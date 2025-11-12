import { Context, Schema, h, Logger, Session, Time } from 'koishi'
import { XHSClient } from './client'
import {
  parseXHSUrl,
  formatContent,
  createForwardMessage,
  validateUrl,
  filterContent,
  createErrorMessage,
  createSuccessMessage
} from './utils'

const DEFAULT_ALLOWED_DOMAINS = ['xiaohongshu.com', 'www.xiaohongshu.com', 'xhslink.com'] as const
const MAX_LINK_LENGTH = 500 // 单个链接最大长度
const MAX_CONCURRENT_PARSES = 3 // 最大并发解析数

type SendMode = 'forward' | 'plain'

declare module 'koishi' {
  interface Context {
    xhsParser: XHSClient
  }
}

export const name = 'xiaohongshu-parser-node'
export const logger = new Logger('xiaohongshu-parser')

export interface Config {
  autoParse?: boolean
  sendMode?: SendMode
  includeMetadata?: boolean
  maxContentLength?: number
  maxImagesPerMessage?: number
  allowedDomains?: string[]
  blockedKeywords?: string[]
  minContentLength?: number
  enableCache?: boolean
  cacheTimeout?: number
  maxRetries?: number
  requestTimeout?: number
  userAgent?: string
  customHeaders?: Record<string, string>
  enablePuppeteer?: boolean
  puppeteerTimeout?: number
  whitelistEnabled?: boolean
  allowedGroups?: string[]
  adminGroups?: string[]
  enableDebugLog?: boolean
  extractText?: boolean
  downloadImages?: boolean
  downloadVideos?: boolean
  maxVideosPerMessage?: number
  showVideoMetadata?: boolean
  videoQualityPreference?: 'high' | 'medium' | 'low'
  enableVideoThumbnail?: boolean
  videoResolutionPreference?: 'high' | 'medium' | 'low'
  enableVideoSubtitle?: boolean
  enableVideoAudio?: boolean
}

export const Config: Schema<Config> = Schema.object({
  autoParse: Schema.boolean().default(true).description('是否自动解析聊天中的小红书链接'),
  sendMode: Schema.union(['forward', 'plain']).default('forward').description('消息发送模式'),
  includeMetadata: Schema.boolean().default(true).description('是否包含点赞、收藏等元数据'),
  maxContentLength: Schema.number().default(500).description('文本内容最大长度'),
  maxImagesPerMessage: Schema.number().default(9).description('每条消息的最大图片数量'),
  allowedDomains: Schema.array(String).default([...DEFAULT_ALLOWED_DOMAINS]).description('允许解析的域名'),
  blockedKeywords: Schema.array(String).default([]).description('命中后跳过的关键词'),
  minContentLength: Schema.number().default(0).description('内容最小长度，低于该长度将跳过发送'),
  enableCache: Schema.boolean().default(true).description('是否启用内容缓存'),
  cacheTimeout: Schema.number().default(Time.hour).description('缓存有效期（毫秒）'),
  maxRetries: Schema.number().default(3).description('请求最大重试次数'),
  requestTimeout: Schema.number().default(10000).description('请求超时时间（毫秒）'),
  userAgent: Schema.string().default('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36').description('HTTP 请求的 User-Agent'),
  customHeaders: Schema.dict(String).default({}).description('额外的自定义请求头'),
  enablePuppeteer: Schema.boolean().default(false).description('是否启用 Puppeteer 渲染'),
  puppeteerTimeout: Schema.number().default(30000).description('Puppeteer 渲染超时时间（毫秒）'),
  whitelistEnabled: Schema.boolean().default(false).description('是否仅允许白名单群组自动解析'),
  allowedGroups: Schema.array(String).default([]).description('允许自动解析的群组列表'),
  adminGroups: Schema.array(String).default([]).description('具备管理权限的群组'),
  enableDebugLog: Schema.boolean().default(false).description('是否输出调试日志'),
  extractText: Schema.boolean().default(true).description('是否提取文本内容'),
  downloadImages: Schema.boolean().default(true).description('是否下载图片'),
  downloadVideos: Schema.boolean().default(true).description('是否下载视频'),
  maxVideosPerMessage: Schema.number().default(3).description('每条消息的最大视频数量'),
  showVideoMetadata: Schema.boolean().default(true).description('是否显示视频元数据（时长、分辨率等）'),
  videoQualityPreference: Schema.union(['high', 'medium', 'low']).default('medium').description('视频质量偏好'),
  enableVideoThumbnail: Schema.boolean().default(true).description('是否启用视频缩略图'),
  videoResolutionPreference: Schema.union(['high', 'medium', 'low']).default('medium').description('视频分辨率偏好'),
  enableVideoSubtitle: Schema.boolean().default(true).description('是否启用视频字幕'),
  enableVideoAudio: Schema.boolean().default(true).description('是否启用视频音频'),
})

// 使用更安全的正则，限制匹配长度防止 DoS
const XHS_LINK_REGEX = /(https?:\/\/(?:www\.)?xiaohongshu\.com\/[^\s]{1,400}|https?:\/\/xhslink\.com\/[^\s]{1,400})/gi

interface PreparedLink {
  title: string
  normalizedUrl: string
  formatted: ReturnType<typeof formatContent>
}

function getAllowedDomains(config: Config): string[] {
  if (config.allowedDomains && config.allowedDomains.length > 0) {
    return config.allowedDomains
  }
  return Array.from(DEFAULT_ALLOWED_DOMAINS)
}

function extractLinks(text: string): string[] {
  if (!text) return []
  
  // 防止超长文本导致正则性能问题
  const maxTextLength = 50000
  const safeText = text.length > maxTextLength ? text.substring(0, maxTextLength) : text
  
  const matches = safeText.match(XHS_LINK_REGEX)
  if (!matches) return []
  
  const seen = new Set<string>()
  const result: string[] = []
  
  for (const raw of matches) {
    const url = raw.trim()
    // 检查长度
    if (!url || url.length > MAX_LINK_LENGTH || seen.has(url)) continue
    seen.add(url)
    result.push(url)
  }
  
  return result
}

function normalizeConfig(config: Config): Config {
  const normalized: Config = { ...config }
  const legacy = config as {
    enableGroupWhitelist?: boolean
    enableForward?: boolean
    forwardMode?: string
  }

  if (normalized.whitelistEnabled === undefined && typeof legacy.enableGroupWhitelist === 'boolean') {
    normalized.whitelistEnabled = legacy.enableGroupWhitelist
  }

  if (typeof legacy.enableForward === 'boolean') {
    normalized.sendMode = legacy.enableForward ? 'forward' : 'plain'
  }

  if (typeof legacy.forwardMode === 'string') {
    const mode = legacy.forwardMode.toLowerCase()
    if (mode === 'manual') {
      normalized.autoParse = false
    } else if (mode === 'quote') {
      normalized.sendMode = 'plain'
    }
  }

  normalized.autoParse ??= true
  normalized.sendMode ??= 'forward'
  normalized.includeMetadata ??= true
  normalized.maxContentLength ??= 500
  normalized.maxImagesPerMessage ??= 9
  normalized.allowedDomains = getAllowedDomains(normalized)
  normalized.blockedKeywords ??= []
  normalized.minContentLength ??= 0
  normalized.enableCache ??= true
  normalized.cacheTimeout ??= Time.hour
  normalized.maxRetries ??= 3
  normalized.requestTimeout ??= 10000
  normalized.userAgent ??= 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  normalized.customHeaders ??= {}
  normalized.enablePuppeteer ??= false
  normalized.puppeteerTimeout ??= 30000
  normalized.whitelistEnabled ??= false
  normalized.allowedGroups ??= []
  normalized.adminGroups ??= []
  normalized.enableDebugLog ??= false
  normalized.extractText ??= true
  normalized.downloadImages ??= true
  normalized.downloadVideos ??= true

  return normalized
}

function parseSendMode(input: unknown): SendMode | null {
  if (typeof input !== 'string') return null
  const value = input.trim().toLowerCase()
  if (value === 'forward' || value === 'plain') {
    return value
  }
  return null
}

async function prepareLink(url: string, config: Config, client: XHSClient, options: { forceRefresh?: boolean } = {}): Promise<PreparedLink | null> {
  const allowedDomains = getAllowedDomains(config)

  if (!validateUrl(url, allowedDomains)) {
    if (config.enableDebugLog) {
      logger.debug(`链接未通过域名校验，跳过: ${url}`)
    }
    return null
  }

  const parsedUrl = parseXHSUrl(url)
  if (!parsedUrl) {
    if (config.enableDebugLog) {
      logger.debug(`无法解析链接结构，跳过: ${url}`)
    }
    return null
  }

  const content = await client.getContent(parsedUrl.normalized, options.forceRefresh ?? false)
  if (!content) {
    if (config.enableDebugLog) {
      logger.debug(`内容获取失败，跳过: ${parsedUrl.normalized}`)
    }
    return null
  }

  const textForFilter = `${content.title}\n${content.description || ''}`
  const minLength = config.minContentLength ?? 0
  if (minLength > 0 && textForFilter.length < minLength) {
    if (config.enableDebugLog) {
      logger.debug(`内容长度不足（${textForFilter.length} < ${minLength}），跳过: ${parsedUrl.normalized}`)
    }
    return null
  }

  if (config.blockedKeywords && config.blockedKeywords.length > 0 && !filterContent(textForFilter, config.blockedKeywords)) {
    if (config.enableDebugLog) {
      logger.debug(`内容命中屏蔽词，跳过: ${parsedUrl.normalized}`)
    }
    return null
  }

  const formatted = formatContent(content, config)
  return {
    title: content.title,
    normalizedUrl: parsedUrl.normalized,
    formatted,
  }
}

async function dispatchContent(session: Session, formatted: ReturnType<typeof formatContent>, config: Config): Promise<void> {
  try {
    if (config.sendMode === 'forward') {
      const forwardMsg = createForwardMessage(formatted, session.userId || '0', config)
      await session.send(h('forward', { id: forwardMsg.id }, forwardMsg.content))
      return
    }
    await session.send(formatted.content)
  } catch (error) {
    logger.error('发送消息失败')
    if (config.enableDebugLog && error instanceof Error) {
      logger.debug('错误详情:', error.message)
    }
    throw error
  }
}

// 检查群组权限
function isAuthorizedGroup(session: Session, config: Config): boolean {
  if (!config.whitelistEnabled || !session.channelId) {
    return true
  }
  return config.allowedGroups?.includes(session.channelId) ||
         config.adminGroups?.includes(session.channelId) ||
         false
}

// 提取链接来源
function extractLinkSources(session: Session, config: Config): string[] {
  const sources: string[] = []
  
  // 1. 主消息内容
  if (session.content && typeof session.content === 'string') {
    sources.push(session.content)
    if (config.enableDebugLog) {
      logger.debug('从主消息内容中提取文本')
    }
  }
  
  // 2. 消息元素
  if (session.elements && Array.isArray(session.elements)) {
    if (config.enableDebugLog) {
      logger.debug(`检测到 ${session.elements.length} 个消息元素`)
    }
    for (const element of session.elements) {
      if (typeof element === 'object' && element) {
        const text = (element as any).text || (element as any).content || (element as any).data
        if (typeof text === 'string') {
          sources.push(text)
        }
      }
    }
  }
  
  // 3. 引用消息
  if (session.quote && session.quote.content) {
    sources.push(String(session.quote.content))
    if (config.enableDebugLog) {
      logger.debug('从引用消息中提取文本')
    }
  }
  
  return sources
}

// 并发控制：限制同时解析的链接数量
async function parseLinksWithLimit(
  urls: string[],
  config: Config,
  client: XHSClient,
  callback: (prepared: PreparedLink) => Promise<void>
): Promise<void> {
  const results = new Set<string>()
  
  // 分批处理，每批 MAX_CONCURRENT_PARSES 个
  for (let i = 0; i < urls.length; i += MAX_CONCURRENT_PARSES) {
    const batch = urls.slice(i, i + MAX_CONCURRENT_PARSES)
    const promises = batch.map(async (url) => {
      try {
        const prepared = await prepareLink(url, config, client)
        if (!prepared || results.has(prepared.normalizedUrl)) return
        results.add(prepared.normalizedUrl)
        await callback(prepared)
      } catch (error) {
        logger.error(`解析链接失败: ${url}`)
        if (config.enableDebugLog && error instanceof Error) {
          logger.debug('错误详情:', error.message)
        }
      }
    })
    await Promise.allSettled(promises)
  }
}

export function apply(ctx: Context, config: Config) {
  const runtimeConfig = normalizeConfig(config)
  const client = new XHSClient(ctx, runtimeConfig)

  // 注册服务
  ctx.inject(['xhsParser'], (ctx) => {
    ;(ctx as any).xhsParser = client
  })
  
  // 监听消息中的链接
  ctx.middleware(async (session, next) => {
    if (!config.autoParse) {
      return next()
    }

    // 检查群组权限
    if (!isAuthorizedGroup(session, config)) {
      if (config.enableDebugLog) {
        logger.debug(`群组 ${session.channelId} 不在白名单中，跳过处理`)
      }
      return next()
    }

    // 提取链接来源
    const linkSources = extractLinkSources(session, config)
    if (linkSources.length === 0) {
      if (config.enableDebugLog) {
        logger.debug('未找到任何文本内容，跳过处理')
      }
      return next()
    }

    // 合并并检测链接
    const combinedText = linkSources.join('\n')
    const matches = extractLinks(combinedText)

    if (config.enableDebugLog) {
      logger.debug(`检测到 ${matches.length} 个小红书链接`)
    }

    if (matches.length === 0) {
      return next()
    }

    // 并发解析链接
    await parseLinksWithLimit(matches, config, client, async (prepared) => {
      if (config.enableDebugLog) {
        logger.debug(`发送已解析内容: ${prepared.title}`)
      }
      await dispatchContent(session, prepared.formatted, config)
    })

    return next()
  })
  
  // 手动触发指令
  ctx.command('xhs <url:string>', '手动解析小红书链接')
    .option('refresh', '-f, --refresh 强制刷新缓存')
    .option('mode', '-m <mode:string> 指定发送模式 (forward/plain)')
    .action(async ({ session, options }, url) => {
      if (!session) return
      const target = url?.trim()
      if (!target) {
        return createErrorMessage('请提供有效的小红书链接')
      }

      const sendMode = options?.mode ? parseSendMode(options.mode) : null

      try {
        const prepared = await prepareLink(target, runtimeConfig, client, { forceRefresh: !!options?.refresh })
        if (!prepared) {
          return createErrorMessage('链接无效或解析失败')
        }

        const dispatchConfig = sendMode ? { ...runtimeConfig, sendMode } : runtimeConfig
        await dispatchContent(session, prepared.formatted, dispatchConfig)
        return createSuccessMessage(prepared.title)
      } catch (error) {
        logger.error(`手动解析失败: ${target}`, error)
        return createErrorMessage('解析过程中发生错误')
      }
    })
  
  // 注册管理指令
  ctx.command('xhs.cache <action>', '缓存管理')
    .option('clear', '-c 清空缓存')
    .option('size', '-s 查看缓存大小')
    .action(async ({ session, options }) => {
      if (!session?.channelId || !runtimeConfig.adminGroups?.includes(session.channelId)) {
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