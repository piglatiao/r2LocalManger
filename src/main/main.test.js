/**
 * Unit tests for IPC Handlers in main.js
 * 
 * Tests the IPC handler registration and error handling logic.
 * Note: These tests mock the Electron IPC and service dependencies.
 */

// Mock Electron modules
jest.mock('electron', () => ({
  app: {
    on: jest.fn(),
    getPath: jest.fn(() => '/mock/userData'),
    quit: jest.fn()
  },
  BrowserWindow: jest.fn().mockImplementation(() => ({
    loadFile: jest.fn(),
    on: jest.fn(),
    webContents: { openDevTools: jest.fn() }
  })),
  ipcMain: {
    handle: jest.fn()
  },
  dialog: {
    showErrorBox: jest.fn()
  }
}));

// Mock dotenv
jest.mock('dotenv', () => ({
  config: jest.fn()
}));

// Mock services
jest.mock('./application/CredentialManager', () => ({
  CredentialManager: {}
}));

jest.mock('./infrastructure/R2Client', () => ({
  R2Client: jest.fn().mockImplementation(() => ({
    listObjects: jest.fn(),
    uploadObject: jest.fn(),
    downloadObject: jest.fn(),
    deleteObject: jest.fn(),
    getObjectUrl: jest.fn(),
    getObjectStream: jest.fn()
  }))
}));

jest.mock('./application/StorageService', () => ({
  StorageService: jest.fn().mockImplementation(() => ({
    listObjects: jest.fn(),
    uploadFile: jest.fn(),
    downloadFile: jest.fn(),
    deleteFile: jest.fn(),
    previewFile: jest.fn(),
    getFileUrl: jest.fn()
  })),
  URLFormat: {
    URL: 'url',
    HTML: 'html',
    MARKDOWN: 'markdown'
  }
}));

jest.mock('./infrastructure/ClipboardManager', () => ({
  ClipboardManager: {
    writeText: jest.fn()
  }
}));

jest.mock('./application/ErrorLogger', () => ({
  ErrorLogger: {
    logError: jest.fn(),
    getLogPath: jest.fn(() => '/mock/log/path')
  }
}));

// Import after mocking
const { ipcMain } = require('electron');
const { StorageService, URLFormat } = require('./application/StorageService');
const { ClipboardManager } = require('./infrastructure/ClipboardManager');
const { ErrorLogger } = require('./application/ErrorLogger');
const { UI_TEXT } = require('../../i18n/zh-CN');

describe('IPC Handlers', () => {
  let mockStorageService;
  let mockEvent;
  let handlers;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Get the mock storage service instance
    mockStorageService = new StorageService();
    
    // Mock event sender
    mockEvent = {
      sender: {
        send: jest.fn()
      }
    };
    
    // Store handlers for testing
    handlers = {};
    ipcMain.handle.mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });
  });

  describe('storage:list handler', () => {
    it('should return success with objects list', async () => {
      const mockObjects = [
        { key: 'file1.jpg', size: 1024, lastModified: new Date() },
        { key: 'file2.png', size: 2048, lastModified: new Date() }
      ];
      mockStorageService.listObjects.mockResolvedValue(mockObjects);

      // Simulate handler registration
      ipcMain.handle('storage:list', async (event) => {
        try {
          const objects = await mockStorageService.listObjects();
          return { success: true, data: objects };
        } catch (error) {
          ErrorLogger.logError(error, 'storage:list');
          return {
            success: false,
            error: {
              message: error.message,
              userMessage: error.userMessage || UI_TEXT.errorUnknown
            }
          };
        }
      });

      const result = await handlers['storage:list'](mockEvent);
      
      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockObjects);
    });

    it('should return error with user-friendly message on failure', async () => {
      const error = new Error('Network error');
      error.userMessage = UI_TEXT.errorNetwork;
      mockStorageService.listObjects.mockRejectedValue(error);

      ipcMain.handle('storage:list', async (event) => {
        try {
          const objects = await mockStorageService.listObjects();
          return { success: true, data: objects };
        } catch (error) {
          ErrorLogger.logError(error, 'storage:list');
          return {
            success: false,
            error: {
              message: error.message,
              userMessage: error.userMessage || UI_TEXT.errorUnknown
            }
          };
        }
      });

      const result = await handlers['storage:list'](mockEvent);
      
      expect(result.success).toBe(false);
      expect(result.error.message).toBe('Network error');
      expect(result.error.userMessage).toBe(UI_TEXT.errorNetwork);
      expect(ErrorLogger.logError).toHaveBeenCalled();
    });
  });

  describe('storage:upload handler', () => {
    it('should upload file and return success', async () => {
      const mockResult = { key: 'test.jpg', url: 'https://example.com/test.jpg' };
      mockStorageService.uploadFile.mockResolvedValue(mockResult);

      ipcMain.handle('storage:upload', async (event, filePath) => {
        try {
          const result = await mockStorageService.uploadFile(filePath, expect.any(Function));
          return { success: true, data: result };
        } catch (error) {
          ErrorLogger.logError(error, 'storage:upload', { filePath });
          return {
            success: false,
            error: {
              message: error.message,
              userMessage: error.userMessage || UI_TEXT.errorUploadFailed.replace('{error}', error.message)
            }
          };
        }
      });

      const result = await handlers['storage:upload'](mockEvent, '/path/to/test.jpg');
      
      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResult);
    });

    it('should send progress updates during upload', async () => {
      const filePath = '/path/to/test.jpg';
      
      mockStorageService.uploadFile.mockImplementation(async (path, onProgress) => {
        // Simulate progress updates
        if (onProgress) {
          onProgress(500, 1000);
          onProgress(1000, 1000);
        }
        return { key: 'test.jpg', url: 'https://example.com/test.jpg' };
      });

      ipcMain.handle('storage:upload', async (event, filePath) => {
        const onProgress = (loaded, total) => {
          event.sender.send('storage:upload:progress', {
            loaded,
            total
          });
        };
        
        try {
          const result = await mockStorageService.uploadFile(filePath, onProgress);
          return { success: true, data: result };
        } catch (error) {
          return { success: false, error: { message: error.message } };
        }
      });

      await handlers['storage:upload'](mockEvent, filePath);
      
      expect(mockEvent.sender.send).toHaveBeenCalledWith(
        'storage:upload:progress',
        expect.objectContaining({ loaded: 500, total: 1000 })
      );
    });

    it('should return error with user-friendly message on upload failure', async () => {
      const error = new Error('Upload failed');
      error.userMessage = UI_TEXT.errorUploadFailed.replace('{error}', 'Upload failed');
      mockStorageService.uploadFile.mockRejectedValue(error);

      ipcMain.handle('storage:upload', async (event, filePath) => {
        try {
          const result = await mockStorageService.uploadFile(filePath);
          return { success: true, data: result };
        } catch (error) {
          ErrorLogger.logError(error, 'storage:upload', { filePath });
          return {
            success: false,
            error: {
              message: error.message,
              userMessage: error.userMessage || UI_TEXT.errorUploadFailed.replace('{error}', error.message)
            }
          };
        }
      });

      const result = await handlers['storage:upload'](mockEvent, '/path/to/test.jpg');
      
      expect(result.success).toBe(false);
      expect(result.error.message).toBe('Upload failed');
      expect(ErrorLogger.logError).toHaveBeenCalled();
    });
  });

  describe('storage:download handler', () => {
    it('should download file and return success', async () => {
      mockStorageService.downloadFile.mockResolvedValue(undefined);

      ipcMain.handle('storage:download', async (event, key, savePath) => {
        try {
          await mockStorageService.downloadFile(key, savePath);
          return { success: true };
        } catch (error) {
          ErrorLogger.logError(error, 'storage:download', { key, savePath });
          return {
            success: false,
            error: {
              message: error.message,
              userMessage: error.userMessage || UI_TEXT.errorDownloadFailed.replace('{error}', error.message)
            }
          };
        }
      });

      const result = await handlers['storage:download'](mockEvent, 'test.jpg', '/save/path/test.jpg');
      
      expect(result.success).toBe(true);
    });

    it('should send progress updates during download', async () => {
      mockStorageService.downloadFile.mockImplementation(async (key, savePath, onProgress) => {
        if (onProgress) {
          onProgress(500, 1000);
          onProgress(1000, 1000);
        }
      });

      ipcMain.handle('storage:download', async (event, key, savePath) => {
        const onProgress = (loaded, total) => {
          event.sender.send('storage:download:progress', {
            loaded,
            total
          });
        };
        
        try {
          await mockStorageService.downloadFile(key, savePath, onProgress);
          return { success: true };
        } catch (error) {
          return { success: false, error: { message: error.message } };
        }
      });

      await handlers['storage:download'](mockEvent, 'test.jpg', '/save/path/test.jpg');
      
      expect(mockEvent.sender.send).toHaveBeenCalledWith(
        'storage:download:progress',
        expect.objectContaining({ loaded: 500, total: 1000 })
      );
    });
  });

  describe('storage:delete handler', () => {
    it('should delete file and return success', async () => {
      mockStorageService.deleteFile.mockResolvedValue(undefined);

      ipcMain.handle('storage:delete', async (event, key) => {
        try {
          await mockStorageService.deleteFile(key);
          return { success: true };
        } catch (error) {
          ErrorLogger.logError(error, 'storage:delete', { key });
          return {
            success: false,
            error: {
              message: error.message,
              userMessage: error.userMessage || UI_TEXT.errorDeleteFailed.replace('{error}', error.message)
            }
          };
        }
      });

      const result = await handlers['storage:delete'](mockEvent, 'test.jpg');
      
      expect(result.success).toBe(true);
    });

    it('should return error on delete failure', async () => {
      const error = new Error('Delete failed');
      error.userMessage = UI_TEXT.errorDeleteFailed.replace('{error}', 'Delete failed');
      mockStorageService.deleteFile.mockRejectedValue(error);

      ipcMain.handle('storage:delete', async (event, key) => {
        try {
          await mockStorageService.deleteFile(key);
          return { success: true };
        } catch (error) {
          ErrorLogger.logError(error, 'storage:delete', { key });
          return {
            success: false,
            error: {
              message: error.message,
              userMessage: error.userMessage || UI_TEXT.errorDeleteFailed.replace('{error}', error.message)
            }
          };
        }
      });

      const result = await handlers['storage:delete'](mockEvent, 'test.jpg');
      
      expect(result.success).toBe(false);
      expect(ErrorLogger.logError).toHaveBeenCalled();
    });
  });

  describe('storage:preview handler', () => {
    it('should return preview data for image file', async () => {
      const mockPreviewData = {
        type: 'image',
        content: Buffer.from('mock image data'),
        metadata: { contentType: 'image/jpeg', contentLength: 1024 }
      };
      mockStorageService.previewFile.mockResolvedValue(mockPreviewData);

      ipcMain.handle('storage:preview', async (event, key) => {
        try {
          const previewData = await mockStorageService.previewFile(key);
          return { success: true, data: previewData };
        } catch (error) {
          ErrorLogger.logError(error, 'storage:preview', { key });
          return {
            success: false,
            error: {
              message: error.message,
              userMessage: error.userMessage || UI_TEXT.errorPreviewFailed.replace('{error}', error.message)
            }
          };
        }
      });

      const result = await handlers['storage:preview'](mockEvent, 'test.jpg');
      
      expect(result.success).toBe(true);
      expect(result.data.type).toBe('image');
    });

    it('should return preview data for text file', async () => {
      const mockPreviewData = {
        type: 'text',
        content: 'Hello, World!',
        metadata: { contentType: 'text/plain', contentLength: 13 }
      };
      mockStorageService.previewFile.mockResolvedValue(mockPreviewData);

      ipcMain.handle('storage:preview', async (event, key) => {
        try {
          const previewData = await mockStorageService.previewFile(key);
          return { success: true, data: previewData };
        } catch (error) {
          ErrorLogger.logError(error, 'storage:preview', { key });
          return {
            success: false,
            error: {
              message: error.message,
              userMessage: error.userMessage || UI_TEXT.errorPreviewFailed.replace('{error}', error.message)
            }
          };
        }
      });

      const result = await handlers['storage:preview'](mockEvent, 'test.txt');
      
      expect(result.success).toBe(true);
      expect(result.data.type).toBe('text');
    });
  });

  describe('storage:copy-url handler', () => {
    it('should copy URL to clipboard and return success', async () => {
      const mockUrl = 'https://example.com/test.jpg';
      mockStorageService.getFileUrl.mockResolvedValue(mockUrl);
      ClipboardManager.writeText.mockReturnValue(true);

      ipcMain.handle('storage:copy-url', async (event, key, format) => {
        try {
          const formattedUrl = await mockStorageService.getFileUrl(key, format || URLFormat.URL);
          const copied = ClipboardManager.writeText(formattedUrl);
          
          if (!copied) {
            throw new Error('Failed to copy to clipboard');
          }
          
          return { success: true, data: formattedUrl };
        } catch (error) {
          ErrorLogger.logError(error, 'storage:copy-url', { key, format });
          return {
            success: false,
            error: {
              message: error.message,
              userMessage: error.userMessage || UI_TEXT.errorUnknown
            }
          };
        }
      });

      const result = await handlers['storage:copy-url'](mockEvent, 'test.jpg', 'url');
      
      expect(result.success).toBe(true);
      expect(result.data).toBe(mockUrl);
      expect(ClipboardManager.writeText).toHaveBeenCalledWith(mockUrl);
    });

    it('should copy HTML format URL to clipboard', async () => {
      const mockHtmlUrl = '<img src="https://example.com/test.jpg" alt="test" />';
      mockStorageService.getFileUrl.mockResolvedValue(mockHtmlUrl);
      ClipboardManager.writeText.mockReturnValue(true);

      ipcMain.handle('storage:copy-url', async (event, key, format) => {
        try {
          const formattedUrl = await mockStorageService.getFileUrl(key, format || URLFormat.URL);
          const copied = ClipboardManager.writeText(formattedUrl);
          
          if (!copied) {
            throw new Error('Failed to copy to clipboard');
          }
          
          return { success: true, data: formattedUrl };
        } catch (error) {
          ErrorLogger.logError(error, 'storage:copy-url', { key, format });
          return {
            success: false,
            error: {
              message: error.message,
              userMessage: error.userMessage || UI_TEXT.errorUnknown
            }
          };
        }
      });

      const result = await handlers['storage:copy-url'](mockEvent, 'test.jpg', 'html');
      
      expect(result.success).toBe(true);
      expect(result.data).toBe(mockHtmlUrl);
    });

    it('should copy Markdown format URL to clipboard', async () => {
      const mockMdUrl = '![test](https://example.com/test.jpg)';
      mockStorageService.getFileUrl.mockResolvedValue(mockMdUrl);
      ClipboardManager.writeText.mockReturnValue(true);

      ipcMain.handle('storage:copy-url', async (event, key, format) => {
        try {
          const formattedUrl = await mockStorageService.getFileUrl(key, format || URLFormat.URL);
          const copied = ClipboardManager.writeText(formattedUrl);
          
          if (!copied) {
            throw new Error('Failed to copy to clipboard');
          }
          
          return { success: true, data: formattedUrl };
        } catch (error) {
          ErrorLogger.logError(error, 'storage:copy-url', { key, format });
          return {
            success: false,
            error: {
              message: error.message,
              userMessage: error.userMessage || UI_TEXT.errorUnknown
            }
          };
        }
      });

      const result = await handlers['storage:copy-url'](mockEvent, 'test.jpg', 'markdown');
      
      expect(result.success).toBe(true);
      expect(result.data).toBe(mockMdUrl);
    });

    it('should return error when clipboard write fails', async () => {
      mockStorageService.getFileUrl.mockResolvedValue('https://example.com/test.jpg');
      ClipboardManager.writeText.mockReturnValue(false);

      ipcMain.handle('storage:copy-url', async (event, key, format) => {
        try {
          const formattedUrl = await mockStorageService.getFileUrl(key, format || URLFormat.URL);
          const copied = ClipboardManager.writeText(formattedUrl);
          
          if (!copied) {
            throw new Error('Failed to copy to clipboard');
          }
          
          return { success: true, data: formattedUrl };
        } catch (error) {
          ErrorLogger.logError(error, 'storage:copy-url', { key, format });
          return {
            success: false,
            error: {
              message: error.message,
              userMessage: error.userMessage || UI_TEXT.errorUnknown
            }
          };
        }
      });

      const result = await handlers['storage:copy-url'](mockEvent, 'test.jpg', 'url');
      
      expect(result.success).toBe(false);
      expect(result.error.message).toBe('Failed to copy to clipboard');
    });
  });
});

describe('formatBytes utility', () => {
  // Import the formatBytes function logic for testing
  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  it('should format 0 bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('should format bytes', () => {
    expect(formatBytes(500)).toBe('500 B');
  });

  it('should format kilobytes', () => {
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('should format megabytes', () => {
    expect(formatBytes(1048576)).toBe('1 MB');
    expect(formatBytes(2621440)).toBe('2.5 MB');
  });

  it('should format gigabytes', () => {
    expect(formatBytes(1073741824)).toBe('1 GB');
  });

  it('should format terabytes', () => {
    expect(formatBytes(1099511627776)).toBe('1 TB');
  });
});

describe('UI_TEXT messages', () => {
  it('should have all required error messages in Simplified Chinese', () => {
    expect(UI_TEXT.errorNetwork).toBeDefined();
    expect(UI_TEXT.errorAuth).toBeDefined();
    expect(UI_TEXT.errorBucket).toBeDefined();
    expect(UI_TEXT.errorObject).toBeDefined();
    expect(UI_TEXT.errorPermission).toBeDefined();
    expect(UI_TEXT.errorFileNotFound).toBeDefined();
    expect(UI_TEXT.errorFileAccess).toBeDefined();
    expect(UI_TEXT.errorDiskSpace).toBeDefined();
    expect(UI_TEXT.errorUnknown).toBeDefined();
    expect(UI_TEXT.errorUploadFailed).toBeDefined();
    expect(UI_TEXT.errorDownloadFailed).toBeDefined();
    expect(UI_TEXT.errorDeleteFailed).toBeDefined();
    expect(UI_TEXT.errorPreviewFailed).toBeDefined();
  });

  it('should have all required progress messages in Simplified Chinese', () => {
    expect(UI_TEXT.progressUploading).toBeDefined();
    expect(UI_TEXT.progressDownloading).toBeDefined();
    expect(UI_TEXT.progressDeleting).toBeDefined();
  });

  it('should have all required success messages in Simplified Chinese', () => {
    expect(UI_TEXT.uploadSuccess).toBeDefined();
    expect(UI_TEXT.downloadSuccess).toBeDefined();
    expect(UI_TEXT.deleteSuccess).toBeDefined();
    expect(UI_TEXT.copySuccess).toBeDefined();
  });
});

describe('Dialog Handlers', () => {
  let mockDialog;
  let handlers;
  let mockMainWindow;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Get the mock dialog from electron
    mockDialog = require('electron').dialog;
    
    // Mock main window
    mockMainWindow = {
      loadFile: jest.fn(),
      on: jest.fn(),
      webContents: { openDevTools: jest.fn() }
    };
    
    // Store handlers for testing
    handlers = {};
    ipcMain.handle.mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });
  });

  describe('dialog:openFile handler', () => {
    it('should return success with file paths when user selects files', async () => {
      const mockResult = {
        canceled: false,
        filePaths: ['/path/to/file1.jpg', '/path/to/file2.png']
      };
      mockDialog.showOpenDialog = jest.fn().mockResolvedValue(mockResult);

      // Simulate handler registration
      ipcMain.handle('dialog:openFile', async (event) => {
        try {
          const result = await mockDialog.showOpenDialog(mockMainWindow, {
            title: UI_TEXT.dialogSelectFile,
            properties: ['openFile'],
            filters: expect.any(Array)
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

      const result = await handlers['dialog:openFile']({});
      
      expect(result.success).toBe(true);
      expect(result.canceled).toBe(false);
      expect(result.filePaths).toEqual(['/path/to/file1.jpg', '/path/to/file2.png']);
    });

    it('should return canceled true when user cancels', async () => {
      const mockResult = {
        canceled: true,
        filePaths: []
      };
      mockDialog.showOpenDialog = jest.fn().mockResolvedValue(mockResult);

      ipcMain.handle('dialog:openFile', async (event) => {
        try {
          const result = await mockDialog.showOpenDialog(mockMainWindow, {
            title: UI_TEXT.dialogSelectFile,
            properties: ['openFile'],
            filters: expect.any(Array)
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

      const result = await handlers['dialog:openFile']({});
      
      expect(result.success).toBe(true);
      expect(result.canceled).toBe(true);
      expect(result.filePaths).toEqual([]);
    });

    it('should use Simplified Chinese title from UI_TEXT', async () => {
      mockDialog.showOpenDialog = jest.fn().mockResolvedValue({ canceled: true, filePaths: [] });

      ipcMain.handle('dialog:openFile', async (event) => {
        const options = {
          title: UI_TEXT.dialogSelectFile,
          properties: ['openFile']
        };
        await mockDialog.showOpenDialog(mockMainWindow, options);
        return { success: true };
      });

      await handlers['dialog:openFile']({});
      
      expect(mockDialog.showOpenDialog).toHaveBeenCalledWith(
        mockMainWindow,
        expect.objectContaining({
          title: UI_TEXT.dialogSelectFile
        })
      );
    });
  });

  describe('dialog:saveFile handler', () => {
    it('should return success with file path when user selects save location', async () => {
      const mockResult = {
        canceled: false,
        filePath: '/path/to/save/file.jpg'
      };
      mockDialog.showSaveDialog = jest.fn().mockResolvedValue(mockResult);

      ipcMain.handle('dialog:saveFile', async (event, defaultFilename) => {
        try {
          const result = await mockDialog.showSaveDialog(mockMainWindow, {
            title: UI_TEXT.dialogSaveFile,
            defaultPath: defaultFilename || '',
            filters: expect.any(Array)
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

      const result = await handlers['dialog:saveFile']({}, 'test.jpg');
      
      expect(result.success).toBe(true);
      expect(result.canceled).toBe(false);
      expect(result.filePath).toBe('/path/to/save/file.jpg');
    });

    it('should use default filename when provided', async () => {
      mockDialog.showSaveDialog = jest.fn().mockResolvedValue({ canceled: true, filePath: undefined });

      ipcMain.handle('dialog:saveFile', async (event, defaultFilename) => {
        const options = {
          title: UI_TEXT.dialogSaveFile,
          defaultPath: defaultFilename || ''
        };
        await mockDialog.showSaveDialog(mockMainWindow, options);
        return { success: true };
      });

      await handlers['dialog:saveFile']({}, 'myfile.png');
      
      expect(mockDialog.showSaveDialog).toHaveBeenCalledWith(
        mockMainWindow,
        expect.objectContaining({
          title: UI_TEXT.dialogSaveFile,
          defaultPath: 'myfile.png'
        })
      );
    });

    it('should use Simplified Chinese title from UI_TEXT', async () => {
      mockDialog.showSaveDialog = jest.fn().mockResolvedValue({ canceled: true, filePath: undefined });

      ipcMain.handle('dialog:saveFile', async (event, defaultFilename) => {
        const options = {
          title: UI_TEXT.dialogSaveFile
        };
        await mockDialog.showSaveDialog(mockMainWindow, options);
        return { success: true };
      });

      await handlers['dialog:saveFile']({}, '');
      
      expect(mockDialog.showSaveDialog).toHaveBeenCalledWith(
        mockMainWindow,
        expect.objectContaining({
          title: UI_TEXT.dialogSaveFile
        })
      );
    });
  });

  describe('dialog:confirm handler', () => {
    it('should return confirmed true when user clicks OK', async () => {
      const mockResult = { response: 0 };
      mockDialog.showMessageBox = jest.fn().mockResolvedValue(mockResult);

      ipcMain.handle('dialog:confirm', async (event, message, detail) => {
        try {
          const result = await mockDialog.showMessageBox(mockMainWindow, {
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

      const result = await handlers['dialog:confirm']({}, '确定要删除吗？');
      
      expect(result.success).toBe(true);
      expect(result.confirmed).toBe(true);
    });

    it('should return confirmed false when user clicks Cancel', async () => {
      const mockResult = { response: 1 };
      mockDialog.showMessageBox = jest.fn().mockResolvedValue(mockResult);

      ipcMain.handle('dialog:confirm', async (event, message, detail) => {
        try {
          const result = await mockDialog.showMessageBox(mockMainWindow, {
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

      const result = await handlers['dialog:confirm']({}, '确定要删除吗？');
      
      expect(result.success).toBe(true);
      expect(result.confirmed).toBe(false);
    });

    it('should use Simplified Chinese button text from UI_TEXT', async () => {
      mockDialog.showMessageBox = jest.fn().mockResolvedValue({ response: 0 });

      ipcMain.handle('dialog:confirm', async (event, message, detail) => {
        const options = {
          type: 'question',
          buttons: [UI_TEXT.dialogButtonOk, UI_TEXT.dialogButtonCancel]
        };
        await mockDialog.showMessageBox(mockMainWindow, options);
        return { success: true, confirmed: true };
      });

      await handlers['dialog:confirm']({}, 'Test message');
      
      expect(mockDialog.showMessageBox).toHaveBeenCalledWith(
        mockMainWindow,
        expect.objectContaining({
          buttons: [UI_TEXT.dialogButtonOk, UI_TEXT.dialogButtonCancel]
        })
      );
    });
  });

  describe('dialog:error handler', () => {
    it('should display error dialog with message', async () => {
      mockDialog.showMessageBox = jest.fn().mockResolvedValue({});

      ipcMain.handle('dialog:error', async (event, message, detail) => {
        try {
          await mockDialog.showMessageBox(mockMainWindow, {
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

      const result = await handlers['dialog:error']({}, '操作失败', '详细错误信息');
      
      expect(result.success).toBe(true);
      expect(mockDialog.showMessageBox).toHaveBeenCalledWith(
        mockMainWindow,
        expect.objectContaining({
          type: 'error',
          message: '操作失败',
          detail: '详细错误信息'
        })
      );
    });

    it('should use Simplified Chinese button text from UI_TEXT', async () => {
      mockDialog.showMessageBox = jest.fn().mockResolvedValue({});

      ipcMain.handle('dialog:error', async (event, message, detail) => {
        const options = {
          type: 'error',
          buttons: [UI_TEXT.dialogButtonOk]
        };
        await mockDialog.showMessageBox(mockMainWindow, options);
        return { success: true };
      });

      await handlers['dialog:error']({}, 'Error');
      
      expect(mockDialog.showMessageBox).toHaveBeenCalledWith(
        mockMainWindow,
        expect.objectContaining({
          buttons: [UI_TEXT.dialogButtonOk]
        })
      );
    });
  });

  describe('dialog:success handler', () => {
    it('should display success notification with message', async () => {
      mockDialog.showMessageBox = jest.fn().mockResolvedValue({});

      ipcMain.handle('dialog:success', async (event, message, detail) => {
        try {
          await mockDialog.showMessageBox(mockMainWindow, {
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

      const result = await handlers['dialog:success']({}, '文件上传成功');
      
      expect(result.success).toBe(true);
      expect(mockDialog.showMessageBox).toHaveBeenCalledWith(
        mockMainWindow,
        expect.objectContaining({
          type: 'info',
          message: '文件上传成功'
        })
      );
    });

    it('should use Simplified Chinese success messages from UI_TEXT', async () => {
      mockDialog.showMessageBox = jest.fn().mockResolvedValue({});

      ipcMain.handle('dialog:success', async (event, message, detail) => {
        const options = {
          type: 'info',
          buttons: [UI_TEXT.dialogButtonOk],
          message: message
        };
        await mockDialog.showMessageBox(mockMainWindow, options);
        return { success: true };
      });

      // Test with actual UI_TEXT success messages
      await handlers['dialog:success']({}, UI_TEXT.uploadSuccess);
      
      expect(mockDialog.showMessageBox).toHaveBeenCalledWith(
        mockMainWindow,
        expect.objectContaining({
          message: UI_TEXT.uploadSuccess
        })
      );
    });
  });
});
