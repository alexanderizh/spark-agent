import { useCallback, useEffect, useReducer, useState } from 'react'
import {
  Button,
  Input as LobeInput,
  InputPassword,
  Select as LobeSelect,
  TextArea as LobeTextArea,
} from '@lobehub/ui'
import './OnboardingView.less'
import sparkLogo from '../../assets/spark-logo.png'
import agentIllustration from '../../assets/onboarding/agent.svg'
import chatIllustration from '../../assets/onboarding/chat.svg'
import modelSourceIllustration from '../../assets/onboarding/model-source.svg'
import providerIllustration from '../../assets/onboarding/provider.svg'
import welcomeIllustration from '../../assets/onboarding/welcome.svg'
import { useApp } from '../AppContext'
import { useAuth } from '../auth/AuthContext'
import { useIpcInvoke } from '../hooks/useIpc'
import { useSessionSidebar } from '../SessionSidebarContext'
import { useToast } from '../components/Toast'
import { ProviderLogo } from '../components/ProviderLogo'
import { Icons } from '../Icons'
import { MacWindowDragHeader } from '../components/MacWindowDragHeader'
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

type OnboardingStep =
  | 'welcome'
  | 'model-source'
  | 'spark-account'
  | 'third-party-provider'
  | 'local-cli'
  | 'connection-test'
  | 'agent-template'
  | 'first-session'
  | 'canvas-guide'
  | 'skills-guide'
  | 'media-guide'
  | 'done'
type ModelSource = 'spark-account' | 'third-party-provider' | 'local-cli'
type UseCaseId = 'daily' | 'document' | 'work' | 'developer' | 'unsure'
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

const ONBOARDING_COMPLETED_KEY = 'spark-agent:onboarding-completed'
const ONBOARDING_DISMISSED_KEY = 'spark-agent:onboarding-dismissed'

const initialState: OnboardingState = {
  step: 'welcome',
  useCase: null,
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
      return { ...state, useCase: action.useCase, templateId: action.templateId }
    case 'set-model-source':
      return { ...state, modelSource: action.modelSource, step: action.step }
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
      return { ...state, agentId: action.agentId, step: 'first-session' }
    case 'set-template':
      return { ...state, templateId: action.templateId }
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
    return state.localCliKind != null ? 'local-cli' : 'third-party-provider'
  }
  if (state.step === 'agent-template') return 'connection-test'
  if (state.step === 'first-session') return 'agent-template'
  if (state.step === 'canvas-guide') return 'first-session'
  if (state.step === 'skills-guide') return 'canvas-guide'
  if (state.step === 'media-guide') return 'skills-guide'
  if (state.step === 'done') return 'media-guide'
  return 'first-session'
}

const useCases: Array<{ id: UseCaseId; title: string; desc: string; templateId: TemplateId }> = [
  {
    id: 'daily',
    title: '写内容 / 做总结',
    desc: '邮件、报告、会议纪要、日常问答。',
    templateId: 'general',
  },
  {
    id: 'document',
    title: '处理文件 / 资料',
    desc: '阅读、归纳、整理文档与表格信息。',
    templateId: 'document',
  },
  {
    id: 'work',
    title: '规划任务 / 做助理',
    desc: '拆解目标、安排步骤、跟进事项。',
    templateId: 'work',
  },
  {
    id: 'developer',
    title: '项目 / 代码 / 自动化',
    desc: '适合已经需要处理项目工程的用户。',
    templateId: 'developer',
  },
  { id: 'unsure', title: '我还不确定', desc: '先用一个通用助手快速体验。', templateId: 'general' },
]

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

const visualByStep: Record<
  OnboardingStep,
  {
    image: string
    kicker: string
    title: string
    caption: string
    stat: string
    points: string[]
  }
> = {
  welcome: {
    image: welcomeIllustration,
    kicker: 'Start',
    title: '把第一次配置拆成 4 步',
    caption: '先选目标，再接模型，最后直接进入第一轮对话。',
    stat: '3 min',
    points: ['按你的用途推荐助手模板', '配置项只在需要时出现', '跳过后不会再次自动打开'],
  },
  'model-source': {
    image: modelSourceIllustration,
    kicker: 'Model',
    title: '选择模型来源',
    caption: 'Spark 账号、第三方服务或本机 CLI 都从这里进入。',
    stat: '01',
    points: [
      '第三方 API 适合已有模型账号',
      '本机 CLI 可复用 Claude Code / Codex 登录',
      '平台模型入口会在订阅上线后启用',
    ],
  },
  'spark-account': {
    image: modelSourceIllustration,
    kicker: 'Account',
    title: '预留平台模型入口',
    caption: '后续登录 Spark 账号即可使用内置模型额度。',
    stat: 'Soon',
    points: ['当前先保留入口', '以后可直接用账号额度', '现在建议走第三方或本机 CLI'],
  },
  'third-party-provider': {
    image: providerIllustration,
    kicker: 'Provider',
    title: '保存服务商与密钥',
    caption: '配置会写入本机安全存储，并立即做健康检查。',
    stat: 'API',
    points: ['优先选择常见 Anthropic 兼容服务', '密钥只保存在本机', '测试通过后再创建助手'],
  },
  'local-cli': {
    image: providerIllustration,
    kicker: 'Local',
    title: '连接本机 AI 工具',
    caption: '适合已经配置 Claude Code 或 Codex 的用户。',
    stat: 'CLI',
    points: ['自动检测本机可用工具', '不需要重新填写 API Key', '适合项目代码和自动化任务'],
  },
  'connection-test': {
    image: providerIllustration,
    kicker: 'Check',
    title: '确认模型已响应',
    caption: '测试通过后再创建助手，避免后续第一条消息失败。',
    stat: 'OK',
    points: ['失败时可返回修改模型', '本机 CLI 会检查可执行文件', '第三方模型会做一次健康检查'],
  },
  'agent-template': {
    image: agentIllustration,
    kicker: 'Agent',
    title: '选择你的助手类型',
    caption: '通用、文档、工作、开发四类模板覆盖常见任务。',
    stat: '02',
    points: ['模板会写入助手提示词', '后续可在助手页继续修改', '开发助手会默认使用较稳妥的权限'],
  },
  'first-session': {
    image: chatIllustration,
    kicker: 'Chat',
    title: '发出第一条消息',
    caption: '用一条真实请求完成初始化，而不是停在空白页面。',
    stat: '03',
    points: ['可以直接选示例问题', '发送后会创建新会话', '接下来是可跳过的能力导览'],
  },
  'canvas-guide': {
    image: agentIllustration,
    kicker: 'Canvas',
    title: '画布适合整理复杂创作',
    caption: '把文本、图片、镜头、角色和参考资料放在同一张工作台里。',
    stat: 'Guide',
    points: [
      '从左侧切到画布视图',
      '节点可以承载资料、提示词和产物',
      '适合长文、分镜、视频与项目规划',
    ],
  },
  'skills-guide': {
    image: providerIllustration,
    kicker: 'Skills',
    title: 'Skill 是 Agent 的可安装能力',
    caption: '它会告诉 Agent 面对特定任务时该用哪些流程、工具和模板。',
    stat: 'Guide',
    points: [
      '内置 Skill 可直接启用',
      '技能商店里可以安装更多能力',
      '适合固定流程：写报告、做课件、跑浏览器自动化',
    ],
  },
  'media-guide': {
    image: chatIllustration,
    kicker: 'Media',
    title: '多媒体模型也能在对话里使用',
    caption: '当服务商支持图片、视频或语音模型时，可以在对话和画布里调用它们。',
    stat: 'Guide',
    points: [
      '图片生成、图生视频、语音等模型会按类型展示',
      '可把参考素材放入对话或画布上下文',
      '生成结果适合继续回到画布整理',
    ],
  },
  done: {
    image: chatIllustration,
    kicker: 'Done',
    title: '配置完成',
    caption: '以后可以在模型与助手设置中继续扩展能力。',
    stat: '✓',
    points: ['新手引导已标记完成', '可从设置页重新打开', '现在可以开始正式会话'],
  },
}

function getDefaultProviderPreset() {
  const deepseek = providerPresets.find((p) => p.id === 'deepseek-api-anthropic')
  const preset = deepseek ?? providerPresets[0] ?? PROVIDER_PRESETS[0]
  if (!preset) throw new Error('No provider presets configured')
  return preset
}

const defaultProviderPreset = getDefaultProviderPreset()

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
  ) {
    return 1
  }
  if (step === 'agent-template') return 2
  if (step === 'first-session') return 3
  if (step === 'canvas-guide') return 4
  if (step === 'skills-guide') return 5
  if (step === 'media-guide') return 6
  return 7
}

function completeOnboarding(): void {
  window.localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true')
  window.localStorage.removeItem(ONBOARDING_DISMISSED_KEY)
}

function dismissOnboarding(): void {
  window.localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true')
  window.localStorage.setItem(ONBOARDING_DISMISSED_KEY, 'true')
}

export function shouldShowOnboarding(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.localStorage.getItem(ONBOARDING_COMPLETED_KEY) !== 'true' &&
    window.localStorage.getItem(ONBOARDING_DISMISSED_KEY) !== 'true'
  )
}

export function OnboardingView(): React.ReactElement {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [providerPresetId, setProviderPresetIdState] = useState(defaultProviderPreset.id)
  const [apiKey, setApiKey] = useState('')
  const [customEndpoint, setCustomEndpoint] = useState(defaultProviderPreset.apiEndpoint)
  const [customModel, setCustomModel] = useState(defaultProviderPreset.defaultModel)
  const [connectionTestOutput, setConnectionTestOutput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { setTweak } = useApp()
  const auth = useAuth()
  const sessionCtx = useSessionSidebar()
  const { toast } = useToast()
  const { invoke: createProvider } = useIpcInvoke('provider:create')
  const { invoke: listProviders } = useIpcInvoke('provider:list')
  const { invoke: createAgent } = useIpcInvoke('agent:create')
  const { invoke: sendTurn } = useIpcInvoke('session:send-turn')
  const { invoke: healthCheck } = useIpcInvoke('provider:health-check')

  const setProviderPresetId = useCallback((id: string) => {
    setProviderPresetIdState(id)
    const preset = providerPresets.find((item) => item.id === id) ?? defaultProviderPreset
    setCustomModel(preset.defaultModel)
    setCustomEndpoint(preset.apiEndpoint)
  }, [])

  const goChat = useCallback(() => {
    setTweak('view', 'chat')
  }, [setTweak])

  const skip = useCallback(() => {
    dismissOnboarding()
    toast.info('已跳过新手引导，可稍后从设置中重新打开。')
    goChat()
  }, [goChat, toast])

  // 用户在引导页关闭窗口 / 刷新 / 任意方式离开引导视图时，若尚未完成引导，
  // 同样视为跳过 — 否则下次启动还会再次自动打开。
  useEffect(() => {
    const markDismissedIfIncomplete = (): void => {
      if (window.localStorage.getItem(ONBOARDING_COMPLETED_KEY) === 'true') return
      dismissOnboarding()
    }
    const handleBeforeUnload = (): void => markDismissedIfIncomplete()
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      markDismissedIfIncomplete()
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
    [healthCheck, listProviders, sessionCtx, toast],
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
      toast.success('第一个 AI 助手已创建。')
      void sessionCtx.refreshData()
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
      const sessionId = await sessionCtx.handleNewSession(null, {
        agentId: state.agentId ?? undefined,
        providerProfileId: state.providerProfileId ?? undefined,
        modelId: state.modelId ?? undefined,
      })
      if (!sessionId) throw new Error('没有可用的模型配置，请先完成模型连接。')
      await sendTurn({ sessionId, message: prompt })
      toast.success('第一次会话已创建。')
      dispatch({ type: 'set-step', step: 'canvas-guide' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(`发送失败：${message}`)
    } finally {
      setBusy(false)
    }
  }, [
    sendTurn,
    sessionCtx,
    state.agentId,
    state.firstPrompt,
    state.modelId,
    state.providerProfileId,
    toast,
  ])

  return (
    <div className="onboarding-shell">
      <MacWindowDragHeader />
      <aside className="onboarding-steps" aria-label="新手引导步骤">
        <div className="onboarding-brand">
          <img src={sparkLogo} alt="" aria-hidden="true" draggable={false} /> Spark Agent
        </div>
        <button
          className="onboarding-back"
          type="button"
          onClick={() => dispatch({ type: 'back' })}
          disabled={state.step === 'welcome'}
        >
          ← 上一步
        </button>
        {['欢迎', '连接模型', '创建助手', '第一次对话', '画布', 'Skill', '多媒体', '完成'].map(
          (label, index) => {
            const activeIndex = getActiveStepIndex(state.step)
            return (
              <div
                key={label}
                className={`onboarding-step ${index === activeIndex ? 'active' : ''} ${index < activeIndex ? 'done' : ''}`}
              >
                <span>{index + 1}</span>
                {label}
              </div>
            )
          },
        )}
        <button className="onboarding-skip" type="button" onClick={skip}>
          稍后再说
        </button>
      </aside>

      <main className="onboarding-main">
        <section className="onboarding-card">
          <div className="onboarding-copy">
            {state.step === 'welcome' && <WelcomeStep dispatch={dispatch} />}
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
                setApiKey={setApiKey}
                customEndpoint={customEndpoint}
                setCustomEndpoint={setCustomEndpoint}
                customModel={customModel}
                setCustomModel={setCustomModel}
                onSubmit={handleCreateProvider}
                busy={busy}
              />
            )}
            {state.step === 'connection-test' && (
              <ConnectionTestStep output={connectionTestOutput} dispatch={dispatch} />
            )}
            {state.step === 'agent-template' && (
              <AgentTemplateStep
                templateId={state.templateId}
                dispatch={dispatch}
                onSubmit={handleCreateAgent}
                busy={busy}
              />
            )}
            {state.step === 'first-session' && (
              <FirstSessionStep
                prompt={state.firstPrompt}
                dispatch={dispatch}
                onSubmit={handleStartFirstSession}
                busy={busy}
              />
            )}
            {state.step === 'canvas-guide' && (
              <CanvasGuideStep dispatch={dispatch} onFinish={goChat} />
            )}
            {state.step === 'skills-guide' && (
              <SkillsGuideStep dispatch={dispatch} onFinish={goChat} />
            )}
            {state.step === 'media-guide' && (
              <MediaGuideStep dispatch={dispatch} onFinish={goChat} />
            )}
            {state.step === 'done' && <DoneStep onDone={goChat} />}
            {error && <div className="onboarding-error">{error}</div>}
          </div>
          <OnboardingVisual step={state.step} />
        </section>
      </main>
    </div>
  )
}

function WelcomeStep({ dispatch }: { dispatch: React.Dispatch<Action> }) {
  return (
    <>
      <p className="eyebrow">安装后 3 分钟配置</p>
      <h1>欢迎使用 Spark Agent</h1>
      <p className="lead">
        不用理解复杂技术名词，我们会一步一步帮你连接模型、创建第一个 AI 助手，并完成第一次对话。
      </p>
      <div className="choice-grid">
        {useCases.map((item) => (
          <button
            key={item.id}
            type="button"
            className="choice-card"
            onClick={() =>
              dispatch({ type: 'set-use-case', useCase: item.id, templateId: item.templateId })
            }
          >
            <span className="choice-card-mark" aria-hidden="true" />
            <strong>{item.title}</strong>
            <span>{item.desc}</span>
          </button>
        ))}
      </div>
      <Button
        type="primary"
        size="large"
        onClick={() => dispatch({ type: 'set-step', step: 'model-source' })}
      >
        开始设置
      </Button>
    </>
  )
}

function ModelSourceStep({ dispatch }: { dispatch: React.Dispatch<Action> }) {
  return (
    <>
      <p className="eyebrow">第一步：准备 AI 模型</p>
      <h1>你想怎么使用 AI 模型？</h1>
      <p className="lead">
        未来可直接登录 Spark 账号使用平台内置模型。现在也可以配置你已有的第三方模型服务。
      </p>
      <div className="source-list">
        <button
          type="button"
          className="source-card"
          onClick={() =>
            dispatch({
              type: 'set-model-source',
              modelSource: 'third-party-provider',
              step: 'third-party-provider',
            })
          }
        >
          <Icons.Server size={22} />
          <div>
            <strong>使用第三方模型</strong>
            <span>已有 OpenAI、Anthropic、OpenRouter 等账号时选择。</span>
          </div>
        </button>
        <button
          type="button"
          className="source-card"
          onClick={() =>
            dispatch({ type: 'set-model-source', modelSource: 'local-cli', step: 'local-cli' })
          }
        >
          <Icons.Terminal size={22} />
          <div>
            <strong>使用本机 AI 工具</strong>
            <span>适合已经安装 Claude Code / Codex 的高级用户。</span>
          </div>
        </button>
        {/* 平台内置模型入口尚未开放：置灰放最后，徽章标「开发中」，待上线后再启用 */}
        <button type="button" className="source-card" disabled>
          <Icons.User size={22} />
          <div>
            <strong>使用 Spark 账号模型</strong>
            <span>适合大多数用户，未来登录后即可使用。</span>
          </div>
          <em>开发中</em>
        </button>
      </div>
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
      <p className="eyebrow">平台内置模型</p>
      <h1>这里已为 Spark 账号模型服务留好入口</h1>
      <p className="lead">
        后续平台订阅上线后，用户将不必自己申请 API Key，登录本账号即可使用内置模型。
      </p>
      <div className="notice-card">
        {isAuthenticated
          ? `当前已登录：${account || 'Spark 账号'}`
          : '当前未登录。平台模型订阅上线后，这里会展示登录 / 注册入口和套餐额度。'}
      </div>
      <div className="button-row">
        <Button onClick={() => dispatch({ type: 'set-step', step: 'model-source' })}>
          返回选择
        </Button>
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
          先配置第三方模型
        </Button>
      </div>
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
    desc: '复用宿主机已登录的 Claude Code，无需 API Key。',
    installHint: '未检测到，可运行 npm i -g @anthropic-ai/claude-code 安装。',
  },
  {
    kind: 'codex',
    title: 'Codex（本机）',
    desc: '复用宿主机已登录的 Codex CLI，无需 API Key。',
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
      <p className="eyebrow">本机 AI 工具</p>
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
              className="source-card local-cli-card"
              disabled={busy || current !== 'available'}
              onClick={() => onSelect(option.kind)}
            >
              <Icons.Terminal size={22} />
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
        <Button onClick={() => dispatch({ type: 'set-step', step: 'model-source' })}>
          返回选择
        </Button>
        <Button onClick={handleRedetect} disabled={busy}>
          重新检测
        </Button>
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
  onSubmit: () => void
  busy: boolean
}) {
  return (
    <>
      <p className="eyebrow">连接第三方模型</p>
      <h1>填写你的模型服务信息</h1>
      <p className="lead">
        “密钥”就是模型服务商给你的使用凭证。Spark Agent 会把它安全保存在你的电脑里。
      </p>
      <label>
        服务商
        <LobeSelect
          showSearch
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
      </label>
      <label>
        密钥
        <InputPassword
          value={props.apiKey}
          onChange={(e) => props.setApiKey(e.target.value)}
          placeholder="粘贴 API Key"
        />
      </label>
      <details>
        <summary>URL 和模型设置</summary>
        <label>
          模型 ID
          <LobeInput
            value={props.customModel}
            onChange={(e) => props.setCustomModel(e.target.value)}
          />
        </label>
        <label>
          API URL
          <LobeInput
            value={props.customEndpoint}
            onChange={(e) => props.setCustomEndpoint(e.target.value)}
            placeholder="默认可留空"
          />
        </label>
      </details>
      <Button type="primary" size="large" onClick={props.onSubmit} loading={props.busy}>
        {props.busy ? '正在测试并保存…' : '测试并保存'}
      </Button>
    </>
  )
}

function AgentTemplateStep({
  templateId,
  dispatch,
  onSubmit,
  busy,
}: {
  templateId: TemplateId
  dispatch: React.Dispatch<Action>
  onSubmit: () => void
  busy: boolean
}) {
  return (
    <>
      <p className="eyebrow">创建第一个助手</p>
      <h1>选择你的 AI 助手类型</h1>
      <div className="choice-grid templates">
        {Object.entries(templates).map(([id, item]) => (
          <button
            key={id}
            type="button"
            className={`choice-card ${templateId === id ? 'selected' : ''}`}
            onClick={() => dispatch({ type: 'set-template', templateId: id as TemplateId })}
          >
            <span className="choice-card-mark" aria-hidden="true" />
            <strong>{item.title}</strong>
            <span>{item.desc}</span>
          </button>
        ))}
      </div>
      <div className="button-row">
        <Button onClick={() => dispatch({ type: 'back' })}>返回模型测试</Button>
        <Button type="primary" onClick={onSubmit} loading={busy}>
          {busy ? '正在创建…' : `创建“${templates[templateId].name}”`}
        </Button>
      </div>
    </>
  )
}

function FirstSessionStep({
  prompt,
  dispatch,
  onSubmit,
  busy,
}: {
  prompt: string
  dispatch: React.Dispatch<Action>
  onSubmit: () => void
  busy: boolean
}) {
  return (
    <>
      <p className="eyebrow">第一次对话</p>
      <h1>试着发出第一条消息</h1>
      <p className="lead">发送后会创建新会话，然后进入几页可跳过的功能导览。</p>
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
      />
      <div className="button-row">
        <Button onClick={() => dispatch({ type: 'back' })}>返回助手选择</Button>
        <Button type="primary" onClick={onSubmit} loading={busy}>
          {busy ? '正在发送…' : '发送并继续导览'}
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
      <p className="eyebrow">可跳过教学：画布</p>
      <h1>把复杂内容放到画布上整理</h1>
      <p className="lead">
        画布不是必须先学会的功能。你可以把它理解成一张可扩展工作台：资料、提示词、图片、角色设定、分镜和生成结果都能作为节点摆放。
      </p>
      <div className="guide-panel">
        <div className="guide-item">
          <Icons.Canvas size={22} />
          <div>
            <strong>适合长任务</strong>
            <span>做方案、写长文、拆分视频分镜时，比单条聊天更容易保留结构。</span>
          </div>
        </div>
        <div className="guide-item">
          <Icons.File size={22} />
          <div>
            <strong>资料和产物放一起</strong>
            <span>把参考文件、模型输出和下一步提示词串起来，减少来回翻找。</span>
          </div>
        </div>
      </div>
      <div className="button-row">
        <Button onClick={() => finishGuide(onFinish)}>跳过讲解，进入会话</Button>
        <Button type="primary" onClick={() => dispatch({ type: 'set-step', step: 'skills-guide' })}>
          继续了解 Skill
        </Button>
      </div>
    </>
  )
}

function SkillsGuideStep({
  dispatch,
  onFinish,
}: {
  dispatch: React.Dispatch<Action>
  onFinish: () => void
}) {
  return (
    <>
      <p className="eyebrow">可跳过教学：Skill</p>
      <h1>Skill 会让 Agent 更懂特定任务</h1>
      <p className="lead">
        Skill 像是给 Agent 的任务手册。安装或启用后，Agent
        会按里面写好的流程、模板和工具习惯处理对应场景。
      </p>
      <div className="guide-panel">
        <div className="guide-item">
          <Icons.Skills size={22} />
          <div>
            <strong>先用内置技能</strong>
            <span>报告、课件、浏览器自动化、文档处理等场景可以直接从技能页查看。</span>
          </div>
        </div>
        <div className="guide-item">
          <Icons.Plus size={22} />
          <div>
            <strong>需要时再安装</strong>
            <span>技能商店用于扩展能力；不确定时保持默认即可，不影响基础聊天。</span>
          </div>
        </div>
      </div>
      <div className="button-row">
        <Button onClick={() => finishGuide(onFinish)}>跳过讲解，进入会话</Button>
        <Button onClick={() => dispatch({ type: 'set-step', step: 'canvas-guide' })}>
          返回画布
        </Button>
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
      <p className="eyebrow">可跳过教学：多媒体模型</p>
      <h1>图片、视频、语音也可以进入对话</h1>
      <p className="lead">
        当你配置的服务商支持多媒体模型时，Spark Agent
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
        <Button onClick={() => dispatch({ type: 'set-step', step: 'skills-guide' })}>
          返回 Skill
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

function ConnectionTestStep({
  output,
  dispatch,
}: {
  output: string
  dispatch: React.Dispatch<Action>
}) {
  return (
    <>
      <p className="eyebrow">连接测试</p>
      <h1>已用“你好”测试模型</h1>
      <p className="lead">下面是本次模型连接测试结果。若失败，可以返回重新选择方案或修改密钥。</p>
      <pre className="test-output">{output || '等待测试结果…'}</pre>
      <div className="button-row">
        <Button onClick={() => dispatch({ type: 'back' })}>返回修改模型</Button>
        <Button
          type="primary"
          onClick={() => dispatch({ type: 'set-step', step: 'agent-template' })}
        >
          继续创建助手
        </Button>
      </div>
    </>
  )
}

function OnboardingVisual({ step }: { step: OnboardingStep }) {
  const visual = visualByStep[step]
  return (
    <div className="onboarding-visual" aria-hidden="true">
      <div className="visual-stage">
        <div className="visual-topline">
          <img src={sparkLogo} alt="" draggable={false} />
          <span>{visual.kicker}</span>
        </div>
        <div className="visual-preview">
          <img className="visual-illustration" src={visual.image} alt="" draggable={false} />
          <div className="visual-metrics">
            <span />
            <span />
            <span />
          </div>
        </div>
        <div className="visual-summary">
          <div>
            <strong>{visual.title}</strong>
            <span>{visual.caption}</span>
          </div>
          <em>{visual.stat}</em>
        </div>
        <ul className="visual-points">
          {visual.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function DoneStep({ onDone }: { onDone: () => void }) {
  return (
    <>
      <p className="eyebrow">完成</p>
      <h1>设置完成！</h1>
      <p className="lead">以后你可以直接从左侧新建会话开始使用，也可以继续添加更多模型和助手。</p>
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
