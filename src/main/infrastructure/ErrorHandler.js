/**
 * ErrorHandler - Centralized Error Handling Utility
 * 
 * Provides helper methods to convert classified errors into user-friendly messages
 * using the i18n text strings.
 * 
 * Features:
 * - Error type detection and classification
 * - User-friendly message generation in Simplified Chinese
 * - Error recovery actions (retry, refresh, re-auth)
 * - Error display helpers for dialogs
 */

const { ErrorType } = require('./R2Client');
const { UI_TEXT } = require('../../../i18n/zh-CN');

/**
 * Error action types for recovery
 */
const ErrorAction = {
  RETRY: 'RETRY',           // Network errors - can retry
  REFRESH: 'REFRESH',       // Object not found - refresh list
  REAUTH: 'REAUTH',         // Auth errors - check credentials
  DISMISS: 'DISMISS',       // Unknown errors - just dismiss
  VIEW_LOGS: 'VIEW_LOGS'    // View error logs
};

/**
 * ErrorHandler class for converting classified errors to user-friendly messages
 */
class ErrorHandler {
  /**
   * Get user-friendly error message based on error type
   * @param {Error} error - Classified error from R2Client
   * @returns {string} User-friendly error message in Simplified Chinese
   */
  static getUserMessage(error) {
    if (!error.errorType) {
      // If error is not classified, return generic unknown error message
      return UI_TEXT.errorUnknown;
    }

    switch (error.errorType) {
      case ErrorType.NETWORK:
        return UI_TEXT.errorNetwork;

      case ErrorType.AUTH:
        // Return both main message and detail for auth errors
        return `${UI_TEXT.errorAuth}\n${UI_TEXT.errorAuthDetail}`;

      case ErrorType.BUCKET:
        return UI_TEXT.errorBucket;

      case ErrorType.OBJECT:
        return UI_TEXT.errorObject;

      case ErrorType.PERMISSION:
        return UI_TEXT.errorPermission;

      case ErrorType.FILE_SYSTEM:
        // Return specific file system error message based on code
        if (error.fileSystemCode === 'ENOENT') {
          return UI_TEXT.errorFileNotFound;
        } else if (error.fileSystemCode === 'EACCES') {
          return UI_TEXT.errorFileAccess;
        } else if (error.fileSystemCode === 'ENOSPC') {
          return UI_TEXT.errorDiskSpace;
        }
        return UI_TEXT.errorUnknown;

      case ErrorType.UNKNOWN:
      default:
        return UI_TEXT.errorUnknown;
    }
  }

  /**
   * Get operation-specific error message
   * @param {Error} error - Classified error from R2Client
   * @param {string} operation - Operation type: 'upload', 'download', 'delete', 'preview'
   * @param {string} filename - Optional filename for context
   * @returns {string} Operation-specific error message
   */
  static getOperationMessage(error, operation, filename = '') {
    const baseMessage = this.getUserMessage(error);
    
    switch (operation) {
      case 'upload':
        return UI_TEXT.errorUploadFailed.replace('{error}', baseMessage);
      
      case 'download':
        return UI_TEXT.errorDownloadFailed.replace('{error}', baseMessage);
      
      case 'delete':
        return UI_TEXT.errorDeleteFailed.replace('{error}', baseMessage);
      
      case 'preview':
        return UI_TEXT.errorPreviewFailed.replace('{error}', baseMessage);
      
      default:
        return baseMessage;
    }
  }

  /**
   * Check if error is retryable (network errors can be retried)
   * @param {Error} error - Classified error from R2Client
   * @returns {boolean} True if error is retryable
   */
  static isRetryable(error) {
    return error.errorType === ErrorType.NETWORK;
  }

  /**
   * Check if error requires credential check (auth errors)
   * @param {Error} error - Classified error from R2Client
   * @returns {boolean} True if error is auth-related
   */
  static isAuthError(error) {
    return error.errorType === ErrorType.AUTH;
  }

  /**
   * Check if error requires list refresh (object not found)
   * @param {Error} error - Classified error from R2Client
   * @returns {boolean} True if list should be refreshed
   */
  static shouldRefreshList(error) {
    return error.errorType === ErrorType.OBJECT;
  }

  /**
   * Get recommended error action based on error type
   * @param {Error} error - Classified error from R2Client
   * @returns {string} Recommended action from ErrorAction enum
   */
  static getRecommendedAction(error) {
    if (!error.errorType) {
      return ErrorAction.VIEW_LOGS;
    }

    switch (error.errorType) {
      case ErrorType.NETWORK:
        return ErrorAction.RETRY;
      
      case ErrorType.AUTH:
        return ErrorAction.REAUTH;
      
      case ErrorType.OBJECT:
        return ErrorAction.REFRESH;
      
      case ErrorType.BUCKET:
      case ErrorType.PERMISSION:
      case ErrorType.FILE_SYSTEM:
        return ErrorAction.DISMISS;
      
      case ErrorType.UNKNOWN:
      default:
        return ErrorAction.VIEW_LOGS;
    }
  }

  /**
   * Get available actions for an error
   * @param {Error} error - Classified error from R2Client
   * @returns {Array<string>} Array of available actions
   */
  static getAvailableActions(error) {
    const actions = [];
    
    if (!error.errorType) {
      actions.push(ErrorAction.VIEW_LOGS);
      return actions;
    }

    // Add retry action for network errors
    if (error.errorType === ErrorType.NETWORK) {
      actions.push(ErrorAction.RETRY);
    }

    // Add refresh action for object not found errors
    if (error.errorType === ErrorType.OBJECT) {
      actions.push(ErrorAction.REFRESH);
    }

    // Add re-auth action for auth errors
    if (error.errorType === ErrorType.AUTH) {
      actions.push(ErrorAction.REAUTH);
    }

    // Always add view logs for unknown errors
    if (error.errorType === ErrorType.UNKNOWN) {
      actions.push(ErrorAction.VIEW_LOGS);
    }

    // Always add dismiss action
    actions.push(ErrorAction.DISMISS);

    return actions;
  }

  /**
   * Get button label for an action
   * @param {string} action - Action from ErrorAction enum
   * @returns {string} Button label in Simplified Chinese
   */
  static getActionLabel(action) {
    switch (action) {
      case ErrorAction.RETRY:
        return UI_TEXT.dialogButtonRetry || '重试';
      
      case ErrorAction.REFRESH:
        return UI_TEXT.refreshButton || '刷新';
      
      case ErrorAction.REAUTH:
        return UI_TEXT.menuCredentials || '检查凭证';
      
      case ErrorAction.VIEW_LOGS:
        return UI_TEXT.buttonViewLogs || '查看日志';
      
      case ErrorAction.DISMISS:
      default:
        return UI_TEXT.dialogButtonOk || '确定';
    }
  }

  /**
   * Create error dialog options
   * @param {Error} error - Classified error from R2Client
   * @param {string} operation - Operation that caused the error
   * @returns {Object} Dialog options for Electron dialog
   */
  static createErrorDialogOptions(error, operation = '') {
    const message = this.getUserMessage(error);
    const actions = this.getAvailableActions(error);
    const buttons = actions.map(action => this.getActionLabel(action));
    
    // Add log path hint for unknown errors
    let detail = '';
    if (error.errorType === ErrorType.UNKNOWN) {
      const { ErrorLogger } = require('../application/ErrorLogger');
      const logPath = ErrorLogger.getLogPath();
      detail = UI_TEXT.errorLogPath ? UI_TEXT.errorLogPath.replace('{path}', logPath) : `日志位置: ${logPath}`;
    }

    return {
      type: 'error',
      buttons: buttons,
      defaultId: 0,
      cancelId: buttons.length - 1, // Dismiss is always last
      title: UI_TEXT.mainWindowTitle || 'R2 存储管理器',
      message: message,
      detail: detail,
      actions: actions, // Include actions for handler to know which button was clicked
      error: error      // Include original error for context
    };
  }

  /**
   * Handle error action execution
   * @param {string} action - Action to execute
   * @param {Error} error - Original error
   * @param {Object} context - Context for action execution
   * @param {Function} context.onRetry - Callback for retry action
   * @param {Function} context.onRefresh - Callback for refresh action
   * @param {Function} context.onReauth - Callback for reauth action
   * @param {Function} context.onViewLogs - Callback for view logs action
   * @returns {boolean} True if action was handled
   */
  static async handleAction(action, error, context = {}) {
    switch (action) {
      case ErrorAction.RETRY:
        if (context.onRetry && typeof context.onRetry === 'function') {
          await context.onRetry();
          return true;
        }
        break;
      
      case ErrorAction.REFRESH:
        if (context.onRefresh && typeof context.onRefresh === 'function') {
          await context.onRefresh();
          return true;
        }
        break;
      
      case ErrorAction.REAUTH:
        if (context.onReauth && typeof context.onReauth === 'function') {
          await context.onReauth();
          return true;
        }
        break;
      
      case ErrorAction.VIEW_LOGS:
        if (context.onViewLogs && typeof context.onViewLogs === 'function') {
          await context.onViewLogs();
          return true;
        }
        // Default behavior: open log file location
        const { shell } = require('electron');
        const { ErrorLogger } = require('../application/ErrorLogger');
        const logPath = ErrorLogger.getLogPath();
        await shell.showItemInFolder(logPath);
        return true;
      
      case ErrorAction.DISMISS:
      default:
        return true;
    }
    return false;
  }

  /**
   * Format error for logging
   * @param {Error} error - Classified error from R2Client
   * @param {string} context - Additional context information
   * @returns {string} Formatted error log entry
   */
  static formatForLog(error, context = '') {
    const timestamp = new Date().toISOString();
    const errorType = error.errorType || 'UNCLASSIFIED';
    const operation = error.operation || 'unknown';
    const message = error.message || 'No message';
    const stack = error.stack || 'No stack trace';
    
    return [
      `[${timestamp}] ERROR`,
      `Type: ${errorType}`,
      `Operation: ${operation}`,
      `Context: ${context}`,
      `Message: ${message}`,
      `Stack: ${stack}`,
      '---'
    ].join('\n');
  }
}

module.exports = { ErrorHandler, ErrorType, ErrorAction };
