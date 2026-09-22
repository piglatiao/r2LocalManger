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
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand
} = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
const { Readable, Transform } = require('stream');
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

const LARGE_UPLOAD_THRESHOLD_BYTES = 300 * 1024 * 1024;
const DEFAULT_MULTIPART_PART_SIZE_BYTES = 64 * 1024 * 1024;
const MIN_MULTIPART_PART_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_MULTIPART_PARTS = 10000;

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
   * 按文件大小选择流式上传或 S3 Multipart 上传。
   * @param {string} key - 对象 key
   * @param {string} filePath - 本地文件路径
   * @param {Function} onProgress - 传输进度回调（已传输字节数、总字节数）
   * @returns {Promise<void>}
   */
  async uploadObject(key, filePath, onProgress) {
    try {
      if (!fs.existsSync(filePath)) {
        const error = new Error(`File not found: ${filePath}`);
        error.code = 'ENOENT';
        throw error;
      }

      const stats = fs.statSync(filePath);
      const fileSize = stats.size;
      const objectHeaders = this._buildObjectHttpMetadata(key);

      onProgress?.(0, fileSize);

      if (fileSize > LARGE_UPLOAD_THRESHOLD_BYTES) {
        await this._uploadMultipartObject(key, filePath, fileSize, objectHeaders, onProgress);
        return;
      }

      await this._sendStreamCommand(
        PutObjectCommand,
        {
          Bucket: this.bucket,
          Key: key,
          ContentLength: fileSize,
          ...objectHeaders
        },
        fs.createReadStream(filePath),
        fileSize,
        0,
        onProgress
      );
    } catch (error) {
      throw this._classifyError(error, 'uploadObject');
    }
  }

  /**
   * 使用 S3 Multipart 接口顺序上传大文件分片。
   * @param {string} key - 对象 key
   * @param {string} filePath - 本地文件路径
   * @param {number} fileSize - 文件总字节数
   * @param {Object} objectHeaders - 对象 HTTP 元数据
   * @param {Function} onProgress - 传输进度回调
   * @returns {Promise<void>}
   */
  async _uploadMultipartObject(key, filePath, fileSize, objectHeaders, onProgress) {
    await this._uploadMultipart(
      key,
      fileSize,
      objectHeaders,
      (offset, currentPartSize) => fs.createReadStream(filePath, {
        start: offset,
        end: offset + currentPartSize - 1
      }),
      onProgress
    );
  }

  /**
   * 使用内存 Buffer 顺序创建 Multipart 分片流。
   * @param {string} key - 对象 key
   * @param {Buffer} buffer - 文件内容
   * @param {Object} objectHeaders - 对象 HTTP 元数据
   * @param {Function} onProgress - 传输进度回调
   * @returns {Promise<void>}
   */
  async _uploadMultipartBuffer(key, buffer, objectHeaders, onProgress) {
    await this._uploadMultipart(
      key,
      buffer.length,
      objectHeaders,
      (offset, currentPartSize) => Readable.from([
        buffer.subarray(offset, offset + currentPartSize)
      ]),
      onProgress
    );
  }

  /**
   * 执行顺序 Multipart 上传并在失败时中止未完成上传。
   * @param {string} key - 对象 key
   * @param {number} fileSize - 文件总字节数
   * @param {Object} objectHeaders - 对象 HTTP 元数据
   * @param {Function} createPartStream - 根据偏移和长度创建分片流
   * @param {Function} onProgress - 传输进度回调
   * @returns {Promise<void>}
   */
  async _uploadMultipart(key, fileSize, objectHeaders, createPartStream, onProgress) {
    const partSize = this._getMultipartPartSize(fileSize);
    const initResponse = await this.s3Client.send(new CreateMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      ...objectHeaders
    }));

    const uploadId = initResponse?.UploadId;
    if (!uploadId) {
      const error = new Error('Multipart upload did not return an upload ID');
      error.code = 'MULTIPART_UPLOAD_INIT_FAILED';
      throw error;
    }

    const parts = [];
    let uploadedBytes = 0;

    try {
      let partNumber = 1;
      for (let offset = 0; offset < fileSize; offset += partSize, partNumber++) {
        const currentPartSize = Math.min(partSize, fileSize - offset);
        const partResponse = await this._sendStreamCommand(
          UploadPartCommand,
          {
            Bucket: this.bucket,
            Key: key,
            UploadId: uploadId,
            PartNumber: partNumber,
            ContentLength: currentPartSize
          },
          createPartStream(offset, currentPartSize),
          fileSize,
          uploadedBytes,
          onProgress
        );

        if (!partResponse?.ETag) {
          throw new Error(`Multipart part ${partNumber} did not return an ETag`);
        }

        parts.push({
          PartNumber: partNumber,
          ETag: partResponse.ETag
        });
        uploadedBytes += currentPartSize;
        onProgress?.(uploadedBytes, fileSize);
      }

      await this.s3Client.send(new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts }
      }));
    } catch (error) {
      try {
        await this.s3Client.send(new AbortMultipartUploadCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId
        }));
      } catch (abortError) {
        error.abortError = abortError;
      }

      throw error;
    }
  }

  /**
   * 根据文件大小计算 Multipart 分片大小，避免超过最大分片数量。
   * @param {number} fileSize - 文件总字节数
   * @returns {number} 分片字节数
   */
  _getMultipartPartSize(fileSize) {
    const sizeForPartLimit = Math.ceil(
      fileSize / MAX_MULTIPART_PARTS / MIN_MULTIPART_PART_SIZE_BYTES
    ) * MIN_MULTIPART_PART_SIZE_BYTES;
    return Math.max(DEFAULT_MULTIPART_PART_SIZE_BYTES, sizeForPartLimit);
  }

  /**
   * 将本地流接入 S3 请求，并按请求体实际消费量报告进度。
   * @param {Function} Command - S3 命令构造器
   * @param {Object} input - S3 命令参数
   * @param {AsyncIterable|Readable} sourceStream - 文件流
   * @param {number} totalBytes - 整个文件总字节数
   * @param {number} completedBytes - 当前分片之前已传输字节数
   * @param {Function} onProgress - 传输进度回调
   * @returns {Promise<Object>} S3 响应
   */
  async _sendStreamCommand(Command, input, sourceStream, totalBytes, completedBytes, onProgress) {
    let transferredBytes = 0;
    const progressStream = new Transform({
      transform: (chunk, encoding, callback) => {
        try {
          const chunkSize = Buffer.isBuffer(chunk)
            ? chunk.length
            : Buffer.byteLength(String(chunk), encoding);
          transferredBytes += chunkSize;
          onProgress?.(completedBytes + transferredBytes, totalBytes);
          callback(null, chunk);
        } catch (error) {
          callback(error);
        }
      }
    });
    const readableSource = Readable.from(sourceStream);
    const streamPromise = pipeline(readableSource, progressStream);
    const uploadPromise = Promise.resolve().then(() => this.s3Client.send(new Command({
      ...input,
      Body: progressStream
    })));

    try {
      const [, response] = await Promise.all([streamPromise, uploadPromise]);
      return response;
    } catch (error) {
      readableSource.destroy(error);
      sourceStream.destroy?.();
      progressStream.destroy(error);
      await Promise.allSettled([streamPromise, uploadPromise]);
      throw error;
    }
  }

  /**
   * 流式上传内存 Buffer，供小文件拖放上传使用。
   * @param {string} key - 对象 key
   * @param {Buffer} buffer - 文件内容
   * @param {string} contentType - MIME 类型
   * @param {Function} onProgress - 传输进度回调
   * @returns {Promise<void>}
   */
  async uploadObjectFromBuffer(key, buffer, contentType, onProgress) {
    try {
      const fileSize = buffer.length;
      const objectHeaders = this._buildObjectHttpMetadata(key, contentType);
      onProgress?.(0, fileSize);

      if (fileSize > LARGE_UPLOAD_THRESHOLD_BYTES) {
        await this._uploadMultipartBuffer(key, buffer, objectHeaders, onProgress);
        return;
      }

      await this._sendStreamCommand(
        PutObjectCommand,
        {
          Bucket: this.bucket,
          Key: key,
          ContentLength: fileSize,
          ...objectHeaders
        },
        Readable.from([buffer]),
        fileSize,
        0,
        onProgress
      );

      if (fileSize === 0) {
        onProgress?.(0, fileSize);
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
      // 始终优先使用当前桶同步回来的 publicUrl，避免切桶后沿用旧的全局配置。
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
