import { useMemo, useState } from 'react'
import {
  AppWindow,
  Boxes,
  Cable,
  FileText,
  Globe,
  ImageIcon,
  LayoutGrid,
  PackageOpen,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { DocsSearch } from '../components/DocsSearch'
import { Section } from '../components/Section'
import { Seo } from '../components/Seo'
import {
  categoryLabels,
  categoryOrder,
  docsTopics,
  type DocCategory,
  type DocsTopicMeta,
} from '../content/docs'
import { searchTopicMetaSync } from '../lib/docs-search'

const ICONS: Record<DocsTopicMeta['icon'], LucideIcon> = {
  Sparkles,
  TerminalSquare,
  Users,
  LayoutGrid,
  FileText,
  ImageIcon,
  Search,
  Globe,
  Cable,
  RefreshCw,
  PackageOpen,
  AppWindow,
  Boxes,
  ShieldCheck,
}

const LEVEL_LABEL: Record<DocsTopicMeta['level'], string> = {
  beginner: '入门',
  intermediate: '进阶',
  advanced: '高级',
}

export function DocsPage() {
  const [filter, setFilter] = useState<DocCategory | 'all'>('all')
  const [q, setQ] = useState('')
  const recommendedPath = docsTopics.filter((topic) =>
    ['quick-start', 'code-development', 'agents-workflows', 'browser-automation', 'desktop-guide'].includes(topic.slug),
  )

  const visible = useMemo(() => {
    let arr = filter === 'all' ? docsTopics : docsTopics.filter((t) => t.category === filter)
    arr = searchTopicMetaSync(arr, q)
    return arr
  }, [filter, q])

  const grouped = useMemo(() => {
    const map: Record<string, DocsTopicMeta[]> = {}
    for (const t of visible) {
      ;(map[t.category] ??= []).push(t)
    }
    return map
  }, [visible])

  const allCount = docsTopics.length
  const visibleCount = visible.length

  return (
    <>
      <Seo
        seo={{
          title: '使用文档 - Spark Agent 教程',
          description:
            'Spark Agent 官方文档：覆盖代码开发、团队 Agent、无限画布、多媒体 Provider、MCP / Skills、权限治理、自动更新与发布。可搜索、按需加载。',
          path: '/docs',
          keywords: [
            'Spark Agent 文档',
            'AI Agent 教程',
            'MCP 教程',
            '团队模式',
            '无限画布',
            'Provider 配置',
            'Skill',
            '自动更新',
          ],
        }}
        jsonLd={buildDocsIndexJsonLd()}
      />
      <Section
        eyebrow="使用文档"
        title="从安装到完成第一个真实任务"
        intro="文档按实际使用路径组织：先完成模型和 Agent 配置，再进入代码开发、团队协作或画布创作工作流。每个主题都可以独立搜索、按需加载。"
      >
        <div className="docs-toolbar">
          <DocsSearch />
          <div className="docs-filter" role="tablist" aria-label="主题分类筛选">
            <button
              type="button"
              role="tab"
              aria-selected={filter === 'all'}
              className={`docs-filter-chip${filter === 'all' ? ' is-active' : ''}`}
              onClick={() => setFilter('all')}
            >
              全部 <span>{allCount}</span>
            </button>
            {categoryOrder.map((cat) => {
              const n = docsTopics.filter((t) => t.category === cat).length
              if (n === 0) return null
              return (
                <button
                  key={cat}
                  type="button"
                  role="tab"
                  aria-selected={filter === cat}
                  className={`docs-filter-chip${filter === cat ? ' is-active' : ''}`}
                  onClick={() => setFilter(cat)}
                >
                  {categoryLabels[cat]} <span>{n}</span>
                </button>
              )
            })}
          </div>
        </div>
      </Section>

      <Section
        title="建议阅读路径"
        intro="如果你是第一次接触 Spark Agent，先按这条路径建立心智模型，再回头挑你当前需要的能力主题。"
      >
        <div className="workflow">
          {recommendedPath.map((topic, index) => (
            <div className="workflow-step" key={topic.slug}>
              <span>{index + 1}</span>
              <strong>{topic.title}</strong>
              <p>{topic.detail}</p>
            </div>
          ))}
        </div>
      </Section>

      {visibleCount === 0 ? (
        <Section title="没有匹配的主题">
          <div className="doc-long">
            <p>
              没有找到匹配「<strong>{q}</strong>」的主题。试试更宽泛的关键词，或浏览左侧分类。
            </p>
            <p>
              也可以直接 <a href="/docs/search">进入搜索页</a>，搜索结果会显示章节和 FAQ 命中片段。
            </p>
          </div>
        </Section>
      ) : (
        categoryOrder.map((cat) => {
          const items = grouped[cat]
          if (!items?.length) return null
          return (
            <Section key={cat} title={categoryLabels[cat]}>
              <div className="grid cards docs-cards">
                {items.map((t) => {
                  const Icon = ICONS[t.icon]
                  return (
                    <a className="card doc-link-card" href={`/docs/${t.slug}`} key={t.slug}>
                      <div className="card-icon" aria-hidden="true">
                        <Icon size={18} strokeWidth={1.8} />
                      </div>
                      <div className="docs-card-row">
                        <h3>{t.title}</h3>
                        <span className={`docs-level is-${t.level}`}>{LEVEL_LABEL[t.level]}</span>
                      </div>
                      <p>{t.detail}</p>
                      <div className="docs-card-foot">
                        <span>阅读约 {t.readTime} 分钟</span>
                        <span aria-hidden="true">·</span>
                        <span>最后核对 {t.updatedAt}</span>
                      </div>
                    </a>
                  )
                })}
              </div>
            </Section>
          )
        })
      )}

      <Section title="上线前建议先确认的配置">
        <div className="doc-long">
          <h3>模型服务</h3>
          <p>
            支持 OpenAI、Anthropic、OpenRouter、Ollama、火山方舟、阿里百炼以及任何兼容 OpenAI 协议的供应商；
            图片、视频和语音能力取决于你接入的 Provider 配置。
          </p>
          <h3>MCP / Skills</h3>
          <p>
            可以添加 MCP Server、安装或导入本地 Skill（包括内置「精选技能」目录中的 ppt-master、playwright 等），
            并使用内置搜索、媒体、调试、平台管理，以及 <code>playwright + spark_browser</code> 浏览器能力。
          </p>
          <h3>数据与权限</h3>
          <p>
            本地 SQLite、workspace 文件、Keychain 凭据存储、权限审批、用量账本、规则与 Hooks
            共同构成可审计工作台。
          </p>
        </div>
      </Section>
    </>
  )
}

function buildDocsIndexJsonLd() {
  const items = docsTopics.map((t, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    url: `https://spark-agent.dev/docs/${t.slug}`,
    name: t.title,
    description: t.description,
  }))
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'Spark Agent 文档主题目录',
      description:
        'Spark Agent 官方文档主题索引：覆盖代码开发、团队 Agent、无限画布、多媒体 Provider、MCP / Skills、权限治理、自动更新与发布。',
      numberOfItems: docsTopics.length,
      itemListOrder: 'https://schema.org/ItemListOrderAscending',
      itemListElement: items,
    },
    {
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
      ],
    },
  ]
}
