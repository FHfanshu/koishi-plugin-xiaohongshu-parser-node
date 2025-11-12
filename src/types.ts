import { h } from 'koishi'

export interface XHSContent {
  title: string
  description: string
  keywords: string[]
  images: XHSMedia[]
  videos: XHSMedia[]
  url: string
  author: string
  publishTime: number
  stats: XHSStats
}

export interface XHSMedia {
  type: 'image' | 'video'
  url: string
  width?: number
  height?: number
  duration?: number
  format?: string
}

export interface XHSStats {
  likes: number
  collects: number
  comments: number
  shares: number
}

export interface ParsedURL {
  original: string
  normalized: string
  type: 'note' | 'user' | 'search' | 'unknown'
  id?: string
}

export interface FormattedContent {
  title: string
  description: string
  images: string[]
  videos: XHSMedia[]
  author: string
  stats: string
  tags: string[]
  content: h.Fragment
}

export interface ForwardMessage {
  id: string
  content: h.Fragment
  sender: {
    id: string
    name: string
  }
}