/**
 * ErrorHandler Unit Tests
 * 
 * Tests for error message generation and helper methods
 */

const { ErrorHandler, ErrorAction } = require('./ErrorHandler');
const { ErrorType } = require('./R2Client');
const { UI_TEXT } = require('../../../i18n/zh-CN');

describe('ErrorHandler', () => {
  describe('getUserMessage', () => {
    test('should return network error message', () => {
      const error = { errorType: ErrorType.NETWORK, message: 'Network error' };
      const message = ErrorHandler.getUserMessage(error);
      expect(message).toBe(UI_TEXT.errorNetwork);
    });

    test('should return auth error message with detail', () => {
      const error = { errorType: ErrorType.AUTH, message: 'Auth error' };
      const message = ErrorHandler.getUserMessage(error);
      expect(message).toBe(`${UI_TEXT.errorAuth}\n${UI_TEXT.errorAuthDetail}`);
    });

    test('should return bucket error message', () => {
      const error = { errorType: ErrorType.BUCKET, message: 'Bucket error' };
      const message = ErrorHandler.getUserMessage(error);
      expect(message).toBe(UI_TEXT.errorBucket);
    });

    test('should return object error message', () => {
      const error = { errorType: ErrorType.OBJECT, message: 'Object error' };
      const message = ErrorHandler.getUserMessage(error);
      expect(message).toBe(UI_TEXT.errorObject);
    });

    test('should return permission error message', () => {
      const error = { errorType: ErrorType.PERMISSION, message: 'Permission error' };
      const message = ErrorHandler.getUserMessage(error);
      expect(message).toBe(UI_TEXT.errorPermission);
    });

    test('should return file not found message for ENOENT', () => {
      const error = { errorType: ErrorType.FILE_SYSTEM, fileSystemCode: 'ENOENT', message: 'File not found' };
      const message = ErrorHandler.getUserMessage(error);
      expect(message).toBe(UI_TEXT.errorFileNotFound);
    });

    test('should return file access message for EACCES', () => {
      const error = { errorType: ErrorType.FILE_SYSTEM, fileSystemCode: 'EACCES', message: 'Access denied' };
      const message = ErrorHandler.getUserMessage(error);
      expect(message).toBe(UI_TEXT.errorFileAccess);
    });

    test('should return disk space message for ENOSPC', () => {
      const error = { errorType: ErrorType.FILE_SYSTEM, fileSystemCode: 'ENOSPC', message: 'No space' };
      const message = ErrorHandler.getUserMessage(error);
      expect(message).toBe(UI_TEXT.errorDiskSpace);
    });

    test('should return unknown error message for unknown type', () => {
      const error = { errorType: ErrorType.UNKNOWN, message: 'Unknown error' };
      const message = ErrorHandler.getUserMessage(error);
      expect(message).toBe(UI_TEXT.errorUnknown);
    });

    test('should return unknown error message for unclassified error', () => {
      const error = { message: 'Some error' };
      const message = ErrorHandler.getUserMessage(error);
      expect(message).toBe(UI_TEXT.errorUnknown);
    });
  });

  describe('getOperationMessage', () => {
    test('should return upload failed message for upload operation', () => {
      const error = { errorType: ErrorType.NETWORK, message: 'Network error' };
      const message = ErrorHandler.getOperationMessage(error, 'upload');
      expect(message).toBe(UI_TEXT.errorUploadFailed.replace('{error}', UI_TEXT.errorNetwork));
    });

    test('should return download failed message for download operation', () => {
      const error = { errorType: ErrorType.NETWORK, message: 'Network error' };
      const message = ErrorHandler.getOperationMessage(error, 'download');
      expect(message).toBe(UI_TEXT.errorDownloadFailed.replace('{error}', UI_TEXT.errorNetwork));
    });

    test('should return delete failed message for delete operation', () => {
      const error = { errorType: ErrorType.NETWORK, message: 'Network error' };
      const message = ErrorHandler.getOperationMessage(error, 'delete');
      expect(message).toBe(UI_TEXT.errorDeleteFailed.replace('{error}', UI_TEXT.errorNetwork));
    });

    test('should return preview failed message for preview operation', () => {
      const error = { errorType: ErrorType.NETWORK, message: 'Network error' };
      const message = ErrorHandler.getOperationMessage(error, 'preview');
      expect(message).toBe(UI_TEXT.errorPreviewFailed.replace('{error}', UI_TEXT.errorNetwork));
    });

    test('should return base message for unknown operation', () => {
      const error = { errorType: ErrorType.NETWORK, message: 'Network error' };
      const message = ErrorHandler.getOperationMessage(error, 'unknown');
      expect(message).toBe(UI_TEXT.errorNetwork);
    });
  });

  describe('isRetryable', () => {
    test('should return true for network error', () => {
      const error = { errorType: ErrorType.NETWORK };
      expect(ErrorHandler.isRetryable(error)).toBe(true);
    });

    test('should return false for auth error', () => {
      const error = { errorType: ErrorType.AUTH };
      expect(ErrorHandler.isRetryable(error)).toBe(false);
    });

    test('should return false for bucket error', () => {
      const error = { errorType: ErrorType.BUCKET };
      expect(ErrorHandler.isRetryable(error)).toBe(false);
    });

    test('should return false for object error', () => {
      const error = { errorType: ErrorType.OBJECT };
      expect(ErrorHandler.isRetryable(error)).toBe(false);
    });

    test('should return false for permission error', () => {
      const error = { errorType: ErrorType.PERMISSION };
      expect(ErrorHandler.isRetryable(error)).toBe(false);
    });

    test('should return false for file system error', () => {
      const error = { errorType: ErrorType.FILE_SYSTEM };
      expect(ErrorHandler.isRetryable(error)).toBe(false);
    });

    test('should return false for unknown error', () => {
      const error = { errorType: ErrorType.UNKNOWN };
      expect(ErrorHandler.isRetryable(error)).toBe(false);
    });
  });

  describe('isAuthError', () => {
    test('should return true for auth error', () => {
      const error = { errorType: ErrorType.AUTH };
      expect(ErrorHandler.isAuthError(error)).toBe(true);
    });

    test('should return false for network error', () => {
      const error = { errorType: ErrorType.NETWORK };
      expect(ErrorHandler.isAuthError(error)).toBe(false);
    });

    test('should return false for permission error', () => {
      const error = { errorType: ErrorType.PERMISSION };
      expect(ErrorHandler.isAuthError(error)).toBe(false);
    });
  });

  describe('shouldRefreshList', () => {
    test('should return true for object error', () => {
      const error = { errorType: ErrorType.OBJECT };
      expect(ErrorHandler.shouldRefreshList(error)).toBe(true);
    });

    test('should return false for network error', () => {
      const error = { errorType: ErrorType.NETWORK };
      expect(ErrorHandler.shouldRefreshList(error)).toBe(false);
    });

    test('should return false for auth error', () => {
      const error = { errorType: ErrorType.AUTH };
      expect(ErrorHandler.shouldRefreshList(error)).toBe(false);
    });

    test('should return false for bucket error', () => {
      const error = { errorType: ErrorType.BUCKET };
      expect(ErrorHandler.shouldRefreshList(error)).toBe(false);
    });
  });

  describe('getRecommendedAction', () => {
    test('should return RETRY for network error', () => {
      const error = { errorType: ErrorType.NETWORK };
      expect(ErrorHandler.getRecommendedAction(error)).toBe(ErrorAction.RETRY);
    });

    test('should return REAUTH for auth error', () => {
      const error = { errorType: ErrorType.AUTH };
      expect(ErrorHandler.getRecommendedAction(error)).toBe(ErrorAction.REAUTH);
    });

    test('should return REFRESH for object error', () => {
      const error = { errorType: ErrorType.OBJECT };
      expect(ErrorHandler.getRecommendedAction(error)).toBe(ErrorAction.REFRESH);
    });

    test('should return DISMISS for bucket error', () => {
      const error = { errorType: ErrorType.BUCKET };
      expect(ErrorHandler.getRecommendedAction(error)).toBe(ErrorAction.DISMISS);
    });

    test('should return DISMISS for permission error', () => {
      const error = { errorType: ErrorType.PERMISSION };
      expect(ErrorHandler.getRecommendedAction(error)).toBe(ErrorAction.DISMISS);
    });

    test('should return DISMISS for file system error', () => {
      const error = { errorType: ErrorType.FILE_SYSTEM };
      expect(ErrorHandler.getRecommendedAction(error)).toBe(ErrorAction.DISMISS);
    });

    test('should return VIEW_LOGS for unknown error', () => {
      const error = { errorType: ErrorType.UNKNOWN };
      expect(ErrorHandler.getRecommendedAction(error)).toBe(ErrorAction.VIEW_LOGS);
    });

    test('should return VIEW_LOGS for unclassified error', () => {
      const error = { message: 'Some error' };
      expect(ErrorHandler.getRecommendedAction(error)).toBe(ErrorAction.VIEW_LOGS);
    });
  });

  describe('getAvailableActions', () => {
    test('should include RETRY for network error', () => {
      const error = { errorType: ErrorType.NETWORK };
      const actions = ErrorHandler.getAvailableActions(error);
      expect(actions).toContain(ErrorAction.RETRY);
    });

    test('should include REAUTH for auth error', () => {
      const error = { errorType: ErrorType.AUTH };
      const actions = ErrorHandler.getAvailableActions(error);
      expect(actions).toContain(ErrorAction.REAUTH);
    });

    test('should include REFRESH for object error', () => {
      const error = { errorType: ErrorType.OBJECT };
      const actions = ErrorHandler.getAvailableActions(error);
      expect(actions).toContain(ErrorAction.REFRESH);
    });

    test('should include VIEW_LOGS for unknown error', () => {
      const error = { errorType: ErrorType.UNKNOWN };
      const actions = ErrorHandler.getAvailableActions(error);
      expect(actions).toContain(ErrorAction.VIEW_LOGS);
    });

    test('should include DISMISS for all errors', () => {
      const error = { errorType: ErrorType.NETWORK };
      const actions = ErrorHandler.getAvailableActions(error);
      expect(actions).toContain(ErrorAction.DISMISS);
    });
  });

  describe('formatForLog', () => {
    test('should format error with all components', () => {
      const error = {
        errorType: ErrorType.NETWORK,
        operation: 'uploadObject',
        message: 'Network connection failed',
        stack: 'Error: Network connection failed\n    at test.js:10:5'
      };

      const logEntry = ErrorHandler.formatForLog(error, 'Testing upload');

      expect(logEntry).toContain('ERROR');
      expect(logEntry).toContain('Type: NETWORK');
      expect(logEntry).toContain('Operation: uploadObject');
      expect(logEntry).toContain('Context: Testing upload');
      expect(logEntry).toContain('Message: Network connection failed');
      expect(logEntry).toContain('Stack:');
    });

    test('should handle error without errorType', () => {
      const error = {
        message: 'Some error',
        stack: 'Error: Some error'
      };

      const logEntry = ErrorHandler.formatForLog(error, 'Test');

      expect(logEntry).toContain('Type: UNCLASSIFIED');
    });

    test('should handle error without operation', () => {
      const error = {
        errorType: ErrorType.NETWORK,
        message: 'Network error',
        stack: 'Error: Network error'
      };

      const logEntry = ErrorHandler.formatForLog(error, 'Test');

      expect(logEntry).toContain('Operation: unknown');
    });
  });

  describe('createErrorDialogOptions', () => {
    test('should create dialog options with all required properties', () => {
      const error = {
        errorType: ErrorType.NETWORK,
        message: 'Network error',
        operation: 'upload'
      };

      const options = ErrorHandler.createErrorDialogOptions(error, 'upload');

      expect(options.type).toBe('error');
      expect(options.buttons).toBeInstanceOf(Array);
      expect(options.buttons.length).toBeGreaterThan(0);
      expect(options.actions).toBeInstanceOf(Array);
      expect(options.actions.length).toBeGreaterThan(0);
      expect(typeof options.message).toBe('string');
      expect(typeof options.title).toBe('string');
      expect(options.error).toBe(error);
    });

    test('should include retry action for network error', () => {
      const error = {
        errorType: ErrorType.NETWORK,
        message: 'Network error'
      };

      const options = ErrorHandler.createErrorDialogOptions(error, 'upload');

      expect(options.actions).toContain(ErrorAction.RETRY);
    });

    test('should include reauth action for auth error', () => {
      const error = {
        errorType: ErrorType.AUTH,
        message: 'Auth error'
      };

      const options = ErrorHandler.createErrorDialogOptions(error, 'upload');

      expect(options.actions).toContain(ErrorAction.REAUTH);
    });
  });
});

describe('ErrorAction constants', () => {
  test('should have all required action types', () => {
    expect(ErrorAction.RETRY).toBe('RETRY');
    expect(ErrorAction.REAUTH).toBe('REAUTH');
    expect(ErrorAction.REFRESH).toBe('REFRESH');
    expect(ErrorAction.VIEW_LOGS).toBe('VIEW_LOGS');
    expect(ErrorAction.DISMISS).toBe('DISMISS');
  });
});
