/**
 * 记忆之忆 Mnemosyne - 世界书联动
 * 把事实卡导出到世界书,或与世界书双向同步
 */

import { getContext } from '../../../../extensions.js';
import { CARD_TYPES, CARD_TYPE_META } from './constants.js';
import { getAllCards } from './storage.js';
import { cardToInjectionText } from './card-model.js';

/**
 * 获取所有可用的世界书列表
 */
export async function listWorldbooks() {
    try {
        const context = getContext();
        // ST的世界书数据通常通过 world_info 模块管理
        // 不同ST版本API略有不同,这里做兼容处理
        if (typeof window.world_names !== 'undefined') {
            return window.world_names || [];
        }
        return [];
    } catch (error) {
        console.error('[Mnemosyne] 获取世界书列表失败:', error);
        return [];
    }
}

/**
 * 把卡片按角色分组,转换为世界书条目
 * 
 * @param {Array} cards 要导出的卡片
 * @param {string} groupBy 'character' | 'type' | 'flat'
 */
export function cardsToWorldbookEntries(cards, groupBy = 'character') {
    const entries = [];
    
    if (groupBy === 'character') {
        // 按角色分组
        const byCharacter = {};
        cards.forEach(card => {
            const characters = [card.subject];
            if (card.object) characters.push(card.object);
            
            characters.forEach(name => {
                if (!name) return;
                if (!byCharacter[name]) byCharacter[name] = [];
                byCharacter[name].push(card);
            });
        });
        
        for (const [name, charCards] of Object.entries(byCharacter)) {
            const content = formatCharacterEntry(name, charCards);
            entries.push({
                key: [name],
                keysecondary: [],
                comment: `[Mnemosyne] ${name} 的记忆`,
                content,
                constant: false,
                selective: true,
                order: 100,
                position: 0,
                disable: false,
                excludeRecursion: false,
                probability: 100,
                useProbability: false,
            });
        }
    } else if (groupBy === 'type') {
        // 按类型分组
        const byType = {};
        cards.forEach(card => {
            if (!byType[card.type]) byType[card.type] = [];
            byType[card.type].push(card);
        });
        
        for (const [type, typeCards] of Object.entries(byType)) {
            const meta = CARD_TYPE_META[type];
            if (!meta) continue;
            
            const content = typeCards.map(c => '- ' + cardToInjectionText(c)).join('\n');
            entries.push({
                key: [meta.label],
                keysecondary: [],
                comment: `[Mnemosyne] ${meta.label}类记忆`,
                content: `## ${meta.icon} ${meta.label}\n${content}`,
                constant: true, // 类型分组通常常驻
                selective: false,
                order: 100,
                position: 0,
                disable: false,
            });
        }
    } else {
        // 平铺:每张卡一个条目
        cards.forEach(card => {
            const keys = [card.subject];
            if (card.object) keys.push(card.object);
            
            entries.push({
                key: keys.filter(k => k),
                keysecondary: [],
                comment: `[Mnemosyne] ${CARD_TYPE_META[card.type]?.label || card.type}: ${card.subject}`,
                content: cardToInjectionText(card),
                constant: card.locked,
                selective: true,
                order: 100,
                position: 0,
                disable: false,
            });
        });
    }
    
    return entries;
}

/**
 * 格式化某个角色的世界书条目内容
 */
function formatCharacterEntry(name, cards) {
    // 按类型分组该角色的所有卡片
    const groups = {};
    cards.forEach(c => {
        if (!groups[c.type]) groups[c.type] = [];
        groups[c.type].push(c);
    });
    
    const sections = [];
    sections.push(`# ${name}`);
    
    const typeOrder = [
        CARD_TYPES.IDENTITY,
        CARD_TYPES.RELATION,
        CARD_TYPES.PROMISE,
        CARD_TYPES.DEBT,
        CARD_TYPES.ITEM,
        CARD_TYPES.EVENT,
    ];
    
    for (const type of typeOrder) {
        if (!groups[type] || groups[type].length === 0) continue;
        const meta = CARD_TYPE_META[type];
        sections.push(`\n## ${meta.icon} ${meta.label}`);
        groups[type].forEach(c => {
            sections.push('- ' + cardToInjectionText(c).replace(/^\[\S+?\]\s*/, ''));
        });
    }
    
    return sections.join('\n');
}

/**
 * 导出指定卡片到世界书
 * 
 * 注意:这个功能依赖ST的世界书API,不同版本可能不同
 * 这里提供"复制到剪贴板"作为兜底方案
 */
export async function exportToWorldbook(cards, options = {}) {
    const { groupBy = 'character', mode = 'clipboard' } = options;
    
    const entries = cardsToWorldbookEntries(cards, groupBy);
    
    if (mode === 'clipboard') {
        // 兜底方案:生成世界书JSON,让用户自己导入
        const worldbookJSON = {
            entries: {},
        };
        
        entries.forEach((entry, index) => {
            worldbookJSON.entries[index] = {
                uid: index,
                ...entry,
            };
        });
        
        const jsonText = JSON.stringify(worldbookJSON, null, 2);
        
        try {
            await navigator.clipboard.writeText(jsonText);
            return {
                success: true,
                method: 'clipboard',
                count: entries.length,
                message: `已生成 ${entries.length} 个世界书条目并复制到剪贴板,请到ST世界书界面导入。`,
            };
        } catch (error) {
            return {
                success: false,
                error: '剪贴板写入失败,请手动复制下方内容',
                fallbackText: jsonText,
            };
        }
    }
    
    // TODO: 实现直接写入ST世界书的API调用
    return {
        success: false,
        error: '直接写入世界书功能待实现,当前请使用剪贴板模式',
    };
}

/**
 * 生成可下载的世界书JSON文件
 */
export function generateWorldbookFile(cards, options = {}) {
    const { groupBy = 'character', filename = 'mnemosyne_worldbook.json' } = options;
    
    const entries = cardsToWorldbookEntries(cards, groupBy);
    const worldbookJSON = {
        entries: {},
    };
    
    entries.forEach((entry, index) => {
        worldbookJSON.entries[index] = {
            uid: index,
            ...entry,
        };
    });
    
    const blob = new Blob([JSON.stringify(worldbookJSON, null, 2)], { 
        type: 'application/json' 
    });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    return { success: true, count: entries.length };
}
