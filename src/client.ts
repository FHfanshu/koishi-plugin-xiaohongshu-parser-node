import { Logger } from 'koishi'
import axios from 'axios'
import * as cheerio from 'cheerio'
import type { CheerioAPI } from 'cheerio'
import type { BasicNote, BasicClientConfig } from './types'
import { normalizeInputUrl } from './utils'

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export class BasicXHSClient {
  private readonly logger = new Logger('xhs-basic-client')

  constructor(private readonly config: BasicClientConfig) {}

  async getBasicNote(rawUrl: string): Promise<BasicNote> {
    const normalizedUrl = normalizeInputUrl(rawUrl, this.config.allowedDomains)
    if (!normalizedUrl) {
      this.logWarn(`拒绝解析非法链接: ${rawUrl}`)
      throw new Error('链接无效或不在允许的域名列表中')
    }

    this.logInfo(`准备获取 HTML 内容: ${normalizedUrl}`)
    const html = await this.fetchHtml(normalizedUrl)
    return this.parseBasicNote(html, normalizedUrl)
  }

  private async fetchHtml(url: string): Promise<string> {
    const headers = {
      'User-Agent': this.config.userAgent || DEFAULT_USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      ...(this.config.customHeaders ?? {})
    }

    let lastError: unknown

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        const response = await axios.get<string>(url, {
          headers,
          timeout: this.config.requestTimeout,
          responseType: 'text',
          maxRedirects: 5,
          validateStatus: (status) => status >= 200 && status < 300
        })
        
        // Log redirect chain for debugging
        const finalUrl = response.request.res.responseUrl || response.config.url
        if (finalUrl !== url && this.config.enableLog) {
          this.logInfo(`重定向: ${url} -> ${finalUrl}`)
        }
        
        this.logInfo(`请求成功（状态 ${response.status}，大小 ${response.data.length} 字节）`)
        return response.data
      } catch (error) {
        lastError = error
        const message = error instanceof Error ? error.message : String(error)
        this.logWarn(`请求失败（尝试 ${attempt}/${this.config.maxRetries}）：${message}`)
        if (attempt < this.config.maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 500))
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error('请求 HTML 失败')
  }

  private parseBasicNote(html: string, url: string): BasicNote {
    const $ = cheerio.load(html)
    const metaTitle = $('meta[property="og:title"]').attr('content') || $('title').text() || ''
    const metaDescription = $('meta[property="og:description"]').attr('content') || $('meta[name="description"]').attr('content') || ''
    const metaCover = $('meta[property="og:image"]').attr('content') || $('meta[name="og:image"]').attr('content') || ''

    const note: BasicNote = {
      title: '',
      content: '',
      images: [],
      url
    }

    const jsonLd = this.extractJsonLdData($)
    if (jsonLd) {
      const jsonTitle = this.firstString(jsonLd.headline, jsonLd.alternativeHeadline, jsonLd.name)
      const jsonContent = this.firstString(jsonLd.articleBody, jsonLd.description)
      const jsonImages = this.normalizeImages(jsonLd.image)
      const jsonVideos = this.normalizeVideos(jsonLd.video ?? jsonLd.videoUrl ?? jsonLd.videoObject)

      if (jsonTitle) {
        note.title = jsonTitle
      }
      if (jsonContent) {
        note.content = jsonContent
      }
      if (jsonImages.length) {
        this.logInfo(`命中 JSON-LD 图片 ${jsonImages.length} 张`)
        note.images.push(...jsonImages)
      }
      if (jsonVideos.length) {
        this.logInfo(`命中 JSON-LD 视频 ${jsonVideos.length} 个`)
        note.videos = [...(note.videos ?? []), ...jsonVideos]
      }
    } else {
      this.logInfo('未找到 JSON-LD 数据，使用元标签回退')
    }

    const initialState = this.extractInitialState($)
    if (initialState) {
      const noteId = this.extractNoteIdFromUrl(url) ?? this.extractNoteIdFromPage($)
      const detail = this.findNoteDetail(initialState, noteId)
      if (detail) {
        this.logInfo('命中初始状态 note 数据')
        this.mergeNoteDetail(note, detail)
      } else {
        this.logInfo('初始状态数据中未找到 note 详情，继续使用元数据')
      }
    } else {
      this.logInfo('未找到初始状态脚本，继续使用元数据')
    }

    if (!note.title.trim()) {
      note.title = metaTitle.trim() || '未能获取标题'
    }

    if (!note.content.trim()) {
      note.content = metaDescription.trim()
    }

    if (!note.images.length && metaCover) {
      note.images.push(metaCover.trim())
    }

    note.title = note.title.trim() || '未能获取标题'
    note.content = note.content.trim()
    note.images = this.deduplicateUrls(note.images)
    if (note.videos && note.videos.length) {
      note.videos = this.deduplicateVideoUrls(note.videos)
    }
    note.coverImage = note.images[0] ?? (metaCover ? metaCover.trim() : undefined)

    return note
  }

  private extractJsonLdData($: CheerioAPI): Record<string, any> | null {
    const scripts = $('script[type="application/ld+json"]')
    for (const element of scripts.toArray()) {
      const content = $(element).text().trim()
      if (!content) {
        continue
      }

      const parsed = this.safeJsonParse(content)
      if (!parsed) {
        continue
      }

      const candidate = this.findJsonLdCandidate(parsed)
      if (candidate) {
        return candidate
      }
    }
    return null
  }

  private extractInitialState($: CheerioAPI): Record<string, any> | null {
    const scripts = $('script').toArray()
    for (const element of scripts) {
      const content = $(element).html() || ''
      if (!content) {
        continue
      }

      const state =
        this.extractJsonFromAssignment(content, 'window.__INITIAL_STATE__') ??
        this.extractJsonFromAssignment(content, '__INITIAL_STATE__') ??
        this.extractJsonFromAssignment(content, 'window.__INITIAL_DATA__') ??
        this.extractJsonFromAssignment(content, '__INITIAL_DATA__')

      if (state) {
        return state
      }
    }
    return null
  }

  private extractJsonFromAssignment(script: string, variableName: string): Record<string, any> | null {
    const index = script.indexOf(variableName)
    if (index === -1) {
      return null
    }

    const start = script.indexOf('{', index)
    if (start === -1) {
      return null
    }

    let depth = 0
    let stringChar: string | null = null
    let escaped = false

    for (let i = start; i < script.length; i++) {
      const char = script[i]

      if (escaped) {
        escaped = false
        continue
      }

      if (stringChar) {
        if (char === '\\') {
          escaped = true
          continue
        }
        if (char === stringChar) {
          stringChar = null
        }
        continue
      }

      if (char === '"' || char === '\'') {
        stringChar = char
        continue
      }

      if (char === '{') {
        depth += 1
      } else if (char === '}') {
        depth -= 1
        if (depth === 0) {
          const jsonText = script.slice(start, i + 1)
          const parsed = this.safeJsonParse(jsonText)
          if (parsed && typeof parsed === 'object') {
            return parsed as Record<string, any>
          }
          break
        }
      }
    }

    return null
  }

  private extractNoteIdFromUrl(url: string): string | null {
    try {
      const parsed = new URL(url)
      const path = parsed.pathname || ''

      const match = path.match(/\/(explore|discovery|item|note|notes|post|detail)\/([^\/?#]+)/i)
      if (match && match[2]) {
        return match[2]
      }

      const candidates = ['note_id', 'noteId', 'id', 'noteid']
      for (const key of candidates) {
        const value = parsed.searchParams.get(key)
        if (value && value.trim()) {
          return value.trim()
        }
      }
    } catch {
      return null
    }

    return null
  }

  private extractNoteIdFromPage($: CheerioAPI): string | null {
    const metaNoteId = $('meta[name="note-id"]').attr('content')
    if (metaNoteId && metaNoteId.trim()) {
      return metaNoteId.trim()
    }

    const ogUrl = $('meta[property="og:url"]').attr('content')
    if (ogUrl) {
      const noteId = this.extractNoteIdFromUrl(ogUrl)
      if (noteId) {
        return noteId
      }
    }

    const dataAttr = $('[data-note-id]').attr('data-note-id')
    if (dataAttr && dataAttr.trim()) {
      return dataAttr.trim()
    }

    return null
  }

  private findNoteDetail(state: unknown, noteId: string | null): Record<string, any> | null {
    if (!state || typeof state !== 'object') {
      return null
    }

    const queue: unknown[] = [state]
    const visited = new Set<unknown>()

    while (queue.length) {
      const current = queue.shift()
      if (!current || typeof current !== 'object') {
        continue
      }
      if (visited.has(current)) {
        continue
      }
      visited.add(current)

      const record = current as Record<string, any>
      if (this.isNoteDetail(record, noteId)) {
        return record
      }

      for (const value of Object.values(record)) {
        if (value && typeof value === 'object') {
          queue.push(value)
        }
      }
    }

    return null
  }

  private isNoteDetail(record: Record<string, any>, noteId: string | null): boolean {
    if (noteId) {
      if (typeof record.noteId === 'string' && record.noteId === noteId) {
        return true
      }
      if (typeof record.id === 'string' && record.id === noteId) {
        return true
      }
      if (record.note && typeof record.note === 'object') {
        const noteRecord = record.note as Record<string, any>
        if (typeof noteRecord.noteId === 'string' && noteRecord.noteId === noteId) {
          return true
        }
        if (typeof noteRecord.id === 'string' && noteRecord.id === noteId) {
          return true
        }
      }
    }

    const keys = ['noteCard', 'noteInfo', 'imageList', 'imageUrls', 'desc', 'noteContent']
    return keys.some((key) => key in record)
  }

  private mergeNoteDetail(note: BasicNote, detail: Record<string, any>): void {
    const candidates = this.collectNoteCandidates(detail)

    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'object') {
        continue
      }

      const record = candidate as Record<string, any>
      const title = this.firstString(
        record.title,
        record.noteTitle,
        record.displayTitle,
        record.shareTitle,
        record.name,
        record.note?.title,
        record.noteCard?.title
      )

      if (title) {
        note.title = title
      }

      const content = this.extractTextFromDetail(record)
      if (content) {
        note.content = content
      }

      const images = this.extractImagesFromDetail(record)
      if (images.length) {
        this.logInfo(`从 note 详情提取到 ${images.length} 张图片`)
        note.images.push(...images)
      }

      const videos = this.extractVideosFromDetail(record)
      if (videos.length) {
        this.logInfo(`从 note 详情提取到 ${videos.length} 个视频`)
        note.videos = [...(note.videos ?? []), ...videos]
      }
    }
  }

  private collectNoteCandidates(source: Record<string, any>): Record<string, any>[] {
    const result: Record<string, any>[] = []
    const queue: unknown[] = [source]
    const visited = new Set<unknown>()

    while (queue.length && result.length < 20) {
      const current = queue.shift()
      if (!current || typeof current !== 'object') {
        continue
      }
      if (visited.has(current)) {
        continue
      }
      visited.add(current)

      const record = current as Record<string, any>
      result.push(record)

      const nestedKeys = ['note', 'noteCard', 'noteInfo', 'noteDetail', 'mainNote', 'targetNote', 'data']
      for (const key of nestedKeys) {
        const value = record[key]
        if (value && typeof value === 'object') {
          queue.push(value)
        }
      }
    }

    return result
  }

  private extractTextFromDetail(record: Record<string, any>): string {
    const segments: string[] = []
    const push = (value: unknown) => {
      if (typeof value === 'string') {
        const trimmed = value.trim()
        if (trimmed) {
          segments.push(trimmed)
        }
      }
    }

    push(record.desc)
    push(record.displayDesc)
    push(record.content)
    push(record.noteContent)
    push(record.note?.desc)
    push(record.note?.content)
    push(record.noteCard?.desc)
    push(record.noteCard?.noteContent)

    const text = Array.from(new Set(segments)).join('\n\n')
    return text.trim()
  }

  private extractVideosFromDetail(record: Record<string, any>): string[] {
    const results: string[] = []
    const debugInfo: Array<{ source: string; url: string }> = []

    const pushValue = (value: unknown, source: string = 'unknown') => {
      if (!value) {
        return
      }
      if (Array.isArray(value)) {
        value.forEach((item, index) => pushValue(item, `${source}[${index}]`))
        return
      }
      if (typeof value === 'string') {
        const trimmed = value.trim()
        if (trimmed && trimmed.startsWith('http')) {
          debugInfo.push({ source, url: trimmed })
          results.push(trimmed)
        }
        return
      }
      if (typeof value === 'object') {
        const data = value as Record<string, unknown>
        const candidateKeys = [
          'playUrl',
          'play_url',
          'videoUrl',
          'mainUrl',
          'masterUrl',
          'backupUrl',
          'url',
          'contentUrl',
          'h264',
          'h265',
          'mp4Url',
          'dashUrl'
        ] as const

        for (const key of candidateKeys) {
          const raw = data[key]
          if (typeof raw === 'string') {
            const trimmed = raw.trim()
            if (trimmed && trimmed.startsWith('http')) {
              debugInfo.push({ source: `${source}.${key}`, url: trimmed })
              results.push(trimmed)
              break
            }
          }
        }
      }
    }

    const candidates: Array<{ key: string; value: unknown }> = [
      { key: 'videoUrl', value: record.videoUrl },
      { key: 'mainUrl', value: record.mainUrl },
      { key: 'masterUrl', value: (record as any).masterUrl },
      { key: 'backupUrl', value: (record as any).backupUrl },
      { key: 'playUrl', value: record.playUrl },
      { key: 'video', value: record.video },
      { key: 'videos', value: record.videos },
      { key: 'videoInfo', value: record.videoInfo },
      { key: 'videoList', value: record.videoList },
      { key: 'note.video', value: record.note?.video },
      { key: 'noteCard.video', value: record.noteCard?.video }
    ]

    for (const { key, value } of candidates) {
      pushValue(value, key)
    }

    // Fallback: BFS over the whole record to find any http video-like URLs
    if (!results.length) {
      const queue: unknown[] = [record]
      const seen = new Set<unknown>()
      const VIDEO_PATTERN = /\.(mp4|m3u8|flv|m4s)(\?|$)/i

      while (queue.length && results.length < 10) {
        const current = queue.shift()
        if (!current || typeof current !== 'object' || seen.has(current)) {
          continue
        }
        seen.add(current)

        for (const [key, value] of Object.entries(current as Record<string, unknown>)) {
          if (typeof value === 'string' && value.startsWith('http') && VIDEO_PATTERN.test(value)) {
            const trimmed = value.trim()
            debugInfo.push({ source: `bfs.${key}`, url: trimmed })
            results.push(trimmed)
          } else if (value && typeof value === 'object') {
            queue.push(value)
          }
        }
      }
    }

    if (this.config.enableLog && debugInfo.length > 0) {
      this.logger.info(`视频提取详情（共 ${results.length} 个）：`)
      const preview = debugInfo.slice(0, 3)
      preview.forEach((info, index) => {
        this.logger.info(`  [${index + 1}] ${info.source}: ${info.url.substring(0, 100)}...`)
      })
      if (debugInfo.length > 3) {
        this.logger.info(`  ... 还有 ${debugInfo.length - 3} 条视频 URL`)
      }
    }

    return this.deduplicateVideoUrls(results)
  }

  private extractImagesFromDetail(record: Record<string, any>): string[] {
    const results: string[] = []
    const debugInfo: Array<{ source: string; type: string; url?: string }> = []
    const seenImageIds = new Set<string>()

    const pushValue = (value: unknown, source: string = 'unknown') => {
      if (!value) {
        return
      }
      if (Array.isArray(value)) {
        value.forEach((item, index) => pushValue(item, `${source}[${index}]`))
        return
      }
      if (typeof value === 'string') {
        const trimmed = value.trim()
        if (trimmed) {
          debugInfo.push({ source, type: 'string', url: trimmed })
          results.push(trimmed)
        }
        return
      }
      if (typeof value === 'object') {
        const data = value as Record<string, unknown>
        
        // 检查图片对象是否有唯一标识符，避免处理重复的图片对象
        const imageId = this.extractImageId(data)
        if (imageId && seenImageIds.has(imageId)) {
          this.logInfo(`跳过重复图片对象: ${imageId}`)
          return
        }
        
        const selected = this.selectBestImageUrl(data)
        if (selected) {
          if (imageId) {
            seenImageIds.add(imageId)
          }
          debugInfo.push({ source, type: 'object-infoList', url: selected })
          results.push(selected)
        }
      }
    }

    // 按优先级顺序尝试提取图片，一旦找到有效列表就停止
    const primaryCandidates: Array<{ key: string; value: unknown }> = [
      { key: 'imageList', value: record.imageList },
      { key: 'noteCard.imageList', value: record.noteCard?.imageList },
      { key: 'note.imageList', value: record.note?.imageList },
      { key: 'imageUrls', value: record.imageUrls },
      { key: 'noteCard.imageUrls', value: record.noteCard?.imageUrls },
      { key: 'note.imageUrls', value: record.note?.imageUrls },
      { key: 'images', value: record.images },
      { key: 'imagesList', value: record.imagesList }
    ]

    // 尝试主要图片列表字段
    for (const { key, value: candidate } of primaryCandidates) {
      if (Array.isArray(candidate) && candidate.length > 0) {
        candidate.forEach((item, index) => pushValue(item, `${key}[${index}]`))
        // 如果已经找到图片，不再尝试其他字段（避免重复）
        if (results.length > 0) {
          this.logInfo(`使用 ${key} 字段提取到 ${results.length} 张图片，跳过其他字段`)
          break
        }
      }
    }

    // 如果主要字段都没找到图片，才尝试封面字段
    if (results.length === 0) {
      const coverCandidates: Array<{ key: string; value: unknown }> = [
        { key: 'cover', value: record.cover },
        { key: 'noteCard.cover', value: record.noteCard?.cover },
        { key: 'note.cover', value: record.note?.cover }
      ]
      
      for (const { key, value: candidate } of coverCandidates) {
        pushValue(candidate, key)
        if (results.length > 0) {
          break
        }
      }
    }

    if (this.config.enableLog && debugInfo.length > 0) {
      this.logger.info(`图片提取详情（共 ${results.length} 张）：`)
      const preview = debugInfo.slice(0, 5)
      preview.forEach((info, index) => {
        this.logger.info(`  [${index + 1}] ${info.source} (${info.type}): ${info.url?.substring(0, 60)}...`)
      })
      if (debugInfo.length > 5) {
        this.logger.info(`  ... 还有 ${debugInfo.length - 5} 张图片`)
      }
    }

    return results
  }

  private extractImageId(data: Record<string, unknown>): string | null {
    // 尝试从图片对象中提取唯一标识符
    const idKeys = ['fileId', 'imageId', 'id', 'traceId', 'url_default', 'originUrl']
    for (const key of idKeys) {
      const value = data[key]
      if (typeof value === 'string' && value.trim()) {
        return value.trim()
      }
    }
    
    // 如果有 infoList，尝试从第一个条目中提取
    if (Array.isArray(data.infoList) && data.infoList.length > 0) {
      const first = data.infoList[0]
      if (first && typeof first === 'object') {
        const record = first as Record<string, unknown>
        for (const key of idKeys) {
          const value = record[key]
          if (typeof value === 'string' && value.trim()) {
            return value.trim()
          }
        }
      }
    }
    
    return null
  }

  private selectBestImageUrl(data: Record<string, unknown>): string | null {
    const chooseFromInfoList = (): string | null => {
      const list = Array.isArray(data.infoList) ? data.infoList : null
      if (!list || !list.length) {
        return null
      }

      if (this.config.enableLog && list.length > 1) {
        this.logger.info(`  infoList 包含 ${list.length} 个场景`)
      }

      let best: { url: string; score: number; scene: string } | null = null
      for (const item of list) {
        if (!item || typeof item !== 'object') {
          continue
        }
        const record = item as Record<string, unknown>
        const rawUrl = typeof record.url === 'string' ? record.url.trim() : typeof record.src === 'string' ? record.src.trim() : ''
        if (!rawUrl) {
          continue
        }

        const scene = typeof record.imageScene === 'string' ? record.imageScene : ''
        const score = this.getImageSceneScore(scene)
        if (!best || score > best.score) {
          best = { url: rawUrl, score, scene }
        }
      }

      if (this.config.enableLog && best) {
        this.logger.info(`    选择场景 "${best.scene}" (score: ${best.score})`)
      }

      return best?.url ?? null
    }

    const infoListUrl = chooseFromInfoList()
    if (infoListUrl) {
      return infoListUrl
    }

    const candidateKeys: (keyof typeof data)[] = [
      'originUrl',
      'url',
      'urlDefault',
      'imageUrl',
      'contentUrl',
      'cover',
      'src',
      'thumbnailUrl',
      'urlPre'
    ]

    for (const key of candidateKeys) {
      const value = data[key]
      if (typeof value === 'string' && value.trim()) {
        return value.trim()
      }
    }

    return null
  }

  private getImageSceneScore(scene: string): number {
    if (!scene) {
      return 0
    }
    const normalized = scene.toUpperCase()
    if (normalized.includes('ORI')) {
      return 5
    }
    if (normalized.includes('DFT') || normalized.includes('DEFAULT')) {
      return 4
    }
    if (normalized.includes('HD')) {
      return 3
    }
    if (normalized.includes('MID')) {
      return 2
    }
    if (normalized.includes('PRV') || normalized.includes('PRE') || normalized.includes('LOW')) {
      return 1
    }
    return 0
  }

  private safeJsonParse(content: string): unknown {
    const sanitized = this.sanitizePotentialJson(content)
    try {
      return JSON.parse(sanitized)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logWarn(`JSON 解析失败: ${message}`)
      return null
    }
  }

  private sanitizePotentialJson(value: string): string {
    return value
      .replace(/\bundefined\b/g, 'null')
      .replace(/\bNaN\b/g, 'null')
      .replace(/\bInfinity\b/g, 'null')
      .replace(/-null/g, 'null')
  }

  private normalizeVideos(videoField: unknown): string[] {
    const results: string[] = []
    const pushValue = (value: unknown) => {
      if (!value) {
        return
      }
      if (typeof value === 'string') {
        const trimmed = value.trim()
        if (trimmed) {
          results.push(trimmed)
        }
        return
      }
      if (typeof value === 'object') {
        const record = value as Record<string, unknown>
        const candidate = record.contentUrl || record.url || record.embedUrl
        if (typeof candidate === 'string' && candidate.trim()) {
          results.push(candidate.trim())
        }
      }
    }

    if (Array.isArray(videoField)) {
      videoField.forEach(pushValue)
    } else {
      pushValue(videoField)
    }

    return results
  }

  private findJsonLdCandidate(data: unknown): Record<string, any> | null {
    if (!data) {
      return null
    }

    if (Array.isArray(data)) {
      for (const item of data) {
        const candidate = this.findJsonLdCandidate(item)
        if (candidate) {
          return candidate
        }
      }
      return null
    }

    if (typeof data === 'object') {
      const record = data as Record<string, any>
      if (this.matchesJsonLdType(record['@type'])) {
        return record
      }
      if (record['@graph']) {
        const candidate = this.findJsonLdCandidate(record['@graph'])
        if (candidate) {
          return candidate
        }
      }
      if (record.mainEntity) {
        const candidate = this.findJsonLdCandidate(record.mainEntity)
        if (candidate) {
          return candidate
        }
      }
    }

    return null
  }

  private matchesJsonLdType(type: unknown): boolean {
    if (!type) {
      return false
    }
    const types = Array.isArray(type) ? type : [type]
    return types.some((item) => {
      if (typeof item !== 'string') {
        return false
      }
      return ['NewsArticle', 'Article', 'BlogPosting', 'SocialMediaPosting', 'CreativeWork'].includes(item)
    })
  }

  private normalizeImages(imageField: unknown): string[] {
    const results: string[] = []
    const pushValue = (value: unknown) => {
      if (!value) {
        return
      }
      if (typeof value === 'string') {
        const trimmed = value.trim()
        if (trimmed) {
          results.push(trimmed)
        }
        return
      }
      if (typeof value === 'object') {
        const record = value as Record<string, unknown>
        const candidate = record.url || record.contentUrl || record.image || record.thumbnailUrl
        if (typeof candidate === 'string' && candidate.trim()) {
          results.push(candidate.trim())
        }
      }
    }

    if (Array.isArray(imageField)) {
      imageField.forEach(pushValue)
    } else {
      pushValue(imageField)
    }

    return results
  }

  private deduplicateUrls(urls: string[]): string[] {
    const seen = new Set<string>()
    const result: string[] = []
    for (const url of urls) {
      const trimmed = url.trim()
      if (!trimmed) {
        continue
      }
      if (!seen.has(trimmed)) {
        seen.add(trimmed)
        result.push(trimmed)
      }
    }
    return result
  }

  private deduplicateVideoUrls(urls: string[]): string[] {
    const seen = new Set<string>()
    const result: string[] = []

    for (const original of urls) {
      const normalized = this.normalizeSingleVideoUrl(original)
      if (!normalized) {
        continue
      }

      const key = this.getVideoCanonicalKey(normalized)
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      result.push(normalized)
    }

    return result
  }

  private getVideoCanonicalKey(urlStr: string): string {
    const trimmed = urlStr.trim()
    if (!trimmed) {
      return ''
    }

    try {
      const u = new URL(trimmed)
      if (u.hostname.endsWith('xhscdn.com') && u.pathname.includes('/stream/')) {
        // 对于小红书 CDN，将路径作为去重 key，忽略不同的镜像域名与查询参数
        return u.pathname
      }
      return trimmed
    } catch {
      return trimmed
    }
  }

  private normalizeSingleVideoUrl(urlStr: string): string | null {
    const trimmed = urlStr.trim()
    if (!trimmed) {
      return null
    }

    try {
      const u = new URL(trimmed)
      // 对小红书 CDN 视频统一升级为 HTTPS，提升在客户端的兼容性
      if (u.protocol === 'http:' && u.hostname.endsWith('xhscdn.com')) {
        u.protocol = 'https:'
        return u.toString()
      }
      return trimmed
    } catch {
      // 解析失败时，保留原始 http 开头的字符串，丢弃其它无效值
      if (trimmed.startsWith('http')) {
        return trimmed
      }
      return null
    }
  }

  private firstString(...values: unknown[]): string {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim()
      }
    }
    return ''
  }

  private logInfo(message: string): void {
    if (this.config.enableLog) {
      this.logger.info(message)
    }
  }

  private logWarn(message: string): void {
    if (this.config.enableLog) {
      this.logger.warn(message)
    }
  }
}