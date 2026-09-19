import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronRight, ListTree, Search, X } from 'lucide-react'
import {
  categoryLabels,
  categoryOrder,
  docsTopics,
  type DocCategory,
  type DocsTopicMeta,
} from '../content/docs'
import type { DocsTocItem } from '../content/docs-pages/_shared'
import { openDocsSearch } from './DocsSearchCommand'

/**
 * 文档页外壳（对齐 Claude / Codex 文档站结构）。
 *
 *   桌面端 ≥1200px：[左侧全局目录 260px] [正文 minmax(0,1fr)] [右侧本页目录 220px]
 *   平板 1024~1199：[左侧目录] [正文]（本页目录折叠进正文顶部）
 *   移动端 <1024 ：单列，左侧目录收进抽屉，本页目录折叠在正文顶部
 *
 * 三块导航同源：左侧目录来自 docs.ts 的主题分组，右侧来自每篇正文的 toc 字段。
 */

export function DocsShell({
  activeSlug,
  toc,
  children,
}: {
  /** 当前主题 slug —— 左侧目录高亮 */
  activeSlug?: string
  /** 当前页章节，用于右侧「本页目录」 */
  toc?: DocsTocItem[]
  children: ReactNode
}) {
  const [drawerOpen, setDrawerOpen] = useState(false)

  // 路由切换时自动收起移动端目录抽屉
  useEffect(() => {
    setDrawerOpen(false)
  }, [activeSlug])

  useEffect(() => {
    if (!drawerOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [drawerOpen])

  return (
    <div className="docs-shell">
      <aside className="docs-shell-rail" aria-label="文档目录">
        <DocsRailSearch />
        <DocsNavRail activeSlug={activeSlug} />
      </aside>

      <div className="docs-shell-main">
        <div className="docs-mobilebar">
          <button type="button" className="docs-mobilebar-btn" onClick={() => setDrawerOpen(true)}>
            <ListTree size={16} strokeWidth={1.8} aria-hidden="true" />
            <span>文档目录</span>
          </button>
          <button type="button" className="docs-mobilebar-btn" onClick={openDocsSearch}>
            <Search size={16} strokeWidth={1.8} aria-hidden="true" />
            <span>搜索</span>
          </button>
        </div>

        {toc && toc.length > 0 && <DocsTocCollapsible items={toc} />}

        {children}
      </div>

      <aside className="docs-shell-toc" aria-label="本页目录">
        {toc && toc.length > 0 && <DocsToc items={toc} />}
      </aside>

      <div
        className={`docs-nav-drawer${drawerOpen ? ' is-open' : ''}`}
        aria-hidden={!drawerOpen}
        role="presentation"
        onClick={() => setDrawerOpen(false)}
      >
        <div className="docs-nav-drawer-inner" onClick={(event) => event.stopPropagation()}>
          <div className="docs-nav-drawer-head">
            <p>文档目录</p>
            <button type="button" onClick={() => setDrawerOpen(false)} aria-label="关闭文档目录">
              <X size={18} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
          <DocsRailSearch variant="drawer" />
          <DocsNavRail activeSlug={activeSlug} onNavigate={() => setDrawerOpen(false)} />
        </div>
      </div>
    </div>
  )
}

/** 左侧目录顶部的搜索入口（复用头部命令面板） */
function DocsRailSearch({ variant = 'rail' }: { variant?: 'rail' | 'drawer' }) {
  return (
    <button
      type="button"
      className={variant === 'drawer' ? 'docs-rail-search is-drawer' : 'docs-rail-search'}
      onClick={openDocsSearch}
    >
      <Search size={15} strokeWidth={1.8} aria-hidden="true" />
      <span>搜索文档</span>
      <kbd aria-hidden="true">⌘K</kbd>
    </button>
  )
}

/** 左侧全局目录：按分类分组，当前主题高亮 */
function DocsNavRail({ activeSlug, onNavigate }: { activeSlug?: string; onNavigate?: () => void }) {
  const groups = useMemo(
    () =>
      categoryOrder
        .map((category) => ({
          category,
          items: docsTopics.filter((topic) => topic.category === category),
        }))
        .filter((group) => group.items.length > 0),
    [],
  )

  return (
    <nav className="docs-rail-nav" aria-label="全部文档主题">
      {groups.map(({ category, items }) => (
        <DocsRailGroup
          key={category}
          category={category}
          items={items}
          activeSlug={activeSlug}
          onNavigate={onNavigate}
        />
      ))}
    </nav>
  )
}

function DocsRailGroup({
  category,
  items,
  activeSlug,
  onNavigate,
}: {
  category: DocCategory
  items: DocsTopicMeta[]
  activeSlug?: string
  onNavigate?: () => void
}) {
  // 默认全部展开：文档站以「一眼看到所有主题」为主，折叠只是窄屏/长目录时的收拢手段
  const [open, setOpen] = useState(true)

  return (
    <section className="docs-rail-group">
      <button
        type="button"
        className={`docs-rail-group-head${open ? ' is-open' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <ChevronRight size={14} strokeWidth={2} aria-hidden="true" />
        <span>{categoryLabels[category]}</span>
        <span className="docs-rail-group-count">{items.length}</span>
      </button>
      {open && (
        <ul className="docs-rail-list">
          {items.map((topic) => {
            const active = topic.slug === activeSlug
            return (
              <li key={topic.slug}>
                <a
                  href={`/docs/${topic.slug}`}
                  className={active ? 'docs-rail-link is-active' : 'docs-rail-link'}
                  aria-current={active ? 'page' : undefined}
                  onClick={onNavigate}
                >
                  {topic.title}
                </a>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** 右侧「本页目录」：滚动时高亮当前小节 */
function DocsToc({ items }: { items: DocsTocItem[] }) {
  const activeId = useActiveHeading(items)

  return (
    <nav className="docs-toc" aria-label="本页目录">
      <p className="docs-toc-heading">本页目录</p>
      <ul>
        {items.map((item) => (
          <li key={item.id} className={item.level === 3 ? 'is-sub' : undefined}>
            <a
              href={`#${item.id}`}
              className={activeId === item.id ? 'is-active' : undefined}
              aria-current={activeId === item.id ? 'location' : undefined}
            >
              {item.title}
            </a>
          </li>
        ))}
      </ul>
      <p className="docs-toc-heading docs-toc-heading-sub">返回</p>
      <ul>
        <li>
          <a href="/docs">文档首页</a>
        </li>
      </ul>
    </nav>
  )
}

/** 移动端 / 平板：把本页目录折成可展开块放在正文顶部 */
function DocsTocCollapsible({ items }: { items: DocsTocItem[] }) {
  const [open, setOpen] = useState(false)
  return (
    <details
      className="docs-toc-collapsible"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary>本页目录（{items.length} 节）</summary>
      <ul>
        {items.map((item) => (
          <li key={item.id} className={item.level === 3 ? 'is-sub' : undefined}>
            <a href={`#${item.id}`} onClick={() => setOpen(false)}>
              {item.title}
            </a>
          </li>
        ))}
      </ul>
    </details>
  )
}

/**
 * 滚动高亮：用 IntersectionObserver 观察所有章节标题。
 * 取「当前处在头部导航下方靠上位置」的那个标题作为当前小节；
 * 观察不到时（例如标题都在视口外）保留上一个有效值。
 */
function useActiveHeading(items: DocsTocItem[]): string | undefined {
  const [activeId, setActiveId] = useState<string | undefined>(items[0]?.id)
  const visibleRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (typeof window === 'undefined' || items.length === 0) return
    const elements = items
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => Boolean(el))
    if (elements.length === 0) return

    visibleRef.current = new Set()

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id
          if (entry.isIntersecting) visibleRef.current.add(id)
          else visibleRef.current.delete(id)
        }
        // 按文档顺序取第一个可见章节，保证高亮稳定不跳
        const first = items.find((item) => visibleRef.current.has(item.id))
        if (first) setActiveId(first.id)
      },
      // 顶部让开吸顶导航，底部收缩，只把「刚进入上半屏」的标题算作当前小节
      { rootMargin: '-96px 0px -60% 0px', threshold: 0 },
    )

    elements.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [items])

  return activeId
}
