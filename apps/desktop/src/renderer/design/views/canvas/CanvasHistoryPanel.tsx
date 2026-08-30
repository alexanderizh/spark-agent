import { useMemo } from 'react'
import { Tag, Tooltip, message } from 'antd'
import { Button } from '@lobehub/ui'
import { Icons } from '../../Icons'
import { AssetThumbnail } from './CanvasAssetThumbnail'
import { operationLabel } from './canvas.api'
import type { CanvasAsset, CanvasTask } from './canvas.types'

/**
 * 历史面板（文档 §7.9）。
 *
 * 不是新的数据源，而是已有 task + assets 的聚合视图：
 *   - 最近生成的资产（source = ai_generated / ai_edited，按时间倒序）
 *   - 最近上传的资产（source = upload / imported）
 *   - 最近成功的任务（status = completed）
 *   - 最近失败可重试的任务（status = failed）
 *
 * 复用点：任务来自 props.tasks，资产来自 props.assets；定位/重试/插入复用现有 handler。
 */

type HistoryEntry =
  | { kind: 'asset'; asset: CanvasAsset; subLabel: string }
  | { kind: 'task'; task: CanvasTask }

export function CanvasHistoryPanel({
  assets,
  tasks,
  onInsertAsset,
  onLocateTaskNode,
  onRetryTask,
}: {
  assets: CanvasAsset[]
  tasks: CanvasTask[]
  onInsertAsset: (assetId: string) => void
  onLocateTaskNode: (taskId: string) => void
  onRetryTask: (taskId: string) => void
}) {
  // 最近生成资产（AI 产出，按 updatedAt 倒序，最多 12）
  const recentGenerated = useMemo(
    () =>
      assets
        .filter((asset) => asset.source === 'ai_generated' || asset.source === 'ai_edited')
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 12),
    [assets],
  )

  // 最近上传资产（用户素材，按 updatedAt 倒序，最多 12）
  const recentUploaded = useMemo(
    () =>
      assets
        .filter((asset) => asset.source === 'upload' || asset.source === 'imported')
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 12),
    [assets],
  )

  // 最近成功任务（按 completedAt/updatedAt 倒序，最多 8）
  const recentSucceeded = useMemo(
    () =>
      tasks
        .filter((task) => task.status === 'completed')
        .sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt))
        .slice(0, 8),
    [tasks],
  )

  // 最近失败可重试任务（按 updatedAt 倒序，最多 8）
  const recentFailed = useMemo(
    () =>
      tasks
        .filter((task) => task.status === 'failed')
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 8),
    [tasks],
  )

  return (
    <div className="canvas-history-panel">
      <HistorySection
        title="最近生成"
        icon={<Icons.Sparkles size={14} />}
        emptyText="暂无 AI 生成资产"
        count={recentGenerated.length}
      >
        <HistoryAssetGrid
          assets={recentGenerated}
          subLabel={(asset) => asset.source === 'ai_edited' ? 'AI 编辑' : 'AI 生成'}
          onInsert={onInsertAsset}
        />
      </HistorySection>

      <HistorySection
        title="最近上传"
        icon={<Icons.Upload size={14} />}
        emptyText="暂无上传资产"
        count={recentUploaded.length}
      >
        <HistoryAssetGrid
          assets={recentUploaded}
          subLabel={(asset) => asset.source === 'imported' ? '导入' : '上传'}
          onInsert={onInsertAsset}
        />
      </HistorySection>

      <HistorySection
        title="成功的任务"
        icon={<Icons.CheckCircle size={14} />}
        emptyText="暂无已完成任务"
        count={recentSucceeded.length}
      >
        <div className="canvas-history-task-list">
          {recentSucceeded.map((task) => (
            <HistoryTaskRow
              key={task.id}
              task={task}
              onLocate={() => onLocateTaskNode(task.id)}
            />
          ))}
        </div>
      </HistorySection>

      <HistorySection
        title="失败可重试"
        icon={<Icons.X size={14} />}
        emptyText="暂无失败任务"
        count={recentFailed.length}
      >
        <div className="canvas-history-task-list">
          {recentFailed.map((task) => (
            <HistoryTaskRow
              key={task.id}
              task={task}
              failed
              onLocate={() => onLocateTaskNode(task.id)}
              onRetry={() => onRetryTask(task.id)}
            />
          ))}
        </div>
      </HistorySection>
    </div>
  )
}

function HistorySection({
  title,
  icon,
  emptyText,
  count,
  children,
}: {
  title: string
  icon: React.ReactNode
  emptyText: string
  count: number
  children: React.ReactNode
}) {
  return (
    <div className="canvas-history-section">
      <div className="canvas-history-section-title">
        <span className="canvas-history-section-icon">{icon}</span>
        <span>{title}</span>
        {count > 0 && <Tag color="default" bordered className="canvas-history-count">{count}</Tag>}
      </div>
      {count === 0 ? (
        <div className="canvas-history-empty">{emptyText}</div>
      ) : (
        children
      )}
    </div>
  )
}

function HistoryAssetGrid({
  assets,
  subLabel,
  onInsert,
}: {
  assets: CanvasAsset[]
  subLabel: (asset: CanvasAsset) => string
  onInsert: (assetId: string) => void
}) {
  return (
    <div className="canvas-history-asset-grid">
      {assets.map((asset) => (
        <div key={asset.id} className="canvas-history-asset" title={asset.title ?? asset.type}>
          <div className="canvas-history-asset-thumb">
            <AssetThumbnail asset={asset} />
          </div>
          <div className="canvas-history-asset-info">
            <span className="canvas-history-asset-name">{asset.title ?? asset.type}</span>
            <span className="canvas-history-asset-sub">{subLabel(asset)}</span>
          </div>
          <Tooltip title="插入到当前视口">
            <Button
              size="middle"
              type="text"
              icon={<Icons.Plus size={13} />}
              onClick={() => onInsert(asset.id)}
            />
          </Tooltip>
        </div>
      ))}
    </div>
  )
}

function HistoryTaskRow({
  task,
  failed,
  onLocate,
  onRetry,
}: {
  task: CanvasTask
  failed?: boolean
  onLocate: () => void
  onRetry?: () => void
}) {
  return (
    <div className="canvas-history-task">
      <div className="canvas-history-task-main">
        <div className="canvas-history-task-title">{task.title ?? operationLabel(task.operation)}</div>
        <div className="canvas-history-task-meta">
          <Tag color={failed ? 'red' : 'green'} bordered>
            {task.status}
          </Tag>
          {task.prompt && (
            <span className="canvas-history-task-prompt" title={task.prompt}>
              {task.prompt.slice(0, 40)}
            </span>
          )}
        </div>
      </div>
      <div className="canvas-history-task-actions">
        {failed && onRetry && (
          <Tooltip title="重试">
            <Button size="middle" type="text" icon={<Icons.RotateCcw size={13} />} onClick={onRetry} />
          </Tooltip>
        )}
        <Tooltip title="定位任务节点">
          <Button size="middle" type="text" icon={<Icons.Search size={13} />} onClick={onLocate} />
        </Tooltip>
      </div>
    </div>
  )
}
