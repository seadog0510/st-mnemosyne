/**
 * 记忆之忆 Mnemosyne - 存储层
 * 负责所有数据的持久化、读取、迁移
 */

import { extension_settings } from '../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../script.js';
import { MODULE_NAME, DEFAULT_SETTINGS } from './constants.js';

/**
 * 加载设置(自动合并默认值)
 */
export function loadSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = {};
    }
    
    const settings = extension_settings[MODULE_NAME];
    
    // 合并默认值,确保所有字段都存在
    for (const key in DEFAULT_SETTINGS) {
        if (settings[key] === undefined) {
            // 深拷贝数组和对象,避免引用问题
            if (Array.isArray(DEFAULT_SETTINGS[key])) {
                settings[key] = [...DEFAULT_SETTINGS[key]];
            } else if (typeof DEFAULT_SETTINGS[key] === 'object' && DEFAULT_SETTINGS[key] !== null) {
                settings[key] = { ...DEFAULT_SETTINGS[key] };
            } else {
                settings[key] = DEFAULT_SETTINGS[key];
            }
        }
    }
    
    return settings;
}

/**
 * 获取设置(已保证存在)
 */
export function getSettings() {
    return extension_settings[MODULE_NAME] || loadSettings();
}

/**
 * 保存设置(防抖)
 */
export function saveSettings() {
    saveSettingsDebounced();
}

// ============================================================
// 卡片CRUD
// ============================================================

/**
 * 获取所有卡片
 */
export function getAllCards() {
    return getSettings().cards || [];
}

/**
 * 根据ID获取卡片
 */
export function getCardById(id) {
    return getAllCards().find(c => c.id === id);
}

/**
 * 添加卡片
 */
export function addCard(card) {
    const settings = getSettings();
    settings.cards.push(card);
    saveSettings();
    return card;
}

/**
 * 更新卡片
 */
export function updateCard(id, updates) {
    const settings = getSettings();
    const index = settings.cards.findIndex(c => c.id === id);
    if (index === -1) return null;
    
    settings.cards[index] = {
        ...settings.cards[index],
        ...updates,
        updatedAt: Date.now(),
    };
    saveSettings();
    return settings.cards[index];
}

/**
 * 删除卡片
 */
export function deleteCard(id) {
    const settings = getSettings();
    const index = settings.cards.findIndex(c => c.id === id);
    if (index === -1) return false;
    
    settings.cards.splice(index, 1);
    saveSettings();
    return true;
}

/**
 * 按类型筛选卡片
 */
export function getCardsByType(type) {
    return getAllCards().filter(c => c.type === type);
}

/**
 * 批量替换所有卡片(用于快照恢复)
 */
export function replaceAllCards(newCards) {
    const settings = getSettings();
    settings.cards = newCards;
    saveSettings();
}

// ============================================================
// 归档管理
// ============================================================

export function getArchivedCards() {
    return getSettings().archivedCards || [];
}

export function archiveCard(id) {
    const settings = getSettings();
    const index = settings.cards.findIndex(c => c.id === id);
    if (index === -1) return false;
    
    const card = settings.cards[index];
    card.archivedAt = Date.now();
    settings.archivedCards.push(card);
    settings.cards.splice(index, 1);
    saveSettings();
    return true;
}

export function unarchiveCard(id) {
    const settings = getSettings();
    const index = settings.archivedCards.findIndex(c => c.id === id);
    if (index === -1) return false;
    
    const card = settings.archivedCards[index];
    delete card.archivedAt;
    settings.cards.push(card);
    settings.archivedCards.splice(index, 1);
    saveSettings();
    return true;
}

// ============================================================
// 快照管理
// ============================================================

/**
 * 创建一个快照
 */
export function createSnapshot(label = '') {
    const settings = getSettings();
    const snapshot = {
        id: `snap_${Date.now()}`,
        label: label || `自动快照 ${new Date().toLocaleString('zh-CN')}`,
        createdAt: Date.now(),
        cards: JSON.parse(JSON.stringify(settings.cards)), // 深拷贝
        cardCount: settings.cards.length,
    };
    
    settings.snapshots.unshift(snapshot); // 最新的在前
    
    // 限制快照数量
    const maxSnapshots = settings.maxSnapshots || 5;
    if (settings.snapshots.length > maxSnapshots) {
        settings.snapshots = settings.snapshots.slice(0, maxSnapshots);
    }
    
    saveSettings();
    return snapshot;
}

/**
 * 恢复快照
 */
export function restoreSnapshot(snapshotId) {
    const settings = getSettings();
    const snapshot = settings.snapshots.find(s => s.id === snapshotId);
    if (!snapshot) return false;
    
    // 在恢复前自动创建一个当前状态的备份
    createSnapshot('恢复前自动备份');
    
    // 恢复卡片数据
    settings.cards = JSON.parse(JSON.stringify(snapshot.cards));
    saveSettings();
    return true;
}

export function deleteSnapshot(snapshotId) {
    const settings = getSettings();
    const index = settings.snapshots.findIndex(s => s.id === snapshotId);
    if (index === -1) return false;
    
    settings.snapshots.splice(index, 1);
    saveSettings();
    return true;
}

export function getAllSnapshots() {
    return getSettings().snapshots || [];
}

// ============================================================
// 导入导出
// ============================================================

/**
 * 导出全部数据为JSON字符串
 */
export function exportData() {
    const settings = getSettings();
    return JSON.stringify({
        version: '0.1.0',
        exportedAt: Date.now(),
        cards: settings.cards,
        archivedCards: settings.archivedCards,
        snapshots: settings.snapshots,
    }, null, 2);
}

/**
 * 从JSON字符串导入数据
 */
export function importData(jsonString, mode = 'replace') {
    try {
        const data = JSON.parse(jsonString);
        if (!data.cards || !Array.isArray(data.cards)) {
            throw new Error('数据格式错误:缺少cards字段');
        }
        
        const settings = getSettings();
        
        if (mode === 'replace') {
            settings.cards = data.cards;
            settings.archivedCards = data.archivedCards || [];
            settings.snapshots = data.snapshots || [];
        } else if (mode === 'merge') {
            // 合并模式:已有同ID则跳过,新ID则添加
            const existingIds = new Set(settings.cards.map(c => c.id));
            const newCards = data.cards.filter(c => !existingIds.has(c.id));
            settings.cards.push(...newCards);
        }
        
        saveSettings();
        return { success: true, count: data.cards.length };
    } catch (error) {
        return { success: false, error: error.message };
    }
}
