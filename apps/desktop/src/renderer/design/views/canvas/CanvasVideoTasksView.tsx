import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ProviderProfile, VideoChannelTask, VideoChannelTaskStatus } from '@spark/protocol'
import {
  isVideoChannelTaskQueryableProvider,
  isVideoChannelTaskStatusSupported,
  resolveVideoChannelTaskProviderKind,
} from '@spark/protocol'
import { Button } from '@lobehub/ui'
import { Empty, Input, Modal, Select, Spin, Table, Tag, message } from 'antd'
import type { TableColumnsType } from 'antd'
import { Icons } from '../../Icons'
import { SidebarExpandButton } from '../../SidebarExpandButton'
import { useApp } from '../../AppContext'
import './CanvasVideoTasksView.less'

const PAGE_SIZE = 20

const STATUS_LABELS: Record<VideoChannelTaskStatus, string> = {
  submitted: '已提交',
  queued: '排队中',
  running: '生成中',
  succeeded: '已完成',
  failed: '失败',
  expired: '已过期',
  cancelled: '已取消',
  unknown: '未知',
}

const STATUS_COLORS: Record<VideoChannelTaskStatus, string> = {
  submitted: 'blue',
  queued: 'blue',
  running: 'processing',
  succeeded: 'success',
  failed: 'error',
  expired: 'warning',
  cancelled: 'default',
  unknown: 'default',
}

export function CanvasVideoTasksView() {
  const { t } = useApp()
  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [providerProfileId, setProviderProfileId] = useState('')
  const [tasks, setTasks] = useState<VideoChannelTask[]>([])
  const [pageNum, setPageNum] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [status, setStatus] = useState<VideoChannelTaskStatus | 'all'>('all')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [detailTask, setDetailTask] = useState<VideoChannelTask | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const taskRequestVersion = useRef(0)
  const detailRequestVersion = useRef(0)

  const selectedProvider = providers.find((provider) => provider.id === providerProfileId)
  const selectedProviderKind = resolveVideoChannelTaskProviderKind(
    selectedProvider?.mediaApiEndpoint ?? selectedProvider?.apiEndpoint,
  )
  const taskActionText = selectedProviderKind === 'bailian' ? '取消' : '删除'

  const loadProviders = useCallback(async () => {
    try {
      const response = await window.spark.invoke('provider:list', { includeDisabled: false })
      const taskProviders = response.profiles.filter((provider) => {
        const endpoint = provider.mediaApiEndpoint ?? provider.apiEndpoint
        const isVideoProvider =
          provider.modelType === 'video' ||
          provider.mediaCapabilities?.some((capability) => capability.startsWith('video.'))
        return (
          provider.enabled !== false &&
          Boolean(provider.keystoreRef) &&
          isVideoChannelTaskQueryableProvider(provider, endpoint) &&
          isVideoProvider
        )
      })
      setProviders(taskProviders)
      setProviderProfileId((current) =>
        taskProviders.some((provider) => provider.id === current) ? current : '',
      )
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取视频渠道配置失败')
    }
  }, [])

  const loadTasks = useCallback(async () => {
    const requestVersion = ++taskRequestVersion.current
    if (!providerProfileId) {
      setTasks([])
      setHasMore(false)
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const response = await window.spark.invoke('canvas:video-tasks:list', {
        providerProfileId,
        pageNum,
        pageSize: PAGE_SIZE,
        ...(status !== 'all' && status !== 'unknown' ? { status } : {}),
      })
      if (requestVersion !== taskRequestVersion.current) return
      setTasks(response.tasks)
      setHasMore(response.hasMore === true || response.tasks.length === PAGE_SIZE)
    } catch (loadError) {
      if (requestVersion !== taskRequestVersion.current) return
      setTasks([])
      setError(loadError instanceof Error ? loadError.message : '查询渠道视频任务失败')
    } finally {
      if (requestVersion === taskRequestVersion.current) setLoading(false)
    }
  }, [pageNum, providerProfileId, status])

  useEffect(() => {
    void loadProviders()
  }, [loadProviders])

  useEffect(() => {
    void loadTasks()
  }, [loadTasks])

  const visibleTasks = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return tasks
    return tasks.filter((task) =>
      [task.id, task.model, task.rawStatus, task.status]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalized)),
    )
  }, [query, tasks])

  const handleProviderChange = (nextId: string) => {
    detailRequestVersion.current += 1
    setProviderProfileId(nextId)
    setPageNum(1)
    setStatus('all')
    setQuery('')
  }

  const handleStatusChange = (nextStatus: VideoChannelTaskStatus | 'all') => {
    setStatus(nextStatus)
    setPageNum(1)
  }

  const handleRefresh = () => {
    if (!providerProfileId) {
      void loadProviders()
      return
    }
    void loadTasks()
  }

  const handleOpenDetail = async (task: VideoChannelTask) => {
    const requestVersion = ++detailRequestVersion.current
    const selectedProviderId = providerProfileId
    setDetailTask(task)
    setDetailLoading(true)
    try {
      const response = await window.spark.invoke('canvas:video-tasks:get', {
        providerProfileId: selectedProviderId,
        taskId: task.id,
      })
      if (requestVersion !== detailRequestVersion.current) return
      setDetailTask(response.task)
    } catch (detailError) {
      if (requestVersion !== detailRequestVersion.current) return
      message.warning(detailError instanceof Error ? detailError.message : '读取任务详情失败')
    } finally {
      if (requestVersion === detailRequestVersion.current) setDetailLoading(false)
    }
  }

  const handleCloseDetail = () => {
    detailRequestVersion.current += 1
    setDetailTask(null)
    setDetailLoading(false)
  }

  const handleDelete = (task: VideoChannelTask) => {
    Modal.confirm({
      title: `${taskActionText}渠道任务？`,
      content:
        taskActionText === '取消'
          ? '阿里云百炼仅支持取消排队中的任务，不会影响已下载到本地的画布素材。'
          : selectedProviderKind === 'minimax-hailuo'
            ? 'MiniMax 会取消排队中的任务，或删除已完成/失败的任务记录，不会影响已下载到本地的画布素材。'
            : '删除只会从火山方舟任务列表中移除该任务，不会影响已下载到本地的画布素材。',
      okText: taskActionText,
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        setDeletingId(task.id)
        try {
          const response = await window.spark.invoke('canvas:video-tasks:delete', {
            providerProfileId,
            taskId: task.id,
          })
          message.success(response.action === 'cancelled' ? '任务已取消' : '任务已删除')
          await loadTasks()
        } catch (deleteError) {
          message.error(deleteError instanceof Error ? deleteError.message : '删除任务失败')
        } finally {
          setDeletingId(null)
        }
      },
    })
  }

  const columns: TableColumnsType<VideoChannelTask> = [
    {
      title: '任务 ID',
      dataIndex: 'id',
      key: 'id',
      width: 260,
      render: (value: string) => (
        <span className="video-task-id" title={value}>
          {value}
        </span>
      ),
    },
    {
      title: '模型',
      dataIndex: 'model',
      key: 'model',
      width: 250,
      render: (value?: string) => value || '—',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (value: VideoChannelTaskStatus) => (
        <Tag color={STATUS_COLORS[value]}>{STATUS_LABELS[value]}</Tag>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: formatDateTime,
    },
    {
      title: '结果',
      key: 'result',
      width: 120,
      render: (_value, task) =>
        task.videoUrl ? (
          <button
            type="button"
            className="video-task-link"
            onClick={() => openExternal(task.videoUrl!)}
          >
            <Icons.ExternalLink size={13} /> 查看视频
          </button>
        ) : task.error?.message ? (
          <span className="video-task-error" title={task.error.message}>
            查看错误
          </span>
        ) : (
          '—'
        ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      fixed: 'right',
      render: (_value, task) => (
        <div className="video-task-actions">
          <Button size="small" type="text" onClick={() => void handleOpenDetail(task)}>
            详情
          </Button>
          <Button
            size="small"
            type="text"
            danger
            disabled={
              selectedProviderKind === 'bailian' &&
              task.status !== 'queued' &&
              task.status !== 'submitted'
            }
            loading={deletingId === task.id}
            onClick={() => handleDelete(task)}
          >
            {taskActionText}
          </Button>
        </div>
      ),
    },
  ]

  const statusOptions = useMemo(() => {
    const statuses: Exclude<VideoChannelTaskStatus, 'unknown'>[] = [
      'submitted',
      'queued',
      'running',
      'succeeded',
      'failed',
      'expired',
      'cancelled',
    ]
    return statuses
      .filter(
        (item) =>
          selectedProviderKind == null ||
          isVideoChannelTaskStatusSupported(selectedProviderKind, item),
      )
      .map((item) => ({ value: item, label: STATUS_LABELS[item] }))
  }, [selectedProviderKind])

  return (
    <div className="canvas-video-tasks-view">
      <header
        className="canvas-video-tasks-header canvas-view-titlebar"
        onDoubleClick={() => {
          window.spark?.invoke('window:maximize', {}).catch(() => {})
        }}
      >
        {t.sidebarHidden && <SidebarExpandButton />}
        <div className="canvas-video-tasks-heading">
          <span className="canvas-video-tasks-kicker">CHANNEL OPERATIONS</span>
          <h2>渠道视频任务</h2>
          <p>统一查看渠道侧异步任务，当前支持火山方舟、阿里云百炼和 MiniMax。</p>
        </div>
        <Button
          size="medium"
          type="text"
          icon={<Icons.Refresh size={15} />}
          onClick={handleRefresh}
        >
          刷新
        </Button>
      </header>

      <main className="canvas-video-tasks-main">
        <section className="canvas-video-tasks-toolbar" aria-label="任务筛选">
          <div className="video-task-filter-group">
            <label htmlFor="video-task-provider">Provider 配置</label>
            <Select
              id="video-task-provider"
              value={providerProfileId || null}
              placeholder="选择渠道配置"
              options={providers.map((provider) => ({
                value: provider.id,
                label: provider.name,
              }))}
              onChange={handleProviderChange}
              disabled={providers.length === 0}
            />
          </div>
          <div className="video-task-filter-group">
            <label htmlFor="video-task-status">状态</label>
            <Select
              id="video-task-status"
              value={status}
              options={[{ value: 'all', label: '全部状态' }, ...statusOptions]}
              onChange={handleStatusChange}
            />
          </div>
          <Input
            className="video-task-search"
            prefix={<Icons.Search size={15} />}
            placeholder="搜索任务 ID、模型或状态"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            allowClear
          />
        </section>

        <div className="canvas-video-tasks-summary">
          <div>
            <strong>{selectedProvider?.name ?? '官方视频渠道'}</strong>
            <span>
              {providerProfileId
                ? '使用当前 Provider 的本地安全存储 API Key'
                : '请选择已配置的 Provider 后开始查询'}
            </span>
          </div>
          <span>
            第 {pageNum} 页 · {visibleTasks.length} 条
          </span>
        </div>

        {error ? (
          <div className="canvas-video-tasks-error" role="alert">
            <Icons.AlertTriangle size={18} />
            <div>
              <strong>任务查询失败</strong>
              <p>{error}</p>
              <span>
                请在模型服务中确认当前 Provider 已配置 API Key，且 Endpoint 使用对应官方域名。
              </span>
            </div>
          </div>
        ) : loading ? (
          <div className="canvas-video-tasks-empty">
            <Spin description="正在读取渠道任务..." />
          </div>
        ) : providers.length === 0 ? (
          <div className="canvas-video-tasks-empty">
            <Empty description="没有找到符合条件的官方视频 Provider，请先配置官方 Endpoint 和 API Key" />
          </div>
        ) : !providerProfileId ? (
          <div className="canvas-video-tasks-empty">
            <Empty description="请选择 Provider 配置后开始查询" />
          </div>
        ) : visibleTasks.length === 0 ? (
          <div className="canvas-video-tasks-empty">
            <Empty description={query ? '没有匹配的任务' : '当前渠道暂无视频任务'} />
          </div>
        ) : (
          <Table<VideoChannelTask>
            rowKey="id"
            columns={columns}
            dataSource={visibleTasks}
            pagination={false}
            scroll={{ x: 1050 }}
            size="middle"
          />
        )}

        <div className="canvas-video-tasks-pagination">
          <Button
            size="small"
            type="text"
            disabled={pageNum <= 1 || loading}
            onClick={() => setPageNum((value) => value - 1)}
          >
            上一页
          </Button>
          <span>{pageNum}</span>
          <Button
            size="small"
            type="text"
            disabled={!hasMore || loading}
            onClick={() => setPageNum((value) => value + 1)}
          >
            下一页
          </Button>
        </div>
      </main>

      <Modal
        title="渠道任务详情"
        open={detailTask != null}
        onCancel={handleCloseDetail}
        footer={null}
        width={680}
      >
        {detailTask && (
          <div className="video-task-detail" aria-busy={detailLoading}>
            {detailLoading ? <Spin /> : null}
            <div className="video-task-detail-head">
              <div>
                <span className="video-task-detail-label">TASK ID</span>
                <strong>{detailTask.id}</strong>
              </div>
              <Tag color={STATUS_COLORS[detailTask.status]}>{STATUS_LABELS[detailTask.status]}</Tag>
            </div>
            <dl>
              <dt>模型</dt>
              <dd>{detailTask.model || '—'}</dd>
              <dt>分辨率 / 比例</dt>
              <dd>
                {[detailTask.resolution, detailTask.ratio].filter(Boolean).join(' / ') || '—'}
              </dd>
              <dt>时长 / 帧率</dt>
              <dd>
                {detailTask.durationSeconds ? `${detailTask.durationSeconds}s` : '—'} /{' '}
                {detailTask.framesPerSecond ? `${detailTask.framesPerSecond}fps` : '—'}
              </dd>
              <dt>创建时间</dt>
              <dd>{formatDateTime(detailTask.createdAt)}</dd>
              <dt>更新时间</dt>
              <dd>{formatDateTime(detailTask.updatedAt)}</dd>
              {detailTask.error?.message ? (
                <>
                  <dt>错误</dt>
                  <dd className="video-task-error">{detailTask.error.message}</dd>
                </>
              ) : null}
            </dl>
            {detailTask.videoUrl ? (
              <button
                type="button"
                className="video-task-detail-result"
                onClick={() => openExternal(detailTask.videoUrl!)}
              >
                <Icons.Video size={16} /> 打开生成视频
                <Icons.ExternalLink size={14} />
              </button>
            ) : null}
          </div>
        )}
      </Modal>
    </div>
  )
}

function formatDateTime(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function openExternal(url: string): void {
  void window.spark?.invoke('browser:open-external', { url })
}
