// 加载环境变量
require('dotenv').config();

const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const fs = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');

// Import i18n UI text strings
const { UI_TEXT } = require('../../i18n/zh-CN');

// Import application services
const { CredentialManager } = require('./application/CredentialManager');
const { R2Client, ErrorType } = require('./infrastructure/R2Client');
const { StorageService, URLFormat } = require('./application/StorageService');
const { ClipboardManager } = require('./infrastructure/ClipboardManager');
const { ErrorLogger } = require('./application/ErrorLogger');
const { ErrorHandler, ErrorAction } = require('./infrastructure/ErrorHandler');

let mainWindow;
let storageService;
let previewWindow = null;

// 导出配置函数供其他模块使用
module.exports = {};

const DEFAULT_R2_ENDPOINT = 'https://12b1178bf0856d6e0b7d787ebd43cee5.r2.cloudflarestorage.com';
const DEFAULT_R2_REGION = 'auto';
const DEFAULT_R2_BUCKET = 'picture';
const DEFAULT_R2_PUBLIC_URL = '';
const DEFAULT_CF_ACCOUNT_ID = '';
const DEFAULT_CF_API_TOKEN = '';
const DEFAULT_CF_R2_JURISDICTION = 'default';
const STARTUP_CHECK_TIMEOUT_MS = 10000;

const StartupCheckStatus = {
  OK: 'OK',
  MISSING_CREDENTIALS: 'MISSING_CREDENTIALS',
  INVALID_SETTINGS: 'INVALID_SETTINGS',
  CONNECTION_FAILED: 'CONNECTION_FAILED'
};

let lastStartupCheckResult = {
  ok: true,
  status: StartupCheckStatus.OK
};

function getStartupCheckMessage(status) {
  if (status === StartupCheckStatus.MISSING_CREDENTIALS) {
    return UI_TEXT.startupCheckMessageMissingCredentials || '启动检查发现未配置凭证，请先完成配置。';
  }

  if (status === StartupCheckStatus.INVALID_SETTINGS) {
    return UI_TEXT.startupCheckMessageInvalidSettings || '启动检查发现 R2 配置无效，请检查 S3 地址、区域、桶名等设置。';
  }

  return UI_TEXT.startupCheckMessageConnectionFailed || '启动检查失败：无法连接到 R2，请检查连接或配置。';
}

/**
 * 标准化 URL（自动补全 https://，并去掉末尾 /）
 * @param {string} rawUrl - 原始 URL
 * @param {Object} options - 选项
 * @param {boolean} options.allowEmpty - 是否允许空值
 * @returns {string} 标准化 URL
 */
function normalizeUrl(rawUrl, options = {}) {
  const { allowEmpty = false } = options;
  const rawValue = typeof rawUrl === 'string' ? rawUrl.trim() : '';

  if (!rawValue) {
    if (allowEmpty) {
      return '';
    }
    throw new Error('URL is required');
  }

  const withProtocol = /^https?:\/\//i.test(rawValue) ? rawValue : `https://${rawValue}`;
  const normalized = withProtocol.replace(/\/+$/, '');

  // Validate URL format
  new URL(normalized);

  return normalized;
}

/**
 * Guess Cloudflare account id from R2 endpoint hostname.
 * Example: https://<account_id>.r2.cloudflarestorage.com
 * @param {string} endpoint
 * @returns {string}
 */
function inferAccountIdFromEndpoint(endpoint) {
  try {
    const hostname = new URL(endpoint).hostname || '';
    const firstLabel = hostname.split('.')[0] || '';
    if (/^[a-z0-9]{16,64}$/i.test(firstLabel)) {
      return firstLabel;
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * Normalize Cloudflare jurisdiction header value.
 * @param {string} raw
 * @returns {'default'|'eu'|'fedramp'}
 */
function normalizeJurisdiction(raw) {
  const normalized = String(raw || DEFAULT_CF_R2_JURISDICTION).trim().toLowerCase();
  if (['default', 'eu', 'fedramp'].includes(normalized)) {
    return normalized;
  }
  return DEFAULT_CF_R2_JURISDICTION;
}

/**
 * 根据 Cloudflare Account ID 生成 R2 S3 兼容端点。
 * @param {string} accountId - Cloudflare 账户 ID
 * @param {string} fallbackEndpoint - 兼容旧配置时的回退端点
 * @returns {string} 标准化后的端点地址
 */
function buildR2Endpoint(accountId, fallbackEndpoint = DEFAULT_R2_ENDPOINT) {
  const normalizedAccountId = String(accountId || '').trim();
  if (normalizedAccountId) {
    return normalizeUrl(`https://${normalizedAccountId}.r2.cloudflarestorage.com`);
  }
  return normalizeUrl(fallbackEndpoint || DEFAULT_R2_ENDPOINT);
}

/**
 * 解密或解码本地安全存储中的字符串。
 * @param {string} encodedValue - Base64 编码后的安全值
 * @returns {string} 解码后的明文
 */
function decodeStoredSecretValue(encodedValue) {
  if (!encodedValue) {
    return '';
  }

  const { safeStorage } = require('electron');
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(encodedValue, 'base64'));
    } catch {
      // 兼容旧版本未加密、仅做 Base64 编码的值。
      return Buffer.from(encodedValue, 'base64').toString('utf8');
    }
  }

  return Buffer.from(encodedValue, 'base64').toString('utf8');
}

/**
 * 将敏感信息写入本地安全存储。
 * @param {Object} store - electron-store 实例
 * @param {string} key - 存储键
 * @param {string} value - 原始值
 * @param {boolean} encrypt - 是否启用系统加密
 */
function storeSecretValue(store, key, value, encrypt = true) {
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) {
    store.delete(key);
    return;
  }

  const { safeStorage } = require('electron');
  if (encrypt !== false && safeStorage.isEncryptionAvailable()) {
    store.set(key, safeStorage.encryptString(normalizedValue).toString('base64'));
    return;
  }

  store.set(key, Buffer.from(normalizedValue, 'utf8').toString('base64'));
}

/**
 * Build Cloudflare API auth config from settings/env.
 * @param {Object} settings
 * @returns {{accountId: string, apiToken: string, jurisdiction: string}}
 */
function resolveCloudflareApiConfig(settings = {}) {
  const accountId =
    String(
      settings.cloudflareAccountId ||
      process.env.CF_ACCOUNT_ID ||
      process.env.CLOUDFLARE_ACCOUNT_ID ||
      ''
    ).trim() || inferAccountIdFromEndpoint(settings.endpoint || '');

  const apiToken = String(
    settings.cloudflareApiToken ||
    process.env.CF_API_TOKEN ||
    process.env.CLOUDFLARE_API_TOKEN ||
    ''
  ).trim();

  const jurisdiction = normalizeJurisdiction(
    settings.cloudflareJurisdiction || process.env.CF_R2_JURISDICTION
  );

  return { accountId, apiToken, jurisdiction };
}

/**
 * 调用 Cloudflare 通用 REST API。
 * @param {Object} params
 * @param {string} params.method - 请求方法
 * @param {string} params.apiToken - Cloudflare API Token
 * @param {string} params.path - API 路径
 * @param {Object} [params.body] - JSON 请求体
 * @param {string} [params.jurisdiction] - R2 管辖区标识
 * @param {Object} [params.extraHeaders] - 额外请求头
 * @param {boolean} [params.requireAccountId] - 是否要求 accountId
 * @param {string} [params.accountId] - Cloudflare Account ID
 * @param {boolean} [params.includeAccountPath] - 是否自动拼接 /accounts/{accountId}
 * @param {boolean} [params.returnFullResponse] - 是否返回完整响应体
 * @returns {Promise<any>}
 */
async function callCloudflareApi(params) {
  const {
    method,
    apiToken,
    path: apiPath,
    body,
    jurisdiction = DEFAULT_CF_R2_JURISDICTION,
    extraHeaders = {},
    requireAccountId = false,
    accountId = '',
    includeAccountPath = false,
    returnFullResponse = false
  } = params;

  if (requireAccountId && !accountId) {
    const error = new Error('Cloudflare account id is required');
    error.userMessage = '缺少 Cloudflare Account ID，请在设置中填写后再试。';
    throw error;
  }

  if (!apiToken) {
    const error = new Error('Cloudflare API token is required');
    error.userMessage = '缺少 Cloudflare API Token，请在设置中填写后再试。';
    throw error;
  }

  if (typeof fetch !== 'function') {
    const error = new Error('Fetch API is unavailable');
    error.userMessage = '当前运行环境不支持 Cloudflare API 调用，请更新运行环境。';
    throw error;
  }

  const headers = {
    Authorization: `Bearer ${apiToken}`,
    ...extraHeaders
  };

  if (includeAccountPath && jurisdiction && jurisdiction !== 'default') {
    headers['cf-r2-jurisdiction'] = jurisdiction;
  }

  let payload = undefined;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const pathPrefix = includeAccountPath && accountId
    ? `/accounts/${encodeURIComponent(accountId)}`
    : '';
  const url = `https://api.cloudflare.com/client/v4${pathPrefix}${apiPath}`;
  const response = await fetch(url, {
    method,
    headers,
    body: payload
  });

  const responseText = await response.text();
  let data = null;
  try {
    data = responseText ? JSON.parse(responseText) : null;
  } catch {
    data = null;
  }

  if (!response.ok || (data && data.success === false)) {
    const firstError = Array.isArray(data?.errors) ? data.errors[0] : null;
    const detailMessage =
      firstError?.message ||
      firstError?.code ||
      data?.messages?.[0]?.message ||
      `HTTP ${response.status}`;

    const error = new Error(`Cloudflare R2 API failed: ${detailMessage}`);
    error.status = response.status;
    error.code = firstError?.code || response.status;
    if (response.status === 401 || response.status === 403) {
      error.userMessage = 'Cloudflare API Token 无权限或已失效，请检查 Token 权限配置。';
    } else {
      error.userMessage = `Cloudflare API 调用失败：${detailMessage}`;
    }
    throw error;
  }

  if (returnFullResponse) {
    return data;
  }

  return data?.result ?? data;
}

/**
 * 调用 Cloudflare R2 账户级管理 API。
 * @param {Object} params - 通用 Cloudflare API 参数
 * @returns {Promise<any>}
 */
async function callCloudflareR2Api(params) {
  return callCloudflareApi({
    ...params,
    requireAccountId: true,
    includeAccountPath: true
  });
}

/**
 * List buckets through Cloudflare management API.
 * @param {{accountId: string, apiToken: string, jurisdiction: string}} apiConfig
 * @returns {Promise<Array<{name: string, creationDate: string|null, locationHint?: string, storageClass?: string}>>}
 */
async function listBucketsViaCloudflareApi(apiConfig) {
  const result = await callCloudflareR2Api({
    method: 'GET',
    accountId: apiConfig.accountId,
    apiToken: apiConfig.apiToken,
    jurisdiction: apiConfig.jurisdiction,
    path: '/r2/buckets?per_page=1000'
  });

  const bucketsRaw = Array.isArray(result)
    ? result
    : Array.isArray(result?.buckets)
      ? result.buckets
      : [];

  return bucketsRaw
    .map(item => ({
      name: item?.name || '',
      creationDate: item?.creation_date || item?.creationDate || null,
      locationHint: item?.locationHint || item?.location || '',
      storageClass: item?.storageClass || item?.storage_class || ''
    }))
    .filter(item => item.name);
}

/**
 * 标准化可用域名（Zone）信息。
 * @param {Object} rawZone - Cloudflare API 返回的原始 zone 对象
 * @returns {{id: string, name: string, status: string, accountId: string}}
 */
function normalizeAvailableDomainInfo(rawZone = {}) {
  return {
    id: String(rawZone?.id || '').trim(),
    name: String(rawZone?.name || '').trim(),
    status: String(rawZone?.status || '').trim(),
    accountId: String(rawZone?.account?.id || rawZone?.account_id || '').trim()
  };
}

/**
 * 获取当前账号下可用于绑定的所有域名列表。
 * @param {{accountId: string, apiToken: string, jurisdiction: string}} apiConfig - Cloudflare API 配置
 * @returns {Promise<Array<{id: string, name: string, status: string, accountId: string}>>}
 */
async function listAvailableDomainsViaCloudflareApi(apiConfig) {
  const perPage = 50;
  const availableDomains = [];
  let page = 1;

  while (true) {
    const query = new URLSearchParams({
      page: String(page),
      per_page: String(perPage),
      order: 'name',
      direction: 'asc'
    });
    if (apiConfig.accountId) {
      query.set('account.id', apiConfig.accountId);
    }

    const response = await callCloudflareApi({
      method: 'GET',
      apiToken: apiConfig.apiToken,
      jurisdiction: apiConfig.jurisdiction,
      path: `/zones?${query.toString()}`,
      returnFullResponse: true
    });

    const responseBody = response && typeof response === 'object' && !Array.isArray(response)
      ? response
      : { result: [] };
    const zonesRaw = Array.isArray(responseBody?.result) ? responseBody.result : [];

    availableDomains.push(
      ...zonesRaw
        .map(item => normalizeAvailableDomainInfo(item))
        .filter(item => item.id && item.name)
    );

    const resultInfo = responseBody.result_info || {};
    const totalPages = Number(resultInfo.total_pages || 0);
    if ((totalPages > 0 && page >= totalPages) || zonesRaw.length < perPage) {
      break;
    }

    page += 1;
  }

  const normalizedAccountId = String(apiConfig.accountId || '').trim();
  return availableDomains
    .filter(item => !normalizedAccountId || !item.accountId || item.accountId === normalizedAccountId)
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * 校验桶名是否合法。
 * @param {string} bucketName - 存储桶名称
 * @returns {boolean} 是否合法
 */
function isValidBucketName(bucketName) {
  const normalizedBucketName = String(bucketName || '').trim();
  return normalizedBucketName.length >= 3 &&
    normalizedBucketName.length <= 64 &&
    /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(normalizedBucketName);
}

/**
 * 标准化桶详情对象。
 * @param {Object} rawBucket - Cloudflare API 返回的原始桶对象
 * @returns {{name: string, creationDate: string|null, locationHint: string, storageClass: string}}
 */
function normalizeBucketInfo(rawBucket = {}) {
  return {
    name: String(rawBucket?.name || '').trim(),
    creationDate: rawBucket?.creation_date || rawBucket?.creationDate || null,
    locationHint: String(rawBucket?.locationHint || rawBucket?.location || '').trim(),
    storageClass: String(rawBucket?.storageClass || rawBucket?.storage_class || '').trim()
  };
}

/**
 * 获取单个存储桶详情。
 * @param {{accountId: string, apiToken: string, jurisdiction: string}} apiConfig - Cloudflare API 配置
 * @param {string} bucketName - 存储桶名称
 * @returns {Promise<{name: string, creationDate: string|null, locationHint: string, storageClass: string}>}
 */
async function getBucketDetailsViaCloudflareApi(apiConfig, bucketName) {
  const result = await callCloudflareR2Api({
    method: 'GET',
    accountId: apiConfig.accountId,
    apiToken: apiConfig.apiToken,
    jurisdiction: apiConfig.jurisdiction,
    path: `/r2/buckets/${encodeURIComponent(bucketName)}`
  });

  return normalizeBucketInfo(result || {});
}

/**
 * 标准化自定义域名信息。
 * @param {Object} rawDomain - Cloudflare API 返回的原始域名对象
 * @returns {{domain: string, enabled: boolean, zoneId: string, minTLS: string, ciphers: string[], status: string}}
 */
function normalizeCustomDomainInfo(rawDomain = {}) {
  return {
    domain: String(rawDomain?.domain || rawDomain?.hostname || '').trim(),
    enabled: Boolean(rawDomain?.enabled),
    zoneId: String(rawDomain?.zoneId || rawDomain?.zone_id || '').trim(),
    minTLS: String(rawDomain?.minTLS || rawDomain?.min_tls || '').trim(),
    ciphers: Array.isArray(rawDomain?.ciphers) ? rawDomain.ciphers.filter(Boolean) : [],
    status: String(rawDomain?.status || '').trim()
  };
}

/**
 * 获取桶的自定义域名列表。
 * @param {{accountId: string, apiToken: string, jurisdiction: string}} apiConfig - Cloudflare API 配置
 * @param {string} bucketName - 存储桶名称
 * @returns {Promise<Array<{domain: string, enabled: boolean, zoneId: string, minTLS: string, ciphers: string[], status: string}>>}
 */
async function listCustomDomainsViaCloudflareApi(apiConfig, bucketName) {
  const result = await callCloudflareR2Api({
    method: 'GET',
    accountId: apiConfig.accountId,
    apiToken: apiConfig.apiToken,
    jurisdiction: apiConfig.jurisdiction,
    path: `/r2/buckets/${encodeURIComponent(bucketName)}/domains/custom`
  });

  const domainsRaw = Array.isArray(result)
    ? result
    : Array.isArray(result?.domains)
      ? result.domains
      : [];

  return domainsRaw
    .map(item => normalizeCustomDomainInfo(item))
    .filter(item => item.domain);
}

/**
 * 获取桶的 r2.dev 域名配置。
 * @param {{accountId: string, apiToken: string, jurisdiction: string}} apiConfig - Cloudflare API 配置
 * @param {string} bucketName - 存储桶名称
 * @returns {Promise<{enabled: boolean, domain: string, url: string}>}
 */
async function getManagedDomainViaCloudflareApi(apiConfig, bucketName) {
  const result = await callCloudflareR2Api({
    method: 'GET',
    accountId: apiConfig.accountId,
    apiToken: apiConfig.apiToken,
    jurisdiction: apiConfig.jurisdiction,
    path: `/r2/buckets/${encodeURIComponent(bucketName)}/domains/managed`
  });

  const domain = String(
    result?.domain ||
    result?.hostname ||
    result?.uri ||
    result?.url ||
    result?.publicUrl ||
    ''
  ).trim();

  return {
    enabled: Boolean(result?.enabled),
    domain,
    url: domain
  };
}

/**
 * 解析当前桶的公开访问地址。
 * @param {Object} params - 解析参数
 * @param {Array<{domain: string, enabled: boolean}>} params.customDomains - 自定义域名列表
 * @param {{enabled: boolean, domain: string, url: string}|null} params.managedDomain - r2.dev 配置
 * @param {string} params.endpoint - S3 端点地址
 * @returns {string} 当前桶的公开访问地址
 */
function resolveBucketPublicUrl(params = {}) {
  const { customDomains = [], managedDomain = null, endpoint = DEFAULT_R2_ENDPOINT } = params;

  const enabledCustomDomain = customDomains.find(item => item && item.enabled && item.domain);
  if (enabledCustomDomain) {
    try {
      return normalizeUrl(enabledCustomDomain.domain);
    } catch {
      // ignore invalid custom domain and continue fallback
    }
  }

  if (managedDomain && managedDomain.enabled) {
    const managedDomainUrl = managedDomain.url || managedDomain.domain || '';
    if (managedDomainUrl) {
      try {
        return normalizeUrl(managedDomainUrl);
      } catch {
        // ignore invalid managed domain and continue fallback
      }
    }
  }

  return normalizeUrl(endpoint);
}

/**
 * 更新当前运行时存储服务。
 * @param {Object} settings - 已保存的 R2 设置
 * @param {Object|null} credentialsOverride - 可选的凭证覆盖
 */
function refreshStorageServiceWithSettings(settings, credentialsOverride = null) {
  const credentials = credentialsOverride || resolveCredentials();
  if (!CredentialManager.validateCredentials(credentials) || !settings?.bucket) {
    storageService = null;
    lastStartupCheckResult = {
      ok: false,
      status: CredentialManager.validateCredentials(credentials)
        ? StartupCheckStatus.INVALID_SETTINGS
        : StartupCheckStatus.MISSING_CREDENTIALS
    };
    return;
  }

  initializeStorageService(credentials, settings);
}

/**
 * 从远端同步当前桶配置，并回写本地运行时设置。
 * @param {Object} input - 输入配置
 * @param {string} [input.bucket] - 指定要同步的桶名
 * @returns {Promise<{buckets: Array, currentBucket: string, bucketDetail: Object|null, customDomains: Array, managedDomain: Object|null, publicUrl: string, endpoint: string, region: string, cloudflareAccountId: string, cloudflareJurisdiction: string}>}
 */
async function syncCurrentBucketFromRemote(input = {}) {
  const baseSettings = resolveR2Settings(input, { requireBucket: false });
  const apiConfig = resolveCloudflareApiConfig(baseSettings);
  const buckets = await listBucketsViaCloudflareApi(apiConfig);

  let currentBucket = String(input.bucket || baseSettings.bucket || '').trim();
  if (!currentBucket || !buckets.some(item => item.name === currentBucket)) {
    currentBucket = buckets[0]?.name || '';
  }

  if (!currentBucket) {
    const savedSettings = saveR2Settings({
      ...baseSettings,
      bucket: '',
      publicUrl: ''
    });
    refreshStorageServiceWithSettings(savedSettings);
    return {
      ...savedSettings,
      buckets,
      currentBucket: '',
      bucketDetail: null,
      customDomains: [],
      managedDomain: null
    };
  }

  const bucketDetail = await getBucketDetailsViaCloudflareApi(apiConfig, currentBucket);
  const customDomains = await listCustomDomainsViaCloudflareApi(apiConfig, currentBucket);
  const managedDomain = await getManagedDomainViaCloudflareApi(apiConfig, currentBucket);
  const publicUrl = resolveBucketPublicUrl({
    customDomains,
    managedDomain,
    endpoint: baseSettings.endpoint
  });

  const savedSettings = saveR2Settings({
    ...baseSettings,
    bucket: currentBucket,
    publicUrl
  });
  refreshStorageServiceWithSettings(savedSettings);

  return {
    ...savedSettings,
    buckets,
    currentBucket,
    bucketDetail,
    customDomains,
    managedDomain
  };
}

/**
 * Delete all objects from a bucket via S3 API before bucket deletion.
 * @param {Object} params
 * @param {string} params.endpoint
 * @param {string} params.region
 * @param {string} params.bucket
 * @param {string} params.accessKeyId
 * @param {string} params.secretAccessKey
 * @returns {Promise<number>} deleted object count
 */
async function clearBucketObjectsViaS3(params) {
  const {
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey
  } = params;

  const {
    S3Client,
    ListObjectsV2Command,
    DeleteObjectsCommand
  } = require('@aws-sdk/client-s3');

  const client = new S3Client({
    endpoint,
    region,
    credentials: {
      accessKeyId,
      secretAccessKey
    }
  });

  let deletedCount = 0;
  let continuationToken = undefined;

  while (true) {
    const listResponse = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      ContinuationToken: continuationToken,
      MaxKeys: 1000
    }));

    const objects = Array.isArray(listResponse?.Contents) ? listResponse.Contents : [];
    const keys = objects.map(item => item?.Key).filter(Boolean);

    if (keys.length > 0) {
      const deleteResponse = await client.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: keys.map(key => ({ Key: key })),
          Quiet: true
        }
      }));

      const errors = Array.isArray(deleteResponse?.Errors) ? deleteResponse.Errors : [];
      if (errors.length > 0) {
        const firstError = errors[0];
        throw new Error(`Failed to clear bucket objects: ${firstError?.Code || ''} ${firstError?.Message || ''}`.trim());
      }

      deletedCount += keys.length;
    }

    if (!listResponse?.IsTruncated || !listResponse?.NextContinuationToken) {
      break;
    }
    continuationToken = listResponse.NextContinuationToken;
  }

  return deletedCount;
}

/**
 * 获取并标准化 R2 配置（endpoint/region/bucket/publicUrl）
 * 说明：
 * 1. endpoint 统一由 account id 自动生成
 * 2. publicUrl 由远端同步后回写到当前桶运行时配置
 * 3. 兼容旧版本中的 cfAccountId / cfApiToken / r2Endpoint 等字段
 * @returns {{endpoint: string, region: string, bucket: string, publicUrl: string, cloudflareAccountId: string, cloudflareApiToken: string, cloudflareJurisdiction: string}}
 */
function getR2Settings() {
  try {
    const Store = require('electron-store');
    const settingsStore = new Store({ name: 'settings' });
    const credentialsStore = new Store({ name: 'credentials' });

    const storedAccountId = settingsStore.get(
      'accountId',
      settingsStore.get(
        'cfAccountId',
        process.env.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || DEFAULT_CF_ACCOUNT_ID
      )
    );
    const endpointFallback = settingsStore.get('r2Endpoint', process.env.R2_ENDPOINT || DEFAULT_R2_ENDPOINT);
    const endpoint = buildR2Endpoint(storedAccountId, endpointFallback);

    const regionRaw = settingsStore.get('r2Region', process.env.R2_REGION || DEFAULT_R2_REGION);
    const bucketRaw = settingsStore.get('currentBucket', process.env.R2_BUCKET || DEFAULT_R2_BUCKET);
    const publicUrlRaw = settingsStore.get('r2PublicUrl', process.env.R2_PUBLIC_URL || DEFAULT_R2_PUBLIC_URL);
    const cfJurisdictionRaw = settingsStore.get(
      'cfR2Jurisdiction',
      settingsStore.get('jurisdiction', process.env.CF_R2_JURISDICTION || DEFAULT_CF_R2_JURISDICTION)
    );

    let publicUrl;
    try {
      publicUrl = normalizeUrl(publicUrlRaw, { allowEmpty: true });
    } catch {
      publicUrl = DEFAULT_R2_PUBLIC_URL;
    }

    let cloudflareApiToken = '';
    try {
      const storedApiToken = credentialsStore.get('apiToken');
      if (storedApiToken) {
        cloudflareApiToken = decodeStoredSecretValue(storedApiToken);
      }
    } catch {
      cloudflareApiToken = '';
    }

    if (!cloudflareApiToken) {
      cloudflareApiToken = String(
        settingsStore.get(
          'cfApiToken',
          process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || DEFAULT_CF_API_TOKEN
        ) || ''
      ).trim();
    }

    const region = String(regionRaw || DEFAULT_R2_REGION).trim() || DEFAULT_R2_REGION;
    const bucket = String(bucketRaw || DEFAULT_R2_BUCKET).trim() || DEFAULT_R2_BUCKET;
    const cloudflareAccountId = String(storedAccountId || '').trim() || inferAccountIdFromEndpoint(endpoint);
    const cloudflareJurisdiction = normalizeJurisdiction(cfJurisdictionRaw);

    return {
      endpoint,
      region,
      bucket,
      publicUrl,
      cloudflareAccountId,
      cloudflareApiToken,
      cloudflareJurisdiction
    };
  } catch {
    return {
      endpoint: DEFAULT_R2_ENDPOINT,
      region: DEFAULT_R2_REGION,
      bucket: DEFAULT_R2_BUCKET,
      publicUrl: DEFAULT_R2_PUBLIC_URL,
      cloudflareAccountId: DEFAULT_CF_ACCOUNT_ID,
      cloudflareApiToken: DEFAULT_CF_API_TOKEN,
      cloudflareJurisdiction: DEFAULT_CF_R2_JURISDICTION
    };
  }
}

/**
 * 合并并标准化 R2 配置。
 * @param {Object} input - 输入配置（可选）
 * @param {Object} options - 选项
 * @param {boolean} options.requireBucket - 是否要求 bucket 必填
 * @returns {{endpoint: string, region: string, bucket: string, publicUrl: string, cloudflareAccountId: string, cloudflareApiToken: string, cloudflareJurisdiction: string}}
 */
function resolveR2Settings(input = {}, options = {}) {
  const { requireBucket = true } = options;
  const base = getR2Settings();

  const merged = {
    region: typeof input.region === 'string' ? input.region : base.region,
    bucket: typeof input.bucket === 'string' ? input.bucket : base.bucket,
    publicUrl: typeof input.publicUrl === 'string' ? input.publicUrl : base.publicUrl,
    cloudflareAccountId:
      typeof input.cloudflareAccountId === 'string' ? input.cloudflareAccountId : base.cloudflareAccountId,
    cloudflareApiToken:
      typeof input.cloudflareApiToken === 'string' ? input.cloudflareApiToken : base.cloudflareApiToken,
    cloudflareJurisdiction:
      typeof input.cloudflareJurisdiction === 'string' ? input.cloudflareJurisdiction : base.cloudflareJurisdiction
  };

  const cloudflareAccountId = String(merged.cloudflareAccountId || '').trim();
  const endpoint = buildR2Endpoint(cloudflareAccountId, base.endpoint);
  const region = String(merged.region || DEFAULT_R2_REGION).trim() || DEFAULT_R2_REGION;
  const bucket = String(merged.bucket || '').trim();
  if (requireBucket && !bucket) {
    throw new Error('Bucket name is required');
  }

  const publicUrl = normalizeUrl(merged.publicUrl, { allowEmpty: true });

  return {
    endpoint,
    region,
    bucket,
    publicUrl,
    cloudflareAccountId: cloudflareAccountId || inferAccountIdFromEndpoint(endpoint),
    cloudflareApiToken: String(merged.cloudflareApiToken || '').trim(),
    cloudflareJurisdiction: normalizeJurisdiction(merged.cloudflareJurisdiction)
  };
}

/**
 * 保存 R2 配置到本地设置。
 * 说明：
 * 1. 账号 ID、当前桶、运行时 publicUrl 存在 settings
 * 2. API Token 作为敏感信息保存在 credentials
 * @param {Object} input - 输入配置
 * @returns {{endpoint: string, region: string, bucket: string, publicUrl: string, cloudflareAccountId: string, cloudflareApiToken: string, cloudflareJurisdiction: string}} 已保存配置
 */
function saveR2Settings(input = {}) {
  const settings = resolveR2Settings(input, { requireBucket: false });
  const Store = require('electron-store');
  const settingsStore = new Store({ name: 'settings' });
  const credentialsStore = new Store({ name: 'credentials' });

  settingsStore.set('accountId', settings.cloudflareAccountId || '');
  settingsStore.set('r2Endpoint', settings.endpoint);
  settingsStore.set('r2Region', settings.region);
  settingsStore.set('currentBucket', settings.bucket || '');
  settingsStore.set('r2PublicUrl', settings.publicUrl);
  settingsStore.set('jurisdiction', settings.cloudflareJurisdiction || DEFAULT_CF_R2_JURISDICTION);
  settingsStore.set('cfR2Jurisdiction', settings.cloudflareJurisdiction || DEFAULT_CF_R2_JURISDICTION);
  settingsStore.set('cfAccountId', settings.cloudflareAccountId || '');

  // 兼容历史字段：清理明文 API Token 存储，统一迁移至安全存储。
  settingsStore.delete('cfApiToken');
  storeSecretValue(credentialsStore, 'apiToken', settings.cloudflareApiToken || '');

  return settings;
}

/**
 * 从本地安全存储读取凭证。
 * 说明：
 * 1. S3 密钥与 Cloudflare API Token 都存储在 credentials 仓库
 * 2. account id 与 jurisdiction 由 settings 管理，便于生成 endpoint
 * @returns {Object|null} 凭证对象或 null
 */
function loadStoredCredentials() {
  try {
    const Store = require('electron-store');
    const settingsStore = new Store({ name: 'settings' });
    const credentialsStore = new Store({ name: 'credentials' });

    const encryptedAccessKey = credentialsStore.get('accessKeyId');
    const encryptedSecretKey = credentialsStore.get('secretAccessKey');
    const encryptedApiToken = credentialsStore.get('apiToken');

    const accessKeyId = encryptedAccessKey ? decodeStoredSecretValue(encryptedAccessKey) : '';
    const secretAccessKey = encryptedSecretKey ? decodeStoredSecretValue(encryptedSecretKey) : '';
    const apiToken = encryptedApiToken ? decodeStoredSecretValue(encryptedApiToken) : '';
    const accountId = String(
      settingsStore.get(
        'accountId',
        settingsStore.get(
          'cfAccountId',
          process.env.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || DEFAULT_CF_ACCOUNT_ID
        )
      ) || ''
    ).trim();
    const jurisdiction = normalizeJurisdiction(
      settingsStore.get(
        'jurisdiction',
        settingsStore.get('cfR2Jurisdiction', process.env.CF_R2_JURISDICTION || DEFAULT_CF_R2_JURISDICTION)
      )
    );

    const s3Credentials = { accessKeyId, secretAccessKey };
    if (!CredentialManager.validateCredentials(s3Credentials)) {
      return null;
    }

    return {
      accessKeyId,
      secretAccessKey,
      apiToken,
      accountId,
      jurisdiction
    };
  } catch (error) {
    ErrorLogger.logError(error, 'credentials:loadStored');
    return null;
  }
}

/**
 * 解析当前可用凭证（优先本地保存，其次环境变量）。
 * @returns {Object|null} 凭证对象或 null
 */
function resolveCredentials() {
  const storedCredentials = loadStoredCredentials();
  if (storedCredentials) {
    return storedCredentials;
  }

  try {
    const envCredentials = CredentialManager.loadCredentials();
    if (!CredentialManager.validateCredentials(envCredentials)) {
      return null;
    }

    const r2Settings = getR2Settings();
    return {
      ...envCredentials,
      apiToken: String(r2Settings.cloudflareApiToken || '').trim(),
      accountId: String(r2Settings.cloudflareAccountId || '').trim(),
      jurisdiction: normalizeJurisdiction(r2Settings.cloudflareJurisdiction)
    };
  } catch {
    return null;
  }
}

/**
 * 创建 R2 配置对象
 * @param {Object} credentials - 凭证对象
 * @param {Object} r2SettingsInput - R2 配置（可选）
 * @returns {Object} R2 配置
 */
function buildR2Config(credentials, r2SettingsInput = {}) {
  const settings = resolveR2Settings(r2SettingsInput);

  return {
    endpoint: settings.endpoint,
    region: settings.region,
    bucket: settings.bucket,
    publicUrl: settings.publicUrl,
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey
  };
}

/**
 * 用当前凭证初始化存储服务
 * @param {Object} credentials - 凭证对象
 * @param {Object} r2SettingsInput - R2 配置（可选）
 */
function initializeStorageService(credentials, r2SettingsInput = {}) {
  const config = buildR2Config(credentials, r2SettingsInput);
  const r2Client = new R2Client(config);
  storageService = new StorageService(r2Client);
  lastStartupCheckResult = {
    ok: true,
    status: StartupCheckStatus.OK
  };
}

/**
 * 获取可用的存储服务实例，若未初始化则抛出认证错误
 * @param {string} operation - 当前操作类型
 * @returns {StorageService} 可用的存储服务实例
 */
function getStorageServiceOrThrow(operation) {
  if (storageService) {
    return storageService;
  }

  const error = new Error('Storage service is not initialized');
  error.errorType = ErrorType.AUTH;
  error.operation = operation || 'unknown';
  error.code = 'SERVICE_NOT_READY';
  throw error;
}

/**
 * Promise 超时包装
 * @param {number} timeoutMs - 超时时间（毫秒）
 * @returns {Promise<never>}
 */
function createTimeoutPromise(timeoutMs) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const timeoutError = new Error('Startup connection check timeout');
      timeoutError.code = 'STARTUP_TIMEOUT';
      reject(timeoutError);
    }, timeoutMs);
  });
}

/**
 * 启动健康检查：检查配置与连接可用性
 * @returns {Promise<{ok: boolean, status: string, error?: Error}>}
 */
async function runStartupHealthCheck() {
  const credentials = resolveCredentials();
  if (!CredentialManager.validateCredentials(credentials)) {
    // 未配置凭证时只提示去配置，不继续做连接检查。
    storageService = null;
    return {
      ok: false,
      status: StartupCheckStatus.MISSING_CREDENTIALS
    };
  }

  let r2Settings;
  try {
    r2Settings = resolveR2Settings();
  } catch (error) {
    storageService = null;
    ErrorLogger.logError(error, 'startup:resolveR2Settings');
    return {
      ok: false,
      status: StartupCheckStatus.INVALID_SETTINGS,
      error
    };
  }

  try {
    const config = buildR2Config(credentials, r2Settings);
    const r2Client = new R2Client(config);

    // 只有在检测到可用配置后，才继续做一次轻量连接探测。
    await Promise.race([
      r2Client.listObjects(),
      createTimeoutPromise(STARTUP_CHECK_TIMEOUT_MS)
    ]);

    storageService = new StorageService(r2Client);
    return {
      ok: true,
      status: StartupCheckStatus.OK
    };
  } catch (error) {
    storageService = null;
    ErrorLogger.logError(error, 'startup:connectivityCheck');
    return {
      ok: false,
      status: StartupCheckStatus.CONNECTION_FAILED,
      error
    };
  }
}

/**
 * 启动检查失败时提示用户检查配置
 * @param {{ok: boolean, status: string, error?: Error}} startupCheckResult - 启动检查结果
 */
async function promptStartupCheckFailure(startupCheckResult) {
  if (!mainWindow || startupCheckResult.ok) {
    return;
  }

  let message = getStartupCheckMessage(startupCheckResult.status);
  let detail = UI_TEXT.startupCheckDetail || '可点击“检查配置”打开设置页面。';

  if (startupCheckResult.status === StartupCheckStatus.MISSING_CREDENTIALS) {
    detail = UI_TEXT.errorAuthDetail || '请先在“设置 > 凭证配置”中填写 R2 凭证，或正确设置环境变量 R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY';
  } else if (startupCheckResult.status === StartupCheckStatus.INVALID_SETTINGS) {
    detail = startupCheckResult.error?.message || (UI_TEXT.startupCheckDetail || '可点击“检查配置”打开设置页面。');
  } else if (startupCheckResult.status === StartupCheckStatus.CONNECTION_FAILED) {
    const errorMessage = startupCheckResult.error?.message ? `\n${startupCheckResult.error.message}` : '';
    detail = `${UI_TEXT.startupCheckDetail || '可点击“检查配置”打开设置页面。'}${errorMessage}`;
  }

  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: UI_TEXT.mainWindowTitle || 'R2 存储管理器',
    message,
    detail,
    buttons: [
      UI_TEXT.startupCheckButtonOpenSettings || '检查配置',
      UI_TEXT.startupCheckButtonLater || '稍后'
    ],
    defaultId: 0,
    cancelId: 1
  });

  if (result.response === 0) {
    createSettingsWindow();
  }
}

// ==================== Preview Window ====================

async function cleanupPreviewTempFile(targetWindow) {
  const tempFilePath = targetWindow?.__previewTempFilePath;
  if (!tempFilePath) {
    return;
  }

  targetWindow.__previewTempFilePath = null;

  try {
    await fs.unlink(tempFilePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      ErrorLogger.logError(error, 'preview:cleanupTempFile', { tempFilePath });
    }
  }
}

function normalizePreviewBuffer(content) {
  if (Buffer.isBuffer(content)) {
    return content;
  }

  if (content instanceof Uint8Array) {
    return Buffer.from(content);
  }

  if (content && content.type === 'Buffer' && Array.isArray(content.data)) {
    return Buffer.from(content.data);
  }

  throw new Error('Invalid preview content buffer');
}

function showAndFocusWindow(targetWindow) {
  if (!targetWindow || targetWindow.isDestroyed()) {
    return;
  }

  if (targetWindow.isMinimized()) {
    targetWindow.restore();
  }

  targetWindow.show();
  targetWindow.focus();

  if (typeof targetWindow.moveTop === 'function') {
    targetWindow.moveTop();
  }
}

/**
 * 创建预览窗口
 * @param {Object} previewData - 预览数据
 */
function createPreviewWindow(previewData) {
  // 如果已有预览窗口，先关闭
  if (previewWindow) {
    previewWindow.close();
    previewWindow = null;
  }
  
  previewWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 400,
    minHeight: 300,
    title: UI_TEXT.previewWindowTitle ? UI_TEXT.previewWindowTitle.replace('{filename}', previewData.key) : `预览 - ${previewData.key}`,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      plugins: true
    },
    icon: path.join(__dirname, '../../assets/icon.ico'),
    autoHideMenuBar: true
  });
  
  // 加载预览窗口 HTML
  previewWindow.loadFile(path.join(__dirname, '../renderer/preview.html'));
  showAndFocusWindow(previewWindow);
  
  // 当预览窗口准备好时，发送预览数据
  previewWindow.webContents.once('did-finish-load', () => {
    previewWindow.webContents.send('preview:data', previewData);
    showAndFocusWindow(previewWindow);
  });
  
  // 监听预览窗口准备好的消息
  ipcMain.once('preview:ready', () => {
    if (previewWindow && previewData) {
      previewWindow.webContents.send('preview:data', previewData);
    }
  });
  
  // 窗口关闭时清理引用
  const currentWindow = previewWindow;
  previewWindow.on('closed', () => {
    cleanupPreviewTempFile(currentWindow).catch(() => {});
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
    if (previewWindow === currentWindow) {
      previewWindow = null;
    }
  });
  
  // 开发环境下打开开发者工具（可选）
  // previewWindow.webContents.openDevTools();
}

async function loadPdfIntoPreviewWindow(previewData) {
  if (!previewWindow || previewWindow.isDestroyed()) {
    createPreviewWindow({ key: previewData.key, loading: true });
  }

  const currentWindow = previewWindow;
  const pdfBuffer = normalizePreviewBuffer(previewData.content);
  const tempFilePath = path.join(
    app.getPath('temp'),
    `r2-preview-${Date.now()}-${Math.random().toString(16).slice(2)}.pdf`
  );

  await fs.writeFile(tempFilePath, pdfBuffer);
  await cleanupPreviewTempFile(currentWindow);

  currentWindow.__previewTempFilePath = tempFilePath;
  currentWindow.setTitle(
    UI_TEXT.previewWindowTitle ? UI_TEXT.previewWindowTitle.replace('{filename}', previewData.key) : `预览 - ${previewData.key}`
  );
  await currentWindow.loadURL(pathToFileURL(tempFilePath).href);
  showAndFocusWindow(currentWindow);
}

/**
 * 获取文件类型
 * @param {string} filename - 文件名
 * @returns {'image' | 'text' | 'other'} 文件类型
 */
function getFileType(filename) {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  
  const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'];
  const textExtensions = ['txt', 'md', 'json', 'xml', 'html', 'css', 'js', 'ts', 'yaml', 'yml', 'log'];
  
  if (imageExtensions.includes(ext)) return 'image';
  if (textExtensions.includes(ext)) return 'text';
  return 'other';
}

/**
 * 创建主窗口
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 600,
    minWidth: 800,
    minHeight: 500,
    title: UI_TEXT.mainWindowTitle,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    icon: path.join(__dirname, '../../assets/icon.ico'),
    autoHideMenuBar: true
  });

  // 隐藏 Electron 默认菜单栏，避免显示框架自带按钮。
  mainWindow.setMenuBarVisibility(false);
  mainWindow.removeMenu();

  // 加载渲染进程的 HTML 文件
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // 开发环境下打开开发者工具（可选）
  // mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 当 Electron 完成初始化时创建窗口
app.on('ready', async () => {
  let startupCheckResult = {
    ok: false,
    status: StartupCheckStatus.CONNECTION_FAILED
  };

  try {
    startupCheckResult = await runStartupHealthCheck();
  } catch (error) {
    storageService = null;
    ErrorLogger.logError(error, 'app:ready:startupHealthCheck');
  }

  lastStartupCheckResult = startupCheckResult;

  // Register dialog handlers
  registerDialogHandlers();

  // Register IPC handlers
  registerIPCHandlers();

  // Register settings handlers
  registerSettingsHandlers();

  // 隐藏应用级默认菜单，避免顶部显示 File / Edit / View 等框架菜单。
  Menu.setApplicationMenu(null);

  createWindow();

  if (!startupCheckResult.ok) {
    try {
      await promptStartupCheckFailure(startupCheckResult);
    } catch (promptError) {
      ErrorLogger.logError(promptError, 'app:ready:startupPrompt');
    }
  }
});

// 当所有窗口关闭时退出应用（macOS 除外）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 在 macOS 上，当点击 dock 图标且没有其他窗口打开时，重新创建窗口
app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// ==================== Dialog Handlers ====================

/**
 * Register all dialog handlers for file selection, save, confirmations, and notifications
 */
function registerDialogHandlers() {
  // Handler for file open dialog
  ipcMain.handle('dialog:openFile', async (event) => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: UI_TEXT.dialogSelectFile,
        properties: ['openFile'],
        legacyFilters: [
          { name: '所有文件', extensions: ['*'] },
          { name: '图片文件', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'] },
          { name: '文本文件', extensions: ['txt', 'md', 'json', 'xml', 'html', 'css', 'js', 'ts', 'yaml', 'yml', 'log'] }
        ],
        filters: [
          { name: 'All Files', extensions: ['*'] }
        ]
      });
      
      return {
        success: true,
        canceled: result.canceled,
        filePaths: result.filePaths
      };
    } catch (error) {
      ErrorLogger.logError(error, 'dialog:openFile');
      return {
        success: false,
        canceled: true,
        filePaths: [],
        error: {
          message: error.message,
          userMessage: UI_TEXT.errorUnknown
        }
      };
    }
  });

  // Handler for file save dialog
  ipcMain.handle('dialog:saveFile', async (event, defaultFilename) => {
    try {
      const result = await dialog.showSaveDialog(mainWindow, {
        title: UI_TEXT.dialogSaveFile,
        defaultPath: defaultFilename || '',
        filters: [
          { name: '所有文件', extensions: ['*'] }
        ]
      });
      
      return {
        success: true,
        canceled: result.canceled,
        filePath: result.filePath
      };
    } catch (error) {
      ErrorLogger.logError(error, 'dialog:saveFile');
      return {
        success: false,
        canceled: true,
        filePath: undefined,
        error: {
          message: error.message,
          userMessage: UI_TEXT.errorUnknown
        }
      };
    }
  });

  // Handler for folder selection dialog
  ipcMain.handle('dialog:openFolder', async (event) => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: UI_TEXT.dialogSelectFolder,
        properties: ['openDirectory', 'createDirectory']
      });
      
      return {
        success: true,
        canceled: result.canceled,
        filePaths: result.filePaths
      };
    } catch (error) {
      ErrorLogger.logError(error, 'dialog:openFolder');
      return {
        success: false,
        canceled: true,
        filePaths: [],
        error: {
          message: error.message,
          userMessage: UI_TEXT.errorUnknown
        }
      };
    }
  });

  // Handler for confirmation dialog
  ipcMain.handle('dialog:confirm', async (event, message, detail) => {
    try {
      const result = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: [UI_TEXT.dialogButtonOk, UI_TEXT.dialogButtonCancel],
        defaultId: 0,
        cancelId: 1,
        title: UI_TEXT.mainWindowTitle,
        message: message,
        detail: detail || ''
      });
      
      return {
        success: true,
        confirmed: result.response === 0
      };
    } catch (error) {
      ErrorLogger.logError(error, 'dialog:confirm');
      return {
        success: false,
        confirmed: false,
        error: {
          message: error.message,
          userMessage: UI_TEXT.errorUnknown
        }
      };
    }
  });

  // Handler for error dialog
  ipcMain.handle('dialog:error', async (event, message, detail) => {
    try {
      await dialog.showMessageBox(mainWindow, {
        type: 'error',
        buttons: [UI_TEXT.dialogButtonOk],
        defaultId: 0,
        title: UI_TEXT.mainWindowTitle,
        message: message,
        detail: detail || ''
      });
      
      return { success: true };
    } catch (error) {
      ErrorLogger.logError(error, 'dialog:error');
      return {
        success: false,
        error: {
          message: error.message,
          userMessage: UI_TEXT.errorUnknown
        }
      };
    }
  });

  // Handler for error dialog with recovery actions
  ipcMain.handle('dialog:errorWithActions', async (event, errorData, context) => {
    try {
      // Reconstruct error object from errorData
      const error = new Error(errorData.message);
      error.errorType = errorData.errorType;
      error.operation = errorData.operation;
      error.fileSystemCode = errorData.fileSystemCode;
      
      // Create error dialog options
      const dialogOptions = ErrorHandler.createErrorDialogOptions(error, errorData.operation);
      
      // Show dialog and get response
      const result = await dialog.showMessageBox(mainWindow, dialogOptions);
      
      // Get the action that was clicked
      const clickedAction = dialogOptions.actions[result.response];
      
      // Handle the action
      const actionContext = {
        onRetry: async () => {
          // Send retry event to renderer
          event.sender.send('error:retry', { operation: errorData.operation, context: context });
        },
        onRefresh: async () => {
          // Refresh the object list
          try {
            const activeStorageService = getStorageServiceOrThrow('list');
            const prefix = typeof context?.prefix === 'string' ? context.prefix : '';
            const objects = await activeStorageService.listObjects(prefix);
            event.sender.send('storage:list:updated', { objects, prefix });
          } catch (refreshError) {
            ErrorLogger.logError(refreshError, 'error:refresh');
          }
        },
        onReauth: async () => {
          // Check credentials and show appropriate message
          try {
            const credentials = resolveCredentials();
            if (!CredentialManager.validateCredentials(credentials)) {
              throw new Error('Missing credentials');
            }
            // If validation passes, credentials might be correct but permissions are wrong
            await dialog.showMessageBox(mainWindow, {
              type: 'info',
              buttons: [UI_TEXT.dialogButtonOk],
              title: UI_TEXT.mainWindowTitle,
              message: UI_TEXT.errorAuthDetail || '请先在设置中配置 R2 凭证'
            });
          } catch (credError) {
            // Credentials are invalid
            await dialog.showMessageBox(mainWindow, {
              type: 'error',
              buttons: [UI_TEXT.dialogButtonOk],
              title: UI_TEXT.mainWindowTitle,
              message: UI_TEXT.errorAuth || '认证失败，请检查 API 凭证配置',
              detail: UI_TEXT.errorAuthDetail || '请先在设置中配置 R2 凭证'
            });
          }
        },
        onViewLogs: async () => {
          // Open log file location
          const { shell } = require('electron');
          const logPath = ErrorLogger.getLogPath();
          await shell.showItemInFolder(logPath);
        }
      };
      
      await ErrorHandler.handleAction(clickedAction, error, actionContext);
      
      return { 
        success: true, 
        action: clickedAction,
        actionIndex: result.response 
      };
    } catch (handlerError) {
      ErrorLogger.logError(handlerError, 'dialog:errorWithActions');
      return {
        success: false,
        error: {
          message: handlerError.message,
          userMessage: UI_TEXT.errorUnknown
        }
      };
    }
  });

  // Handler for success notification
  ipcMain.handle('dialog:success', async (event, message, detail) => {
    try {
      await dialog.showMessageBox(mainWindow, {
        type: 'info',
        buttons: [UI_TEXT.dialogButtonOk],
        defaultId: 0,
        title: UI_TEXT.mainWindowTitle,
        message: message,
        detail: detail || ''
      });
      
      return { success: true };
    } catch (error) {
      ErrorLogger.logError(error, 'dialog:success');
      return {
        success: false,
        error: {
          message: error.message,
          userMessage: UI_TEXT.errorUnknown
        }
      };
    }
  });
}

// ==================== IPC Handlers ====================

/**
 * Register all IPC handlers for storage operations
 */
function registerIPCHandlers() {
  // Handler for listing objects
  ipcMain.handle('storage:list', async (event, prefix = '') => {
    try {
      const activeStorageService = getStorageServiceOrThrow('list');
      const objects = await activeStorageService.listObjects(prefix);
      return { success: true, data: objects };
    } catch (error) {
      ErrorLogger.logError(error, 'storage:list', { prefix });
      
      // Get user-friendly message
      let userMessage = ErrorHandler.getUserMessage(error);
      if (error.code === 'SERVICE_NOT_READY' && lastStartupCheckResult && !lastStartupCheckResult.ok) {
        userMessage = getStartupCheckMessage(lastStartupCheckResult.status);
      }
      
      return {
        success: false,
        error: {
          message: error.message,
          userMessage: userMessage,
          code: error.code,
          errorType: error.errorType,
          operation: error.operation,
          fileSystemCode: error.fileSystemCode,
          isRetryable: ErrorHandler.isRetryable(error),
          shouldRefreshList: ErrorHandler.shouldRefreshList(error),
          isAuthError: ErrorHandler.isAuthError(error)
        }
      };
    }
  });

  // Handler for uploading files with progress updates
  ipcMain.handle('storage:upload', async (event, filePath, prefix = '') => {
    try {
      const activeStorageService = getStorageServiceOrThrow('upload');

      // Progress callback to send updates to renderer
      const onProgress = (loaded, total) => {
        const percent = total > 0 ? Math.round((loaded / total) * 100) : 0;
        const loadedFormatted = formatBytes(loaded);
        const totalFormatted = formatBytes(total);
        const filename = path.basename(filePath);
        
        // Send progress update to renderer
        event.sender.send('storage:upload:progress', {
          filename,
          percent,
          loaded,
          total,
          message: UI_TEXT.progressUploading
            .replace('{filename}', filename)
            .replace('{percent}', percent)
            .replace('{uploaded}', loadedFormatted)
            .replace('{total}', totalFormatted)
        });
      };

      const result = await activeStorageService.uploadFile(filePath, onProgress, prefix);
      return { success: true, data: result };
    } catch (error) {
      ErrorLogger.logError(error, 'storage:upload', { filePath, prefix });
      
      // Get user-friendly message
      const userMessage = ErrorHandler.getOperationMessage(error, 'upload');
      
      return {
        success: false,
        error: {
          message: error.message,
          userMessage: userMessage,
          errorType: error.errorType,
          operation: 'upload',
          fileSystemCode: error.fileSystemCode,
          isRetryable: ErrorHandler.isRetryable(error),
          shouldRefreshList: ErrorHandler.shouldRefreshList(error),
          isAuthError: ErrorHandler.isAuthError(error)
        }
      };
    }
  });

  // Handler for uploading buffer (for drag and drop support)
  ipcMain.handle('storage:upload-buffer', async (event, { name, buffer, type }) => {
    try {
      const activeStorageService = getStorageServiceOrThrow('upload');

      // Convert ArrayBuffer to Buffer if needed
      const nodeBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
      
      // Progress callback to send updates to renderer
      const onProgress = (loaded, total) => {
        const percent = total > 0 ? Math.round((loaded / total) * 100) : 0;
        const loadedFormatted = formatBytes(loaded);
        const totalFormatted = formatBytes(total);
        
        // Send progress update to renderer
        event.sender.send('storage:upload:progress', {
          filename: name,
          percent,
          loaded,
          total,
          message: UI_TEXT.progressUploading
            .replace('{filename}', name)
            .replace('{percent}', percent)
            .replace('{uploaded}', loadedFormatted)
            .replace('{total}', totalFormatted)
        });
      };

      const result = await activeStorageService.uploadBuffer(name, nodeBuffer, type, onProgress);
      return { success: true, data: result };
    } catch (error) {
      ErrorLogger.logError(error, 'storage:upload-buffer', { name });
      
      // Get user-friendly message
      const userMessage = ErrorHandler.getOperationMessage(error, 'upload');
      
      return {
        success: false,
        error: {
          message: error.message,
          userMessage: userMessage,
          errorType: error.errorType,
          operation: 'upload',
          fileSystemCode: error.fileSystemCode,
          isRetryable: ErrorHandler.isRetryable(error),
          shouldRefreshList: ErrorHandler.shouldRefreshList(error),
          isAuthError: ErrorHandler.isAuthError(error)
        }
      };
    }
  });

  // Handler for downloading files with progress updates
  ipcMain.handle('storage:download', async (event, key, savePath) => {
    try {
      const activeStorageService = getStorageServiceOrThrow('download');

      // Progress callback to send updates to renderer
      const onProgress = (loaded, total) => {
        const percent = total > 0 ? Math.round((loaded / total) * 100) : 0;
        const downloadedFormatted = formatBytes(loaded);
        const totalFormatted = formatBytes(total);
        
        // Send progress update to renderer
        event.sender.send('storage:download:progress', {
          filename: key,
          percent,
          loaded,
          total,
          message: UI_TEXT.progressDownloading
            .replace('{filename}', key)
            .replace('{percent}', percent)
            .replace('{downloaded}', downloadedFormatted)
            .replace('{total}', totalFormatted)
        });
      };

      await activeStorageService.downloadFile(key, savePath, onProgress);
      return { success: true };
    } catch (error) {
      ErrorLogger.logError(error, 'storage:download', { key, savePath });
      
      // Get user-friendly message
      const userMessage = ErrorHandler.getOperationMessage(error, 'download');
      
      return {
        success: false,
        error: {
          message: error.message,
          userMessage: userMessage,
          errorType: error.errorType,
          operation: 'download',
          fileSystemCode: error.fileSystemCode,
          isRetryable: ErrorHandler.isRetryable(error),
          shouldRefreshList: ErrorHandler.shouldRefreshList(error),
          isAuthError: ErrorHandler.isAuthError(error)
        }
      };
    }
  });

  // Handler for deleting files
  ipcMain.handle('storage:delete', async (event, key) => {
    try {
      const activeStorageService = getStorageServiceOrThrow('delete');
      await activeStorageService.deleteFile(key);
      return { success: true };
    } catch (error) {
      ErrorLogger.logError(error, 'storage:delete', { key });
      
      // Get user-friendly message
      const userMessage = ErrorHandler.getOperationMessage(error, 'delete');
      
      return {
        success: false,
        error: {
          message: error.message,
          userMessage: userMessage,
          errorType: error.errorType,
          operation: 'delete',
          fileSystemCode: error.fileSystemCode,
          isRetryable: ErrorHandler.isRetryable(error),
          shouldRefreshList: ErrorHandler.shouldRefreshList(error),
          isAuthError: ErrorHandler.isAuthError(error)
        }
      };
    }
  });

  // Handler for batch deleting files
  ipcMain.handle('storage:delete-batch', async (event, keys) => {
    try {
      const activeStorageService = getStorageServiceOrThrow('delete');
      const result = await activeStorageService.deleteFiles(keys);
      return { success: true, data: result };
    } catch (error) {
      ErrorLogger.logError(error, 'storage:delete-batch', { keys });
      
      // Get user-friendly message
      const userMessage = ErrorHandler.getOperationMessage(error, 'delete');
      
      return {
        success: false,
        error: {
          message: error.message,
          userMessage: userMessage,
          errorType: error.errorType,
          operation: 'delete',
          fileSystemCode: error.fileSystemCode,
          isRetryable: ErrorHandler.isRetryable(error),
          shouldRefreshList: ErrorHandler.shouldRefreshList(error),
          isAuthError: ErrorHandler.isAuthError(error)
        }
      };
    }
  });

  // Handler for batch downloading files
  ipcMain.handle('storage:download-batch', async (event, keys, folderPath) => {
    try {
      const activeStorageService = getStorageServiceOrThrow('download');
      const results = {
        downloaded: [],
        errors: []
      };

      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const current = i + 1;
        const total = keys.length;

        try {
          // Construct the save path using the original object name
          const savePath = path.join(folderPath, key);

          // Progress callback to send updates to renderer
          const onProgress = (loaded, totalBytes) => {
            const percent = totalBytes > 0 ? Math.round((loaded / totalBytes) * 100) : 0;

            // Send progress update to renderer
            event.sender.send('storage:download-batch:progress', {
              filename: key,
              current,
              total,
              percent,
              loaded,
              totalBytes,
              message: UI_TEXT.progressBatchDownloadingFile
                .replace('{filename}', key)
                .replace('{current}', current)
                .replace('{total}', total)
            });
          };

          await activeStorageService.downloadFile(key, savePath, onProgress);
          results.downloaded.push(key);
        } catch (error) {
          ErrorLogger.logError(error, 'storage:download-batch', { key, folderPath });
          results.errors.push({ key, error: error.message });
        }
      }

      return { success: true, data: results };
    } catch (error) {
      ErrorLogger.logError(error, 'storage:download-batch:init', { keyCount: keys ? keys.length : 0 });

      const userMessage = ErrorHandler.getOperationMessage(error, 'download');

      return {
        success: false,
        error: {
          message: error.message,
          userMessage: userMessage,
          errorType: error.errorType,
          operation: 'download',
          fileSystemCode: error.fileSystemCode,
          isRetryable: ErrorHandler.isRetryable(error),
          shouldRefreshList: ErrorHandler.shouldRefreshList(error),
          isAuthError: ErrorHandler.isAuthError(error)
        }
      };
    }
  });

  // Handler for previewing files
  ipcMain.handle('storage:preview', async (event, key) => {
    try {
      const activeStorageService = getStorageServiceOrThrow('preview');

      // 先创建预览窗口显示加载状态
      createPreviewWindow({ key, loading: true });
      
      // 然后加载文件内容
      createPreviewWindow({ key, loading: true });
      const previewData = await activeStorageService.previewFile(key);
      
      // 添加 key 到预览数据
      previewData.key = key;

      if (previewData.type === 'pdf') {
        await loadPdfIntoPreviewWindow(previewData);
        return { success: true, data: previewData };
      }
      
      // 发送预览数据到已打开的窗口
      if (previewWindow) {
        previewWindow.webContents.send('preview:data', previewData);
      }
      
      return { success: true, data: previewData };
    } catch (error) {
      ErrorLogger.logError(error, 'storage:preview', { key });
      // 发送错误到预览窗口
      if (previewWindow) {
        previewWindow.webContents.send('preview:error', {
          message: error.message,
          userMessage: ErrorHandler.getOperationMessage(error, 'preview')
        });
      }
      
      // Get user-friendly message
      const userMessage = ErrorHandler.getOperationMessage(error, 'preview');
      
      return {
        success: false,
        error: {
          message: error.message,
          userMessage: userMessage,
          errorType: error.errorType,
          operation: 'preview',
          fileSystemCode: error.fileSystemCode,
          isRetryable: ErrorHandler.isRetryable(error),
          shouldRefreshList: ErrorHandler.shouldRefreshList(error),
          isAuthError: ErrorHandler.isAuthError(error)
        }
      };
    }
  });

  // Handler for loading media thumbnail data
  ipcMain.handle('storage:thumbnail', async (event, key) => {
    try {
      const activeStorageService = getStorageServiceOrThrow('preview');
      const previewData = await activeStorageService.previewFile(key);
      previewData.key = key;

      if (!['image', 'video'].includes(previewData.type)) {
        const error = new Error('Thumbnail preview is only supported for image and video files');
        error.userMessage = UI_TEXT.previewNotSupported || '不支持预览此文件类型，请下载后查看';
        throw error;
      }

      return { success: true, data: previewData };
    } catch (error) {
      ErrorLogger.logError(error, 'storage:thumbnail', { key });

      const userMessage = error.userMessage || ErrorHandler.getOperationMessage(error, 'preview');

      return {
        success: false,
        error: {
          message: error.message,
          userMessage: userMessage,
          errorType: error.errorType,
          operation: 'thumbnail',
          fileSystemCode: error.fileSystemCode,
          isRetryable: ErrorHandler.isRetryable(error),
          shouldRefreshList: ErrorHandler.shouldRefreshList(error),
          isAuthError: ErrorHandler.isAuthError(error)
        }
      };
    }
  });

  // Handler for copying URL to clipboard
  ipcMain.handle('storage:copy-url', async (event, key, format) => {
    try {
      const activeStorageService = getStorageServiceOrThrow('copy-url');

      // Get formatted URL
      const formattedUrl = await activeStorageService.getFileUrl(key, format || URLFormat.URL);
      
      // Copy to clipboard
      const copied = ClipboardManager.writeText(formattedUrl);
      
      if (!copied) {
        throw new Error('Failed to copy to clipboard');
      }
      
      return { success: true, data: formattedUrl };
    } catch (error) {
      ErrorLogger.logError(error, 'storage:copy-url', { key, format });
      
      // Get user-friendly message
      const userMessage = ErrorHandler.getUserMessage(error);
      
      return {
        success: false,
        error: {
          message: error.message,
          userMessage: userMessage,
          errorType: error.errorType,
          operation: 'copy-url',
          fileSystemCode: error.fileSystemCode,
          isRetryable: ErrorHandler.isRetryable(error),
          shouldRefreshList: ErrorHandler.shouldRefreshList(error),
          isAuthError: ErrorHandler.isAuthError(error)
        }
      };
    }
  });

  // Handler for opening log file location
  ipcMain.handle('logs:openLocation', async (event) => {
    try {
      const { shell } = require('electron');
      const logPath = ErrorLogger.getLogPath();
      await shell.showItemInFolder(logPath);
      return { success: true };
    } catch (error) {
      ErrorLogger.logError(error, 'logs:openLocation');
      return {
        success: false,
        error: {
          message: error.message,
          userMessage: UI_TEXT.errorUnknown
        }
      };
    }
  });
}

// ==================== Settings Window ====================

let settingsWindow = null;

/**
 * 创建设置窗口
 */
function createSettingsWindow() {
  // 如果已有设置窗口，聚焦它
  if (settingsWindow) {
    if (settingsWindow.isMinimized()) {
      settingsWindow.restore();
    }
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  
  settingsWindow = new BrowserWindow({
    width: 600,
    height: 550,
    minWidth: 500,
    minHeight: 400,
    title: UI_TEXT.settingsWindowTitle || '设置',
    parent: mainWindow,
    modal: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    icon: path.join(__dirname, '../../assets/icon.ico'),
    autoHideMenuBar: true,
    resizable: true
  });
  
  // 加载设置窗口 HTML
  settingsWindow.loadFile(path.join(__dirname, '../renderer/settings.html'));

  // 确保窗口创建后可见并聚焦，避免“点击设置无反应”的感知问题
  settingsWindow.once('ready-to-show', () => {
    settingsWindow.show();
    settingsWindow.focus();
  });
  
  // 窗口关闭时清理引用
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// ==================== Settings IPC Handlers ====================

/**
 * Register all settings IPC handlers
 */
function registerSettingsHandlers() {
  // Handler for getting credentials
  ipcMain.handle('settings:getCredentials', async (event) => {
    const credentials = resolveCredentials();
    return {
      success: true,
      data: credentials
    };
  });

  // Handler for getting R2 endpoint/bucket/public URL configuration
  ipcMain.handle('settings:getR2Config', async (event) => {
    return {
      success: true,
      data: getR2Settings()
    };
  });

  // Handler for saving R2 endpoint/bucket/public URL configuration
  ipcMain.handle('settings:saveR2Config', async (event, r2Config) => {
    try {
      const savedConfig = saveR2Settings({
        region: r2Config?.region,
        bucket: r2Config?.bucket,
        publicUrl: r2Config?.publicUrl,
        cloudflareAccountId: r2Config?.cloudflareAccountId,
        cloudflareApiToken: r2Config?.cloudflareApiToken,
        cloudflareJurisdiction: r2Config?.cloudflareJurisdiction
      });
      refreshStorageServiceWithSettings(savedConfig);

      return {
        success: true,
        data: savedConfig
      };
    } catch (error) {
      ErrorLogger.logError(error, 'settings:saveR2Config');
      let userMessage = UI_TEXT.settingsSaveFailed || '保存设置失败';
      if (error.message === 'URL is required') {
        userMessage = UI_TEXT.endpointRequired || '请填写 S3 地址（Endpoint）';
      } else if (error.message === 'Bucket name is required') {
        userMessage = UI_TEXT.bucketRequired || '请填写桶名';
      }
      return {
        success: false,
        error: {
          message: error.message,
          userMessage: userMessage
        }
      };
    }
  });
  
  // Handler for saving credentials
  ipcMain.handle('settings:saveCredentials', async (event, credentials) => {
    try {
      const {
        accessKeyId,
        secretAccessKey,
        apiToken,
        accountId,
        jurisdiction,
        encrypt
      } = credentials || {};
      
      if (!accessKeyId || !secretAccessKey) {
        return {
          success: false,
          error: {
            message: 'Missing credentials',
            userMessage: UI_TEXT.credentialsValidateFailed || '请输入完整的凭证信息'
          }
        };
      }
      
      // Validate credentials
      if (!CredentialManager.validateCredentials({ accessKeyId, secretAccessKey })) {
        return {
          success: false,
          error: {
            message: 'Invalid credentials',
            userMessage: UI_TEXT.credentialsValidateFailed || '凭证格式无效'
          }
        };
      }
      
      const Store = require('electron-store');
      const settingsStore = new Store({ name: 'settings' });
      const credentialsStore = new Store({ name: 'credentials' });

      // 同步保存账户维度配置，保证 endpoint 自动派生。
      if (typeof accountId === 'string') {
        settingsStore.set('accountId', accountId.trim());
        settingsStore.set('cfAccountId', accountId.trim());
      }
      if (typeof jurisdiction === 'string') {
        const normalizedJurisdiction = normalizeJurisdiction(jurisdiction);
        settingsStore.set('jurisdiction', normalizedJurisdiction);
        settingsStore.set('cfR2Jurisdiction', normalizedJurisdiction);
      }

      // 安全保存两套凭证。
      storeSecretValue(credentialsStore, 'accessKeyId', accessKeyId, encrypt);
      storeSecretValue(credentialsStore, 'secretAccessKey', secretAccessKey, encrypt);
      storeSecretValue(credentialsStore, 'apiToken', apiToken || '', encrypt);

      // 更新当前 storageService，避免刷新后才生效。
      try {
        const mergedSettings = saveR2Settings({
          cloudflareAccountId: typeof accountId === 'string' ? accountId : undefined,
          cloudflareApiToken: typeof apiToken === 'string' ? apiToken : undefined,
          cloudflareJurisdiction: typeof jurisdiction === 'string' ? jurisdiction : undefined,
          bucket: getR2Settings().bucket,
          publicUrl: getR2Settings().publicUrl
        });
        refreshStorageServiceWithSettings(mergedSettings, {
          accessKeyId,
          secretAccessKey,
          apiToken: String(apiToken || '').trim(),
          accountId: String(accountId || mergedSettings.cloudflareAccountId || '').trim(),
          jurisdiction: normalizeJurisdiction(jurisdiction || mergedSettings.cloudflareJurisdiction)
        });
      } catch (updateError) {
        ErrorLogger.logError(updateError, 'settings:saveCredentials:update');
      }
      
      return { success: true };
    } catch (error) {
      ErrorLogger.logError(error, 'settings:saveCredentials');
      return {
        success: false,
        error: {
          message: error.message,
          userMessage: UI_TEXT.credentialsSaveFailed || '凭证保存失败'
        }
      };
    }
  });
  
  // Handler for clearing credentials
  ipcMain.handle('settings:clearCredentials', async (event) => {
    try {
      const Store = require('electron-store');
      const credentialsStore = new Store({ name: 'credentials' });
      const settingsStore = new Store({ name: 'settings' });
      
      credentialsStore.clear();
      settingsStore.delete('accountId');
      settingsStore.delete('cfAccountId');
      settingsStore.delete('jurisdiction');
      settingsStore.delete('cfR2Jurisdiction');
      settingsStore.delete('r2PublicUrl');
      storageService = null;
      lastStartupCheckResult = {
        ok: false,
        status: StartupCheckStatus.MISSING_CREDENTIALS
      };
      
      return { success: true };
    } catch (error) {
      ErrorLogger.logError(error, 'settings:clearCredentials');
      return {
        success: false,
        error: {
          message: error.message,
          userMessage: UI_TEXT.securityClearFailed || '清除凭证失败'
        }
      };
    }
  });
  
  // Handler for testing connection
  ipcMain.handle('settings:testConnection', async (event, payload) => {
    try {
      const inputAccessKeyId = typeof payload?.accessKeyId === 'string' ? payload.accessKeyId.trim() : '';
      const inputSecretAccessKey = typeof payload?.secretAccessKey === 'string' ? payload.secretAccessKey.trim() : '';

      let credentials = null;
      if (inputAccessKeyId && inputSecretAccessKey) {
        credentials = {
          accessKeyId: inputAccessKeyId,
          secretAccessKey: inputSecretAccessKey
        };
      } else {
        credentials = resolveCredentials();
      }

      if (!CredentialManager.validateCredentials(credentials)) {
        return {
          success: false,
          error: {
            message: 'Missing credentials',
            userMessage: UI_TEXT.credentialsValidateFailed || '请输入完整的凭证信息'
          }
        };
      }

      const r2Settings = resolveR2Settings(payload || {});
      const testConfig = buildR2Config(credentials, r2Settings);
      const testClient = new R2Client(testConfig);

      // Try to list objects to verify endpoint/credentials/bucket
      await testClient.listObjects();

      return { success: true };
    } catch (error) {
      ErrorLogger.logError(error, 'settings:testConnection');
      let userMessage = ErrorHandler.getUserMessage(error);
      if (error.message === 'URL is required') {
        userMessage = UI_TEXT.endpointRequired || '请填写 S3 地址（Endpoint）';
      } else if (error.message === 'Bucket name is required') {
        userMessage = UI_TEXT.bucketRequired || '请填写桶名';
      }

      return {
        success: false,
        error: {
          message: error.message,
          userMessage: userMessage || UI_TEXT.credentialsTestFailed || '连接测试失败'
        }
      };
    }
  });
  
  // Handler for listing buckets
  ipcMain.handle('settings:listBuckets', async (event, payload) => {
    try {
      const r2Settings = resolveR2Settings(payload || {}, { requireBucket: false });
      const cfApiConfig = resolveCloudflareApiConfig(r2Settings);
      const buckets = await listBucketsViaCloudflareApi(cfApiConfig);
      return { success: true, data: buckets };
    } catch (error) {
      ErrorLogger.logError(error, 'settings:listBuckets');

      return {
        success: false,
        error: {
          message: error.message,
          userMessage: error.userMessage || UI_TEXT.bucketLoadFailed || '加载存储桶列表失败'
        }
      };
    }
  });
  
  // Handler for getting current bucket
  ipcMain.handle('settings:getCurrentBucket', async (event) => {
    try {
      const bucket = getR2Settings().bucket;
      return { success: true, data: bucket };
    } catch (error) {
      // Return default bucket
      return { success: true, data: DEFAULT_R2_BUCKET };
    }
  });
  
  // Handler for setting current bucket
  ipcMain.handle('settings:setCurrentBucket', async (event, bucket) => {
    try {
      const syncResult = await syncCurrentBucketFromRemote({ bucket });
      return { success: true, data: syncResult };
    } catch (error) {
      ErrorLogger.logError(error, 'settings:setCurrentBucket');
      return {
        success: false,
        error: {
          message: error.message,
          userMessage: UI_TEXT.bucketSwitchFailed || '切换存储桶失败'
        }
      };
    }
  });

  // Handler for creating a bucket
  ipcMain.handle('settings:createBucket', async (event, payload) => {
    try {
      const r2Settings = resolveR2Settings(payload || {}, { requireBucket: false });
      const cfApiConfig = resolveCloudflareApiConfig(r2Settings);

      const bucketName = String(payload?.name || '').trim();
      const storageClass = String(payload?.storageClass || 'Standard').trim() || 'Standard';
      const locationHintRaw = String(payload?.locationHint || '').trim();

      if (!bucketName) {
        return {
          success: false,
          error: {
            message: 'Bucket name is required',
            userMessage: UI_TEXT.bucketRequired || '请填写桶名'
          }
        };
      }
      if (!isValidBucketName(bucketName)) {
        return {
          success: false,
          error: {
            message: 'Invalid bucket name',
            userMessage: '桶名必须为 3-64 位，只允许小写字母、数字和连字符。'
          }
        };
      }

      const body = {
        name: bucketName,
        storageClass
      };
      if (locationHintRaw) {
        body.locationHint = locationHintRaw;
      }

      const result = await callCloudflareR2Api({
        method: 'POST',
        accountId: cfApiConfig.accountId,
        apiToken: cfApiConfig.apiToken,
        jurisdiction: cfApiConfig.jurisdiction,
        path: '/r2/buckets',
        body
      });

      return {
        success: true,
        data: result
      };
    } catch (error) {
      ErrorLogger.logError(error, 'settings:createBucket');
      return {
        success: false,
        error: {
          message: error.message,
          userMessage: error.userMessage || '创建存储桶失败，请检查 Cloudflare API 配置。'
        }
      };
    }
  });

  // Handler for updating bucket storage class
  ipcMain.handle('settings:updateBucket', async (event, payload) => {
    try {
      const r2Settings = resolveR2Settings(payload || {}, { requireBucket: false });
      const cfApiConfig = resolveCloudflareApiConfig(r2Settings);

      const bucketName = String(payload?.bucketName || '').trim();
      const storageClass = String(payload?.storageClass || '').trim();
      if (!bucketName) {
        return {
          success: false,
          error: {
            message: 'Bucket name is required',
            userMessage: UI_TEXT.bucketRequired || '请填写桶名'
          }
        };
      }
      if (!isValidBucketName(bucketName)) {
        return {
          success: false,
          error: {
            message: 'Invalid bucket name',
            userMessage: '桶名必须为 3-64 位，只允许小写字母、数字和连字符。'
          }
        };
      }

      if (!['Standard', 'InfrequentAccess'].includes(storageClass)) {
        return {
          success: false,
          error: {
            message: 'Invalid storage class',
            userMessage: '存储类型仅支持 Standard 或 InfrequentAccess。'
          }
        };
      }

      const result = await callCloudflareR2Api({
        method: 'PATCH',
        accountId: cfApiConfig.accountId,
        apiToken: cfApiConfig.apiToken,
        jurisdiction: cfApiConfig.jurisdiction,
        path: `/r2/buckets/${encodeURIComponent(bucketName)}`,
        extraHeaders: {
          'cf-r2-storage-class': storageClass
        }
      });

      return {
        success: true,
        data: result
      };
    } catch (error) {
      ErrorLogger.logError(error, 'settings:updateBucket');
      return {
        success: false,
        error: {
          message: error.message,
          userMessage: error.userMessage || '更新存储桶失败，请检查 Cloudflare API 配置。'
        }
      };
    }
  });

  // Handler for deleting bucket (with clear objects first)
  ipcMain.handle('settings:deleteBucket', async (event, payload) => {
    try {
      const r2Settings = resolveR2Settings(payload || {}, { requireBucket: false });
      const cfApiConfig = resolveCloudflareApiConfig(r2Settings);

      const bucketName = String(payload?.bucketName || '').trim();
      if (!bucketName) {
        return {
          success: false,
          error: {
            message: 'Bucket name is required',
            userMessage: UI_TEXT.bucketRequired || '请填写桶名'
          }
        };
      }
      if (!isValidBucketName(bucketName)) {
        return {
          success: false,
          error: {
            message: 'Invalid bucket name',
            userMessage: '桶名必须为 3-64 位，只允许小写字母、数字和连字符。'
          }
        };
      }

      const inputAccessKeyId = typeof payload?.accessKeyId === 'string' ? payload.accessKeyId.trim() : '';
      const inputSecretAccessKey = typeof payload?.secretAccessKey === 'string' ? payload.secretAccessKey.trim() : '';
      let credentials = null;
      if (inputAccessKeyId && inputSecretAccessKey) {
        credentials = {
          accessKeyId: inputAccessKeyId,
          secretAccessKey: inputSecretAccessKey
        };
      } else {
        credentials = resolveCredentials();
      }

      if (!CredentialManager.validateCredentials(credentials)) {
        return {
          success: false,
          error: {
            message: 'Missing credentials',
            userMessage: UI_TEXT.errorAuthDetail || '请先在设置中配置 R2 凭证'
          }
        };
      }

      const deletedObjects = await clearBucketObjectsViaS3({
        endpoint: r2Settings.endpoint,
        region: r2Settings.region,
        bucket: bucketName,
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey
      });

      await callCloudflareR2Api({
        method: 'DELETE',
        accountId: cfApiConfig.accountId,
        apiToken: cfApiConfig.apiToken,
        jurisdiction: cfApiConfig.jurisdiction,
        path: `/r2/buckets/${encodeURIComponent(bucketName)}`
      });

      return {
        success: true,
        data: {
          deletedObjects
        }
      };
    } catch (error) {
      ErrorLogger.logError(error, 'settings:deleteBucket');
      return {
        success: false,
        error: {
          message: error.message,
          userMessage: error.userMessage || '删除存储桶失败，请检查桶权限与 Cloudflare API 配置。'
        }
      };
    }
  });

  // Handler for syncing current bucket configuration from remote
  ipcMain.handle('settings:syncBucketState', async (event, payload) => {
    try {
      const data = await syncCurrentBucketFromRemote(payload || {});
      return { success: true, data };
    } catch (error) {
      ErrorLogger.logError(error, 'settings:syncBucketState');
      return {
        success: false,
        error: {
          message: error.message,
          userMessage: error.userMessage || UI_TEXT.bucketLoadFailed || '同步存储桶配置失败'
        }
      };
    }
  });

  // Handler for getting a bucket detail snapshot
  ipcMain.handle('settings:getBucketDetail', async (event, payload) => {
    try {
      const r2Settings = resolveR2Settings(payload || {}, { requireBucket: false });
      const bucketName = String(payload?.bucketName || r2Settings.bucket || '').trim();
      if (!bucketName) {
        return {
          success: false,
          error: {
            message: 'Bucket name is required',
            userMessage: UI_TEXT.bucketRequired || '请填写桶名'
          }
        };
      }

      const cfApiConfig = resolveCloudflareApiConfig(r2Settings);
      const data = await getBucketDetailsViaCloudflareApi(cfApiConfig, bucketName);
      return { success: true, data };
    } catch (error) {
      ErrorLogger.logError(error, 'settings:getBucketDetail');
      return {
        success: false,
        error: {
          message: error.message,
          userMessage: error.userMessage || '获取存储桶详情失败'
        }
      };
    }
  });

  // Handler for listing custom domains of a bucket
  ipcMain.handle('settings:listCustomDomains', async (event, payload) => {
    try {
      const r2Settings = resolveR2Settings(payload || {}, { requireBucket: false });
      const bucketName = String(payload?.bucketName || r2Settings.bucket || '').trim();
      if (!bucketName) {
        return {
          success: false,
          error: {
            message: 'Bucket name is required',
            userMessage: UI_TEXT.bucketRequired || '请填写桶名'
          }
        };
      }

      const cfApiConfig = resolveCloudflareApiConfig(r2Settings);
      const data = await listCustomDomainsViaCloudflareApi(cfApiConfig, bucketName);
      return { success: true, data };
    } catch (error) {
      ErrorLogger.logError(error, 'settings:listCustomDomains');
      return {
        success: false,
        error: {
          message: error.message,
          userMessage: error.userMessage || '加载自定义域名失败'
        }
      };
    }
  });

  // Handler for listing available Cloudflare domains (zones)
  ipcMain.handle('settings:listAvailableDomains', async (event, payload) => {
    try {
      const r2Settings = resolveR2Settings(payload || {}, { requireBucket: false });
      const cfApiConfig = resolveCloudflareApiConfig(r2Settings);
      const data = await listAvailableDomainsViaCloudflareApi(cfApiConfig);
      return { success: true, data };
    } catch (error) {
      ErrorLogger.logError(error, 'settings:listAvailableDomains');
      return {
        success: false,
        error: {
          message: error.message,
          userMessage: error.userMessage || '加载可用域名失败，请检查 Cloudflare Zone 读取权限。'
        }
      };
    }
  });

  // Handler for creating custom domain binding
  ipcMain.handle('settings:createCustomDomain', async (event, payload) => {
    try {
      const r2Settings = resolveR2Settings(payload || {}, { requireBucket: false });
      const bucketName = String(payload?.bucketName || r2Settings.bucket || '').trim();
      const domain = String(payload?.domain || '').trim();
      const zoneId = String(payload?.zoneId || '').trim();
      const enabled = payload?.enabled !== false;
      const minTLS = String(payload?.minTLS || '').trim();
      const ciphers = Array.isArray(payload?.ciphers) ? payload.ciphers.filter(Boolean) : [];

      if (!bucketName) {
        return {
          success: false,
          error: {
            message: 'Bucket name is required',
            userMessage: UI_TEXT.bucketRequired || '请填写桶名'
          }
        };
      }
      if (!domain || !zoneId) {
        return {
          success: false,
          error: {
            message: 'Domain and zoneId are required',
            userMessage: '请填写完整的自定义域名和 Zone ID。'
          }
        };
      }

      const body = {
        domain,
        zoneId,
        enabled
      };
      if (minTLS) {
        body.minTLS = minTLS;
      }
      if (ciphers.length > 0) {
        body.ciphers = ciphers;
      }

      const cfApiConfig = resolveCloudflareApiConfig(r2Settings);
      const result = await callCloudflareR2Api({
        method: 'POST',
        accountId: cfApiConfig.accountId,
        apiToken: cfApiConfig.apiToken,
        jurisdiction: cfApiConfig.jurisdiction,
        path: `/r2/buckets/${encodeURIComponent(bucketName)}/domains/custom`,
        body
      });

      return {
        success: true,
        data: normalizeCustomDomainInfo(result || body)
      };
    } catch (error) {
      ErrorLogger.logError(error, 'settings:createCustomDomain');
      return {
        success: false,
        error: {
          message: error.message,
          userMessage: error.userMessage || '绑定自定义域名失败'
        }
      };
    }
  });

  // Handler for updating custom domain binding
  ipcMain.handle('settings:updateCustomDomain', async (event, payload) => {
    try {
      const r2Settings = resolveR2Settings(payload || {}, { requireBucket: false });
      const bucketName = String(payload?.bucketName || r2Settings.bucket || '').trim();
      const currentDomain = String(payload?.currentDomain || payload?.domain || '').trim();
      const domain = String(payload?.domain || '').trim();
      const zoneId = String(payload?.zoneId || '').trim();
      const enabled = payload?.enabled !== false;
      const minTLS = String(payload?.minTLS || '').trim();
      const ciphers = Array.isArray(payload?.ciphers) ? payload.ciphers.filter(Boolean) : [];

      if (!bucketName || !currentDomain || !domain || !zoneId) {
        return {
          success: false,
          error: {
            message: 'Bucket name, domain and zoneId are required',
            userMessage: '请填写完整的桶名、域名和 Zone ID。'
          }
        };
      }

      const body = {
        domain,
        zoneId,
        enabled
      };
      if (minTLS) {
        body.minTLS = minTLS;
      }
      if (ciphers.length > 0) {
        body.ciphers = ciphers;
      }

      const cfApiConfig = resolveCloudflareApiConfig(r2Settings);
      const result = await callCloudflareR2Api({
        method: 'PUT',
        accountId: cfApiConfig.accountId,
        apiToken: cfApiConfig.apiToken,
        jurisdiction: cfApiConfig.jurisdiction,
        path: `/r2/buckets/${encodeURIComponent(bucketName)}/domains/custom/${encodeURIComponent(currentDomain)}`,
        body
      });

      return {
        success: true,
        data: normalizeCustomDomainInfo(result || body)
      };
    } catch (error) {
      ErrorLogger.logError(error, 'settings:updateCustomDomain');
      return {
        success: false,
        error: {
          message: error.message,
          userMessage: error.userMessage || '更新自定义域名失败'
        }
      };
    }
  });

  // Handler for deleting custom domain binding
  ipcMain.handle('settings:deleteCustomDomain', async (event, payload) => {
    try {
      const r2Settings = resolveR2Settings(payload || {}, { requireBucket: false });
      const bucketName = String(payload?.bucketName || r2Settings.bucket || '').trim();
      const domain = String(payload?.domain || '').trim();

      if (!bucketName || !domain) {
        return {
          success: false,
          error: {
            message: 'Bucket name and domain are required',
            userMessage: '请先选择桶并填写要删除的域名。'
          }
        };
      }

      const cfApiConfig = resolveCloudflareApiConfig(r2Settings);
      await callCloudflareR2Api({
        method: 'DELETE',
        accountId: cfApiConfig.accountId,
        apiToken: cfApiConfig.apiToken,
        jurisdiction: cfApiConfig.jurisdiction,
        path: `/r2/buckets/${encodeURIComponent(bucketName)}/domains/custom/${encodeURIComponent(domain)}`
      });

      return { success: true };
    } catch (error) {
      ErrorLogger.logError(error, 'settings:deleteCustomDomain');
      return {
        success: false,
        error: {
          message: error.message,
          userMessage: error.userMessage || '删除自定义域名失败'
        }
      };
    }
  });

  // Handler for getting r2.dev managed domain config
  ipcMain.handle('settings:getManagedDomain', async (event, payload) => {
    try {
      const r2Settings = resolveR2Settings(payload || {}, { requireBucket: false });
      const bucketName = String(payload?.bucketName || r2Settings.bucket || '').trim();
      if (!bucketName) {
        return {
          success: false,
          error: {
            message: 'Bucket name is required',
            userMessage: UI_TEXT.bucketRequired || '请填写桶名'
          }
        };
      }

      const cfApiConfig = resolveCloudflareApiConfig(r2Settings);
      const data = await getManagedDomainViaCloudflareApi(cfApiConfig, bucketName);
      return { success: true, data };
    } catch (error) {
      ErrorLogger.logError(error, 'settings:getManagedDomain');
      return {
        success: false,
        error: {
          message: error.message,
          userMessage: error.userMessage || '获取 r2.dev 配置失败'
        }
      };
    }
  });

  // Handler for updating r2.dev managed domain config
  ipcMain.handle('settings:updateManagedDomain', async (event, payload) => {
    try {
      const r2Settings = resolveR2Settings(payload || {}, { requireBucket: false });
      const bucketName = String(payload?.bucketName || r2Settings.bucket || '').trim();
      if (!bucketName) {
        return {
          success: false,
          error: {
            message: 'Bucket name is required',
            userMessage: UI_TEXT.bucketRequired || '请填写桶名'
          }
        };
      }

      const cfApiConfig = resolveCloudflareApiConfig(r2Settings);
      await callCloudflareR2Api({
        method: 'PUT',
        accountId: cfApiConfig.accountId,
        apiToken: cfApiConfig.apiToken,
        jurisdiction: cfApiConfig.jurisdiction,
        path: `/r2/buckets/${encodeURIComponent(bucketName)}/domains/managed`,
        body: {
          enabled: Boolean(payload?.enabled)
        }
      });

      const data = await getManagedDomainViaCloudflareApi(cfApiConfig, bucketName);
      return { success: true, data };
    } catch (error) {
      ErrorLogger.logError(error, 'settings:updateManagedDomain');
      return {
        success: false,
        error: {
          message: error.message,
          userMessage: error.userMessage || '更新 r2.dev 配置失败'
        }
      };
    }
  });
  
  // Handler for opening settings window
  ipcMain.handle('settings:openWindow', async (event) => {
    try {
      createSettingsWindow();
      return { success: true };
    } catch (error) {
      ErrorLogger.logError(error, 'settings:openWindow');
      return {
        success: false,
        error: {
          message: error.message,
          userMessage: UI_TEXT.errorUnknown || '打开设置窗口失败'
        }
      };
    }
  });
}

/**
 * Format bytes to human-readable string
 * @param {number} bytes - Number of bytes
 * @returns {string} Formatted string (e.g., "1.5 MB")
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}


