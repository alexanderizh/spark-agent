/**
 * ChatInspectorJourney — 会话检查器「会话经历」系列区块
 *
 * 一个会话过程中「用了什么 / 查了什么 / 产出了什么 / 输入了什么」的聚合视图
 * （`session:get-journey` IPC，主进程聚合审计账本与事件流，不受聊天窗口化影响）。
 * 四个分组各自是独立的顶级折叠区块（与「工具执行」「上下文窗口」同层级，
 * 不再套一层总区块），有数据的分组才出现：
 * - 过程产物：文件变更 + Agent 显式呈现的文件（主进程仅收集文档 / 多媒体，
 *   点击优先走统一预览路由 onFilePreview 打开预览，无回调时回落访达定位）；
 * - 技能与 MCP：加载过的技能、调用过的 MCP 服务器（含调用次数）；
 * - 网页查询：检索词与抓取过的网页（page 条目可点击用系统浏览器打开）；
 * - 输入来源：用户消息携带的图片 / 文件 / 目录附件（同上，预览优先、定位兜底）。
 *
 * 数据加载遵循 ChatInspectorToolLog 模板：useIpcInvoke + 延迟一拍加载，
 * 请求序号竞态守卫、loading 骨架 / error 重试 / 刷新完备；四个区块共享
 * 同一次请求的结果（一次 IPC 聚合返回，不重复拉取）。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type {
  SessionJourneyArtifact,
  SessionJourneyInputSource,
  SessionJourneyMcpServer,
  SessionJourneyResponse,
  SessionJourneySkill,
  SessionJourneyWebEntry,
} from '@spark/protocol'
import { Icons } from '../Icons'
import { useIpcInvoke } from '../hooks/useIpc'
import { InspectorCollapsibleSection } from './InspectorCollapsibleSection'
import { getPreviewFileType } from './FileDisplay'
import type { FileOpenHandler } from './fileOpenRouting'
import { useToast } from './Toast'
import './ChatInspectorJourney.less'

const CHANGE_TYPE_LABEL: Record<SessionJourneyArtifact['changeTypes'][number], string> = {
  create: '新增',
  modify: '修改',
  delete: '删除',
  rename: '重命名',
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function formatTime(iso: string | null): string {
  if (iso == null) return ''
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return ''
  const date = new Date(ms)
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return sameDay
    ? `${pad(date.getHours())}:${pad(date.getMinutes())}`
    : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 网页条目展示文本：page 显示 主机名+路径摘要，search 显示检索词。 */
function webDisplayText(entry: SessionJourneyWebEntry): string {
  if (entry.kind === 'search') return entry.text
  if (entry.host != null && entry.host !== '') {
    let pathname = ''
    try {
      pathname = new URL(entry.text).pathname
    } catch {
      // URL 解析失败时仅展示主机名
    }
    if (pathname !== '' && pathname !== '/') {
      const trimmed = pathname.length > 28 ? `${pathname.slice(0, 27)}…` : pathname
      return `${entry.host}${trimmed}`
    }
    return entry.host
  }
  return entry.text.length > 40 ? `${entry.text.slice(0, 39)}…` : entry.text
}

export interface ChatInspectorJourneyProps {
  sessionId: string
  /** 统一文件打开路由回调（ChatView 传入）：可预览文件优先打开预览，未传时回落访达定位。 */
  onFilePreview?: FileOpenHandler | undefined
  /** 在技能与 MCP 区块之后渲染的同级模块。 */
  afterSkillsMcp?: ReactNode | undefined
}

export function ChatInspectorJourney({
  sessionId,
  onFilePreview,
  afterSkillsMcp,
}: ChatInspectorJourneyProps) {
  const { toast } = useToast()
  const { invoke: invokeJourney } = useIpcInvoke('session:get-journey')
  const { invoke: openExternal } = useIpcInvoke('browser:open-external')
  const { invoke: revealFile } = useIpcInvoke('file:reveal')

  const [data, setData] = useState<SessionJourneyResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const aliveRef = useRef(true)
  /** 首屏请求序号：会话切换时旧响应落地前被新请求作废。 */
  const loadSeqRef = useRef(0)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const load = useCallback(async () => {
    const requestId = ++loadSeqRef.current
    setLoading(true)
    setError(null)
    try {
      const res = await invokeJourney({ sessionId })
      if (!aliveRef.current || requestId !== loadSeqRef.current) return
      setData(res)
    } catch (err) {
      if (!aliveRef.current || requestId !== loadSeqRef.current) return
      setData(null)
      setError(errorMessage(err))
    } finally {
      if (aliveRef.current && requestId === loadSeqRef.current) setLoading(false)
    }
  }, [invokeJourney, sessionId])

  useEffect(() => {
    const id = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(id)
  }, [load])

  const handleOpenWeb = useCallback(
    (entry: SessionJourneyWebEntry) => {
      if (entry.kind !== 'page') return
      void openExternal({ url: entry.text }).catch((err: unknown) => {
        toast.error(`打开网页失败：${errorMessage(err)}`)
      })
    },
    [openExternal, toast],
  )

  const handleReveal = useCallback(
    (filePath: string) => {
      void revealFile({ filePath }).catch((err: unknown) => {
        toast.error(`定位文件失败：${errorMessage(err)}`)
      })
    },
    [revealFile, toast],
  )

  /** 产物 / 附件点击：可预览类型走统一预览路由，其余（或未传回调）回落访达定位。 */
  const handleOpenFile = useCallback(
    (filePath: string) => {
      if (onFilePreview != null) {
        const fileType = getPreviewFileType(filePath)
        if (fileType != null) {
          onFilePreview(filePath, fileType, { mode: 'preview' })
          return
        }
      }
      handleReveal(filePath)
    },
    [handleReveal, onFilePreview],
  )

  const renderSkill = (skill: SessionJourneySkill) => (
    <div
      className="chat-journey__row"
      key={`skill-${skill.name}`}
      title={`${skill.name}（${skill.toolName} · 最近 ${formatTime(skill.lastUsedAt)}）`}
    >
      <Icons.Skills aria-hidden="true" size={14} className="chat-journey__row-icon s-skill" />
      <span className="chat-journey__row-name">{skill.name}</span>
      <span className="chat-journey__row-meta">{skill.calls} 次</span>
    </div>
  )

  const renderMcp = (server: SessionJourneyMcpServer) => (
    <div
      className="chat-journey__row"
      key={`mcp-${server.serverId}`}
      title={`${server.displayName}（${server.serverId} · ${server.tools} 个工具 · 最近 ${formatTime(server.lastUsedAt)}）`}
    >
      <Icons.MCP aria-hidden="true" size={14} className="chat-journey__row-icon s-mcp" />
      <span className="chat-journey__row-name">{server.displayName}</span>
      <span className="chat-journey__row-meta">
        {server.tools} 工具 · {server.calls} 次
      </span>
    </div>
  )

  const renderWeb = (entry: SessionJourneyWebEntry) =>
    entry.kind === 'page' ? (
      <button
        type="button"
        className="chat-journey__row is-action"
        key={`web-${entry.kind}-${entry.text}`}
        onClick={() => handleOpenWeb(entry)}
        title={`${entry.text}（${entry.toolName} · ${entry.calls} 次）`}
      >
        <Icons.Globe aria-hidden="true" size={14} className="chat-journey__row-icon s-web" />
        <span className="chat-journey__row-name">{webDisplayText(entry)}</span>
        <span className="chat-journey__row-meta">{entry.calls} 次</span>
      </button>
    ) : (
      <div
        className="chat-journey__row"
        key={`web-${entry.kind}-${entry.text}`}
        title={`搜索「${entry.text}」（${entry.toolName} · ${entry.calls} 次）`}
      >
        <Icons.Search aria-hidden="true" size={14} className="chat-journey__row-icon s-web" />
        <span className="chat-journey__row-name">{entry.text}</span>
        <span className="chat-journey__row-meta">{entry.calls} 次</span>
      </div>
    )

  const renderArtifact = (artifact: SessionJourneyArtifact) => (
    <button
      type="button"
      className="chat-journey__row is-action"
      key={`artifact-${artifact.path}`}
      onClick={() => artifact.absolutePath != null && handleOpenFile(artifact.absolutePath)}
      disabled={artifact.absolutePath == null}
      title={`${artifact.path}${artifact.title != null ? ` · ${artifact.title}` : ''}（点击预览 · 最近 ${formatTime(artifact.lastChangedAt)}）`}
    >
      {artifact.presented ? (
        <Icons.Star aria-hidden="true" size={14} className="chat-journey__row-icon s-presented" />
      ) : (
        <Icons.File aria-hidden="true" size={14} className="chat-journey__row-icon s-file" />
      )}
      <span className="chat-journey__row-name">{artifact.name}</span>
      <span className="chat-journey__row-tags">
        {artifact.presented && <span className="chat-journey__tag s-presented">呈现</span>}
        {artifact.changeTypes.map((type) => (
          <span className="chat-journey__tag" key={type}>
            {CHANGE_TYPE_LABEL[type]}
          </span>
        ))}
      </span>
    </button>
  )

  const renderInputSource = (source: SessionJourneyInputSource) => (
    <button
      type="button"
      className="chat-journey__row is-action"
      key={`input-${source.path}`}
      onClick={() => handleOpenFile(source.path)}
      title={`${source.path}${source.mimeType != null ? ` (${source.mimeType})` : ''}（点击预览 · ${source.occurrences} 次）`}
    >
      {source.kind === 'image' ? (
        <Icons.Image aria-hidden="true" size={14} className="chat-journey__row-icon s-image" />
      ) : source.kind === 'directory' ? (
        <Icons.Folder aria-hidden="true" size={14} className="chat-journey__row-icon s-image" />
      ) : (
        <Icons.FileText aria-hidden="true" size={14} className="chat-journey__row-icon s-image" />
      )}
      <span className="chat-journey__row-name">{source.name}</span>
      {source.occurrences > 1 && (
        <span className="chat-journey__row-meta">{source.occurrences} 次</span>
      )}
    </button>
  )

  const renderRefresh = (
    <button
      type="button"
      className="chat-journey__icon-btn"
      onClick={() => void load()}
      disabled={loading}
      title="刷新"
      aria-label="刷新会话经历"
    >
      <Icons.Refresh size={11} />
    </button>
  )

  // ── 加载 / 错误 / 空态：均为独立的轻量卡片，不占用分组标题 ──
  if (error != null) {
    return (
      <>
        <section className="inspector-section chat-journey">
          <div className="chat-journey__error">
            <span>会话经历加载失败：{error}</span>
            <button type="button" onClick={() => void load()}>
              重试
            </button>
          </div>
        </section>
        {afterSkillsMcp}
      </>
    )
  }

  if (loading && data == null) {
    return (
      <>
        <section className="inspector-section chat-journey" aria-busy="true">
          <div className="chat-journey__skeleton">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="chat-journey__skeleton-row"
                style={{ width: i % 2 === 0 ? '64%' : '86%' }}
              />
            ))}
          </div>
        </section>
        {afterSkillsMcp}
      </>
    )
  }

  if (data == null) return afterSkillsMcp ?? null

  // ── 四个同级折叠区块：产物 → 技能与 MCP → 网页查询 → 输入来源 ──
  const sections: Array<{ key: string; title: string; count: number; children: ReactNode[] }> = [
    {
      key: 'artifacts',
      title: '过程产物',
      count: data.artifacts.length,
      children: data.artifacts.map(renderArtifact),
    },
    {
      key: 'skills-mcp',
      title: '技能与 MCP',
      count: data.skills.length + data.mcpServers.length,
      children: [...data.skills.map(renderSkill), ...data.mcpServers.map(renderMcp)],
    },
    {
      key: 'web',
      title: '网页查询',
      count: data.web.length,
      children: data.web.map(renderWeb),
    },
    {
      key: 'inputs',
      title: '输入来源',
      count: data.inputSources.length,
      children: data.inputSources.map(renderInputSource),
    },
  ].filter((section) => section.count > 0)

  if (sections.length === 0) return afterSkillsMcp ?? null

  const renderSection = (key: string) => {
    const index = sections.findIndex((section) => section.key === key)
    const section = index < 0 ? undefined : sections[index]
    if (section == null) return null

    return (
      <InspectorCollapsibleSection
        key={section.key}
        className="chat-journey"
        title={section.title}
        summary={<span className="inspector-count">{section.count}</span>}
        headerAction={renderRefresh}
        defaultExpanded={
          section.key === 'artifacts' || section.key === 'skills-mcp' || section.key === 'web'
        }
      >
        <div className="chat-journey__list">{section.children}</div>
        {data.truncated && index === sections.length - 1 && (
          <div className="chat-journey__foot">仅统计最近记录（更早的历史未包含）</div>
        )}
      </InspectorCollapsibleSection>
    )
  }

  return (
    <>
      {renderSection('artifacts')}
      {renderSection('skills-mcp')}
      {afterSkillsMcp}
      {renderSection('web')}
      {renderSection('inputs')}
    </>
  )
}
