/**
 * 设置窗口渲染进程脚本
 * 负责凭证配置、存储桶选择等设置功能
 */

// Electron IPC
let ipcRenderer = null;
if (typeof require === 'function') {
  ({ ipcRenderer } = require('electron'));
} else if (
  window.parent &&
  window.parent !== window &&
  typeof window.parent.require === 'function'
) {
  ({ ipcRenderer } = window.parent.require('electron'));
}

if (!ipcRenderer) {
  throw new Error('Electron IPC unavailable in settings renderer');
}

// 获取 UI 文本
var UI_TEXT = window.UI_TEXT || {};
const isEmbeddedMode = new URLSearchParams(window.location.search).get('embedded') === '1';

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

  // R2 配置相关
  getR2Config: async () => {
    return await ipcRenderer.invoke('settings:getR2Config');
  },

  saveR2Config: async (config) => {
    return await ipcRenderer.invoke('settings:saveR2Config', config);
  },
  
  // 存储桶相关
  listBuckets: async (payload) => {
    return await ipcRenderer.invoke('settings:listBuckets', payload);
  },

  createBucket: async (payload) => {
    return await ipcRenderer.invoke('settings:createBucket', payload);
  },

  updateBucket: async (payload) => {
    return await ipcRenderer.invoke('settings:updateBucket', payload);
  },

  deleteBucket: async (payload) => {
    return await ipcRenderer.invoke('settings:deleteBucket', payload);
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
  bucketName: document.getElementById('bucket-name'),
  btnCreateBucket: document.getElementById('btn-create-bucket'),
  btnUpdateBucket: document.getElementById('btn-update-bucket'),
  btnDeleteBucket: document.getElementById('btn-delete-bucket'),
  newBucketName: document.getElementById('new-bucket-name'),
  newBucketLocationHint: document.getElementById('new-bucket-location-hint'),
  newBucketStorageClass: document.getElementById('new-bucket-storage-class'),
  editBucketStorageClass: document.getElementById('edit-bucket-storage-class'),
  endpointUrl: document.getElementById('endpoint-url'),
  endpointRegion: document.getElementById('endpoint-region'),
  publicUrl: document.getElementById('public-url'),
  cloudflareAccountId: document.getElementById('cloudflare-account-id'),
  cloudflareApiToken: document.getElementById('cloudflare-api-token'),
  cloudflareJurisdiction: document.getElementById('cloudflare-jurisdiction'),
  
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
  r2Config: {
    endpoint: '',
    region: 'auto',
    bucket: '',
    publicUrl: '',
    cloudflareAccountId: '',
    cloudflareApiToken: '',
    cloudflareJurisdiction: 'default'
  },
  buckets: [],
  hasChanges: false,
  isTesting: false,
  isLoadingBuckets: false
};

function getInputValue(element, fallback = '') {
  if (!element) return fallback;
  return typeof element.value === 'string' ? element.value.trim() : fallback;
}

function closeSettingsPage(options = {}) {
  const { reload = false } = options;

  if (isEmbeddedMode) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'settings:close',
        reload
      }, '*');
      return;
    }
    window.location.href = 'index.html';
  } else {
    window.close();
  }
}

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
  if (elements.accessKeyId) elements.accessKeyId.addEventListener('input', handleCredentialInput);
  if (elements.secretAccessKey) elements.secretAccessKey.addEventListener('input', handleCredentialInput);
  if (elements.btnToggleSecret) elements.btnToggleSecret.addEventListener('click', toggleSecretVisibility);
  if (elements.btnTestConnection) elements.btnTestConnection.addEventListener('click', handleTestConnection);
  if (elements.btnClearCredentials) elements.btnClearCredentials.addEventListener('click', handleClearCredentials);
  
  // Bucket
  if (elements.bucketName) elements.bucketName.addEventListener('input', handleR2ConfigInput);
  if (elements.bucketSelect) elements.bucketSelect.addEventListener('change', handleBucketChange);
  if (elements.btnRefreshBuckets) elements.btnRefreshBuckets.addEventListener('click', handleRefreshBuckets);
  if (elements.endpointUrl) elements.endpointUrl.addEventListener('input', handleR2ConfigInput);
  if (elements.endpointRegion) elements.endpointRegion.addEventListener('input', handleR2ConfigInput);
  if (elements.publicUrl) elements.publicUrl.addEventListener('input', handleR2ConfigInput);
  if (elements.cloudflareAccountId) elements.cloudflareAccountId.addEventListener('input', handleR2ConfigInput);
  if (elements.cloudflareApiToken) elements.cloudflareApiToken.addEventListener('input', handleR2ConfigInput);
  if (elements.cloudflareJurisdiction) elements.cloudflareJurisdiction.addEventListener('change', handleR2ConfigInput);
  if (elements.btnCreateBucket) elements.btnCreateBucket.addEventListener('click', handleCreateBucket);
  if (elements.btnUpdateBucket) elements.btnUpdateBucket.addEventListener('click', handleUpdateBucket);
  if (elements.btnDeleteBucket) elements.btnDeleteBucket.addEventListener('click', handleDeleteBucket);
  
  // Footer buttons
  if (elements.btnCancel) elements.btnCancel.addEventListener('click', handleCancel);
  if (elements.btnSave) elements.btnSave.addEventListener('click', handleSave);
}

/**
 * 加载设置
 */
async function loadSettings() {
  try {
    // Load credentials
    const credResult = await electronAPI.getCredentials();
    if (credResult.success && credResult.data) {
      state.credentials = credResult.data;
      if (elements.accessKeyId) elements.accessKeyId.value = state.credentials.accessKeyId || '';
      if (elements.secretAccessKey) elements.secretAccessKey.value = state.credentials.secretAccessKey || '';
      updateCredentialStatus(true);
    } else {
      updateCredentialStatus(false);
    }

    // Load R2 + Cloudflare API config
    const r2ConfigResult = await electronAPI.getR2Config();
    if (r2ConfigResult.success && r2ConfigResult.data) {
      state.r2Config = {
        endpoint: r2ConfigResult.data.endpoint || '',
        region: r2ConfigResult.data.region || 'auto',
        bucket: r2ConfigResult.data.bucket || '',
        publicUrl: r2ConfigResult.data.publicUrl || '',
        cloudflareAccountId: r2ConfigResult.data.cloudflareAccountId || '',
        cloudflareApiToken: r2ConfigResult.data.cloudflareApiToken || '',
        cloudflareJurisdiction: r2ConfigResult.data.cloudflareJurisdiction || 'default'
      };
    } else {
      state.r2Config = {
        endpoint: '',
        region: 'auto',
        bucket: '',
        publicUrl: '',
        cloudflareAccountId: '',
        cloudflareApiToken: '',
        cloudflareJurisdiction: 'default'
      };
    }

    if (elements.endpointUrl) elements.endpointUrl.value = state.r2Config.endpoint;
    if (elements.endpointRegion) elements.endpointRegion.value = state.r2Config.region;
    if (elements.publicUrl) elements.publicUrl.value = state.r2Config.publicUrl;
    if (elements.cloudflareAccountId) elements.cloudflareAccountId.value = state.r2Config.cloudflareAccountId;
    if (elements.cloudflareApiToken) elements.cloudflareApiToken.value = state.r2Config.cloudflareApiToken;
    if (elements.cloudflareJurisdiction) {
      elements.cloudflareJurisdiction.value = state.r2Config.cloudflareJurisdiction || 'default';
    }
    if (elements.bucketName) {
      elements.bucketName.value = state.r2Config.bucket;
    } else if (elements.bucketSelect) {
      elements.bucketSelect.value = state.r2Config.bucket;
    }

    // Load bucket list
    await loadBucketList();
  } catch (error) {
    console.error('加载设置失败:', error);
    showNotification(UI_TEXT.credentialsLoadFailed || '加载设置失败', 'error');
  }
}

/**
 * 处理 Tab 点击 点击
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
  state.credentials.accessKeyId = elements.accessKeyId ? elements.accessKeyId.value : '';
  state.credentials.secretAccessKey = elements.secretAccessKey ? elements.secretAccessKey.value : '';
  state.hasChanges = true;
  
  // 更新状态指示器
  const hasCredentials = state.credentials.accessKeyId && state.credentials.secretAccessKey;
  updateCredentialStatus(hasCredentials);
}

/**
 * 更新凭证状态指示器
 */
function updateCredentialStatus(isConfigured) {
  if (!elements.credentialStatus || !elements.credentialStatusText) {
    return;
  }

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
  if (!elements.secretAccessKey || !elements.toggleSecretText) return;

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
  
  const accessKeyId = getInputValue(elements.accessKeyId);
  const secretAccessKey = getInputValue(elements.secretAccessKey);
  const endpoint = getInputValue(elements.endpointUrl);
  const region = getInputValue(elements.endpointRegion, 'auto') || 'auto';
  const bucket = getInputValue(elements.bucketName) || getInputValue(elements.bucketSelect);
  const publicUrl = getInputValue(elements.publicUrl);
  
  if (!accessKeyId || !secretAccessKey) {
    showNotification(UI_TEXT.credentialsValidateFailed || '请输入完整的凭证信息', 'error');
    return;
  }

  if (!endpoint) {
    showNotification(UI_TEXT.endpointRequired || '请填写 S3 地址（Endpoint）', 'error');
    return;
  }

  if (!bucket) {
    showNotification(UI_TEXT.bucketRequired || '请填写桶名', 'error');
    return;
  }
  
  state.isTesting = true;
  if (elements.btnTestConnection) {
    elements.btnTestConnection.disabled = true;
    elements.btnTestConnection.innerHTML = `<span class="loading-spinner"></span><span>${UI_TEXT.credentialsTesting || '正在测试连接...'}</span>`;
  }
  
  try {
    const result = await electronAPI.testConnection({
      accessKeyId,
      secretAccessKey,
      endpoint,
      region,
      bucket,
      publicUrl
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
    if (elements.btnTestConnection) {
      elements.btnTestConnection.disabled = false;
      elements.btnTestConnection.innerHTML = `<span>${UI_TEXT.credentialsTestConnection || '测试连接'}</span>`;
    }
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
      if (elements.accessKeyId) elements.accessKeyId.value = '';
      if (elements.secretAccessKey) elements.secretAccessKey.value = '';
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
  if (elements.bucketLoading) elements.bucketLoading.style.display = 'block';
  if (elements.bucketSelect) elements.bucketSelect.disabled = true;
  
  try {
    const accessKeyId = getInputValue(elements.accessKeyId);
    const secretAccessKey = getInputValue(elements.secretAccessKey);
    const bucketRequestPayload = {
      endpoint: getInputValue(elements.endpointUrl),
      region: getInputValue(elements.endpointRegion),
      bucket: getInputValue(elements.bucketName) || getInputValue(elements.bucketSelect),
      cloudflareAccountId: getInputValue(elements.cloudflareAccountId),
      cloudflareApiToken: getInputValue(elements.cloudflareApiToken),
      cloudflareJurisdiction: getInputValue(elements.cloudflareJurisdiction, 'default') || 'default'
    };

    // 两个字段都填写时，使用表单中的凭证测试；否则由主进程回退到已保存凭证
    if (accessKeyId && secretAccessKey) {
      bucketRequestPayload.accessKeyId = accessKeyId;
      bucketRequestPayload.secretAccessKey = secretAccessKey;
    }

    const result = await electronAPI.listBuckets(bucketRequestPayload);
    
    if (result.success && result.data) {
      state.buckets = result.data;
      renderBucketList();
      if (result.warning?.userMessage) {
        showNotification(result.warning.userMessage, 'info');
      }
    } else {
      showNotification(result.error?.userMessage || UI_TEXT.bucketLoadFailed || '加载存储桶列表失败', 'error');
    }
  } catch (error) {
    console.error('加载存储桶列表失败:', error);
    showNotification(UI_TEXT.bucketLoadFailed || '加载存储桶列表失败', 'error');
  } finally {
    state.isLoadingBuckets = false;
    if (elements.bucketLoading) elements.bucketLoading.style.display = 'none';
    if (elements.bucketSelect) elements.bucketSelect.disabled = false;
  }
}

/**
 * 处理 R2 配置输入
 */
function handleR2ConfigInput() {
  state.r2Config.endpoint = getInputValue(elements.endpointUrl);
  state.r2Config.region = getInputValue(elements.endpointRegion, 'auto') || 'auto';
  state.r2Config.bucket = getInputValue(elements.bucketName);
  state.r2Config.publicUrl = getInputValue(elements.publicUrl);
  state.r2Config.cloudflareAccountId = getInputValue(elements.cloudflareAccountId);
  state.r2Config.cloudflareApiToken = getInputValue(elements.cloudflareApiToken);
  state.r2Config.cloudflareJurisdiction = getInputValue(elements.cloudflareJurisdiction, 'default') || 'default';
  state.hasChanges = true;
}

/**
 * 渲染存储桶列表
 */
function renderBucketList() {
  if (!elements.bucketSelect) return;

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
    
    if (bucket.name === state.r2Config.bucket) {
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
  
  if (selectedBucket && selectedBucket !== state.r2Config.bucket) {
    state.r2Config.bucket = selectedBucket;
    if (elements.bucketName) elements.bucketName.value = selectedBucket;
    state.hasChanges = true;
  }
}

/**
 * 处理刷新存储桶列表
 */
async function handleRefreshBuckets() {
  await loadBucketList();
}

function getSettingsPayload() {
  return {
    endpoint: getInputValue(elements.endpointUrl),
    region: getInputValue(elements.endpointRegion, 'auto') || 'auto',
    bucket: getInputValue(elements.bucketName) || getInputValue(elements.bucketSelect),
    publicUrl: getInputValue(elements.publicUrl),
    cloudflareAccountId: getInputValue(elements.cloudflareAccountId),
    cloudflareApiToken: getInputValue(elements.cloudflareApiToken),
    cloudflareJurisdiction: getInputValue(elements.cloudflareJurisdiction, 'default') || 'default'
  };
}

async function handleCreateBucket() {
  const name = getInputValue(elements.newBucketName).toLowerCase();
  const locationHint = getInputValue(elements.newBucketLocationHint);
  const storageClass = getInputValue(elements.newBucketStorageClass, 'Standard') || 'Standard';

  if (!name) {
    showNotification('Please input a bucket name to create', 'error');
    return;
  }

  const result = await electronAPI.createBucket({
    ...getSettingsPayload(),
    name,
    locationHint,
    storageClass
  });

  if (!result.success) {
    showNotification(result.error?.userMessage || 'Create bucket failed', 'error');
    return;
  }

  if (elements.newBucketName) elements.newBucketName.value = '';
  if (elements.bucketName) elements.bucketName.value = name;
  state.r2Config.bucket = name;
  state.hasChanges = true;
  showNotification(`Bucket "${name}" created`, 'success');
  await loadBucketList();
}

async function handleUpdateBucket() {
  const bucketName = getInputValue(elements.bucketName) || getInputValue(elements.bucketSelect);
  const storageClass = getInputValue(elements.editBucketStorageClass, 'Standard') || 'Standard';

  if (!bucketName) {
    showNotification('Please select or input a bucket name to update', 'error');
    return;
  }

  const result = await electronAPI.updateBucket({
    ...getSettingsPayload(),
    bucketName,
    storageClass
  });

  if (!result.success) {
    showNotification(result.error?.userMessage || 'Update bucket failed', 'error');
    return;
  }

  showNotification(`Bucket "${bucketName}" updated to ${storageClass}`, 'success');
  await loadBucketList();
}

async function handleDeleteBucket() {
  const bucketName = getInputValue(elements.bucketName) || getInputValue(elements.bucketSelect);
  if (!bucketName) {
    showNotification('Please select or input a bucket name to delete', 'error');
    return;
  }

  const confirmed = await electronAPI.confirm(
    `Delete bucket "${bucketName}"? Objects in this bucket will be deleted first. This action cannot be undone.`
  );
  if (!confirmed) return;

  const accessKeyId = getInputValue(elements.accessKeyId);
  const secretAccessKey = getInputValue(elements.secretAccessKey);
  const payload = {
    ...getSettingsPayload(),
    bucketName
  };
  if (accessKeyId && secretAccessKey) {
    payload.accessKeyId = accessKeyId;
    payload.secretAccessKey = secretAccessKey;
  }

  const result = await electronAPI.deleteBucket(payload);
  if (!result.success) {
    showNotification(result.error?.userMessage || 'Delete bucket failed', 'error');
    return;
  }

  const deletedObjects = Number(result.data?.deletedObjects || 0);
  showNotification(`Bucket "${bucketName}" deleted. Cleared ${deletedObjects} objects.`, 'success');

  if (elements.bucketName) elements.bucketName.value = '';
  state.r2Config.bucket = '';
  state.hasChanges = true;
  await loadBucketList();
}

/**
 * 处理取消
 */
function handleCancel() {
  closeSettingsPage({ reload: false });
}

/**
 * 处理保存
 */
async function handleSave() {
  const accessKeyId = getInputValue(elements.accessKeyId);
  const secretAccessKey = getInputValue(elements.secretAccessKey);
  const endpoint = getInputValue(elements.endpointUrl);
  const region = getInputValue(elements.endpointRegion, 'auto') || 'auto';
  const bucket = getInputValue(elements.bucketName) || getInputValue(elements.bucketSelect);
  const publicUrl = getInputValue(elements.publicUrl);
  const cloudflareAccountId = getInputValue(elements.cloudflareAccountId);
  const cloudflareApiToken = getInputValue(elements.cloudflareApiToken);
  const cloudflareJurisdiction = getInputValue(elements.cloudflareJurisdiction, 'default') || 'default';

  if (!state.hasChanges) {
    showNotification(UI_TEXT.settingsNoChanges || 'No changes to save', 'info');
    return;
  }

  if (!endpoint) {
    showNotification(UI_TEXT.endpointRequired || 'Please input S3 endpoint', 'error');
    return;
  }

  if (!bucket) {
    showNotification(UI_TEXT.bucketRequired || 'Please input bucket name', 'error');
    return;
  }

  if ((accessKeyId && !secretAccessKey) || (!accessKeyId && secretAccessKey)) {
    showNotification(UI_TEXT.credentialsValidateFailed || 'Please input complete credentials', 'error');
    return;
  }

  if (elements.btnSave) {
    elements.btnSave.disabled = true;
    elements.btnSave.innerHTML = `<span class="loading-spinner"></span><span>${UI_TEXT.settingsSaving || 'Saving...'}</span>`;
  }

  try {
    const r2ConfigResult = await electronAPI.saveR2Config({
      endpoint,
      region,
      bucket,
      publicUrl,
      cloudflareAccountId,
      cloudflareApiToken,
      cloudflareJurisdiction
    });

    if (!r2ConfigResult.success) {
      showNotification(r2ConfigResult.error?.userMessage || UI_TEXT.settingsSaveFailed || 'Save settings failed', 'error');
      return;
    }

    if (accessKeyId && secretAccessKey) {
      const credResult = await electronAPI.saveCredentials({
        accessKeyId,
        secretAccessKey,
        encrypt: elements.encryptCredentials ? elements.encryptCredentials.checked : true
      });

      if (!credResult.success) {
        showNotification(credResult.error?.userMessage || UI_TEXT.credentialsSaveFailed || 'Save credentials failed', 'error');
        return;
      }
    }

    state.r2Config = {
      endpoint,
      region,
      bucket,
      publicUrl,
      cloudflareAccountId,
      cloudflareApiToken,
      cloudflareJurisdiction
    };
    state.hasChanges = false;
    showNotification(UI_TEXT.settingsSaveSuccess || 'Settings saved', 'success');

    setTimeout(() => {
      closeSettingsPage({ reload: true });
    }, 1000);
  } catch (error) {
    console.error('Save settings failed:', error);
    showNotification(UI_TEXT.settingsSaveFailed || 'Save settings failed', 'error');
  } finally {
    if (elements.btnSave) {
      elements.btnSave.disabled = false;
      elements.btnSave.innerHTML = `<span>${UI_TEXT.settingsButtonSave || 'Save Settings'}</span>`;
    }
  }
}

/**
 * 显示通知
 */
function showNotification(message, type = 'info') {
  if (!elements.notificationContainer) {
    return;
  }

  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;

  elements.notificationContainer.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = 'slideIn 0.3s ease reverse';
    setTimeout(() => {
      notification.remove();
    }, 300);
  }, 3000);
}

async function bootstrapSettings() {
  try {
    await init();
  } catch (error) {
    console.error('Settings bootstrap failed:', error);
    showNotification((UI_TEXT.settingsLoadFailed || UI_TEXT.errorUnknown || 'Settings bootstrap failed') + `: ${error.message}`, 'error');
    try {
      window.alert(`Settings bootstrap failed: ${error.message}`);
    } catch {
      // ignore
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrapSettings);
} else {
  bootstrapSettings();
}
