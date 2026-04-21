// 加载环境变量
require('dotenv').config();

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');

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
const STARTUP_CHECK_TIMEOUT_MS = 10000;

const StartupCheckStatus = {
  OK: 'OK',
  MISSING_CREDENTIALS: 'MISSING_CREDENTIALS',
  INVALID_SETTINGS: 'INVALID_SETTINGS',
  CONNECTION_FAILED: 'CONNECTION_FAILED'
};

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
 * 获取并标准化 R2 配置（endpoint/region/bucket/publicUrl）
 * @returns {{endpoint: string, region: string, bucket: string, publicUrl: string}}
 */
function getR2Settings() {
  try {
    const Store = require('electron-store');
    const store = new Store({ name: 'settings' });

    const endpointRaw = store.get('r2Endpoint', process.env.R2_ENDPOINT || DEFAULT_R2_ENDPOINT);
    const regionRaw = store.get('r2Region', process.env.R2_REGION || DEFAULT_R2_REGION);
    const bucketRaw = store.get('currentBucket', process.env.R2_BUCKET || DEFAULT_R2_BUCKET);
    const publicUrlRaw = store.get('r2PublicUrl', process.env.R2_PUBLIC_URL || DEFAULT_R2_PUBLIC_URL);

    let endpoint;
    let publicUrl;
    try {
      endpoint = normalizeUrl(endpointRaw);
    } catch {
      endpoint = DEFAULT_R2_ENDPOINT;
    }

    try {
      publicUrl = normalizeUrl(publicUrlRaw, { allowEmpty: true });
    } catch {
      publicUrl = DEFAULT_R2_PUBLIC_URL;
    }

    const region = String(regionRaw || DEFAULT_R2_REGION).trim() || DEFAULT_R2_REGION;
    const bucket = String(bucketRaw || DEFAULT_R2_BUCKET).trim() || DEFAULT_R2_BUCKET;

    return {
      endpoint,
      region,
      bucket,
      publicUrl
    };
  } catch {
    return {
      endpoint: DEFAULT_R2_ENDPOINT,
      region: DEFAULT_R2_REGION,
      bucket: DEFAULT_R2_BUCKET,
      publicUrl: DEFAULT_R2_PUBLIC_URL
    };
  }
}

/**
 * 合并并标准化 R2 配置
 * @param {Object} input - 输入配置（可选）
 * @returns {{endpoint: string, region: string, bucket: string, publicUrl: string}}
 */
function resolveR2Settings(input = {}, options = {}) {
  const { requireBucket = true } = options;
  const base = getR2Settings();

  const merged = {
    endpoint: typeof input.endpoint === 'string' ? input.endpoint : base.endpoint,
    region: typeof input.region === 'string' ? input.region : base.region,
    bucket: typeof input.bucket === 'string' ? input.bucket : base.bucket,
    publicUrl: typeof input.publicUrl === 'string' ? input.publicUrl : base.publicUrl
  };

  const endpoint = normalizeUrl(merged.endpoint);
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
    publicUrl
  };
}

/**
 * 保存 R2 配置到本地设置
 * @param {Object} input - 输入配置（至少包含 endpoint/region/bucket/publicUrl 中的一部分）
 * @returns {{endpoint: string, region: string, bucket: string, publicUrl: string}} 已保存配置
 */
function saveR2Settings(input = {}) {
  const settings = resolveR2Settings(input);
  const Store = require('electron-store');
  const store = new Store({ name: 'settings' });

  store.set('r2Endpoint', settings.endpoint);
  store.set('r2Region', settings.region);
  store.set('currentBucket', settings.bucket);
  store.set('r2PublicUrl', settings.publicUrl);

  return settings;
}

/**
 * 从本地安全存储读取凭证
 * @returns {Object|null} 凭证对象或 null
 */
function loadStoredCredentials() {
  try {
    const { safeStorage } = require('electron');
    const Store = require('electron-store');
    const store = new Store({ name: 'credentials' });

    const encryptedAccessKey = store.get('accessKeyId');
    const encryptedSecretKey = store.get('secretAccessKey');

    if (!encryptedAccessKey || !encryptedSecretKey) {
      return null;
    }

    let accessKeyId;
    let secretAccessKey;

    if (safeStorage.isEncryptionAvailable()) {
      accessKeyId = safeStorage.decryptString(Buffer.from(encryptedAccessKey, 'base64'));
      secretAccessKey = safeStorage.decryptString(Buffer.from(encryptedSecretKey, 'base64'));
    } else {
      accessKeyId = Buffer.from(encryptedAccessKey, 'base64').toString('utf8');
      secretAccessKey = Buffer.from(encryptedSecretKey, 'base64').toString('utf8');
    }

    const credentials = { accessKeyId, secretAccessKey };
    return CredentialManager.validateCredentials(credentials) ? credentials : null;
  } catch (error) {
    ErrorLogger.logError(error, 'credentials:loadStored');
    return null;
  }
}

/**
 * 解析当前可用凭证（优先本地保存，其次环境变量）
 * @returns {Object|null} 凭证对象或 null
 */
function resolveCredentials() {
  const storedCredentials = loadStoredCredentials();
  if (storedCredentials) {
    return storedCredentials;
  }

  try {
    const envCredentials = CredentialManager.loadCredentials();
    return CredentialManager.validateCredentials(envCredentials) ? envCredentials : null;
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

    // 启动时做一次轻量连接探测，失败则提示用户检查配置
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

  let message = UI_TEXT.startupCheckMessageConnectionFailed || '启动检查失败：无法连接到 R2，请检查配置。';
  let detail = UI_TEXT.startupCheckDetail || '可点击“检查配置”打开设置页面。';

  if (startupCheckResult.status === StartupCheckStatus.MISSING_CREDENTIALS) {
    message = UI_TEXT.startupCheckMessageMissingCredentials || '启动检查发现未配置凭证，请先完成配置。';
    detail = UI_TEXT.errorAuthDetail || '请先在“设置 > 凭证配置”中填写 R2 凭证，或正确设置环境变量 R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY';
  } else if (startupCheckResult.status === StartupCheckStatus.INVALID_SETTINGS) {
    message = UI_TEXT.startupCheckMessageInvalidSettings || '启动检查发现 R2 配置无效，请检查 S3 地址、区域、桶名等设置。';
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
    parent: mainWindow,
    modal: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    icon: path.join(__dirname, '../../assets/icon.ico'),
    autoHideMenuBar: true
  });
  
  // 加载预览窗口 HTML
  previewWindow.loadFile(path.join(__dirname, '../renderer/preview.html'));
  
  // 当预览窗口准备好时，发送预览数据
  previewWindow.webContents.on('did-finish-load', () => {
    previewWindow.webContents.send('preview:data', previewData);
  });
  
  // 监听预览窗口准备好的消息
  ipcMain.on('preview:ready', () => {
    if (previewWindow && previewData) {
      previewWindow.webContents.send('preview:data', previewData);
    }
  });
  
  // 窗口关闭时清理引用
  previewWindow.on('closed', () => {
    previewWindow = null;
  });
  
  // 开发环境下打开开发者工具（可选）
  // previewWindow.webContents.openDevTools();
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
    icon: path.join(__dirname, '../../assets/icon.ico')
  });

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

  // Register dialog handlers
  registerDialogHandlers();

  // Register IPC handlers
  registerIPCHandlers();

  // Register settings handlers
  registerSettingsHandlers();

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
        filters: [
          { name: '所有文件', extensions: ['*'] },
          { name: '图片文件', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'] },
          { name: '文本文件', extensions: ['txt', 'md', 'json', 'xml', 'html', 'css', 'js', 'ts', 'yaml', 'yml', 'log'] }
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
            const objects = await activeStorageService.listObjects();
            event.sender.send('storage:list:updated', { objects });
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
  ipcMain.handle('storage:list', async (event) => {
    try {
      const activeStorageService = getStorageServiceOrThrow('list');
      const objects = await activeStorageService.listObjects();
      return { success: true, data: objects };
    } catch (error) {
      ErrorLogger.logError(error, 'storage:list');
      
      // Get user-friendly message
      const userMessage = ErrorHandler.getUserMessage(error);
      
      return {
        success: false,
        error: {
          message: error.message,
          userMessage: userMessage,
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
  ipcMain.handle('storage:upload', async (event, filePath) => {
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

      const result = await activeStorageService.uploadFile(filePath, onProgress);
      return { success: true, data: result };
    } catch (error) {
      ErrorLogger.logError(error, 'storage:upload', { filePath });
      
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
      const previewData = await activeStorageService.previewFile(key);
      
      // 添加 key 到预览数据
      previewData.key = key;
      
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
        endpoint: r2Config?.endpoint,
        region: r2Config?.region,
        bucket: r2Config?.bucket,
        publicUrl: r2Config?.publicUrl
      });

      try {
        const credentials = resolveCredentials();
        if (credentials) {
          initializeStorageService(credentials, savedConfig);
        } else {
          storageService = null;
        }
      } catch (updateError) {
        ErrorLogger.logError(updateError, 'settings:saveR2Config:update');
      }

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
      const { accessKeyId, secretAccessKey, encrypt } = credentials;
      
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
      
      // Store credentials securely
      const { safeStorage } = require('electron');
      const Store = require('electron-store');
      const store = new Store({ name: 'credentials' });
      
      if (encrypt !== false && safeStorage.isEncryptionAvailable()) {
        // Encrypt and store
        const encryptedAccessKey = safeStorage.encryptString(accessKeyId).toString('base64');
        const encryptedSecretKey = safeStorage.encryptString(secretAccessKey).toString('base64');
        
        store.set('accessKeyId', encryptedAccessKey);
        store.set('secretAccessKey', encryptedSecretKey);
      } else {
        // Store with base64 encoding (less secure, but better than plain text)
        store.set('accessKeyId', Buffer.from(accessKeyId).toString('base64'));
        store.set('secretAccessKey', Buffer.from(secretAccessKey).toString('base64'));
      }
      
      // Update the current storageService with new credentials
      try {
        initializeStorageService({ accessKeyId, secretAccessKey }, getR2Settings());
      } catch (updateError) {
        ErrorLogger.logError(updateError, 'settings:saveCredentials:update');
        // Still return success since credentials were saved
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
      const store = new Store({ name: 'credentials' });
      
      store.clear();
      storageService = null;
      
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
      // Use S3Client to list buckets
      const { S3Client, ListBucketsCommand } = require('@aws-sdk/client-s3');

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

      const r2Settings = resolveR2Settings(payload || {}, { requireBucket: false });

      const client = new S3Client({
        endpoint: r2Settings.endpoint,
        region: r2Settings.region,
        credentials: {
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey
        }
      });
      
      const command = new ListBucketsCommand({});
      const response = await client.send(command);
      
      const buckets = (response.Buckets || []).map(bucket => ({
        name: bucket.Name,
        creationDate: bucket.CreationDate
      }));
      
      return { success: true, data: buckets };
    } catch (error) {
      ErrorLogger.logError(error, 'settings:listBuckets');

      const isAccessDenied =
        error?.name === 'AccessDenied' ||
        error?.Code === 'AccessDenied' ||
        error?.code === 'AccessDenied' ||
        error?.$metadata?.httpStatusCode === 403;

      if (isAccessDenied) {
        const payloadBucket = typeof payload?.bucket === 'string' ? payload.bucket.trim() : '';
        const storedBucket = (getR2Settings().bucket || '').trim();
        const fallbackBucket = payloadBucket || storedBucket;
        const fallbackBuckets = fallbackBucket ? [{ name: fallbackBucket, creationDate: null }] : [];

        return {
          success: true,
          data: fallbackBuckets,
          warning: {
            code: 'ACCESS_DENIED',
            userMessage: '当前 Access Key 没有“列出存储桶”权限，已切换为手动桶名模式。请直接填写桶名，或在 Cloudflare R2 为该密钥增加 ListBuckets/All Buckets 权限。'
          }
        };
      }

      let userMessage = ErrorHandler.getUserMessage(error);
      if (error.message === 'URL is required') {
        userMessage = UI_TEXT.endpointRequired || '请填写 S3 地址（Endpoint）';
      }

      return {
        success: false,
        error: {
          message: error.message,
          userMessage: userMessage || UI_TEXT.bucketLoadFailed || '加载存储桶列表失败'
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
      const savedConfig = saveR2Settings({ bucket });
      
      // Update the current storageService with new bucket
      try {
        const credentials = resolveCredentials();
        if (credentials) {
          initializeStorageService(credentials, savedConfig);
        } else {
          storageService = null;
        }
      } catch (updateError) {
        ErrorLogger.logError(updateError, 'settings:setCurrentBucket:update');
      }
      
      return { success: true };
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


