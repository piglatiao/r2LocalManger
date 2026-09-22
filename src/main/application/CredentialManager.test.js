/**
 * CredentialManager 单元测试
 */

const { CredentialManager } = require('./CredentialManager');

describe('CredentialManager', () => {
  describe('loadCredentials', () => {
    test('should load credentials from local settings', () => {
      const credentials = CredentialManager.loadCredentials({
        accessKeyId: 'test_access_key',
        secretAccessKey: 'test_secret_key'
      });

      expect(credentials).toEqual({
        accessKeyId: 'test_access_key',
        secretAccessKey: 'test_secret_key'
      });
    });

    test('should throw error when access key is missing', () => {
      expect(() => {
        CredentialManager.loadCredentials({ secretAccessKey: 'test_secret_key' });
      }).toThrow('Missing R2 credentials');
    });

    test('should throw error when secret key is missing', () => {
      expect(() => {
        CredentialManager.loadCredentials({ accessKeyId: 'test_access_key' });
      }).toThrow('Missing R2 credentials');
    });

    test('should reject non-string credentials', () => {
      expect(() => {
        CredentialManager.loadCredentials({
          accessKeyId: 123,
          secretAccessKey: 'test_secret_key'
        });
      }).toThrow('Missing R2 credentials');
    });

    test('should throw error with details when credentials are missing', () => {
      try {
        CredentialManager.loadCredentials();
        fail('Should have thrown an error');
      } catch (error) {
        expect(error.code).toBe('MISSING_CREDENTIALS');
        expect(error.details).toEqual({
          hasAccessKeyId: false,
          hasSecretAccessKey: false
        });
      }
    });
  });

  describe('validateCredentials', () => {
    test('should return true for valid credentials', () => {
      const credentials = {
        accessKeyId: 'test_access_key',
        secretAccessKey: 'test_secret_key'
      };

      expect(CredentialManager.validateCredentials(credentials)).toBe(true);
    });

    test('should return false when credentials is null', () => {
      expect(CredentialManager.validateCredentials(null)).toBe(false);
    });

    test('should return false when credentials is undefined', () => {
      expect(CredentialManager.validateCredentials(undefined)).toBe(false);
    });

    test('should return false when accessKeyId is missing', () => {
      const credentials = {
        secretAccessKey: 'test_secret_key'
      };

      expect(CredentialManager.validateCredentials(credentials)).toBe(false);
    });

    test('should return false when secretAccessKey is missing', () => {
      const credentials = {
        accessKeyId: 'test_access_key'
      };

      expect(CredentialManager.validateCredentials(credentials)).toBe(false);
    });

    test('should return false when accessKeyId is empty string', () => {
      const credentials = {
        accessKeyId: '',
        secretAccessKey: 'test_secret_key'
      };

      expect(CredentialManager.validateCredentials(credentials)).toBe(false);
    });

    test('should return false when accessKeyId is whitespace only', () => {
      const credentials = {
        accessKeyId: '   ',
        secretAccessKey: 'test_secret_key'
      };

      expect(CredentialManager.validateCredentials(credentials)).toBe(false);
    });

    test('should return false when secretAccessKey is empty string', () => {
      const credentials = {
        accessKeyId: 'test_access_key',
        secretAccessKey: ''
      };

      expect(CredentialManager.validateCredentials(credentials)).toBe(false);
    });

    test('should return false when secretAccessKey is whitespace only', () => {
      const credentials = {
        accessKeyId: 'test_access_key',
        secretAccessKey: '   '
      };

      expect(CredentialManager.validateCredentials(credentials)).toBe(false);
    });

    test('should return false when accessKeyId is not a string', () => {
      const credentials = {
        accessKeyId: 123,
        secretAccessKey: 'test_secret_key'
      };

      expect(CredentialManager.validateCredentials(credentials)).toBe(false);
    });

    test('should return false when secretAccessKey is not a string', () => {
      const credentials = {
        accessKeyId: 'test_access_key',
        secretAccessKey: 123
      };

      expect(CredentialManager.validateCredentials(credentials)).toBe(false);
    });
  });

  describe('getConfig', () => {
    test('should return complete R2 configuration from local settings', () => {
      const config = CredentialManager.getConfig(
        {
          accessKeyId: 'test_access_key',
          secretAccessKey: 'test_secret_key'
        },
        {
          endpoint: 'https://example.r2.cloudflarestorage.com',
          region: 'auto',
          bucket: 'picture'
        }
      );

      expect(config).toEqual({
        endpoint: 'https://example.r2.cloudflarestorage.com',
        region: 'auto',
        bucket: 'picture',
        accessKeyId: 'test_access_key',
        secretAccessKey: 'test_secret_key'
      });
    });

    test('should throw error when credentials are missing', () => {
      expect(() => {
        CredentialManager.getConfig(undefined, {
          endpoint: 'https://example.r2.cloudflarestorage.com',
          bucket: 'picture'
        });
      }).toThrow('Missing R2 credentials');
    });

    test('should throw error when credentials are invalid', () => {
      expect(() => {
        CredentialManager.getConfig({
          accessKeyId: '',
          secretAccessKey: 'test_secret_key'
        });
      }).toThrow();
    });
  });
});
