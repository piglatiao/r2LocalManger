/**
 * R2Client - Infrastructure Layer
 * 
 * Wraps the AWS S3 SDK to interact with Cloudflare R2.
 * Provides methods for listing, uploading, downloading, deleting objects,
 * and retrieving object metadata and URLs.
 */

const {
  S3Client,
  ListObjectsV2Command,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand
} = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');

/**
 * Error types for classification
 */
const ErrorType = {
  NETWORK: 'NETWORK',
  AUTH: 'AUTH',
  BUCKET: 'BUCKET',
  OBJECT: 'OBJECT',
  PERMISSION: 'PERMISSION',
  FILE_SYSTEM: 'FILE_SYSTEM',
  UNKNOWN: 'UNKNOWN'
};

/**
 * 需要优先在浏览器中内联预览的 MIME 类型前缀。
 * 这些类型复制公开链接后更适合直接预览，而不是触发下载。
 */
const INLINE_CONTENT_TYPE_PREFIXES = ['image/', 'video/', 'text/'];

/**
 * 需要优先在浏览器中内联预览的精确 MIME 类型。
 */
const INLINE_CONTENT_TYPES = new Set([
  'application/pdf',
  'application/json',
  'application/xml',
  'application/javascript',
  'application/typescript',
  'application/x-yaml'
]);

/**
 * 按扩展名映射 MIME 类型，保证普通上传和拖拽上传写入一致的对象元数据。
 */
const MIME_TYPE_BY_EXTENSION = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  mp4: 'video/mp4',
  avi: 'video/x-msvideo',
  mov: 'video/quicktime',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/aac',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  css: 'text/css',
  js: 'application/javascript',
  ts: 'application/typescript',
  yaml: 'application/x-yaml',
  yml: 'application/x-yaml',
  zip: 'application/zip',
  rar: 'application/x-rar-compressed',
  '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar',
  gz: 'application/gzip'
};

/**
 * R2Client class for interacting with Cloudflare R2 storage
 */
class R2Client {
  /**
   * Initialize R2Client with configuration
   * @param {Object} config - R2 configuration
   * @param {string} config.endpoint - R2 endpoint URL
   * @param {string} config.region - AWS region (use 'auto' for R2)
   * @param {string} config.bucket - Bucket name
   * @param {string} config.accessKeyId - R2 Access Key ID
   * @param {string} config.secretAccessKey - R2 Secret Access Key
   */
  constructor(config) {
    this.config = config;
    this.bucket = config.bucket;
    
    // Initialize S3Client with R2 configuration
    this.s3Client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    });
  }

  /**
   * 按当前目录层级列出对象和虚拟文件夹。
   * @param {string} prefix - 当前目录前缀，根目录为空字符串
   * @returns {Promise<Array<ObjectInfo>>} 当前目录下的文件和文件夹
   */
  async listObjects(prefix = '') {
    try {
      const normalizedPrefix = String(prefix || '');
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: normalizedPrefix,
        Delimiter: '/'
      });

      const response = await this.s3Client.send(command);

      const folders = new Map();
      (response.CommonPrefixes || []).forEach(item => {
        const folderKey = String(item.Prefix || '');
        if (!folderKey || folderKey === normalizedPrefix) {
          return;
        }

        folders.set(folderKey, {
          key: folderKey,
          name: folderKey.slice(normalizedPrefix.length).replace(/\/$/, ''),
          isFolder: true,
          size: 0,
          lastModified: null,
          contentType: 'application/x-directory'
        });
      });

      const contents = response.Contents || [];
      contents.forEach(item => {
        const key = String(item.Key || '');
        if (key && key !== normalizedPrefix && key.endsWith('/')) {
          folders.set(key, {
            key,
            name: key.slice(normalizedPrefix.length).replace(/\/$/, ''),
            isFolder: true,
            size: 0,
            lastModified: item.LastModified || null,
            contentType: 'application/x-directory'
          });
        }
      });

      // 保留文件对象原有字段，避免影响现有文件操作逻辑。
      const objects = contents
        .filter(item => item.Key && item.Key !== normalizedPrefix && !String(item.Key).endsWith('/'))
        .map(item => ({
        key: item.Key,
        size: item.Size,
        lastModified: item.LastModified,
        contentType: item.ContentType
        }));

      return [...folders.values(), ...objects];
    } catch (error) {
      throw this._classifyError(error, 'listObjects');
    }
  }

  /**
   * Upload a file to R2
   * @param {string} key - Object key (filename in bucket)
   * @param {string} filePath - Local file path to upload
   * @param {Function} onProgress - Optional progress callback (loaded, total) => void
   * @returns {Promise<void>}
   */
  async uploadObject(key, filePath, onProgress) {
    try {
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        const error = new Error(`File not found: ${filePath}`);
        error.code = 'ENOENT';
        throw error;
      }

      // Get file stats
      const stats = fs.statSync(filePath);
      const fileSize = stats.size;

      // Read file content
      const fileStream = fs.createReadStream(filePath);
      const chunks = [];
      let uploadedBytes = 0;

      // Collect chunks and track progress
      for await (const chunk of fileStream) {
        chunks.push(chunk);
        uploadedBytes += chunk.length;
        
        if (onProgress) {
          onProgress(uploadedBytes, fileSize);
        }
      }

      const fileBuffer = Buffer.concat(chunks);
      const objectHeaders = this._buildObjectHttpMetadata(key);

      // Upload to R2
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: fileBuffer,
        ...objectHeaders
      });

      await this.s3Client.send(command);
    } catch (error) {
      throw this._classifyError(error, 'uploadObject');
    }
  }

  /**
   * Upload a buffer to R2 (for drag and drop support)
   * @param {string} key - Object key (filename in bucket)
   * @param {Buffer} buffer - Buffer content to upload
   * @param {string} contentType - Optional content type
   * @param {Function} onProgress - Optional progress callback (loaded, total) => void
   * @returns {Promise<void>}
   */
  async uploadObjectFromBuffer(key, buffer, contentType, onProgress) {
    try {
      const fileSize = buffer.length;

      // Report initial progress
      if (onProgress) {
        onProgress(0, fileSize);
      }

      const objectHeaders = this._buildObjectHttpMetadata(key, contentType);

      // Upload to R2
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ...objectHeaders
      });

      await this.s3Client.send(command);

      // Report final progress
      if (onProgress) {
        onProgress(fileSize, fileSize);
      }
    } catch (error) {
      throw this._classifyError(error, 'uploadObjectFromBuffer');
    }
  }

  /**
   * Download an object from R2
   * @param {string} key - Object key to download
   * @param {string} savePath - Local path to save the file
   * @param {Function} onProgress - Optional progress callback (loaded, total) => void
   * @returns {Promise<void>}
   */
  async downloadObject(key, savePath, onProgress) {
    try {
      // Get object from R2
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key
      });

      const response = await this.s3Client.send(command);
      
      // Get content length for progress tracking
      const contentLength = response.ContentLength || 0;
      let downloadedBytes = 0;

      // Create write stream
      const writeStream = fs.createWriteStream(savePath);
      
      // Track progress while streaming
      const body = response.Body;
      
      for await (const chunk of body) {
        writeStream.write(chunk);
        downloadedBytes += chunk.length;
        
        if (onProgress) {
          onProgress(downloadedBytes, contentLength);
        }
      }

      writeStream.end();
      
      // Wait for write stream to finish
      await new Promise((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });
    } catch (error) {
      throw this._classifyError(error, 'downloadObject');
    }
  }

  /**
   * Delete an object from R2
   * @param {string} key - Object key to delete
   * @returns {Promise<void>}
   */
  async deleteObject(key) {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key
      });

      await this.s3Client.send(command);
    } catch (error) {
      throw this._classifyError(error, 'deleteObject');
    }
  }

  /**
   * Delete multiple objects from R2
   * @param {string[]} keys - Array of object keys to delete
   * @returns {Promise<{deleted: string[], errors: Array<{key: string, error: Error}>}>}
   */
  async deleteObjects(keys) {
    try {
      const command = new DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: {
          Objects: keys.map(key => ({ Key: key })),
          Quiet: false
        }
      });

      const response = await this.s3Client.send(command);
      
      const deleted = (response.Deleted || []).map(item => item.Key);
      const errors = (response.Errors || []).map(item => {
        const error = new Error(item.Message || 'Delete failed');
        error.key = item.Key;
        error.code = item.Code;
        return { key: item.Key, error };
      });

      return { deleted, errors };
    } catch (error) {
      throw this._classifyError(error, 'deleteObjects');
    }
  }

  /**
   * Get the public URL for an object
   * @param {string} key - Object key
   * @returns {Promise<string>} Object URL
   */
  async getObjectUrl(key) {
    try {
      // 始终优先使用当前桶同步回来的 publicUrl，避免切桶后沿用旧的全局环境变量。
      const publicUrl = String(this.config.publicUrl || this.config.endpoint || '').trim().replace(/\/+$/, '');
      // 直接拼接当前对象访问地址，确保每个桶返回自己的公开域名。
      const url = `${publicUrl}/${key}`;
      return url;
    } catch (error) {
      throw this._classifyError(error, 'getObjectUrl');
    }
  }

  /**
   * Get object metadata
   * @param {string} key - Object key
   * @returns {Promise<ObjectMetadata>} Object metadata
   */
  async getObjectMetadata(key) {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key
      });

      const response = await this.s3Client.send(command);
      
      return {
        contentType: response.ContentType,
        contentLength: response.ContentLength,
        lastModified: response.LastModified,
        etag: response.ETag,
        metadata: response.Metadata
      };
    } catch (error) {
      throw this._classifyError(error, 'getObjectMetadata');
    }
  }

  /**
   * Get object as a stream (for preview functionality)
   * @param {string} key - Object key
   * @returns {Promise<{stream: ReadableStream, metadata: ObjectMetadata}>}
   */
  async getObjectStream(key) {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key
      });

      const response = await this.s3Client.send(command);
      
      return {
        stream: response.Body,
        metadata: {
          contentType: response.ContentType,
          contentLength: response.ContentLength,
          lastModified: response.LastModified,
          etag: response.ETag
        }
      };
    } catch (error) {
      throw this._classifyError(error, 'getObjectStream');
    }
  }

  /**
   * 构建对象的 HTTP 元数据，统一控制浏览器访问公开链接时的展示行为。
   * @private
   * @param {string} key - 对象 key，用于推断扩展名
   * @param {string} [providedContentType] - 外部已知的 MIME 类型
   * @returns {{ContentType: string, ContentDisposition?: string}}
   */
  _buildObjectHttpMetadata(key, providedContentType) {
    const contentType = this._resolveContentType(key, providedContentType);
    const metadata = {
      ContentType: contentType
    };

    if (this._shouldUseInlineDisposition(contentType)) {
      metadata.ContentDisposition = 'inline';
    }

    return metadata;
  }

  /**
   * 根据显式传入值或文件扩展名推断对象 MIME 类型。
   * @private
   * @param {string} key - 对象 key
   * @param {string} [providedContentType] - 外部传入的 MIME 类型
   * @returns {string} 标准化后的 MIME 类型
   */
  _resolveContentType(key, providedContentType) {
    const normalizedContentType = String(providedContentType || '').trim();
    if (normalizedContentType) {
      return normalizedContentType;
    }

    const ext = path.extname(String(key || '')).slice(1).toLowerCase();
    return MIME_TYPE_BY_EXTENSION[ext] || 'application/octet-stream';
  }

  /**
   * 判断是否应写入 inline，便于浏览器直接预览公开链接。
   * @private
   * @param {string} contentType - 对象 MIME 类型
   * @returns {boolean} 是否使用 inline
   */
  _shouldUseInlineDisposition(contentType) {
    const normalizedContentType = String(contentType || '').trim().toLowerCase();
    if (!normalizedContentType) {
      return false;
    }

    if (INLINE_CONTENT_TYPES.has(normalizedContentType)) {
      return true;
    }

    return INLINE_CONTENT_TYPE_PREFIXES.some(prefix => normalizedContentType.startsWith(prefix));
  }

  /**
   * Classify errors into specific error types
   * @private
   * @param {Error} error - Original error
   * @param {string} operation - Operation that caused the error
   * @returns {Error} Classified error with errorType property
   */
  _classifyError(error, operation) {
    // Create a new error with additional context
    const classifiedError = new Error(error.message);
    classifiedError.originalError = error;
    classifiedError.operation = operation;
    classifiedError.stack = error.stack;

    // Classify error type based on error properties
    // Priority order matters: check specific errors before generic ones
    
    // 1. File System Errors (local file operations)
    if (error.code === 'ENOENT' || error.code === 'EACCES' || error.code === 'ENOSPC') {
      classifiedError.errorType = ErrorType.FILE_SYSTEM;
      classifiedError.fileSystemCode = error.code;
    }
    // 2. Network Errors (connection issues)
    else if (error.name === 'NetworkingError' || error.code === 'ENOTFOUND' || 
             error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' ||
             error.code === 'ECONNRESET' || error.code === 'EHOSTUNREACH') {
      classifiedError.errorType = ErrorType.NETWORK;
    }
    // 3. Authentication Errors (invalid credentials)
    else if (error.name === 'InvalidAccessKeyId' || error.name === 'SignatureDoesNotMatch' ||
             error.name === 'InvalidToken' || error.name === 'ExpiredToken') {
      classifiedError.errorType = ErrorType.AUTH;
    }
    // 4. Permission Errors (valid credentials but insufficient permissions)
    else if (error.name === 'AccessDenied' || 
             (error.$metadata?.httpStatusCode === 403 && error.name !== 'InvalidAccessKeyId')) {
      classifiedError.errorType = ErrorType.PERMISSION;
    }
    // 5. Bucket Errors (bucket doesn't exist or can't be accessed)
    else if (error.name === 'NoSuchBucket' || error.name === 'BucketNotFound') {
      classifiedError.errorType = ErrorType.BUCKET;
    }
    // 6. Object Errors (object doesn't exist)
    else if (error.name === 'NoSuchKey' || error.name === 'NotFound' ||
             error.$metadata?.httpStatusCode === 404) {
      classifiedError.errorType = ErrorType.OBJECT;
    }
    // 7. Unknown Errors (fallback for unclassified errors)
    else {
      classifiedError.errorType = ErrorType.UNKNOWN;
    }

    return classifiedError;
  }
}

module.exports = { R2Client, ErrorType };
