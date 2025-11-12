import { h } from 'koishi'
import { ParsedURL, XHSContent, XHSMedia, FormattedContent, ForwardMessage } from './types'
import type { Config } from './index'

// 常量定义
const MAX_URL_LENGTH = 2048
const MAX_JSON_SIZE = 1024 * 1024 // 1MB
const MAX_LINK_MATCH_LENGTH = 500 // 单个链接最大长度

export function parseXHSUrl(url: string): ParsedURL | null {
  // 清理URL
  url = url.trim()
  
  // 基础安全检查：限制URL长度
  if (url.length > MAX_URL_LENGTH) {
    return null
  }
  
  // 检查是否包含危险字符
  if (/[<>"'\\]/.test(url)) {
    return null
  }
  
  // 小红书短链接
  const shortLinkMatch = url.match(/xhslink\.com\/([a-zA-Z0-9]+)/)
  if (shortLinkMatch) {
    return {
      original: url,
      normalized: url,
      type: 'note',
      id: shortLinkMatch[1]
    }
  }
  
  // 标准小红书链接
  const noteMatch = url.match(/xiaohongshu\.com\/explore\/([a-zA-Z0-9]+)/) ||
                   url.match(/xiaohongshu\.com\/discovery\/item\/([a-zA-Z0-9]+)/) ||
                   url.match(/xiaohongshu\.com\/search_result\/([a-zA-Z0-9]+)/)
  
  if (noteMatch) {
    return {
      original: url,
      normalized: `https://www.xiaohongshu.com/explore/${noteMatch[1]}`,
      type: 'note',
      id: noteMatch[1]
    }
  }
  
  // 用户主页链接
  const userMatch = url.match(/xiaohongshu\.com\/user\/profile\/([a-zA-Z0-9]+)/)
  if (userMatch) {
    return {
      original: url,
      normalized: url,
      type: 'user',
      id: userMatch[1]
    }
  }
  
  return null
}

export function formatContent(content: XHSContent, config: Config): FormattedContent {
  const parts: string[] = []
  const imageUrls: string[] = []
  const videoUrls: XHSMedia[] = []
  
  // 标题
  parts.push(`📌 ${content.title}`)
  
  // 作者信息
  parts.push(`👤 作者: ${content.author}`)
  
  // 描述
  if (content.description && config.extractText) {
    const desc = content.description.length > (config.maxContentLength || 500)
      ? content.description.substring(0, (config.maxContentLength || 500)) + '...'
      : content.description
    parts.push(`📝 ${desc}`)
  }
  
  // 标签
  if (content.keywords.length > 0) {
    const tags = content.keywords.slice(0, 5).map(tag => `#${tag}`).join(' ')
    parts.push(`🏷️ ${tags}`)
  }
  
  // 统计数据（受 includeMetadata 控制）
  const stats = [] as string[]
  if (config.includeMetadata) {
    if (content.stats.likes > 0) stats.push(`👍 ${formatNumber(content.stats.likes)}`)
    if (content.stats.collects > 0) stats.push(`⭐ ${formatNumber(content.stats.collects)}`)
    if (content.stats.comments > 0) stats.push(`💬 ${formatNumber(content.stats.comments)}`)
    if (stats.length > 0) {
      parts.push(`📊 ${stats.join(' ')}`)
    }
  }
  
  // 处理媒体
  if (config.downloadImages) {
    content.images.forEach(img => {
      if (imageUrls.length < (config.maxImagesPerMessage || 9)) {
        imageUrls.push(img.url)
      }
    })
  }
  
  if (config.downloadVideos) {
    videoUrls.push(...content.videos.slice(0, config.maxVideosPerMessage || 3))
  }
  
  // 添加媒体统计信息
  if ((content.images.length > 0 || content.videos.length > 0) && config.includeMetadata) {
    const mediaInfo = []
    if (content.images.length > 0) {
      mediaInfo.push(`📸 图片 ${content.images.length}张`)
    }
    if (content.videos.length > 0 && config.showVideoMetadata) {
      const videoInfo = []
      videoInfo.push(`🎬 视频 ${content.videos.length}个`)
      
      // 显示视频详细信息
      const videoDetails = []
      for (const video of content.videos) {
        const details = []
        if (video.duration && video.duration > 0) {
          details.push(formatDuration(video.duration))
        }
        if (video.width && video.height) {
          details.push(`${video.width}x${video.height}`)
        }
        if (video.format && video.format !== 'unknown') {
          details.push(video.format.toUpperCase())
        }
        if (details.length > 0) {
          videoDetails.push(`(${details.join(', ')})`)
        }
      }
      
      if (videoDetails.length > 0) {
        videoInfo.push(videoDetails.join(' '))
      }
      
      mediaInfo.push(videoInfo.join(' '))
    }
    
    if (mediaInfo.length > 0) {
      parts.push(`📎 ${mediaInfo.join(' | ')}`)
    }
  }
  
  // 构建最终内容
  const textContent = parts.join('\n\n')
  const elements: h.Fragment = []
  
  // 添加文本
  elements.push(h('text', textContent))
  
  // 添加图片
  imageUrls.forEach(url => {
    elements.push(h('image', { url }))
  })
  
  // 添加视频
  videoUrls.forEach(video => {
    elements.push(h('video', { url: video.url }))
  })
  
  return {
    title: content.title,
    description: content.description,
    images: imageUrls,
    videos: content.videos,
    author: content.author,
    stats: config.includeMetadata ? stats.join(' ') : '',
    tags: content.keywords,
    content: elements
  }
}

export function createForwardMessage(content: FormattedContent, userId: string, config?: Config): ForwardMessage {
  const id = generateMessageId()
  
  const forwardElements: h.Fragment = []
  
  // 标题和作者
  forwardElements.push(
    h('text', `📌 ${content.title}\n👤 作者: ${content.author}\n\n`)
  )
  
  // 描述
  if (content.description) {
    forwardElements.push(
      h('text', `📝 ${content.description.substring(0, 200)}${content.description.length > 200 ? '...' : ''}\n\n`)
    )
  }
  
  // 标签
  if (content.tags.length > 0) {
    const tags = content.tags.slice(0, 3).map(tag => `#${tag}`).join(' ')
    forwardElements.push(h('text', `🏷️ ${tags}\n\n`))
  }
  
  // 统计数据
  if (content.stats) {
    forwardElements.push(h('text', `📊 ${content.stats}\n\n`))
  }
  
  // 媒体内容
  if (content.images.length > 0) {
    forwardElements.push(h('text', `📸 图片 (${content.images.length}张):\n`))
    content.images.slice(0, 3).forEach(url => {
      forwardElements.push(h('image', { url }))
    })
    if (content.images.length > 3) {
      forwardElements.push(h('text', `... 还有 ${content.images.length - 3} 张图片`))
    }
  }
  
  if (content.videos.length > 0) {
    forwardElements.push(h('text', `🎬 视频 (${content.videos.length}个):\n`))
    
    content.videos.forEach((video, index) => {
      const videoInfo = []
      if (config?.showVideoMetadata !== false) {
        if (video.duration && video.duration > 0) {
          videoInfo.push(`时长: ${formatDuration(video.duration)}`)
        }
        if (video.width && video.height) {
          videoInfo.push(`分辨率: ${video.width}x${video.height}`)
        }
        if (video.format && video.format !== 'unknown') {
          videoInfo.push(`格式: ${video.format.toUpperCase()}`)
        }
      }
      
      const infoText = videoInfo.length > 0 ? ` ${videoInfo.join(' | ')}` : ''
      forwardElements.push(h('text', `视频${index + 1}${infoText}\n`))
      forwardElements.push(h('video', { url: video.url }))
    })
  }
  
  return {
    id,
    content: forwardElements,
    sender: {
      id: userId,
      name: '小红书分享'
    }
  }
}

export function filterContent(content: string, blockedKeywords: string[]): boolean {
  if (!blockedKeywords || blockedKeywords.length === 0) {
    return true
  }
  
  const lowerContent = content.toLowerCase()
  return !blockedKeywords.some(keyword => 
    lowerContent.includes(keyword.toLowerCase())
  )
}

export function validateUrl(url: string, allowedDomains: string[]): boolean {
  try {
    const parsed = new URL(url)
    
    // 检查协议
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false
    }
    
    // 检查主机名
    const host = parsed.hostname.toLowerCase()
    
    // 防止SSRF：禁止访问内网地址
    if (isPrivateIP(host) || isLocalhost(host)) {
      return false
    }
    
    // 检查允许的域名
    return allowedDomains.some((domain) => {
      const d = domain.toLowerCase().trim()
      if (!d) return false
      return host === d || host.endsWith('.' + d)
    })
  } catch {
    return false
  }
}

export function isPrivateIP(hostname: string): boolean {
  // 检查是否为私有IP地址
  const privateRanges = [
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^192\.168\./,
    /^127\./,
    /^169\.254\./,
    /^::1$/,
    /^fc00:/,
    /^fe80:/
  ]
  
  return privateRanges.some(range => range.test(hostname))
}

export function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '0.0.0.0' || hostname === '::1'
}

// 统一的去重函数
export function deduplicateMedia<T extends XHSMedia>(items: T[]): T[] {
  const seen = new Set<string>()
  const result: T[] = []
  for (const item of items) {
    if (!item?.url) continue
    if (seen.has(item.url)) continue
    seen.add(item.url)
    result.push(item)
  }
  return result
}

// 安全的 JSON 解析
export function safeJsonParse<T = any>(text: string, maxSize: number = MAX_JSON_SIZE): T | null {
  if (!text || text.length > maxSize) {
    return null
  }
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

// 安全清理HTML内容
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/on\w+="[^"]*"/gi, '')
    .replace(/on\w+='[^']*'/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/vbscript:/gi, '')
    // 只移除 data: 后跟非图片 MIME 的内容
    .replace(/data:(?!image\/)/gi, 'blocked:')
}

function formatNumber(num: number): string {
  if (num >= 10000) {
    return (num / 10000).toFixed(1) + 'w'
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'k'
  }
  return num.toString()
}

function formatDuration(duration: number): string {
  if (!Number.isFinite(duration) || duration <= 0) return ''
  
  const hours = Math.floor(duration / 3600)
  const minutes = Math.floor((duration % 3600) / 60)
  const seconds = Math.floor(duration % 60)
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  } else {
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }
}

function generateMessageId(): string {
  // 使用更安全的 ID 生成，添加计数器避免冲突
  const timestamp = Date.now().toString(36)
  const random1 = Math.random().toString(36).substr(2, 9)
  const random2 = Math.random().toString(36).substr(2, 9)
  return `${timestamp}-${random1}-${random2}`
}

// 类型守卫函数
export function hasPuppeteer(ctx: any): ctx is { puppeteer: { page: () => Promise<any> } } {
  return ctx && typeof ctx.puppeteer === 'object' && typeof ctx.puppeteer.page === 'function'
}

export function createErrorMessage(error: string): h.Fragment {
  return h('text', `❌ 解析失败: ${error}`)
}

export function createLoadingMessage(): h.Fragment {
  return h('text', '⏳ 正在解析小红书内容...')
}

export function createSuccessMessage(title: string): h.Fragment {
  return h('text', `✅ 成功解析: ${title}`)
}