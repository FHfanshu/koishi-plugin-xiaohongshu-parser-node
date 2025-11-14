import { h } from "koishi"
import { URL } from "node:url"
import type { BasicNote } from "./types"

const MAX_URL_LENGTH = 2048
const SAFE_PROTOCOLS = new Set(["http:", "https:"])
const PRIVATE_IP_REGEX = /^(10\.|127\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/
const PRIVATE_HOSTNAME_SUFFIXES = [".local", ".internal"]
const URL_EXTRACT_PATTERN = /https?:\/\/[^\s]+/gi
const TRAILING_PUNCTUATION_PATTERN = /[)\]\}>"'。！？!?！，,。.]+$/u

export const DEFAULT_ALLOWED_DOMAINS = ["xiaohongshu.com", "www.xiaohongshu.com", "xhslink.com"] as const

export function normalizeInputUrl(input: string, allowedDomains: readonly string[] = DEFAULT_ALLOWED_DOMAINS): string | null {
  if (!input) {
    return null
  }

  const trimmed = input.trim()
  if (!trimmed) {
    return null
  }

  if (trimmed.length <= MAX_URL_LENGTH) {
    const direct = normalizeSingleUrl(trimmed, allowedDomains)
    if (direct) {
      return direct
    }
  }

  const candidates = extractCandidateUrls(trimmed)
  for (const candidate of candidates) {
    const normalized = normalizeSingleUrl(candidate, allowedDomains)
    if (normalized) {
      return normalized
    }
  }

  return null
}

export function isPrivateHostname(hostname: string): boolean {
  if (!hostname) {
    return true
  }
  if (hostname === "localhost") {
    return true
  }
  if (PRIVATE_IP_REGEX.test(hostname)) {
    return true
  }
  return PRIVATE_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
}

function isAllowedDomain(hostname: string, allowedDomains: readonly string[]): boolean {
  return allowedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
}

function normalizeSingleUrl(candidate: string, allowedDomains: readonly string[]): string | null {
  if (!candidate || candidate.length > MAX_URL_LENGTH) {
    return null
  }

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    try {
      parsed = new URL(`https://${candidate}`)
    } catch {
      return null
    }
  }

  if (!SAFE_PROTOCOLS.has(parsed.protocol)) {
    return null
  }

  const hostname = parsed.hostname.toLowerCase()
  if (isPrivateHostname(hostname)) {
    return null
  }

  if (!isAllowedDomain(hostname, allowedDomains)) {
    return null
  }

  parsed.hash = ""

  return parsed.toString()
}

export function extractCandidateUrls(text: string): string[] {
  const matches = text.match(URL_EXTRACT_PATTERN)
  if (!matches) {
    return []
  }

  return matches
    .map((raw) => sanitizeExtractedUrl(raw))
    .filter((value): value is string => Boolean(value))
}

export function sanitizeExtractedUrl(raw: string): string | null {
  if (!raw) {
    return null
  }

  const cleaned = raw.replace(TRAILING_PUNCTUATION_PATTERN, "")
  return cleaned.trim() || null
}

export function formatNoteText(note: BasicNote): string {
  const segments: string[] = [` ${note.title.trim()}`]

  const content = note.content.trim()
  if (content) {
    segments.push(content)
  }

  segments.push(` ${note.url}`)

  return segments.join("\n\n")
}

export function renderBasicNote(note: BasicNote): h.Fragment {
  const message = formatNoteText(note)
  const elements: h.Fragment[] = [h('text', { content: message })]

  for (const imageUrl of note.images) {
    elements.push(h('img', { src: imageUrl }))
  }

  if (!note.images.length && note.coverImage) {
    elements.push(h('img', { src: note.coverImage }))
  }

  if (note.videoBuffer) {
    const mime = note.videoMimeType || 'video/mp4'
    elements.push(h.video(note.videoBuffer, mime))
  }

  if (note.videos && note.videos.length) {
    for (const videoUrl of note.videos) {
      elements.push(h('video', { src: videoUrl }))
    }
  }

  return elements.length === 1 ? elements[0] : h('message', elements)
}

export function createErrorMessage(message: string): h.Fragment {
  return h("text", { content: ` ${message}` })
}

export function createSuccessMessage(title: string): h.Fragment {
  return h("text", { content: ` 成功解析: ${title}` })
}
