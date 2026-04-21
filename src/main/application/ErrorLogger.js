/**
 * ErrorLogger - Application Layer
 * 
 * Logs errors to a file with timestamp and context information.
 * Provides centralized error logging for the application.
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/**
 * ErrorLogger class for logging errors
 */
class ErrorLogger {
  /**
   * Get the log directory path
   * @private
   * @returns {string} Log directory path
   */
  static _getLogDirectory() {
    // Use %APPDATA%/r2-storage-manager/logs/ on Windows
    const userDataPath = app.getPath('userData');
    return path.join(userDataPath, 'logs');
  }

  /**
   * Get the log file path
   * @returns {string} Log file path
   */
  static getLogPath() {
    const logDir = this._getLogDirectory();
    return path.join(logDir, 'error.log');
  }

  /**
   * Ensure log directory exists
   * @private
   */
  static _ensureLogDirectory() {
    const logDir = this._getLogDirectory();
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  /**
   * Format error for logging
   * @private
   * @param {Error} error - Error to format
   * @param {string} context - Context information
   * @returns {string} Formatted error message
   */
  static _formatError(error, context) {
    const timestamp = new Date().toISOString();
    const separator = '='.repeat(80);
    
    let logMessage = `\n${separator}\n`;
    logMessage += `[${timestamp}] [${context}]\n`;
    logMessage += `${separator}\n`;
    
    // Error message
    logMessage += `Error: ${error.message}\n`;
    
    // Error type if available
    if (error.errorType) {
      logMessage += `Type: ${error.errorType}\n`;
    }
    
    // Error code if available
    if (error.code) {
      logMessage += `Code: ${error.code}\n`;
    }
    
    // Operation if available
    if (error.operation) {
      logMessage += `Operation: ${error.operation}\n`;
    }
    
    // File path if available
    if (error.filePath) {
      logMessage += `File Path: ${error.filePath}\n`;
    }
    
    // Stack trace
    if (error.stack) {
      logMessage += `\nStack Trace:\n${error.stack}\n`;
    }
    
    // Original error if available
    if (error.originalError && error.originalError !== error) {
      logMessage += `\nOriginal Error:\n`;
      logMessage += `Message: ${error.originalError.message}\n`;
      if (error.originalError.stack) {
        logMessage += `Stack: ${error.originalError.stack}\n`;
      }
    }
    
    logMessage += `${separator}\n`;
    
    return logMessage;
  }

  /**
   * Log an error to the log file
   * @param {Error} error - Error to log
   * @param {string} context - Context information (e.g., "uploadFile", "downloadFile")
   */
  static logError(error, context = 'Unknown') {
    try {
      // Ensure log directory exists
      this._ensureLogDirectory();
      
      // Format error message
      const logMessage = this._formatError(error, context);
      
      // Append to log file
      const logPath = this.getLogPath();
      fs.appendFileSync(logPath, logMessage, 'utf-8');
      
      // Also log to console for development
      console.error(`[ErrorLogger] ${context}:`, error);
    } catch (loggingError) {
      // If logging fails, at least log to console
      console.error('[ErrorLogger] Failed to write to log file:', loggingError);
      console.error('[ErrorLogger] Original error:', error);
    }
  }

  /**
   * Clear the log file
   * @returns {boolean} True if successful, false otherwise
   */
  static clearLog() {
    try {
      const logPath = this.getLogPath();
      if (fs.existsSync(logPath)) {
        fs.unlinkSync(logPath);
      }
      return true;
    } catch (error) {
      console.error('[ErrorLogger] Failed to clear log file:', error);
      return false;
    }
  }

  /**
   * Read the log file content
   * @returns {string} Log file content
   */
  static readLog() {
    try {
      const logPath = this.getLogPath();
      if (fs.existsSync(logPath)) {
        return fs.readFileSync(logPath, 'utf-8');
      }
      return '';
    } catch (error) {
      console.error('[ErrorLogger] Failed to read log file:', error);
      return '';
    }
  }

  /**
   * Get log file size in bytes
   * @returns {number} Log file size
   */
  static getLogSize() {
    try {
      const logPath = this.getLogPath();
      if (fs.existsSync(logPath)) {
        const stats = fs.statSync(logPath);
        return stats.size;
      }
      return 0;
    } catch (error) {
      console.error('[ErrorLogger] Failed to get log file size:', error);
      return 0;
    }
  }

  /**
   * Rotate log file if it exceeds size limit (10MB)
   * @private
   */
  static _rotateLogIfNeeded() {
    try {
      const maxSize = 10 * 1024 * 1024; // 10MB
      const logPath = this.getLogPath();
      
      if (fs.existsSync(logPath)) {
        const stats = fs.statSync(logPath);
        if (stats.size > maxSize) {
          // Rename current log to backup
          const backupPath = logPath.replace('.log', `.${Date.now()}.log`);
          fs.renameSync(logPath, backupPath);
          
          // Keep only last 5 backup files
          const logDir = this._getLogDirectory();
          const files = fs.readdirSync(logDir)
            .filter(f => f.startsWith('error.') && f.endsWith('.log'))
            .map(f => ({
              name: f,
              path: path.join(logDir, f),
              time: fs.statSync(path.join(logDir, f)).mtime.getTime()
            }))
            .sort((a, b) => b.time - a.time);
          
          // Delete old backups
          files.slice(5).forEach(file => {
            fs.unlinkSync(file.path);
          });
        }
      }
    } catch (error) {
      console.error('[ErrorLogger] Failed to rotate log file:', error);
    }
  }
}

module.exports = { ErrorLogger };
