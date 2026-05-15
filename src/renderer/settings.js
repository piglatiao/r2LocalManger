/**
 * 设置窗口渲染进程脚本
 * 负责凭证配置、远端存储桶同步、自定义域名与 r2.dev 管理。
 */

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

var UI_TEXT = window.UI_TEXT || {};
const isEmbeddedMode = new URLSearchParams(window.location.search).get('embedded') === '1';

/**
 * 设置页可用的 IPC 能力封装。
 */
const electronAPI = {
  getCredentials: async () => ipcRenderer.invoke('settings:getCredentials'),
  saveCredentials: async (payload) => ipcRenderer.invoke('settings:saveCredentials', payload),
  clearCredentials: async () => ipcRenderer.invoke('settings:clearCredentials'),
  testConnection: async (payload) => ipcRenderer.invoke('settings:testConnection', payload),
  getR2Config: async () => ipcRenderer.invoke('settings:getR2Config'),
  saveR2Config: async (payload) => ipcRenderer.invoke('settings:saveR2Config', payload),
  listBuckets: async (payload) => ipcRenderer.invoke('settings:listBuckets', payload),
  getCurrentBucket: async () => ipcRenderer.invoke('settings:getCurrentBucket'),
  setCurrentBucket: async (bucket) => ipcRenderer.invoke('settings:setCurrentBucket', bucket),
  createBucket: async (payload) => ipcRenderer.invoke('settings:createBucket', payload),
  updateBucket: async (payload) => ipcRenderer.invoke('settings:updateBucket', payload),
  deleteBucket: async (payload) => ipcRenderer.invoke('settings:deleteBucket', payload),
  syncBucketState: async (payload) => ipcRenderer.invoke('settings:syncBucketState', payload),
  getBucketDetail: async (payload) => ipcRenderer.invoke('settings:getBucketDetail', payload),
  listCustomDomains: async (payload) => ipcRenderer.invoke('settings:listCustomDomains', payload),
  createCustomDomain: async (payload) => ipcRenderer.invoke('settings:createCustomDomain', payload),
  updateCustomDomain: async (payload) => ipcRenderer.invoke('settings:updateCustomDomain', payload),
  deleteCustomDomain: async (payload) => ipcRenderer.invoke('settings:deleteCustomDomain', payload),
  getManagedDomain: async (payload) => ipcRenderer.invoke('settings:getManagedDomain', payload),
  updateManagedDomain: async (payload) => ipcRenderer.invoke('settings:updateManagedDomain', payload),
  confirm: async (message) => {
    const result = await ipcRenderer.invoke('dialog:confirm', message);
    return result.confirmed;
  }
};

window.electronAPI = electronAPI;

const elements = {
  tabNavItems: document.querySelectorAll('.tab-nav-item'),
  tabPanels: document.querySelectorAll('.tab-panel'),
  credentialStatus: document.getElementById('credential-status'),
  credentialStatusText: document.getElementById('credential-status-text'),
  cloudflareAccountId: document.getElementById('cloudflare-account-id'),
  cloudflareApiToken: document.getElementById('cloudflare-api-token'),
  accessKeyId: document.getElementById('access-key-id'),
  secretAccessKey: document.getElementById('secret-access-key'),
  cloudflareJurisdiction: document.getElementById('cloudflare-jurisdiction'),
  endpointUrl: document.getElementById('endpoint-url'),
  endpointRegion: document.getElementById('endpoint-region'),
  btnToggleSecret: document.getElementById('btn-toggle-secret'),
  toggleSecretText: document.getElementById('toggle-secret-text'),
  btnTestConnection: document.getElementById('btn-test-connection'),
  encryptCredentials: document.getElementById('encrypt-credentials'),
  btnClearCredentials: document.getElementById('btn-clear-credentials'),
  bucketSelect: document.getElementById('bucket-select'),
  btnRefreshBuckets: document.getElementById('btn-refresh-buckets'),
  bucketLoading: document.getElementById('bucket-loading'),
  bucketLoadingText: document.querySelector('#bucket-loading span:last-child'),
  bucketName: document.getElementById('bucket-name'),
  bucketCreatedAt: document.getElementById('bucket-created-at'),
  bucketLocationHint: document.getElementById('bucket-location-hint'),
  publicUrl: document.getElementById('public-url'),
  btnCreateBucket: document.getElementById('btn-create-bucket'),
  btnUpdateBucket: document.getElementById('btn-update-bucket'),
  btnDeleteBucket: document.getElementById('btn-delete-bucket'),
  newBucketName: document.getElementById('new-bucket-name'),
  newBucketLocationHint: document.getElementById('new-bucket-location-hint'),
  newBucketStorageClass: document.getElementById('new-bucket-storage-class'),
  editBucketStorageClass: document.getElementById('edit-bucket-storage-class'),
  managedDomainUrl: document.getElementById('managed-domain-url'),
  managedDomainEnabled: document.getElementById('managed-domain-enabled'),
  btnUpdateManagedDomain: document.getElementById('btn-update-managed-domain'),
  customDomainList: document.getElementById('custom-domain-list'),
  customDomain: document.getElementById('custom-domain'),
  customDomainZoneId: document.getElementById('custom-domain-zone-id'),
  customDomainMinTls: document.getElementById('custom-domain-min-tls'),
  customDomainEnabled: document.getElementById('custom-domain-enabled'),
  customDomainCiphers: document.getElementById('custom-domain-ciphers'),
  btnCreateCustomDomain: document.getElementById('btn-create-custom-domain'),
  btnUpdateCustomDomain: document.getElementById('btn-update-custom-domain'),
  btnDeleteCustomDomain: document.getElementById('btn-delete-custom-domain'),
  btnResetCustomDomain: document.getElementById('btn-reset-custom-domain'),
  btnCancel: document.getElementById('btn-cancel'),
  btnSave: document.getElementById('btn-save'),
  notificationContainer: document.getElementById('notification-container')
};

const state = {
  credentials: {
    accountId: '',
    apiToken: '',
    accessKeyId: '',
    secretAccessKey: '',
    jurisdiction: 'default'
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
  bucketDetail: null,
  customDomains: [],
  managedDomain: null,
  selectedDomain: '',
  hasChanges: false,
  isTesting: false,
  isLoadingBuckets: false
};

function getInputValue(element, fallback = '') {
  if (!element) return fallback;
  return typeof element.value === 'string' ? element.value.trim() : fallback;
}

/**
 * 将加密套件文本区域解析为字符串数组。
 * @param {string} rawValue - 原始输入值
 * @returns {string[]} 过滤后的加密套件数组
 */
function parseCipherList(rawValue) {
  return String(rawValue || '')
    .split(/\r?\n|,/)
    .map(item => item.trim())
    .filter(Boolean);
}

/**
 * 根据 account id 自动更新 endpoint 展示值。
 */
function updateDerivedEndpoint() {
  const accountId = getInputValue(elements.cloudflareAccountId);
  if (elements.endpointUrl) {
    elements.endpointUrl.value = accountId
      ? `https://${accountId}.r2.cloudflarestorage.com`
      : '';
  }
  if (elements.endpointRegion) {
    elements.endpointRegion.value = 'auto';
  }
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
    return;
  }

  window.close();
}

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

function updateCredentialStatus(isConfigured) {
  if (!elements.credentialStatus || !elements.credentialStatusText) {
    return;
  }

  if (isConfigured) {
    elements.credentialStatus.classList.remove('not-configured');
    elements.credentialStatus.classList.add('configured');
    elements.credentialStatusText.textContent = UI_TEXT.credentialsStatusConfigured || '凭证已配置';
    return;
  }

  elements.credentialStatus.classList.remove('configured');
  elements.credentialStatus.classList.add('not-configured');
  elements.credentialStatusText.textContent = UI_TEXT.credentialsStatusNotConfigured || '凭证未配置';
}

/**
 * 渲染桶下拉列表。
 */
/**
 * 控制设置页远端同步提示。
 * @param {boolean} visible - 是否显示远端同步提示
 * @param {string} text - 当前远端操作文案
 */
function setBucketLoadingState(visible, text = '正在同步远端存储桶配置...') {
  if (elements.bucketLoadingText) {
    elements.bucketLoadingText.textContent = text;
  }
  if (elements.bucketLoading) {
    elements.bucketLoading.style.display = visible ? 'block' : 'none';
  }
}

function renderBucketList() {
  if (!elements.bucketSelect) {
    return;
  }

  elements.bucketSelect.innerHTML = '';

  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = UI_TEXT.bucketSelectPlaceholder || '请选择存储桶';
  elements.bucketSelect.appendChild(defaultOption);

  state.buckets.forEach(bucket => {
    const option = document.createElement('option');
    option.value = bucket.name;
    option.textContent = bucket.name;
    if (bucket.name === state.r2Config.bucket) {
      option.selected = true;
    }
    elements.bucketSelect.appendChild(option);
  });

  elements.bucketSelect.disabled = state.isLoadingBuckets || state.buckets.length === 0;
}

/**
 * 渲染自定义域名列表。
 */
function renderCustomDomains() {
  if (!elements.customDomainList) {
    return;
  }

  elements.customDomainList.innerHTML = '';

  if (!state.customDomains.length) {
    const emptyTip = document.createElement('div');
    emptyTip.className = 'empty-inline-tip';
    emptyTip.textContent = '当前桶暂无自定义域名。';
    elements.customDomainList.appendChild(emptyTip);
    return;
  }

  state.customDomains.forEach(item => {
    const wrapper = document.createElement('div');
    wrapper.className = `custom-domain-item${item.domain === state.selectedDomain ? ' selected' : ''}`;
    wrapper.dataset.domain = item.domain;

    const title = document.createElement('div');
    title.className = 'custom-domain-title';
    title.innerHTML = `
      <span>${item.domain}</span>
      <span class="status-pill ${item.enabled ? 'enabled' : 'disabled'}">${item.enabled ? '已启用' : '已停用'}</span>
    `;

    const meta = document.createElement('div');
    meta.className = 'custom-domain-meta';
    meta.innerHTML = `
      <div>Zone ID: ${item.zoneId || '-'}</div>
      <div>最低 TLS: ${item.minTLS || '默认'}</div>
      <div>状态: ${item.status || '未知'}</div>
      <div>加密套件数: ${Array.isArray(item.ciphers) ? item.ciphers.length : 0}</div>
    `;

    wrapper.appendChild(title);
    wrapper.appendChild(meta);
    wrapper.addEventListener('click', () => selectCustomDomain(item.domain));
    elements.customDomainList.appendChild(wrapper);
  });
}

/**
 * 将当前选中的自定义域名信息填充到表单。
 * @param {string} domain - 选中的域名
 */
function selectCustomDomain(domain) {
  state.selectedDomain = domain;
  const current = state.customDomains.find(item => item.domain === domain);
  if (!current) {
    renderCustomDomains();
    return;
  }

  if (elements.customDomain) elements.customDomain.value = current.domain || '';
  if (elements.customDomainZoneId) elements.customDomainZoneId.value = current.zoneId || '';
  if (elements.customDomainMinTls) elements.customDomainMinTls.value = current.minTLS || '';
  if (elements.customDomainEnabled) elements.customDomainEnabled.checked = Boolean(current.enabled);
  if (elements.customDomainCiphers) {
    elements.customDomainCiphers.value = Array.isArray(current.ciphers) ? current.ciphers.join('\n') : '';
  }

  renderCustomDomains();
}

/**
 * 清空自定义域名编辑表单。
 */
function resetCustomDomainForm() {
  state.selectedDomain = '';
  if (elements.customDomain) elements.customDomain.value = '';
  if (elements.customDomainZoneId) elements.customDomainZoneId.value = '';
  if (elements.customDomainMinTls) elements.customDomainMinTls.value = '';
  if (elements.customDomainEnabled) elements.customDomainEnabled.checked = true;
  if (elements.customDomainCiphers) elements.customDomainCiphers.value = '';
  renderCustomDomains();
}

/**
 * 将远端同步结果写回设置页状态。
 * @param {Object} syncState - 同步结果
 */
function applySyncedBucketState(syncState) {
  state.buckets = Array.isArray(syncState?.buckets) ? syncState.buckets : [];
  state.r2Config.bucket = syncState?.currentBucket || '';
  state.r2Config.publicUrl = syncState?.publicUrl || '';
  state.r2Config.endpoint = syncState?.endpoint || state.r2Config.endpoint;
  state.r2Config.region = syncState?.region || 'auto';
  state.r2Config.cloudflareAccountId = syncState?.cloudflareAccountId || state.r2Config.cloudflareAccountId;
  state.r2Config.cloudflareJurisdiction = syncState?.cloudflareJurisdiction || state.r2Config.cloudflareJurisdiction;
  state.bucketDetail = syncState?.bucketDetail || null;
  state.customDomains = Array.isArray(syncState?.customDomains) ? syncState.customDomains : [];
  state.managedDomain = syncState?.managedDomain || null;

  if (elements.bucketName) {
    elements.bucketName.value = state.r2Config.bucket;
  }
  if (elements.publicUrl) {
    elements.publicUrl.value = state.r2Config.publicUrl || '';
  }
  if (elements.bucketCreatedAt) {
    elements.bucketCreatedAt.value = state.bucketDetail?.creationDate || '';
  }
  if (elements.bucketLocationHint) {
    elements.bucketLocationHint.value = state.bucketDetail?.locationHint || '';
  }
  if (elements.editBucketStorageClass) {
    elements.editBucketStorageClass.value = state.bucketDetail?.storageClass || 'Standard';
  }
  if (elements.managedDomainUrl) {
    elements.managedDomainUrl.value = state.managedDomain?.url || state.managedDomain?.domain || '';
  }
  if (elements.managedDomainEnabled) {
    elements.managedDomainEnabled.checked = Boolean(state.managedDomain?.enabled);
  }

  renderBucketList();
  renderCustomDomains();
  if (state.selectedDomain) {
    selectCustomDomain(state.selectedDomain);
  }
}

/**
 * 获取当前设置表单对应的 R2 配置载荷。
 * @returns {Object} 配置对象
 */
function getSettingsPayload() {
  return {
    bucket: state.r2Config.bucket,
    cloudflareAccountId: getInputValue(elements.cloudflareAccountId),
    cloudflareApiToken: getInputValue(elements.cloudflareApiToken),
    cloudflareJurisdiction: getInputValue(elements.cloudflareJurisdiction, 'default') || 'default',
    region: 'auto',
    publicUrl: getInputValue(elements.publicUrl)
  };
}

/**
 * 同步当前桶完整配置，并刷新页面展示。
 * @param {Object} options - 同步选项
 * @param {string} options.bucket - 指定桶名
 * @returns {Promise<void>}
 */

async function syncBucketState(options = {}) {
  const payload = {
    ...getSettingsPayload(),
    bucket: options.bucket || state.r2Config.bucket
  };
  const result = await electronAPI.syncBucketState(payload);
	  if (!result.success) {
	    setBucketLoadingState(false, '正在删除远端存储桶...');
	    setBucketLoadingState(false, '正在更新远端存储桶配置...');
	    setBucketLoadingState(false, '正在创建远端存储桶...');
	      setBucketLoadingState(false, '正在切换存储桶配置...');
    throw new Error(result.error?.message || 'Sync bucket state failed');
  }
	    applySyncedBucketState(result.data);
	    setBucketLoadingState(false, '正在切换存储桶配置...');
}

/**
 * 重新从远端同步桶列表。
 * @param {Object} options - 同步选项
 * @param {string} options.bucket - 指定要激活的桶名
 */
async function loadBucketState(options = {}) {
  const normalizedOptions = {
    loadingText: '正在同步远端存储桶配置...',
    ...options
  };
  if (state.isLoadingBuckets) return;

  state.isLoadingBuckets = true;
  setBucketLoadingState(true, normalizedOptions.loadingText);
  renderBucketList();

  try {
    await syncBucketState(normalizedOptions);
	  } catch (error) {
	    setBucketLoadingState(false, '正在切换存储桶配置...');
    console.error('同步远端存储桶状态失败:', error);
    showNotification(error.userMessage || UI_TEXT.bucketLoadFailed || '加载存储桶列表失败', 'error');
  } finally {
    state.isLoadingBuckets = false;
    setBucketLoadingState(false, normalizedOptions.loadingText);
    renderBucketList();
  }
}

function handleTabClick(tabItem) {
  const tabId = tabItem.dataset.tab;
  elements.tabNavItems.forEach(item => item.classList.remove('active'));
  tabItem.classList.add('active');
  elements.tabPanels.forEach(panel => panel.classList.remove('active'));
  document.getElementById(`tab-${tabId}`).classList.add('active');
}

/**
 * 处理凭证输入，更新本地状态与派生 endpoint。
 */
function handleCredentialInput() {
  state.credentials.accountId = getInputValue(elements.cloudflareAccountId);
  state.credentials.apiToken = getInputValue(elements.cloudflareApiToken);
  state.credentials.accessKeyId = getInputValue(elements.accessKeyId);
  state.credentials.secretAccessKey = getInputValue(elements.secretAccessKey);
  state.credentials.jurisdiction = getInputValue(elements.cloudflareJurisdiction, 'default') || 'default';
  updateDerivedEndpoint();
  state.hasChanges = true;

  const hasCredentials = state.credentials.accountId &&
    state.credentials.apiToken &&
    state.credentials.accessKeyId &&
    state.credentials.secretAccessKey;
  updateCredentialStatus(Boolean(hasCredentials));
}

function handleR2ConfigInput() {
  state.r2Config.cloudflareAccountId = getInputValue(elements.cloudflareAccountId);
  state.r2Config.cloudflareApiToken = getInputValue(elements.cloudflareApiToken);
  state.r2Config.cloudflareJurisdiction = getInputValue(elements.cloudflareJurisdiction, 'default') || 'default';
  state.hasChanges = true;
}

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
 * 测试当前凭证与当前桶对象访问能力。
 */
async function handleTestConnection() {
  if (state.isTesting) return;

  const accountId = getInputValue(elements.cloudflareAccountId);
  const apiToken = getInputValue(elements.cloudflareApiToken);
  const accessKeyId = getInputValue(elements.accessKeyId);
  const secretAccessKey = getInputValue(elements.secretAccessKey);
  const bucket = state.r2Config.bucket;

  if (!accountId || !apiToken || !accessKeyId || !secretAccessKey) {
    showNotification(UI_TEXT.credentialsValidateFailed || '请输入完整的凭证信息', 'error');
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
      endpoint: getInputValue(elements.endpointUrl),
      region: 'auto',
      bucket,
      publicUrl: getInputValue(elements.publicUrl),
      cloudflareAccountId: accountId,
      cloudflareApiToken: apiToken,
      cloudflareJurisdiction: getInputValue(elements.cloudflareJurisdiction, 'default') || 'default'
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

async function handleClearCredentials() {
  const confirmed = await electronAPI.confirm(
    UI_TEXT.securityClearConfirm || '确定要清除已保存的凭证吗？您需要重新输入凭证才能使用应用。'
  );
  if (!confirmed) return;

  try {
    const result = await electronAPI.clearCredentials();
    if (!result.success) {
      showNotification(result.error?.userMessage || UI_TEXT.securityClearFailed || '清除凭证失败', 'error');
      return;
    }

    if (elements.cloudflareAccountId) elements.cloudflareAccountId.value = '';
    if (elements.cloudflareApiToken) elements.cloudflareApiToken.value = '';
    if (elements.accessKeyId) elements.accessKeyId.value = '';
    if (elements.secretAccessKey) elements.secretAccessKey.value = '';
    if (elements.cloudflareJurisdiction) elements.cloudflareJurisdiction.value = 'default';
    updateDerivedEndpoint();
    state.credentials = {
      accountId: '',
      apiToken: '',
      accessKeyId: '',
      secretAccessKey: '',
      jurisdiction: 'default'
    };
    updateCredentialStatus(false);
    showNotification(UI_TEXT.securityClearSuccess || '凭证已清除', 'success');
  } catch (error) {
    console.error('清除凭证失败:', error);
    showNotification(UI_TEXT.securityClearFailed || '清除凭证失败', 'error');
  }
}

async function handleBucketChange(event) {
  const selectedBucket = String(event.target?.value || '').trim();
  if (!selectedBucket || selectedBucket === state.r2Config.bucket) {
    return;
  }

  setBucketLoadingState(true, '正在切换存储桶配置...');
  try {
    const result = await electronAPI.setCurrentBucket(selectedBucket);
    if (!result.success) {
      showNotification(result.error?.userMessage || UI_TEXT.bucketSwitchFailed || '切换存储桶失败', 'error');
      return;
    }
    applySyncedBucketState(result.data);
    showNotification((UI_TEXT.bucketSwitchSuccess || '已切换到存储桶: {bucket}').replace('{bucket}', selectedBucket), 'success');
  } catch (error) {
    console.error('切换存储桶失败:', error);
    showNotification(error.userMessage || UI_TEXT.bucketSwitchFailed || '切换存储桶失败', 'error');
  }
}

async function handleRefreshBuckets() {
  await loadBucketState({ loadingText: '正在刷新远端存储桶配置...' });
}

async function handleCreateBucket() {
  const name = getInputValue(elements.newBucketName).toLowerCase();
  const locationHint = getInputValue(elements.newBucketLocationHint);
  const storageClass = getInputValue(elements.newBucketStorageClass, 'Standard') || 'Standard';

  if (!name) {
    showNotification(UI_TEXT.bucketRequired || '请填写桶名', 'error');
    return;
  }

	  setBucketLoadingState(true, '正在创建远端存储桶...');
	  const result = await electronAPI.createBucket({
    ...getSettingsPayload(),
    name,
    locationHint,
    storageClass
  });

  if (!result.success) {
    showNotification(result.error?.userMessage || '创建存储桶失败', 'error');
    return;
  }

	  if (elements.newBucketName) elements.newBucketName.value = '';
	  setBucketLoadingState(false, '正在创建远端存储桶...');
  showNotification(`Bucket "${name}" created`, 'success');
	  await loadBucketState({ bucket: name, loadingText: '正在同步新建存储桶配置...' });
}

async function handleUpdateBucket() {
  const bucketName = state.r2Config.bucket;
  const storageClass = getInputValue(elements.editBucketStorageClass, 'Standard') || 'Standard';
  if (!bucketName) {
    showNotification(UI_TEXT.bucketRequired || '请填写桶名', 'error');
    return;
  }

	  setBucketLoadingState(true, '正在更新远端存储桶配置...');
	  const result = await electronAPI.updateBucket({
    ...getSettingsPayload(),
    bucketName,
    storageClass
  });

  if (!result.success) {
    showNotification(result.error?.userMessage || '更新存储桶失败', 'error');
    return;
  }

	  setBucketLoadingState(false, '正在更新远端存储桶配置...');
	  showNotification(`Bucket "${bucketName}" updated to ${storageClass}`, 'success');
	  await loadBucketState({ bucket: bucketName, loadingText: '正在同步存储桶最新配置...' });
}

async function handleDeleteBucket() {
  const bucketName = state.r2Config.bucket;
  if (!bucketName) {
    showNotification(UI_TEXT.bucketRequired || '请填写桶名', 'error');
    return;
  }

  const confirmed = await electronAPI.confirm(
    `Delete bucket "${bucketName}"? Objects in this bucket will be deleted first. This action cannot be undone.`
  );
  if (!confirmed) return;

	  setBucketLoadingState(true, '正在删除远端存储桶...');
	  const result = await electronAPI.deleteBucket({
    ...getSettingsPayload(),
    bucketName,
    accessKeyId: getInputValue(elements.accessKeyId),
    secretAccessKey: getInputValue(elements.secretAccessKey)
  });

  if (!result.success) {
    showNotification(result.error?.userMessage || '删除存储桶失败', 'error');
    return;
  }

  const deletedObjects = Number(result.data?.deletedObjects || 0);
  showNotification(`Bucket "${bucketName}" deleted. Cleared ${deletedObjects} objects.`, 'success');
  resetCustomDomainForm();
  await loadBucketState();
}

async function handleUpdateManagedDomain() {
  if (!state.r2Config.bucket) {
    showNotification(UI_TEXT.bucketRequired || '请填写桶名', 'error');
    return;
  }

	  setBucketLoadingState(true, '正在同步 r2.dev 配置...');
	  const result = await electronAPI.updateManagedDomain({
    ...getSettingsPayload(),
    bucketName: state.r2Config.bucket,
    enabled: Boolean(elements.managedDomainEnabled?.checked)
  });

  if (!result.success) {
    showNotification(result.error?.userMessage || '更新 r2.dev 配置失败', 'error');
    return;
  }

  state.managedDomain = result.data;
  if (elements.managedDomainUrl) {
    elements.managedDomainUrl.value = state.managedDomain?.url || state.managedDomain?.domain || '';
  }
  showNotification('r2.dev 状态已更新', 'success');
	  await loadBucketState({ bucket: state.r2Config.bucket, loadingText: '正在同步 r2.dev 最新配置...' });
}

function buildCustomDomainPayload() {
  return {
    ...getSettingsPayload(),
    bucketName: state.r2Config.bucket,
    domain: getInputValue(elements.customDomain),
    zoneId: getInputValue(elements.customDomainZoneId),
    enabled: Boolean(elements.customDomainEnabled?.checked),
    minTLS: getInputValue(elements.customDomainMinTls),
    ciphers: parseCipherList(getInputValue(elements.customDomainCiphers))
  };
}

async function handleCreateCustomDomain() {
  if (!state.r2Config.bucket) {
    showNotification(UI_TEXT.bucketRequired || '请先选择存储桶', 'error');
    return;
  }

	  setBucketLoadingState(true, '正在绑定自定义域名...');
	  const result = await electronAPI.createCustomDomain(buildCustomDomainPayload());
  if (!result.success) {
    showNotification(result.error?.userMessage || '绑定自定义域名失败', 'error');
    return;
  }

  showNotification('自定义域名绑定成功', 'success');
	  await loadBucketState({ bucket: state.r2Config.bucket, loadingText: '正在同步自定义域名配置...' });
  selectCustomDomain(result.data?.domain || getInputValue(elements.customDomain));
}

async function handleUpdateCustomDomain() {
  if (!state.selectedDomain) {
    showNotification('请先从列表中选择要更新的域名。', 'warning');
    return;
  }

	  setBucketLoadingState(true, '正在更新自定义域名配置...');
	  const result = await electronAPI.updateCustomDomain({
    ...buildCustomDomainPayload(),
    currentDomain: state.selectedDomain
  });
  if (!result.success) {
    showNotification(result.error?.userMessage || '更新自定义域名失败', 'error');
    return;
  }

  showNotification('自定义域名已更新', 'success');
	  await loadBucketState({ bucket: state.r2Config.bucket, loadingText: '正在同步自定义域名最新配置...' });
  selectCustomDomain(result.data?.domain || getInputValue(elements.customDomain));
}

async function handleDeleteCustomDomain() {
  const domain = state.selectedDomain || getInputValue(elements.customDomain);
  if (!domain) {
    showNotification('请先选择要解绑的域名。', 'warning');
    return;
  }

  const confirmed = await electronAPI.confirm(`确定要解绑域名 "${domain}" 吗？`);
  if (!confirmed) return;

	  setBucketLoadingState(true, '正在解绑自定义域名...');
	  const result = await electronAPI.deleteCustomDomain({
    ...getSettingsPayload(),
    bucketName: state.r2Config.bucket,
    domain
  });
  if (!result.success) {
    showNotification(result.error?.userMessage || '删除自定义域名失败', 'error');
    return;
  }

  showNotification('自定义域名已解绑', 'success');
  resetCustomDomainForm();
	  await loadBucketState({ bucket: state.r2Config.bucket, loadingText: '正在同步自定义域名列表...' });
}

function handleCancel() {
  closeSettingsPage({ reload: false });
}

/**
 * 保存凭证与基础配置。
 */
async function handleSave() {
  const accountId = getInputValue(elements.cloudflareAccountId);
  const apiToken = getInputValue(elements.cloudflareApiToken);
  const accessKeyId = getInputValue(elements.accessKeyId);
  const secretAccessKey = getInputValue(elements.secretAccessKey);
  const jurisdiction = getInputValue(elements.cloudflareJurisdiction, 'default') || 'default';

  if (!state.hasChanges) {
    showNotification(UI_TEXT.settingsNoChanges || '没有需要保存的更改', 'info');
    return;
  }
  if (!accountId || !apiToken || !accessKeyId || !secretAccessKey) {
    showNotification(UI_TEXT.credentialsValidateFailed || '请输入完整的凭证信息', 'error');
    return;
  }

  if (elements.btnSave) {
    elements.btnSave.disabled = true;
    elements.btnSave.innerHTML = `<span class="loading-spinner"></span><span>${UI_TEXT.settingsSaving || '正在保存...'}</span>`;
  }

  try {
    const r2ConfigResult = await electronAPI.saveR2Config({
      bucket: state.r2Config.bucket,
      publicUrl: state.r2Config.publicUrl,
      cloudflareAccountId: accountId,
      cloudflareApiToken: apiToken,
      cloudflareJurisdiction: jurisdiction,
      region: 'auto'
    });
    if (!r2ConfigResult.success) {
      showNotification(r2ConfigResult.error?.userMessage || UI_TEXT.settingsSaveFailed || '保存设置失败', 'error');
      return;
    }

    const credResult = await electronAPI.saveCredentials({
      accountId,
      apiToken,
      accessKeyId,
      secretAccessKey,
      jurisdiction,
      encrypt: elements.encryptCredentials ? elements.encryptCredentials.checked : true
    });
    if (!credResult.success) {
      showNotification(credResult.error?.userMessage || UI_TEXT.credentialsSaveFailed || '保存凭证失败', 'error');
      return;
    }

    state.hasChanges = false;
    showNotification(UI_TEXT.settingsSaveSuccess || '设置已保存', 'success');

    if (!state.r2Config.bucket) {
      await loadBucketState();
    }

    setTimeout(() => {
      closeSettingsPage({ reload: true });
    }, 800);
  } catch (error) {
    console.error('保存设置失败:', error);
    showNotification(UI_TEXT.settingsSaveFailed || '保存设置失败', 'error');
  } finally {
    if (elements.btnSave) {
      elements.btnSave.disabled = false;
      elements.btnSave.innerHTML = `<span>${UI_TEXT.settingsButtonSave || '保存设置'}</span>`;
    }
  }
}

function showNotification(message, type = 'info') {
  setBucketLoadingState(false);
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

// 重新声明远端同步与桶/域名操作方法，覆盖前面零散补丁留下的中间状态。

async function syncBucketState(options = {}) {
  const payload = {
    ...getSettingsPayload(),
    bucket: options.bucket || state.r2Config.bucket
  };
  const result = await electronAPI.syncBucketState(payload);
  if (!result.success) {
    throw new Error(result.error?.message || 'Sync bucket state failed');
  }
  applySyncedBucketState(result.data);
}

async function loadBucketState(options = {}) {
  const normalizedOptions = {
    loadingText: '正在同步远端存储桶配置...',
    ...options
  };
  if (state.isLoadingBuckets) return;

  state.isLoadingBuckets = true;
  setBucketLoadingState(true, normalizedOptions.loadingText);
  renderBucketList();

  try {
    await syncBucketState(normalizedOptions);
  } catch (error) {
    console.error('同步远端存储桶状态失败:', error);
    showNotification(error.userMessage || UI_TEXT.bucketLoadFailed || '加载存储桶列表失败', 'error');
  } finally {
    state.isLoadingBuckets = false;
    setBucketLoadingState(false, normalizedOptions.loadingText);
    renderBucketList();
  }
}

async function handleBucketChange(event) {
  const selectedBucket = String(event.target?.value || '').trim();
  if (!selectedBucket || selectedBucket === state.r2Config.bucket) {
    return;
  }

  setBucketLoadingState(true, '正在切换存储桶配置...');
  try {
    const result = await electronAPI.setCurrentBucket(selectedBucket);
    if (!result.success) {
      showNotification(result.error?.userMessage || UI_TEXT.bucketSwitchFailed || '切换存储桶失败', 'error');
      return;
    }
    applySyncedBucketState(result.data);
    showNotification((UI_TEXT.bucketSwitchSuccess || '已切换到存储桶: {bucket}').replace('{bucket}', selectedBucket), 'success');
  } catch (error) {
    console.error('切换存储桶失败:', error);
    showNotification(error.userMessage || UI_TEXT.bucketSwitchFailed || '切换存储桶失败', 'error');
  }
}

async function handleRefreshBuckets() {
  await loadBucketState({ loadingText: '正在刷新远端存储桶配置...' });
}

async function handleCreateBucket() {
  const name = getInputValue(elements.newBucketName).toLowerCase();
  const locationHint = getInputValue(elements.newBucketLocationHint);
  const storageClass = getInputValue(elements.newBucketStorageClass, 'Standard') || 'Standard';

  if (!name) {
    showNotification(UI_TEXT.bucketRequired || '请填写桶名', 'error');
    return;
  }

  setBucketLoadingState(true, '正在创建远端存储桶...');
  const result = await electronAPI.createBucket({
    ...getSettingsPayload(),
    name,
    locationHint,
    storageClass
  });

  if (!result.success) {
    showNotification(result.error?.userMessage || '创建存储桶失败', 'error');
    return;
  }

  if (elements.newBucketName) elements.newBucketName.value = '';
  showNotification(`Bucket "${name}" created`, 'success');
  await loadBucketState({ bucket: name, loadingText: '正在同步新建存储桶配置...' });
}

async function handleUpdateBucket() {
  const bucketName = state.r2Config.bucket;
  const storageClass = getInputValue(elements.editBucketStorageClass, 'Standard') || 'Standard';
  if (!bucketName) {
    showNotification(UI_TEXT.bucketRequired || '请填写桶名', 'error');
    return;
  }

  setBucketLoadingState(true, '正在更新远端存储桶配置...');
  const result = await electronAPI.updateBucket({
    ...getSettingsPayload(),
    bucketName,
    storageClass
  });

  if (!result.success) {
    showNotification(result.error?.userMessage || '更新存储桶失败', 'error');
    return;
  }

  showNotification(`Bucket "${bucketName}" updated to ${storageClass}`, 'success');
  await loadBucketState({ bucket: bucketName, loadingText: '正在同步存储桶最新配置...' });
}

async function handleDeleteBucket() {
  const bucketName = state.r2Config.bucket;
  if (!bucketName) {
    showNotification(UI_TEXT.bucketRequired || '请填写桶名', 'error');
    return;
  }

  const confirmed = await electronAPI.confirm(
    `Delete bucket "${bucketName}"? Objects in this bucket will be deleted first. This action cannot be undone.`
  );
  if (!confirmed) return;

  setBucketLoadingState(true, '正在删除远端存储桶...');
  const result = await electronAPI.deleteBucket({
    ...getSettingsPayload(),
    bucketName,
    accessKeyId: getInputValue(elements.accessKeyId),
    secretAccessKey: getInputValue(elements.secretAccessKey)
  });

  if (!result.success) {
    showNotification(result.error?.userMessage || '删除存储桶失败', 'error');
    return;
  }

  const deletedObjects = Number(result.data?.deletedObjects || 0);
  showNotification(`Bucket "${bucketName}" deleted. Cleared ${deletedObjects} objects.`, 'success');
  resetCustomDomainForm();
  await loadBucketState({ loadingText: '正在同步删除后的存储桶列表...' });
}

async function handleUpdateManagedDomain() {
  if (!state.r2Config.bucket) {
    showNotification(UI_TEXT.bucketRequired || '请填写桶名', 'error');
    return;
  }

  setBucketLoadingState(true, '正在同步 r2.dev 配置...');
  const result = await electronAPI.updateManagedDomain({
    ...getSettingsPayload(),
    bucketName: state.r2Config.bucket,
    enabled: Boolean(elements.managedDomainEnabled?.checked)
  });

  if (!result.success) {
    showNotification(result.error?.userMessage || '更新 r2.dev 配置失败', 'error');
    return;
  }

  state.managedDomain = result.data;
  if (elements.managedDomainUrl) {
    elements.managedDomainUrl.value = state.managedDomain?.url || state.managedDomain?.domain || '';
  }
  showNotification('r2.dev 状态已更新', 'success');
  await loadBucketState({ bucket: state.r2Config.bucket, loadingText: '正在同步 r2.dev 最新配置...' });
}

async function handleCreateCustomDomain() {
  if (!state.r2Config.bucket) {
    showNotification(UI_TEXT.bucketRequired || '请先选择存储桶', 'error');
    return;
  }

  setBucketLoadingState(true, '正在绑定自定义域名...');
  const result = await electronAPI.createCustomDomain(buildCustomDomainPayload());
  if (!result.success) {
    showNotification(result.error?.userMessage || '绑定自定义域名失败', 'error');
    return;
  }

  showNotification('自定义域名绑定成功', 'success');
  await loadBucketState({ bucket: state.r2Config.bucket, loadingText: '正在同步自定义域名配置...' });
  selectCustomDomain(result.data?.domain || getInputValue(elements.customDomain));
}

async function handleUpdateCustomDomain() {
  if (!state.selectedDomain) {
    showNotification('请先从列表中选择要更新的域名。', 'warning');
    return;
  }

  setBucketLoadingState(true, '正在更新自定义域名配置...');
  const result = await electronAPI.updateCustomDomain({
    ...buildCustomDomainPayload(),
    currentDomain: state.selectedDomain
  });
  if (!result.success) {
    showNotification(result.error?.userMessage || '更新自定义域名失败', 'error');
    return;
  }

  showNotification('自定义域名已更新', 'success');
  await loadBucketState({ bucket: state.r2Config.bucket, loadingText: '正在同步自定义域名最新配置...' });
  selectCustomDomain(result.data?.domain || getInputValue(elements.customDomain));
}

async function handleDeleteCustomDomain() {
  const domain = state.selectedDomain || getInputValue(elements.customDomain);
  if (!domain) {
    showNotification('请先选择要解绑的域名。', 'warning');
    return;
  }

  const confirmed = await electronAPI.confirm(`确定要解绑域名 "${domain}" 吗？`);
  if (!confirmed) return;

  setBucketLoadingState(true, '正在解绑自定义域名...');
  const result = await electronAPI.deleteCustomDomain({
    ...getSettingsPayload(),
    bucketName: state.r2Config.bucket,
    domain
  });
  if (!result.success) {
    showNotification(result.error?.userMessage || '删除自定义域名失败', 'error');
    return;
  }

  showNotification('自定义域名已解绑', 'success');
  resetCustomDomainForm();
  await loadBucketState({ bucket: state.r2Config.bucket, loadingText: '正在同步自定义域名列表...' });
}

function bindEvents() {
  elements.tabNavItems.forEach(item => {
    item.addEventListener('click', () => handleTabClick(item));
  });

  if (elements.cloudflareAccountId) elements.cloudflareAccountId.addEventListener('input', handleCredentialInput);
  if (elements.cloudflareApiToken) elements.cloudflareApiToken.addEventListener('input', handleCredentialInput);
  if (elements.accessKeyId) elements.accessKeyId.addEventListener('input', handleCredentialInput);
  if (elements.secretAccessKey) elements.secretAccessKey.addEventListener('input', handleCredentialInput);
  if (elements.cloudflareJurisdiction) {
    elements.cloudflareJurisdiction.addEventListener('change', () => {
      handleCredentialInput();
      handleR2ConfigInput();
    });
  }
  if (elements.btnToggleSecret) elements.btnToggleSecret.addEventListener('click', toggleSecretVisibility);
  if (elements.btnTestConnection) elements.btnTestConnection.addEventListener('click', handleTestConnection);
  if (elements.btnClearCredentials) elements.btnClearCredentials.addEventListener('click', handleClearCredentials);
  if (elements.bucketSelect) elements.bucketSelect.addEventListener('change', handleBucketChange);
  if (elements.btnRefreshBuckets) elements.btnRefreshBuckets.addEventListener('click', handleRefreshBuckets);
  if (elements.btnCreateBucket) elements.btnCreateBucket.addEventListener('click', handleCreateBucket);
  if (elements.btnUpdateBucket) elements.btnUpdateBucket.addEventListener('click', handleUpdateBucket);
  if (elements.btnDeleteBucket) elements.btnDeleteBucket.addEventListener('click', handleDeleteBucket);
  if (elements.btnUpdateManagedDomain) elements.btnUpdateManagedDomain.addEventListener('click', handleUpdateManagedDomain);
  if (elements.btnCreateCustomDomain) elements.btnCreateCustomDomain.addEventListener('click', handleCreateCustomDomain);
  if (elements.btnUpdateCustomDomain) elements.btnUpdateCustomDomain.addEventListener('click', handleUpdateCustomDomain);
  if (elements.btnDeleteCustomDomain) elements.btnDeleteCustomDomain.addEventListener('click', handleDeleteCustomDomain);
  if (elements.btnResetCustomDomain) elements.btnResetCustomDomain.addEventListener('click', resetCustomDomainForm);
  if (elements.btnCancel) elements.btnCancel.addEventListener('click', handleCancel);
  if (elements.btnSave) elements.btnSave.addEventListener('click', handleSave);
}

/**
 * 加载设置页初始化数据。
 */
async function loadSettings() {
  try {
    const credResult = await electronAPI.getCredentials();
    if (credResult.success && credResult.data) {
      state.credentials = {
        accountId: credResult.data.accountId || '',
        apiToken: credResult.data.apiToken || '',
        accessKeyId: credResult.data.accessKeyId || '',
        secretAccessKey: credResult.data.secretAccessKey || '',
        jurisdiction: credResult.data.jurisdiction || 'default'
      };
      if (elements.cloudflareAccountId) elements.cloudflareAccountId.value = state.credentials.accountId;
      if (elements.cloudflareApiToken) elements.cloudflareApiToken.value = state.credentials.apiToken;
      if (elements.accessKeyId) elements.accessKeyId.value = state.credentials.accessKeyId;
      if (elements.secretAccessKey) elements.secretAccessKey.value = state.credentials.secretAccessKey;
      if (elements.cloudflareJurisdiction) elements.cloudflareJurisdiction.value = state.credentials.jurisdiction || 'default';
      updateDerivedEndpoint();
      updateCredentialStatus(Boolean(
        state.credentials.accountId &&
        state.credentials.apiToken &&
        state.credentials.accessKeyId &&
        state.credentials.secretAccessKey
      ));
    } else {
      updateCredentialStatus(false);
    }

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
    }

    if (!getInputValue(elements.cloudflareAccountId) && state.r2Config.cloudflareAccountId) {
      elements.cloudflareAccountId.value = state.r2Config.cloudflareAccountId;
      updateDerivedEndpoint();
    }
    if (!getInputValue(elements.cloudflareApiToken) && state.r2Config.cloudflareApiToken) {
      elements.cloudflareApiToken.value = state.r2Config.cloudflareApiToken;
    }
    if (elements.cloudflareJurisdiction && !getInputValue(elements.cloudflareJurisdiction)) {
      elements.cloudflareJurisdiction.value = state.r2Config.cloudflareJurisdiction || 'default';
    }

    await loadBucketState({ bucket: state.r2Config.bucket });
  } catch (error) {
    console.error('加载设置失败:', error);
    showNotification(UI_TEXT.credentialsLoadFailed || '加载设置失败', 'error');
  }
}

async function init() {
  applyI18nText();
  bindEvents();
  updateDerivedEndpoint();
  await loadSettings();
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
