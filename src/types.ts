export interface BasicNote {
  title: string
  content: string
  images: string[]
  coverImage?: string
  videos?: string[]
  url: string
}

export interface BasicClientConfig {
  allowedDomains: string[]
  userAgent: string
  requestTimeout: number
  maxRetries: number
  customHeaders?: Record<string, string>
  enableLog: boolean
}