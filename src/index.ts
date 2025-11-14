import { Context, Schema, h } from 'koishi'
import { BasicXHSClient } from './client'
import {
  DEFAULT_ALLOWED_DOMAINS,
  normalizeInputUrl,
  renderBasicNote,
  createErrorMessage,
  extractCandidateUrls,
  sanitizeExtractedUrl
} from './utils'
import type { BasicClientConfig } from './types'

export const name = 'xiaohongshu-parser-node'

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export interface Config {
  allowedDomains?: string[]
  userAgent?: string
  requestTimeout?: number
  maxRetries?: number
  customHeaders?: Record<string, string>
  enableLog?: boolean
  enableForward?: boolean
  maxUrlsPerMessage?: number
  autoParseGuilds?: string[]
  autoParseUsers?: string[]
}

export const Config: Schema<Config> = Schema.object({
  allowedDomains: Schema.array(String)
    .description('允许解析的小红书域名')
    .default([...DEFAULT_ALLOWED_DOMAINS]),
  userAgent: Schema.string()
    .description('HTTP 请求使用的 User-Agent')
    .default(DEFAULT_USER_AGENT),
  requestTimeout: Schema.number()
    .description('请求超时时间（毫秒）')
    .default(10000),
  maxRetries: Schema.number()
    .description('请求失败后的重试次数')
    .default(3),
  customHeaders: Schema.dict(String)
    .description('额外的请求头')
    .default({}),
  enableLog: Schema.boolean()
    .description('输出解析过程和结果日志')
    .default(false),
  enableForward: Schema.boolean()
    .description('启用自动合并转发（检测到多条小红书链接时）')
    .default(false),
  maxUrlsPerMessage: Schema.number()
    .description('单条消息中最多处理的链接数量')
    .default(5),
  autoParseGuilds: Schema.array(String)
    .description('自动解析白名单群聊（guildId 或 platform:guildId）')
    .default([]),
  autoParseUsers: Schema.array(String)
    .description('自动解析白名单私聊（userId 或 platform:userId）')
    .default([])
})

declare module 'koishi' {
  interface Context {
    xhsBasicClient?: BasicXHSClient
  }
}

function createClientConfig(config: Config): BasicClientConfig {
  return {
    allowedDomains: config.allowedDomains ?? [...DEFAULT_ALLOWED_DOMAINS],
    userAgent: config.userAgent ?? DEFAULT_USER_AGENT,
    requestTimeout: config.requestTimeout ?? 10000,
    maxRetries: config.maxRetries ?? 3,
    customHeaders: config.customHeaders ?? {},
    enableLog: config.enableLog ?? false
  }
}

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger('xiaohongshu-parser-node')
  const client = new BasicXHSClient(createClientConfig(config))
  ctx.xhsBasicClient = client

  ctx.command('xhs <url:text>', '解析小红书笔记')
    .option('raw', '-r 输出纯文本')
    .option('merge', '-m 合并转发多个链接')
    .action(async ({ options }, url) => {
      if (!url) {
        return createErrorMessage('请提供要解析的小红书链接')
      }

      try {
        if (options?.merge) {
          return await handleMultipleUrls(ctx, url, config)
        } else {
          return await handleSingleUrl(url, config)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '解析失败'
        if (config.enableLog) {
          logger.error(`解析失败: ${message}`)
        }
        return createErrorMessage(message)
      }
    })

  // Auto-forwarding middleware
  if (config.enableForward) {
    ctx.middleware(async (session, next) => {
      const content = session.content
      if (!content || !session.userId) {
        return next()
      }

      const urls = extractXhsUrlsFromText(content)
      if (!urls.length) {
        return next()
      }

      // 仅对白名单会话启用自动解析，其他场景不再提供多链接兼容模式
      const isWhitelisted = isInAutoParseWhitelist(session, config)
      if (!isWhitelisted) {
        return next()
      }

      const limitedUrls = urls.slice(0, config.maxUrlsPerMessage ?? 5)

      if (config.enableLog) {
        logger.info(`检测到 ${limitedUrls.length} 个小红书链接，模式：白名单自动解析`)
      }

      try {
        let result: h.Fragment
        if (limitedUrls.length === 1) {
          result = await handleSingleUrl(limitedUrls[0], config)
        } else {
          result = await handleMultipleUrls(ctx, limitedUrls.join(' '), config)
        }
        await session.send(result)
        return
      } catch (error) {
        if (config.enableLog) {
          logger.error(`自动转发失败: ${error instanceof Error ? error.message : String(error)}`)
        }
        return next()
      }
    })
  }

  ctx.on('dispose', () => {
    if (ctx.xhsBasicClient) {
      delete ctx.xhsBasicClient
    }
  })
}

async function handleSingleUrl(url: string, config: Config): Promise<h.Fragment> {
  const normalizedUrl = normalizeInputUrl(url, config.allowedDomains ?? DEFAULT_ALLOWED_DOMAINS)
  if (!normalizedUrl) {
    return createErrorMessage('链接无效或不在允许的域名中')
  }

  const client = new BasicXHSClient(createClientConfig(config))

  if (config.enableLog) {
    console.log(`开始解析链接: ${normalizedUrl}`)
  }

  const note = await client.getBasicNote(normalizedUrl)
  const videoCount = note.videos?.length ?? 0
  const extraVideoInfo = videoCount > 0 ? `，含 ${videoCount} 个视频` : ''

  if (config.enableLog) {
    console.log(`解析成功: ${note.title}（共 ${note.images.length} 张图片${extraVideoInfo}）`)
  }

  const rendered = renderBasicNote(note)

  if (config.enableForward) {
    return h('message', { forward: true }, rendered)
  }

  return rendered
}

async function handleMultipleUrls(ctx: Context, text: string, config: Config): Promise<h.Fragment> {
  const urls = extractXhsUrlsFromText(text)
  const limitedUrls = urls.slice(0, config.maxUrlsPerMessage ?? 5)

  if (limitedUrls.length === 0) {
    return createErrorMessage('未找到有效的小红书链接')
  }

  if (limitedUrls.length === 1) {
    return await handleSingleUrl(limitedUrls[0], config)
  }

  const client = new BasicXHSClient(createClientConfig(config))
  const messages: h.Fragment[] = []

  for (const url of limitedUrls) {
    try {
      const normalizedUrl = normalizeInputUrl(url, config.allowedDomains ?? DEFAULT_ALLOWED_DOMAINS)
      if (!normalizedUrl) {
        messages.push(createErrorMessage(`无效链接: ${url}`))
        continue
      }

      if (config.enableLog) {
        console.log(`解析链接: ${normalizedUrl}`)
      }

      const note = await client.getBasicNote(normalizedUrl)
      const videoCount = note.videos?.length ?? 0
      const extraVideoInfo = videoCount > 0 ? `，含 ${videoCount} 个视频` : ''

      if (config.enableLog) {
        console.log(`解析成功: ${note.title}（共 ${note.images.length} 张图片${extraVideoInfo}）`)
      }

      messages.push(renderBasicNote(note))
    } catch (error) {
      const message = error instanceof Error ? error.message : '解析失败'
      if (config.enableLog) {
        console.log(`解析失败: ${url} - ${message}`)
      }
      messages.push(createErrorMessage(`解析失败: ${url}`))
    }
  }

  // 使用 forward 标记让支持的平台以转发消息的形式展示多条解析结果
  return h('message', { forward: true }, ...messages)
}

function extractXhsUrlsFromText(text: string): string[] {
  const candidates = extractCandidateUrls(text)
  return candidates
    .map(url => sanitizeExtractedUrl(url))
    .filter((url): url is string => {
      if (!url) return false
      const normalized = normalizeInputUrl(url, DEFAULT_ALLOWED_DOMAINS)
      return normalized !== null
    })
}

function isInAutoParseWhitelist(session: any, config: Config): boolean {
  const platform = typeof session.platform === 'string' ? session.platform : ''
  const channelId = typeof session.channelId === 'string' ? session.channelId : undefined
  const guildId = typeof session.guildId === 'string' ? session.guildId : undefined
  const userId = typeof session.userId === 'string' ? session.userId : undefined

  if (matchIdWithPlatform(channelId, platform, config.autoParseGuilds)) return true
  if (matchIdWithPlatform(guildId, platform, config.autoParseGuilds)) return true
  if (matchIdWithPlatform(userId, platform, config.autoParseUsers)) return true

  return false
}

function matchIdWithPlatform(id: string | undefined, platform: string, list?: string[]): boolean {
  if (!id || !list || !list.length) return false

  for (const entry of list) {
    if (!entry) continue
    if (entry.includes(':')) {
      if (entry === `${platform}:${id}`) return true
    } else if (entry === id) {
      return true
    }
  }

  return false
}
