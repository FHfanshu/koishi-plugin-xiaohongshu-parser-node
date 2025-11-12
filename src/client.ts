import { Context, Logger, Time } from 'koishi'
import type { Config } from './index'
import { XHSContent, XHSNote, XHSMedia } from './types'
import axios from 'axios'
import * as cheerio from 'cheerio'

export class XHSClient {
  private cache = new Map<string, { data: XHSContent; timestamp: number }>()
  private logger: Logger
  private cleanupTimer?: NodeJS.Timeout
  
  constructor(private ctx: Context, private config: Config) {
    this.logger = new Logger('xhs-client')
    this.startCacheCleanup()
  }
  
  async getContent(url: string, forceRefresh = false): Promise<XHSContent | null> {
    // 检查缓存
    if (!forceRefresh && this.config.enableCache) {
      const cached = this.cache.get(url)
      if (cached && Date.now() - cached.timestamp < (this.config.cacheTimeout || 3600000)) {
        this.logger.debug('使用缓存内容')
        return cached.data
      }
    }
    
    try {
      let content: XHSContent | null
      
      if ((this.config.enablePuppeteer ?? false) && (this.ctx as any).puppeteer) {
        content = await this.getContentWithPuppeteer(url)
      } else {
        content = await this.getContentWithAxios(url)
      }
      
      if (content && this.config.enableCache) {
        this.cache.set(url, { data: content, timestamp: Date.now() })
      }
      
      return content
    } catch (error) {
      this.logger.error('获取内容失败:', error)
      return null
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
          maxRedirects: 5
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
    if (!(this.ctx as any).puppeteer) {
      throw new Error('Puppeteer 服务未启用')
    }
    
    const page = await (this.ctx as any).puppeteer.page()
    
    try {
      await page.setUserAgent(this.config.userAgent)
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
    const $ = cheerio.load(html)
    
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
    
    // 提取视频
    const videos: XHSMedia[] = []
    $('meta[property="og:video"]').each((_, element) => {
      const src = $(element).attr('content')
      if (src && src.startsWith('http')) {
        videos.push({
          type: 'video',
          url: src,
          duration: 0
        })
      }
    })
    
    // 尝试从脚本中提取更详细的数据
    const scriptData = this.extractScriptData($)
    
    // 提取元数据
    const metadata = this.extractMetadata($)
    
    const uniqueByUrl = (list: XHSMedia[]): XHSMedia[] => {
      const seen = new Set<string>()
      const out: XHSMedia[] = []
      for (const m of list) {
        if (!m?.url) continue
        if (seen.has(m.url)) continue
        seen.add(m.url)
        out.push(m)
      }
      return out
    }

    const allImages = uniqueByUrl([...(images || []), ...((scriptData.images as XHSMedia[]) || [])])
    const allVideos = uniqueByUrl([...(videos || []), ...((scriptData.videos as XHSMedia[]) || [])])

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
          return { type: 'video', url: it, duration: 0 } as XHSMedia
        } else if (it && typeof it === 'object') {
          const url = it.contentUrl || it.url || it.embedUrl
          const duration = typeof it.duration === 'number' ? it.duration : 0
          return url ? ({ type: 'video', url, duration } as XHSMedia) : null
        }
        return null
      }).filter(Boolean) as XHSMedia[]
    }

    scripts.each((_, element) => {
      try {
        const text = $(element).text() || $(element).html() || ''
        if (!text.trim()) return
        const json = JSON.parse(text)
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
      } catch (error) {
        this.logger.debug('脚本数据解析失败:', error)
      }
    })

    const dedup = (arr: XHSMedia[]) => {
      const seen = new Set<string>()
      const out: XHSMedia[] = []
      for (const m of arr) {
        if (!m?.url) continue
        if (seen.has(m.url)) continue
        seen.add(m.url)
        out.push(m)
      }
      return out
    }

    result.images = dedup(result.images)
    result.videos = dedup(result.videos)
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
      let cleaned = 0

      for (const [key, value] of this.cache.entries()) {
        if (now - value.timestamp > (this.config.cacheTimeout || 3600000)) {
          this.cache.delete(key)
          cleaned++
        }
      }

      if (cleaned > 0) {
        this.logger.debug(`清理了 ${cleaned} 条过期缓存`)
      }
    }, Time.minute * 5)
  }

  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = undefined
    }
  }
}