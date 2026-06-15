import { useMemo, useState, type ReactNode } from 'react'
import { Button, Tag } from '@lobehub/ui'
import { Descriptions, Empty, Modal, Progress, Space } from 'antd'
import { Icons } from '../../Icons'
import { isMediaOperation, operationLabel } from './canvas.api'
import type { CanvasAsset, CanvasNode, CanvasTask, CanvasTaskStatus } from './canvas.types'

type TaskFilter = 'all' | 'active' | 'failed' | 'completed'

export function CanvasTaskQueue({
  tasks,
  nodes,
  assets,
  onCompleteDemoTask,
  onCancelTask,
  onRetryTask,
  onSelectNode,
}: {
  tasks: CanvasTask[]
  nodes: CanvasNode[]
  assets: CanvasAsset[]
  onCompleteDemoTask: (taskId: string) => void
  onCancelTask: (taskId: string) => void
  onRetryTask: (task: CanvasTask) => void
  onSelectNode: (nodeId: string) => void
}) {
  const [filter, setFilter] = useState<TaskFilter>('all')
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null)
  const orderedTasks = useMemo(
    () => [...tasks].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [tasks],
  )
  const visibleTasks = orderedTasks.filter((task) => {
    if (filter === 'active') return isTaskActive(task)
    if (filter === 'failed') return task.status === 'failed' || task.status === 'cancelled'
    if (filter === 'completed') return task.status === 'completed'
    return true
  })
  const activeCount = tasks.filter(isTaskActive).length
  const failedCount = tasks.filter((task) => task.status === 'failed' || task.status === 'cancelled').length
  const completedCount = tasks.filter((task) => task.status === 'completed').length
  const detailTask = tasks.find((task) => task.id === detailTaskId) ?? null

  return (
    <section className="canvas-panel-section canvas-task-center">
      <div className="canvas-panel-title-row">
        <h3>任务队列</h3>
        <Tag color={activeCount > 0 ? 'blue' : 'default'}>
          {activeCount} 运行
        </Tag>
      </div>

      <div className="canvas-task-stat-grid">
        <TaskStat label="全部" value={tasks.length} active={filter === 'all'} onClick={() => setFilter('all')} />
        <TaskStat label="运行" value={activeCount} active={filter === 'active'} onClick={() => setFilter('active')} />
        <TaskStat label="失败" value={failedCount} active={filter === 'failed'} onClick={() => setFilter('failed')} />
        <TaskStat label="完成" value={completedCount} active={filter === 'completed'} onClick={() => setFilter('completed')} />
      </div>

      <div className="canvas-task-queue-list">
        {visibleTasks.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无任务" />
        ) : (
          visibleTasks.map((task) => (
            <button
              key={task.id}
              type="button"
              className={`canvas-task-card canvas-task-card-${task.status}`}
              onClick={() => setDetailTaskId(task.id)}
            >
              <div className="canvas-task-card-head">
                <span className="canvas-task-card-title">
                  {task.title ?? operationLabel(task.operation)}
                </span>
                <TaskStatusTag status={task.status} />
              </div>
              <div className="canvas-task-card-meta">
                <span>{operationLabel(task.operation)}</span>
                {task.provider ? <span>{task.provider}</span> : null}
                {task.modelId ? <span>{task.modelId}</span> : null}
              </div>
              <Progress percent={task.progress} size="small" status={progressStatus(task.status)} />
              {(task.errorMsg || task.errorDetail) && (
                <div className="canvas-task-card-error">
                  {task.errorDetail ?? task.errorMsg}
                </div>
              )}
            </button>
          ))
        )}
      </div>

      <TaskDetailModal
        task={detailTask}
        nodes={nodes}
        assets={assets}
        onClose={() => setDetailTaskId(null)}
        onCancelTask={onCancelTask}
        onCompleteDemoTask={onCompleteDemoTask}
        onRetryTask={onRetryTask}
        onSelectNode={onSelectNode}
      />
    </section>
  )
}

function TaskStat({
  label,
  value,
  active,
  onClick,
}: {
  label: string
  value: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`canvas-task-stat${active ? ' canvas-task-stat-active' : ''}`}
      onClick={onClick}
    >
      <strong>{value}</strong>
      <span>{label}</span>
    </button>
  )
}

function TaskDetailModal({
  task,
  nodes,
  assets,
  onClose,
  onCancelTask,
  onCompleteDemoTask,
  onRetryTask,
  onSelectNode,
}: {
  task: CanvasTask | null
  nodes: CanvasNode[]
  assets: CanvasAsset[]
  onClose: () => void
  onCancelTask: (taskId: string) => void
  onCompleteDemoTask: (taskId: string) => void
  onRetryTask: (task: CanvasTask) => void
  onSelectNode: (nodeId: string) => void
}) {
  if (!task) return null

  const inputNodes = nodes.filter((node) => task.inputNodeIds.includes(node.id))
  const outputNodes = nodes.filter((node) => task.outputNodeIds.includes(node.id))
  const inputAssets = assets.filter((asset) => task.inputAssetIds.includes(asset.id))
  const outputAssets = assets.filter((asset) => task.outputAssetIds.includes(asset.id))
  const taskNode = nodes.find((node) => node.taskId === task.id)
  const canCancel = isTaskActive(task)
  const canDemoComplete = !isMediaOperation(task.operation) && task.status !== 'completed'

  return (
    <Modal
      title="任务详情"
      open
      onCancel={onClose}
      footer={null}
      width={680}
      className="canvas-task-detail-modal"
    >
      <div className="canvas-task-detail">
        <div className="canvas-task-detail-hero">
          <div>
            <div className="canvas-task-detail-title">
              {task.title ?? operationLabel(task.operation)}
            </div>
            <div className="canvas-task-detail-meta">
              {operationLabel(task.operation)}
              {task.provider ? ` / ${task.provider}` : ''}
              {task.modelId ? ` / ${task.modelId}` : ''}
            </div>
          </div>
          <TaskStatusTag status={task.status} />
        </div>

        <Progress percent={task.progress} status={progressStatus(task.status)} />

        <Space size={8} wrap>
          {taskNode && (
            <Button size="small" icon={<Icons.Activity size={14} />} onClick={() => onSelectNode(taskNode.id)}>
              定位任务节点
            </Button>
          )}
          <Button size="small" disabled={!canCancel} onClick={() => onCancelTask(task.id)}>
            中断取消
          </Button>
          <Button size="small" onClick={() => onRetryTask(task)}>
            {task.status === 'failed' || task.status === 'cancelled' ? '重试' : '再次运行'}
          </Button>
          {canDemoComplete && (
            <Button size="small" type="primary" onClick={() => onCompleteDemoTask(task.id)}>
              Demo 完成
            </Button>
          )}
        </Space>

        <Descriptions
          size="small"
          column={2}
          className="canvas-task-detail-desc"
          items={[
            { label: 'Task ID', children: task.id },
            { label: 'Request', children: task.requestId ?? '-' },
            { label: 'Provider Profile', children: task.providerProfileId ?? '-' },
            { label: 'Manifest', children: task.manifestId ?? '-' },
            { label: 'Agent', children: task.agentId ?? task.agentMode ?? '-' },
            { label: '创建时间', children: formatTime(task.createdAt) },
            { label: '更新时间', children: formatTime(task.updatedAt) },
            { label: '完成时间', children: task.completedAt ? formatTime(task.completedAt) : '-' },
          ]}
        />

        {task.prompt && (
          <DetailBlock title="Prompt">
            <pre>{task.prompt}</pre>
          </DetailBlock>
        )}

        <DetailBlock title="输入 / 输出">
          <div className="canvas-task-ref-grid">
            <TaskRefList title="输入节点" nodes={inputNodes} onSelectNode={onSelectNode} />
            <TaskRefList title="输出节点" nodes={outputNodes} onSelectNode={onSelectNode} />
            <AssetRefList title="输入资产" assets={inputAssets} />
            <AssetRefList title="输出资产" assets={outputAssets} />
          </div>
        </DetailBlock>

        <DetailBlock title="参数">
          <pre>{formatJson(task.modelParams)}</pre>
        </DetailBlock>

        {task.requestCall && (
          <DetailBlock title="请求摘要">
            <div className="canvas-task-request-call">
              <div className="canvas-task-request-line">
                <Tag size="small" color="blue">{task.requestCall.method}</Tag>
                <code>{task.requestCall.url}</code>
              </div>
              {task.requestCall.body != null && (
                <pre>{formatJson(task.requestCall.body)}</pre>
              )}
            </div>
          </DetailBlock>
        )}

        {(task.errorMsg || task.errorDetail) && (
          <DetailBlock title="错误日志">
            <div className="canvas-task-error-log">
              <strong>{task.errorMsg ?? 'error'}</strong>
              <pre>{task.errorDetail ?? '-'}</pre>
            </div>
          </DetailBlock>
        )}

        <DetailBlock title="运行日志">
          <div className="canvas-task-log-list">
            <TaskLogItem time={task.createdAt} label="任务创建" />
            {task.requestId && <TaskLogItem time={task.updatedAt} label={`Provider request: ${task.requestId}`} />}
            <TaskLogItem time={task.updatedAt} label={`状态更新为 ${task.status}`} />
            {task.completedAt && <TaskLogItem time={task.completedAt} label="任务结束" />}
          </div>
        </DetailBlock>

        {task.rawResponse != null && (
          <DetailBlock title="原始响应摘要">
            <pre>{formatJson(task.rawResponse)}</pre>
          </DetailBlock>
        )}
      </div>
    </Modal>
  )
}

function DetailBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="canvas-task-detail-block">
      <div className="canvas-task-detail-block-title">{title}</div>
      {children}
    </div>
  )
}

function TaskRefList({
  title,
  nodes,
  onSelectNode,
}: {
  title: string
  nodes: CanvasNode[]
  onSelectNode: (nodeId: string) => void
}) {
  return (
    <div className="canvas-task-ref-list">
      <span>{title}</span>
      {nodes.length === 0 ? (
        <em>-</em>
      ) : (
        nodes.map((node) => (
          <button key={node.id} type="button" onClick={() => onSelectNode(node.id)}>
            {node.title ?? node.type}
          </button>
        ))
      )}
    </div>
  )
}

function AssetRefList({ title, assets }: { title: string; assets: CanvasAsset[] }) {
  return (
    <div className="canvas-task-ref-list">
      <span>{title}</span>
      {assets.length === 0 ? (
        <em>-</em>
      ) : (
        assets.map((asset) => <em key={asset.id}>{asset.title ?? asset.type}</em>)
      )}
    </div>
  )
}

function TaskLogItem({ time, label }: { time: string; label: string }) {
  return (
    <div className="canvas-task-log-item">
      <span>{formatTime(time)}</span>
      <strong>{label}</strong>
    </div>
  )
}

function TaskStatusTag({ status }: { status: CanvasTaskStatus }) {
  return (
    <Tag color={statusColor(status)} bordered>
      {statusLabel(status)}
    </Tag>
  )
}

function isTaskActive(task: CanvasTask): boolean {
  return task.status === 'pending' || task.status === 'running'
}

function statusColor(status: CanvasTaskStatus): string {
  if (status === 'completed') return 'green'
  if (status === 'failed') return 'red'
  if (status === 'cancelled') return 'orange'
  if (status === 'running') return 'blue'
  return 'default'
}

function statusLabel(status: CanvasTaskStatus): string {
  if (status === 'completed') return '完成'
  if (status === 'failed') return '失败'
  if (status === 'cancelled') return '已取消'
  if (status === 'running') return '运行中'
  return '等待中'
}

function progressStatus(status: CanvasTaskStatus): 'normal' | 'active' | 'exception' | 'success' {
  if (status === 'completed') return 'success'
  if (status === 'failed' || status === 'cancelled') return 'exception'
  if (status === 'running' || status === 'pending') return 'active'
  return 'normal'
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString()
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2)
  } catch {
    return String(value)
  }
}
