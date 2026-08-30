import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { useNavigate } from '../lib/router'

/**
 * 文档搜索框：受控组件 + 快捷键（/）。
 * - 回车跳到 /docs/search?q=...
 * - 输入时实时显示候选主题（基于元数据）
 */
export function DocsSearch({ initialQuery = '' }: { initialQuery?: string }) {
  const [q, setQ] = useState(initialQuery)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  // / 快捷键聚焦（仅在 Docs 相关页面生效）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (
        e.key === '/' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        tag !== 'INPUT' &&
        tag !== 'TEXTAREA' &&
        !target?.isContentEditable
      ) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const submit = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const trimmed = q.trim()
    if (!trimmed) return
    navigate(`/docs/search?q=${encodeURIComponent(trimmed)}`)
  }

  return (
    <form className="docs-search" role="search" onSubmit={submit}>
      <Search size={18} strokeWidth={1.8} aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        name="q"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜索文档：MCP / 团队模式 / Provider / 自动更新…"
        aria-label="搜索文档"
        autoComplete="off"
        spellCheck={false}
      />
      <kbd aria-hidden="true">/</kbd>
    </form>
  )
}