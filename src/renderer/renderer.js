/**
 * 渲染进程主脚本
 * 负责 UI 交互和与主进程的 IPC 通信
 */

// Electron IPC
const { ipcRenderer } = require('electron');

// UI 文本（从 zh-CN.js 加载，已挂载到 window.UI_TEXT）
// 注意：不要使用 const 重新声明，直接引用 window.UI_TEXT
var UI_TEXT = window.UI_TEXT || {};

// IPC API 封装
const electronAPI = {
  listObjects: async () => {
    const result = await ipcRenderer.invoke('storage:list');
    if (!result.success) throw result.error;
    return result.data;
  },
  
  selectFile: async () => {
    return await ipcRenderer.invoke('dialog:openFile');
  },
  
  saveFile: async (defaultFilename) => {
    return await ipcRenderer.invoke('dialog:saveFile', defaultFilename);
  },
  
  uploadFile: async (filePath, onProgress) => {
    // 监听进度更新
    const progressHandler = (event, data) => onProgress(data);
    ipcRenderer.on('storage:upload:progress', progressHandler);
    
    try {
      const result = await ipcRenderer.invoke('storage:upload', filePath);
      if (!result.success) throw result.error;
      return result.data;
    } finally {
      ipcRenderer.removeListener('storage:upload:progress', progressHandler);
    }
  },
  
  downloadFile: async (key, savePath, onProgress) => {
    // 监听进度更新
    const progressHandler = (event, data) => onProgress(data);
    ipcRenderer.on('storage:download:progress', progressHandler);
    
    try {
      const result = await ipcRenderer.invoke('storage:download', key, savePath);
      if (!result.success) throw result.error;
    } finally {
      ipcRenderer.removeListener('storage:download:progress', progressHandler);
    }
  },
  
  selectFolder: async () => {
    return await ipcRenderer.invoke('dialog:openFolder');
  },
  
  downloadFilesBatch: async (keys, folderPath, onProgress) => {
    // 监听进度更新
    const progressHandler = (event, data) => onProgress(data);
    ipcRenderer.on('storage:download-batch:progress', progressHandler);
    
    try {
      const result = await ipcRenderer.invoke('storage:download-batch', keys, folderPath);
      if (!result.success) throw result.error;
      return result.data;
    } finally {
      ipcRenderer.removeListener('storage:download-batch:progress', progressHandler);
    }
  },
  
  deleteFile: async (key) => {
    const result = await ipcRenderer.invoke('storage:delete', key);
    if (!result.success) throw result.error;
  },
  
  deleteFilesBatch: async (keys) => {
    const result = await ipcRenderer.invoke('storage:delete-batch', keys);
    if (!result.success) throw result.error;
    return result.data;
  },
  
  previewFile: async (key) => {
    const result = await ipcRenderer.invoke('storage:preview', key);
    if (!result.success) throw result.error;
    return result.data;
  },
  
  copyUrl: async (key, format) => {
    const result = await ipcRenderer.invoke('storage:copy-url', key, format);
    if (!result.success) throw result.error;
    return result.data;
  },
  
  confirmDelete: async (key, message) => {
    const result = await ipcRenderer.invoke('dialog:confirm', message);
    return result.confirmed;
  },
  
  showErrorWithActions: async (error, context) => {
    const result = await ipcRenderer.invoke('dialog:errorWithActions', error, context);
    return result;
  },
  
  openLogLocation: async () => {
    const result = await ipcRenderer.invoke('logs:openLocation');
    return result.success;
  },
  
  openSettings: async () => {
    const result = await ipcRenderer.invoke('settings:openWindow');
    if (!result.success) {
      const error = new Error(result.error?.message || 'Open settings failed');
      error.userMessage = result.error?.userMessage || (UI_TEXT.errorUnknown || '打开设置窗口失败');
      throw error;
    }
    return true;
  }
};

// 暴露到全局
window.electronAPI = electronAPI;

// DOM 元素引用
const elements = {
  btnUpload: document.getElementById('btn-upload'),
  btnDownload: document.getElementById('btn-download'),
  btnPreview: document.getElementById('btn-preview'),
  btnDelete: document.getElementById('btn-delete'),
  btnRefresh: document.getElementById('btn-refresh'),
  searchInput: document.getElementById('search-input'),
  btnClearSearch: document.getElementById('btn-clear-search'),
  filterType: document.getElementById('filter-type'),
  filterDateStart: document.getElementById('filter-date-start'),
  filterDateEnd: document.getElementById('filter-date-end'),
  btnClearDate: document.getElementById('btn-clear-date'),
  objectListBody: document.getElementById('object-list-body'),
  objectListContainer: document.getElementById('object-list-container'),
  settingsEmbeddedContainer: document.getElementById('settings-embedded-container'),
  settingsEmbeddedFrame: document.getElementById('settings-embedded-frame'),
  statusText: document.getElementById('status-text'),
  objectCount: document.getElementById('object-count'),
  loading: document.getElementById('loading'),
  emptyState: document.getElementById('empty-state'),
  contextMenu: document.getElementById('context-menu'),
  progressOverlay: document.getElementById('progress-overlay'),
  progressBar: document.getElementById('progress-bar'),
  progressText: document.getElementById('progress-text'),
  progressSpeed: document.getElementById('progress-speed'),
  progressEta: document.getElementById('progress-eta'),
  progressTitle: document.getElementById('progress-title'),
  progressCurrentFile: document.getElementById('progress-current-file'),
  progressBatchInfo: document.getElementById('progress-batch-info'),
  btnCancelProgress: document.getElementById('btn-cancel-progress'),
  notificationContainer: document.getElementById('notification-container')
};

// 应用状态
const state = {
  objects: [],
  filteredObjects: [], // 过滤后的对象列表
  selectedObjects: new Set(),
  isLoading: false,
  currentSort: { column: 'name', direction: 'asc' },
  searchTerm: '', // 当前搜索词
  filterType: 'all', // 当前文件类型筛选
  filterDateStart: null, // 日期范围筛选 - 开始日期
  filterDateEnd: null, // 日期范围筛选 - 结束日期
  isSettingsEmbeddedOpen: false
};

// 文件类型图标映射
const FILE_TYPE_ICONS = {
  // 图片
  image: { icon: '🖼️', types: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'] },
  // 视频
  video: { icon: '🎬', types: ['mp4', 'avi', 'mov', 'wmv', 'flv', 'mkv', 'webm'] },
  // 音频
  audio: { icon: '🎵', types: ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'] },
  // 文档
  document: { icon: '📄', types: ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'] },
  // PDF
  pdf: { icon: '📕', types: ['pdf'] },
  // 文本
  text: { icon: '📝', types: ['txt', 'md', 'rtf'] },
  // 代码
  code: { icon: '💻', types: ['js', 'ts', 'py', 'java', 'cpp', 'c', 'h', 'css', 'html', 'json', 'xml', 'yaml', 'yml'] },
  // 压缩包
  archive: { icon: '📦', types: ['zip', 'rar', '7z', 'tar', 'gz'] },
  // 其他
  other: { icon: '📄', types: [] }
};

const PREVIEWABLE_FILE_TYPES = new Set(['image', 'video', 'pdf']);

/**
 * 初始化应用
 */
function init() {
  console.log('R2 存储管理器初始化...');
  
  // 应用 i18n 文本
  applyI18nText();
  
  // 设置工具提示
  setTooltips();
  
  // 绑定工具栏按钮事件
  elements.btnUpload.addEventListener('click', handleUpload);
  elements.btnDownload.addEventListener('click', handleDownload);
  elements.btnPreview.addEventListener('click', handlePreview);
  elements.btnDelete.addEventListener('click', handleDelete);
  elements.btnRefresh.addEventListener('click', handleRefresh);
  
  // 绑定设置按钮事件
  const btnSettings = document.getElementById('btn-settings');
  if (btnSettings) {
    btnSettings.addEventListener('click', handleSettings);
  }
  
  // 绑定搜索事件
  elements.searchInput.addEventListener('input', handleSearchInput);
  elements.btnClearSearch.addEventListener('click', handleClearSearch);
  
  // 绑定筛选事件
  if (elements.filterType) {
    elements.filterType.addEventListener('change', handleFilterTypeChange);
  }
  
  // 绑定日期筛选事件
  if (elements.filterDateStart) {
    elements.filterDateStart.addEventListener('change', handleDateFilterChange);
  }
  if (elements.filterDateEnd) {
    elements.filterDateEnd.addEventListener('change', handleDateFilterChange);
  }
  if (elements.btnClearDate) {
    elements.btnClearDate.addEventListener('click', handleClearDateFilter);
  }
  
  // 绑定键盘快捷键
  document.addEventListener('keydown', handleKeyboard);
  
  // 绑定右键菜单
  document.addEventListener('contextmenu', handleContextMenu);
  document.addEventListener('click', hideContextMenu);
  
  // 绑定表格点击事件
  elements.objectListBody.addEventListener('click', handleTableClick);
  elements.objectListBody.addEventListener('dblclick', handleTableDoubleClick);
  
  // 绑定拖放事件
  setupDragAndDrop();
  
  // 监听来自主进程的错误恢复事件
  setupErrorRecoveryListeners();

  // 监听来自设置页（内嵌 iframe）的关闭消息
  window.addEventListener('message', handleSettingsEmbeddedMessage);
  
  // 加载对象列表
  loadObjectList();
}

/**
 * 设置错误恢复事件监听器
 */
function setupErrorRecoveryListeners() {
  // 监听重试事件
  ipcRenderer.on('error:retry', async (event, data) => {
    console.log('收到重试请求:', data);
    // 重试操作会由对话框处理结果触发
  });
  
  // 监听列表更新事件
  ipcRenderer.on('storage:list:updated', async (event, data) => {
    console.log('收到列表更新:', data);
    if (data.objects) {
      state.objects = data.objects;
      renderObjectList();
      updateObjectCount(state.objects.length);
      showNotification(UI_TEXT.refreshSuccess || '列表已刷新', 'success');
    }
  });
}

/**
 * 应用 i18n 文本到 DOM 元素
 */
function applyI18nText() {
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const key = element.getAttribute('data-i18n');
    if (UI_TEXT[key]) {
      element.textContent = UI_TEXT[key];
    }
  });
}

/**
 * 设置工具提示
 */
function setTooltips() {
  elements.btnUpload.title = UI_TEXT.tooltipUpload || '上传文件 (Ctrl+U)';
  elements.btnDownload.title = UI_TEXT.tooltipDownload || '下载选中文件 (Ctrl+D)';
  elements.btnPreview.title = UI_TEXT.tooltipPreview || '预览选中文件 (Enter)';
  elements.btnDelete.title = UI_TEXT.tooltipDelete || '删除选中文件 (Delete)';
  elements.btnRefresh.title = UI_TEXT.tooltipRefresh || '刷新列表 (Ctrl+R)';
  if (elements.searchInput) {
    elements.searchInput.title = UI_TEXT.tooltipSearch || '搜索文件 (Esc 清除)';
  }
  if (elements.filterType) {
    elements.filterType.title = UI_TEXT.tooltipFilterType || '按文件类型筛选 (Esc 清除)';
  }
  if (elements.filterDateStart) {
    elements.filterDateStart.title = UI_TEXT.labelStartDate || '开始日期';
  }
  if (elements.filterDateEnd) {
    elements.filterDateEnd.title = UI_TEXT.labelEndDate || '结束日期';
  }
  if (elements.btnClearDate) {
    elements.btnClearDate.title = UI_TEXT.tooltipClearDateRange || '清除日期筛选';
  }
}

/**
 * 更新状态栏文本
 */
function updateStatus(text) {
  elements.statusText.textContent = text;
}

/**
 * 更新对象计数
 */
function updateObjectCount(count) {
  const template = UI_TEXT.objectCount || '共 {count} 个对象';
  elements.objectCount.textContent = template.replace('{count}', count);
}

/**
 * 显示加载指示器
 */
function showLoading() {
  state.isLoading = true;
  elements.loading.style.display = 'block';
  elements.objectListContainer.style.opacity = '0.5';
}

/**
 * 隐藏加载指示器
 */
function hideLoading() {
  state.isLoading = false;
  elements.loading.style.display = 'none';
  elements.objectListContainer.style.opacity = '1';
}

/**
 * 显示空状态
 */
function showEmptyState() {
  elements.objectListBody.innerHTML = '';
  elements.emptyState.style.display = 'block';
}

/**
 * 隐藏空状态
 */
function hideEmptyState() {
  elements.emptyState.style.display = 'none';
}

/**
 * 进度状态跟踪
 */
const progressState = {
  startTime: 0,
  lastLoaded: 0,
  lastTime: 0,
  speed: 0,
  // 批量操作状态
  batchStartTime: 0,
  batchTotal: 0,
  batchCurrent: 0,
  batchTotalBytes: 0,
  batchLoadedBytes: 0,
  isBatch: false,
  isCancelled: false
};

/**
 * 显示进度指示器
 * @param {string} title - 进度标题
 * @param {Object} options - 可选配置
 * @param {boolean} options.isBatch - 是否为批量操作
 * @param {number} options.batchTotal - 批量操作总数
 * @param {boolean} options.cancellable - 是否可取消
 */
function showProgress(title, options = {}) {
  elements.progressTitle.textContent = title;
  elements.progressBar.style.width = '0%';
  elements.progressText.textContent = '0%';
  elements.progressCurrentFile.textContent = '';
  elements.progressBatchInfo.textContent = '';
  elements.progressSpeed.textContent = '';
  elements.progressEta.textContent = '';
  elements.progressOverlay.style.display = 'flex';
  
  // 重置进度状态
  progressState.startTime = Date.now();
  progressState.lastLoaded = 0;
  progressState.lastTime = Date.now();
  progressState.speed = 0;
  progressState.isCancelled = false;
  
  // 批量操作配置
  if (options.isBatch) {
    progressState.isBatch = true;
    progressState.batchStartTime = Date.now();
    progressState.batchTotal = options.batchTotal || 0;
    progressState.batchCurrent = 0;
    progressState.batchTotalBytes = 0;
    progressState.batchLoadedBytes = 0;
    
    // 显示取消按钮
    if (options.cancellable !== false) {
      elements.btnCancelProgress.style.display = 'block';
    }
  } else {
    progressState.isBatch = false;
    elements.btnCancelProgress.style.display = 'none';
  }
}

/**
 * 更新进度
 * @param {number} percent - 进度百分比 (0-100)
 * @param {number} loaded - 已传输字节数
 * @param {number} total - 总字节数
 */
function updateProgress(percent, loaded, total) {
  const now = Date.now();
  const elapsed = now - progressState.lastTime;
  
  // 计算传输速度 (每500ms更新一次)
  if (elapsed >= 500 && loaded > 0) {
    const loadedDiff = loaded - progressState.lastLoaded;
    progressState.speed = (loadedDiff / elapsed) * 1000; // bytes per second
    progressState.lastLoaded = loaded;
    progressState.lastTime = now;
  }
  
  // 格式化进度文本
  const loadedFormatted = formatFileSize(loaded);
  const totalFormatted = formatFileSize(total);
  const speedFormatted = formatFileSize(Math.round(progressState.speed));
  
  // 更新进度条和文本
  elements.progressBar.style.width = `${percent}%`;
  elements.progressText.textContent = `${percent}% (${loadedFormatted}/${totalFormatted})`;
  
  // 更新速度显示
  if (progressState.speed > 0) {
    elements.progressSpeed.textContent = `${speedFormatted}/s`;
  } else {
    elements.progressSpeed.textContent = '';
  }
  
  // 计算并更新预计剩余时间
  if (progressState.speed > 0 && total > loaded) {
    const remainingBytes = total - loaded;
    const remainingSeconds = remainingBytes / progressState.speed;
    elements.progressEta.textContent = `预计剩余: ${formatTime(remainingSeconds)}`;
  } else {
    elements.progressEta.textContent = '';
  }
}

/**
 * 格式化时间
 * @param {number} seconds - 秒数
 * @returns {string} 格式化的时间字符串
 */
function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) {
    return '--';
  }
  if (seconds < 60) {
    return `${Math.round(seconds)}秒`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${minutes}分${secs}秒`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}小时${minutes}分`;
  }
}

/**
 * 更新批量操作进度
 * @param {Object} progress - 进度信息
 * @param {number} progress.current - 当前文件索引（从1开始）
 * @param {number} progress.total - 总文件数
 * @param {string} progress.filename - 当前文件名
 * @param {number} progress.percent - 当前文件进度百分比
 * @param {number} progress.loaded - 当前文件已传输字节数
 * @param {number} progress.totalBytes - 当前文件总字节数
 */
function updateBatchProgress(progress) {
  const { current, total, filename, percent, loaded, totalBytes } = progress;
  
  // 更新批量状态
  progressState.batchCurrent = current;
  
  // 计算整体进度
  const overallPercent = Math.round(((current - 1) / total) * 100 + (percent / total));
  
  // 更新进度条
  elements.progressBar.style.width = `${overallPercent}%`;
  elements.progressText.textContent = `${overallPercent}%`;
  
  // 更新当前文件名
  if (filename) {
    elements.progressCurrentFile.textContent = filename;
    elements.progressCurrentFile.title = filename; // 鼠标悬停显示完整文件名
  }
  
  // 更新批量信息
  const batchInfoMsg = UI_TEXT.progressBatchInfo || '正在处理 {current}/{total} 个文件';
  elements.progressBatchInfo.textContent = batchInfoMsg
    .replace('{current}', current)
    .replace('{total}', total);
  
  // 计算并更新预计剩余时间
  if (progressState.batchStartTime > 0 && current > 1) {
    const elapsed = (Date.now() - progressState.batchStartTime) / 1000; // 秒
    const avgTimePerFile = elapsed / current;
    const remainingFiles = total - current;
    const estimatedRemaining = avgTimePerFile * remainingFiles;
    
    // 如果当前文件有进度，调整预估时间
    if (percent > 0 && percent < 100) {
      // 加上当前文件剩余时间的估算
      const currentFileRemaining = (100 - percent) / percent * avgTimePerFile;
      elements.progressEta.textContent = `${UI_TEXT.progressEta || '预计剩余'}: ${formatTime(estimatedRemaining + currentFileRemaining)}`;
    } else {
      elements.progressEta.textContent = `${UI_TEXT.progressEta || '预计剩余'}: ${formatTime(estimatedRemaining)}`;
    }
  }
  
  // 更新速度（如果有传输字节数据）
  if (loaded && totalBytes) {
    const now = Date.now();
    const elapsed = now - progressState.lastTime;
    
    if (elapsed >= 500 && loaded > 0) {
      const loadedDiff = loaded - progressState.lastLoaded;
      progressState.speed = (loadedDiff / elapsed) * 1000; // bytes per second
      progressState.lastLoaded = loaded;
      progressState.lastTime = now;
      
      if (progressState.speed > 0) {
        const speedFormatted = formatFileSize(Math.round(progressState.speed));
        elements.progressSpeed.textContent = `${speedFormatted}/s`;
      }
    }
  }
}

/**
 * 取消当前操作
 */
function cancelCurrentOperation() {
  progressState.isCancelled = true;
  elements.btnCancelProgress.disabled = true;
  elements.btnCancelProgress.textContent = '正在取消...';
  elements.progressTitle.textContent = UI_TEXT.progressCancelling || '正在取消...';
}

/**
 * 隐藏进度指示器
 */
function hideProgress() {
  elements.progressOverlay.style.display = 'none';
  
  // 重置取消按钮状态
  elements.btnCancelProgress.style.display = 'none';
  elements.btnCancelProgress.disabled = false;
  elements.btnCancelProgress.textContent = '取消';
  elements.btnCancelProgress.onclick = null;
  
  // 重置批量状态
  progressState.isBatch = false;
  progressState.isCancelled = false;
}

/**
 * 显示通知
 */
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;
  
  elements.notificationContainer.appendChild(notification);
  
  // 3秒后自动移除
  setTimeout(() => {
    notification.style.animation = 'slideIn 0.3s ease reverse';
    setTimeout(() => {
      notification.remove();
    }, 300);
  }, 3000);
}

/**
 * 加载对象列表
 */
async function loadObjectList() {
  showLoading();
  updateStatus(UI_TEXT.statusLoading || '正在加载...');
  
  // 清除选择状态
  clearSelection();
  
  // 清除搜索状态
  state.searchTerm = '';
  state.filteredObjects = [];
  state.filterType = 'all';
  state.filterDateStart = null;
  state.filterDateEnd = null;
  if (elements.searchInput) {
    elements.searchInput.value = '';
    elements.btnClearSearch.style.display = 'none';
  }
  if (elements.filterType) {
    elements.filterType.value = 'all';
  }
  if (elements.filterDateStart) {
    elements.filterDateStart.value = '';
  }
  if (elements.filterDateEnd) {
    elements.filterDateEnd.value = '';
  }
  if (elements.btnClearDate) {
    elements.btnClearDate.style.display = 'none';
  }
  
  try {
    // 调用 IPC 获取对象列表
    const objects = await window.electronAPI.listObjects();
    state.objects = objects || [];
    
    renderObjectList();
    updateStatus(UI_TEXT.statusReady || '就绪');
    updateObjectCount(state.objects.length);
    
    if (state.objects.length === 0) {
      showEmptyState();
    }
  } catch (error) {
    console.error('加载对象列表失败:', error);
    hideLoading();
    
    // 使用错误恢复处理
    await handleErrorWithRecovery(error, 'list', loadObjectList);
    
    updateStatus(UI_TEXT.statusReady || '就绪');
    showEmptyState();
    return;
  }
  
  hideLoading();
}

/**
 * 渲染对象列表
 */
function renderObjectList() {
  hideEmptyState();
  elements.objectListBody.innerHTML = '';
  
  // 使用过滤后的对象列表（如果有筛选条件）或完整列表
  const hasFilters = state.searchTerm || state.filterType !== 'all' || state.filterDateStart || state.filterDateEnd;
  const objectsToRender = hasFilters ? state.filteredObjects : state.objects;
  
  // 如果有筛选条件但没有匹配结果，显示无结果提示
  if (hasFilters && objectsToRender.length === 0) {
    showNoResultsMessage(state.searchTerm, state.filterType, state.filterDateStart, state.filterDateEnd);
    return;
  }
  
  objectsToRender.forEach((obj, index) => {
    const row = document.createElement('tr');
    row.dataset.key = obj.key;
    row.dataset.index = index;
    
    // 获取文件图标
    const icon = getFileIcon(obj.key);
    
    // 格式化文件大小
    const size = formatFileSize(obj.size);
    
    // 格式化修改时间
    const modified = formatDate(obj.lastModified);
    
    row.innerHTML = `
      <td class="col-icon">
        <span class="file-icon ${icon.type}">${icon.icon}</span>
      </td>
      <td class="col-name">${escapeHtml(obj.key)}</td>
      <td class="col-size">${size}</td>
      <td class="col-modified">${modified}</td>
    `;
    
    // 检查是否选中
    if (state.selectedObjects.has(obj.key)) {
      row.classList.add('selected');
    }
    
    elements.objectListBody.appendChild(row);
  });
  
  // 更新选择计数
  updateSelectionCount();
}

/**
 * 显示无搜索结果提示
 * @param {string} searchTerm - 搜索词
 * @param {string} filterType - 文件类型筛选
 * @param {string} dateStart - 开始日期
 * @param {string} dateEnd - 结束日期
 */
function showNoResultsMessage(searchTerm, filterType, dateStart, dateEnd) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'no-results-message';
  
  // 构建提示消息
  let message = '';
  let hint = '';
  
  const hasSearch = searchTerm && searchTerm.length > 0;
  const hasTypeFilter = filterType !== 'all';
  const hasDateFilter = dateStart || dateEnd;
  
  if (hasSearch && hasTypeFilter && hasDateFilter) {
    // 同时有搜索词、类型筛选和日期筛选
    const filterLabel = getFilterTypeLabel(filterType);
    const dateRange = formatDateRange(dateStart, dateEnd);
    message = `在 "${filterLabel}" 类型中，${dateRange}范围内未找到匹配 "${searchTerm}" 的文件`;
    hint = '请尝试其他搜索词或调整筛选条件';
  } else if (hasSearch && hasTypeFilter) {
    // 同时有搜索词和类型筛选
    const filterLabel = getFilterTypeLabel(filterType);
    message = `在 "${filterLabel}" 中未找到匹配 "${searchTerm}" 的文件`;
    hint = '请尝试其他搜索词或更改文件类型筛选';
  } else if (hasSearch && hasDateFilter) {
    // 同时有搜索词和日期筛选
    const dateRange = formatDateRange(dateStart, dateEnd);
    message = `在 ${dateRange}范围内未找到匹配 "${searchTerm}" 的文件`;
    hint = '请尝试其他搜索词或调整日期范围';
  } else if (hasTypeFilter && hasDateFilter) {
    // 同时有类型筛选和日期筛选
    const filterLabel = getFilterTypeLabel(filterType);
    const dateRange = formatDateRange(dateStart, dateEnd);
    message = `在 "${filterLabel}" 类型中，${dateRange}范围内未找到文件`;
    hint = '请尝试其他文件类型或调整日期范围';
  } else if (hasSearch) {
    // 只有搜索词
    const noResultsText = UI_TEXT.noResultsFound || '未找到匹配 "{term}" 的文件';
    message = noResultsText.replace('{term}', searchTerm);
    hint = UI_TEXT.noResultsHint || '请尝试其他搜索词';
  } else if (hasTypeFilter) {
    // 只有类型筛选
    const filterLabel = getFilterTypeLabel(filterType);
    message = `没有找到 "${filterLabel}" 类型的文件`;
    hint = '请尝试其他文件类型或清除筛选';
  } else if (hasDateFilter) {
    // 只有日期筛选
    const dateRange = formatDateRange(dateStart, dateEnd);
    message = `${dateRange}范围内未找到文件`;
    hint = '请尝试调整日期范围';
  }
  
  messageDiv.innerHTML = `
    <p>${escapeHtml(message)}</p>
    <p class="hint">${escapeHtml(hint)}</p>
  `;
  elements.objectListBody.appendChild(messageDiv);
}

/**
 * 格式化日期范围显示
 * @param {string} dateStart - 开始日期
 * @param {string} dateEnd - 结束日期
 * @returns {string} 格式化的日期范围字符串
 */
function formatDateRange(dateStart, dateEnd) {
  if (dateStart && dateEnd) {
    return `"${dateStart}" 至 "${dateEnd}"`;
  } else if (dateStart) {
    return `"${dateStart}" 之后`;
  } else if (dateEnd) {
    return `"${dateEnd}" 之前`;
  }
  return '';
}

/**
 * 获取文件类型筛选的显示标签
 * @param {string} filterType - 筛选类型
 * @returns {string} 显示标签
 */
function getFilterTypeLabel(filterType) {
  const labels = {
    'all': UI_TEXT.filterAllTypes || '全部类型',
    'image': UI_TEXT.filterImages || '图片',
    'video': UI_TEXT.filterVideos || '视频',
    'audio': UI_TEXT.filterAudio || '音频',
    'document': UI_TEXT.filterDocuments || '文档',
    'archive': UI_TEXT.filterArchives || '压缩包',
    'code': UI_TEXT.filterCode || '代码',
    'text': UI_TEXT.filterText || '文本'
  };
  return labels[filterType] || filterType;
}

/**
 * 处理搜索输入
 * @param {Event} event - 输入事件
 */
function handleSearchInput(event) {
  const searchTerm = event.target.value.trim();
  state.searchTerm = searchTerm;
  
  // 显示/隐藏清除按钮
  elements.btnClearSearch.style.display = searchTerm ? 'block' : 'none';
  
  // 应用所有筛选
  applyFilters();
  
  // 重新渲染列表
  renderObjectList();
  
  // 更新对象计数
  const count = state.searchTerm || state.filterType !== 'all' || state.filterDateStart || state.filterDateEnd 
    ? state.filteredObjects.length : state.objects.length;
  updateObjectCount(count);
  
  // 清除选择状态（搜索时重置选择）
  clearSelection();
  updateButtonStates();
}

/**
 * 处理清除搜索
 */
function handleClearSearch() {
  state.searchTerm = '';
  elements.searchInput.value = '';
  elements.btnClearSearch.style.display = 'none';
  
  // 重新应用筛选
  applyFilters();
  
  // 重新渲染列表
  renderObjectList();
  
  // 更新对象计数
  const count = state.searchTerm || state.filterType !== 'all' || state.filterDateStart || state.filterDateEnd 
    ? state.filteredObjects.length : state.objects.length;
  updateObjectCount(count);
  
  // 清除选择状态
  clearSelection();
  updateButtonStates();
}

/**
 * 处理文件类型筛选变化
 * @param {Event} event - 变化事件
 */
function handleFilterTypeChange(event) {
  state.filterType = event.target.value;
  
  // 重新应用筛选
  applyFilters();
  
  // 重新渲染列表
  renderObjectList();
  
  // 更新对象计数
  const count = state.searchTerm || state.filterType !== 'all' || state.filterDateStart || state.filterDateEnd 
    ? state.filteredObjects.length : state.objects.length;
  updateObjectCount(count);
  
  // 清除选择状态
  clearSelection();
  updateButtonStates();
}

/**
 * 处理日期筛选变化
 * @param {Event} event - 变化事件
 */
function handleDateFilterChange(event) {
  const startDate = elements.filterDateStart.value;
  const endDate = elements.filterDateEnd.value;
  
  // 验证日期范围
  if (startDate && endDate && startDate > endDate) {
    showNotification(UI_TEXT.dateRangeInvalid || '开始日期不能晚于结束日期', 'warning');
    // 恢复之前的值
    if (event.target === elements.filterDateStart) {
      elements.filterDateStart.value = state.filterDateStart || '';
    } else {
      elements.filterDateEnd.value = state.filterDateEnd || '';
    }
    return;
  }
  
  state.filterDateStart = startDate || null;
  state.filterDateEnd = endDate || null;
  
  // 显示/隐藏清除按钮
  const hasDateFilter = state.filterDateStart || state.filterDateEnd;
  elements.btnClearDate.style.display = hasDateFilter ? 'block' : 'none';
  
  // 重新应用筛选
  applyFilters();
  
  // 重新渲染列表
  renderObjectList();
  
  // 更新对象计数
  const count = state.searchTerm || state.filterType !== 'all' || state.filterDateStart || state.filterDateEnd 
    ? state.filteredObjects.length : state.objects.length;
  updateObjectCount(count);
  
  // 清除选择状态
  clearSelection();
  updateButtonStates();
}

/**
 * 处理清除日期筛选
 */
function handleClearDateFilter() {
  state.filterDateStart = null;
  state.filterDateEnd = null;
  elements.filterDateStart.value = '';
  elements.filterDateEnd.value = '';
  elements.btnClearDate.style.display = 'none';
  
  // 重新应用筛选
  applyFilters();
  
  // 重新渲染列表
  renderObjectList();
  
  // 更新对象计数
  const count = state.searchTerm || state.filterType !== 'all' || state.filterDateStart || state.filterDateEnd 
    ? state.filteredObjects.length : state.objects.length;
  updateObjectCount(count);
  
  // 清除选择状态
  clearSelection();
  updateButtonStates();
}

/**
 * 应用所有筛选条件（搜索 + 文件类型 + 日期范围）
 */
function applyFilters() {
  const hasSearchTerm = state.searchTerm && state.searchTerm.length > 0;
  const hasTypeFilter = state.filterType !== 'all';
  const hasDateFilter = state.filterDateStart || state.filterDateEnd;
  
  // 如果没有任何筛选，清空过滤列表
  if (!hasSearchTerm && !hasTypeFilter && !hasDateFilter) {
    state.filteredObjects = [];
    return;
  }
  
  // 应用筛选条件（AND 逻辑）
  state.filteredObjects = state.objects.filter(obj => {
    // 搜索词筛选
    if (hasSearchTerm) {
      const lowerSearchTerm = state.searchTerm.toLowerCase();
      if (!obj.key.toLowerCase().includes(lowerSearchTerm)) {
        return false;
      }
    }
    
    // 文件类型筛选
    if (hasTypeFilter) {
      const fileType = getFileTypeCategory(obj.key);
      if (fileType !== state.filterType) {
        return false;
      }
    }
    
    // 日期范围筛选
    if (hasDateFilter) {
      const objDate = new Date(obj.lastModified);
      
      // 检查开始日期
      if (state.filterDateStart) {
        const startDate = new Date(state.filterDateStart);
        startDate.setHours(0, 0, 0, 0); // 设置为当天的开始时间
        if (objDate < startDate) {
          return false;
        }
      }
      
      // 检查结束日期
      if (state.filterDateEnd) {
        const endDate = new Date(state.filterDateEnd);
        endDate.setHours(23, 59, 59, 999); // 设置为当天的结束时间
        if (objDate > endDate) {
          return false;
        }
      }
    }
    
    return true;
  });
}

/**
 * 获取文件的类型分类
 * @param {string} filename - 文件名
 * @returns {string} 文件类型分类
 */
function getFileTypeCategory(filename) {
  const ext = getFileExtension(filename).toLowerCase();
  
  // 检查每种类型的扩展名列表
  for (const [type, config] of Object.entries(FILE_TYPE_ICONS)) {
    if (type !== 'other' && config.types.includes(ext)) {
      return type;
    }
  }
  
  return 'other';
}

/**
 * 过滤对象列表（仅搜索词筛选，保留向后兼容）
 * @param {string} searchTerm - 搜索词
 */
function filterObjects(searchTerm) {
  // 更新搜索词
  state.searchTerm = searchTerm;
  
  // 应用所有筛选
  applyFilters();
}

/**
 * 获取文件图标
 */
function getFileIcon(filename) {
  const ext = getFileExtension(filename).toLowerCase();
  
  for (const [type, config] of Object.entries(FILE_TYPE_ICONS)) {
    if (config.types.includes(ext)) {
      return { icon: config.icon, type: type };
    }
  }
  
  return { icon: FILE_TYPE_ICONS.other.icon, type: 'other' };
}

/**
 * 获取文件扩展名
 */
function getFileExtension(filename) {
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop() : '';
}

/**
 * 格式化文件大小
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + units[i];
}

/**
 * 格式化日期
 */
function formatDate(date) {
  if (!date) return '-';
  
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hour = String(d.getHours()).padStart(2, '0');
  const minute = String(d.getMinutes()).padStart(2, '0');
  
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

/**
 * HTML 转义
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * 获取错误消息
 */
function getErrorMessage(error) {
  if (typeof error === 'string') return error;
  if (error.userMessage) return error.userMessage;
  if (error.message) return error.message;
  return UI_TEXT.errorUnknown || '发生未知错误';
}

/**
 * 处理错误并显示适当的恢复选项
 * @param {Object} error - 错误对象
 * @param {string} operation - 操作类型
 * @param {Function} retryCallback - 重试回调函数
 */
async function handleErrorWithRecovery(error, operation, retryCallback) {
  // 如果错误有恢复标志，使用错误对话框处理
  if (error.isRetryable || error.shouldRefreshList || error.isAuthError || error.errorType === 'UNKNOWN') {
    try {
      const context = {
        operation: operation,
        retryCallback: retryCallback ? true : false
      };
      
      const result = await window.electronAPI.showErrorWithActions(error, context);
      
      // 处理重试操作
      if (result.action === 'RETRY' && retryCallback) {
        await retryCallback();
      }
      
      // 处理刷新操作
      if (result.action === 'REFRESH') {
        await loadObjectList();
      }
      
      return;
    } catch (handlerError) {
      console.error('Error handling failed:', handlerError);
    }
  }
  
  // 默认显示简单错误通知
  showNotification(getErrorMessage(error), 'error');
}

/**
 * 最后点击的行索引（用于 Shift+Click 范围选择）
 */
let lastClickedIndex = -1;

/**
 * 处理表格点击
 */
function handleTableClick(event) {
  const row = event.target.closest('tr');
  if (!row) return;
  
  const key = row.dataset.key;
  const currentIndex = parseInt(row.dataset.index, 10);
  
  // Ctrl 键多选（添加/移除单个项）
  if (event.ctrlKey || event.metaKey) {
    if (state.selectedObjects.has(key)) {
      state.selectedObjects.delete(key);
      row.classList.remove('selected');
    } else {
      state.selectedObjects.add(key);
      row.classList.add('selected');
    }
    lastClickedIndex = currentIndex;
  }
  // Shift 键范围选择
  else if (event.shiftKey && lastClickedIndex !== -1) {
    // 确定范围
    const startIndex = Math.min(lastClickedIndex, currentIndex);
    const endIndex = Math.max(lastClickedIndex, currentIndex);
    
    // 选择范围内的所有对象
    for (let i = startIndex; i <= endIndex; i++) {
      const obj = state.objects[i];
      if (obj) {
        state.selectedObjects.add(obj.key);
        const rowToSelect = elements.objectListBody.querySelector(`tr[data-index="${i}"]`);
        if (rowToSelect) {
          rowToSelect.classList.add('selected');
        }
      }
    }
    // 不更新 lastClickedIndex，保持范围选择的起点
  }
  // 普通点击（单选）
  else {
    clearSelection();
    state.selectedObjects.add(key);
    row.classList.add('selected');
    lastClickedIndex = currentIndex;
  }
  
  updateButtonStates();
  updateSelectionCount();
}

/**
 * 处理表格双击
 */
function handleTableDoubleClick(event) {
  const row = event.target.closest('tr');
  if (!row) return;
  
  const key = row.dataset.key;
  selectObject(key);

  if (isPreviewableFile(key)) {
    handlePreview();
    return;
  }

  handleDownload();
}

/**
 * 选择单个对象
 */
function selectObject(objectKey) {
  clearSelection();
  if (objectKey) {
    state.selectedObjects.add(objectKey);
    const row = elements.objectListBody.querySelector(`tr[data-key="${objectKey}"]`);
    if (row) {
      row.classList.add('selected');
      lastClickedIndex = parseInt(row.dataset.index, 10);
    }
  }
  updateButtonStates();
  updateSelectionCount();
}

/**
 * 清除选择
 */
function clearSelection() {
  state.selectedObjects.clear();
  elements.objectListBody.querySelectorAll('tr.selected').forEach(row => {
    row.classList.remove('selected');
  });
  lastClickedIndex = -1;
}

/**
 * 全选
 */
function selectAll() {
  // 选择当前显示的对象（过滤后的或全部）
  const hasFilters = state.searchTerm || state.filterType !== 'all' || state.filterDateStart || state.filterDateEnd;
  const objectsToSelect = hasFilters ? state.filteredObjects : state.objects;
  
  objectsToSelect.forEach((obj, index) => {
    state.selectedObjects.add(obj.key);
    const row = elements.objectListBody.querySelector(`tr[data-index="${index}"]`);
    if (row) {
      row.classList.add('selected');
    }
  });
  
  updateButtonStates();
  updateSelectionCount();
}

/**
 * 更新按钮状态
 */
function updateButtonStates() {
  const hasSelection = state.selectedObjects.size > 0;
  const selectedObject = getSingleSelectedObject();
  elements.btnDownload.disabled = !hasSelection;
  elements.btnPreview.disabled = !selectedObject || !isPreviewableFile(selectedObject.key);
  elements.btnDelete.disabled = !hasSelection;
}

/**
 * 更新选择计数显示
 */
function updateSelectionCount() {
  const count = state.selectedObjects.size;
  if (count > 1) {
    const template = UI_TEXT.messageSelectedCount || '已选择 {count} 个对象';
    elements.objectCount.textContent = template.replace('{count}', count);
  } else {
    // 如果有筛选条件，显示过滤后的数量
    const hasFilters = state.searchTerm || state.filterType !== 'all' || state.filterDateStart || state.filterDateEnd;
    const totalCount = hasFilters ? state.filteredObjects.length : state.objects.length;
    
    // 如果有筛选条件，显示筛选后的数量
    if (hasFilters) {
      const template = UI_TEXT.filteredCount || '筛选出 {count} 个对象';
      elements.objectCount.textContent = template.replace('{count}', totalCount);
    } else {
      updateObjectCount(totalCount);
    }
  }
}

/**
 * 获取选中的对象
 */
function getSelectedObjects() {
  return state.objects.filter(obj => state.selectedObjects.has(obj.key));
}

function getSingleSelectedObject() {
  const selected = getSelectedObjects();
  return selected.length === 1 ? selected[0] : null;
}

function getPreviewType(filename) {
  const fileType = getFileTypeCategory(filename);
  return PREVIEWABLE_FILE_TYPES.has(fileType) ? fileType : null;
}

function isPreviewableFile(filename) {
  return Boolean(getPreviewType(filename));
}

/**
 * 处理上传按钮点击
 */
async function handleUpload() {
  try {
    const result = await window.electronAPI.selectFile();
    if (!result || result.canceled) return;
    
    const filePath = result.filePaths[0];
    if (!filePath) return;
    
    const filename = filePath.split(/[/\\]/).pop();
    const progressMsg = UI_TEXT.progressUploading || '正在上传 {filename}...';
    
    showProgress(progressMsg.replace('{filename}', filename));
    updateStatus(UI_TEXT.statusUploading || '正在上传...');
    
    await window.electronAPI.uploadFile(filePath, (progress) => {
      // progress.percent is already 0-100 from main process
      const percent = progress.percent;
      updateProgress(percent, progress.loaded, progress.total);
    });
    
    hideProgress();
    showNotification(UI_TEXT.uploadSuccess || '文件上传成功', 'success');
    updateStatus(UI_TEXT.statusReady || '就绪');
    
    // 刷新列表
    await loadObjectList();
  } catch (error) {
    hideProgress();
    console.error('上传失败:', error);
    
    // 使用错误恢复处理
    await handleErrorWithRecovery(error, 'upload', () => handleUpload());
    
    updateStatus(UI_TEXT.statusReady || '就绪');
  }
}

/**
 * 处理下载按钮点击
 */
async function handleDownload() {
  const selected = getSelectedObjects();
  if (selected.length === 0) return;
  
  // 批量下载（多个对象）
  if (selected.length > 1) {
    await handleBatchDownload(selected);
    return;
  }
  
  // 单个下载
  const obj = selected[0];

  try {
    const result = await window.electronAPI.saveFile(obj.key);
    if (!result || result.canceled) return;
    
    const savePath = result.filePath;
    if (!savePath) return;
    
    const progressMsg = UI_TEXT.progressDownloading || '正在下载 {filename}...';
    
    showProgress(progressMsg.replace('{filename}', obj.key));
    updateStatus(UI_TEXT.statusDownloading || '正在下载...');
    
    await window.electronAPI.downloadFile(obj.key, savePath, (progress) => {
      // progress.percent is already 0-100 from main process
      const percent = progress.percent;
      updateProgress(percent, progress.loaded, progress.total);
    });
    
    hideProgress();
    showNotification(UI_TEXT.downloadSuccess || '文件下载成功', 'success');
    updateStatus(UI_TEXT.statusReady || '就绪');
  } catch (error) {
    hideProgress();
    console.error('下载失败:', error);
    
    // 使用错误恢复处理
    await handleErrorWithRecovery(error, 'download', () => handleDownload());
    
    updateStatus(UI_TEXT.statusReady || '就绪');
  }
}

/**
 * 处理批量下载
 * @param {Array} objects - 要下载的对象数组
 */
async function handleBatchDownload(objects) {
  const total = objects.length;
  
  try {
    // 让用户选择保存文件夹
    const result = await window.electronAPI.selectFolder();
    if (!result || result.canceled || !result.filePaths || result.filePaths.length === 0) return;
    
    const folderPath = result.filePaths[0];
    
    // 获取所有要下载的键
    const keys = objects.map(obj => obj.key);
    
    // 显示进度（批量操作，可取消）
    const progressMsg = UI_TEXT.progressBatchDownloading || '正在下载文件...';
    showProgress(progressMsg, { isBatch: true, batchTotal: total, cancellable: true });
    updateStatus(progressMsg);
    
    // 绑定取消按钮事件
    const cancelHandler = () => {
      cancelCurrentOperation();
    };
    elements.btnCancelProgress.onclick = cancelHandler;
    
    // 调用批量下载 API
    const downloadResult = await window.electronAPI.downloadFilesBatch(keys, folderPath, (progress) => {
      // 检查是否已取消
      if (progressState.isCancelled) {
        return;
      }
      
      // 更新进度显示
      updateBatchProgress(progress);
    });
    
    hideProgress();
    
    // 检查是否被取消
    if (progressState.isCancelled) {
      showNotification(UI_TEXT.operationCancelled || '操作已取消', 'info');
      updateStatus(UI_TEXT.statusReady || '就绪');
      return;
    }
    
    const { downloaded, errors } = downloadResult;
    const successCount = downloaded.length;
    const failCount = errors.length;
    
    // 显示结果摘要
    if (failCount === 0) {
      // 全部成功
      const successMsg = UI_TEXT.batchDownloadSuccess || '成功下载 {count} 个文件';
      showNotification(successMsg.replace('{count}', successCount), 'success');
    } else if (successCount > 0) {
      // 部分成功
      const partialMsg = UI_TEXT.batchDownloadPartialSuccess || '成功下载 {success} 个文件，{failed} 个失败';
      showNotification(partialMsg
        .replace('{success}', successCount)
        .replace('{failed}', failCount), 'warning');
    } else {
      // 全部失败
      showNotification(UI_TEXT.batchDownloadAllFailed || '所有文件下载失败', 'error');
    }
    
    updateStatus(UI_TEXT.statusReady || '就绪');
  } catch (error) {
    hideProgress();
    console.error('批量下载失败:', error);
    
    // 使用错误恢复处理
    await handleErrorWithRecovery(error, 'download', () => handleBatchDownload(objects));
    
    updateStatus(UI_TEXT.statusReady || '就绪');
  }
}

/**
 * 处理预览按钮点击
 */
async function handlePreview() {
  const selected = getSelectedObjects();
  if (selected.length === 0) return;
  
  const obj = selected[0];

  if (!isPreviewableFile(obj.key)) {
    await handleDownload();
    return;
  }
  
  try {
    updateStatus(UI_TEXT.previewLoadingImage || '正在加载...');
    await window.electronAPI.previewFile(obj.key);
    updateStatus(UI_TEXT.statusReady || '就绪');
  } catch (error) {
    console.error('预览失败:', error);
    
    // 使用错误恢复处理
    await handleErrorWithRecovery(error, 'preview', () => handlePreview());
    
    updateStatus(UI_TEXT.statusReady || '就绪');
  }
}

/**
 * 处理删除按钮点击
 */
async function handleDelete() {
  const selected = getSelectedObjects();
  if (selected.length === 0) return;
  
  // 批量删除（多个对象）
  if (selected.length > 1) {
    await handleBatchDelete(selected);
    return;
  }
  
  // 单个删除
  const obj = selected[0];
  
  try {
    const confirmMsg = UI_TEXT.dialogConfirmDelete || '确定要删除 \'{filename}\' 吗？此操作无法撤销。';
    const confirmed = await window.electronAPI.confirmDelete(obj.key, confirmMsg.replace('{filename}', obj.key));
    
    if (!confirmed) return;
    
    updateStatus(UI_TEXT.progressDeleting || '正在删除...');
    
    await window.electronAPI.deleteFile(obj.key);
    
    showNotification(UI_TEXT.deleteSuccess || '文件删除成功', 'success');
    updateStatus(UI_TEXT.statusReady || '就绪');
    
    // 刷新列表
    await loadObjectList();
  } catch (error) {
    console.error('删除失败:', error);
    
    // 使用错误恢复处理
    await handleErrorWithRecovery(error, 'delete', () => handleDelete());
    
    updateStatus(UI_TEXT.statusReady || '就绪');
  }
}

/**
 * 处理批量删除
 * @param {Array} objects - 要删除的对象数组
 */
async function handleBatchDelete(objects) {
  const total = objects.length;
  
  try {
    // 显示确认对话框
    const confirmMsg = UI_TEXT.dialogConfirmBatchDelete || '确定要删除 {count} 个对象吗？此操作无法撤销。';
    const confirmed = await window.electronAPI.confirmDelete(
      null, 
      confirmMsg.replace('{count}', total)
    );
    
    if (!confirmed) return;
    
    // 获取所有要删除的键
    const keys = objects.map(obj => obj.key);
    
    // 显示进度（批量操作，不可取消 - 删除操作不可逆）
    const progressMsg = UI_TEXT.progressBatchDeleting || '正在删除对象...';
    showProgress(progressMsg, { isBatch: true, batchTotal: total, cancellable: false });
    updateStatus(progressMsg);
    
    // 调用批量删除 API
    const result = await window.electronAPI.deleteFilesBatch(keys);
    
    hideProgress();
    
    const { deleted, errors } = result;
    const successCount = deleted.length;
    const failCount = errors.length;
    
    // 显示结果摘要
    if (failCount === 0) {
      // 全部成功
      const successMsg = UI_TEXT.batchDeleteSuccess || '成功删除 {count} 个对象';
      showNotification(successMsg.replace('{count}', successCount), 'success');
    } else if (successCount > 0) {
      // 部分成功
      const partialMsg = UI_TEXT.batchDeletePartialSuccess || '成功删除 {success} 个对象，{failed} 个失败';
      showNotification(partialMsg
        .replace('{success}', successCount)
        .replace('{failed}', failCount), 'warning');
    } else {
      // 全部失败
      showNotification(UI_TEXT.batchDeleteAllFailed || '所有对象删除失败', 'error');
    }
    
    updateStatus(UI_TEXT.statusReady || '就绪');
    
    // 刷新列表
    await loadObjectList();
  } catch (error) {
    hideProgress();
    console.error('批量删除失败:', error);
    
    // 使用错误恢复处理
    await handleErrorWithRecovery(error, 'delete', () => handleBatchDelete(objects));
    
    updateStatus(UI_TEXT.statusReady || '就绪');
  }
}

/**
 * 处理刷新按钮点击
 */
async function handleRefresh() {
  await loadObjectList();
  showNotification(UI_TEXT.refreshSuccess || '列表已刷新', 'success');
}

/**
 * 处理设置按钮点击
 */
/**
 * Open settings inside the embedded iframe area.
 * Keeps toolbar unchanged and only switches lower content area.
 * @param {Object} options
 * @param {boolean} options.forceReload - Force iframe reload
 */
function openEmbeddedSettings(options = {}) {
  const { forceReload = false } = options;

  if (!elements.settingsEmbeddedContainer || !elements.settingsEmbeddedFrame || !elements.objectListContainer) {
    // Fallback for unexpected DOM mismatch
    window.location.href = 'settings.html?embedded=1';
    return;
  }

  const shouldReload = forceReload || !state.isSettingsEmbeddedOpen;
  if (shouldReload) {
    elements.settingsEmbeddedFrame.src = `settings.html?embedded=1&t=${Date.now()}`;
  }

  elements.objectListContainer.style.display = 'none';
  elements.settingsEmbeddedContainer.style.display = 'block';
  state.isSettingsEmbeddedOpen = true;
}

/**
 * Close embedded settings and show object list area.
 * @param {Object} options
 * @param {boolean} options.reload - Reload object list after close
 */
function closeEmbeddedSettings(options = {}) {
  const { reload = false } = options;

  if (elements.settingsEmbeddedContainer) {
    elements.settingsEmbeddedContainer.style.display = 'none';
  }
  if (elements.settingsEmbeddedFrame) {
    elements.settingsEmbeddedFrame.src = 'about:blank';
  }
  if (elements.objectListContainer) {
    elements.objectListContainer.style.display = 'block';
  }

  state.isSettingsEmbeddedOpen = false;

  if (reload) {
    loadObjectList();
  }
}

/**
 * Handle postMessage events from embedded settings page.
 * @param {MessageEvent} event
 */
function handleSettingsEmbeddedMessage(event) {
  const frameWindow = elements.settingsEmbeddedFrame?.contentWindow;
  if (!frameWindow || event.source !== frameWindow) {
    return;
  }

  const data = event.data;
  if (!data || typeof data !== 'object') {
    return;
  }

  if (data.type === 'settings:close') {
    closeEmbeddedSettings({ reload: Boolean(data.reload) });
  }
}

async function handleSettings() {
  try {
    openEmbeddedSettings({ forceReload: true });
  } catch (error) {
    console.error('打开设置窗口失败:', error);
    showNotification(error.userMessage || UI_TEXT.errorUnknown || '打开设置窗口失败', 'error');
  }
}

/**
 * 处理键盘快捷键
 */
function handleKeyboard(event) {
  // 如果正在加载，忽略快捷键
  if (state.isLoading) return;
  
  // 如果焦点在搜索框，只处理特定快捷键
  if (document.activeElement === elements.searchInput) {
    // Escape: 清除搜索并失焦
    if (event.key === 'Escape') {
      handleClearSearch();
      elements.searchInput.blur();
    }
    // Enter: 如果有选中项，预览
    else if (event.key === 'Enter' && state.selectedObjects.size === 1) {
      event.preventDefault();
      handlePreview();
    }
    return;
  }
  
  // Ctrl+U: 上传
  if (event.ctrlKey && event.key === 'u') {
    event.preventDefault();
    handleUpload();
  }
  // Ctrl+D: 下载
  else if (event.ctrlKey && event.key === 'd') {
    event.preventDefault();
    if (state.selectedObjects.size > 0) {
      handleDownload();
    }
  }
  // Ctrl+R: 刷新
  else if (event.ctrlKey && event.key === 'r') {
    event.preventDefault();
    handleRefresh();
  }
  // Ctrl+F: 聚焦搜索框
  else if (event.ctrlKey && event.key === 'f') {
    event.preventDefault();
    elements.searchInput.focus();
  }
  // Ctrl+A: 全选
  else if (event.ctrlKey && event.key === 'a') {
    event.preventDefault();
    selectAll();
  }
  // Delete: 删除
  else if (event.key === 'Delete') {
    event.preventDefault();
    if (state.selectedObjects.size > 0) {
      handleDelete();
    }
  }
  // Enter: 预览
  else if (event.key === 'Enter') {
    event.preventDefault();
    if (state.selectedObjects.size === 1) {
      handlePreview();
    }
  }
  // Ctrl+C: 复制 URL
  else if (event.ctrlKey && event.key === 'c' && !event.shiftKey) {
    if (state.selectedObjects.size === 1) {
      // 默认复制 URL 格式
      handleCopyUrl('url');
    }
  }
  // Escape: 取消选择或清除搜索/筛选
  else if (event.key === 'Escape') {
    // 如果有搜索内容，先清除搜索
    if (state.searchTerm) {
      handleClearSearch();
    } else if (state.filterType !== 'all' || state.filterDateStart || state.filterDateEnd) {
      // 如果有类型筛选或日期筛选，清除所有筛选
      state.filterType = 'all';
      state.filterDateStart = null;
      state.filterDateEnd = null;
      elements.filterType.value = 'all';
      elements.filterDateStart.value = '';
      elements.filterDateEnd.value = '';
      elements.btnClearDate.style.display = 'none';
      applyFilters();
      renderObjectList();
      updateObjectCount(state.objects.length);
      clearSelection();
      updateButtonStates();
    } else {
      clearSelection();
      updateButtonStates();
      updateSelectionCount();
    }
    hideContextMenu();
  }
}

/**
 * 处理右键菜单
 */
function handleContextMenu(event) {
  event.preventDefault();
  
  // 检查是否点击在表格行上
  const row = event.target.closest('tr');
  const isOnTable = !!row;
  
  // 如果点击在表格行上，选中该行
  if (isOnTable) {
    const key = row.dataset.key;
    if (!state.selectedObjects.has(key)) {
      selectObject(key);
    }
  }
  
  // 显示右键菜单
  elements.contextMenu.style.display = 'block';
  
  // 调整菜单位置，确保不超出屏幕
  const menuRect = elements.contextMenu.getBoundingClientRect();
  let x = event.pageX;
  let y = event.pageY;
  
  if (x + menuRect.width > window.innerWidth) {
    x = window.innerWidth - menuRect.width - 10;
  }
  if (y + menuRect.height > window.innerHeight) {
    y = window.innerHeight - menuRect.height - 10;
  }
  
  elements.contextMenu.style.left = `${x}px`;
  elements.contextMenu.style.top = `${y}px`;
  
  // 更新菜单项状态
  const hasSelection = state.selectedObjects.size > 0;
  const selectedObject = getSingleSelectedObject();
  const canPreview = Boolean(selectedObject && isPreviewableFile(selectedObject.key));
  const menuItems = elements.contextMenu.querySelectorAll('.menu-item');
  const previewMenuItem = elements.contextMenu.querySelector('.menu-item[data-action="preview"]');

  if (previewMenuItem) {
    previewMenuItem.style.display = canPreview ? 'block' : 'none';
  }

  menuItems.forEach(item => {
    const action = item.dataset.action;

    if (action === 'preview') {
      if (canPreview) {
        item.classList.remove('disabled');
      } else {
        item.classList.add('disabled');
      }
      return;
    }

    if (['download', 'delete', 'copy-url'].includes(action)) {
      if (hasSelection) {
        item.classList.remove('disabled');
      } else {
        item.classList.add('disabled');
      }
    }
  });
  
  // 绑定子菜单点击事件
  const submenuItems = elements.contextMenu.querySelectorAll('.submenu-item');
  submenuItems.forEach(item => {
    item.onclick = (e) => {
      e.stopPropagation();
      const format = item.dataset.format;
      handleCopyUrl(format);
      hideContextMenu();
    };
  });
  
  // 绑定菜单项点击事件
  menuItems.forEach(item => {
    if (item.classList.contains('has-submenu')) return;
    
    item.onclick = () => {
      const action = item.getAttribute('data-action');
      if (!item.classList.contains('disabled')) {
        handleMenuAction(action);
      }
      hideContextMenu();
    };
  });
}

/**
 * 隐藏右键菜单
 */
function hideContextMenu() {
  elements.contextMenu.style.display = 'none';
}

/**
 * 处理菜单操作
 */
function handleMenuAction(action) {
  switch (action) {
    case 'upload':
      handleUpload();
      break;
    case 'download':
      handleDownload();
      break;
    case 'preview':
      handlePreview();
      break;
    case 'delete':
      handleDelete();
      break;
    case 'copy-url':
      handleCopyUrl('url');
      break;
  }
}

/**
 * 处理复制 URL
 */
async function handleCopyUrl(format) {
  const selected = getSelectedObjects();
  if (selected.length === 0) return;
  
  const obj = selected[0];
  
  try {
    await window.electronAPI.copyUrl(obj.key, format);
    showNotification(UI_TEXT.copySuccess || '链接已复制到剪贴板', 'success');
  } catch (error) {
    console.error('复制 URL 失败:', error);
    showNotification(getErrorMessage(error), 'error');
  }
}

// ==================== 拖放上传功能 ====================

/**
 * 拖放状态
 */
const dragState = {
  isDragging: false,
  dragCounter: 0
};

/**
 * 设置拖放事件监听器
 */
function setupDragAndDrop() {
  const dropZone = document.getElementById('content');
  
  // 阻止默认拖放行为
  document.addEventListener('dragenter', handleDragEnter);
  document.addEventListener('dragover', handleDragOver);
  document.addEventListener('dragleave', handleDragLeave);
  document.addEventListener('drop', handleDrop);
  
  // 在内容区域添加额外的拖放处理
  dropZone.addEventListener('dragenter', handleDragEnter);
  dropZone.addEventListener('dragover', handleDragOver);
  dropZone.addEventListener('dragleave', handleDragLeave);
  dropZone.addEventListener('drop', handleDrop);
}

/**
 * 处理拖入事件
 * @param {DragEvent} event 
 */
function handleDragEnter(event) {
  event.preventDefault();
  event.stopPropagation();
  
  // 检查是否拖入的是文件
  if (event.dataTransfer.types.includes('Files')) {
    dragState.dragCounter++;
    
    if (!dragState.isDragging) {
      dragState.isDragging = true;
      document.body.classList.add('drag-over');
    }
    
    // 设置拖放效果
    event.dataTransfer.dropEffect = 'copy';
  }
}

/**
 * 处理拖动悬停事件
 * @param {DragEvent} event 
 */
function handleDragOver(event) {
  event.preventDefault();
  event.stopPropagation();
  
  // 检查是否拖入的是文件
  if (event.dataTransfer.types.includes('Files')) {
    // 必须调用 preventDefault 以允许放置
    event.dataTransfer.dropEffect = 'copy';
  }
}

/**
 * 处理拖出事件
 * @param {DragEvent} event 
 */
function handleDragLeave(event) {
  event.preventDefault();
  event.stopPropagation();
  
  if (event.dataTransfer.types.includes('Files')) {
    dragState.dragCounter--;
    
    if (dragState.dragCounter === 0) {
      dragState.isDragging = false;
      document.body.classList.remove('drag-over');
    }
  }
}

/**
 * 处理放置事件
 * @param {DragEvent} event 
 */
async function handleDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  
  // 重置拖放状态
  dragState.isDragging = false;
  dragState.dragCounter = 0;
  document.body.classList.remove('drag-over');
  
  // 获取拖放的文件
  const files = event.dataTransfer.files;
  if (!files || files.length === 0) return;
  
  // 处理拖放的文件
  await handleDroppedFiles(files);
}

/**
 * 处理拖放的文件
 * @param {FileList} files 
 */
async function handleDroppedFiles(files) {
  // 验证是否有文件
  if (!files || files.length === 0) {
    showNotification(UI_TEXT.messageNoFilesDetected || '没有检测到可上传的文件', 'warning');
    return;
  }
  
  // 过滤出有效的文件（排除文件夹）
  const validFiles = [];
  for (const file of files) {
    // 检查是否为文件夹（文件夹的 type 为空且 size 为 0，或者通过 webkitRelativePath 判断）
    // 注意：在拖放操作中，文件夹通常无法被正确识别，但我们可以通过检查 file.size 和 file.type 来初步判断
    if (file.size === 0 && file.type === '') {
      // 可能是空文件或文件夹，跳过
      console.log(`跳过可能的文件夹或空文件: ${file.name}`);
      continue;
    }
    validFiles.push(file);
  }
  
  // 检查是否有有效文件
  if (validFiles.length === 0) {
    showNotification(UI_TEXT.messageNoValidFiles || '没有有效的文件可上传（可能拖放的是文件夹）', 'warning');
    return;
  }
  
  const totalFiles = validFiles.length;
  let successCount = 0;
  let failCount = 0;
  const errors = [];
  
  // 更新状态为上传中
  updateStatus(UI_TEXT.statusUploading || '正在上传...');
  
  // 显示进度（批量操作，可取消）
  const progressMsg = UI_TEXT.uploadMultipleProgress || '正在上传文件...';
  showProgress(progressMsg, { isBatch: true, batchTotal: totalFiles, cancellable: true });
  
  // 绑定取消按钮事件
  elements.btnCancelProgress.onclick = () => {
    cancelCurrentOperation();
  };
  
  // 逐个上传文件
  for (let i = 0; i < totalFiles; i++) {
    // 检查是否已取消
    if (progressState.isCancelled) {
      break;
    }
    
    const file = validFiles[i];
    const currentFileNum = i + 1;
    
    try {
      // 更新批量进度
      updateBatchProgress({
        current: currentFileNum,
        total: totalFiles,
        filename: file.name,
        percent: 0,
        loaded: 0,
        totalBytes: file.size
      });
      
      // 读取文件并上传
      const arrayBuffer = await file.arrayBuffer();
      const result = await ipcRenderer.invoke('storage:upload-buffer', {
        name: file.name,
        buffer: arrayBuffer,
        type: file.type
      });
      
      if (!result.success) {
        throw result.error;
      }
      
      // 更新完成进度
      updateBatchProgress({
        current: currentFileNum,
        total: totalFiles,
        filename: file.name,
        percent: 100,
        loaded: file.size,
        totalBytes: file.size
      });
      
      successCount++;
    } catch (error) {
      failCount++;
      errors.push({ filename: file.name, error: error });
      console.error(`上传文件 ${file.name} 失败:`, error);
    }
  }
  
  // 隐藏进度指示器
  hideProgress();
  updateStatus(UI_TEXT.statusReady || '就绪');
  
  // 检查是否被取消
  if (progressState.isCancelled) {
    showNotification(UI_TEXT.operationCancelled || '操作已取消', 'info');
    // 仍然刷新列表以显示已上传的文件
    await loadObjectList();
    return;
  }
  
  // 显示上传结果摘要
  if (failCount === 0) {
    // 全部成功
    const successMsg = UI_TEXT.uploadMultipleSuccess || '成功上传 {count} 个文件';
    showNotification(successMsg.replace('{count}', successCount), 'success');
  } else if (successCount > 0) {
    // 部分成功
    const partialMsg = UI_TEXT.uploadMultiplePartialSuccess || '成功上传 {success} 个文件，{failed} 个失败';
    showNotification(partialMsg
      .replace('{success}', successCount)
      .replace('{failed}', failCount), 'warning');
  } else {
    // 全部失败
    showNotification(UI_TEXT.uploadMultipleAllFailed || '所有文件上传失败', 'error');
  }
  
  // 刷新列表
  await loadObjectList();
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', init);
