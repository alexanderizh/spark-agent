import type { ReactNode } from 'react'

/**
 * 文档主题详情页的内容契约：
 *   - toc:         侧边目录（h2/h3 锚点）
 *   - faq:         常见问题（同时用于 JSON-LD FAQPage）
 *   - howTo:       操作步骤（用于 JSON-LD HowTo）
 *   - quickReference: 速查表（用于摘要、AI 搜索）
 *   - aiSummary:   长摘要，AI 搜索引擎直接抓取
 *   - Body:        实际渲染（结构化 JSX，含 h2/h3 锚点）
 */
export interface DocsTocItem {
  id: string
  title: string
  level: 2 | 3
}

export interface DocsFaqItem {
  question: string
  answer: string
}

export interface DocsPageContent {
  slug: string
  toc: DocsTocItem[]
  faq: DocsFaqItem[]
  aiSummary: string
  Body: () => ReactNode
  quickReference?: Array<{ key: string; value: string }>
  howTo?: { name: string; description?: string; totalTime?: string; steps: string[] }
}

/** 把任意字符串转成 URL 友好的锚点 id（仅用在小段落 id 上） */
export function anchorId(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s/]+/g, '-')
    .replace(/[^\w\u4e00-\u9fa5-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}
