import { SITE_URL, GITHUB_URL } from './links'

export interface PageSeo {
  title: string
  description: string
  path: string
  keywords: string[]
}

export const defaultSeo: PageSeo = {
  title: 'Spark Agent - 本地优先的 AI 内容创作工作台',
  description:
    'Spark Agent 是一个开源、本地优先的 AI 内容创作工作台，支持写代码、写文档、做 PPT、网页、文件处理、多 Agent 协作与影视无限画布创作。',
  path: '/',
  keywords: [
    'AI 内容创作工作台',
    'AI Agent',
    '无限画布',
    '影视创作',
    'AI 写代码',
    'AI 写文档',
    'AI PPT',
    'MCP',
    '多 Agent',
    '本地优先 AI 工具',
  ],
}

export function absoluteUrl(path: string) {
  return `${SITE_URL}${path === '/' ? '' : path}`
}

export function softwareJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Spark Agent',
    applicationCategory: 'ProductivityApplication',
    operatingSystem: 'macOS, Windows',
    description: defaultSeo.description,
    codeRepository: GITHUB_URL,
    softwareHelp: absoluteUrl('/docs'),
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  }
}
