import { useEffect } from 'react'
import { Link } from '../components/Link'
import { Section } from '../components/Section'
import { Seo } from '../components/Seo'
import { DocsBreadcrumbs, DocsSidebar } from '../components/DocsSidebar'
import { findDocsTopic, relatedDocsTopics } from '../content/docs'
import { getDocsPageContent } from '../content/docs-page-registry'
import { OPEN_SOURCE_ENABLED } from '../lib/links'
import { absoluteUrl } from '../lib/seo'
import type { DocsPageContent } from '../content/docs-pages/_shared'

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
        <div className="docs-topic-main">
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
            {OPEN_SOURCE_ENABLED && findDocsTopic(slug)?.githubSource ? (
              <a
                href={`https://github.com/alexanderizh/spark-agent/blob/main/${findDocsTopic(slug)?.githubSource}`}
                target="_blank"
                rel="noreferrer"
              >
                在 GitHub 查看完整版 ↗
              </a>
            ) : null}
          </nav>
        </div>

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
 * - docsPageRegistry 维护 slug → 正文的同步映射，支持构建期完整预渲染
 * - 找不到 slug 时回退到 NotFound
 * - slug 有效时把 loader 交给 DocsTopicBodyLazy 在 useEffect 内手动触发，
 *   自己管 loading / error 状态（避免 React.lazy 在「loader 返回数据对象」场景下的反模式）
 */
export function DocsTopicPage({ slug }: { slug: string }) {
  const meta = findDocsTopic(slug)
  const content = getDocsPageContent(slug)

  // slug 无效时直接渲染 NotFound（不渲染 SEO）
  if (!meta || !content) {
    return (
      <>
        <Seo
          seo={{
            title: '未找到文档主题 - Spark Work',
            description: '该主题不存在或已被移除。',
            path: `/docs/${slug}`,
            keywords: ['Spark Work 文档'],
            robots: 'noindex, follow',
          }}
        />
        <DocsTopicNotFound slug={slug} />
      </>
    )
  }

  // 文档详情页的 SEO：title / description / canonical / JSON-LD
  const seoTitle = `${meta.title} - Spark Work 文档`
  const seoDescription = meta.description
  const jsonLd = buildDocsJsonLd(meta, content)

  return (
    <>
      <Seo
        seo={{
          title: seoTitle,
          description: seoDescription,
          path: `/docs/${slug}`,
          keywords: [meta.title, ...meta.keywords, 'Spark Work 文档', 'AI Agent 教程'],
        }}
        jsonLd={jsonLd}
      />
      <DocsTopicBody content={content} slug={slug} />
    </>
  )
}

function buildDocsJsonLd(meta: ReturnType<typeof findDocsTopic>, content: DocsPageContent) {
  if (!meta) return undefined
  const url = absoluteUrl(`/docs/${meta.slug}`)
  const article = {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: `${meta.title} - Spark Work 文档`,
    description: meta.description,
    inLanguage: 'zh-CN',
    keywords: meta.keywords.join(', '),
    dateModified: meta.updatedAt,
    datePublished: meta.updatedAt,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    author: { '@type': 'Organization', name: 'Spark Work' },
    publisher: {
      '@type': 'Organization',
      name: 'Spark Work',
      logo: { '@type': 'ImageObject', url: absoluteUrl('/icon.png') },
    },
    about: { '@type': 'SoftwareApplication', name: 'Spark Work' },
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
        item: absoluteUrl('/'),
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: '文档',
        item: absoluteUrl('/docs'),
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: meta.title,
        item: url,
      },
    ],
  }

  const faq = content.faq.length
    ? {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: content.faq.map((item) => ({
          '@type': 'Question',
          name: item.question,
          acceptedAnswer: { '@type': 'Answer', text: item.answer },
        })),
      }
    : undefined

  const howTo = content.howTo
    ? {
        '@context': 'https://schema.org',
        '@type': 'HowTo',
        name: content.howTo.name,
        description: content.howTo.description,
        totalTime: content.howTo.totalTime,
        step: content.howTo.steps.map((text, index) => ({
          '@type': 'HowToStep',
          position: index + 1,
          name: `步骤 ${index + 1}`,
          text,
        })),
      }
    : undefined

  return [article, breadcrumbs, faq, howTo].filter(Boolean)
}
