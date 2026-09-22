/**
 * CredentialManager - Application Layer
 *
 * 负责校验应用内设置页提供的 R2 凭证。
 */

/**
 * CredentialManager class for managing R2 credentials
 */
class CredentialManager {
  /**
   * 标准化设置页提供的凭证。
   * @param {Object} credentials - 应用内设置中的凭证
   * @returns {Object} 标准化后的凭证
   * @throws {Error} 凭证缺失时抛出异常
   */
  static loadCredentials(credentials = {}) {
    const accessKeyId = typeof credentials.accessKeyId === 'string'
      ? credentials.accessKeyId.trim()
      : '';
    const secretAccessKey = typeof credentials.secretAccessKey === 'string'
      ? credentials.secretAccessKey.trim()
      : '';

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
   * 根据应用内凭证和设置组装 R2 配置。
   * @param {Object} credentials - 应用内设置中的凭证
   * @param {Object} settings - 应用内设置中的连接参数
   * @returns {Object} R2 配置
   * @throws {Error} 凭证缺失或无效时抛出异常
   */
  static getConfig(credentials, settings = {}) {
    const normalizedCredentials = this.loadCredentials(credentials);

    if (!this.validateCredentials(normalizedCredentials)) {
      const error = new Error('Invalid R2 credentials');
      error.code = 'INVALID_CREDENTIALS';
      throw error;
    }

    return {
      endpoint: String(settings.endpoint || '').trim(),
      region: String(settings.region || 'auto').trim() || 'auto',
      bucket: String(settings.bucket || '').trim(),
      accessKeyId: normalizedCredentials.accessKeyId,
      secretAccessKey: normalizedCredentials.secretAccessKey
    };
  }
}

module.exports = { CredentialManager };
