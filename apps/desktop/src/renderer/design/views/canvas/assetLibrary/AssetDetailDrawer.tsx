/**
 * 资产详情抽屉（步骤模式设计文档 §5.4，P2；R3 增强生成体验）。
 *
 * 展示单个资产的完整信息：大图、结构化属性（经 P1 的 FilmAssetPayload）、
 * prompt、引用与来源元数据。操作按钮由容器注入；本组件只读不写。
 *
 * R3 增强：
 * - generationStatus：最近一次生成任务状态（进行中/失败/完成），容器从快照
 *   节点反查（collectAssetGenerationStatuses）后传入——步骤模式视图不展示
 *   画布任务节点，抽屉是任务状态的唯一回显处。
 * - generator：生成配置区插槽（模型 + 画幅/分辨率参数 + 发起按钮），由
 *   容器注入（共享 useAssetGenerationConfig 实例），组件不感知其内部结构。
 */

import { useMemo, type ReactNode } from 'react'
import { Tag } from 'antd'
import { Button } from '@lobehub/ui'
import type { CanvasAsset, CanvasTaskStatus } from '../canvas.types'
import { AssetThumbnail } from '../CanvasAssetThumbnail'
import { FILM_ASSET_KIND_LABELS, readAssetKind } from '../canvasFilmAssets'
import { isStructuredFilmAssetPayload, readFilmAssetPayload } from './filmAssetPayload'
import {
  formatAssetGenerationProgress,
  isAssetGenerationActive,
  type AssetGenerationStatus,
} from './assetGenerationStatus'

export type AssetDetailAction = {
  key: string
  label: string
  icon?: ReactNode
  onClick: (asset: CanvasAsset) => void
  danger?: boolean
}

export type AssetDetailDrawerProps = {
  asset: CanvasAsset
  /** 未软删引用数（容器按 collectAssetReferences 口径算好传入） */
  usageCount: number
  onClose: () => void
  actions?: AssetDetailAction[]
  /** 最近一次生成任务状态（可选：画布模式/无任务时不传） */
  generationStatus?: AssetGenerationStatus | undefined
  /** 生成配置区插槽（模型 + 参数 + 发起按钮，容器注入） */
  generator?: ReactNode | undefined
}

function formatBytes(sizeBytes: number | null | undefined): string {
  if (!sizeBytes || sizeBytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = sizeBytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString()
}

function Field({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <div className="asset-library-field">
      <span className="asset-library-field-label">{label}</span>
      <span className="asset-library-field-value">{value}</span>
    </div>
  )
}

const STATUS_LABELS: Record<CanvasTaskStatus, string> = {
  pending: '排队中',
  running: '生成中',
  completed: '已完成',
  failed: '生成失败',
  cancelled: '已取消',
}

function GenerationStatusBanner({ status }: { status: AssetGenerationStatus }) {
  const active = isAssetGenerationActive(status)
  const label = STATUS_LABELS[status.status] ?? status.status
  const percent = formatAssetGenerationProgress(status.progress)
  const detail = status.status === 'failed' || status.status === 'cancelled' ? status.message : ''
  const tone = active ? 'is-running' : status.status === 'failed' ? 'is-failed' : 'is-idle'
  return (
    <div
      className={`asset-library-gen-status ${tone}`}
      role="status"
      aria-label={`生成任务：${label}`}
    >
      {active ? <span className="asset-library-gen-spinner" aria-hidden /> : null}
      <strong>{label}</strong>
      {percent ? <span className="asset-library-gen-percent">{percent}</span> : null}
      {detail ? (
        <span className="asset-library-gen-message" title={detail}>
          {detail}
        </span>
      ) : null}
      {status.updatedAt ? (
        <span className="asset-library-gen-time">{formatTime(status.updatedAt)}</span>
      ) : null}
    </div>
  )
}

export function AssetDetailDrawer({
  asset,
  usageCount,
  onClose,
  actions = [],
  generationStatus,
  generator,
}: AssetDetailDrawerProps) {
  const payload = useMemo(() => readFilmAssetPayload(asset), [asset])

  const structured: Array<{ label: string; value: string }> = []
  // raw 分支 kind 为宽 string，直接按 kind 比较无法收窄，必须先过类型守卫（同 P1 教训）
  if (payload && isStructuredFilmAssetPayload(payload)) {
    if (payload.kind === 'character') {
      structured.push({ label: '外貌', value: payload.character.appearance })
      if (payload.character.personality) {
        structured.push({ label: '性格', value: payload.character.personality })
      }
    } else if (payload.kind === 'scene') {
      structured.push({ label: '场景描述', value: payload.scene.description })
      if (payload.scene.timeOfDay)
        structured.push({ label: '时段', value: payload.scene.timeOfDay })
    } else if (payload.kind === 'prop') {
      structured.push({ label: '道具描述', value: payload.prop.description })
    } else if (payload.kind === 'effect') {
      structured.push({ label: '特效描述', value: payload.effect.description })
    }
  }

  const meta = asset.metadata ?? {}
  const prompt = typeof meta['prompt'] === 'string' ? (meta['prompt'] as string) : ''
  const tags = Array.isArray(meta['tags'])
    ? (meta['tags'] as unknown[]).filter((tag): tag is string => typeof tag === 'string')
    : []
  const providerProfileId =
    typeof meta['providerProfileId'] === 'string' ? (meta['providerProfileId'] as string) : ''
  const originTaskId =
    typeof meta['originTaskId'] === 'string' ? (meta['originTaskId'] as string) : ''
  const fileId = typeof meta['fileId'] === 'string' ? (meta['fileId'] as string) : ''

  return (
    <>
      <div className="asset-library-drawer-overlay" onClick={onClose} />
      <aside className="asset-library-drawer">
        <div className="asset-library-drawer-header">
          <strong title={asset.title ?? asset.id}>{asset.title ?? asset.id}</strong>
          <button className="asset-library-close" onClick={onClose} aria-label="关闭详情">
            ✕
          </button>
        </div>
        <div className="asset-library-drawer-body">
          <div className="asset-library-card-thumb" style={{ borderRadius: 10 }}>
            <AssetThumbnail asset={asset} />
          </div>

          {generationStatus ? <GenerationStatusBanner status={generationStatus} /> : null}

          {generator}

          <div className="asset-library-field">
            <span className="asset-library-field-label">分类</span>
            <span className="asset-library-field-value">
              {(() => {
                const kind = readAssetKind(asset)
                return kind ? FILM_ASSET_KIND_LABELS[kind] : asset.type
              })()}
            </span>
          </div>

          {tags.length > 0 ? (
            <div className="asset-library-field">
              <span className="asset-library-field-label">标签</span>
              <span className="asset-library-field-value">
                {tags.map((tag) => (
                  <Tag key={tag}>{tag}</Tag>
                ))}
              </span>
            </div>
          ) : null}

          {structured.map((field) => (
            <Field key={field.label} label={field.label} value={field.value} />
          ))}

          <Field label="提示词" value={prompt} />

          <div>
            <div className="asset-library-field-label" style={{ marginBottom: 4 }}>
              引用与来源
            </div>
            <div className="asset-library-meta-row">
              <span>引用数</span>
              <span>{usageCount > 0 ? `${usageCount} 个画布节点` : '未被引用'}</span>
            </div>
            <div className="asset-library-meta-row">
              <span>类型</span>
              <span>{asset.type}</span>
            </div>
            {providerProfileId ? (
              <div className="asset-library-meta-row">
                <span>生成渠道</span>
                <span>{providerProfileId}</span>
              </div>
            ) : null}
            {fileId ? (
              <div className="asset-library-meta-row">
                <span>Provider 文件</span>
                <span title={fileId}>{fileId}</span>
              </div>
            ) : null}
            {originTaskId ? (
              <div className="asset-library-meta-row">
                <span>来源任务</span>
                <span title={originTaskId}>{originTaskId}</span>
              </div>
            ) : null}
            <div className="asset-library-meta-row">
              <span>大小</span>
              <span>{formatBytes(asset.sizeBytes)}</span>
            </div>
            <div className="asset-library-meta-row">
              <span>创建时间</span>
              <span>{formatTime(asset.createdAt)}</span>
            </div>
            <div className="asset-library-meta-row">
              <span>更新时间</span>
              <span>{formatTime(asset.updatedAt)}</span>
            </div>
          </div>

          {actions.length > 0 ? (
            <div className="asset-library-drawer-actions">
              {actions.map((action) => (
                <Button
                  key={action.key}
                  icon={action.icon}
                  size="small"
                  type={action.danger ? 'default' : 'primary'}
                  onClick={() => action.onClick(asset)}
                  style={action.danger ? { color: 'var(--ast-danger)' } : undefined}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      </aside>
    </>
  )
}
