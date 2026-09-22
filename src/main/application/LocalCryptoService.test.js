/**
 * LocalCryptoService 单元测试
 */

const {
  LocalCryptoService,
  deriveKey,
  generateSalt,
  generateKey,
  buildVerifier,
  verifyVerifier,
  KEY_LENGTH
} = require('./LocalCryptoService');

describe('LocalCryptoService', () => {
  let crypto;

  beforeEach(() => {
    crypto = new LocalCryptoService();
  });

  describe('key management', () => {
    test('初始状态没有密钥', () => {
      expect(crypto.hasKey()).toBe(false);
    });

    test('设置 32 字节密钥后可用', () => {
      crypto.setKey(generateKey());
      expect(crypto.hasKey()).toBe(true);
    });

    test('长度不对的密钥会被拒绝', () => {
      crypto.setKey(Buffer.alloc(16));
      expect(crypto.hasKey()).toBe(false);
    });

    test('清除密钥后不可用', () => {
      crypto.setKey(generateKey());
      crypto.clearKey();
      expect(crypto.hasKey()).toBe(false);
    });
  });

  describe('encrypt / decrypt', () => {
    test('加解密可还原原始内容', () => {
      crypto.setKey(generateKey());
      const plain = Buffer.from('hello thumbnail');

      const cipher = crypto.encrypt(plain);
      expect(cipher.equals(plain)).toBe(false);
      expect(crypto.isEncrypted(cipher)).toBe(true);

      const restored = crypto.decrypt(cipher);
      expect(restored).not.toBeNull();
      expect(restored.equals(plain)).toBe(true);
    });

    test('相同明文每次加密结果不同（IV 随机）', () => {
      crypto.setKey(generateKey());
      const plain = Buffer.from('same-input');

      expect(crypto.encrypt(plain).equals(crypto.encrypt(plain))).toBe(false);
    });

    test('密文中不包含明文字节', () => {
      crypto.setKey(generateKey());
      const plain = Buffer.concat([Buffer.from('JFIF'), Buffer.alloc(512, 0x41)]);

      const cipher = crypto.encrypt(plain);
      expect(cipher.includes(Buffer.from('JFIF'))).toBe(false);
    });

    test('用错误的密钥解密返回 null', () => {
      crypto.setKey(generateKey());
      const cipher = crypto.encrypt(Buffer.from('secret'));

      crypto.setKey(generateKey());
      expect(crypto.decrypt(cipher)).toBeNull();
    });

    test('没有密钥时加密原样返回（降级），解密密文返回 null', () => {
      const plain = Buffer.from('no-key-mode');

      expect(crypto.encrypt(plain).equals(plain)).toBe(true);

      crypto.setKey(generateKey());
      const cipher = crypto.encrypt(plain);
      crypto.clearKey();

      expect(crypto.decrypt(cipher)).toBeNull();
    });

    test('空内容不做加密', () => {
      crypto.setKey(generateKey());
      const empty = Buffer.alloc(0);
      expect(crypto.encrypt(empty).equals(empty)).toBe(true);
      expect(crypto.decrypt(empty)).toBeNull();
    });

    test('非加密格式的内容按明文返回（兼容旧数据）', () => {
      crypto.setKey(generateKey());
      const legacy = Buffer.from('legacy-plain-cache');
      expect(crypto.decrypt(legacy).equals(legacy)).toBe(true);
    });

    test('篡改密文后解密失败而不是返回乱码', () => {
      crypto.setKey(generateKey());
      const cipher = crypto.encrypt(Buffer.from('tamper-test'));
      cipher[cipher.length - 1] ^= 0xFF;

      expect(crypto.decrypt(cipher)).toBeNull();
    });
  });

  describe('key derivation', () => {
    test('相同密码与盐派生出相同密钥', async () => {
      const salt = generateSalt();
      const first = await deriveKey('password-1', salt);
      const second = await deriveKey('password-1', salt);

      expect(first.length).toBe(KEY_LENGTH);
      expect(first.equals(second)).toBe(true);
    });

    test('不同密码或不同盐派生出不同密钥', async () => {
      const salt = generateSalt();
      const otherSalt = generateSalt();

      expect((await deriveKey('a', salt)).equals(await deriveKey('b', salt))).toBe(false);
      expect((await deriveKey('a', salt)).equals(await deriveKey('a', otherSalt))).toBe(false);
    });

    test('校验值可用于验证密码且可区分错误密码', async () => {
      const salt = generateSalt();
      const verifier = buildVerifier(await deriveKey('correct', salt));

      expect(verifyVerifier(buildVerifier(await deriveKey('correct', salt)), verifier)).toBe(true);
      expect(verifyVerifier(buildVerifier(await deriveKey('wrong', salt)), verifier)).toBe(false);
    });
  });
});
