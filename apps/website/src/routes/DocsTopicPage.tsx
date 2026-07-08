import { useEffect, useState } from 'react'
import { Link } from '../components/Link'
import { Section } from '../components/Section'
import { Seo } from '../components/Seo'
import { DocsBreadcrumbs, DocsSidebar } from '../components/DocsSidebar'
import { findDocsTopic, relatedDocsTopics } from '../content/docs'
import type { DocsPageContent } from '../content/docs-pages/_shared'

/**
 * slug → 动态 import 的映射表。
 * 这里集中维护，每个主题一个独立 chunk —— 按需加载。
 */
const docPageLoaders: Record<string, () => Promise<{ default: DocsPageContent }>> = {
  'quick-start': () => import('../content/docs-pages/quick-start'),
  'code-development': () => import('../content/docs-pages/code-development'),
  'agents-workflows': () => import('../content/docs-pages/agents-workflows'),
  'team-mode': () => import('../content/docs-pages/team-mode'),
  'canvas-mvp': () => import('../content/docs-pages/canvas-mvp'),
  'media-providers': () => import('../content/docs-pages/media-providers'),
  'image-providers': () => import('../content/docs-pages/image-providers'),
  'web-search': () => import('../content/docs-pages/web-search'),
  'browser-automation': () => import('../content/docs-pages/browser-automation'),
  'remote-connections': () => import('../content/docs-pages/remote-connections'),
  'auto-update': () => import('../content/docs-pages/auto-update'),
  'mcp-skills': () => import('../content/docs-pages/mcp-skills'),
  governance: () => import('../content/docs-pages/governance'),
  'desktop-guide': () => import('../content/docs-pages/desktop-guide'),
  'builtin-tools': () => import('../content/docs-pages/builtin-tools'),
  'workflow-usage': () => import('../content/docs-pages/workflow-usage'),
  'board-view': () => import('../content/docs-pages/board-view'),
}

function DocsPageFallback() {
  return (
    <Section title="加载中…">
      <p className="docs-fallback">正在加载主题正文（按需懒加载）。</p>
    </Section>
  )
}

function DocsTopicNotFound({ slug }: { slug: string }) {
  return (
    <Section title="未找到这个主题">
      <div className="doc-long">
        <p>
          当前 URL <code>/docs/{slug}</code> 没有对应的主题。可能主题已被移除或重命名。
        </p>
        <p>
          <Link href="/docs">返回文档首页</Link>
        </p>
      </div>
    </Section>
  )
}

interface DocsTopicBodyProps {
  content: DocsPageContent
  slug: string
}

function DocsTopicBody({ content, slug }: DocsTopicBodyProps) {
  // 加载完正文后锚点跳转（如从其它页带 #hash 进来）
  useEffect(() => {
    if (typeof window === 'undefined') return
    const hash = window.location.hash.replace(/^#/, '')
    if (!hash) return
    // 给锚点渲染一点时间（动态 Body 已挂载）
    const t = window.setTimeout(() => {
      const el = document.getElementById(hash)
      if (el) {
        el.scrollIntoView({ behavior: 'instant' as ScrollBehavior, block: 'start' })
      }
    }, 60)
    return () => window.clearTimeout(t)
  }, [slug])

  const Body = content.Body
  const related = relatedDocsTopics(slug)

  return (
    <article className="docs-topic">
      <header className="docs-topic-header">
        <DocsBreadcrumbs active={findDocsTopic(slug)} />
        <h1>{findDocsTopic(slug)?.title ?? content.slug}</h1>
        <p className="docs-topic-intro">{findDocsTopic(slug)?.description}</p>
        <div className="docs-topic-meta">
          <span>阅读约 {findDocsTopic(slug)?.readTime ?? 5} 分钟</span>
          <span aria-hidden="true">·</span>
          <span>最后核对 {findDocsTopic(slug)?.updatedAt}</span>
        </div>
      </header>

      <div className="docs-topic-grid">
        <main className="docs-topic-main">
          <div className="docs-topic-body">
            <Body />
          </div>

          {content.quickReference && content.quickReference.length > 0 && (
            <section className="docs-quickref" aria-labelledby="quickref-h">
              <h2 id="quickref-h">速查表</h2>
              <dl>
                {content.quickReference.map((qr, i) => (
                  <div key={i} className="docs-quickref-row">
                    <dt>{qr.key}</dt>
                    <dd>{qr.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {content.faq && content.faq.length > 0 && (
            <section className="docs-faq" aria-labelledby="faq-h">
              <h2 id="faq-h">常见问题</h2>
              <details>
                <summary>展开 {content.faq.length} 条常见问题</summary>
                <ul>
                  {content.faq.map((f, i) => (
                    <li key={i}>
                      <strong>{f.question}</strong>
                      <p>{f.answer}</p>
                    </li>
                  ))}
                </ul>
              </details>
            </section>
          )}

          {related.length > 0 && (
            <section className="docs-related" aria-labelledby="related-h">
              <h2 id="related-h">相关主题</h2>
              <ul className="link-list">
                {related.map((r) => (
                  <li key={r.slug}>
                    <a href={`/docs/${r.slug}`}>{r.title}</a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <nav className="docs-topic-pager" aria-label="主题翻页">
            <Link href="/docs">← 文档首页</Link>
            {findDocsTopic(slug)?.githubSource ? (
              <a
                href={`https://github.com/alexanderizh/spark-agent/blob/main/${findDocsTopic(slug)?.githubSource}`}
                target="_blank"
                rel="noreferrer"
              >
                在 GitHub 查看完整版 ↗
              </a>
            ) : null}
          </nav>
        </main>

        <aside className="docs-topic-aside">
          <div className="docs-topic-toc" aria-label="本页目录">
            <p className="docs-toc-heading">本页目录</p>
            <ul>
              {content.toc.map((item) => (
                <li key={item.id} className={`docs-toc-level-${item.level}`}>
                  <a href={`#${item.id}`}>{item.title}</a>
                </li>
              ))}
            </ul>
          </div>
          <DocsSidebar activeSlug={slug} variant="inline" />
        </aside>
      </div>
    </article>
  )
}

/**
 * /docs/:slug 文档主题详情页。
 *
 * - docPageLoaders 维护 slug → chunk loader 的映射（每主题独立 chunk，按需加载）
 * - 找不到 slug 时回退到 NotFound
 * - slug 有效时把 loader 交给 DocsTopicBodyLazy 在 useEffect 内手动触发，
 *   自己管 loading / error 状态（避免 React.lazy 在「loader 返回数据对象」场景下的反模式）
 */
export function DocsTopicPage({ slug }: { slug: string }) {
  const meta = findDocsTopic(slug)
  const hasLoader = Boolean(docPageLoaders[slug])

  // slug 无效时直接渲染 NotFound（不渲染 SEO）
  if (!meta || !hasLoader) {
    return (
      <>
        <Seo
          seo={{
            title: '未找到文档主题 - Spark Agent',
            description: '该主题不存在或已被移除。',
            path: `/docs/${slug}`,
            keywords: ['Spark Agent 文档'],
          }}
        />
        <DocsTopicNotFound slug={slug} />
      </>
    )
  }

  // 文档详情页的 SEO：title / description / canonical / JSON-LD
  const seoTitle = `${meta.title} - Spark Agent 文档`
  const seoDescription = meta.description
  const jsonLd = buildDocsJsonLd(meta)

  return (
    <>
      <Seo
        seo={{
          title: seoTitle,
          description: seoDescription,
          path: `/docs/${slug}`,
          keywords: [
            meta.title,
            ...meta.keywords,
            'Spark Agent 文档',
            'AI Agent 教程',
          ],
        }}
        jsonLd={jsonLd}
      />
      <DocsTopicBodyLazy slug={slug} />
    </>
  )
}

function DocsTopicBodyLazy({ slug }: { slug: string }) {
  const [content, setContent] = useState<DocsPageContent | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setContent(null)
    setError(null)
    const loader = docPageLoaders[slug]
    if (!loader) {
      setError('未找到主题')
      return () => {
        cancelled = true
      }
    }
    loader()
      .then((mod) => {
        if (cancelled) return
        const c: DocsPageContent = mod.default ?? (mod as Record<string, DocsPageContent>)[Object.keys(mod)[0]]
        setContent(c)
      })
      .catch((err) => {
        if (cancelled) return
        console.error('[docs] failed to load', slug, err)
        setError(err?.message ?? '加载失败')
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  if (error) return <DocsTopicNotFound slug={slug} />
  if (!content) return <DocsPageFallback />
  return <DocsTopicBody content={content} slug={slug} />
}

function buildDocsJsonLd(meta: ReturnType<typeof findDocsTopic>) {
  if (!meta) return undefined
  const url = `https://spark-agent.dev/docs/${meta.slug}`
  const article = {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: `${meta.title} - Spark Agent 文档`,
    description: meta.description,
    inLanguage: 'zh-CN',
    keywords: meta.keywords.join(', '),
    dateModified: meta.updatedAt,
    datePublished: meta.updatedAt,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    author: { '@type': 'Organization', name: 'Spark Agent' },
    publisher: {
      '@type': 'Organization',
      name: 'Spark Agent',
      logo: { '@type': 'ImageObject', url: 'https://spark-agent.dev/icon.png' },
    },
    about: { '@type': 'SoftwareApplication', name: 'Spark Agent' },
    proficiencyLevel: meta.level,
    timeRequired: `PT${meta.readTime}M`,
  }

  const breadcrumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: '首页',
        item: 'https://spark-agent.dev/',
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: '文档',
        item: 'https://spark-agent.dev/docs',
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: meta.title,
        item: url,
      },
    ],
  }

  return [article, breadcrumbs]
}