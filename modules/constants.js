/**
 * 记忆之忆 Mnemosyne - 常量定义
 */

export const MODULE_NAME = 'st-mnemosyne';
export const MODULE_DISPLAY_NAME = '记忆之忆';
export const VERSION = '0.1.0';

/**
 * 卡片类型枚举
 * 每种类型有不同的更新策略
 */
export const CARD_TYPES = {
    IDENTITY: 'identity',     // 身份 - 覆盖型
    RELATION: 'relation',     // 关系 - 覆盖型
    EVENT: 'event',           // 事件 - 累积型
    PROMISE: 'promise',       // 承诺 - 累积型(状态可变)
    DEBT: 'debt',             // 债务 - 累积型(状态可变)
    ITEM: 'item',             // 物品 - 覆盖型
};

/**
 * 卡片类型的显示信息
 */
export const CARD_TYPE_META = {
    [CARD_TYPES.IDENTITY]: { 
        label: '身份', icon: '👤', color: '#60a5fa', 
        updateMode: 'overwrite',
        description: '角色身份/职业/外貌等稳定信息' 
    },
    [CARD_TYPES.RELATION]: { 
        label: '关系', icon: '❤️', color: '#f472b6', 
        updateMode: 'overwrite',
        description: '角色之间的关系状态' 
    },
    [CARD_TYPES.EVENT]: { 
        label: '事件', icon: '⚡', color: '#fbbf24', 
        updateMode: 'append',
        description: '已发生的关键剧情' 
    },
    [CARD_TYPES.PROMISE]: { 
        label: '承诺', icon: '🤝', color: '#34d399', 
        updateMode: 'append_with_status',
        description: '谁答应谁什么' 
    },
    [CARD_TYPES.DEBT]: { 
        label: '债务', icon: '💰', color: '#fb923c', 
        updateMode: 'append_with_status',
        description: '谁欠谁什么' 
    },
    [CARD_TYPES.ITEM]: { 
        label: '物品', icon: '📦', color: '#a78bfa', 
        updateMode: 'overwrite',
        description: '谁持有什么' 
    },
};

/**
 * 卡片状态(主要用于承诺/债务)
 */
export const CARD_STATUS = {
    ACTIVE: 'active',         // 活跃中(默认)
    FULFILLED: 'fulfilled',   // 已兑现/已偿还
    BROKEN: 'broken',         // 已违约
    CANCELLED: 'cancelled',   // 已取消
    ARCHIVED: 'archived',     // 已归档
};

export const CARD_STATUS_META = {
    [CARD_STATUS.ACTIVE]: { label: '进行中', color: '#60a5fa' },
    [CARD_STATUS.FULFILLED]: { label: '已完成', color: '#34d399' },
    [CARD_STATUS.BROKEN]: { label: '已违约', color: '#f87171' },
    [CARD_STATUS.CANCELLED]: { label: '已取消', color: '#9ca3af' },
    [CARD_STATUS.ARCHIVED]: { label: '已归档', color: '#6b7280' },
};

/**
 * 默认设置
 */
export const DEFAULT_SETTINGS = {
    enabled: true,
    cards: [],
    snapshots: [],
    archivedCards: [],
    
    // 抽取设置
    extractInterval: 5,
    lastExtractMessageId: -1,
    extractPromptStyle: 'gentle',  // 'gentle' | 'strict'
    
    // 注入设置
    injectEnabled: true,
    injectMaxCards: 20,
    injectPosition: 'before_chat',
    
    // 快照设置
    snapshotInterval: 10,
    maxSnapshots: 5,
    lastSnapshotMessageId: -1,
    
    // 归档设置
    archiveAfterMessages: 50,
    
    // 世界书联动
    worldbookSync: false,
    worldbookName: '',
    
    // UI状态
    activeTab: 'cards',
    debug: false,
};

/**
 * ST事件名称(常量化避免拼写错误)
 */
export const ST_EVENTS = {
    MESSAGE_SENT: 'message_sent',
    MESSAGE_RECEIVED: 'message_received',
    CHAT_CHANGED: 'chat_id_changed',
    GENERATION_STARTED: 'generation_started',
    GENERATION_ENDED: 'generation_ended',
};
