# Error Handling Documentation

## Overview

The R2 Storage Manager implements a comprehensive error handling system that classifies errors into specific types and provides user-friendly messages in Simplified Chinese.

## Architecture

The error handling system consists of three main components:

1. **R2Client** - Classifies errors at the infrastructure layer
2. **ErrorHandler** - Converts classified errors to user-friendly messages
3. **UI_TEXT** - Provides all Simplified Chinese error messages

## Error Types

### 1. Network Errors (网络错误)

**Error Type:** `ErrorType.NETWORK`

**Detected When:**
- `error.name === 'NetworkingError'`
- `error.code === 'ENOTFOUND'` (DNS lookup failed)
- `error.code === 'ECONNREFUSED'` (Connection refused)
- `error.code === 'ETIMEDOUT'` (Connection timeout)
- `error.code === 'ECONNRESET'` (Connection reset)
- `error.code === 'EHOSTUNREACH'` (Host unreachable)

**User Message:** "网络连接失败,请检查网络设置"

**Recommended Action:** Provide "重试" (Retry) button

**Retryable:** Yes

---

### 2. Authentication Errors (认证错误)

**Error Type:** `ErrorType.AUTH`

**Detected When:**
- `error.name === 'InvalidAccessKeyId'`
- `error.name === 'SignatureDoesNotMatch'`
- `error.name === 'InvalidToken'`
- `error.name === 'ExpiredToken'`

**User Message:** 
```
认证失败，请检查 API 凭证配置
请确认环境变量 R2_ACCESS_KEY_ID 和 R2_SECRET_ACCESS_KEY 已正确设置
```

**Recommended Action:** Guide user to check environment variables

**Retryable:** No (requires credential fix)

---

### 3. Permission Errors (权限错误)

**Error Type:** `ErrorType.PERMISSION`

**Detected When:**
- `error.name === 'AccessDenied'`
- `error.$metadata?.httpStatusCode === 403` (and not an auth error)

**User Message:** "权限不足，无法执行此操作"

**Recommended Action:** Inform user about insufficient permissions

**Retryable:** No

---

### 4. Bucket Errors (存储桶错误)

**Error Type:** `ErrorType.BUCKET`

**Detected When:**
- `error.name === 'NoSuchBucket'`
- `error.name === 'BucketNotFound'`

**User Message:** "存储桶不存在或无法访问"

**Recommended Action:** Verify bucket configuration

**Retryable:** No

---

### 5. Object Errors (对象错误)

**Error Type:** `ErrorType.OBJECT`

**Detected When:**
- `error.name === 'NoSuchKey'`
- `error.name === 'NotFound'`
- `error.$metadata?.httpStatusCode === 404`

**User Message:** "对象不存在，可能已被删除"

**Recommended Action:** Automatically refresh object list

**Retryable:** No (but should refresh list)

---

### 6. File System Errors (文件系统错误)

**Error Type:** `ErrorType.FILE_SYSTEM`

**Detected When:**
- `error.code === 'ENOENT'` (File not found)
- `error.code === 'EACCES'` (Access denied)
- `error.code === 'ENOSPC'` (No space left)

**User Messages:**
- ENOENT: "文件或目录不存在"
- EACCES: "没有访问权限"
- ENOSPC: "磁盘空间不足"

**Recommended Action:** Depends on specific error code

**Retryable:** No

---

### 7. Unknown Errors (未知错误)

**Error Type:** `ErrorType.UNKNOWN`

**Detected When:** Error doesn't match any other category

**User Message:** "发生未知错误，请查看日志文件获取详细信息"

**Recommended Action:** Log error details and show log path

**Retryable:** No

---

## Usage Examples

### Basic Error Classification

```javascript
const { R2Client } = require('./infrastructure/R2Client');

const client = new R2Client(config);

try {
  await client.listObjects();
} catch (error) {
  // Error is automatically classified
  console.log('Error Type:', error.errorType);
  console.log('Operation:', error.operation);
  console.log('Original Error:', error.originalError);
}
```

### Getting User-Friendly Messages

```javascript
const { ErrorHandler } = require('./infrastructure/ErrorHandler');

try {
  await client.uploadObject(key, filePath);
} catch (error) {
  // Get user-friendly message
  const message = ErrorHandler.getUserMessage(error);
  console.log(message); // "网络连接失败，请检查网络设置"
  
  // Get operation-specific message
  const opMessage = ErrorHandler.getOperationMessage(error, 'upload');
  console.log(opMessage); // "文件上传失败: 网络连接失败，请检查网络设置"
}
```

### Error Recovery Logic

```javascript
try {
  await client.downloadObject(key, savePath);
} catch (error) {
  // Check if error is retryable
  if (ErrorHandler.isRetryable(error)) {
    // Show retry button
    showRetryButton();
  }
  
  // Check if list should be refreshed
  if (ErrorHandler.shouldRefreshList(error)) {
    // Automatically refresh object list
    await refreshObjectList();
  }
  
  // Check if auth error
  if (ErrorHandler.isAuthError(error)) {
    // Guide user to check credentials
    showCredentialHelp();
  }
}
```

### Error Logging

```javascript
const { ErrorHandler } = require('./infrastructure/ErrorHandler');
const fs = require('fs');

try {
  await client.deleteObject(key);
} catch (error) {
  // Format error for logging
  const logEntry = ErrorHandler.formatForLog(error, 'User deleted file: ' + key);
  
  // Write to log file
  fs.appendFileSync(logPath, logEntry + '\n');
  
  // Show user-friendly message
  const message = ErrorHandler.getOperationMessage(error, 'delete');
  showErrorDialog(message);
}
```

## Error Classification Priority

The `_classifyError` method checks errors in the following priority order:

1. **File System Errors** (ENOENT, EACCES, ENOSPC)
2. **Network Errors** (ENOTFOUND, ECONNREFUSED, ETIMEDOUT, etc.)
3. **Authentication Errors** (InvalidAccessKeyId, SignatureDoesNotMatch, etc.)
4. **Permission Errors** (AccessDenied, 403 status)
5. **Bucket Errors** (NoSuchBucket, BucketNotFound)
6. **Object Errors** (NoSuchKey, NotFound, 404 status)
7. **Unknown Errors** (fallback)

This priority ensures that more specific errors are caught before generic ones.

## Testing

### Running Error Classification Tests

```bash
node src/main/infrastructure/R2Client.test.js
```

This tests:
- All error type classifications
- Error wrapping in all R2Client methods

### Running ErrorHandler Tests

```bash
node src/main/infrastructure/ErrorHandler.test.js
```

This tests:
- User message generation
- Operation-specific messages
- Helper methods (isRetryable, isAuthError, shouldRefreshList)
- Log formatting

## Integration with UI

### Main Process (IPC Handlers)

```javascript
const { ErrorHandler } = require('./infrastructure/ErrorHandler');

ipcMain.handle('storage:upload', async (event, filePath) => {
  try {
    await storageService.uploadFile(filePath);
    return { success: true };
  } catch (error) {
    const message = ErrorHandler.getOperationMessage(error, 'upload');
    return { success: false, error: message };
  }
});
```

### Renderer Process (UI)

```javascript
async function uploadFile(filePath) {
  try {
    const result = await ipcRenderer.invoke('storage:upload', filePath);
    
    if (result.success) {
      showSuccessMessage(UI_TEXT.uploadSuccess);
    } else {
      showErrorDialog(result.error);
    }
  } catch (error) {
    showErrorDialog(UI_TEXT.errorUnknown);
  }
}
```

## Best Practices

1. **Always classify errors** - Use R2Client methods which automatically classify errors
2. **Use ErrorHandler for messages** - Don't create error messages manually
3. **Log unknown errors** - Always log full details for unknown errors
4. **Provide retry for network errors** - Network errors are temporary and retryable
5. **Auto-refresh on object errors** - Object not found means list is stale
6. **Guide users on auth errors** - Provide clear instructions for credential setup
7. **Test error scenarios** - Test all error types in manual testing

## Future Enhancements

1. **Error Analytics** - Track error frequency and types
2. **Automatic Retry** - Implement exponential backoff for network errors
3. **Offline Mode** - Detect offline state and queue operations
4. **Error Recovery UI** - Dedicated error recovery dialog with actions
5. **Localization** - Support multiple languages (currently Simplified Chinese only)

## Related Files

- `src/main/infrastructure/R2Client.js` - Error classification
- `src/main/infrastructure/ErrorHandler.js` - Error message generation
- `src/main/infrastructure/R2Client.test.js` - Classification tests
- `src/main/infrastructure/ErrorHandler.test.js` - Handler tests
- `i18n/zh-CN.js` - Simplified Chinese error messages
- `src/main/application/ErrorLogger.js` - Error logging (to be implemented)

## Requirements Coverage

This error handling implementation satisfies the following requirements:

- **Requirement 8.1** - Network error handling
- **Requirement 8.2** - Authentication error handling
- **Requirement 8.3** - Bucket error handling
- **Requirement 8.4** - Object error handling
- **Requirement 8.5** - Permission error handling
- **Requirement 8.6** - Unknown error handling with logging

All error messages are in Simplified Chinese as per the design specification.
