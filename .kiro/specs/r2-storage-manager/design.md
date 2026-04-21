# Design Document

## Introduction

本文档描述 R2 Storage Manager 的技术设计，这是一个基于 Windows 平台的桌面应用程序，用于管理 Cloudflare R2 存储桶对象。

## Technology Stack

- **运行时**: Node.js (Electron 框架)
- **UI 框架**: Electron + HTML/CSS/JavaScript
- **S3 SDK**: @aws-sdk/client-s3 (v3.x)
- **打包工具**: electron-builder (生成 Windows exe)
- **开发语言**: JavaScript/TypeScript

## Architecture

### Component Overview

```
┌─────────────────────────────────────────────────┐
│           R2 Storage Manager (Main)             │
│  ┌───────────────────────────────────────────┐  │
│  │         UI Layer (Renderer Process)       │  │
│  │  - MainWindow                             │  │
│  │  - PreviewWindow                          │  │
│  │  - DialogManager                          │  │
│  └───────────────┬───────────────────────────┘  │
│                  │ IPC                           │
│  ┌───────────────▼───────────────────────────┐  │
│  │      Application Layer (Main Process)     │  │
│  │  - StorageService                         │  │
│  │  - CredentialManager                      │  │
│  │  - URLFormatter                           │  │
│  └───────────────┬───────────────────────────┘  │
│                  │                               │
│  ┌───────────────▼───────────────────────────┐  │
│  │         Infrastructure Layer              │  │
│  │  - R2Client (S3Client wrapper)            │  │
│  │  - FileSystemHelper                       │  │
│  │  - ClipboardManager                       │  │
│  └───────────────┬───────────────────────────┘  │
└──────────────────┼───────────────────────────────┘
                   │
                   ▼
         ┌─────────────────────┐
         │  Cloudflare R2 API  │
         │   (S3 Compatible)   │
         └─────────────────────┘
```

## Component Design

### 1. R2Client (Infrastructure Layer)

**职责**: 封装 S3 SDK，提供与 Cloudflare R2 交互的底层接口

**接口**:
```javascript
class R2Client {
  constructor(config: R2Config)
  async listObjects(): Promise<ObjectInfo[]>
  async uploadObject(key: string, filePath: string, onProgress?: ProgressCallback): Promise<void>
  async downloadObject(key: string, savePath: string, onProgress?: ProgressCallback): Promise<void>
  async deleteObject(key: string): Promise<void>
  async getObjectUrl(key: string): Promise<string>
  async getObjectMetadata(key: string): Promise<ObjectMetadata>
  async getObjectStream(key: string): Promise<ReadableStream>
}

interface R2Config {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

interface ObjectInfo {
  key: string
  size: number
  lastModified: Date
  contentType?: string
}
```

**实现细节**:
- 使用 `@aws-sdk/client-s3` 的 `S3Client`
- 配置 endpoint 为 Cloudflare R2 endpoint
- 使用 `ListObjectsV2Command` 列出对象
- 使用 `PutObjectCommand` 上传对象
- 使用 `GetObjectCommand` 下载对象
- 使用 `DeleteObjectCommand` 删除对象
- 使用 `HeadObjectCommand` 获取对象元数据

### 2. CredentialManager (Application Layer)

**职责**: 管理 R2 API 凭证的读取和验证

**接口**:
```javascript
class CredentialManager {
  static loadCredentials(): Credentials
  static validateCredentials(credentials: Credentials): boolean
  static getConfig(): R2Config
}

interface Credentials {
  accessKeyId: string
  secretAccessKey: string
}
```

**实现细节**:
- 从环境变量读取 `R2_ACCESS_KEY_ID` 和 `R2_SECRET_ACCESS_KEY`
- 验证凭证是否存在且非空
- 返回完整的 R2Config 对象（包含 endpoint、region、bucket）

### 3. StorageService (Application Layer)

**职责**: 提供业务逻辑层的存储操作接口

**接口**:
```javascript
class StorageService {
  constructor(r2Client: R2Client)
  async listObjects(): Promise<ObjectInfo[]>
  async uploadFile(filePath: string, onProgress?: ProgressCallback): Promise<UploadResult>
  async downloadFile(key: string, savePath: string, onProgress?: ProgressCallback): Promise<void>
  async deleteFile(key: string): Promise<void>
  async previewFile(key: string): Promise<PreviewData>
  async getFileUrl(key: string, format: URLFormat): Promise<string>
}

enum URLFormat {
  URL = 'url',
  HTML = 'html',
  MARKDOWN = 'markdown'
}

interface UploadResult {
  key: string
  url: string
}

interface PreviewData {
  type: 'image' | 'text' | 'info'
  content: string | Buffer
  metadata: ObjectMetadata
}
```

**实现细节**:
- 封装 R2Client 的调用
- 处理文件名提取（从完整路径）
- 实现预览逻辑（根据文件扩展名判断类型）
- 调用 URLFormatter 生成不同格式的 URL

### 4. URLFormatter (Application Layer)

**职责**: 将对象 URL 格式化为不同格式

**接口**:
```javascript
class URLFormatter {
  static formatUrl(baseUrl: string, key: string, format: URLFormat): string
}
```

**实现细节**:
- URL 格式: `https://{endpoint}/{bucket}/{key}`
- HTML 格式: `<img src="{url}" alt="{filename}" />`
- Markdown 格式: `![{filename}]({url})`

### 5. MainWindow (UI Layer)

**职责**: 主窗口 UI，显示对象列表和操作按钮

**组件结构**:
```
MainWindow
├── Toolbar
│   ├── UploadButton (上传)
│   ├── DownloadButton (下载)
│   ├── PreviewButton (预览)
│   ├── DeleteButton (删除)
│   └── RefreshButton (刷新)
├── ObjectList (Table)
│   ├── Column: Icon (图标)
│   ├── Column: Name (文件名)
│   ├── Column: Size (大小)
│   └── Column: Last Modified (修改时间)
├── ContextMenu
│   ├── Upload (上传)
│   ├── Download (下载)
│   ├── Preview (预览)
│   ├── Delete (删除)
│   ├── Copy URL (复制链接)
│   ├── Copy HTML (复制 HTML)
│   └── Copy Markdown (复制 Markdown)
└── StatusBar
    ├── StatusText (状态文本)
    └── ObjectCount (对象数量)
```

**UI 文本示例**:
- 工具栏按钮: "上传", "下载", "预览", "删除", "刷新"
- 表格列标题: "文件名", "大小", "修改时间"
- 右键菜单: "上传", "下载", "预览", "删除", "复制链接", "复制 HTML", "复制 Markdown"
- 状态栏: "就绪" / "正在加载..." / "共 {count} 个对象"

**IPC 通信**:
- `storage:list` - 请求对象列表
- `storage:upload` - 上传文件
- `storage:download` - 下载文件
- `storage:delete` - 删除文件
- `storage:preview` - 预览文件
- `storage:copy-url` - 复制 URL

### 6. PreviewWindow (UI Layer)

**职责**: 预览窗口，显示对象内容

**组件结构**:
```
PreviewWindow
├── Header
│   ├── Title (文件名)
│   └── CloseButton (关闭)
└── ContentArea
    ├── ImageViewer (图片查看器)
    ├── TextViewer (文本查看器)
    └── InfoViewer (信息查看器)
```

**UI 文本示例**:
- 窗口标题: "预览 - {文件名}"
- 关闭按钮: "关闭"
- 信息查看器标签: "文件名:", "大小:", "类型:", "最后修改:"
- 加载提示: "正在加载..."
- 错误提示: "无法加载预览"

### 7. DialogManager (UI Layer)

**职责**: 管理系统对话框（文件选择、保存、确认）

**接口**:
```javascript
class DialogManager {
  static async showOpenDialog(options: OpenDialogOptions): Promise<string[]>
  static async showSaveDialog(options: SaveDialogOptions): Promise<string>
  static async showConfirmDialog(message: string): Promise<boolean>
  static showErrorDialog(message: string): void
  static showSuccessDialog(message: string): void
}
```

**对话框文本示例**:
- 文件选择对话框标题: "选择要上传的文件"
- 文件保存对话框标题: "保存文件"
- 确认删除对话框: "确定要删除 '{文件名}' 吗？此操作无法撤销。"
- 确认对话框按钮: "确定", "取消"
- 成功提示: "操作成功"
- 错误提示: "操作失败"

## Data Flow

### Upload Flow
```
用户点击上传按钮
  → DialogManager.showOpenDialog() (标题: "选择要上传的文件")
  → 用户选择文件
  → IPC: storage:upload (filePath)
  → StorageService.uploadFile()
  → R2Client.uploadObject()
  → S3 SDK: PutObjectCommand
  → 成功: 刷新列表，显示成功消息 "文件上传成功"
  → 失败: 显示错误对话框 "文件上传失败: {错误信息}"
```

### Download Flow
```
用户选择对象并点击下载按钮
  → DialogManager.showSaveDialog() (标题: "保存文件", 默认文件名: {对象名})
  → 用户选择保存位置
  → IPC: storage:download (key, savePath)
  → StorageService.downloadFile()
  → R2Client.downloadObject()
  → S3 SDK: GetObjectCommand
  → 写入文件系统
  → 成功: 显示成功消息 "文件下载成功"
  → 失败: 显示错误对话框 "文件下载失败: {错误信息}"
```

### Preview Flow
```
用户选择对象并点击预览按钮
  → IPC: storage:preview (key)
  → StorageService.previewFile()
  → R2Client.getObjectStream()
  → 根据扩展名判断文件类型
  → 加载内容 (图片/文本/信息)
  → 打开预览窗口显示内容 (标题: "预览 - {文件名}")
  → 失败: 显示错误对话框 "无法预览文件: {错误信息}"
```

### Delete Flow
```
用户选择对象并点击删除按钮
  → DialogManager.showConfirmDialog() (消息: "确定要删除 '{文件名}' 吗？此操作无法撤销。")
  → 用户点击"确定"
  → IPC: storage:delete (key)
  → StorageService.deleteFile()
  → R2Client.deleteObject()
  → S3 SDK: DeleteObjectCommand
  → 成功: 刷新列表，显示成功消息 "文件删除成功"
  → 失败: 显示错误对话框 "文件删除失败: {错误信息}"
```

### Copy URL Flow
```
用户选择对象并点击复制 URL (选择格式)
  → IPC: storage:copy-url (key, format)
  → StorageService.getFileUrl()
  → R2Client.getObjectUrl()
  → URLFormatter.formatUrl()
  → ClipboardManager.writeText()
  → 显示成功消息 "链接已复制到剪贴板"
```

## Error Handling Strategy

### Error Categories

1. **Network Errors (网络错误)**
   - 检测: Catch network-related exceptions from S3 SDK
   - 错误消息: "网络连接失败，请检查网络设置"
   - 用户操作: 提供"重试"按钮

2. **Authentication Errors (认证错误)**
   - 检测: HTTP 403 或 InvalidAccessKeyId
   - 错误消息: "认证失败，请检查 API 凭证配置"
   - 详细提示: "请确认环境变量 R2_ACCESS_KEY_ID 和 R2_SECRET_ACCESS_KEY 已正确设置"

3. **Bucket Errors (存储桶错误)**
   - 检测: NoSuchBucket error
   - 错误消息: "存储桶不存在或无法访问"

4. **Object Errors (对象错误)**
   - 检测: NoSuchKey error
   - 错误消息: "对象不存在，可能已被删除"
   - 恢复操作: 自动刷新列表

5. **Permission Errors (权限错误)**
   - 检测: HTTP 403 AccessDenied
   - 错误消息: "权限不足，无法执行此操作"

6. **File System Errors (文件系统错误)**
   - 检测: ENOENT, EACCES, ENOSPC
   - 错误消息示例:
     - ENOENT: "文件或目录不存在"
     - EACCES: "没有访问权限"
     - ENOSPC: "磁盘空间不足"

7. **Unknown Errors (未知错误)**
   - 检测: 所有未分类的错误
   - 处理: 记录完整错误堆栈到日志文件
   - 错误消息: "发生未知错误，请查看日志文件获取详细信息"
   - 日志路径提示: "日志位置: {日志文件路径}"

### Progress Messages (进度消息)

- 上传中: "正在上传 {文件名}... {百分比}% ({已上传大小}/{总大小})"
- 下载中: "正在下载 {文件名}... {百分比}% ({已下载大小}/{总大小})"
- 加载中: "正在加载对象列表..."
- 删除中: "正在删除 {文件名}..."

### Success Messages (成功消息)

- 上传成功: "文件上传成功"
- 下载成功: "文件下载成功"
- 删除成功: "文件删除成功"
- 复制成功: "链接已复制到剪贴板"
- 刷新成功: "列表已刷新"

### Error Logging

```javascript
class ErrorLogger {
  static logError(error: Error, context: string): void
  static getLogPath(): string
}
```

- 日志位置: `%APPDATA%/r2-storage-manager/logs/error.log`
- 日志格式: `[时间戳] [上下文] 错误消息\n堆栈跟踪`

## File Type Detection

### Supported Preview Types

**Images (图片)**: jpg, jpeg, png, gif, webp, svg, bmp, ico
**Text (文本)**: txt, md, json, xml, html, css, js, ts, yaml, yml, log

### Detection Logic

```javascript
function getFileType(filename: string): 'image' | 'text' | 'other' {
  const ext = path.extname(filename).toLowerCase().slice(1)
  if (IMAGE_EXTENSIONS.includes(ext)) return 'image'
  if (TEXT_EXTENSIONS.includes(ext)) return 'text'
  return 'other'
}
```

### Preview Messages (预览消息)

- 图片加载中: "正在加载图片..."
- 文本加载中: "正在加载文本..."
- 文件过大警告: "文件过大 ({文件大小})，预览可能较慢。是否继续？"
- 不支持预览: "不支持预览此文件类型，请下载后查看"

## Configuration

### Internationalization (国际化设计)

**当前版本语言支持**: 仅支持简体中文

**设计原则**:
- 所有 UI 文本、按钮标签、菜单项均使用简体中文
- 所有错误消息、提示信息、对话框文本均使用简体中文
- 状态栏、工具栏、右键菜单等所有界面元素均使用简体中文
- 日期时间格式使用中文本地化格式（如：2024年1月15日 14:30）
- 文件大小单位使用中文（如：KB、MB、GB）

**文本管理**:
```javascript
// 所有 UI 文本集中管理在 i18n/zh-CN.js
const UI_TEXT = {
  // 窗口标题
  mainWindowTitle: 'R2 存储管理器',
  previewWindowTitle: '预览 - {filename}',
  
  // 工具栏按钮
  uploadButton: '上传',
  downloadButton: '下载',
  previewButton: '预览',
  deleteButton: '删除',
  refreshButton: '刷新',
  
  // 表格列标题
  columnIcon: '图标',
  columnName: '文件名',
  columnSize: '大小',
  columnModified: '修改时间',
  
  // 右键菜单
  menuUpload: '上传',
  menuDownload: '下载',
  menuPreview: '预览',
  menuDelete: '删除',
  menuCopyUrl: '复制链接',
  menuCopyHtml: '复制 HTML',
  menuCopyMarkdown: '复制 Markdown',
  
  // 状态栏
  statusReady: '就绪',
  statusLoading: '正在加载...',
  statusUploading: '正在上传...',
  statusDownloading: '正在下载...',
  objectCount: '共 {count} 个对象',
  
  // 对话框
  dialogSelectFile: '选择要上传的文件',
  dialogSaveFile: '保存文件',
  dialogConfirmDelete: '确定要删除 \'{filename}\' 吗？此操作无法撤销。',
  dialogButtonOk: '确定',
  dialogButtonCancel: '取消',
  dialogButtonRetry: '重试',
  
  // 成功消息
  uploadSuccess: '文件上传成功',
  downloadSuccess: '文件下载成功',
  deleteSuccess: '文件删除成功',
  copySuccess: '链接已复制到剪贴板',
  refreshSuccess: '列表已刷新',
  
  // 错误消息
  errorNetwork: '网络连接失败，请检查网络设置',
  errorAuth: '认证失败，请检查 API 凭证配置',
  errorAuthDetail: '请确认环境变量 R2_ACCESS_KEY_ID 和 R2_SECRET_ACCESS_KEY 已正确设置',
  errorBucket: '存储桶不存在或无法访问',
  errorObject: '对象不存在，可能已被删除',
  errorPermission: '权限不足，无法执行此操作',
  errorFileNotFound: '文件或目录不存在',
  errorFileAccess: '没有访问权限',
  errorDiskSpace: '磁盘空间不足',
  errorUnknown: '发生未知错误，请查看日志文件获取详细信息',
  errorLogPath: '日志位置: {path}',
  
  // 进度消息
  progressUploading: '正在上传 {filename}... {percent}% ({uploaded}/{total})',
  progressDownloading: '正在下载 {filename}... {percent}% ({downloaded}/{total})',
  progressDeleting: '正在删除 {filename}...',
  
  // 预览消息
  previewLoadingImage: '正在加载图片...',
  previewLoadingText: '正在加载文本...',
  previewFileTooLarge: '文件过大 ({size})，预览可能较慢。是否继续？',
  previewNotSupported: '不支持预览此文件类型，请下载后查看',
  previewError: '无法预览文件',
  
  // 预览窗口标签
  previewLabelFilename: '文件名:',
  previewLabelSize: '大小:',
  previewLabelType: '类型:',
  previewLabelModified: '最后修改:',
  previewButtonClose: '关闭',
  
  // 工具提示
  tooltipUpload: '上传文件 (Ctrl+U)',
  tooltipDownload: '下载选中文件 (Ctrl+D)',
  tooltipPreview: '预览选中文件 (Enter)',
  tooltipDelete: '删除选中文件 (Delete)',
  tooltipRefresh: '刷新列表 (Ctrl+R)',
}
```

**未来扩展**:
- 预留多语言支持架构（可添加 en-US.js、ja-JP.js 等）
- 使用 i18next 或类似库实现语言切换
- 在设置中添加语言选择选项

### Environment Variables

- `R2_ACCESS_KEY_ID`: R2 Access Key ID (必需)
- `R2_SECRET_ACCESS_KEY`: R2 Secret Access Key (必需)

### Hardcoded Configuration

```javascript
const R2_CONFIG = {
  endpoint: 'https://12b1178bf0856d6e0b7d787ebd43cee5.r2.cloudflarestorage.com',
  region: 'auto',
  bucket: 'picture'
}
```

## UI Design Specifications

### Main Window

- **尺寸**: 1000x600 px (可调整)
- **最小尺寸**: 800x500 px
- **窗口标题**: "R2 存储管理器"
- **布局**: 
  - Toolbar: 高度 50px
  - ObjectList: 填充剩余空间
  - StatusBar: 高度 30px

### Object List Columns

1. **图标**: 宽度 40px (文件类型图标)
2. **文件名**: 宽度 40% (可排序)
3. **大小**: 宽度 20% (可排序，显示为 KB/MB/GB)
4. **修改时间**: 宽度 40% (可排序，显示为本地时间格式)

### Toolbar Buttons (工具栏按钮)

- 上传按钮: 图标 + "上传" 文本
- 下载按钮: 图标 + "下载" 文本
- 预览按钮: 图标 + "预览" 文本
- 删除按钮: 图标 + "删除" 文本
- 刷新按钮: 图标 + "刷新" 文本

### Context Menu (右键菜单)

- "上传"
- "下载"
- "预览"
- "删除"
- 分隔线
- "复制链接"
- "复制 HTML"
- "复制 Markdown"

### Preview Window

- **尺寸**: 800x600 px (可调整)
- **最小尺寸**: 400x300 px
- **窗口标题**: "预览 - {文件名}"
- **图片预览**: 居中显示，保持宽高比，支持缩放
- **文本预览**: 等宽字体，支持滚动
- **信息显示标签**:
  - "文件名:"
  - "大小:"
  - "类型:"
  - "最后修改:"

### Progress Indicators (进度指示器)

- **上传/下载**: 进度条显示百分比和传输速度
- **位置**: 状态栏或模态对话框
- **格式**: "{百分比}% - {速度} MB/s"

### Status Bar (状态栏)

- 左侧: 状态文本
  - 就绪: "就绪"
  - 加载中: "正在加载..."
  - 上传中: "正在上传..."
  - 下载中: "正在下载..."
- 右侧: 对象计数
  - 格式: "共 {数量} 个对象"

### Keyboard Shortcuts (键盘快捷键)

- `Ctrl+U`: 上传文件
- `Ctrl+D`: 下载选中对象
- `Ctrl+R`: 刷新列表
- `Delete`: 删除选中对象
- `Enter`: 预览选中对象
- `Ctrl+C`: 复制 URL (默认格式)
- `Ctrl+Shift+C`: 显示复制格式菜单

### Tooltip Text (工具提示)

- 上传按钮: "上传文件 (Ctrl+U)"
- 下载按钮: "下载选中文件 (Ctrl+D)"
- 预览按钮: "预览选中文件 (Enter)"
- 删除按钮: "删除选中文件 (Delete)"
- 刷新按钮: "刷新列表 (Ctrl+R)"

## Security Considerations

1. **凭证安全**
   - 凭证仅从环境变量读取，不存储在应用程序中
   - 不在日志中记录凭证信息
   - 不在 UI 中显示完整凭证

2. **输入验证**
   - 验证文件路径，防止路径遍历攻击
   - 验证对象键名，确保符合 S3 命名规范

3. **错误消息**
   - 不在错误消息中暴露敏感信息（如完整的 API endpoint）
   - 使用通用错误消息，详细信息记录到日志

## Performance Considerations

1. **对象列表**
   - 实现分页或虚拟滚动（如果对象数量 > 1000）
   - 缓存列表结果，避免频繁请求

2. **上传/下载**
   - 使用流式传输，支持大文件
   - 实现断点续传（可选，未来增强）

3. **预览**
   - 限制预览文件大小（图片 < 10MB，文本 < 1MB）
   - 对于大文件，显示警告并提供下载选项

## Testing Strategy

### Unit Tests

- R2Client: 模拟 S3 SDK 响应
- URLFormatter: 测试各种格式输出
- CredentialManager: 测试凭证加载和验证
- FileTypeDetection: 测试各种文件扩展名

### Integration Tests

- StorageService: 使用 mock R2Client 测试业务逻辑
- IPC 通信: 测试 main process 和 renderer process 之间的通信

### End-to-End Tests

- 使用 Spectron 或 Playwright 测试完整的用户流程
- 测试上传、下载、预览、删除、复制 URL 等操作

### Manual Testing

- 在 Windows 10/11 上测试 exe 安装和运行
- 测试各种文件类型的上传和预览
- 测试错误场景（网络断开、凭证错误等）

## Deployment

### Build Process

1. 安装依赖: `npm install`
2. 构建应用: `npm run build`
3. 打包 exe: `npm run package:win`

### electron-builder Configuration

```json
{
  "appId": "com.r2storagemanager.app",
  "productName": "R2 存储管理器",
  "directories": {
    "output": "dist"
  },
  "win": {
    "target": "nsis",
    "icon": "assets/icon.ico"
  },
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true,
    "installerLanguages": ["zh_CN"],
    "language": "2052"
  }
}
```

### Distribution

- 生成的 exe 文件位于 `dist/` 目录
- 安装程序使用简体中文界面
- 用户需要在系统环境变量中配置 R2 凭证
- 提供 README.md 说明凭证配置方法（简体中文）

### Installation Messages (安装程序文本)

- 欢迎页面: "欢迎安装 R2 存储管理器"
- 许可协议: "请阅读并接受许可协议"
- 安装位置: "选择安装位置"
- 安装进度: "正在安装..."
- 完成页面: "安装完成"
- 按钮文本: "下一步", "上一步", "安装", "完成", "取消"

## Future Enhancements

1. **多存储桶支持**: 允许用户切换不同的存储桶
   - UI: 添加存储桶下拉选择器
   - 标签: "存储桶:", "切换存储桶"

2. **凭证管理 UI**: 提供 UI 界面配置凭证（加密存储）
   - 菜单: "设置" → "凭证配置"
   - 标签: "Access Key ID:", "Secret Access Key:", "保存", "取消"

3. **批量操作**: 支持批量上传、下载、删除
   - 按钮: "批量上传", "批量下载", "批量删除"
   - 提示: "已选择 {count} 个文件"

4. **搜索和过滤**: 支持按文件名、类型、大小搜索对象
   - 搜索框占位符: "搜索文件..."
   - 过滤器标签: "文件类型:", "大小范围:", "修改日期:"

5. **文件夹支持**: 支持虚拟文件夹结构（基于对象键前缀）
   - 按钮: "新建文件夹", "重命名"
   - 面包屑导航: "根目录 > 文件夹1 > 文件夹2"

6. **拖放上传**: 支持拖放文件到窗口上传
   - 提示: "拖放文件到此处上传"

7. **自动同步**: 监控本地文件夹，自动同步到 R2
   - 菜单: "工具" → "自动同步设置"
   - 标签: "本地文件夹:", "同步间隔:", "启用自动同步"

8. **公共链接生成**: 生成带签名的临时公共访问链接
   - 菜单项: "生成临时链接"
   - 对话框标题: "生成临时访问链接"
   - 标签: "有效期:", "生成", "复制链接"
