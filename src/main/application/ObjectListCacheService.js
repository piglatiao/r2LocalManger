/**
 * ObjectListCacheService - Application Layer
 *
 * 对象列表（bucket + prefix 维度）落盘缓存。
 * 目标：切换存储桶 / 切换目录时直接用本地缓存秒出，只有显式刷新或写操作才重新访问 R2。
 *
 * - 缓存键 = bucket + prefix
 * - 无自动过期：只有「刷新」「上传/删除等写操作」会失效对应条目
 * - 条目数 / 总字节双重上限，超出按 LRU 淘汰
 */

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const CACHE_DIR_NAME = 'object-list-cache';
const INDEX_FILE_NAME = 'index.json';
const INDEX_FLUSH_DELAY_MS = 1200;

const DEFAULT_MAX_ENTRIES = 300;
const MIN_MAX_ENTRIES = 20;
const MAX_MAX_ENTRIES = 5000;
const DEFAULT_MAX_SIZE_BYTES = 64 * 1024 * 1024;

/**
 * 生成缓存条目 ID。
 * @param {string} bucket - 桶名
 * @param {string} prefix - 目录前缀
 * @returns {string} sha1 摘要
 */
function buildListCacheId(bucket, prefix) {
  return crypto
    .createHash('sha1')
    .update(`${String(bucket || '')}\u0000${String(prefix || '')}`)
    .digest('hex');
}

class ObjectListCacheService {
  /**
   * @param {string} rootDir - 缓存根目录的父目录（通常传 app.getPath('userData')）
   */
  constructor(rootDir) {
    this.rootDir = path.join(String(rootDir || '.'), CACHE_DIR_NAME);
    this.indexFilePath = path.join(this.rootDir, INDEX_FILE_NAME);

    this.enabled = true;
    this.maxEntries = DEFAULT_MAX_ENTRIES;
    this.maxSizeBytes = DEFAULT_MAX_SIZE_BYTES;

    /** @type {Map<string, Object>} */
    this.entries = new Map();
    this.readyPromise = null;
    this.flushTimer = null;
    this.dirty = false;
  }

  /**
   * 初始化缓存目录与索引（幂等）。
   * @returns {Promise<void>}
   */
  init() {
    if (!this.readyPromise) {
      this.readyPromise = this._initInternal().catch((error) => {
        this.readyPromise = null;
        throw error;
      });
    }
    return this.readyPromise;
  }

  /**
   * @private
   * @returns {Promise<void>}
   */
  async _initInternal() {
    await fs.mkdir(this.rootDir, { recursive: true });
    await this._loadIndex();
    await this._evictInternal();
  }

  /**
   * @private
   * @returns {Promise<void>}
   */
  async _ensureReady() {
    await this.init();
  }

  /**
   * 更新配置。
   * @param {{enabled?: boolean, maxEntries?: number, maxSizeBytes?: number}} options - 配置项
   */
  configure(options = {}) {
    if (typeof options.enabled === 'boolean') {
      this.enabled = options.enabled;
    }

    if (options.maxEntries !== undefined) {
      const raw = Number(options.maxEntries);
      if (Number.isFinite(raw)) {
        this.maxEntries = Math.min(MAX_MAX_ENTRIES, Math.max(MIN_MAX_ENTRIES, Math.floor(raw)));
      }
    }

    if (options.maxSizeBytes !== undefined) {
      const raw = Number(options.maxSizeBytes);
      if (Number.isFinite(raw) && raw > 0) {
        this.maxSizeBytes = Math.floor(raw);
      }
    }
  }

  /**
   * 读取配置。
   * @returns {{enabled: boolean, maxEntries: number, maxSizeBytes: number}} 配置
   */
  getSettings() {
    return {
      enabled: this.enabled,
      maxEntries: this.maxEntries,
      maxSizeBytes: this.maxSizeBytes
    };
  }

  /**
   * 读取统计信息。
   * @returns {Promise<{enabled: boolean, count: number, usedBytes: number, directory: string}>} 统计
   */
  async getStats() {
    await this._ensureReady();

    let usedBytes = 0;
    this.entries.forEach((entry) => {
      usedBytes += Number(entry.bytes || 0);
    });

    return {
      enabled: this.enabled,
      count: this.entries.size,
      usedBytes,
      directory: this.rootDir
    };
  }

  /**
   * 读取缓存的列表。
   * @param {string} bucket - 桶名
   * @param {string} prefix - 目录前缀
   * @returns {Promise<{objects: Array<Object>, cachedAt: number}|null>} 缓存内容，未命中返回 null
   */
  async get(bucket, prefix) {
    if (!this.enabled) {
      return null;
    }

    await this._ensureReady();

    const id = buildListCacheId(bucket, prefix);
    const entry = this.entries.get(id);
    if (!entry) {
      return null;
    }

    try {
      const raw = await fs.readFile(path.join(this.rootDir, entry.file), 'utf8');
      const parsed = JSON.parse(raw);
      const objects = Array.isArray(parsed?.objects) ? parsed.objects : null;
      if (!objects) {
        await this._removeEntry(id);
        return null;
      }

      entry.accessedAt = Date.now();
      this._scheduleFlush();

      return {
        objects,
        cachedAt: Number(parsed.cachedAt || entry.cachedAt || Date.now())
      };
    } catch (error) {
      await this._removeEntry(id);
      return null;
    }
  }

  /**
   * 写入缓存。
   * @param {string} bucket - 桶名
   * @param {string} prefix - 目录前缀
   * @param {Array<Object>} objects - 对象列表
   * @returns {Promise<boolean>} 是否写入成功
   */
  async put(bucket, prefix, objects) {
    if (!this.enabled || !Array.isArray(objects)) {
      return false;
    }

    await this._ensureReady();

    const id = buildListCacheId(bucket, prefix);
    const now = Date.now();
    const file = `${id}.json`;
    const targetPath = path.join(this.rootDir, file);
    const payload = JSON.stringify({
      bucket: String(bucket || ''),
      prefix: String(prefix || ''),
      cachedAt: now,
      objects
    });

    let bytes = 0;
    try {
      await fs.writeFile(targetPath, payload, 'utf8');
      bytes = Buffer.byteLength(payload, 'utf8');
    } catch (error) {
      return false;
    }

    this.entries.set(id, {
      id,
      file,
      bucket: String(bucket || ''),
      prefix: String(prefix || ''),
      bytes,
      count: objects.length,
      cachedAt: now,
      accessedAt: now
    });

    this._scheduleFlush();
    await this._evictInternal();
    return true;
  }

  /**
   * 失效指定目录（前缀为空表示失效整个桶）。
   * @param {string} bucket - 桶名
   * @param {string} [prefix] - 目录前缀；不传则失效该桶全部目录
   * @returns {Promise<number>} 失效条目数
   */
  async invalidate(bucket, prefix) {
    await this._ensureReady();

    const normalizedBucket = String(bucket || '');
    const hasPrefix = prefix !== undefined && prefix !== null;
    const normalizedPrefix = normalizePrefixValue(prefix);
    let removed = 0;

    for (const entry of Array.from(this.entries.values())) {
      if (entry.bucket !== normalizedBucket) {
        continue;
      }

      if (hasPrefix && normalizePrefixValue(entry.prefix) !== normalizedPrefix) {
        continue;
      }

      await this._removeEntry(entry.id);
      removed += 1;
    }

    if (removed > 0) {
      this._scheduleFlush();
    }

    return removed;
  }

  /**
   * 清空全部列表缓存。
   * @returns {Promise<{removed: number, freedBytes: number}>} 清理结果
   */
  async clear() {
    await this._ensureReady();

    let freedBytes = 0;
    const ids = Array.from(this.entries.keys());

    for (const id of ids) {
      const entry = this.entries.get(id);
      freedBytes += Number(entry?.bytes || 0);
      await this._unlinkEntryFile(entry);
    }

    this.entries.clear();

    try {
      const files = await fs.readdir(this.rootDir);
      for (const file of files) {
        if (file === INDEX_FILE_NAME) continue;
        await fs.unlink(path.join(this.rootDir, file)).catch(() => {});
      }
    } catch {
      // 目录不可读时忽略
    }

    await this._flushIndex();
    return { removed: ids.length, freedBytes };
  }

  /**
   * 按 LRU 淘汰到上限以内。
   * @returns {Promise<number>} 淘汰条目数
   */
  async evictToLimit() {
    await this._ensureReady();
    return this._evictInternal();
  }

  /**
   * @private
   * @returns {Promise<number>}
   */
  async _evictInternal() {
    let usedBytes = 0;
    this.entries.forEach((entry) => {
      usedBytes += Number(entry.bytes || 0);
    });

    let evicted = 0;
    const overLimit = () => this.entries.size > this.maxEntries || usedBytes > this.maxSizeBytes;
    if (!overLimit()) {
      return 0;
    }

    const candidates = Array.from(this.entries.values()).sort((a, b) => {
      const aTime = Number(a.accessedAt || a.cachedAt || 0);
      const bTime = Number(b.accessedAt || b.cachedAt || 0);
      return aTime - bTime;
    });

    for (const entry of candidates) {
      if (!overLimit()) break;
      usedBytes -= Number(entry.bytes || 0);
      await this._removeEntry(entry.id);
      evicted += 1;
    }

    if (evicted > 0) {
      this._scheduleFlush();
    }

    return evicted;
  }

  /**
   * 立即落盘索引。
   * @returns {Promise<void>}
   */
  async flush() {
    if (!this.readyPromise) return;
    await this._flushIndex();
  }

  /**
   * @private
   * @returns {Promise<void>}
   */
  async _loadIndex() {
    this.entries.clear();

    let raw = '';
    try {
      raw = await fs.readFile(this.indexFilePath, 'utf8');
    } catch {
      await this._rebuildIndexFromDisk();
      return;
    }

    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      await this._rebuildIndexFromDisk();
      return;
    }

    for (const item of Array.isArray(parsed?.entries) ? parsed.entries : []) {
      if (!item || typeof item.id !== 'string' || typeof item.file !== 'string') continue;

      try {
        const stat = await fs.stat(path.join(this.rootDir, item.file));
        this.entries.set(item.id, {
          id: item.id,
          file: item.file,
          bucket: String(item.bucket || ''),
          prefix: String(item.prefix || ''),
          bytes: Number(stat.size || item.bytes || 0),
          count: Number(item.count || 0),
          cachedAt: Number(item.cachedAt || Date.now()),
          accessedAt: Number(item.accessedAt || item.cachedAt || Date.now())
        });
      } catch {
        // 文件缺失则跳过
      }
    }

    this._scheduleFlush();
  }

  /**
   * @private
   * @returns {Promise<void>}
   */
  async _rebuildIndexFromDisk() {
    let files = [];
    try {
      files = await fs.readdir(this.rootDir);
    } catch {
      return;
    }

    for (const file of files) {
      if (file === INDEX_FILE_NAME || !file.endsWith('.json')) continue;

      try {
        const stat = await fs.stat(path.join(this.rootDir, file));
        if (!stat.isFile()) continue;

        const id = path.basename(file, '.json');
        this.entries.set(id, {
          id,
          file,
          bucket: '',
          prefix: '',
          bytes: stat.size,
          count: 0,
          cachedAt: stat.mtimeMs || Date.now(),
          accessedAt: stat.mtimeMs || Date.now()
        });
      } catch {
        // 忽略
      }
    }

    this._scheduleFlush();
  }

  /**
   * @private
   * @param {string} id - 条目 ID
   * @returns {Promise<void>}
   */
  async _removeEntry(id) {
    const entry = this.entries.get(id);
    this.entries.delete(id);
    await this._unlinkEntryFile(entry);
  }

  /**
   * @private
   * @param {Object|undefined} entry - 条目
   * @returns {Promise<void>}
   */
  async _unlinkEntryFile(entry) {
    if (!entry || !entry.file) return;
    try {
      await fs.unlink(path.join(this.rootDir, entry.file));
    } catch {
      // 文件可能已不存在
    }
  }

  /**
   * @private
   */
  _scheduleFlush() {
    this.dirty = true;
    if (this.flushTimer) return;

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this._flushIndex().catch(() => {});
    }, INDEX_FLUSH_DELAY_MS);

    if (typeof this.flushTimer.unref === 'function') {
      this.flushTimer.unref();
    }
  }

  /**
   * @private
   * @returns {Promise<void>}
   */
  async _flushIndex() {
    if (!this.dirty) return;

    const payload = {
      version: 1,
      updatedAt: Date.now(),
      entries: Array.from(this.entries.values())
    };

    try {
      await fs.mkdir(this.rootDir, { recursive: true });
      await fs.writeFile(this.indexFilePath, JSON.stringify(payload), 'utf8');
      this.dirty = false;
    } catch {
      // 写索引失败不影响主流程
    }
  }
}

/**
 * 统一前缀格式，避免根目录 '' 与 '/' 造成缓存键不一致。
 * @param {string} prefix - 原始前缀
 * @returns {string} 归一化前缀
 */
function normalizePrefixValue(prefix) {
  return String(prefix || '').replace(/\/+$/, '');
}

module.exports = {
  ObjectListCacheService,
  buildListCacheId,
  normalizePrefixValue,
  DEFAULT_MAX_ENTRIES,
  DEFAULT_MAX_SIZE_BYTES
};
