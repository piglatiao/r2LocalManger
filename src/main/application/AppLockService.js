/**
 * AppLockService - Application Layer
 *
 * 应用密码锁：启动后需要输入密码才能进入；密码只保存 salt + 校验值，不保存明文。
 * 忘记密码时可用当前桶的 Cloudflare Account ID + API Token 验证身份后重设。
 *
 * 密码同时用于派生本地缓存（缩略图 / 对象列表）的加密密钥：
 * - 启用密码锁：密钥由密码派生，只有输入正确密码才能解密缓存
 * - 未启用密码锁：使用本地随机密钥（经系统 safeStorage 加密后存盘），
 *   保证缓存目录里依然是密文而不是可直接打开的图片
 */

const {
  deriveKey,
  generateSalt,
  generateKey,
  buildVerifier,
  verifyVerifier,
  KEY_LENGTH
} = require('./LocalCryptoService');

const MIN_PASSWORD_LENGTH = 4;

const STORE_KEY_ENABLED = 'appLockEnabled';
const STORE_KEY_SALT = 'appLockSalt';
const STORE_KEY_VERIFIER = 'appLockVerifier';
const STORE_KEY_DISMISSED = 'appLockSetupDismissed';
const STORE_KEY_FALLBACK_KEY = 'localCacheKey';

/**
 * 默认设置仓库（懒加载 electron-store，便于在测试环境替换为内存实现）。
 * @returns {{get: Function, set: Function, delete: Function}} 仓库对象
 */
function createDefaultStore() {
  let instance = null;

  const resolve = () => {
    if (!instance) {
      const Store = require('electron-store');
      instance = new Store({ name: 'settings' });
    }
    return instance;
  };

  return {
    get: (key, fallback) => {
      try {
        return resolve().get(key, fallback);
      } catch {
        return fallback;
      }
    },
    set: (key, value) => {
      try {
        resolve().set(key, value);
      } catch {
        // 忽略写入失败
      }
    },
    delete: (key) => {
      try {
        resolve().delete(key);
      } catch {
        // 忽略删除失败
      }
    }
  };
}

/**
 * 默认的机密值加密（系统 safeStorage），不可用时降级为 base64。
 * @param {string} plain - 明文
 * @returns {string} 密文（base64）
 */
function defaultEncryptSecret(plain) {
  try {
    const { safeStorage } = require('electron');
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(String(plain)).toString('base64');
    }
  } catch {
    // 降级为 base64
  }
  return Buffer.from(String(plain), 'utf8').toString('base64');
}

/**
 * 默认的机密值解密。
 * @param {string} encoded - 密文（base64）
 * @returns {string} 明文
 */
function defaultDecryptSecret(encoded) {
  if (!encoded) {
    return '';
  }

  try {
    const { safeStorage } = require('electron');
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(String(encoded), 'base64'));
    }
  } catch {
    // 兼容未加密的历史值
  }

  return Buffer.from(String(encoded), 'base64').toString('utf8');
}

class AppLockService {
  /**
   * @param {Object} crypto - LocalCryptoService 实例
   * @param {Object} [options] - 可注入依赖（测试用）
   */
  constructor(crypto, options = {}) {
    this.crypto = crypto;
    this.store = options.store || createDefaultStore();
    this.encryptSecret = options.encryptSecret || defaultEncryptSecret;
    this.decryptSecret = options.decryptSecret || defaultDecryptSecret;
  }

  /**
   * 读取密码锁状态。
   * @returns {{enabled: boolean, hasPassword: boolean, locked: boolean, needsSetup: boolean}} 状态
   */
  getStatus() {
    const enabled = this.store.get(STORE_KEY_ENABLED, false) === true;
    const hasPassword = Boolean(this.store.get(STORE_KEY_SALT, '')) && Boolean(this.store.get(STORE_KEY_VERIFIER, ''));
    const dismissed = this.store.get(STORE_KEY_DISMISSED, false) === true;

    return {
      enabled,
      hasPassword,
      locked: enabled && hasPassword && !this.crypto.hasKey(),
      // 未启用且未设置过密码，且用户没有选择“暂不设置”时才提示初始化
      needsSetup: !enabled && !hasPassword && !dismissed
    };
  }

  /**
   * 标记用户暂不设置密码。
   */
  dismissSetup() {
    this.store.set(STORE_KEY_DISMISSED, true);
  }

  /**
   * 保存新密码（重置 / 首次设置共用）。
   * @param {string} password - 新密码
   * @param {boolean} enable - 是否同时启用密码锁
   * @returns {Promise<void>}
   */
  async applyNewPassword(password, enable = true) {
    const normalized = String(password || '');
    if (normalized.length < MIN_PASSWORD_LENGTH) {
      const error = new Error('Password too short');
      error.userMessage = `密码至少需要 ${MIN_PASSWORD_LENGTH} 个字符`;
      throw error;
    }

    const salt = generateSalt();
    const key = await deriveKey(normalized, salt);

    this.store.set(STORE_KEY_SALT, salt.toString('base64'));
    this.store.set(STORE_KEY_VERIFIER, buildVerifier(key));
    this.store.set(STORE_KEY_ENABLED, enable);
    this.store.set(STORE_KEY_DISMISSED, true);

    this.crypto.setKey(key);
  }

  /**
   * 校验密码是否正确（不解锁）。
   * @param {string} password - 待校验密码
   * @returns {Promise<boolean>} 是否正确
   */
  async verifyPassword(password) {
    const salt = this.store.get(STORE_KEY_SALT, '');
    const verifier = this.store.get(STORE_KEY_VERIFIER, '');
    if (!salt || !verifier) {
      return false;
    }

    const key = await deriveKey(String(password || ''), salt);
    const matched = verifyVerifier(buildVerifier(key), verifier);
    if (matched) {
      this.crypto.setKey(key);
    } else {
      key.fill(0);
    }

    return matched;
  }

  /**
   * 解锁应用。
   * @param {string} password - 密码
   * @returns {Promise<{success: boolean, userMessage?: string}>} 解锁结果
   */
  async unlock(password) {
    const matched = await this.verifyPassword(password);
    if (!matched) {
      return { success: false, userMessage: '密码错误，请重试' };
    }

    this.store.set(STORE_KEY_ENABLED, true);
    return { success: true };
  }

  /**
   * 修改密码（需要原密码）。
   * @param {string} currentPassword - 原密码
   * @param {string} newPassword - 新密码
   * @returns {Promise<{success: boolean, userMessage?: string}>} 结果
   */
  async changePassword(currentPassword, newPassword) {
    const matched = await this.verifyPassword(currentPassword);
    if (!matched) {
      return { success: false, userMessage: '原密码不正确' };
    }

    await this.applyNewPassword(newPassword, true);
    return { success: true };
  }

  /**
   * 关闭密码锁（需要原密码），并切换回本地随机密钥以保住已有缓存。
   * @param {string} currentPassword - 原密码
   * @returns {Promise<{success: boolean, userMessage?: string}>} 结果
   */
  async disable(currentPassword) {
    const matched = await this.verifyPassword(currentPassword);
    if (!matched) {
      return { success: false, userMessage: '原密码不正确' };
    }

    this.store.set(STORE_KEY_ENABLED, false);
    this.store.delete(STORE_KEY_SALT);
    this.store.delete(STORE_KEY_VERIFIER);
    this.provisionFallbackKey();
    return { success: true };
  }

  /**
   * 启用密码锁（把已有的随机密钥换成密码派生密钥）。
   * @param {string} password - 密码
   * @returns {Promise<{success: boolean, userMessage?: string}>} 结果
   */
  async enable(password) {
    await this.applyNewPassword(password, true);
    return { success: true };
  }

  /**
   * 启动时准备缓存密钥。
   * 未启用密码锁时使用本地随机密钥（首次自动生成并加密保存）。
   * @returns {{unlocked: boolean}} 是否已有可用密钥
   */
  provisionFallbackKey() {
    const encoded = this.store.get(STORE_KEY_FALLBACK_KEY, '');
    let key = null;

    if (encoded) {
      const decoded = this.decryptSecret(encoded);
      const buffer = decoded ? Buffer.from(decoded, 'base64') : Buffer.alloc(0);
      if (buffer.length === KEY_LENGTH) {
        key = buffer;
      }
    }

    if (!key) {
      key = generateKey();
      this.store.set(STORE_KEY_FALLBACK_KEY, this.encryptSecret(key.toString('base64')));
    }

    this.crypto.setKey(key);
    return { unlocked: true };
  }

  /**
   * 启动时初始化：按状态决定是否需要等待用户输入密码。
   * @returns {{locked: boolean, enabled: boolean, hasPassword: boolean}} 初始化结果
   */
  bootstrap() {
    const status = this.getStatus();

    if (status.enabled && status.hasPassword) {
      // 需要用户输入密码才能拿到密钥
      this.crypto.clearKey();
      return { locked: true, enabled: true, hasPassword: true };
    }

    this.provisionFallbackKey();
    return { locked: false, enabled: false, hasPassword: status.hasPassword };
  }
}

module.exports = {
  AppLockService,
  MIN_PASSWORD_LENGTH,
  STORE_KEY_ENABLED,
  STORE_KEY_SALT,
  STORE_KEY_VERIFIER,
  STORE_KEY_DISMISSED,
  STORE_KEY_FALLBACK_KEY
};
