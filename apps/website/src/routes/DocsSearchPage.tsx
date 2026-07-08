import { useEffect, useState } from 'react'
import { Search as SearchIcon, ArrowUpRight } from 'lucide-react'
import { DocsSearch } from '../components/DocsSearch'
import { Section } from '../components/Section'
import { Seo } from '../components/Seo'
import { searchDocs, splitByTokens, tokenize, type DocsSearchHit } from '../lib/docs-search'
import { APP_NAVIGATE_EVENT, readSearchParams, useNavigate } from '../lib/router'

export function DocsSearchPage() {
  const [query, setQuery] = useState(() => readSearchParams().get('q') ?? '')
  const [hits, setHits] = useState<DocsSearchHit[]>([])
  const [tokens, setTokens] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  // 保留 `searched` 标志：未来 UI 可能需要「已搜索过 / 还没搜过」分流（比如推荐关键词）。
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [searched, setSearched] = useState(false)
  const navigate = useNavigate()

  // 监听 URL ?q= 变化。
  // App.tsx 路由只在 pathname 变化时刷新子组件；
  // 同页内 search 变化（例如从 ?q=a 改成 ?q=b）需要我们主动监听。
  useEffect(() => {
    const run = (q: string) => {
      setQuery(q)
      if (!q.trim()) {
        setHits([])
        setTokens([])
        setSearched(false)
        return
      }
      let cancelled = false
      setLoading(true)
      setSearched(true)
      setTokens(tokenize(q))
      searchDocs(q)
        .then((res) => {
          if (cancelled) return
          setHits(res)
        })
        .catch((err) => {
          if (cancelled) return
          console.error('[docs-search] failed', err)
          setHits([])
        })
        .finally(() => {
          if (cancelled) return
          setLoading(false)
        })
      return () => {
        cancelled = true
      }
    }

    // 初始化：直接读当前 URL
    run(readSearchParams().get('q') ?? '')

    // 监听 popstate（浏览器前进/后退）和 app:navigate（程序内 navigate）
    const onChange = () => {
      run(readSearchParams().get('q') ?? '')
    }
    window.addEventListener('popstate', onChange)
    window.addEventListener(APP_NAVIGATE_EVENT, onChange)
    return () => {
      window.removeEventListener('popstate', onChange)
      window.removeEventListener(APP_NAVIGATE_EVENT, onChange)
    }
  }, [])

  const seoTitle = query ? `搜索：${query} - Spark Agent 文档` : '搜索文档 - Spark Agent'
  const seoDescription = query
    ? `在 Spark Agent 文档中搜索「${query}」的结果。`
    : '在 Spark Agent 官方文档中搜索关键词，支持标题、描述、章节、FAQ 与正文摘要的全文检索。'

  return (
    <>
      <Seo
        seo={{
          title: seoTitle,
          description: seoDescription,
          path: `/docs/search${query ? `?q=${encodeURIComponent(query)}` : ''}`,
          keywords: query
            ? ['Spark Agent 文档搜索', `Spark Agent ${query}`, query]
            : ['Spark Agent 文档搜索'],
        }}
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'SearchResultsPage',
          name: seoTitle,
          query: query || undefined,
          url: `https://spark-agent.dev/docs/search${query ? `?q=${encodeURIComponent(query)}` : ''}`,
        }}
      />
      <Section
        eyebrow="文档搜索"
        title={query ? `搜索结果：${query}` : '搜索文档'}
        intro="全文检索标题、描述、章节、FAQ 和正文摘要 —— 输入关键词后按回车。"
      >
        <DocsSearch initialQuery={query} />
      </Section>

      {!query.trim() ? (
        <Section title="可以试试这些关键词">
          <div className="link-list large">
            {[
              '团队模式',
              'MCP',
              'Provider',
              'Worktree',
              'spark_search',
              'spark_media',
              'Keychain',
              'auto-update',
            ].map((kw) => (
              <a key={kw} href={`/docs/search?q=${encodeURIComponent(kw)}`}>
                {kw}
              </a>
            ))}
          </div>
        </Section>
      ) : loading ? (
        <Section title="搜索中…">
          <p className="docs-fallback">正在遍历所有主题的标题、章节、FAQ 和摘要…</p>
        </Section>
      ) : hits.length === 0 ? (
        <Section title="没有匹配结果">
          <div className="doc-long">
            <p>
              没有匹配「<strong>{query}</strong>」的主题。请检查拼写，或换个更宽泛的关键词。
            </p>
            <p>
              你也可以直接浏览 <a href="/docs">全部文档主题</a>。
            </p>
          </div>
        </Section>
      ) : (
        <Section title={`${hits.length} 条匹配`}>
          <ol className="docs-search-results">
            {hits.map((h) => (
              <li key={h.topic.slug}>
                <a
                  className="docs-search-result"
                  href={`/docs/${h.topic.slug}`}
                  onClick={(e) => {
                    if (
                      e.defaultPrevented ||
                      e.metaKey ||
                      e.ctrlKey ||
                      e.shiftKey ||
                      e.altKey ||
                      e.button !== 0
                    )
                      return
                    e.preventDefault()
                    navigate(`/docs/${h.topic.slug}`)
                  }}
                >
                  <div className="docs-search-result-head">
                    <SearchIcon size={16} strokeWidth={1.8} aria-hidden="true" />
                    <span className="docs-search-result-title">
                      {renderHighlighted(h.topic.title, tokens)}
                    </span>
                    <ArrowUpRight
                      size={16}
                      strokeWidth={1.8}
                      aria-hidden="true"
                      className="docs-search-result-arrow"
                    />
                  </div>
                  <p className="docs-search-result-desc">
                    {renderHighlighted(h.topic.description, tokens)}
                  </p>
                  {h.highlights.length > 0 && (
                    <ul className="docs-search-highlights">
                      {h.highlights.slice(0, 3).map((hi, i) => (
                        <li key={i}>
                          <span className="docs-search-snippet">
                            <span className="docs-search-field">{hi.field}</span>
                            {renderHighlighted(hi.snippet, tokens)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="docs-search-result-meta">
                    <span>相关度 {h.score.toFixed(1)}</span>
                    <span aria-hidden="true">·</span>
                    <span>阅读约 {h.topic.readTime} 分钟</span>
                  </div>
                </a>
              </li>
            ))}
          </ol>
        </Section>
      )}
    </>
  )
}

/**
 * 把命中 token 用 <mark> 包起来。空 tokens 走纯文本。
 */
function renderHighlighted(text: string, tokens: string[]) {
  if (!tokens.length) return text
  const segments = splitByTokens(text, tokens)
  return segments.map((seg, i) =>
    seg.matched ? (
      <mark key={i} className="docs-search-mark">
        {seg.text}
      </mark>
    ) : (
      <span key={i}>{seg.text}</span>
    ),
  )
}