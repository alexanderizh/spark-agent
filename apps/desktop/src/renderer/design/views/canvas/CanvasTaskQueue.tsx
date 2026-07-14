import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, Tag } from '@lobehub/ui'
import { Descriptions, Empty, Modal, Progress, Space } from 'antd'
import { Icons } from '../../Icons'
import { operationLabel } from './canvas.api'
import { buildCanvasTaskDetailParams } from './canvasTaskInputDiagnostics'
import type { CanvasAsset, CanvasNode, CanvasTask, CanvasTaskStatus } from './canvas.types'
import { CanvasTaskInputSnapshotList } from './CanvasTaskInputSnapshotList'

type TaskFilter = 'all' | 'active' | 'failed' | 'completed'
type ClearTaskScope = 'active' | 'failed'

export function CanvasTaskQueue({
  tasks,
  nodes,
  assets,
  onCancelTask,
  onClearTasks,
  onDeleteTasks,
  onRetryTask,
  onSelectNode,
}: {
  tasks: CanvasTask[]
  nodes: CanvasNode[]
  assets: CanvasAsset[]
  onCancelTask: (taskId: string) => void
  onClearTasks: (scope: ClearTaskScope) => void | Promise<void>
  onDeleteTasks: (taskIds: string[]) => void | Promise<void>
  onRetryTask: (task: CanvasTask) => void
  onSelectNode: (nodeId: string) => void
}) {
  const [filter, setFilter] = useState<TaskFilter>('all')
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null)
  const [queueModalOpen, setQueueModalOpen] = useState(false)
  // loading 标识：'active'/'failed'/'orphan' 对应正在进行的批量操作，null 表示空闲。
  const [clearing, setClearing] = useState<string | null>(null)
  // 防止「全部取消」等批量操作被重复触发（运行中任务串行取消耗时较长）。
  const clearingRef = useRef(false)
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
  const failedCount = tasks.filter(
    (task) => task.status === 'failed' || task.status === 'cancelled',
  ).length
  const completedCount = tasks.filter((task) => task.status === 'completed').length
  // 孤儿任务：仍在运行（pending/running）但承载节点已被删除。多由历史脏数据产生，
  // cancelTask 无法真正终止（节点没了 runtime 也无意义），需单独提供清理入口。
  // hostedTaskIds 同时复用于 TaskCard：孤儿任务显示「清理」而非「取消」。
  const hostedTaskIds = useMemo(
    () => new Set(nodes.map((node) => node.taskId).filter(Boolean) as string[]),
    [nodes],
  )
  const isOrphanTask = (task: CanvasTask) =>
    isTaskActive(task) && !hostedTaskIds.has(task.id)
  const orphanTasks = tasks.filter(isOrphanTask)
  const orphanCount = orphanTasks.length
  const detailTask = tasks.find((task) => task.id === detailTaskId) ?? null

  // 删除孤儿任务（单条或批量）：二次确认后走 onDeleteTasks 直接删除记录。
  // 不走 cancelTask，因为孤儿任务的承载节点已删除，runtime 早已失效，无法正常取消。
  const runDeleteOrphans = (taskIds: string[]) => {
    if (taskIds.length === 0 || clearingRef.current) return
    const count = taskIds.length
    Modal.confirm({
      title:
        count === 1
          ? '清理该无节点的运行中任务？'
          : `清理 ${count} 个无节点的运行中任务？`,
      content:
        '这些任务的承载节点已被删除，runtime 早已失效，无法正常取消。将直接从队列删除这些残留记录，操作不可撤销。',
      okText: '清理',
      okButtonProps: { danger: true },
      cancelText: '再想想',
      onOk: async () => {
        clearingRef.current = true
        setClearing('orphan')
        try {
          await Promise.resolve(onDeleteTasks(taskIds))
        } finally {
          clearingRef.current = false
          setClearing(null)
        }
      },
    })
  }

  // 二次确认后执行批量清理。批量取消运行中任务是高危操作（会中断正在生成的任务），
  // 删除失败记录不可撤销，因此统一走 Modal.confirm 确认。
  const runClearTasks = (scope: ClearTaskScope, count: number) => {
    if (count === 0 || clearingRef.current) return
    const isClearActive = scope === 'active'
    Modal.confirm({
      title: isClearActive
        ? `取消全部 ${count} 个运行中任务？`
        : `清空全部 ${count} 个失败任务？`,
      content: isClearActive
        ? '将中断这些正在运行的任务，已生成的部分结果不会保留。'
        : '将从队列中删除这些已结束的任务记录，操作不可撤销。',
      okText: isClearActive ? '全部取消' : '清空',
      okButtonProps: { danger: true },
      cancelText: '再想想',
      onOk: async () => {
        clearingRef.current = true
        setClearing(scope)
        try {
          await Promise.resolve(onClearTasks(scope))
        } finally {
          clearingRef.current = false
          setClearing(null)
        }
      },
    })
  }

  return (
    <section className="canvas-panel-section canvas-task-center">
      <div className="canvas-panel-title-row">
        <h3>任务队列</h3>
        <Space size={6}>
          <Tag color={activeCount > 0 ? 'blue' : 'default'}>{activeCount} 运行</Tag>
          <Button
            size="middle"
            type="text"
            icon={<Icons.Maximize size={14} />}
            onClick={() => setQueueModalOpen(true)}
          >
            放大
          </Button>
          {activeCount > 0 && (
            <Button
              size="middle"
              type="text"
              danger
              title="全部取消"
              loading={clearing === 'active'}
              icon={<Icons.Square size={14} />}
              onClick={() => runClearTasks('active', activeCount)}
            >
              取消
            </Button>
          )}
          {orphanCount > 0 && (
            <Button
              size="middle"
              type="text"
              danger
              title="清理无节点"
              loading={clearing === 'orphan'}
              icon={<Icons.Trash size={14} />}
              onClick={() => runDeleteOrphans(orphanTasks.map((task) => task.id))}
            >
              清理({orphanCount})
            </Button>
          )}
   
        </Space>
      </div>

      <div className="canvas-task-stat-grid">
        <TaskStat
          label="全部"
          value={tasks.length}
          active={filter === 'all'}
          onClick={() => setFilter('all')}
        />
        <TaskStat
          label="运行"
          value={activeCount}
          active={filter === 'active'}
          onClick={() => setFilter('active')}
        />
        <TaskStat
          label="失败"
          value={failedCount}
          active={filter === 'failed'}
          onClick={() => setFilter('failed')}
        />
        <TaskStat
          label="完成"
          value={completedCount}
          active={filter === 'completed'}
          onClick={() => setFilter('completed')}
        />
      </div>

      <div className="canvas-task-queue-list">
        {visibleTasks.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无任务" />
        ) : (
          visibleTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              orphan={isOrphanTask(task)}
              onOpen={() => setDetailTaskId(task.id)}
              onCancelTask={onCancelTask}
              onClearOrphan={() => runDeleteOrphans([task.id])}
            />
          ))
        )}
      </div>

      <Modal
        title="任务队列"
        open={queueModalOpen}
        onCancel={() => setQueueModalOpen(false)}
        footer={null}
        width="min(1080px, 92vw)"
        className="canvas-task-queue-modal"
      >
        <div className="canvas-task-queue-modal-body">
          <div className="canvas-task-stat-grid">
            <TaskStat
              label="全部"
              value={tasks.length}
              active={filter === 'all'}
              onClick={() => setFilter('all')}
            />
            <TaskStat
              label="运行"
              value={activeCount}
              active={filter === 'active'}
              onClick={() => setFilter('active')}
            />
            <TaskStat
              label="失败"
              value={failedCount}
              active={filter === 'failed'}
              onClick={() => setFilter('failed')}
            />
            <TaskStat
              label="完成"
              value={completedCount}
              active={filter === 'completed'}
              onClick={() => setFilter('completed')}
            />
          </div>
          <div className="canvas-task-queue-bulk-actions">
            <Button
              size="middle"
              danger
              disabled={activeCount === 0}
              loading={clearing === 'active'}
              icon={<Icons.Square size={14} />}
              onClick={() => runClearTasks('active', activeCount)}
            >
              清空运行中{activeCount > 0 ? `(${activeCount})` : ''}
            </Button>
            <Button
              size="middle"
              disabled={failedCount === 0}
              loading={clearing === 'failed'}
              icon={<Icons.Trash size={14} />}
              onClick={() => runClearTasks('failed', failedCount)}
            >
              清空失败{failedCount > 0 ? `(${failedCount})` : ''}
            </Button>
            {orphanCount > 0 && (
              <Button
                size="middle"
                danger
                loading={clearing === 'orphan'}
                icon={<Icons.Trash size={14} />}
                onClick={() => runDeleteOrphans(orphanTasks.map((task) => task.id))}
              >
                清理无节点任务({orphanCount})
              </Button>
            )}
          </div>
          <div className="canvas-task-queue-list canvas-task-queue-list-modal">
            {visibleTasks.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无任务" />
            ) : (
              visibleTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  orphan={isOrphanTask(task)}
                  onOpen={() => setDetailTaskId(task.id)}
                  onCancelTask={onCancelTask}
                  onClearOrphan={() => runDeleteOrphans([task.id])}
                />
              ))
            )}
          </div>
        </div>
      </Modal>

      <TaskDetailModal
        task={detailTask}
        nodes={nodes}
        assets={assets}
        onClose={() => setDetailTaskId(null)}
        onCancelTask={onCancelTask}
        onRetryTask={onRetryTask}
        onSelectNode={onSelectNode}
      />
    </section>
  )
}

/**
 * 单个任务卡片：点击打开详情；运行中/等待中任务显示「取消」按钮（不进入详情，直接取消）。
 * 孤儿任务（承载节点已删）的「取消」替换为「清理」——cancelTask 对它无效，
 * 改走直接删除记录。
 */
function TaskCard({
  task,
  orphan,
  onOpen,
  onCancelTask,
  onClearOrphan,
}: {
  task: CanvasTask
  orphan: boolean
  onOpen: () => void
  onCancelTask: (taskId: string) => void
  onClearOrphan: () => void
}) {
  const active = isTaskActive(task)
  return (
    <div
      className={`canvas-task-card canvas-task-card-${task.status}${orphan ? ' canvas-task-card-orphan' : ''}`}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
    >
      <div className="canvas-task-card-head">
        <span className="canvas-task-card-title">
          {task.title ?? operationLabel(task.operation)}
        </span>
        <div className="canvas-task-card-head-right">
          {active &&
            (orphan ? (
              <button
                type="button"
                className="canvas-task-card-cancel canvas-task-card-clear"
                title="清理无节点的残留任务"
                onClick={(event) => {
                  event.stopPropagation()
                  onClearOrphan()
                }}
              >
                清理
              </button>
            ) : (
              <button
                type="button"
                className="canvas-task-card-cancel"
                title="取消任务"
                onClick={(event) => {
                  event.stopPropagation()
                  onCancelTask(task.id)
                }}
              >
                取消
              </button>
            ))}
          <TaskStatusTag status={task.status} />
        </div>
      </div>
      <div className="canvas-task-card-meta">
        <span>{operationLabel(task.operation)}</span>
        {orphan && <span className="canvas-task-card-orphan-tag">无节点</span>}
        {task.provider ? <span>{task.provider}</span> : null}
        {task.modelId ? <span>{task.modelId}</span> : null}
      </div>
      <Progress percent={task.progress} size="middle" status={progressStatus(task.status)} />
      {orphan ? (
        <div className="canvas-task-card-error">
          承载节点已被删除，无法正常取消，请点「清理」移除该残留记录。
        </div>
      ) : (task.errorMsg || task.errorDetail) ? (
        <div className="canvas-task-card-error">{task.errorDetail ?? task.errorMsg}</div>
      ) : null}
    </div>
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
  onRetryTask,
  onSelectNode,
}: {
  task: CanvasTask | null
  nodes: CanvasNode[]
  assets: CanvasAsset[]
  onClose: () => void
  onCancelTask: (taskId: string) => void
  onRetryTask: (task: CanvasTask) => void
  onSelectNode: (nodeId: string) => void
}) {
  if (!task) return null

  const inputNodes = nodes.filter((node) => task.inputNodeIds.includes(node.id))
  const outputNodes = nodes.filter((node) => task.outputNodeIds.includes(node.id))
  // 节点已代表其背后资产（节点带 assetId）时，资产版块就是冗余展示，
  // 节点版块既能定位跳转又带原标题。仅显示那些没被任何对应节点代表的纯资产引用。
  const inputNodeAssetIds = new Set(
    inputNodes.map((n) => n.assetId).filter((id): id is string => Boolean(id))
  )
  const outputNodeAssetIds = new Set(
    outputNodes.map((n) => n.assetId).filter((id): id is string => Boolean(id))
  )
  const inputAssets = assets.filter(
    (asset) => task.inputAssetIds.includes(asset.id) && !inputNodeAssetIds.has(asset.id)
  )
  const outputAssets = assets.filter(
    (asset) => task.outputAssetIds.includes(asset.id) && !outputNodeAssetIds.has(asset.id)
  )
  const taskNode = nodes.find((node) => node.taskId === task.id)
  const canCancel = isTaskActive(task)
  const raw = isRecord(task.rawResponse) ? task.rawResponse : null
  const outputText = stringField(raw?.outputText) || stringField(raw?.text)
  const parsedEntities = raw?.parsedEntities
  const displayPrompt = task.compiledUserText || task.prompt || ''
  const detailParams = buildCanvasTaskDetailParams(task)
  const httpResponse = task.requestCall?.response
  const providerResponseText = task.rawResponse != null ? formatJson(task.rawResponse) : ''
  const httpResponseBodyText = httpResponse?.body != null ? formatJson(httpResponse.body) : ''
  const shouldShowProviderResponse =
    task.rawResponse != null &&
    (!httpResponseBodyText || providerResponseText !== httpResponseBodyText)

  return (
    <Modal
      title="任务详情"
      open
      onCancel={onClose}
      footer={null}
      width={920}
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
            <Button
              size="middle"
              icon={<Icons.Activity size={14} />}
              onClick={() => onSelectNode(taskNode.id)}
            >
              定位任务节点
            </Button>
          )}
          <Button size="middle" disabled={!canCancel} onClick={() => onCancelTask(task.id)}>
            中断取消
          </Button>
          <Button size="middle" onClick={() => onRetryTask(task)}>
            {task.status === 'failed' || task.status === 'cancelled' ? '重试' : '再次运行'}
          </Button>
        </Space>

        <Descriptions
          size="middle"
          column={2}
          className="canvas-task-detail-desc"
          items={[
            { label: 'Task ID', children: task.id },
            { label: 'Request', children: task.requestId ?? '-' },
            { label: 'Provider', children: task.provider ?? '-' },
            { label: 'Provider Profile', children: task.providerProfileId ?? '-' },
            { label: 'Manifest', children: task.manifestId ?? '-' },
            { label: 'Model', children: task.modelId ?? '-' },
            { label: 'Agent', children: task.agentId ?? task.agentMode ?? '-' },
            { label: '创建时间', children: formatTime(task.createdAt) },
            { label: '更新时间', children: formatTime(task.updatedAt) },
            { label: '完成时间', children: task.completedAt ? formatTime(task.completedAt) : '-' },
          ]}
        />

        {outputText && (
          <DetailBlock title="模型输出">
            <pre>{outputText}</pre>
          </DetailBlock>
        )}

        {task.inputSnapshots && task.inputSnapshots.length > 0 && (
          <DetailBlock title="提交快照输入">
            <CanvasTaskInputSnapshotList snapshots={task.inputSnapshots} />
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

        <DetailBlock title="任务配置参数">
          <pre>{formatJson(detailParams)}</pre>
        </DetailBlock>

        {parsedEntities != null && (
          <DetailBlock title="结构化解析结果">
            <pre>{formatJson(parsedEntities)}</pre>
          </DetailBlock>
        )}

        {task.requestCall && (
          <DetailBlock title="实际 HTTP 请求">
            <div className="canvas-task-request-call">
              <div className="canvas-task-request-line">
                <Tag size="middle" color="blue">
                  {task.requestCall.method}
                </Tag>
                <code>{task.requestCall.url}</code>
              </div>
              {task.requestCall.headers != null && <pre>{formatJson(task.requestCall.headers)}</pre>}
              {task.requestCall.body != null && <pre>{formatJson(task.requestCall.body)}</pre>}
            </div>
          </DetailBlock>
        )}

        {httpResponse && (
          <DetailBlock title="实际 HTTP 响应">
            <div className="canvas-task-request-call">
              <div className="canvas-task-request-line">
                <Tag size="middle" color={httpResponse.status >= 400 ? 'red' : 'green'}>
                  {httpResponse.status}
                </Tag>
                <code>{httpResponse.statusText || 'response'}</code>
              </div>
              {httpResponse.headers != null && <pre>{formatJson(httpResponse.headers)}</pre>}
              {httpResponse.body != null && <pre>{formatJson(httpResponse.body)}</pre>}
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
            {(task.agentId || task.providerProfileId || task.modelId) && (
              <TaskLogItem
                time={task.updatedAt}
                label={`运行配置：${[
                  task.agentId ? `Agent ${task.agentId}` : '',
                  task.providerProfileId ? `Profile ${task.providerProfileId}` : '',
                  task.provider ? `Provider ${task.provider}` : '',
                  task.modelId ? `Model ${task.modelId}` : '',
                ]
                  .filter(Boolean)
                  .join(' / ')}`}
              />
            )}
            {displayPrompt && (
              <TaskLogItem time={task.updatedAt} label={`Prompt ${displayPrompt.length} 字符`} />
            )}
            {outputText && (
              <TaskLogItem time={task.updatedAt} label={`模型输出 ${outputText.length} 字符`} />
            )}
            {task.requestId && (
              <TaskLogItem time={task.updatedAt} label={`Provider request: ${task.requestId}`} />
            )}
            <TaskLogItem time={task.updatedAt} label={`状态更新为 ${task.status}`} />
            {task.completedAt && <TaskLogItem time={task.completedAt} label="任务结束" />}
          </div>
        </DetailBlock>

        {shouldShowProviderResponse && (
          <DetailBlock title="最终 Provider 响应">
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
