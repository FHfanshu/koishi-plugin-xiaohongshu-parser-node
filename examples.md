# 小红书解析插件使用示例

本文档提供了详细的使用示例，帮助您快速上手 koishi-plugin-xiaohongshu-parser-node 插件。

## 快速开始

### 1. 安装插件

```bash
npm install koishi-plugin-xiaohongshu-parser-node
```

### 2. 基础配置

在您的 Koishi 配置文件中添加：

```javascript
// koishi.config.js
module.exports = {
  plugins: {
    'xiaohongshu-parser-node': {
      enableCache: true,
      downloadImages: true,
      enableForward: true
    }
  }
};
```

### 3. 启动使用

安装并配置后，插件会自动启用。用户可以在聊天中直接发送小红书链接。

## 使用方式

### 自动检测模式

当用户在聊天中发送小红书链接时，插件会自动检测并解析：

```
用户: 看看这个笔记 https://www.xiaohongshu.com/explore/xxxxx
机器人: 
📌 笔记标题
👤 作者: 用户名
📝 笔记描述内容...
🏷️ #标签1 #标签2
📊 👍 1.2k ⭐ 500 💬 89
📸 图片 (3张):
[图片1] [图片2] [图片3]
```

### 手动指令模式

使用 `xhs` 指令手动解析链接：

```
用户: xhs https://www.xiaohongshu.com/explore/xxxxx
机器人: (同上解析结果)
```

### 强制刷新缓存

使用 `-f` 参数强制重新获取内容：

```
用户: xhs https://www.xiaohongshu.com/explore/xxxxx -f
机器人: ⏳ 正在重新获取内容...
📌 笔记标题...
```

### 指定发送模式

使用 `-m` 参数指定发送模式：

```
用户: xhs https://www.xiaohongshu.com/explore/xxxxx -m quote
机器人: 
> 引用用户消息
📌 笔记标题...
```

## 高级功能示例

### 合并转发模式

当启用 `enableForward: true` 时，长内容会使用合并转发：

```
机器人发送合并转发消息:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 超好看的咖啡店分享
👤 作者: 咖啡达人小王

📝 今天发现了一家宝藏咖啡店，环境超赞，咖啡也很好喝！推荐给大家～

🏷️ #咖啡 #探店 #生活分享
📊 👍 2.3k ⭐ 1.1k 💬 156

📸 图片 (5张):
[图片预览]
... 还有 2 张图片
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 批量解析

支持同时解析多个链接：

```
用户: 看看这两个笔记 
      https://www.xiaohongshu.com/explore/xxx1 
      https://www.xiaohongshu.com/explore/xxx2
机器人: (分别解析两个链接并发送)
```

### 缓存管理

管理员可以使用缓存管理指令：

```
管理员: xhs.cache -s
机器人: 当前缓存大小: 47 条记录

管理员: xhs.cache -c
机器人: ✅ 缓存已清空
```

## 配置示例

### 基础配置

```javascript
{
  enableCache: true,
  cacheTimeout: 3600000, // 1小时
  downloadImages: true,
  downloadVideos: true,
  enableForward: true,
  forwardMode: 'auto'
}
```

### 群组白名单配置

```javascript
{
  enableGroupWhitelist: true,
  allowedGroups: ['123456789', '987654321'],
  adminGroups: ['123456789'],
  blockedKeywords: ['广告', '推广']
}
```

### 轻量级配置

```javascript
{
  enableCache: true,
  cacheTimeout: 1800000, // 30分钟
  downloadImages: true,
  downloadVideos: false, // 不下载视频
  maxImagesPerMessage: 3,
  enablePuppeteer: false
}
```

### 高性能配置

```javascript
{
  enableCache: true,
  cacheTimeout: 7200000, // 2小时
  maxRetries: 5,
  enablePuppeteer: true,
  puppeteerTimeout: 60000, // 1分钟
  maxImagesPerMessage: 9
}
```

## API 使用示例

### 在插件中使用

```javascript
// 在您的插件中获取服务
ctx.service('xhsParser');

// 使用服务解析链接
const content = await ctx.xhsParser.getContent('https://www.xiaohongshu.com/explore/xxxxx');

if (content) {
  console.log('标题:', content.title);
  console.log('作者:', content.author);
  console.log('图片数量:', content.images.length);
  console.log('视频数量:', content.videos.length);
  console.log('点赞数:', content.stats.likes);
}
```

### 错误处理

```javascript
try {
  const content = await ctx.xhsParser.getContent(url);
  if (!content) {
    await session.send('无法获取内容，请检查链接是否有效');
    return;
  }
  
  // 处理内容
  const formatted = formatContent(content, config);
  await session.send(formatted.content);
  
} catch (error) {
  console.error('解析失败:', error);
  await session.send('解析失败，请稍后重试');
}
```

## 常见问题

### Q: 为什么有些链接解析失败？

A: 可能的原因：
1. 链接格式不正确或已失效
2. 小红书反爬机制触发
3. 网络连接问题
4. 内容被删除或设为私密

解决方案：
- 检查链接是否有效
- 启用 Puppeteer 模式
- 调整请求间隔和重试次数
- 使用代理（如有需要）

### Q: 如何防止刷屏？

A: 建议配置：
```javascript
{
  enableForward: true,
  maxImagesPerMessage: 3,
  maxContentLength: 300
}
```

### Q: 如何限制使用权限？

A: 使用群组白名单：
```javascript
{
  enableGroupWhitelist: true,
  allowedGroups: ['your-group-id'],
  adminGroups: ['your-admin-group-id']
}
```

### Q: 缓存占用内存过多怎么办？

A: 可以：
1. 减少缓存超时时间
2. 定期清理缓存
3. 禁用缓存功能
4. 使用外部缓存服务

## 最佳实践

### 1. 合理配置缓存

根据您的用户量和服务器的性能，合理设置缓存时间：
- 小型机器人：1-2小时缓存
- 中型机器人：30分钟-1小时缓存
- 大型机器人：15-30分钟缓存

### 2. 内容过滤

建议启用内容过滤，防止违规内容：
```javascript
{
  blockedKeywords: ['广告', '推广', '违规', '敏感'],
  minContentLength: 10
}
```

### 3. 错误重试

网络不稳定时，适当增加重试次数：
```javascript
{
  maxRetries: 3,
  requestTimeout: 15000
}
```

### 4. 性能优化

- 根据服务器性能选择是否启用 Puppeteer
- 合理设置单条消息的内容长度和图片数量
- 使用 CDN 加速媒体资源访问

## 更新日志

### v1.0.0
- ✨ 初始版本发布
- 🎯 支持小红书链接解析
- 📱 支持图文视频内容提取
- 🔄 支持合并转发功能
- ⚡ 内置缓存机制
- 🔧 完善的配置选项

---

如需更多帮助，请查看项目的 [GitHub 仓库](https://github.com/koishijs/koishi-plugin-xiaohongshu-parser-node) 或提交 Issue。