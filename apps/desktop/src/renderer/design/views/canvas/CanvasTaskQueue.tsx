import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, Tag } from '@lobehub/ui'
import { Descriptions, Empty, Modal, Progress, Space } from 'antd'
import { Icons } from '../../Icons'
import { translate, useI18n } from '../../i18n'
import { operationLabel } from './canvas.api'
import { buildCanvasTaskDetailParams } from './canvasTaskInputDiagnostics'
import { stripDuplicateCanvasRuntimeDiagnostics } from './canvasTaskDetailPresentation'
import { isCanvasTaskActive } from './canvasTaskActivity'
import type { CanvasAsset, CanvasNode, CanvasTask, CanvasTaskStatus } from './canvas.types'
import { CanvasTaskInputSnapshotList } from './CanvasTaskInputSnapshotList'

type TaskFilter = 'all' | 'active' | 'failed' | 'completed'
type ClearTaskScope = 'active' | 'failed'
export type CanvasTaskRetryRuntimeSource = 'current-node' | 'original-task'

export function CanvasTaskQueue({
  boardId,
  tasks,
  nodes,
  assets,
  onCancelTask,
  onClearTasks,
  onDeleteTasks,
  onRetryTask,
  onRepollTask,
  onSelectNode,
}: {
  boardId: string
  tasks: CanvasTask[]
  nodes: CanvasNode[]
  assets: CanvasAsset[]
  onCancelTask: (taskId: string) => void
  onClearTasks: (scope: ClearTaskScope) => void | Promise<void>
  onDeleteTasks: (taskIds: string[]) => void | Promise<void>
  onRetryTask: (task: CanvasTask, runtimeSource: CanvasTaskRetryRuntimeSource) => void
  onRepollTask?: ((taskId: string) => void | Promise<void>) | undefined
  onSelectNode: (nodeId: string) => void
}) {
  // 本文件使用非响应式 translate()：顶层订阅语言变化，保证切换语言后整树重渲染。
  useI18n()
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
    if (filter === 'active') return isCanvasTaskActive(task)
    if (filter === 'failed') return task.status === 'failed' || task.status === 'cancelled'
    if (filter === 'completed') return task.status === 'completed'
    return true
  })
  const activeCount = tasks.filter(isCanvasTaskActive).length
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
  const visibleNodeIds = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes])
  const isOrphanTask = (task: CanvasTask) => {
    if (!isCanvasTaskActive(task)) return false
    // nodes 与正常任务列表都属于当前画板。显式校验 boardId 后，即使空画板没有
    // 任何节点，也能安全识别残留任务；意外传入的其他画板任务仍不会被误删。
    if (task.boardId !== boardId) return false
    // taskId 只代表节点最近一次运行；历史任务仍通过 operationNodeId 归属于同一操作节点。
    if (task.operationNodeId && visibleNodeIds.has(task.operationNodeId)) return false
    return !hostedTaskIds.has(task.id)
  }
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
          ? translate('canvasTaskQueue.t1Desc')
          : translate('canvasTaskQueue.tpl1Desc', { count }),
      content:
        translate('canvasTaskQueue.t2LongDesc'),
      okText: translate('canvasTaskQueue.t3'),
      okButtonProps: { danger: true },
      cancelText: translate('canvasTaskQueue.t4'),
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
        ? translate('canvasTaskQueue.tpl2Desc', { count })
        : translate('canvasTaskQueue.tpl3Desc', { count }),
      content: isClearActive
        ? translate('canvasTaskQueue.t5Desc')
        : translate('canvasTaskQueue.t6LongDesc'),
      okText: isClearActive ? translate('canvasTaskQueue.t7') : translate('canvasTaskQueue.t8'),
      okButtonProps: { danger: true },
      cancelText: translate('canvasTaskQueue.t4'),
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
        <h3>{translate('canvasTaskQueue.t26')}</h3>
        <Space size={6}>
          <Tag color={activeCount > 0 ? 'blue' : 'default'}>
            {translate('canvasTaskQueue.tpl4', { count: activeCount })}
          </Tag>
          <Button
            size="middle"
            type="text"
            icon={<Icons.Maximize size={14} />}
            onClick={() => setQueueModalOpen(true)}
          >
            {translate('canvasTaskQueue.t47')}
          </Button>
          {activeCount > 0 && (
            <Button
              size="middle"
              type="text"
              danger
              title={translate('canvasTaskQueue.t7')}
              loading={clearing === 'active'}
              icon={<Icons.Square size={14} />}
              onClick={() => runClearTasks('active', activeCount)}
            >
              {translate('canvasTaskQueue.t48')}
            </Button>
          )}
          {orphanCount > 0 && (
            <Button
              size="middle"
              type="text"
              danger
              title={translate('canvasTaskQueue.t22')}
              loading={clearing === 'orphan'}
              icon={<Icons.Trash size={14} />}
              onClick={() => runDeleteOrphans(orphanTasks.map((task) => task.id))}
            >
              {translate('canvasTaskQueue.tpl5Btn', { count: orphanCount })}
            </Button>
          )}
        </Space>
      </div>

      <div className="canvas-task-stat-grid">
        <TaskStat
          label={translate('canvasTaskQueue.t23')}
          value={tasks.length}
          active={filter === 'all'}
          onClick={() => setFilter('all')}
        />
        <TaskStat
          label={translate('canvasTaskQueue.t24')}
          value={activeCount}
          active={filter === 'active'}
          onClick={() => setFilter('active')}
        />
        <TaskStat
          label={translate('canvasTaskQueue.t18')}
          value={failedCount}
          active={filter === 'failed'}
          onClick={() => setFilter('failed')}
        />
        <TaskStat
          label={translate('canvasTaskQueue.t17')}
          value={completedCount}
          active={filter === 'completed'}
          onClick={() => setFilter('completed')}
        />
      </div>

      <div className="canvas-task-queue-list">
        {visibleTasks.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={translate('canvasTaskQueue.t25')} />
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
        title={translate('canvasTaskQueue.t26')}
        open={queueModalOpen}
        onCancel={() => setQueueModalOpen(false)}
        footer={null}
        width="min(1080px, 92vw)"
        className="canvas-task-queue-modal"
      >
        <div className="canvas-task-queue-modal-body">
          <div className="canvas-task-stat-grid">
            <TaskStat
              label={translate('canvasTaskQueue.t23')}
              value={tasks.length}
              active={filter === 'all'}
              onClick={() => setFilter('all')}
            />
            <TaskStat
              label={translate('canvasTaskQueue.t24')}
              value={activeCount}
              active={filter === 'active'}
              onClick={() => setFilter('active')}
            />
            <TaskStat
              label={translate('canvasTaskQueue.t18')}
              value={failedCount}
              active={filter === 'failed'}
              onClick={() => setFilter('failed')}
            />
            <TaskStat
              label={translate('canvasTaskQueue.t17')}
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
              {translate('canvasTaskQueue.tpl6Btn', {
                suffix: activeCount > 0 ? `(${activeCount})` : '',
              })}
            </Button>
            <Button
              size="middle"
              disabled={failedCount === 0}
              loading={clearing === 'failed'}
              icon={<Icons.Trash size={14} />}
              onClick={() => runClearTasks('failed', failedCount)}
            >
              {translate('canvasTaskQueue.tpl7Btn', {
                suffix: failedCount > 0 ? `(${failedCount})` : '',
              })}
            </Button>
            {orphanCount > 0 && (
              <Button
                size="middle"
                danger
                loading={clearing === 'orphan'}
                icon={<Icons.Trash size={14} />}
                onClick={() => runDeleteOrphans(orphanTasks.map((task) => task.id))}
              >
                {translate('canvasTaskQueue.tpl8', { count: orphanCount })}
              </Button>
            )}
          </div>
          <div className="canvas-task-queue-list canvas-task-queue-list-modal">
            {visibleTasks.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={translate('canvasTaskQueue.t25')} />
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
        onRepollTask={onRepollTask}
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
  const active = isCanvasTaskActive(task)
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
                title={translate('canvasTaskQueue.t27')}
                onClick={(event) => {
                  event.stopPropagation()
                  onClearOrphan()
                }}
              >
                {translate('canvasTaskQueue.t3')}
              </button>
            ) : (
              <button
                type="button"
                className="canvas-task-card-cancel"
                title={translate('canvasTaskQueue.t28')}
                onClick={(event) => {
                  event.stopPropagation()
                  onCancelTask(task.id)
                }}
              >
                {translate('canvasTaskQueue.t48')}
              </button>
            ))}
          <TaskStatusTag status={task.status} />
        </div>
      </div>
      <div className="canvas-task-card-meta">
        <span>{operationLabel(task.operation)}</span>
        {orphan && <span className="canvas-task-card-orphan-tag">{translate('canvasTaskQueue.t49')}</span>}
        {task.provider ? <span>{task.provider}</span> : null}
        {task.modelId ? <span>{task.modelId}</span> : null}
      </div>
      <Progress percent={task.progress} size="middle" status={progressStatus(task.status)} />
      {orphan ? (
        <div className="canvas-task-card-error">
          {translate('canvasTaskQueue.t50Desc')}
        </div>
      ) : task.errorMsg || task.errorDetail ? (
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
  onRepollTask,
  onSelectNode,
}: {
  task: CanvasTask | null
  nodes: CanvasNode[]
  assets: CanvasAsset[]
  onClose: () => void
  onCancelTask: (taskId: string) => void
  onRetryTask: (task: CanvasTask, runtimeSource: CanvasTaskRetryRuntimeSource) => void
  onRepollTask?: ((taskId: string) => void | Promise<void>) | undefined
  onSelectNode: (nodeId: string) => void
}) {
  const [repolling, setRepolling] = useState(false)

  if (!task) return null

  const handleRepoll = async () => {
    if (!onRepollTask || repolling) return
    setRepolling(true)
    try {
      await onRepollTask(task.id)
    } finally {
      setRepolling(false)
    }
  }

  const inputNodes = nodes.filter((node) => task.inputNodeIds.includes(node.id))
  const outputNodes = nodes.filter((node) => task.outputNodeIds.includes(node.id))
  // Keep assets visible even when a node also represents them. Diagnostic views favor
  // complete lineage over UI deduplication.
  const inputAssets = assets.filter((asset) => task.inputAssetIds.includes(asset.id))
  const outputAssets = assets.filter((asset) => task.outputAssetIds.includes(asset.id))
  const taskNode =
    (task.operationNodeId ? nodes.find((node) => node.id === task.operationNodeId) : undefined) ??
    nodes.find((node) => node.taskId === task.id)
  const canCancel = isCanvasTaskActive(task)
  const raw = isRecord(task.rawResponse) ? task.rawResponse : null
  const outputText = task.modelOutputText || stringField(raw?.outputText) || stringField(raw?.text)
  const parsedEntities = raw?.parsedEntities
  const displayPrompt = task.compiledUserText || task.prompt || ''
  const detailParams = {
    ...buildCanvasTaskDetailParams(task),
    ...(task.shotScriptConfig == null && taskNode?.data.shotScriptConfig
      ? { shotScriptConfig: taskNode.data.shotScriptConfig }
      : {}),
  }
  const httpResponse = task.requestCall?.response
  const submitResponse = task.submitResponse ?? httpResponse?.body
  const requestCaptureStatus = isRecord(task.requestCall?.body)
    ? stringField(task.requestCall.body.captureStatus)
    : undefined
  const runtimeDiagnostics = stripDuplicateCanvasRuntimeDiagnostics(task.rawResponse)
  const providerResponseText = runtimeDiagnostics != null ? formatJson(runtimeDiagnostics) : ''
  const httpResponseBodyText = httpResponse?.body != null ? formatJson(httpResponse.body) : ''
  const shouldShowProviderResponse =
    runtimeDiagnostics != null &&
    (!isRecord(runtimeDiagnostics) || Object.keys(runtimeDiagnostics).length > 0) &&
    (!httpResponseBodyText || providerResponseText !== httpResponseBodyText)

  return (
    <Modal
      title={translate('canvasTaskQueue.t29')}
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
              {translate('canvasTaskQueue.t51')}
            </Button>
          )}
          <Button size="middle" disabled={!canCancel} onClick={() => onCancelTask(task.id)}>
            {translate('canvasTaskQueue.t52')}
          </Button>
          {canRepollTask(task) && onRepollTask && (
            <Button
              size="middle"
              loading={repolling}
              disabled={repolling}
              onClick={() => void handleRepoll()}
            >
              {translate('canvasTaskQueue.t53')}
            </Button>
          )}
          {taskNode && (
            <Button size="middle" onClick={() => onRetryTask(task, 'current-node')}>
              {translate('canvasTaskQueue.t54')}
            </Button>
          )}
          <Button size="middle" type="text" onClick={() => onRetryTask(task, 'original-task')}>
            {translate('canvasTaskQueue.t55')}
          </Button>
        </Space>

        <Descriptions
          size="middle"
          column={2}
          className="canvas-task-detail-desc"
          items={[
            { label: 'Task ID', children: task.id },
            { label: 'Provider Task ID', children: task.providerTaskId ?? task.requestId ?? '-' },
            { label: 'Runtime Task ID', children: task.runtimeTaskId ?? '-' },
            { label: 'Provider', children: task.provider ?? '-' },
            { label: 'Provider Profile', children: task.providerProfileId ?? '-' },
            { label: 'Manifest', children: task.manifestId ?? '-' },
            { label: 'Model', children: task.modelId ?? '-' },
            { label: 'Agent', children: task.agentId ?? task.agentMode ?? '-' },
            { label: translate('canvasTaskQueue.t9'), children: formatTime(task.createdAt) },
            { label: translate('canvasTaskQueue.t10'), children: formatTime(task.updatedAt) },
            { label: translate('canvasTaskQueue.t11'), children: task.completedAt ? formatTime(task.completedAt) : '-' },
          ]}
        />

        <DetailBlock title={translate('canvasTaskQueue.t30Desc')} defaultOpen>
          <pre>{outputText || translate('canvasTaskQueue.t12Desc')}</pre>
        </DetailBlock>

        {task.requestCall ? (
          <DetailBlock title={translate('canvasTaskQueue.t31Desc')} defaultOpen>
            <div className="canvas-task-request-call">
              {requestCaptureStatus === 'session-dispatch' && (
                <div className="canvas-task-detail-note">
                  {translate('canvasTaskQueue.t60LongDesc')}
                </div>
              )}
              <div className="canvas-task-detail-subtitle">{translate('canvasTaskQueue.t56')}</div>
              <div className="canvas-task-request-line">
                <Tag size="middle" color="blue">
                  {task.requestCall.method}
                </Tag>
                <code>{task.requestCall.url}</code>
              </div>
              {task.requestCall.headers != null && (
                <>
                  <div className="canvas-task-detail-subtitle">{translate('canvasTaskQueue.t57')}</div>
                  <pre>{formatJson(task.requestCall.headers)}</pre>
                </>
              )}
              {task.requestCall.body != null && (
                <>
                  <div className="canvas-task-detail-subtitle">
                    {isHttpMethod(task.requestCall.method)
                      ? translate('canvasTaskQueue.t13Desc')
                      : translate('canvasTaskQueue.t14Desc')}
                  </div>
                  <pre>{formatJson(task.requestCall.body)}</pre>
                </>
              )}
              {(httpResponse || task.submitResponse != null) && (
                <>
                  <div className="canvas-task-detail-subtitle">{translate('canvasTaskQueue.t58')}</div>
                  {httpResponse && (
                    <div className="canvas-task-request-line">
                      <Tag size="middle" color={httpResponse.status >= 400 ? 'red' : 'green'}>
                        {httpResponse.status}
                      </Tag>
                      <code>{httpResponse.statusText || 'response'}</code>
                    </div>
                  )}
                  {httpResponse?.headers != null && <pre>{formatJson(httpResponse.headers)}</pre>}
                  {submitResponse != null && <pre>{formatJson(submitResponse)}</pre>}
                </>
              )}
            </div>
          </DetailBlock>
        ) : (
          task.status !== 'pending' && (
            <DetailBlock title={translate('canvasTaskQueue.t32Desc')} defaultOpen>
              <div className="canvas-task-detail-empty-call">
                {translate('canvasTaskQueue.t61LongDesc')}
              </div>
            </DetailBlock>
          )
        )}

        {(task.systemPrompt || displayPrompt) && (
          <DetailBlock title={translate('canvasTaskQueue.t33Desc')}>
            <div className="canvas-task-detail-note">
              {translate('canvasTaskQueue.t59LongDesc')}
            </div>
            {task.systemPrompt && (
              <>
                <div className="canvas-task-detail-subtitle">System Prompt</div>
                <pre>{task.systemPrompt}</pre>
              </>
            )}
            {displayPrompt && (
              <>
                <div className="canvas-task-detail-subtitle">User Prompt</div>
                <pre>{displayPrompt}</pre>
              </>
            )}
          </DetailBlock>
        )}

        {task.inputSnapshots && task.inputSnapshots.length > 0 && (
          <DetailBlock title={translate('canvasTaskQueue.t34Desc')}>
            <CanvasTaskInputSnapshotList snapshots={task.inputSnapshots} />
          </DetailBlock>
        )}

        <DetailBlock title={translate('canvasTaskQueue.t35')}>
          <div className="canvas-task-ref-grid">
            <TaskRefList title={translate('canvasTaskQueue.t36')} nodes={inputNodes} onSelectNode={onSelectNode} />
            <TaskRefList title={translate('canvasTaskQueue.t37')} nodes={outputNodes} onSelectNode={onSelectNode} />
            <AssetRefList title={translate('canvasTaskQueue.t38')} assets={inputAssets} />
            <AssetRefList title={translate('canvasTaskQueue.t39')} assets={outputAssets} />
          </div>
        </DetailBlock>

        <DetailBlock title={translate('canvasTaskQueue.t40Desc')}>
          <pre>{formatJson(detailParams)}</pre>
        </DetailBlock>

        {parsedEntities != null && (
          <DetailBlock title={translate('canvasTaskQueue.t41')}>
            <pre>{formatJson(parsedEntities)}</pre>
          </DetailBlock>
        )}

        {!task.requestCall && (httpResponse || task.submitResponse != null) && (
          <DetailBlock title={task.submitResponse != null ? translate('canvasTaskQueue.t15') : translate('canvasTaskQueue.t16')}>
            <div className="canvas-task-request-call">
              {httpResponse && (
                <div className="canvas-task-request-line">
                  <Tag size="middle" color={httpResponse.status >= 400 ? 'red' : 'green'}>
                    {httpResponse.status}
                  </Tag>
                  <code>{httpResponse.statusText || 'response'}</code>
                </div>
              )}
              {httpResponse?.headers != null && <pre>{formatJson(httpResponse.headers)}</pre>}
              {submitResponse != null && <pre>{formatJson(submitResponse)}</pre>}
            </div>
          </DetailBlock>
        )}

        {(task.errorMsg || task.errorDetail) && (
          <DetailBlock title={translate('canvasTaskQueue.t42')} defaultOpen>
            <div className="canvas-task-error-log">
              <strong>{task.errorMsg ?? 'error'}</strong>
              <pre>{task.errorDetail ?? '-'}</pre>
            </div>
          </DetailBlock>
        )}

        <DetailBlock title={translate('canvasTaskQueue.t43')}>
          <div className="canvas-task-log-list">
            {task.runtimeEvents && task.runtimeEvents.length > 0 ? (
              task.runtimeEvents.map((event, index) => (
                <TaskLogItem
                  key={`${event.at}-${event.kind}-${index}`}
                  time={event.at}
                  label={event.detail ? `${event.label}：${event.detail}` : event.label}
                />
              ))
            ) : (
              <>
                <TaskLogItem time={task.createdAt} label={translate('canvasTaskQueue.t44Desc')} />
                <TaskLogItem
                  time={task.updatedAt}
                  label={translate('canvasTaskQueue.tpl9', { status: task.status })}
                />
                {task.completedAt && <TaskLogItem time={task.completedAt} label={translate('canvasTaskQueue.t45')} />}
              </>
            )}
          </div>
        </DetailBlock>

        {shouldShowProviderResponse && (
          <DetailBlock title={translate('canvasTaskQueue.t46Desc')}>
            <pre>{formatJson(runtimeDiagnostics)}</pre>
          </DetailBlock>
        )}
      </div>
    </Modal>
  )
}

function DetailBlock({
  title,
  children,
  defaultOpen = false,
}: {
  title: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <details
      className="canvas-task-detail-block"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="canvas-task-detail-block-title">{title}</summary>
      <div className="canvas-task-detail-block-content">{children}</div>
    </details>
  )
}

function isHttpMethod(method: string): boolean {
  return /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/i.test(method.trim())
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

function canRepollTask(task: CanvasTask): boolean {
  return (
    task.status === 'failed' &&
    task.pollingAvailable === true &&
    Boolean(task.providerTaskId ?? task.requestId)
  )
}

function statusColor(status: CanvasTaskStatus): string {
  if (status === 'completed') return 'green'
  if (status === 'failed') return 'red'
  if (status === 'cancelled') return 'orange'
  if (status === 'running') return 'blue'
  return 'default'
}

function statusLabel(status: CanvasTaskStatus): string {
  if (status === 'completed') return translate('canvasTaskQueue.t17')
  if (status === 'failed') return translate('canvasTaskQueue.t18')
  if (status === 'cancelled') return translate('canvasTaskQueue.t19')
  if (status === 'running') return translate('canvasTaskQueue.t20')
  return translate('canvasTaskQueue.t21')
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
