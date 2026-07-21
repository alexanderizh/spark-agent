/**
 * VideoWorkbenchResourcePicker — 从画布选择资源的缩略图多选弹窗。
 *
 * 取代旧的 Modal.confirm + Select（纯文字、无缩略图、无类型过滤）。
 * 特性：2 列缩略图网格、类型筛选（全部/视频/图片）、搜索、多选角标、已选计数。
 *
 * 泛型 <T extends BaseCandidate>：调用方传 CanvasResourceOption / LocalResourceFile 等
 * 具体类型，onConfirm 原样返回该类型，避免类型丢失或循环 import。
 */
import { useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { Button, Modal } from 'antd'
import { Icons } from '../../../Icons'
import { formatTimestamp } from './videoWorkbench.types'
import { ResourceThumb } from './VideoWorkbenchResourceThumb'
import {
  filterVideoWorkbenchPickerCandidates,
  type VideoWorkbenchPickerCandidate,
  type VideoWorkbenchResourceFilter,
} from './videoWorkbenchResourcePickerModel'

interface Props<T extends VideoWorkbenchPickerCandidate> {
  open: boolean
  candidates: T[]
  busy?: boolean
  selectionMode?: 'multiple' | 'single'
  title?: string
  confirmLabel?: string
  onConfirm: (selected: T[]) => void
  onCancel: () => void
}

const FILTER_LABELS: Record<VideoWorkbenchResourceFilter, string> = {
  all: '全部',
  video: '视频',
  image: '图片',
}

export function VideoWorkbenchResourcePicker<T extends VideoWorkbenchPickerCandidate>({
  open,
  candidates,
  busy = false,
  selectionMode = 'multiple',
  title = '从画布选择资源',
  confirmLabel = '加入资源面板',
  onConfirm,
  onCancel,
}: Props<T>): ReactElement {
  const [filter, setFilter] = useState<VideoWorkbenchResourceFilter>('all')
  const [query, setQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [highlightedId, setHighlightedId] = useState<string | null>(candidates[0]?.id ?? null)

  const counts = useMemo(() => {
    let video = 0
    let image = 0
    for (const c of candidates) {
      if (c.kind === 'video') video++
      else if (c.kind === 'image') image++
    }
    return { all: candidates.length, video, image }
  }, [candidates])

  const visible = useMemo(
    () => filterVideoWorkbenchPickerCandidates(candidates, filter, query),
    [candidates, filter, query],
  )
  const highlighted =
    visible.find((candidate) => candidate.id === highlightedId) ?? visible[0] ?? null

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      if (selectionMode === 'single') return new Set([id])
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allVisibleSelected =
    visible.length > 0 && visible.every((candidate) => selectedIds.has(candidate.id))

  const toggleVisible = () => {
    if (selectionMode === 'single') return
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (allVisibleSelected) visible.forEach((candidate) => next.delete(candidate.id))
      else visible.forEach((candidate) => next.add(candidate.id))
      return next
    })
  }

  const handleOk = () => {
    const selected = candidates.filter((c) => selectedIds.has(c.id))
    onConfirm(selected)
  }

  return (
    <Modal
      open={open}
      title={title}
      onCancel={onCancel}
      width={680}
      destroyOnClose
      maskClosable={!busy}
      rootClassName="vwb-picker-modal"
      zIndex={10010}
      footer={[
        <Button key="cancel" onClick={onCancel} disabled={busy}>
          取消
        </Button>,
        <Button
          key="ok"
          type="primary"
          loading={busy}
          disabled={selectedIds.size === 0}
          onClick={handleOk}
        >
          {confirmLabel}
          {selectedIds.size > 0 ? `（${selectedIds.size}）` : ''}
        </Button>,
      ]}
    >
      <div className="vwb-picker">
        <div className="vwb-picker-toolbar">
          <input
            className="vwb-picker-search"
            placeholder="🔍 搜索画布资源..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {(['all', 'video', 'image'] as VideoWorkbenchResourceFilter[]).map((key) => (
            <button
              key={key}
              type="button"
              className={`vwb-picker-chip${filter === key ? ' is-active' : ''}`}
              onClick={() => setFilter(key)}
            >
              {FILTER_LABELS[key]} {counts[key]}
            </button>
          ))}
        </div>

        <div className="vwb-picker-summary">
          <span>
            {filter === 'all' ? '图片与视频' : FILTER_LABELS[filter]}
            <small>{visible.length}</small>
          </span>
          {selectionMode === 'multiple' && visible.length > 0 && (
            <button type="button" onClick={toggleVisible}>
              {allVisibleSelected ? '取消全选当前结果' : '全选当前结果'}
            </button>
          )}
        </div>

        {visible.length === 0 ? (
          <div className="vwb-picker-empty">
            <Icons.Layers size={28} />
            <strong>{candidates.length === 0 ? '当前画布没有可选资源' : '没有匹配的资源'}</strong>
            <div className="muted">
              {candidates.length === 0
                ? '先在画布上创建图片或视频节点，再回到这里选择。'
                : '试试调整搜索关键词或筛选条件。'}
            </div>
          </div>
        ) : (
          <div className="vwb-picker-browser">
            <div
              className="vwb-picker-results"
              role="listbox"
              aria-multiselectable={selectionMode === 'multiple'}
            >
              {visible.map((candidate) => {
                const selected = selectedIds.has(candidate.id)
                const metadata = resourceMetadata(candidate)
                return (
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    key={candidate.id}
                    className={`vwb-picker-result${selected ? ' is-selected' : ''}${
                      highlighted?.id === candidate.id ? ' is-highlighted' : ''
                    }`}
                    onMouseEnter={() => setHighlightedId(candidate.id)}
                    onFocus={() => setHighlightedId(candidate.id)}
                    onClick={() => toggle(candidate.id)}
                    title={candidate.title}
                  >
                    <span className="vwb-picker-result-thumb">
                      <ResourceThumb resource={candidate} />
                    </span>
                    <span className="vwb-picker-result-copy">
                      <strong>{candidate.title}</strong>
                      <small>{metadata}</small>
                    </span>
                    <span className="vwb-picker-result-check" aria-hidden="true">
                      {selected ? <Icons.Check size={13} /> : null}
                    </span>
                  </button>
                )
              })}
            </div>
            {highlighted && (
              <aside className="vwb-picker-preview" aria-label={`${highlighted.title}预览`}>
                <div className="vwb-picker-preview-media">
                  <ResourceThumb resource={highlighted} />
                </div>
                <div className="vwb-picker-preview-copy">
                  <strong>{highlighted.title}</strong>
                  <small>{resourceMetadata(highlighted)}</small>
                </div>
              </aside>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

function resourceMetadata(candidate: VideoWorkbenchPickerCandidate): string {
  const parts = [candidate.kind === 'video' ? '视频' : '图片']
  if (candidate.kind === 'video' && candidate.durationSec) {
    parts.push(formatTimestamp(candidate.durationSec))
  }
  if (candidate.width && candidate.height) parts.push(`${candidate.width}×${candidate.height}`)
  return parts.join(' · ')
}
