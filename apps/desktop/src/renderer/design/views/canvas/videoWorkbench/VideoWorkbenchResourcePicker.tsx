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

type Filter = 'all' | 'video' | 'image'

/** Picker 所需的最小候选字段（CanvasResourceOption / LocalResourceFile 都满足） */
export interface PickerCandidate {
  id: string
  title: string
  kind: 'video' | 'image'
  url: string
  thumbnailUrl?: string
  durationSec?: number
  width?: number
  height?: number
}

interface Props<T extends PickerCandidate> {
  open: boolean
  candidates: T[]
  busy?: boolean
  onConfirm: (selected: T[]) => void
  onCancel: () => void
}

const FILTER_LABELS: Record<Filter, string> = {
  all: '全部',
  video: '视频',
  image: '图片',
}

export function VideoWorkbenchResourcePicker<T extends PickerCandidate>({
  open,
  candidates,
  busy = false,
  onConfirm,
  onCancel,
}: Props<T>): ReactElement {
  // Modal 用 destroyOnClose，每次打开都会 remount，这里 state 初始值即为重置。
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const counts = useMemo(() => {
    let video = 0
    let image = 0
    for (const c of candidates) {
      if (c.kind === 'video') video++
      else if (c.kind === 'image') image++
    }
    return { all: candidates.length, video, image }
  }, [candidates])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return candidates.filter((c) => {
      if (filter !== 'all' && c.kind !== filter) return false
      if (!q) return true
      return c.title.toLowerCase().includes(q) || c.url.toLowerCase().includes(q)
    })
  }, [candidates, filter, query])

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
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
      title="从画布选择资源"
      onCancel={onCancel}
      width={720}
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
          加入资源面板{selectedIds.size > 0 ? `（${selectedIds.size}）` : ''}
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
          {(['all', 'video', 'image'] as Filter[]).map((key) => (
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

        {visible.length === 0 ? (
          <div className="vwb-picker-empty">
            <Icons.Layers size={28} />
            <strong>
              {candidates.length === 0 ? '当前画布没有可选资源' : '没有匹配的资源'}
            </strong>
            <div className="muted">
              {candidates.length === 0
                ? '先在画布上创建图片或视频节点，再回到这里选择。'
                : '试试调整搜索关键词或筛选条件。'}
            </div>
          </div>
        ) : (
          <div className="vwb-picker-grid">
            {visible.map((c) => {
              const selected = selectedIds.has(c.id)
              const isVideo = c.kind === 'video'
              return (
                <button
                  type="button"
                  key={c.id}
                  className={`vwb-picker-card${selected ? ' is-selected' : ''}`}
                  onClick={() => toggle(c.id)}
                  title={c.title}
                >
                  <div className="vwb-picker-card-thumb">
                    <ResourceThumb resource={c} className="vwb-picker-card-media" />
                    <span className={`vwb-picker-card-type type-${c.kind}`}>
                      {isVideo ? '视频' : '图片'}
                    </span>
                    {isVideo && c.durationSec ? (
                      <span className="vwb-picker-card-dur">{formatTimestamp(c.durationSec)}</span>
                    ) : !isVideo && c.width && c.height ? (
                      <span className="vwb-picker-card-dur">
                        {c.width}×{c.height}
                      </span>
                    ) : null}
                    {selected && (
                      <span className="vwb-picker-card-check">
                        <Icons.Check size={14} />
                      </span>
                    )}
                  </div>
                  <div className="vwb-picker-card-name">{c.title}</div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </Modal>
  )
}
