import { Box, Text, useApp, useStdout } from 'ink'
import { homedir } from 'node:os'
import { sep } from 'node:path'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'

import { expandCustomCommand, matchCustomCommand, type CustomCommand } from '../commands/custom-commands.js'
import type { AgentEvent } from '../events/schema.js'
import { shortSessionId } from '../events/ledger.js'
import type { SessionMeta } from '../seams.js'
import type { LlmDelta, ReasoningEffort } from '../llm/types.js'
import type { InteractiveApprover, PendingApproval } from '../permission/interactive.js'
import type { PermissionDecision, PermissionMode } from '../permission/types.js'
import type { AgentSession } from '../sdk/agent.js'
import { SPARK_ENGINE_VERSION } from '../version.js'
import { PermissionCard } from './components/permission-card.js'
import { PERMISSION_MODES, PermissionPicker, nextPermissionMode } from './components/permission-picker.js'
import { DEFAULT_REASONING_EFFORT, EffortPicker } from './components/effort-picker.js'
import { ActiveTools, Transcript } from './components/rows.js'
import { SessionPicker } from './components/session-picker.js'
import { InputEditor } from './components/input-editor.js'
import { WorkingLine } from './components/spinner.js'
import { WelcomeBox } from './components/welcome.js'
import { ModelPicker, ProviderConfigForm } from './model-flow.js'
import { displayModelName } from './display-name.js'
import { helpDetail } from './slash-commands.js'
import type { ModelRuntimeController } from './use-model-runtime.js'
import { projectTranscript } from './projection.js'
import {
  describeUpdateOutcome,
  type SparkUpdateRunner,
  type UpdateOutcomeTone,
} from './update-runner.js'
import {
  defaultTheme,
  detectTerminalCapabilities,
  type TerminalCapabilities,
  type TuiTheme,
} from './theme.js'

export interface SparkTuiAppProps {
  readonly initialSession: AgentSession
  readonly initialEvents: readonly AgentEvent[]
  readonly approver: InteractiveApprover
  readonly createSession: () => Promise<AgentSession>
  readonly capabilities?: TerminalCapabilities
  readonly theme?: TuiTheme
  readonly version?: string
  readonly model?: string
  readonly modelRuntime?: ModelRuntimeController
  /** In-TUI self-update channel; absent disables /update (static/test mode). */
  readonly updateRunner?: SparkUpdateRunner
  readonly permissionMode?: PermissionMode
  /** Initial reasoning effort (from --effort); adjustable via /effort. */
  readonly reasoningEffort?: ReasoningEffort
  /** Prompt files from `.spark/commands/**`; expanded and sent as the turn input. */
  readonly customCommands?: readonly CustomCommand[]
  /** Working directory shown in the status bar; defaults to blank when unknown. */
  readonly cwd?: string
  /** Reopen a recorded session by id; absent disables /sessions switching. */
  readonly openSession?: (sessionId: string) => Promise<AgentSession>
  /** Resumable sessions for the /sessions picker (most recent first). */
  readonly listSessions?: () => Promise<readonly SessionMeta[]>
  /** Open the session picker at startup (bare `spark --resume`). */
  readonly resumePicker?: boolean
}

interface NoticeState {
  readonly text: string
  readonly tone: UpdateOutcomeTone | 'warn'
}

function permissionLabel(mode: PermissionMode): string {
  return PERMISSION_MODES.find((entry) => entry.mode === mode)?.label ?? mode
}

/** Collapse the home prefix to `~` so the status bar path stays short. */
function formatCwd(cwd: string | undefined): string | undefined {
  if (cwd === undefined || cwd === '') return undefined
  const home = homedir()
  if (cwd === home) return '~'
  if (cwd.startsWith(home + sep)) return '~' + cwd.slice(home.length)
  return cwd
}

interface StepPerf {
  readonly tokensPerSec: number
  readonly ttftMs: number
}

/**
 * Throughput and time-to-first-token of the most recent model call, derived
 * from the latest assistant event that carries adapter timing.
 */
function lastStepPerf(events: readonly AgentEvent[]): StepPerf | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'assistant.completed') continue
    if (event.llmMs <= 0 && event.ttftMs <= 0) continue
    return {
      tokensPerSec: event.llmMs > 0 ? (event.usage.outputTokens / event.llmMs) * 1_000 : 0,
      ttftMs: event.ttftMs,
    }
  }
  return undefined
}

/** Compact bar segment, e.g. `38.5 tok/s · ttft 0.8s`; empty parts dropped. */
function formatPerf(perf: StepPerf): string {
  const segments: string[] = []
  if (perf.tokensPerSec > 0) {
    const rate =
      perf.tokensPerSec >= 100 ? Math.round(perf.tokensPerSec).toString() : perf.tokensPerSec.toFixed(1)
    segments.push(`${rate} tok/s`)
  }
  if (perf.ttftMs > 0) {
    const ttft =
      perf.ttftMs >= 10_000
        ? `${Math.round(perf.ttftMs / 1_000)}s`
        : perf.ttftMs >= 1_000
          ? `${(perf.ttftMs / 1_000).toFixed(1)}s`
          : `${Math.round(perf.ttftMs)}ms`
    segments.push(`ttft ${ttft}`)
  }
  return segments.join(' · ')
}

function noticeColor(theme: TuiTheme, tone: NoticeState['tone']): string {
  if (tone === 'ok') return theme.ok
  if (tone === 'error') return theme.error
  if (tone === 'info') return theme.dim
  return theme.warn
}

export function SparkTuiApp(props: SparkTuiAppProps): ReactElement {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const theme = props.theme ?? defaultTheme
  // Capabilities re-detect on terminal resize so wrapping reflows; the
  // initial value honors the injected prop (tests pin width/color mode).
  const [capabilities, setCapabilities] = useState(() => props.capabilities ?? detectTerminalCapabilities())
  // Bumped after a resize repaint: remounts <Static> so already-written rows
  // are re-emitted at the new width instead of staying at the old one.
  const [resizeVersion, setResizeVersion] = useState(0)
  const [session, setSession] = useState(props.initialSession)
  const [events, setEvents] = useState<AgentEvent[]>([...props.initialEvents])
  const [liveText, setLiveText] = useState('')
  const [liveThinking, setLiveThinking] = useState('')
  const [showThinking, setShowThinking] = useState(true)
  const [activeTurns, setActiveTurns] = useState(0)
  const [pending, setPending] = useState<PendingApproval>()
  const [notice, setNoticeFull] = useState<NoticeState | undefined>(
    props.permissionMode === 'bypass'
      ? { text: '危险：权限绕过已启用，已注册工具可不经审批执行。', tone: 'warn' }
      : undefined,
  )
  const [exitArmed, setExitArmed] = useState(false)
  const [configFormOpen, setConfigFormOpen] = useState(false)
  const [permPickerOpen, setPermPickerOpen] = useState(false)
  const [effortPickerOpen, setEffortPickerOpen] = useState(false)
  const [sessionPickerOpen, setSessionPickerOpen] = useState(props.resumePicker === true)
  const [sessions, setSessions] = useState<readonly SessionMeta[]>([])
  // Always explicit: the engine never sends a channel-dependent "auto" effort.
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(
    props.reasoningEffort ?? DEFAULT_REASONING_EFFORT,
  )
  const [permissionMode, setPermissionModeState] = useState<PermissionMode>(
    props.permissionMode ?? props.initialSession.permissionMode,
  )
  const [updateRunning, setUpdateRunning] = useState(false)
  const [updateCheckOnly, setUpdateCheckOnly] = useState(false)
  const controllers = useRef<AbortController[]>([])
  const exitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => props.approver.subscribe(setPending), [props.approver])

  // Load the session list whenever the picker becomes visible (the startup
  // picker and /sessions share it); a failed read leaves the picker usable
  // but empty instead of crashing the render.
  useEffect(() => {
    if (!sessionPickerOpen || props.listSessions === undefined) return
    let cancelled = false
    props
      .listSessions()
      .then((found) => {
        if (!cancelled) setSessions(found)
      })
      .catch(() => {
        if (!cancelled) setSessions([])
      })
    return () => {
      cancelled = true
    }
  }, [sessionPickerOpen, props.listSessions])

  // Terminal-resize repaint: <Static> content is written once and never
  // reflows, so after the width settles we clear the screen, refresh the
  // detected capabilities, and remount the transcript (key change) to re-emit
  // every settled row at the new width. Debounced because drag-resize fires
  // a burst of events and each repaint rewrites the whole log; height-only
  // changes reflow natively and are skipped.
  useEffect(() => {
    let repaint: ReturnType<typeof setTimeout> | undefined
    let lastWidth = stdout.columns
    const onResize = (): void => {
      if (stdout.columns === lastWidth) return
      if (repaint !== undefined) clearTimeout(repaint)
      repaint = setTimeout(() => {
        lastWidth = stdout.columns
        stdout.write('\x1b[2J\x1b[H')
        setCapabilities(detectTerminalCapabilities(stdout))
        setResizeVersion((version) => version + 1)
      }, 150)
    }
    stdout.on('resize', onResize)
    return () => {
      stdout.off('resize', onResize)
      if (repaint !== undefined) clearTimeout(repaint)
    }
  }, [stdout])

  useEffect(
    () => () => {
      for (const controller of controllers.current) controller.abort('TUI closed')
      if (exitTimer.current) clearTimeout(exitTimer.current)
    },
    [],
  )

  const setNotice = useCallback((text: string) => {
    setNoticeFull({ text, tone: 'warn' })
  }, [])

  const appendEvent = useCallback((event: AgentEvent) => {
    setEvents((current) =>
      current.some((candidate) => candidate.seq === event.seq) ? current : [...current, event],
    )
    if (
      event.type === 'turn.completed' ||
      event.type === 'turn.cancelled' ||
      event.type === 'turn.failed'
    ) {
      setLiveText('')
      setLiveThinking('')
    }
  }, [])

  const modelRuntime = props.modelRuntime
  const effectiveModel = modelRuntime?.model ?? props.model
  const visibleModelName = displayModelName(effectiveModel, modelRuntime?.catalog)
  const pickerOpen = modelRuntime?.open === true

  const handleDelta = useCallback((delta: LlmDelta) => {
    if (delta.type === 'text') setLiveText((current) => current + delta.text)
    else if (delta.type === 'thinking') setLiveThinking((current) => current + delta.text)
  }, [])

  const startTurn = useCallback(
    (prompt: string) => {
      if (effectiveModel === undefined) {
        modelRuntime?.openPicker('先选择或配置一个模型，再开始任务')
        return
      }
      const controller = new AbortController()
      controllers.current.push(controller)
      setActiveTurns((count) => count + 1)
      setNoticeFull(undefined)
      void session
        .turn(prompt, {
          signal: controller.signal,
          reasoningEffort,
          onEvent: appendEvent,
          onDelta: handleDelta,
        })
        .finally(() => {
          controllers.current = controllers.current.filter((candidate) => candidate !== controller)
          setActiveTurns((count) => Math.max(0, count - 1))
        })
    },
    [appendEvent, effectiveModel, handleDelta, modelRuntime, reasoningEffort, session],
  )

  const submit = useCallback(
    (value: string) => {
      if (value.startsWith('/')) {
        const custom =
          props.customCommands === undefined
            ? undefined
            : matchCustomCommand(value, props.customCommands)
        if (custom) {
          const expanded = expandCustomCommand(custom.command, custom.args)
          setNoticeFull({
            text: `已展开自定义命令 /${custom.command.name}，作为任务发送…`,
            tone: 'info',
          })
          startTurn(expanded)
          return
        }
        void handleCommand(value)
        return
      }
      startTurn(value)
    },
    [props.customCommands, startTurn],
  )

  const runUpdate = useCallback(
    (checkOnly: boolean): void => {
      const runner = props.updateRunner
      if (!runner) {
        setNotice('当前环境未接入更新通道；请退出后运行 `spark update`。')
        return
      }
      if (updateRunning) {
        setNotice('已有一个更新任务在进行，请等待其完成。')
        return
      }
      if (activeTurns > 0) {
        setNotice('turn 运行中；请先中断或等待完成，再检查更新。')
        return
      }
      setUpdateCheckOnly(checkOnly)
      setUpdateRunning(true)
      setNoticeFull({
        text: checkOnly ? '正在检查更新…' : '正在更新 Spark，下载校验约需一会儿…',
        tone: 'info',
      })
      void runner
        .run({ checkOnly })
        .then((result) => {
          const outcome = describeUpdateOutcome(result.exitCode, checkOnly, result.output)
          setNoticeFull({ text: outcome.lines.join('\n'), tone: outcome.tone })
        })
        .catch((error: unknown) => {
          const detail = error instanceof Error ? error.message : String(error)
          setNoticeFull({ text: `更新失败：${detail}`, tone: 'error' })
        })
        .finally(() => {
          setUpdateRunning(false)
        })
    },
    [activeTurns, props.updateRunner, setNotice, updateRunning],
  )

  const handleCommand = async (raw: string): Promise<void> => {
    const [command] = raw.trim().split(/\s+/, 1)
    switch (command) {
      case '/help': {
        const custom = props.customCommands ?? []
        const customText =
          custom.length === 0
            ? ''
            : `\n自定义命令：${custom.map((command) => `/${command.name}${command.description === '' ? '' : ` ${command.description}`}`).join(' · ')}`
        setNoticeFull({ text: helpDetail() + customText, tone: 'info' })
        break
      }
      case '/status':
        setNotice(
          `session=${session.sessionId} · queued=${session.queuedTurns()} · events=${events.length}` +
            ` · 模型=${effectiveModel ?? '未配置'} · 权限=${permissionMode} · 推理=${reasoningEffort}`,
        )
        break
      case '/model':
        if (!modelRuntime) {
          setNotice(`当前模型: ${props.model ?? 'unconfigured'}（静态模式，未接入切换器）`)
          break
        }
        if (activeTurns > 0) {
          setNotice('当前 turn 仍在运行；模型在 turn 结束前保持不变，请稍后再切换。')
          break
        }
        setConfigFormOpen(false)
        modelRuntime.openPicker()
        break
      case '/perm':
        if (activeTurns > 0) {
          setNotice('turn 运行中；权限策略将在下一个 turn 生效，请稍后切换。')
          break
        }
        setPermPickerOpen(true)
        break
      case '/effort':
        if (activeTurns > 0) {
          setNotice('turn 运行中；推理强度在下一个 turn 生效。')
          break
        }
        setEffortPickerOpen(true)
        break
      case '/update': {
        const argument = raw.trim().split(/\s+/)[1]
        if (argument !== undefined && argument !== '--check' && argument !== 'check') {
          setNotice('用法：/update 或 /update --check')
          break
        }
        runUpdate(argument !== undefined)
        break
      }
      case '/clear': {
        if (activeTurns > 0) {
          setNotice('当前仍有 turn 运行；请先中断或等待完成，再开启新会话。')
          break
        }
        const next = await props.createSession()
        const initial: AgentEvent[] = []
        for await (const event of next.events()) initial.push(event)
        setSession(next)
        setEvents(initial)
        setNotice(`已开启新会话 ${next.sessionId}`)
        break
      }
      case '/sessions': {
        if (props.openSession === undefined || props.listSessions === undefined) {
          setNotice('当前环境未启用会话切换。')
          break
        }
        if (activeTurns > 0) {
          setNotice('当前仍有 turn 运行；请先中断或等待完成，再切换会话。')
          break
        }
        const found = await props.listSessions().catch(() => undefined)
        if (found === undefined) {
          setNotice('读取会话列表失败。')
          break
        }
        setSessions(found)
        setSessionPickerOpen(true)
        break
      }
      case '/exit':
      case '/quit':
        exit()
        break
      default:
        setNotice(`未知命令: ${command ?? raw} · 输入 /help 查看命令`)
    }
  }

  const interrupt = useCallback(() => {
    const controller = controllers.current[0]
    if (controller) controller.abort('User interrupted')
  }, [])

  /** Switch the live session to a recorded one and replay its transcript. */
  const pickSession = useCallback(
    async (sessionId: string): Promise<void> => {
      if (props.openSession === undefined) return
      try {
        const next = await props.openSession(sessionId)
        const initial: AgentEvent[] = []
        for await (const event of next.events()) initial.push(event)
        setSessionPickerOpen(false)
        setSession(next)
        setEvents(initial)
        setNotice(`已切换到会话 ${shortSessionId(sessionId)}`)
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        setNotice(`切换会话失败: ${detail}`)
      }
    },
    [props.openSession, setNotice],
  )

  const controlC = useCallback(() => {
    if (activeTurns > 0) {
      interrupt()
      return
    }
    if (exitArmed) {
      exit()
      return
    }
    setExitArmed(true)
    setNotice('再按一次 Ctrl+C 退出')
    if (exitTimer.current) clearTimeout(exitTimer.current)
    exitTimer.current = setTimeout(() => {
      setExitArmed(false)
    }, 1_000)
  }, [activeTurns, exit, exitArmed, interrupt])

  const decide = useCallback(
    (decision: PermissionDecision) => {
      if (pending) props.approver.decide(pending.request.requestId, decision)
    },
    [pending, props.approver],
  )

  const projection = useMemo(() => projectTranscript(events, capabilities), [capabilities, events])
  const action = deriveAction(events, liveText, liveThinking, pending)
  const perfText = formatPerf(lastStepPerf(events) ?? { tokensPerSec: 0, ttftMs: 0 })
  const empty = projection.settled.length === 0 && liveText === '' && liveThinking === ''

  const applyPermissionMode = useCallback(
    (mode: PermissionMode) => {
      session.setPermissionMode(mode)
      setPermissionModeState(mode)
      setPermPickerOpen(false)
      setNoticeFull({
        text:
          mode === 'bypass'
            ? '危险：完全访问已启用（仅本会话），审批与规则全部跳过。'
            : mode === 'auto'
              ? '已切换到自动审批：工具自动执行（显式 deny 规则仍生效）。'
              : `权限策略已切换为 ${permissionLabel(mode)}（本会话生效）。`,
        tone: mode === 'bypass' ? 'warn' : 'info',
      })
    },
    [session],
  )

  // Shift+Tab walks the safe modes only; arming bypass stays behind /perm's
  // explicit double confirm so one stray keypress can never go unreviewed.
  const cyclePermission = useCallback(() => {
    if (activeTurns > 0) {
      setNotice('turn 运行中；权限策略将在下一个 turn 生效，请稍后再切换。')
      return
    }
    applyPermissionMode(nextPermissionMode(permissionMode))
  }, [activeTurns, applyPermissionMode, permissionMode, setNotice])

  return (
    <Box flexDirection="column">
      {empty && !pickerOpen && (
        <WelcomeBox
          version={props.version ?? SPARK_ENGINE_VERSION}
          model={visibleModelName}
          capabilities={capabilities}
          theme={theme}
        />
      )}
      {/* Remount on resize (reflow) and session switch: ink <Static> counts
          flushed rows by position, so a swapped row list would otherwise be
          silently skipped when the new session has a shorter/equal transcript. */}
      <Transcript key={`${resizeVersion}-${session.sessionId}`} rows={projection.settled} theme={theme} capabilities={capabilities} />
      {showThinking && liveThinking && <Text color={theme.dim}>▍ {liveThinking}</Text>}
      {liveText && <Text>{liveText}</Text>}
      <ActiveTools tools={projection.activeTools} capabilities={capabilities} theme={theme} />
      {activeTurns > 0 && (
        <WorkingLine
          label={action}
          detail={`esc 中断${session.queuedTurns() > 0 ? ` · +${session.queuedTurns()} 排队` : ''}`}
          capabilities={capabilities}
          theme={theme}
        />
      )}
      {pending && (
        <PermissionCard
          pending={pending}
          theme={theme}
          onDecide={decide}
          onNotice={(message) => {
            setNotice(message)
          }}
        />
      )}
      {permPickerOpen && !pending && (
        <PermissionPicker
          theme={theme}
          current={permissionMode}
          onPick={applyPermissionMode}
          onClose={() => {
            setPermPickerOpen(false)
          }}
          onNotice={(message) => {
            setNotice(message)
          }}
        />
      )}
      {effortPickerOpen && !pending && !permPickerOpen && (
        <EffortPicker
          theme={theme}
          current={reasoningEffort}
          onPick={(effort) => {
            setReasoningEffort(effort)
            setEffortPickerOpen(false)
            setNotice(`推理强度: ${effort}（对下一个 turn 生效）`)
          }}
          onClose={() => {
            setEffortPickerOpen(false)
          }}
        />
      )}
      {sessionPickerOpen && !pending && !permPickerOpen && (
        <SessionPicker
          theme={theme}
          sessions={sessions}
          currentSessionId={session.sessionId}
          onPick={(sessionId) => {
            void pickSession(sessionId)
          }}
          onClose={() => {
            setSessionPickerOpen(false)
          }}
        />
      )}
      {pickerOpen && modelRuntime && !configFormOpen && (
        <ModelPicker
          catalog={modelRuntime.catalog}
          refreshing={modelRuntime.refreshing}
          busy={modelRuntime.busy}
          notice={modelRuntime.notice ?? modelRuntime.startupError}
          error={modelRuntime.error}
          selectedModel={effectiveModel}
          theme={theme}
          canClose={effectiveModel !== undefined}
          onSelect={(modelId) => {
            void modelRuntime.select(modelId)
          }}
          onConfigureLocal={() => {
            setConfigFormOpen(true)
          }}
          onRefresh={() => {
            void modelRuntime.refresh()
          }}
          onClose={() => {
            modelRuntime.closePicker()
          }}
          onExit={exit}
        />
      )}
      {pickerOpen && modelRuntime && configFormOpen && (
        <ProviderConfigForm
          theme={theme}
          error={modelRuntime.error}
          onCancel={() => {
            setConfigFormOpen(false)
          }}
          onExit={exit}
          onSubmit={(draft) => {
            void modelRuntime.configureLocal(draft).then((ok) => {
              if (ok) setConfigFormOpen(false)
            })
          }}
        />
      )}
      {updateRunning && (
        <WorkingLine
          label={updateCheckOnly ? '正在检查更新' : '正在更新 Spark'}
          detail="连接发布通道，下载并校验安装包"
          capabilities={capabilities}
          theme={theme}
        />
      )}
      {notice && (
        <Text color={noticeColor(theme, notice.tone)}>{notice.text}</Text>
      )}
      <InputEditor
        active={!pickerOpen}
        locked={pending !== undefined || pickerOpen || permPickerOpen || effortPickerOpen || sessionPickerOpen}
        running={activeTurns > 0}
        capabilities={capabilities}
        theme={theme}
        extraCommands={(props.customCommands ?? []).map((command) => ({
          name: `/${command.name}`,
          ...(command.description === '' ? {} : { summary: command.description }),
        }))}
        onSubmit={submit}
        onEscape={interrupt}
        onControlC={controlC}
        onCyclePermission={cyclePermission}
        onToggleThinking={() => {
          setShowThinking((visible) => !visible)
        }}
      />
      {/* Status bar: bare values only — model, permission, effort, perf, cwd. */}
      <Box gap={2} flexWrap="wrap">
        <Text color={theme.accent}>{visibleModelName ?? '未选择模型'}</Text>
        <Text color={permissionMode === 'bypass' ? theme.warn : theme.dim}>
          {permissionMode}
        </Text>
        <Text color={theme.ok}>{reasoningEffort}</Text>
        {perfText && <Text color={theme.dim}>{perfText}</Text>}
        {formatCwd(props.cwd) && <Text color={theme.dim}>{formatCwd(props.cwd)}</Text>}
        <Text color={theme.dim}>/help</Text>
      </Box>
    </Box>
  )
}

function deriveAction(
  events: readonly AgentEvent[],
  liveText: string,
  liveThinking: string,
  pending: PendingApproval | undefined,
): string {
  if (pending) return '等待权限确认'
  if (liveText) return '生成回答'
  if (liveThinking) return '正在思考'
  const latest = events.at(-1)
  if (latest?.type === 'tool.intent') return `运行工具 ${latest.callId}`
  if (latest?.type === 'step.started') return '请求模型'
  return '处理中'
}
