import { Context, Logger, Time } from 'koishi'
import type { Config } from './index'
import { XHSContent, XHSMedia } from './types'
import {
  isPrivateIP,
  isLocalhost,
  sanitizeHtml,
  safeJsonParse,
  deduplicateMedia,
  hasPuppeteer
} from './utils'
import axios from 'axios'
import * as cheerio from 'cheerio'

// 常量定义
const MAX_CACHE_SIZE = 200 // LRU 缓存最大容量
const CACHE_CLEANUP_INTERVAL = Time.minute * 5

interface CacheEntry {
  data: XHSContent
  timestamp: number
  accessCount: number
}

export class XHSClient {
  private cache = new Map<string, CacheEntry>()
  private cacheAccessOrder: string[] = [] // LRU 跟踪
  private logger: Logger
  private cleanupTimer?: NodeJS.Timeout
  
  constructor(private ctx: Context, private config: Config) {
    this.logger = new Logger('xhs-client')
    this.startCacheCleanup()
  }
  
  async getContent(url: string, forceRefresh = false): Promise<XHSContent | null> {
    // 检查缓存
    if (!forceRefresh && this.config.enableCache) {
      const cached = this.getCachedContent(url)
      if (cached) {
        this.logger.debug('使用缓存内容')
        return cached
      }
    }
    
    try {
      let content: XHSContent | null
      
      if ((this.config.enablePuppeteer ?? false) && hasPuppeteer(this.ctx)) {
        content = await this.getContentWithPuppeteer(url)
      } else {
        content = await this.getContentWithAxios(url)
      }
      
      if (content && this.config.enableCache) {
        this.setCachedContent(url, content)
      }
      
      return content
    } catch (error) {
      this.logger.error('获取内容失败')
      if (this.config.enableDebugLog && error instanceof Error) {
        this.logger.debug('错误详情:', error.message)
      }
      throw new Error('内容获取失败')
    }
  }
  
  // LRU 缓存获取
  private getCachedContent(url: string): XHSContent | null {
    const cached = this.cache.get(url)
    if (!cached) return null
    
    const isExpired = Date.now() - cached.timestamp >= (this.config.cacheTimeout || Time.hour)
    if (isExpired) {
      this.cache.delete(url)
      this.removeFromAccessOrder(url)
      return null
    }
    
    // 更新访问顺序（LRU）
    cached.accessCount++
    this.updateAccessOrder(url)
    return cached.data
  }
  
  // LRU 缓存设置
  private setCachedContent(url: string, content: XHSContent): void {
    // 如果缓存已满，移除最少使用的项
    if (this.cache.size >= MAX_CACHE_SIZE && !this.cache.has(url)) {
      const lruKey = this.cacheAccessOrder[0]
      if (lruKey) {
        this.cache.delete(lruKey)
        this.cacheAccessOrder.shift()
      }
    }
    
    this.cache.set(url, {
      data: content,
      timestamp: Date.now(),
      accessCount: 1
    })
    this.updateAccessOrder(url)
  }
  
  // 更新访问顺序
  private updateAccessOrder(url: string): void {
    this.removeFromAccessOrder(url)
    this.cacheAccessOrder.push(url)
  }
  
  // 从访问顺序中移除
  private removeFromAccessOrder(url: string): void {
    const index = this.cacheAccessOrder.indexOf(url)
    if (index > -1) {
      this.cacheAccessOrder.splice(index, 1)
    }
  }
  
  private async getContentWithAxios(url: string): Promise<XHSContent | null> {
    const headers = {
      'User-Agent': this.config.userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      ...this.config.customHeaders
    }
    
    for (let attempt = 1; attempt <= (this.config.maxRetries || 3); attempt++) {
      try {
        const response = await axios.get(url, {
          headers,
          timeout: this.config.requestTimeout || 10000,
          maxRedirects: 5,
          // 安全配置：禁止跟随到内网重定向
          beforeRedirect: (options, response) => {
            const hostname = options.hostname?.toLowerCase()
            if (hostname && (isPrivateIP(hostname) || isLocalhost(hostname))) {
              throw new Error('禁止重定向到内网地址')
            }
          }
        })
        
        return this.parseContent(response.data, url)
      } catch (error) {
        this.logger.warn(`第 ${attempt} 次尝试失败:`, error)
        if (attempt === (this.config.maxRetries || 3)) {
          throw error
        }
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
      }
    }
    
    return null
  }
  
  private async getContentWithPuppeteer(url: string): Promise<XHSContent | null> {
    if (!hasPuppeteer(this.ctx)) {
      throw new Error('Puppeteer 服务未启用')
    }
    
    const page = await this.ctx.puppeteer.page()
    
    try {
      await page.setUserAgent(this.config.userAgent)
      
      // 安全配置：禁用不必要的功能
      await page.evaluateOnNewDocument(`
        // 禁用 navigator.webdriver
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
        });
        
        // 修改 permissions
        const originalQuery = navigator.permissions.query;
        navigator.permissions.query = (parameters) => (
          parameters.name === 'notifications' ?
            Promise.resolve({ state: Notification.permission }) :
            originalQuery(parameters)
        );
      `)
      
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: this.config.puppeteerTimeout || 30000
      })
      
      // 等待内容加载
      await page.waitForSelector('.note-content', { timeout: 10000 }).catch(() => {
        this.logger.debug('未找到.note-content，尝试其他选择器')
      })
      
      const content = await page.content()
      return this.parseContent(content, url)
    } finally {
      await page.close()
    }
  }
  
  private parseContent(html: string, url: string): XHSContent {
    // 清理HTML内容，移除潜在的安全风险
    const sanitizedHtml = sanitizeHtml(html)
    const $ = cheerio.load(sanitizedHtml)
    
    // 提取标题
    const title = $('meta[property="og:title"]').attr('content') ||
                  $('title').text()?.replace(' - 小红书', '') ||
                  '无标题'
    
    // 提取描述
    const description = $('meta[property="og:description"]').attr('content') ||
                       $('meta[name="description"]').attr('content') ||
                       ''
    
    // 提取关键词
    const keywords = $('meta[name="keywords"]').attr('content') ||
                    $('meta[property="og:keywords"]').attr('content') ||
                    ''
    
    // 提取图片
    const images: XHSMedia[] = []
    $('meta[property="og:image"]').each((_, element) => {
      const src = $(element).attr('content')
      if (src && src.startsWith('http')) {
        images.push({
          type: 'image',
          url: src,
          width: 0,
          height: 0
        })
      }
    })
    
    // 提取视频 - 增强版本
    const videos: XHSMedia[] = []
    
    // 从 og:video 标签提取基础视频信息
    $('meta[property="og:video"]').each((_, element) => {
      const src = $(element).attr('content')
      const type = $(element).attr('type') || ''
      const width = parseInt($(element).attr('width') || '0') || 0
      const height = parseInt($(element).attr('height') || '0') || 0
      
      if (src && src.startsWith('http')) {
        videos.push({
          type: 'video',
          url: src,
          width,
          height,
          duration: 0,
          format: type.includes('mp4') ? 'mp4' : type.includes('mov') ? 'mov' : 'unknown'
        })
      }
    })
    
    // 从 video 标签提取更详细的视频信息
    $('video source').each((_, element) => {
      const src = $(element).attr('src')
      const type = $(element).attr('type') || ''
      
      if (src && (src.startsWith('http') || src.startsWith('//'))) {
        const fullUrl = src.startsWith('//') ? 'https:' + src : src
        videos.push({
          type: 'video',
          url: fullUrl,
          width: 0,
          height: 0,
          duration: 0,
          format: type.includes('mp4') ? 'mp4' : type.includes('mov') ? 'mov' : 'unknown'
        })
      }
    })
    
    // 从 JSON-LD 数据中提取视频信息
    $('script[type="application/ld+json"]').each((_, element) => {
      const text = $(element).text() || ''
      const json = safeJsonParse(text)
      if (json && json.video) {
        const videoArray = Array.isArray(json.video) ? json.video : [json.video]
        videoArray.forEach((video: any) => {
          if (video.contentUrl || video.url) {
            const url = video.contentUrl || video.url
            if (url && typeof url === 'string' && url.startsWith('http')) {
              videos.push({
                type: 'video',
                url,
                width: typeof video.width === 'number' && video.width > 0 ? video.width : 0,
                height: typeof video.height === 'number' && video.height > 0 ? video.height : 0,
                duration: typeof video.duration === 'number' && video.duration > 0 ? video.duration : 0,
                format: video.encodingFormat || 'unknown'
              })
            }
          }
        })
      }
    })
    
    // 尝试从脚本中提取更详细的数据
    const scriptData = this.extractScriptData($)
    
    // 提取元数据
    const metadata = this.extractMetadata($)
    
    const allImages = deduplicateMedia([...(images || []), ...((scriptData.images as XHSMedia[]) || [])])
    const allVideos = deduplicateMedia([...(videos || []), ...((scriptData.videos as XHSMedia[]) || [])])

    return {
      title: title.trim(),
      description: description.trim(),
      keywords: keywords.split(',').map(k => k.trim()).filter(k => k),
      images: allImages,
      videos: allVideos,
      url: url,
      author: scriptData.author || metadata.author || '未知作者',
      publishTime: scriptData.publishTime || metadata.publishTime || Date.now(),
      stats: {
        likes: (scriptData.likes ?? metadata.likes ?? 0) as number,
        collects: (scriptData.collects ?? metadata.collects ?? 0) as number,
        comments: (scriptData.comments ?? metadata.comments ?? 0) as number,
        shares: (scriptData.shares ?? metadata.shares ?? 0) as number
      }
    }
  }
  
  private extractScriptData($: cheerio.CheerioAPI): any {
    const scripts = $('script[type="application/ld+json"]')
    const result: any = {
      images: [] as XHSMedia[],
      videos: [] as XHSMedia[],
      author: undefined as string | undefined,
      publishTime: undefined as number | undefined,
      likes: undefined as number | undefined,
      collects: undefined as number | undefined,
      comments: undefined as number | undefined,
      shares: undefined as number | undefined,
    }

    const asArray = (input: any): any[] => Array.isArray(input) ? input : (input ? [input] : [])

    const normalizeImages = (input: any): XHSMedia[] => {
      return asArray(input).map((it: any) => {
        if (typeof it === 'string') {
          return { type: 'image', url: it, width: 0, height: 0 } as XHSMedia
        } else if (it && typeof it === 'object') {
          const url = it.url || it.contentUrl || it.thumbnailUrl
          const width = typeof it.width === 'number' ? it.width : 0
          const height = typeof it.height === 'number' ? it.height : 0
          return url ? ({ type: 'image', url, width, height } as XHSMedia) : null
        }
        return null
      }).filter(Boolean) as XHSMedia[]
    }

    const normalizeVideos = (input: any): XHSMedia[] => {
      return asArray(input).map((it: any) => {
        if (typeof it === 'string') {
          return { type: 'video', url: it, width: 0, height: 0, duration: 0, format: 'unknown' } as XHSMedia
        } else if (it && typeof it === 'object') {
          const url = it.contentUrl || it.url || it.embedUrl || it.src
          const width = typeof it.width === 'number' ? it.width : 0
          const height = typeof it.height === 'number' ? it.height : 0
          const duration = typeof it.duration === 'number' ? it.duration : 0
          const format = it.encodingFormat || it.format || (url.includes('.mp4') ? 'mp4' : url.includes('.mov') ? 'mov' : 'unknown')
          return url ? ({ type: 'video', url, width, height, duration, format } as XHSMedia) : null
        }
        return null
      }).filter(Boolean) as XHSMedia[]
    }

    scripts.each((_, element) => {
      const text = $(element).text() || $(element).html() || ''
      if (!text.trim()) return
      
      const json = safeJsonParse(text)
      if (!json) return
      
      const items = Array.isArray(json) ? json : [json]
      for (const item of items) {
        if (!result.author) {
          result.author = typeof item.author === 'string' ? item.author : item.author?.name
        }
        if (!result.publishTime && item.datePublished) {
          const t = new Date(item.datePublished)
          if (!Number.isNaN(t.getTime())) result.publishTime = t.getTime()
        }
        if (item.interactionStatistic && Array.isArray(item.interactionStatistic)) {
          for (const s of item.interactionStatistic) {
            const type = typeof s.interactionType === 'string' ? s.interactionType : (s.interactionType?.['@type'] || '')
            const count = Number(s.userInteractionCount) || 0
            if (/LikeAction/i.test(type)) result.likes = Math.max(result.likes || 0, count)
            if (/CommentAction/i.test(type)) result.comments = Math.max(result.comments || 0, count)
            if (/ShareAction/i.test(type)) result.shares = Math.max(result.shares || 0, count)
            if (/CollectAction|SaveAction/i.test(type)) result.collects = Math.max(result.collects || 0, count)
          }
        }
        result.images.push(...normalizeImages(item.image))
        result.videos.push(...normalizeVideos(item.video || item.videoObject))
      }
    })

    result.images = deduplicateMedia(result.images)
    result.videos = deduplicateMedia(result.videos)
    return result
  }
  
  private extractMetadata($: cheerio.CheerioAPI): any {
    return {
      author: $('meta[property="og:xhs:note_author"]').attr('content'),
      likes: parseInt($('meta[property="og:xhs:note_like"]').attr('content') || '0'),
      collects: parseInt($('meta[property="og:xhs:note_collect"]').attr('content') || '0'),
      comments: parseInt($('meta[property="og:xhs:note_comment"]').attr('content') || '0'),
      shares: parseInt($('meta[property="og:xhs:note_share"]').attr('content') || '0')
    }
  }
  
  async clearCache(): Promise<void> {
    this.cache.clear()
    this.logger.info('缓存已清空')
  }
  
  async getCacheSize(): Promise<number> {
    return this.cache.size
  }

  private startCacheCleanup(): void {
    if (!this.config.enableCache) return

    this.cleanupTimer = setInterval(() => {
      const now = Date.now()
      const timeout = this.config.cacheTimeout || Time.hour
      let cleaned = 0

      for (const [key, value] of this.cache.entries()) {
        if (now - value.timestamp > timeout) {
          this.cache.delete(key)
          this.removeFromAccessOrder(key)
          cleaned++
        }
      }

      if (cleaned > 0) {
        this.logger.debug(`清理了 ${cleaned} 条过期缓存`)
      }
    }, CACHE_CLEANUP_INTERVAL)
  }

  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = undefined
    }
  }
}