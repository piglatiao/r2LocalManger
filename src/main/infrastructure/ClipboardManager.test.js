/**
 * ClipboardManager Tests
 * 
 * Tests to verify ClipboardManager functionality using Jest
 */

// Mock Electron clipboard API
let mockClipboardContent = '';
const mockClipboard = {
  writeText: jest.fn((text) => {
    mockClipboardContent = text;
  }),
  readText: jest.fn(() => {
    return mockClipboardContent;
  }),
  clear: jest.fn(() => {
    mockClipboardContent = '';
  })
};

// Mock the electron module before requiring ClipboardManager
jest.mock('electron', () => ({
  clipboard: mockClipboard
}));

const { ClipboardManager } = require('./ClipboardManager');

describe('ClipboardManager', () => {
  beforeEach(() => {
    // Reset mock clipboard content before each test
    mockClipboardContent = '';
    jest.clearAllMocks();
  });

  describe('writeText()', () => {
    it('should write valid text to clipboard and return true', () => {
      const text = 'https://example.com/image.jpg';
      const result = ClipboardManager.writeText(text);
      
      expect(result).toBe(true);
      expect(mockClipboard.writeText).toHaveBeenCalledWith(text);
      expect(mockClipboardContent).toBe(text);
    });

    it('should write valid HTML to clipboard and return true', () => {
      const html = '<img src="https://example.com/image.jpg" alt="image" />';
      const result = ClipboardManager.writeText(html);
      
      expect(result).toBe(true);
      expect(mockClipboard.writeText).toHaveBeenCalledWith(html);
      expect(mockClipboardContent).toBe(html);
    });

    it('should write valid Markdown to clipboard and return true', () => {
      const markdown = '![image](https://example.com/image.jpg)';
      const result = ClipboardManager.writeText(markdown);
      
      expect(result).toBe(true);
      expect(mockClipboard.writeText).toHaveBeenCalledWith(markdown);
      expect(mockClipboardContent).toBe(markdown);
    });

    it('should return false for empty string', () => {
      const result = ClipboardManager.writeText('');
      
      expect(result).toBe(false);
      expect(mockClipboard.writeText).not.toHaveBeenCalled();
    });

    it('should return false for null value', () => {
      const result = ClipboardManager.writeText(null);
      
      expect(result).toBe(false);
      expect(mockClipboard.writeText).not.toHaveBeenCalled();
    });

    it('should return false for undefined value', () => {
      const result = ClipboardManager.writeText(undefined);
      
      expect(result).toBe(false);
      expect(mockClipboard.writeText).not.toHaveBeenCalled();
    });

    it('should return false for non-string value (number)', () => {
      const result = ClipboardManager.writeText(12345);
      
      expect(result).toBe(false);
      expect(mockClipboard.writeText).not.toHaveBeenCalled();
    });

    it('should return false for non-string value (object)', () => {
      const result = ClipboardManager.writeText({ url: 'https://example.com' });
      
      expect(result).toBe(false);
      expect(mockClipboard.writeText).not.toHaveBeenCalled();
    });
  });

  describe('readText()', () => {
    it('should read text from clipboard', () => {
      const testText = 'Test clipboard content';
      ClipboardManager.writeText(testText);
      
      const result = ClipboardManager.readText();
      
      expect(result).toBe(testText);
      expect(mockClipboard.readText).toHaveBeenCalled();
    });

    it('should return empty string when clipboard is empty', () => {
      const result = ClipboardManager.readText();
      
      expect(result).toBe('');
      expect(mockClipboard.readText).toHaveBeenCalled();
    });
  });

  describe('clear()', () => {
    it('should clear clipboard and return true', () => {
      ClipboardManager.writeText('Content to be cleared');
      
      const clearResult = ClipboardManager.clear();
      
      expect(clearResult).toBe(true);
      expect(mockClipboard.clear).toHaveBeenCalled();
      
      const content = ClipboardManager.readText();
      expect(content).toBe('');
    });
  });

  describe('success/failure feedback', () => {
    it('should return true for successful write operation', () => {
      const result = ClipboardManager.writeText('Valid text');
      
      expect(result).toBe(true);
    });

    it('should return false for failed write operation', () => {
      const result = ClipboardManager.writeText(null);
      
      expect(result).toBe(false);
    });
  });
});
