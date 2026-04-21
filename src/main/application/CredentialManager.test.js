/**
 * Unit tests for CredentialManager
 */

const { CredentialManager } = require('./CredentialManager');

describe('CredentialManager', () => {
  // Store original environment variables
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment before each test
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('loadCredentials', () => {
    test('should load credentials from environment variables', () => {
      process.env.R2_ACCESS_KEY_ID = 'test_access_key';
      process.env.R2_SECRET_ACCESS_KEY = 'test_secret_key';

      const credentials = CredentialManager.loadCredentials();

      expect(credentials).toEqual({
        accessKeyId: 'test_access_key',
        secretAccessKey: 'test_secret_key'
      });
    });

    test('should throw error when access key is missing', () => {
      delete process.env.R2_ACCESS_KEY_ID;
      process.env.R2_SECRET_ACCESS_KEY = 'test_secret_key';

      expect(() => {
        CredentialManager.loadCredentials();
      }).toThrow('Missing R2 credentials');
    });

    test('should throw error when secret key is missing', () => {
      process.env.R2_ACCESS_KEY_ID = 'test_access_key';
      delete process.env.R2_SECRET_ACCESS_KEY;

      expect(() => {
        CredentialManager.loadCredentials();
      }).toThrow('Missing R2 credentials');
    });

    test('should throw error with details when credentials are missing', () => {
      delete process.env.R2_ACCESS_KEY_ID;
      delete process.env.R2_SECRET_ACCESS_KEY;

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
    test('should return complete R2 configuration', () => {
      process.env.R2_ACCESS_KEY_ID = 'test_access_key';
      process.env.R2_SECRET_ACCESS_KEY = 'test_secret_key';

      const config = CredentialManager.getConfig();

      expect(config).toEqual({
        endpoint: 'https://12b1178bf0856d6e0b7d787ebd43cee5.r2.cloudflarestorage.com',
        region: 'auto',
        bucket: 'picture',
        accessKeyId: 'test_access_key',
        secretAccessKey: 'test_secret_key'
      });
    });

    test('should throw error when credentials are missing', () => {
      delete process.env.R2_ACCESS_KEY_ID;
      delete process.env.R2_SECRET_ACCESS_KEY;

      expect(() => {
        CredentialManager.getConfig();
      }).toThrow('Missing R2 credentials');
    });

    test('should throw error when credentials are invalid', () => {
      process.env.R2_ACCESS_KEY_ID = '';
      process.env.R2_SECRET_ACCESS_KEY = 'test_secret_key';

      expect(() => {
        CredentialManager.getConfig();
      }).toThrow();
    });
  });
});
