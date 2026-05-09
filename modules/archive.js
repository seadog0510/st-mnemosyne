/**
 * 记忆之忆 Mnemosyne - 归档系统
 * 自动归档老旧的事件卡,保持活跃记忆精简
 */

import { CARD_TYPES, CARD_STATUS } from './constants.js';
import { getAllCards, getSettings, archiveCard, saveSettings } from './storage.js';
import { getContext } from '../../../../extensions.js';

/**
 * 自动归档候选检测
 * 
 * 归档规则:
 * 1. 已完成/已违约/已取消的承诺、债务 → 归档
 * 2. 距今超过N轮的事件卡(N可配置) → 归档
 * 3. 锁定的卡永不归档
 */
export function findArchiveCandidates() {
    const settings = getSettings();
    const allCards = getAllCards();
    const context = getContext();
    const currentMsgId = (context.chat || []).length - 1;
    const archiveAfter = settings.archiveAfterMessages || 50;
    
    const candidates = [];
    
    for (const card of allCards) {
        if (card.locked) continue;
        
        // 已完结的承诺/债务
        if ([CARD_TYPES.PROMISE, CARD_TYPES.DEBT].includes(card.type)) {
            if ([CARD_STATUS.FULFILLED, CARD_STATUS.BROKEN, CARD_STATUS.CANCELLED].includes(card.status)) {
                candidates.push({
                    card,
                    reason: `${card.status === CARD_STATUS.FULFILLED ? '已完成' : 
                             card.status === CARD_STATUS.BROKEN ? '已违约' : '已取消'}`,
                });
                continue;
            }
        }
        
        // 老的事件卡
        if (card.type === CARD_TYPES.EVENT) {
            const sourceMsgId = card.source?.messageId;
            if (typeof sourceMsgId === 'number' && sourceMsgId >= 0) {
                if (currentMsgId - sourceMsgId > archiveAfter) {
                    candidates.push({
                        card,
                        reason: `事件距今超过 ${archiveAfter} 轮`,
                    });
                }
            }
        }
    }
    
    return candidates;
}

/**
 * 执行自动归档
 */
export function performAutoArchive() {
    const candidates = findArchiveCandidates();
    let archived = 0;
    
    for (const { card } of candidates) {
        if (archiveCard(card.id)) {
            archived++;
        }
    }
    
    if (archived > 0) {
        console.log(`[Mnemosyne] 自动归档了 ${archived} 张卡片`);
    }
    
    return { archived, total: candidates.length };
}

/**
 * 生成归档摘要(把多个老卡压缩成一段文字,作为"剧情线")
 */
export function summarizeArchive(archivedCards) {
    if (!archivedCards || archivedCards.length === 0) return '';
    
    // 按角色分组
    const byCharacter = {};
    archivedCards.forEach(card => {
        const name = card.subject;
        if (!byCharacter[name]) byCharacter[name] = [];
        byCharacter[name].push(card);
    });
    
    const lines = [];
    for (const [name, cards] of Object.entries(byCharacter)) {
        const events = cards.filter(c => c.type === CARD_TYPES.EVENT);
        const promises = cards.filter(c => c.type === CARD_TYPES.PROMISE);
        
        if (events.length > 0) {
            lines.push(`${name}: ${events.map(e => e.content).slice(0, 3).join('; ')}`);
        }
        if (promises.length > 0) {
            lines.push(`${name}的承诺: ${promises.map(p => `→${p.object} ${p.content}`).join('; ')}`);
        }
    }
    
    return lines.join('\n');
}
