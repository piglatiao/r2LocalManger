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
  listAvailableDomains: async (payload) => ipcRenderer.invoke('settings:listAvailableDomains', payload),
  getCacheSettings: async () => ipcRenderer.invoke('cache:getSettings'),
  saveCacheSettings: async (payload) => ipcRenderer.invoke('cache:saveSettings', payload),
  getCacheStats: async () => ipcRenderer.invoke('cache:stats'),
  clearCache: async () => ipcRenderer.invoke('cache:clear'),
  openCacheLocation: async () => ipcRenderer.invoke('cache:openLocation'),
  getAppLockStatus: async () => ipcRenderer.invoke('appLock:getStatus'),
  verifyAppLockPassword: async (password) => ipcRenderer.invoke('appLock:verify', password),
  setAppLockEnabled: async (payload) => ipcRenderer.invoke('appLock:setEnabled', payload),
  changeAppLockPassword: async (payload) => ipcRenderer.invoke('appLock:change', payload),
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
  thumbnailCacheEnabled: document.getElementById('thumbnail-cache-enabled'),
  thumbnailCacheLimit: document.getElementById('thumbnail-cache-limit'),
  objectListCacheEnabled: document.getElementById('object-list-cache-enabled'),
  cacheUsed: document.getElementById('cache-used'),
  cacheCount: document.getElementById('cache-count'),
  cacheListCount: document.getElementById('cache-list-count'),
  cacheDirectory: document.getElementById('cache-directory'),
  cacheProgressBar: document.getElementById('cache-progress-bar'),
  btnClearCache: document.getElementById('btn-clear-cache'),
  btnOpenCacheDir: document.getElementById('btn-open-cache-dir'),
  btnRefreshCacheStats: document.getElementById('btn-refresh-cache-stats'),
  appLockEnabled: document.getElementById('app-lock-enabled'),
  appLockCurrentPassword: document.getElementById('app-lock-current-password'),
  appLockNewPassword: document.getElementById('app-lock-settings-new-password'),
  appLockConfirmPassword: document.getElementById('app-lock-settings-confirm-password'),
  btnChangeAppLockPassword: document.getElementById('btn-app-lock-change'),
  credentialsLockPanel: document.getElementById('credentials-lock-panel'),
  credentialsUnprotectedHint: document.getElementById('credentials-unprotected-hint'),
  credentialsUnlockPassword: document.getElementById('credentials-unlock-password'),
  credentialsUnlockError: document.getElementById('credentials-unlock-error'),
  btnCredentialsUnlock: document.getElementById('btn-credentials-unlock'),
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
  availableDomains: [],
  bucketDetail: null,
  customDomains: [],
  managedDomain: null,
  selectedDomain: '',
  selectedZoneId: '',
  hasChanges: false,
  isTesting: false,
  isLoadingBuckets: false,
  isLoadingZones: false,
  cache: {
    enabled: true,
    maxSizeMB: 512,
    listEnabled: true,
    usedBytes: 0,
    count: 0,
    listCount: 0,
    listUsedBytes: 0,
    directory: ''
  },
  isClearingCache: false,
  appLock: {
    enabled: false,
    hasPassword: false
  },
  credentialsUnlocked: false
};

// 凭证未解锁时显示的掩码
const CREDENTIAL_MASK = '••••••••';

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
 * 根据域名查询当前账号下的 Zone 信息。
 * @param {string} domain - 域名
 * @returns {{id: string, name: string, status: string, accountId: string}|null}
 */
function findAvailableDomainByName(domain) {
  const normalizedDomain = String(domain || '').trim().toLowerCase();
  if (!normalizedDomain) {
    return null;
  }

  const matchedDomains = state.availableDomains.filter(item => {
    const zoneName = String(item?.name || '').trim().toLowerCase();
    if (!zoneName) {
      return false;
    }
    return normalizedDomain === zoneName || normalizedDomain.endsWith(`.${zoneName}`);
  });

  if (!matchedDomains.length) {
    return null;
  }

  return matchedDomains.sort((left, right) => String(right.name || '').length - String(left.name || '').length)[0] || null;
}

/**
 * 根据 Zone ID 查询可用域名信息。
 * @param {string} zoneId - Zone ID
 * @returns {{id: string, name: string, status: string, accountId: string}|null}
 */
function findAvailableDomainById(zoneId) {
  const normalizedZoneId = String(zoneId || '').trim();
  if (!normalizedZoneId) {
    return null;
  }

  return state.availableDomains.find(item => String(item?.id || '').trim() === normalizedZoneId) || null;
}

/**
 * 渲染可用域名下拉列表。
 * 选项值直接使用 Zone ID，避免页面中继续暴露手工填写 Zone ID 的流程。
 */
function renderAvailableDomains() {
  if (!elements.customDomainZoneId) {
    return;
  }

  elements.customDomainZoneId.innerHTML = '';

  const placeholderOption = document.createElement('option');
  placeholderOption.value = '';
  if (state.isLoadingZones) {
    placeholderOption.textContent = '正在加载可用域名...';
  } else if (state.availableDomains.length > 0) {
    placeholderOption.textContent = '请选择可用域名';
  } else {
    placeholderOption.textContent = '暂无可用域名';
  }
  elements.customDomainZoneId.appendChild(placeholderOption);

  state.availableDomains.forEach(item => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.name;
    option.dataset.domain = item.name;
    option.title = item.id;
    if (item.id === state.selectedZoneId) {
      option.selected = true;
    }
    elements.customDomainZoneId.appendChild(option);
  });

  if (state.selectedZoneId && !state.availableDomains.some(item => item.id === state.selectedZoneId)) {
    const fallbackOption = document.createElement('option');
    fallbackOption.value = state.selectedZoneId;
    fallbackOption.textContent = `当前已选 Zone ID: ${state.selectedZoneId}`;
    fallbackOption.selected = true;
    elements.customDomainZoneId.appendChild(fallbackOption);
  }

  elements.customDomainZoneId.disabled = state.isLoadingZones || (!state.availableDomains.length && !state.selectedZoneId);
}

/**
 * 根据当前域名输入自动匹配可用域名列表，并同步 Zone 选择。
 * @param {string} domain - 需要匹配的域名
 */
function syncZoneSelectionByDomain(domain) {
  const matchedZone = findAvailableDomainByName(domain);
  state.selectedZoneId = matchedZone?.id || '';
  if (elements.customDomainZoneId) {
    elements.customDomainZoneId.value = state.selectedZoneId;
  }
}

/**
 * 根据当前 Zone 选择同步域名输入。
 * 用于从下拉列表直接选域名时自动回填域名输入框。
 */
function syncDomainInputByZoneSelection() {
  const zoneId = getInputValue(elements.customDomainZoneId);
  state.selectedZoneId = zoneId;
  const matchedZone = state.availableDomains.find(item => item.id === zoneId) || null;
  if (matchedZone && elements.customDomain && !getInputValue(elements.customDomain)) {
    elements.customDomain.value = matchedZone.name;
  }
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
    const matchedZone = findAvailableDomainById(item.zoneId);

    const title = document.createElement('div');
    title.className = 'custom-domain-title';
    title.innerHTML = `
      <span>${item.domain}</span>
      <span class="status-pill ${item.enabled ? 'enabled' : 'disabled'}">${item.enabled ? '已启用' : '已停用'}</span>
    `;

    const meta = document.createElement('div');
    meta.className = 'custom-domain-meta';
    meta.innerHTML = `
      <div>所属域名: ${matchedZone?.name || '-'}</div>
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
    resetCustomDomainForm({ preserveZoneSelection: true });
    return;
  }

  if (elements.customDomain) elements.customDomain.value = current.domain || '';
  state.selectedZoneId = current.zoneId || '';
  if (elements.customDomainZoneId) elements.customDomainZoneId.value = state.selectedZoneId;
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
function resetCustomDomainForm(options = {}) {
  const { preserveZoneSelection = false } = options;
  state.selectedDomain = '';
  if (elements.customDomain) elements.customDomain.value = '';
  if (elements.customDomainMinTls) elements.customDomainMinTls.value = '';
  if (elements.customDomainEnabled) elements.customDomainEnabled.checked = true;
  if (elements.customDomainCiphers) elements.customDomainCiphers.value = '';
  if (!preserveZoneSelection) {
    state.selectedZoneId = '';
    if (elements.customDomainZoneId) elements.customDomainZoneId.value = '';
  }
  renderCustomDomains();
  renderAvailableDomains();
}

/**
 * 将远端同步结果写回设置页状态。
 * @param {Object} syncState - 同步结果
 */
function applySyncedBucketState(syncState) {
  const previousBucket = state.r2Config.bucket;
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

  if (previousBucket && previousBucket !== state.r2Config.bucket) {
    state.selectedDomain = '';
    state.selectedZoneId = '';
  }

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
  } else {
    resetCustomDomainForm({ preserveZoneSelection: true });
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
  // 未验证密码时输入框是掩码，不能回写到状态里
  if (isCredentialsLocked()) {
    return;
  }

  state.credentials.accountId = getInputValue(elements.cloudflareAccountId);
  state.credentials.apiToken = getInputValue(elements.cloudflareApiToken);
  state.credentials.accessKeyId = getInputValue(elements.accessKeyId);
  state.credentials.secretAccessKey = getInputValue(elements.secretAccessKey);
  state.credentials.jurisdiction = getInputValue(elements.cloudflareJurisdiction, 'default') || 'default';
  updateDerivedEndpoint();
  state.hasChanges = true;

  const accountChanged =
    state.credentials.accountId !== state.r2Config.cloudflareAccountId ||
    state.credentials.apiToken !== state.r2Config.cloudflareApiToken;
  if (accountChanged) {
    state.availableDomains = [];
    state.selectedZoneId = '';
    renderAvailableDomains();
  }

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
  if (isCredentialsLocked()) {
    showNotification('请先验证应用密码后再测试连接', 'error');
    return;
  }

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
  if (isCredentialsLocked()) {
    showNotification('请先验证应用密码后再清除凭证', 'error');
    return;
  }

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
  const domain = getInputValue(elements.customDomain);
  syncZoneSelectionByDomain(domain);

  return {
    ...getSettingsPayload(),
    bucketName: state.r2Config.bucket,
    domain,
    zoneId: state.selectedZoneId || getInputValue(elements.customDomainZoneId),
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

  const payload = buildCustomDomainPayload();
  if (!payload.domain) {
    showNotification('请先填写要绑定的完整域名。', 'warning');
    return;
  }
  if (!payload.zoneId) {
    showNotification('请选择当前账号下可用的域名，系统才能自动匹配 Zone。', 'warning');
    return;
  }

  setBucketLoadingState(true, '正在绑定自定义域名...');
  const result = await electronAPI.createCustomDomain(payload);
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

  const payload = buildCustomDomainPayload();
  if (!payload.domain) {
    showNotification('请先填写要更新的完整域名。', 'warning');
    return;
  }
  if (!payload.zoneId) {
    showNotification('请选择当前账号下可用的域名，系统才能自动匹配 Zone。', 'warning');
    return;
  }

  setBucketLoadingState(true, '正在更新自定义域名配置...');
  const result = await electronAPI.updateCustomDomain({
    ...payload,
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
  if (isCredentialsLocked()) {
    showNotification('请先验证应用密码后再保存凭证', 'error');
    return;
  }

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

/**
 * 处理自定义域名输入变化，自动匹配可用 Zone。
 */
function handleCustomDomainInput() {
  const domain = getInputValue(elements.customDomain);
  if (!domain) {
    state.selectedZoneId = '';
    if (elements.customDomainZoneId) {
      elements.customDomainZoneId.value = '';
    }
    return;
  }

  syncZoneSelectionByDomain(domain);
}

/**
 * 处理可用域名下拉切换。
 */
function handleCustomDomainZoneChange() {
  syncDomainInputByZoneSelection();
}

/**
 * 从远端加载当前账号下的可用域名列表。
 * @param {Object} options - 加载选项
 * @param {string} options.loadingText - 加载中的提示文案
 * @param {boolean} options.silent - 是否静默处理错误
 * @returns {Promise<boolean>} 是否成功
 */
async function loadAvailableDomains(options = {}) {
  const normalizedOptions = {
    loadingText: '正在加载可用域名...',
    silent: false,
    manageLoading: true,
    ...options
  };

  const accountId = getInputValue(elements.cloudflareAccountId);
  const apiToken = getInputValue(elements.cloudflareApiToken);
  if (!accountId || !apiToken) {
    state.availableDomains = [];
    renderAvailableDomains();
    return false;
  }
  if (state.isLoadingZones) {
    return false;
  }

  state.isLoadingZones = true;
  if (normalizedOptions.manageLoading) {
    setBucketLoadingState(true, normalizedOptions.loadingText);
  }
  renderAvailableDomains();

  try {
    const result = await electronAPI.listAvailableDomains({
      ...getSettingsPayload(),
      cloudflareAccountId: accountId,
      cloudflareApiToken: apiToken
    });

    if (!result.success) {
      throw new Error(result.error?.message || 'Load available domains failed');
    }

    state.availableDomains = Array.isArray(result.data) ? result.data : [];
    renderAvailableDomains();

    if (getInputValue(elements.customDomain)) {
      syncZoneSelectionByDomain(getInputValue(elements.customDomain));
    }

    if (elements.customDomainZoneId) {
      elements.customDomainZoneId.value = state.selectedZoneId || '';
    }

    return true;
  } catch (error) {
    state.availableDomains = [];
    renderAvailableDomains();
    if (!normalizedOptions.silent) {
      console.error('加载可用域名失败:', error);
      showNotification(error.userMessage || '加载可用域名失败，请检查 Cloudflare Zone 读取权限。', 'error');
    }
    return false;
  } finally {
    state.isLoadingZones = false;
    if (normalizedOptions.manageLoading) {
      setBucketLoadingState(false, normalizedOptions.loadingText);
    }
    renderAvailableDomains();
  }
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
    await loadAvailableDomains({
      loadingText: normalizedOptions.loadingText,
      silent: true,
      manageLoading: false
    });
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

  const payload = buildCustomDomainPayload();
  if (!payload.domain) {
    showNotification('请先填写要绑定的完整域名。', 'warning');
    return;
  }
  if (!payload.zoneId) {
    showNotification('请选择当前账号下可用的域名，系统才能自动匹配 Zone。', 'warning');
    return;
  }

  setBucketLoadingState(true, '正在绑定自定义域名...');
  const result = await electronAPI.createCustomDomain(payload);
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

  const payload = buildCustomDomainPayload();
  if (!payload.domain) {
    showNotification('请先填写要更新的完整域名。', 'warning');
    return;
  }
  if (!payload.zoneId) {
    showNotification('请选择当前账号下可用的域名，系统才能自动匹配 Zone。', 'warning');
    return;
  }

  setBucketLoadingState(true, '正在更新自定义域名配置...');
  const result = await electronAPI.updateCustomDomain({
    ...payload,
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

/**
 * 格式化字节数为可读文本。
 * @param {number} bytes - 字节数
 * @returns {string} 可读文本
 */
function formatCacheSize(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * 把缓存统计渲染到界面。
 * @param {Object} stats - 缓存统计
 */
function renderCacheStats(stats) {
  if (!stats) return;

  state.cache = {
    enabled: Boolean(stats.enabled),
    maxSizeMB: Number(stats.maxSizeMB) || 512,
    listEnabled: stats.listEnabled !== false,
    usedBytes: Number(stats.usedBytes) || 0,
    count: Number(stats.count) || 0,
    listCount: Number(stats.listCount) || 0,
    listUsedBytes: Number(stats.listUsedBytes) || 0,
    directory: String(stats.directory || '')
  };

  if (elements.thumbnailCacheEnabled) {
    elements.thumbnailCacheEnabled.checked = state.cache.enabled;
  }
  if (elements.objectListCacheEnabled) {
    elements.objectListCacheEnabled.checked = state.cache.listEnabled;
  }
  if (elements.thumbnailCacheLimit) {
    const limitValue = String(state.cache.maxSizeMB);
    const hasOption = Array.from(elements.thumbnailCacheLimit.options)
      .some(option => option.value === limitValue);
    if (hasOption) {
      elements.thumbnailCacheLimit.value = limitValue;
    }
  }
  if (elements.cacheUsed) {
    const maxBytes = state.cache.maxSizeMB * 1024 * 1024;
    elements.cacheUsed.textContent = `${formatCacheSize(state.cache.usedBytes)} / ${formatCacheSize(maxBytes)}`;
  }
  if (elements.cacheCount) {
    elements.cacheCount.textContent = `${state.cache.count} 个`;
  }
  if (elements.cacheListCount) {
    const listSize = state.cache.listUsedBytes > 0
      ? `（${formatCacheSize(state.cache.listUsedBytes)}）`
      : '';
    elements.cacheListCount.textContent = `${state.cache.listCount} 个${listSize}`;
  }
  if (elements.cacheDirectory) {
    elements.cacheDirectory.textContent = state.cache.directory || '-';
  }
  if (elements.cacheProgressBar) {
    const maxBytes = state.cache.maxSizeMB * 1024 * 1024;
    const ratio = maxBytes > 0 ? Math.min(1, state.cache.usedBytes / maxBytes) : 0;
    elements.cacheProgressBar.style.width = `${(ratio * 100).toFixed(1)}%`;
    elements.cacheProgressBar.classList.toggle('near-limit', ratio >= 0.75 && ratio < 1);
    elements.cacheProgressBar.classList.toggle('over-limit', ratio >= 1);
  }
}

/**
 * 读取缓存设置与占用情况。
 * @param {Object} options - 选项
 * @param {boolean} options.silent - 是否静默处理错误
 * @returns {Promise<void>}
 */
async function loadCacheStats(options = {}) {
  try {
    const result = await electronAPI.getCacheStats();
    if (!result.success) {
      throw new Error(result.error?.message || 'Load cache stats failed');
    }
    renderCacheStats(result.data);
  } catch (error) {
    if (!options.silent) {
      console.error('读取缓存状态失败:', error);
      showNotification('读取缓存状态失败', 'error');
    }
  }
}

/**
 * 保存缓存设置并立即生效。
 * @param {{enabled?: boolean, maxSizeMB?: number}} payload - 待保存配置
 * @returns {Promise<boolean>} 是否保存成功
 */
async function saveCacheSettings(payload) {
  try {
    const result = await electronAPI.saveCacheSettings(payload);
    if (!result.success) {
      throw new Error(result.error?.message || 'Save cache settings failed');
    }
    renderCacheStats(result.data);
    return true;
  } catch (error) {
    console.error('保存缓存设置失败:', error);
    showNotification('保存缓存设置失败', 'error');
    return false;
  }
}

/**
 * 切换缩略图缓存开关。
 */
async function handleCacheEnabledChange() {
  const enabled = Boolean(elements.thumbnailCacheEnabled?.checked);
  const ok = await saveCacheSettings({
    enabled,
    maxSizeMB: state.cache.maxSizeMB,
    listEnabled: state.cache.listEnabled
  });
  if (ok) {
    showNotification(enabled ? '已启用缩略图缓存' : '已停用缩略图缓存', 'success');
  }
}

/**
 * 切换对象列表缓存开关。
 */
async function handleListCacheEnabledChange() {
  const listEnabled = Boolean(elements.objectListCacheEnabled?.checked);
  const ok = await saveCacheSettings({
    enabled: state.cache.enabled,
    maxSizeMB: state.cache.maxSizeMB,
    listEnabled
  });
  if (ok) {
    showNotification(listEnabled ? '已启用文件列表缓存' : '已停用文件列表缓存', 'success');
  }
}

/**
 * 修改缓存大小上限。
 */
async function handleCacheLimitChange() {
  const maxSizeMB = Number(elements.thumbnailCacheLimit?.value) || state.cache.maxSizeMB;
  const ok = await saveCacheSettings({
    enabled: state.cache.enabled,
    maxSizeMB,
    listEnabled: state.cache.listEnabled
  });
  if (ok) {
    showNotification(`缓存上限已设为 ${maxSizeMB >= 1024 ? `${maxSizeMB / 1024} GB` : `${maxSizeMB} MB`}`, 'success');
  }
}

/**
 * 清理全部缩略图缓存。
 */
async function handleClearCache() {
  if (state.isClearingCache) return;

  const confirmed = await electronAPI.confirm(
    '确定要清理全部本地缓存（缩略图 + 文件列表）吗？清理后重新浏览时会再次从远端加载。'
  );
  if (!confirmed) return;

  state.isClearingCache = true;
  if (elements.btnClearCache) {
    elements.btnClearCache.disabled = true;
  }

  try {
    const result = await electronAPI.clearCache();
    if (!result.success) {
      throw new Error(result.error?.message || 'Clear cache failed');
    }

    const freedBytes = Number(result.data?.freedBytes || 0) + Number(result.data?.listFreedBytes || 0);
    await loadCacheStats({ silent: true });
    showNotification(
      `缓存已清理${freedBytes > 0 ? `，释放 ${formatCacheSize(freedBytes)}` : ''}`,
      'success'
    );
  } catch (error) {
    console.error('清理缓存失败:', error);
    showNotification('清理缓存失败', 'error');
  } finally {
    state.isClearingCache = false;
    if (elements.btnClearCache) {
      elements.btnClearCache.disabled = false;
    }
  }
}

/**
 * 凭证是否需要先验证应用密码才能查看。
 * @returns {boolean} 是否处于锁定状态
 */
function isCredentialsLocked() {
  return Boolean(state.appLock.enabled && state.appLock.hasPassword && !state.credentialsUnlocked);
}

/**
 * 把凭证值写入输入框。
 * @param {Object} values - 凭证值
 */
function fillCredentialInputs(values) {
  if (elements.cloudflareAccountId) elements.cloudflareAccountId.value = values.accountId || '';
  if (elements.cloudflareApiToken) elements.cloudflareApiToken.value = values.apiToken || '';
  if (elements.accessKeyId) elements.accessKeyId.value = values.accessKeyId || '';
  if (elements.secretAccessKey) elements.secretAccessKey.value = values.secretAccessKey || '';
}

/**
 * 按解锁状态渲染凭证区：未解锁时显示掩码并禁用输入。
 */
function applyCredentialVisibility() {
  const locked = isCredentialsLocked();

  [elements.cloudflareAccountId, elements.cloudflareApiToken, elements.accessKeyId, elements.secretAccessKey]
    .forEach((input) => {
      if (input) input.disabled = locked;
    });

  fillCredentialInputs(locked
    ? {
      accountId: CREDENTIAL_MASK,
      apiToken: CREDENTIAL_MASK,
      accessKeyId: CREDENTIAL_MASK,
      secretAccessKey: CREDENTIAL_MASK
    }
    : state.credentials);

  if (elements.credentialsLockPanel) {
    elements.credentialsLockPanel.style.display = locked ? 'flex' : 'none';
  }

  // 未启用密码锁时给出提示，但不阻断配置（首次配置凭证时本来就没有密码）
  if (elements.credentialsUnprotectedHint) {
    const showHint = !locked && !state.appLock.enabled;
    elements.credentialsUnprotectedHint.style.display = showHint ? 'flex' : 'none';
  }
}

/**
 * 验证应用密码后查看凭证。
 */
async function handleCredentialsUnlock() {
  const password = String(elements.credentialsUnlockPassword?.value || '');
  if (!password) {
    if (elements.credentialsUnlockError) {
      elements.credentialsUnlockError.textContent = '请输入应用密码';
      elements.credentialsUnlockError.style.display = 'block';
    }
    return;
  }

  if (elements.btnCredentialsUnlock) {
    elements.btnCredentialsUnlock.disabled = true;
  }

  try {
    const result = await electronAPI.verifyAppLockPassword(password);
    if (!result.success) {
      if (elements.credentialsUnlockError) {
        elements.credentialsUnlockError.textContent = result.error?.userMessage || '密码错误';
        elements.credentialsUnlockError.style.display = 'block';
      }
      return;
    }

    state.credentialsUnlocked = true;
    if (elements.credentialsUnlockError) {
      elements.credentialsUnlockError.style.display = 'none';
    }
    if (elements.credentialsUnlockPassword) {
      elements.credentialsUnlockPassword.value = '';
    }
    applyCredentialVisibility();
    showNotification('已验证，可以查看凭证', 'success');
  } catch (error) {
    console.error('验证应用密码失败:', error);
    showNotification('验证应用密码失败', 'error');
  } finally {
    if (elements.btnCredentialsUnlock) {
      elements.btnCredentialsUnlock.disabled = false;
    }
  }
}

/**
 * 渲染密码锁状态。
 * @param {Object} lockStatus - 密码锁状态
 */
function renderAppLockStatus(lockStatus) {
  if (!lockStatus) return;

  state.appLock = {
    enabled: Boolean(lockStatus.enabled),
    hasPassword: Boolean(lockStatus.hasPassword)
  };

  if (elements.appLockEnabled) {
    elements.appLockEnabled.checked = state.appLock.enabled;
  }
}

/**
 * 读取密码锁状态。
 */
async function loadAppLockStatus() {
  try {
    const result = await electronAPI.getAppLockStatus();
    if (result.success) {
      renderAppLockStatus(result.data);
    }
  } catch (error) {
    console.warn('读取密码锁状态失败:', error);
  }
}

/**
 * 启用 / 关闭密码锁。
 */
async function handleAppLockToggle() {
  const enabled = Boolean(elements.appLockEnabled?.checked);
  const password = getInputValue(elements.appLockCurrentPassword);
  const newPassword = getInputValue(elements.appLockNewPassword);
  const confirmPassword = getInputValue(elements.appLockConfirmPassword);

  if (enabled) {
    if (!newPassword) {
      showNotification('启用密码锁请先填写新密码', 'error');
      if (elements.appLockEnabled) elements.appLockEnabled.checked = false;
      return;
    }
    if (newPassword !== confirmPassword) {
      showNotification('两次输入的新密码不一致', 'error');
      if (elements.appLockEnabled) elements.appLockEnabled.checked = false;
      return;
    }
  } else if (!password) {
    showNotification('关闭密码锁需要填写当前密码', 'error');
    if (elements.appLockEnabled) elements.appLockEnabled.checked = true;
    return;
  }

  try {
    const result = await electronAPI.setAppLockEnabled({
      enabled,
      password: enabled ? newPassword : password
    });

    if (!result.success) {
      showNotification(result.error?.userMessage || '更新密码锁状态失败', 'error');
      await loadAppLockStatus();
      return;
    }

    renderAppLockStatus(result.data);
    clearAppLockPasswordInputs();
    showNotification(enabled ? '已启用应用密码锁' : '已关闭应用密码锁', 'success');
  } catch (error) {
    console.error('更新密码锁状态失败:', error);
    await loadAppLockStatus();
    showNotification('更新密码锁状态失败', 'error');
  }
}

/**
 * 修改密码。
 */
async function handleChangeAppLockPassword() {
  const currentPassword = getInputValue(elements.appLockCurrentPassword);
  const newPassword = getInputValue(elements.appLockNewPassword);
  const confirmPassword = getInputValue(elements.appLockConfirmPassword);

  if (!currentPassword || !newPassword) {
    showNotification('请填写当前密码与新密码', 'error');
    return;
  }
  if (newPassword !== confirmPassword) {
    showNotification('两次输入的新密码不一致', 'error');
    return;
  }

  try {
    const result = await electronAPI.changeAppLockPassword({ currentPassword, newPassword });
    if (!result.success) {
      showNotification(result.error?.userMessage || '修改密码失败', 'error');
      return;
    }

    renderAppLockStatus(result.data);
    clearAppLockPasswordInputs();
    showNotification('密码已修改，本地缓存已清空重建', 'success');
  } catch (error) {
    console.error('修改密码失败:', error);
    showNotification('修改密码失败', 'error');
  }
}

/**
 * 清空密码输入框。
 */
function clearAppLockPasswordInputs() {
  [elements.appLockCurrentPassword, elements.appLockNewPassword, elements.appLockConfirmPassword]
    .forEach((input) => {
      if (input) input.value = '';
    });
}

/**
 * 打开缓存目录。
 */
async function handleOpenCacheDir() {
  try {
    const result = await electronAPI.openCacheLocation();
    if (!result.success) {
      showNotification('打开缓存目录失败', 'error');
    }
  } catch (error) {
    console.error('打开缓存目录失败:', error);
    showNotification('打开缓存目录失败', 'error');
  }
}

function bindEvents() {
  elements.tabNavItems.forEach(item => {
    item.addEventListener('click', () => handleTabClick(item));
  });

  if (elements.thumbnailCacheEnabled) {
    elements.thumbnailCacheEnabled.addEventListener('change', handleCacheEnabledChange);
  }
  if (elements.objectListCacheEnabled) {
    elements.objectListCacheEnabled.addEventListener('change', handleListCacheEnabledChange);
  }
  if (elements.thumbnailCacheLimit) {
    elements.thumbnailCacheLimit.addEventListener('change', handleCacheLimitChange);
  }
  if (elements.btnCredentialsUnlock) {
    elements.btnCredentialsUnlock.addEventListener('click', handleCredentialsUnlock);
  }
  if (elements.credentialsUnlockPassword) {
    elements.credentialsUnlockPassword.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleCredentialsUnlock();
      }
    });
  }
  if (elements.appLockEnabled) elements.appLockEnabled.addEventListener('change', handleAppLockToggle);
  if (elements.btnChangeAppLockPassword) {
    elements.btnChangeAppLockPassword.addEventListener('click', handleChangeAppLockPassword);
  }
  if (elements.btnClearCache) elements.btnClearCache.addEventListener('click', handleClearCache);
  if (elements.btnOpenCacheDir) elements.btnOpenCacheDir.addEventListener('click', handleOpenCacheDir);
  if (elements.btnRefreshCacheStats) {
    elements.btnRefreshCacheStats.addEventListener('click', () => loadCacheStats());
  }

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
  if (elements.customDomain) elements.customDomain.addEventListener('change', handleCustomDomainInput);
  if (elements.customDomainZoneId) elements.customDomainZoneId.addEventListener('change', handleCustomDomainZoneChange);
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
    // 先拿密码锁状态，凭证区据此决定是否要遮罩
    await loadAppLockStatus();

    const credResult = await electronAPI.getCredentials();
    if (credResult.success && credResult.data) {
      state.credentials = {
        accountId: credResult.data.accountId || '',
        apiToken: credResult.data.apiToken || '',
        accessKeyId: credResult.data.accessKeyId || '',
        secretAccessKey: credResult.data.secretAccessKey || '',
        jurisdiction: credResult.data.jurisdiction || 'default'
      };
      if (elements.cloudflareJurisdiction) elements.cloudflareJurisdiction.value = state.credentials.jurisdiction || 'default';
      updateCredentialStatus(Boolean(
        state.credentials.accountId &&
        state.credentials.apiToken &&
        state.credentials.accessKeyId &&
        state.credentials.secretAccessKey
      ));
    } else {
      updateCredentialStatus(false);
    }

    // 未验证密码时只填掩码
    applyCredentialVisibility();

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

    if (!isCredentialsLocked()) {
      if (!getInputValue(elements.cloudflareAccountId) && state.r2Config.cloudflareAccountId) {
        elements.cloudflareAccountId.value = state.r2Config.cloudflareAccountId;
      }
      if (!getInputValue(elements.cloudflareApiToken) && state.r2Config.cloudflareApiToken) {
        elements.cloudflareApiToken.value = state.r2Config.cloudflareApiToken;
      }
      updateDerivedEndpoint();
    }
    if (elements.cloudflareJurisdiction && !getInputValue(elements.cloudflareJurisdiction)) {
      elements.cloudflareJurisdiction.value = state.r2Config.cloudflareJurisdiction || 'default';
    }

    renderAvailableDomains();
    await loadBucketState({ bucket: state.r2Config.bucket });
    await loadCacheStats({ silent: true });
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
