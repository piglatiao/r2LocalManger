/**
 * ThumbnailCacheService 单元测试
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ThumbnailCacheService, buildCacheId } = require('./ThumbnailCacheService');
const { LocalCryptoService, generateKey } = require('./LocalCryptoService');

describe('ThumbnailCacheService', () => {
  let rootDir;
  let cache;

  /**
   * 构造一个固定元信息，便于验证缓存键。
   */
  const buildMeta = (overrides = {}) => ({
    bucket: 'picture',
    key: 'folder/image.png',
    size: 2048,
    lastModified: '2026-01-01T00:00:00.000Z',
    etag: '"etag-1"',
    ...overrides
  });

  beforeEach(async () => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumb-cache-test-'));
    cache = new ThumbnailCacheService(rootDir);
    // 20 MB 上限，便于用 1MB 的条目触发淘汰
    cache.configure({ enabled: true, maxSizeBytes: 20 * 1024 * 1024 });
    await cache.init();
  });

  afterEach(async () => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  describe('cache id', () => {
    test('同一元信息生成相同的缓存 ID', () => {
      expect(buildCacheId(buildMeta())).toBe(buildCacheId(buildMeta()));
    });

    test('不同桶的相同 key 生成不同的缓存 ID', () => {
      expect(buildCacheId(buildMeta({ bucket: 'other' }))).not.toBe(buildCacheId(buildMeta()));
    });

    test('文件更新（size/lastModified/etag 变化）会生成不同的缓存 ID', () => {
      expect(buildCacheId(buildMeta({ size: 4096 }))).not.toBe(buildCacheId(buildMeta()));
      expect(buildCacheId(buildMeta({ etag: '"etag-2"' }))).not.toBe(buildCacheId(buildMeta()));
      expect(buildCacheId(buildMeta({ lastModified: '2026-02-01T00:00:00.000Z' })))
        .not.toBe(buildCacheId(buildMeta()));
    });
  });

  describe('get / put', () => {
    test('未命中缓存时返回 null', async () => {
      expect(await cache.get(buildMeta())).toBeNull();
    });

    test('写入后可读出相同内容', async () => {
      const content = Buffer.from('thumbnail-bytes');
      await cache.put(buildMeta(), content, 'image/jpeg');

      const hit = await cache.get(buildMeta());
      expect(hit).not.toBeNull();
      expect(hit.buffer.equals(content)).toBe(true);
      expect(hit.contentType).toBe('image/jpeg');
      expect(hit.cached).toBe(true);
    });

    test('缓存停用后不写入也不命中', async () => {
      await cache.put(buildMeta(), Buffer.from('x'));
      cache.configure({ enabled: false });

      expect(await cache.get(buildMeta())).toBeNull();

      cache.configure({ enabled: true });
      expect(await cache.get(buildMeta())).not.toBeNull();
    });

    test('空内容不会写入缓存', async () => {
      expect(await cache.put(buildMeta(), Buffer.alloc(0))).toBe(false);
    });
  });

  describe('LRU eviction', () => {
    test('超过上限时淘汰最久未使用的条目', async () => {
      const payload = Buffer.alloc(1024 * 1024, 7);

      for (let i = 0; i < 30; i += 1) {
        await cache.put(buildMeta({ key: `k-${i}`, etag: `"e${i}"` }), payload, 'image/jpeg');
      }

      const stats = await cache.getStats();
      expect(stats.usedBytes).toBeLessThanOrEqual(stats.maxSizeBytes);
      expect(stats.count).toBeLessThan(30);
    });

    test('命中会刷新访问时间，避免被立即淘汰', async () => {
      const payload = Buffer.alloc(1024 * 1024, 7);

      await cache.put(buildMeta({ key: 'hot.png', etag: '"hot"' }), payload, 'image/jpeg');
      for (let i = 0; i < 30; i += 1) {
        // 每次都触碰一下 hot.png，让它始终是最新的
        await cache.get(buildMeta({ key: 'hot.png', etag: '"hot"' }));
        await cache.put(buildMeta({ key: `k-${i}`, etag: `"e${i}"` }), payload, 'image/jpeg');
      }

      expect(await cache.get(buildMeta({ key: 'hot.png', etag: '"hot"' }))).not.toBeNull();
    });
  });

  describe('index persistence', () => {
    test('重新加载索引后仍能命中缓存', async () => {
      const content = Buffer.from('persisted-thumbnail');
      await cache.put(buildMeta(), content, 'image/jpeg');
      await cache.flush();

      const reloaded = new ThumbnailCacheService(rootDir);
      await reloaded.init();

      const hit = await reloaded.get(buildMeta());
      expect(hit).not.toBeNull();
      expect(hit.buffer.equals(content)).toBe(true);
    });

    test('索引指向的缓存文件缺失时自动丢弃该条目', async () => {
      await cache.put(buildMeta(), Buffer.from('gone'), 'image/jpeg');
      await cache.flush();

      const statsBefore = await cache.getStats();
      expect(statsBefore.count).toBe(1);

      const entry = Array.from(cache.entries.values())[0];
      fs.unlinkSync(path.join(cache.rootDir, entry.file));

      expect(await cache.get(buildMeta())).toBeNull();
      const statsAfter = await cache.getStats();
      expect(statsAfter.count).toBe(0);
    });
  });

  describe('clear / stats', () => {
    test('清理缓存会删除全部条目并释放空间', async () => {
      await cache.put(buildMeta(), Buffer.alloc(1024), 'image/jpeg');
      await cache.put(buildMeta({ key: 'b.png', etag: '"b"' }), Buffer.alloc(2048), 'image/jpeg');

      const result = await cache.clear();
      expect(result.removed).toBe(2);
      expect(result.freedBytes).toBe(3072);

      const stats = await cache.getStats();
      expect(stats.count).toBe(0);
      expect(stats.usedBytes).toBe(0);
    });

    test('统计信息包含目录与上限', async () => {
      const stats = await cache.getStats();
      expect(stats.directory).toBe(path.join(rootDir, 'thumbnail-cache'));
      expect(stats.maxSizeBytes).toBe(20 * 1024 * 1024);
      expect(stats.enabled).toBe(true);
    });
  });

  describe('远端清理', () => {
    test('purgeBuckets 只删远端已消失的桶', async () => {
      await cache.put(buildMeta(), Buffer.alloc(1024), 'image/jpeg');
      await cache.put(buildMeta({ bucket: 'backup', key: 'x.png', etag: '"x"' }), Buffer.alloc(1024), 'image/jpeg');

      const removed = await cache.purgeBuckets(['picture']);

      expect(removed).toBe(1);
      expect(await cache.get(buildMeta())).not.toBeNull();
      expect(await cache.get(buildMeta({ bucket: 'backup', key: 'x.png', etag: '"x"' }))).toBeNull();
    });

    test('pruneMissingObjects 删掉当前目录里已不存在的对象', async () => {
      await cache.put(buildMeta({ key: 'shots/a.png', etag: '"a"' }), Buffer.alloc(1024), 'image/jpeg');
      await cache.put(buildMeta({ key: 'shots/b.png', etag: '"b"' }), Buffer.alloc(1024), 'image/jpeg');

      const removed = await cache.pruneMissingObjects('picture', 'shots/', ['shots/a.png'], []);

      expect(removed).toBe(1);
      expect(await cache.get(buildMeta({ key: 'shots/a.png', etag: '"a"' }))).not.toBeNull();
      expect(await cache.get(buildMeta({ key: 'shots/b.png', etag: '"b"' }))).toBeNull();
    });

    test('pruneMissingObjects 连带清掉远端已删除文件夹里的对象', async () => {
      await cache.put(buildMeta({ key: 'gone/a.png', etag: '"ga"' }), Buffer.alloc(1024), 'image/jpeg');
      await cache.put(buildMeta({ key: 'gone/deep/b.png', etag: '"gb"' }), Buffer.alloc(1024), 'image/jpeg');
      await cache.put(buildMeta({ key: 'keep/c.png', etag: '"kc"' }), Buffer.alloc(1024), 'image/jpeg');

      const removed = await cache.pruneMissingObjects('picture', '', [], ['keep/']);

      expect(removed).toBe(2);
      expect(await cache.get(buildMeta({ key: 'keep/c.png', etag: '"kc"' }))).not.toBeNull();
      expect(await cache.get(buildMeta({ key: 'gone/a.png', etag: '"ga"' }))).toBeNull();
      expect(await cache.get(buildMeta({ key: 'gone/deep/b.png', etag: '"gb"' }))).toBeNull();
    });
  });

  describe('加密存储', () => {
    test('落盘内容不含明文，读取时自动解密', async () => {
      const crypto = new LocalCryptoService();
      crypto.setKey(generateKey());
      const secureCache = new ThumbnailCacheService(rootDir, { crypto });
      secureCache.configure({ enabled: true, maxSizeBytes: 20 * 1024 * 1024 });
      await secureCache.init();

      // 使用可识别的图片魔数，确保能验证"磁盘上没有明文"
      const secret = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.from('SECRET-IMAGE-BYTES')]);
      await secureCache.put(buildMeta(), secret, 'image/jpeg');

      const files = fs.readdirSync(secureCache.rootDir).filter(f => f !== 'index.json');
      expect(files).toHaveLength(1);

      const rawOnDisk = fs.readFileSync(path.join(secureCache.rootDir, files[0]));
      expect(rawOnDisk.includes(secret)).toBe(false);
      expect(rawOnDisk.includes(Buffer.from('SECRET-IMAGE-BYTES'))).toBe(false);
      expect(crypto.isEncrypted(rawOnDisk)).toBe(true);

      const hit = await secureCache.get(buildMeta());
      expect(hit).not.toBeNull();
      expect(hit.buffer.equals(secret)).toBe(true);
    });

    test('未持有密钥时不写入也不读取（避免明文落盘）', async () => {
      const crypto = new LocalCryptoService();
      const secureCache = new ThumbnailCacheService(rootDir, { crypto });
      await secureCache.init();

      expect(await secureCache.put(buildMeta(), Buffer.from('plain'), 'image/jpeg')).toBe(false);
      expect(await secureCache.get(buildMeta())).toBeNull();

      const files = fs.readdirSync(secureCache.rootDir).filter(f => f !== 'index.json');
      expect(files).toHaveLength(0);
    });

    test('更换密钥后旧缓存自动失效而不是返回乱码', async () => {
      const crypto = new LocalCryptoService();
      crypto.setKey(generateKey());
      const secureCache = new ThumbnailCacheService(rootDir, { crypto });
      await secureCache.init();

      await secureCache.put(buildMeta(), Buffer.from('old-key-data'), 'image/jpeg');
      expect(await secureCache.get(buildMeta())).not.toBeNull();

      crypto.setKey(generateKey());
      expect(await secureCache.get(buildMeta())).toBeNull();
    });
  });
});
