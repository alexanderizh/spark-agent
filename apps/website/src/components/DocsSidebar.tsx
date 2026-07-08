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
import {
  categoryLabels,
  categoryOrder,
  docsTopics,
  type DocCategory,
  type DocsTopicMeta,
} from '../content/docs'

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

export function DocsSidebar({
  activeSlug,
  variant = 'panel',
}: {
  /** 当前主题 slug —— 高亮对应链接 */
  activeSlug?: string
  /** panel = 桌面侧边抽屉；inline = 文档页内右侧目录 */
  variant?: 'panel' | 'inline'
}) {
  const groups = categoryOrder
    .map((cat) => ({ cat, items: docsTopics.filter((t) => t.category === cat) }))
    .filter((g) => g.items.length > 0)

  if (variant === 'inline') {
    return (
      <nav className="docs-toc-inline" aria-label="其它文档主题">
        <p className="docs-toc-heading">其它主题</p>
        <ul>
          {groups.map(({ cat, items }) => (
            <li key={cat}>
              <p className="docs-toc-group">{categoryLabels[cat]}</p>
              <ul>
                {items.map((t) => (
                  <li key={t.slug}>
                    <a
                      href={`/docs/${t.slug}`}
                      className={t.slug === activeSlug ? 'is-active' : ''}
                    >
                      {t.title}
                    </a>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </nav>
    )
  }

  return (
    <nav className="docs-sidebar" aria-label="文档主题导航">
      <p className="docs-sidebar-heading">按主题</p>
      <ul>
        {groups.map(({ cat, items }) => (
          <li key={cat}>
            <p className="docs-sidebar-group">{categoryLabels[cat]}</p>
            <ul>
              {items.map((t) => {
                const Icon = ICONS[t.icon]
                const active = t.slug === activeSlug
                return (
                  <li key={t.slug}>
                    <a
                      href={`/docs/${t.slug}`}
                      className={`docs-sidebar-link${active ? ' is-active' : ''}`}
                      aria-current={active ? 'page' : undefined}
                    >
                      <Icon size={14} strokeWidth={1.8} aria-hidden="true" />
                      <span>{t.title}</span>
                    </a>
                  </li>
                )
              })}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export function DocsBreadcrumbs({
  active,
}: {
  active?: DocsTopicMeta
}) {
  const items: Array<{ label: string; href?: string }> = [
    { label: '首页', href: '/' },
    { label: '文档', href: '/docs' },
  ]
  if (active) items.push({ label: active.title })
  return (
    <nav className="docs-breadcrumbs" aria-label="面包屑导航">
      <ol>
        {items.map((it, i) => (
          <li key={i}>
            {it.href ? <a href={it.href}>{it.label}</a> : <span aria-current="page">{it.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  )
}

export { categoryLabels, categoryOrder }
export type { DocCategory, DocsTopicMeta }
