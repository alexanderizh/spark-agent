import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CornerDownLeft, FileText, Search, X } from 'lucide-react'
import { Link } from './Link'
import { categoryLabels, docsTopics } from '../content/docs'
import { searchDocs, splitByTokens, tokenize, type DocsSearchHit } from '../lib/docs-search'

/**
 * 头部文档搜索（命令面板）。
 *
 * - 入口常驻顶部导航：桌面端是带 ⌘K 提示的搜索按钮，移动端在抽屉里给整行入口
 * - 打开后是居中浮层：输入即实时检索全部文档主题（标题 / 摘要 / 章节 / FAQ / 速查表）
 * - 命中章节时深链到 `/docs/<slug>#<anchor>`，直接落到小节
 * - 键盘：⌘K / Ctrl+K 开关、`/` 快速打开、↑↓ 选择、Enter 打开、Esc 关闭
 *
 * 索引由 lib/docs-search.ts 维护，与 /docs 搜索页共用同一份数据源。
 */

const RESULT_LIMIT = 8
const DEBOUNCE_MS = 120

/**
 * 打开搜索面板的全局事件。
 * 头部按钮、左侧目录里的搜索入口、移动端抽屉入口都通过它触发，
 * 面板状态统一由 Layout 持有，避免多份 open 状态互相打架。
 */
export const DOCS_SEARCH_OPEN_EVENT = 'spark:open-docs-search'

export function openDocsSearch() {
  window.dispatchEvent(new Event(DOCS_SEARCH_OPEN_EVENT))
}

/** 平台化快捷键提示：挂载后按平台纠正，避免首帧结构不一致 */
export function useShortcutLabel(): string {
  const [label, setLabel] = useState('⌘K')
  useEffect(() => {
    const isApple = /mac|iphone|ipad|ipod/i.test(
      window.navigator.platform || window.navigator.userAgent,
    )
    setLabel(isApple ? '⌘K' : 'Ctrl K')
  }, [])
  return label
}

/** 全局快捷键：⌘K / Ctrl+K 开关搜索浮层；非输入态按「/」也能打开 */
export function useDocsSearchHotkeys(onToggle: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      const typing =
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        Boolean(target?.isContentEditable)

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        onToggle()
        return
      }
      if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault()
        onToggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onToggle])
}

/** 顶部导航里的搜索入口 */
export function DocsSearchTrigger({ onOpen }: { onOpen: () => void }) {
  const shortcutLabel = useShortcutLabel()
  return (
    <button type="button" className="nav-search" onClick={onOpen} aria-label="搜索文档">
      <span className="nav-search-icon" aria-hidden="true">
        <Search size={15} strokeWidth={1.8} />
      </span>
      <span className="nav-search-label">搜索文档</span>
      <kbd className="nav-search-kbd" aria-hidden="true">
        {shortcutLabel}
      </kbd>
    </button>
  )
}

/** 移动端抽屉里的整行搜索入口 */
export function DocsSearchDrawerEntry({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className="nav-drawer-search" onClick={onOpen}>
      <Search size={18} strokeWidth={1.8} aria-hidden="true" />
      <span>搜索文档</span>
    </button>
  )
}

export function DocsSearchOverlay({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<DocsSearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const tokens = useMemo(() => tokenize(query), [query])
  const hasQuery = query.trim().length > 0

  const hrefFor = useCallback((hit: DocsSearchHit) => {
    return hit.anchorId ? `/docs/${hit.topic.slug}#${hit.anchorId}` : `/docs/${hit.topic.slug}`
  }, [])

  // 打开即聚焦
  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20)
    return () => window.clearTimeout(timer)
  }, [])

  // 锁滚动 + Esc 关闭
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // 防抖检索
  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setHits([])
      setLoading(false)
      setActiveIndex(0)
      return
    }
    let cancelled = false
    setLoading(true)
    const timer = window.setTimeout(() => {
      searchDocs(trimmed, RESULT_LIMIT)
        .then((next) => {
          if (cancelled) return
          setHits(next)
          setActiveIndex(0)
        })
        .catch(() => {
          if (cancelled) return
          setHits([])
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query])

  const onInputKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((i) => (hits.length ? (i + 1) % hits.length : 0))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((i) => (hits.length ? (i - 1 + hits.length) % hits.length : 0))
    } else if (event.key === 'Enter') {
      const hit = hits[activeIndex]
      if (!hit) return
      event.preventDefault()
      onClose()
      window.location.href = hrefFor(hit)
    }
  }

  // 键盘选中项跟随滚动
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, hits])

  return (
    <div className="docs-cmd-mask" role="presentation" onClick={onClose}>
      <div
        className="docs-cmd"
        role="dialog"
        aria-modal="true"
        aria-label="搜索文档"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="docs-cmd-head">
          <Search size={18} strokeWidth={1.8} aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="搜索文档：MCP、团队模式、Provider、自动更新…"
            aria-label="搜索文档关键词"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" className="docs-cmd-close" onClick={onClose} aria-label="关闭搜索">
            <X size={18} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>

        <div className="docs-cmd-body">
          {!hasQuery && (
            <div className="docs-cmd-empty">
              <p>
                输入关键词检索全部 {docsTopics.length} 篇文档，可命中标题、章节、速查表与常见问题。
              </p>
              <p className="docs-cmd-tips">
                <kbd>↑</kbd>
                <kbd>↓</kbd> 选择 · <kbd>Enter</kbd> 打开 · <kbd>Esc</kbd> 关闭
              </p>
            </div>
          )}

          {hasQuery && loading && hits.length === 0 && (
            <div className="docs-cmd-empty">
              <p>检索中…</p>
            </div>
          )}

          {hasQuery && !loading && hits.length === 0 && (
            <div className="docs-cmd-empty">
              <p>
                没有匹配「<strong>{query.trim()}</strong>」的文档。
              </p>
              <p className="docs-cmd-tips">
                试试更宽泛的关键词，或前往 <Link href="/docs">文档首页</Link> 浏览目录。
              </p>
            </div>
          )}

          {hits.length > 0 && (
            <ul className="docs-cmd-list" ref={listRef} role="listbox" aria-label="搜索结果">
              {hits.map((hit, index) => (
                <li key={`${hit.topic.slug}#${hit.anchorId ?? 'top'}`}>
                  <a
                    href={hrefFor(hit)}
                    data-index={index}
                    role="option"
                    aria-selected={index === activeIndex}
                    className={`docs-cmd-item${index === activeIndex ? ' is-active' : ''}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={onClose}
                  >
                    <span className="docs-cmd-item-icon" aria-hidden="true">
                      <FileText size={16} strokeWidth={1.8} />
                    </span>
                    <span className="docs-cmd-item-main">
                      <span className="docs-cmd-item-title">
                        <Highlighted text={hit.topic.title} tokens={tokens} />
                        <span className="docs-cmd-badge">{categoryLabels[hit.topic.category]}</span>
                      </span>
                      {hit.anchorTitle && (
                        <span className="docs-cmd-item-anchor">
                          章节：
                          <Highlighted text={hit.anchorTitle} tokens={tokens} />
                        </span>
                      )}
                      {!hit.anchorTitle && hit.snippet && (
                        <span className="docs-cmd-item-snippet">
                          <Highlighted text={hit.snippet} tokens={tokens} />
                        </span>
                      )}
                    </span>
                    <span className="docs-cmd-item-enter" aria-hidden="true">
                      <CornerDownLeft size={14} strokeWidth={1.8} />
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="docs-cmd-foot">
          <span className="docs-cmd-foot-count">
            {hasQuery ? `${hits.length} 条结果` : `${docsTopics.length} 篇文档`}
          </span>
          <Link href="/docs/search" onClick={onClose}>
            进入完整搜索页 ↗
          </Link>
        </div>
      </div>
    </div>
  )
}

function Highlighted({ text, tokens }: { text: string; tokens: string[] }) {
  const segments = splitByTokens(text, tokens)
  return (
    <>
      {segments.map((segment, index) =>
        segment.matched ? (
          <mark key={index}>{segment.text}</mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  )
}
