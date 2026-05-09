/**
 * 记忆之忆 Mnemosyne - 卡片模型
 * 卡片的创建、验证、比较、序列化
 */

import { CARD_TYPES, CARD_STATUS, CARD_TYPE_META } from './constants.js';

/**
 * 生成唯一ID
 */
export function generateCardId() {
    return `card_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * 创建一张新卡片
 * 
 * @param {Object} params
 * @param {string} params.type - 卡片类型
 * @param {string} params.subject - 主语(必填)
 * @param {string} params.content - 内容
 * @param {string} [params.object] - 对象(关系/承诺/债务类需要)
 * @param {Object} [params.source] - 来源信息 { messageId, swipeId, excerpt }
 * @param {string} [params.status] - 状态(承诺/债务用)
 * @param {boolean} [params.locked] - 是否锁定
 * @param {Object} [params.extra] - 额外字段
 */
export function createCard(params) {
    const now = Date.now();
    
    return {
        id: generateCardId(),
        type: params.type,
        subject: params.subject || '',
        object: params.object || '',
        content: params.content || '',
        status: params.status || CARD_STATUS.ACTIVE,
        locked: params.locked || false,
        source: params.source || {
            messageId: -1,
            swipeId: 0,
            excerpt: '',
        },
        extra: params.extra || {},
        createdAt: now,
        updatedAt: now,
        // 用于"易变性"判断,值越高越稳定
        stability: getDefaultStability(params.type),
    };
}

/**
 * 默认稳定度(用于注入时排序)
 */
function getDefaultStability(type) {
    const map = {
        [CARD_TYPES.IDENTITY]: 90,
        [CARD_TYPES.RELATION]: 60,
        [CARD_TYPES.EVENT]: 80,
        [CARD_TYPES.PROMISE]: 75,
        [CARD_TYPES.DEBT]: 75,
        [CARD_TYPES.ITEM]: 50,
    };
    return map[type] || 50;
}

/**
 * 验证卡片数据是否合法
 */
export function validateCard(card) {
    const errors = [];
    
    if (!card.type || !Object.values(CARD_TYPES).includes(card.type)) {
        errors.push('卡片类型无效');
    }
    if (!card.subject || card.subject.trim() === '') {
        errors.push('主语不能为空');
    }
    if (!card.content || card.content.trim() === '') {
        errors.push('内容不能为空');
    }
    
    // 关系/承诺/债务类必须有对象
    if ([CARD_TYPES.RELATION, CARD_TYPES.PROMISE, CARD_TYPES.DEBT].includes(card.type)) {
        if (!card.object || card.object.trim() === '') {
            errors.push(`${CARD_TYPE_META[card.type].label}类卡片必须填写"对象"字段`);
        }
    }
    
    return {
        valid: errors.length === 0,
        errors,
    };
}

/**
 * 判断两张卡片是否描述同一件事(用于覆盖型更新和冲突检测)
 * 
 * - 身份卡: 同一个subject就视为同一张
 * - 关系卡: subject + object 相同(无方向)
 * - 物品卡: subject + content关键词
 * - 事件/承诺/债务: 较难判断同一性,主要靠内容相似度
 */
export function cardsAreSameEntity(a, b) {
    if (a.type !== b.type) return false;
    
    switch (a.type) {
        case CARD_TYPES.IDENTITY:
            return a.subject === b.subject;
        
        case CARD_TYPES.RELATION:
            // 关系无方向:A↔B 等于 B↔A
            return (a.subject === b.subject && a.object === b.object) ||
                   (a.subject === b.object && a.object === b.subject);
        
        case CARD_TYPES.ITEM:
            // 同一人持有同一类物品视为同一张
            return a.subject === b.subject && 
                   contentKeywordMatch(a.content, b.content);
        
        case CARD_TYPES.PROMISE:
        case CARD_TYPES.DEBT:
            // 同样的承诺/债务关系
            return a.subject === b.subject && 
                   a.object === b.object &&
                   contentKeywordMatch(a.content, b.content);
        
        case CARD_TYPES.EVENT:
            // 事件几乎不会"是同一张",每个事件都是独立的
            return false;
        
        default:
            return false;
    }
}

/**
 * 简单的内容关键词匹配(粗略判断是否描述同一件事)
 */
function contentKeywordMatch(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    
    // 提取关键字符(去掉标点和空格)
    const normalize = s => s.replace(/[\s,.，。、；;:：!！?？""''""']/g, '');
    const na = normalize(a);
    const nb = normalize(b);
    
    // 一方包含另一方,或共同字符占比超60%
    if (na.includes(nb) || nb.includes(na)) return true;
    
    const minLen = Math.min(na.length, nb.length);
    if (minLen === 0) return false;
    
    let common = 0;
    const setB = new Set(nb);
    for (const ch of na) {
        if (setB.has(ch)) common++;
    }
    return common / minLen > 0.6;
}

/**
 * 检测两张卡片是否构成冲突(主语颠倒等)
 * 
 * 这是抗污染的核心算法之一
 */
export function detectConflict(oldCard, newCard) {
    if (oldCard.type !== newCard.type) return null;
    
    // 1. 主语颠倒型冲突(最严重):承诺/债务方向反了
    if ([CARD_TYPES.PROMISE, CARD_TYPES.DEBT].includes(oldCard.type)) {
        if (oldCard.subject === newCard.object && 
            oldCard.object === newCard.subject &&
            contentKeywordMatch(oldCard.content, newCard.content)) {
            return {
                type: 'subject_reversed',
                severity: 'high',
                message: '检测到主语颠倒:同一件事但执行者反了',
                oldCard,
                newCard,
            };
        }
    }
    
    // 2. 身份冲突:同一人不同身份
    if (oldCard.type === CARD_TYPES.IDENTITY && 
        oldCard.subject === newCard.subject &&
        oldCard.content !== newCard.content &&
        !contentKeywordMatch(oldCard.content, newCard.content)) {
        return {
            type: 'identity_changed',
            severity: 'medium',
            message: '检测到身份变更,需要确认是否合理',
            oldCard,
            newCard,
        };
    }
    
    // 3. 关系冲突:同一对角色关系剧变
    if (oldCard.type === CARD_TYPES.RELATION &&
        cardsAreSameEntity(oldCard, newCard) &&
        !contentKeywordMatch(oldCard.content, newCard.content)) {
        return {
            type: 'relation_changed',
            severity: 'low',
            message: '关系状态发生变化',
            oldCard,
            newCard,
        };
    }
    
    return null;
}

/**
 * 把卡片格式化成简洁的文本(用于注入prompt)
 */
export function cardToInjectionText(card) {
    const meta = CARD_TYPE_META[card.type];
    if (!meta) return '';
    
    const label = `[${meta.label}]`;
    
    switch (card.type) {
        case CARD_TYPES.IDENTITY:
            return `${label} ${card.subject}: ${card.content}`;
        
        case CARD_TYPES.RELATION:
            return `${label} ${card.subject} ↔ ${card.object}: ${card.content}`;
        
        case CARD_TYPES.EVENT:
            return `${label} ${card.subject} ${card.content}`;
        
        case CARD_TYPES.PROMISE:
            return `${label} ${card.subject} 答应 ${card.object}: ${card.content}` +
                   (card.status !== CARD_STATUS.ACTIVE ? ` (${card.status})` : '');
        
        case CARD_TYPES.DEBT:
            return `${label} ${card.subject} 欠 ${card.object}: ${card.content}` +
                   (card.status !== CARD_STATUS.ACTIVE ? ` (${card.status})` : '');
        
        case CARD_TYPES.ITEM:
            return `${label} ${card.subject} 持有: ${card.content}`;
        
        default:
            return `${label} ${card.subject}: ${card.content}`;
    }
}

/**
 * 估算卡片在prompt中占用的token数(粗略,中文1字≈0.5token,英文1词≈1.3token)
 */
export function estimateCardTokens(card) {
    const text = cardToInjectionText(card);
    // 粗略估算:中文按字符数*0.6,英文按字符数*0.3
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - chineseChars;
    return Math.ceil(chineseChars * 0.6 + otherChars * 0.3);
}
