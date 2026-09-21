/**
 * StorageService Tests
 * 
 * Tests for the StorageService application layer component
 */

const { StorageService, FileType, URLFormat } = require('./StorageService');
const { ErrorType } = require('../infrastructure/R2Client');
const { FileSystemHelper } = require('../infrastructure/FileSystemHelper');
const { UI_TEXT } = require('../../../i18n/zh-CN');

// Mock FileSystemHelper
jest.mock('../infrastructure/FileSystemHelper');

// Mock ErrorLogger to avoid Electron dependency issues
jest.mock('./ErrorLogger', () => ({
  ErrorLogger: {
    logError: jest.fn(),
    getLogPath: jest.fn().mockReturnValue('/mock/path/error.log')
  }
}));

describe('StorageService', () => {
  let storageService;
  let mockR2Client;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create mock R2Client
    mockR2Client = {
      listObjects: jest.fn(),
      uploadObject: jest.fn(),
      downloadObject: jest.fn(),
      deleteObject: jest.fn(),
      deleteObjects: jest.fn(),
      getObjectUrl: jest.fn(),
      getObjectMetadata: jest.fn(),
      getObjectStream: jest.fn()
    };

    storageService = new StorageService(mockR2Client);

    // Setup default FileSystemHelper mocks
    FileSystemHelper.validatePath.mockReturnValue(true);
    FileSystemHelper.fileExists.mockReturnValue(true);
    FileSystemHelper.getFileName.mockImplementation((filePath) => {
      const parts = filePath.split(/[/\\]/);
      return parts[parts.length - 1];
    });
    FileSystemHelper.getFileExtension.mockImplementation((filename) => {
      const parts = filename.split('.');
      return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
    });
  });

  describe('constructor', () => {
    test('should initialize with R2Client', () => {
      expect(storageService.r2Client).toBe(mockR2Client);
    });
  });

  describe('listObjects', () => {
    test('should return list of objects from R2Client', async () => {
      const mockObjects = [
        { key: 'file1.jpg', size: 1024, lastModified: new Date() },
        { key: 'file2.png', size: 2048, lastModified: new Date() }
      ];
      mockR2Client.listObjects.mockResolvedValue(mockObjects);

      const result = await storageService.listObjects();

      expect(result).toEqual(mockObjects);
      expect(mockR2Client.listObjects).toHaveBeenCalledTimes(1);
    });

    test('should pass the current directory prefix to R2Client', async () => {
      mockR2Client.listObjects.mockResolvedValue([]);

      await storageService.listObjects('photos/');

      expect(mockR2Client.listObjects).toHaveBeenCalledWith('photos/');
    });

    test('should throw enhanced error on failure', async () => {
      const mockError = new Error('Network error');
      mockError.errorType = ErrorType.NETWORK;
      mockR2Client.listObjects.mockRejectedValue(mockError);

      await expect(storageService.listObjects()).rejects.toThrow('Network error');
    });
  });

  describe('uploadFile', () => {
    test('should upload file and return key and url', async () => {
      const filePath = 'C:\\Users\\test\\image.jpg';
      const expectedUrl = 'https://example.com/picture/image.jpg';
      
      mockR2Client.uploadObject.mockResolvedValue();
      mockR2Client.getObjectUrl.mockResolvedValue(expectedUrl);

      const result = await storageService.uploadFile(filePath);

      expect(result).toEqual({
        key: 'image.jpg',
        url: expectedUrl
      });
      expect(mockR2Client.uploadObject).toHaveBeenCalledWith('image.jpg', filePath, undefined);
      expect(mockR2Client.getObjectUrl).toHaveBeenCalledWith('image.jpg');
    });

    test('should call progress callback during upload', async () => {
      const filePath = 'C:\\Users\\test\\image.jpg';
      const progressCallback = jest.fn();
      
      mockR2Client.uploadObject.mockResolvedValue();
      mockR2Client.getObjectUrl.mockResolvedValue('https://example.com/picture/image.jpg');

      await storageService.uploadFile(filePath, progressCallback);

      expect(mockR2Client.uploadObject).toHaveBeenCalledWith('image.jpg', filePath, progressCallback);
    });

    test('should prepend the current directory prefix to the uploaded key', async () => {
      const filePath = 'C:\\Users\\test\\image.jpg';
      const expectedUrl = 'https://example.com/picture/photos/image.jpg';

      mockR2Client.uploadObject.mockResolvedValue();
      mockR2Client.getObjectUrl.mockResolvedValue(expectedUrl);

      const result = await storageService.uploadFile(filePath, undefined, 'photos/');

      expect(result).toEqual({
        key: 'photos/image.jpg',
        url: expectedUrl
      });
      expect(mockR2Client.uploadObject).toHaveBeenCalledWith('photos/image.jpg', filePath, undefined);
      expect(mockR2Client.getObjectUrl).toHaveBeenCalledWith('photos/image.jpg');
    });

    test('should throw error for invalid file path', async () => {
      const invalidPath = 'C:\\Users\\test\\<invalid>.jpg';
      FileSystemHelper.validatePath.mockReturnValue(false);

      await expect(storageService.uploadFile(invalidPath)).rejects.toThrow(UI_TEXT.errorFileNotFound);
    });

    test('should throw error for non-existent file', async () => {
      const filePath = 'C:\\Users\\test\\nonexistent.jpg';
      FileSystemHelper.fileExists.mockReturnValue(false);

      await expect(storageService.uploadFile(filePath)).rejects.toThrow(UI_TEXT.errorFileNotFound);
    });

    test('should add errorType and userMessage for invalid file path', async () => {
      const invalidPath = 'C:\\Users\\test\\<invalid>.jpg';
      FileSystemHelper.validatePath.mockReturnValue(false);

      try {
        await storageService.uploadFile(invalidPath);
        fail('Should have thrown an error');
      } catch (error) {
        expect(error.errorType).toBe(ErrorType.FILE_SYSTEM);
        expect(error.code).toBe('INVALID_PATH');
        expect(error.userMessage).toBe(UI_TEXT.errorFileNotFound);
      }
    });

    test('should add errorType and userMessage for non-existent file', async () => {
      const filePath = 'C:\\Users\\test\\nonexistent.jpg';
      FileSystemHelper.fileExists.mockReturnValue(false);

      try {
        await storageService.uploadFile(filePath);
        fail('Should have thrown an error');
      } catch (error) {
        expect(error.errorType).toBe(ErrorType.FILE_SYSTEM);
        expect(error.code).toBe('ENOENT');
        expect(error.userMessage).toBe(UI_TEXT.errorFileNotFound);
        expect(error.filePath).toBe(filePath);
      }
    });
  });

  describe('downloadFile', () => {
    test('should download file to specified path', async () => {
      const key = 'image.jpg';
      const savePath = 'C:\\Users\\test\\Downloads\\image.jpg';
      
      mockR2Client.downloadObject.mockResolvedValue();

      await storageService.downloadFile(key, savePath);

      expect(mockR2Client.downloadObject).toHaveBeenCalledWith(key, savePath, undefined);
    });

    test('should call progress callback during download', async () => {
      const key = 'image.jpg';
      const savePath = 'C:\\Users\\test\\Downloads\\image.jpg';
      const progressCallback = jest.fn();
      
      mockR2Client.downloadObject.mockResolvedValue();

      await storageService.downloadFile(key, savePath, progressCallback);

      expect(mockR2Client.downloadObject).toHaveBeenCalledWith(key, savePath, progressCallback);
    });

    test('should throw error for invalid save path', async () => {
      const key = 'image.jpg';
      const invalidPath = 'C:\\Users\\test\\<invalid>.jpg';
      FileSystemHelper.validatePath.mockReturnValue(false);

      await expect(storageService.downloadFile(key, invalidPath)).rejects.toThrow(UI_TEXT.errorFileNotFound);
    });

    test('should add errorType and userMessage for invalid save path', async () => {
      const key = 'image.jpg';
      const invalidPath = 'C:\\Users\\test\\<invalid>.jpg';
      FileSystemHelper.validatePath.mockReturnValue(false);

      try {
        await storageService.downloadFile(key, invalidPath);
        fail('Should have thrown an error');
      } catch (error) {
        expect(error.errorType).toBe(ErrorType.FILE_SYSTEM);
        expect(error.code).toBe('INVALID_PATH');
        expect(error.userMessage).toBe(UI_TEXT.errorFileNotFound);
      }
    });
  });

  describe('deleteFile', () => {
    test('should delete file from bucket', async () => {
      const key = 'image.jpg';
      
      mockR2Client.deleteObject.mockResolvedValue();

      await storageService.deleteFile(key);

      expect(mockR2Client.deleteObject).toHaveBeenCalledWith(key);
    });

    test('should throw enhanced error on failure', async () => {
      const key = 'image.jpg';
      const mockError = new Error('Object not found');
      mockError.errorType = ErrorType.OBJECT;
      mockR2Client.deleteObject.mockRejectedValue(mockError);

      await expect(storageService.deleteFile(key)).rejects.toThrow('Object not found');
    });
  });

  describe('deleteFiles', () => {
    test('should delete multiple files from bucket', async () => {
      const keys = ['file1.jpg', 'file2.png', 'file3.pdf'];
      const mockResult = {
        deleted: ['file1.jpg', 'file2.png', 'file3.pdf'],
        errors: []
      };
      
      mockR2Client.deleteObjects.mockResolvedValue(mockResult);

      const result = await storageService.deleteFiles(keys);

      expect(mockR2Client.deleteObjects).toHaveBeenCalledWith(keys);
      expect(result.deleted).toEqual(['file1.jpg', 'file2.png', 'file3.pdf']);
      expect(result.errors).toEqual([]);
    });

    test('should return partial results when some deletions fail', async () => {
      const keys = ['file1.jpg', 'file2.png', 'file3.pdf'];
      const mockResult = {
        deleted: ['file1.jpg', 'file3.pdf'],
        errors: [
          { key: 'file2.png', error: new Error('Access denied') }
        ]
      };
      
      mockR2Client.deleteObjects.mockResolvedValue(mockResult);

      const result = await storageService.deleteFiles(keys);

      expect(result.deleted).toEqual(['file1.jpg', 'file3.pdf']);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].key).toBe('file2.png');
    });

    test('should throw enhanced error on failure', async () => {
      const keys = ['file1.jpg', 'file2.png'];
      const mockError = new Error('Network error');
      mockError.errorType = ErrorType.NETWORK;
      mockR2Client.deleteObjects.mockRejectedValue(mockError);

      await expect(storageService.deleteFiles(keys)).rejects.toThrow('Network error');
    });
  });

  describe('previewFile', () => {
    test('should return image preview data', async () => {
      const key = 'image.jpg';
      const mockBuffer = Buffer.from('fake image data');
      const mockMetadata = {
        contentType: 'image/jpeg',
        contentLength: mockBuffer.length,
        lastModified: new Date()
      };

      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield mockBuffer;
        }
      };

      mockR2Client.getObjectStream.mockResolvedValue({
        stream: mockStream,
        metadata: mockMetadata
      });

      const result = await storageService.previewFile(key);

      expect(result.type).toBe(FileType.IMAGE);
      expect(result.content).toEqual(mockBuffer);
      expect(result.metadata).toEqual(mockMetadata);
    });

    test('should return text preview data', async () => {
      const key = 'document.txt';
      const mockText = 'Hello, World!';
      const mockBuffer = Buffer.from(mockText);
      const mockMetadata = {
        contentType: 'text/plain',
        contentLength: mockBuffer.length,
        lastModified: new Date()
      };

      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield mockBuffer;
        }
      };

      mockR2Client.getObjectStream.mockResolvedValue({
        stream: mockStream,
        metadata: mockMetadata
      });

      const result = await storageService.previewFile(key);

      expect(result.type).toBe(FileType.TEXT);
      expect(result.content).toBe(mockText);
      expect(result.metadata).toEqual(mockMetadata);
    });

    test('should return pdf preview data', async () => {
      const key = 'document.pdf';
      const mockBuffer = Buffer.from('fake pdf data');
      const mockMetadata = {
        contentType: 'application/pdf',
        contentLength: mockBuffer.length,
        lastModified: new Date()
      };

      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield mockBuffer;
        }
      };

      mockR2Client.getObjectStream.mockResolvedValue({
        stream: mockStream,
        metadata: mockMetadata
      });

      const result = await storageService.previewFile(key);

      expect(result.type).toBe(FileType.PDF);
      expect(result.content).toEqual(mockBuffer);
      expect(result.metadata).toEqual(mockMetadata);
    });

    test('should return video preview data', async () => {
      const key = 'video.mp4';
      const mockBuffer = Buffer.from('fake video data');
      const mockMetadata = {
        contentType: 'video/mp4',
        contentLength: mockBuffer.length,
        lastModified: new Date()
      };

      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield mockBuffer;
        }
      };

      mockR2Client.getObjectStream.mockResolvedValue({
        stream: mockStream,
        metadata: mockMetadata
      });

      const result = await storageService.previewFile(key);

      expect(result.type).toBe(FileType.VIDEO);
      expect(result.content).toEqual(mockBuffer);
      expect(result.metadata).toEqual(mockMetadata);
    });
  });

  describe('getFileUrl', () => {
    test('should return URL format by default', async () => {
      const key = 'image.jpg';
      const baseUrl = 'https://example.com/picture/image.jpg';
      
      mockR2Client.getObjectUrl.mockResolvedValue(baseUrl);

      const result = await storageService.getFileUrl(key);

      expect(result).toBe(baseUrl);
      expect(mockR2Client.getObjectUrl).toHaveBeenCalledWith(key);
    });

    test('should return HTML format when specified', async () => {
      const key = 'image.jpg';
      const baseUrl = 'https://example.com/picture/image.jpg';
      
      mockR2Client.getObjectUrl.mockResolvedValue(baseUrl);

      const result = await storageService.getFileUrl(key, URLFormat.HTML);

      expect(result).toBe('<img src="https://example.com/picture/image.jpg" alt="image" />');
    });

    test('should return Markdown format when specified', async () => {
      const key = 'image.jpg';
      const baseUrl = 'https://example.com/picture/image.jpg';
      
      mockR2Client.getObjectUrl.mockResolvedValue(baseUrl);

      const result = await storageService.getFileUrl(key, URLFormat.MARKDOWN);

      expect(result).toBe('![image](https://example.com/picture/image.jpg)');
    });
  });

  describe('_detectFileType', () => {
    test('should detect image files', () => {
      expect(storageService._detectFileType('photo.jpg')).toBe(FileType.IMAGE);
      expect(storageService._detectFileType('photo.jpeg')).toBe(FileType.IMAGE);
      expect(storageService._detectFileType('photo.png')).toBe(FileType.IMAGE);
      expect(storageService._detectFileType('photo.gif')).toBe(FileType.IMAGE);
      expect(storageService._detectFileType('photo.webp')).toBe(FileType.IMAGE);
      expect(storageService._detectFileType('photo.svg')).toBe(FileType.IMAGE);
      expect(storageService._detectFileType('photo.bmp')).toBe(FileType.IMAGE);
      expect(storageService._detectFileType('photo.ico')).toBe(FileType.IMAGE);
    });

    test('should detect text files', () => {
      expect(storageService._detectFileType('document.txt')).toBe(FileType.TEXT);
      expect(storageService._detectFileType('README.md')).toBe(FileType.TEXT);
      expect(storageService._detectFileType('data.json')).toBe(FileType.TEXT);
      expect(storageService._detectFileType('config.xml')).toBe(FileType.TEXT);
      expect(storageService._detectFileType('index.html')).toBe(FileType.TEXT);
      expect(storageService._detectFileType('style.css')).toBe(FileType.TEXT);
      expect(storageService._detectFileType('script.js')).toBe(FileType.TEXT);
      expect(storageService._detectFileType('app.ts')).toBe(FileType.TEXT);
      expect(storageService._detectFileType('config.yaml')).toBe(FileType.TEXT);
      expect(storageService._detectFileType('config.yml')).toBe(FileType.TEXT);
      expect(storageService._detectFileType('error.log')).toBe(FileType.TEXT);
    });

    test('should detect video files', () => {
      expect(storageService._detectFileType('video.mp4')).toBe(FileType.VIDEO);
      expect(storageService._detectFileType('movie.mkv')).toBe(FileType.VIDEO);
      expect(storageService._detectFileType('clip.webm')).toBe(FileType.VIDEO);
    });

    test('should detect pdf files', () => {
      expect(storageService._detectFileType('document.pdf')).toBe(FileType.PDF);
    });

    test('should detect other file types', () => {
      expect(storageService._detectFileType('archive.zip')).toBe(FileType.OTHER);
      expect(storageService._detectFileType('audio.mp3')).toBe(FileType.OTHER);
    });

    test('should handle files without extension', () => {
      expect(storageService._detectFileType('README')).toBe(FileType.OTHER);
    });

    test('should be case insensitive', () => {
      expect(storageService._detectFileType('photo.JPG')).toBe(FileType.IMAGE);
      expect(storageService._detectFileType('photo.PNG')).toBe(FileType.IMAGE);
      expect(storageService._detectFileType('document.TXT')).toBe(FileType.TEXT);
    });
  });

  describe('_enhanceError', () => {
    test('should add operation to error', () => {
      const originalError = new Error('Test error');
      const enhanced = storageService._enhanceError(originalError, 'testOperation');

      expect(enhanced.operation).toBe('testOperation');
      expect(enhanced.message).toBe('Test error');
    });

    test('should not override existing operation', () => {
      const originalError = new Error('Test error');
      originalError.operation = 'existingOperation';
      const enhanced = storageService._enhanceError(originalError, 'newOperation');

      expect(enhanced.operation).toBe('existingOperation');
    });

    test('should add user-friendly message for network errors', () => {
      const originalError = new Error('Network error');
      originalError.errorType = ErrorType.NETWORK;
      const enhanced = storageService._enhanceError(originalError, 'listObjects');

      expect(enhanced.userMessage).toBe(UI_TEXT.errorNetwork);
    });

    test('should add user-friendly message for auth errors', () => {
      const originalError = new Error('Auth error');
      originalError.errorType = ErrorType.AUTH;
      const enhanced = storageService._enhanceError(originalError, 'uploadFile');

      expect(enhanced.userMessage).toBe(`${UI_TEXT.errorAuth}。${UI_TEXT.errorAuthDetail}`);
    });

    test('should add user-friendly message for bucket errors', () => {
      const originalError = new Error('Bucket error');
      originalError.errorType = ErrorType.BUCKET;
      const enhanced = storageService._enhanceError(originalError, 'listObjects');

      expect(enhanced.userMessage).toBe(UI_TEXT.errorBucket);
    });

    test('should add user-friendly message for object errors', () => {
      const originalError = new Error('Object error');
      originalError.errorType = ErrorType.OBJECT;
      const enhanced = storageService._enhanceError(originalError, 'downloadFile');

      expect(enhanced.userMessage).toBe(UI_TEXT.errorObject);
    });

    test('should add user-friendly message for permission errors', () => {
      const originalError = new Error('Permission error');
      originalError.errorType = ErrorType.PERMISSION;
      const enhanced = storageService._enhanceError(originalError, 'deleteFile');

      expect(enhanced.userMessage).toBe(UI_TEXT.errorPermission);
    });

    test('should add user-friendly message for file system errors (ENOENT)', () => {
      const originalError = new Error('File not found');
      originalError.errorType = ErrorType.FILE_SYSTEM;
      originalError.code = 'ENOENT';
      const enhanced = storageService._enhanceError(originalError, 'uploadFile');

      expect(enhanced.userMessage).toBe(UI_TEXT.errorFileNotFound);
    });

    test('should add user-friendly message for file system errors (EACCES)', () => {
      const originalError = new Error('Access denied');
      originalError.errorType = ErrorType.FILE_SYSTEM;
      originalError.code = 'EACCES';
      const enhanced = storageService._enhanceError(originalError, 'downloadFile');

      expect(enhanced.userMessage).toBe(UI_TEXT.errorFileAccess);
    });

    test('should add user-friendly message for file system errors (ENOSPC)', () => {
      const originalError = new Error('Disk full');
      originalError.errorType = ErrorType.FILE_SYSTEM;
      originalError.code = 'ENOSPC';
      const enhanced = storageService._enhanceError(originalError, 'downloadFile');

      expect(enhanced.userMessage).toBe(UI_TEXT.errorDiskSpace);
    });

    test('should add user-friendly message for unknown errors', () => {
      const originalError = new Error('Unknown error');
      originalError.errorType = ErrorType.UNKNOWN;
      const enhanced = storageService._enhanceError(originalError, 'listObjects');

      expect(enhanced.userMessage).toBe(UI_TEXT.errorUnknown);
    });

    test('should add user-friendly message for errors without errorType', () => {
      const originalError = new Error('Some error');
      const enhanced = storageService._enhanceError(originalError, 'listObjects');

      expect(enhanced.userMessage).toBe(UI_TEXT.errorUnknown);
    });
  });

  describe('_getUserFriendlyMessage', () => {
    test('should return existing userMessage if present', () => {
      const error = new Error('Test error');
      error.userMessage = 'Custom message';
      
      const result = storageService._getUserFriendlyMessage(error, 'testOperation');
      
      expect(result).toBe('Custom message');
    });
  });

  describe('_getFileSystemErrorMessage', () => {
    test('should return file not found message for ENOENT', () => {
      const error = { code: 'ENOENT' };
      const result = storageService._getFileSystemErrorMessage(error);
      expect(result).toBe(UI_TEXT.errorFileNotFound);
    });

    test('should return file access message for EACCES', () => {
      const error = { code: 'EACCES' };
      const result = storageService._getFileSystemErrorMessage(error);
      expect(result).toBe(UI_TEXT.errorFileAccess);
    });

    test('should return disk space message for ENOSPC', () => {
      const error = { code: 'ENOSPC' };
      const result = storageService._getFileSystemErrorMessage(error);
      expect(result).toBe(UI_TEXT.errorDiskSpace);
    });

    test('should return file not found message for INVALID_PATH', () => {
      const error = { code: 'INVALID_PATH' };
      const result = storageService._getFileSystemErrorMessage(error);
      expect(result).toBe(UI_TEXT.errorFileNotFound);
    });

    test('should return unknown error for unrecognized code', () => {
      const error = { code: 'UNKNOWN' };
      const result = storageService._getFileSystemErrorMessage(error);
      expect(result).toBe(UI_TEXT.errorUnknown);
    });
  });
});
