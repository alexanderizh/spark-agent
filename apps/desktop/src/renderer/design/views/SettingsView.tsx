/**
 * SettingsView — 多分类设置（通用/外观/快捷键/模型/规则/权限/MCP/工作流/遥测/存储/更新）
 *
 * 包含：左侧分组导航 + 右侧多 section 内容。Profile 编辑使用 Modal。
 * 注意：Provider 配置 UI 已抽到 ProvidersView.tsx（侧边栏一级菜单）。
 */
import React, { useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { Button, Input, InputNumber, Modal, Segmented, Select, Tag, TextArea } from '@lobehub/ui'
// TODO(lobe-migration): @lobehub/ui 没有 Switch 命名导出;从 antd 引用,与项目其他 view 保持一致
import { Switch } from 'antd'
import { QRCodeSVG } from '@rc-component/qrcode'
import { Icons } from '../Icons'
import { useApp, PRIMARIES } from '../AppContext'
import { useIpcInvoke } from '../hooks/useIpc'
import { useToast } from '../components/Toast'
import { ModelCapabilityRegistry } from '@spark/shared'
import { PlaywrightStatusCard } from './PlaywrightStatusCard'
import { canvasApi } from './canvas/canvas.api'
import { resolveSupportedLanguage, SUPPORTED_LANGUAGES, useI18n } from '../i18n'
// Provider 相关 UI 已抽到 ProvidersView；保留 ProviderEditPanel 的 re-export
// 以便现有测试（apps/desktop/src/renderer/tests/renderer.test.ts）等其他消费者
// 仍能通过原路径 import。
export { ProviderEditPanel } from './ProvidersView'
import type {
  SessionAgentAdapter,
  SessionPermissionMode,
  PermissionMode,
  PermissionProfileItem,
  RuleItem,
  RuleScope,
  WorkspaceInfo,
  ModelProfile,
  ProviderProfile,
  // MCP 设置暂未完全实现，保留类型导入以便后续启用
  McpServerItem,
  UpdateStatus,
  SdkIntegrityItem,
  RuntimeToolStatus,
  SessionListResponse,
  RemoteChannelType,
  RemoteCommandDefinition,
  RemoteConnectionCapabilities,
  RemoteConnectionConfig,
  RemotePairingMode,
  RemoteRuntimeStatusResponse,
} from '@spark/protocol'

// 工作流模板暂未实现，保留类型定义以便后续启用
type WorkflowTemplate = {
  id: string
  name: string
  desc: string
  nodes: number
  updatedAt: string
}

const SANDBOX_LEVEL_KEY = 'spark-sandbox-level'
const AUDIT_ENABLED_KEY = 'spark-audit-enabled'
// 工作流模板暂未实现，保留常量定义以便后续启用
const WORKFLOW_TEMPLATES_KEY = 'spark-workflow-templates'
const COMPOSER_PREFS_KEY = 'spark-agent:composer-prefs'
const RUNTIME_PERMISSION_SETTINGS_CATEGORY = 'runtime-permissions'
const RUNTIME_PERMISSION_SETTINGS_KEY = 'defaults'

// 远程连接：记住用户上次新建/切换的渠道，方便"新建连接"卡片一键复用
const REMOTE_LAST_CHANNEL_CATEGORY = 'remote-connections'
const REMOTE_LAST_CHANNEL_KEY = 'last-channel'

function deferEffect(task: () => void | Promise<void>): () => void {
  const id = window.setTimeout(() => {
    void task()
  }, 0)
  return () => window.clearTimeout(id)
}

/* ─── Settings persistence keys ─── */
const SETTINGS_GENERAL_KEY = 'spark-settings-general'
const SETTINGS_UPDATED_EVENT = 'spark-settings-updated'
const SETTINGS_APPEARANCE_KEY = 'spark-settings-appearance'
const SETTINGS_TELEMETRY_KEY = 'spark-settings-telemetry'
const SETTINGS_UPDATES_KEY = 'spark-settings-updates'
const sparkPlatform = typeof window !== 'undefined' ? window.spark?.platform : undefined
const isPlatformDarwin = sparkPlatform === 'darwin'
const isPlatformWin32 = sparkPlatform === 'win32'
const RELEASES_URL = 'https://github.com/alexanderizh/spark-agent/releases'

const REMOTE_CHANNEL_LABELS: Record<RemoteChannelType, string> = {
  telegram: 'Telegram',
  feishu: '飞书机器人',
  qq: 'QQ 机器人',
  'wechat-claw': '微信 Claw',
}

const REMOTE_STATUS_LABELS: Record<RemoteConnectionConfig['status'], string> = {
  disabled: '已停用',
  draft: '草稿',
  'pending-pairing': '等待配对',
  connected: '已连接',
  error: '错误',
}

/* ─── Category mapping (localStorage key → IPC category) ─── */
function localStorageKeyToCategory(key: string): string {
  return key.replace('spark-settings-', '')
}

type GeneralSettings = {
  userName: string
  language: string
  startupBehavior: string
  defaultWorkspace: string
  systemTray: boolean
  autoStart: boolean
  defaultSandbox: number
  unsavedPrompt: boolean
  checkpointRetention: number
  notifyTaskComplete: boolean
  notifyPermission: boolean
  notifyWorkflowFail: boolean
  notifyMcpOffline: boolean
  notifyNewVersion: boolean
  anonymousTelemetry: boolean
  autoDiagPackage: boolean
}

type AppearanceSettings = {
  font: string
  fontSize: number
  codeLigature: boolean
  windowCorners: string
  backdropBlur: boolean
  autoCollapseTools: boolean
  inlineTokenCount: boolean
  syntaxHighlight: boolean
  timestampFormat: string
}

type TelemetrySettings = {
  logLevel: string
  otlpEndpoint: string
  traceSamplingRate: number
  traceRetentionDays: number
}

type UpdatesSettings = {
  autoCheck: boolean
  autoDownload: boolean
  autoInstall: boolean
  channel: string
}

type RuntimePermissionPrefs = {
  adapter?: SessionAgentAdapter
  permissionMode?: SessionPermissionMode
}

type RuntimePermissionSettings = {
  adapter: SessionAgentAdapter
  permissionMode: SessionPermissionMode
}

type RuntimePermissionModeOption = {
  value: SessionPermissionMode
  label: string
  desc: string
  tone?: 'auto' | 'danger'
}

const DEFAULT_GENERAL: GeneralSettings = {
  userName: 'User',
  language: resolveSupportedLanguage(undefined),
  startupBehavior: 'last',
  defaultWorkspace: '',
  systemTray: true,
  autoStart: false,
  defaultSandbox: 2,
  unsavedPrompt: true,
  checkpointRetention: 50,
  notifyTaskComplete: true,
  notifyPermission: true,
  notifyWorkflowFail: true,
  notifyMcpOffline: false,
  notifyNewVersion: true,
  anonymousTelemetry: true,
  autoDiagPackage: true,
}

const DEFAULT_APPEARANCE: AppearanceSettings = {
  font: 'geist',
  fontSize: 14,
  codeLigature: false,
  windowCorners: 'soft',
  backdropBlur: false,
  autoCollapseTools: true,
  inlineTokenCount: false,
  syntaxHighlight: true,
  timestampFormat: 'rel',
}

const DEFAULT_TELEMETRY: TelemetrySettings = {
  logLevel: 'info',
  otlpEndpoint: '',
  traceSamplingRate: 100,
  traceRetentionDays: 14,
}

const DEFAULT_UPDATES: UpdatesSettings = {
  autoCheck: true,
  autoDownload: false,
  autoInstall: false,
  channel: 'stable',
}

/**
 * Persisted settings hook — dual-layer persistence:
 *
 *   1. localStorage (sync, instant UI render)
 *   2. SQLite via IPC (durable, survives app data reset)
 *
 * On mount, reads from localStorage for instant render, then async loads
 * from IPC (SQLite) to get the authoritative value. On update, writes to
 * both localStorage and IPC (fire-and-forget).
 */
function usePersistedSettings<T>(key: string, defaults: T): [T, (patch: Partial<T>) => void] {
  const category = localStorageKeyToCategory(key)
  const [state, setState] = React.useState<T>(() => readStoredJson(key, defaults))
  const loadedRef = React.useRef(false)

  // Load from IPC on mount (authoritative source)
  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true
    window.spark
      ?.invoke('settings:get', { category, key: 'data' })
      .then((res) => {
        if (res.value != null && typeof res.value === 'object') {
          const merged = { ...defaults, ...(res.value as Partial<T>) }
          setState(merged)
          writeStoredJson(key, merged)
        }
      })
      .catch(() => {
        // IPC not available — use localStorage fallback
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const update = useCallback(
    (patch: Partial<T>) => {
      setState((prev) => {
        const next = { ...prev, ...patch }
        writeStoredJson(key, next)
        // Persist to IPC/SQLite (fire-and-forget)
        window.spark?.invoke('settings:set', { category, key: 'data', value: next }).catch(() => {
          /* ignore IPC errors */
        })
        return next
      })
    },
    [key, category],
  )
  return [state, update]
}

// 工作流模板暂未实现，保留默认模板数据以便后续启用
const DEFAULT_WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'template:agent-dev',
    name: 'Agent 开发流程',
    desc: '需求分析、计划、编码、测试、审查',
    nodes: 6,
    updatedAt: '内置模板',
  },
  {
    id: 'template:research',
    name: '资料研究流程',
    desc: '检索、摘要、交叉验证、报告生成',
    nodes: 4,
    updatedAt: '内置模板',
  },
]

function readStoredJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  const raw = window.localStorage.getItem(key)
  if (raw === null) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeStoredJson<T>(key: string, value: T) {
  window.localStorage.setItem(key, JSON.stringify(value))
  window.dispatchEvent(new CustomEvent(SETTINGS_UPDATED_EVENT, { detail: { key } }))
}

export function SettingsView() {
  const { t, setTweak } = useApp()
  const section = t.settingsSection || 'general'
  const setSection = (s: string) => setTweak('settingsSection', s)

  const nav = [
    {
      group: '通用',
      items: [
        { id: 'general', icon: <Icons.Settings />, label: '通用' },
        { id: 'appearance', icon: <Icons.Sparkles />, label: '外观' },
        { id: 'shortcuts', icon: <Icons.Command />, label: '快捷键' },
      ],
    },
    {
      group: 'Agent',
      items: [
        { id: 'rules', icon: <Icons.Beaker />, label: '规则' },
        { id: 'permissions', icon: <Icons.Shield />, label: '权限策略' },
      ],
    },
    {
      group: '生态',
      items: [
        // MCP 设置暂未完全实现，隐藏导航项
        // { id: 'mcp-settings', icon: <Icons.MCP />, label: 'MCP' },
        { id: 'remote-connections', icon: <Icons.Globe />, label: '远程连接' },
        { id: 'system-prompt', icon: <Icons.Chat />, label: '系统提示词' },
        // 工作流模板暂未实现，隐藏导航项
        // { id: 'workflows', icon: <Icons.Workflow />, label: '工作流模板' },
      ],
    },
    {
      group: '系统',
      items: [
        { id: 'integrity', icon: <Icons.Shield />, label: '完整性' },
        { id: 'playwright', icon: <Icons.Globe />, label: '浏览器自动化' },
        { id: 'usage', icon: <Icons.Activity />, label: '用量统计' },
        { id: 'telemetry', icon: <Icons.Activity />, label: '遥测与日志' },
        { id: 'hooks', icon: <Icons.Bell />, label: 'Hooks' },
        { id: 'storage', icon: <Icons.Database />, label: '存储与备份' },
        { id: 'archived', icon: <Icons.Archive />, label: '已归档' },
        { id: 'updates', icon: <Icons.Refresh />, label: '更新' },
        { id: 'about', icon: <Icons.Sparkles />, label: '关于' },
      ],
    },
  ]

  const Section: Record<string, () => React.ReactElement> = {
    general: GeneralSection,
    appearance: AppearanceSection,
    shortcuts: ShortcutsSection,
    rules: RulesSection,
    permissions: PermissionsSection,
    // MCP 设置暂未完全实现，隐藏
    // 'mcp-settings': McpSection,
    'remote-connections': RemoteConnectionsSection,
    'system-prompt': SystemPromptSection,
    // 工作流模板暂未实现，隐藏
    // workflows: WorkflowTemplatesSection,
    integrity: IntegritySection,
    playwright: PlaywrightStatusCard,
    telemetry: TelemetrySection,
    hooks: HooksSection,
    storage: StorageSection,
    usage: UsageSection,
    archived: ArchivedSection,
    updates: UpdatesSection,
    about: AboutSection,
  }
  const SectionBody = Section[section]

  return (
    <div className="settings-layout">
      <div className="settings-nav scroll">
        {nav.map((g) => (
          <div key={g.group}>
            <div className="settings-nav-h">{g.group}</div>
            {g.items.map((it) => (
              <button
                key={it.id}
                className={`nav-item ${section === it.id ? 'active' : ''}`}
                onClick={() => setSection(it.id)}
              >
                <span className="nav-icon">{it.icon}</span>
                <span className="nav-label">{it.label}</span>
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="settings-content scroll">
        {isPlatformDarwin && (
          <div
            className="settings-drag-header"
            onDoubleClick={() => {
              window.spark?.invoke('window:maximize', {}).catch(() => {})
            }}
          />
        )}
        {SectionBody != null ? <SectionBody /> : <PlaceholderSection name={section} />}
      </div>
    </div>
  )
}

/* ───────── GENERAL ───────── */
function GeneralSection() {
  const { setTweak } = useApp()
  const { t: tr } = useI18n()
  const [s, set] = usePersistedSettings(SETTINGS_GENERAL_KEY, DEFAULT_GENERAL)
  const { invoke: openDirectory } = useIpcInvoke('dialog:open-directory')
  const [autoStartSupported, setAutoStartSupported] = useState(true)
  const [autoStartBusy, setAutoStartBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.spark
      ?.invoke('app:get-startup-settings', {})
      .then((res) => {
        if (cancelled) return
        setAutoStartSupported(res.supported)
        if (res.openAtLogin !== s.autoStart) {
          set({ autoStart: res.openAtLogin })
        }
      })
      .catch(() => {
        if (!cancelled) setAutoStartSupported(false)
      })
    return () => {
      cancelled = true
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleBrowseWorkspace = async () => {
    try {
      const selected = await openDirectory({ title: '选择默认工作区' })
      if (!selected.canceled && selected.filePath !== undefined) {
        set({ defaultWorkspace: selected.filePath })
      }
    } catch {
      /* user cancelled */
    }
  }

  const handleToggleAutoStart = async () => {
    if (!autoStartSupported || autoStartBusy) return
    const next = !s.autoStart
    setAutoStartBusy(true)
    set({ autoStart: next })
    try {
      const res = await window.spark.invoke('app:set-startup-settings', {
        openAtLogin: next,
        openAsHidden: true,
      })
      setAutoStartSupported(res.supported)
      set({ autoStart: res.openAtLogin })
    } catch {
      set({ autoStart: !next })
    } finally {
      setAutoStartBusy(false)
    }
  }

  return (
    <div className="settings-section">
      <h2>通用</h2>
      <div className="lede">应用启动、语言、默认行为。</div>

      <div className="settings-card" style={{marginBottom: 10}}>
        <SettingsRow
          title="新手引导"
          desc="重新打开安装后的图文引导，配置模型、助手并发起第一次会话。"
          right={
            <button
              className="btn"
              onClick={() => {
                window.localStorage.removeItem('spark-agent:onboarding-completed')
                window.localStorage.removeItem('spark-agent:onboarding-dismissed')
                setTweak('view', 'onboarding')
              }}
            >
              重新打开
            </button>
          }
        />
      </div>

      <div className="form-grid">
        <label>
          语言<span className="sub">界面文案语言</span>
        </label>
        <Select
          value={resolveSupportedLanguage(s.language)}
          onChange={(v) => set({ language: resolveSupportedLanguage(v) })}
          options={SUPPORTED_LANGUAGES.map((language) => ({
            label: tr(language === 'zh-CN' ? 'settings.general.language.zh' : 'settings.general.language.en'),
            value: language,
          }))}
        />

        <label>
          启动行为<span className="sub">应用启动时的默认动作</span>
        </label>
        <Select
          value={s.startupBehavior}
          onChange={(v) => set({ startupBehavior: v })}
          options={[
            { label: '恢复上次会话', value: 'last' },
            { label: '打开 Home', value: 'home' },
            { label: '打开上次项目', value: 'last-project' },
            { label: '空白会话', value: 'blank' },
          ]}
        />

        <label>
          默认工作区<span className="sub">新建项目会话时的预选根目录</span>
        </label>
        <div className="control">
          <Input
            className="flex1"
            value={s.defaultWorkspace || ''}
            onChange={(e) => set({ defaultWorkspace: e.target.value })}
            placeholder="点击浏览选择…"
          />
          <Button size="small" type="default" icon={<Icons.Folder size={12} />} onClick={() => void handleBrowseWorkspace()}>
            浏览…
          </Button>
        </div>

        <label>
          系统托盘<span className="sub">关闭主窗口后保留后台运行</span>
        </label>
        <Switch
          size="small"
          checked={s.systemTray}
          onChange={(v) => set({ systemTray: v })}
        />

        <label>
          开机自启动
          <span className="sub">
            {autoStartSupported ? '登录系统后自动启动 Spark Agent' : '当前系统环境不支持读取登录项'}
          </span>
        </label>
        <Switch
          size="small"
          checked={s.autoStart}
          loading={autoStartBusy}
          disabled={!autoStartSupported}
          onChange={() => void handleToggleAutoStart()}
        />

        <label>新会话默认沙箱</label>
        <Segmented
          value={s.defaultSandbox}
          onChange={(v) => set({ defaultSandbox: Number(v) as 0 | 1 | 2 | 3 })}
          options={[
            { label: 'L0 仅聊天', value: 0 },
            { label: 'L1 只读', value: 1 },
            { label: 'L2 受控', value: 2 },
            { label: 'L3 完全', value: 3 },
          ]}
        />

        <label>
          未保存修改提示<span className="sub">关闭会话或退出前提示</span>
        </label>
        <Switch
          size="small"
          checked={s.unsavedPrompt}
          onChange={(v) => set({ unsavedPrompt: v })}
        />

        <label>
          检查点保留<span className="sub">每个会话保留多少历史检查点</span>
        </label>
        <div className="control">
          <InputNumber
            min={10}
            max={500}
            step={10}
            value={s.checkpointRetention}
            onChange={(v) => set({ checkpointRetention: typeof v === 'number' ? v : 50 })}
            addonAfter="个"
            className="input-w-sm"
          />
          <span className="muted text-xs-12">超出后按时间淘汰</span>
        </div>
      </div>

      <div className="subsec-h">通知</div>
      <div className="settings-card">
        <SettingsRow
          title="任务完成"
          desc="长任务（≥30s）结束后系统通知"
          right={
            <Switch
              size="small"
              checked={s.notifyTaskComplete}
              onChange={(v) => set({ notifyTaskComplete: v })}
            />
          }
        />
        <SettingsRow
          title="权限请求"
          desc="需要审批时弹出系统通知"
          right={
            <Switch
              size="small"
              checked={s.notifyPermission}
              onChange={(v) => set({ notifyPermission: v })}
            />
          }
        />
        <SettingsRow
          title="工作流失败"
          desc="任意节点失败时通知"
          right={
            <Switch
              size="small"
              checked={s.notifyWorkflowFail}
              onChange={(v) => set({ notifyWorkflowFail: v })}
            />
          }
        />
        <SettingsRow
          title="MCP 离线"
          desc="服务器连接断开时通知"
          right={
            <Switch
              size="small"
              checked={s.notifyMcpOffline}
              onChange={(v) => set({ notifyMcpOffline: v })}
            />
          }
        />
        <SettingsRow
          title="新版本可用"
          right={
            <Switch
              size="small"
              checked={s.notifyNewVersion}
              onChange={(v) => set({ notifyNewVersion: v })}
            />
          }
        />
      </div>

      <div className="subsec-h">隐私</div>
      <div className="settings-card">
        <SettingsRow
          title="匿名遥测"
          desc="发送匿名使用与崩溃数据，帮助改进 Spark Agent"
          right={
            <Switch
              size="small"
              checked={s.anonymousTelemetry}
              onChange={(v) => set({ anonymousTelemetry: v })}
            />
          }
        />
        <SettingsRow
          title="自动诊断包"
          desc="崩溃时自动收集脱敏诊断包（不含密钥与代码）"
          right={
            <Switch
              size="small"
              checked={s.autoDiagPackage}
              onChange={(v) => set({ autoDiagPackage: v })}
            />
          }
        />
      </div>
    </div>
  )
}

/* ───────── REMOTE CONNECTIONS ───────── */
const DEFAULT_REMOTE_CAPABILITIES: RemoteConnectionCapabilities = {
  sendMessages: true,
  switchModel: true,
  switchSession: true,
  switchAgent: true,
  manageWorkspace: true,
  runCommands: true,
  approvePermissions: false,
  observeDesktop: true,
  controlDesktop: false,
  transferFiles: false,
  manageRuntime: false,
  dangerousActions: false,
}

function splitCsv(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function joinCsv(value: string[] | undefined): string {
  return (value ?? []).join(', ')
}

function createRemoteDraft(channel: RemoteChannelType): RemoteConnectionConfig {
  const now = new Date().toISOString()
  return {
    id: '',
    channel,
    name: REMOTE_CHANNEL_LABELS[channel],
    enabled: false,
    status: 'draft',
    credentials: {},
    commandPrefix: '/',
    allowedUserIds: [],
    allowedChatIds: [],
    telegramCommands: ['help', 'sessions', 'models', 'agents', 'status'],
    capabilities: { ...DEFAULT_REMOTE_CAPABILITIES },
    pairedDevices: [],
    createdAt: now,
    updatedAt: now,
  }
}

function RemoteConnectionsSection() {
  const { toast } = useToast()
  const { invoke: getSetting } = useIpcInvoke('settings:get')
  const { invoke: setSetting } = useIpcInvoke('settings:set')
  const [connections, setConnections] = useState<RemoteConnectionConfig[]>([])
  const [commands, setCommands] = useState<RemoteCommandDefinition[]>([])
  const [sessions, setSessions] = useState<SessionListResponse['sessions']>([])
  const [runtimeStatus, setRuntimeStatus] = useState<RemoteRuntimeStatusResponse>({
    running: false,
    port: null,
    localBaseUrl: null,
    polling: [],
    longConnections: [],
  })
  const [selectedId, setSelectedId] = useState<string>('')
  const [lastChannel, setLastChannel] = useState<RemoteChannelType>('telegram')
  const [draft, setDraft] = useState<RemoteConnectionConfig>(() => createRemoteDraft('telegram'))
  const [editorOpen, setEditorOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [manualPairUser, setManualPairUser] = useState('')
  const [manualPairName, setManualPairName] = useState('')

  // 加载"上次新建/选择的渠道"，失败或不存在则保持默认 telegram。
  useEffect(() => {
    let cancelled = false
    getSetting({ category: REMOTE_LAST_CHANNEL_CATEGORY, key: REMOTE_LAST_CHANNEL_KEY })
      .then((res) => {
        if (cancelled) return
        if (res && typeof res.value === 'string' && res.value in REMOTE_CHANNEL_LABELS) {
          setLastChannel(res.value as RemoteChannelType)
        }
      })
      .catch(() => {
        // 静默失败，不阻塞 UI
      })
    return () => {
      cancelled = true
    }
  }, [getSetting])

  const rememberChannel = useCallback(
    (channel: RemoteChannelType) => {
      setLastChannel(channel)
      void setSetting({
        category: REMOTE_LAST_CHANNEL_CATEGORY,
        key: REMOTE_LAST_CHANNEL_KEY,
        value: channel,
      }).catch(() => {
        // 持久化失败不影响当前 UI
      })
    },
    [setSetting],
  )

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await window.spark.invoke('remote:list', {})
      setConnections(res.connections)
      setCommands(res.commandCatalog)
      const [runtime, sessionRes] = await Promise.all([
        window.spark.invoke('remote:runtime-status', {}),
        window.spark.invoke('session:list', { includeArchived: false, limit: 60 }),
      ])
      setRuntimeStatus(runtime)
      setSessions(sessionRes.sessions)
      if (res.connections.length > 0) {
        const next = res.connections.find((item) => item.id === selectedId) ?? res.connections[0]
        if (next == null) return
        setSelectedId(next.id)
        setDraft(next)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载远程连接失败')
    } finally {
      setLoading(false)
    }
  }, [selectedId, toast])

  useEffect(() => {
    return deferEffect(refresh)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return window.spark.on('stream:remote:changed', () => {
      void refresh()
    })
  }, [refresh])

  const refreshRuntime = useCallback(async () => {
    try {
      const status = await window.spark.invoke('remote:runtime-status', {})
      setRuntimeStatus(status)
    } catch {
      setRuntimeStatus({
        running: false,
        port: null,
        localBaseUrl: null,
        polling: [],
        longConnections: [],
      })
    }
  }, [])

  const updateDraft = (patch: Partial<RemoteConnectionConfig>) => {
    setDraft((prev) => ({ ...prev, ...patch }))
  }

  const updateCredential = (key: keyof RemoteConnectionConfig['credentials'], value: string) => {
    setDraft((prev) => ({ ...prev, credentials: { ...prev.credentials, [key]: value } }))
  }

  const updateCapability = (key: keyof RemoteConnectionCapabilities, value: boolean) => {
    setDraft((prev) => ({
      ...prev,
      capabilities: { ...prev.capabilities, [key]: value },
    }))
  }

  const saveDraft = async () => {
    setBusy('save')
    try {
      const payload: Partial<RemoteConnectionConfig> &
        Pick<RemoteConnectionConfig, 'channel' | 'name'> = {
        ...draft,
        status: draft.enabled ? draft.status : 'disabled',
      }
      // 新建草稿时 createRemoteDraft 把 id 初始化成 ''，spread 会把它带进来，
      // 这里统一清掉，让服务端按缺失 id 处理（service 会自动 createId）。
      if (!draft.id) delete (payload as { id?: string }).id
      else payload.id = draft.id
      const res = await window.spark.invoke('remote:save', { connection: payload })
      setConnections((prev) => {
        const exists = prev.some((item) => item.id === res.connection.id)
        return exists
          ? prev.map((item) => (item.id === res.connection.id ? res.connection : item))
          : [res.connection, ...prev]
      })
      setSelectedId(res.connection.id)
      setDraft(res.connection)
      setEditorOpen(true)
      await refreshRuntime()
      toast.success('远程连接已保存')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setBusy(null)
    }
  }

  const createBotDraft = async (channel: RemoteChannelType) => {
    setBusy(`create:${channel}`)
    try {
      const res = await window.spark.invoke('remote:create-bot-draft', {
        channel,
        openConsole: true,
      })
      setConnections((prev) => [res.connection, ...prev])
      setSelectedId(res.connection.id)
      setDraft(res.connection)
      setEditorOpen(true)
      rememberChannel(channel)
      await refreshRuntime()
      toast.success(`已创建 ${REMOTE_CHANNEL_LABELS[channel]} 草稿并打开平台入口`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建草稿失败')
    } finally {
      setBusy(null)
    }
  }

  const testConnection = async () => {
    if (!draft.id) {
      toast.error('请先保存连接')
      return
    }
    setBusy('test')
    try {
      const res = await window.spark.invoke('remote:test', { id: draft.id })
      toast[res.ok ? 'success' : 'error'](res.message)
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '测试失败')
    } finally {
      setBusy(null)
    }
  }

  const generatePairing = async (mode: RemotePairingMode) => {
    if (!draft.id) {
      toast.error('请先保存连接')
      return
    }
    setBusy(`pair:${mode}`)
    try {
      const res = await window.spark.invoke('remote:generate-pairing', { id: draft.id, mode })
      setConnections((prev) =>
        prev.map((item) => (item.id === res.connection.id ? res.connection : item)),
      )
      setDraft(res.connection)
      await refreshRuntime()
      toast.success(mode === 'qr' ? '二维码配对负载已生成' : '配对码已生成')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '生成配对失败')
    } finally {
      setBusy(null)
    }
  }

  const confirmPairing = async () => {
    if (!draft.id || draft.pairing == null) return
    if (manualPairUser.trim().length === 0) {
      toast.error('请输入远程用户 ID')
      return
    }
    setBusy('confirm-pair')
    try {
      const res = await window.spark.invoke('remote:confirm-pairing', {
        id: draft.id,
        code: draft.pairing.code,
        remoteUserId: manualPairUser.trim(),
        ...(manualPairName.trim().length > 0 ? { displayName: manualPairName.trim() } : {}),
      })
      setConnections((prev) =>
        prev.map((item) => (item.id === res.connection.id ? res.connection : item)),
      )
      setDraft(res.connection)
      await refreshRuntime()
      toast.success('配对已确认')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '确认配对失败')
    } finally {
      setBusy(null)
    }
  }

  const deleteConnection = async () => {
    if (!draft.id) {
      setDraft(createRemoteDraft(draft.channel))
      return
    }
    setBusy('delete')
    try {
      await window.spark.invoke('remote:delete', { id: draft.id })
      const next = connections.filter((item) => item.id !== draft.id)
      setConnections(next)
      if (next[0] != null) {
        setSelectedId(next[0].id)
        setDraft(next[0])
      } else {
        setSelectedId('')
        setDraft(createRemoteDraft('telegram'))
      }
      setEditorOpen(false)
      await refreshRuntime()
      toast.success('连接已删除')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败')
    } finally {
      setBusy(null)
    }
  }

  const webhookUrl =
    runtimeStatus.localBaseUrl != null && draft.id
      ? `${runtimeStatus.localBaseUrl}/remote/webhook/${draft.channel}/${draft.id}`
      : ''
  const polling = runtimeStatus.polling.find((item) => item.connectionId === draft.id)
  const longConnection = runtimeStatus.longConnections.find(
    (item) => item.connectionId === draft.id,
  )
  const selectedSession = sessions.find((item) => item.id === draft.defaultSessionId)

  return (
    <div className="settings-section remote-settings">
      <h2>远程连接</h2>
      <div className="lede">
        通过 Telegram、飞书、QQ、微信 Claw 从远程桌面或移动端与 Spark Agent 通信。
      </div>

      <div className="remote-create-strip">
        {(Object.keys(REMOTE_CHANNEL_LABELS) as RemoteChannelType[]).map((channel) => (
          <Button
            key={channel}
            size="small"
            type={draft.channel === channel ? 'primary' : 'default'}
            loading={busy === `create:${channel}`}
            onClick={() => void createBotDraft(channel)}
          >
            一键创建 {REMOTE_CHANNEL_LABELS[channel]}
          </Button>
        ))}
      </div>

      <div className="remote-runtime-bar">
        <div>
          <strong>{runtimeStatus.running ? '运行中' : '未运行'}</strong>
          <span>
            {runtimeStatus.localBaseUrl != null
              ? `本地入口 ${runtimeStatus.localBaseUrl}`
              : '本地 webhook 服务未启动'}
          </span>
        </div>
        <Button size="small" onClick={() => void refreshRuntime()}>
          刷新状态
        </Button>
      </div>

      <div className="remote-card-grid">
        <button
          className={`remote-connection-card ${draft.id === '' ? 'active' : ''}`}
          onClick={() => {
            setSelectedId('')
            setDraft(createRemoteDraft(lastChannel))
            setEditorOpen(true)
          }}
        >
          <span className="remote-card-main">
            <span className="remote-card-title">新建连接</span>
            <span className="remote-card-desc">上次：{REMOTE_CHANNEL_LABELS[lastChannel]}</span>
          </span>
          <Icons.Plus size={14} />
        </button>
        {loading && <div className="remote-muted-box">加载中...</div>}
        {connections.map((item) => (
          <button
            key={item.id}
            className={`remote-connection-card ${selectedId === item.id ? 'active' : ''}`}
            onClick={() => {
              setSelectedId(item.id)
              setDraft(item)
              setManualPairUser('')
              setManualPairName('')
              setEditorOpen(true)
            }}
          >
            <span className="remote-card-main">
              <span className="remote-card-title">{item.name}</span>
              <span className="remote-card-desc">{REMOTE_CHANNEL_LABELS[item.channel]}</span>
            </span>
            <Tag
              size="small"
              color={
                item.status === 'connected' ? 'green' : item.status === 'error' ? 'red' : 'blue'
              }
            >
              {REMOTE_STATUS_LABELS[item.status]}
            </Tag>
          </button>
        ))}
      </div>

      <Modal
        open={editorOpen}
        title={draft.id ? `编辑 ${draft.name}` : '新建远程连接'}
        footer={null}
        onCancel={() => setEditorOpen(false)}
        className="remote-editor-modal"
        maskClosable={false}
      >
        <div className="remote-editor">
          <div className="remote-actions remote-actions-sticky">
            <Button
              type="primary"
              size="small"
              loading={busy === 'save'}
              onClick={() => void saveDraft()}
            >
              保存连接
            </Button>
            <Button
              size="small"
              loading={busy === 'test'}
              disabled={!draft.id}
              onClick={() => void testConnection()}
            >
              测试配置
            </Button>
            <Button
              size="small"
              danger
              loading={busy === 'delete'}
              onClick={() => void deleteConnection()}
            >
              删除
            </Button>
          </div>

          <div className="subsec-h">连接配置</div>
          <div className="form-grid remote-form-grid">
            <label>
              渠道<span className="sub">同一时间可以启用多个渠道</span>
            </label>
            <Select
              value={draft.channel}
              onChange={(v) => {
                const channel = v as RemoteChannelType
                updateDraft({ channel, name: draft.name || REMOTE_CHANNEL_LABELS[channel] })
                rememberChannel(channel)
              }}
              options={[
                { label: 'Telegram', value: 'telegram' },
                { label: '飞书机器人', value: 'feishu' },
                { label: 'QQ 机器人', value: 'qq' },
                { label: '微信 Claw', value: 'wechat-claw' },
              ]}
            />

            <label>连接名称</label>
            <Input value={draft.name} onChange={(e) => updateDraft({ name: e.target.value })} />

            <label>
              启用连接<span className="sub">停用后不会接收远程消息</span>
            </label>
            <Switch
              size="small"
              checked={draft.enabled}
              onChange={(v) => updateDraft({ enabled: v })}
            />

            <label>
              命令前缀<span className="sub">Telegram 可同步为 bot command</span>
            </label>
            <Input
              value={draft.commandPrefix}
              onChange={(e) => updateDraft({ commandPrefix: e.target.value || '/' })}
            />

            <label>
              默认会话<span className="sub">普通远程消息会投递到这里</span>
            </label>
            <Select
              value={draft.defaultSessionId ?? ''}
              onChange={(v) => {
                const value = v
                setDraft((prev) => {
                  const next = { ...prev }
                  if (value) next.defaultSessionId = value
                  else delete next.defaultSessionId
                  return next
                })
              }}
              options={[
                { label: '未选择', value: '' },
                ...sessions.map((session) => ({
                  label: `${session.title || '新会话'} · ${session.id}`,
                  value: session.id,
                })),
              ]}
            />

            <RemoteCredentialFields draft={draft} updateCredential={updateCredential} />

            <label>
              允许用户 ID<span className="sub">英文逗号或换行分隔，留空表示配对后允许</span>
            </label>
            <TextArea
              value={joinCsv(draft.allowedUserIds)}
              onChange={(e) => updateDraft({ allowedUserIds: splitCsv(e.target.value) })}
              rows={2}
            />

            <label>
              允许会话/群 ID<span className="sub">用于群聊、频道或飞书群限制</span>
            </label>
            <TextArea
              value={joinCsv(draft.allowedChatIds)}
              onChange={(e) => updateDraft({ allowedChatIds: splitCsv(e.target.value) })}
              rows={2}
            />
          </div>

          {draft.channel === 'telegram' && (
            <>
              <div className="subsec-h">Telegram 命令</div>
              <div className="remote-muted-box">
                {polling?.running
                  ? 'Telegram polling 已启动，无需公网 webhook；发送 /bind 配对码 后即可使用。'
                  : polling?.lastError != null
                    ? `Telegram polling 未启动：${polling.lastError}`
                    : '保存并启用 Telegram Bot Token 后会自动启动 polling。'}
              </div>
              <TextArea
                value={draft.telegramCommands.join('\n')}
                onChange={(e) => updateDraft({ telegramCommands: splitCsv(e.target.value) })}
                rows={5}
                placeholder="help&#10;sessions&#10;models&#10;agents"
              />
            </>
          )}

          {draft.channel === 'feishu' && (
            <>
              <div className="subsec-h">飞书长连接</div>
              <div className="remote-muted-box">
                {longConnection?.running
                  ? '飞书 WebSocket 长连接已启动，无需公网 webhook；在飞书里发送 /bind 配对码 后即可使用。'
                  : longConnection?.lastError != null
                    ? `飞书长连接未启动：${longConnection.lastError}`
                    : '保存并启用 App ID / App Secret 后会自动启动飞书长连接。'}
              </div>
            </>
          )}

          <div className="subsec-h">远程功能</div>
          <div className="remote-cap-grid">
            {(
              Object.entries(draft.capabilities) as Array<
                [keyof RemoteConnectionCapabilities, boolean]
              >
            ).map(([key, value]) => (
              <SettingsRow
                key={key}
                title={REMOTE_CAPABILITY_LABELS[key]}
                desc={REMOTE_CAPABILITY_DESCS[key]}
                right={
                  <Switch
                    size="small"
                    checked={value}
                    onChange={(v) => updateCapability(key, v)}
                  />
                }
              />
            ))}
          </div>

          <div className="subsec-h">配对</div>
          <div className="remote-pairing-panel">
            {webhookUrl && draft.channel !== 'telegram' && draft.channel !== 'feishu' && (
              <div className="remote-webhook-box">
                <span>{webhookUrl}</span>
                <Button
                  size="small"
                  onClick={() => void navigator.clipboard?.writeText(webhookUrl)}
                >
                  复制 webhook
                </Button>
              </div>
            )}
            {selectedSession == null && draft.defaultSessionId != null && (
              <div className="remote-muted-box">
                当前默认会话未在最近会话列表中找到：{draft.defaultSessionId}
              </div>
            )}
            <div className="remote-pairing-actions">
              <Button
                size="small"
                disabled={!draft.id}
                loading={busy === 'pair:code'}
                onClick={() => void generatePairing('code')}
              >
                生成配对码
              </Button>
              <Button
                size="small"
                disabled={!draft.id}
                loading={busy === 'pair:qr'}
                onClick={() => void generatePairing('qr')}
              >
                生成二维码配对
              </Button>
            </div>
            {draft.pairing != null ? (
              <div className="remote-pairing-body">
                <div>
                  <div className="remote-pair-code">{draft.pairing.code}</div>
                  <div className="remote-pair-tip">
                    在 {REMOTE_CHANNEL_LABELS[draft.channel]} 中发送{' '}
                    <code>/bind {draft.pairing.code}</code> 完成配对。
                  </div>
                  <div className="muted text-xs-12">
                    过期时间：{new Date(draft.pairing.expiresAt).toLocaleString()}
                  </div>
                  <div className="remote-manual-pair">
                    <Input
                      value={manualPairUser}
                      onChange={(e) => setManualPairUser(e.target.value)}
                      placeholder="远程用户 ID"
                    />
                    <Input
                      value={manualPairName}
                      onChange={(e) => setManualPairName(e.target.value)}
                      placeholder="显示名称（可选）"
                    />
                    <Button
                      size="small"
                      loading={busy === 'confirm-pair'}
                      onClick={() => void confirmPairing()}
                    >
                      手动确认
                    </Button>
                  </div>
                </div>
                <QrPayloadPreview payload={draft.pairing.qrPayload} />
              </div>
            ) : (
              <div className="remote-muted-box">
                连接保存后生成一次性配对码，然后在远程聊天里发送 /bind 配对码 完成绑定。
              </div>
            )}
            {draft.pairedDevices.length > 0 && (
              <div className="remote-paired-list">
                {draft.pairedDevices.map((device) => (
                  <Tag key={device.id} size="small" color="green">
                    {device.displayName || device.remoteUserId}
                  </Tag>
                ))}
              </div>
            )}
          </div>

          <div className="subsec-h">内置远程命令</div>
          <div className="remote-command-list">
            {commands.map((cmd) => (
              <div key={cmd.name} className="remote-command-row">
                <code>{cmd.usage}</code>
                <span>{cmd.description}</span>
              </div>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  )
}

const REMOTE_CAPABILITY_LABELS: Record<keyof RemoteConnectionCapabilities, string> = {
  sendMessages: '发送消息到会话',
  switchModel: '切换模型 / Provider',
  switchSession: '切换会话',
  switchAgent: '切换 Agent',
  manageWorkspace: '查看工作区',
  runCommands: '运行内置命令',
  approvePermissions: '远程审批权限',
  observeDesktop: '观察桌面',
  controlDesktop: '控制桌面',
  transferFiles: '传输文件',
  manageRuntime: '管理运行时',
  dangerousActions: '高危动作确认',
}

const REMOTE_CAPABILITY_DESCS: Record<keyof RemoteConnectionCapabilities, string> = {
  sendMessages: '允许远程端向默认会话提交 /send 或普通消息',
  switchModel: '允许 /models、/providers、/use-model、/use-provider',
  switchSession: '允许 /sessions 与 /use-session',
  switchAgent: '允许 /agents 与 /use-agent',
  manageWorkspace: '允许 /workspaces 查看项目入口',
  runCommands: '允许解析命令前缀并执行命令目录',
  approvePermissions: '预留给远程 allow/deny 审批，默认关闭',
  observeDesktop: '允许 /screen、/windows 查看桌面与窗口概览',
  controlDesktop: '允许 /focus、/click、/type、/hotkey 等桌面控制命令，默认关闭',
  transferFiles: '预留给远程文件上传、下载与摘要读取，默认关闭',
  manageRuntime: '允许 /progress、/queue、/history、/cancel 管理远程任务',
  dangerousActions: '允许 /confirm 确认高危动作，仍需二次确认',
}

function RemoteCredentialFields({
  draft,
  updateCredential,
}: {
  draft: RemoteConnectionConfig
  updateCredential: (key: keyof RemoteConnectionConfig['credentials'], value: string) => void
}) {
  if (draft.channel === 'telegram') {
    return (
      <>
        <label>Bot Token</label>
        <Input
          value={draft.credentials.botToken ?? ''}
          onChange={(e) => updateCredential('botToken', e.target.value)}
          placeholder="123456:ABC..."
        />
      </>
    )
  }
  if (draft.channel === 'feishu') {
    return (
      <>
        <label>App ID</label>
        <Input
          value={draft.credentials.appId ?? ''}
          onChange={(e) => updateCredential('appId', e.target.value)}
        />
        <label>App Secret</label>
        <Input
          value={draft.credentials.appSecret ?? ''}
          onChange={(e) => updateCredential('appSecret', e.target.value)}
        />
      </>
    )
  }
  if (draft.channel === 'qq') {
    return (
      <>
        <label>机器人 AppID</label>
        <Input
          value={draft.credentials.qqBotAppId ?? ''}
          onChange={(e) => updateCredential('qqBotAppId', e.target.value)}
        />
        <label>机器人 Token</label>
        <Input
          value={draft.credentials.qqBotToken ?? ''}
          onChange={(e) => updateCredential('qqBotToken', e.target.value)}
        />
        <label>机器人 Secret</label>
        <Input
          value={draft.credentials.qqBotSecret ?? ''}
          onChange={(e) => updateCredential('qqBotSecret', e.target.value)}
        />
      </>
    )
  }
  return (
    <>
      <label>Claw Endpoint</label>
      <Input
        value={draft.credentials.clawEndpoint ?? ''}
        onChange={(e) => updateCredential('clawEndpoint', e.target.value)}
        placeholder="http://127.0.0.1:..."
      />
      <label>Access Token</label>
      <Input
        value={draft.credentials.clawAccessToken ?? ''}
        onChange={(e) => updateCredential('clawAccessToken', e.target.value)}
      />
    </>
  )
}

function QrPayloadPreview({ payload }: { payload: string }) {
  return (
    <button
      className="remote-qr"
      title={payload}
      onClick={() => void navigator.clipboard?.writeText(payload)}
    >
      <QRCodeSVG
        value={payload}
        size={128}
        level="M"
        includeMargin
        bgColor="transparent"
        fgColor="currentColor"
      />
      <small>点击复制二维码负载</small>
    </button>
  )
}

/* ───────── APPEARANCE ───────── */
function AppearanceSection() {
  const { t, setTweak } = useApp()
  const [a, setA] = usePersistedSettings(SETTINGS_APPEARANCE_KEY, DEFAULT_APPEARANCE)

  return (
    <div className="settings-section">
      <h2>外观</h2>
      <div className="lede">主题、密度、字体、布局。这些设置实时生效。</div>

      <div className="subsec-h">主题</div>
      <div className="theme-grid">
        <ThemePreview
          kind="light"
          active={t.theme === 'light'}
          onClick={() => setTweak('theme', 'light')}
        />
        <ThemePreview
          kind="dark"
          active={t.theme === 'dark'}
          onClick={() => setTweak('theme', 'dark')}
        />
        <ThemePreview
          kind="auto"
          active={t.theme === 'system'}
          onClick={() => setTweak('theme', 'system')}
        />
      </div>

      <div className="subsec-h">主色</div>
      <div className="color-swatch-row">
        {Object.entries(PRIMARIES).map(([color, info]) => (
          <button key={color} onClick={() => setTweak('primary', color)} className="color-swatch">
            <span
              className={`color-swatch-circle ${t.primary === color ? 'active' : ''}`}
              style={{
                background: color,
                boxShadow: t.primary === color ? `0 0 0 2px var(--bg), 0 0 0 4px ${color}` : 'none',
              }} /* dynamic */
            >
              {t.primary === color && <Icons.Check size={16} />}
            </span>
            <span className={`color-swatch-label ${t.primary === color ? 'active' : ''}`}>
              {info.name}
            </span>
          </button>
        ))}
        <button className="color-add-btn">
          <Icons.Plus size={14} />
        </button>
      </div>

      <div className="subsec-h">布局与字体</div>
      <div className="form-grid">
        <label>
          密度<span className="sub">界面元素紧凑度</span>
        </label>
        <Segmented
          value={t.density}
          onChange={(v) => setTweak('density', v as typeof t.density)}
          options={[
            { label: '紧凑', value: 'compact' },
            { label: '常规', value: 'regular' },
            { label: '宽松', value: 'comfy' },
          ]}
        />

        <label>字体</label>
        <Select
          value={a.font}
          onChange={(v) => setA({ font: v })}
          options={[
            { label: 'Geist + Geist Mono（推荐）', value: 'geist' },
            { label: '系统默认', value: 'system' },
            { label: 'Inter', value: 'inter' },
            { label: 'JetBrains', value: 'jetbrains' },
            { label: 'IBM Plex', value: 'ibm-plex' },
            { label: 'Segoe UI', value: 'segoe-ui' },
            { label: '微软雅黑', value: 'microsoft-yahei' },
            { label: '宋体', value: 'simsun' },
            { label: '楷体', value: 'kaiti' },
            { label: '仿宋', value: 'fangsong' },
            { label: '幼圆', value: 'youyuan' },
          ]}
        />

        <label>
          字号<span className="sub">基础字号，其他字号按比例缩放</span>
        </label>
        <div className="control">
          <InputNumber
            min={10}
            max={20}
            step={1}
            value={a.fontSize}
            onChange={(v) => setA({ fontSize: typeof v === 'number' ? v : 14 })}
            addonAfter="px"
            className="font-size-input"
          />
        </div>

        <label>
          代码字体连字<span className="sub">Geist Mono ligature 例如 =&gt; → ⇒</span>
        </label>
        <Switch
          size="small"
          checked={a.codeLigature}
          onChange={(v) => setA({ codeLigature: v })}
        />

        <label>窗口圆角</label>
        <Segmented
          value={a.windowCorners}
          onChange={(v) => setA({ windowCorners: v as 'sharp' | 'soft' | 'round' })}
          options={[
            { label: '直角', value: 'sharp' },
            { label: '柔和', value: 'soft' },
            { label: '圆润', value: 'round' },
          ]}
        />

        <label>
          背景毛玻璃<span className="sub">macOS 半透明背景（性能略低）</span>
        </label>
        <Switch
          size="small"
          checked={a.backdropBlur}
          onChange={(v) => setA({ backdropBlur: v })}
        />
      </div>

      <div className="subsec-h">聊天显示</div>
      <div className="settings-card">
        <SettingsRow
          title="自动折叠工具调用"
          desc="超过 200 行的工具结果默认折叠"
          right={
            <Switch
              size="small"
              checked={a.autoCollapseTools}
              onChange={(v) => setA({ autoCollapseTools: v })}
            />
          }
        />
        <SettingsRow
          title="行内显示 token 计数"
          right={
            <Switch
              size="small"
              checked={a.inlineTokenCount}
              onChange={(v) => setA({ inlineTokenCount: v })}
            />
          }
        />
        <SettingsRow
          title="语法高亮代码块"
          right={
            <Switch
              size="small"
              checked={a.syntaxHighlight}
              onChange={(v) => setA({ syntaxHighlight: v })}
            />
          }
        />
        <SettingsRow
          title="时间戳格式"
          right={
            <Select
              value={a.timestampFormat}
              onChange={(v) => setA({ timestampFormat: v })}
              options={[
                { label: '相对时间', value: 'rel' },
                { label: '绝对时间', value: 'abs' },
              ]}
            />
          }
        />
      </div>
    </div>
  )
}

function ThemePreview({
  kind,
  active,
  onClick,
  disabled,
}: {
  kind: 'light' | 'dark' | 'auto'
  active: boolean
  onClick: () => void
  disabled?: boolean
}) {
  const colors = {
    light: {
      bg: '#fdfdfc',
      soft: '#fefefe',
      text: '#20201d',
      muted: '#9b9489',
      accent: 'var(--primary)',
    },
    dark: {
      bg: '#16161b',
      soft: '#0d0d10',
      text: '#fafafa',
      muted: '#6b7280',
      accent: 'var(--primary)',
    },
    auto: {
      bg: 'linear-gradient(135deg, #fff 50%, #16161b 50%)',
      soft: '#444',
      text: '#888',
      muted: '#888',
      accent: 'var(--primary)',
    },
  } as const
  const c = colors[kind]
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`theme-preview ${active ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
    >
      <div className="theme-preview-body" style={{ background: c.bg }} /* dynamic */>
        <div className="theme-preview-sidebar" style={{ background: c.soft }} /* dynamic */>
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="theme-preview-line"
              style={{ background: c.muted }} /* dynamic */
            />
          ))}
        </div>
        <div className="theme-preview-main">
          <div className="theme-preview-title" style={{ background: c.text }} /* dynamic */ />
          <div
            className="theme-preview-text"
            style={{ background: c.muted, width: '90%' }} /* dynamic */
          />
          <div
            className="theme-preview-text"
            style={{ background: c.muted, width: '70%' }} /* dynamic */
          />
          <div className="theme-preview-accent" style={{ background: c.accent }} /* dynamic */ />
        </div>
      </div>
      <div className="theme-preview-foot">
        <span>{kind === 'light' ? '浅色' : kind === 'dark' ? '深色' : '跟随系统'}</span>
        {active && <Icons.Check size={13} className="color-primary" />}
      </div>
    </button>
  )
}

/* ───────── SHORTCUTS ───────── */
function ShortcutsSection() {
  const groups: { name: string; items: [string, string[]][] }[] = [
    {
      name: '全局',
      items: [
        ['打开命令面板', ['⌘', 'K']],
        ['新建会话', ['⌘', 'N']],
        ['新建项目', ['⌘', '⇧', 'N']],
        ['打开设置', ['⌘', ',']],
        ['搜索', ['⌘', 'F']],
        ['切换侧边栏', ['⌘', 'B']],
        ['聚焦输入框并滚动到底部', ['⌘', 'L']],
        ['关闭对话框 / 面板', ['Esc']],
      ],
    },
    {
      name: '视图切换',
      items: [
        ['Chat 视图', ['⌘', '1']],
        ['Workflows 视图', ['⌘', '3']],
        ['Agents 视图', ['⌘', '4']],
        ['Skills 视图', ['⌘', '5']],
        ['MCP 视图', ['⌘', '6']],
        ['Settings 视图', ['⌘', '7']],
      ],
    },
    {
      name: '会话输入',
      items: [
        ['发送消息', ['↵']],
        ['插入换行', ['⇧', '↵']],
        ['回溯 / 前进历史输入', ['↑', '↓']],
        ['循环切换权限模式', ['⇧', 'Tab']],
        ['自动补全斜杠命令', ['Tab']],
        ['中断生成（连按两次）', ['Esc', 'Esc']],
      ],
    },
  ]

  return (
    <div className="settings-section section-wider">
      <h2>快捷键</h2>
      <div className="lede">所有组合可在下方搜索并自定义。Mac 使用 ⌘，其他系统替换为 Ctrl。</div>

      <div className="row row-mb-sm">
        <div className="search-input flex1">
          <Icons.Search />
          <Input placeholder="搜索动作或按键..." />
        </div>
        <Button size="small" type="default" icon={<Icons.Refresh size={12} />}>
          重置全部
        </Button>
      </div>

      {groups.map((g) => (
        <div key={g.name}>
          <div className="subsec-h">{g.name}</div>
          <div className="keymap">
            {g.items.map(([label, keys]) => (
              <div key={label} className="km-row">
                <div className="km-action">{label}</div>
                <div className="km-keys">
                  {keys.map((k, i) => (
                    <span key={i} className="kbd">
                      {k}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ───────── PROFILE EDIT MODAL ───────── */
export function ProfileEditModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <div className="modal-h-icon modal-h-icon-primary">
            <Icons.Brain size={18} />
          </div>
          <div>
            <div className="modal-title">编辑模型 Profile</div>
            <div className="modal-subtitle">Anthropic · Claude Sonnet 4.5</div>
          </div>
        </div>
        <div className="modal-body modal-body-scroll">
          <div className="form-grid">
            <label>显示名称</label>
            <Input defaultValue="Sonnet 4.5 · 默认" />

            <label>模型 ID</label>
            <Input className="mono-sm" defaultValue="claude-sonnet-4-5-20250929" />

            <label>
              角色<span className="sub">该 profile 适配的角色</span>
            </label>
            <div className="row row-gap-xs">
              {['default', 'planner', 'coder', 'reviewer', 'fast', 'vision', 'long-context'].map(
                (r) => (
                  <span
                    key={r}
                    className={`badge ${['default', 'coder', 'reviewer'].includes(r) ? 'primary' : ''} badge-role-tag`}
                  >
                    {r}
                  </span>
                ),
              )}
            </div>

            <label>Temperature</label>
            <div className="control">
              <Input type="range" min="0" max="2" step="0.1" defaultValue="0.7" className="flex1" />
              <span className="mono-sm muted range-value">0.7</span>
            </div>

            <label>最大输入 token</label>
            <Input type="number" defaultValue="180000" />

            <label>最大输出 token</label>
            <Input type="number" defaultValue="8192" />

            <label>
              推理强度<span className="sub">extended thinking 时使用</span>
            </label>
            <Segmented
              defaultValue="medium"
              options={[
                { label: 'none', value: 'none' },
                { label: 'minimal', value: 'minimal' },
                { label: 'low', value: 'low' },
                { label: 'medium', value: 'medium' },
                { label: 'high', value: 'high' },
              ]}
            />

            <label>单次运行成本上限</label>
            <div className="control">
              <span className="muted">$</span>
              <Input type="number" defaultValue="5.00" step="0.50" className="flex1" />
              <span className="muted text-xs-12">USD · 超出后切换到 fallback</span>
            </div>

            <label>超时</label>
            <div className="control">
              <Input type="number" defaultValue="120" className="flex1" />
              <span className="muted text-xs-12">秒</span>
            </div>

            <label>
              Fallback 链<span className="sub">主模型失败或超限时按顺序尝试</span>
            </label>
            <div className="fallback-list">
              <div className="row fallback-row">
                <span className="mono-sm faint">1.</span>
                <Icons.Brain size={13} className="color-primary" />
                <span className="strong fallback-name">Claude Opus 4</span>
                <span className="badge fallback-badge">当延迟 &gt; 5s</span>
                <button className="icon-btn fallback-close">
                  <Icons.X size={11} />
                </button>
              </div>
              <div className="row fallback-row">
                <span className="mono-sm faint">2.</span>
                <Icons.Brain size={13} className="color-primary" />
                <span className="strong fallback-name">Claude Haiku 4.5</span>
                <span className="badge fallback-badge">当成本超限</span>
                <button className="icon-btn fallback-close">
                  <Icons.X size={11} />
                </button>
              </div>
              <Button className="add-fallback-btn" size="small" type="text" icon={<Icons.Plus size={11} />}>
                添加 fallback
              </Button>
            </div>

            <label>启用</label>
            <Switch size="small" defaultChecked />
          </div>
        </div>
        <div className="modal-foot">
          <Button size="small" type="default" danger>删除 Profile</Button>
          <div className="flex1" />
          <Button size="small" type="default" onClick={onClose}>
            取消
          </Button>
          <Button size="small" type="primary" icon={<Icons.Check size={12} />} onClick={onClose}>
            保存
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ───────── MODELS ───────── */
function ModelsSection() {
  const [models, setModels] = useState<ModelProfile[]>([])
  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [addingForProvider, setAddingForProvider] = useState<string | null>(null)
  const [newModelName, setNewModelName] = useState('')
  const { invoke: listModels } = useIpcInvoke('model:list')
  const { invoke: listProviders } = useIpcInvoke('provider:list')
  const { invoke: createModel } = useIpcInvoke('model:create')
  const { invoke: updateModel } = useIpcInvoke('model:update')
  const { invoke: deleteModel } = useIpcInvoke('model:delete')
  const { requestConfirm } = useApp()

  const refresh = useCallback(() => {
    setLoading(true)
    setError('')
    Promise.all([listModels({}), listProviders({})])
      .then(([mRes, pRes]) => {
        setModels(mRes.models)
        setProviders(pRes.profiles)
      })
      .catch((err) => setError(err instanceof Error ? err.message : '加载失败'))
      .finally(() => setLoading(false))
  }, [listModels, listProviders])

  useEffect(() => {
    return deferEffect(refresh)
  }, [refresh])

  const handleToggle = async (m: ModelProfile) => {
    await updateModel({ id: m.id, enabled: !m.enabled })
    refresh()
  }

  const handleDelete = async (id: string) => {
    const confirmed = await requestConfirm({
      title: '删除模型？',
      description: '该自定义模型会从当前 Provider 下移除。',
      confirmText: '删除',
      danger: true,
    })
    if (!confirmed) return
    await deleteModel({ id })
    refresh()
  }

  const handleAdd = async (providerId: string) => {
    const name = newModelName.trim()
    if (!name) return
    await createModel({ providerId, name })
    setAddingForProvider(null)
    setNewModelName('')
    refresh()
  }

  // Group models by provider
  const byProvider = providers.map((p) => ({
    provider: p,
    models: models.filter((m) => m.providerId === p.id),
  }))

  return (
    <div className="settings-section">
      <div className="row section-header-row">
        <div className="flex1">
          <h2 className="section-h2">模型管理</h2>
          <div className="lede section-lede">
            按 Provider 分组管理可用模型，可启用/禁用或添加自定义模型。
          </div>
        </div>
        <span className="badge primary dot">共 {models.length} 个</span>
      </div>

      {error && <div className="alert-banner">{error}</div>}

      {loading && <div className="card loading-card">正在加载...</div>}

      {!loading && providers.length === 0 && (
        <div className="card loading-card">暂无 Provider。请先在 Provider 页面添加。</div>
      )}

      {!loading &&
        byProvider.map(({ provider, models: pModels }) => (
          <div key={provider.id} className="card model-card">
            <div className="row model-card-header">
              <span className="strong">{provider.name}</span>
              <span className="badge model-provider-badge">{provider.provider}</span>
              <span className="flex1" />
              <Button
                size="small"
                type="text"
                icon={<Icons.Plus size={11} />}
                onClick={() => {
                  setAddingForProvider(provider.id)
                  setNewModelName('')
                }}
              >
                添加
              </Button>
            </div>

            {addingForProvider === provider.id && (
              <div className="row row-gap-sm mb-sm">
                <Input
                  className="flex1 model-name-sm"
                  placeholder="模型名称，如 gpt-4o"
                  value={newModelName}
                  onChange={(e) => setNewModelName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleAdd(provider.id)
                    if (e.key === 'Escape') setAddingForProvider(null)
                  }}
                  autoFocus
                />
                <Button size="small" type="primary" onClick={() => void handleAdd(provider.id)}>
                  确认
                </Button>
                <Button size="small" type="text" onClick={() => setAddingForProvider(null)}>
                  取消
                </Button>
              </div>
            )}

            {pModels.length === 0 && <div className="model-card-empty">暂无模型</div>}

            {pModels.map((m) => {
              const cap = ModelCapabilityRegistry.getCapabilities(m.name)
              return (
                <div key={m.id} className="row model-row-border">
                  <span className="mono-sm model-name-sm flex1">{m.name}</span>
                  {cap && (
                    <div className="row model-cap-tags">
                      {cap.supportsVision && <span className="model-cap-tag vision">Vision</span>}
                      {cap.supportsToolUse && <span className="model-cap-tag tool">Tools</span>}
                      {cap.supportsExtendedThinking && (
                        <span className="model-cap-tag thinking">Thinking</span>
                      )}
                      <span className="model-cap-tag ctx">
                        {cap.contextWindow >= 1_000_000
                          ? `${cap.contextWindow / 1_000_000}M`
                          : `${cap.contextWindow / 1_000}K`}
                      </span>
                    </div>
                  )}
                  <Switch
                    size="small"
                    checked={m.enabled}
                    onChange={() => void handleToggle(m)}
                  />
                  <button className="icon-btn" title="删除" onClick={() => void handleDelete(m.id)}>
                    <Icons.X size={12} />
                  </button>
                </div>
              )
            })}
          </div>
        ))}
    </div>
  )
}

/* ───────── RULES ───────── */
const RULE_LAYER_META: Array<{
  scope: RuleScope
  label: string
  badge: string
  badgeColor: string
  desc: string
}> = [
  {
    scope: 'system',
    label: 'System',
    badge: 'SYS',
    badgeColor: '#94a3b8',
    desc: '应用内置 · 不可删除',
  },
  { scope: 'team', label: 'Team', badge: 'TEAM', badgeColor: '#8b5cf6', desc: '团队管理员发布' },
  { scope: 'user', label: 'User', badge: 'USER', badgeColor: '#10b981', desc: '用户全局偏好' },
  {
    scope: 'project',
    label: 'Project',
    badge: 'PROJ',
    badgeColor: '#f97316',
    desc: '.spark/rules · 当前工作区',
  },
  {
    scope: 'session',
    label: 'Session',
    badge: 'SESS',
    badgeColor: '#f43f5e',
    desc: '本次会话临时规则',
  },
]

function RulesSection() {
  const [rules, setRules] = useState<RuleItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<{ scope: RuleScope; rule: RuleItem | null } | null>(null)

  const { invoke: listRules } = useIpcInvoke('rules:list')
  const { invoke: createRule } = useIpcInvoke('rules:create')
  const { invoke: updateRule } = useIpcInvoke('rules:update')
  const { invoke: deleteRule } = useIpcInvoke('rules:delete')
  const { requestConfirm } = useApp()

  const refresh = useCallback(() => {
    setLoading(true)
    setError('')
    listRules({})
      .then((res) => setRules(res.rules))
      .catch((err) => setError(err instanceof Error ? err.message : '加载规则失败'))
      .finally(() => setLoading(false))
  }, [listRules])

  useEffect(() => {
    return deferEffect(refresh)
  }, [refresh])

  const grouped = RULE_LAYER_META.reduce<Record<RuleScope, RuleItem[]>>(
    (acc, meta) => {
      acc[meta.scope] = rules.filter((rule) => rule.scope === meta.scope)
      return acc
    },
    { system: [], team: [], user: [], project: [], session: [] },
  )

  const activeCount = rules.filter((rule) => rule.enabled).length

  const handleToggle = async (id: string, enabled: boolean) => {
    await updateRule({ id, enabled })
    refresh()
  }

  const handleDelete = async (id: string) => {
    const confirmed = await requestConfirm({
      title: '删除规则？',
      description: '该规则会从本地规则列表中移除。',
      confirmText: '删除',
      danger: true,
    })
    if (!confirmed) return
    await deleteRule({ id })
    refresh()
  }

  const handleSave = async (draft: {
    scope: RuleScope
    id?: string
    name: string
    content: string
    priority: number
  }) => {
    if (draft.id !== undefined) {
      await updateRule({
        id: draft.id,
        name: draft.name,
        content: draft.content,
        priority: draft.priority,
      })
    } else {
      await createRule({
        scope: draft.scope,
        name: draft.name,
        content: draft.content,
        priority: draft.priority,
      })
    }
    setEditing(null)
    refresh()
  }

  return (
    <>
      <div className="settings-section">
        <h2>规则</h2>
        <div className="lede">
          多层规则按优先级合成为有效 prompt 注入。下方按层级展示来源，并显示冲突与覆盖。
        </div>

        <div className="row info-banner">
          <Icons.Brain size={14} className="color-primary flex-shrink-0" />
          <div className="flex1 info-banner-text">
            <strong>当前生效</strong> · {activeCount} 条启用规则来自 {RULE_LAYER_META.length}{' '}
            个作用域
          </div>
          <Button size="small" type="primary" icon={<Icons.Refresh size={11} />} onClick={refresh}>
            刷新
          </Button>
        </div>

        {error && <div className="alert-banner">{error}</div>}

        {loading ? (
          <div className="card loading-card">正在加载规则...</div>
        ) : (
          RULE_LAYER_META.map((meta) => (
            <RuleLayer
              key={meta.scope}
              scope={meta.label}
              badge={meta.badge}
              badgeColor={meta.badgeColor}
              desc={`${meta.desc} · ${grouped[meta.scope].length} 条`}
              rules={grouped[meta.scope]}
              readOnly={meta.scope === 'system'}
              onToggle={handleToggle}
              onEdit={(rule) => setEditing({ scope: meta.scope, rule })}
              onDelete={handleDelete}
              onAdd={() => setEditing({ scope: meta.scope, rule: null })}
            />
          ))
        )}
      </div>

      {editing !== null && (
        <RuleEditPanel
          scope={editing.scope}
          rule={editing.rule}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
    </>
  )
}

function RuleLayer({
  scope,
  badge,
  badgeColor,
  desc,
  rules,
  readOnly = false,
  onToggle,
  onEdit,
  onDelete,
  onAdd,
}: {
  scope: string
  badge: string
  badgeColor: string
  desc: string
  rules: RuleItem[]
  readOnly?: boolean
  onToggle: (id: string, enabled: boolean) => void
  onEdit: (rule: RuleItem) => void
  onDelete: (id: string) => void
  onAdd: () => void
}) {
  return (
    <div className="rule-layer">
      <div className="rule-layer-h">
        <span
          className="badge rule-badge rule-badge-dynamic"
          style={{ background: badgeColor + '20', color: badgeColor }} /* dynamic */
        >
          {badge}
        </span>
        <div>
          <span className="name">{scope}</span>
          <span className="desc"> · {desc}</span>
        </div>
        <div className="flex1" />
        {readOnly && <span className="badge rule-readonly-badge">只读</span>}
        {!readOnly && (
          <button className="icon-btn" title="新增规则" onClick={onAdd}>
            <Icons.Plus size={13} />
          </button>
        )}
        <button className="icon-btn">
          <Icons.ChevronDown size={13} />
        </button>
      </div>
      <div className="rule-layer-body">
        {rules.length === 0 && (
          <div className="rule-line">
            <span className="src">empty</span>
            <span className="txt">暂无规则</span>
          </div>
        )}
        {rules.map((rule) => (
          <div key={rule.id} className={`rule-line ${rule.enabled ? '' : 'overridden'}`}>
            <span className="src">{rule.name}</span>
            <span className="txt">{rule.content}</span>
            <span className="marker win">P{rule.priority}</span>
            {!rule.enabled && <span className="marker lose">禁用</span>}
            <Switch
              size="small"
              checked={rule.enabled}
              onChange={(v) => onToggle(rule.id, v)}
            />
            {!readOnly && (
              <>
                <button className="icon-btn" title="编辑" onClick={() => onEdit(rule)}>
                  <Icons.Edit size={12} />
                </button>
                <button className="icon-btn" title="删除" onClick={() => onDelete(rule.id)}>
                  <Icons.X size={12} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function RuleEditPanel({
  scope,
  rule,
  onClose,
  onSave,
}: {
  scope: RuleScope
  rule: RuleItem | null
  onClose: () => void
  onSave: (draft: {
    scope: RuleScope
    id?: string
    name: string
    content: string
    priority: number
  }) => Promise<void>
}) {
  const [name, setName] = useState(rule?.name ?? '')
  const [content, setContent] = useState(rule?.content ?? '')
  const [priority, setPriority] = useState(rule?.priority ?? 0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    if (!name.trim() || !content.trim()) {
      setError('名称和内容不能为空')
      return
    }

    setSaving(true)
    setError('')
    try {
      await onSave({
        scope,
        ...(rule !== null && { id: rule.id }),
        name: name.trim(),
        content: content.trim(),
        priority,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存规则失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="slide-panel-backdrop" onClick={onClose}>
      <div className="slide-panel" onClick={(e) => e.stopPropagation()}>
        <div className="slide-panel-h">
          <div className="h-icon">{scope.slice(0, 1).toUpperCase()}</div>
          <div className="flex1">
            <div className="h-title">{rule === null ? '新增规则' : '编辑规则'}</div>
            <div className="h-sub">{scope} scope · prompt 片段</div>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <Icons.X />
          </button>
        </div>

        <div className="slide-panel-body">
          {error && <div className="alert-banner">{error}</div>}

          <div className="subsec-h">规则</div>
          <div className="form-grid">
            <label>名称</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：代码风格"
            />

            <label>
              优先级<span className="sub">数字越大越优先</span>
            </label>
            <Input
              type="number"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
            />

            <label>内容</label>
            <TextArea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="输入要注入到 Agent prompt 的规则内容"
              className="rule-textarea"
            />
          </div>
        </div>

        <div className="slide-panel-foot">
          <span className="flex1" />
          <Button size="small" type="default" onClick={onClose}>
            取消
          </Button>
          <Button size="small" type="primary" loading={saving} icon={<Icons.Check size={12} />} onClick={handleSave} disabled={saving}>
            保存
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ───────── MCP ───────── */
// MCP 设置暂未完全实现，从导航和 Section 映射中移除
// 代码保留以便后续启用
type McpTransportType = 'stdio' | 'sse'

type McpSettingsConfig = {
  transport?: McpTransportType | 'http'
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
  tools?: string[]
}

type McpServerStatus = {
  connected: boolean
  toolCount: number
  error?: string
}

type McpServerTools = Array<{
  name: string
  description: string
}>

type McpFormDraft = {
  name: string
  scope: string
  type: McpTransportType
  command: string
  args: string
  url: string
  envPairs: Array<{ key: string; value: string }>
}

const EMPTY_MCP_DRAFT: McpFormDraft = {
  name: '',
  scope: 'user',
  type: 'stdio',
  command: '',
  args: '',
  url: '',
  envPairs: [],
}

function parseMcpConfig(configJson: string): McpSettingsConfig {
  try {
    return JSON.parse(configJson) as McpSettingsConfig
  } catch {
    return {}
  }
}

function McpSection() {
  const [servers, setServers] = useState<McpServerItem[]>([])
  const [statusMap, setStatusMap] = useState<Record<string, McpServerStatus>>({})
  const [toolsMap, setToolsMap] = useState<Record<string, McpServerTools>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<McpFormDraft>({ ...EMPTY_MCP_DRAFT })
  const [formError, setFormError] = useState('')
  const [formSaving, setFormSaving] = useState(false)
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({})
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const { invoke: listMcp, loading } = useIpcInvoke('mcp:list')
  const { invoke: createMcp } = useIpcInvoke('mcp:create')
  const { invoke: updateMcp } = useIpcInvoke('mcp:update')
  const { invoke: deleteMcp } = useIpcInvoke('mcp:delete')
  const { invoke: startServer } = useIpcInvoke('mcp:start-server')
  const { invoke: stopServer } = useIpcInvoke('mcp:stop-server')
  const { invoke: getServerStatus } = useIpcInvoke('mcp:server-status')
  const { invoke: getServerTools } = useIpcInvoke('mcp:server-tools')
  const { toast } = useToast()

  const refresh = useCallback(() => {
    setError('')
    listMcp({})
      .then((res) => {
        setServers(res.servers)
        // Fetch status for each server
        res.servers.forEach((s) => {
          getServerStatus({ serverId: s.id })
            .then((status) => setStatusMap((prev) => ({ ...prev, [s.id]: status })))
            .catch(() => {})
        })
      })
      .catch((err) => setError(err instanceof Error ? err.message : '加载 MCP 服务器失败'))
  }, [listMcp, getServerStatus])

  useEffect(() => {
    return deferEffect(refresh)
  }, [refresh])

  const loadTools = useCallback(
    async (serverId: string) => {
      try {
        const res = await getServerTools({ serverId })
        setToolsMap((prev) => ({ ...prev, [serverId]: res.tools }))
      } catch {
        setToolsMap((prev) => ({ ...prev, [serverId]: [] }))
      }
    },
    [getServerTools],
  )

  const handleToggleExpand = (serverId: string) => {
    if (expandedId === serverId) {
      setExpandedId(null)
    } else {
      setExpandedId(serverId)
      loadTools(serverId)
    }
  }

  const handleStart = async (serverId: string) => {
    setActionLoading((prev) => ({ ...prev, [serverId]: true }))
    try {
      const res = await startServer({ serverId })
      if (res.started) {
        toast.success('MCP 服务器已启动')
        setStatusMap((prev) => ({
          ...prev,
          [serverId]: { connected: true, toolCount: res.toolCount },
        }))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '启动失败')
      setStatusMap((prev) => ({
        ...prev,
        [serverId]: {
          connected: false,
          toolCount: 0,
          error: err instanceof Error ? err.message : '启动失败',
        },
      }))
    } finally {
      setActionLoading((prev) => ({ ...prev, [serverId]: false }))
    }
  }

  const handleStop = async (serverId: string) => {
    setActionLoading((prev) => ({ ...prev, [serverId]: true }))
    try {
      const res = await stopServer({ serverId })
      if (res.stopped) {
        toast.success('MCP 服务器已停止')
        setStatusMap((prev) => ({ ...prev, [serverId]: { connected: false, toolCount: 0 } }))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '停止失败')
    } finally {
      setActionLoading((prev) => ({ ...prev, [serverId]: false }))
    }
  }

  const handleDelete = async (serverId: string) => {
    setActionLoading((prev) => ({ ...prev, [serverId]: true }))
    try {
      // Stop server first if running
      const status = statusMap[serverId]
      if (status?.connected) {
        try {
          await stopServer({ serverId })
        } catch {
          /* ignore */
        }
      }
      await deleteMcp({ id: serverId })
      toast.success('MCP 服务器已删除')
      setDeleteConfirmId(null)
      refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败')
    } finally {
      setActionLoading((prev) => ({ ...prev, [serverId]: false }))
    }
  }

  const openAddForm = () => {
    setEditingId(null)
    setDraft({ ...EMPTY_MCP_DRAFT })
    setFormError('')
    setShowForm(true)
  }

  const openEditForm = (server: McpServerItem) => {
    const config = parseMcpConfig(server.configJson)
    const transport = (config.transport === 'sse' ? 'sse' : 'stdio') as McpTransportType
    const envPairs = config.env
      ? Object.entries(config.env).map(([key, value]) => ({ key, value }))
      : []
    setEditingId(server.id)
    setDraft({
      name: server.name,
      scope: server.scope,
      type: transport,
      command: config.command ?? '',
      args: config.args?.join(' ') ?? '',
      url: config.url ?? '',
      envPairs,
    })
    setFormError('')
    setShowForm(true)
  }

  const closeForm = () => {
    setShowForm(false)
    setEditingId(null)
    setDraft({ ...EMPTY_MCP_DRAFT })
    setFormError('')
  }

  const handleFormSave = async () => {
    const name = draft.name.trim()
    if (!name) {
      setFormError('名称不能为空')
      return
    }
    if (draft.type === 'stdio' && !draft.command.trim()) {
      setFormError('stdio 类型需要填写启动命令')
      return
    }
    if (draft.type === 'sse' && !draft.url.trim()) {
      setFormError('SSE 类型需要填写 URL')
      return
    }

    const envObj: Record<string, string> = {}
    for (const pair of draft.envPairs) {
      if (pair.key.trim()) {
        envObj[pair.key.trim()] = pair.value
      }
    }

    const config: McpSettingsConfig = {
      transport: draft.type,
      tools: [],
    }
    if (draft.type === 'stdio') {
      config.command = draft.command.trim()
      const args = draft.args.trim().split(/\s+/).filter(Boolean)
      if (args.length > 0) config.args = args
    } else {
      config.url = draft.url.trim()
    }
    if (Object.keys(envObj).length > 0) {
      config.env = envObj
    }

    setFormSaving(true)
    setFormError('')
    try {
      if (editingId) {
        await updateMcp({
          id: editingId,
          name,
          configJson: JSON.stringify(config),
        })
        toast.success('MCP 服务器已更新')
      } else {
        await createMcp({
          name,
          scope: draft.scope,
          configJson: JSON.stringify(config),
          enabled: true,
        })
        toast.success('MCP 服务器已创建')
      }
      closeForm()
      refresh()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '保存失败')
      toast.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setFormSaving(false)
    }
  }

  const addEnvPair = () => {
    setDraft((prev) => ({ ...prev, envPairs: [...prev.envPairs, { key: '', value: '' }] }))
  }

  const removeEnvPair = (index: number) => {
    setDraft((prev) => ({ ...prev, envPairs: prev.envPairs.filter((_, i) => i !== index) }))
  }

  const updateEnvPair = (index: number, field: 'key' | 'value', val: string) => {
    setDraft((prev) => ({
      ...prev,
      envPairs: prev.envPairs.map((p, i) => (i === index ? { ...p, [field]: val } : p)),
    }))
  }

  const runningCount = servers.filter((s) => statusMap[s.id]?.connected).length

  return (
    <div className="settings-section">
      <div className="row section-header-row">
        <div className="flex1">
          <h2 className="section-h2">MCP 服务器</h2>
          <div className="lede section-lede">
            配置 Model Context Protocol 服务器，为 Agent 提供外部工具和数据源。
          </div>
        </div>
        <span className="badge primary dot">
          {runningCount} / {servers.length} 运行中
        </span>
        <Button
          type="primary"
          icon={<Icons.Plus size={12} />}
          onClick={openAddForm}
          style={{ marginLeft: 10 }} /* dynamic */
        >
          添加
        </Button>
      </div>

      {error && <div className="alert-banner">{error}</div>}

      {loading ? (
        <div className="card loading-card">正在加载 MCP 服务器...</div>
      ) : servers.length === 0 ? (
        <div className="mcp-empty-state">
          <Icons.MCP size={24} />
          <div className="strong mcp-empty-title">暂无 MCP 服务器</div>
          <div className="mcp-empty-desc">添加 MCP 服务器以扩展 Agent 的工具能力</div>
        </div>
      ) : (
        <div className="mcp-server-list">
          {servers.map((server) => {
            const config = parseMcpConfig(server.configJson)
            const transport = config.transport === 'sse' ? 'sse' : 'stdio'
            const status = statusMap[server.id]
            const isConnected = status?.connected ?? false
            const hasError = status?.error != null && status.error.length > 0
            const isExpanded = expandedId === server.id
            const isLoading = actionLoading[server.id] ?? false
            const toolCount = status?.toolCount ?? 0

            return (
              <div key={server.id} className={`mcp-server-card ${isExpanded ? 'expanded' : ''}`}>
                {/* Server row */}
                <div className="mcp-server-row" onClick={() => handleToggleExpand(server.id)}>
                  <span
                    className={`mcp-status-dot ${isConnected ? 'running' : hasError ? 'error' : 'stopped'}`}
                  />
                  <div className="mcp-server-meta flex1 min-w-0">
                    <div className="row row-gap-xs">
                      <span className="mcp-server-name">{server.name}</span>
                      <span className="badge">{transport.toUpperCase()}</span>
                    </div>
                    <div className="mcp-server-desc">
                      {transport === 'stdio' ? (config.command ?? '—') : (config.url ?? '—')}
                      <span className="mcp-desc-sep">·</span>
                      <span>{server.scope}</span>
                      <span className="mcp-desc-sep">·</span>
                      <span>{toolCount} 个工具</span>
                    </div>
                  </div>
                  <div
                    className="row row-gap-xs mcp-server-actions"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {isLoading ? (
                      <span className="mcp-action-loading">
                        <Icons.Spinner size={13} />
                      </span>
                    ) : isConnected ? (
                      <Button
                        size="small"
                        type="text"
                        icon={<Icons.Stop size={11} />}
                        onClick={() => void handleStop(server.id)}
                        title="停止"
                      >
                        停止
                      </Button>
                    ) : (
                      <Button
                        size="small"
                        type="text"
                        icon={<Icons.Play size={11} />}
                        onClick={() => void handleStart(server.id)}
                        title="启动"
                      >
                        启动
                      </Button>
                    )}
                    <button className="icon-btn" title="编辑" onClick={() => openEditForm(server)}>
                      <Icons.Edit size={12} />
                    </button>
                    <button
                      className="icon-btn"
                      title="删除"
                      onClick={() => setDeleteConfirmId(server.id)}
                    >
                      <Icons.Trash size={11} />
                    </button>
                    <span className="mcp-expand-icon">
                      {isExpanded ? <Icons.ChevronUp size={14} /> : <Icons.ChevronDown size={14} />}
                    </span>
                  </div>
                </div>

                {/* Expanded detail panel */}
                {isExpanded && (
                  <div className="mcp-server-detail">
                    <div className="mcp-detail-grid">
                      <div className="mcp-detail-col">
                        <div className="mcp-detail-label">连接状态</div>
                        <div className="mcp-detail-value">
                          <span
                            className={`badge ${isConnected ? 'success' : hasError ? 'danger' : ''} dot`}
                          >
                            {isConnected ? '已连接' : hasError ? '错误' : '已停止'}
                          </span>
                        </div>
                      </div>
                      <div className="mcp-detail-col">
                        <div className="mcp-detail-label">传输类型</div>
                        <div className="mcp-detail-value">
                          {transport === 'stdio' ? 'Stdio' : 'SSE'}
                        </div>
                      </div>
                      <div className="mcp-detail-col">
                        <div className="mcp-detail-label">工具数量</div>
                        <div className="mcp-detail-value">{toolCount}</div>
                      </div>
                      <div className="mcp-detail-col">
                        <div className="mcp-detail-label">作用域</div>
                        <div className="mcp-detail-value">{server.scope}</div>
                      </div>
                    </div>

                    {hasError && (
                      <div className="mcp-detail-error">
                        <Icons.AlertTriangle size={13} />
                        <span>{status?.error}</span>
                      </div>
                    )}

                    <div className="mcp-detail-tools-h">可用工具</div>
                    {(() => {
                      const tools = toolsMap[server.id]
                      if (tools == null) {
                        return (
                          <div className="mcp-detail-loading">
                            <Icons.Spinner size={13} /> 加载工具列表...
                          </div>
                        )
                      }
                      if (tools.length === 0) {
                        return (
                          <div className="mcp-detail-empty">
                            暂无工具（服务器未运行或未提供工具）
                          </div>
                        )
                      }
                      return (
                        <div className="mcp-detail-tools">
                          {tools.map((tool) => (
                            <div key={tool.name} className="mcp-tool-item">
                              <span className="mcp-tool-name">
                                <Icons.Wrench size={11} /> {tool.name}
                              </span>
                              <span className="mcp-tool-desc">{tool.description || '—'}</span>
                            </div>
                          ))}
                        </div>
                      )
                    })()}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Add/Edit dialog */}
      {showForm && (
        <div className="modal-backdrop" onClick={closeForm}>
          <div className="modal modal-mcp-form" onClick={(e) => e.stopPropagation()}>
            <div className="modal-h">
              <div className="modal-h-icon modal-h-icon-primary">
                <Icons.MCP size={18} />
              </div>
              <div className="flex1">
                <div className="modal-title">
                  {editingId ? '编辑 MCP 服务器' : '添加 MCP 服务器'}
                </div>
                <div className="modal-subtitle">
                  {draft.type === 'stdio' ? 'Stdio 传输' : 'SSE 传输'}
                </div>
              </div>
              <button className="icon-btn" onClick={closeForm}>
                <Icons.X />
              </button>
            </div>

            <div className="modal-body modal-body-scroll">
              {formError && <div className="alert-banner">{formError}</div>}

              <div className="subsec-h">基础配置</div>
              <div className="form-grid">
                <label>
                  名称<span className="sub">服务器唯一标识名称</span>
                </label>
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="例：filesystem"
                />

                <label>
                  作用域<span className="sub">配置生效范围</span>
                </label>
                <Select
                  value={draft.scope}
                  onChange={(v) => setDraft((prev) => ({ ...prev, scope: v }))}
                  disabled={!!editingId}
                  options={[
                    { label: 'user', value: 'user' },
                    { label: 'team', value: 'team' },
                    { label: 'project', value: 'project' },
                    { label: 'session', value: 'session' },
                  ]}
                />

                <label>
                  传输类型<span className="sub">与 MCP 服务器的通信方式</span>
                </label>
                <Select
                  value={draft.type}
                  onChange={(v) =>
                    setDraft((prev) => ({
                      ...prev,
                      type: (v === 'sse' ? 'sse' : 'stdio') as McpTransportType,
                    }))
                  }
                  disabled={!!editingId}
                  options={[
                    { label: 'Stdio（本地进程）', value: 'stdio' },
                    { label: 'SSE（HTTP 流）', value: 'sse' },
                  ]}
                />
              </div>

              {draft.type === 'stdio' ? (
                <>
                  <div className="subsec-h mt-lg">Stdio 配置</div>
                  <div className="form-grid">
                    <label>
                      启动命令<span className="sub">可执行文件路径</span>
                    </label>
                    <Input
                      className="mono-sm"
                      value={draft.command}
                      onChange={(e) => setDraft((prev) => ({ ...prev, command: e.target.value }))}
                      placeholder="npx"
                    />

                    <label>
                      参数<span className="sub">空格分隔的命令行参数</span>
                    </label>
                    <Input
                      className="mono-sm"
                      value={draft.args}
                      onChange={(e) => setDraft((prev) => ({ ...prev, args: e.target.value }))}
                      placeholder="-y @modelcontextprotocol/server-filesystem ."
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="subsec-h mt-lg">SSE 配置</div>
                  <div className="form-grid">
                    <label>
                      URL<span className="sub">SSE 端点地址</span>
                    </label>
                    <Input
                      className="mono-sm"
                      value={draft.url}
                      onChange={(e) => setDraft((prev) => ({ ...prev, url: e.target.value }))}
                      placeholder="https://mcp.example.com/sse"
                    />
                  </div>
                </>
              )}

              <div className="subsec-h mt-lg">
                环境变量
                <Button className="mcp-env-add-btn" size="small" type="text" icon={<Icons.Plus size={11} />} onClick={addEnvPair}>
                  添加
                </Button>
              </div>
              {draft.envPairs.length === 0 ? (
                <div className="mcp-env-empty">未配置环境变量</div>
              ) : (
                <div className="mcp-env-list">
                  {draft.envPairs.map((pair, idx) => (
                    <div key={idx} className="mcp-env-row">
                      <Input
                        className="mcp-env-key mono-sm"
                        value={pair.key}
                        onChange={(e) => updateEnvPair(idx, 'key', e.target.value)}
                        placeholder="KEY"
                      />
                      <span className="mcp-env-eq">=</span>
                      <Input
                        className="mcp-env-val mono-sm flex1"
                        value={pair.value}
                        onChange={(e) => updateEnvPair(idx, 'value', e.target.value)}
                        placeholder="value"
                      />
                      <button
                        className="icon-btn mcp-env-del"
                        onClick={() => removeEnvPair(idx)}
                        title="删除"
                      >
                        <Icons.X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="modal-foot">
              <span className="flex1" />
              <Button size="small" type="default" onClick={closeForm}>
                取消
              </Button>
              <Button
                size="small"
                type="primary"
                loading={formSaving}
                icon={<Icons.Check size={12} />}
                onClick={() => void handleFormSave()}
                disabled={formSaving}
              >
                保存
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deleteConfirmId !== null && (
        <div className="modal-backdrop" onClick={() => setDeleteConfirmId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-h">
              <div
                className="modal-h-icon"
                style={{
                  background: 'var(--danger-bg, #fef2f2)',
                  color: 'var(--danger)',
                }} /* dynamic */
              >
                <Icons.AlertTriangle size={18} />
              </div>
              <div>
                <div className="modal-title">删除 MCP 服务器</div>
                <div className="modal-subtitle">
                  {servers.find((s) => s.id === deleteConfirmId)?.name ?? ''}
                </div>
              </div>
            </div>
            <div className="modal-body">
              <div className="mcp-delete-warning">
                确认删除此 MCP 服务器？
                {statusMap[deleteConfirmId]?.connected ? '该服务器正在运行，将自动停止。' : ''}
                此操作无法撤销。
              </div>
            </div>
            <div className="modal-foot">
              <span className="flex1" />
              <Button size="small" type="default" onClick={() => setDeleteConfirmId(null)}>
                取消
              </Button>
              <Button
                size="small"
                type="default"
                danger
                loading={actionLoading[deleteConfirmId] ?? false}
                onClick={() => void handleDelete(deleteConfirmId)}
                disabled={actionLoading[deleteConfirmId] ?? false}
              >
                确认删除
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
// MCP 设置 section 结束 - 保留代码以便后续启用

/* ───────── SYSTEM PROMPT ───────── */

function SystemPromptSection() {
  const [systemPrompt, setSystemPrompt] = useState('')
  const [savedPrompt, setSavedPrompt] = useState('')
  const [savingPrompt, setSavingPrompt] = useState(false)
  const { toast } = useToast()
  const { invoke: getPromptConfig } = useIpcInvoke('prompt-config:get')
  const { invoke: updatePromptConfig } = useIpcInvoke('prompt-config:update')

  const isDirty = systemPrompt !== savedPrompt

  useEffect(() => {
    getPromptConfig({})
      .then((res) => {
        setSystemPrompt(res.system.content)
        setSavedPrompt(res.system.content)
      })
      .catch(() => {})
  }, [getPromptConfig])

  const saveSystemPrompt = async () => {
    setSavingPrompt(true)
    try {
      const res = await updatePromptConfig({
        scope: 'system',
        value: { enabled: true, content: systemPrompt },
      })
      setSystemPrompt(res.system.content)
      setSavedPrompt(res.system.content)
      toast.success('系统提示词已保存')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存系统提示词失败')
    } finally {
      setSavingPrompt(false)
    }
  }

  const handleReset = () => {
    setSystemPrompt(savedPrompt)
  }

  const charCount = systemPrompt.length
  const estimatedTokens = Math.ceil(charCount / 4)

  return (
    <div className="settings-section">
      <div className="row section-header-row">
        <div className="flex1">
          <h2 className="section-h2">系统提示词</h2>
          <div className="lede section-lede">配置全局系统级提示词，作为所有 Agent 的基础指令。</div>
        </div>
        {isDirty && <span className="badge warning dot">未保存</span>}
      </div>

      <TextArea
        className="prompt-textarea"
        value={systemPrompt}
        onChange={(event) => setSystemPrompt(event.target.value)}
        placeholder="输入全局系统提示词...&#10;&#10;例如：你是一个专业的编程助手，请用中文回复。"
        rows={14}
      />

      <div className="prompt-editor-footer">
        <div className="prompt-editor-stats">
          <span>{charCount} 字符</span>
          <span className="prompt-stats-sep">·</span>
          <span>约 {estimatedTokens} tokens</span>
          {charCount > 10000 && (
            <>
              <span className="prompt-stats-sep">·</span>
              <span className="prompt-stats-warn">内容较长</span>
            </>
          )}
        </div>
        <div className="row row-gap-xs">
          {isDirty && (
            <Button size="small" type="text" onClick={handleReset}>
              撤销修改
            </Button>
          )}
          <Button
            size="small"
            type="primary"
            loading={savingPrompt}
            icon={<Icons.Check size={12} />}
            onClick={() => void saveSystemPrompt()}
            disabled={savingPrompt || !isDirty}
          >
            保存
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ───────── WORKFLOW TEMPLATES ───────── */
// 工作流模板暂未实现，从导航和 Section 映射中移除
// 代码保留以便后续启用
function WorkflowTemplatesSection() {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>(() =>
    readStoredJson(WORKFLOW_TEMPLATES_KEY, DEFAULT_WORKFLOW_TEMPLATES),
  )

  const restoreDefaults = () => {
    setTemplates(DEFAULT_WORKFLOW_TEMPLATES)
    writeStoredJson(WORKFLOW_TEMPLATES_KEY, DEFAULT_WORKFLOW_TEMPLATES)
  }

  return (
    <div className="settings-section">
      <div className="row section-header-row">
        <div className="flex1">
          <h2 className="section-h2">工作流模板</h2>
          <div className="lede section-lede">
            管理共享 DAG 模板与版本。模板会作为 Workflow 页创建新流程时的起点。
          </div>
        </div>
        <Button size="small" type="text" icon={<Icons.Refresh size={11} />} onClick={restoreDefaults}>
          恢复内置
        </Button>
      </div>

      <div className="card">
        {templates.map((template) => (
          <SettingsRow
            key={template.id}
            title={template.name}
            desc={`${template.desc} · ${template.nodes} 个节点 · ${template.updatedAt}`}
            right={<span className="badge">模板</span>}
          />
        ))}
      </div>
    </div>
  )
}
// 工作流模板 section 结束 - 保留代码以便后续启用

/* ───────── PERMISSIONS ───────── */
export function PermissionsSection() {
  const [profiles, setProfiles] = useState<PermissionProfileItem[]>([])
  const [activeProfileId, setActiveProfileId] = useState('project-standard')
  const [loading, setLoading] = useState(true)
  const [auditEnabled, setAuditEnabled] = useState(
    () => window.localStorage.getItem(AUDIT_ENABLED_KEY) !== 'false',
  )
  const [runtimePrefs, setRuntimePrefs] = useState<RuntimePermissionPrefs>(() =>
    readRuntimePermissionPrefs(),
  )

  const { invoke: listProfiles } = useIpcInvoke('permission:list-profiles')
  const { invoke: updateSandbox } = useIpcInvoke('permission:update-sandbox')
  const { invoke: updateRule } = useIpcInvoke('permission:update-rule')
  const { invoke: setActiveProfile } = useIpcInvoke('permission:set-active-profile')
  const { invoke: getSetting } = useIpcInvoke('settings:get')
  const { invoke: setSetting } = useIpcInvoke('settings:set')

  const runtimeAdapter = runtimePrefs.adapter ?? 'claude-sdk'
  const runtimeOptions = getRuntimePermissionModeOptions(runtimeAdapter)
  const runtimePermissionMode = getValidRuntimePermissionMode(
    runtimePrefs.permissionMode,
    runtimeAdapter,
  )
  const activeRuntimeMode = runtimeOptions.find((option) => option.value === runtimePermissionMode)

  const refresh = useCallback(() => {
    setLoading(true)
    listProfiles({})
      .then((res) => {
        setProfiles(res.profiles)
        setActiveProfileId(res.activeProfileId)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [listProfiles])

  useEffect(() => {
    return deferEffect(refresh)
  }, [refresh])

  useEffect(() => {
    let cancelled = false
    getSetting({
      category: RUNTIME_PERMISSION_SETTINGS_CATEGORY,
      key: RUNTIME_PERMISSION_SETTINGS_KEY,
    })
      .then((res) => {
        if (cancelled || res.value == null) return
        const next = normalizeRuntimePermissionSettings(res.value)
        setRuntimePrefs(next)
        writeRuntimePermissionPrefs(next)
      })
      .catch(console.error)
    return () => {
      cancelled = true
    }
  }, [getSetting])

  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? profiles[0]

  const handleProfileChange = (profileId: string) => {
    setActiveProfileId(profileId)
    void setActiveProfile({ profileId })
      .then((res) => setActiveProfileId(res.activeProfileId))
      .then(refresh)
      .catch(console.error)
  }

  const handleSandboxChange = (level: number) => {
    if (!activeProfile) return
    void updateSandbox({ profileId: activeProfile.id, sandboxLevel: level }).then(refresh)
  }

  const handleRuleChange = (action: string, mode: PermissionMode) => {
    if (!activeProfile) return
    void updateRule({ profileId: activeProfile.id, action, mode }).then(refresh)
  }

  const toggleAudit = () => {
    const next = !auditEnabled
    setAuditEnabled(next)
    window.localStorage.setItem(AUDIT_ENABLED_KEY, String(next))
  }

  const updateRuntimePrefs = (patch: RuntimePermissionPrefs) => {
    const next = { ...runtimePrefs, ...patch }
    const normalizedAdapter = next.adapter ?? 'claude-sdk'
    next.adapter = normalizedAdapter
    next.permissionMode = getValidRuntimePermissionMode(next.permissionMode, normalizedAdapter)
    setRuntimePrefs(next)
    writeRuntimePermissionPrefs(next)
    void setSetting({
      category: RUNTIME_PERMISSION_SETTINGS_CATEGORY,
      key: RUNTIME_PERMISSION_SETTINGS_KEY,
      value: next,
    }).catch(console.error)
  }

  const handleRuntimeAdapterChange = (adapter: SessionAgentAdapter) => {
    const permissionMode = getValidRuntimePermissionMode(runtimePermissionMode, adapter)
    updateRuntimePrefs({ adapter, permissionMode })
  }

  const RULE_META: Array<{
    action: string
    icon: ReactNode
    name: string
    hint: string
    scope: string
  }> = [
    {
      action: 'file_read',
      icon: <Icons.File />,
      name: '读取工作区文件',
      hint: '允许 · 不弹窗',
      scope: '工作区内',
    },
    {
      action: 'file_write',
      icon: <Icons.Edit />,
      name: '编辑工作区文件',
      hint: '自动写入，记录到 checkpoint',
      scope: '工作区内',
    },
    {
      action: 'file_read_any',
      icon: <Icons.File />,
      name: '访问工作区外文件',
      hint: '读取或写入 ~/ 之外路径',
      scope: '任意',
    },
    {
      action: 'command_exec',
      icon: <Icons.Terminal />,
      name: '执行 shell 命令',
      hint: '非破坏性命令',
      scope: '本会话',
    },
    {
      action: 'command_dangerous',
      icon: <Icons.AlertTriangle />,
      name: '高风险命令',
      hint: 'rm -rf、curl | sh、密钥导出',
      scope: '任意',
    },
    {
      action: 'git_push',
      icon: <Icons.GitBranch />,
      name: 'Git 推送',
      hint: '包含 --force / --force-with-lease',
      scope: '任意',
    },
    {
      action: 'network_known',
      icon: <Icons.Globe />,
      name: '网络访问',
      hint: 'HTTP/HTTPS 请求',
      scope: '域名白名单',
    },
    {
      action: 'network_unknown',
      icon: <Icons.Globe />,
      name: '访问陌生域名',
      hint: '未在白名单中的域名',
      scope: '任意',
    },
    {
      action: 'mcp_tool',
      icon: <Icons.MCP />,
      name: '调用 MCP 工具',
      hint: '按 server allowlist',
      scope: '按 server',
    },
    {
      action: 'secret_read',
      icon: <Icons.Lock />,
      name: '读取 secret',
      hint: '通过 secret reference 注入',
      scope: 'profile 内',
    },
    {
      action: 'long_task',
      icon: <Icons.Clock />,
      name: '长任务后台运行',
      hint: '≥ 30s 的任务',
      scope: '本会话',
    },
  ]

  const PROFILE_META: Record<string, { icon: ReactNode; desc: string }> = {
    strict: { icon: <Icons.Lock />, desc: '一切都问' },
    'project-standard': { icon: <Icons.Shield />, desc: '工作区写入自动允许' },
    trusted: { icon: <Icons.CheckCircle />, desc: '自动允许大多数' },
  }

  return (
    <div className="settings-section">
      <h2>权限策略</h2>
      <div className="lede">
        控制 Agent 能做什么、何时需要审批。沙箱等级配合策略一起决定运行时风险。
      </div>

      <div className="subsec-h">SDK 执行默认策略</div>
      <div className="card runtime-permission-card">
        <SettingsRow
          title="默认执行器"
          desc="影响新会话与无会话输入区；已有会话保留自己的运行时策略"
          right={
            <div className="select-sm">
              <Select
                value={runtimeAdapter}
                onChange={(v) => handleRuntimeAdapterChange(v as SessionAgentAdapter)}
                options={[
                  { label: 'Claude SDK', value: 'claude-sdk' },
                  { label: 'Codex', value: 'codex' },
                ]}
              />
            </div>
          }
        />
        <SettingsRow title="默认权限策略" desc="新建会话时将优先使用此权限策略" />
        <div className="runtime-permission-grid p-[10px]">
          {runtimeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`runtime-permission-option ${option.value === runtimePermissionMode ? 'active' : ''} ${option.tone ? `tone-${option.tone}` : ''}`}
              onClick={() => updateRuntimePrefs({ permissionMode: option.value })}
            >
              <span className="runtime-permission-icon">
                {option.tone === 'danger' ? (
                  <Icons.AlertTriangle />
                ) : option.tone === 'auto' ? (
                  <Icons.Zap />
                ) : (
                  <Icons.Shield />
                )}
              </span>
              <span className="runtime-permission-copy">
                <span className="runtime-permission-label">{option.label}</span>
                <span className="runtime-permission-desc">{option.desc}</span>
              </span>
            </button>
          ))}
        </div>
        {activeRuntimeMode?.tone === 'danger' && (
          <div className="runtime-permission-warning">
            <Icons.AlertTriangle />
            <span>
              当前默认策略会跳过人工审批，agent 的工具调用将被直接执行。仅在完全可信工作区使用。
            </span>
          </div>
        )}
      </div>

      <div className="subsec-h">权限 Profile</div>
      {loading ? (
        <div className="loading-sm">加载中…</div>
      ) : (
        <div className="row perm-profile-row">
          {profiles.map((p) => {
            const meta = PROFILE_META[p.id]
            return (
              <ProfileChip
                key={p.id}
                active={p.id === activeProfileId}
                onClick={() => handleProfileChange(p.id)}
                icon={meta?.icon ?? <Icons.Shield />}
                name={p.name}
                desc={meta?.desc ?? `沙箱 L${p.sandboxLevel}`}
              />
            )
          })}
        </div>
      )}

      {activeProfile && (
        <>
          <div className="subsec-h">具体权限 · {activeProfile.name}</div>
          <div className="card">
            {RULE_META.map(({ action, icon, name, hint, scope }) => {
              const rule = activeProfile.rules.find((r) => r.action === action)
              const mode = (rule?.mode ?? 'ask') as PermissionMode
              return (
                <PermRule
                  key={action}
                  icon={icon}
                  name={name}
                  hint={hint}
                  scope={scope}
                  mode={mode}
                  onModeChange={(m) => handleRuleChange(action, m)}
                />
              )
            })}
          </div>

          <div className="subsec-h">沙箱等级</div>
          <div className="card">
            {(
              [
                [0, 'L0 · 仅聊天', '完全禁用工具调用', false],
                [1, 'L1 · 只读工作区', '可读文件，不可写、不可执行命令', false],
                [2, 'L2 · 受控写入', '可写工作区文件，命令需审批 — 推荐', false],
                [3, 'L3 · 完全自动化', '工作区内大多数操作免审批；高风险仍审批', false],
                [4, 'L4 · 隔离沙箱', 'microVM 内执行 (实验性)', true],
              ] as [number, string, string, boolean][]
            ).map(([level, title, desc, disabled]) => (
              <SettingsRow
                key={level}
                title={title}
                desc={desc}
                right={
                  <Input
                    type="radio"
                    className="spark-radio"
                    name={`sb-${activeProfile.id}`}
                    checked={activeProfile.sandboxLevel === level}
                    onChange={() => handleSandboxChange(level)}
                    disabled={disabled}
                  />
                }
              />
            ))}
          </div>
        </>
      )}

      <div className="subsec-h">审计</div>
      <div className="card">
        <SettingsRow
          title="记录所有权限决策"
          desc="写入 SQLite · 不可篡改"
          right={
            <Switch
              size="small"
              checked={auditEnabled}
              onChange={toggleAudit}
            />
          }
        />
        <SettingsRow
          title="导出团队审计报告"
          desc="按周生成可签发的 JSON 报告"
          right={<Switch size="small" />}
        />
        <SettingsRow
          title="审计日志保留"
          right={
            <div className="select-sm">
              <Select
                defaultValue="90"
                options={[
                  { label: '30 天', value: '30' },
                  { label: '90 天', value: '90' },
                  { label: '1 年', value: '365' },
                  { label: '永久', value: 'forever' },
                ]}
              />
            </div>
          }
        />
      </div>
    </div>
  )
}

function ProfileChip({
  active,
  onClick,
  icon,
  name,
  desc,
}: {
  active: boolean
  onClick: () => void
  icon: ReactNode
  name: string
  desc: string
}) {
  return (
    <button onClick={onClick} className={`profile-chip ${active ? 'active' : ''}`}>
      <span className={`profile-chip-icon ${active ? 'active' : ''}`}>{icon}</span>
      <div>
        <div className={`profile-chip-name ${active ? 'active' : ''}`}>{name}</div>
        <div className="profile-chip-desc">{desc}</div>
      </div>
    </button>
  )
}

function PermRule({
  icon,
  name,
  hint,
  scope,
  mode,
  onModeChange,
}: {
  icon: ReactNode
  name: string
  hint: string
  scope: string
  mode: PermissionMode
  onModeChange?: (m: PermissionMode) => void
}) {
  return (
    <div className="perm-rule">
      <span className="ico">{icon}</span>
      <div className="desc">
        <div className="name">{name}</div>
        <div className="hint">{hint}</div>
      </div>
      <div className="select-full">
        <Select
          defaultValue={scope}
          options={[
            { label: '工作区内', value: '工作区内' },
            { label: '本会话', value: '本会话' },
            { label: '本项目', value: '本项目' },
            { label: '任意', value: '任意' },
            { label: 'profile 内', value: 'profile 内' },
            { label: '按 server', value: '按 server' },
            { label: '域名白名单', value: '域名白名单' },
          ]}
        />
      </div>
      <div className="select-full">
        <Select
          value={mode}
          onChange={(v) => onModeChange?.(v as PermissionMode)}
          options={[
            { label: '允许', value: 'allow' },
            { label: '询问', value: 'ask' },
            { label: '双重确认', value: 'ask-twice' },
            { label: '拒绝', value: 'deny' },
          ]}
        />
      </div>
    </div>
  )
}

/* ───────── TELEMETRY ───────── */
function TelemetrySection() {
  const [s, set] = usePersistedSettings(SETTINGS_TELEMETRY_KEY, DEFAULT_TELEMETRY)

  return (
    <div className="settings-section">
      <h2>遥测与日志</h2>
      <div className="lede">观察会话、工作流与 Agent 内部行为；导出诊断包帮助调试。</div>

      <div className="form-grid">
        <label>本地日志级别</label>
        <Select
          value={s.logLevel}
          onChange={(v) => set({ logLevel: v })}
          options={[
            { label: 'error', value: 'error' },
            { label: 'warn', value: 'warn' },
            { label: 'info', value: 'info' },
            { label: 'debug', value: 'debug' },
            { label: 'trace', value: 'trace' },
          ]}
        />

        <label>
          OpenTelemetry endpoint<span className="sub">可选 — 把 trace 转发到 collector</span>
        </label>
        <Input
          value={s.otlpEndpoint}
          onChange={(e) => set({ otlpEndpoint: e.target.value })}
          placeholder="https://otlp.example.com:4318 (可选)"
        />

        <label>Trace 采样率</label>
        <div className="control">
          <Input
            type="range"
            min="0"
            max="100"
            value={s.traceSamplingRate}
            onChange={(e) => set({ traceSamplingRate: Number(e.target.value) })}
            className="flex1"
          />
          <span className="mono-sm muted range-value">{s.traceSamplingRate}%</span>
        </div>

        <label>本地保留 trace 天数</label>
        <Input
          type="number"
          value={s.traceRetentionDays}
          onChange={(e) => set({ traceRetentionDays: Number(e.target.value) || 14 })}
          className="input-max-sm"
        />
      </div>

      <div className="subsec-h">最近运行</div>
      <div className="card">
        <SettingsRow
          title="代码功能开发：搜索优化"
          desc="Run #4f3a · 5 agent · 4m 38s · $0.92"
          right={
            <Button size="small" type="text" icon={<Icons.Eye size={11} />}>
              查看 trace
            </Button>
          }
        />
        <SettingsRow
          title="重构 auth 模块为 OAuth 2.1"
          desc="Run #41b8 · 1 agent · 6m 12s · $1.34"
          right={
            <Button size="small" type="text" icon={<Icons.Eye size={11} />}>
              查看 trace
            </Button>
          }
        />
        <SettingsRow
          title="MCP gateway 性能调优"
          desc="Run #38c0 · 1 agent · 失败"
          right={
            <Button size="small" type="text" danger icon={<Icons.Eye size={11} />}>
              查看错误
            </Button>
          }
        />
      </div>

      <div className="subsec-h">诊断包</div>
      <div className="card">
        <SettingsRow
          title="生成诊断包"
          desc="包含 app/OS 版本、provider 健康、近期错误日志，自动脱敏"
          right={
            <Button size="small" type="default" icon={<Icons.Download size={11} />}>
              生成
            </Button>
          }
        />
        <SettingsRow
          title="复制最近一次错误"
          desc="便于发到 GitHub Issue"
          right={
            <Button size="small" type="text" icon={<Icons.Copy size={11} />}>
              复制
            </Button>
          }
        />
      </div>
    </div>
  )
}

/* ───────── USAGE ───────── */
function UsageSection() {
  const [dashboard, setDashboard] = useState<{
    total: {
      totalInputTokens: number
      totalOutputTokens: number
      totalCacheReadTokens: number
      totalCacheWriteTokens: number
      totalCostUsd: number
      recordCount: number
    }
    currentMonth: {
      totalInputTokens: number
      totalOutputTokens: number
      totalCacheReadTokens: number
      totalCacheWriteTokens: number
      totalCostUsd: number
      recordCount: number
    }
    topModels: Array<{
      modelId: string
      providerId: string
      totalInputTokens: number
      totalOutputTokens: number
      totalCostUsd: number
      recordCount: number
    }>
    recentRecords: Array<{
      id: string
      session_id: string
      provider_id: string
      model_id: string
      input_tokens: number
      output_tokens: number
      cache_read_tokens: number
      cache_write_tokens: number
      cost_usd: number
      request_timestamp: string
      created_at: string
    }>
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.spark.invoke('usage:get-dashboard', {})
      setDashboard(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    return deferEffect(loadDashboard)
  }, [loadDashboard])

  const fmt = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return String(n)
  }

  const fmtUsd = (n: number) => {
    if (n === 0) return '$0.00'
    if (n < 0.01) return '<$0.01'
    return `$${n.toFixed(2)}`
  }

  const fmtDate = (ts: string) => {
    try {
      const d = new Date(ts)
      return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
    } catch {
      return ts
    }
  }

  const month = dashboard?.currentMonth
  const total = dashboard?.total
  const models = dashboard?.topModels ?? []
  const records = dashboard?.recentRecords ?? []

  return (
    <div className="settings-section">
      <h2>用量统计</h2>
      <div className="lede">追踪每次对话的 token 消耗和费用。数据仅保存在本地。</div>

      {error && <div className="card usage-error-card">{error}</div>}

      {/* ── Overview Cards ── */}
      <div className="subsec-h">本月概览</div>
      <div className="usage-overview-grid">
        <div className="usage-stat-card">
          <div className="usage-stat-label">输入 Token</div>
          <div className="usage-stat-value">
            {loading ? '—' : fmt(month?.totalInputTokens ?? 0)}
          </div>
        </div>
        <div className="usage-stat-card">
          <div className="usage-stat-label">输出 Token</div>
          <div className="usage-stat-value">
            {loading ? '—' : fmt(month?.totalOutputTokens ?? 0)}
          </div>
        </div>
        <div className="usage-stat-card">
          <div className="usage-stat-label">缓存命中</div>
          <div className="usage-stat-value">
            {loading ? '—' : fmt(month?.totalCacheReadTokens ?? 0)}
          </div>
        </div>
        <div className="usage-stat-card">
          <div className="usage-stat-label">预估费用</div>
          <div className="usage-stat-value usage-cost-value">
            {loading ? '—' : fmtUsd(month?.totalCostUsd ?? 0)}
          </div>
        </div>
      </div>

      {/* ── All-time summary ── */}
      <div className="subsec-h">累计统计</div>
      <div className="card">
        <SettingsRow
          title="总请求数"
          right={
            <span className="mono-sm strong">
              {loading ? '—' : String(total?.recordCount ?? 0)}
            </span>
          }
        />
        <SettingsRow
          title="总输入 Token"
          right={
            <span className="mono-sm strong">
              {loading ? '—' : fmt(total?.totalInputTokens ?? 0)}
            </span>
          }
        />
        <SettingsRow
          title="总输出 Token"
          right={
            <span className="mono-sm strong">
              {loading ? '—' : fmt(total?.totalOutputTokens ?? 0)}
            </span>
          }
        />
        <SettingsRow
          title="总费用"
          right={
            <span className="mono-sm strong usage-cost-value">
              {loading ? '—' : fmtUsd(total?.totalCostUsd ?? 0)}
            </span>
          }
        />
      </div>

      {/* ── Top Models ── */}
      <div className="subsec-h">模型用量排行</div>
      <div className="card">
        {models.length === 0 && !loading && (
          <div className="settings-card-row usage-empty">暂无用量数据</div>
        )}
        {models.map((m) => (
          <div key={`${m.providerId}-${m.modelId}`} className="settings-card-row usage-model-row">
            <div className="flex1 min-w-0">
              <div className="row-title">{m.modelId}</div>
              <div className="row-desc">{m.providerId}</div>
            </div>
            <div className="usage-model-stats">
              <span className="mono-sm">↑{fmt(m.totalInputTokens)}</span>
              <span className="mono-sm">↓{fmt(m.totalOutputTokens)}</span>
              <span className="mono-sm usage-cost-value">{fmtUsd(m.totalCostUsd)}</span>
            </div>
          </div>
        ))}
      </div>

      {/* ── Recent Records ── */}
      <div className="subsec-h">最近请求</div>
      <div className="card usage-records-card">
        {records.length === 0 && !loading && (
          <div className="settings-card-row usage-empty">暂无记录</div>
        )}
        <div className="usage-records-table">
          {records.map((r) => (
            <div key={r.id} className="usage-record-row">
              <span className="usage-rec-time">{fmtDate(r.request_timestamp)}</span>
              <span className="usage-rec-model">{r.model_id}</span>
              <span className="usage-rec-tokens mono-sm">
                ↑{fmt(r.input_tokens)} ↓{fmt(r.output_tokens)}
              </span>
              <span className="usage-rec-cost mono-sm">{fmtUsd(r.cost_usd)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Actions ── */}
      <div className="subsec-h">数据管理</div>
      <div className="card">
        <SettingsRow
          title="刷新数据"
          desc="重新从数据库加载用量统计"
          right={
            <Button size="small" type="text" loading={loading} icon={<Icons.Refresh size={11} />} onClick={loadDashboard} disabled={loading}>
              刷新
            </Button>
          }
        />
      </div>
    </div>
  )
}

/* ───────── STORAGE ───────── */
function StorageSection() {
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState<{
    userDataPath: string
    projectsDir: string
    canvasProjectsRoot: string
    databasePath: string
    databaseBytes: number
    cacheBytes: number
    projectsBytes: number
    canvasProjectsBytes: number
    totalBytes: number
  } | null>(null)
  const [canvasProjectsRoot, setCanvasProjectsRoot] = useState('')
  const [statsLoading, setStatsLoading] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [canvasMaintaining, setCanvasMaintaining] = useState(false)
  const { toast } = useToast()
  const { requestConfirm } = useApp()
  const { invoke: getCurrentWorkspace } = useIpcInvoke('workspace:get-current')
  const { invoke: openWorkspace } = useIpcInvoke('workspace:open')
  const { invoke: closeWorkspace } = useIpcInvoke('workspace:close')
  const { invoke: openDirectory } = useIpcInvoke('dialog:open-directory')
  const { invoke: getStorageStats } = useIpcInvoke('app:get-storage-stats')
  const { invoke: clearCache } = useIpcInvoke('app:clear-cache')
  const { invoke: openDataDir } = useIpcInvoke('app:open-data-dir')
  const { invoke: getSetting } = useIpcInvoke('settings:get')
  const { invoke: setSetting } = useIpcInvoke('settings:set')

  const refreshWorkspace = useCallback(async () => {
    const res = await getCurrentWorkspace({})
    setWorkspace(res.workspace)
  }, [getCurrentWorkspace])

  const refreshStats = useCallback(async () => {
    setStatsLoading(true)
    try {
      const res = await getStorageStats({})
      setStats(res)
      setCanvasProjectsRoot((current) => current || res.canvasProjectsRoot)
    } catch (err) {
      console.error('加载存储统计失败', err)
    } finally {
      setStatsLoading(false)
    }
  }, [getStorageStats])

  useEffect(() => {
    return deferEffect(() => {
      refreshWorkspace().catch((err: unknown) =>
        setError(err instanceof Error ? err.message : String(err)),
      )
      refreshStats().catch(console.error)
      getSetting({ category: 'canvas', key: 'data' })
        .then((res) => {
          const value = res.value as { projectsRootPath?: string } | null
          if (value?.projectsRootPath) setCanvasProjectsRoot(value.projectsRootPath)
        })
        .catch(console.error)
    })
  }, [getSetting, refreshWorkspace, refreshStats])

  const handleOpenDataDir = async () => {
    try {
      await openDataDir({})
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '打开数据目录失败')
    }
  }

  const handleClearCache = async (pruneOrphan: boolean) => {
    const label = pruneOrphan ? '清空缓存并清理孤儿项目目录' : '清空全部缓存'
    const confirmed = await requestConfirm({
      title: `${label}？`,
      description: '该操作不会影响会话、消息、规则等业务数据。',
      confirmText: '清空',
      danger: true,
    })
    if (!confirmed) return
    setClearing(true)
    try {
      const res = await clearCache({ pruneOrphanProjects: pruneOrphan })
      toast.success(`已清理 ${formatBytes(res.clearedBytes)}`)
      await refreshStats()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '清空缓存失败')
    } finally {
      setClearing(false)
    }
  }

  const handleOpenWorkspace = async () => {
    try {
      const selected = await openDirectory({ title: '选择默认工作区' })
      if (selected.canceled || selected.filePath === undefined) {
        return
      }
      const res = await openWorkspace({ rootPath: selected.filePath })
      setWorkspace(res.workspace)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleChooseCanvasRoot = async () => {
    try {
      const selected = await openDirectory({
        title: '选择 Canvas 项目默认保存位置',
        ...(canvasProjectsRoot ? { defaultPath: canvasProjectsRoot } : {}),
      })
      if (selected.canceled || selected.filePath === undefined) return
      const current = await getSetting({ category: 'canvas', key: 'data' })
      const currentValue =
        current.value && typeof current.value === 'object'
          ? (current.value as Record<string, unknown>)
          : {}
      await setSetting({
        category: 'canvas',
        key: 'data',
        value: { ...currentValue, projectsRootPath: selected.filePath },
      })
      setCanvasProjectsRoot(selected.filePath)
      toast.success('已更新 Canvas 项目默认位置')
      await refreshStats()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '更新 Canvas 项目位置失败')
    }
  }

  const handleMigrateCanvasAssets = async () => {
    const confirmed = await requestConfirm({
      title: '迁移旧画布资源？',
      description: '会把旧全局目录里的画布图片/视频复制到各自项目目录，并更新项目快照。',
      confirmText: '迁移',
    })
    if (!confirmed) return
    setCanvasMaintaining(true)
    try {
      await canvasApi.hydrateFromStorage()
      const projects = await canvasApi.listProjects()
      let moved = 0
      let skipped = 0
      for (const project of projects) {
        const result = await canvasApi.migrateProjectAssetsToDirectory(project.id)
        moved += result.movedAssets
        skipped += result.skippedAssets
      }
      toast.success(
        `迁移完成：${moved} 个资源已归档到项目目录${skipped > 0 ? `，${skipped} 个跳过` : ''}`,
      )
      await refreshStats()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '迁移画布资源失败')
    } finally {
      setCanvasMaintaining(false)
    }
  }

  const handleCleanupCanvasAssets = async () => {
    const confirmed = await requestConfirm({
      title: '清理旧画布资源？',
      description: '只清理旧全局画布资源目录中不再被快照引用的文件，项目目录内资源不会删除。',
      confirmText: '清理',
      danger: true,
    })
    if (!confirmed) return
    setCanvasMaintaining(true)
    try {
      const result = await canvasApi.cleanupLegacyCanvasAssets()
      toast.success(`已清理 ${result.deletedFiles} 个文件，共 ${formatBytes(result.deletedBytes)}`)
      await refreshStats()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '清理旧画布资源失败')
    } finally {
      setCanvasMaintaining(false)
    }
  }

  const handleCloseWorkspace = async () => {
    if (workspace === null) return
    await closeWorkspace({ workspaceId: workspace.id })
    setWorkspace(null)
  }

  return (
    <div className="settings-section">
      <h2>存储与备份</h2>
      <div className="lede">所有会话、规则、工作流与审计日志默认存在本地 SQLite。</div>

      <div className="form-grid">
        <label>数据目录</label>
        <div className="control">
          <Input
            className="flex1"
            value={stats?.userDataPath ?? '加载中...'}
            readOnly
          />
          <Button size="small" type="default" icon={<Icons.Folder size={12} />} onClick={handleOpenDataDir}>
            打开
          </Button>
        </div>

        <label>
          当前工作区<span className="sub">Agent 文件工具的根目录</span>
        </label>
        <div className="control">
          <Input className="flex1" value={workspace?.rootPath ?? '未打开工作区'} readOnly />
          <Button size="small" type="default" icon={<Icons.Folder size={12} />} onClick={handleOpenWorkspace}>
            选择
          </Button>
          <Button
            size="small"
            type="text"
            onClick={handleCloseWorkspace}
            disabled={workspace === null}
          >
            关闭
          </Button>
        </div>

        <label>
          Canvas 项目根目录<span className="sub">新建画布项目默认保存位置</span>
        </label>
        <div className="control">
          <Input className="flex1" value={canvasProjectsRoot || stats?.canvasProjectsRoot || '加载中...'} readOnly />
          <Button size="small" type="default" icon={<Icons.Folder size={12} />} onClick={() => void handleChooseCanvasRoot()}>
            选择
          </Button>
        </div>
      </div>

      {error !== null && <div className="card storage-card">{error}</div>}

      <div className="subsec-h">
        存储用量
        <Button
          size="small"
          type="text"
          loading={statsLoading}
          onClick={() => void refreshStats()}
          disabled={statsLoading}
          style={{ marginLeft: 8 }}
        >
          刷新
        </Button>
      </div>
      <div className="card">
        {stats === null ? (
          <div className="empty-compact">
            <div className="empty-desc">{statsLoading ? '正在统计...' : '暂无数据'}</div>
          </div>
        ) : (
          <>
            <UsageRow
              label="业务数据库 (spark.db)"
              used={formatBytes(stats.databaseBytes)}
              pct={percent(stats.databaseBytes, stats.totalBytes)}
            />
            <UsageRow
              label="项目工作目录 (projects/)"
              used={formatBytes(stats.projectsBytes)}
              pct={percent(stats.projectsBytes, stats.totalBytes)}
            />
            <UsageRow
              label="Canvas 项目目录"
              used={formatBytes(stats.canvasProjectsBytes)}
              pct={percent(stats.canvasProjectsBytes, stats.totalBytes)}
            />
            <UsageRow
              label="浏览器缓存 (Cache / GPU / 共享词典)"
              used={formatBytes(stats.cacheBytes)}
              pct={percent(stats.cacheBytes, stats.totalBytes)}
            />
            <div className="usage-total-hint">
              合计：{formatBytes(stats.totalBytes)} · 数据库位置：{stats.databasePath}
            </div>
          </>
        )}
      </div>

      <div className="subsec-h">备份</div>
      <div className="card">
        <SettingsRow
          title="自动备份"
          desc="每日凌晨 3:00 增量备份到 Time Machine / 指定目录"
          right={<Switch size="small" defaultChecked />}
        />
        <SettingsRow
          title="备份目录"
          desc="~/Backups/SparkAgent"
          right={
            <Button size="small" type="default" icon={<Icons.Folder size={11} />}>
              修改
            </Button>
          }
        />
        <SettingsRow
          title="最近一次备份"
          desc="今天 03:00 · 成功 · 41 MB"
          right={<Button size="small" type="text">查看历史</Button>}
        />
        <SettingsRow
          title="导出全部数据"
          desc="JSONL + 文件 · 可在另一台机器导入"
          right={
            <Button size="small" type="default" icon={<Icons.Download size={11} />}>
              导出
            </Button>
          }
        />
      </div>

      <div className="subsec-h">清理</div>
      <div className="card">
        <SettingsRow
          title="清空浏览器与渲染缓存"
          desc={`清理 Electron / Chromium 的 Cache、Code Cache、GPUCache 等${stats ? `（当前占用 ${formatBytes(stats.cacheBytes)}）` : ''}。下次启动会自动重建，不影响会话与设置。`}
          right={
            <Button
              size="small"
              type="text"
              danger
              loading={clearing}
              onClick={() => void handleClearCache(false)}
              disabled={clearing}
            >
              清空
            </Button>
          }
        />
        <SettingsRow
          title="清理孤儿项目目录"
          desc="删除 projects/ 下不再被任何项目引用的临时目录。同时清空浏览器缓存。"
          right={
            <Button
              size="small"
              type="text"
              danger
              loading={clearing}
              onClick={() => void handleClearCache(true)}
              disabled={clearing}
            >
              清空
            </Button>
          }
        />
        <SettingsRow
          title="迁移旧画布资源到项目目录"
          desc="将旧全局 media 目录中的画布资源复制进对应 Canvas 项目文件夹，并重写快照引用。"
          right={
            <Button
              size="small"
              type="text"
              loading={canvasMaintaining}
              onClick={() => void handleMigrateCanvasAssets()}
              disabled={canvasMaintaining}
            >
              迁移
            </Button>
          }
        />
        <SettingsRow
          title="清理旧画布孤儿资源"
          desc="清理旧全局画布资源目录中不再被任何快照引用的图片、音频或视频文件。"
          right={
            <Button
              size="small"
              type="text"
              danger
              loading={canvasMaintaining}
              onClick={() => void handleCleanupCanvasAssets()}
              disabled={canvasMaintaining}
            >
              清理
            </Button>
          }
        />
      </div>
    </div>
  )
}

/* ───────── ARCHIVED ───────── */
function ArchivedSection() {
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([])
  const [sessions, setSessions] = useState<SessionListResponse['sessions']>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { toast } = useToast()
  const { requestConfirm } = useApp()

  const { invoke: listWorkspaces } = useIpcInvoke('workspace:list')
  const { invoke: listSessions } = useIpcInvoke('session:list')
  const { invoke: updateWorkspace } = useIpcInvoke('workspace:update')
  const { invoke: updateSession } = useIpcInvoke('session:update')
  const { invoke: deleteWorkspace } = useIpcInvoke('workspace:delete')
  const { invoke: deleteSession } = useIpcInvoke('session:delete')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [wsRes, sessRes] = await Promise.all([
        listWorkspaces({ includeArchived: true, limit: 100 }),
        listSessions({ includeArchived: true, limit: 100 }),
      ])
      setWorkspaces(wsRes.workspaces.filter((w) => w.archivedAt != null))
      setSessions(sessRes.sessions.filter((s) => s.archivedAt != null))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [listWorkspaces, listSessions])

  useEffect(() => {
    return deferEffect(refresh)
  }, [refresh])

  const handleRestoreWorkspace = async (workspace: WorkspaceInfo) => {
    try {
      await updateWorkspace({ workspaceId: workspace.id, archived: false })
      toast.success(`项目「${workspace.name}」已恢复`)
      refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '恢复项目失败')
    }
  }

  const handleRestoreSession = async (session: SessionListResponse['sessions'][number]) => {
    try {
      await updateSession({ sessionId: session.id, archived: false })
      toast.success(`会话「${session.title || '新会话'}」已恢复`)
      refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '恢复会话失败')
    }
  }

  const handleDeleteWorkspace = async (workspace: WorkspaceInfo) => {
    const confirmed = await requestConfirm({
      title: `永久删除项目「${workspace.name}」？`,
      description: '此操作不可撤销。',
      confirmText: '永久删除',
      danger: true,
    })
    if (!confirmed) return
    try {
      await deleteWorkspace({ workspaceId: workspace.id })
      toast.success(`项目「${workspace.name}」已删除`)
      refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除项目失败')
    }
  }

  const handleDeleteSession = async (session: SessionListResponse['sessions'][number]) => {
    const confirmed = await requestConfirm({
      title: `永久删除会话「${session.title || '新会话'}」？`,
      description: '此操作不可撤销。',
      confirmText: '永久删除',
      danger: true,
    })
    if (!confirmed) return
    try {
      await deleteSession({ sessionId: session.id })
      toast.success(`会话「${session.title || '新会话'}」已删除`)
      refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除会话失败')
    }
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—'
    const d = new Date(dateStr)
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
  }

  return (
    <div className="settings-section">
      <h2>已归档</h2>
      <div className="lede">归档后的项目和会话会从主列表隐藏，但仍可在此查看、恢复或永久删除。</div>

      {error && <div className="card storage-card">{error}</div>}

      {/* ── Archived Workspaces ── */}
      <div className="subsec-h">已归档项目 ({workspaces.length})</div>
      <div className="card">
        {loading && <div className="settings-card-row">加载中...</div>}
        {!loading && workspaces.length === 0 && (
          <div className="settings-card-row">暂无已归档的项目</div>
        )}
        {!loading &&
          workspaces.length > 0 &&
          workspaces.map((w) => (
            <div key={w.id} className="settings-card-row archived-item-row">
              <div className="flex1 min-w-0">
                <div className="row-title">{w.name}</div>
                <div className="row-desc mono-sm">{w.rootPath}</div>
                <div className="row-desc">归档于 {formatDate(w.archivedAt)}</div>
              </div>
              <div className="archived-item-actions">
                <Button size="small" type="default" icon={<Icons.Refresh size={11} />} onClick={() => handleRestoreWorkspace(w)}>
                  恢复
                </Button>
                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<Icons.Trash size={11} />}
                  onClick={() => handleDeleteWorkspace(w)}
                >
                  删除
                </Button>
              </div>
            </div>
          ))}
      </div>

      {/* ── Archived Sessions ── */}
      <div className="subsec-h">已归档会话 ({sessions.length})</div>
      <div className="card">
        {loading && <div className="settings-card-row">加载中...</div>}
        {!loading && sessions.length === 0 && (
          <div className="settings-card-row">暂无已归档的会话</div>
        )}
        {!loading &&
          sessions.length > 0 &&
          sessions.map((s) => (
            <div key={s.id} className="settings-card-row archived-item-row">
              <div className="flex1 min-w-0">
                <div className="row-title">{s.title || '新会话'}</div>
                <div className="row-desc">
                  {s.messageCount} 条消息 · {formatDate(s.createdAt)} · 归档于{' '}
                  {formatDate(s.archivedAt)}
                </div>
              </div>
              <div className="archived-item-actions">
                <Button size="small" type="default" icon={<Icons.Refresh size={11} />} onClick={() => handleRestoreSession(s)}>
                  恢复
                </Button>
                <Button size="small" type="text" danger icon={<Icons.Trash size={11} />} onClick={() => handleDeleteSession(s)}>
                  删除
                </Button>
              </div>
            </div>
          ))}
      </div>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

function percent(part: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.round((part / total) * 100))
}

function UsageRow({ label, used, pct }: { label: string; used: string; pct: number }) {
  return (
    <div className="settings-card-row usage-row">
      <div className="row">
        <span className="perm-row-hint">{label}</span>
        <span className="flex1" />
        <span className="mono-sm strong">{used}</span>
        <span className="mono-sm faint range-value">{pct}%</span>
      </div>
      <div className="usage-bar-track">
        <div className="usage-bar-fill" style={{ width: `${pct}%` }} /* dynamic */ />
      </div>
    </div>
  )
}

/* ───────── INTEGRITY ───────── */
function IntegritySection() {
  const [sdks, setSdks] = useState<SdkIntegrityItem[]>([])
  const [tools, setTools] = useState<RuntimeToolStatus[]>([])
  const [checkedAt, setCheckedAt] = useState<string | null>(null)
  const [isChecking, setIsChecking] = useState(false)
  const [isCheckingLatest, setIsCheckingLatest] = useState(false)
  const [installingPkg, setInstallingPkg] = useState<string | null>(null)
  const [installResult, setInstallResult] = useState<{
    pkg: string
    success: boolean
    message: string
  } | null>(null)
  const { toast } = useToast()

  // Load cached result from startup auto-check
  useEffect(() => {
    const loadCached = () => {
      try {
        const cached = window.localStorage.getItem('spark-sdk-integrity')
        if (cached) {
          const parsed = JSON.parse(cached) as {
            sdks: SdkIntegrityItem[]
            tools: RuntimeToolStatus[]
            checkedAt: string
          }
          setSdks(parsed.sdks)
          setTools(parsed.tools ?? [])
          setCheckedAt(parsed.checkedAt)
        }
      } catch {
        /* ignore */
      }
    }
    loadCached()

    // Also subscribe to startup integrity push
    const unsub = window.spark?.on('stream:sdk:integrity', (payload) => {
      setSdks(payload.sdks)
      setTools(payload.tools ?? [])
      setCheckedAt(payload.checkedAt)
      window.localStorage.setItem('spark-sdk-integrity', JSON.stringify(payload))
    })
    return unsub ?? (() => {})
  }, [])

  const handleCheck = async (checkLatest = false) => {
    if (checkLatest) {
      setIsCheckingLatest(true)
    } else {
      setIsChecking(true)
    }
    try {
      const result = await window.spark.invoke('sdk:integrity-check', { checkLatest })
      setSdks(result.sdks)
      setTools(result.tools ?? [])
      setCheckedAt(result.checkedAt)
      window.localStorage.setItem('spark-sdk-integrity', JSON.stringify(result))
    } catch (err) {
      toast.error(`检测失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsChecking(false)
      setIsCheckingLatest(false)
    }
  }

  const handleInstall = async (packageName: string) => {
    setInstallingPkg(packageName)
    setInstallResult(null)
    try {
      const result = await window.spark.invoke('sdk:integrity-install', { packageName })
      setInstallResult({ pkg: packageName, success: result.success, message: result.message })
      if (result.success) {
        toast.success(result.message)
        // Re-check after install
        await handleCheck(true)
      } else {
        toast.error(result.message)
      }
    } catch (err) {
      toast.error(`安装失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setInstallingPkg(null)
    }
  }

  const getStatusBadge = (sdk: SdkIntegrityItem) => {
    if (!sdk.installed) {
      return <span className="badge error dot">未安装</span>
    }
    if (sdk.updateAvailable) {
      return <span className="badge warning dot">有新版 {sdk.latestVersion}</span>
    }
    if (sdk.latestChecked && sdk.latestVersion && !sdk.updateAvailable) {
      return <span className="badge success dot">最新</span>
    }
    if (sdk.installed) {
      return <span className="badge success dot">已安装</span>
    }
    return <span className="badge dot">未知</span>
  }

  const getToolBadge = (tool: RuntimeToolStatus) => {
    if (tool.available) {
      return <span className="badge success dot">可用</span>
    }
    return <span className="badge error dot">未找到</span>
  }

  const getToolIcon = (command: string) => {
    switch (command) {
      case 'node':
        return <Icons.Cpu size={14} />
      case 'npm':
        return <Icons.Package size={14} />
      case 'git':
        return <Icons.GitBranch size={14} />
      default:
        return <Icons.Terminal size={14} />
    }
  }

  const formatCheckedTime = (iso: string | null) => {
    if (!iso) return '从未检测'
    try {
      return new Date(iso).toLocaleString('zh-CN')
    } catch {
      return iso
    }
  }

  // Count installed / total for summary (SDKs + tools combined)
  const sdkInstalled = sdks.filter((s) => s.installed).length
  const toolAvailable = tools.filter((t) => t.available).length
  const totalItems = sdks.length + tools.length
  const allOk = totalItems > 0 && sdkInstalled === sdks.length && toolAvailable === tools.length

  return (
    <div className="settings-section">
      <h2>完整性检测</h2>
      <div className="lede">检测 Agent 运行所需的环境依赖和 SDK 包，确保核心功能可用。</div>

      {/* ── Status summary + actions ── */}
      <div className="integrity-toolbar">
        <div className="integrity-status-row">
          {totalItems > 0 ? (
            <div className={`integrity-status-badge ${allOk ? 'ok' : 'warn'}`}>
              {allOk ? <Icons.CheckCircle size={14} /> : <Icons.AlertTriangle size={14} />}
              <span>
                {allOk ? '环境完整' : `${sdkInstalled + toolAvailable}/${totalItems} 正常`}
              </span>
            </div>
          ) : (
            <div className="integrity-status-badge unknown">
              <Icons.Refresh size={14} />
              <span>尚未检测</span>
            </div>
          )}
          {checkedAt && (
            <span className="muted" style={{ fontSize: '11px' }}>
              上次检测: {formatCheckedTime(checkedAt)}
            </span>
          )}
        </div>
        <div className="integrity-actions">
          <Button
            size="small"
            type="default"
            loading={isChecking}
            disabled={isChecking || isCheckingLatest}
            icon={<Icons.Refresh size={12} className={isChecking ? 'spin' : ''} />}
            onClick={() => void handleCheck(false)}
          >
            立即检测
          </Button>
          <Button
            size="small"
            type="default"
            loading={isCheckingLatest}
            disabled={isChecking || isCheckingLatest}
            icon={<Icons.Globe size={12} className={isCheckingLatest ? 'spin' : ''} />}
            onClick={() => void handleCheck(true)}
          >
            检查最新版本
          </Button>
        </div>
      </div>

      {/* ── Install result banner ── */}
      {installResult && (
        <div className={`integrity-banner ${installResult.success ? 'success' : 'error'}`}>
          {installResult.success ? (
            <Icons.CheckCircle size={14} />
          ) : (
            <Icons.AlertTriangle size={14} />
          )}
          <span>{installResult.message}</span>
          <Button
            size="small"
            type="text"
            icon={<Icons.X size={12} />}
            onClick={() => setInstallResult(null)}
            style={{ marginLeft: 'auto', padding: '0 4px', height: 20 }}
          />
        </div>
      )}

      {/* ── Environment tools (node, npm, git) ── */}
      <div className="subsec-h" style={{ marginTop: 0 }}>
        环境工具
      </div>
      <div className="settings-card integrity-sdk-card">
        {tools.map((tool, idx) => (
          <div key={tool.command} className={`integrity-sdk-row ${idx > 0 ? 'bordered' : ''}`}>
            <div className="integrity-tool-icon">{getToolIcon(tool.command)}</div>
            <div className="integrity-sdk-info">
              <div className="integrity-sdk-name">{tool.displayName}</div>
              <div className="integrity-sdk-version">
                {tool.available
                  ? (tool.version ?? '已安装')
                  : tool.resolvedPath
                    ? tool.resolvedPath
                    : '未找到'}
              </div>
            </div>
            <div className="integrity-sdk-right">
              {getToolBadge(tool)}
              {!tool.available && (
                <Button
                  size="small"
                  type="default"
                  icon={<Icons.ExternalLink size={12} />}
                  href={tool.downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  下载
                </Button>
              )}
            </div>
          </div>
        ))}
        {tools.length === 0 && !isChecking && (
          <div className="integrity-empty">
            <Icons.Terminal size={24} />
            <span>点击"立即检测"检查环境工具</span>
          </div>
        )}
      </div>

      {/* ── SDK list ── */}
      <div className="subsec-h">核心依赖</div>
      <div className="settings-card integrity-sdk-card">
        {sdks.map((sdk, idx) => (
          <div key={sdk.packageName}>
            <div className={`integrity-sdk-row ${idx > 0 ? 'bordered' : ''}`}>
              <div className="integrity-sdk-info">
                <div className="integrity-sdk-name">{sdk.displayName}</div>
                <div className="integrity-sdk-version">
                  {sdk.installedVersion
                    ? `v${sdk.installedVersion}`
                    : sdk.installed
                      ? '已安装'
                      : '未安装'}
                </div>
              </div>
              <div className="integrity-sdk-right">
                {getStatusBadge(sdk)}
                {(!sdk.installed || sdk.updateAvailable) && (
                  <Button
                    size="small"
                    type="primary"
                    loading={installingPkg === sdk.packageName}
                    disabled={installingPkg === sdk.packageName}
                    icon={<Icons.Download size={12} />}
                    onClick={() => void handleInstall(sdk.packageName)}
                  >
                    {sdk.installed ? '更新' : '安装'}
                  </Button>
                )}
              </div>
            </div>
            {sdk.error && <div className="integrity-sdk-error">{sdk.error}</div>}
          </div>
        ))}
        {sdks.length === 0 && !isChecking && (
          <div className="integrity-empty">
            <Icons.Package size={24} />
            <span>点击"立即检测"开始检查 SDK 完整性</span>
          </div>
        )}
      </div>

      {/* ── Reference ── */}
      <div className="subsec-h">依赖说明</div>
      <div className="integrity-ref-card">
        <div className="integrity-ref-item">
          <div className="integrity-ref-left">
            <div className="integrity-ref-name">Node.js</div>
            <div className="integrity-ref-desc">
              JavaScript 运行时环境，Agent 进程执行的基础依赖。推荐 v18+ 版本。
            </div>
          </div>
          <span className="badge danger dot">必需</span>
        </div>
        <div className="integrity-ref-item bordered">
          <div className="integrity-ref-left">
            <div className="integrity-ref-name">npm</div>
            <div className="integrity-ref-desc">
              Node.js 包管理器，用于安装和管理 SDK 依赖。随 Node.js 一起安装。
            </div>
          </div>
          <span className="badge danger dot">必需</span>
        </div>
        <div className="integrity-ref-item bordered">
          <div className="integrity-ref-left">
            <div className="integrity-ref-name">Git</div>
            <div className="integrity-ref-desc">
              版本控制系统，支持代码仓库操作、文件差异比较和分支管理。
            </div>
          </div>
          <span className="badge danger dot">必需</span>
        </div>
        <div className="integrity-ref-item bordered">
          <div className="integrity-ref-left">
            <div className="integrity-ref-name">Claude Agent SDK</div>
            <div className="integrity-ref-desc">
              提供 Claude Code 级别的 Agent 执行引擎，包含文件编辑、Shell 命令、代码搜索等内置工具。
            </div>
          </div>
          <span className="badge danger dot">必需</span>
        </div>
        <div className="integrity-ref-item bordered">
          <div className="integrity-ref-left">
            <div className="integrity-ref-name">OpenAI / Codex SDK</div>
            <div className="integrity-ref-desc">
              提供 OpenAI 模型适配和 Codex 代码生成能力，支持 Responses API。
            </div>
          </div>
          <span className="badge danger dot">必需</span>
        </div>
      </div>
    </div>
  )
}

/* ───────── UPDATES ───────── */
function UpdatesSection() {
  const [s, set] = usePersistedSettings(SETTINGS_UPDATES_KEY, DEFAULT_UPDATES)
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const installActionLabel = isPlatformDarwin ? '打开安装镜像' : '安装更新'
  const autoInstallSupported = isPlatformWin32
  useEffect(() => {
    window.spark
      ?.invoke('update:get-status', {})
      .then((res) => {
        setStatus(res.status)
      })
      .catch(() => {
        /* ignore */
      })
  }, [])

  // Subscribe to update status stream events
  useEffect(() => {
    const unsub = window.spark?.on('stream:update:status', (payload) => {
      setStatus(payload)
    })
    return unsub
  }, [])

  useEffect(() => {
    if (s.autoDownload) {
      set({ autoDownload: false })
      void window.spark?.invoke('update:settings', { autoDownload: false })
    }
  }, [s.autoDownload, set])

  useEffect(() => {
    if (autoInstallSupported || !s.autoInstall) return
    set({ autoInstall: false })
    void window.spark?.invoke('update:settings', { autoInstall: false })
  }, [autoInstallSupported, s.autoInstall, set])

  const handleCheckUpdate = async () => {
    try {
      await window.spark.invoke('update:check', {})
    } catch {
      // Error handled via stream events
    }
  }

  const handleDownload = async () => {
    try {
      await window.spark.invoke('update:download', {})
    } catch {
      // Error handled via stream events
    }
  }

  const handleInstall = () => {
    void window.spark.invoke('update:install-restart', {})
  }

  const handleOpenReleasesPage = () => {
    void window.spark?.invoke('browser:open-external', { url: RELEASES_URL })
  }

  const handleSettingsChange = (key: keyof UpdatesSettings, value: boolean | string) => {
    set({ [key]: value })
    const patch: Record<string, boolean | string> = {}
    if (
      (key === 'autoCheck' || key === 'autoDownload' || key === 'autoInstall') &&
      typeof value === 'boolean'
    ) {
      patch[key] = value
    }
    if (key === 'channel' && typeof value === 'string') {
      patch.channel = value as 'stable' | 'beta'
    }
    if (Object.keys(patch).length > 0) {
      void window.spark.invoke('update:settings', patch)
    }
  }

  const state = status?.state ?? 'idle'
  const isChecking = state === 'checking'
  const isDownloading = state === 'downloading'
  const isAvailable = state === 'available'
  const hasUpdate = isAvailable || isDownloading || state === 'downloaded'
  const isDownloaded = state === 'downloaded'
  const isError = state === 'error'
  const currentVersion = status?.currentVersion ?? '0.1.0'
  const lastChecked =
    status?.lastCheckedAt != null ? new Date(status.lastCheckedAt).toLocaleString('zh-CN') : null

  // Update card status icon and label
  const getStatusIcon = () => {
    if (isError) return <Icons.AlertTriangle size={26} />
    if (isDownloaded) return <Icons.CheckCircle size={26} />
    if (isDownloading) return <Icons.Download size={26} />
    if (isAvailable) return <Icons.Download size={26} />
    if (isChecking) return <Icons.Refresh size={26} className="spin" />
    return <Icons.CheckCircle size={26} />
  }

  const getStatusLabel = () => {
    if (isError) return `检查失败：${status?.error ?? '未知错误'}`
    if (isChecking) return '正在检查更新…'
    if (isDownloading)
      return `正在下载 ${status?.progress != null ? `(${Math.round(status.progress.percent)}%)` : ''}`
    if (isDownloaded) return `安装包已就绪：v${status?.updateInfo?.version ?? '?'}`
    if (hasUpdate) return `发现新版本：v${status?.updateInfo?.version ?? '?'}`
    return `已是最新版本`
  }

  const getStatusClass = () => {
    if (isError) return 'error'
    if (isChecking) return 'checking'
    if (isDownloading) return 'downloading'
    if (isDownloaded) return 'downloaded'
    if (isAvailable) return 'available'
    return 'ok'
  }

  return (
    <div className="settings-section">
      <h2>更新</h2>
      <div className="lede">保持 Spark Agent 最新版本以获得最新模型与安全修复。</div>

      <div className="card update-card">
        <div className={`update-icon ${getStatusClass()}`}>{getStatusIcon()}</div>
        <div className="flex1">
          <div className="strong update-version">{getStatusLabel()}</div>
          <div className="muted update-meta">
            Spark Agent {currentVersion}
            {lastChecked ? ` · 上次检查 ${lastChecked}` : ''}
          </div>
          {isDownloading && status?.progress != null && (
            <div className="update-progress-bar">
              <div
                className="update-progress-fill"
                style={{ width: `${status.progress.percent}%` }}
              />
            </div>
          )}
        </div>
        <div className="update-actions">
          {isDownloaded ? (
            <Button
              type="primary"
              icon={<Icons.CheckCircle size={14} />}
              className="update-action-btn"
              onClick={handleInstall}
            >
              {installActionLabel}
            </Button>
          ) : isAvailable ? (
            <Button
              type="primary"
              icon={<Icons.Download size={14} />}
              className="update-action-btn"
              onClick={() => void handleDownload()}
            >
              下载更新
            </Button>
          ) : isDownloading ? (
            <Button icon={<Icons.Download size={14} />} className="update-action-btn" disabled>
              下载中 {status?.progress != null ? `${Math.round(status.progress.percent)}%` : ''}
            </Button>
          ) : (
            <Button
              // icon={<Icons.Refresh size={14} className={isChecking ? 'spin' : ''} />}
              className="update-action-btn"
              onClick={() => void handleCheckUpdate()}
              disabled={isChecking || isDownloading}
            >
              {isChecking ? '检查中…' : '检查更新'}
            </Button>
          )}
        </div>
      </div>

      <div className="card">
        <SettingsRow
          title="Release 下载"
          desc="前往 GitHub Release 页面查看所有版本安装包"
          right={
            <Button
              icon={<Icons.GitHub size={14} />}
              className="update-action-btn"
              onClick={handleOpenReleasesPage}
            >
              打开 Release 页
            </Button>
          }
        />
      </div>

      <div className="subsec-h">更新策略</div>
      <div className="card">
        <SettingsRow
          title="自动检查更新"
          desc="仅在应用启动时自动检查；固定间隔轮询已关闭以节省 GitHub 请求次数"
          right={
            <Switch
              size="small"
              checked={s.autoCheck}
              onChange={(v) => handleSettingsChange('autoCheck', v)}
            />
          }
        />
        <SettingsRow
          title="自动下载"
          desc="为避免误下载，检测到新版本后仅显示更新按钮，需要手动点击下载"
          right={<Switch size="small" disabled />}
        />
        <SettingsRow
          title="自动安装"
          desc={
            autoInstallSupported
              ? '退出应用时自动启动安装器'
              : '当前平台不支持自动安装，下载后需手动打开安装包'
          }
          right={
            <Switch
              size="small"
              checked={s.autoInstall}
              disabled={!autoInstallSupported}
              onChange={(v) => handleSettingsChange('autoInstall', v)}
            />
          }
        />
        <SettingsRow
          title="更新通道"
          right={
            <div className="select-sm">
              <Select
                value={s.channel}
                onChange={(v) => handleSettingsChange('channel', v)}
                options={[
                  { label: 'stable', value: 'stable' },
                  { label: 'beta', value: 'beta' },
                ]}
              />
            </div>
          }
        />
      </div>

      <div className="subsec-h">版本</div>
      <div className="card">
        <SettingsRow
          title="Spark Agent"
          desc={`${currentVersion}`}
          right={
            <span className={hasUpdate ? 'badge warning dot' : 'badge success dot'}>
              {hasUpdate ? `有新版 ${status?.updateInfo?.version}` : '最新'}
            </span>
          }
        />

        <SettingsRow title="Electron" desc="31.x" right={<span className="badge">嵌入</span>} />
      </div>
    </div>
  )
}

/* ───────── Helpers ───────── */
const CLAUDE_RUNTIME_PERMISSION_OPTIONS: RuntimePermissionModeOption[] = [
  { value: 'claude-ask', label: '请求批准', desc: '每次工具执行前确认' },
  { value: 'claude-plan', label: '计划模式', desc: '先产出计划，再批准执行' },
  { value: 'claude-auto', label: '自动审批', desc: '使用自动权限策略', tone: 'auto' },
  {
    value: 'claude-bypass',
    label: '完全访问',
    desc: '完全由 agent 执行',
    tone: 'danger',
  },
]

const CODEX_RUNTIME_PERMISSION_OPTIONS: RuntimePermissionModeOption[] = [
  { value: 'codex-default', label: 'Default', desc: '使用 Codex 默认权限策略' },
  {
    value: 'codex-auto-review',
    label: 'Auto review',
    desc: 'Codex workspace-write 自动审查模式',
    tone: 'auto',
  },
  {
    value: 'codex-full-access',
    label: 'Full access',
    desc: '危险：跳过 Codex 审批与沙箱',
    tone: 'danger',
  },
]

function getRuntimePermissionModeOptions(
  adapter: SessionAgentAdapter,
): RuntimePermissionModeOption[] {
  return adapter === 'codex' ? CODEX_RUNTIME_PERMISSION_OPTIONS : CLAUDE_RUNTIME_PERMISSION_OPTIONS
}

function getValidRuntimePermissionMode(
  value: SessionPermissionMode | undefined,
  adapter: SessionAgentAdapter,
): SessionPermissionMode {
  const options = getRuntimePermissionModeOptions(adapter)
  return options.some((option) => option.value === value)
    ? (value as SessionPermissionMode)
    : (options[0]?.value ?? 'claude-ask')
}

function normalizeRuntimePermissionSettings(value: unknown): RuntimePermissionSettings {
  const source = value != null && typeof value === 'object' ? (value as RuntimePermissionPrefs) : {}
  const adapter =
    source.adapter === 'claude' || source.adapter === 'claude-sdk' || source.adapter === 'codex'
      ? source.adapter
      : 'claude-sdk'
  return {
    adapter,
    permissionMode: getValidRuntimePermissionMode(source.permissionMode, adapter),
  }
}

function readRuntimePermissionPrefs(): RuntimePermissionPrefs {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(COMPOSER_PREFS_KEY)
    if (raw == null) return {}
    const parsed = JSON.parse(raw) as RuntimePermissionPrefs
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeRuntimePermissionPrefs(patch: RuntimePermissionPrefs): void {
  if (typeof window === 'undefined') return
  const current = readRuntimePermissionPrefs()
  const next: RuntimePermissionPrefs = { ...current, ...patch }
  for (const key of Object.keys(next) as Array<keyof RuntimePermissionPrefs>) {
    if (next[key] === undefined) delete next[key]
  }
  window.localStorage.setItem(COMPOSER_PREFS_KEY, JSON.stringify(next))
}

function SettingsRow({ title, desc, right }: { title: string; desc?: string; right?: ReactNode }) {
  return (
    <div className="settings-card-row">
      <div className="flex1 min-w-0">
        <div className="row-title">{title}</div>
        {desc && <div className="row-desc">{desc}</div>}
      </div>
      <div className="row-action">{right}</div>
    </div>
  )
}

function AboutSection() {
  const [sysInfo, setSysInfo] = useState<{
    appVersion: string
    electronVersion: string
    chromeVersion: string
    nodeVersion: string
    platform: string
  } | null>(null)

  useEffect(() => {
    window.spark
      ?.invoke('app:get-info', {})
      .then((res) => {
        setSysInfo({
          appVersion: res.appVersion,
          electronVersion: res.electronVersion,
          chromeVersion: res.chromeVersion,
          nodeVersion: res.nodeVersion,
          platform: res.platform,
        })
      })
      .catch(() => {
        // Fallback: try user-agent parsing
        setSysInfo({
          appVersion: '0.1.0',
          electronVersion: '31.x',
          chromeVersion: navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? 'unknown',
          nodeVersion: 'unknown',
          platform: navigator.platform ?? 'unknown',
        })
      })
  }, [])

  return (
    <div className="settings-section">
      <div className="about-header">
        <div className="about-title">Spark Agent</div>
        <div className="about-subtitle">AI Agent 工作台</div>
        <div className="about-version">版本 {sysInfo?.appVersion ?? '0.1.0'} (MVP)</div>
      </div>
      <div className="subsec-h">技术栈</div>
      <div className="card">
        <SettingsRow
          title="Electron"
          desc="桌面应用框架"
          right={<span className="mono-sm tech-version">{sysInfo?.electronVersion ?? '31.x'}</span>}
        />
        <SettingsRow
          title="Chromium"
          desc="渲染引擎"
          right={
            <span className="mono-sm tech-version">{sysInfo?.chromeVersion ?? 'unknown'}</span>
          }
        />
        <SettingsRow
          title="Node.js"
          desc="JavaScript 运行时"
          right={<span className="mono-sm tech-version">{sysInfo?.nodeVersion ?? 'unknown'}</span>}
        />
        <SettingsRow
          title="React"
          desc="UI 框架"
          right={<span className="mono-sm tech-version">19.x</span>}
        />
        <SettingsRow
          title="TypeScript"
          desc="开发语言"
          right={<span className="mono-sm tech-version">5.x</span>}
        />
        <SettingsRow
          title="数据库"
          desc="本地存储"
          right={<span className="mono-sm tech-version">SQLite (better-sqlite3)</span>}
        />
        <SettingsRow
          title="AI 引擎"
          desc="Agent Runtime"
          right={<span className="mono-sm tech-version">Claude / OpenAI / DeepSeek / Ollama</span>}
        />
      </div>

      <div className="subsec-h">系统信息</div>
      <div className="card">
        <SettingsRow
          title="平台"
          desc="操作系统"
          right={<span className="mono-sm tech-version">{sysInfo?.platform ?? '—'}</span>}
        />
        <SettingsRow
          title="User Agent"
          desc="浏览器标识"
          right={
            <span className="mono-sm tech-version about-user-agent">
              {navigator.userAgent.slice(0, 60)}…
            </span>
          }
        />
      </div>

      <div className="subsec-h">链接</div>
      <div className="card">
        <SettingsRow
          title="GitHub"
          desc="源代码仓库"
          right={
            <a href="https://github.com" target="_blank" rel="noreferrer" className="about-link">
              github.com →
            </a>
          }
        />
        <SettingsRow
          title="文档"
          desc="使用指南与 API 参考"
          right={
            <a
              href="https://docs.spark-agent.dev"
              target="_blank"
              rel="noreferrer"
              className="about-link"
            >
              文档 →
            </a>
          }
        />
        <SettingsRow
          title="反馈"
          desc="问题报告与功能建议"
          right={
            <a
              href="https://github.com/issues"
              target="_blank"
              rel="noreferrer"
              className="about-link"
            >
              提交 Issue →
            </a>
          }
        />
      </div>

      <div className="about-footer">© 2026 Spark Agent Team. All rights reserved.</div>
    </div>
  )
}

/* ───────── HOOKS ───────── */
type HookNodeType = 'permission_request' | 'ask_user_question' | 'session_end' | 'session_fail'

type HookNodeConfig = {
  sound: boolean
  notification: boolean
}

type HookConfig = {
  enabled: boolean
  nodes: Record<HookNodeType, HookNodeConfig>
}

const SETTINGS_HOOKS_KEY = 'spark-settings-hooks'

const DEFAULT_HOOK_CONFIG: HookConfig = {
  enabled: true,
  nodes: {
    permission_request: { sound: true, notification: true },
    ask_user_question: { sound: true, notification: true },
    session_end: { sound: true, notification: true },
    session_fail: { sound: true, notification: true },
  },
}

const HOOK_NODE_LABELS: Record<HookNodeType, { label: string; desc: string }> = {
  permission_request: { label: '权限请求', desc: 'Agent 需要您的审批' },
  ask_user_question: { label: '用户提问', desc: 'Agent 需要您提供更多信息' },
  session_end: { label: '任务完成', desc: '当前任务已成功完成' },
  session_fail: { label: '任务失败', desc: '任务执行出错' },
}

const HOOK_NODE_ICONS: Record<
  HookNodeType,
  (p: { size?: number; className?: string }) => React.JSX.Element
> = {
  permission_request: Icons.Shield,
  ask_user_question: Icons.Chat,
  session_end: Icons.CheckCircle,
  session_fail: Icons.AlertTriangle,
}

function HooksSection() {
  const [config, setConfig] = usePersistedSettings(SETTINGS_HOOKS_KEY, DEFAULT_HOOK_CONFIG)
  const [testing, setTesting] = useState<string | null>(null)
  const { toast } = useToast()

  const updateNodeConfig = (node: HookNodeType, type: 'sound' | 'notification', value: boolean) => {
    setConfig({
      ...config,
      nodes: {
        ...config.nodes,
        [node]: {
          ...config.nodes[node],
          [type]: value,
        },
      },
    })
  }

  const testHook = async (node: HookNodeType) => {
    setTesting(node)
    try {
      await window.spark?.invoke('hook:play-sound', {})
      const nodeInfo = HOOK_NODE_LABELS[node]
      await window.spark?.invoke('hook:show-notification', {
        title: `测试：${nodeInfo.label}`,
        body: `这是一条测试通知，来自 ${nodeInfo.label} 节点`,
      })
      toast.success('Hook 测试完成')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '测试失败')
    } finally {
      setTesting(null)
    }
  }

  return (
    <div className="settings-section">
      <div className="row section-header-row">
        <div className="flex1">
          <h2 className="section-h2">Hooks</h2>
          <div className="lede section-lede">
            在会话关键节点触发提示音和系统通知，帮助您及时响应 Agent 的状态变化。
          </div>
        </div>
        <Switch
          size="small"
          checked={config.enabled}
          onChange={(v) => setConfig({ ...config, enabled: v })}
        />
      </div>

      {config.enabled && (
        <>
          <div className="subsec-h">节点配置</div>
          <div className="hook-nodes-list">
            {(Object.keys(HOOK_NODE_LABELS) as HookNodeType[]).map((node) => {
              const info = HOOK_NODE_LABELS[node]
              const nodeConfig = config.nodes[node]
              const Icon = HOOK_NODE_ICONS[node]
              const anyEnabled = nodeConfig.sound || nodeConfig.notification
              return (
                <div key={node} className="hook-node-card">
                  <div className="hook-node-header">
                    <div className="hook-node-icon-wrap">
                      <Icon size={14} />
                    </div>
                    <div className="hook-node-meta flex1 min-w-0">
                      <div className="hook-node-label">{info.label}</div>
                      <div className="hook-node-desc">{info.desc}</div>
                    </div>
                    <span className={`badge dot ${anyEnabled ? 'success' : ''}`}>
                      {anyEnabled ? '已启用' : '已关闭'}
                    </span>
                  </div>
                  <div className="hook-node-toggles">
                    <div className="hook-toggle-row">
                      <div className="hook-toggle-info">
                        <Icons.Bell size={13} className="hook-toggle-icon" />
                        <span className="hook-toggle-label">系统通知</span>
                        <span className="hook-toggle-hint">原生横幅通知，点击聚焦窗口</span>
                      </div>
                      <Switch
                        size="small"
                        checked={nodeConfig.notification}
                        onChange={(v) => updateNodeConfig(node, 'notification', v)}
                      />
                    </div>
                    <div className="hook-toggle-row">
                      <div className="hook-toggle-info">
                        <Icons.Activity size={13} className="hook-toggle-icon" />
                        <span className="hook-toggle-label">提示音</span>
                        <span className="hook-toggle-hint">系统默认提示音</span>
                      </div>
                      <Switch
                        size="small"
                        checked={nodeConfig.sound}
                        onChange={(v) => updateNodeConfig(node, 'sound', v)}
                      />
                    </div>
                  </div>
                  <div className="hook-node-footer">
                    <Button
                      size="small"
                      type="text"
                      loading={testing === node}
                      icon={<Icons.Play size={11} />}
                      onClick={() => void testHook(node)}
                      disabled={testing === node}
                    >
                      测试
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function PlaceholderSection({ name, hint }: { name: string; hint?: string }) {
  return (
    <div className="settings-section placeholder-section">
      <div className="col placeholder-inner">
        <Icons.Settings size={32} className="faint" />
        <div className="strong">{name}</div>
        {hint && <div className="muted perm-row-hint">{hint}</div>}
      </div>
    </div>
  )
}
