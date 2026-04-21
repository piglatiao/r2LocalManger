# 环境变量配置说明

本文档说明 R2 存储管理器的环境变量配置实现。

## 实现内容

### 1. 环境变量处理

应用程序使用 `dotenv` 包来加载环境变量。在 `src/main/main.js` 中：

```javascript
// 加载环境变量
require('dotenv').config();
```

### 2. 必需的环境变量

应用程序需要以下两个环境变量：

- `R2_ACCESS_KEY_ID` - Cloudflare R2 Access Key ID
- `R2_SECRET_ACCESS_KEY` - Cloudflare R2 Secret Access Key

### 3. 环境变量验证

应用程序在启动时会验证环境变量是否已配置：

```javascript
function validateEnvironmentVariables() {
  const requiredVars = ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];
  const missingVars = [];

  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      missingVars.push(varName);
    }
  }

  if (missingVars.length > 0) {
    return {
      valid: false,
      message: `缺少必需的环境变量: ${missingVars.join(', ')}\n\n请在项目根目录创建 .env 文件并配置这些变量。\n参考 .env.example 文件获取配置示例。`
    };
  }

  return { valid: true };
}
```

如果环境变量缺失，应用程序会显示错误对话框并退出。

### 4. R2 配置获取

提供了 `getR2Config()` 函数来获取完整的 R2 配置：

```javascript
function getR2Config() {
  return {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    endpoint: 'https://12b1178bf0856d6e0b7d787ebd43cee5.r2.cloudflarestorage.com',
    region: 'auto',
    bucket: 'picture'
  };
}
```

该函数已导出，可供其他模块使用。

### 5. 配置文件

#### .env.example
示例配置文件，包含：
- 环境变量说明
- 配置示例
- 使用注意事项

#### .env
实际配置文件（已添加到 .gitignore）：
- 用户需要复制 .env.example 并填入实际凭证
- 不会被提交到版本控制系统

#### .gitignore
确保敏感信息不被提交：
- .env 文件
- node_modules
- 构建输出目录
- 日志文件等

## 使用方法

### 开发环境

1. 复制 `.env.example` 为 `.env`
2. 编辑 `.env` 文件，填入实际凭证
3. 运行应用程序：`npm run dev`

### 生产环境

可以选择以下任一方式：

#### 方式一：使用 .env 文件
将 .env 文件放在应用程序根目录

#### 方式二：系统环境变量
在 Windows 系统中设置环境变量：
1. 系统属性 → 高级 → 环境变量
2. 添加 `R2_ACCESS_KEY_ID` 和 `R2_SECRET_ACCESS_KEY`
3. 重启应用程序

## 安全性

- ✅ 凭证从环境变量读取，不硬编码在代码中
- ✅ .env 文件已添加到 .gitignore
- ✅ 应用程序启动时验证凭证存在
- ✅ 错误消息不暴露敏感信息
- ✅ 配置函数导出供其他模块使用

## 依赖包

- `dotenv` (^17.4.2) - 用于加载 .env 文件中的环境变量

## 相关文件

- `src/main/main.js` - 主进程，包含环境变量加载和验证逻辑
- `.env.example` - 环境变量配置示例
- `.env` - 实际环境变量配置（不提交到版本控制）
- `.gitignore` - 忽略敏感文件
- `README.md` - 用户文档，包含配置说明
- `package.json` - 包含 dotenv 依赖

## 测试

环境变量处理已通过以下测试：
- ✅ dotenv 包正确加载 .env 文件
- ✅ 环境变量可以被 process.env 访问
- ✅ getR2Config() 函数返回正确的配置对象
- ✅ 验证函数能够检测缺失的环境变量

## 后续任务

此任务完成后，下一步可以实现：
- Task 2.2: 实现 R2Client 类（使用 getR2Config() 获取配置）
- Task 3.1: 实现 CredentialManager 类（使用环境变量验证逻辑）
