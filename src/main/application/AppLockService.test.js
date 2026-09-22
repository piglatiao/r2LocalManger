/**
 * AppLockService 单元测试
 */

const { AppLockService } = require('./AppLockService');
const { LocalCryptoService } = require('./LocalCryptoService');

/**
 * 内存版设置仓库，避免测试依赖 electron-store。
 */
function createMemoryStore(initial = {}) {
  const data = { ...initial };
  return {
    data,
    get: (key, fallback) => (key in data ? data[key] : fallback),
    set: (key, value) => {
      data[key] = value;
    },
    delete: (key) => {
      delete data[key];
    }
  };
}

describe('AppLockService', () => {
  let crypto;
  let store;
  let lock;

  beforeEach(() => {
    crypto = new LocalCryptoService();
    store = createMemoryStore();
    lock = new AppLockService(crypto, {
      store,
      encryptSecret: (plain) => Buffer.from(plain, 'utf8').toString('base64'),
      decryptSecret: (encoded) => Buffer.from(encoded, 'base64').toString('utf8')
    });
  });

  describe('初始状态', () => {
    test('未设置密码时不锁定，并准备好本地缓存密钥', () => {
      const result = lock.bootstrap();

      expect(result.locked).toBe(false);
      expect(crypto.hasKey()).toBe(true);
      expect(lock.getStatus().needsSetup).toBe(true);
    });

    test('本地缓存密钥会被持久化，重启后仍是同一个', () => {
      lock.bootstrap();
      const firstKey = crypto.key;

      const crypto2 = new LocalCryptoService();
      const lock2 = new AppLockService(crypto2, {
        store,
        encryptSecret: (plain) => Buffer.from(plain, 'utf8').toString('base64'),
        decryptSecret: (encoded) => Buffer.from(encoded, 'base64').toString('utf8')
      });
      lock2.bootstrap();

      expect(crypto2.key.equals(firstKey)).toBe(true);
    });
  });

  describe('设置与解锁', () => {
    test('设置密码后启用，并可正常解锁', async () => {
      await lock.applyNewPassword('my-password', true);
      expect(lock.getStatus().hasPassword).toBe(true);
      expect(lock.getStatus().enabled).toBe(true);

      // 模拟重启：清空内存密钥
      crypto.clearKey();
      expect(lock.getStatus().locked).toBe(true);

      const result = await lock.unlock('my-password');
      expect(result.success).toBe(true);
      expect(lock.getStatus().locked).toBe(false);
      expect(crypto.hasKey()).toBe(true);
    });

    test('错误密码无法解锁', async () => {
      await lock.applyNewPassword('my-password', true);
      crypto.clearKey();

      const result = await lock.unlock('wrong-password');
      expect(result.success).toBe(false);
      expect(result.userMessage).toBeTruthy();
      expect(crypto.hasKey()).toBe(false);
      expect(lock.getStatus().locked).toBe(true);
    });

    test('密码过短会被拒绝', async () => {
      await expect(lock.applyNewPassword('ab', true)).rejects.toThrow();
    });

    test('密码只保存校验值，不保存明文', async () => {
      await lock.applyNewPassword('my-password', true);

      const serialized = JSON.stringify(store.data);
      expect(serialized).not.toContain('my-password');
      expect(store.data.appLockSalt).toBeTruthy();
      expect(store.data.appLockVerifier).toBeTruthy();
    });
  });

  describe('修改 / 关闭', () => {
    test('原密码正确才能修改，且密钥会变化', async () => {
      await lock.applyNewPassword('old-password', true);
      const oldKey = Buffer.from(crypto.key);

      const okResult = await lock.changePassword('old-password', 'new-password');
      expect(okResult.success).toBe(true);
      expect(crypto.key.equals(oldKey)).toBe(false);

      crypto.clearKey();
      expect((await lock.unlock('new-password')).success).toBe(true);
    });

    test('原密码错误不能修改', async () => {
      await lock.applyNewPassword('old-password', true);

      const result = await lock.changePassword('nope', 'new-password');
      expect(result.success).toBe(false);
    });

    test('关闭密码锁后不再锁定，且仍能拿到缓存密钥', async () => {
      await lock.applyNewPassword('old-password', true);

      const result = await lock.disable('old-password');
      expect(result.success).toBe(true);
      expect(lock.getStatus().enabled).toBe(false);
      expect(lock.getStatus().locked).toBe(false);
      expect(crypto.hasKey()).toBe(true);
    });

    test('关闭密码锁需要验证原密码', async () => {
      await lock.applyNewPassword('old-password', true);

      const result = await lock.disable('wrong');
      expect(result.success).toBe(false);
      expect(lock.getStatus().enabled).toBe(true);
    });
  });

  describe('找回密码', () => {
    test('重设密码后可用新密码解锁，旧密码失效', async () => {
      await lock.applyNewPassword('forgotten', true);

      // 找回流程：Cloudflare 校验通过后调用 applyNewPassword
      await lock.applyNewPassword('brand-new', true);
      crypto.clearKey();

      expect((await lock.unlock('forgotten')).success).toBe(false);
      expect((await lock.unlock('brand-new')).success).toBe(true);
    });
  });

  describe('暂不设置', () => {
    test('选择暂不设置后不再提示', async () => {
      expect(lock.getStatus().needsSetup).toBe(true);

      lock.dismissSetup();

      expect(lock.getStatus().needsSetup).toBe(false);
    });
  });
});
