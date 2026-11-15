/**
 * 远程消息渲染。
 *
 * 富文本复用桌面端 ChatMarkdown（代码高亮、mermaid 图、SVG、表格、文件链接）。
 * 思考与工具调用对齐桌面端对话区：连续的思考/工具收成一条「活动段」摘要行，
 * 展开才逐条列出——一次 turn 里十几个 bash 逐条铺开会把正文冲散。
 * 整条回答就是一个 HTML 文档时改用隔离页面预览（agent 直接产出页面的场景）。
 *
 * 身份标识（「远程 Agent」）整条会话只出现一次：远程视图是单一 Agent，
 * 逐段挂标签等于每段正文前刷一行同样的字（见 remoteMessageIdentity）。
 *
 * 回合级自动折叠：一轮处理完之后只留最后一段正文总结，中间正文段 / 思考 / 工具
 * 收进一行「已折叠 N 项过程」，点开才看全过程（见 remoteTurnCollapse）。
 * 运行中的那一轮保持展开，实时进展不能被收起来。
 *
 * 每条消息底部挂操作条（复制 / 用户消息的「重新发送」）：复用桌面端的
 * MessageHoverBar，鼠标悬停到该条消息才显形，静态时不占视觉。
 */
import { Fragment, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react'
import { createLogger } from '@spark/shared'
import { Icons } from '../../Icons'
import { MarkdownText } from '../chat/ChatMarkdown'
import { MessageHoverBar } from '../chat/MessageHoverBar'
import type { FileOpenHandler } from '../../components/fileOpenRouting'
import { useIpcInvoke } from '../../hooks/useIpc'
import { RemoteAttachmentStrip } from './RemoteAttachmentStrip'
import type { RemoteAttachmentRef } from './RemoteAttachmentStrip'
import { RemoteDocPreview } from './RemoteDocPreview'
import { RemoteFileCards } from './RemoteFileCards'
import { RemoteHtmlPreview } from './RemoteHtmlPreview'
import {
  countActivityErrors,
  groupRemoteActivity,
  isActivityLive,
  isShellTool,
  settleActivitySteps,
  summarizeActivity,
} from './remoteActivity'
import type { RemoteActivityStep, RemoteTimelineItem } from './remoteEventMerge'
import { fetchRemoteAttachment } from './remoteFileCache'
import { resolveAgentIdentityIndex } from './remoteMessageIdentity'
import {
  extractHtmlDocument,
  fileNameOf,
  splitRemoteHtmlSegments,
  usesDocumentPreview,
} from './remoteRichContent'
import { projectRemoteTurnCollapse, splitRemoteTurns } from './remoteTurnCollapse'

const logger = createLogger('remote-message-list')

/** 时间线上的一条用户消息（「重新发送」正是围绕它做的） */
export type RemoteUserItem = Extract<RemoteTimelineItem, { kind: 'user' }>

const TOOL_STATUS_LABEL = { running: '执行中', success: '完成', error: '失败' } as const

/** 思考正文压成单行预览：换行与连续空白折叠，超长交给 CSS 截断 */
function toThoughtPreview(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * 活动段里的一步：细行，无描边盒子；点开才展开结果。
 * 左边那个小圆点落在活动段的竖线上，读起来像一段执行轨迹。
 */
function StepRow({
  step,
  live,
  onFilePreview,
}: {
  step: RemoteActivityStep
  live: boolean
  /** 思考正文里的文件路径点击 → 远程取回预览（见 RemoteMessageList） */
  onFilePreview?: FileOpenHandler | undefined
}) {
  const [open, setOpen] = useState(false)

  if (step.kind === 'thinking') {
    // 没在跑的历史思考不显示「进行中…」，改为字数（目标端不一定写终态）
    const streaming = step.streaming && live
    const preview = toThoughtPreview(step.text)
    return (
      <div className={`rc-step is-thought${open ? ' is-open' : ''}`}>
        <button
          type="button"
          className="rc-step-head"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <span className="rc-step-dot" aria-hidden="true" />
          <span className="rc-step-icon" aria-hidden="true">
            <Icons.Sparkles size={11} />
          </span>
          <span className="rc-step-name">思考</span>
          {!open && preview.length > 0 && (
            // 折叠时给一句摘要：比只写「思考 · 128 字」有用得多，也不占额外行
            <span className="rc-step-preview">{preview}</span>
          )}
          <span className={`rc-step-meta${streaming ? ' is-live' : ''}`}>
            {streaming ? '进行中' : `${step.text.length} 字`}
          </span>
          <span className={`rc-step-chevron${open ? ' is-open' : ''}`}>
            <Icons.ChevronRight size={11} />
          </span>
        </button>
        {open && (
          <div className="rc-step-body md-surface">
            <MarkdownText
              content={step.text}
              isStreaming={streaming}
              detectDocumentOutput={false}
              remoteFileRefs
              {...(onFilePreview != null ? { onFilePreview } : {})}
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
    <div className={`rc-step is-tool state-${step.status}${stale ? ' is-stale' : ''}`}>
      <button
        type="button"
        className="rc-step-head"
        onClick={() => hasResult && setOpen((value) => !value)}
        aria-expanded={hasResult ? open : undefined}
        title={hasResult ? (open ? '收起输出' : '查看输出') : undefined}
      >
        <span
          className={`rc-step-dot state-${step.status}${stale ? ' is-stale' : ''}`}
          aria-hidden="true"
        />
        <span className="rc-step-icon" aria-hidden="true">
          {isShellTool(step.toolName) ? (
            // 带外框的命令行图标：裸的 `>_` 在小字号下会被读成箭头，和右侧展开箭头撞车
            <Icons.BashCommand size={11} />
          ) : (
            <Icons.Wrench size={11} />
          )}
        </span>
        <span className="rc-step-name is-mono">{step.toolName}</span>
        <span className={`rc-step-status state-${step.status}${stale ? ' is-stale' : ''}`}>
          {step.status === 'running' && !stale && <Icons.Spinner size={9} className="spin" />}
          {statusLabel}
        </span>
        {hasResult && (
          <span className={`rc-step-chevron${open ? ' is-open' : ''}`}>
            <Icons.ChevronRight size={11} />
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
  onFilePreview,
}: {
  item: Extract<RemoteTimelineItem, { kind: 'activity' }>
  runningSession: boolean
  isLast: boolean
  onFilePreview?: FileOpenHandler | undefined
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
        {only != null && (
          <StepRow
            step={only}
            live={running}
            {...(onFilePreview != null ? { onFilePreview } : {})}
          />
        )}
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
        <span className="rc-activity-icon" aria-hidden="true">
          <Icons.Activity size={12} />
        </span>
        <span className="rc-activity-summary">{summarizeActivity(item.steps)}</span>
        {running && (
          <span className="rc-activity-live">
            <Icons.Spinner size={10} className="spin" />
            进行中
          </span>
        )}
        {!running && errors > 0 && <span className="rc-activity-fail">{errors} 项失败</span>}
        <span className={`rc-activity-chevron${open ? ' is-open' : ''}`}>
          <Icons.ChevronRight size={12} />
        </span>
      </button>
      {open && (
        <div className="rc-activity-body">
          {steps.map((step) => (
            <StepRow
              key={`${step.kind}-${step.id}`}
              step={step}
              live={running}
              {...(onFilePreview != null ? { onFilePreview } : {})}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * 回答正文渲染：
 *   1. 整条就是一个 HTML 文档 → 单独的隔离页面预览（agent 直接产出页面的场景）；
 *   2. 讲解文字中间夹着完整 HTML 文档块 → 按段渲染，文档块卡片化（预览 + 独立窗口/
 *      外部浏览器），对齐本地会话 html_block 的体验——远程链路没有 UIBlock，
 *      在渲染端自己识别（见 remoteRichContent）；
 *   3. 其余情况走普通 markdown（零行为变化）。
 * 流式渲染中不做任何抽取，等流结束再定形，避免文档写到一半被误判。
 */
function AssistantBody({
  text,
  streaming,
  onFilePreview,
}: {
  text: string
  streaming: boolean
  onFilePreview?: FileOpenHandler | undefined
}) {
  const htmlDocument = streaming ? null : extractHtmlDocument(text)
  if (htmlDocument != null) {
    return <RemoteHtmlPreview html={htmlDocument} title="HTML 页面" openActions />
  }
  const segments = streaming ? null : splitRemoteHtmlSegments(text)
  if (segments == null) {
    return (
      <div className="rc-assistant-body md-surface">
        <MarkdownText
          content={text}
          isStreaming={streaming}
          remoteFileRefs
          {...(onFilePreview != null ? { onFilePreview } : {})}
        />
      </div>
    )
  }
  let htmlCount = 0
  return (
    <div className="rc-assistant-body md-surface">
      {segments.map((segment, index) => {
        if (segment.kind === 'markdown') {
          return (
            <MarkdownText
              key={index}
              content={segment.text}
              remoteFileRefs
              {...(onFilePreview != null ? { onFilePreview } : {})}
            />
          )
        }
        htmlCount += 1
        return (
          <RemoteHtmlPreview
            key={index}
            html={segment.html}
            title={htmlCount > 1 ? `HTML 块 ${htmlCount}` : 'HTML 块'}
            openActions
          />
        )
      })}
    </div>
  )
}

/** 会话开头的身份行：一处说明「这些回答来自哪台电脑上的 Agent」 */
function AgentIdentity() {
  return (
    <div className="rc-msg-identity">
      <span className="rc-msg-avatar" aria-hidden="true">
        <Icons.Agent size={12} />
      </span>
      <span className="rc-msg-identity-name">远程 Agent</span>
    </div>
  )
}

function MessageItem({
  item,
  deviceId,
  showIdentity,
  isLast,
  sessionRunning,
  onReuseUserMessage,
  onFilePreview,
}: {
  item: RemoteTimelineItem
  deviceId: string
  /** 整条时间线只有第一条助手内容需要身份行 */
  showIdentity: boolean
  /** 是否是时间线上的最后一条（活动段要看它判断有没有后续内容） */
  isLast: boolean
  sessionRunning: boolean
  /** 用户消息的「重新发送」：把正文与附件回填到输入区 */
  onReuseUserMessage?: (item: RemoteUserItem) => void
  /** 正文里的文件路径点击 → 远程取回预览 */
  onFilePreview?: FileOpenHandler | undefined
}) {
  if (item.kind === 'user') {
    return (
      <div className="rc-msg rc-msg-user">
        <div className="rc-bubble">
          {item.text.length > 0 && <p className="rc-text">{item.text}</p>}
          <RemoteAttachmentStrip deviceId={deviceId} attachments={item.attachments} />
        </div>
        {/* 操作条复用桌面端 .msg-hover-bar 的形态，hover 到气泡才显形（见 remote-control.less） */}
        <MessageHoverBar
          position="right"
          textContent={item.text}
          {...(onReuseUserMessage != null ? { onResend: () => onReuseUserMessage(item) } : {})}
        />
      </div>
    )
  }

  if (item.kind === 'activity') {
    return (
      <ActivityBlock
        item={item}
        runningSession={sessionRunning}
        isLast={isLast}
        {...(onFilePreview != null ? { onFilePreview } : {})}
      />
    )
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
      {showIdentity && <AgentIdentity />}
      <AssistantBody
        text={item.text}
        streaming={streaming}
        {...(onFilePreview != null ? { onFilePreview } : {})}
      />
      {/* 生成中的分段不挂操作条：按钮会随正文增长反复位移 */}
      {!streaming && item.text.trim().length > 0 && (
        // 靠右：远程视图一轮拆成十几段，操作栏贴在正文下沿，左对齐时会落在
        // 下一段（活动摘要 / 正文）的左边缘上，和正文起点抢视线
        <MessageHoverBar position="right" textContent={item.text} />
      )}
    </div>
  )
}

/** 折叠条：一行收起整轮过程，展开后原地变成「收起过程」 */
function TurnCollapseBar({
  hiddenCount,
  hiddenFailures,
  expanded,
  onToggle,
}: {
  hiddenCount: number
  hiddenFailures: number
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className={`rc-turn-collapse${expanded ? ' is-open' : ''}`}
      onClick={onToggle}
      aria-expanded={expanded}
      title={expanded ? '收起这一轮的中间过程' : '展开这一轮的中间过程'}
    >
      <span className="rc-turn-collapse-icon" aria-hidden="true">
        <Icons.History size={12} />
      </span>
      <span className="rc-turn-collapse-text">
        {expanded ? '收起过程' : `已折叠 ${hiddenCount} 段过程`}
      </span>
      {hiddenFailures > 0 && <span className="rc-turn-collapse-fail">{hiddenFailures} 项失败</span>}
      <span className="rc-turn-collapse-chevron" aria-hidden="true">
        <Icons.ChevronRight size={12} />
      </span>
    </button>
  )
}

/**
 * 本地待发的乐观气泡：POST /turns 在途时先上屏，事件回流后整条交棒给真实消息。
 * 失败态停在气泡上，点它重发（文字与附件都还在，不会丢）。
 * queued 态表示目标端已接受但排队（会话有活跃回合）：状态行换成「已加入队列」，
 * 气泡继续挂着等回合起跑——排队期间时间线不会出现这条消息，不能让它凭空消失。
 */
function PendingUserBubble({
  pending,
  deviceId,
  onRetry,
}: {
  pending: RemotePendingUserView
  deviceId: string
  onRetry?: () => void
}) {
  return (
    <div className="rc-msg rc-msg-user rc-msg-user--pending">
      <div className="rc-bubble">
        {pending.text.length > 0 && <p className="rc-text">{pending.text}</p>}
        <RemoteAttachmentStrip deviceId={deviceId} attachments={pending.attachments} />
      </div>
      {pending.status === 'sending' && (
        <button type="button" className="rc-send-state" disabled>
          <Icons.Spinner size={11} className="spin" />
          发送中…
        </button>
      )}
      {pending.status === 'sent' && pending.queued === true && (
        <span className="rc-send-state is-queued">
          <Icons.Clock size={11} />
          已加入队列 · 当前回合结束后自动执行
        </span>
      )}
      {pending.status === 'failed' && (
        <button type="button" className="rc-send-state is-failed" onClick={onRetry}>
          发送失败 · 点击重试
          {pending.error != null ? `（${pending.error}）` : ''}
        </button>
      )}
    </div>
  )
}

/**
 * 回合已跑起来但目标端还没吐第一个字：三点跳动 + 一行说明。
 * 没有它，发送成功到首字到达之间界面毫无变化，用户只能干等。
 */
function AwaitingResponseRow() {
  return (
    <div className="rc-msg rc-msg-awaiting">
      <span className="rc-awaiting-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="rc-awaiting-text">等待响应…</span>
    </div>
  )
}

/**
 * 一个回合：渲染该轮条目，并负责「处理完自动收起中间过程」。
 *
 * 折叠状态在组件内：每轮一份，进历史页时旧回合天然都是收起的；
 * 用户点开的那个回合自己记住，不会被同一条时间线里别的回合干扰。
 */
function RemoteTurnBlock({
  items,
  deviceId,
  runningSession,
  isLastTurn,
  identityItemId,
  lastItemId,
  onReuseUserMessage,
  onFilePreview,
}: {
  items: RemoteTimelineItem[]
  deviceId: string
  runningSession: boolean
  isLastTurn: boolean
  /** 整条时间线上需要渲染身份行的助手条目 id（只会命中一次） */
  identityItemId: string | null
  /** 整条时间线最后一条的 id：活动段的「进行中」只可能落在它上面 */
  lastItemId: string | null
  onReuseUserMessage?: (item: RemoteUserItem) => void
  onFilePreview?: FileOpenHandler | undefined
}) {
  // 运行中的最后一轮不折叠：用户要看到实时进展
  const finished = !(runningSession && isLastTurn)
  const projection = useMemo(
    () => projectRemoteTurnCollapse(items, { finished }),
    [finished, items],
  )

  const [expanded, setExpanded] = useState(!projection.canCollapse)
  const wasCollapsibleRef = useRef(projection.canCollapse)
  useLayoutEffect(() => {
    // 与桌面端主对话区同一规则：只在「这一轮刚处理完」时自动收起一次；
    // 用户之后手动展开不再被打断。
    if (projection.canCollapse && !wasCollapsibleRef.current) setExpanded(false)
    else if (!projection.canCollapse) setExpanded(true)
    wasCollapsibleRef.current = projection.canCollapse
  }, [projection.canCollapse])

  const collapsed = projection.canCollapse && !expanded
  const shown = collapsed ? projection.visible : items
  // 折叠条落在提问之后、过程之前——读起来就是「这轮折叠了这些」，不打断正文
  const leadingUserCount = shown.findIndex((item) => item.kind !== 'user')
  const barIndex = projection.canCollapse
    ? leadingUserCount === -1
      ? shown.length
      : leadingUserCount
    : -1

  return (
    <>
      {shown.map((item, index) => (
        <Fragment key={`${item.kind}-${item.id}-${item.seq}`}>
          {index === barIndex && (
            <TurnCollapseBar
              hiddenCount={projection.hiddenCount}
              hiddenFailures={projection.hiddenFailures}
              expanded={expanded}
              onToggle={() => setExpanded((value) => !value)}
            />
          )}
          <MessageItem
            item={item}
            deviceId={deviceId}
            showIdentity={identityItemId != null && item.id === identityItemId}
            isLast={lastItemId != null && item.id === lastItemId}
            sessionRunning={runningSession}
            {...(onReuseUserMessage != null ? { onReuseUserMessage } : {})}
            {...(onFilePreview != null ? { onFilePreview } : {})}
          />
        </Fragment>
      ))}
    </>
  )
}

/**
 * 本地待发的用户消息（乐观气泡）在列表里的形态。
 * 状态机由 RemoteChatPane 推进：sending（POST 在途）→ sent（已送达等事件回流）
 * → 事件到位后整条消失；failed 停在气泡上可点击重试。
 * queued = 目标端已接受但排队（会话有活跃回合）：状态行显示「已加入队列」，
 * 气泡挂到 user 事件入库为止（判据见 isPendingUserVisible）。
 */
export interface RemotePendingUserView {
  text: string
  attachments: RemoteAttachmentRef[]
  status: 'sending' | 'sent' | 'failed'
  turnIds?: string[]
  queued?: boolean
  error?: string
}

export function RemoteMessageList({
  items,
  deviceId,
  running = false,
  onReuseUserMessage,
  pendingUser,
  onRetryPendingUser,
  awaitingResponse = false,
}: {
  items: RemoteTimelineItem[]
  deviceId: string
  /** 会话是否正在运行：历史会话一律不显示「进行中」 */
  running?: boolean
  /** 用户消息「重新发送」回调；不传则不显示该按钮（预览壳等场景） */
  onReuseUserMessage?: (item: RemoteUserItem) => void
  /** 本地待发的乐观气泡；事件回流后由调用方置 null 交棒 */
  pendingUser?: RemotePendingUserView | null
  /** 点击失败气泡的重试入口 */
  onRetryPendingUser?: () => void
  /** 已送达、目标端还未吐字：列表末尾显示等待指示器 */
  awaitingResponse?: boolean
}) {
  // 折叠在这里做而不是让调用方记住：thinking / tool 未折叠时本组件无从渲染，
  // 放在入口保证任何来源的时间线都能正确显示。
  const grouped = useMemo(() => groupRemoteActivity(items), [items])
  const turns = useMemo(() => splitRemoteTurns(grouped), [grouped])
  const identityItemId = useMemo(() => {
    const index = resolveAgentIdentityIndex(grouped)
    return index >= 0 ? (grouped[index]?.id ?? null) : null
  }, [grouped])
  const lastItemId = grouped.length > 0 ? (grouped[grouped.length - 1]?.id ?? null) : null

  // 正文里的文件路径点击：文档（Office/PDF）开右侧抽屉，其余取回后交给系统应用。
  // 与产物卡片的「预览 / 打开」双轨一致（见 RemoteFileCards）。
  const [docPath, setDocPath] = useState<string | null>(null)
  const { invoke: openLocalFile } = useIpcInvoke('file:open')
  const openWithSystemApp = useCallback(
    async (filePath: string) => {
      try {
        const cached = await fetchRemoteAttachment(deviceId, filePath)
        const result = await openLocalFile({ filePath: cached.localPath })
        if (!result.opened) logger.warn('Failed to open remote file with system app', { filePath })
      } catch (cause) {
        logger.warn('Failed to fetch remote file for preview', {
          filePath,
          message: cause instanceof Error ? cause.message : String(cause),
        })
      }
    },
    [deviceId, openLocalFile],
  )
  const handleFilePreview = useCallback<FileOpenHandler>(
    (filePath) => {
      if (usesDocumentPreview(filePath)) setDocPath(filePath)
      else void openWithSystemApp(filePath)
    },
    [openWithSystemApp],
  )

  return (
    <>
      {turns.map((turn, index) => (
        <RemoteTurnBlock
          key={turn.key}
          items={turn.items}
          deviceId={deviceId}
          runningSession={running}
          isLastTurn={index === turns.length - 1}
          identityItemId={identityItemId}
          lastItemId={lastItemId}
          onFilePreview={handleFilePreview}
          {...(onReuseUserMessage != null ? { onReuseUserMessage } : {})}
        />
      ))}
      {pendingUser != null && (
        <PendingUserBubble
          pending={pendingUser}
          deviceId={deviceId}
          {...(onRetryPendingUser != null ? { onRetry: onRetryPendingUser } : {})}
        />
      )}
      {awaitingResponse && <AwaitingResponseRow />}
      {docPath != null && (
        <RemoteDocPreview
          deviceId={deviceId}
          remotePath={docPath}
          name={fileNameOf(docPath)}
          onClose={() => setDocPath(null)}
        />
      )}
    </>
  )
}
