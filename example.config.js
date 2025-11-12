// Koishi 小红书解析插件配置示例
// 复制此文件到您的 Koishi 项目配置目录

module.exports = {
  plugins: {
    'xiaohongshu-parser-node': {
      // ============================================
      // 基础配置
      // ============================================
      
      // 是否启用缓存功能
      // 启用后可以显著提高响应速度，减少重复请求
      enableCache: true,
      
      // 缓存超时时间（毫秒）
      // 默认1小时，可以根据需求调整
      cacheTimeout: 3600000, // 1小时
      
      // 最大重试次数
      // 当请求失败时的最大重试次数
      maxRetries: 3,
      
      // 请求超时时间（毫秒）
      // 防止请求挂起过久
      requestTimeout: 10000, // 10秒
      
      // ============================================
      // 内容配置
      // ============================================
      
      // 是否下载图片
      // 如果只需要文本内容可以关闭以节省带宽
      downloadImages: true,
      
      // 是否下载视频
      // 视频文件较大，可以根据网络情况选择
      downloadVideos: true,
      
      // 是否提取文本内容
      // 包括标题、描述、标签等
      extractText: true,
      
      // 是否包含元数据
      // 包括点赞数、收藏数、评论数等统计信息
      includeMetadata: true,
      
      // ============================================
      // 转发配置
      // ============================================
      
      // 是否启用合并转发功能
      // 避免刷屏，提升用户体验
      enableForward: true,
      
      // 转发模式
      // 'auto': 自动检测并使用合并转发
      // 'manual': 手动模式，需要用户触发
      // 'quote': 引用回复模式
      forwardMode: 'auto',
      
      // 每条消息最大图片数量
      // 防止单条消息过大，超过限制会自动分批发送
      maxImagesPerMessage: 9,
      
      // 每条消息最大内容长度
      // 长内容会自动截断并提示
      maxContentLength: 500,
      
      // ============================================
      // 高级配置
      // ============================================
      
      // 自定义 User-Agent
      // 可以模拟不同浏览器访问，绕过反爬
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      
      // 是否启用 Puppeteer 渲染模式
      // 对于反爬较强的网站，可以使用浏览器渲染
      enablePuppeteer: false,
      
      // Puppeteer 超时时间（毫秒）
      // 浏览器渲染可能需要更长时间
      puppeteerTimeout: 30000, // 30秒
      
      // 自定义请求头
      // 可以添加额外的请求头信息
      customHeaders: {
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache'
      },
      
      // ============================================
      // 过滤配置
      // ============================================
      
      // 屏蔽关键词列表
      // 包含这些关键词的内容将被过滤
      blockedKeywords: [
        '广告',
        '推广',
        '营销',
        '违规',
        '敏感'
      ],
      
      // 允许的域名列表
      // 只有这些域名的链接才会被处理
      allowedDomains: [
        'www.xiaohongshu.com',
        'xiaohongshu.com',
        'xhslink.com'
      ],
      
      // 最小内容长度
      // 内容长度小于此值将被忽略（防止空内容）
      minContentLength: 10,
      
      // ============================================
      // 群组配置
      // ============================================
      
      // 是否启用群组白名单
      // 启用后只有白名单中的群组可以使用插件
      enableGroupWhitelist: false,
      
      // 允许使用插件的群组列表
      // 需要与 enableGroupWhitelist 配合使用
      allowedGroups: [
        // '123456789', // 示例群组ID
        // '987654321'  // 示例群组ID
      ],
      
      // 管理员群组列表
      // 这些群组可以使用管理指令（如缓存管理）
      adminGroups: [
        // '123456789' // 示例管理员群组ID
      ]
    }
  }
};

// ============================================
// 不同场景的推荐配置
// ============================================

// 高性能配置（适合服务器性能好，用户量大的情况）
const highPerformanceConfig = {
  enableCache: true,
  cacheTimeout: 7200000, // 2小时
  maxRetries: 5,
  downloadImages: true,
  downloadVideos: true,
  enableForward: true,
  enablePuppeteer: true,
  puppeteerTimeout: 60000
};

// 轻量级配置（适合服务器资源有限的情况）
const lightweightConfig = {
  enableCache: true,
  cacheTimeout: 1800000, // 30分钟
  maxRetries: 2,
  downloadImages: true,
  downloadVideos: false, // 不下载视频节省资源
  enableForward: true,
  enablePuppeteer: false,
  maxImagesPerMessage: 3 // 减少单条消息图片数量
};

// 严格安全配置
const strictSecurityConfig = {
  enableGroupWhitelist: true,
  allowedGroups: ['your-group-id'],
  adminGroups: ['your-admin-group-id'],
  blockedKeywords: [
    '广告', '推广', '营销', '违规', '敏感',
    '政治', '暴力', '色情', '赌博', '毒品'
  ],
  minContentLength: 50,
  maxContentLength: 300
};

// 开发测试配置
const developmentConfig = {
  enableCache: false, // 开发时关闭缓存便于调试
  maxRetries: 1,
  requestTimeout: 5000,
  enablePuppeteer: false,
  customHeaders: {
    'X-Debug-Mode': 'true'
  }
};

// 根据您的需求选择合适的配置
// module.exports.plugins['xiaohongshu-parser-node'] = {
//   ...module.exports.plugins['xiaohongshu-parser-node'],
//   ...highPerformanceConfig // 或其他配置
// };

console.log('小红书解析插件配置已加载');
console.log('建议根据实际使用情况调整配置参数');