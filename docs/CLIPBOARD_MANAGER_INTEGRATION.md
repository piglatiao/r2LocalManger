# ClipboardManager Integration Guide

## Overview

The ClipboardManager is a completed infrastructure component that wraps the Electron clipboard API. This document shows how it will be integrated with other components.

## Implementation Status

✅ **Task 2.4 Complete**: ClipboardManager implementation
- Wrapper for Electron clipboard API
- writeText() method with validation
- Success/failure feedback (boolean return)
- Additional methods: readText(), clear()

## Integration Points

### 1. StorageService Integration (Task 3.3)

The ClipboardManager will be used by StorageService to copy formatted URLs:

```javascript
// In StorageService.js
const { ClipboardManager } = require('../infrastructure/ClipboardManager');
const { URLFormatter } = require('./URLFormatter');

class StorageService {
  async copyFileUrl(key, format) {
    try {
      // Get object URL
      const baseUrl = await this.r2Client.getObjectUrl(key);
      
      // Format URL according to requested format
      const formattedUrl = URLFormatter.formatUrl(baseUrl, key, format);
      
      // Copy to clipboard
      const success = ClipboardManager.writeText(formattedUrl);
      
      if (!success) {
        throw new Error('Failed to copy to clipboard');
      }
      
      return { success: true, url: formattedUrl };
    } catch (error) {
      throw error;
    }
  }
}
```

### 2. IPC Handler Integration (Task 4.2)

The main process will handle copy-url requests from the renderer:

```javascript
// In main.js
const { ClipboardManager } = require('./infrastructure/ClipboardManager');

// Register IPC handler for copy URL
ipcMain.handle('storage:copy-url', async (event, key, format) => {
  try {
    const result = await storageService.copyFileUrl(key, format);
    return { success: true, message: UI_TEXT.copySuccess };
  } catch (error) {
    ErrorLogger.logError(error, 'copy-url');
    return { 
      success: false, 
      message: UI_TEXT.errorUnknown,
      error: error.message 
    };
  }
});
```

### 3. Renderer Process Integration (Task 5.5)

The renderer will call the IPC handler when user clicks copy URL:

```javascript
// In renderer.js
async function copyUrl(key, format) {
  try {
    const result = await ipcRenderer.invoke('storage:copy-url', key, format);
    
    if (result.success) {
      showNotification(result.message); // "链接已复制到剪贴板"
    } else {
      showError(result.message);
    }
  } catch (error) {
    showError('复制失败');
  }
}

// Context menu handlers
document.getElementById('copy-url').addEventListener('click', () => {
  const selectedKey = getSelectedObjectKey();
  copyUrl(selectedKey, 'url');
});

document.getElementById('copy-html').addEventListener('click', () => {
  const selectedKey = getSelectedObjectKey();
  copyUrl(selectedKey, 'html');
});

document.getElementById('copy-markdown').addEventListener('click', () => {
  const selectedKey = getSelectedObjectKey();
  copyUrl(selectedKey, 'markdown');
});
```

## Usage Examples

### Example 1: Copy Plain URL
```javascript
const success = ClipboardManager.writeText('https://example.com/image.jpg');
if (success) {
  console.log('URL copied to clipboard');
}
```

### Example 2: Copy HTML Format
```javascript
const html = '<img src="https://example.com/image.jpg" alt="image" />';
const success = ClipboardManager.writeText(html);
if (success) {
  console.log('HTML copied to clipboard');
}
```

### Example 3: Copy Markdown Format
```javascript
const markdown = '![image](https://example.com/image.jpg)';
const success = ClipboardManager.writeText(markdown);
if (success) {
  console.log('Markdown copied to clipboard');
}
```

### Example 4: Error Handling
```javascript
const success = ClipboardManager.writeText(null);
if (!success) {
  console.error('Failed to copy to clipboard');
  // Show error notification to user
}
```

## API Reference

### ClipboardManager.writeText(text)

Writes text to the system clipboard.

**Parameters:**
- `text` (string): Text to write to clipboard (must be non-empty string)

**Returns:**
- `boolean`: `true` if successful, `false` if failed

**Example:**
```javascript
const success = ClipboardManager.writeText('Hello, World!');
```

### ClipboardManager.readText()

Reads text from the system clipboard.

**Returns:**
- `string`: Text from clipboard, or empty string if failed

**Example:**
```javascript
const text = ClipboardManager.readText();
console.log('Clipboard content:', text);
```

### ClipboardManager.clear()

Clears the system clipboard.

**Returns:**
- `boolean`: `true` if successful, `false` if failed

**Example:**
```javascript
const success = ClipboardManager.clear();
```

## Testing

The ClipboardManager can only be tested within an Electron application context. To test:

1. Start the application: `npm run dev`
2. Select an object in the list
3. Right-click and select "复制链接" (Copy URL)
4. Paste into a text editor to verify the URL was copied
5. Try different formats: URL, HTML, Markdown

## Error Handling

The ClipboardManager handles errors gracefully:

- **Invalid input**: Returns `false` and logs error
- **Clipboard unavailable**: Returns `false` and logs error
- **Electron not available**: Returns `false` and logs error

All errors are logged to the console for debugging purposes.

## Requirements Mapping

This implementation satisfies:

- **Requirement 7.5**: Copy formatted URL to system clipboard
- **Requirement 7.6**: Display success notification after copy
- **Task 2.4**: Implement ClipboardManager with writeText() and feedback

## Next Steps

To complete the copy URL functionality:

1. ✅ Task 2.4: Implement ClipboardManager (COMPLETE)
2. ⏳ Task 3.2: Implement URLFormatter
3. ⏳ Task 3.3: Implement StorageService.copyFileUrl()
4. ⏳ Task 4.2: Register IPC handler for 'storage:copy-url'
5. ⏳ Task 5.5: Implement copy URL menu in renderer

## Conclusion

The ClipboardManager is fully implemented and ready for integration. It provides a clean, simple API with proper error handling and feedback mechanisms.
