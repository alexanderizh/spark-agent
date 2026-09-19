import type { DocsTopicMeta } from '../content/docs'

/**
 * 文档面包屑。
 *
 * 说明：早期版本这里还有一套 `DocsSidebar`（左抽屉 / 页内目录两态）与配套样式，
 * 现在左侧全局目录由 `DocsShell.tsx` 的 `DocsNavRail` 承担、右侧本页目录由
 * `DocsToc` 承担，因此本文件只保留仍被详情页使用的面包屑。
 */
export function DocsBreadcrumbs({ active }: { active?: DocsTopicMeta }) {
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
            {it.href ? (
              <a href={it.href}>{it.label}</a>
            ) : (
              <span aria-current="page">{it.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
