/**
 * VideoWorkbenchResourcePanel — 视频工作台右侧"资源"tab。
 *
 * 数据来源：VideoWorkbenchData.resourcePanel（视频 + 图片混合）。
 * 主要交互：
 *  - 顶部开关：自动收集上游产物
 *  - 搜索 / 类型筛选（全部 / 视频 / 图片）
 *  - 2 列网格卡片：缩略图 + 类型药丸 + 时长/尺寸 + 来源药丸
 *  - 卡片 hover → "+" 按钮加入轨道；已加入的卡片显示绿色角标
 *  - 资源卡可拖拽到下方 TrackTimeline（HTML5 drag-and-drop，dataTransfer 携带 resourceId）
 *
 * 与"添加资源"按钮互补：顶部"添加资源"由父级 Modal 负责"从本机/从画布/自动收集"三个入口，
 * 这里只展示与操作已入面板的资源。
 */
import { useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { Button, Switch, Tooltip } from 'antd'
import { Icons } from '../../../Icons'
import { formatTimestamp, type TrackClip, type WorkbenchResource } from './videoWorkbench.types'
import { isResourceUsedInTrack } from './resourcePanelUtils'
import { ResourceThumb, type ThumbnailMeta } from './VideoWorkbenchResourceThumb'

type Filter = 'all' | 'video' | 'image'

export interface ResourceDragPayload {
  resourceId: string
  source: 'panel' | 'local' | 'upstream' | 'canvas'
}

interface Props {
  resources: WorkbenchResource[]
  track: TrackClip[]
  autoCollectUpstream: boolean
  busy: boolean
  onAddToTrack: (resource: WorkbenchResource) => void
  onPreview: (resource: WorkbenchResource) => void
  onRemoveResource: (resourceId: string) => void
  onAutoCollectToggle: (next: boolean) => void
  onCollectUpstream: () => void
  /** 「从本机添加」按钮回调（由父级 Modal 实现文件选择器） */
  onPickLocal?: (() => void) | undefined
  /** 「从画布选择」按钮回调（由父级 Modal 弹出画布节点选择器） */
  onPickCanvas?: (() => void) | undefined
  /** 视频缩略图 onLoadedMetadata 回填（durationSec / 宽高），仅在缺失字段时触发 */
  onResourceMeta?: ((resourceId: string, meta: ThumbnailMeta) => void) | undefined
}

const FILTER_LABELS: Record<Filter, string> = {
  all: '全部',
  video: '视频',
  image: '图片',
}

export function VideoWorkbenchResourcePanel({
  resources,
  track,
  autoCollectUpstream,
  busy,
  onAddToTrack,
  onPreview,
  onRemoveResource,
  onAutoCollectToggle,
  onCollectUpstream,
  onPickLocal,
  onPickCanvas,
  onResourceMeta,
}: Props): ReactElement {
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')

  const counts = useMemo(() => {
    let video = 0
    let image = 0
    for (const r of resources) {
      if (r.kind === 'video') video++
      else if (r.kind === 'image') image++
    }
    return { all: resources.length, video, image }
  }, [resources])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return resources.filter((r) => {
      if (filter !== 'all' && r.kind !== filter) return false
      if (!q) return true
      return r.title.toLowerCase().includes(q) || r.url.toLowerCase().includes(q)
    })
  }, [filter, query, resources])

  return (
    <div className="vwb-resource-panel">
      <div className="vwb-resource-head">
        <span className="vwb-resource-count">
          <strong>{resources.length}</strong>
          <span className="vwb-resource-count-muted"> 个资源</span>
        </span>
        <div className="vwb-resource-spacer" />
        <Tooltip title="开启后，工作台打开时按上级连线自动收集上游节点的首选产物">
          <label className="vwb-resource-toggle">
            <Switch
              size="small"
              checked={autoCollectUpstream}
              onChange={onAutoCollectToggle}
              disabled={busy}
            />
            <span>自动收集上游</span>
          </label>
        </Tooltip>
      </div>

      <div className="vwb-resource-toolbar">
        <input
          className="vwb-resource-search"
          placeholder="🔍 搜索资源..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {(['all', 'video', 'image'] as Filter[]).map((key) => (
          <button
            key={key}
            type="button"
            className={`vwb-resource-chip${filter === key ? ' is-active' : ''}`}
            onClick={() => setFilter(key)}
          >
            {FILTER_LABELS[key]} {counts[key]}
          </button>
        ))}
      </div>

      <div className="vwb-resource-quickadd">
        {onPickLocal && (
          <Button size="small" icon={<Icons.Upload size={13} />} onClick={onPickLocal}>
            本机
          </Button>
        )}
        {onPickCanvas && (
          <Button
            size="small"
            icon={<Icons.Layers size={13} />}
            onClick={onPickCanvas}
            disabled={busy}
          >
            从画布
          </Button>
        )}
        <Button
          size="small"
          type="primary"
          icon={<Icons.Link size={13} />}
          onClick={onCollectUpstream}
          loading={busy}
        >
          按上级连线收集
        </Button>
      </div>

      {visible.length === 0 ? (
        <div className="vwb-resource-empty">
          <Icons.Film size={28} />
          <strong>{resources.length === 0 ? '暂无资源' : '没有匹配的资源'}</strong>
          <div className="muted">
            {resources.length === 0
              ? '从本机导入图片 / 视频，或按上级连线自动收集上游节点的首选产物。'
              : '试试调整搜索关键词或筛选条件。'}
          </div>
          {resources.length === 0 && (
            <div className="vwb-resource-empty-hint">
              <strong>💡 上游节点首选产物规则</strong>
              <br />· 优先取首个视频产物
              <br />· 没有视频时取首个图片产物
              <br />· 一个上游节点可能产出多个产物，可在卡片上切换
            </div>
          )}
        </div>
      ) : (
        <div className="vwb-resource-grid">
          {visible.map((r) => {
            const used = isResourceUsedInTrack(track, r.id)
            return (
              <ResourceCard
                key={r.id}
                resource={r}
                used={used}
                onAdd={() => onAddToTrack(r)}
                onPreview={() => onPreview(r)}
                onRemove={() => onRemoveResource(r.id)}
                onMeta={
                  onResourceMeta ? (meta) => onResourceMeta(r.id, meta) : undefined
                }
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

interface ResourceCardProps {
  resource: WorkbenchResource
  used: boolean
  onAdd: () => void
  onPreview: () => void
  onRemove: () => void
  onMeta?: ((meta: ThumbnailMeta) => void) | undefined
}

function ResourceCard({
  resource,
  used,
  onAdd,
  onPreview,
  onRemove,
  onMeta,
}: ResourceCardProps): ReactElement {
  const { kind, title, source, durationSec, width, height, fileSize } = resource
  const isVideo = kind === 'video'
  const sourceLabel = source === 'upstream' ? '↑ 上游' : source === 'canvas' ? '🎨 画布' : '本地'
  const sourceClass =
    source === 'upstream' ? 'from-up' : source === 'canvas' ? 'from-canvas' : 'from-local'

  return (
    <div
      className={`vwb-resource-card${used ? ' used' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(
          'application/x-vwb-resource',
          JSON.stringify({
            resourceId: resource.id,
            source: 'panel',
          } satisfies ResourceDragPayload),
        )
        e.dataTransfer.effectAllowed = 'copy'
      }}
      title={title}
    >
      <div className="vwb-resource-thumb">
        <ResourceThumb resource={resource} className="vwb-resource-thumb-media" onMeta={onMeta} />
        <span className={`vwb-resource-type vwb-resource-type-${kind}`}>
          {isVideo ? '视频' : '图片'}
        </span>
        <span className={`vwb-resource-source ${sourceClass}`}>{sourceLabel}</span>
        {isVideo && durationSec ? (
          <span className="vwb-resource-duration">{formatTimestamp(durationSec)}</span>
        ) : !isVideo && width && height ? (
          <span className="vwb-resource-duration">
            {width}×{height}
          </span>
        ) : fileSize ? (
          <span className="vwb-resource-duration">{formatFileSize(fileSize)}</span>
        ) : null}
      </div>
      <div className="vwb-resource-info">
        <div className="vwb-resource-name">{title}</div>
        <div className="vwb-resource-meta">
          <span>
            {source === 'upstream'
              ? '视频工作台节点'
              : source === 'canvas'
                ? '画布节点'
                : '本机导入'}
          </span>
          {isVideo && durationSec ? <span>{formatTimestamp(durationSec)}</span> : null}
          {!isVideo && width && height ? (
            <span>
              {width}×{height}
            </span>
          ) : null}
        </div>
      </div>
      <Tooltip title="预览">
        <button
          type="button"
          className="vwb-resource-action"
          aria-label={`预览 ${title}`}
          onClick={onPreview}
        >
          <Icons.Eye size={13} />
        </button>
      </Tooltip>
      {used ? (
        <span className="vwb-resource-used-badge">已在轨道</span>
      ) : (
        <Tooltip title="加入轨道">
          <button
            type="button"
            className="vwb-resource-add"
            aria-label={`加入 ${title} 到轨道`}
            onClick={onAdd}
          >
            +
          </button>
        </Tooltip>
      )}
      <Tooltip title="从面板移除">
        <button
          type="button"
          className="vwb-resource-remove"
          aria-label={`移除 ${title}`}
          onClick={onRemove}
        >
          <Icons.X size={11} />
        </button>
      </Tooltip>
    </div>
  )
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}
