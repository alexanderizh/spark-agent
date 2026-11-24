/**
 * 远程会话检查器（检查器 tab，2026-11-25 重写为本地 ChatInspector 同款样式）。
 *
 * 视觉结构完全复用本地检查器的类名（SessionPanelDesign.less /
 * ChatInspectorJourney.less 随包全局生效）：
 *   session-panel > inspector scroll > session-panel-heading + inspector-section
 *   + kv-row 信息行 + InspectorCollapsibleSection(chat-journey) 折叠区块
 *   + chat-journey__row 列表行（过程产物 / 工具调用）。
 *
 * 数据全部来自控制端已有的远程数据源，不新增目标端基础设施：
 *   - 会话信息：侧栏缓存（remoteSessionStore）+ 面板注入的项目路径/设备名
 *   - 过程产物：产物 REST 聚合（file_change + presented_files）+ 事件流即时并入
 *   - 工具调用：事件流统计（useRemoteSessionTimelineSummary）
 *   - Token 用量 / 上下文窗口：远程链路暂未上报，如实渲染占位（与本地对应
 *     区块位置一致，待目标端桥接事件扩展后接入）。
 */
import { useMemo } from 'react'
import { Icons } from '../../Icons'
import { translate } from '../../i18n'
import { formatRelativeTime, getRemoteSessionStore } from './remoteSessionStore'
import { InspectorCollapsibleSection } from '../../components/InspectorCollapsibleSection'
import type { MobileBridgeProjectArtifactItem } from '@spark/protocol'
import type { RemoteSessionTimelineSummary } from './useRemoteSessionTimelineSummary'

const INSPECTOR_ARTIFACT_ROWS = 12
const INSPECTOR_TOOL_ROWS = 16

const CHANGE_TYPE_LABEL: Record<string, string> = {
  create: '新增',
  modify: '修改',
  delete: '删除',
}

export interface RemoteSessionInspectorProps {
  deviceId: string
  sessionId: string | null
  sessionTitle: string | null
  projectName: string
  /** 项目根路径（有则显示，对齐本地检查器的「路径」行） */
  rootPath: string
  deviceLabel: string
  summary: RemoteSessionTimelineSummary
  artifacts: MobileBridgeProjectArtifactItem[]
  onOpenPreview: (filePath: string) => void
}

export function RemoteSessionInspector({
  deviceId,
  sessionId,
  sessionTitle,
  projectName,
  rootPath,
  deviceLabel,
  summary,
  artifacts,
  onOpenPreview,
}: RemoteSessionInspectorProps) {
  // 会话行信息（状态/更新时间）从侧栏缓存取：面板不重复请求
  const sessionRow = useMemo(() => {
    if (sessionId == null) return null
    const store = getRemoteSessionStore(deviceId)
    const bucket = store.sessions[projectIdOf(store, sessionId)]
    const fromBucket = bucket?.rows.find((row) => row.id === sessionId)
    if (fromBucket != null) return fromBucket
    return store.allSessions?.rows.find((row) => row.id === sessionId) ?? null
    // store 是可变单例：由宿主的 useSyncExternalStore 版本号驱动重渲染
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, sessionId, summary.lastActivityAt])

  const toolRows = summary.toolCalls.slice(0, INSPECTOR_TOOL_ROWS)
  const toolTotalCalls = summary.toolCalls.reduce((sum, stat) => sum + stat.total, 0)
  const artifactRows = artifacts.slice(0, INSPECTOR_ARTIFACT_ROWS)

  return (
    <div className="session-panel rc-session-panel-host">
      <div className="inspector scroll">
        <header className="session-panel-heading">
          <strong>{translate('chatInspector.t72')}</strong>
          <span>{translate('chatInspector.t73Desc')}</span>
        </header>

        <div className="inspector-section">
          <h4>{translate('chatInspector.t75')}</h4>
          {sessionId == null ? (
            <div className="inspector-muted">{translate('chatInspector.t81')}</div>
          ) : (
            <>
              <div className="kv-row">
                <span className="k">{translate('chatInspector.t76')}</span>
                <span className="v">{summary.messageCount}</span>
              </div>
              {rootPath.length > 0 && (
                <div className="kv-row">
                  <span className="k">{translate('chatInspector.t77')}</span>
                  <span className="v mono-sm truncate inspector-path" title={rootPath}>
                    {rootPath}
                  </span>
                </div>
              )}
              <div className="kv-row">
                <span className="k">项目</span>
                <span className="v truncate" title={projectName}>
                  {projectName}
                </span>
              </div>
              <div className="kv-row">
                <span className="k">设备</span>
                <span className="v truncate" title={deviceLabel}>
                  {deviceLabel}
                </span>
              </div>
              {sessionRow?.status != null && (
                <div className="kv-row">
                  <span className="k">状态</span>
                  <span className="v">
                    {sessionRow.status === 'running' ? '运行中' : sessionRow.status === 'error' ? '异常' : '空闲'}
                  </span>
                </div>
              )}
              {sessionRow?.updatedAt != null && (
                <div className="kv-row">
                  <span className="k">{translate('chatInspector.t80')}</span>
                  <span className="v">{formatRelativeTime(sessionRow.updatedAt)}</span>
                </div>
              )}
            </>
          )}
        </div>

        <InspectorCollapsibleSection
          className="chat-journey"
          title="过程产物"
          summary={<span className="inspector-count">{artifacts.length}</span>}
          defaultExpanded
        >
          <div className="chat-journey__list">
            {artifactRows.length === 0 && (
              <div className="inspector-muted">
                {summary.loading ? '正在读取…' : '暂无产物'}
              </div>
            )}
            {artifactRows.map((item) => {
              const name = item.title ?? item.path.split(/[\\/]/).pop() ?? item.path
              return (
                <button
                  key={item.path}
                  type="button"
                  className="chat-journey__row is-action"
                  title={`${item.path}（点击预览 · ${item.sessionTitle}）`}
                  onClick={() => onOpenPreview(item.path)}
                >
                  {item.presented === true ? (
                    <Icons.Star aria-hidden="true" size={14} className="chat-journey__row-icon s-presented" />
                  ) : (
                    <Icons.File aria-hidden="true" size={14} className="chat-journey__row-icon s-file" />
                  )}
                  <span className="chat-journey__row-name">{name}</span>
                  <span className="chat-journey__row-tags">
                    {item.presented === true && (
                      <span className="chat-journey__tag s-presented">呈现</span>
                    )}
                    {(item.changeTypes ?? []).map((type) => (
                      <span className="chat-journey__tag" key={type}>
                        {CHANGE_TYPE_LABEL[type] ?? type}
                      </span>
                    ))}
                  </span>
                </button>
              )
            })}
            {artifacts.length > artifactRows.length && (
              <div className="chat-journey__foot">
                其余 {artifacts.length - artifactRows.length} 项见「产物」页
              </div>
            )}
          </div>
        </InspectorCollapsibleSection>

        <InspectorCollapsibleSection
          className="chat-journey"
          title="工具调用"
          summary={<span className="inspector-count">{toolTotalCalls} 次</span>}
          defaultExpanded
        >
          <div className="chat-journey__list">
            {toolRows.length === 0 && (
              <div className="inspector-muted">
                {summary.loading ? '正在读取…' : '暂无工具调用'}
              </div>
            )}
            {toolRows.map((stat) => (
              <div
                key={stat.toolName}
                className="chat-journey__row"
                title={stat.toolName}
              >
                <Icons.Terminal aria-hidden="true" size={14} className="chat-journey__row-icon s-skill" />
                <span className="chat-journey__row-name">{shortToolName(stat.toolName)}</span>
                <span className="chat-journey__row-meta">
                  {stat.error > 0 && `${stat.error} 失败 · `}
                  {stat.total} 次
                </span>
              </div>
            ))}
            {summary.toolCalls.length > toolRows.length && (
              <div className="chat-journey__foot">
                其余 {summary.toolCalls.length - toolRows.length} 类工具未显示
              </div>
            )}
            {summary.error != null && (
              <div className="chat-journey__foot">{summary.error}</div>
            )}
          </div>
        </InspectorCollapsibleSection>

        <div className="inspector-section">
          <h4>{translate('chatInspector.t82')}</h4>
          <div className="inspector-muted">目标端暂未上报用量数据（远程链路待支持）</div>
        </div>

        <div className="inspector-section">
          <h4>上下文窗口</h4>
          <div className="inspector-muted">目标端暂未上报上下文数据（远程链路待支持）</div>
        </div>
      </div>
    </div>
  )
}

/** mcp__server__tool → server·tool；其余保留原名（长名由 title 悬浮兜底） */
function shortToolName(toolName: string): string {
  const parts = toolName.split('__')
  if (parts.length >= 3) {
    const server = parts[1] ?? ''
    const tool = parts.slice(2).join('·')
    return `${server}·${tool}`
  }
  return toolName
}

/** 会话行所在的项目桶 id（找不到时回落全量列表，这里只用于定位桶） */
function projectIdOf(store: ReturnType<typeof getRemoteSessionStore>, sessionId: string): string {
  for (const [projectId, bucket] of Object.entries(store.sessions)) {
    if (bucket.rows.some((row) => row.id === sessionId)) return projectId
  }
  return ''
}
