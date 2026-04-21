/**
 * 设置窗口渲染进程脚本
 * 负责凭证配置、存储桶选择等设置功能
 */

// Electron IPC
const { ipcRenderer } = require('electron');

// 获取 UI 文本
const UI_TEXT = window.UI_TEXT || {};

// IPC API 封装
const electronAPI = {
  // 凭证相关
  getCredentials: async () => {
    return await ipcRenderer.invoke('settings:getCredentials');
  },
  
  saveCredentials: async (credentials) => {
    return await ipcRenderer.invoke('settings:saveCredentials', credentials);
  },
  
  clearCredentials: async () => {
    return await ipcRenderer.invoke('settings:clearCredentials');
  },
  
  testConnection: async (credentials) => {
    return await ipcRenderer.invoke('settings:testConnection', credentials);
  },
  
  // 存储桶相关
  listBuckets: async () => {
    return await ipcRenderer.invoke('settings:listBuckets');
  },
  
  getCurrentBucket: async () => {
    return await ipcRenderer.invoke('settings:getCurrentBucket');
  },
  
  setCurrentBucket: async (bucket) => {
    return await ipcRenderer.invoke('settings:setCurrentBucket', bucket);
  },
  
  // 对话框
  confirm: async (message) => {
    const result = await ipcRenderer.invoke('dialog:confirm', message);
    return result.confirmed;
  }
};

// 暴露到全局
window.electronAPI = electronAPI;

// DOM 元素引用
const elements = {
  // Tab navigation
  tabNavItems: document.querySelectorAll('.tab-nav-item'),
  tabPanels: document.querySelectorAll('.tab-panel'),
  
  // Credentials tab
  credentialStatus: document.getElementById('credential-status'),
  credentialStatusText: document.getElementById('credential-status-text'),
  accessKeyId: document.getElementById('access-key-id'),
  secretAccessKey: document.getElementById('secret-access-key'),
  btnToggleSecret: document.getElementById('btn-toggle-secret'),
  toggleSecretText: document.getElementById('toggle-secret-text'),
  btnTestConnection: document.getElementById('btn-test-connection'),
  encryptCredentials: document.getElementById('encrypt-credentials'),
  btnClearCredentials: document.getElementById('btn-clear-credentials'),
  
  // Bucket tab
  bucketSelect: document.getElementById('bucket-select'),
  btnRefreshBuckets: document.getElementById('btn-refresh-buckets'),
  bucketListContainer: document.getElementById('bucket-list-container'),
  bucketList: document.getElementById('bucket-list'),
  bucketLoading: document.getElementById('bucket-loading'),
  endpointUrl: document.getElementById('endpoint-url'),
  endpointRegion: document.getElementById('endpoint-region'),
  
  // Footer buttons
  btnCancel: document.getElementById('btn-cancel'),
  btnSave: document.getElementById('btn-save'),
  
  // Notification
  notificationContainer: document.getElementById('notification-container')
};

// 应用状态
const state = {
  credentials: {
    accessKeyId: '',
    secretAccessKey: ''
  },
  currentBucket: '',
  buckets: [],
  hasChanges: false,
  isTesting: false,
  isLoadingBuckets: false
};

/**
 * 初始化应用
 */
async function init() {
  console.log('设置窗口初始化...');
  
  // 应用 i18n 文本
  applyI18nText();
  
  // 绑定事件
  bindEvents();
  
  // 加载当前设置
  await loadSettings();
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
  
  document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
    const key = element.getAttribute('data-i18n-placeholder');
    if (UI_TEXT[key]) {
      element.placeholder = UI_TEXT[key];
    }
  });
}

/**
 * 绑定事件
 */
function bindEvents() {
  // Tab navigation
  elements.tabNavItems.forEach(item => {
    item.addEventListener('click', () => handleTabClick(item));
  });
  
  // Credentials
  elements.accessKeyId.addEventListener('input', handleCredentialInput);
  elements.secretAccessKey.addEventListener('input', handleCredentialInput);
  elements.btnToggleSecret.addEventListener('click', toggleSecretVisibility);
  elements.btnTestConnection.addEventListener('click', handleTestConnection);
  elements.btnClearCredentials.addEventListener('click', handleClearCredentials);
  
  // Bucket
  elements.bucketSelect.addEventListener('change', handleBucketChange);
  elements.btnRefreshBuckets.addEventListener('click', handleRefreshBuckets);
  
  // Footer buttons
  elements.btnCancel.addEventListener('click', handleCancel);
  elements.btnSave.addEventListener('click', handleSave);
}

/**
 * 加载设置
 */
async function loadSettings() {
  try {
    // 加载凭证
    const credResult = await electronAPI.getCredentials();
    if (credResult.success && credResult.data) {
      state.credentials = credResult.data;
      elements.accessKeyId.value = state.credentials.accessKeyId || '';
      elements.secretAccessKey.value = state.credentials.secretAccessKey || '';
      updateCredentialStatus(true);
    } else {
      updateCredentialStatus(false);
    }
    
    // 加载当前存储桶
    const bucketResult = await electronAPI.getCurrentBucket();
    if (bucketResult.success && bucketResult.data) {
      state.currentBucket = bucketResult.data;
    }
    
    // 加载存储桶列表
    await loadBucketList();
    
  } catch (error) {
    console.error('加载设置失败:', error);
    showNotification(UI_TEXT.credentialsLoadFailed || '加载设置失败', 'error');
  }
}

/**
 * 处理 Tab 点击
 */
function handleTabClick(tabItem) {
  const tabId = tabItem.dataset.tab;
  
  // 更新 Tab 导航状态
  elements.tabNavItems.forEach(item => {
    item.classList.remove('active');
  });
  tabItem.classList.add('active');
  
  // 更新 Tab 面板显示
  elements.tabPanels.forEach(panel => {
    panel.classList.remove('active');
  });
  document.getElementById(`tab-${tabId}`).classList.add('active');
}

/**
 * 处理凭证输入
 */
function handleCredentialInput() {
  state.credentials.accessKeyId = elements.accessKeyId.value;
  state.credentials.secretAccessKey = elements.secretAccessKey.value;
  state.hasChanges = true;
  
  // 更新状态指示器
  const hasCredentials = state.credentials.accessKeyId && state.credentials.secretAccessKey;
  updateCredentialStatus(hasCredentials);
}

/**
 * 更新凭证状态指示器
 */
function updateCredentialStatus(isConfigured) {
  if (isConfigured) {
    elements.credentialStatus.classList.remove('not-configured');
    elements.credentialStatus.classList.add('configured');
    elements.credentialStatusText.textContent = UI_TEXT.credentialsStatusConfigured || '凭证已配置';
  } else {
    elements.credentialStatus.classList.remove('configured');
    elements.credentialStatus.classList.add('not-configured');
    elements.credentialStatusText.textContent = UI_TEXT.credentialsStatusNotConfigured || '凭证未配置';
  }
}

/**
 * 切换密钥可见性
 */
function toggleSecretVisibility() {
  const input = elements.secretAccessKey;
  const isPassword = input.type === 'password';
  
  input.type = isPassword ? 'text' : 'password';
  elements.toggleSecretText.textContent = isPassword 
    ? (UI_TEXT.credentialsHidePassword || '隐藏')
    : (UI_TEXT.credentialsShowPassword || '显示');
}

/**
 * 处理测试连接
 */
async function handleTestConnection() {
  if (state.isTesting) return;
  
  const accessKeyId = elements.accessKeyId.value.trim();
  const secretAccessKey = elements.secretAccessKey.value.trim();
  
  if (!accessKeyId || !secretAccessKey) {
    showNotification(UI_TEXT.credentialsValidateFailed || '请输入完整的凭证信息', 'error');
    return;
  }
  
  state.isTesting = true;
  elements.btnTestConnection.disabled = true;
  elements.btnTestConnection.innerHTML = `<span class="loading-spinner"></span><span>${UI_TEXT.credentialsTesting || '正在测试连接...'}</span>`;
  
  try {
    const result = await electronAPI.testConnection({
      accessKeyId,
      secretAccessKey
    });
    
    if (result.success) {
      showNotification(UI_TEXT.credentialsTestSuccess || '连接测试成功', 'success');
    } else {
      showNotification(result.error?.userMessage || UI_TEXT.credentialsTestFailed || '连接测试失败', 'error');
    }
  } catch (error) {
    console.error('测试连接失败:', error);
    showNotification(UI_TEXT.credentialsTestFailed || '连接测试失败', 'error');
  } finally {
    state.isTesting = false;
    elements.btnTestConnection.disabled = false;
    elements.btnTestConnection.innerHTML = `<span>${UI_TEXT.credentialsTestConnection || '测试连接'}</span>`;
  }
}

/**
 * 处理清除凭证
 */
async function handleClearCredentials() {
  const confirmed = await electronAPI.confirm(
    UI_TEXT.securityClearConfirm || '确定要清除已保存的凭证吗？您需要重新输入凭证才能使用应用。'
  );
  
  if (!confirmed) return;
  
  try {
    const result = await electronAPI.clearCredentials();
    
    if (result.success) {
      // 清空输入框
      elements.accessKeyId.value = '';
      elements.secretAccessKey.value = '';
      state.credentials = { accessKeyId: '', secretAccessKey: '' };
      updateCredentialStatus(false);
      showNotification(UI_TEXT.securityClearSuccess || '凭证已清除', 'success');
    } else {
      showNotification(UI_TEXT.securityClearFailed || '清除凭证失败', 'error');
    }
  } catch (error) {
    console.error('清除凭证失败:', error);
    showNotification(UI_TEXT.securityClearFailed || '清除凭证失败', 'error');
  }
}

/**
 * 加载存储桶列表
 */
async function loadBucketList() {
  if (state.isLoadingBuckets) return;
  
  state.isLoadingBuckets = true;
  elements.bucketLoading.style.display = 'block';
  elements.bucketSelect.disabled = true;
  
  try {
    const result = await electronAPI.listBuckets();
    
    if (result.success && result.data) {
      state.buckets = result.data;
      renderBucketList();
    } else {
      showNotification(result.error?.userMessage || UI_TEXT.bucketLoadFailed || '加载存储桶列表失败', 'error');
    }
  } catch (error) {
    console.error('加载存储桶列表失败:', error);
    showNotification(UI_TEXT.bucketLoadFailed || '加载存储桶列表失败', 'error');
  } finally {
    state.isLoadingBuckets = false;
    elements.bucketLoading.style.display = 'none';
    elements.bucketSelect.disabled = false;
  }
}

/**
 * 渲染存储桶列表
 */
function renderBucketList() {
  // 清空下拉列表
  elements.bucketSelect.innerHTML = '';
  
  // 添加默认选项
  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = UI_TEXT.bucketSelectPlaceholder || '请选择存储桶';
  elements.bucketSelect.appendChild(defaultOption);
  
  // 添加存储桶选项
  state.buckets.forEach(bucket => {
    const option = document.createElement('option');
    option.value = bucket.name;
    option.textContent = bucket.name;
    
    if (bucket.name === state.currentBucket) {
      option.selected = true;
    }
    
    elements.bucketSelect.appendChild(option);
  });
  
  // 如果没有存储桶
  if (state.buckets.length === 0) {
    const noBucketOption = document.createElement('option');
    noBucketOption.value = '';
    noBucketOption.textContent = UI_TEXT.bucketNoBuckets || '未找到可用的存储桶';
    noBucketOption.disabled = true;
    elements.bucketSelect.appendChild(noBucketOption);
  }
}

/**
 * 处理存储桶选择变化
 */
function handleBucketChange(event) {
  const selectedBucket = event.target.value;
  
  if (selectedBucket !== state.currentBucket) {
    state.currentBucket = selectedBucket;
    state.hasChanges = true;
  }
}

/**
 * 处理刷新存储桶列表
 */
async function handleRefreshBuckets() {
  await loadBucketList();
}

/**
 * 处理取消
 */
function handleCancel() {
  window.close();
}

/**
 * 处理保存
 */
async function handleSave() {
  const accessKeyId = elements.accessKeyId.value.trim();
  const secretAccessKey = elements.secretAccessKey.value.trim();
  
  // 检查是否有更改
  if (!state.hasChanges) {
    showNotification(UI_TEXT.settingsNoChanges || '没有需要保存的更改', 'info');
    return;
  }
  
  // 验证凭证
  if (!accessKeyId || !secretAccessKey) {
    showNotification(UI_TEXT.credentialsValidateFailed || '请输入完整的凭证信息', 'error');
    return;
  }
  
  // 保存按钮状态
  elements.btnSave.disabled = true;
  elements.btnSave.innerHTML = `<span class="loading-spinner"></span><span>${UI_TEXT.settingsSaving || '正在保存...'}</span>`;
  
  try {
    // 保存凭证
    const credResult = await electronAPI.saveCredentials({
      accessKeyId,
      secretAccessKey,
      encrypt: elements.encryptCredentials.checked
    });
    
    if (!credResult.success) {
      showNotification(credResult.error?.userMessage || UI_TEXT.credentialsSaveFailed || '凭证保存失败', 'error');
      return;
    }
    
    // 保存存储桶设置
    if (state.currentBucket) {
      await electronAPI.setCurrentBucket(state.currentBucket);
    }
    
    showNotification(UI_TEXT.settingsSaveSuccess || '设置已保存', 'success');
    state.hasChanges = false;
    
    // 延迟关闭窗口
    setTimeout(() => {
      window.close();
    }, 1000);
    
  } catch (error) {
    console.error('保存设置失败:', error);
    showNotification(UI_TEXT.settingsSaveFailed || '保存设置失败', 'error');
  } finally {
    elements.btnSave.disabled = false;
    elements.btnSave.innerHTML = `<span>${UI_TEXT.settingsButtonSave || '保存设置'}</span>`;
  }
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

// 初始化应用
document.addEventListener('DOMContentLoaded', init);
