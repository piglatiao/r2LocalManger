/**
 * ErrorLogger Tests
 */

const fs = require('fs');
const path = require('path');
const { ErrorLogger } = require('./ErrorLogger');

// Mock electron app
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => 'C:\\Users\\TestUser\\AppData\\Roaming\\r2-storage-manager')
  }
}));

describe('ErrorLogger', () => {
  const mockLogDir = 'C:\\Users\\TestUser\\AppData\\Roaming\\r2-storage-manager\\logs';
  const mockLogPath = path.join(mockLogDir, 'error.log');

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
    
    // Mock fs methods
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);
    jest.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
    jest.spyOn(fs, 'appendFileSync').mockImplementation(() => {});
    jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
    jest.spyOn(fs, 'readFileSync').mockReturnValue('');
    jest.spyOn(fs, 'statSync').mockReturnValue({ size: 1024 });
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getLogPath', () => {
    it('should return correct log file path', () => {
      const logPath = ErrorLogger.getLogPath();
      expect(logPath).toBe(mockLogPath);
    });
  });

  describe('logError', () => {
    it('should create log directory if it does not exist', () => {
      fs.existsSync.mockReturnValue(false);
      
      const error = new Error('Test error');
      ErrorLogger.logError(error, 'TestContext');
      
      expect(fs.mkdirSync).toHaveBeenCalledWith(mockLogDir, { recursive: true });
    });

    it('should not create log directory if it already exists', () => {
      fs.existsSync.mockReturnValue(true);
      
      const error = new Error('Test error');
      ErrorLogger.logError(error, 'TestContext');
      
      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });

    it('should append error to log file with timestamp and context', () => {
      const error = new Error('Test error message');
      const context = 'uploadFile';
      
      ErrorLogger.logError(error, context);
      
      expect(fs.appendFileSync).toHaveBeenCalledWith(
        mockLogPath,
        expect.stringContaining('[uploadFile]'),
        'utf-8'
      );
      expect(fs.appendFileSync).toHaveBeenCalledWith(
        mockLogPath,
        expect.stringContaining('Error: Test error message'),
        'utf-8'
      );
    });

    it('should include error stack trace in log', () => {
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at test.js:10:5';
      
      ErrorLogger.logError(error, 'TestContext');
      
      expect(fs.appendFileSync).toHaveBeenCalledWith(
        mockLogPath,
        expect.stringContaining('Stack Trace:'),
        'utf-8'
      );
    });

    it('should include error type if available', () => {
      const error = new Error('Test error');
      error.errorType = 'NetworkError';
      
      ErrorLogger.logError(error, 'TestContext');
      
      expect(fs.appendFileSync).toHaveBeenCalledWith(
        mockLogPath,
        expect.stringContaining('Type: NetworkError'),
        'utf-8'
      );
    });

    it('should include error code if available', () => {
      const error = new Error('Test error');
      error.code = 'ENOENT';
      
      ErrorLogger.logError(error, 'TestContext');
      
      expect(fs.appendFileSync).toHaveBeenCalledWith(
        mockLogPath,
        expect.stringContaining('Code: ENOENT'),
        'utf-8'
      );
    });

    it('should use "Unknown" as default context', () => {
      const error = new Error('Test error');
      
      ErrorLogger.logError(error);
      
      expect(fs.appendFileSync).toHaveBeenCalledWith(
        mockLogPath,
        expect.stringContaining('[Unknown]'),
        'utf-8'
      );
    });

    it('should log to console even if file write fails', () => {
      fs.appendFileSync.mockImplementation(() => {
        throw new Error('Write failed');
      });
      
      const error = new Error('Test error');
      ErrorLogger.logError(error, 'TestContext');
      
      expect(console.error).toHaveBeenCalledWith(
        '[ErrorLogger] Failed to write to log file:',
        expect.any(Error)
      );
      expect(console.error).toHaveBeenCalledWith(
        '[ErrorLogger] Original error:',
        error
      );
    });
  });

  describe('clearLog', () => {
    it('should delete log file if it exists', () => {
      fs.existsSync.mockReturnValue(true);
      
      const result = ErrorLogger.clearLog();
      
      expect(fs.unlinkSync).toHaveBeenCalledWith(mockLogPath);
      expect(result).toBe(true);
    });

    it('should return true if log file does not exist', () => {
      fs.existsSync.mockReturnValue(false);
      
      const result = ErrorLogger.clearLog();
      
      expect(fs.unlinkSync).not.toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should return false if deletion fails', () => {
      fs.existsSync.mockReturnValue(true);
      fs.unlinkSync.mockImplementation(() => {
        throw new Error('Delete failed');
      });
      
      const result = ErrorLogger.clearLog();
      
      expect(result).toBe(false);
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('readLog', () => {
    it('should read log file content if it exists', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('Log content');
      
      const content = ErrorLogger.readLog();
      
      expect(fs.readFileSync).toHaveBeenCalledWith(mockLogPath, 'utf-8');
      expect(content).toBe('Log content');
    });

    it('should return empty string if log file does not exist', () => {
      fs.existsSync.mockReturnValue(false);
      
      const content = ErrorLogger.readLog();
      
      expect(fs.readFileSync).not.toHaveBeenCalled();
      expect(content).toBe('');
    });

    it('should return empty string if read fails', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockImplementation(() => {
        throw new Error('Read failed');
      });
      
      const content = ErrorLogger.readLog();
      
      expect(content).toBe('');
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('getLogSize', () => {
    it('should return log file size if it exists', () => {
      fs.existsSync.mockReturnValue(true);
      fs.statSync.mockReturnValue({ size: 2048 });
      
      const size = ErrorLogger.getLogSize();
      
      expect(fs.statSync).toHaveBeenCalledWith(mockLogPath);
      expect(size).toBe(2048);
    });

    it('should return 0 if log file does not exist', () => {
      fs.existsSync.mockReturnValue(false);
      
      const size = ErrorLogger.getLogSize();
      
      expect(fs.statSync).not.toHaveBeenCalled();
      expect(size).toBe(0);
    });

    it('should return 0 if stat fails', () => {
      fs.existsSync.mockReturnValue(true);
      fs.statSync.mockImplementation(() => {
        throw new Error('Stat failed');
      });
      
      const size = ErrorLogger.getLogSize();
      
      expect(size).toBe(0);
      expect(console.error).toHaveBeenCalled();
    });
  });
});
