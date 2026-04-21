/**
 * 预览窗口渲染进程脚本
 * 负责显示图片、文本和信息预览
 */

// Electron IPC
const { ipcRenderer } = require('electron');

// 获取 UI 文本
const UI_TEXT = window.UI_TEXT || {};

// DOM 元素引用
const elements = {
  previewTitle: document.getElementById('preview-title'),
  btnClose: document.getElementById('btn-close'),
  loadingIndicator: document.getElementById('loading-indicator'),
  loadingText: document.getElementById('loading-text'),
  errorDisplay: document.getElementById('error-display'),
  errorMessage: document.getElementById('error-message'),
  imageViewer: document.getElementById('image-viewer'),
  previewImage: document.getElementById('preview-image'),
  zoomControls: document.getElementById('zoom-controls'),
  btnZoomOut: document.getElementById('btn-zoom-out'),
  btnZoomIn: document.getElementById('btn-zoom-in'),
  btnZoomReset: document.getElementById('btn-zoom-reset'),
  zoomLevel: document.getElementById('zoom-level'),
  textViewer: document.getElementById('text-viewer'),
  previewText: document.getElementById('preview-text'),
  infoViewer: document.getElementById('info-viewer'),
  infoFilename: document.getElementById('info-filename'),
  infoSize: document.getElementById('info-size'),
  infoType: document.getElementById('info-type'),
  infoModified: document.getElementById('info-modified')
};

// 预览状态
const state = {
  previewData: null,
  currentZoom: 100
};

/**
 * 初始化预览窗口
 */
function init() {
  console.log('预览窗口初始化...');
  
  // 应用 i18n 文本
  applyI18nText();
  
  // 绑定关闭按钮事件
  elements.btnClose.addEventListener('click', handleClose);
  
  // 绑定缩放控制事件
  elements.btnZoomOut.addEventListener('click', () => handleZoom(-10));
  elements.btnZoomIn.addEventListener('click', () => handleZoom(10));
  elements.btnZoomReset.addEventListener('click', handleZoomReset);
  
  // 监听预览数据
  ipcRenderer.on('preview:data', handlePreviewData);
  
  // 通知主进程预览窗口已准备好
  ipcRenderer.send('preview:ready');
}

/**
 * 应用 i18n 文本到 DOM 元素
 */
function applyI18nText() {
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const key = element.getAttribute('data-i18n');
    if (UI_TEXT[key]) {
      element.textContent = UI_TEXT[key];
    }
  });
}

/**
 * 处理预览数据
 */
function handlePreviewData(event, data) {
  console.log('收到预览数据:', data);
  
  state.previewData = data;
  
  // 更新窗口标题
  const titleTemplate = UI_TEXT.previewWindowTitle || '预览 - {filename}';
  const filename = data.key || data.metadata?.filename || '未知文件';
  elements.previewTitle.textContent = titleTemplate.replace('{filename}', filename);
  
  // 如果是加载状态，显示加载中
  if (data.loading) {
    showLoading(UI_TEXT.previewLoadingImage || '正在加载...');
    return;
  }
  
  // 根据预览类型显示不同的查看器
  switch (data.type) {
    case 'image':
      showImagePreview(data);
      break;
    case 'text':
      showTextPreview(data);
      break;
    case 'info':
    default:
      showInfoPreview(data);
      break;
  }
}

/**
 * 显示图片预览
 */
function showImagePreview(data) {
  hideAllViewers();
  showLoading(UI_TEXT.previewLoadingImage || '正在加载图片...');
  
  try {
    // 处理图片内容
    if (data.content) {
      let base64Content;
      
      // 如果是 Buffer 对象（在渲染进程中可能是 Uint8Array）
      if (data.content instanceof Uint8Array || Buffer.isBuffer(data.content)) {
        // 将 Buffer 转换为 base64
        const buffer = data.content instanceof Uint8Array 
          ? Buffer.from(data.content) 
          : data.content;
        base64Content = buffer.toString('base64');
      } else if (typeof data.content === 'string') {
        // 如果已经是字符串，假设是 base64 编码
        base64Content = data.content;
      } else {
        throw new Error('无法识别的图片内容格式');
      }
      
      // 获取 MIME 类型
      const contentType = data.metadata?.contentType || getMimeType(data.key);
      
      // 创建 data URL
      const dataUrl = `data:${contentType};base64,${base64Content}`;
      loadImage(dataUrl);
    } else if (data.url) {
      // 如果有 URL，直接使用
      loadImage(data.url);
    } else {
      showError(UI_TEXT.previewError || '无法预览文件');
    }
  } catch (error) {
    console.error('图片预览失败:', error);
    showError(UI_TEXT.previewError || '无法预览文件');
  }
}

/**
 * 加载图片
 */
function loadImage(url) {
  const img = elements.previewImage;
  
  img.onload = () => {
    hideLoading();
    elements.imageViewer.style.display = 'flex';
    resetZoom();
  };
  
  img.onerror = () => {
    showError(UI_TEXT.previewError || '无法预览文件');
  };
  
  img.src = url;
}

/**
 * 显示文本预览
 */
function showTextPreview(data) {
  hideAllViewers();
  showLoading(UI_TEXT.previewLoadingText || '正在加载文本...');
  
  try {
    let textContent = '';
    
    if (typeof data.content === 'string') {
      textContent = data.content;
    } else if (data.content instanceof Uint8Array || Buffer.isBuffer(data.content)) {
      // 将 Buffer 转换为字符串
      const buffer = data.content instanceof Uint8Array 
        ? Buffer.from(data.content) 
        : data.content;
      textContent = buffer.toString('utf-8');
    } else if (data.content) {
      // 尝试转换为字符串
      textContent = String(data.content);
    }
    
    // 限制文本长度，防止渲染过慢
    const maxLength = 1000000; // 1MB 文本
    if (textContent.length > maxLength) {
      textContent = textContent.substring(0, maxLength) + '\n\n... (文本过长，已截断)';
    }
    
    elements.previewText.textContent = textContent;
    hideLoading();
    elements.textViewer.style.display = 'flex';
  } catch (error) {
    console.error('文本预览失败:', error);
    showError(UI_TEXT.previewError || '无法预览文件');
  }
}

/**
 * 显示信息预览
 */
function showInfoPreview(data) {
  hideAllViewers();
  
  // 填充信息
  const filename = data.key || '-';
  const size = data.metadata?.contentLength || data.size || 0;
  const contentType = data.metadata?.contentType || getMimeType(data.key);
  const lastModified = data.metadata?.lastModified || data.lastModified;
  
  elements.infoFilename.textContent = filename;
  elements.infoSize.textContent = formatFileSize(size);
  elements.infoType.textContent = contentType;
  elements.infoModified.textContent = formatDate(lastModified);
  
  elements.infoViewer.style.display = 'flex';
}

/**
 * 隐藏所有查看器
 */
function hideAllViewers() {
  elements.imageViewer.style.display = 'none';
  elements.textViewer.style.display = 'none';
  elements.infoViewer.style.display = 'none';
  elements.errorDisplay.style.display = 'none';
}

/**
 * 显示加载指示器
 */
function showLoading(text) {
  elements.loadingText.textContent = text || UI_TEXT.previewLoadingImage || '正在加载...';
  elements.loadingIndicator.style.display = 'block';
}

/**
 * 隐藏加载指示器
 */
function hideLoading() {
  elements.loadingIndicator.style.display = 'none';
}

/**
 * 显示错误
 */
function showError(message) {
  hideLoading();
  hideAllViewers();
  elements.errorMessage.textContent = message || UI_TEXT.previewError || '无法预览文件';
  elements.errorDisplay.style.display = 'block';
}

/**
 * 处理缩放
 */
function handleZoom(delta) {
  const newZoom = Math.max(10, Math.min(500, state.currentZoom + delta));
  state.currentZoom = newZoom;
  
  elements.previewImage.style.transform = `scale(${newZoom / 100})`;
  elements.zoomLevel.textContent = `${newZoom}%`;
}

/**
 * 重置缩放
 */
function handleZoomReset() {
  resetZoom();
}

/**
 * 重置缩放到 100%
 */
function resetZoom() {
  state.currentZoom = 100;
  elements.previewImage.style.transform = 'scale(1)';
  elements.zoomLevel.textContent = '100%';
}

/**
 * 处理关闭按钮点击
 */
function handleClose() {
  window.close();
}

/**
 * 格式化文件大小
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + units[i];
}

/**
 * 格式化日期
 */
function formatDate(date) {
  if (!date) return '-';
  
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hour = String(d.getHours()).padStart(2, '0');
  const minute = String(d.getMinutes()).padStart(2, '0');
  
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

/**
 * 获取 MIME 类型
 */
function getMimeType(filename) {
  if (!filename) return '未知';
  
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  
  const mimeTypes = {
    // 图片
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
    'bmp': 'image/bmp',
    'ico': 'image/x-icon',
    // 视频
    'mp4': 'video/mp4',
    'avi': 'video/x-msvideo',
    'mov': 'video/quicktime',
    'wmv': 'video/x-ms-wmv',
    'flv': 'video/x-flv',
    'mkv': 'video/x-matroska',
    'webm': 'video/webm',
    // 音频
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'ogg': 'audio/ogg',
    'flac': 'audio/flac',
    'aac': 'audio/aac',
    // 文档
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'ppt': 'application/vnd.ms-powerpoint',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // 文本
    'txt': 'text/plain',
    'md': 'text/markdown',
    'json': 'application/json',
    'xml': 'application/xml',
    'html': 'text/html',
    'css': 'text/css',
    'js': 'application/javascript',
    'ts': 'application/typescript',
    'yaml': 'application/x-yaml',
    'yml': 'application/x-yaml',
    // 压缩包
    'zip': 'application/zip',
    'rar': 'application/x-rar-compressed',
    '7z': 'application/x-7z-compressed',
    'tar': 'application/x-tar',
    'gz': 'application/gzip'
  };
  
  return mimeTypes[ext] || '未知类型';
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', init);
