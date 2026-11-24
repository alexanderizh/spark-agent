/**
 * 远程会话检查器（远程版 Inspector，2026-11-25 对齐本地会话检查器）。
 *
 * 数据全部来自控制端已有的远程数据源，不新增目标端基础设施：
 *   - 会话信息：侧栏缓存（remoteSessionStore）+ 会话标题/项目/设备 props
 *   - 过程产物：产物 REST 聚合（file_change + presented_files，服务端合并）
 *   - 工具调用日志：事件流统计（useRemoteSessionTimelineSummary，tool_call/result）
 *   - Token 用量 / 上下文窗口：远程链路当前不上报（MobileBridgeEvent 无 usage 字段），
 *     如实渲染「目标端暂未上报」占位——与本地检查器的对应区块位置一致，等目标端
 *     桥接事件扩展后再接入真数据。
 */
import { useMemo } from 'react'
import { Icons } from '../../Icons'
import { formatRelativeTime, getRemoteSessionStore } from './remoteSessionStore'
import type { MobileBridgeProjectArtifactItem } from '@spark/protocol'
import type { RemoteSessionTimelineSummary } from './useRemoteSessionTimelineSummary'

const INSPECTOR_ARTIFACT_ROWS = 8
const INSPECTOR_TOOL_ROWS = 12

function InspectorSection({
  icon,
  title,
  count,
  children,
}: {
  icon: React.ReactNode
  title: string
  count?: string
  children: React.ReactNode
}) {
  return (
    <div className="rc-panel-section">
      <div className="rc-panel-section-head">
        <span className="rc-inspector-section-title">
          {icon}
          {title}
        </span>
        {count != null && <span className="rc-panel-section-count">{count}</span>}
      </div>
      {children}
    </div>
  )
}

function InfoRow({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="rc-inspector-info-row" title={title ?? value}>
      <span className="rc-inspector-info-label">{label}</span>
      <span className="rc-inspector-info-value">{value}</span>
    </div>
  )
}

export interface RemoteSessionInspectorProps {
  deviceId: string
  sessionId: string | null
  sessionTitle: string | null
  projectName: string
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

  const toolStats = summary.toolCalls.slice(0, INSPECTOR_TOOL_ROWS)
  const toolTotalCalls = summary.toolCalls.reduce((sum, stat) => sum + stat.total, 0)
  const artifactRows = artifacts.slice(0, INSPECTOR_ARTIFACT_ROWS)

  return (
    <div className="rc-inspector">
      <InspectorSection icon={<Icons.Chat size={12} />} title="会话信息">
        <InfoRow label="标题" value={sessionTitle ?? '未命名会话'} />
        <InfoRow label="项目" value={projectName} />
        <InfoRow label="设备" value={deviceLabel} />
        {sessionRow?.status != null && (
          <InfoRow
            label="状态"
            value={sessionRow.status === 'running' ? '运行中' : '空闲'}
          />
        )}
        {sessionRow?.updatedAt != null && (
          <InfoRow label="更新于" value={formatRelativeTime(sessionRow.updatedAt)} />
        )}
        <InfoRow label="消息数" value={String(summary.messageCount)} />
        {sessionId == null && (
          <div className="rc-panel-empty">尚未选择会话</div>
        )}
      </InspectorSection>

      <InspectorSection
        icon={<Icons.Package size={12} />}
        title="过程产物"
        count={String(artifacts.length)}
      >
        {artifactRows.length === 0 ? (
          <div className="rc-panel-empty">{summary.loading ? '正在读取…' : '暂无产物'}</div>
        ) : (
          <div className="rc-inspector-artifacts">
            {artifactRows.map((item) => (
              <button
                key={item.path}
                type="button"
                className="rc-inspector-artifact-row"
                title={`${item.path}${item.changeTypes != null ? `（${item.changeTypes.join(' / ')}）` : ''}`}
                onClick={() => onOpenPreview(item.path)}
              >
                <span className="rc-inspector-artifact-name">
                  {item.title ?? item.path.split(/[\\/]/).pop() ?? item.path}
                </span>
                <span className="rc-inspector-artifact-meta">
                  {item.sessionTitle} · {formatRelativeTime(item.presentedAt)}
                </span>
              </button>
            ))}
            {artifacts.length > artifactRows.length && (
              <div className="rc-panel-hint-note">其余 {artifacts.length - artifactRows.length} 项见「产物」页</div>
            )}
          </div>
        )}
      </InspectorSection>

      <InspectorSection
        icon={<Icons.Terminal size={12} />}
        title="工具调用"
        count={String(toolTotalCalls)}
      >
        {toolStats.length === 0 ? (
          <div className="rc-panel-empty">{summary.loading ? '正在读取…' : '暂无工具调用'}</div>
        ) : (
          <div className="rc-inspector-tools">
            {toolStats.map((stat) => (
              <div key={stat.toolName} className="rc-inspector-tool-row" title={stat.toolName}>
                <span className="rc-inspector-tool-name">{shortToolName(stat.toolName)}</span>
                <span className="rc-inspector-tool-nums">
                  {stat.running > 0 && <span className="is-running">{stat.running} 运行中</span>}
                  {stat.error > 0 && <span className="is-error">{stat.error} 失败</span>}
                  <span className="is-total">{stat.total} 次</span>
                </span>
              </div>
            ))}
            {summary.toolCalls.length > toolStats.length && (
              <div className="rc-panel-hint-note">
                其余 {summary.toolCalls.length - toolStats.length} 类工具未显示
              </div>
            )}
            {summary.error != null && <div className="rc-panel-hint-note">{summary.error}</div>}
          </div>
        )}
      </InspectorSection>

      <InspectorSection icon={<Icons.Zap size={12} />} title="Token 用量">
        <div className="rc-panel-empty">目标端暂未上报用量数据（远程链路待支持）</div>
      </InspectorSection>

      <InspectorSection icon={<Icons.Brain size={12} />} title="上下文窗口">
        <div className="rc-panel-empty">目标端暂未上报上下文数据（远程链路待支持）</div>
      </InspectorSection>
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
