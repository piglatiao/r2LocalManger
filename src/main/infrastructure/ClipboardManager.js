/**
 * ClipboardManager - Infrastructure Layer
 * 
 * Wrapper for Electron clipboard API to provide clipboard operations
 * with success/failure feedback.
 */

const { clipboard } = require('electron');

/**
 * ClipboardManager class for clipboard operations
 */
class ClipboardManager {
  /**
   * Write text to clipboard
   * @param {string} text - Text to write to clipboard
   * @returns {boolean} True if successful, false otherwise
   */
  static writeText(text) {
    try {
      if (!text || typeof text !== 'string') {
        throw new Error('Invalid text: must be a non-empty string');
      }
      
      clipboard.writeText(text);
      return true;
    } catch (error) {
      console.error('Failed to write to clipboard:', error);
      return false;
    }
  }

  /**
   * Read text from clipboard
   * @returns {string} Text from clipboard
   */
  static readText() {
    try {
      return clipboard.readText();
    } catch (error) {
      console.error('Failed to read from clipboard:', error);
      return '';
    }
  }

  /**
   * Clear clipboard
   * @returns {boolean} True if successful, false otherwise
   */
  static clear() {
    try {
      clipboard.clear();
      return true;
    } catch (error) {
      console.error('Failed to clear clipboard:', error);
      return false;
    }
  }
}

module.exports = { ClipboardManager };
