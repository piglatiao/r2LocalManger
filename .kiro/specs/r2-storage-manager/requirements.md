# Requirements Document

## Introduction

R2 Storage Manager 是一个 Windows 桌面应用程序，用于管理 Cloudflare R2 存储桶中的对象。该工具提供图形界面，支持对象的上传、下载、预览、删除以及连接 URL 的复制功能，支持多种格式输出（URL、HTML、Markdown）。

## Glossary

- **R2_Storage_Manager**: Windows 桌面应用程序，用于管理 Cloudflare R2 存储桶对象
- **Storage_Client**: 使用 S3 SDK 连接 Cloudflare R2 的客户端组件
- **Object**: 存储在 R2 存储桶中的文件
- **Bucket**: Cloudflare R2 存储桶，用于存储对象
- **Credential_Store**: 存储 R2 API 凭证的组件（Access Key ID 和 Secret Access Key）
- **Preview_Component**: 用于预览对象内容的 UI 组件
- **URL_Formatter**: 将对象 URL 格式化为不同格式（URL、HTML、Markdown）的组件

## Requirements

### Requirement 1: R2 连接配置

**User Story:** 作为用户，我希望能够配置 R2 连接凭证，以便应用程序能够访问我的 R2 存储桶。

#### Acceptance Criteria

1. THE Credential_Store SHALL 从环境变量读取 Access Key ID
2. THE Credential_Store SHALL 从环境变量读取 Secret Access Key
3. THE Storage_Client SHALL 使用 Endpoint "https://12b1178bf0856d6e0b7d787ebd43cee5.r2.cloudflarestorage.com" 连接到 R2
4. THE Storage_Client SHALL 使用 Region "auto" 配置 S3 客户端
5. THE Storage_Client SHALL 使用 Bucket 名称 "picture" 作为默认存储桶
6. WHEN 凭证无效或缺失时，THE R2_Storage_Manager SHALL 显示错误消息并提示用户配置凭证

### Requirement 2: 对象上传

**User Story:** 作为用户，我希望能够上传文件到 R2 存储桶，以便存储和管理我的文件。

#### Acceptance Criteria

1. WHEN 用户选择本地文件时，THE R2_Storage_Manager SHALL 显示文件选择对话框
2. WHEN 用户确认上传时，THE Storage_Client SHALL 将文件上传到 Bucket
3. WHEN 上传成功时，THE R2_Storage_Manager SHALL 显示成功消息并刷新对象列表
4. WHEN 上传失败时，THE R2_Storage_Manager SHALL 显示错误消息并保留原有对象列表
5. WHILE 上传进行中时，THE R2_Storage_Manager SHALL 显示上传进度指示器
6. THE Storage_Client SHALL 保留上传文件的原始文件名作为对象键名

### Requirement 3: 对象列表显示

**User Story:** 作为用户，我希望能够查看存储桶中的所有对象，以便了解存储的内容。

#### Acceptance Criteria

1. WHEN 应用程序启动时，THE R2_Storage_Manager SHALL 加载并显示 Bucket 中的所有对象
2. THE R2_Storage_Manager SHALL 显示每个对象的文件名
3. THE R2_Storage_Manager SHALL 显示每个对象的文件大小
4. THE R2_Storage_Manager SHALL 显示每个对象的最后修改时间
5. WHEN 用户点击刷新按钮时，THE R2_Storage_Manager SHALL 重新加载对象列表

### Requirement 4: 对象下载

**User Story:** 作为用户，我希望能够下载存储桶中的对象到本地，以便在本地使用这些文件。

#### Acceptance Criteria

1. WHEN 用户选择一个对象并点击下载时，THE R2_Storage_Manager SHALL 显示保存文件对话框
2. WHEN 用户确认保存位置时，THE Storage_Client SHALL 从 Bucket 下载对象
3. WHEN 下载成功时，THE R2_Storage_Manager SHALL 显示成功消息
4. WHEN 下载失败时，THE R2_Storage_Manager SHALL 显示错误消息
5. WHILE 下载进行中时，THE R2_Storage_Manager SHALL 显示下载进度指示器
6. THE R2_Storage_Manager SHALL 使用对象的原始文件名作为默认保存文件名

### Requirement 5: 对象预览

**User Story:** 作为用户，我希望能够预览对象内容，以便在下载前确认文件内容。

#### Acceptance Criteria

1. WHEN 用户选择一个对象并点击预览时，THE Preview_Component SHALL 显示预览窗口
2. WHERE 对象是图片文件（jpg、png、gif、webp、svg），THE Preview_Component SHALL 显示图片内容
3. WHERE 对象是文本文件（txt、md、json、xml、html、css、js），THE Preview_Component SHALL 显示文本内容
4. WHERE 对象是其他类型文件，THE Preview_Component SHALL 显示文件信息（名称、大小、类型）
5. WHEN 预览失败时，THE Preview_Component SHALL 显示错误消息
6. THE Preview_Component SHALL 提供关闭预览窗口的按钮

### Requirement 6: 对象删除

**User Story:** 作为用户，我希望能够删除存储桶中的对象，以便管理存储空间。

#### Acceptance Criteria

1. WHEN 用户选择一个对象并点击删除时，THE R2_Storage_Manager SHALL 显示确认对话框
2. WHEN 用户确认删除时，THE Storage_Client SHALL 从 Bucket 删除对象
3. WHEN 删除成功时，THE R2_Storage_Manager SHALL 显示成功消息并刷新对象列表
4. WHEN 删除失败时，THE R2_Storage_Manager SHALL 显示错误消息并保留原有对象列表
5. WHEN 用户取消删除时，THE R2_Storage_Manager SHALL 关闭确认对话框并不执行删除操作

### Requirement 7: URL 复制功能

**User Story:** 作为用户，我希望能够复制对象的访问 URL，以便在其他地方使用这些链接。

#### Acceptance Criteria

1. WHEN 用户选择一个对象并点击复制 URL 时，THE URL_Formatter SHALL 生成对象的完整访问 URL
2. WHERE 用户选择 URL 格式，THE URL_Formatter SHALL 生成纯 URL 格式（https://...）
3. WHERE 用户选择 HTML 格式，THE URL_Formatter SHALL 生成 HTML img 标签格式（&lt;img src="https://..." /&gt;）
4. WHERE 用户选择 Markdown 格式，THE URL_Formatter SHALL 生成 Markdown 图片格式（![](https://...)）
5. WHEN URL 生成成功时，THE R2_Storage_Manager SHALL 将格式化的 URL 复制到系统剪贴板
6. WHEN 复制成功时，THE R2_Storage_Manager SHALL 显示成功提示消息

### Requirement 8: 错误处理

**User Story:** 作为用户，我希望应用程序能够妥善处理错误情况，以便了解问题并采取相应措施。

#### Acceptance Criteria

1. WHEN 网络连接失败时，THE R2_Storage_Manager SHALL 显示网络错误消息
2. WHEN API 认证失败时，THE R2_Storage_Manager SHALL 显示认证错误消息并提示检查凭证
3. WHEN 存储桶不存在时，THE R2_Storage_Manager SHALL 显示存储桶错误消息
4. WHEN 对象不存在时，THE R2_Storage_Manager SHALL 显示对象不存在消息
5. WHEN 权限不足时，THE R2_Storage_Manager SHALL 显示权限错误消息
6. IF 发生未预期的错误，THEN THE R2_Storage_Manager SHALL 记录错误详情并显示通用错误消息

### Requirement 9: 用户界面

**User Story:** 作为用户，我希望应用程序具有直观的用户界面，以便轻松完成各项操作。

#### Acceptance Criteria

1. THE R2_Storage_Manager SHALL 提供主窗口显示对象列表
2. THE R2_Storage_Manager SHALL 提供工具栏包含上传、下载、预览、删除、刷新按钮
3. THE R2_Storage_Manager SHALL 提供右键菜单支持对象操作
4. THE R2_Storage_Manager SHALL 提供状态栏显示当前操作状态和对象数量
5. THE R2_Storage_Manager SHALL 支持键盘快捷键（如 Ctrl+U 上传、Ctrl+D 下载、Delete 删除）
6. THE R2_Storage_Manager SHALL 使用图标标识不同文件类型
