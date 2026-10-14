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
import { ProviderLogo } from '../components/ProviderLogo'
import { ProviderPromoBanner } from '../components/ProviderPromoBanner'
import { Icons } from '../Icons'
import { useI18n, type TranslateFn } from '../i18n'
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

function createInitialState(t: TranslateFn): OnboardingState {
  return {
    step: 'welcome',
    useCase: 'daily',
    modelSource: null,
    providerProfileId: null,
    modelId: null,
    agentId: null,
    templateId: 'general',
    firstPrompt: t('onboarding.firstPrompt.summary'),
    localAdapter: null,
    localPermissionMode: null,
    localCliKind: null,
  }
}

function reducer(state: OnboardingState, action: Action, t: TranslateFn): OnboardingState {
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
                general: t('onboarding.useCasePrompt.general'),
                document: t('onboarding.useCasePrompt.document'),
                work: t('onboarding.useCasePrompt.work'),
                developer: t('onboarding.useCasePrompt.developer'),
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

type AssistantTemplate = {
  title: string
  name: string
  desc: string
  prompt: string
  permissionMode: SessionPermissionMode
  adapter: SessionAgentAdapter
}

/** 助手模板按当前语言生成（模块级常量无法随语言切换更新，故改为函数）。 */
function getTemplates(t: TranslateFn): Record<TemplateId, AssistantTemplate> {
  return {
    general: {
      title: t('onboarding.template.generalTitle'),
      name: t('onboarding.template.generalName'),
      desc: t('onboarding.template.generalDesc'),
      permissionMode: 'claude-auto-edits',
      adapter: 'claude-sdk',
      prompt: t('onboarding.template.generalPrompt'),
    },
    document: {
      title: t('onboarding.template.documentTitle'),
      name: t('onboarding.template.documentName'),
      desc: t('onboarding.template.documentDesc'),
      permissionMode: 'claude-auto-edits',
      adapter: 'claude-sdk',
      prompt: t('onboarding.template.documentPrompt'),
    },
    work: {
      title: t('onboarding.template.workTitle'),
      name: t('onboarding.template.workName'),
      desc: t('onboarding.template.workDesc'),
      permissionMode: 'claude-auto-edits',
      adapter: 'claude-sdk',
      prompt: t('onboarding.template.workPrompt'),
    },
    developer: {
      title: t('onboarding.template.developerTitle'),
      name: t('onboarding.template.developerName'),
      desc: t('onboarding.template.developerDesc'),
      permissionMode: 'claude-auto-edits',
      adapter: 'claude-sdk',
      prompt: t('onboarding.template.developerPrompt'),
    },
  }
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

function getFirstPrompts(t: TranslateFn): string[] {
  return [
    t('onboarding.firstPrompt.summary'),
    t('onboarding.firstPrompt.cleanup'),
    t('onboarding.firstPrompt.plan'),
  ]
}

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
  const { t } = useI18n()
  // reducer 需要 t 来本地化「由用例派生的示例提示词」；包装后语义不变。
  const reducerWithT = useCallback(
    (prev: OnboardingState, action: Action) => reducer(prev, action, t),
    [t],
  )
  const [state, dispatch] = useReducer(reducerWithT, t, createInitialState)
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
  const { invoke: updateProvider } = useIpcInvoke('provider:update')
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
    toast.info(t('onboarding.skipToast'))
    goChat()
  }, [goChat, toast, t])

  const handleFetchProviderModels = useCallback(async () => {
    const preset =
      providerPresets.find((item) => item.id === providerPresetId) ?? defaultProviderPreset
    const key = apiKey.trim()
    if (!key) {
      setError(t('onboarding.fetchModelsNoKey'))
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
        setError(t('onboarding.fetchModelsEmpty'))
        return
      }
      toast.success(t('onboarding.fetchModelsSuccess', { count: ids.length }))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(t('onboarding.fetchModelsFailed', { message }))
    } finally {
      setFetchingProviderModels(false)
    }
  }, [apiKey, customEndpoint, fetchProviderModels, providerPresetId, setError, toast, t])

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
      setError(t('onboarding.providerApiKeyRequired'))
      return
    }
    setBusy(true)
    setError('')
    try {
      const res = await createProvider({
        name: t('onboarding.providerDefaultName', { name: preset.name }),
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
      setConnectionTestOutput(t('onboarding.providerTesting'))
      try {
        const test = await healthCheck({ id: profile.id })
        setConnectionTestOutput(
          test.healthy
            ? t('onboarding.providerTestOk', {
                latency:
                  test.latencyMs != null
                    ? t('onboarding.providerTestLatency', { ms: test.latencyMs })
                    : '',
              })
            : t('onboarding.providerUnhealthyError'),
        )
      } catch (testErr) {
        setConnectionTestOutput(
          t('onboarding.providerTestFailed', {
            message: testErr instanceof Error ? testErr.message : String(testErr),
          }),
        )
      }
      toast.success(t('onboarding.providerSaved'))
      void sessionCtx.refreshData()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(t('onboarding.providerSaveFailed', { message }))
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
    t,
  ])

  const handleSelectLocalCli = useCallback(
    async (kind: LocalCliKind) => {
      const providerId = kind === 'codex' ? LOCAL_CODEX_CLI_PROVIDER_ID : LOCAL_CLI_PROVIDER_ID
      const label = kind === 'codex' ? 'Codex' : 'Claude Code'
      setBusy(true)
      setError('')
      setConnectionTestOutput(t('onboarding.localCliCheckingLabel', { label }))
      try {
        // 本地 CLI provider 的可见性由 listProviders 内的 CLI 可用性检测把关：
        // 能看到对应 id 就说明宿主机真的装了该 CLI。这里带 includeDisabled，
        // 避免用户曾在 Providers 界面禁用过该内置项时被误判为"未安装"。
        const res = await listProviders({ includeDisabled: true })
        const profiles = res.profiles as ProviderProfile[]
        const profile = profiles.find((p) => p.id === providerId)
        if (!profile) {
          throw new Error(
            t('onboarding.localCliNotFoundError', {
              label,
              cli: kind === 'codex' ? 'Codex CLI' : 'Claude Code',
              cmd: kind === 'codex' ? 'npm i -g @openai/codex' : 'npm i -g @anthropic-ai/claude-code',
            }),
          )
        }
        // 引导页里明确选择连接本机 CLI，等价于要求该内置 Provider 可用；
        // 若之前被禁用，这里重新启用，否则后续会话/模型选择器解析不到它。
        if (profile.enabled === false) {
          await updateProvider({ id: profile.id, enabled: true })
        }
        // 二次确认：本地 CLI 的 healthCheck 就是检查可执行文件存在，无副作用。
        const test = await healthCheck({ id: profile.id })
        if (!test.healthy) {
          throw new Error(test.errorMessage || t('onboarding.localCliUnavailableError', { label }))
        }
        dispatch({
          type: 'set-local-cli',
          kind,
          providerProfileId: profile.id,
          modelId: profile.defaultModel,
        })
        setConnectionTestOutput(t('onboarding.localCliConnectedDesc', { label }))
        toast.success(t('onboarding.localCliConnected', { label }))
        void sessionCtx.refreshData()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
        setConnectionTestOutput('')
      } finally {
        setBusy(false)
      }
    },
    [healthCheck, listProviders, sessionCtx, setError, toast, updateProvider, t],
  )

  const handleCreateAgent = useCallback(async () => {
    const template = getTemplates(t)[state.templateId]
    setBusy(true)
    setError('')
    try {
      let providerId = state.providerProfileId
      let modelId = state.modelId
      if (!providerId) {
        const providers = await listProviders({})
        const profile = (providers.profiles as ProviderProfile[])[0]
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
      setError(t('onboarding.createAgentFailed', { message }))
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
    t,
  ])

  const handleStartFirstSession = useCallback(async () => {
    const prompt = state.firstPrompt.trim()
    if (!prompt) {
      setError(t('onboarding.firstSessionNoPrompt'))
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
      if (!sessionId) throw new Error(t('onboarding.firstSessionNoModel'))
      // 用户聊天输入显式声明来源：auto-router 故障切换重派发仅对 'user' 轮次武装
      await sendTurn({ sessionId, message: prompt, turnSource: 'user' })
      toast.success(t('onboarding.firstSessionCreated'))
      completeOnboarding()
      goChat()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(t('onboarding.firstSessionFailed', { message }))
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
    t,
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
                <Icons.ArrowLeft size={14} /> {t('onboarding.backBtn')}
              </button>
              <button type="button" disabled={busy} onClick={skip}>
                {t('onboarding.laterBtn')}
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
  const { t } = useI18n()
  return (
    <>
      <h1>{t('onboarding.welcomeTitle')}</h1>
      <p className="lead">{t('onboarding.welcomeLead')}</p>
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
            <strong>{t(item.titleKey)}</strong>
            <small>{t(item.descKey)}</small>
            {useCase === item.id && (
              <span className="experience-check" aria-hidden="true">
                <Icons.Check size={12} />
              </span>
            )}
          </button>
        ))}
      </div>
      <p className="experience-hint">{t('onboarding.welcomeHint')}</p>
      <div className="button-row experience-continue">
        <Button type="primary" onClick={() => dispatch({ type: 'set-step', step: 'model-source' })}>
          {t('onboarding.continueBtn')} <Icons.ArrowRight size={16} />
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
  label,
}: {
  dispatch: React.Dispatch<Action>
  target: OnboardingStep
  label?: string
}) {
  const { t } = useI18n()
  return (
    <Button onClick={() => dispatch({ type: 'set-step', step: target })}>
      {label ?? t('onboarding.skipStepBtn')}
    </Button>
  )
}

function ModelSourceStep({ dispatch }: { dispatch: React.Dispatch<Action> }) {
  const { t } = useI18n()
  return (
    <>
      <h1>{t('onboarding.modelSourceTitle')}</h1>
      <p className="lead">{t('onboarding.modelSourceLead')}</p>
      <div className="experience-choices source-options">
        <div className="experience-choice source-choice-primary">
          <span className="experience-icon">
            <Icons.Server size={21} strokeWidth={1.7} />
          </span>
          <div className="source-primary-copy">
            <div className="source-primary-title">
              <strong>{t('onboarding.modelSourceThirdParty')}</strong>
              <em>{t('onboarding.modelSourceRecommended')}</em>
            </div>
            <span>{t('onboarding.modelSourceThirdPartyDesc')}</span>
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
            {t('onboarding.modelSourceThirdPartyBtn')}
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
          <strong>{t('onboarding.modelSourceSparkAccount')}</strong>
          <small>{t('onboarding.modelSourceSparkAccountDesc')}</small>
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
          <strong>{t('onboarding.modelSourceLocalCli')}</strong>
          <small>{t('onboarding.modelSourceLocalCliDesc')}</small>
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
        {t('onboarding.modelSourceSkipBtn')}
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
  const { t } = useI18n()
  return (
    <>
      <h1>{t('onboarding.sparkAccountTitle')}</h1>
      <p className="lead">{t('onboarding.sparkAccountLead')}</p>
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

function getLocalCliOptions(t: TranslateFn): Array<LocalCliOption> {
  return [
    {
      kind: 'claude',
      title: t('onboarding.localCliClaudeTitle'),
      desc: t('onboarding.localCliClaudeDesc'),
      installHint: t('onboarding.localCliClaudeHint'),
    },
    {
      kind: 'codex',
      title: t('onboarding.localCliCodexTitle'),
      desc: t('onboarding.localCliCodexDesc'),
      installHint: t('onboarding.localCliCodexHint'),
    },
  ]
}

function LocalCliStep({
  dispatch,
  onSelect,
  busy,
}: {
  dispatch: React.Dispatch<Action>
  onSelect: (kind: LocalCliKind) => void | Promise<void>
  busy: boolean
}) {
  const { t } = useI18n()
  const { invoke: listProviders } = useIpcInvoke('provider:list')
  const [status, setStatus] = useState<Record<LocalCliKind, LocalCliStatus>>({
    claude: 'checking',
    codex: 'checking',
  })

  const detect = useCallback(
    async (options: { forceRefresh?: boolean } = {}) => {
      try {
        // 检测语义是"CLI 是否安装"，不是"Provider 是否启用"：
        // - includeDisabled: 用户曾在 Providers 界面禁用过内置项时，不算"未安装"
        // - listProviders 内部仍会按 CLI 可用性过滤这两个内置 id，装了才会出现
        const res = await listProviders({
          includeDisabled: true,
          forceRefreshLocalCli: options.forceRefresh === true,
        })
        const profiles = res.profiles as ProviderProfile[]
        setStatus({
          claude: profiles.some(isLocalClaudeCliProvider) ? 'available' : 'unavailable',
          codex: profiles.some(isLocalCodexCliProvider) ? 'available' : 'unavailable',
        })
      } catch {
        setStatus({ claude: 'unavailable', codex: 'unavailable' })
      }
    },
    [listProviders],
  )

  const handleRedetect = useCallback(() => {
    // 点击「重新检测」时先把状态重置回 checking，再发起探测；
    // 强制绕过主进程 5 分钟可用性缓存，刚装完 CLI 也能立即检出。
    setStatus({ claude: 'checking', codex: 'checking' })
    void detect({ forceRefresh: true })
  }, [detect])

  useEffect(() => {
    // 挂载时探测本机 CLI 可用性；detect 内部 setState，沿用仓库内同类 mount-time fetch 的约定。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void detect()
  }, [detect])

  const anyAvailable = status.claude === 'available' || status.codex === 'available'

  return (
    <>
      <h1>{t('onboarding.localCliTitle')}</h1>
      <p className="lead">{t('onboarding.localCliLead')}</p>
      <div className="source-list">
        {getLocalCliOptions(t).map((option) => {
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
                    ? t('onboarding.localCliDetecting')
                    : current === 'available'
                      ? option.desc
                      : option.installHint}
                </span>
              </div>
              {current === 'checking' ? (
                <em className="local-cli-badge checking">{t('onboarding.localCliCheckingBadge')}</em>
              ) : current === 'available' ? (
                <em className="local-cli-badge ok">{t('onboarding.localCliAvailableBadge')}</em>
              ) : (
                <em className="local-cli-badge no">{t('onboarding.localCliUnavailableBadge')}</em>
              )}
            </button>
          )
        })}
      </div>
      <div className="button-row">
        <Button onClick={handleRedetect} disabled={busy}>
          {t('onboarding.localCliRecheckBtn')}
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
            {t('onboarding.localCliFallbackBtn')}
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
  const { t } = useI18n()
  return (
    <>
      <h1>{t('onboarding.providerTitle')}</h1>
      <p className="lead">{t('onboarding.providerLead')}</p>
      <ProviderPromoBanner
        className="onboarding-promo-banner"
        onSelectPreset={props.setProviderPresetId}
      />
      <div className="onboarding-form">
        <label>
          <span className="onboarding-field-head">
            {t('onboarding.providerVendorLabel')}
            <small className="onboarding-field-hint">{t('onboarding.providerVendorHint')}</small>
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
            {t('onboarding.providerKeyLabel')}
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
                  title={t('onboarding.providerGetKeyTitle', { url: apiKeyUrl })}
                >
                  {t('onboarding.providerGetKey')}
                  <Icons.ExternalLink size={11} />
                </a>
              ) : null
            })()}
          </span>
          <InputPassword
            value={props.apiKey}
            onChange={(e) => props.setApiKey(e.target.value)}
            placeholder={t('onboarding.providerKeyPlaceholder')}
          />
          <small className="onboarding-field-hint">{t('onboarding.providerKeyHint')}</small>
        </label>
        <label>
          <span className="onboarding-field-head">
            {t('onboarding.providerModelLabel')}
            <small className="onboarding-field-hint">{t('onboarding.providerModelHint')}</small>
          </span>
          <div className="provider-model-row">
            {props.fetchedModelIds.length > 0 ? (
              <LobeSelect
                showSearch
                value={props.customModel || undefined}
                onChange={(value) => props.setCustomModel(String(value))}
                placeholder={t('onboarding.providerModelSelectPlaceholder')}
                options={props.fetchedModelIds.map((id) => ({ label: id, value: id }))}
              />
            ) : (
              <LobeInput
                value={props.customModel}
                onChange={(e) => props.setCustomModel(e.target.value)}
                placeholder={t('onboarding.providerModelPlaceholder')}
              />
            )}
            <Button
              type="default"
              onClick={props.onFetchModels}
              loading={props.fetchingModels}
              disabled={props.busy}
            >
              {props.fetchedModelIds.length > 0
                ? t('onboarding.providerRefetchModelsBtn')
                : t('onboarding.providerFetchModelsBtn')}
            </Button>
          </div>
        </label>
        <label>
          {t('onboarding.providerUrlLabel')}
          <LobeInput
            value={props.customEndpoint}
            onChange={(e) => props.setCustomEndpoint(e.target.value)}
            placeholder={t('onboarding.providerUrlPlaceholder')}
          />
          <small className="onboarding-field-hint">{t('onboarding.providerUrlHint')}</small>
        </label>
      </div>
      <div className="button-row">
        {props.dispatch && <SkipStepButton dispatch={props.dispatch} target="agent-template" />}
        <Button type="primary" size="middle" onClick={props.onSubmit} loading={props.busy}>
          {props.busy ? t('onboarding.providerSubmittingBtn') : t('onboarding.providerSubmitBtn')}
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
  const { t } = useI18n()
  const templates = getTemplates(t)
  return (
    <>
      <h1>{t('onboarding.firstSessionTitle')}</h1>
      <p className="experience-assistant">
        {t('onboarding.firstSessionMatched', { name: templates[templateId].title })}
      </p>
      <details className="experience-template-options">
        <summary>{t('onboarding.firstSessionAdjust')}</summary>
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
      <p className="lead">{t('onboarding.firstSessionLead')}</p>
      <div className="prompt-list">
        {getFirstPrompts(t).map((item) => (
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
        aria-label={t('onboarding.firstSessionPromptAria')}
        disabled={busy}
      />
      <div className="button-row">
        <Button disabled={busy} onClick={onSkip}>
          {t('onboarding.firstSessionSkipBtn')}
        </Button>
        <Button
          disabled={busy}
          onClick={() => dispatch({ type: 'set-step', step: 'workflows-guide' })}
        >
          {t('onboarding.firstSessionMoreBtn')}
        </Button>
        <Button type="primary" onClick={onSubmit} loading={busy}>
          {busy ? t('onboarding.firstSessionSubmittingBtn') : t('onboarding.firstSessionSubmitBtn')}
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
  const { t } = useI18n()
  return (
    <>
      <h1>{t('onboarding.canvasGuideTitle')}</h1>
      <p className="lead">{t('onboarding.canvasGuideLead')}</p>
      <div className="guide-panel">
        <div className="guide-item">
          <Icons.Film size={22} />
          <div>
            <strong>{t('onboarding.canvasGuideItem1Title')}</strong>
            <span>{t('onboarding.canvasGuideItem1Desc')}</span>
          </div>
        </div>
        <div className="guide-item">
          <Icons.Folder size={22} />
          <div>
            <strong>{t('onboarding.canvasGuideItem2Title')}</strong>
            <span>{t('onboarding.canvasGuideItem2Desc')}</span>
          </div>
        </div>
        <div className="guide-item">
          <Icons.Image size={22} />
          <div>
            <strong>{t('onboarding.canvasGuideItem3Title')}</strong>
            <span>{t('onboarding.canvasGuideItem3Desc')}</span>
          </div>
        </div>
      </div>
      <div className="button-row">
        <Button onClick={() => finishGuide(onFinish)}>{t('onboarding.skipGuideBtn')}</Button>
        <Button type="primary" onClick={() => dispatch({ type: 'set-step', step: 'media-guide' })}>
          {t('onboarding.canvasGuideNextBtn')}
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
  const { t } = useI18n()
  return (
    <>
      <h1>{t('onboarding.mediaGuideTitle')}</h1>
      <p className="lead">{t('onboarding.mediaGuideLead')}</p>
      <div className="guide-panel">
        <div className="guide-item">
          <Icons.Image size={22} />
          <div>
            <strong>{t('onboarding.mediaGuideItem1Title')}</strong>
            <span>{t('onboarding.mediaGuideItem1Desc')}</span>
          </div>
        </div>
        <div className="guide-item">
          <Icons.Play size={22} />
          <div>
            <strong>{t('onboarding.mediaGuideItem2Title')}</strong>
            <span>{t('onboarding.mediaGuideItem2Desc')}</span>
          </div>
        </div>
      </div>
      <div className="button-row">
        <Button onClick={() => finishGuide(onFinish)}>{t('onboarding.skipGuideBtn')}</Button>
        <Button onClick={() => dispatch({ type: 'set-step', step: 'canvas-guide' })}>
          {t('onboarding.canvasGuideBackBtn')}
        </Button>
        <Button
          type="primary"
          onClick={() => {
            completeOnboarding()
            dispatch({ type: 'set-step', step: 'done' })
          }}
        >
          {t('onboarding.mediaGuideFinishBtn')}
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
  const { t } = useI18n()
  return (
    <>
      <h1>{t('onboarding.workflowsGuideTitle')}</h1>
      <p className="lead">{t('onboarding.workflowsGuideLead')}</p>
      <div className="guide-panel">
        <div className="guide-item">
          <Icons.Workflow size={22} />
          <div>
            <strong>{t('onboarding.workflowsGuideItem1Title')}</strong>
            <span>{t('onboarding.workflowsGuideItem1Desc')}</span>
          </div>
        </div>
        <div className="guide-item">
          <Icons.Brain size={22} />
          <div>
            <strong>{t('onboarding.workflowsGuideItem2Title')}</strong>
            <span>{t('onboarding.workflowsGuideItem2Desc')}</span>
          </div>
        </div>
        <div className="guide-item">
          <Icons.Branch size={22} />
          <div>
            <strong>{t('onboarding.workflowsGuideItem3Title')}</strong>
            <span>{t('onboarding.workflowsGuideItem3Desc')}</span>
          </div>
        </div>
      </div>
      <div className="button-row">
        <Button onClick={() => finishGuide(onFinish)}>{t('onboarding.skipGuideBtn')}</Button>
        <Button onClick={() => dispatch({ type: 'set-step', step: 'first-session' })}>
          {t('onboarding.workflowsGuideBackBtn')}
        </Button>
        <Button type="primary" onClick={() => dispatch({ type: 'set-step', step: 'canvas-guide' })}>
          {t('onboarding.workflowsGuideNextBtn')}
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
  const { t } = useI18n()
  return (
    <>
      <h1>{t('onboarding.connectionTestTitle')}</h1>
      <p className="lead">{t('onboarding.connectionTestLead')}</p>
      <pre className="test-output">{output || t('onboarding.connectionTestWaiting')}</pre>
      <div className="button-row">
        <Button onClick={() => dispatch({ type: 'back' })}>
          {t('onboarding.connectionTestBackBtn')}
        </Button>
        <SkipStepButton dispatch={dispatch} target="agent-template" />
        <Button
          type="primary"
          onClick={() => dispatch({ type: 'set-step', step: 'agent-template' })}
        >
          {t('onboarding.continueBtn')}
        </Button>
      </div>
    </>
  )
}

function DoneStep({ onDone }: { onDone: () => void }) {
  const { t } = useI18n()
  return (
    <>
      <h1>{t('onboarding.doneTitle')}</h1>
      <p className="lead">{t('onboarding.doneLead')}</p>
      <div className="guide-panel">
        <div className="guide-item">
          <Icons.Terminal size={22} />
          <div>
            <strong>{t('onboarding.doneItem1Title')}</strong>
            <span>{t('onboarding.doneItem1Desc')}</span>
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
        {t('onboarding.doneEnterBtn')}
      </Button>
    </>
  )
}
