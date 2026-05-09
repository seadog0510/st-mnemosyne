/**
 * 记忆之忆 Mnemosyne - 注入器
 * 把卡片格式化后注入到主模型的prompt中
 */

import { getContext } from '../../../../extensions.js';
import { CARD_TYPES, CARD_TYPE_META, CARD_STATUS } from './constants.js';
import { cardToInjectionText, estimateCardTokens } from './card-model.js';
import { getAllCards, getSettings } from './storage.js';

const INJECTION_KEY = 'mnemosyne_memory';

/**
 * 决定哪些卡片应该被注入
 * 
 * 策略(分层):
 * 1. 锁定的卡片始终注入
 * 2. 身份卡始终注入(数量少且重要)
 * 3. 当前对话提到的角色相关卡片注入
 * 4. 最近更新的活跃卡注入
 * 5. 限制总数,超出的按优先级砍掉
 */
export function selectCardsForInjection(allCards, recentMessages, maxCards = 20) {
    if (!allCards || allCards.length === 0) return [];
    
    // 提取最近消息中提到的角色名(粗略:从已有卡片的subject/object匹配)
    const allEntities = new Set();
    allCards.forEach(c => {
        if (c.subject) allEntities.add(c.subject);
        if (c.object) allEntities.add(c.object);
    });
    
    const recentText = (recentMessages || []).map(m => m.mes || '').join(' ');
    const mentionedEntities = new Set();
    allEntities.forEach(name => {
        if (name && recentText.includes(name)) {
            mentionedEntities.add(name);
        }
    });
    
    // 给每张卡打分
    const scored = allCards.map(card => {
        let score = 0;
        
        // 锁定卡:最高优先级
        if (card.locked) score += 1000;
        
        // 身份卡:基础高分
        if (card.type === CARD_TYPES.IDENTITY) score += 100;
        
        // 提到的角色相关:高分
        if (mentionedEntities.has(card.subject)) score += 80;
        if (mentionedEntities.has(card.object)) score += 80;
        
        // 状态为active的承诺/债务:重要
        if ([CARD_TYPES.PROMISE, CARD_TYPES.DEBT].includes(card.type)) {
            if (card.status === CARD_STATUS.ACTIVE) score += 60;
            else score += 10; // 已完成的也保留少量
        }
        
        // 关系卡:中等
        if (card.type === CARD_TYPES.RELATION) score += 40;
        
        // 物品卡:基础
        if (card.type === CARD_TYPES.ITEM) score += 30;
        
        // 事件卡:按时间衰减(最近的事件分高)
        if (card.type === CARD_TYPES.EVENT) {
            const daysSinceUpdate = (Date.now() - (card.updatedAt || card.createdAt)) / (1000 * 60 * 60 * 24);
            score += Math.max(50 - daysSinceUpdate * 5, 5);
        }
        
        // 已归档/已取消的卡降权
        if ([CARD_STATUS.ARCHIVED, CARD_STATUS.CANCELLED].includes(card.status)) {
            score -= 50;
        }
        
        // 稳定度加成
        score += (card.stability || 50) * 0.2;
        
        return { card, score };
    });
    
    // 排序并截断
    scored.sort((a, b) => b.score - a.score);
    const selected = scored.slice(0, maxCards).map(s => s.card);
    
    return selected;
}

/**
 * 把选中的卡片格式化成最终注入到prompt的文本
 */
export function formatInjection(cards) {
    if (!cards || cards.length === 0) return '';
    
    // 按类型分组,显示更清晰
    const groups = {};
    cards.forEach(card => {
        const type = card.type;
        if (!groups[type]) groups[type] = [];
        groups[type].push(card);
    });
    
    const sections = [];
    
    // 按固定顺序输出各类型
    const typeOrder = [
        CARD_TYPES.IDENTITY,
        CARD_TYPES.RELATION,
        CARD_TYPES.PROMISE,
        CARD_TYPES.DEBT,
        CARD_TYPES.ITEM,
        CARD_TYPES.EVENT,
    ];
    
    for (const type of typeOrder) {
        if (!groups[type]) continue;
        const meta = CARD_TYPE_META[type];
        const lines = groups[type].map(c => '  - ' + cardToInjectionText(c).replace(/^\[\S+?\]\s*/, ''));
        sections.push(`### ${meta.icon} ${meta.label}\n${lines.join('\n')}`);
    }
    
    if (sections.length === 0) return '';
    
    const header = '## 📜 已知事实(请据此保持剧情连贯,严格区分主语)\n';
    const footer = '\n(以上是根据剧情自动维护的事实记忆,请优先信任此处信息。)';
    
    return header + sections.join('\n\n') + footer;
}

/**
 * 计算注入内容的token预估
 */
export function estimateInjectionTokens(cards) {
    if (!cards || cards.length === 0) return 0;
    
    let total = 0;
    cards.forEach(c => {
        total += estimateCardTokens(c);
    });
    
    // 加上头尾文本和分组标题的开销
    total += 50;
    
    return total;
}

/**
 * 执行注入(注册到ST的generate前置钩子)
 * 
 * 这个函数会被ST在每次生成前调用,我们把记忆塞进去
 */
export function performInjection() {
    const settings = getSettings();
    
    if (!settings.enabled || !settings.injectEnabled) {
        clearInjection();
        return;
    }
    
    const context = getContext();
    if (!context.setExtensionPrompt) {
        console.warn('[Mnemosyne] setExtensionPrompt API不可用,无法注入');
        return;
    }
    
    const allCards = getAllCards();
    const recentMessages = (context.chat || []).slice(-10);
    
    const selected = selectCardsForInjection(
        allCards, 
        recentMessages, 
        settings.injectMaxCards || 20
    );
    
    if (selected.length === 0) {
        clearInjection();
        return;
    }
    
    const injectionText = formatInjection(selected);
    
    // ST的setExtensionPrompt签名: (key, value, position, depth)
    // position: 0=开头, 1=结尾, 2=深度N
    // depth: 在聊天历史中的深度位置(配合position=2使用)
    
    let position = 0;
    let depth = 0;
    
    if (settings.injectPosition === 'before_chat') {
        position = 0; // 注入到system prompt之后,聊天历史之前
    } else if (settings.injectPosition === 'in_chat') {
        position = 2;
        depth = 4; // 在最近4条消息之前
    } else if (settings.injectPosition === 'after_chat') {
        position = 1;
    }
    
    try {
        context.setExtensionPrompt(INJECTION_KEY, injectionText, position, depth);
        
        if (settings.debug) {
            console.log(`[Mnemosyne] 已注入 ${selected.length} 张卡片, 约 ${estimateInjectionTokens(selected)} tokens`);
            console.log('[Mnemosyne] 注入内容:\n' + injectionText);
        }
    } catch (error) {
        console.error('[Mnemosyne] 注入失败:', error);
    }
    
    return {
        cardCount: selected.length,
        tokenEstimate: estimateInjectionTokens(selected),
        cards: selected,
    };
}

/**
 * 清除注入
 */
export function clearInjection() {
    const context = getContext();
    if (context.setExtensionPrompt) {
        try {
            context.setExtensionPrompt(INJECTION_KEY, '', 0, 0);
        } catch (e) {}
    }
}

/**
 * 获取当前注入状态(用于UI显示)
 */
export function getInjectionStatus() {
    const settings = getSettings();
    if (!settings.enabled || !settings.injectEnabled) {
        return { active: false, cardCount: 0, tokenEstimate: 0 };
    }
    
    const allCards = getAllCards();
    const context = getContext();
    const recentMessages = (context.chat || []).slice(-10);
    
    const selected = selectCardsForInjection(
        allCards,
        recentMessages,
        settings.injectMaxCards || 20
    );
    
    return {
        active: true,
        cardCount: selected.length,
        tokenEstimate: estimateInjectionTokens(selected),
        totalCards: allCards.length,
    };
}
