/**
 * 记忆之忆 Mnemosyne
 * SillyTavern 记忆插件 - 事实卡架构
 * 
 * @version 0.1.0
 * @author Lotus Eater
 */

import { eventSource, event_types } from '../../../../script.js';
import { MODULE_NAME, MODULE_DISPLAY_NAME, VERSION } from './modules/constants.js';
import { loadSettings, getSettings } from './modules/storage.js';
import { extractCards } from './modules/extractor.js';
import { performInjection } from './modules/injector.js';
import { performAutoArchive } from './modules/archive.js';
import { renderMainPanel, updateMainPanelStats, toast } from './modules/ui.js';

// ============================================================
// 事件钩子
// ============================================================

/**
 * AI回复完成后:尝试抽取记忆
 */
async function onMessageReceived() {
    const settings = getSettings();
    if (!settings.enabled) return;
    
    try {
        // 异步抽取,不阻塞主流程
        setTimeout(async () => {
            try {
                const result = await extractCards();
                if (settings.debug) {
                    console.log('[Mnemosyne] 自动抽取结果:', result);
                }
                if (!result.skipped && result.success) {
                    updateMainPanelStats();
                    if (result.added > 0 || result.updated > 0) {
                        const msg = `📜 记忆已更新 (新增${result.added}, 更新${result.updated}` +
                                    (result.conflicts?.length ? `, 冲突${result.conflicts.length}` : '') + ')';
                        toast(msg);
                    }
                }
            } catch (error) {
                console.error('[Mnemosyne] 自动抽取失败:', error);
            }
        }, 500);
    } catch (error) {
        console.error('[Mnemosyne] onMessageReceived异常:', error);
    }
}

/**
 * 生成开始前:执行注入
 */
function onGenerationStarted() {
    const settings = getSettings();
    if (!settings.enabled) return;
    
    try {
        performInjection();
    } catch (error) {
        console.error('[Mnemosyne] 注入失败:', error);
    }
}

/**
 * 聊天切换时:刷新UI
 */
function onChatChanged() {
    try {
        updateMainPanelStats();
    } catch (error) {
        console.error('[Mnemosyne] onChatChanged异常:', error);
    }
}

// ============================================================
// 初始化
// ============================================================

/**
 * 注册所有事件钩子
 */
function registerEventListeners() {
    if (!eventSource || !event_types) {
        console.warn('[Mnemosyne] ST事件系统不可用,某些功能可能受限');
        return;
    }
    
    // ST的事件名在不同版本可能略有不同,做兼容
    const eventMap = {
        MESSAGE_RECEIVED: event_types.MESSAGE_RECEIVED || event_types.message_received || 'message_received',
        GENERATION_STARTED: event_types.GENERATION_STARTED || event_types.generation_started || 'generation_started',
        CHAT_CHANGED: event_types.CHAT_CHANGED || event_types.chat_id_changed || 'chat_id_changed',
    };
    
    try {
        eventSource.on(eventMap.MESSAGE_RECEIVED, onMessageReceived);
        eventSource.on(eventMap.GENERATION_STARTED, onGenerationStarted);
        eventSource.on(eventMap.CHAT_CHANGED, onChatChanged);
        
        console.log('[Mnemosyne] ✓ 事件钩子已注册');
    } catch (error) {
        console.error('[Mnemosyne] 事件钩子注册失败:', error);
    }
}

/**
 * 插件主入口
 */
jQuery(async () => {
    console.log(`[${MODULE_NAME}] 正在加载 v${VERSION}...`);
    
    try {
        // 1. 加载配置
        loadSettings();
        
        // 2. 渲染主面板
        renderMainPanel();
        
        // 3. 注册事件
        registerEventListeners();
        
        // 4. 暴露调试接口到window(开发用)
        if (typeof window !== 'undefined') {
            window.Mnemosyne = {
                version: VERSION,
                getSettings,
                extractCards,
                performInjection,
                performAutoArchive,
                toast,
            };
        }
        
        console.log(`[${MODULE_NAME}] ✓ 加载成功 v${VERSION}`);
        console.log(`[${MODULE_NAME}] 调试接口已挂载到 window.Mnemosyne`);
    } catch (error) {
        console.error(`[${MODULE_NAME}] ✗ 加载失败:`, error);
    }
});
