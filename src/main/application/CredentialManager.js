/**
 * CredentialManager - Application Layer
 * 
 * Manages R2 API credentials by reading from environment variables
 * and validating them. Provides complete R2 configuration.
 */

/**
 * CredentialManager class for managing R2 credentials
 */
class CredentialManager {
  /**
   * Load credentials from environment variables
   * @returns {Object} Credentials object
   * @returns {string} credentials.accessKeyId - R2 Access Key ID
   * @returns {string} credentials.secretAccessKey - R2 Secret Access Key
   * @throws {Error} If credentials are missing
   */
  static loadCredentials() {
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

    if (!accessKeyId || !secretAccessKey) {
      const error = new Error('Missing R2 credentials');
      error.code = 'MISSING_CREDENTIALS';
      error.details = {
        hasAccessKeyId: !!accessKeyId,
        hasSecretAccessKey: !!secretAccessKey
      };
      throw error;
    }

    return {
      accessKeyId,
      secretAccessKey
    };
  }

  /**
   * Validate credentials
   * @param {Object} credentials - Credentials to validate
   * @param {string} credentials.accessKeyId - R2 Access Key ID
   * @param {string} credentials.secretAccessKey - R2 Secret Access Key
   * @returns {boolean} True if credentials are valid
   */
  static validateCredentials(credentials) {
    if (!credentials) {
      return false;
    }

    const { accessKeyId, secretAccessKey } = credentials;

    // Check if both credentials exist and are non-empty strings
    if (!accessKeyId || typeof accessKeyId !== 'string' || accessKeyId.trim() === '') {
      return false;
    }

    if (!secretAccessKey || typeof secretAccessKey !== 'string' || secretAccessKey.trim() === '') {
      return false;
    }

    return true;
  }

  /**
   * Get complete R2 configuration
   * @returns {Object} R2Config object
   * @returns {string} config.endpoint - R2 endpoint URL
   * @returns {string} config.region - AWS region
   * @returns {string} config.bucket - Bucket name
   * @returns {string} config.accessKeyId - R2 Access Key ID
   * @returns {string} config.secretAccessKey - R2 Secret Access Key
   * @throws {Error} If credentials are missing or invalid
   */
  static getConfig() {
    const credentials = this.loadCredentials();

    if (!this.validateCredentials(credentials)) {
      const error = new Error('Invalid R2 credentials');
      error.code = 'INVALID_CREDENTIALS';
      throw error;
    }

    // Return complete R2 configuration with hardcoded values
    return {
      endpoint: 'https://12b1178bf0856d6e0b7d787ebd43cee5.r2.cloudflarestorage.com',
      region: 'auto',
      bucket: 'picture',
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey
    };
  }
}

module.exports = { CredentialManager };
