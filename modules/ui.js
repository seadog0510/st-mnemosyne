/**
 * 记忆之忆 Mnemosyne - 主UI
 * 渲染所有界面元素,处理用户交互
 */

import { CARD_TYPES, CARD_TYPE_META, CARD_STATUS, CARD_STATUS_META } from './constants.js';
import { 
    getAllCards, getCardById, addCard, updateCard, deleteCard, 
    getSettings, saveSettings, getAllSnapshots, restoreSnapshot, 
    deleteSnapshot, exportData, importData, getArchivedCards,
    createSnapshot as createSnapshotStorage
} from './storage.js';
import { createCard, validateCard, cardToInjectionText } from './card-model.js';
import { extractCards, getPendingConflicts, resolveConflict } from './extractor.js';
import { performInjection, getInjectionStatus } from './injector.js';
import { exportToWorldbook, generateWorldbookFile } from './worldbook.js';
import { performAutoArchive, findArchiveCandidates } from './archive.js';

// ============================================================
// HTML 模板
// ============================================================

function getMainPanelHTML() {
    return `
    <div id="mnemosyne-panel" class="mnemosyne-container">
        <div class="mnemosyne-header">
            <h3>📜 记忆之忆 Mnemosyne</h3>
            <div class="mnemosyne-header-actions">
                <button class="mn-btn-icon" id="mn-toggle-enabled" title="启用/禁用">⚡</button>
                <button class="mn-btn-icon" id="mn-open-fullscreen" title="全屏管理">⛶</button>
            </div>
        </div>
        
        <div class="mnemosyne-summary">
            <div class="mn-stat">
                <div class="mn-stat-num" id="mn-stat-active">0</div>
                <div class="mn-stat-label">活跃卡</div>
            </div>
            <div class="mn-stat">
                <div class="mn-stat-num" id="mn-stat-tokens">0</div>
                <div class="mn-stat-label">注入Token</div>
            </div>
            <div class="mn-stat">
                <div class="mn-stat-num" id="mn-stat-conflicts">0</div>
                <div class="mn-stat-label">待裁决</div>
            </div>
            <div class="mn-stat">
                <div class="mn-stat-num" id="mn-stat-archived">0</div>
                <div class="mn-stat-label">已归档</div>
            </div>
        </div>
        
        <div class="mnemosyne-quick-actions">
            <button class="mn-btn mn-btn-primary" id="mn-extract-now">⚡ 立即抽取</button>
            <button class="mn-btn" id="mn-add-card">+ 手动添加</button>
            <button class="mn-btn" id="mn-open-fullscreen-2">📋 管理面板</button>
        </div>
        
        <div class="mnemosyne-conflict-banner" id="mn-conflict-banner" style="display:none;">
            <span>⚠️ 有 <b id="mn-conflict-count">0</b> 个记忆冲突待裁决</span>
            <button class="mn-btn-mini" id="mn-resolve-conflicts">去处理</button>
        </div>
    </div>
    `;
}

function getFullscreenHTML() {
    return `
    <div id="mnemosyne-fullscreen" class="mn-fullscreen" style="display:none;">
        <div class="mn-fs-header">
            <h2>📜 记忆之忆 - 管理面板</h2>
            <button class="mn-btn-icon mn-fs-close" id="mn-fs-close">✕</button>
        </div>
        
        <div class="mn-fs-tabs">
            <button class="mn-tab active" data-tab="cards">📋 卡片</button>
            <button class="mn-tab" data-tab="conflicts">⚖️ 冲突</button>
            <button class="mn-tab" data-tab="archive">📦 归档</button>
            <button class="mn-tab" data-tab="snapshots">📸 快照</button>
            <button class="mn-tab" data-tab="settings">⚙️ 设置</button>
        </div>
        
        <div class="mn-fs-content">
            <!-- 卡片Tab -->
            <div class="mn-tab-content active" data-tab-content="cards">
                <div class="mn-toolbar">
                    <input type="text" id="mn-search" placeholder="🔍 搜索..." class="mn-input">
                    <select id="mn-filter-type" class="mn-input">
                        <option value="">全部类型</option>
                        <option value="${CARD_TYPES.IDENTITY}">👤 身份</option>
                        <option value="${CARD_TYPES.RELATION}">❤️ 关系</option>
                        <option value="${CARD_TYPES.EVENT}">⚡ 事件</option>
                        <option value="${CARD_TYPES.PROMISE}">🤝 承诺</option>
                        <option value="${CARD_TYPES.DEBT}">💰 债务</option>
                        <option value="${CARD_TYPES.ITEM}">📦 物品</option>
                    </select>
                    <button class="mn-btn mn-btn-primary" id="mn-add-card-fs">+ 新增</button>
                </div>
                <div class="mn-cards-list" id="mn-cards-list"></div>
            </div>
            
            <!-- 冲突Tab -->
            <div class="mn-tab-content" data-tab-content="conflicts">
                <div class="mn-conflicts-list" id="mn-conflicts-list">
                    <div class="mn-empty">暂无冲突 ✨</div>
                </div>
            </div>
            
            <!-- 归档Tab -->
            <div class="mn-tab-content" data-tab-content="archive">
                <div class="mn-toolbar">
                    <button class="mn-btn" id="mn-auto-archive">🤖 自动归档候选</button>
                </div>
                <div class="mn-archive-list" id="mn-archive-list"></div>
            </div>
            
            <!-- 快照Tab -->
            <div class="mn-tab-content" data-tab-content="snapshots">
                <div class="mn-toolbar">
                    <button class="mn-btn mn-btn-primary" id="mn-create-snapshot">📸 创建快照</button>
                </div>
                <div class="mn-snapshots-list" id="mn-snapshots-list"></div>
            </div>
            
            <!-- 设置Tab -->
            <div class="mn-tab-content" data-tab-content="settings">
                <div class="mn-settings-form" id="mn-settings-form"></div>
            </div>
        </div>
    </div>
    `;
}

function getCardEditHTML() {
    return `
    <div id="mn-card-edit-modal" class="mn-modal" style="display:none;">
        <div class="mn-modal-content">
            <div class="mn-modal-header">
                <h3 id="mn-modal-title">编辑卡片</h3>
                <button class="mn-btn-icon" id="mn-modal-close">✕</button>
            </div>
            <div class="mn-modal-body">
                <div class="mn-form-row">
                    <label>类型</label>
                    <select id="mn-edit-type" class="mn-input">
                        <option value="${CARD_TYPES.IDENTITY}">👤 身份</option>
                        <option value="${CARD_TYPES.RELATION}">❤️ 关系</option>
                        <option value="${CARD_TYPES.EVENT}">⚡ 事件</option>
                        <option value="${CARD_TYPES.PROMISE}">🤝 承诺</option>
                        <option value="${CARD_TYPES.DEBT}">💰 债务</option>
                        <option value="${CARD_TYPES.ITEM}">📦 物品</option>
                    </select>
                </div>
                <div class="mn-form-row">
                    <label>主语 <span class="mn-required">*</span></label>
                    <input type="text" id="mn-edit-subject" class="mn-input" placeholder="谁(具体角色名)">
                </div>
                <div class="mn-form-row" id="mn-edit-object-row">
                    <label>对象</label>
                    <input type="text" id="mn-edit-object" class="mn-input" placeholder="对谁">
                </div>
                <div class="mn-form-row">
                    <label>内容 <span class="mn-required">*</span></label>
                    <textarea id="mn-edit-content" class="mn-input mn-textarea" placeholder="描述内容"></textarea>
                </div>
                <div class="mn-form-row" id="mn-edit-status-row">
                    <label>状态</label>
                    <select id="mn-edit-status" class="mn-input">
                        <option value="${CARD_STATUS.ACTIVE}">进行中</option>
                        <option value="${CARD_STATUS.FULFILLED}">已完成</option>
                        <option value="${CARD_STATUS.BROKEN}">已违约</option>
                        <option value="${CARD_STATUS.CANCELLED}">已取消</option>
                    </select>
                </div>
                <div class="mn-form-row mn-form-checkbox">
                    <label>
                        <input type="checkbox" id="mn-edit-locked"> 🔒 锁定(不被自动修改)
                    </label>
                </div>
            </div>
            <div class="mn-modal-footer">
                <button class="mn-btn" id="mn-edit-cancel">取消</button>
                <button class="mn-btn mn-btn-primary" id="mn-edit-save">保存</button>
            </div>
        </div>
    </div>
    `;
}

// ============================================================
// 渲染函数
// ============================================================

/**
 * 渲染主面板
 */
export function renderMainPanel() {
    if ($('#mnemosyne-panel').length === 0) {
        // 找一个合适的位置插入
        const target = $('#extensions_settings');
        if (target.length === 0) {
            console.warn('[Mnemosyne] 找不到挂载点 #extensions_settings');
            return;
        }
        target.append(getMainPanelHTML());
    }
    
    updateMainPanelStats();
    bindMainPanelEvents();
}

/**
 * 更新主面板的统计数字
 */
export function updateMainPanelStats() {
    const allCards = getAllCards();
    const archivedCards = getArchivedCards();
    const conflicts = getPendingConflicts();
    const injectStatus = getInjectionStatus();
    
    $('#mn-stat-active').text(allCards.length);
    $('#mn-stat-tokens').text(injectStatus.tokenEstimate || 0);
    $('#mn-stat-conflicts').text(conflicts.length);
    $('#mn-stat-archived').text(archivedCards.length);
    
    if (conflicts.length > 0) {
        $('#mn-conflict-banner').show();
        $('#mn-conflict-count').text(conflicts.length);
    } else {
        $('#mn-conflict-banner').hide();
    }
}

/**
 * 渲染全屏面板
 */
export function renderFullscreen() {
    if ($('#mnemosyne-fullscreen').length === 0) {
        $('body').append(getFullscreenHTML());
        $('body').append(getCardEditHTML());
        bindFullscreenEvents();
    }
}

/**
 * 显示全屏面板
 */
export function showFullscreen() {
    renderFullscreen();
    $('#mnemosyne-fullscreen').show();
    renderCardsList();
}

/**
 * 隐藏全屏面板
 */
export function hideFullscreen() {
    $('#mnemosyne-fullscreen').hide();
}

/**
 * 渲染卡片列表
 */
function renderCardsList() {
    const cards = getAllCards();
    const searchText = $('#mn-search').val()?.toLowerCase() || '';
    const filterType = $('#mn-filter-type').val() || '';
    
    let filtered = cards;
    if (filterType) {
        filtered = filtered.filter(c => c.type === filterType);
    }
    if (searchText) {
        filtered = filtered.filter(c => 
            (c.subject || '').toLowerCase().includes(searchText) ||
            (c.object || '').toLowerCase().includes(searchText) ||
            (c.content || '').toLowerCase().includes(searchText)
        );
    }
    
    // 按类型分组
    const groups = {};
    const typeOrder = [
        CARD_TYPES.IDENTITY, CARD_TYPES.RELATION, 
        CARD_TYPES.PROMISE, CARD_TYPES.DEBT, 
        CARD_TYPES.ITEM, CARD_TYPES.EVENT
    ];
    
    filtered.forEach(c => {
        if (!groups[c.type]) groups[c.type] = [];
        groups[c.type].push(c);
    });
    
    let html = '';
    
    if (filtered.length === 0) {
        html = '<div class="mn-empty">暂无卡片,点击「+ 新增」开始创建,或者「立即抽取」让AI自动生成 ✨</div>';
    } else {
        for (const type of typeOrder) {
            if (!groups[type] || groups[type].length === 0) continue;
            const meta = CARD_TYPE_META[type];
            
            html += `<div class="mn-card-group">
                <div class="mn-card-group-header">
                    ${meta.icon} ${meta.label} <span class="mn-count">(${groups[type].length})</span>
                </div>
                <div class="mn-card-group-items">
            `;
            
            groups[type].forEach(card => {
                html += renderCard(card);
            });
            
            html += `</div></div>`;
        }
    }
    
    $('#mn-cards-list').html(html);
    
    // 绑定卡片操作
    $('.mn-card-edit-btn').off('click').on('click', function() {
        const id = $(this).closest('.mn-card-item').data('id');
        openCardEditor(id);
    });
    
    $('.mn-card-delete-btn').off('click').on('click', function() {
        const id = $(this).closest('.mn-card-item').data('id');
        if (confirm('确定删除这张卡片?')) {
            deleteCard(id);
            renderCardsList();
            updateMainPanelStats();
        }
    });
    
    $('.mn-card-lock-btn').off('click').on('click', function() {
        const id = $(this).closest('.mn-card-item').data('id');
        const card = getCardById(id);
        if (card) {
            updateCard(id, { locked: !card.locked });
            renderCardsList();
        }
    });
    
    $('.mn-card-source-btn').off('click').on('click', function() {
        const id = $(this).closest('.mn-card-item').data('id');
        const card = getCardById(id);
        if (card && card.source) {
            const msg = `来源消息: 第 ${card.source.messageId + 1} 条\n` +
                       `创建时间: ${new Date(card.createdAt).toLocaleString('zh-CN')}\n` +
                       `更新时间: ${new Date(card.updatedAt).toLocaleString('zh-CN')}\n\n` +
                       `原文摘录:\n${card.source.excerpt || '(无)'}`;
            alert(msg);
        }
    });
}

/**
 * 渲染单张卡片
 */
function renderCard(card) {
    const meta = CARD_TYPE_META[card.type];
    const statusMeta = CARD_STATUS_META[card.status];
    
    let title = '';
    if ([CARD_TYPES.RELATION].includes(card.type)) {
        title = `${card.subject} ↔ ${card.object}`;
    } else if ([CARD_TYPES.PROMISE, CARD_TYPES.DEBT].includes(card.type)) {
        const verb = card.type === CARD_TYPES.PROMISE ? '答应' : '欠';
        title = `${card.subject} ${verb} ${card.object}`;
    } else {
        title = card.subject;
    }
    
    const statusBadge = card.status !== CARD_STATUS.ACTIVE && statusMeta ? 
        `<span class="mn-status-badge" style="color:${statusMeta.color}">${statusMeta.label}</span>` : '';
    
    return `
        <div class="mn-card-item" data-id="${card.id}">
            <div class="mn-card-item-header">
                <span class="mn-card-title">${escapeHtml(title)}</span>
                ${card.locked ? '<span class="mn-lock-icon">🔒</span>' : ''}
                ${statusBadge}
            </div>
            <div class="mn-card-item-content">${escapeHtml(card.content)}</div>
            <div class="mn-card-item-actions">
                <button class="mn-btn-mini mn-card-edit-btn">✏️ 编辑</button>
                <button class="mn-btn-mini mn-card-lock-btn">${card.locked ? '🔓 解锁' : '🔒 锁定'}</button>
                <button class="mn-btn-mini mn-card-source-btn">📍 来源</button>
                <button class="mn-btn-mini mn-card-delete-btn">🗑️ 删除</button>
            </div>
        </div>
    `;
}

/**
 * 渲染冲突列表
 */
function renderConflictsList() {
    const conflicts = getPendingConflicts();
    
    if (conflicts.length === 0) {
        $('#mn-conflicts-list').html('<div class="mn-empty">暂无冲突 ✨</div>');
        return;
    }
    
    let html = '';
    conflicts.forEach((conflict, index) => {
        const oldText = cardToInjectionText(conflict.oldCard);
        const newText = cardToInjectionText(conflict.newCard);
        
        html += `
            <div class="mn-conflict-item" data-index="${index}">
                <div class="mn-conflict-header">
                    <span class="mn-conflict-severity mn-sev-${conflict.severity}">${getSeverityLabel(conflict.severity)}</span>
                    <span class="mn-conflict-message">${escapeHtml(conflict.message)}</span>
                </div>
                <div class="mn-conflict-cards">
                    <div class="mn-conflict-old">
                        <div class="mn-conflict-label">📜 原有记忆</div>
                        <div class="mn-conflict-content">${escapeHtml(oldText)}</div>
                    </div>
                    <div class="mn-conflict-vs">VS</div>
                    <div class="mn-conflict-new">
                        <div class="mn-conflict-label">🆕 新抽取</div>
                        <div class="mn-conflict-content">${escapeHtml(newText)}</div>
                    </div>
                </div>
                <div class="mn-conflict-actions">
                    <button class="mn-btn" data-action="keep_old">采用原有</button>
                    <button class="mn-btn mn-btn-primary" data-action="use_new">采用新的</button>
                    <button class="mn-btn" data-action="keep_both">都保留</button>
                </div>
            </div>
        `;
    });
    
    $('#mn-conflicts-list').html(html);
    
    // 绑定按钮
    $('.mn-conflict-actions .mn-btn').off('click').on('click', function() {
        const action = $(this).data('action');
        const index = $(this).closest('.mn-conflict-item').data('index');
        
        if (resolveConflict(index, action)) {
            renderConflictsList();
            renderCardsList();
            updateMainPanelStats();
        }
    });
}

function getSeverityLabel(severity) {
    return { high: '🔴 严重', medium: '🟡 中等', low: '🟢 轻微' }[severity] || severity;
}

/**
 * 渲染快照列表
 */
function renderSnapshotsList() {
    const snapshots = getAllSnapshots();
    
    if (snapshots.length === 0) {
        $('#mn-snapshots-list').html('<div class="mn-empty">暂无快照</div>');
        return;
    }
    
    let html = '';
    snapshots.forEach(snap => {
        html += `
            <div class="mn-snapshot-item" data-id="${snap.id}">
                <div class="mn-snapshot-info">
                    <div class="mn-snapshot-label">${escapeHtml(snap.label)}</div>
                    <div class="mn-snapshot-meta">
                        ${new Date(snap.createdAt).toLocaleString('zh-CN')} · ${snap.cardCount} 张卡片
                    </div>
                </div>
                <div class="mn-snapshot-actions">
                    <button class="mn-btn-mini" data-action="restore">↩️ 恢复</button>
                    <button class="mn-btn-mini" data-action="delete">🗑️</button>
                </div>
            </div>
        `;
    });
    
    $('#mn-snapshots-list').html(html);
    
    $('.mn-snapshot-actions .mn-btn-mini').off('click').on('click', function() {
        const action = $(this).data('action');
        const id = $(this).closest('.mn-snapshot-item').data('id');
        
        if (action === 'restore') {
            if (confirm('恢复这个快照?当前数据会自动备份。')) {
                if (restoreSnapshot(id)) {
                    alert('恢复成功!');
                    renderCardsList();
                    renderSnapshotsList();
                    updateMainPanelStats();
                }
            }
        } else if (action === 'delete') {
            if (confirm('删除这个快照?')) {
                deleteSnapshot(id);
                renderSnapshotsList();
            }
        }
    });
}

/**
 * 渲染归档列表
 */
function renderArchiveList() {
    const archived = getArchivedCards();
    const candidates = findArchiveCandidates();
    
    let html = '';
    
    if (candidates.length > 0) {
        html += `<div class="mn-archive-section">
            <div class="mn-archive-section-title">🤖 自动归档候选 (${candidates.length})</div>
        `;
        candidates.forEach(({ card, reason }) => {
            html += `
                <div class="mn-archive-candidate">
                    <div class="mn-card-title">${escapeHtml(card.subject)}: ${escapeHtml(card.content)}</div>
                    <div class="mn-archive-reason">${escapeHtml(reason)}</div>
                </div>
            `;
        });
        html += '</div>';
    }
    
    if (archived.length > 0) {
        html += `<div class="mn-archive-section">
            <div class="mn-archive-section-title">📦 已归档 (${archived.length})</div>
        `;
        archived.forEach(card => {
            html += `
                <div class="mn-archive-item">
                    <div class="mn-card-title">${escapeHtml(card.subject)}: ${escapeHtml(card.content)}</div>
                    <div class="mn-archive-date">归档于 ${new Date(card.archivedAt).toLocaleString('zh-CN')}</div>
                </div>
            `;
        });
        html += '</div>';
    }
    
    if (html === '') {
        html = '<div class="mn-empty">暂无归档</div>';
    }
    
    $('#mn-archive-list').html(html);
}

/**
 * 渲染设置表单
 */
function renderSettingsForm() {
    const settings = getSettings();
    
    const html = `
        <div class="mn-settings-section">
            <h4>⚡ 抽取设置</h4>
            <div class="mn-form-row">
                <label>抽取间隔(每N条消息抽取一次)</label>
                <input type="number" id="mn-set-extract-interval" class="mn-input" 
                       value="${settings.extractInterval}" min="1" max="50">
            </div>
            <div class="mn-form-row">
                <label>抽取prompt风格</label>
                <select id="mn-set-prompt-style" class="mn-input">
                    <option value="gentle" ${settings.extractPromptStyle === 'gentle' ? 'selected' : ''}>温和版(中文,推荐)</option>
                    <option value="strict" ${settings.extractPromptStyle === 'strict' ? 'selected' : ''}>严格版(更结构化)</option>
                </select>
            </div>
        </div>
        
        <div class="mn-settings-section">
            <h4>📤 注入设置</h4>
            <div class="mn-form-row mn-form-checkbox">
                <label>
                    <input type="checkbox" id="mn-set-inject-enabled" ${settings.injectEnabled ? 'checked' : ''}>
                    启用注入
                </label>
            </div>
            <div class="mn-form-row">
                <label>最大注入卡片数</label>
                <input type="number" id="mn-set-inject-max" class="mn-input" 
                       value="${settings.injectMaxCards}" min="1" max="100">
            </div>
            <div class="mn-form-row">
                <label>注入位置</label>
                <select id="mn-set-inject-position" class="mn-input">
                    <option value="before_chat" ${settings.injectPosition === 'before_chat' ? 'selected' : ''}>聊天历史之前</option>
                    <option value="in_chat" ${settings.injectPosition === 'in_chat' ? 'selected' : ''}>聊天历史中(深度4)</option>
                    <option value="after_chat" ${settings.injectPosition === 'after_chat' ? 'selected' : ''}>聊天历史之后</option>
                </select>
            </div>
        </div>
        
        <div class="mn-settings-section">
            <h4>📸 快照与归档</h4>
            <div class="mn-form-row">
                <label>自动快照间隔(消息数)</label>
                <input type="number" id="mn-set-snapshot-interval" class="mn-input" 
                       value="${settings.snapshotInterval}" min="5" max="100">
            </div>
            <div class="mn-form-row">
                <label>最大快照保留数</label>
                <input type="number" id="mn-set-max-snapshots" class="mn-input" 
                       value="${settings.maxSnapshots}" min="1" max="20">
            </div>
            <div class="mn-form-row">
                <label>事件归档阈值(超过N条消息自动归档候选)</label>
                <input type="number" id="mn-set-archive-after" class="mn-input" 
                       value="${settings.archiveAfterMessages}" min="10" max="500">
            </div>
        </div>
        
        <div class="mn-settings-section">
            <h4>🌐 世界书</h4>
            <div class="mn-form-row">
                <button class="mn-btn" id="mn-export-wb-clipboard">📋 导出到剪贴板</button>
                <button class="mn-btn" id="mn-export-wb-file">💾 下载JSON文件</button>
            </div>
        </div>
        
        <div class="mn-settings-section">
            <h4>💾 数据管理</h4>
            <div class="mn-form-row">
                <button class="mn-btn" id="mn-export-all">📤 导出全部数据</button>
                <button class="mn-btn" id="mn-import-all">📥 导入数据</button>
            </div>
            <div class="mn-form-row mn-form-checkbox">
                <label>
                    <input type="checkbox" id="mn-set-debug" ${settings.debug ? 'checked' : ''}>
                    🐛 调试模式(在Console打印详细日志)
                </label>
            </div>
        </div>
        
        <div class="mn-settings-section">
            <button class="mn-btn mn-btn-primary mn-btn-block" id="mn-save-settings">💾 保存设置</button>
        </div>
    `;
    
    $('#mn-settings-form').html(html);
    bindSettingsEvents();
}

// ============================================================
// 事件绑定
// ============================================================

function bindMainPanelEvents() {
    $('#mn-extract-now').off('click').on('click', async function() {
        const $btn = $(this);
        $btn.prop('disabled', true).text('⏳ 抽取中...');
        
        try {
            const result = await extractCards({ force: true });
            if (result.skipped) {
                toast(`⏭️ 跳过抽取: ${result.reason}`);
            } else if (result.success) {
                let msg = `✅ 抽取完成: 新增 ${result.added} 张, 更新 ${result.updated} 张`;
                if (result.conflicts && result.conflicts.length > 0) {
                    msg += `, 冲突 ${result.conflicts.length} 个`;
                }
                toast(msg);
            } else {
                toast('❌ 抽取失败: ' + result.error);
            }
            updateMainPanelStats();
            if ($('#mnemosyne-fullscreen').is(':visible')) {
                renderCardsList();
            }
        } catch (error) {
            console.error('[Mnemosyne] 抽取异常:', error);
            toast('❌ 抽取异常: ' + error.message);
        } finally {
            $btn.prop('disabled', false).text('⚡ 立即抽取');
        }
    });
    
    $('#mn-add-card').off('click').on('click', function() {
        showFullscreen();
        setTimeout(() => openCardEditor(null), 100);
    });
    
    $('#mn-open-fullscreen, #mn-open-fullscreen-2').off('click').on('click', function() {
        showFullscreen();
    });
    
    $('#mn-toggle-enabled').off('click').on('click', function() {
        const settings = getSettings();
        settings.enabled = !settings.enabled;
        saveSettings();
        toast(settings.enabled ? '✅ 已启用' : '⏸️ 已禁用');
    });
    
    $('#mn-resolve-conflicts').off('click').on('click', function() {
        showFullscreen();
        $('.mn-tab[data-tab="conflicts"]').click();
    });
}

function bindFullscreenEvents() {
    $('#mn-fs-close').off('click').on('click', hideFullscreen);
    
    // Tab切换
    $('.mn-tab').off('click').on('click', function() {
        const tab = $(this).data('tab');
        $('.mn-tab').removeClass('active');
        $(this).addClass('active');
        $('.mn-tab-content').removeClass('active');
        $(`[data-tab-content="${tab}"]`).addClass('active');
        
        // 进入Tab时刷新内容
        if (tab === 'cards') renderCardsList();
        else if (tab === 'conflicts') renderConflictsList();
        else if (tab === 'archive') renderArchiveList();
        else if (tab === 'snapshots') renderSnapshotsList();
        else if (tab === 'settings') renderSettingsForm();
    });
    
    // 搜索和筛选
    $('#mn-search').off('input').on('input', renderCardsList);
    $('#mn-filter-type').off('change').on('change', renderCardsList);
    
    // 新增卡片
    $('#mn-add-card-fs').off('click').on('click', function() {
        openCardEditor(null);
    });
    
    // 卡片编辑模态框
    $('#mn-modal-close, #mn-edit-cancel').off('click').on('click', closeCardEditor);
    $('#mn-edit-save').off('click').on('click', saveCardFromEditor);
    
    // 类型变化时显示/隐藏对象字段
    $('#mn-edit-type').off('change').on('change', function() {
        const type = $(this).val();
        const needsObject = [CARD_TYPES.RELATION, CARD_TYPES.PROMISE, CARD_TYPES.DEBT].includes(type);
        const needsStatus = [CARD_TYPES.PROMISE, CARD_TYPES.DEBT].includes(type);
        $('#mn-edit-object-row').toggle(needsObject);
        $('#mn-edit-status-row').toggle(needsStatus);
    });
    
    // 创建快照
    $('#mn-create-snapshot').off('click').on('click', function() {
        const label = prompt('快照标签(可选)', '手动快照');
        if (label !== null) {
            createSnapshotStorage(label || '手动快照');
            renderSnapshotsList();
            toast('✅ 快照已创建');
        }
    });
    
    // 自动归档
    $('#mn-auto-archive').off('click').on('click', function() {
        const result = performAutoArchive();
        toast(`📦 已归档 ${result.archived} 张卡片`);
        renderArchiveList();
        updateMainPanelStats();
    });
}

function bindSettingsEvents() {
    $('#mn-save-settings').off('click').on('click', function() {
        const settings = getSettings();
        
        settings.extractInterval = parseInt($('#mn-set-extract-interval').val()) || 5;
        settings.extractPromptStyle = $('#mn-set-prompt-style').val();
        settings.injectEnabled = $('#mn-set-inject-enabled').is(':checked');
        settings.injectMaxCards = parseInt($('#mn-set-inject-max').val()) || 20;
        settings.injectPosition = $('#mn-set-inject-position').val();
        settings.snapshotInterval = parseInt($('#mn-set-snapshot-interval').val()) || 10;
        settings.maxSnapshots = parseInt($('#mn-set-max-snapshots').val()) || 5;
        settings.archiveAfterMessages = parseInt($('#mn-set-archive-after').val()) || 50;
        settings.debug = $('#mn-set-debug').is(':checked');
        
        saveSettings();
        toast('✅ 设置已保存');
    });
    
    $('#mn-export-wb-clipboard').off('click').on('click', async function() {
        const cards = getAllCards();
        if (cards.length === 0) {
            toast('⚠️ 没有卡片可导出');
            return;
        }
        const result = await exportToWorldbook(cards, { mode: 'clipboard' });
        if (result.success) {
            toast(result.message);
        } else {
            toast('❌ ' + result.error);
        }
    });
    
    $('#mn-export-wb-file').off('click').on('click', function() {
        const cards = getAllCards();
        if (cards.length === 0) {
            toast('⚠️ 没有卡片可导出');
            return;
        }
        generateWorldbookFile(cards);
        toast('💾 文件已下载');
    });
    
    $('#mn-export-all').off('click').on('click', function() {
        const json = exportData();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `mnemosyne_backup_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast('💾 数据已导出');
    });
    
    $('#mn-import-all').off('click').on('click', function() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const text = await file.text();
            const mode = confirm('点击"确定"覆盖,点击"取消"合并') ? 'replace' : 'merge';
            const result = importData(text, mode);
            if (result.success) {
                toast(`✅ 导入成功: ${result.count} 张卡片`);
                renderCardsList();
                updateMainPanelStats();
            } else {
                toast('❌ 导入失败: ' + result.error);
            }
        };
        input.click();
    });
}

// ============================================================
// 卡片编辑器
// ============================================================

let editingCardId = null;

function openCardEditor(cardId) {
    editingCardId = cardId;
    const card = cardId ? getCardById(cardId) : null;
    
    $('#mn-modal-title').text(card ? '编辑卡片' : '新增卡片');
    $('#mn-edit-type').val(card?.type || CARD_TYPES.IDENTITY);
    $('#mn-edit-subject').val(card?.subject || '');
    $('#mn-edit-object').val(card?.object || '');
    $('#mn-edit-content').val(card?.content || '');
    $('#mn-edit-status').val(card?.status || CARD_STATUS.ACTIVE);
    $('#mn-edit-locked').prop('checked', card?.locked || false);
    
    // 触发类型变化事件,显示正确的字段
    $('#mn-edit-type').trigger('change');
    
    $('#mn-card-edit-modal').show();
}

function closeCardEditor() {
    $('#mn-card-edit-modal').hide();
    editingCardId = null;
}

function saveCardFromEditor() {
    const type = $('#mn-edit-type').val();
    const subject = $('#mn-edit-subject').val().trim();
    const object = $('#mn-edit-object').val().trim();
    const content = $('#mn-edit-content').val().trim();
    const status = $('#mn-edit-status').val();
    const locked = $('#mn-edit-locked').is(':checked');
    
    const cardData = {
        type, subject, object, content, status, locked,
    };
    
    if (editingCardId) {
        // 更新
        const validation = validateCard({ ...cardData });
        if (!validation.valid) {
            alert('验证失败:\n' + validation.errors.join('\n'));
            return;
        }
        updateCard(editingCardId, cardData);
        toast('✅ 卡片已更新');
    } else {
        // 新增
        const newCard = createCard(cardData);
        const validation = validateCard(newCard);
        if (!validation.valid) {
            alert('验证失败:\n' + validation.errors.join('\n'));
            return;
        }
        addCard(newCard);
        toast('✅ 卡片已添加');
    }
    
    closeCardEditor();
    renderCardsList();
    updateMainPanelStats();
}

// ============================================================
// 工具函数
// ============================================================

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * 简易toast提示
 */
export function toast(message, duration = 2500) {
    let $toast = $('#mn-toast');
    if ($toast.length === 0) {
        $toast = $('<div id="mn-toast" class="mn-toast"></div>');
        $('body').append($toast);
    }
    
    $toast.text(message).addClass('show');
    
    clearTimeout(window.__mnToastTimer);
    window.__mnToastTimer = setTimeout(() => {
        $toast.removeClass('show');
    }, duration);
}
