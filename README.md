# koishi-plugin-xiaohongshu-parser-node

一个功能强大的小红书分享链接解析插件，支持图文视频内容提取和智能合并转发。

## 功能特性

### 🎯 核心功能
- **链接解析**: 支持小红书各种格式的分享链接
- **内容提取**: 自动提取标题、描述、图片、视频和元数据
- **智能转发**: 支持合并转发和普通发送模式
- **缓存机制**: 提高响应速度，减少重复请求

### 🔧 高级功能
- **多模式解析**: 支持 Axios 和 Puppeteer 两种解析方式
- **内容过滤**: 支持关键词屏蔽和内容长度限制
- **群组管理**: 支持白名单和权限控制
- **错误处理**: 完善的重试机制和错误恢复

### 📱 支持内容类型
- **图文笔记**: 提取所有图片和文案内容
- **视频笔记**: 提取视频文件和封面
- **混合内容**: 支持图文视频混合的笔记
- **元数据**: 点赞、收藏、评论等统计信息

## 安装

```bash
npm install koishi-plugin-xiaohongshu-parser-node
```

## 配置

### 基础配置

```typescript
export interface Config {
  // 基础配置
  enableCache?: boolean           // 启用缓存 (默认: true)
  cacheTimeout?: number          // 缓存超时时间，毫秒 (默认: 1小时)
  maxRetries?: number            // 最大重试次数 (默认: 3)
  requestTimeout?: number        // 请求超时时间，毫秒 (默认: 10000)
  
  // 内容配置
  downloadImages?: boolean       // 下载图片 (默认: true)
  downloadVideos?: boolean       // 下载视频 (默认: true)
  extractText?: boolean          // 提取文本 (默认: true)
  includeMetadata?: boolean      // 包含元数据 (默认: true)
  
  // 转发配置
  enableForward?: boolean        // 启用合并转发 (默认: true)
  forwardMode?: 'auto' | 'manual' | 'quote'  // 转发模式 (默认: 'auto')
  maxImagesPerMessage?: number   // 每条消息最大图片数 (默认: 9)
  maxContentLength?: number      // 每条消息最大内容长度 (默认: 500)
}
```

### 完整配置示例

```typescript
ctx.plugin(require('koishi-plugin-xiaohongshu-parser-node'), {
  // 基础配置
  enableCache: true,
  cacheTimeout: 3600000, // 1小时
  maxRetries: 3,
  requestTimeout: 10000,
  
  // 内容配置
  downloadImages: true,
  downloadVideos: true,
  extractText: true,
  includeMetadata: true,
  
  // 转发配置
  enableForward: true,
  forwardMode: 'auto',
  maxImagesPerMessage: 9,
  maxContentLength: 500,
  
  // 高级配置
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  enablePuppeteer: false,
  puppeteerTimeout: 30000,
  customHeaders: {
    'Accept-Language': 'zh-CN,zh;q=0.9'
  },
  
  // 过滤配置
  blockedKeywords: ['广告', '推广'],
  allowedDomains: ['www.xiaohongshu.com', 'xhslink.com'],
  minContentLength: 10,
  
  // 群组配置
  allowedGroups: ['123456789', '987654321'],
  adminGroups: ['123456789'],
  enableGroupWhitelist: false
})
```

## 使用方法

### 指令使用

1. **基础解析**
```
xhs <小红书链接>
```

2. **强制刷新缓存**
```
xhs <链接> -f
```

3. **指定发送模式**
```
xhs <链接> -m quote    # 引用回复模式
xhs <链接> -m manual   # 手动模式
xhs <链接> -m auto     # 自动模式
```

### 自动检测

当用户在聊天中发送小红书链接时，插件会自动检测并解析：

- 支持的链接格式：
  - `https://www.xiaohongshu.com/explore/xxx`
  - `https://www.xiaohongshu.com/discovery/item/xxx`
  - `http://xhslink.com/xxx` (短链接)

### 缓存管理

管理员可以使用以下指令管理缓存：

```
xhs.cache -c    # 清空缓存
xhs.cache -s    # 查看缓存大小
```

## 权限控制

### 群组白名单

通过配置 `allowedGroups` 和 `enableGroupWhitelist` 可以限制插件的使用范围：

```typescript
{
  enableGroupWhitelist: true,
  allowedGroups: ['123456789'],  // 允许使用的群组
  adminGroups: ['123456789']     // 管理员群组
}
```

### 内容过滤

支持关键词屏蔽和内容长度限制：

```typescript
{
  blockedKeywords: ['广告', '推广', '违规内容'],
  minContentLength: 10  // 最小内容长度
}
```

## 高级功能

### Puppeteer 模式

对于反爬较强的情况，可以启用 Puppeteer 模式：

```typescript
{
  enablePuppeteer: true,
  puppeteerTimeout: 30000
}
```

### 自定义请求头

可以添加自定义请求头绕过反爬：

```typescript
{
  customHeaders: {
    'X-Custom-Header': 'value',
    'Accept-Language': 'zh-CN,zh;q=0.9'
  }
}
```

## 错误处理

插件具有完善的错误处理机制：

1. **网络重试**: 自动重试失败的请求
2. **缓存容错**: 缓存失效时自动重新获取
3. **内容验证**: 验证获取的内容完整性
4. **日志记录**: 详细的错误日志便于调试

## 性能优化

### 缓存策略

- 内存缓存减少重复请求
- 可配置的缓存过期时间
- 自动清理过期缓存

### 并发控制

- 限制同时处理的链接数量
- 避免触发平台反爬机制
- 优雅的错误恢复

## 更新日志

### v1.0.0
- ✨ 初始版本发布
- 🎯 支持小红书链接解析
- 📱 支持图文视频内容提取
- 🔄 支持合并转发功能
- ⚡ 内置缓存机制
- 🔧 完善的配置选项

## 支持与反馈

如有问题或建议，请通过以下方式联系：

- GitHub Issues: [提交问题](https://github.com/koishijs/koishi-plugin-xiaohongshu-parser-node/issues)
- 邮件: developer@example.com

## 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

## 致谢

感谢以下项目和开发者的支持：

- [Koishi](https://koishi.js.org/) - 优秀的机器人框架
- [Cheerio](https://cheerio.js.org/) - 快速的HTML解析器
- [Axios](https://axios-http.com/) - 强大的HTTP客户端