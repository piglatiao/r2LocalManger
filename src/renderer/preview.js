const { ipcRenderer } = require('electron');

var UI_TEXT = window.UI_TEXT || {};

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
  videoViewer: document.getElementById('video-viewer'),
  previewVideo: document.getElementById('preview-video'),
  pdfViewer: document.getElementById('pdf-viewer'),
  previewPdf: document.getElementById('preview-pdf'),
  textViewer: document.getElementById('text-viewer'),
  previewText: document.getElementById('preview-text'),
  infoViewer: document.getElementById('info-viewer'),
  infoFilename: document.getElementById('info-filename'),
  infoSize: document.getElementById('info-size'),
  infoType: document.getElementById('info-type'),
  infoModified: document.getElementById('info-modified')
};

const state = {
  previewData: null,
  currentZoom: 100,
  objectUrl: null
};

function init() {
  applyI18nText();

  elements.btnClose.addEventListener('click', handleClose);
  elements.btnZoomOut.addEventListener('click', () => handleZoom(-10));
  elements.btnZoomIn.addEventListener('click', () => handleZoom(10));
  elements.btnZoomReset.addEventListener('click', handleZoomReset);
  elements.previewImage.addEventListener('click', handlePreviewImageClick);
  elements.previewImage.addEventListener('wheel', handlePreviewWheel, { passive: false });

  ipcRenderer.on('preview:data', handlePreviewData);
  ipcRenderer.on('preview:error', handlePreviewError);
  window.addEventListener('beforeunload', cleanupObjectUrl);

  ipcRenderer.send('preview:ready');
}

function applyI18nText() {
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const key = element.getAttribute('data-i18n');
    if (UI_TEXT[key]) {
      element.textContent = UI_TEXT[key];
    }
  });
}

function handlePreviewData(event, data) {
  state.previewData = data;

  const titleTemplate = UI_TEXT.previewWindowTitle || '预览 - {filename}';
  const filename = data.key || data.metadata?.filename || '未知文件';
  elements.previewTitle.textContent = titleTemplate.replace('{filename}', filename);

  if (data.loading) {
    showLoading(UI_TEXT.previewLoadingImage || '正在加载...');
    return;
  }

  switch (data.type) {
    case 'image':
      showImagePreview(data);
      break;
    case 'video':
      showVideoPreview(data);
      break;
    case 'pdf':
      showPdfPreview(data);
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

function handlePreviewError(event, error) {
  showError(error?.userMessage || error?.message || UI_TEXT.previewError || '无法预览文件');
}

function showImagePreview(data) {
  hideAllViewers();
  showLoading(UI_TEXT.previewLoadingImage || '正在加载图片...');

  try {
    const url = resolveMediaUrl(data, data.metadata?.contentType || getMimeType(data.key));
    if (!url) {
      throw new Error('Image content is empty');
    }
    loadImage(url);
  } catch (error) {
    console.error('Image preview failed:', error);
    showError(UI_TEXT.previewError || '无法预览文件');
  }
}

function showVideoPreview(data) {
  hideAllViewers();
  showLoading(UI_TEXT.previewLoadingImage || '正在加载...');

  try {
    const url = resolveMediaUrl(data, data.metadata?.contentType || getMimeType(data.key));
    if (!url) {
      throw new Error('Video content is empty');
    }
    loadVideo(url);
  } catch (error) {
    console.error('Video preview failed:', error);
    showError(UI_TEXT.previewError || '无法预览文件');
  }
}

function showPdfPreview(data) {
  hideAllViewers();
  showLoading(UI_TEXT.previewLoadingImage || '正在加载...');

  try {
    const url = resolveMediaUrl(data, data.metadata?.contentType || 'application/pdf');
    if (!url) {
      throw new Error('PDF content is empty');
    }
    loadPdf(url);
  } catch (error) {
    console.error('PDF preview failed:', error);
    showError(UI_TEXT.previewError || '无法预览文件');
  }
}

function showTextPreview(data) {
  hideAllViewers();
  showLoading(UI_TEXT.previewLoadingText || '正在加载文本...');

  try {
    let textContent = '';

    if (typeof data.content === 'string') {
      textContent = data.content;
    } else {
      const buffer = normalizeBinaryContent(data.content);
      if (buffer) {
        textContent = buffer.toString('utf-8');
      } else if (data.content) {
        textContent = String(data.content);
      }
    }

    const maxLength = 1000000;
    if (textContent.length > maxLength) {
      textContent = `${textContent.substring(0, maxLength)}\n\n... (文本过长，已截断)`;
    }

    elements.previewText.textContent = textContent;
    hideLoading();
    elements.textViewer.style.display = 'flex';
  } catch (error) {
    console.error('Text preview failed:', error);
    showError(UI_TEXT.previewError || '无法预览文件');
  }
}

function showInfoPreview(data) {
  hideAllViewers();
  hideLoading();

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

function loadVideo(url) {
  const video = elements.previewVideo;
  let settled = false;

  const finish = () => {
    if (settled) {
      return;
    }
    settled = true;
    hideLoading();
    elements.videoViewer.style.display = 'flex';
  };

  video.onloadedmetadata = finish;
  video.oncanplay = finish;
  video.onerror = () => {
    showError(UI_TEXT.previewError || '无法预览文件');
  };

  video.src = url;
  video.load();
  setTimeout(finish, 800);
}

function loadPdf(url) {
  const frame = elements.previewPdf;
  let settled = false;

  const finish = () => {
    if (settled) {
      return;
    }
    settled = true;
    hideLoading();
    elements.pdfViewer.style.display = 'flex';
  };

  frame.onload = finish;
  frame.onerror = () => {
    showError(UI_TEXT.previewError || '无法预览文件');
  };

  elements.pdfViewer.style.display = 'flex';
  frame.src = url;
  setTimeout(finish, 800);
}

function resolveMediaUrl(data, mimeType) {
  if (data.url) {
    return data.url;
  }

  if (typeof data.content === 'string') {
    return `data:${mimeType};base64,${data.content}`;
  }

  if (!data.content) {
    return null;
  }

  return createObjectUrl(data.content, mimeType);
}

function createObjectUrl(content, mimeType) {
  cleanupObjectUrl();

  const buffer = normalizeBinaryContent(content);
  if (!buffer) {
    return null;
  }

  const blob = new Blob([buffer], { type: mimeType || 'application/octet-stream' });
  state.objectUrl = URL.createObjectURL(blob);
  return state.objectUrl;
}

function normalizeBinaryContent(content) {
  if (!content) {
    return null;
  }

  if (Buffer.isBuffer(content)) {
    return content;
  }

  if (content instanceof Uint8Array) {
    return Buffer.from(content);
  }

  if (content instanceof ArrayBuffer) {
    return Buffer.from(content);
  }

  if (content.type === 'Buffer' && Array.isArray(content.data)) {
    return Buffer.from(content.data);
  }

  return null;
}

function cleanupObjectUrl() {
  if (state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = null;
  }
}

function hideAllViewers() {
  cleanupObjectUrl();

  elements.imageViewer.style.display = 'none';
  elements.videoViewer.style.display = 'none';
  elements.pdfViewer.style.display = 'none';
  elements.textViewer.style.display = 'none';
  elements.infoViewer.style.display = 'none';
  elements.errorDisplay.style.display = 'none';

  elements.previewImage.removeAttribute('src');

  elements.previewVideo.pause();
  elements.previewVideo.removeAttribute('src');
  elements.previewVideo.load();

  elements.previewPdf.removeAttribute('src');
}

function showLoading(text) {
  elements.loadingText.textContent = text || UI_TEXT.previewLoadingImage || '正在加载...';
  elements.loadingIndicator.style.display = 'block';
}

function hideLoading() {
  elements.loadingIndicator.style.display = 'none';
}

function showError(message) {
  hideLoading();
  hideAllViewers();
  elements.errorMessage.textContent = message || UI_TEXT.previewError || '无法预览文件';
  elements.errorDisplay.style.display = 'block';
}

function handleZoom(delta) {
  const newZoom = Math.max(10, Math.min(500, state.currentZoom + delta));
  state.currentZoom = newZoom;

  elements.previewImage.style.transform = `scale(${newZoom / 100})`;
  elements.zoomLevel.textContent = `${newZoom}%`;
}

/**
 * 点击预览图片时递增缩放，达到上限后回到初始比例。
 */
function handlePreviewImageClick() {
  if (state.currentZoom >= 500) {
    resetZoom();
    return;
  }

  handleZoom(25);
}

/**
 * 在预览图片上按住 Ctrl 滚轮调整缩放比例。
 * @param {WheelEvent} event - 滚轮事件
 */
function handlePreviewWheel(event) {
  if (!event.ctrlKey) {
    return;
  }

  event.preventDefault();
  handleZoom(event.deltaY < 0 ? 10 : -10);
}

function handleZoomReset() {
  resetZoom();
}

function resetZoom() {
  state.currentZoom = 100;
  elements.previewImage.style.transform = 'scale(1)';
  elements.zoomLevel.textContent = '100%';
}

function handleClose() {
  window.close();
}

function formatFileSize(bytes) {
  if (!bytes) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + units[i];
}

function formatDate(date) {
  if (!date) {
    return '-';
  }

  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hour = String(d.getHours()).padStart(2, '0');
  const minute = String(d.getMinutes()).padStart(2, '0');

  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function getMimeType(filename) {
  if (!filename) {
    return 'application/octet-stream';
  }

  const ext = filename.split('.').pop()?.toLowerCase() || '';

  const mimeTypes = {
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

  return mimeTypes[ext] || 'application/octet-stream';
}

document.addEventListener('DOMContentLoaded', init);
