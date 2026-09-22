/**
 * LocalCryptoService - Application Layer
 *
 * 本地缓存（缩略图 / 对象列表）的加解密。
 *
 * 目标：缓存目录下不出现明文图片，别人直接打开文件夹只看到一堆二进制密文。
 * 算法：AES-256-GCM，密钥由应用密码经 scrypt 派生；未启用密码锁时使用
 * 本地随机密钥（再用系统 safeStorage 包一层存盘）。
 */

const crypto = require('crypto');

const MAGIC = Buffer.from('R2CE', 'ascii');
const FORMAT_VERSION = 1;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const HEADER_LENGTH = MAGIC.length + 1 + IV_LENGTH + AUTH_TAG_LENGTH;

const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/**
 * 使用 scrypt 从密码派生密钥。
 * @param {string} password - 明文密码
 * @param {Buffer|string} salt - 盐值
 * @returns {Promise<Buffer>} 32 字节密钥
 */
function deriveKey(password, salt) {
  const saltBuffer = Buffer.isBuffer(salt) ? salt : Buffer.from(String(salt), 'base64');

  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password || ''), saltBuffer, KEY_LENGTH, SCRYPT_OPTIONS, (error, key) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(key);
    });
  });
}

/**
 * 同步派生密钥（仅在明确可接受阻塞时使用，例如启动前的一次性解锁）。
 * @param {string} password - 明文密码
 * @param {Buffer|string} salt - 盐值
 * @returns {Buffer} 32 字节密钥
 */
function deriveKeySync(password, salt) {
  const saltBuffer = Buffer.isBuffer(salt) ? salt : Buffer.from(String(salt), 'base64');
  return crypto.scryptSync(String(password || ''), saltBuffer, KEY_LENGTH, SCRYPT_OPTIONS);
}

class LocalCryptoService {
  constructor() {
    /** @type {Buffer|null} */
    this.key = null;
  }

  /**
   * 设置当前会话密钥。
   * @param {Buffer|null} key - 32 字节密钥
   */
  setKey(key) {
    this.key = Buffer.isBuffer(key) && key.length === KEY_LENGTH ? key : null;
  }

  /**
   * 清除会话密钥（锁屏 / 退出时调用）。
   */
  clearKey() {
    if (this.key) {
      this.key.fill(0);
    }
    this.key = null;
  }

  /**
   * 当前是否持有可用密钥。
   * @returns {boolean} 是否可用
   */
  hasKey() {
    return Boolean(this.key);
  }

  /**
   * 加密内容；无密钥时原样返回（降级为明文，保证功能不中断）。
   * @param {Buffer} buffer - 明文内容
   * @returns {Buffer} 密文（含头部）
   */
  encrypt(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      return buffer;
    }

    if (!this.key) {
      return buffer;
    }

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return Buffer.concat([
      MAGIC,
      Buffer.from([FORMAT_VERSION]),
      iv,
      authTag,
      ciphertext
    ]);
  }

  /**
   * 解密内容；无密钥或非本服务产生的格式时返回 null。
   * @param {Buffer} buffer - 密文（含头部）
   * @returns {Buffer|null} 明文内容
   */
  decrypt(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      return null;
    }

    // 非加密格式（旧数据或降级写入）直接按明文返回
    if (buffer.length < HEADER_LENGTH || !buffer.subarray(0, MAGIC.length).equals(MAGIC)) {
      return buffer;
    }

    if (!this.key) {
      return null;
    }

    try {
      const version = buffer[MAGIC.length];
      if (version !== FORMAT_VERSION) {
        return null;
      }

      const iv = buffer.subarray(MAGIC.length + 1, MAGIC.length + 1 + IV_LENGTH);
      const authTag = buffer.subarray(
        MAGIC.length + 1 + IV_LENGTH,
        MAGIC.length + 1 + IV_LENGTH + AUTH_TAG_LENGTH
      );
      const ciphertext = buffer.subarray(HEADER_LENGTH);

      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(authTag);

      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch (error) {
      return null;
    }
  }

  /**
   * 判断内容是否为本服务加密的格式。
   * @param {Buffer} buffer - 待判断内容
   * @returns {boolean} 是否为加密格式
   */
  isEncrypted(buffer) {
    return Boolean(buffer)
      && buffer.length >= HEADER_LENGTH
      && buffer.subarray(0, MAGIC.length).equals(MAGIC);
  }
}

/**
 * 生成随机盐值。
 * @returns {Buffer} 16 字节盐值
 */
function generateSalt() {
  return crypto.randomBytes(SALT_LENGTH);
}

/**
 * 生成随机缓存密钥（未启用密码锁时使用）。
 * @returns {Buffer} 32 字节密钥
 */
function generateKey() {
  return crypto.randomBytes(KEY_LENGTH);
}

/**
 * 生成密码校验值（HMAC），不存储密码本身。
 * @param {Buffer} key - 派生密钥
 * @returns {string} hex 校验值
 */
function buildVerifier(key) {
  return crypto.createHmac('sha256', key).update('r2-storage-manager-app-lock-v1').digest('hex');
}

/**
 * 常量时间比较校验值。
 * @param {string} left - 校验值 A
 * @param {string} right - 校验值 B
 * @returns {boolean} 是否一致
 */
function verifyVerifier(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

module.exports = {
  LocalCryptoService,
  deriveKey,
  deriveKeySync,
  generateSalt,
  generateKey,
  buildVerifier,
  verifyVerifier,
  KEY_LENGTH,
  SALT_LENGTH
};
