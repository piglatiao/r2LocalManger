/**
 * FileSystemHelper Unit Tests
 * 
 * Tests for file system utility methods
 */

const { FileSystemHelper } = require('./FileSystemHelper');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Mock fs module with promises
jest.mock('fs', () => {
  const mockFs = {
    existsSync: jest.fn(),
    mkdirSync: jest.fn(),
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
    statSync: jest.fn(),
    createReadStream: jest.fn(),
    createWriteStream: jest.fn(),
    rmSync: jest.fn(),
    promises: {
      readFile: jest.fn(),
      writeFile: jest.fn(),
      mkdir: jest.fn()
    }
  };
  return mockFs;
});

describe('FileSystemHelper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validatePath', () => {
    test('should return true for valid absolute path', () => {
      const result = FileSystemHelper.validatePath('/valid/path/file.txt');
      expect(result).toBe(true);
    });

    test('should return true for valid relative path', () => {
      const result = FileSystemHelper.validatePath('./relative/path/file.txt');
      expect(result).toBe(true);
    });

    test('should return true for simple filename', () => {
      const result = FileSystemHelper.validatePath('file.txt');
      expect(result).toBe(true);
    });

    test('should return true for path in subdirectory', () => {
      const result = FileSystemHelper.validatePath('folder/subfolder/file.txt');
      expect(result).toBe(true);
    });

    test('should return false for empty string', () => {
      const result = FileSystemHelper.validatePath('');
      expect(result).toBe(false);
    });

    test('should return false for null value', () => {
      const result = FileSystemHelper.validatePath(null);
      expect(result).toBe(false);
    });

    test('should return false for undefined value', () => {
      const result = FileSystemHelper.validatePath(undefined);
      expect(result).toBe(false);
    });

    test('should return false for path exceeding MAX_PATH', () => {
      const longPath = 'a'.repeat(300) + '.txt';
      const result = FileSystemHelper.validatePath(longPath);
      expect(result).toBe(false);
    });

    // Windows-specific tests
    if (process.platform === 'win32') {
      test('should return true for valid Windows path with drive', () => {
        const result = FileSystemHelper.validatePath('C:\\Users\\Documents\\file.txt');
        expect(result).toBe(true);
      });

      test('should return false for invalid character: pipe', () => {
        const result = FileSystemHelper.validatePath('file|name.txt');
        expect(result).toBe(false);
      });

      test('should return false for invalid character: asterisk', () => {
        const result = FileSystemHelper.validatePath('file*.txt');
        expect(result).toBe(false);
      });

      test('should return false for invalid character: question mark', () => {
        const result = FileSystemHelper.validatePath('file?.txt');
        expect(result).toBe(false);
      });

      test('should return false for reserved name: CON', () => {
        const result = FileSystemHelper.validatePath('CON.txt');
        expect(result).toBe(false);
      });

      test('should return false for reserved name: PRN', () => {
        const result = FileSystemHelper.validatePath('PRN');
        expect(result).toBe(false);
      });

      test('should return false for reserved name: COM1', () => {
        const result = FileSystemHelper.validatePath('COM1.log');
        expect(result).toBe(false);
      });

      test('should return true for UNC path', () => {
        const result = FileSystemHelper.validatePath('\\\\server\\share\\file.txt');
        expect(result).toBe(true);
      });
    }
  });

  describe('fileExists', () => {
    test('should return true when file exists', () => {
      fs.existsSync.mockReturnValue(true);
      
      const result = FileSystemHelper.fileExists('/path/to/file.txt');
      
      expect(result).toBe(true);
      expect(fs.existsSync).toHaveBeenCalledWith('/path/to/file.txt');
    });

    test('should return false when file does not exist', () => {
      fs.existsSync.mockReturnValue(false);
      
      const result = FileSystemHelper.fileExists('/path/to/nonexistent.txt');
      
      expect(result).toBe(false);
    });
  });

  describe('readFile', () => {
    test('should read file content successfully', async () => {
      const testContent = 'Hello, World!';
      fs.promises.readFile.mockResolvedValue(Buffer.from(testContent));
      
      const result = await FileSystemHelper.readFile('/path/to/file.txt');
      
      expect(result.toString()).toBe(testContent);
      expect(fs.promises.readFile).toHaveBeenCalledWith('/path/to/file.txt');
    });

    test('should throw error when file does not exist', async () => {
      const error = new Error('File not found');
      error.code = 'ENOENT';
      fs.promises.readFile.mockRejectedValue(error);
      
      await expect(FileSystemHelper.readFile('/path/to/nonexistent.txt'))
        .rejects.toThrow();
    });
  });

  describe('writeFile', () => {
    test('should write file content successfully', async () => {
      const testContent = Buffer.from('Test content');
      fs.promises.writeFile.mockResolvedValue();
      fs.promises.mkdir.mockResolvedValue();
      
      await FileSystemHelper.writeFile('/path/to/file.txt', testContent);
      
      expect(fs.promises.writeFile).toHaveBeenCalledWith('/path/to/file.txt', testContent);
    });

    test('should create nested directories if needed', async () => {
      const testContent = Buffer.from('Test content');
      fs.promises.writeFile.mockResolvedValue();
      fs.promises.mkdir.mockResolvedValue();
      
      await FileSystemHelper.writeFile('/path/to/nested/file.txt', testContent);
      
      expect(fs.promises.mkdir).toHaveBeenCalled();
    });
  });

  describe('getFileSize', () => {
    test('should return file size', () => {
      fs.statSync.mockReturnValue({ size: 1024 });
      
      const result = FileSystemHelper.getFileSize('/path/to/file.txt');
      
      expect(result).toBe(1024);
      expect(fs.statSync).toHaveBeenCalledWith('/path/to/file.txt');
    });

    test('should throw error when file does not exist', () => {
      const error = new Error('File not found');
      error.code = 'ENOENT';
      fs.statSync.mockImplementation(() => { throw error; });
      
      expect(() => FileSystemHelper.getFileSize('/path/to/nonexistent.txt'))
        .toThrow();
    });
  });

  describe('formatFileSize', () => {
    test('should format zero bytes', () => {
      const result = FileSystemHelper.formatFileSize(0);
      expect(result).toBe('0 字节');
    });

    test('should format bytes', () => {
      const result = FileSystemHelper.formatFileSize(500);
      expect(result).toBe('500 字节');
    });

    test('should format kilobytes', () => {
      const result = FileSystemHelper.formatFileSize(1024);
      expect(result).toBe('1.00 KB');
    });

    test('should format megabytes', () => {
      const result = FileSystemHelper.formatFileSize(1024 * 1024);
      expect(result).toBe('1.00 MB');
    });

    test('should format gigabytes', () => {
      const result = FileSystemHelper.formatFileSize(1024 * 1024 * 1024);
      expect(result).toBe('1.00 GB');
    });

    test('should format terabytes', () => {
      const result = FileSystemHelper.formatFileSize(1024 * 1024 * 1024 * 1024);
      expect(result).toBe('1.00 TB');
    });

    test('should format fractional KB', () => {
      const result = FileSystemHelper.formatFileSize(1536);
      expect(result).toBe('1.50 KB');
    });

    test('should format fractional MB', () => {
      const result = FileSystemHelper.formatFileSize(1024 * 1024 * 2.5);
      expect(result).toBe('2.50 MB');
    });
  });

  describe('getFileExtension', () => {
    test('should return extension for simple filename', () => {
      const result = FileSystemHelper.getFileExtension('file.txt');
      expect(result).toBe('txt');
    });

    test('should return last extension for multiple dots', () => {
      const result = FileSystemHelper.getFileExtension('archive.tar.gz');
      expect(result).toBe('gz');
    });

    test('should return empty string for no extension', () => {
      const result = FileSystemHelper.getFileExtension('README');
      expect(result).toBe('');
    });

    test('should return empty string for hidden file (no extension)', () => {
      const result = FileSystemHelper.getFileExtension('.gitignore');
      expect(result).toBe('');
    });

    test('should extract extension from full path', () => {
      const result = FileSystemHelper.getFileExtension('/path/to/file.jpg');
      expect(result).toBe('jpg');
    });

    test('should return lowercase for uppercase extension', () => {
      const result = FileSystemHelper.getFileExtension('IMAGE.PNG');
      expect(result).toBe('png');
    });

    test('should return lowercase for mixed case extension', () => {
      const result = FileSystemHelper.getFileExtension('document.PdF');
      expect(result).toBe('pdf');
    });
  });

  describe('getFileName', () => {
    test('should return filename from simple path', () => {
      const result = FileSystemHelper.getFileName('file.txt');
      expect(result).toBe('file.txt');
    });

    test('should extract filename from full path', () => {
      const result = FileSystemHelper.getFileName('/path/to/file.txt');
      expect(result).toBe('file.txt');
    });

    test('should extract filename from Windows path', () => {
      const result = FileSystemHelper.getFileName('C:\\Users\\Documents\\file.txt');
      expect(result).toBe('file.txt');
    });

    test('should extract filename from relative path', () => {
      const result = FileSystemHelper.getFileName('./folder/file.txt');
      expect(result).toBe('file.txt');
    });
  });

  describe('getFileNameWithoutExtension', () => {
    test('should return filename without extension', () => {
      const result = FileSystemHelper.getFileNameWithoutExtension('file.txt');
      expect(result).toBe('file');
    });

    test('should handle multiple dots', () => {
      const result = FileSystemHelper.getFileNameWithoutExtension('archive.tar.gz');
      expect(result).toBe('archive.tar');
    });

    test('should return same string for no extension', () => {
      const result = FileSystemHelper.getFileNameWithoutExtension('README');
      expect(result).toBe('README');
    });

    test('should extract from full path', () => {
      const result = FileSystemHelper.getFileNameWithoutExtension('/path/to/file.jpg');
      expect(result).toBe('file');
    });

    test('should handle hidden file', () => {
      const result = FileSystemHelper.getFileNameWithoutExtension('.gitignore');
      expect(result).toBe('.gitignore');
    });
  });

  describe('isValidFilename', () => {
    test('should return true for valid simple filename', () => {
      const result = FileSystemHelper.isValidFilename('document.txt');
      expect(result).toBe(true);
    });

    test('should return true for filename with spaces', () => {
      const result = FileSystemHelper.isValidFilename('my document.txt');
      expect(result).toBe(true);
    });

    test('should return true for filename with numbers', () => {
      const result = FileSystemHelper.isValidFilename('file123.txt');
      expect(result).toBe(true);
    });

    test('should return false for empty string', () => {
      const result = FileSystemHelper.isValidFilename('');
      expect(result).toBe(false);
    });

    test('should return false for null value', () => {
      const result = FileSystemHelper.isValidFilename(null);
      expect(result).toBe(false);
    });

    // Windows-specific tests
    if (process.platform === 'win32') {
      test('should return false for filename with pipe', () => {
        const result = FileSystemHelper.isValidFilename('file|name.txt');
        expect(result).toBe(false);
      });

      test('should return false for filename with asterisk', () => {
        const result = FileSystemHelper.isValidFilename('file*.txt');
        expect(result).toBe(false);
      });

      test('should return false for filename with question mark', () => {
        const result = FileSystemHelper.isValidFilename('file?.txt');
        expect(result).toBe(false);
      });

      test('should return false for filename with colon', () => {
        const result = FileSystemHelper.isValidFilename('file:name.txt');
        expect(result).toBe(false);
      });

      test('should return false for filename with quote', () => {
        const result = FileSystemHelper.isValidFilename('file"name.txt');
        expect(result).toBe(false);
      });

      test('should return false for filename with less than', () => {
        const result = FileSystemHelper.isValidFilename('file<name.txt');
        expect(result).toBe(false);
      });

      test('should return false for filename with greater than', () => {
        const result = FileSystemHelper.isValidFilename('file>name.txt');
        expect(result).toBe(false);
      });

      test('should return false for trailing space', () => {
        const result = FileSystemHelper.isValidFilename('filename ');
        expect(result).toBe(false);
      });

      test('should return false for trailing period', () => {
        const result = FileSystemHelper.isValidFilename('filename.');
        expect(result).toBe(false);
      });

      test('should return false for reserved name CON', () => {
        const result = FileSystemHelper.isValidFilename('CON.txt');
        expect(result).toBe(false);
      });

      test('should return false for reserved name PRN', () => {
        const result = FileSystemHelper.isValidFilename('PRN');
        expect(result).toBe(false);
      });

      test('should return false for reserved name AUX', () => {
        const result = FileSystemHelper.isValidFilename('AUX.log');
        expect(result).toBe(false);
      });

      test('should return false for reserved name COM1', () => {
        const result = FileSystemHelper.isValidFilename('COM1.txt');
        expect(result).toBe(false);
      });

      test('should return false for reserved name LPT1', () => {
        const result = FileSystemHelper.isValidFilename('LPT1.dat');
        expect(result).toBe(false);
      });
    }
  });

  describe('sanitizeFilename', () => {
    test('should return same filename for valid name', () => {
      const result = FileSystemHelper.sanitizeFilename('document.txt');
      expect(result).toBe('document.txt');
    });

    test('should return empty string for empty input', () => {
      const result = FileSystemHelper.sanitizeFilename('');
      expect(result).toBe('');
    });

    test('should return empty string for null input', () => {
      const result = FileSystemHelper.sanitizeFilename(null);
      expect(result).toBe('');
    });

    // Windows-specific tests
    if (process.platform === 'win32') {
      test('should replace pipe character', () => {
        const result = FileSystemHelper.sanitizeFilename('file|name.txt');
        expect(result).toBe('file_name.txt');
      });

      test('should replace asterisk', () => {
        const result = FileSystemHelper.sanitizeFilename('file*.txt');
        expect(result).toBe('file_.txt');
      });

      test('should replace question mark', () => {
        const result = FileSystemHelper.sanitizeFilename('file?.txt');
        expect(result).toBe('file_.txt');
      });

      test('should replace multiple invalid chars', () => {
        const result = FileSystemHelper.sanitizeFilename('file<>:"|?.txt');
        expect(result).toBe('file______.txt');
      });

      test('should sanitize reserved name CON', () => {
        const result = FileSystemHelper.sanitizeFilename('CON.txt');
        expect(result).toBe('CON_file.txt');
      });

      test('should sanitize reserved name PRN', () => {
        const result = FileSystemHelper.sanitizeFilename('PRN');
        expect(result).toBe('PRN_file');
      });

      test('should sanitize reserved name COM1', () => {
        const result = FileSystemHelper.sanitizeFilename('COM1.log');
        expect(result).toBe('COM1_file.log');
      });
    }
  });

  describe('createReadStream', () => {
    test('should create read stream for file', () => {
      const mockStream = { on: jest.fn() };
      fs.createReadStream.mockReturnValue(mockStream);
      
      const result = FileSystemHelper.createReadStream('/path/to/file.txt');
      
      expect(result).toBe(mockStream);
      expect(fs.createReadStream).toHaveBeenCalledWith('/path/to/file.txt');
    });
  });

  describe('createWriteStream', () => {
    test('should create write stream for file', () => {
      const mockStream = { on: jest.fn() };
      fs.createWriteStream.mockReturnValue(mockStream);
      
      const result = FileSystemHelper.createWriteStream('/path/to/file.txt');
      
      expect(result).toBe(mockStream);
      expect(fs.createWriteStream).toHaveBeenCalledWith('/path/to/file.txt');
    });
  });
});
