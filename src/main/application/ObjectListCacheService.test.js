/**
 * ObjectListCacheService 单元测试
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ObjectListCacheService, buildListCacheId, normalizePrefixValue } = require('./ObjectListCacheService');
const { LocalCryptoService, generateKey } = require('./LocalCryptoService');

describe('ObjectListCacheService', () => {
  let rootDir;
  let cache;

  const buildObjects = (count = 2) => Array.from({ length: count }, (_, index) => ({
    key: `file-${index}.png`,
    size: 1024 * (index + 1),
    lastModified: new Date('2026-01-01T00:00:00.000Z'),
    isFolder: false
  }));

  beforeEach(async () => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'list-cache-test-'));
    cache = new ObjectListCacheService(rootDir);
    // 注意：configure 会把 maxEntries 钳到 [20, 5000]
    cache.configure({ enabled: true, maxEntries: 20, maxSizeBytes: 10 * 1024 * 1024 });
    await cache.init();
  });

  afterEach(async () => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  describe('cache id', () => {
    test('同一 bucket + prefix 生成相同 ID', () => {
      expect(buildListCacheId('picture', 'a/b/')).toBe(buildListCacheId('picture', 'a/b/'));
    });

    test('不同 bucket 或 prefix 生成不同 ID', () => {
      expect(buildListCacheId('other', 'a/b/')).not.toBe(buildListCacheId('picture', 'a/b/'));
      expect(buildListCacheId('picture', 'a/c/')).not.toBe(buildListCacheId('picture', 'a/b/'));
    });

    test('前缀归一化后根目录与带斜杠形式一致', () => {
      expect(normalizePrefixValue('')).toBe('');
      expect(normalizePrefixValue('/')).toBe('');
      expect(normalizePrefixValue('a/b/')).toBe('a/b');
    });
  });

  describe('get / put', () => {
    test('未写入前读取返回 null', async () => {
      expect(await cache.get('picture', '')).toBeNull();
    });

    test('写入后可读取到相同列表', async () => {
      const objects = buildObjects(3);
      await cache.put('picture', 'photos/', objects);

      const hit = await cache.get('picture', 'photos/');
      expect(hit).not.toBeNull();
      expect(hit.objects).toHaveLength(3);
      expect(hit.objects[0].key).toBe('file-0.png');
      expect(typeof hit.cachedAt).toBe('number');
    });

    test('不同桶的同名目录互不干扰', async () => {
      await cache.put('picture', 'photos/', buildObjects(1));

      expect(await cache.get('picture', 'photos/')).not.toBeNull();
      expect(await cache.get('other', 'photos/')).toBeNull();
    });

    test('停用后不读不写', async () => {
      await cache.put('picture', '', buildObjects(1));
      cache.configure({ enabled: false });

      expect(await cache.get('picture', '')).toBeNull();
      expect(await cache.put('picture', 'x/', buildObjects(1))).toBe(false);
    });
  });

  describe('invalidate', () => {
    test('按目录精确失效', async () => {
      await cache.put('picture', 'a/', buildObjects(1));
      await cache.put('picture', 'b/', buildObjects(1));

      const removed = await cache.invalidate('picture', 'a/');

      expect(removed).toBe(1);
      expect(await cache.get('picture', 'a/')).toBeNull();
      expect(await cache.get('picture', 'b/')).not.toBeNull();
    });

    test('不传前缀时失效整个桶', async () => {
      await cache.put('picture', 'a/', buildObjects(1));
      await cache.put('picture', 'b/', buildObjects(1));
      await cache.put('other', 'a/', buildObjects(1));

      const removed = await cache.invalidate('picture');

      expect(removed).toBe(2);
      expect(await cache.get('picture', 'a/')).toBeNull();
      expect(await cache.get('picture', 'b/')).toBeNull();
      expect(await cache.get('other', 'a/')).not.toBeNull();
    });

    test('前缀末尾斜杠差异不影响失效匹配', async () => {
      await cache.put('picture', 'a/', buildObjects(1));
      await cache.invalidate('picture', 'a');

      expect(await cache.get('picture', 'a/')).toBeNull();
    });
  });

  describe('远端清理', () => {
    test('purgeBuckets 清掉远端已删除的桶', async () => {
      await cache.put('picture', 'photos/', buildObjects(1));
      await cache.put('picture', 'docs/', buildObjects(1));
      await cache.put('backup', 'photos/', buildObjects(1));

      const removed = await cache.purgeBuckets(['picture']);

      expect(removed).toBe(1);
      expect(await cache.get('backup', 'photos/')).toBeNull();
      expect(await cache.get('picture', 'photos/')).not.toBeNull();
      expect(await cache.get('picture', 'docs/')).not.toBeNull();
    });

    test('空桶列表不误删任何缓存', async () => {
      await cache.put('picture', 'photos/', buildObjects(1));

      const removed = await cache.purgeBuckets([]);

      expect(removed).toBe(0);
      expect(await cache.get('picture', 'photos/')).not.toBeNull();
    });

    test('pruneMissingFolders 删掉远端已消失的子目录（含更深层）', async () => {
      await cache.put('picture', '', buildObjects(1));
      await cache.put('picture', 'old/', buildObjects(1));
      await cache.put('picture', 'old/nested/', buildObjects(1));
      await cache.put('picture', 'keep/', buildObjects(1));
      await cache.put('picture', 'keep/nested/', buildObjects(1));

      // 根目录刷新回来只剩 keep/
      const removed = await cache.pruneMissingFolders('picture', '', ['keep/']);

      expect(removed).toBe(2);
      expect(await cache.get('picture', 'old/')).toBeNull();
      expect(await cache.get('picture', 'old/nested/')).toBeNull();
      expect(await cache.get('picture', 'keep/')).not.toBeNull();
      expect(await cache.get('picture', 'keep/nested/')).not.toBeNull();
      // 当前目录自身的缓存不会被清
      expect(await cache.get('picture', '')).not.toBeNull();
    });

    test('pruneMissingFolders 在子目录内也能按层级判断', async () => {
      await cache.put('picture', 'shots/', buildObjects(1));
      await cache.put('picture', 'shots/gone/', buildObjects(1));
      await cache.put('picture', 'shots/gone/deep/', buildObjects(1));
      await cache.put('picture', 'shots/keep/', buildObjects(1));

      const removed = await cache.pruneMissingFolders('picture', 'shots/', ['shots/keep/']);

      expect(removed).toBe(2);
      expect(await cache.get('picture', 'shots/keep/')).not.toBeNull();
      expect(await cache.get('picture', 'shots/gone/')).toBeNull();
      expect(await cache.get('picture', 'shots/gone/deep/')).toBeNull();
    });

    test('pruneMissingFolders 不影响其它桶', async () => {
      await cache.put('picture', 'old/', buildObjects(1));
      await cache.put('backup', 'old/', buildObjects(1));

      await cache.pruneMissingFolders('picture', '', []);

      expect(await cache.get('picture', 'old/')).toBeNull();
      expect(await cache.get('backup', 'old/')).not.toBeNull();
    });
  });

  describe('LRU eviction', () => {
    test('超过条目上限时淘汰最久未使用的目录', async () => {
      for (let i = 0; i < 40; i += 1) {
        await cache.put('picture', `dir-${i}/`, buildObjects(1));
      }

      const stats = await cache.getStats();
      expect(stats.count).toBeLessThanOrEqual(20);
      expect(await cache.get('picture', 'dir-0/')).toBeNull();
      expect(await cache.get('picture', 'dir-39/')).not.toBeNull();
    });

    test('读取会刷新访问时间，避免被淘汰', async () => {
      await cache.put('picture', 'hot/', buildObjects(1));

      for (let i = 0; i < 40; i += 1) {
        await cache.get('picture', 'hot/');
        await cache.put('picture', `dir-${i}/`, buildObjects(1));
      }

      expect(await cache.get('picture', 'hot/')).not.toBeNull();
    });
  });

  describe('persistence / clear', () => {
    test('重新加载索引后仍能命中', async () => {
      await cache.put('picture', 'photos/', buildObjects(2));
      await cache.flush();

      const reloaded = new ObjectListCacheService(rootDir);
      await reloaded.init();

      const hit = await reloaded.get('picture', 'photos/');
      expect(hit).not.toBeNull();
      expect(hit.objects).toHaveLength(2);
    });

    test('缓存文件损坏时自动丢弃条目', async () => {
      await cache.put('picture', 'photos/', buildObjects(2));
      await cache.flush();

      const entry = Array.from(cache.entries.values())[0];
      fs.writeFileSync(path.join(cache.rootDir, entry.file), 'not-json');

      expect(await cache.get('picture', 'photos/')).toBeNull();
    });

    test('清空缓存后条目与空间归零', async () => {
      await cache.put('picture', 'a/', buildObjects(2));
      await cache.put('picture', 'b/', buildObjects(3));

      const result = await cache.clear();
      expect(result.removed).toBe(2);
      expect(result.freedBytes).toBeGreaterThan(0);

      const stats = await cache.getStats();
      expect(stats.count).toBe(0);
      expect(stats.usedBytes).toBe(0);
    });
  });

  describe('加密存储', () => {
    test('落盘内容不含明文文件名', async () => {
      const crypto = new LocalCryptoService();
      crypto.setKey(generateKey());
      const secureCache = new ObjectListCacheService(rootDir, { crypto });
      await secureCache.init();

      await secureCache.put('picture', 'photos/', [{ key: 'TOP-SECRET.png', size: 1 }]);

      const files = fs.readdirSync(secureCache.rootDir).filter(f => f !== 'index.json');
      expect(files).toHaveLength(1);

      const rawOnDisk = fs.readFileSync(path.join(secureCache.rootDir, files[0]));
      expect(rawOnDisk.includes(Buffer.from('TOP-SECRET.png'))).toBe(false);
      expect(crypto.isEncrypted(rawOnDisk)).toBe(true);

      const hit = await secureCache.get('picture', 'photos/');
      expect(hit.objects[0].key).toBe('TOP-SECRET.png');
    });

    test('未持有密钥时不读写', async () => {
      const crypto = new LocalCryptoService();
      const secureCache = new ObjectListCacheService(rootDir, { crypto });
      await secureCache.init();

      expect(await secureCache.put('picture', 'a/', [])).toBe(false);
      expect(await secureCache.get('picture', 'a/')).toBeNull();
    });
  });
});
