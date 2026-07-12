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
import sparkLogo from '../../assets/spark-logo.png'
import { useApp } from '../AppContext'
import { useAuth } from '../auth/AuthContext'
import { AuthGate } from '../auth/AuthGate'
import { useIpcInvoke } from '../hooks/useIpc'
import { useSessionSidebar } from '../SessionSidebarContext'
import { useToast } from '../components/Toast'
import { ProviderLogo } from '../components/ProviderLogo'
import { Icons } from '../Icons'
import { showPlatformQuotaGuide } from './platform-model/platform-quota-guide'
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
  | 'tools-guide'
  | 'workflows-guide'
  | 'board-guide'
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

// Onboarding 完成标记的真实存储：主进程的 app_settings 表（SQLite）。
// 不能只放 localStorage —— localStorage 按 origin 隔离，开发态
// (http://localhost:5173) 与生产态 (file://) 分属不同 origin，互相读不到，
// 会导致「开发态完成的引导，生产态每次启动还弹」（实测 leveldb 取证确认）。
// 主进程 SQLite 作为 single source of truth；localStorage 仅保留给
// 老版本数据一次性迁移，不再参与启动判定。
const ONBOARDING_SETTINGS_CATEGORY = 'onboarding'
const ONBOARDING_SETTINGS_KEY = 'data'

type OnboardingStateRecord = {
  completed: boolean
  dismissed: boolean
}

/** 同步读取当前 origin 的 localStorage（仅用于老版本数据迁移）。 */
function readLocalOnboarding(): OnboardingStateRecord {
  if (typeof window === 'undefined') return { completed: false, dismissed: false }
  return {
    completed: window.localStorage.getItem(ONBOARDING_COMPLETED_KEY) === 'true',
    dismissed: window.localStorage.getItem(ONBOARDING_DISMISSED_KEY) === 'true',
  }
}

/**
 * 把状态写到主进程 SQLite（权威存储）。
 * 不再同步刷 localStorage —— localStorage 按 origin 隔离，写它反而制造
 * dev/prod 数据不一致。启动判定只信主进程值。
 */
function writeOnboardingState(state: OnboardingStateRecord): void {
  window.spark
    ?.invoke('settings:set', {
      category: ONBOARDING_SETTINGS_CATEGORY,
      key: ONBOARDING_SETTINGS_KEY,
      value: state,
    })
    .catch(() => {
      // IPC 失败不阻塞引导流程；下次启动会再读主进程，最坏情况是本次会话内
      // 重复进入引导（远比"每次启动都弹"可接受）。
    })
}

/**
 * 异步从主进程读取权威 onboarding 状态。
 *
 * 迁移：若主进程尚无记录（老用户首次升级到此版本），用当前 origin 的
 * localStorage 值初始化主进程，并把 localStorage 清掉，避免后续混淆。
 * 这样老用户无论从哪个 origin 登录，完成状态都会被正确迁移到主进程。
 */
async function readRemoteOnboarding(): Promise<OnboardingStateRecord> {
  try {
    const res = await window.spark?.invoke('settings:get', {
      category: ONBOARDING_SETTINGS_CATEGORY,
      key: ONBOARDING_SETTINGS_KEY,
    })
    const value = res?.value
    if (value != null && typeof value === 'object') {
      const v = value as Partial<OnboardingStateRecord>
      return {
        completed: v.completed === true,
        dismissed: v.dismissed === true,
      }
    }
    // 主进程无记录 → 用当前 origin 的 localStorage 迁移过去（一次性）
    const local = readLocalOnboarding()
    if (local.completed || local.dismissed) {
      await window.spark?.invoke('settings:set', {
        category: ONBOARDING_SETTINGS_CATEGORY,
        key: ONBOARDING_SETTINGS_KEY,
        value: local,
      })
      // 迁移成功后清掉 localStorage，避免后续读取的歧义
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(ONBOARDING_COMPLETED_KEY)
        window.localStorage.removeItem(ONBOARDING_DISMISSED_KEY)
      }
    }
    return local
  } catch {
    // IPC 完全不可用（极端情况）→ 回退到 localStorage，保证函数有返回值
    return readLocalOnboarding()
  }
}

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
  if (state.step === 'tools-guide') return 'skills-guide'
  if (state.step === 'workflows-guide') return 'tools-guide'
  if (state.step === 'board-guide') return 'workflows-guide'
  if (state.step === 'media-guide') return 'board-guide'
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

type IconType = typeof Icons.Rocket

const visualByStep: Record<
  OnboardingStep,
  {
    icon: IconType
    accent: [string, string]
    kicker: string
    title: string
    caption: string
    stat: string
    points: string[]
  }
> = {
  welcome: {
    icon: Icons.Rocket,
    accent: ['#6366f1', '#8b5cf6'],
    kicker: 'Start',
    title: '把第一次配置拆成 4 步',
    caption: '先选目标，再接模型，最后直接进入第一轮对话。',
    stat: '3 min',
    points: ['按你的用途推荐助手模板', '配置项只在需要时出现', '跳过后不会再次自动打开'],
  },
  'model-source': {
    icon: Icons.Cpu,
    accent: ['#06b6d4', '#6366f1'],
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
    icon: Icons.User,
    accent: ['#8b5cf6', '#ec4899'],
    kicker: 'Account',
    title: '预留平台模型入口',
    caption: '后续登录 Spark 账号即可使用内置模型额度。',
    stat: 'Soon',
    points: ['当前先保留入口', '以后可直接用账号额度', '现在建议走第三方或本机 CLI'],
  },
  'third-party-provider': {
    icon: Icons.Server,
    accent: ['#06b6d4', '#3b82f6'],
    kicker: 'Provider',
    title: '保存服务商与密钥',
    caption: '配置会写入本机安全存储，并立即做健康检查。',
    stat: 'API',
    points: ['优先选择常见 Anthropic 兼容服务', '密钥只保存在本机', '测试通过后再创建助手'],
  },
  'local-cli': {
    icon: Icons.Terminal,
    accent: ['#64748b', '#6366f1'],
    kicker: 'Local',
    title: '连接本机 AI 工具',
    caption: '适合已经配置 Claude Code 或 Codex 的用户。',
    stat: 'CLI',
    points: ['自动检测本机可用工具', '不需要重新填写 API Key', '适合项目代码和自动化任务'],
  },
  'connection-test': {
    icon: Icons.Zap,
    accent: ['#10b981', '#06b6d4'],
    kicker: 'Check',
    title: '确认模型已响应',
    caption: '测试通过后再创建助手，避免后续第一条消息失败。',
    stat: 'OK',
    points: ['失败时可返回修改模型', '本机 CLI 会检查可执行文件', '第三方模型会做一次健康检查'],
  },
  'agent-template': {
    icon: Icons.Bot,
    accent: ['#6366f1', '#8b5cf6'],
    kicker: 'Agent',
    title: '选择你的助手类型',
    caption: '通用、文档、工作、开发四类模板覆盖常见任务。',
    stat: '02',
    points: [
      '模板只是起点：提示词、技能、工作流后续都能改',
      '助手页可继续挂载技能、绑定工作流',
      '开发助手会默认使用较稳妥的权限',
    ],
  },
  'first-session': {
    icon: Icons.Chat,
    accent: ['#8b5cf6', '#06b6d4'],
    kicker: 'Chat',
    title: '发出第一条消息',
    caption: '用一条真实请求完成初始化，而不是停在空白页面。',
    stat: '03',
    points: ['可以直接选示例问题', '发送后会创建新会话', '接下来是可跳过的能力导览'],
  },
  'canvas-guide': {
    icon: Icons.Canvas,
    accent: ['#06b6d4', '#10b981'],
    kicker: 'Canvas',
    title: '画布 = 多媒体创作工作台',
    caption: '按项目组织剧本、角色、分镜、参考图和生成结果。',
    stat: 'Guide',
    points: [
      '节点承载文本、图片、视频、音频、镜头',
      '从左侧切到画布视图进入项目',
      '适合分镜、视频与视觉创作',
    ],
  },
  'skills-guide': {
    icon: Icons.Skills,
    accent: ['#f59e0b', '#f97316'],
    kicker: 'Skills',
    title: 'Skill 给 Agent 增加专门能力',
    caption: '内置、推荐、SkillHub 市场、本地检测四种来源，按需启用。',
    stat: 'Guide',
    points: ['内置 Skill 开箱即用', '推荐 / SkillHub 市场可安装更多', '本地 Skill 会被自动检测到'],
  },
  'tools-guide': {
    icon: Icons.Wrench,
    accent: ['#64748b', '#8b5cf6'],
    kicker: 'Tools',
    title: 'Agent 自带的常用工具',
    caption: '终端、检索、编辑和 Spark Web Tool 内容生成等能力开箱即用。',
    stat: 'Guide',
    points: [
      '终端 / 检索 / 编辑，默认启用不用额外安装',
      '改代码时可先看 diff，并回到最近的代码还原点',
      'Spark Web Tool 一键出课件、讲解、数据分析报告',
    ],
  },
  'workflows-guide': {
    icon: Icons.Workflow,
    accent: ['#6366f1', '#06b6d4'],
    kicker: 'Workflows',
    title: '把多步任务编排成工作流',
    caption: '节点 + 边的图编辑器，让 Agent 按流程自动执行；代码任务跑偏时还能回到还原点。',
    stat: 'Guide',
    points: [
      '节点代表一个步骤，边代表顺序',
      '工作流可绑定到 Agent',
      '可保存为模板，并结合代码还原点更稳地迭代',
    ],
  },
  'board-guide': {
    icon: Icons.Board,
    accent: ['#8b5cf6', '#6366f1'],
    kicker: 'Board',
    title: '任务面板：拖一拖就能推进',
    caption: '类飞书看板视图，可触发 Agent 自动执行。',
    stat: 'Guide',
    points: ['拖拽卡片改变状态', '可绑定会话或自动执行', '支持附件、评论与回收站'],
  },
  'media-guide': {
    icon: Icons.Film,
    accent: ['#ec4899', '#8b5cf6'],
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
    icon: Icons.CheckCircle,
    accent: ['#10b981', '#06b6d4'],
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

const ONBOARDING_STEP_ITEMS = [
  { label: '欢迎', step: 'welcome' },
  { label: '连接模型', step: 'model-source' },
  { label: '创建助手', step: 'agent-template' },
  { label: '第一次对话', step: 'first-session' },
  { label: '画布', step: 'canvas-guide' },
  { label: 'Skill', step: 'skills-guide' },
  { label: '内置工具', step: 'tools-guide' },
  { label: '工作流', step: 'workflows-guide' },
  { label: '任务面板', step: 'board-guide' },
  { label: '多媒体', step: 'media-guide' },
  { label: '完成', step: 'done' },
] as const satisfies ReadonlyArray<{ label: string; step: OnboardingStep }>

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
  if (step === 'tools-guide') return 6
  if (step === 'workflows-guide') return 7
  if (step === 'board-guide') return 8
  if (step === 'media-guide') return 9
  return 10
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

/**
 * 清空主进程权威记录（用于设置页"重新打开"）。
 * value:null 在主进程 settings:set handler 里会被解释为 delete。
 */
export function clearOnboardingState(): void {
  window.spark
    ?.invoke('settings:set', {
      category: ONBOARDING_SETTINGS_CATEGORY,
      key: ONBOARDING_SETTINGS_KEY,
      value: null,
    })
    .catch(() => {
      /* ignore */
    })
}

/**
 * 异步判定：是否需要展示新手引导。读主进程 SQLite 权威值，
 * 跨 origin / 跨环境一致。**App 启动期的唯一判定入口。**
 *
 * 历史教训：曾存在同步版本 shouldShowOnboarding()（读 localStorage），
 * 但 localStorage 按 origin 隔离 (file:// vs http://localhost:5173)，
 * dev/prod 互不可见，导致「生产环境每次重启都弹引导」。已删除同步版本，
 * 避免调用方误用。
 */
export async function shouldShowOnboardingAsync(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  const { completed, dismissed } = await readRemoteOnboarding()
  return !completed && !dismissed
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
          <Icons.ArrowLeft size={14} /> 上一步
        </button>
        <div className="onboarding-progress-track" aria-hidden="true">
          <motion.div
            className="onboarding-progress-fill"
            animate={{
              width: `${((getActiveStepIndex(state.step) + 1) / ONBOARDING_STEP_ITEMS.length) * 100}%`,
            }}
            transition={{ type: 'spring', stiffness: 260, damping: 32 }}
          />
        </div>
        <div className="onboarding-steps-list" role="list">
          {ONBOARDING_STEP_ITEMS.map((item, index) => {
            const activeIndex = getActiveStepIndex(state.step)
            const isActive = index === activeIndex
            const isDone = index < activeIndex
            return (
              <button
                key={item.label}
                type="button"
                role="listitem"
                className={`onboarding-step ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}`}
                aria-current={isActive ? 'step' : undefined}
                onClick={() => dispatch({ type: 'set-step', step: item.step })}
              >
                {isActive && (
                  <motion.span
                    className="onboarding-step-pill"
                    layoutId="onboarding-step-pill"
                    transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                  />
                )}
                <span className="onboarding-step-dot">
                  {isDone ? <Icons.Check size={12} /> : index + 1}
                </span>
                <span className="onboarding-step-label">{item.label}</span>
              </button>
            )
          })}
        </div>
        <button className="onboarding-skip" type="button" onClick={skip}>
          稍后再说
        </button>
      </aside>

      <main className="onboarding-main">
        <section className="onboarding-card">
          <div className="onboarding-copy">
            <AnimatePresence mode="wait">
              <motion.div
                key={state.step}
                className="onboarding-copy-inner"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
              >
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
                    dispatch={dispatch}
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
                {state.step === 'tools-guide' && (
                  <ToolsGuideStep dispatch={dispatch} onFinish={goChat} />
                )}
                {state.step === 'workflows-guide' && (
                  <WorkflowsGuideStep dispatch={dispatch} onFinish={goChat} />
                )}
                {state.step === 'board-guide' && (
                  <BoardGuideStep dispatch={dispatch} onFinish={goChat} />
                )}
                {state.step === 'media-guide' && (
                  <MediaGuideStep dispatch={dispatch} onFinish={goChat} />
                )}
                {state.step === 'done' && <DoneStep onDone={goChat} />}
                {error && <div className="onboarding-error">{error}</div>}
              </motion.div>
            </AnimatePresence>
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
          <div key={item.id} className="choice-card choice-card--static">
            <span className="choice-card-mark" aria-hidden="true" />
            <strong>{item.title}</strong>
            <span>{item.desc}</span>
          </div>
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
        <button
          type="button"
          className="source-card"
          onClick={() => dispatch({ type: 'set-model-source', modelSource: 'spark-account', step: 'spark-account' })}
        >
          <Icons.User size={22} />
          <div>
            <strong>使用 Spark 账号模型</strong>
            <span>适合大多数用户，登录后可直接购买、兑换并使用。</span>
          </div>
          <em>推荐</em>
        </button>
      </div>
      <div className="button-row">
        <SkipStepButton
          dispatch={dispatch}
          target="agent-template"
          label="跳过本步，先去创建助手"
        />
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
  const { toast } = useToast()
  const [opening, setOpening] = useState(false)

  const openPlatformModel = async (): Promise<void> => {
    if (!isAuthenticated) {
      toast.error('请先登录 Spark 账号')
      return
    }
    setOpening(true)
    try {
      await window.spark.invoke('platform-model:bootstrap', undefined)
      const usage = await window.spark.invoke('platform-model:get-usage', undefined)
      if (usage.walletQuota <= 0) {
        showPlatformQuotaGuide('onboarding')
      } else {
        toast.success('Spark 平台模型已就绪')
        dispatch({ type: 'set-step', step: 'agent-template' })
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '平台模型开通失败')
    } finally {
      setOpening(false)
    }
  }

  return (
    <>
      <p className="eyebrow">平台内置模型</p>
      <h1>使用 Spark 平台模型</h1>
      <p className="lead">
        不必申请或配置 API Key。平台模型作为一个可选 Provider，与你的第三方模型配置并存。
      </p>
      <div className="notice-card">
        {isAuthenticated
          ? `当前已登录：${account || 'Spark 账号'}`
          : '当前未登录。请先登录或注册 Spark 账号，再开通平台模型。'}
      </div>
      {!isAuthenticated ? (
        <div className="onboarding-auth-embed">
          <AuthGate />
        </div>
      ) : null}
      <div className="button-row">
        <Button onClick={() => dispatch({ type: 'set-step', step: 'model-source' })}>
          返回选择
        </Button>
        <SkipStepButton dispatch={dispatch} target="agent-template" />
        {isAuthenticated ? (
          <Button type="primary" loading={opening} disabled={opening} onClick={() => void openPlatformModel()}>
            检查额度并继续
          </Button>
        ) : null}
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
  onSubmit: () => void
  busy: boolean
  dispatch?: React.Dispatch<Action>
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
      <div className="button-row">
        {props.dispatch && <SkipStepButton dispatch={props.dispatch} target="agent-template" />}
        <Button type="primary" size="large" onClick={props.onSubmit} loading={props.busy}>
          {props.busy ? '正在测试并保存…' : '测试并保存'}
        </Button>
      </div>
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
      <div className="guide-panel">
        <div className="guide-item">
          <Icons.Skills size={22} />
          <div>
            <strong>创建后可挂载技能</strong>
            <span>
              模板只带一个默认提示词。去助手详情页的「技能」Tab，挂载已安装或从技能市场装的技能，让它掌握写
              PPT、查资料等具体流程。
            </span>
          </div>
        </div>
        <div className="guide-item">
          <Icons.Workflow size={22} />
          <div>
            <strong>还可以绑定工作流</strong>
            <span>
              把"先做 A、再做 B、最后做
              C"这类多步任务编排成工作流后绑定到助手，收到匹配任务时会自动跑完整个流程。
            </span>
          </div>
        </div>
        <div className="guide-item">
          <Icons.Edit size={22} />
          <div>
            <strong>随时改写提示词</strong>
            <span>
              上面选的模板提示词不是最终版本，在助手设置里可以随时调整语气、边界和默认行为，不用重新创建助手。
            </span>
          </div>
        </div>
      </div>
      <div className="button-row">
        <Button onClick={() => dispatch({ type: 'back' })}>返回模型测试</Button>
        <SkipStepButton dispatch={dispatch} target="first-session" />
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
        <SkipStepButton dispatch={dispatch} target="canvas-guide" />
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
      <h1>Skill 让 Agent 一次上手新能力</h1>
      <p className="lead">
        Skill 像是给 Agent 的任务手册：里面写好了应对特定场景的流程、模板、提示词与工具用法。Spark
        Agent 通过四种来源为你提供 Skill，按需取用即可。
      </p>
      <div className="guide-panel">
        <div className="guide-item">
          <Icons.Star size={22} />
          <div>
            <strong>推荐技能</strong>
            <span>
              「精选技能」Tab
              展示官方与社区挑选的常用扩展，适合不确定该装什么的时候翻一翻，踩坑更少。
            </span>
          </div>
        </div>
        <div className="guide-item">
          <Icons.Globe size={22} />
          <div>
            <strong>从技能市场安装</strong>
            <span>
              技能商店（SkillHub）里有完整的分类与搜索，覆盖写作、代码、视觉、研究等场景，按需装回「已安装」。
            </span>
          </div>
        </div>
        <div className="guide-item">
          <Icons.Sparkles size={22} />
          <div>
            <strong>举个例子：ppt-master 制作 PPT</strong>
            <span>
              想做一份产品发布 PPT，可以先去技能市场的「精选市场」安装 <code>ppt-master</code>
              ，应用会优先使用 Spark 自建安装源。装好之后，只要在输入框里写一条提示词，例如：
              <br />
              <code className="guide-prompt-example">
                用 ppt-master 帮我做一份 8 页的产品发布 PPT，主题是「X
                智能助手」，受众是潜在企业客户，风格简洁商务。
              </code>
              <br />
              Agent 会按技能里的流程自动出大纲、生成幻灯片并交付文件。
              <em>（以上仅是提示词示例，不会自动触发。）</em>
            </span>
          </div>
        </div>
      </div>
      <div className="button-row">
        <Button onClick={() => finishGuide(onFinish)}>跳过讲解，进入会话</Button>
        <Button onClick={() => dispatch({ type: 'set-step', step: 'canvas-guide' })}>
          返回画布
        </Button>
        <Button type="primary" onClick={() => dispatch({ type: 'set-step', step: 'tools-guide' })}>
          继续了解内置工具
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
        <Button onClick={() => dispatch({ type: 'set-step', step: 'board-guide' })}>
          返回任务面板
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

function ToolsGuideStep({
  dispatch,
  onFinish,
}: {
  dispatch: React.Dispatch<Action>
  onFinish: () => void
}) {
  return (
    <>
      <p className="eyebrow">可跳过教学：内置工具</p>
      <h1>Agent 自带常用的内置工具</h1>
      <p className="lead">
        不用装任何 Skill 或 MCP，Agent
        就能调用以下内置能力处理终端、检索、编辑和内容生成。你可以在输入框里直接让 Agent 使用它们。
      </p>
      <div className="guide-panel">
        <div className="guide-item">
          <Icons.Terminal size={22} />
          <div>
            <strong>终端命令</strong>
            <span>
              运行 shell 命令：构建、测试、安装依赖、查日志由 Agent 直接处理，使用前会先征得你同意。
            </span>
          </div>
        </div>
        <div className="guide-item">
          <Icons.Search size={22} />
          <div>
            <strong>本地 + 联网检索</strong>
            <span>在本地文件、项目和公开网络上检索信息，把结果带回到对话和画布里。</span>
          </div>
        </div>
        <div className="guide-item">
          <Icons.Code size={22} />
          <div>
            <strong>编辑 / Diff / 代码还原点</strong>
            <span>
              对代码和文档做精确修改：先看 diff
              再确认；关键改动会保留代码还原点，跑偏时可恢复到最近的稳定版本。
            </span>
          </div>
        </div>
        <div className="guide-item">
          <Icons.Book size={22} />
          <div>
            <strong>Spark Web Tool：一键出内容产物</strong>
            <span>
              内置技能：课件、专题讲解、数据分析报告三类任务，先和你确认内容与视觉方向，再产出 PPTX
              / HTML / DOCX / Markdown 等格式。
            </span>
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
          onClick={() => dispatch({ type: 'set-step', step: 'workflows-guide' })}
        >
          继续了解工作流
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
      <p className="eyebrow">可跳过教学：工作流</p>
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
        <Button onClick={() => dispatch({ type: 'set-step', step: 'tools-guide' })}>
          返回内置工具
        </Button>
        <Button type="primary" onClick={() => dispatch({ type: 'set-step', step: 'board-guide' })}>
          继续了解任务面板
        </Button>
      </div>
    </>
  )
}

function BoardGuideStep({
  dispatch,
  onFinish,
}: {
  dispatch: React.Dispatch<Action>
  onFinish: () => void
}) {
  return (
    <>
      <p className="eyebrow">可跳过教学：任务面板</p>
      <h1>用任务面板把待办变成可执行项</h1>
      <p className="lead">
        任务面板是类飞书看板：把要做的事拆成一张张卡片按列推进，状态变化时可以一键交给 Agent 处理，
        也能开启自动执行让 Agent 接管。
      </p>
      <div className="guide-panel">
        <div className="guide-item">
          <Icons.Board size={22} />
          <div>
            <strong>拖一拖就能推进</strong>
            <span>
              待办 / 进行中 / 已完成 / 失败 等状态按列排列，拖卡片就能换状态，多选也能批量移动。
            </span>
          </div>
        </div>
        <div className="guide-item">
          <Icons.Play size={22} />
          <div>
            <strong>一键交给 Agent</strong>
            <span>
              卡片可绑定到会话：点一下就开新会话处理；也可开启自动执行，状态变化即触发 Agent。
            </span>
          </div>
        </div>
        <div className="guide-item">
          <Icons.ListTodo size={22} />
          <div>
            <strong>附件 / 评论 / 回收站</strong>
            <span>
              每张卡片可以挂附件、留评论、设置优先级；删除后进入回收站，需要时可恢复或彻底删除。
            </span>
          </div>
        </div>
      </div>
      <div className="button-row">
        <Button onClick={() => finishGuide(onFinish)}>跳过讲解，进入会话</Button>
        <Button onClick={() => dispatch({ type: 'set-step', step: 'workflows-guide' })}>
          返回工作流
        </Button>
        <Button type="primary" onClick={() => dispatch({ type: 'set-step', step: 'media-guide' })}>
          继续了解多媒体模型
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
          继续创建助手
        </Button>
      </div>
    </>
  )
}

/**
 * 统一的抽象化插画场景：用同一套「光斑 + 旋转光环 + 图标徽章 + 声波」语言
 * 替换过去 5 张风格各异的静态贴图，只随每一步的 icon/accent 变化，
 * 既保证视觉连贯，也天然自带动效。
 */
function IllustrationScene({ icon: Icon, accent }: { icon: IconType; accent: [string, string] }) {
  const sceneStyle = { '--accent-a': accent[0], '--accent-b': accent[1] } as React.CSSProperties
  return (
    <div className="onb-scene" style={sceneStyle}>
      <div className="onb-scene-grid" />
      <span className="onb-scene-blob onb-scene-blob-a" />
      <span className="onb-scene-blob onb-scene-blob-b" />
      <span className="onb-scene-blob onb-scene-blob-c" />
      <div className="onb-scene-orbit onb-scene-orbit-1">
        <span />
      </div>
      <div className="onb-scene-orbit onb-scene-orbit-2">
        <span />
      </div>
      <div className="onb-scene-badge">
        <Icon size={32} />
      </div>
      <div className="onb-scene-wave">
        {Array.from({ length: 7 }).map((_, i) => (
          <span key={i} style={{ animationDelay: `${i * 0.11}s` }} />
        ))}
      </div>
    </div>
  )
}

function OnboardingVisual({ step }: { step: OnboardingStep }) {
  const visual = visualByStep[step]
  return (
    <div className="onboarding-visual" aria-hidden="true">
      <div className="visual-stage">
        <div className="visual-topline">
          <span>{visual.kicker}</span>
        </div>
        <div className="visual-preview">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              className="visual-preview-inner"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            >
              <IllustrationScene icon={visual.icon} accent={visual.accent} />
            </motion.div>
          </AnimatePresence>
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
