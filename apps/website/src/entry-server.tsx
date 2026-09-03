import { renderToString } from 'react-dom/server'
import { App } from './App'
import { SeoCollectorProvider, type SeoPayload } from './components/Seo'
import { docsTopics } from './content/docs'
import { absoluteUrl, defaultSeo } from './lib/seo'

export interface RouteManifestEntry {
  path: string
  changefreq: 'weekly' | 'monthly' | 'yearly'
  priority: number
  lastmod?: string
  indexable: boolean
}

export interface RenderedPage {
  html: string
  seo: SeoPayload['seo']
  jsonLd: object
  canonical: string
}

const staticRoutes: RouteManifestEntry[] = [
  { path: '/', changefreq: 'weekly', priority: 1, indexable: true },
  { path: '/features', changefreq: 'weekly', priority: 0.8, indexable: true },
  { path: '/canvas', changefreq: 'weekly', priority: 0.8, indexable: true },
  { path: '/architecture', changefreq: 'monthly', priority: 0.7, indexable: true },
  { path: '/download', changefreq: 'weekly', priority: 0.9, indexable: true },
  { path: '/docs', changefreq: 'weekly', priority: 0.9, indexable: true },
  { path: '/roadmap', changefreq: 'monthly', priority: 0.5, indexable: true },
  { path: '/contact', changefreq: 'yearly', priority: 0.4, indexable: true },
]

export const routeManifest: RouteManifestEntry[] = [
  ...staticRoutes,
  ...docsTopics.map((topic) => ({
    path: `/docs/${topic.slug}`,
    changefreq: 'monthly' as const,
    priority: topic.level === 'beginner' ? 0.8 : 0.7,
    lastmod: topic.updatedAt,
    indexable: true,
  })),
  {
    path: '/docs/search',
    changefreq: 'monthly',
    priority: 0.3,
    indexable: false,
  },
  { path: '/404', changefreq: 'yearly', priority: 0, indexable: false },
]

export function renderPage(path: string): RenderedPage {
  let captured: SeoPayload = {
    seo: defaultSeo,
    jsonLd: {},
  }
  const html = renderToString(
    <SeoCollectorProvider collect={(payload) => (captured = payload)}>
      <App initialPath={path} />
    </SeoCollectorProvider>,
  )
  return {
    html,
    seo: captured.seo,
    jsonLd: captured.jsonLd,
    canonical: absoluteUrl(captured.seo.path),
  }
}

export function createDiscoveryFiles(pages: Record<string, RenderedPage>): Record<string, string> {
  const indexableRoutes = routeManifest.filter((route) => route.indexable)
  const sitemap = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...indexableRoutes.map((route) => {
      const fields = [
        `    <loc>${escapeXml(absoluteUrl(route.path))}</loc>`,
        ...(route.lastmod ? [`    <lastmod>${route.lastmod}</lastmod>`] : []),
        `    <changefreq>${route.changefreq}</changefreq>`,
        `    <priority>${route.priority.toFixed(1)}</priority>`,
      ]
      return ['  <url>', ...fields, '  </url>'].join('\n')
    }),
    '</urlset>',
    '',
  ].join('\n')

  const robots = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /docs/search',
    '',
    'User-agent: GPTBot',
    'Allow: /',
    'Disallow: /docs/search',
    '',
    'User-agent: ChatGPT-User',
    'Allow: /',
    'Disallow: /docs/search',
    '',
    'User-agent: ClaudeBot',
    'Allow: /',
    'Disallow: /docs/search',
    '',
    'User-agent: PerplexityBot',
    'Allow: /',
    'Disallow: /docs/search',
    '',
    `Sitemap: ${absoluteUrl('/sitemap.xml')}`,
    '',
  ].join('\n')

  const routeLines = indexableRoutes.map((route) => {
    const page = pages[route.path]
    return `- [${page.seo.title}](${absoluteUrl(route.path)}): ${page.seo.description}`
  })
  const llms = [
    '# Spark Work',
    '',
    '> 本地优先的桌面端 AI Agent 工作台，覆盖代码开发、办公内容、团队协作、多媒体生成与无限画布。',
    '',
    '## 官方入口',
    '',
    `- [官网](${absoluteUrl('/')})`,
    `- [下载](${absoluteUrl('/download')})`,
    `- [使用文档](${absoluteUrl('/docs')})`,
    '',
    '## 可引用页面',
    '',
    ...routeLines,
    '',
    '## 抓取说明',
    '',
    '- 页面在构建期预渲染，无需执行 JavaScript 即可读取正文。',
    '- `/docs/search` 是交互式站内搜索，不作为独立检索结果收录。',
    '- 下载版本与平台信息来自官网构建时的发行快照，并在客户端后台刷新。',
    '',
  ].join('\n')

  const fullSections = indexableRoutes.flatMap((route) => {
    const page = pages[route.path]
    return [
      `## ${page.seo.title}`,
      '',
      `Source: ${absoluteUrl(route.path)}`,
      '',
      page.seo.description,
      '',
      extractMainText(page.html),
      '',
    ]
  })
  const llmsFull = [
    '# Spark Work — 官方页面完整文本快照',
    '',
    '> 以下内容由官网构建期的实际预渲染 HTML 自动提取；页面源码是事实来源。',
    '',
    ...fullSections,
  ].join('\n')

  return {
    'sitemap.xml': sitemap,
    'robots.txt': robots,
    'llms.txt': llms,
    'llms-full.txt': llmsFull,
  }
}

function extractMainText(html: string): string {
  const main = html.match(/<main>([\s\S]*?)<\/main>/)?.[1] ?? html
  return decodeHtml(
    main
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--.*?-->/gs, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  )
}

function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
