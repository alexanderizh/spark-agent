/**
 * WikiPagePanel — 知识页详情 / 编辑（主区主体，无自带顶栏）。
 *
 * 形态（重设计稿 v3）：
 *   - 阅读态：24px 标题 + 类型/标签行 + 元信息行 + 720px 度量正文
 *     （只读渲染走既有 MarkdownText 管线：shiki 高亮 / mermaid / katex 全量复用）
 *     + 底部反向链接区块；
 *   - 编辑态：标题输入 + 摘要/标签字段 + 撑满剩余空间的 Markdown 编辑器
 *     + 44px 底部操作条（未保存指示 / 保存 / 取消）。
 *
 * 页面级操作（编辑入口 / 归档·还原 / 删除 / 版本历史）已上移到 WikiView 主区
 * 顶栏，本面板不再渲染第二个顶栏——全应用只有一条 46px 顶栏。
 *
 * 保存契约：只提交发生变化的字段，并携带 expectedVersion 做 CAS；
 * 版本冲突（他人先提交）由 WikiView 重取页面并提示，不静默覆盖。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WikiBacklinkEntry, WikiPageDetail, WikiPageKind } from '@spark/protocol'
import { Icons } from '../../Icons'
import { MarkdownText } from '../chat/ChatMarkdown'
import { CodeEditor } from '../../components/code-editor/CodeEditor'

export interface WikiPagePatch {
  title?: string
  summary?: string
  body?: string
  tags?: string[]
}

const KIND_LABEL: Record<WikiPageKind, string> = {
  knowledge: '知识',
  experience: '经验',
  pattern: '模式',
  reference: '参考',
  note: '随笔',
}

const STATUS_LABEL: Record<WikiPageDetail['status'], string> = {
  draft: '草稿',
  published: '已发布',
  archived: '已归档',
}

/** 编辑器初始高度（首帧未测量时的兜底），测量后由 ResizeObserver 纠正。 */
const EDITOR_FALLBACK_HEIGHT = 480

function formatTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`
}

export interface WikiPagePanelProps {
  page: WikiPageDetail
  saving: boolean
  error: string
  /** 编辑态由 WikiView 持有（顶栏「编辑」入口与面板快捷键共用同一状态）。 */
  editing: boolean
  onEditingChange: (editing: boolean) => void
  onSave: (patch: WikiPagePatch) => Promise<boolean>
  /** 反向链接（谁引用了本页）。undefined = 尚未加载，空数组 = 确实没有引用。 */
  backlinks: readonly WikiBacklinkEntry[] | undefined
  /** 点反向链接跳转（切换到来源页） */
  onOpenBacklink: (pageId: string) => void
}

/**
 * 反向链接区块（阅读态正文底部）。
 *
 * 三态：未加载（undefined，不渲染避免闪烁）/ 无引用（一行提示）/ 有引用（可点跳转）。
 * 双链与显式关联用色点区分（不新增颜色，走既有语义 token）。
 */
function BacklinksSection({
  backlinks,
  onOpen,
}: {
  backlinks: readonly WikiBacklinkEntry[] | undefined
  onOpen: (pageId: string) => void
}) {
  if (backlinks === undefined) return null
  return (
    <section className="wiki_backlinks" aria-label="反向链接">
      <div className="wiki_backlinks_head">
        引用本页
        <span className="wiki_tree_count">{backlinks.length}</span>
      </div>
      {backlinks.length === 0 ? (
        <div className="wiki_backlinks_empty">还没有其他页面引用本页。</div>
      ) : (
        <ul className="wiki_backlinks_list">
          {backlinks.map((link) => (
            <li key={`${link.fromPage}-${link.linkType}`}>
              <button
                type="button"
                className="wiki_backlink_item"
                onClick={() => onOpen(link.fromPage)}
                title={link.fromTitle}
              >
                <span
                  className={`wiki_dot${link.linkType === 'reference' ? ' is-reference' : ''}`}
                />
                <span className="wiki_backlink_title">{link.fromTitle}</span>
                {link.linkType === 'reference' && <span className="wiki_tag">关联</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function WikiPagePanel({
  page,
  saving,
  error,
  editing,
  onEditingChange,
  onSave,
  backlinks,
  onOpenBacklink,
}: WikiPagePanelProps) {
  const [title, setTitle] = useState(page.title)
  const [summary, setSummary] = useState(page.summary)
  const [tagsText, setTagsText] = useState(page.tags.join(', '))
  const [body, setBody] = useState(page.body)
  const [editorHeight, setEditorHeight] = useState(EDITOR_FALLBACK_HEIGHT)
  const editorAreaRef = useRef<HTMLDivElement>(null)

  // 切页或页面版本变化（保存成功 / 他人更新）时重置草稿并退出编辑态，
  // 避免把旧内容写回新版本、或在新页上残留上一个页面的编辑界面。
  const resetDraft = useCallback(() => {
    setTitle(page.title)
    setSummary(page.summary)
    setTagsText(page.tags.join(', '))
    setBody(page.body)
  }, [page])

  useEffect(() => {
    resetDraft()
    onEditingChange(false)
  }, [page.id, page.version, resetDraft, onEditingChange])

  const dirty = useMemo(
    () =>
      title !== page.title ||
      summary !== page.summary ||
      body !== page.body ||
      tagsText !== page.tags.join(', '),
    [title, summary, body, tagsText, page],
  )

  // 编辑器撑满「标题区之下、操作条之上」的剩余空间：CodeEditor 只接受数值高度，
  // 这里用 ResizeObserver 测量容器实际高度回填（窄屏 / 密度切换都能自适应）。
  useEffect(() => {
    if (!editing) return
    const el = editorAreaRef.current
    if (el == null) return
    const measure = () => {
      const h = el.clientHeight
      if (h > 120) setEditorHeight(h)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [editing])

  const cancelEditing = useCallback(() => {
    resetDraft()
    onEditingChange(false)
  }, [resetDraft, onEditingChange])

  const submit = useCallback(async () => {
    const patch: WikiPagePatch = {}
    if (title !== page.title) patch.title = title
    if (summary !== page.summary) patch.summary = summary
    if (body !== page.body) patch.body = body
    const tags = tagsText
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
    // 标签逐项比较：用换行拼接（标签来自单行输入，不可能含换行，不会误判相等）
    if (tags.join('\n') !== page.tags.join('\n')) patch.tags = tags
    if (Object.keys(patch).length === 0) {
      onEditingChange(false)
      return
    }
    const ok = await onSave(patch)
    if (ok) onEditingChange(false)
  }, [title, summary, body, tagsText, page, onSave, onEditingChange])

  // 编辑态快捷键：⌘/Ctrl+S 保存、Esc 取消（与项目其他编辑器一致的保存语义）
  useEffect(() => {
    if (!editing) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void submit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        cancelEditing()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, submit, cancelEditing])

  const archived = page.status === 'archived'

  if (editing) {
    return (
      <div className="wiki_editor">
        <div className="wiki_editor_head">
          <input
            className="wiki_editor_title"
            value={title}
            placeholder="未命名页面"
            aria-label="页面标题"
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="wiki_editor_meta">
            <div className="wiki_editor_field">
              <label className="wiki_editor_field_label" htmlFor="wiki-edit-summary">
                摘要
              </label>
              <textarea
                id="wiki-edit-summary"
                className="wiki_editor_input"
                rows={2}
                value={summary}
                placeholder="一句话说明这一页是什么（检索结果里展示，≤600 字）"
                onChange={(e) => setSummary(e.target.value)}
              />
            </div>
            <div className="wiki_editor_field">
              <label className="wiki_editor_field_label" htmlFor="wiki-edit-tags">
                标签
              </label>
              <input
                id="wiki-edit-tags"
                className="wiki_editor_input"
                value={tagsText}
                placeholder="逗号分隔，如 sqlite, fts, cjk"
                onChange={(e) => setTagsText(e.target.value)}
              />
            </div>
          </div>
          {error.length > 0 && <div className="wiki_error">{error}</div>}
        </div>

        <div className="wiki_editor_body">
          <div ref={editorAreaRef} style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex' }}>
            <CodeEditor
              value={body}
              language="markdown"
              height={editorHeight}
              onChange={setBody}
              ariaLabel="知识页正文"
            />
          </div>
        </div>

        <div className="wiki_editor_foot">
          {dirty && (
            <span className="wiki_dirty">
              <span className="wiki_dirty_dot" />
              未保存
            </span>
          )}
          <span className="wiki_rail_spacer" />
          <span className="wiki_hint">⌘/Ctrl + S 保存 · Esc 取消</span>
          <button
            type="button"
            className="wiki_btn_ghost"
            disabled={saving}
            onClick={cancelEditing}
          >
            取消
          </button>
          <button
            type="button"
            className="wiki_btn_primary"
            disabled={saving || !dirty}
            onClick={() => void submit()}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="wiki_article">
      <h1 className="wiki_title">{page.title}</h1>
      {error.length > 0 && <div className="wiki_error">{error}</div>}

      <div className="wiki_tagrow">
        <span className="wiki_tag is-kind">
          <span className={`wiki_tree_dot k-${page.kind}`} aria-hidden />
          {KIND_LABEL[page.kind]}
        </span>
        {page.status !== 'published' && (
          <span className={`wiki_tag ${page.status === 'draft' ? 'is-draft' : 'is-warn'}`}>
            {STATUS_LABEL[page.status]}
          </span>
        )}
        {page.tags.map((tag) => (
          <span key={tag} className="wiki_tag">
            {tag}
          </span>
        ))}
        {page.truncated && (
          <span className="wiki_tag is-warn" title="正文超过显示上限，已截断">
            已截断
          </span>
        )}
      </div>

      <div className="wiki_meta">
        <span className="wiki_meta_item">v{page.version}</span>
        <span className="wiki_meta_item">更新于 {formatTime(page.updatedAt)}</span>
        <span className="wiki_meta_item">引用 {page.hitCount}</span>
        {page.authorRole != null && <span className="wiki_meta_item">来源 {page.authorRole}</span>}
      </div>

      <div className="wiki_article_body">
        {page.body.trim().length === 0 ? (
          <div className="wiki_hint" style={{ padding: '24px 0' }}>
            这一页还没有正文。点右上角「更多 → 编辑」开始写第一段。
          </div>
        ) : (
          <MarkdownText content={page.body} />
        )}
      </div>

      {archived && (
        <div className="wiki_hint" style={{ marginTop: 18 }}>
          该页已归档：不在目录树默认视图与 Agent 检索结果中展示，可随时取消归档。
        </div>
      )}

      <BacklinksSection backlinks={backlinks} onOpen={onOpenBacklink} />
    </div>
  )
}
