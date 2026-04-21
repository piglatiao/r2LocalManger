/**
 * URLFormatter - Application Layer
 * 
 * Formats object URLs into different formats (URL, HTML, Markdown)
 * for easy copying and sharing.
 */

const path = require('path');

/**
 * URL format types
 */
const URLFormat = {
  URL: 'url',
  HTML: 'html',
  MARKDOWN: 'markdown'
};

/**
 * URLFormatter class for formatting object URLs
 */
class URLFormatter {
  /**
   * Format object URL into specified format
   * @param {string} baseUrl - Base URL of the object
   * @param {string} key - Object key (filename)
   * @param {string} format - Format type (url, html, markdown)
   * @returns {string} Formatted URL string
   */
  static formatUrl(baseUrl, key, format) {
    // Construct the full URL
    const fullUrl = baseUrl;

    // Extract filename for alt text
    const filename = path.basename(key);
    const filenameWithoutExt = this._getFilenameWithoutExtension(filename);

    switch (format) {
      case URLFormat.URL:
        return fullUrl;

      case URLFormat.HTML:
        return `<img src="${fullUrl}" alt="${filenameWithoutExt}" />`;

      case URLFormat.MARKDOWN:
        return `![${filenameWithoutExt}](${fullUrl})`;

      default:
        // Default to URL format if unknown format is provided
        return fullUrl;
    }
  }

  /**
   * Get filename without extension for alt text
   * @private
   * @param {string} filename - Filename with extension
   * @returns {string} Filename without extension
   */
  static _getFilenameWithoutExtension(filename) {
    const ext = path.extname(filename);
    return ext ? filename.slice(0, -ext.length) : filename;
  }
}

module.exports = { URLFormatter, URLFormat };
