/**
 * Unit tests for URLFormatter
 */

const { URLFormatter, URLFormat } = require('./URLFormatter');

describe('URLFormatter', () => {
  const baseUrl = 'https://example.r2.cloudflarestorage.com/picture/test-image.jpg';
  const key = 'folder/test-image.jpg';

  describe('formatUrl', () => {
    test('should return plain URL for URL format', () => {
      const result = URLFormatter.formatUrl(baseUrl, key, URLFormat.URL);
      expect(result).toBe(baseUrl);
    });

    test('should return HTML img tag for HTML format', () => {
      const result = URLFormatter.formatUrl(baseUrl, key, URLFormat.HTML);
      expect(result).toBe('<img src="https://example.r2.cloudflarestorage.com/picture/test-image.jpg" alt="test-image" />');
    });

    test('should return Markdown image syntax for MARKDOWN format', () => {
      const result = URLFormatter.formatUrl(baseUrl, key, URLFormat.MARKDOWN);
      expect(result).toBe('![test-image](https://example.r2.cloudflarestorage.com/picture/test-image.jpg)');
    });

    test('should handle filename without extension', () => {
      const noExtKey = 'folder/testfile';
      const result = URLFormatter.formatUrl(baseUrl, noExtKey, URLFormat.HTML);
      expect(result).toContain('alt="testfile"');
    });

    test('should extract filename from nested path', () => {
      const nestedKey = 'folder1/folder2/folder3/image.png';
      const result = URLFormatter.formatUrl(baseUrl, nestedKey, URLFormat.MARKDOWN);
      expect(result).toBe('![image](https://example.r2.cloudflarestorage.com/picture/test-image.jpg)');
    });

    test('should handle multiple dots in filename', () => {
      const multiDotKey = 'my.test.file.jpg';
      const result = URLFormatter.formatUrl(baseUrl, multiDotKey, URLFormat.HTML);
      expect(result).toContain('alt="my.test.file"');
    });

    test('should default to URL format for unknown format', () => {
      const result = URLFormatter.formatUrl(baseUrl, key, 'unknown');
      expect(result).toBe(baseUrl);
    });

    test('should handle empty key', () => {
      const result = URLFormatter.formatUrl(baseUrl, '', URLFormat.HTML);
      expect(result).toBe('<img src="https://example.r2.cloudflarestorage.com/picture/test-image.jpg" alt="" />');
    });
  });

  describe('URLFormat constants', () => {
    test('should have correct format values', () => {
      expect(URLFormat.URL).toBe('url');
      expect(URLFormat.HTML).toBe('html');
      expect(URLFormat.MARKDOWN).toBe('markdown');
    });
  });
});
