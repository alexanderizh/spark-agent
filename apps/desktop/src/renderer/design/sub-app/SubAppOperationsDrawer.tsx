import React from 'react'
import { Button, Empty } from '@lobehub/ui'
import { Drawer, Spin, message as antdMessage } from 'antd'
import type {
  SubAppConnectionBinding,
  SubAppDiagnosticResult,
  SubAppJob,
  SubAppProjectStatus,
  SubAppServiceLogEntry,
  SubAppServiceStatus,
  SubAppSummary,
} from '@spark/protocol'
import { subAppClient } from './subAppClient'

interface OperationsState {
  project: SubAppProjectStatus
  connections: SubAppConnectionBinding[]
  service: SubAppServiceStatus
  jobs: SubAppJob[]
  logs: SubAppServiceLogEntry[]
  diagnosis: SubAppDiagnosticResult
}

export function SubAppOperationsDrawer({
  app,
  onClose,
}: {
  app: SubAppSummary | null
  onClose: () => void
}): React.ReactElement {
  const [state, setState] = React.useState<OperationsState | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [restarting, setRestarting] = React.useState(false)

  const load = React.useCallback(async (): Promise<void> => {
    if (app == null) return
    setLoading(true)
    setError(null)
    try {
      const [project, connections, service, jobs, logs, diagnosis] = await Promise.all([
        subAppClient.projectStatus({ appId: app.id }),
        subAppClient.connectionList({ appId: app.id }),
        subAppClient.serviceStatus({ appId: app.id }),
        subAppClient.jobList({ appId: app.id, limit: 20 }),
        subAppClient.serviceLogs({ appId: app.id, limit: 80 }),
        subAppClient.diagnose({ appId: app.id, mode: 'published', includeService: true }),
      ])
      setState({
        project,
        connections: connections.items,
        service,
        jobs: jobs.items,
        logs: logs.items,
        diagnosis,
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }, [app])

  React.useEffect(() => {
    if (app == null) return
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [app, load])

  const visibleState = state?.project.appId === app?.id ? state : null

  const restart = async (): Promise<void> => {
    if (app == null) return
    setRestarting(true)
    try {
      await subAppClient.serviceRestart({ appId: app.id })
      antdMessage.success('后台服务已重启')
      await load()
    } catch (reason) {
      antdMessage.error(`重启失败：${reason instanceof Error ? reason.message : String(reason)}`)
    } finally {
      setRestarting(false)
    }
  }

  return (
    <Drawer
      title={app == null ? '应用运维' : `${app.name} · 开发与运维`}
      placement="right"
      width={520}
      open={app != null}
      onClose={onClose}
      extra={
        <Button size="small" type="text" loading={loading} onClick={() => void load()}>
          刷新
        </Button>
      }
    >
      {loading && visibleState == null ? (
        <div className="sao-loading">
          <Spin />
        </div>
      ) : null}
      {error != null ? (
        <div className="sao-error" role="alert">
          加载失败：{error}
        </div>
      ) : null}
      {visibleState != null ? (
        <div className="sao-sections">
          <section className="sao-section">
            <header>
              <h3>项目</h3>
              <span>{app?.format === 'v2' ? 'V2 受管项目' : 'V1 单 HTML'}</span>
            </header>
            <dl>
              <div>
                <dt>草稿 revision</dt>
                <dd>{visibleState.project.revision}</dd>
              </div>
              <div>
                <dt>文件</dt>
                <dd>{visibleState.project.validation.fileCount}</dd>
              </div>
              <div>
                <dt>总大小</dt>
                <dd>{formatBytes(visibleState.project.validation.byteLength)}</dd>
              </div>
              <div>
                <dt>可发布</dt>
                <dd>{visibleState.project.validation.readyToPublish ? '是' : '否'}</dd>
              </div>
            </dl>
            {visibleState.project.validation.diagnostics.length > 0 ? (
              <ul className="sao-diagnostics">
                {visibleState.project.validation.diagnostics.slice(0, 8).map((item, index) => (
                  <li key={`${item.code}-${index}`} data-level={item.level}>
                    <code>{item.code}</code>
                    <span>{item.message}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="sao-muted">未发现静态校验问题。</p>
            )}
          </section>

          <section className="sao-section">
            <header>
              <h3>连接</h3>
              <span>{visibleState.connections.length}</span>
            </header>
            {visibleState.connections.length === 0 ? (
              <p className="sao-muted">尚未绑定 API Connection 或 Provider。</p>
            ) : (
              <ul className="sao-lines">
                {visibleState.connections.map((item) => (
                  <li key={item.slot}>
                    <strong>{item.slot}</strong>
                    <span>
                      {item.bindingKind} · {item.grantedOrigins.join(', ') || '按 manifest'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="sao-section">
            <header>
              <h3>后台服务</h3>
              <div className="sao-header-actions">
                <span data-status={visibleState.service.status}>
                  {serviceLabel(visibleState.service.status)}
                </span>
                <Button
                  size="small"
                  type="text"
                  loading={restarting}
                  disabled={visibleState.project.manifest?.service == null}
                  onClick={() => void restart()}
                >
                  重启
                </Button>
              </div>
            </header>
            <dl>
              <div>
                <dt>Release</dt>
                <dd>{visibleState.service.releaseId?.slice(0, 8) ?? '-'}</dd>
              </div>
              <div>
                <dt>重启次数</dt>
                <dd>{visibleState.service.restartCount}</dd>
              </div>
              <div>
                <dt>启动时间</dt>
                <dd>{formatDate(visibleState.service.startedAt)}</dd>
              </div>
            </dl>
            {visibleState.service.lastError != null ? (
              <p className="sao-error">最近错误：{visibleState.service.lastError}</p>
            ) : null}
            {visibleState.logs.length > 0 ? (
              <pre className="sao-logs">
                {visibleState.logs
                  .map((item) => `[${item.at}] ${item.level} ${item.message}`)
                  .join('\n')}
              </pre>
            ) : (
              <p className="sao-muted">暂无后台日志。</p>
            )}
          </section>

          <section className="sao-section">
            <header>
              <h3>持久任务</h3>
              <span>{visibleState.jobs.length}</span>
            </header>
            {visibleState.jobs.length === 0 ? (
              <Empty description="暂无任务" />
            ) : (
              <ul className="sao-lines">
                {visibleState.jobs.map((job) => (
                  <li key={job.id}>
                    <strong>{job.type}</strong>
                    <span>
                      {job.status} · {Math.round(job.progress * 100)}% · {formatDate(job.updatedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="sao-section">
            <header>
              <h3>联合诊断</h3>
              <span data-status={visibleState.diagnosis.ready ? 'running' : 'crashed'}>
                {visibleState.diagnosis.ready ? '就绪' : '需处理'}
              </span>
            </header>
            <p className="sao-muted">Correlation ID: {visibleState.diagnosis.correlationId}</p>
            {visibleState.diagnosis.diagnostics.map((item, index) => (
              <p
                className={item.level === 'error' ? 'sao-error' : 'sao-muted'}
                key={`${item.code}-${index}`}
              >
                {item.code}: {item.message}
              </p>
            ))}
          </section>
        </div>
      ) : null}
    </Drawer>
  )
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}
function formatDate(value: string | null): string {
  return value == null ? '-' : new Date(value).toLocaleString()
}
function serviceLabel(status: SubAppServiceStatus['status']): string {
  return {
    stopped: '已停止',
    starting: '启动中',
    running: '运行中',
    degraded: '已降级',
    crashed: '已崩溃',
  }[status]
}
