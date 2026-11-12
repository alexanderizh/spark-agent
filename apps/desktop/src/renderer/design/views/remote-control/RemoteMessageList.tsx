/**
 * 远程消息渲染。
 *
 * 富文本复用桌面端 ChatMarkdown（代码高亮、mermaid 图、SVG、表格、文件链接）。
 * 思考与工具调用对齐桌面端对话区：连续的思考/工具收成一条「活动段」摘要行，
 * 展开才逐条列出——一次 turn 里十几个 bash 逐条铺开会把正文冲散。
 * 整条回答就是一个 HTML 文档时改用隔离页面预览（agent 直接产出页面的场景）。
 */
import { useMemo, useState } from 'react'
import { Icons } from '../../Icons'
import { MarkdownText } from '../chat/ChatMarkdown'
import { RemoteAttachmentStrip } from './RemoteAttachmentStrip'
import { RemoteFileCards } from './RemoteFileCards'
import { RemoteHtmlPreview } from './RemoteHtmlPreview'
import {
  countActivityErrors,
  groupRemoteActivity,
  isActivityLive,
  settleActivitySteps,
  isShellTool,
  summarizeActivity,
} from './remoteActivity'
import type { RemoteActivityStep, RemoteTimelineItem } from './remoteEventMerge'
import { extractHtmlDocument } from './remoteRichContent'

const TOOL_STATUS_LABEL = { running: '执行中', success: '完成', error: '失败' } as const

/** 活动段里的一步：细行，无描边盒子；点开才展开结果 */
function StepRow({ step, live }: { step: RemoteActivityStep; live: boolean }) {
  const [open, setOpen] = useState(false)

  if (step.kind === 'thinking') {
    // 没在跑的历史思考不显示「进行中…」，改为字数（目标端不一定写终态）
    const streaming = step.streaming && live
    return (
      <div className="rc-step is-thought">
        <button
          type="button"
          className="rc-step-head"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <span className="rc-step-icon">
            <Icons.Sparkles size={12} />
          </span>
          <span className="rc-step-name">思考</span>
          <span className="rc-step-meta is-quiet">
            {streaming ? '进行中…' : `${step.text.length} 字`}
          </span>
          <span className={`rc-step-chevron${open ? ' is-open' : ''}`}>
            <Icons.ChevronRight size={12} />
          </span>
        </button>
        {open && (
          <div className="rc-step-body md-surface">
            <MarkdownText
              content={step.text}
              isStreaming={streaming}
              detectDocumentOutput={false}
            />
          </div>
        )}
      </div>
    )
  }

  const hasResult = step.result != null && step.result.trim().length > 0
  // 会话已经结束还停在 running = 目标端没记到结果（中断/漏写），显示「未完成」
  const stale = step.status === 'running' && !live
  const statusLabel = stale ? '未完成' : TOOL_STATUS_LABEL[step.status]

  return (
    <div className={`rc-step state-${step.status}${stale ? ' is-stale' : ''}`}>
      <button
        type="button"
        className="rc-step-head"
        onClick={() => hasResult && setOpen((value) => !value)}
        aria-expanded={hasResult ? open : undefined}
      >
        <span className="rc-step-icon">
          {isShellTool(step.toolName) ? (
            <Icons.BashCommand size={12} />
          ) : (
            <Icons.Wrench size={12} />
          )}
        </span>
        <span className="rc-step-name is-mono">{step.toolName}</span>
        <span className={`rc-step-status state-${step.status}${stale ? ' is-stale' : ''}`}>
          {step.status === 'running' && !stale && <Icons.Spinner size={9} className="spin" />}
          {statusLabel}
        </span>
        {hasResult && (
          <span className={`rc-step-chevron${open ? ' is-open' : ''}`}>
            <Icons.ChevronRight size={12} />
          </span>
        )}
      </button>
      {open && hasResult && <pre className="rc-step-result">{step.result}</pre>}
    </div>
  )
}

/**
 * 活动段：≥2 步收成一行摘要（默认折叠，与桌面端一致）；
 * 只有 1 步时直接渲染那一行，不再多套一层摘要，避免「为了折一条而多一行」。
 */
function ActivityBlock({
  item,
  runningSession,
  isLast,
}: {
  item: Extract<RemoteTimelineItem, { kind: 'activity' }>
  runningSession: boolean
  isLast: boolean
}) {
  const [open, setOpen] = useState(false)
  // 会话在跑 + 这一段是最后一段，才可能真的还在进行（见 isActivityLive 的说明）
  const running = isActivityLive(item.steps, { live: runningSession, isLast })
  const steps = useMemo(() => settleActivitySteps(item.steps, running), [item.steps, running])
  const errors = countActivityErrors(item.steps)

  if (steps.length === 1) {
    const only = steps[0]
    return (
      <div className="rc-activity is-single">
        {only != null && <StepRow step={only} live={running} />}
      </div>
    )
  }

  return (
    <div className={`rc-activity${open ? ' is-open' : ''}${running ? ' is-running' : ''}`}>
      <button
        type="button"
        className="rc-activity-head"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        title={summarizeActivity(item.steps)}
      >
        <span className="rc-activity-icon">
          <Icons.Activity size={12} />
        </span>
        <span className="rc-activity-summary">{summarizeActivity(item.steps)}</span>
        {running ? (
          <span className="rc-activity-live">
            <Icons.Spinner size={10} className="spin" />
            进行中
          </span>
        ) : (
          errors > 0 && <span className="rc-activity-fail">{errors} 项失败</span>
        )}
        <span className="rc-activity-chevron">
          <Icons.ChevronRight size={12} />
        </span>
      </button>
      {open && (
        <div className="rc-activity-body">
          {steps.map((step) => (
            <StepRow key={`${step.kind}-${step.id}`} step={step} live={running} />
          ))}
        </div>
      )}
    </div>
  )
}

/** 回答里可能夹着整页 HTML：是文档就预览，不是就走正常 markdown */
function AssistantBody({ text, streaming }: { text: string; streaming: boolean }) {
  const htmlDocument = streaming ? null : extractHtmlDocument(text)
  if (htmlDocument != null) {
    return <RemoteHtmlPreview html={htmlDocument} title="HTML 页面" />
  }
  return (
    <div className="rc-assistant-body md-surface">
      <MarkdownText content={text} isStreaming={streaming} />
    </div>
  )
}

function MessageItem({
  item,
  deviceId,
  showRole,
  isLast,
  sessionRunning,
}: {
  item: RemoteTimelineItem
  deviceId: string
  showRole: boolean
  /** 是否是时间线上的最后一条（活动段要看它判断有没有后续内容） */
  isLast: boolean
  sessionRunning: boolean
}) {
  if (item.kind === 'user') {
    return (
      <div className="rc-msg rc-msg-user">
        <div className="rc-bubble">
          {item.text.length > 0 && <p className="rc-text">{item.text}</p>}
          <RemoteAttachmentStrip deviceId={deviceId} attachments={item.attachments} />
        </div>
      </div>
    )
  }

  if (item.kind === 'activity') {
    return <ActivityBlock item={item} runningSession={sessionRunning} isLast={isLast} />
  }

  if (item.kind === 'files') {
    return <RemoteFileCards deviceId={deviceId} files={item.files} />
  }

  if (item.kind === 'notice') {
    return (
      <div className={`rc-msg rc-msg-notice tone-${item.tone}`}>
        <Icons.AlertTriangle size={12} />
        <span>{item.text}</span>
      </div>
    )
  }

  if (item.kind !== 'assistant') return null

  const streaming = item.streaming && sessionRunning
  return (
    <div className={`rc-msg rc-msg-assistant${streaming ? ' streaming' : ''}`}>
      {showRole && (
        <div className="rc-msg-role">
          <Icons.Agent size={12} />
          远程 Agent
        </div>
      )}
      <AssistantBody text={item.text} streaming={streaming} />
    </div>
  )
}

/**
 * 一个 turn 常被后端拆成多个 segment（文本段、代码段各一条），
 * 连续同类项只保留第一处角色标签，避免同一段回答刷出一排「远程 Agent」。
 */
function shouldShowRole(items: RemoteTimelineItem[], index: number): boolean {
  const current = items[index]
  if (current == null) return true
  if (current.kind !== 'assistant') return true
  const previous = items[index - 1]
  if (previous == null) return true
  return previous.kind !== 'assistant' && previous.kind !== 'thinking'
}

export function RemoteMessageList({
  items,
  deviceId,
  running = false,
}: {
  items: RemoteTimelineItem[]
  deviceId: string
  /** 会话是否正在运行：历史会话一律不显示「进行中」 */
  running?: boolean
}) {
  // 折叠在这里做而不是让调用方记住：thinking / tool 未折叠时本组件无从渲染，
  // 放在入口保证任何来源的时间线都能正确显示。
  const grouped = useMemo(() => groupRemoteActivity(items), [items])

  return (
    <>
      {grouped.map((item, index) => (
        <MessageItem
          key={`${item.kind}-${item.id}-${item.seq}`}
          item={item}
          deviceId={deviceId}
          showRole={shouldShowRole(grouped, index)}
          isLast={index === grouped.length - 1}
          sessionRunning={running}
        />
      ))}
    </>
  )
}
