/**
 * StorageService - Application Layer
 * 
 * Provides business logic layer for storage operations.
 * Orchestrates R2Client, URLFormatter, and file type detection.
 */

const path = require('path');
const { URLFormatter, URLFormat } = require('./URLFormatter');
const { FileSystemHelper } = require('../infrastructure/FileSystemHelper');
const { ErrorType } = require('../infrastructure/R2Client');
const { UI_TEXT } = require('../../../i18n/zh-CN');

// ErrorLogger will be loaded lazily to avoid issues when Electron app is not ready
let ErrorLogger = null;

/**
 * Get ErrorLogger instance (lazy loading)
 * @private
 * @returns {Object|null} ErrorLogger class or null if not available
 */
function _getErrorLogger() {
  if (ErrorLogger === null) {
    try {
      ErrorLogger = require('./ErrorLogger').ErrorLogger;
    } catch (e) {
      // ErrorLogger not available (e.g., in test environment or Electron not ready)
      ErrorLogger = undefined;
    }
  }
  return ErrorLogger;
}

/**
 * File type categories for preview
 */
const FileType = {
  IMAGE: 'image',
  TEXT: 'text',
  OTHER: 'other'
};

/**
 * Supported file extensions for preview
 */
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'];
const TEXT_EXTENSIONS = ['txt', 'md', 'json', 'xml', 'html', 'css', 'js', 'ts', 'yaml', 'yml', 'log'];

/**
 * StorageService class for storage operations
 */
class StorageService {
  /**
   * Initialize StorageService with R2Client
   * @param {R2Client} r2Client - R2Client instance
   */
  constructor(r2Client) {
    this.r2Client = r2Client;
  }

  /**
   * List all objects in the bucket
   * @returns {Promise<Array<Object>>} Array of object information
   */
  async listObjects() {
    try {
      return await this.r2Client.listObjects();
    } catch (error) {
      this._logError(error, 'listObjects');
      throw this._enhanceError(error, 'listObjects');
    }
  }

  /**
   * Upload a file to the bucket
   * @param {string} filePath - Local file path to upload
   * @param {Function} onProgress - Optional progress callback (loaded, total) => void
   * @returns {Promise<Object>} Upload result with key and url
   */
  async uploadFile(filePath, onProgress) {
    try {
      // Validate file path
      if (!FileSystemHelper.validatePath(filePath)) {
        const error = new Error(UI_TEXT.errorFileNotFound);
        error.code = 'INVALID_PATH';
        error.errorType = ErrorType.FILE_SYSTEM;
        throw error;
      }

      // Check if file exists
      if (!FileSystemHelper.fileExists(filePath)) {
        const error = new Error(UI_TEXT.errorFileNotFound);
        error.code = 'ENOENT';
        error.errorType = ErrorType.FILE_SYSTEM;
        error.filePath = filePath;
        throw error;
      }

      // Extract filename to use as object key
      const filename = FileSystemHelper.getFileName(filePath);

      // Upload to R2
      await this.r2Client.uploadObject(filename, filePath, onProgress);

      // Get object URL
      const url = await this.r2Client.getObjectUrl(filename);

      return {
        key: filename,
        url: url
      };
    } catch (error) {
      this._logError(error, 'uploadFile', { filePath });
      throw this._enhanceError(error, 'uploadFile');
    }
  }

  /**
   * Upload a buffer to the bucket (for drag and drop support)
   * @param {string} filename - Filename to use as object key
   * @param {Buffer} buffer - Buffer content to upload
   * @param {string} contentType - Optional content type
   * @param {Function} onProgress - Optional progress callback (loaded, total) => void
   * @returns {Promise<Object>} Upload result with key and url
   */
  async uploadBuffer(filename, buffer, contentType, onProgress) {
    try {
      // Upload to R2
      await this.r2Client.uploadObjectFromBuffer(filename, buffer, contentType, onProgress);

      // Get object URL
      const url = await this.r2Client.getObjectUrl(filename);

      return {
        key: filename,
        url: url
      };
    } catch (error) {
      this._logError(error, 'uploadBuffer', { filename });
      throw this._enhanceError(error, 'uploadBuffer');
    }
  }

  /**
   * Download a file from the bucket
   * @param {string} key - Object key to download
   * @param {string} savePath - Local path to save the file
   * @param {Function} onProgress - Optional progress callback (loaded, total) => void
   * @returns {Promise<void>}
   */
  async downloadFile(key, savePath, onProgress) {
    try {
      // Validate save path
      if (!FileSystemHelper.validatePath(savePath)) {
        const error = new Error(UI_TEXT.errorFileNotFound);
        error.code = 'INVALID_PATH';
        error.errorType = ErrorType.FILE_SYSTEM;
        throw error;
      }

      await this.r2Client.downloadObject(key, savePath, onProgress);
    } catch (error) {
      this._logError(error, 'downloadFile', { key, savePath });
      throw this._enhanceError(error, 'downloadFile');
    }
  }

  /**
   * Delete a file from the bucket
   * @param {string} key - Object key to delete
   * @returns {Promise<void>}
   */
  async deleteFile(key) {
    try {
      await this.r2Client.deleteObject(key);
    } catch (error) {
      this._logError(error, 'deleteFile', { key });
      throw this._enhanceError(error, 'deleteFile');
    }
  }

  /**
   * Delete multiple files from the bucket
   * @param {string[]} keys - Array of object keys to delete
   * @returns {Promise<{deleted: string[], errors: Array<{key: string, error: Error}>}>}
   */
  async deleteFiles(keys) {
    try {
      const result = await this.r2Client.deleteObjects(keys);
      return result;
    } catch (error) {
      this._logError(error, 'deleteFiles', { keys });
      throw this._enhanceError(error, 'deleteFiles');
    }
  }

  /**
   * Get preview data for a file
   * @param {string} key - Object key to preview
   * @returns {Promise<Object>} Preview data with type, content, and metadata
   */
  async previewFile(key) {
    try {
      // Detect file type
      const fileType = this._detectFileType(key);

      // Get object stream and metadata
      const { stream, metadata } = await this.r2Client.getObjectStream(key);

      // Read stream content
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      const content = Buffer.concat(chunks);

      return {
        type: fileType,
        content: fileType === FileType.TEXT ? content.toString('utf-8') : content,
        metadata: metadata
      };
    } catch (error) {
      this._logError(error, 'previewFile', { key });
      throw this._enhanceError(error, 'previewFile');
    }
  }

  /**
   * Get file URL in specified format
   * @param {string} key - Object key
   * @param {string} format - URL format (url, html, markdown)
   * @returns {Promise<string>} Formatted URL
   */
  async getFileUrl(key, format = URLFormat.URL) {
    try {
      const baseUrl = await this.r2Client.getObjectUrl(key);
      return URLFormatter.formatUrl(baseUrl, key, format);
    } catch (error) {
      this._logError(error, 'getFileUrl', { key, format });
      throw this._enhanceError(error, 'getFileUrl');
    }
  }

  /**
   * Detect file type based on extension
   * @private
   * @param {string} filename - Filename or path
   * @returns {string} File type (image, text, other)
   */
  _detectFileType(filename) {
    const ext = FileSystemHelper.getFileExtension(filename);

    if (IMAGE_EXTENSIONS.includes(ext)) {
      return FileType.IMAGE;
    }

    if (TEXT_EXTENSIONS.includes(ext)) {
      return FileType.TEXT;
    }

    return FileType.OTHER;
  }

  /**
   * Enhance error with additional context and user-friendly message
   * @private
   * @param {Error} error - Original error
   * @param {string} operation - Operation that caused the error
   * @returns {Error} Enhanced error
   */
  _enhanceError(error, operation) {
    if (!error.operation) {
      error.operation = operation;
    }

    // Add user-friendly message based on error type
    error.userMessage = this._getUserFriendlyMessage(error, operation);

    return error;
  }

  /**
   * Get user-friendly error message in Simplified Chinese
   * @private
   * @param {Error} error - Error object
   * @param {string} operation - Operation that caused the error
   * @returns {string} User-friendly error message
   */
  _getUserFriendlyMessage(error, operation) {
    // If error already has a user-friendly message, return it
    if (error.userMessage) {
      return error.userMessage;
    }

    const errorType = error.errorType || ErrorType.UNKNOWN;

    // Map error types to user-friendly messages
    switch (errorType) {
      case ErrorType.NETWORK:
        return UI_TEXT.errorNetwork;

      case ErrorType.AUTH:
        return `${UI_TEXT.errorAuth}。${UI_TEXT.errorAuthDetail}`;

      case ErrorType.BUCKET:
        return UI_TEXT.errorBucket;

      case ErrorType.OBJECT:
        return UI_TEXT.errorObject;

      case ErrorType.PERMISSION:
        return UI_TEXT.errorPermission;

      case ErrorType.FILE_SYSTEM:
        return this._getFileSystemErrorMessage(error);

      case ErrorType.UNKNOWN:
      default:
        return UI_TEXT.errorUnknown;
    }
  }

  /**
   * Get file system error message based on error code
   * @private
   * @param {Error} error - Error object with file system code
   * @returns {string} User-friendly file system error message
   */
  _getFileSystemErrorMessage(error) {
    const code = error.code || error.fileSystemCode;

    switch (code) {
      case 'ENOENT':
        return UI_TEXT.errorFileNotFound;

      case 'EACCES':
        return UI_TEXT.errorFileAccess;

      case 'ENOSPC':
        return UI_TEXT.errorDiskSpace;

      case 'INVALID_PATH':
        return UI_TEXT.errorFileNotFound;

      default:
        return UI_TEXT.errorUnknown;
    }
  }

  /**
   * Log error using ErrorLogger if available
   * @private
   * @param {Error} error - Error to log
   * @param {string} operation - Operation context
   * @param {Object} context - Additional context data
   */
  _logError(error, operation, context = {}) {
    const Logger = _getErrorLogger();
    if (Logger) {
      try {
        // Add context to error
        const contextStr = Object.keys(context).length > 0 
          ? ` (${JSON.stringify(context)})` 
          : '';
        Logger.logError(error, `${operation}${contextStr}`);
      } catch (logError) {
        // Silently fail if logging fails
        console.error('[StorageService] Failed to log error:', logError);
      }
    }
  }
}

module.exports = { StorageService, FileType, URLFormat };
