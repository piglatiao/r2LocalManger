/**
 * ThumbnailCacheService - Application Layer
 *
 * 列表 / 网格视图里的缩略图（图片、视频首帧）落盘缓存。
 * - 缓存键 = 桶 + key + size + lastModified + etag，切换桶来回切也不会重复下载
 * - 磁盘占用超过上限时按 LRU（最近最少使用）自动淘汰
 * - 索引文件 index.json 记录元数据，写盘做防抖，避免高频 IO
 */

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const CACHE_DIR_NAME = 'thumbnail-cache';
const INDEX_FILE_NAME = 'index.json';
const INDEX_FLUSH_DELAY_MS = 1500;

const DEFAULT_MAX_SIZE_BYTES = 512 * 1024 * 1024;
const MIN_MAX_SIZE_BYTES = 16 * 1024 * 1024;
const MAX_MAX_SIZE_BYTES = 8 * 1024 * 1024 * 1024;

/**
 * 生成缓存条目的唯一 ID。
 * @param {{bucket?: string, key?: string, size?: number|string, lastModified?: string|Date, etag?: string}} meta - 对象元信息
 * @returns {string} sha1 摘要
 */
function buildCacheId(meta) {
  const bucket = String(meta?.bucket || '');
  const key = String(meta?.key || '');
  const size = String(meta?.size || '');
  const lastModified = meta?.lastModified
    ? new Date(meta.lastModified).toISOString()
    : '';
  const etag = String(meta?.etag || '');

  return crypto
    .createHash('sha1')
    .update(`${bucket}\u0000${key}\u0000${size}\u0000${lastModified}\u0000${etag}`)
    .digest('hex');
}

/**
 * 按 content-type 推导缓存文件扩展名。
 * @param {string} contentType - MIME 类型
 * @returns {string} 扩展名（含点）
 */
function extensionForContentType(contentType) {
  const normalized = String(contentType || '').toLowerCase();

  if (normalized.includes('png')) return '.png';
  if (normalized.includes('webp')) return '.webp';
  if (normalized.includes('gif')) return '.gif';
  if (normalized.includes('svg')) return '.svg';
  if (normalized.includes('bmp')) return '.bmp';
  if (normalized.includes('ico')) return '.ico';

  return '.jpg';
}

class ThumbnailCacheService {
  /**
   * @param {string} rootDir - 缓存根目录的父目录（通常传 app.getPath('userData')）
   */
  constructor(rootDir) {
    this.rootDir = path.join(String(rootDir || '.'), CACHE_DIR_NAME);
    this.indexFilePath = path.join(this.rootDir, INDEX_FILE_NAME);

    this.enabled = true;
    this.maxSizeBytes = DEFAULT_MAX_SIZE_BYTES;

    /** @type {Map<string, Object>} */
    this.entries = new Map();
    this.readyPromise = null;
    this.flushTimer = null;
    this.dirty = false;
  }

  /**
   * 初始化缓存目录与索引（幂等，可重复调用）。
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
   * 初始化内部实现。
   * @private
   * @returns {Promise<void>}
   */
  async _initInternal() {
    await fs.mkdir(this.rootDir, { recursive: true });
    await this._loadIndex();
    // 注意：初始化内部必须走无锁版本，否则会与 _ensureReady 互相等待形成死锁
    await this._evictInternal();
  }

  /**
   * 等待缓存就绪。
   * @private
   * @returns {Promise<void>}
   */
  async _ensureReady() {
    await this.init();
  }

  /**
   * 更新缓存配置。
   * @param {{enabled?: boolean, maxSizeBytes?: number}} options - 配置项
   * @returns {void}
   */
  configure(options = {}) {
    if (typeof options.enabled === 'boolean') {
      this.enabled = options.enabled;
    }

    if (options.maxSizeBytes !== undefined) {
      const raw = Number(options.maxSizeBytes);
      if (Number.isFinite(raw)) {
        this.maxSizeBytes = Math.min(
          MAX_MAX_SIZE_BYTES,
          Math.max(MIN_MAX_SIZE_BYTES, Math.floor(raw))
        );
      }
    }
  }

  /**
   * 读取当前缓存配置。
   * @returns {{enabled: boolean, maxSizeBytes: number}} 配置
   */
  getSettings() {
    return {
      enabled: this.enabled,
      maxSizeBytes: this.maxSizeBytes
    };
  }

  /**
   * 读取缓存统计信息。
   * @returns {Promise<{enabled: boolean, maxSizeBytes: number, usedBytes: number, count: number, directory: string}>} 统计信息
   */
  async getStats() {
    await this._ensureReady();

    let usedBytes = 0;
    this.entries.forEach((entry) => {
      usedBytes += Number(entry.bytes || 0);
    });

    return {
      enabled: this.enabled,
      maxSizeBytes: this.maxSizeBytes,
      usedBytes,
      count: this.entries.size,
      directory: this.rootDir
    };
  }

  /**
   * 读取缓存条目。
   * @param {Object} meta - 对象元信息（bucket/key/size/lastModified/etag）
   * @returns {Promise<{buffer: Buffer, contentType: string, cached: boolean}|null>} 缓存内容，未命中返回 null
   */
  async get(meta) {
    if (!this.enabled) {
      return null;
    }

    await this._ensureReady();

    const id = buildCacheId(meta);
    const entry = this.entries.get(id);
    if (!entry) {
      return null;
    }

    try {
      const buffer = await fs.readFile(path.join(this.rootDir, entry.file));
      entry.accessedAt = Date.now();
      this._scheduleFlush();

      return {
        buffer,
        contentType: entry.contentType || 'image/jpeg',
        cached: true
      };
    } catch (error) {
      // 文件缺失/损坏：直接丢弃索引项
      await this._removeEntry(id);
      return null;
    }
  }

  /**
   * 写入缓存条目，并在超限时执行 LRU 淘汰。
   * @param {Object} meta - 对象元信息（bucket/key/size/lastModified/etag）
   * @param {Buffer} buffer - 缩略图二进制内容
   * @param {string} contentType - MIME 类型
   * @returns {Promise<boolean>} 是否写入成功
   */
  async put(meta, buffer, contentType = 'image/jpeg') {
    if (!this.enabled || !buffer || !buffer.length) {
      return false;
    }

    await this._ensureReady();

    const id = buildCacheId(meta);
    const now = Date.now();
    const file = `${id}${extensionForContentType(contentType)}`;
    const targetPath = path.join(this.rootDir, file);

    try {
      await fs.writeFile(targetPath, buffer);
    } catch (error) {
      return false;
    }

    this.entries.set(id, {
      id,
      file,
      bucket: String(meta?.bucket || ''),
      key: String(meta?.key || ''),
      bytes: buffer.length,
      contentType: String(contentType || 'image/jpeg'),
      createdAt: now,
      accessedAt: now
    });

    this._scheduleFlush();
    await this.evictToLimit();
    return true;
  }

  /**
   * 清空全部缓存。
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

    // 兜底清理残留文件（索引缺失但文件还在的情况）
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
   * 按 LRU 淘汰直到占用回到上限以内。
   * @returns {Promise<number>} 被淘汰的条目数
   */
  async evictToLimit() {
    await this._ensureReady();
    return this._evictInternal();
  }

  /**
   * 淘汰逻辑实现（不等待就绪，仅供内部/初始化使用）。
   * @private
   * @returns {Promise<number>} 被淘汰的条目数
   */
  async _evictInternal() {
    const totalBytes = () => {
      let sum = 0;
      this.entries.forEach((entry) => {
        sum += Number(entry.bytes || 0);
      });
      return sum;
    };

    let evicted = 0;
    let used = totalBytes();

    if (used <= this.maxSizeBytes) {
      return 0;
    }

    const candidates = Array.from(this.entries.values()).sort((a, b) => {
      const aTime = Number(a.accessedAt || a.createdAt || 0);
      const bTime = Number(b.accessedAt || b.createdAt || 0);
      return aTime - bTime;
    });

    for (const entry of candidates) {
      if (used <= this.maxSizeBytes) break;
      used -= Number(entry.bytes || 0);
      await this._removeEntry(entry.id);
      evicted += 1;
    }

    if (evicted > 0) {
      this._scheduleFlush();
    }

    return evicted;
  }

  /**
   * 立即把索引写入磁盘（退出前调用）。
   * @returns {Promise<void>}
   */
  async flush() {
    if (!this.readyPromise) return;
    await this._flushIndex();
  }

  /**
   * 加载索引文件，并剔除指向缺失文件的条目。
   * @private
   * @returns {Promise<void>}
   */
  async _loadIndex() {
    this.entries.clear();

    let raw = '';
    try {
      raw = await fs.readFile(this.indexFilePath, 'utf8');
    } catch {
      // 首次启动没有索引文件，扫描目录建立索引
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

    const list = Array.isArray(parsed?.entries) ? parsed.entries : [];
    const now = Date.now();

    for (const item of list) {
      if (!item || typeof item.id !== 'string' || typeof item.file !== 'string') continue;

      const filePath = path.join(this.rootDir, item.file);
      try {
        const stat = await fs.stat(filePath);
        this.entries.set(item.id, {
          id: item.id,
          file: item.file,
          bucket: String(item.bucket || ''),
          key: String(item.key || ''),
          bytes: Number(stat.size || item.bytes || 0),
          contentType: String(item.contentType || 'image/jpeg'),
          createdAt: Number(item.createdAt || now),
          accessedAt: Number(item.accessedAt || item.createdAt || now)
        });
      } catch {
        // 文件已不存在，跳过
      }
    }

    this._scheduleFlush();
  }

  /**
   * 索引缺失或损坏时，扫描缓存目录重建索引。
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

    const now = Date.now();

    for (const file of files) {
      if (file === INDEX_FILE_NAME) continue;
      const filePath = path.join(this.rootDir, file);
      try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) continue;

        const id = path.basename(file, path.extname(file));
        const ext = path.extname(file).toLowerCase();
        const contentType = ext === '.png'
          ? 'image/png'
          : ext === '.webp'
            ? 'image/webp'
            : ext === '.gif'
              ? 'image/gif'
              : ext === '.svg'
                ? 'image/svg+xml'
                : 'image/jpeg';

        this.entries.set(id, {
          id,
          file,
          bucket: '',
          key: '',
          bytes: stat.size,
          contentType,
          createdAt: stat.mtimeMs || now,
          accessedAt: stat.mtimeMs || now
        });
      } catch {
        // 忽略无法读取的文件
      }
    }

    this._scheduleFlush();
  }

  /**
   * 删除单个缓存条目。
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
   * 删除条目对应的文件。
   * @private
   * @param {Object|undefined} entry - 缓存条目
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
   * 标记索引为脏并安排延迟写盘。
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
   * 把索引写入磁盘。
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

module.exports = {
  ThumbnailCacheService,
  buildCacheId,
  DEFAULT_MAX_SIZE_BYTES,
  MIN_MAX_SIZE_BYTES,
  MAX_MAX_SIZE_BYTES
};
