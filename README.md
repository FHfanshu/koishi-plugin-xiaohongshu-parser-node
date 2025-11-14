# koishi-plugin-xiaohongshu-parser-node

一个功能强大的小红书分享链接解析插件，支持图文视频内容提取和智能合并转发。

## 功能特性

### 🎯 核心功能
- **链接解析**: 支持小红书各种格式的分享链接
- **内容提取**: 自动提取标题、描述、图片和视频
- **智能转发**: 支持合并转发多个链接
- **安全防护**: 内置SSRF防护和输入验证

### 📱 支持内容类型
- **图文笔记**: 提取所有图片和文案内容
- **视频笔记**: 提取视频链接和封面
- **短链接**: 支持xhslink.com短链接解析

## 安装

```bash
npm install koishi-plugin-xiaohongshu-parser-node
```

## 配置

### 基础配置

```typescript
export interface Config {
  // 基础配置
  allowedDomains?: string[]       // 允许解析的域名 (默认: ["xiaohongshu.com", "www.xiaohongshu.com", "xhslink.com"])
  userAgent?: string             // HTTP请求User-Agent
  requestTimeout?: number        // 请求超时时间，毫秒 (默认: 10000)
  maxRetries?: number            // 最大重试次数 (默认: 3)
  customHeaders?: Record<string, string>  // 自定义请求头
  
  // 功能配置
  enableLog?: boolean            // 启用日志输出 (默认: false)
  enableForward?: boolean        // 启用自动合并转发 (默认: false)
  maxUrlsPerMessage?: number     // 单条消息最多处理的链接数量 (默认: 5)
}
```

### 完整配置示例

```typescript
ctx.plugin(require('koishi-plugin-xiaohongshu-parser-node'), {
  // 基础配置
  allowedDomains: ['www.xiaohongshu.com', 'xhslink.com'],
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  requestTimeout: 10000,
  maxRetries: 3,
  
  // 功能配置
  enableLog: false,
  enableForward: true,
  maxUrlsPerMessage: 5,
  
  // 自定义请求头
  customHeaders: {
    'Accept-Language': 'zh-CN,zh;q=0.9'
  }
})
```

## 使用方法

### 指令使用

1. **基础解析**
```
xhs <小红书链接>
```

2. **合并转发多个链接**
```
xhs <链接1> <链接2> <链接3> -m
```

### 自动检测

当启用 `enableForward` 且用户在聊天中发送多个小红书链接时，插件会自动检测并合并转发：

- 支持的链接格式：
  - `https://www.xiaohongshu.com/explore/xxx`
  - `https://www.xiaohongshu.com/discovery/item/xxx`
  - `http://xhslink.com/xxx` (短链接)

- 自动转发条件：
  - 消息中包含多个有效的小红书链接
  - 链接数量不超过 `maxUrlsPerMessage` 设置

## 安全特性

### SSRF 防护

插件内置SSRF防护机制：

- 仅允许访问指定的可信域名
- 自动阻止内网IP地址访问
- 过滤私有主机名（localhost、.local等）
- 协议验证（仅支持HTTP/HTTPS）

### 输入验证

- URL长度限制（最大2048字符）
- 危险字符过滤
- 自动清理URL末尾标点符号

## 高级功能

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

### 日志调试

启用详细日志输出以便调试：

```typescript
{
  enableLog: true  // 输出解析过程和结果日志
}
```

## 错误处理

插件具有完善的错误处理机制：

1. **网络重试**: 自动重试失败的请求（最多3次）
2. **输入验证**: 验证URL格式和域名安全性
3. **内容验证**: 验证获取的内容完整性
4. **日志记录**: 详细的错误日志便于调试

## 更新日志

### v0.0.13
- ✨ 支持小红书链接解析
- 📱 支持图文视频内容提取
- 🔄 支持合并转发功能
- 🔧 内置SSRF防护
- 📝 完善的配置选项

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