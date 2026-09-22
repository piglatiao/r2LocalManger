/**
 * R2 Storage Manager - Simplified Chinese (简体中文) UI Text Strings
 * 
 * This file contains all user-facing text strings for the application.
 * Import and use the UI_TEXT object throughout the application for consistent localization.
 */

// 使用 var 声明以避免与 renderer.js 中的引用冲突
var UI_TEXT = {
  // ==================== Window Titles ====================
  mainWindowTitle: 'R2 存储管理器',
  previewWindowTitle: '预览 - {filename}',
  
  // ==================== Toolbar Buttons ====================
  uploadButton: '上传',
  downloadButton: '下载',
  previewButton: '预览',
  deleteButton: '删除',
  refreshButton: '刷新',
  
  // ==================== Table Column Headers ====================
  columnIcon: '预览',
  columnName: '文件名',
  columnSize: '大小',
  columnModified: '修改时间',
  
  // ==================== Context Menu Items ====================
  menuUpload: '上传',
  menuDownload: '下载',
  menuPreview: '预览',
  menuDelete: '删除',
  menuCopyUrl: '复制链接',
  menuCopyHtml: '复制 HTML',
  menuCopyMarkdown: '复制 Markdown',
  
  // ==================== Status Bar ====================
  statusReady: '就绪',
  statusLoading: '正在加载...',
  statusUploading: '正在上传...',
  statusDownloading: '正在下载...',
  objectCount: '共 {count} 个对象',
  
  // ==================== Dialog Titles and Messages ====================
  dialogSelectFile: '选择要上传的文件',
  dialogSaveFile: '保存文件',
  dialogConfirmDelete: '确定要删除 \'{filename}\' 吗？此操作无法撤销。',
  dialogButtonOk: '确定',
  dialogButtonCancel: '取消',
  dialogButtonRetry: '重试',
  
  // ==================== Success Messages ====================
  uploadSuccess: '文件上传成功',
  downloadSuccess: '文件下载成功',
  deleteSuccess: '文件删除成功',
  copySuccess: '链接已复制到剪贴板',
  refreshSuccess: '列表已刷新',
  
  // ==================== Error Messages ====================
  errorNetwork: '网络连接失败，请检查网络设置',
  errorAuth: '认证失败，请检查 API 凭证配置',
  errorAuthDetail: '请先在“设置 > 凭证配置”中填写 R2 凭证，并在“存储桶设置”中确认连接参数',
  errorBucket: '存储桶不存在或无法访问',
  errorObject: '对象不存在，可能已被删除',
  errorPermission: '权限不足，无法执行此操作',
  errorFileNotFound: '文件或目录不存在',
  errorFileAccess: '没有访问权限',
  errorDiskSpace: '磁盘空间不足',
  errorUnknown: '发生未知错误，请查看日志文件获取详细信息',
  errorLogPath: '日志位置: {path}',
  errorUploadFailed: '文件上传失败: {error}',
  errorDownloadFailed: '文件下载失败: {error}',
  errorDeleteFailed: '文件删除失败: {error}',
  errorPreviewFailed: '无法预览文件: {error}',

  // Startup check
  startupCheckMessageMissingCredentials: '启动检查发现未配置凭证，请先完成配置。',
  startupCheckMessageInvalidSettings: '启动检查发现 R2 配置无效，请检查 S3 地址、区域、桶名等设置。',
  startupCheckMessageConnectionFailed: '启动检查失败：无法连接到 R2，请检查连接或配置。',
  startupCheckDetail: '可点击“检查配置”打开设置页面。',
  startupCheckButtonOpenSettings: '检查配置',
  startupCheckButtonLater: '稍后',
  
  // ==================== Progress Messages ====================
  progressUploading: '正在上传 {filename}... {percent}% ({uploaded}/{total})',
  progressDownloading: '正在下载 {filename}... {percent}% ({downloaded}/{total})',
  progressDeleting: '正在删除 {filename}...',
  progressLoadingList: '正在加载对象列表...',
  progressSpeed: '{speed}/s',
  progressEta: '预计剩余: {time}',
  progressSeconds: '{seconds}秒',
  progressMinutes: '{minutes}分{seconds}秒',
  progressHours: '{hours}小时{minutes}分',
  
  // ==================== Preview Window ====================
  previewLoadingImage: '正在加载图片...',
  previewLoadingText: '正在加载文本...',
  previewFileTooLarge: '文件过大 ({size})，预览可能较慢。是否继续？',
  previewNotSupported: '不支持预览此文件类型，请下载后查看',
  previewError: '无法预览文件',
  
  // Preview Window Labels
  previewLabelFilename: '文件名:',
  previewLabelSize: '大小:',
  previewLabelType: '类型:',
  previewLabelModified: '最后修改:',
  previewButtonClose: '关闭',
  
  // ==================== Tooltips ====================
  tooltipUpload: '上传文件 (Ctrl+U)',
  tooltipDownload: '下载选中文件 (Ctrl+D)',
  tooltipPreview: '预览选中文件 (Enter)',
  tooltipDelete: '删除选中文件 (Delete)',
  tooltipRefresh: '刷新列表 (Ctrl+R)',
  tooltipSearch: '搜索文件 (Ctrl+F, Esc 清除)',
  tooltipClearSearch: '清除搜索',
  tooltipFilterType: '按文件类型筛选 (Esc 清除)',
  
  // ==================== Installer Messages ====================
  installerWelcome: '欢迎安装 R2 存储管理器',
  installerLicense: '请阅读并接受许可协议',
  installerLocation: '选择安装位置',
  installerProgress: '正在安装...',
  installerComplete: '安装完成',
  installerButtonNext: '下一步',
  installerButtonBack: '上一步',
  installerButtonInstall: '安装',
  installerButtonFinish: '完成',
  installerButtonCancel: '取消',
  
  // ==================== Future Enhancement Strings ====================
  // Multi-bucket support
  labelBucket: '存储桶:',
  buttonSwitchBucket: '切换存储桶',
  
  // Credential management UI
  menuSettings: '设置',
  menuCredentials: '凭证配置',
  labelAccessKeyId: 'Access Key ID:',
  labelSecretAccessKey: 'Secret Access Key:',
  buttonSave: '保存',
  
  // Batch operations
  buttonBatchUpload: '批量上传',
  buttonBatchDownload: '批量下载',
  buttonBatchDelete: '批量删除',
  messageSelectedCount: '已选择 {count} 个对象',
  tooltipSelectAll: '全选 (Ctrl+A)',
  
  // Search and filter
  placeholderSearch: '搜索文件...',
  labelFileType: '文件类型:',
  labelSizeRange: '大小范围:',
  labelModifiedDate: '修改日期:',
  noResultsFound: '未找到匹配 "{term}" 的文件',
  noResultsHint: '请尝试其他搜索词',
  
  // File type filter options
  filterAllTypes: '全部类型',
  filterImages: '图片',
  filterVideos: '视频',
  filterAudio: '音频',
  filterDocuments: '文档',
  filterArchives: '压缩包',
  filterCode: '代码',
  filterText: '文本',
  
  // Filter status
  filteredCount: '筛选出 {count} 个对象',
  filterActive: '已启用筛选',
  
  // Date range filter
  labelDateRange: '日期范围:',
  labelStartDate: '开始日期',
  labelEndDate: '结束日期',
  tooltipDateRange: '按修改日期筛选 (Esc 清除)',
  tooltipClearDateRange: '清除日期筛选',
  dateRangeInvalid: '开始日期不能晚于结束日期',
  
  // Folder support
  buttonNewFolder: '新建文件夹',
  buttonRename: '重命名',
  breadcrumbRoot: '根目录',
  folderNavigationLabel: '目录导航',
  folderUp: '返回上级文件夹',
  folderOpen: '打开文件夹',
  folderLabel: '文件夹',
  viewList: '列表视图',
  viewGrid: '网格视图',
  statusOpeningFolder: '正在打开文件夹...',
  
  // Drag and drop
  messageDragDrop: '拖放文件到此处上传',
  messageNoValidFiles: '没有有效的文件可上传（可能拖放的是文件夹）',
  messageNoFilesDetected: '没有检测到可上传的文件',
  
  // Multiple file upload
  uploadMultipleProgress: '正在上传 {current}/{total}...',
  uploadMultipleFileProgress: '正在上传 {filename} ({current}/{total})...',
  uploadMultipleSuccess: '成功上传 {count} 个文件',
  uploadMultiplePartialSuccess: '成功上传 {success} 个文件，{failed} 个失败',
  uploadMultipleAllFailed: '所有文件上传失败',
  
  // Batch delete
  dialogConfirmBatchDelete: '确定要删除 {count} 个对象吗？此操作无法撤销。',
  progressBatchDeleting: '正在删除 {current}/{total}...',
  batchDeleteSuccess: '成功删除 {count} 个对象',
  batchDeletePartialSuccess: '成功删除 {success} 个对象，{failed} 个失败',
  batchDeleteAllFailed: '所有对象删除失败',
  
  // Batch download
  dialogSelectFolder: '选择保存文件夹',
  progressBatchDownloading: '正在下载文件...',
  progressBatchDownloadingFile: '正在下载 {filename} ({current}/{total})...',
  progressBatchInfo: '正在处理 {current}/{total} 个文件',
  batchDownloadSuccess: '成功下载 {count} 个文件',
  batchDownloadPartialSuccess: '成功下载 {success} 个文件，{failed} 个失败',
  batchDownloadAllFailed: '所有文件下载失败',
  
  // Operation cancellation
  operationCancelled: '操作已取消',
  progressCancelling: '正在取消...',
  
  // Auto sync
  menuAutoSync: '自动同步设置',
  labelLocalFolder: '本地文件夹:',
  labelSyncInterval: '同步间隔:',
  checkboxEnableSync: '启用自动同步',
  
  // Public link generation
  menuGenerateLink: '生成临时链接',
  dialogGenerateLink: '生成临时访问链接',
  labelLinkExpiry: '有效期:',
  buttonGenerate: '生成',
  buttonCopyLink: '复制链接',
  
  // View logs
  buttonViewLogs: '查看日志',
  
  // File size units (for reference)
  unitBytes: '字节',
  unitKB: 'KB',
  unitMB: 'MB',
  unitGB: 'GB',
  unitTB: 'TB',
  
  // Time units (for reference)
  unitSecond: '秒',
  unitMinute: '分钟',
  unitHour: '小时',
  unitDay: '天',
  
  // Common actions
  actionContinue: '继续',
  actionYes: '是',
  actionNo: '否',
  actionClose: '关闭',
  actionApply: '应用',
  actionReset: '重置',
  
  // ==================== Settings Window ====================
  settingsWindowTitle: '设置',
  settingsTabCredentials: '凭证配置',
  settingsTabBucket: '存储桶设置',
  settingsTabGeneral: '常规设置',
  
  // Credential settings
  credentialsTitle: 'R2 API 凭证',
  credentialsDescription: '配置您的 Cloudflare R2 API 凭证以访问存储服务。',
  credentialsStatusConfigured: '凭证已配置',
  credentialsStatusNotConfigured: '凭证未配置',
  credentialsAccessKeyId: 'Access Key ID',
  credentialsSecretAccessKey: 'Secret Access Key',
  credentialsPlaceholderAccessKey: '请输入 Access Key ID',
  credentialsPlaceholderSecretKey: '请输入 Secret Access Key',
  credentialsShowPassword: '显示密钥',
  credentialsHidePassword: '隐藏密钥',
  credentialsValidateSuccess: '凭证验证成功',
  credentialsValidateFailed: '凭证验证失败',
  credentialsSaveSuccess: '凭证保存成功',
  credentialsSaveFailed: '凭证保存失败',
  credentialsLoadFailed: '加载凭证失败',
  credentialsTestConnection: '测试连接',
  credentialsTesting: '正在测试连接...',
  credentialsTestSuccess: '连接测试成功',
  credentialsTestFailed: '连接测试失败',
  
  // Bucket settings
  bucketTitle: '存储桶选择',
  bucketDescription: '选择要管理的 R2 存储桶。',
  bucketCurrent: '当前存储桶',
  bucketSelectPlaceholder: '请选择存储桶',
  bucketRefreshList: '刷新列表',
  bucketLoadingList: '正在加载存储桶列表...',
  bucketLoadFailed: '加载存储桶列表失败',
  bucketSwitchSuccess: '已切换到存储桶: {bucket}',
  bucketSwitchFailed: '切换存储桶失败',
  bucketNoBuckets: '未找到可用的存储桶',
  bucketAutoSelect: '自动选择',
  bucketManualHint: '可手动填写桶名，也可通过下方“刷新”后选择。',
  
  // Settings buttons
  settingsButtonSave: '保存设置',
  settingsButtonCancel: '取消',
  settingsButtonReset: '重置为默认',
  settingsSaving: '正在保存...',
  settingsSaveSuccess: '设置已保存',
  settingsSaveFailed: '保存设置失败',
  settingsResetConfirm: '确定要重置所有设置为默认值吗？',
  settingsResetSuccess: '设置已重置',
  settingsNoChanges: '没有需要保存的更改',
  
  // Endpoint settings
  endpointTitle: 'R2 端点',
  endpointUrl: '端点 URL',
  endpointRegion: '区域',
  endpointDescription: 'R2 API 端点配置（高级设置）',
  endpointHelp: '支持输入完整 URL；未填写协议时默认使用 https://',
  endpointRequired: '请填写 S3 地址（Endpoint）',
  bucketRequired: '请填写桶名',

  // Public URL / custom domain
  publicUrl: '自定义域名',
  publicUrlHelp: '可选。用于生成文件访问链接；不填写时使用 S3 地址。',
  
  // Security
  securityTitle: '安全设置',
  securityEncryptCredentials: '加密存储凭证',
  securityEncryptDescription: '使用系统密钥加密存储您的 R2 凭证',
  securityClearCredentials: '清除已保存的凭证',
  securityClearConfirm: '确定要清除已保存的凭证吗？您需要重新输入凭证才能使用应用。',
  securityClearSuccess: '凭证已清除',
  securityClearFailed: '清除凭证失败',

  // Settings tabs
  settingsTabCredentials: '凭证配置',
  settingsTabBucket: '存储桶设置',
  settingsTabCache: '缓存设置',
  settingsTabSecurity: '安全与密码',

  // Thumbnail cache settings
  cacheTitle: '缩略图缓存',
  cacheDescription: '把列表与网格中的图片、视频首帧缩略图保存到本地磁盘，切换存储桶或重新进入目录时无需重复下载。',
  cacheEnableLabel: '启用本地缩略图缓存',
  cacheListEnableLabel: '缓存文件列表（切换桶 / 目录直接本地秒开）',
  cacheLimitLabel: '缓存大小上限',
  cacheLimitHelp: '超过上限时自动淘汰最久未使用的缩略图。',
  cacheUsedLabel: '当前占用',
  cacheCountLabel: '缩略图条目',
  cacheListCountLabel: '已缓存目录',
  cacheDirectoryLabel: '缓存目录',
  // App lock
  appLockTitle: '应用已锁定',
  appLockSubtitle: '请输入密码以继续使用',
  appLockUnlockButton: '解锁',
  appLockForgotLink: '忘记密码？',
  appLockBackLink: '返回登录',
  appLockResetHint: '验证当前存储桶的 Cloudflare 凭据后即可重设密码。重设后本地缓存会清空并重新生成。',
  appLockResetButton: '验证并重设密码',
  appLockSetupHint: '配置已完成。设置应用密码后，下次启动需要输入密码才能进入；密码经过加密保存，忘记时可用 Cloudflare 凭据找回。',
  appLockSetupButton: '设置密码',
  appLockSkipLink: '暂不设置',
  appLockSectionTitle: '应用密码锁',
  appLockSectionDescription: '启用后启动应用需要输入密码。本地缓存（缩略图、文件列表）会用该密码加密保存，忘记密码时可用当前存储桶的 Cloudflare 凭据找回。',
  appLockEnableLabel: '启用应用密码锁',
  appLockChangeButton: '修改密码',
  appLockSetButton: '设置密码',

  cacheClearButton: '清理缓存',
  cacheOpenDirectoryButton: '打开缓存目录',
  cacheRefreshButton: '刷新状态',
};

// Export for use in both main and renderer processes
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { UI_TEXT };
}

// Also expose globally for browser/renderer context
if (typeof window !== 'undefined') {
  window.UI_TEXT = UI_TEXT;
}
