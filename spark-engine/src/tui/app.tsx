import { Box, Text, useApp } from 'ink'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'

import type { AgentEvent } from '../events/schema.js'
import type { LlmDelta, ReasoningEffort } from '../llm/types.js'
import type { InteractiveApprover, PendingApproval } from '../permission/interactive.js'
import type { PermissionDecision, PermissionMode } from '../permission/types.js'
import type { AgentSession } from '../sdk/agent.js'
import { SPARK_ENGINE_VERSION } from '../version.js'
import { PermissionCard } from './components/permission-card.js'
import { PERMISSION_MODES, PermissionPicker, nextPermissionMode } from './components/permission-picker.js'
import { ActiveTools, Transcript } from './components/rows.js'
import { InputEditor } from './components/input-editor.js'
import { PlanApprovalCard } from './components/plan-card.js'
import { WorkingLine } from './components/spinner.js'
import { WelcomeBox } from './components/welcome.js'
import { ModelPicker, ProviderConfigForm } from './model-flow.js'
import { cycleEffort, effortLabel, helpDetail } from './slash-commands.js'
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
}

interface NoticeState {
  readonly text: string
  readonly tone: UpdateOutcomeTone | 'warn'
}

function permissionLabel(mode: PermissionMode): string {
  return PERMISSION_MODES.find((entry) => entry.mode === mode)?.label ?? mode
}

function noticeColor(theme: TuiTheme, tone: NoticeState['tone']): string {
  if (tone === 'ok') return theme.ok
  if (tone === 'error') return theme.error
  if (tone === 'info') return theme.dim
  return theme.warn
}

export function SparkTuiApp(props: SparkTuiAppProps): ReactElement {
  const { exit } = useApp()
  const capabilities = props.capabilities ?? detectTerminalCapabilities()
  const theme = props.theme ?? defaultTheme
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
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort | undefined>(
    props.reasoningEffort,
  )
  const [permissionMode, setPermissionModeState] = useState<PermissionMode>(
    props.permissionMode ?? props.initialSession.permissionMode,
  )
  const [updateRunning, setUpdateRunning] = useState(false)
  const [updateCheckOnly, setUpdateCheckOnly] = useState(false)
  /** Non-empty after a plan-mode turn produced a plan awaiting approval. */
  const [planProposal, setPlanProposal] = useState<string | undefined>(undefined)
  const controllers = useRef<AbortController[]>([])
  const exitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => props.approver.subscribe(setPending), [props.approver])
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
  const pickerOpen = modelRuntime?.open === true

  const handleDelta = useCallback((delta: LlmDelta) => {
    if (delta.type === 'text') setLiveText((current) => current + delta.text)
    else if (delta.type === 'thinking') setLiveThinking((current) => current + delta.text)
  }, [])

  const submit = useCallback(
    (value: string) => {
      if (value.startsWith('/')) {
        void handleCommand(value)
        return
      }
      if (effectiveModel === undefined) {
        modelRuntime?.openPicker('先选择或配置一个模型，再开始任务')
        return
      }
      const controller = new AbortController()
      controllers.current.push(controller)
      setActiveTurns((count) => count + 1)
      setNoticeFull(undefined)
      setPlanProposal(undefined)
      void session
        .turn(value, {
          signal: controller.signal,
          ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
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
      case '/help':
        setNoticeFull({ text: helpDetail(), tone: 'info' })
        break
      case '/status':
        setNotice(
          `session=${session.sessionId} · queued=${session.queuedTurns()} · events=${events.length}` +
            ` · 模型=${effectiveModel ?? '未配置'} · 权限=${permissionMode} · 推理=${effortLabel(reasoningEffort)}`,
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
      case '/effort': {
        if (activeTurns > 0) {
          setNotice('turn 运行中；推理强度在下一个 turn 生效。')
          break
        }
        const next = cycleEffort(reasoningEffort)
        setReasoningEffort(next)
        setNotice(`推理强度: ${effortLabel(next)}（对下一个 turn 生效）`)
        break
      }
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
  const metrics = useMemo(() => deriveMetrics(events), [events])
  const action = deriveAction(events, liveText, liveThinking, pending)
  const empty = projection.settled.length === 0 && liveText === '' && liveThinking === ''
  const lastAssistantText = useMemo(() => {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      if (event?.type === 'assistant.completed' && (event.message.text ?? '').trim()) {
        return event.message.text ?? ''
      }
    }
    return undefined
  }, [events])

  // Plan-mode approval flow: when a plan turn settles while still in plan
  // mode, surface its proposal for approve/iterate instead of silently ending.
  const prevActiveTurns = useRef(0)
  useEffect(() => {
    const wasRunning = prevActiveTurns.current > 0
    prevActiveTurns.current = activeTurns
    if (wasRunning && activeTurns === 0 && permissionMode === 'plan' && lastAssistantText) {
      setPlanProposal(lastAssistantText)
    }
  }, [activeTurns, lastAssistantText, permissionMode])

  const applyPermissionMode = useCallback(
    (mode: PermissionMode) => {
      session.setPermissionMode(mode)
      setPermissionModeState(mode)
      setPermPickerOpen(false)
      setPlanProposal(undefined)
      setNoticeFull({
        text:
          mode === 'plan'
            ? '已切换到计划模式：只读探索，产出计划后会询问是否执行。'
            : mode === 'bypass'
              ? '危险：权限绕过已启用（仅本会话），工具将不经审批执行。'
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

  const approvePlan = useCallback(() => {
    setPlanProposal(undefined)
    applyPermissionMode('acceptEdits')
    submit('请严格按照上面的计划开始执行；逐步使用可用工具完成任务。')
    // submit depends on this callback through the editor only; calling it here
    // re-enters the same stable closure captured for the card's lifetime.
  }, [applyPermissionMode, submit])

  return (
    <Box flexDirection="column">
      {empty && !pickerOpen && (
        <WelcomeBox
          version={props.version ?? SPARK_ENGINE_VERSION}
          model={effectiveModel}
          cwd={session.cwd}
          capabilities={capabilities}
          theme={theme}
        />
      )}
      <Transcript rows={projection.settled} theme={theme} />
      {showThinking && liveThinking && <Text color={theme.dim}>▍ {liveThinking}</Text>}
      {liveText && <Text>{liveText}</Text>}
      <ActiveTools tools={projection.activeTools} capabilities={capabilities} theme={theme} />
      {activeTurns > 0 && (
        <WorkingLine
          label={action}
          detail={`step ${metrics.steps} · ${metrics.tokens} tok${session.queuedTurns() > 0 ? ` · +${session.queuedTurns()} 排队` : ''} · esc 中断`}
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
      {planProposal !== undefined && !permPickerOpen && !pending && (
        <PlanApprovalCard
          proposal={planProposal}
          theme={theme}
          onApprove={approvePlan}
          onDismiss={() => {
            setPlanProposal(undefined)
            setNotice('已留在计划模式；继续讨论或输入 /perm 切换策略。')
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
        locked={pending !== undefined || pickerOpen || permPickerOpen || planProposal !== undefined}
        running={activeTurns > 0}
        capabilities={capabilities}
        theme={theme}
        onSubmit={submit}
        onEscape={interrupt}
        onControlC={controlC}
        onCyclePermission={cyclePermission}
        onToggleThinking={() => {
          setShowThinking((visible) => !visible)
        }}
      />
      <Box gap={2} flexWrap="wrap">
        <Text color={theme.accent}>{effectiveModel ?? '未选择模型'}</Text>
        <Text color={permissionMode === 'plan' ? theme.ok : theme.dim}>权限:{permissionMode}</Text>
        <Text color={reasoningEffort === undefined ? theme.dim : theme.ok}>
          推理:{effortLabel(reasoningEffort)}
        </Text>
        <Text color={theme.dim}>
          {metrics.tokens} tok · ${metrics.costUsd.toFixed(4)} · /help
        </Text>
      </Box>
    </Box>
  )
}

function deriveMetrics(events: readonly AgentEvent[]): {
  readonly steps: number
  readonly tokens: number
  readonly costUsd: number
} {
  let steps = 0
  let tokens = 0
  let costUsd = 0
  for (const event of events) {
    if (event.type === 'step.started') steps += 1
    else if (event.type === 'assistant.completed') {
      tokens += event.usage.inputTokens + event.usage.outputTokens
    } else if (event.type === 'turn.completed') costUsd += event.stats.costUsd
  }
  return { steps, tokens, costUsd }
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
