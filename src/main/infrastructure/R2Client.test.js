/**
 * R2Client Unit Tests
 * 
 * Tests for R2Client methods with mocked S3Client
 */

const { R2Client, ErrorType } = require('./R2Client');
const fs = require('fs');
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

// Mock the AWS S3 SDK
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(),
  ListObjectsV2Command: jest.fn(),
  PutObjectCommand: jest.fn(),
  CreateMultipartUploadCommand: jest.fn(),
  UploadPartCommand: jest.fn(),
  CompleteMultipartUploadCommand: jest.fn(),
  AbortMultipartUploadCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
  DeleteObjectCommand: jest.fn(),
  DeleteObjectsCommand: jest.fn(),
  HeadObjectCommand: jest.fn()
}));

// Mock fs module
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  statSync: jest.fn(),
  createReadStream: jest.fn(),
  createWriteStream: jest.fn()
}));

describe('R2Client', () => {
  let r2Client;
  let mockSend;

  const testConfig = {
    endpoint: 'https://test.r2.cloudflarestorage.com',
    region: 'auto',
    bucket: 'test-bucket',
    accessKeyId: 'test-access-key',
    secretAccessKey: 'test-secret-key'
  };

  beforeEach(() => {
    jest.clearAllMocks();

    PutObjectCommand.mockImplementation(input => input);
    CreateMultipartUploadCommand.mockImplementation(input => input);
    UploadPartCommand.mockImplementation(input => input);
    CompleteMultipartUploadCommand.mockImplementation(input => input);
    AbortMultipartUploadCommand.mockImplementation(input => input);
    
    // Setup mock S3Client
    mockSend = jest.fn();
    S3Client.mockImplementation(() => ({
      send: mockSend
    }));

    r2Client = new R2Client(testConfig);
  });

  describe('constructor', () => {
    test('should initialize with correct configuration', () => {
      expect(r2Client.config).toEqual(testConfig);
      expect(r2Client.bucket).toBe('test-bucket');
      expect(S3Client).toHaveBeenCalledWith({
        endpoint: testConfig.endpoint,
        region: testConfig.region,
        credentials: {
          accessKeyId: testConfig.accessKeyId,
          secretAccessKey: testConfig.secretAccessKey
        }
      });
    });
  });

  describe('listObjects', () => {
    test('should return list of objects from bucket', async () => {
      const mockObjects = [
        { Key: 'file1.jpg', Size: 1024, LastModified: new Date('2024-01-01') },
        { Key: 'file2.png', Size: 2048, LastModified: new Date('2024-01-02') }
      ];

      mockSend.mockResolvedValue({
        Contents: mockObjects
      });

      const result = await r2Client.listObjects();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        key: 'file1.jpg',
        size: 1024,
        lastModified: expect.any(Date),
        contentType: undefined
      });
      expect(result[1]).toEqual({
        key: 'file2.png',
        size: 2048,
        lastModified: expect.any(Date),
        contentType: undefined
      });
    });

    test('should return virtual folders and direct objects for the requested prefix', async () => {
      const directObjectLastModified = new Date('2024-01-03');
      const folderLastModified = new Date('2024-01-05');
      mockSend
        .mockResolvedValueOnce({
          CommonPrefixes: [{ Prefix: 'photos/raw/' }],
          Contents: [{
            Key: 'photos/readme.txt',
            Size: 512,
            LastModified: directObjectLastModified,
            ContentType: 'text/plain'
          }]
        })
        .mockResolvedValueOnce({
          Contents: [{
            Key: 'photos/raw/latest.jpg',
            LastModified: folderLastModified
          }]
        });

      const result = await r2Client.listObjects('photos/');

      expect(ListObjectsV2Command).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Prefix: 'photos/',
        Delimiter: '/'
      });
      expect(result).toEqual([
        {
          key: 'photos/raw/',
          name: 'raw',
          isFolder: true,
          size: 0,
          lastModified: folderLastModified,
          contentType: 'application/x-directory'
        },
        {
          key: 'photos/readme.txt',
          size: 512,
          lastModified: directObjectLastModified,
          contentType: 'text/plain'
        }
      ]);
    });

    test('should paginate folder objects when finding latest modification time', async () => {
      const latestModified = new Date('2024-01-06');
      mockSend
        .mockResolvedValueOnce({
          CommonPrefixes: [{ Prefix: 'photos/raw/' }]
        })
        .mockResolvedValueOnce({
          Contents: [{
            Key: 'photos/raw/old.jpg',
            LastModified: new Date('2024-01-04')
          }],
          IsTruncated: true,
          NextContinuationToken: 'next-page'
        })
        .mockResolvedValueOnce({
          Contents: [{
            Key: 'photos/raw/new.jpg',
            LastModified: latestModified
          }]
        });

      const result = await r2Client.listObjects('photos/');

      expect(result[0].lastModified).toBe(latestModified);
      expect(ListObjectsV2Command).toHaveBeenNthCalledWith(3, {
        Bucket: 'test-bucket',
        Prefix: 'photos/raw/',
        ContinuationToken: 'next-page'
      });
    });

    test('should convert folder marker objects into folder entries', async () => {
      mockSend.mockResolvedValue({
        Contents: [{
          Key: 'documents/',
          Size: 0,
          LastModified: new Date('2024-01-04')
        }]
      });

      const result = await r2Client.listObjects();

      expect(result[0]).toMatchObject({
        key: 'documents/',
        name: 'documents',
        isFolder: true
      });
    });

    test('should return empty array when bucket is empty', async () => {
      mockSend.mockResolvedValue({});

      const result = await r2Client.listObjects();

      expect(result).toEqual([]);
    });

    test('should classify network error correctly', async () => {
      const networkError = new Error('Network error');
      networkError.code = 'ENOTFOUND';
      mockSend.mockRejectedValue(networkError);

      await expect(r2Client.listObjects()).rejects.toMatchObject({
        errorType: ErrorType.NETWORK,
        operation: 'listObjects'
      });
    });

    test('should classify auth error correctly', async () => {
      const authError = new Error('Invalid access key');
      authError.name = 'InvalidAccessKeyId';
      mockSend.mockRejectedValue(authError);

      await expect(r2Client.listObjects()).rejects.toMatchObject({
        errorType: ErrorType.AUTH,
        operation: 'listObjects'
      });
    });

    test('should classify bucket error correctly', async () => {
      const bucketError = new Error('Bucket not found');
      bucketError.name = 'NoSuchBucket';
      mockSend.mockRejectedValue(bucketError);

      await expect(r2Client.listObjects()).rejects.toMatchObject({
        errorType: ErrorType.BUCKET,
        operation: 'listObjects'
      });
    });

    test('should classify permission error correctly', async () => {
      const permError = new Error('Access denied');
      permError.name = 'AccessDenied';
      mockSend.mockRejectedValue(permError);

      await expect(r2Client.listObjects()).rejects.toMatchObject({
        errorType: ErrorType.PERMISSION,
        operation: 'listObjects'
      });
    });
  });

  describe('uploadObject', () => {
    test('should upload file successfully', async () => {
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from('test content');
        }
      };

      fs.existsSync.mockReturnValue(true);
      fs.statSync.mockReturnValue({ size: 12 });
      fs.createReadStream.mockReturnValue(mockStream);
      mockSend.mockResolvedValue({});

      await r2Client.uploadObject('test-key', '/path/to/file.jpg');

      expect(mockSend).toHaveBeenCalled();
      expect(PutObjectCommand).toHaveBeenCalledWith(expect.objectContaining({
        Bucket: 'test-bucket',
        Key: 'test-key',
        ContentType: 'application/octet-stream'
      }));
    });

    test('should call progress callback during upload', async () => {
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from('test ');
          yield Buffer.from('content');
        }
      };

      fs.existsSync.mockReturnValue(true);
      fs.statSync.mockReturnValue({ size: 12 });
      fs.createReadStream.mockReturnValue(mockStream);
      mockSend.mockResolvedValue({});

      const progressCallback = jest.fn();
      await r2Client.uploadObject('test-key', '/path/to/file.jpg', progressCallback);

      expect(progressCallback).toHaveBeenCalled();
    });

    test('should infer preview metadata from object key', async () => {
      const mockStream = {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from('image content');
        }
      };

      fs.existsSync.mockReturnValue(true);
      fs.statSync.mockReturnValue({ size: 13 });
      fs.createReadStream.mockReturnValue(mockStream);
      mockSend.mockResolvedValue({});

      await r2Client.uploadObject('photo.jpg', '/path/to/file.jpg');

      expect(PutObjectCommand).toHaveBeenCalledWith(expect.objectContaining({
        Bucket: 'test-bucket',
        Key: 'photo.jpg',
        ContentType: 'image/jpeg',
        ContentDisposition: 'inline'
      }));
    });

    test('should throw error when file does not exist', async () => {
      fs.existsSync.mockReturnValue(false);

      await expect(r2Client.uploadObject('test-key', '/path/to/nonexistent.jpg'))
        .rejects.toMatchObject({
          errorType: ErrorType.FILE_SYSTEM
        });
    });

    test('should classify file system error correctly', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.statSync.mockImplementation(() => {
        const error = new Error('Permission denied');
        error.code = 'EACCES';
        throw error;
      });

      await expect(r2Client.uploadObject('test-key', '/path/to/file.jpg'))
        .rejects.toMatchObject({
          errorType: ErrorType.FILE_SYSTEM
        });
    });

    test('should use multipart upload for files larger than 300 MiB', async () => {
      const fileSize = 300 * 1024 * 1024 + 1;
      const progress = [];
      let sendCount = 0;

      fs.existsSync.mockReturnValue(true);
      fs.statSync.mockReturnValue({ size: fileSize });
      fs.createReadStream.mockImplementation(() => ({
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from('part');
        }
      }));
      mockSend.mockImplementation(async command => {
        sendCount++;
        if (command?.Body) {
          for await (const chunk of command.Body) {
            void chunk;
          }
        }

        if (sendCount === 1) {
          return { UploadId: 'upload-id' };
        }
        if (sendCount <= 6) {
          return { ETag: `etag-${sendCount}` };
        }
        return {};
      });

      await r2Client.uploadObject('large.bin', '/path/to/large.bin', (loaded, total) => {
        progress.push({ loaded, total });
      });

      expect(CreateMultipartUploadCommand).toHaveBeenCalledWith(expect.objectContaining({
        Bucket: 'test-bucket',
        Key: 'large.bin',
        ContentType: 'application/octet-stream'
      }));
      expect(UploadPartCommand).toHaveBeenCalledTimes(5);
      expect(CompleteMultipartUploadCommand).toHaveBeenCalledWith(expect.objectContaining({
        Bucket: 'test-bucket',
        Key: 'large.bin',
        UploadId: 'upload-id',
        MultipartUpload: {
          Parts: expect.arrayContaining([
            expect.objectContaining({ PartNumber: 1 }),
            expect.objectContaining({ PartNumber: 5 })
          ])
        }
      }));
      expect(AbortMultipartUploadCommand).not.toHaveBeenCalled();
      expect(progress.at(-1)).toEqual({ loaded: fileSize, total: fileSize });
    });

    test('should abort multipart upload when a part fails', async () => {
      const fileSize = 300 * 1024 * 1024 + 1;
      let sendCount = 0;

      fs.existsSync.mockReturnValue(true);
      fs.statSync.mockReturnValue({ size: fileSize });
      fs.createReadStream.mockImplementation(() => ({
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from('part');
        }
      }));
      mockSend.mockImplementation(async command => {
        sendCount++;
        if (sendCount === 1) {
          return { UploadId: 'upload-id' };
        }
        if (command?.Body) {
          for await (const chunk of command.Body) {
            void chunk;
          }
          throw new Error('part upload failed');
        }
        return {};
      });

      await expect(r2Client.uploadObject('large.bin', '/path/to/large.bin'))
        .rejects.toThrow('part upload failed');
      expect(AbortMultipartUploadCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'large.bin',
        UploadId: 'upload-id'
      });
    });
  });

  describe('uploadObjectFromBuffer', () => {
    test('should use provided content type and inline disposition for previewable files', async () => {
      const progressCallback = jest.fn();
      mockSend.mockResolvedValue({});

      await r2Client.uploadObjectFromBuffer(
        'poster.png',
        Buffer.from('image content'),
        'image/png',
        progressCallback
      );

      expect(PutObjectCommand).toHaveBeenCalledWith(expect.objectContaining({
        Bucket: 'test-bucket',
        Key: 'poster.png',
        ContentType: 'image/png',
        ContentDisposition: 'inline'
      }));
      expect(progressCallback).toHaveBeenCalledTimes(2);
    });

    test('should infer content type from key when drag data has no mime', async () => {
      mockSend.mockResolvedValue({});

      await r2Client.uploadObjectFromBuffer(
        'clip.webm',
        Buffer.from('video content'),
        '',
        undefined
      );

      expect(PutObjectCommand).toHaveBeenCalledWith(expect.objectContaining({
        Bucket: 'test-bucket',
        Key: 'clip.webm',
        ContentType: 'video/webm',
        ContentDisposition: 'inline'
      }));
    });
  });

  describe('downloadObject', () => {
    test('should download object successfully', async () => {
      const mockBody = {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from('downloaded content');
        }
      };

      const mockWriteStream = {
        write: jest.fn(),
        end: jest.fn(),
        on: jest.fn((event, callback) => {
          if (event === 'finish') {
            setTimeout(callback, 0);
          }
        })
      };

      mockSend.mockResolvedValue({
        Body: mockBody,
        ContentLength: 17
      });
      fs.createWriteStream.mockReturnValue(mockWriteStream);

      await r2Client.downloadObject('test-key', '/path/to/save.jpg');

      expect(mockSend).toHaveBeenCalled();
      expect(mockWriteStream.write).toHaveBeenCalled();
      expect(mockWriteStream.end).toHaveBeenCalled();
    });

    test('should call progress callback during download', async () => {
      const mockBody = {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from('chunk1');
          yield Buffer.from('chunk2');
        }
      };

      const mockWriteStream = {
        write: jest.fn(),
        end: jest.fn(),
        on: jest.fn((event, callback) => {
          if (event === 'finish') {
            setTimeout(callback, 0);
          }
        })
      };

      mockSend.mockResolvedValue({
        Body: mockBody,
        ContentLength: 12
      });
      fs.createWriteStream.mockReturnValue(mockWriteStream);

      const progressCallback = jest.fn();
      await r2Client.downloadObject('test-key', '/path/to/save.jpg', progressCallback);

      expect(progressCallback).toHaveBeenCalled();
    });

    test('should classify object not found error correctly', async () => {
      const objectError = new Error('Object not found');
      objectError.name = 'NoSuchKey';
      mockSend.mockRejectedValue(objectError);

      await expect(r2Client.downloadObject('nonexistent-key', '/path/to/save.jpg'))
        .rejects.toMatchObject({
          errorType: ErrorType.OBJECT
        });
    });
  });

  describe('deleteObject', () => {
    test('should delete object successfully', async () => {
      mockSend.mockResolvedValue({});

      await r2Client.deleteObject('test-key');

      expect(mockSend).toHaveBeenCalled();
    });

    test('should classify error on delete failure', async () => {
      const error = new Error('Access denied');
      error.name = 'AccessDenied';
      mockSend.mockRejectedValue(error);

      await expect(r2Client.deleteObject('test-key'))
        .rejects.toMatchObject({
          errorType: ErrorType.PERMISSION
        });
    });
  });

  describe('deleteObjects', () => {
    test('should delete multiple objects successfully', async () => {
      mockSend.mockResolvedValue({
        Deleted: [
          { Key: 'file1.jpg' },
          { Key: 'file2.png' },
          { Key: 'file3.pdf' }
        ],
        Errors: []
      });

      const result = await r2Client.deleteObjects(['file1.jpg', 'file2.png', 'file3.pdf']);

      expect(result.deleted).toEqual(['file1.jpg', 'file2.png', 'file3.pdf']);
      expect(result.errors).toEqual([]);
      expect(mockSend).toHaveBeenCalled();
    });

    test('should return partial results when some deletions fail', async () => {
      mockSend.mockResolvedValue({
        Deleted: [
          { Key: 'file1.jpg' },
          { Key: 'file3.pdf' }
        ],
        Errors: [
          { Key: 'file2.png', Code: 'AccessDenied', Message: 'Access denied' }
        ]
      });

      const result = await r2Client.deleteObjects(['file1.jpg', 'file2.png', 'file3.pdf']);

      expect(result.deleted).toEqual(['file1.jpg', 'file3.pdf']);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].key).toBe('file2.png');
      expect(result.errors[0].error.message).toBe('Access denied');
    });

    test('should return empty deleted array when all deletions fail', async () => {
      mockSend.mockResolvedValue({
        Deleted: [],
        Errors: [
          { Key: 'file1.jpg', Code: 'AccessDenied', Message: 'Access denied' },
          { Key: 'file2.png', Code: 'AccessDenied', Message: 'Access denied' }
        ]
      });

      const result = await r2Client.deleteObjects(['file1.jpg', 'file2.png']);

      expect(result.deleted).toEqual([]);
      expect(result.errors).toHaveLength(2);
    });

    test('should handle empty response', async () => {
      mockSend.mockResolvedValue({});

      const result = await r2Client.deleteObjects(['file1.jpg']);

      expect(result.deleted).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    test('should classify error on batch delete failure', async () => {
      const error = new Error('Access denied');
      error.name = 'AccessDenied';
      mockSend.mockRejectedValue(error);

      await expect(r2Client.deleteObjects(['file1.jpg', 'file2.png']))
        .rejects.toMatchObject({
          errorType: ErrorType.PERMISSION
        });
    });
  });

  describe('getObjectUrl', () => {
    test('should return correct URL for object', async () => {
      const url = await r2Client.getObjectUrl('test-image.jpg');

      expect(url).toBe('https://test.r2.cloudflarestorage.com/test-bucket/test-image.jpg');
    });

    test('should handle nested key paths', async () => {
      const url = await r2Client.getObjectUrl('folder/subfolder/file.jpg');

      expect(url).toBe('https://test.r2.cloudflarestorage.com/test-bucket/folder/subfolder/file.jpg');
    });
  });

  describe('getObjectMetadata', () => {
    test('should return object metadata', async () => {
      const mockMetadata = {
        ContentType: 'image/jpeg',
        ContentLength: 1024,
        LastModified: new Date('2024-01-01'),
        ETag: '"abc123"'
      };

      mockSend.mockResolvedValue(mockMetadata);

      const result = await r2Client.getObjectMetadata('test-key');

      expect(result).toEqual({
        contentType: 'image/jpeg',
        contentLength: 1024,
        lastModified: expect.any(Date),
        etag: '"abc123"',
        metadata: undefined
      });
    });

    test('should classify object not found error', async () => {
      const error = new Error('Not found');
      error.$metadata = { httpStatusCode: 404 };
      mockSend.mockRejectedValue(error);

      await expect(r2Client.getObjectMetadata('nonexistent-key'))
        .rejects.toMatchObject({
          errorType: ErrorType.OBJECT
        });
    });
  });

  describe('getObjectStream', () => {
    test('should return stream and metadata', async () => {
      const mockBody = {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from('stream content');
        }
      };

      mockSend.mockResolvedValue({
        Body: mockBody,
        ContentType: 'text/plain',
        ContentLength: 14,
        LastModified: new Date('2024-01-01'),
        ETag: '"xyz789"'
      });

      const result = await r2Client.getObjectStream('test-key');

      expect(result.stream).toBeDefined();
      expect(result.metadata).toEqual({
        contentType: 'text/plain',
        contentLength: 14,
        lastModified: expect.any(Date),
        etag: '"xyz789"'
      });
    });
  });

  describe('_classifyError', () => {
    test('should classify ENOENT as FILE_SYSTEM error', () => {
      const error = new Error('File not found');
      error.code = 'ENOENT';
      
      const result = r2Client._classifyError(error, 'testOperation');
      
      expect(result.errorType).toBe(ErrorType.FILE_SYSTEM);
      expect(result.fileSystemCode).toBe('ENOENT');
    });

    test('should classify EACCES as FILE_SYSTEM error', () => {
      const error = new Error('Permission denied');
      error.code = 'EACCES';
      
      const result = r2Client._classifyError(error, 'testOperation');
      
      expect(result.errorType).toBe(ErrorType.FILE_SYSTEM);
    });

    test('should classify ENOSPC as FILE_SYSTEM error', () => {
      const error = new Error('No space left');
      error.code = 'ENOSPC';
      
      const result = r2Client._classifyError(error, 'testOperation');
      
      expect(result.errorType).toBe(ErrorType.FILE_SYSTEM);
    });

    test('should classify ENOTFOUND as NETWORK error', () => {
      const error = new Error('Host not found');
      error.code = 'ENOTFOUND';
      
      const result = r2Client._classifyError(error, 'testOperation');
      
      expect(result.errorType).toBe(ErrorType.NETWORK);
    });

    test('should classify ECONNREFUSED as NETWORK error', () => {
      const error = new Error('Connection refused');
      error.code = 'ECONNREFUSED';
      
      const result = r2Client._classifyError(error, 'testOperation');
      
      expect(result.errorType).toBe(ErrorType.NETWORK);
    });

    test('should classify ETIMEDOUT as NETWORK error', () => {
      const error = new Error('Connection timed out');
      error.code = 'ETIMEDOUT';
      
      const result = r2Client._classifyError(error, 'testOperation');
      
      expect(result.errorType).toBe(ErrorType.NETWORK);
    });

    test('should classify ECONNRESET as NETWORK error', () => {
      const error = new Error('Connection reset');
      error.code = 'ECONNRESET';
      
      const result = r2Client._classifyError(error, 'testOperation');
      
      expect(result.errorType).toBe(ErrorType.NETWORK);
    });

    test('should classify EHOSTUNREACH as NETWORK error', () => {
      const error = new Error('Host unreachable');
      error.code = 'EHOSTUNREACH';
      
      const result = r2Client._classifyError(error, 'testOperation');
      
      expect(result.errorType).toBe(ErrorType.NETWORK);
    });

    test('should classify NetworkingError as NETWORK error', () => {
      const error = new Error('Networking error');
      error.name = 'NetworkingError';
      
      const result = r2Client._classifyError(error, 'testOperation');
      
      expect(result.errorType).toBe(ErrorType.NETWORK);
    });

    test('should classify InvalidAccessKeyId as AUTH error', () => {
      const error = new Error('Invalid access key');
      error.name = 'InvalidAccessKeyId';
      
      const result = r2Client._classifyError(error, 'testOperation');
      
      expect(result.errorType).toBe(ErrorType.AUTH);
    });

    test('should classify SignatureDoesNotMatch as AUTH error', () => {
      const error = new Error('Signature mismatch');
      error.name = 'SignatureDoesNotMatch';
      
      const result = r2Client._classifyError(error, 'testOperation');
      
      expect(result.errorType).toBe(ErrorType.AUTH);
    });

    test('should classify InvalidToken as AUTH error', () => {
      const error = new Error('Invalid token');
      error.name = 'InvalidToken';
      
      const result = r2Client._classifyError(error, 'testOperation');
      
      expect(result.errorType).toBe(ErrorType.AUTH);
    });

    test('should classify ExpiredToken as AUTH error', () => {
      const error = new Error('Token expired');
      error.name = 'ExpiredToken';
      
      const result = r2Client._classifyError(error, 'testOperation');
      
      expect(result.errorType).toBe(ErrorType.AUTH);
    });

    test('should classify AccessDenied as PERMISSION error', () => {
      const error = new Error('Access denied');
      error.name = 'AccessDenied';
      
      const result = r2Client._classifyError(error, 'testOperation');
      
      expect(result.errorType).toBe(ErrorType.PERMISSION);
    });

    test('should classify 403 status as PERMISSION error (when not auth error)', () => {
      const error = new Error('Forbidden');
      error.$metadata = { httpStatusCode: 403 };
      
      const result = r2Client._classifyError(error, 'testOperation');
      
      expect(result.errorType).toBe(ErrorType.PERMISSION);
    });

    test('should classify NoSuchBucket as BUCKET error', () => {
      const error = new Error('Bucket not found');
      error.name = 'NoSuchBucket';
      
      const result = r2Client._classifyError(error, 'testOperation');
      
      expect(result.errorType).toBe(ErrorType.BUCKET);
    });

    test('should classify BucketNotFound as BUCKET error', () => {
      const error = new Error('Bucket not found');
      error.name = 'BucketNotFound';
      
      const result = r2Client._classifyError(error, 'testOperation');
      
      expect(result.errorType).toBe(ErrorType.BUCKET);
    });

    test('should classify NoSuchKey as OBJECT error', () => {
      const error = new Error('Key not found');
      error.name = 'NoSuchKey';
      
      const result = r2Client._classifyError(error, 'testOperation');
      
      expect(result.errorType).toBe(ErrorType.OBJECT);
    });

    test('should classify NotFound as OBJECT error', () => {
      const error = new Error('Not found');
      error.name = 'NotFound';
      
      const result = r2Client._classifyError(error, 'testOperation');
      
      expect(result.errorType).toBe(ErrorType.OBJECT);
    });

    test('should classify 404 status as OBJECT error', () => {
      const error = new Error('Not found');
      error.$metadata = { httpStatusCode: 404 };
      
      const result = r2Client._classifyError(error, 'testOperation');
      
      expect(result.errorType).toBe(ErrorType.OBJECT);
    });

    test('should classify unknown errors as UNKNOWN', () => {
      const error = new Error('Some unknown error');
      
      const result = r2Client._classifyError(error, 'testOperation');
      
      expect(result.errorType).toBe(ErrorType.UNKNOWN);
    });

    test('should preserve original error and stack', () => {
      const error = new Error('Test error');
      error.code = 'ENOENT';
      
      const result = r2Client._classifyError(error, 'testOperation');
      
      expect(result.originalError).toBe(error);
      expect(result.operation).toBe('testOperation');
      expect(result.stack).toBe(error.stack);
    });
  });
});

describe('ErrorType constants', () => {
  test('should have all required error types', () => {
    expect(ErrorType.NETWORK).toBe('NETWORK');
    expect(ErrorType.AUTH).toBe('AUTH');
    expect(ErrorType.BUCKET).toBe('BUCKET');
    expect(ErrorType.OBJECT).toBe('OBJECT');
    expect(ErrorType.PERMISSION).toBe('PERMISSION');
    expect(ErrorType.FILE_SYSTEM).toBe('FILE_SYSTEM');
    expect(ErrorType.UNKNOWN).toBe('UNKNOWN');
  });
});
