import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from 'antd'
import { Icons } from '../../Icons'
import { useIpcInvoke } from '../../hooks/useIpc'
import { useToast } from '../../components/Toast'
import type { SessionId, SessionReferenceCandidate } from '@spark/protocol'
import type { ComposerSessionReference } from './ChatComposerTypes'
import { classNames } from '../../utils/class-names'
import './SessionReferencePicker.less'

interface SessionReferencePickerProps {
  open: boolean
  targetSessionId: SessionId | null
  selected: ComposerSessionReference[]
  workspaceId?: string | null
  onClose: () => void
  onSelect: (candidate: SessionReferenceCandidate) => void
  fallbackCandidates?: SessionReferenceCandidate[]
}

export function SessionReferencePicker({
  open,
  targetSessionId,
  selected,
  workspaceId,
  onClose,
  onSelect,
  fallbackCandidates = [],
}: SessionReferencePickerProps) {
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<SessionReferenceCandidate[]>([])
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const loadRequestRef = useRef(0)
  const { invoke: listCandidates } = useIpcInvoke('session:reference-candidates')
  const { invoke: searchSessions } = useIpcInvoke('session:search')
  const { toast } = useToast()

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current
    const isCurrentRequest = () => loadRequestRef.current === requestId
    if (!open) return
    if (targetSessionId == null) {
      const normalizedQuery = query.trim().toLocaleLowerCase()
      if (normalizedQuery.length === 0) {
        setCandidates(fallbackCandidates)
        setActiveIndex(0)
        setLoading(false)
        return
      }
      setLoading(true)
      try {
        const result = await searchSessions({
          query: query.trim(),
          ...(workspaceId != null ? { workspaceId } : {}),
          limit: 30,
        })
        const fallbackById = new Map(
          fallbackCandidates.map((candidate) => [candidate.sessionId, candidate]),
        )
        if (isCurrentRequest()) {
          setCandidates(
            result.results.map(
              (match) =>
                fallbackById.get(match.sessionId) ?? {
                  sessionId: match.sessionId,
                  title: match.title,
                  projectId: '',
                  workspaceIds: workspaceId != null ? [workspaceId] : [],
                  status: 'idle',
                  archived: false,
                  updatedAt: match.updatedAt,
                  latestCompletedSeq: -1,
                  latestCompletedTurnId: null,
                  turnCount: 0,
                },
            ),
          )
          setActiveIndex(0)
        }
      } catch (error) {
        if (isCurrentRequest()) {
          toast.error(error instanceof Error ? error.message : '搜索参考会话失败')
        }
      } finally {
        if (isCurrentRequest()) setLoading(false)
      }
      return
    }
    setLoading(true)
    try {
      const result = await listCandidates({
        targetSessionId,
        ...(workspaceId != null ? { workspaceId } : {}),
        ...(query.trim() ? { query: query.trim() } : {}),
        limit: 30,
      })
      if (isCurrentRequest()) {
        setCandidates(result.candidates)
        setActiveIndex(0)
      }
    } catch (error) {
      if (isCurrentRequest()) {
        toast.error(error instanceof Error ? error.message : '加载参考会话失败')
      }
    } finally {
      if (isCurrentRequest()) setLoading(false)
    }
  }, [
    fallbackCandidates,
    listCandidates,
    open,
    query,
    searchSessions,
    targetSessionId,
    toast,
    workspaceId,
  ])

  useEffect(() => {
    // Invalidate the previous request immediately when the query or target
    // changes; otherwise an old response can win during the debounce window.
    loadRequestRef.current += 1
    if (!open) return
    const timer = window.setTimeout(() => void load(), query ? 160 : 0)
    return () => window.clearTimeout(timer)
  }, [load, open, query])

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  const selectedIds = useMemo(
    () => new Set(selected.map((item) => item.sourceSessionId)),
    [selected],
  )
  const choose = (candidate: SessionReferenceCandidate) => {
    if (selectedIds.has(candidate.sessionId)) {
      toast.info('这个会话已经添加为参考')
      return
    }
    if (selected.length >= 10) {
      toast.warning('每个会话最多添加 10 个参考会话')
      return
    }
    setQuery('')
    onSelect(candidate)
  }

  const handleClose = () => {
    setQuery('')
    onClose()
  }

  return (
    <Modal
      open={open}
      title="添加会话参考"
      onCancel={handleClose}
      footer={null}
      width={520}
      destroyOnHidden
    >
      <div className="session-reference-picker">
        <div className="session-reference-picker-search">
          <Icons.Search size={14} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            placeholder="搜索会话标题或内容…"
            aria-label="搜索参考会话"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveIndex((value) => Math.min(value + 1, Math.max(0, candidates.length - 1)))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveIndex((value) => Math.max(0, value - 1))
              } else if (event.key === 'Enter' && candidates[activeIndex] != null) {
                event.preventDefault()
                choose(candidates[activeIndex])
              }
            }}
          />
        </div>
        <div className="session-reference-picker-list" role="listbox" aria-label="可引用会话">
          {loading ? (
            <div className="session-reference-picker-empty">
              <Icons.Spinner size={16} /> 加载中…
            </div>
          ) : candidates.length === 0 ? (
            <div className="session-reference-picker-empty">没有找到可引用的会话</div>
          ) : (
            candidates.map((candidate, index) => (
              <button
                type="button"
                role="option"
                aria-selected={selectedIds.has(candidate.sessionId)}
                key={candidate.sessionId}
                className={classNames(
                  'session-reference-picker-item',
                  index === activeIndex && 'is-selected',
                )}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(candidate)}
              >
                <span className="session-reference-picker-item-icon">
                  <Icons.MessageSquare size={14} />
                </span>
                <span className="session-reference-picker-item-copy">
                  <span className="session-reference-picker-item-title">
                    {candidate.title || '未命名会话'}
                  </span>
                  <span className="session-reference-picker-item-meta">
                    {candidate.turnCount} 轮 · {candidate.archived ? '已归档' : '最近更新'}
                  </span>
                </span>
                {selectedIds.has(candidate.sessionId) && <Icons.Check size={15} />}
              </button>
            ))
          )}
        </div>
      </div>
    </Modal>
  )
}
