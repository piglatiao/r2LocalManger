/**
 * FileSystemHelper - Infrastructure Layer
 * 
 * Provides utility methods for file system operations including
 * path validation, file reading/writing with stream support,
 * and file size/extension utilities.
 */

const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');

/**
 * FileSystemHelper class for file system operations
 */
class FileSystemHelper {
  /**
   * Windows reserved filenames that cannot be used
   * @private
   */
  static WINDOWS_RESERVED_NAMES = [
    'CON', 'PRN', 'AUX', 'NUL',
    'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
    'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
  ];

  /**
   * Windows invalid filename characters
   * @private
   */
  static WINDOWS_INVALID_CHARS = /[<>:"|?*\x00-\x1F]/;

  /**
   * Maximum path length for Windows (including drive letter and null terminator)
   * @private
   */
  static MAX_PATH_LENGTH = 260;

  /**
   * Validate if a file path is safe and valid for Windows
   * @param {string} filePath - Path to validate
   * @returns {boolean} True if path is valid and safe
   */
  static validatePath(filePath) {
    try {
      if (!filePath || typeof filePath !== 'string') {
        return false;
      }

      // Check path length (Windows MAX_PATH limitation)
      if (filePath.length > this.MAX_PATH_LENGTH) {
        return false;
      }

      // Check if path is absolute or relative
      const resolvedPath = path.resolve(filePath);
      
      // Check for path traversal attempts
      if (filePath.includes('..') && !resolvedPath.startsWith(path.resolve('.'))) {
        return false;
      }

      // Validate Windows-specific constraints
      if (process.platform === 'win32') {
        return this.validateWindowsPath(filePath);
      }
      
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Validate Windows-specific path constraints
   * @param {string} filePath - Path to validate
   * @returns {boolean} True if path is valid for Windows
   */
  static validateWindowsPath(filePath) {
    try {
      // Parse the path into components
      const parsed = path.parse(filePath);
      const pathComponents = filePath.split(path.sep).filter(c => c);

      // Check each path component
      for (const component of pathComponents) {
        // Skip drive letters (e.g., "C:")
        if (component.match(/^[A-Za-z]:$/)) {
          continue;
        }

        // Check for invalid characters
        if (this.WINDOWS_INVALID_CHARS.test(component)) {
          return false;
        }

        // Check for trailing spaces or periods (not allowed in Windows)
        if (component.endsWith(' ') || component.endsWith('.')) {
          return false;
        }

        // Check for reserved names
        const nameWithoutExt = component.split('.')[0].toUpperCase();
        if (this.WINDOWS_RESERVED_NAMES.includes(nameWithoutExt)) {
          return false;
        }
      }

      // Validate drive letter if present
      if (parsed.root) {
        if (parsed.root.match(/^[A-Za-z]:[\\/]$/)) {
          // Valid drive letter
          return true;
        } else if (parsed.root.startsWith('\\\\')) {
          // UNC path - validate format
          return this.validateUNCPath(filePath);
        }
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Validate UNC (Universal Naming Convention) path
   * @param {string} filePath - UNC path to validate
   * @returns {boolean} True if UNC path is valid
   */
  static validateUNCPath(filePath) {
    try {
      // UNC path format: \\server\share\path
      const uncPattern = /^\\\\[^\\]+\\[^\\]+/;
      return uncPattern.test(filePath);
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if a filename contains invalid characters for Windows
   * @param {string} filename - Filename to check
   * @returns {boolean} True if filename is valid
   */
  static isValidFilename(filename) {
    if (!filename || typeof filename !== 'string') {
      return false;
    }

    // Check for invalid characters
    if (this.WINDOWS_INVALID_CHARS.test(filename)) {
      return false;
    }

    // Check for trailing spaces or periods
    if (filename.endsWith(' ') || filename.endsWith('.')) {
      return false;
    }

    // Check for reserved names
    const nameWithoutExt = filename.split('.')[0].toUpperCase();
    if (this.WINDOWS_RESERVED_NAMES.includes(nameWithoutExt)) {
      return false;
    }

    return true;
  }

  /**
   * Sanitize a filename by removing or replacing invalid characters
   * @param {string} filename - Filename to sanitize
   * @param {string} replacement - Character to replace invalid chars with (default: '_')
   * @returns {string} Sanitized filename
   */
  static sanitizeFilename(filename, replacement = '_') {
    if (!filename || typeof filename !== 'string') {
      return '';
    }

    let sanitized = filename;

    // Replace invalid characters (use global flag for replace)
    const invalidCharsGlobal = /[<>:"|?*\x00-\x1F]/g;
    sanitized = sanitized.replace(invalidCharsGlobal, replacement);

    // Remove trailing spaces and periods
    sanitized = sanitized.replace(/[\s.]+$/, '');

    // Check for reserved names and add suffix if needed
    const nameWithoutExt = sanitized.split('.')[0].toUpperCase();
    if (this.WINDOWS_RESERVED_NAMES.includes(nameWithoutExt)) {
      const ext = path.extname(sanitized);
      const base = path.basename(sanitized, ext);
      sanitized = `${base}_file${ext}`;
    }

    return sanitized;
  }

  /**
   * Check if a file exists
   * @param {string} filePath - Path to check
   * @returns {boolean} True if file exists
   */
  static fileExists(filePath) {
    try {
      return fs.existsSync(filePath);
    } catch (error) {
      return false;
    }
  }

  /**
   * Read file content as buffer
   * @param {string} filePath - Path to file
   * @returns {Promise<Buffer>} File content as buffer
   */
  static async readFile(filePath) {
    try {
      return await fs.promises.readFile(filePath);
    } catch (error) {
      throw this._createFileSystemError(error, 'readFile', filePath);
    }
  }

  /**
   * Read file as stream
   * @param {string} filePath - Path to file
   * @returns {ReadableStream} File read stream
   */
  static createReadStream(filePath) {
    try {
      return fs.createReadStream(filePath);
    } catch (error) {
      throw this._createFileSystemError(error, 'createReadStream', filePath);
    }
  }

  /**
   * Write buffer to file
   * @param {string} filePath - Path to file
   * @param {Buffer} data - Data to write
   * @returns {Promise<void>}
   */
  static async writeFile(filePath, data) {
    try {
      // Ensure directory exists
      const dir = path.dirname(filePath);
      await fs.promises.mkdir(dir, { recursive: true });
      
      await fs.promises.writeFile(filePath, data);
    } catch (error) {
      throw this._createFileSystemError(error, 'writeFile', filePath);
    }
  }

  /**
   * Create write stream
   * @param {string} filePath - Path to file
   * @returns {WritableStream} File write stream
   */
  static createWriteStream(filePath) {
    try {
      // Ensure directory exists
      const dir = path.dirname(filePath);
      fs.mkdirSync(dir, { recursive: true });
      
      return fs.createWriteStream(filePath);
    } catch (error) {
      throw this._createFileSystemError(error, 'createWriteStream', filePath);
    }
  }

  /**
   * Get file size
   * @param {string} filePath - Path to file
   * @returns {number} File size in bytes
   */
  static getFileSize(filePath) {
    try {
      const stats = fs.statSync(filePath);
      return stats.size;
    } catch (error) {
      throw this._createFileSystemError(error, 'getFileSize', filePath);
    }
  }

  /**
   * Format file size to human-readable format
   * @param {number} bytes - Size in bytes
   * @returns {string} Formatted size (e.g., "1.5 MB")
   */
  static formatFileSize(bytes) {
    if (bytes === 0) return '0 字节';
    
    const units = ['字节', 'KB', 'MB', 'GB', 'TB'];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    if (i === 0) {
      return `${bytes} ${units[i]}`;
    }
    
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${units[i]}`;
  }

  /**
   * Extract file extension from filename
   * @param {string} filename - Filename or path
   * @returns {string} File extension without dot (e.g., "jpg")
   */
  static getFileExtension(filename) {
    const ext = path.extname(filename);
    return ext ? ext.slice(1).toLowerCase() : '';
  }

  /**
   * Extract filename from path
   * @param {string} filePath - File path
   * @returns {string} Filename without path
   */
  static getFileName(filePath) {
    return path.basename(filePath);
  }

  /**
   * Get file name without extension
   * @param {string} filename - Filename or path
   * @returns {string} Filename without extension
   */
  static getFileNameWithoutExtension(filename) {
    const base = path.basename(filename);
    const ext = path.extname(base);
    return ext ? base.slice(0, -ext.length) : base;
  }

  /**
   * Create a file system error with additional context
   * @private
   * @param {Error} error - Original error
   * @param {string} operation - Operation that caused the error
   * @param {string} filePath - File path involved
   * @returns {Error} Enhanced error
   */
  static _createFileSystemError(error, operation, filePath) {
    const enhancedError = new Error(error.message);
    enhancedError.originalError = error;
    enhancedError.operation = operation;
    enhancedError.filePath = filePath;
    enhancedError.code = error.code;
    enhancedError.stack = error.stack;
    return enhancedError;
  }
}

module.exports = { FileSystemHelper };
