/**
 * 记忆之忆 Mnemosyne - 抽取器
 * 调用LLM从对话中抽取事实卡
 */

import { getContext } from '../../../../extensions.js';
import { CARD_TYPES, CARD_STATUS, CARD_TYPE_META } from './constants.js';
import { createCard, validateCard, cardsAreSameEntity, detectConflict } from './card-model.js';
import { 
    getAllCards, addCard, updateCard, deleteCard,
    getSettings, saveSettings, createSnapshot 
} from './storage.js';

/**
 * 温和版抽取prompt(默认)
 */
const PROMPT_GENTLE = `你是一位严谨的剧情记录员。请基于"最近对话"和"已有记忆卡片",抽取需要新增或更新的事实卡。

## 卡片类型说明
- identity(身份): 角色的身份/职业/外貌等稳定信息
- relation(关系): 两个角色之间的关系状态
- event(事件): 已发生的关键剧情节点
- promise(承诺): 谁答应了谁什么
- debt(债务): 谁欠了谁什么
- item(物品): 谁持有什么有意义的物品

## 严格要求
1. 主语必须明确: subject字段必须是具体角色名,不能是"她/他/某人"
2. 关系/承诺/债务必须有object: 明确写出对象是谁
3. 只抽取已发生的事实: 不推测、不脑补、不评价
4. 如果某事实已在已有记忆中且无变化,不要重复输出
5. 优先抽取重要事件,日常对话琐事不必抽取

## 输出格式(严格JSON,不要任何额外文字、不要markdown代码块)
{
  "new_cards": [
    {
      "type": "promise",
      "subject": "角色A",
      "object": "角色B",
      "content": "答应下周一起去吃自助餐",
      "excerpt": "原文中的关键句"
    }
  ],
  "update_cards": [
    {
      "match": { "type": "identity", "subject": "角色A" },
      "new_content": "更新后的内容"
    }
  ]
}

如果没有需要更新的内容,输出 {"new_cards": [], "update_cards": []}

## 已有记忆(避免重复抽取相同内容)
{{EXISTING_CARDS}}

## 最近对话
{{RECENT_MESSAGES}}

请输出JSON:`;

const PROMPT_STRICT = `你是剧情记录员,从对话中抽取事实卡片用于长期记忆。

## 卡片类型(必须使用以下英文type)
identity / relation / event / promise / debt / item

## 抗污染要求(极重要)
1. 主语必须是明确的具体角色名,严禁使用代词
2. 涉及双方关系(promise/debt/relation)必须填写object
3. 严格区分"A对B说"和"B对A说"
4. 引用对话时分清说话人和听话人
5. 不推测未明说的内容,不合并不同人的行为
6. 已存在的记忆若无变化则跳过,不要重复

## 输出严格JSON格式(无额外文字、无markdown代码块)
{
  "new_cards": [{"type":"...","subject":"...","object":"...","content":"...","excerpt":"..."}],
  "update_cards": [{"match":{"type":"...","subject":"..."},"new_content":"..."}]
}

## 已有记忆
{{EXISTING_CARDS}}

## 最近对话
{{RECENT_MESSAGES}}

请输出JSON:`;

function formatExistingCards(cards, maxCards = 50) {
    if (!cards || cards.length === 0) return '(暂无记忆)';
    
    const sorted = [...cards].sort((a, b) => {
        if (a.locked !== b.locked) return a.locked ? -1 : 1;
        return (b.updatedAt || 0) - (a.updatedAt || 0);
    }).slice(0, maxCards);
    
    return sorted.map((c, i) => {
        let line = `${i+1}. [${c.type}] subject="${c.subject}"`;
        if (c.object) line += ` object="${c.object}"`;
        line += ` content="${c.content}"`;
        if (c.locked) line += ' (locked)';
        return line;
    }).join('\n');
}

function formatRecentMessages(messages) {
    if (!messages || messages.length === 0) return '(无消息)';
    
    return messages.map(m => {
        const speaker = m.is_user ? '用户' : (m.name || 'AI');
        let content = m.mes || '';
        if (content.length > 1500) {
            content = content.substring(0, 1500) + '...(已截断)';
        }
        return `[${speaker}]: ${content}`;
    }).join('\n\n');
}

async function callExtractionAPI(promptContent) {
    const context = getContext();
    
    if (!context.generateQuietPrompt) {
        throw new Error('ST的generateQuietPrompt API不可用');
    }
    
    try {
        const result = await context.generateQuietPrompt(promptContent, false, false);
        return result;
    } catch (error) {
        console.error('[Mnemosyne] 抽取API调用失败:', error);
        throw error;
    }
}

function parseExtractionResult(rawText) {
    if (!rawText || typeof rawText !== 'string') {
        return { new_cards: [], update_cards: [] };
    }
    
    let cleaned = rawText.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        console.warn('[Mnemosyne] 抽取结果不包含JSON:', rawText.substring(0, 200));
        return { new_cards: [], update_cards: [] };
    }
    
    try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
            new_cards: Array.isArray(parsed.new_cards) ? parsed.new_cards : [],
            update_cards: Array.isArray(parsed.update_cards) ? parsed.update_cards : [],
        };
    } catch (error) {
        console.warn('[Mnemosyne] JSON解析失败:', error.message, rawText.substring(0, 200));
        return { new_cards: [], update_cards: [] };
    }
}

/**
 * 应用抽取结果到本地存储(纯本地操作,不会污染)
 */
function applyExtractionResult(result, sourceMessageId) {
    const settings = getSettings();
    const existingCards = [...getAllCards()];
    
    let added = 0;
    let updated = 0;
    const conflicts = [];
    
    for (const rawCard of result.new_cards) {
        if (!rawCard.type || !rawCard.subject || !rawCard.content) continue;
        
        const newCard = createCard({
            type: rawCard.type,
            subject: rawCard.subject,
            object: rawCard.object || '',
            content: rawCard.content,
            source: {
                messageId: sourceMessageId,
                swipeId: 0,
                excerpt: rawCard.excerpt || '',
            },
        });
        
        const validation = validateCard(newCard);
        if (!validation.valid) {
            console.warn('[Mnemosyne] 跳过非法卡片:', validation.errors, rawCard);
            continue;
        }
        
        const existing = existingCards.find(c => cardsAreSameEntity(c, newCard));
        
        if (existing) {
            if (existing.locked) {
                console.log('[Mnemosyne] 跳过锁定卡片:', existing.id);
                continue;
            }
            
            const conflict = detectConflict(existing, newCard);
            if (conflict) {
                conflicts.push(conflict);
                
                if (conflict.severity === 'high') {
                    if (!settings.pendingConflicts) settings.pendingConflicts = [];
                    settings.pendingConflicts.push({
                        ...conflict,
                        detectedAt: Date.now(),
                    });
                    continue;
                }
            }
            
            const meta = CARD_TYPE_META[existing.type];
            if (meta && meta.updateMode === 'overwrite') {
                updateCard(existing.id, {
                    content: newCard.content,
                    object: newCard.object || existing.object,
                    source: newCard.source,
                });
                updated++;
            } else {
                addCard(newCard);
                added++;
            }
        } else {
            addCard(newCard);
            added++;
        }
    }
    
    for (const updateRequest of result.update_cards) {
        if (!updateRequest.match || !updateRequest.new_content) continue;
        
        const target = existingCards.find(c => 
            c.type === updateRequest.match.type &&
            c.subject === updateRequest.match.subject &&
            (!updateRequest.match.object || c.object === updateRequest.match.object)
        );
        
        if (target && !target.locked) {
            updateCard(target.id, {
                content: updateRequest.new_content,
                source: {
                    messageId: sourceMessageId,
                    swipeId: 0,
                    excerpt: updateRequest.excerpt || '',
                },
            });
            updated++;
        }
    }
    
    saveSettings();
    return { added, updated, conflicts };
}

/**
 * 主抽取流程
 */
export async function extractCards(options = {}) {
    const settings = getSettings();
    const context = getContext();
    
    if (!settings.enabled && !options.force) {
        return { skipped: true, reason: '插件已禁用' };
    }
    
    const chat = context.chat || [];
    if (chat.length === 0) {
        return { skipped: true, reason: '无对话记录' };
    }
    
    const currentMsgId = chat.length - 1;
    
    if (!options.force) {
        const interval = settings.extractInterval || 5;
        if (currentMsgId - settings.lastExtractMessageId < interval) {
            return { 
                skipped: true, 
                reason: `距上次抽取仅 ${currentMsgId - settings.lastExtractMessageId} 条,需要至少 ${interval} 条` 
            };
        }
    }
    
    const lookback = options.lookback || (settings.extractInterval * 2 || 10);
    const recentMessages = chat.slice(-lookback);
    const existingCards = getAllCards();
    
    const promptTemplate = settings.extractPromptStyle === 'strict' ? PROMPT_STRICT : PROMPT_GENTLE;
    const fullPrompt = promptTemplate
        .replace('{{EXISTING_CARDS}}', formatExistingCards(existingCards))
        .replace('{{RECENT_MESSAGES}}', formatRecentMessages(recentMessages));
    
    if (settings.debug) {
        console.log('[Mnemosyne] 抽取prompt:\n', fullPrompt);
    }
    
    if (currentMsgId - settings.lastSnapshotMessageId >= settings.snapshotInterval) {
        createSnapshot('抽取前自动快照');
        settings.lastSnapshotMessageId = currentMsgId;
    }
    
    let rawResult;
    try {
        rawResult = await callExtractionAPI(fullPrompt);
    } catch (error) {
        return { 
            success: false, 
            error: '抽取API调用失败: ' + error.message,
        };
    }
    
    if (settings.debug) {
        console.log('[Mnemosyne] 抽取原始返回:', rawResult);
    }
    
    if (!rawResult || rawResult.trim() === '') {
        return {
            success: false,
            error: '模型返回为空(可能被中转站拦截或触发审查)',
        };
    }
    
    const parsed = parseExtractionResult(rawResult);
    const stats = applyExtractionResult(parsed, currentMsgId);
    
    settings.lastExtractMessageId = currentMsgId;
    saveSettings();
    
    return {
        success: true,
        ...stats,
        rawNew: parsed.new_cards.length,
        rawUpdate: parsed.update_cards.length,
    };
}

export function getPendingConflicts() {
    const settings = getSettings();
    return settings.pendingConflicts || [];
}

export function resolveConflict(conflictIndex, resolution) {
    const settings = getSettings();
    if (!settings.pendingConflicts || conflictIndex >= settings.pendingConflicts.length) {
        return false;
    }
    
    const conflict = settings.pendingConflicts[conflictIndex];
    
    if (resolution === 'use_new') {
        const newCard = createCard({
            type: conflict.newCard.type,
            subject: conflict.newCard.subject,
            object: conflict.newCard.object,
            content: conflict.newCard.content,
            source: conflict.newCard.source,
        });
        deleteCard(conflict.oldCard.id);
        addCard(newCard);
    } else if (resolution === 'keep_both') {
        const newCard = createCard({
            type: conflict.newCard.type,
            subject: conflict.newCard.subject,
            object: conflict.newCard.object,
            content: conflict.newCard.content,
            source: conflict.newCard.source,
        });
        addCard(newCard);
    }
    
    settings.pendingConflicts.splice(conflictIndex, 1);
    saveSettings();
    return true;
}
