import { Context, Schema, h, Logger, Time } from 'koishi'
import { XHSClient } from './client'
import { parseXHSUrl, formatContent, createForwardMessage, validateUrl, filterContent } from './utils'

export const name = 'xiaohongshu-parser-node'
export const logger = new Logger('xiaohongshu-parser')

export interface Config {
  // 基础配置
  enableCache?: boolean
  cacheTimeout?: number
  maxRetries?: number
  requestTimeout?: number
  
  // 内容配置
  downloadImages?: boolean
  downloadVideos?: boolean
  extractText?: boolean
  includeMetadata?: boolean
  
  // 转发配置
  enableForward?: boolean
  forwardMode?: 'auto' | 'manual' | 'quote'
  maxImagesPerMessage?: number
  maxContentLength?: number
  
  // 高级配置
  userAgent?: string
  enablePuppeteer?: boolean
  puppeteerTimeout?: number
  customHeaders?: Record<string, string>
  
  // 过滤配置
  blockedKeywords?: string[]
  allowedDomains?: string[]
  minContentLength?: number
  
  // 群组配置
  allowedGroups?: string[]
  adminGroups?: string[]
  enableGroupWhitelist?: boolean
}

export const Config: Schema<Config> = Schema.object({
  // 基础配置
  enableCache: Schema.boolean().default(true).description('是否启用缓存功能'),
  cacheTimeout: Schema.number().default(Time.hour).description('缓存超时时间（毫秒）'),
  maxRetries: Schema.number().default(3).description('最大重试次数'),
  requestTimeout: Schema.number().default(10000).description('请求超时时间（毫秒）'),
  
  // 内容配置
  downloadImages: Schema.boolean().default(true).description('是否下载图片'),
  downloadVideos: Schema.boolean().default(true).description('是否下载视频'),
  extractText: Schema.boolean().default(true).description('是否提取文本内容'),
  includeMetadata: Schema.boolean().default(true).description('是否包含元数据（点赞、收藏等）'),
  
  // 转发配置
  enableForward: Schema.boolean().default(true).description('是否启用合并转发功能'),
  forwardMode: Schema.union(['auto', 'manual', 'quote']).default('auto').description('转发模式'),
  maxImagesPerMessage: Schema.number().default(9).description('每条消息最大图片数量'),
  maxContentLength: Schema.number().default(500).description('每条消息最大内容长度'),
  
  // 高级配置
  userAgent: Schema.string().default('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36').description('自定义User-Agent'),
  enablePuppeteer: Schema.boolean().default(false).description('是否启用Puppeteer渲染'),
  puppeteerTimeout: Schema.number().default(30000).description('Puppeteer超时时间（毫秒）'),
  customHeaders: Schema.dict(String).description('自定义请求头'),
  
  // 过滤配置
  blockedKeywords: Schema.array(String).default([]).description('屏蔽关键词列表'),
  allowedDomains: Schema.array(String).default(['www.xiaohongshu.com', 'xhslink.com']).description('允许的域名列表'),
  minContentLength: Schema.number().default(10).description('最小内容长度'),
  
  // 群组配置
  allowedGroups: Schema.array(String).default([]).description('允许使用的群组列表'),
  adminGroups: Schema.array(String).default([]).description('管理员群组列表'),
  enableGroupWhitelist: Schema.boolean().default(false).description('是否启用群组白名单')
})

export function apply(ctx: Context, config: Config) {
  const client = new XHSClient(ctx, config)
  
  // 注册服务
  ;(ctx as any).service('xhsParser', client)
  
  // 注册指令
  ctx.command('xhs <url>', '解析小红书链接')
    .option('force', '-f 强制刷新缓存', { fallback: false })
    .option('mode', '-m <mode> 发送模式', { fallback: config.forwardMode })
    .action(async ({ session, options }, url) => {
      if (!url) {
        return '请提供小红书链接'
      }
      if (config.allowedDomains && !validateUrl(url, config.allowedDomains)) {
        return '链接域名不在允许列表'
      }
      
      // 检查群组权限
      if (config.enableGroupWhitelist && session?.channelId) {
        if (!config.allowedGroups?.includes(session.channelId) && 
            !config.adminGroups?.includes(session.channelId)) {
          return '该群组没有使用权限'
        }
      }
      
      try {
        // 解析URL
        const parsedUrl = parseXHSUrl(url)
        if (!parsedUrl) {
          return '无法识别的小红书链接格式'
        }
        
        // 获取内容
        const content = await client.getContent(parsedUrl.normalized, options?.force)
        if (!content) {
          return '无法获取内容，请检查链接是否有效'
        }
        const textForFilter = `${content.title}\n${content.description || ''}`
        if (config.minContentLength && textForFilter.length < config.minContentLength) {
          return '内容长度不足，已忽略'
        }
        if (config.blockedKeywords && !filterContent(textForFilter, config.blockedKeywords)) {
          return '内容包含屏蔽关键词，已忽略'
        }
        
        // 格式化并发送内容
        const formatted = formatContent(content, config)
        
        if (config.enableForward && options?.mode !== 'quote') {
          // 使用合并转发
          const forwardMsg = createForwardMessage(formatted, session?.userId || '0')
          return h('forward', { id: forwardMsg.id }, forwardMsg.content)
        } else {
          // 普通发送
          return formatted.content
        }
        
      } catch (error) {
        logger.error('解析失败:', error)
        // 避免泄露详细错误信息
        return '解析失败，请检查链接是否有效或稍后重试'
      }
    })
  
  // 监听消息中的链接
  ctx.middleware(async (session, next) => {
    if (!session.content || typeof session.content !== 'string') {
      return next()
    }
    
    // 检查群组权限
    if (config.enableGroupWhitelist && session.channelId) {
      if (!config.allowedGroups?.includes(session.channelId) && 
          !config.adminGroups?.includes(session.channelId)) {
        return next()
      }
    }
    
    // 检测小红书链接
    const xhsRegex = /(https?:\/\/(www\.)?xiaohongshu\.com\/[^\s]+|https?:\/\/xhslink\.com\/[^\s]+)/g
    const matches = session.content.match(xhsRegex)
    
    if (matches && config.forwardMode === 'auto') {
      try {
        const filteredMatches = matches.filter(u => !config.allowedDomains || validateUrl(u, config.allowedDomains))
        for (const u of filteredMatches) {
          const parsedUrl = parseXHSUrl(u)
          if (!parsedUrl) continue
          const content = await client.getContent(parsedUrl.normalized)
          if (!content) continue
          const textForFilter = `${content.title}\n${content.description || ''}`
          if (config.minContentLength && textForFilter.length < config.minContentLength) continue
          if (config.blockedKeywords && !filterContent(textForFilter, config.blockedKeywords)) continue
          const formatted = formatContent(content, config)
          if (config.enableForward) {
            const forwardMsg = createForwardMessage(formatted, session.userId || '0')
            await session.send(h('forward', { id: forwardMsg.id }, forwardMsg.content))
          } else {
            await session.send(formatted.content)
          }
        }
      } catch (error) {
        logger.error('自动解析失败:', error)
        // 静默处理错误，避免信息泄露
      }
    }
    
    return next()
  })
  
  // 注册管理指令
  ctx.command('xhs.cache <action>', '缓存管理')
    .option('clear', '-c 清空缓存')
    .option('size', '-s 查看缓存大小')
    .action(async ({ session, options }) => {
      if (!session?.channelId || !config.adminGroups?.includes(session.channelId)) {
        return '只有管理员群组可以使用此命令'
      }
      
      if (options?.clear) {
        await client.clearCache()
        return '缓存已清空'
      }
      
      if (options?.size) {
        const size = await client.getCacheSize()
        return `当前缓存大小: ${size} 条记录`
      }
      
      return '请指定操作: -c 清空缓存, -s 查看大小'
    })

  ctx.on('dispose', () => {
    client.dispose()
  })
}