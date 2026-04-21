// 加载环境变量
require('dotenv').config();

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');

// Import i18n UI text strings
const { UI_TEXT } = require('../../i18n/zh-CN');

// Import application services
const { CredentialManager } = require('./application/CredentialManager');
const { R2Client } = require('./infrastructure/R2Client');
const { StorageService, URLFormat } = require('./application/StorageService');
const { ClipboardManager } = require('./infrastructure/ClipboardManager');
const { ErrorLogger } = require('./application/ErrorLogger');
const { ErrorHandler, ErrorAction } = require('./infrastructure/ErrorHandler');

let mainWindow;
let storageService;
let previewWindow = null;

// 导出配置函数供其他模块使用
module.exports = {};

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
app.on('ready', () => {
  // Initialize services using CredentialManager
  try {
    // Step 1: Load credentials and get configuration using CredentialManager
    const config = CredentialManager.getConfig();
    
    // Step 2: Initialize R2Client with configuration
    const r2Client = new R2Client(config);
    
    // Step 3: Initialize StorageService with R2Client
    storageService = new StorageService(r2Client);
  } catch (error) {
    // Step 4: Handle initialization errors with Simplified Chinese error dialog
    // Determine the appropriate error message
    let errorTitle = UI_TEXT.mainWindowTitle;
    let errorMessage = UI_TEXT.errorUnknown;
    
    if (error.code === 'MISSING_CREDENTIALS' || error.code === 'INVALID_CREDENTIALS') {
      // Credentials missing or invalid - show authentication error with details
      errorMessage = `${UI_TEXT.errorAuth}\n\n${UI_TEXT.errorAuthDetail}`;
    } else {
      // Other initialization errors
      errorMessage = `无法初始化存储服务: ${error.message}`;
    }
    
    dialog.showErrorBox(errorTitle, errorMessage);
    app.quit();
    return;
  }

  // Register dialog handlers
  registerDialogHandlers();

  // Register IPC handlers
  registerIPCHandlers();

  // Register settings handlers
  registerSettingsHandlers();

  createWindow();
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
            const objects = await storageService.listObjects();
            event.sender.send('storage:list:updated', { objects });
          } catch (refreshError) {
            ErrorLogger.logError(refreshError, 'error:refresh');
          }
        },
        onReauth: async () => {
          // Check credentials and show appropriate message
          try {
            CredentialManager.validateCredentials(CredentialManager.loadCredentials());
            // If validation passes, credentials might be correct but permissions are wrong
            await dialog.showMessageBox(mainWindow, {
              type: 'info',
              buttons: [UI_TEXT.dialogButtonOk],
              title: UI_TEXT.mainWindowTitle,
              message: UI_TEXT.errorAuthDetail || '请确认环境变量 R2_ACCESS_KEY_ID 和 R2_SECRET_ACCESS_KEY 已正确设置'
            });
          } catch (credError) {
            // Credentials are invalid
            await dialog.showMessageBox(mainWindow, {
              type: 'error',
              buttons: [UI_TEXT.dialogButtonOk],
              title: UI_TEXT.mainWindowTitle,
              message: UI_TEXT.errorAuth || '认证失败，请检查 API 凭证配置',
              detail: UI_TEXT.errorAuthDetail || '请确认环境变量 R2_ACCESS_KEY_ID 和 R2_SECRET_ACCESS_KEY 已正确设置'
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
      const objects = await storageService.listObjects();
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

      const result = await storageService.uploadFile(filePath, onProgress);
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

      const result = await storageService.uploadBuffer(name, nodeBuffer, type, onProgress);
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

      await storageService.downloadFile(key, savePath, onProgress);
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
      await storageService.deleteFile(key);
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
      const result = await storageService.deleteFiles(keys);
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
          const downloadedFormatted = formatBytes(loaded);
          const totalFormatted = formatBytes(totalBytes);
          
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
        
        await storageService.downloadFile(key, savePath, onProgress);
        results.downloaded.push(key);
      } catch (error) {
        ErrorLogger.logError(error, 'storage:download-batch', { key, folderPath });
        results.errors.push({ key, error: error.message });
      }
    }
    
    return { success: true, data: results };
  });

  // Handler for previewing files
  ipcMain.handle('storage:preview', async (event, key) => {
    try {
      // 先创建预览窗口显示加载状态
      createPreviewWindow({ key, loading: true });
      
      // 然后加载文件内容
      const previewData = await storageService.previewFile(key);
      
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
      // Get formatted URL
      const formattedUrl = await storageService.getFileUrl(key, format || URLFormat.URL);
      
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
    try {
      // Try to load from secure storage first
      const { safeStorage } = require('electron');
      const Store = require('electron-store');
      const store = new Store({ name: 'credentials' });
      
      const encryptedAccessKey = store.get('accessKeyId');
      const encryptedSecretKey = store.get('secretAccessKey');
      
      if (encryptedAccessKey && encryptedSecretKey) {
        // Decrypt credentials
        let accessKeyId, secretAccessKey;
        
        if (safeStorage.isEncryptionAvailable()) {
          accessKeyId = safeStorage.decryptString(Buffer.from(encryptedAccessKey, 'base64'));
          secretAccessKey = safeStorage.decryptString(Buffer.from(encryptedSecretKey, 'base64'));
        } else {
          // Fallback to base64 decode (less secure)
          accessKeyId = Buffer.from(encryptedAccessKey, 'base64').toString('utf8');
          secretAccessKey = Buffer.from(encryptedSecretKey, 'base64').toString('utf8');
        }
        
        return {
          success: true,
          data: { accessKeyId, secretAccessKey }
        };
      }
      
      // Fall back to environment variables
      const credentials = CredentialManager.loadCredentials();
      return {
        success: true,
        data: credentials
      };
    } catch (error) {
      // If no stored credentials, try environment variables
      try {
        const credentials = CredentialManager.loadCredentials();
        return {
          success: true,
          data: credentials
        };
      } catch (envError) {
        // No credentials available
        return {
          success: true,
          data: null
        };
      }
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
        const config = {
          endpoint: 'https://12b1178bf0856d6e0b7d787ebd43cee5.r2.cloudflarestorage.com',
          region: 'auto',
          bucket: 'picture',
          accessKeyId,
          secretAccessKey
        };
        
        const r2Client = new R2Client(config);
        storageService = new StorageService(r2Client);
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
  ipcMain.handle('settings:testConnection', async (event, credentials) => {
    try {
      const { accessKeyId, secretAccessKey } = credentials;
      
      if (!accessKeyId || !secretAccessKey) {
        return {
          success: false,
          error: {
            message: 'Missing credentials',
            userMessage: UI_TEXT.credentialsValidateFailed || '请输入完整的凭证信息'
          }
        };
      }
      
      // Create a test R2Client
      const testConfig = {
        endpoint: 'https://12b1178bf0856d6e0b7d787ebd43cee5.r2.cloudflarestorage.com',
        region: 'auto',
        bucket: 'picture',
        accessKeyId,
        secretAccessKey
      };
      
      const testClient = new R2Client(testConfig);
      
      // Try to list objects (limited) to test connection
      await testClient.listObjects();
      
      return { success: true };
    } catch (error) {
      ErrorLogger.logError(error, 'settings:testConnection');
      
      const userMessage = ErrorHandler.getUserMessage(error);
      
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
  ipcMain.handle('settings:listBuckets', async (event) => {
    try {
      // Use S3Client to list buckets
      const { S3Client, ListBucketsCommand } = require('@aws-sdk/client-s3');
      
      // Get current credentials
      let credentials;
      try {
        const credResult = await ipcMain.invoke('settings:getCredentials');
        credentials = credResult.data;
      } catch {
        credentials = CredentialManager.loadCredentials();
      }
      
      const client = new S3Client({
        endpoint: 'https://12b1178bf0856d6e0b7d787ebd43cee5.r2.cloudflarestorage.com',
        region: 'auto',
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
      
      const userMessage = ErrorHandler.getUserMessage(error);
      
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
      const Store = require('electron-store');
      const store = new Store({ name: 'settings' });
      
      const bucket = store.get('currentBucket', 'picture');
      
      return { success: true, data: bucket };
    } catch (error) {
      // Return default bucket
      return { success: true, data: 'picture' };
    }
  });
  
  // Handler for setting current bucket
  ipcMain.handle('settings:setCurrentBucket', async (event, bucket) => {
    try {
      const Store = require('electron-store');
      const store = new Store({ name: 'settings' });
      
      store.set('currentBucket', bucket);
      
      // Update the current storageService with new bucket
      try {
        const credentials = CredentialManager.loadCredentials();
        const config = {
          endpoint: 'https://12b1178bf0856d6e0b7d787ebd43cee5.r2.cloudflarestorage.com',
          region: 'auto',
          bucket: bucket,
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey
        };
        
        const r2Client = new R2Client(config);
        storageService = new StorageService(r2Client);
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


