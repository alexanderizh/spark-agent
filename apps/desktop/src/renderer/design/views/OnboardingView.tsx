import { EXPERIENCE_CASES, OnboardingBanner, OnboardingProgress } from './OnboardingExperience'
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Button,
  Input as LobeInput,
  InputPassword,
  Select as LobeSelect,
  TextArea as LobeTextArea,
} from '@lobehub/ui'
import './OnboardingView.less'
import './OnboardingExperience.less'
import { useApp } from '../AppContext'
import { useAuth } from '../auth/AuthContext'
import { AuthGate } from '../auth/AuthGate'
import { useIpcInvoke } from '../hooks/useIpc'
import { useSessionSidebar } from '../SessionSidebarContext'
import { useToast } from '../components/Toast'
import { filterProvidersForVisibleUi } from '../utils/auto-router-ui'
import { ProviderLogo } from '../components/ProviderLogo'
import { ProviderPromoBanner } from '../components/ProviderPromoBanner'
import { Icons } from '../Icons'
import { OnboardingPlatformFunding } from './platform-model/OnboardingPlatformFunding'
import {
  getVendorMeta,
  PROVIDER_PRESETS,
  LOCAL_CLI_PROVIDER_ID,
  LOCAL_CODEX_CLI_PROVIDER_ID,
  isLocalClaudeCliProvider,
  isLocalCodexCliProvider,
} from '@spark/protocol'
import type {
  ManagedAgent,
  ProviderProfile,
  SessionAgentAdapter,
  SessionPermissionMode,
} from '@spark/protocol'
import { writeOnboardingState } from './onboarding-state'
export { clearOnboardingState, shouldShowOnboardingAsync } from './onboarding-state'

export type OnboardingStep =
  | 'welcome'
  | 'model-source'
  | 'spark-account'
  | 'third-party-provider'
  | 'local-cli'
  | 'connection-test'
  | 'agent-template'
  | 'first-session'
  | 'workflows-guide'
  | 'canvas-guide'
  | 'media-guide'
  | 'done'
type ModelSource = 'spark-account' | 'third-party-provider' | 'local-cli'
type UseCaseId = 'daily' | 'document' | 'work' | 'developer'
type TemplateId = 'general' | 'document' | 'work' | 'developer'

type LocalCliKind = 'claude' | 'codex'

type OnboardingState = {
  step: OnboardingStep
  useCase: UseCaseId | null
  modelSource: ModelSource | null
  providerProfileId: string | null
  modelId: string | null
  agentId: string | null
  templateId: TemplateId
  firstPrompt: string
  /** 走「本机 AI 工具」分支时记录的目标 adapter / 权限；非空表示走本机 CLI 路径 */
  localAdapter: SessionAgentAdapter | null
  localPermissionMode: SessionPermissionMode | null
  localCliKind: LocalCliKind | null
}

type Action =
  | { type: 'set-step'; step: OnboardingStep }
  | { type: 'back' }
  | { type: 'set-use-case'; useCase: UseCaseId; templateId: TemplateId }
  | { type: 'set-model-source'; modelSource: ModelSource; step: OnboardingStep }
  | { type: 'set-provider'; providerProfileId: string; modelId: string }
  | { type: 'set-local-cli'; kind: LocalCliKind; providerProfileId: string; modelId: string }
  | { type: 'set-agent'; agentId: string }
  | { type: 'set-template'; templateId: TemplateId }
  | { type: 'set-first-prompt'; firstPrompt: string }

const initialState: OnboardingState = {
  step: 'welcome',
  useCase: 'daily',
  modelSource: null,
  providerProfileId: null,
  modelId: null,
  agentId: null,
  templateId: 'general',
  firstPrompt: '帮我写一段简短的工作总结，语气自然、清楚。',
  localAdapter: null,
  localPermissionMode: null,
  localCliKind: null,
}

function reducer(state: OnboardingState, action: Action): OnboardingState {
  switch (action.type) {
    case 'back':
      return { ...state, step: previousStep(state) }
    case 'set-step':
      return { ...state, step: action.step }
    case 'set-use-case':
      return {
        ...state,
        agentId: state.useCase === action.useCase ? state.agentId : null,
        useCase: action.useCase,
        templateId: action.templateId,
        firstPrompt:
          state.useCase === action.useCase
            ? state.firstPrompt
            : {
                general: '帮我写一封简洁、友好的邮件，同步本周工作进展。',
                document: '帮我设计一份阅读笔记模板，包含核心观点、关键证据和待确认的问题。',
                work: '帮我制定本周工作计划，按优先级拆解并预留复盘时间。',
                developer: '帮我梳理新项目的启动清单，包含目标、技术选型和第一阶段任务。',
              }[action.templateId],
      }
    case 'set-model-source':
      return {
        ...state,
        modelSource: action.modelSource,
        step: action.step,
        agentId: null,
        providerProfileId: null,
        modelId: null,
        localAdapter: null,
        localPermissionMode: null,
        localCliKind: null,
      }
    case 'set-provider':
      return {
        ...state,
        providerProfileId: action.providerProfileId,
        modelId: action.modelId,
        step: 'connection-test',
      }
    case 'set-local-cli': {
      const adapter: SessionAgentAdapter = action.kind === 'codex' ? 'codex' : 'claude-sdk'
      const permissionMode: SessionPermissionMode =
        action.kind === 'codex' ? 'codex-default' : 'claude-auto-edits'
      return {
        ...state,
        providerProfileId: action.providerProfileId,
        modelId: action.modelId,
        localAdapter: adapter,
        localPermissionMode: permissionMode,
        localCliKind: action.kind,
        step: 'connection-test',
      }
    }
    case 'set-agent':
      return { ...state, agentId: action.agentId }
    case 'set-template':
      return { ...state, templateId: action.templateId, agentId: null }
    case 'set-first-prompt':
      return { ...state, firstPrompt: action.firstPrompt }
    default:
      return state
  }
}

function previousStep(state: OnboardingState): OnboardingStep {
  if (state.step === 'welcome') return 'welcome'
  if (state.step === 'model-source') return 'welcome'
  if (
    state.step === 'spark-account' ||
    state.step === 'third-party-provider' ||
    state.step === 'local-cli'
  )
    return 'model-source'
  if (state.step === 'connection-test') {
    return state.modelSource ?? 'model-source'
  }
  if (state.step === 'agent-template') return 'model-source'
  if (state.step === 'first-session') return 'model-source'
  if (state.step === 'workflows-guide') return 'first-session'
  if (state.step === 'canvas-guide') return 'workflows-guide'
  if (state.step === 'media-guide') return 'canvas-guide'
  if (state.step === 'done') return 'media-guide'
  return 'first-session'
}

const templates: Record<
  TemplateId,
  {
    title: string
    name: string
    desc: string
    prompt: string
    permissionMode: SessionPermissionMode
    adapter: SessionAgentAdapter
  }
> = {
  general: {
    title: '通用助手',
    name: '我的通用助手',
    desc: '适合日常问答、写作、总结和信息整理。',
    permissionMode: 'claude-auto-edits',
    adapter: 'claude-sdk',
    prompt:
      '你是一个耐心、清楚、适合非技术用户的 AI 助手。回答时先给结论，再给步骤。避免使用不必要的技术术语；如果必须使用，请用生活化例子解释。',
  },
  document: {
    title: '文档助手',
    name: '我的文档助手',
    desc: '适合阅读、总结、改写和整理资料。',
    permissionMode: 'claude-auto-edits',
    adapter: 'claude-sdk',
    prompt:
      '你是一个文档整理助手。帮助用户阅读、总结、提炼重点、改写文本，并用简明标题和清晰条目输出。用户不是技术人员时，避免技术行话。',
  },
  work: {
    title: '工作助理',
    name: '我的工作助理',
    desc: '适合计划、待办、复盘和工作沟通。',
    permissionMode: 'claude-auto-edits',
    adapter: 'claude-sdk',
    prompt:
      '你是一个可靠的工作助理。帮助用户拆解任务、制定计划、整理待办、起草沟通内容。输出要可执行、简短、清楚。',
  },
  developer: {
    title: '开发助手',
    name: '我的开发助手',
    desc: '适合代码、项目、自动化与工程任务。',
    permissionMode: 'claude-auto-edits',
    adapter: 'claude-sdk',
    prompt:
      '你是一个严谨的开发助手。帮助用户理解项目、修改代码、解释技术方案。遇到风险时先说明影响，再执行。',
  },
}

const providerPresets = PROVIDER_PRESETS.filter(
  (preset) =>
    preset.provider === 'anthropic' &&
    preset.modelType !== 'image' &&
    preset.modelType !== 'voice' &&
    preset.modelType !== 'video',
)

const defaultProviderPreset =
  providerPresets.find((p) => p.id === 'deepseek-api-anthropic') ??
  providerPresets[0] ??
  PROVIDER_PRESETS[0]!

const firstPrompts = [
  '帮我写一段简短的工作总结，语气自然、清楚。',
  '请把这段话整理得更清楚，并列出重点。',
  '帮我规划今天的 3 个重要任务，并给出执行顺序。',
]

function getActiveStepIndex(step: OnboardingStep): number {
  if (step === 'welcome') return 0
  if (
    [
      'model-source',
      'spark-account',
      'third-party-provider',
      'local-cli',
      'connection-test',
    ].includes(step)
  )
    return 1
  return 2
}

function completeOnboarding(): void {
  // 完成（用户走完所有步骤，或主动点"进入会话/跳过讲解"）：
  // dismissed 清空，标记为 completed。
  writeOnboardingState({ completed: true, dismissed: false })
}

function dismissOnboarding(): void {
  // 跳过（"稍后再说" / 中途离开）：completed 也置为 true（不再自动弹），
  // dismissed 同时置为 true 用于区分两种语义。
  writeOnboardingState({ completed: true, dismissed: true })
}

export function OnboardingView(): React.ReactElement {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [providerPresetId, setProviderPresetIdState] = useState(defaultProviderPreset.id)
  const [apiKey, setApiKey] = useState('')
  const [customEndpoint, setCustomEndpoint] = useState(defaultProviderPreset.apiEndpoint)
  const [customModel, setCustomModel] = useState(defaultProviderPreset.defaultModel)
  const [fetchedProviderModelIds, setFetchedProviderModelIds] = useState<string[]>([])
  const [fetchingProviderModels, setFetchingProviderModels] = useState(false)
  const [connectionTestOutput, setConnectionTestOutput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setErrorMessage] = useState('')
  const [errorStep, setErrorStep] = useState<OnboardingStep | null>(null)
  const { setTweak } = useApp()
  const auth = useAuth()
  const sessionCtx = useSessionSidebar()
  const { toast } = useToast()
  const { invoke: createProvider } = useIpcInvoke('provider:create')
  const { invoke: listProviders } = useIpcInvoke('provider:list')
  const { invoke: fetchProviderModels } = useIpcInvoke('provider:fetch-models')
  const { invoke: createAgent } = useIpcInvoke('agent:create')
  const { invoke: sendTurn } = useIpcInvoke('session:submit-turn')
  const { invoke: healthCheck } = useIpcInvoke('provider:health-check')

  const setProviderPresetId = useCallback((id: string) => {
    setProviderPresetIdState(id)
    const preset = providerPresets.find((item) => item.id === id) ?? defaultProviderPreset
    setCustomModel(preset.defaultModel)
    setCustomEndpoint(preset.apiEndpoint)
    setFetchedProviderModelIds([])
  }, [])

  const setError = useCallback(
    (message: string) => {
      setErrorMessage(message)
      setErrorStep(message ? state.step : null)
    },
    [state.step],
  )

  // finishedRef: 标记用户是否已"主动结束"引导（点了稍后再说 / 跳过讲解 / 进入会话）。
  // 所有主动结束路径都经过下面的 goChat()，所以把 set 放进 goChat 即可覆盖全部。
  // cleanup effect 据此判断要不要把"中途关窗"当成 dismiss —— 避免读存储层（localStorage
  // 已不再被 complete/dismiss 写入，主进程值是异步的，都不能用作同步判定源）。
  const finishedRef = useRef(false)

  const goChat = useCallback(() => {
    finishedRef.current = true
    setTweak('view', 'chat')
  }, [setTweak])

  const skip = useCallback(() => {
    dismissOnboarding()
    toast.info('已跳过新手引导，可稍后从设置中重新打开。')
    goChat()
  }, [goChat, toast])

  const handleFetchProviderModels = useCallback(async () => {
    const preset =
      providerPresets.find((item) => item.id === providerPresetId) ?? defaultProviderPreset
    const key = apiKey.trim()
    if (!key) {
      setError('获取模型列表需要先填写 API Key。')
      return
    }

    setFetchingProviderModels(true)
    setError('')
    try {
      const endpoint = customEndpoint.trim() || preset.apiEndpoint
      const result = await fetchProviderModels({
        provider: preset.provider,
        apiEndpoint: endpoint || null,
        apiKey: key,
      })
      const ids = Array.from(
        new Set(
          result.models.map((model) => model.id.trim()).filter((id): id is string => id.length > 0),
        ),
      )
      setFetchedProviderModelIds(ids)
      if (ids.length === 0) {
        setError('没有获取到可用模型，请检查服务商地址或稍后重试。')
        return
      }
      toast.success(`已获取 ${ids.length} 个模型，可在模型 ID 中选择。`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(`获取模型失败：${message}`)
    } finally {
      setFetchingProviderModels(false)
    }
  }, [apiKey, customEndpoint, fetchProviderModels, providerPresetId, setError, toast])

  // 用户在引导页关闭窗口 / 刷新时，若尚未主动结束引导，视为跳过 —
  // 否则下次启动还会再次自动打开。
  //
  // 只在浏览器 beforeunload 事件里 dismiss，**不在 React cleanup 里 dismiss**：
  // React 的 cleanup 在生产环境会在主动结束时触发（finishedRef 已拦截），
  // 但在 dev 模式 StrictMode 下会双调用 mount→unmount→mount，第一次 unmount
  // 的 cleanup 会把主进程误标记为 dismissed（参见 ChatView.tsx 同类陷阱的注释）。
  // beforeunload 只在窗口真正关闭/刷新时触发，是"用户离开"的可靠信号。
  useEffect(() => {
    const handleBeforeUnload = (): void => {
      if (finishedRef.current) return
      dismissOnboarding()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [])

  const handleCreateProvider = useCallback(async () => {
    const preset =
      providerPresets.find((item) => item.id === providerPresetId) ?? defaultProviderPreset
    const model = customModel.trim() || preset.defaultModel
    const endpoint = customEndpoint.trim() || preset.apiEndpoint
    const key = apiKey.trim()
    if (!key) {
      setError('请粘贴模型服务商提供的密钥。')
      return
    }
    setBusy(true)
    setError('')
    try {
      const res = await createProvider({
        name: `${preset.name} · 新手引导`,
        provider: preset.provider,
        defaultModel: model,
        modelIds: Array.from(new Set([model, ...preset.modelIds])),
        apiEndpoint: endpoint || undefined,
        apiKey: key,
        isDefault: true,
        modelType: preset.modelType ?? 'multimodal',
      } as Parameters<typeof createProvider>[0])
      const profile = (res as { profile: ProviderProfile }).profile
      dispatch({ type: 'set-provider', providerProfileId: profile.id, modelId: model })
      setConnectionTestOutput('正在发送“你好”测试模型连接…')
      try {
        const test = await healthCheck({ id: profile.id })
        setConnectionTestOutput(
          test.healthy
            ? `测试通过：模型已响应。${test.latencyMs != null ? `延迟 ${test.latencyMs}ms。` : ''}`
            : '测试未通过：Provider 返回不健康状态，请返回检查配置。',
        )
      } catch (testErr) {
        setConnectionTestOutput(
          `测试失败：${testErr instanceof Error ? testErr.message : String(testErr)}`,
        )
      }
      toast.success('模型连接信息已保存。')
      void sessionCtx.refreshData()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(`保存失败：${message}`)
    } finally {
      setBusy(false)
    }
  }, [
    apiKey,
    createProvider,
    customEndpoint,
    customModel,
    healthCheck,
    providerPresetId,
    setError,
    sessionCtx,
    toast,
  ])

  const handleSelectLocalCli = useCallback(
    async (kind: LocalCliKind) => {
      const providerId = kind === 'codex' ? LOCAL_CODEX_CLI_PROVIDER_ID : LOCAL_CLI_PROVIDER_ID
      const label = kind === 'codex' ? 'Codex' : 'Claude Code'
      setBusy(true)
      setError('')
      setConnectionTestOutput(`正在检测本机 ${label} …`)
      try {
        // listProviders 已会过滤掉不可用的本地 CLI provider；
        // 若返回结果里能看到对应 id，说明宿主机真的装了该 CLI。
        const res = await listProviders({})
        const profiles = res.profiles as ProviderProfile[]
        const profile = profiles.find((p) => p.id === providerId)
        if (!profile) {
          throw new Error(
            `未检测到本机 ${label}。请先安装${kind === 'codex' ? ' Codex CLI' : ' Claude Code'}（${
              kind === 'codex' ? 'npm i -g @openai/codex' : 'npm i -g @anthropic-ai/claude-code'
            }）并完成一次登录。`,
          )
        }
        // 二次确认：本地 CLI 的 healthCheck 就是检查可执行文件存在，无副作用。
        const test = await healthCheck({ id: profile.id })
        if (!test.healthy) {
          throw new Error(test.errorMessage || `本机 ${label} 不可用`)
        }
        dispatch({
          type: 'set-local-cli',
          kind,
          providerProfileId: profile.id,
          modelId: profile.defaultModel,
        })
        setConnectionTestOutput(
          `已检测到本机 ${label}，可直接复用你已登录的凭证，无需填写 API Key。`,
        )
        toast.success(`已连接本机 ${label}。`)
        void sessionCtx.refreshData()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
        setConnectionTestOutput('')
      } finally {
        setBusy(false)
      }
    },
    [healthCheck, listProviders, sessionCtx, setError, toast],
  )

  const handleCreateAgent = useCallback(async () => {
    const template = templates[state.templateId]
    setBusy(true)
    setError('')
    try {
      let providerId = state.providerProfileId
      let modelId = state.modelId
      if (!providerId) {
        const providers = await listProviders({})
        const profile = filterProvidersForVisibleUi(providers.profiles as ProviderProfile[])[0]
        providerId = profile?.id ?? null
        modelId = modelId ?? profile?.defaultModel ?? null
      }
      const res = await createAgent({
        name: template.name,
        description: template.desc,
        enabled: true,
        isDefault: true,
        providerProfileId: providerId,
        modelId,
        // 本机 CLI 路径必须按 CLI 种类覆盖 adapter / 权限：Codex 走 codex adapter +
        // codex-default；Claude Code 走 claude-sdk。模板默认值只适用于第三方 API 路径。
        agentAdapter: state.localAdapter ?? template.adapter,
        permissionMode: state.localPermissionMode ?? template.permissionMode,
        reasoningEffort: 'medium',
        prompt: template.prompt,
        metadata: {
          source: 'onboarding',
          templateId: state.templateId,
          ...(state.localCliKind != null ? { localCliKind: state.localCliKind } : {}),
        },
      })
      const agent = (res as { agent: ManagedAgent }).agent
      dispatch({ type: 'set-agent', agentId: agent.id })
      void sessionCtx.refreshData()
      return agent.id
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(`创建助手失败：${message}`)
    } finally {
      setBusy(false)
    }
  }, [
    createAgent,
    listProviders,
    sessionCtx,
    state.localAdapter,
    state.localCliKind,
    state.localPermissionMode,
    state.modelId,
    state.providerProfileId,
    state.templateId,
    setError,
    toast,
  ])

  const handleStartFirstSession = useCallback(async () => {
    const prompt = state.firstPrompt.trim()
    if (!prompt) {
      setError('请先输入或选择一句想让助手完成的话。')
      return
    }
    setBusy(true)
    setError('')
    try {
      const agentId = state.agentId ?? (await handleCreateAgent())
      if (!agentId) return
      setBusy(true)
      const sessionId = await sessionCtx.handleNewSession(null, {
        agentId,
        providerProfileId: state.providerProfileId ?? undefined,
        modelId: state.modelId ?? undefined,
      })
      if (!sessionId) throw new Error('没有可用的模型配置，请先完成模型连接。')
      await sendTurn({ sessionId, message: prompt })
      toast.success('第一次会话已创建。')
      completeOnboarding()
      goChat()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(`发送失败：${message}`)
    } finally {
      setBusy(false)
    }
  }, [
    sendTurn,
    handleCreateAgent,
    goChat,
    sessionCtx,
    state.agentId,
    state.firstPrompt,
    state.modelId,
    state.providerProfileId,
    setError,
    toast,
  ])

  return (
    <div className="onboarding-shell experience-shell" data-use={state.useCase}>
      {/* 引导页自带透明拖拽条（拖拽移动窗口 / 双击最大化）：
          不复用 MacWindowDragHeader，避免其底色在页面背景上形成异色头部；
          透明背景让氛围光晕与页面背景自然透出。 */}
      <div
        className="onboarding-drag-strip"
        aria-hidden="true"
        onDoubleClick={() => {
          window.spark?.invoke('window:maximize', {}).catch(() => {})
        }}
      />
      <OnboardingBanner useCase={state.useCase} />

      <main className="onboarding-main">
        <section className="onboarding-card">
          <div className="onboarding-copy">
            <OnboardingProgress phase={getActiveStepIndex(state.step)} />
            <div className="experience-navigation">
              <button
                type="button"
                disabled={busy || state.step === 'welcome'}
                onClick={() => dispatch({ type: 'back' })}
              >
                <Icons.ArrowLeft size={14} /> 上一步
              </button>
              <button type="button" disabled={busy} onClick={skip}>
                稍后再说
              </button>
            </div>
            <AnimatePresence mode="wait">
              <motion.div
                key={state.step}
                className="onboarding-copy-inner"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
              >
                {state.step === 'welcome' && (
                  <WelcomeStep dispatch={dispatch} useCase={state.useCase} />
                )}
                {state.step === 'model-source' && <ModelSourceStep dispatch={dispatch} />}
                {state.step === 'spark-account' && (
                  <SparkAccountStep
                    isAuthenticated={auth.isAuthenticated}
                    account={auth.user?.account ?? auth.user?.nickname ?? ''}
                    dispatch={dispatch}
                  />
                )}
                {state.step === 'local-cli' && (
                  <LocalCliStep dispatch={dispatch} onSelect={handleSelectLocalCli} busy={busy} />
                )}
                {state.step === 'third-party-provider' && (
                  <ProviderStep
                    providerPresetId={providerPresetId}
                    setProviderPresetId={setProviderPresetId}
                    apiKey={apiKey}
                    setApiKey={(value) => {
                      setApiKey(value)
                      setFetchedProviderModelIds([])
                    }}
                    customEndpoint={customEndpoint}
                    setCustomEndpoint={(value) => {
                      setCustomEndpoint(value)
                      setFetchedProviderModelIds([])
                    }}
                    customModel={customModel}
                    setCustomModel={setCustomModel}
                    fetchedModelIds={fetchedProviderModelIds}
                    onFetchModels={handleFetchProviderModels}
                    fetchingModels={fetchingProviderModels}
                    onSubmit={handleCreateProvider}
                    busy={busy}
                    dispatch={dispatch}
                  />
                )}
                {state.step === 'connection-test' && (
                  <ConnectionTestStep output={connectionTestOutput} dispatch={dispatch} />
                )}
                {(state.step === 'agent-template' || state.step === 'first-session') && (
                  <FirstSessionStep
                    prompt={state.firstPrompt}
                    templateId={state.templateId}
                    dispatch={dispatch}
                    onSubmit={handleStartFirstSession}
                    onSkip={skip}
                    busy={busy}
                  />
                )}
                {state.step === 'workflows-guide' && (
                  <WorkflowsGuideStep dispatch={dispatch} onFinish={goChat} />
                )}
                {state.step === 'canvas-guide' && (
                  <CanvasGuideStep dispatch={dispatch} onFinish={goChat} />
                )}
                {state.step === 'media-guide' && (
                  <MediaGuideStep dispatch={dispatch} onFinish={goChat} />
                )}
                {state.step === 'done' && <DoneStep onDone={goChat} />}
                {error && errorStep === state.step && (
                  <div className="onboarding-error">{error}</div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </section>
      </main>
    </div>
  )
}

function WelcomeStep({
  dispatch,
  useCase,
}: {
  dispatch: React.Dispatch<Action>
  useCase: UseCaseId | null
}) {
  return (
    <>
      <h1>你想先做些什么？</h1>
      <p className="lead">选一个最贴近你的场景，我们为你准备一个好的开始。</p>
      <div className="experience-choices">
        {EXPERIENCE_CASES.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={useCase === item.id}
            className="experience-choice"
            onClick={() =>
              dispatch({ type: 'set-use-case', useCase: item.id, templateId: item.templateId })
            }
          >
            <span className="experience-icon">
              <item.icon size={21} strokeWidth={1.7} />
            </span>
            <strong>{item.title}</strong>
            <small>{item.desc}</small>
            {useCase === item.id && (
              <span className="experience-check" aria-hidden="true">
                <Icons.Check size={12} />
              </span>
            )}
          </button>
        ))}
      </div>
      <p className="experience-hint">随时可以尝试其他用途，这不会限制你的助手。</p>
      <div className="button-row experience-continue">
        <Button type="primary" onClick={() => dispatch({ type: 'set-step', step: 'model-source' })}>
          继续 <Icons.ArrowRight size={16} />
        </Button>
      </div>
    </>
  )
}

/**
 * 「跳过本步」按钮 —— 把 set-step: target 的样板代码收敛到一个地方。
 * 大部分 onboarding 子步骤都允许用户跳过配置直接进入下一步，
 * 用这个组件避免在 7+ 处重复 onClick 写 dispatch({ type: 'set-step', ... })。
 */
function SkipStepButton({
  dispatch,
  target,
  label = '跳过本步',
}: {
  dispatch: React.Dispatch<Action>
  target: OnboardingStep
  label?: string
}) {
  return <Button onClick={() => dispatch({ type: 'set-step', step: target })}>{label}</Button>
}

function ModelSourceStep({ dispatch }: { dispatch: React.Dispatch<Action> }) {
  return (
    <>
      <h1>选择你的 AI 模型</h1>
      <p className="lead">
        推荐使用已有的第三方模型 API Key，也可以登录 Spark 账号或连接本机工具。
      </p>
      <div className="experience-choices source-options">
        <div className="experience-choice source-choice-primary">
          <span className="experience-icon">
            <Icons.Server size={21} strokeWidth={1.7} />
          </span>
          <div className="source-primary-copy">
            <div className="source-primary-title">
              <strong>第三方模型</strong>
              <em>推荐</em>
            </div>
            <span>使用已有 API Key，密钥只保存在本机</span>
          </div>
          <Button
            type="primary"
            onClick={() =>
              dispatch({
                type: 'set-model-source',
                modelSource: 'third-party-provider',
                step: 'third-party-provider',
              })
            }
          >
            填写 API Key
          </Button>
        </div>
        <button
          type="button"
          className="experience-choice source-choice"
          onClick={() =>
            dispatch({
              type: 'set-model-source',
              modelSource: 'spark-account',
              step: 'spark-account',
            })
          }
        >
          <span className="experience-icon">
            <Icons.User size={21} strokeWidth={1.7} />
          </span>
          <strong>Spark 账号</strong>
          <small>登录即可使用，无需配置</small>
          <span className="source-choice-arrow" aria-hidden="true">
            <Icons.ArrowRight size={16} strokeWidth={1.7} />
          </span>
        </button>
        <button
          type="button"
          className="experience-choice source-choice"
          onClick={() =>
            dispatch({ type: 'set-model-source', modelSource: 'local-cli', step: 'local-cli' })
          }
        >
          <span className="experience-icon">
            <Icons.Terminal size={21} strokeWidth={1.7} />
          </span>
          <strong>本机 AI 工具</strong>
          <small>连接 Claude Code 或 Codex</small>
          <span className="source-choice-arrow" aria-hidden="true">
            <Icons.ArrowRight size={16} strokeWidth={1.7} />
          </span>
        </button>
      </div>
      <button
        type="button"
        className="source-skip"
        onClick={() => dispatch({ type: 'set-step', step: 'agent-template' })}
      >
        暂时跳过
      </button>
    </>
  )
}

function SparkAccountStep({
  isAuthenticated,
  account,
  dispatch,
}: {
  isAuthenticated: boolean
  account: string
  dispatch: React.Dispatch<Action>
}) {
  return (
    <>
      <h1>使用 Spark 平台模型</h1>
      <p className="lead">
        不必申请或配置 API Key。平台模型作为一个可选 Provider，与你的第三方模型配置并存。
      </p>
      {!isAuthenticated ? (
        <div className="onboarding-auth-embed">
          <AuthGate variant="embed" />
        </div>
      ) : (
        <OnboardingPlatformFunding
          account={account}
          onContinue={() => dispatch({ type: 'set-step', step: 'agent-template' })}
        />
      )}
      {!isAuthenticated ? (
        <div className="button-row">
          <SkipStepButton dispatch={dispatch} target="agent-template" />
        </div>
      ) : null}
    </>
  )
}

type LocalCliStatus = 'checking' | 'available' | 'unavailable'

type LocalCliOption = {
  kind: LocalCliKind
  title: string
  desc: string
  installHint: string
}

const LOCAL_CLI_OPTIONS: Array<LocalCliOption> = [
  {
    kind: 'claude',
    title: 'Claude Code（本机）',
    desc: '复用宿主机已登录的 Claude Code。',
    installHint: '未检测到，可运行 npm i -g @anthropic-ai/claude-code 安装。',
  },
  {
    kind: 'codex',
    title: 'Codex（本机）',
    desc: '复用宿主机已登录的 Codex CLI。',
    installHint: '未检测到，可运行 npm i -g @openai/codex 安装。',
  },
]

function LocalCliStep({
  dispatch,
  onSelect,
  busy,
}: {
  dispatch: React.Dispatch<Action>
  onSelect: (kind: LocalCliKind) => void | Promise<void>
  busy: boolean
}) {
  const { invoke: listProviders } = useIpcInvoke('provider:list')
  const [status, setStatus] = useState<Record<LocalCliKind, LocalCliStatus>>({
    claude: 'checking',
    codex: 'checking',
  })

  const detect = useCallback(async () => {
    try {
      const res = await listProviders({})
      const profiles = res.profiles as ProviderProfile[]
      setStatus({
        claude: profiles.some(isLocalClaudeCliProvider) ? 'available' : 'unavailable',
        codex: profiles.some(isLocalCodexCliProvider) ? 'available' : 'unavailable',
      })
    } catch {
      setStatus({ claude: 'unavailable', codex: 'unavailable' })
    }
  }, [listProviders])

  const handleRedetect = useCallback(() => {
    // 点击「重新检测」时先把状态重置回 checking，再发起探测。
    setStatus({ claude: 'checking', codex: 'checking' })
    void detect()
  }, [detect])

  useEffect(() => {
    // 挂载时探测本机 CLI 可用性；detect 内部 setState，沿用仓库内同类 mount-time fetch 的约定。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void detect()
  }, [detect])

  const anyAvailable = status.claude === 'available' || status.codex === 'available'

  return (
    <>
      <h1>连接本机的 Claude Code 或 Codex</h1>
      <p className="lead">
        选中后会直接复用你本机已登录的 Claude Code / Codex 配置，不需要再填写 API Key。
        如果两个都还没装，可以改用第三方模型路径。
      </p>
      <div className="source-list">
        {LOCAL_CLI_OPTIONS.map((option) => {
          const current = status[option.kind]
          return (
            <button
              key={option.kind}
              type="button"
              className={`source-card local-cli-card ${
                option.kind === 'claude' ? 'accent-amber' : 'accent-blue'
              }`}
              disabled={busy || current !== 'available'}
              onClick={() => onSelect(option.kind)}
            >
              <Icons.Terminal size={21} strokeWidth={1.7} />
              <div>
                <strong>{option.title}</strong>
                <span>
                  {current === 'checking'
                    ? '正在检测本机是否已安装…'
                    : current === 'available'
                      ? option.desc
                      : option.installHint}
                </span>
              </div>
              {current === 'checking' ? (
                <em className="local-cli-badge checking">检测中</em>
              ) : current === 'available' ? (
                <em className="local-cli-badge ok">可用</em>
              ) : (
                <em className="local-cli-badge no">未安装</em>
              )}
            </button>
          )
        })}
      </div>
      <div className="button-row">
        <Button onClick={handleRedetect} disabled={busy}>
          重新检测
        </Button>
        <SkipStepButton dispatch={dispatch} target="agent-template" />
        {!anyAvailable && (
          <Button
            type="primary"
            onClick={() =>
              dispatch({
                type: 'set-model-source',
                modelSource: 'third-party-provider',
                step: 'third-party-provider',
              })
            }
          >
            改用第三方模型
          </Button>
        )}
      </div>
    </>
  )
}

function ProviderStep(props: {
  providerPresetId: string
  setProviderPresetId: (id: string) => void
  apiKey: string
  setApiKey: (v: string) => void
  customEndpoint: string
  setCustomEndpoint: (v: string) => void
  customModel: string
  setCustomModel: (v: string) => void
  fetchedModelIds: string[]
  onFetchModels: () => void
  fetchingModels: boolean
  onSubmit: () => void
  busy: boolean
  dispatch?: React.Dispatch<Action>
}) {
  return (
    <>
      <h1>填写你的模型服务信息</h1>
      <p className="lead">
        “密钥”就是模型服务商给你的使用凭证。SparkWork 会把它安全保存在你的电脑里。
      </p>
      <ProviderPromoBanner
        className="onboarding-promo-banner"
        onSelectPreset={props.setProviderPresetId}
      />
      <div className="onboarding-form">
        <label>
          <span className="onboarding-field-head">
            服务商
            <small className="onboarding-field-hint">已内置接口地址与默认模型</small>
          </span>
          <LobeSelect
            value={props.providerPresetId}
            onChange={(value) => props.setProviderPresetId(String(value))}
            options={providerPresets.map((p) => ({
              label: (
                <span className="provider-select-option">
                  <ProviderLogo
                    vendor={getVendorMeta(p.vendorId) ?? null}
                    size={24}
                    shape="rounded"
                  />
                  <span>
                    <strong>{p.name}</strong>
                    <small>{p.defaultModel}</small>
                  </span>
                </span>
              ),
              value: p.id,
            }))}
          />
          {/* 渠道简介取自 VendorMeta.desc，未知渠道不渲染，避免占位空白 */}
          {(() => {
            const preset = providerPresets.find((p) => p.id === props.providerPresetId)
            const desc = preset ? getVendorMeta(preset.vendorId)?.desc : undefined
            return desc ? <small className="onboarding-field-hint">{desc}</small> : null
          })()}
        </label>
        <label>
          <span className="onboarding-field-head">
            密钥
            {(() => {
              // 仅已知渠道（VendorMeta.apiKeyUrl）显示「获取密钥」快捷入口，未知渠道不渲染
              const preset = providerPresets.find((p) => p.id === props.providerPresetId)
              const apiKeyUrl = preset ? getVendorMeta(preset.vendorId)?.apiKeyUrl : undefined
              return apiKeyUrl ? (
                <a
                  className="onboarding-apikey-link"
                  href={apiKeyUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={`前往 ${apiKeyUrl} 获取密钥`}
                >
                  获取密钥
                  <Icons.ExternalLink size={11} />
                </a>
              ) : null
            })()}
          </span>
          <InputPassword
            value={props.apiKey}
            onChange={(e) => props.setApiKey(e.target.value)}
            placeholder="粘贴 API Key"
          />
          <small className="onboarding-field-hint">
            只保存在本机，不会上传到任何服务器
          </small>
        </label>
        <label>
          <span className="onboarding-field-head">
            模型 ID
            <small className="onboarding-field-hint">点右侧按钮可从服务商读取可用模型</small>
          </span>
          <div className="provider-model-row">
            {props.fetchedModelIds.length > 0 ? (
              <LobeSelect
                showSearch
                value={props.customModel || undefined}
                onChange={(value) => props.setCustomModel(String(value))}
                placeholder="选择模型"
                options={props.fetchedModelIds.map((id) => ({ label: id, value: id }))}
              />
            ) : (
              <LobeInput
                value={props.customModel}
                onChange={(e) => props.setCustomModel(e.target.value)}
                placeholder="填写 Model ID"
              />
            )}
            <Button
              type="default"
              onClick={props.onFetchModels}
              loading={props.fetchingModels}
              disabled={props.busy}
            >
              {props.fetchedModelIds.length > 0 ? '重新获取' : '获取模型'}
            </Button>
          </div>
        </label>
        <label>
          API URL
          <LobeInput
            value={props.customEndpoint}
            onChange={(e) => props.setCustomEndpoint(e.target.value)}
            placeholder="默认可留空"
          />
          <small className="onboarding-field-hint">
            仅在使用自建或代理接口时填写，需兼容 OpenAI 接口格式
          </small>
        </label>
      </div>
      <div className="button-row">
        {props.dispatch && <SkipStepButton dispatch={props.dispatch} target="agent-template" />}
        <Button type="primary" size="middle" onClick={props.onSubmit} loading={props.busy}>
          {props.busy ? '正在测试并保存…' : '测试并保存'}
        </Button>
      </div>
    </>
  )
}

function FirstSessionStep({
  templateId,
  onSkip,
  prompt,
  dispatch,
  onSubmit,
  busy,
}: {
  prompt: string
  templateId: TemplateId
  onSkip: () => void
  dispatch: React.Dispatch<Action>
  onSubmit: () => void
  busy: boolean
}) {
  return (
    <>
      <h1>从第一件小事开始。</h1>
      <p className="experience-assistant">已为你匹配：{templates[templateId].title}</p>
      <details className="experience-template-options">
        <summary>调整助手类型</summary>
        <div className="choice-grid templates">
          {Object.entries(templates).map(([id, item]) => (
            <button
              type="button"
              key={id}
              disabled={busy}
              aria-pressed={templateId === id}
              className={`choice-card ${templateId === id ? 'selected' : ''}`}
              onClick={() => dispatch({ type: 'set-template', templateId: id as TemplateId })}
            >
              {item.title}
            </button>
          ))}
        </div>
      </details>
      <p className="lead">修改下面的内容，开始你的第一项任务。发送成功后将进入工作台。</p>
      <div className="prompt-list">
        {firstPrompts.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => dispatch({ type: 'set-first-prompt', firstPrompt: item })}
          >
            {item}
          </button>
        ))}
      </div>
      <LobeTextArea
        value={prompt}
        onChange={(e) => dispatch({ type: 'set-first-prompt', firstPrompt: e.target.value })}
        rows={4}
        aria-label="第一项任务"
        disabled={busy}
      />
      <div className="button-row">
        <Button disabled={busy} onClick={onSkip}>
          稍后开始，进入工作台
        </Button>
        <Button
          disabled={busy}
          onClick={() => dispatch({ type: 'set-step', step: 'workflows-guide' })}
        >
          了解更多功能
        </Button>
        <Button type="primary" onClick={onSubmit} loading={busy}>
          {busy ? '正在发送…' : '开始第一项任务'}
        </Button>
      </div>
    </>
  )
}

function finishGuide(onFinish: () => void) {
  completeOnboarding()
  onFinish()
}

function CanvasGuideStep({
  dispatch,
  onFinish,
}: {
  dispatch: React.Dispatch<Action>
  onFinish: () => void
}) {
  return (
    <>
      <h1>画布是你的多媒体创作工作台</h1>
      <p className="lead">
        画布是按"项目"组织的多媒体创作空间，把剧本、角色、场景、分镜、参考图、提示词和生成结果都摆在一张可平移、可缩放的画布上。它不是聊天窗口的延伸，而是真正动手做东西的地方。
      </p>
      <div className="guide-panel">
        <div className="guide-item">
          <Icons.Film size={22} />
          <div>
            <strong>多模态节点 + 创作链路</strong>
            <span>
              文本、图片、视频、音频、镜头都能作为节点摆放，节点之间用线串起"先有剧本 → 再做分镜 →
              跑图生视频"的创作链路。
            </span>
          </div>
        </div>
        <div className="guide-item">
          <Icons.Folder size={22} />
          <div>
            <strong>按项目组织，不会丢</strong>
            <span>
              每个画布对应一个项目，角色设定、首帧、迭代版本都在画布里保留，跨会话也能继续。
            </span>
          </div>
        </div>
        <div className="guide-item">
          <Icons.Image size={22} />
          <div>
            <strong>生成结果直接回写画布</strong>
            <span>图片、视频、语音的产出自动落成新节点，AI 操作在画布上跑，过程清楚可见。</span>
          </div>
        </div>
      </div>
      <div className="button-row">
        <Button onClick={() => finishGuide(onFinish)}>跳过讲解，进入会话</Button>
        <Button type="primary" onClick={() => dispatch({ type: 'set-step', step: 'media-guide' })}>
          继续了解多媒体模型
        </Button>
      </div>
    </>
  )
}

function MediaGuideStep({
  dispatch,
  onFinish,
}: {
  dispatch: React.Dispatch<Action>
  onFinish: () => void
}) {
  return (
    <>
      <h1>图片、视频、语音也可以进入对话</h1>
      <p className="lead">
        当你配置的服务商支持多媒体模型时，SparkWork
        会按模型类型组织能力。你可以在对话里描述要生成的画面，也可以把参考素材带进画布继续加工。
      </p>
      <div className="guide-panel">
        <div className="guide-item">
          <Icons.Image size={22} />
          <div>
            <strong>参考素材要说清楚</strong>
            <span>例如“用这张图做首帧”“保持角色一致”“生成 16:9 封面”。</span>
          </div>
        </div>
        <div className="guide-item">
          <Icons.Play size={22} />
          <div>
            <strong>生成结果可继续迭代</strong>
            <span>把图片或视频结果放回上下文，继续改提示词、做分镜或转成下一步素材。</span>
          </div>
        </div>
      </div>
      <div className="button-row">
        <Button onClick={() => finishGuide(onFinish)}>跳过讲解，进入会话</Button>
        <Button onClick={() => dispatch({ type: 'set-step', step: 'canvas-guide' })}>
          返回画布
        </Button>
        <Button
          type="primary"
          onClick={() => {
            completeOnboarding()
            dispatch({ type: 'set-step', step: 'done' })
          }}
        >
          完成引导
        </Button>
      </div>
    </>
  )
}

function WorkflowsGuideStep({
  dispatch,
  onFinish,
}: {
  dispatch: React.Dispatch<Action>
  onFinish: () => void
}) {
  return (
    <>
      <h1>把多步任务编排成工作流</h1>
      <p className="lead">
        工作流是一张节点 + 边的 DAG 图：把"先做 A、再做 B、最后做 C"这种多步任务可视化、可复用。
        适合可重复、可追溯的复杂流程。
      </p>
      <div className="guide-panel">
        <div className="guide-item">
          <Icons.Workflow size={22} />
          <div>
            <strong>节点 + 边的图编辑器</strong>
            <span>
              节点代表一个步骤（Agent
              调用、Skill、工具、条件分支），用边表示执行顺序；中间面板负责调参。
            </span>
          </div>
        </div>
        <div className="guide-item">
          <Icons.Brain size={22} />
          <div>
            <strong>绑定到 Agent 自动跑</strong>
            <span>
              把工作流绑定到某个助手，Agent
              收到匹配任务时会按流程自动跑完所有节点，结果回写到原位置。
            </span>
          </div>
        </div>
        <div className="guide-item">
          <Icons.Branch size={22} />
          <div>
            <strong>模板、版本与还原点</strong>
            <span>
              可保存为模板复用；如果工作流里的代码步骤跑偏，能结合代码还原点回到上一个稳定状态后继续推进。
            </span>
          </div>
        </div>
      </div>
      <div className="button-row">
        <Button onClick={() => finishGuide(onFinish)}>跳过讲解，进入会话</Button>
        <Button onClick={() => dispatch({ type: 'set-step', step: 'first-session' })}>
          返回第一项任务
        </Button>
        <Button type="primary" onClick={() => dispatch({ type: 'set-step', step: 'canvas-guide' })}>
          继续了解画布
        </Button>
      </div>
    </>
  )
}

function ConnectionTestStep({
  output,
  dispatch,
}: {
  output: string
  dispatch: React.Dispatch<Action>
}) {
  return (
    <>
      <h1>已用"你好"测试模型</h1>
      <p className="lead">下面是本次模型连接测试结果。若失败，可以返回重新选择方案或修改密钥。</p>
      <pre className="test-output">{output || '等待测试结果…'}</pre>
      <div className="button-row">
        <Button onClick={() => dispatch({ type: 'back' })}>返回修改模型</Button>
        <SkipStepButton dispatch={dispatch} target="agent-template" />
        <Button
          type="primary"
          onClick={() => dispatch({ type: 'set-step', step: 'agent-template' })}
        >
          继续
        </Button>
      </div>
    </>
  )
}

function DoneStep({ onDone }: { onDone: () => void }) {
  return (
    <>
      <h1>设置完成！</h1>
      <p className="lead">以后你可以直接从左侧新建会话开始使用，也可以继续添加更多模型和助手。</p>
      <div className="guide-panel">
        <div className="guide-item">
          <Icons.Terminal size={22} />
          <div>
            <strong>运行环境缺失？交给 Agent</strong>
            <span>
              使用某些能力时可能会提示缺少 Python、Node.js 等运行环境——不必手动折腾，直接让 Agent
              帮你安装配置即可，装好就能继续用。
            </span>
          </div>
        </div>
      </div>
      <Button
        type="primary"
        onClick={() => {
          completeOnboarding()
          onDone()
        }}
      >
        进入会话
      </Button>
    </>
  )
}
