/**
 * SettingsView — 多分类设置（通用 / Agent / 生态 / 系统 四大分组）
 *
 * 包含：左侧分组导航 + 右侧多 section 内容。Profile 编辑使用 Modal。
 * 注意：Provider 配置 UI 已抽到 ProvidersView.tsx（侧边栏一级菜单）。
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react'
import type { ReactNode } from 'react'
import {
  Button,
  Checkbox,
  Input,
  InputNumber,
  Modal,
  Segmented,
  Select,
  Tag,
  TextArea,
} from '@lobehub/ui'
// TODO(lobe-migration): @lobehub/ui 没有 Switch 命名导出;从 antd 引用,与项目其他 view 保持一致
import { Modal as AntdModal, Space, Switch } from 'antd'
import { Icons } from '../Icons'
import { useApp, PRIMARIES } from '../AppContext'
import {
  DEFAULT_SHORTCUTS,
  formatShortcut,
  loadShortcuts,
  modSymbol,
  saveShortcuts,
} from '../hooks/useKeyboard'
import {
  DEFAULT_APPEARANCE,
  UI_ZOOM_MAX,
  UI_ZOOM_MIN,
  UI_ZOOM_STEP,
  getAppearanceFontOptions,
  isAppearanceFontAvailable,
  patchAppearance,
  useAppearanceSettings,
} from '../hooks/useAppearance'
import type { ShortcutBinding } from '../hooks/useKeyboard'
import { useSessionSidebar } from '../SessionSidebarContext'
import { useIpcInvoke } from '../hooks/useIpc'
import { useToast } from '../components/Toast'
import { filterProvidersForVisibleUi } from '../utils/auto-router-ui'
import { estimateTokens, ModelCapabilityRegistry } from '@spark/shared'
import { PlaywrightStatusCard } from './PlaywrightStatusCard'
import { FfmpegStatusCard } from './FfmpegStatusCard'
import { UsageRankingCard } from './UsageRankingCard'
import { VoiceIntegritySettingsItem } from '../voice/VoiceIntegritySettingsItem'
import { VoiceAssistantSettingsCard } from '../voice-assistant/VoiceAssistantSettingsCard'
import { OptionalCapabilitiesSettingsCard } from '../optional-capabilities/OptionalCapabilitiesSettingsCard'
import { CodexRuntimeDiagnosticsCard } from '../optional-capabilities/CodexRuntimeDiagnosticsCard'
import { PerformanceSettingsSection } from '../settings-performance/PerformanceSettingsSection'
import { FontAssetControl } from '../components/FontAssetControl'
import { SdkInstallProgressView } from '../components/SdkInstallProgress'
import { clearOnboardingState } from './onboarding-state'
import { clearUsageHeatmapCache } from './usageHeatmapCache'
import { canvasApi } from './canvas/canvas.api'
import { resolveSupportedLanguage, SUPPORTED_LANGUAGES, translate, useI18n } from '../i18n'
// Provider 相关 UI 已抽到 ProvidersView；保留 ProviderEditPanel 的 re-export
// 以便现有测试（apps/desktop/src/renderer/tests/renderer.test.ts）等其他消费者
// 仍能通过原路径 import。
export { ProviderEditPanel } from './ProvidersView'
import { MemoryPanel } from './MemoryPanel'
import { WikiSettingsPanel } from './wiki/WikiSettingsPanel'
import { SettingsLogViewer } from './SettingsLogViewer'
import { RemoteConnectionsSection } from './SettingsRemoteConnections'
import { SubAppRuntimeSettingsCard } from '../sub-app/SubAppRuntimeSettingsCard'
import { TeamRegistrySection } from './TeamRegistrySection'
import { SessionWorkflowSettingsSection } from './SessionWorkflowSettingsSection'
import { ToolchainSection } from './toolchain/ToolchainSection'
import { UsageHeatmap } from './UsageHeatmap'
import { ModelUsageTrendCard } from './ModelUsageTrendCard'
import { needsSdkInstallAction } from './sdkIntegrityPresentation'
import { CustomCommandsSection } from './custom-commands/CustomCommandsSection'
import { CODEX_PERMISSION_MODE_OPTIONS as SHARED_CODEX_PERMISSION_MODE_OPTIONS } from '../utils/permission-options'
import { ComputerUseSettingsSection } from '../computer-use/ComputerUseSettingsSection'
import { AccountSyncSettingsSection } from './account-sync/AccountSyncSettingsSection'
import { UpdateReleaseNotesCard } from './UpdateReleaseNotesCard'
import { HooksV2Section } from './hooks/HooksV2Section'
import { SettingsNavResizer } from './settings-nav/SettingsNavResizer'
import { MobileBridgeSettingsSection } from './SettingsMobileBridge'
import { MemoryPendingBadge } from '../MemoryPendingBadge'
import './SettingsView.less'
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
  SdkIntegrityInstallProgress,
  RuntimeToolStatus,
  SessionListResponse,
  SessionId,
} from '@spark/protocol'

const COMPOSER_PREFS_KEY = 'spark-agent:composer-prefs'
const RUNTIME_PERMISSION_SETTINGS_CATEGORY = 'runtime-permissions'
const RUNTIME_PERMISSION_SETTINGS_KEY = 'defaults'

function deferEffect(task: () => void | Promise<void>): () => void {
  const id = window.setTimeout(() => {
    void task()
  }, 0)
  return () => window.clearTimeout(id)
}

/* ─── Settings persistence keys ─── */
const SETTINGS_GENERAL_KEY = 'spark-settings-general'
const SETTINGS_UPDATED_EVENT = 'spark-settings-updated'
const SETTINGS_TELEMETRY_KEY = 'spark-settings-telemetry'
const SETTINGS_UPDATES_KEY = 'spark-settings-updates'
const sparkPlatform = typeof window !== 'undefined' ? window.spark?.platform : undefined
const isPlatformDarwin = sparkPlatform === 'darwin'
const isPlatformWin32 = sparkPlatform === 'win32'
const RELEASES_URL = 'https://github.com/alexanderizh/spark-agent/releases'

function getUpdateSourceLabel(
  source?: UpdateStatus['updateSource'] | UpdateStatus['downloadSource'],
): string {
  if (source === 'version-center') return translate('settingsView.t1')
  if (source === 'github') return 'GitHub Releases'
  return translate('settingsView.t2')
}

/* ─── Category mapping (localStorage key → IPC category) ─── */
function localStorageKeyToCategory(key: string): string {
  return key.replace('spark-settings-', '')
}

type GeneralSettings = {
  userName: string
  language: string
  autoStart: boolean
  notifyNewVersion: boolean
}

type TelemetrySettings = {
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  /** 运行时日志开关：是否记录每轮白盒提示词快照。默认关闭以节省存储。 */
  runtimeLogEnabled: boolean
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
  autoStart: false,
  notifyNewVersion: true,
}

const DEFAULT_TELEMETRY: TelemetrySettings = {
  logLevel: 'warn',
  runtimeLogEnabled: false,
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

export function SettingsView({ initialSection }: { initialSection?: string } = {}) {
  // 本文件使用非响应式 translate()：顶层订阅语言变化，保证切换语言后整树重渲染。
  useI18n()
  const { t, setTweak } = useApp()
  // 外部直达（如从侧栏/命令面板以 'memory' 路由进入）→ 优先用 initialSection
  const section = initialSection ?? t.settingsSection ?? 'general'
  const setSection = (s: string) => setTweak('settingsSection', s)
  // 首次以 initialSection 进入时同步到 tweak，使后续 setTweak 走相同 key
  React.useEffect(() => {
    if (initialSection) setTweak('settingsSection', initialSection)
  }, [initialSection, setTweak])

  // 导航分组：常用项收拢到「通用」，其余按 Agent / 生态 / 系统 归类。
  // 仅调整归属与顺序，各 section 的 id 与实现保持不变。
  const nav = [
    {
      group: translate('settingsView.t3'),
      items: [
        {
          id: 'general',
          icon: <Icons.Settings size={13} />,
          label: translate('settingsView.t3'),
          keywords: [translate('settingsView.t4'), translate('settingsView.t5'), translate('settingsView.t6'), translate('settingsView.t7'), translate('settingsView.t8')],
        },
        {
          id: 'appearance',
          icon: <Icons.Sparkles size={13} />,
          label: translate('settingsView.t9'),
          keywords: [translate('settingsView.t10'), translate('settingsView.t11'), translate('settingsView.t12'), translate('settingsView.t13'), translate('settingsView.t14'), translate('settingsView.t15'), translate('settingsView.t16'), translate('settingsView.t17')],
        },
        {
          id: 'account-sync',
          icon: <Icons.Refresh size={13} />,
          label: translate('settingsView.t18'),
          keywords: [translate('settingsView.t19'), translate('settingsView.t20'), translate('settingsView.t21'), translate('settingsView.t22'), translate('settingsView.t23')],
        },
        {
          id: 'memory',
          icon: <Icons.Brain size={13} />,
          label: translate('settingsView.t24'),
          keywords: [translate('settingsView.t25'), translate('settingsView.t26'), translate('settingsView.t27')],
        },
        {
          id: 'wiki',
          icon: <Icons.Book size={13} />,
          label: translate('settingsView.t28'),
          keywords: ['wiki', translate('settingsView.t28'), translate('settingsView.t29'), translate('settingsView.t30'), translate('settingsView.t31'), translate('settingsView.t32')],
        },
        {
          id: 'remote-connections',
          icon: <Icons.Globe size={13} />,
          label: translate('settingsView.t33'),
          keywords: ['API Key', translate('settingsView.t34'), 'Provider', translate('settingsView.t35'), translate('settingsView.t36'), translate('settingsView.t37')],
        },
        {
          id: 'voice-assistant',
          icon: <Icons.Monitor size={13} />,
          label: translate('settingsView.t38'),
          keywords: [translate('settingsView.t39'), translate('settingsView.t40'), translate('settingsView.t41'), 'TTS', translate('settingsView.t42'), translate('settingsView.t43'), translate('settingsView.t44')],
        },
        {
          id: 'performance',
          icon: <Icons.Activity size={13} />,
          label: translate('settingsView.t45'),
          keywords: [translate('settingsView.t46'), translate('settingsView.t47'), translate('settingsView.t48'), translate('settingsView.t49'), translate('settingsView.t50'), translate('settingsView.t51'), translate('settingsView.t52'), 'performance'],
        },
        {
          id: 'integrity',
          icon: <Icons.Shield size={13} />,
          label: translate('settingsView.t53'),
          keywords: [translate('settingsView.t54'), translate('settingsView.t55'), 'Chromium', translate('settingsView.t56'), translate('settingsView.t53')],
        },
        {
          id: 'hooks',
          icon: <Icons.Bell size={13} />,
          label: 'Hooks',
          keywords: [translate('settingsView.t57'), translate('settingsView.t58'), translate('settingsView.t59'), translate('settingsView.t60')],
        },
      ],
    },
    {
      group: 'Agent',
      items: [
        {
          id: 'rules',
          icon: <Icons.Beaker size={13} />,
          label: translate('settingsView.t61'),
          keywords: [translate('settingsView.t62'), 'AGENTS', 'CLAUDE', translate('settingsView.t63')],
        },
        {
          id: 'custom-commands',
          icon: <Icons.Command size={13} />,
          label: translate('settingsView.t64'),
          keywords: [translate('settingsView.t65'), 'slash', translate('settingsView.t66'), translate('settingsView.t67')],
        },
        {
          id: 'permissions',
          icon: <Icons.Shield size={13} />,
          label: translate('settingsView.t68'),
          keywords: [translate('settingsView.t69'), translate('settingsView.t70'), translate('settingsView.t71'), translate('settingsView.t72'), translate('settingsView.t73')],
        },
        {
          id: 'session-workflow',
          icon: <Icons.Workflow size={13} />,
          label: translate('settingsView.t74'),
          keywords: [translate('settingsView.t75'), translate('settingsView.t76'), translate('settingsView.t77'), translate('settingsView.t78'), translate('settingsView.t74')],
        },
        {
          id: 'toolchain',
          icon: <Icons.Puzzle size={13} />,
          label: translate('settingsView.t79'),
          keywords: [translate('settingsView.t80'), 'toolchain', 'MCP', translate('settingsView.t81'), translate('settingsView.t82'), translate('settingsView.t73'), translate('settingsView.t83')],
        },
      ],
    },
    {
      group: translate('settingsView.t84'),
      items: [
        {
          id: 'playwright',
          icon: <Icons.Globe size={13} />,
          label: translate('settingsView.t85'),
          keywords: ['Playwright', translate('settingsView.t86'), translate('settingsView.t87'), translate('settingsView.t88'), 'E2E'],
        },
        {
          id: 'usage',
          icon: <Icons.Activity size={13} />,
          label: translate('settingsView.t89'),
          keywords: ['token', translate('settingsView.t90'), translate('settingsView.t91'), translate('settingsView.t92')],
        },
        {
          id: 'storage',
          icon: <Icons.Database size={13} />,
          label: translate('settingsView.t93'),
          keywords: [translate('settingsView.t94'), translate('settingsView.t22'), translate('settingsView.t95'), translate('settingsView.t96'), translate('settingsView.t97'), translate('settingsView.t98')],
        },
        // MCP 设置暂未完全实现，隐藏导航项
        // { id: 'mcp-settings', icon: <Icons.MCP />, label: 'MCP' },
        {
          id: 'team-registry',
          icon: <Icons.Users size={13} />,
          label: translate('settingsView.t99'),
          keywords: ['Nacos', translate('settingsView.t100'), translate('settingsView.t101'), translate('settingsView.t102'), translate('settingsView.t103'), translate('settingsView.t99')],
        },
        {
          id: 'system-prompt',
          icon: <Icons.Chat size={13} />,
          label: translate('settingsView.t104'),
          keywords: [translate('settingsView.t105'), 'prompt', translate('settingsView.t106'), translate('settingsView.t107')],
        },
        {
          id: 'sub-app',
          icon: <Icons.Sparkles size={13} />,
          label: translate('settingsView.t108'),
          keywords: ['sub-app', translate('settingsView.t108'), translate('settingsView.t109'), 'CSP', translate('settingsView.t110'), 'eval', translate('settingsView.t111')],
        },
        {
          id: 'mobile-bridge',
          icon: <Icons.Phone size={13} />,
          label: '移动端桥接',
          keywords: ['小程序', '移动端', '手机', '配对', '远程会话', '桥接', 'mobile', 'bridge'],
        },
      ],
    },
    {
      group: translate('settingsView.t112'),
      items: [
        {
          id: 'shortcuts',
          icon: <Icons.Command size={13} />,
          label: translate('settingsView.t41'),
          keywords: [translate('settingsView.t113'), translate('settingsView.t114'), translate('settingsView.t115'), 'shortcut'],
        },
        {
          id: 'computer-use',
          icon: <Icons.Monitor size={13} />,
          label: translate('settingsView.t116'),
          keywords: [translate('settingsView.t117'), translate('settingsView.t118'), translate('settingsView.t119'), translate('settingsView.t120'), 'computer use'],
        },
        {
          id: 'telemetry',
          icon: <Icons.Activity size={13} />,
          label: translate('settingsView.t121'),
          keywords: [translate('settingsView.t122'), translate('settingsView.t123'), 'telemetry'],
        },
        {
          id: 'archived',
          icon: <Icons.Archive size={13} />,
          label: translate('settingsView.t124'),
          keywords: [translate('settingsView.t125'), translate('settingsView.t126'), translate('settingsView.t127')],
        },
        {
          id: 'updates',
          icon: <Icons.Refresh size={13} />,
          label: translate('settingsView.t128'),
          keywords: [translate('settingsView.t129'), translate('settingsView.t130'), translate('settingsView.t131'), 'release'],
        },
        {
          id: 'about',
          icon: <Icons.Sparkles size={13} />,
          label: translate('settingsView.t132'),
          keywords: [translate('settingsView.t133'), translate('settingsView.t134'), translate('settingsView.t135'), translate('settingsView.t136')],
        },
      ],
    },
  ]
  const [navQuery, setNavQuery] = React.useState('')
  const navQ = navQuery.trim().toLowerCase()
  const navItemMatches = (label: string, group: string, keywords: string[] = []) =>
    !navQ ||
    label.toLowerCase().includes(navQ) ||
    group.toLowerCase().includes(navQ) ||
    keywords.some((k) => k.toLowerCase().includes(navQ))
  const navGroups = nav
    .map((g) => ({
      ...g,
      items: g.items.filter((it) => navItemMatches(it.label, g.group, it.keywords)),
    }))
    .filter((g) => g.items.length > 0)

  const Section: Record<string, () => React.ReactElement> = {
    general: GeneralSection,
    appearance: AppearanceSection,
    'account-sync': AccountSyncSettingsSection,
    shortcuts: ShortcutsSection,
    rules: RulesSection,
    'custom-commands': CustomCommandsSection,
    permissions: PermissionsSection,
    'session-workflow': SessionWorkflowSettingsSection,
    // 直接引用模块级组件，不要包箭头函数（同 MemoryPanel 的教训）
    toolchain: ToolchainSection,
    // MCP 设置暂未完全实现，隐藏
    // 'mcp-settings': McpSection,
    'remote-connections': RemoteConnectionsSection,
    // 直接引用模块级组件，不要包箭头函数（同 MemoryPanel 的教训）
    'voice-assistant': VoiceAssistantSettingsCard,
    'team-registry': TeamRegistrySection,
    'system-prompt': SystemPromptSection,
    // 直接引用模块级组件，不要包箭头函数（同 MemoryPanel 的教训）
    'sub-app': SubAppRuntimeSettingsCard,
    'mobile-bridge': MobileBridgeSettingsSection,
    'computer-use': ComputerUseSettingsSection,
    performance: PerformanceSettingsSection,
    integrity: IntegritySection,
    playwright: PlaywrightStatusCard,
    telemetry: TelemetrySection,
    hooks: HooksV2Section,
    storage: StorageSection,
    usage: UsageSection,
    archived: ArchivedSection,
    updates: UpdatesSection,
    // 直接引用模块级组件，不要包箭头函数 —— 否则 Section 对象每次渲染都会拿到
    // 全新的函数引用，<SectionBody /> 的组件类型随之变化，React 会卸载并重新挂载
    // MemoryPanel，导致其内部 state（scope tab、新增/配置 Drawer 的 open）全部丢失：
    // 表现为「tab 切换几秒后自动跳回 User」「新增/配置弹窗打不开」。
    memory: MemoryPanel,
    wiki: WikiSettingsPanel,
    about: AboutSection,
  }
  const SectionBody = Section[section]

  return (
    <div className="settings-layout">
      <div className="settings-nav">
        <div className="settings-nav-fixed">
          <button
            type="button"
            className="settings-nav-return"
            onClick={() => {
              // 返回当前工作区模式的主视图：画布模式回画布，工作台模式回会话。
              // 否则从画布进设置再返回会被无条件拉回 chat，造成跳页 bug。
              if (t.workspaceMode === 'canvas') {
                setTweak('view', 'canvas')
              } else {
                setTweak('chatMode', 'vibe')
                setTweak('view', 'chat')
              }
            }}
          >
            <Icons.ArrowLeft size={16} />
            <span>{translate('settingsView.t360')}</span>
          </button>
          <Input
            className="settings-nav-search"
            size="middle"
            allowClear
            prefix={<Icons.Search size={14} />}
            value={navQuery}
            onChange={(e) => setNavQuery(e.target.value)}
            placeholder={translate('settingsView.t291')}
          />
        </div>
        <div className="settings-nav-list scroll">
          {navGroups.length === 0 ? (
            <div className="settings-nav-empty">{translate('settingsView.t361')}</div>
          ) : (
            navGroups.map((g) => (
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
                    {it.id === 'memory' && <MemoryPendingBadge refreshKey={section} />}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>

      <SettingsNavResizer />

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
      <h2>{translate('settingsView.t3')}</h2>
      <div className="lede">{translate('settingsView.t362Desc')}</div>

      <div className="settings-card" style={{ marginBottom: 10 }}>
        <SettingsRow
          title={translate('settingsView.t292')}
          desc={translate('settingsView.t293Desc')}
          right={
            <button
              className="btn"
              onClick={() => {
                // 清主进程 SQLite 权威记录；localStorage 已不再被启动判定使用，
                // 但顺手清掉老版本残留值，避免迁移逻辑把它重新写回主进程。
                window.localStorage.removeItem('spark-agent:onboarding-completed')
                window.localStorage.removeItem('spark-agent:onboarding-dismissed')
                clearOnboardingState()
                setTweak('view', 'onboarding')
              }}
            >
              {translate('settingsView.t363')}
            </button>
          }
        />
      </div>

      <UsageHeatmap />

      <ModelUsageTrendCard />

      <div className="form-grid">
        <label>
          {translate('settingsView.t4')}<span className="sub">{translate('settingsView.t364')}</span>
        </label>
        <Select
          value={resolveSupportedLanguage(s.language)}
          onChange={(v) => set({ language: resolveSupportedLanguage(v) })}
          options={SUPPORTED_LANGUAGES.map((language) => ({
            label: tr(
              language === 'zh-CN'
                ? 'settings.general.language.zh'
                : 'settings.general.language.en',
            ),
            value: language,
          }))}
        />

        <label>
          {translate('settingsView.t365')}
          <span className="sub">
            {autoStartSupported ? translate('settingsView.t137Desc') : translate('settingsView.t138Desc')}
          </span>
        </label>
        <Switch
          size="middle"
          checked={s.autoStart}
          loading={autoStartBusy}
          disabled={!autoStartSupported}
          onChange={() => void handleToggleAutoStart()}
        />
      </div>

      <div className="subsec-h">{translate('settingsView.t7')}</div>
      <div className="settings-card">
        <SettingsRow
          title={translate('settingsView.t294')}
          right={
            <Switch
              size="middle"
              checked={s.notifyNewVersion}
              onChange={(v) => set({ notifyNewVersion: v })}
            />
          }
        />
      </div>
    </div>
  )
}

/* ───────── APPEARANCE ───────── */
function AppearanceSection() {
  const { t, setTweak, resetVisualTweaks, requestConfirm } = useApp()
  const a = useAppearanceSettings()
  const setA = patchAppearance
  const fontOptions = useMemo(() => getAppearanceFontOptions(a.font), [a.font])
  const selectedFontAvailable = isAppearanceFontAvailable(a.font)

  const resetAppearance = useCallback(async () => {
    const ok = await requestConfirm({
      title: translate('settingsView.t139'),
      description: translate('settingsView.t140Desc'),
      confirmText: translate('settingsView.t141'),
      danger: true,
    })
    if (!ok) return
    // A 层（useAppearance）覆盖式写入 10 个外观字段；B 层（视觉 tweak）单条
    // persist 链一次性写入 4 个视觉字段。两者最终落地的都是默认值，即使远端
    // 两条 IPC 链交错，被覆盖掉的也是默认值，重启后仍为默认值。
    patchAppearance(DEFAULT_APPEARANCE)
    resetVisualTweaks()
  }, [requestConfirm, resetVisualTweaks])

  return (
    <div className="settings-section">
      <h2>{translate('settingsView.t9')}</h2>
      <div className="lede">{translate('settingsView.t366Desc')}</div>
      <div className="row row-mb-sm" style={{ justifyContent: 'flex-end' }}>
        <Button
          size="middle"
          type="text"
          icon={<Icons.Refresh size={13} />}
          onClick={resetAppearance}
        >
          {translate('settingsView.t367')}
        </Button>
      </div>

      <div className="subsec-h">{translate('settingsView.t10')}</div>
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

      <div className="subsec-h">{translate('settingsView.t368')}</div>
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
      </div>

      <div className="subsec-h">{translate('settingsView.t369')}</div>
      <div className="form-grid">
        <label>
          {translate('settingsView.t370')}<span className="sub">{translate('settingsView.t371')}</span>
        </label>
        <Segmented
          value={t.density}
          onChange={(v) => setTweak('density', v as typeof t.density)}
          options={[
            { label: translate('settingsView.t142'), value: 'compact' },
            { label: translate('settingsView.t143'), value: 'regular' },
            { label: translate('settingsView.t144'), value: 'comfy' },
          ]}
        />

        <label>{translate('settingsView.t14')}</label>
        {/* height:auto 覆盖 .form-grid > .control 的 height:36px：
            本行纵向堆叠 Select + 字体资产控件，36px 会裁切内容并侵入下一行 */}
        <div className="control" style={{ display: 'block', height: 'auto' }}>
          <Select
            value={a.font}
            onChange={(v) => setA({ font: v })}
            options={fontOptions}
            style={{
              width: 200,
            }}
          />
          <FontAssetControl />
        </div>

        <label>
          {translate('settingsView.t15')}<span className="sub">{translate('settingsView.t372Desc')}</span>
        </label>
        <div className="control">
          <Space.Compact>
            <InputNumber
              min={10}
              max={20}
              step={1}
              value={a.fontSize}
              onChange={(v) => setA({ fontSize: typeof v === 'number' ? v : 15 })}
              className="font-size-input"
            />
            <span className="input-suffix-addon">px</span>
          </Space.Compact>
        </div>

        <label>
          {translate('settingsView.t373')}
          <span className="sub">
            {translate('settingsView.tpl35Desc', { zoom: a.uiZoom ?? 100, plus: modSymbol(), minus: modSymbol() })}
          </span>
        </label>
        <div className="control ui-zoom-control">
          <Space.Compact>
            <InputNumber
              min={80}
              max={150}
              step={5}
              value={a.uiZoom ?? 100}
              onChange={(v) => {
                if (typeof v !== 'number') {
                  setA({ uiZoom: 100 })
                  return
                }
                const stepped = Math.round(v / UI_ZOOM_STEP) * UI_ZOOM_STEP
                setA({ uiZoom: Math.min(UI_ZOOM_MAX, Math.max(UI_ZOOM_MIN, stepped)) })
              }}
              className="ui-zoom-input"
            />
            <span className="input-suffix-addon">%</span>
          </Space.Compact>
        </div>

        <label>
          {translate('settingsView.t374')}<span className="sub">{translate('settingsView.t375Desc')}</span>
        </label>
        <Switch
          size="middle"
          checked={a.codeLigature}
          onChange={(v) => setA({ codeLigature: v })}
        />

        <label>{translate('settingsView.t376')}</label>
        <Segmented
          value={a.windowCorners}
          onChange={(v) => setA({ windowCorners: v as 'sharp' | 'soft' | 'round' })}
          options={[
            { label: translate('settingsView.t145'), value: 'sharp' },
            { label: translate('settingsView.t146'), value: 'soft' },
            { label: translate('settingsView.t147'), value: 'round' },
          ]}
        />

        <label>
          {translate('settingsView.t377')}<span className="sub">{translate('settingsView.t378Desc')}</span>
        </label>
        <Switch
          size="middle"
          checked={a.backdropBlur}
          onChange={(v) => setA({ backdropBlur: v })}
        />
      </div>

      <div className="subsec-h">{translate('settingsView.t379')}</div>
      <div className="settings-card">
        <SettingsRow
          title={translate('settingsView.t295')}
          desc={translate('settingsView.t296Desc')}
          right={
            <Switch
              size="middle"
              checked={a.autoCollapseTools}
              onChange={(v) => setA({ autoCollapseTools: v })}
            />
          }
        />
        <SettingsRow
          title={translate('settingsView.t297')}
          right={
            <Switch
              size="middle"
              checked={a.syntaxHighlight}
              onChange={(v) => setA({ syntaxHighlight: v })}
            />
          }
        />
        <SettingsRow
          title={translate('settingsView.t298')}
          right={
            <Select
              value={a.timestampFormat}
              onChange={(v) => setA({ timestampFormat: v })}
              options={[
                { label: translate('settingsView.t148'), value: 'rel' },
                { label: translate('settingsView.t149'), value: 'abs' },
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
      bg: '#303030',
      soft: '#262626',
      text: '#fafafa',
      muted: '#6b7280',
      accent: 'var(--primary)',
    },
    auto: {
      bg: 'linear-gradient(135deg, #fff 50%, #303030 50%)',
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
        <span>{kind === 'light' ? translate('settingsView.t13') : kind === 'dark' ? translate('settingsView.t12') : translate('settingsView.t150')}</span>
        {active && <Icons.Check size={13} className="color-primary" />}
      </div>
    </button>
  )
}

/* ───────── SHORTCUTS ───────── */
function ShortcutsSection() {
  const [shortcuts, setShortcuts] = useState<ShortcutBinding[]>(() => loadShortcuts())
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()

  const updateShortcuts = useCallback((next: ShortcutBinding[]) => {
    setShortcuts(next)
    saveShortcuts(next)
  }, [])

  const resetShortcuts = useCallback(() => {
    updateShortcuts(DEFAULT_SHORTCUTS)
  }, [updateShortcuts])

  const updateShortcutKey = useCallback(
    (id: ShortcutBinding['id'], rawValue: string) => {
      const value = rawValue.trim()
      if (!value) return
      updateShortcuts(
        shortcuts.map((shortcut) =>
          shortcut.id === id
            ? { ...shortcut, key: value === 'Esc' ? 'Escape' : value.toLowerCase() }
            : shortcut,
        ),
      )
    },
    [shortcuts, updateShortcuts],
  )

  const groupedShortcuts = shortcuts.reduce<Record<ShortcutBinding['group'], ShortcutBinding[]>>(
    (acc, shortcut) => {
      if (
        normalizedQuery &&
        !`${shortcut.label} ${shortcut.description} ${formatShortcut(shortcut.key, shortcut.shift)}`
          .toLowerCase()
          .includes(normalizedQuery)
      ) {
        return acc
      }
      acc[shortcut.group].push(shortcut)
      return acc
    },
    { action: [], navigation: [], settings: [] },
  )

  const groups: { id: ShortcutBinding['group']; name: string }[] = [
    { id: 'action', name: translate('settingsView.t151') },
    { id: 'navigation', name: translate('settingsView.t152') },
    { id: 'settings', name: translate('settingsView.t153') },
  ]

  return (
    <div className="settings-section section-wider">
      <h2>{translate('settingsView.t41')}</h2>
      <div className="lede">
        {translate('settingsView.t380Desc')}
      </div>

      <div className="row row-mb-sm">
        <Input
          className="flex1"
          size="middle"
          allowClear
          prefix={<Icons.Search size={14} />}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={translate('settingsView.t299')}
        />
        <Button
          size="middle"
          type="text"
          icon={<Icons.Refresh size={13} />}
          onClick={resetShortcuts}
        >
          {translate('settingsView.t381')}
        </Button>
      </div>

      {groups.map((group) => {
        const items = groupedShortcuts[group.id]
        if (items.length === 0) return null
        return (
          <div key={group.id}>
            <div className="subsec-h">{group.name}</div>
            <div className="keymap">
              {items.map((shortcut) => (
                <div key={shortcut.id} className="km-row">
                  <div className="km-action">
                    <div className="km-action-title">{shortcut.label}</div>
                    <div className="km-action-desc">{shortcut.description}</div>
                  </div>
                  <div className="km-keys">
                    {shortcut.shift && <span className="kbd">⇧</span>}
                    {shortcut.mod && <span className="kbd">{modSymbol().replace('+', '')}</span>}
                    <Input
                      className="shortcut-key-input"
                      value={shortcut.key === 'Escape' ? 'Esc' : shortcut.key.toUpperCase()}
                      onChange={(e) => updateShortcutKey(shortcut.id, e.target.value)}
                      aria-label={translate('settingsView.tpl1Desc', { label: shortcut.label })}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {groups.every((group) => groupedShortcuts[group.id].length === 0) && (
        <div className="empty-hint">{translate('settingsView.t382')}</div>
      )}
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
        const visibleProviders = filterProvidersForVisibleUi(pRes.profiles)
        const visibleProviderIds = new Set(visibleProviders.map((provider) => provider.id))
        setModels(mRes.models.filter((model) => visibleProviderIds.has(model.providerId)))
        setProviders(visibleProviders)
      })
      .catch((err) => setError(err instanceof Error ? err.message : translate('settingsView.t154')))
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
      title: translate('settingsView.t155'),
      description: translate('settingsView.t156Desc'),
      confirmText: translate('settingsView.t157'),
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
          <h2 className="section-h2">{translate('settingsView.t383')}</h2>
          <div className="lede section-lede">
            {translate('settingsView.t384Desc')}
          </div>
        </div>
        <span className="badge primary dot">{translate('settingsView.tpl36Desc', { count: models.length })}</span>
      </div>

      {error && <div className="alert-banner">{error}</div>}

      {loading && <div className="card loading-card">{translate('settingsView.t385')}</div>}

      {!loading && providers.length === 0 && (
        <div className="card loading-card">{translate('settingsView.t386Desc')}</div>
      )}

      {!loading &&
        byProvider.map(({ provider, models: pModels }) => (
          <div key={provider.id} className="card model-card">
            <div className="row model-card-header">
              <span className="strong">{provider.name}</span>
              <span className="badge model-provider-badge">{provider.provider}</span>
              <span className="flex1" />
              <Button
                size="middle"
                type="text"
                icon={<Icons.Plus size={11} />}
                onClick={() => {
                  setAddingForProvider(provider.id)
                  setNewModelName('')
                }}
              >
                {translate('settingsView.t387')}
              </Button>
            </div>

            {addingForProvider === provider.id && (
              <div className="row row-gap-sm mb-sm">
                <Input
                  className="flex1 model-name-sm"
                  placeholder={translate('settingsView.t300Desc')}
                  value={newModelName}
                  onChange={(e) => setNewModelName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleAdd(provider.id)
                    if (e.key === 'Escape') setAddingForProvider(null)
                  }}
                  autoFocus
                />
                <Button size="middle" type="primary" onClick={() => void handleAdd(provider.id)}>
                  {translate('settingsView.t388')}
                </Button>
                <Button size="middle" type="text" onClick={() => setAddingForProvider(null)}>
                  {translate('settingsView.t389')}
                </Button>
              </div>
            )}

            {pModels.length === 0 && <div className="model-card-empty">{translate('settingsView.t390')}</div>}

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
                  <Switch size="middle" checked={m.enabled} onChange={() => void handleToggle(m)} />
                  <button className="icon-btn" title={translate('settingsView.t157')} onClick={() => void handleDelete(m.id)}>
                    <Icons.X size={13} />
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
    desc: translate('settingsView.t158'),
  },
  { scope: 'team', label: 'Team', badge: 'TEAM', badgeColor: '#8b5cf6', desc: translate('settingsView.t159') },
  { scope: 'user', label: 'User', badge: 'USER', badgeColor: '#10b981', desc: translate('settingsView.t160') },
  {
    scope: 'project',
    label: 'Project',
    badge: 'PROJ',
    badgeColor: '#f97316',
    desc: translate('settingsView.t161Desc'),
  },
  {
    scope: 'session',
    label: 'Session',
    badge: 'SESS',
    badgeColor: '#f43f5e',
    desc: translate('settingsView.t162'),
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
      .catch((err) => setError(err instanceof Error ? err.message : translate('settingsView.t163')))
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
      title: translate('settingsView.t164'),
      description: translate('settingsView.t165Desc'),
      confirmText: translate('settingsView.t157'),
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
        <h2>{translate('settingsView.t61')}</h2>
        <div className="lede">
          {translate('settingsView.t391LongDesc')}
        </div>

        <div className="row info-banner">
          <Icons.Brain size={14} className="color-primary flex-shrink-0" />
          <div className="flex1 info-banner-text">
            <strong>{translate('settingsView.t392')}</strong> · {translate('settingsView.tpl37Desc', { count: activeCount, scopes: RULE_LAYER_META.length })}
          </div>
          <Button size="middle" type="primary" icon={<Icons.Refresh size={11} />} onClick={refresh}>
            {translate('settingsView.t393')}
          </Button>
        </div>

        {error && <div className="alert-banner">{error}</div>}

        {loading ? (
          <div className="card loading-card">{translate('settingsView.t394')}</div>
        ) : (
          RULE_LAYER_META.map((meta) => (
            <RuleLayer
              key={meta.scope}
              scope={meta.label}
              badge={meta.badge}
              badgeColor={meta.badgeColor}
              desc={translate('settingsView.tpl2Desc', { desc: meta.desc, count: grouped[meta.scope].length })}
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
        {readOnly && <span className="badge rule-readonly-badge">{translate('settingsView.t395')}</span>}
        {!readOnly && (
          <button className="icon-btn" title={translate('settingsView.t168')} onClick={onAdd}>
            <Icons.Plus size={13} />
          </button>
        )}
      </div>
      <div className="rule-layer-body">
        {rules.length === 0 && (
          <div className="rule-line">
            <span className="src">empty</span>
            <span className="txt">{translate('settingsView.t396')}</span>
          </div>
        )}
        {rules.map((rule) => (
          <div key={rule.id} className={`rule-line ${rule.enabled ? '' : 'overridden'}`}>
            <span className="src">{rule.name}</span>
            <span className="txt">{rule.content}</span>
            <span className="marker win">P{rule.priority}</span>
            {!rule.enabled && <span className="marker lose">{translate('settingsView.t397')}</span>}
            <Switch size="middle" checked={rule.enabled} onChange={(v) => onToggle(rule.id, v)} />
            {!readOnly && (
              <>
                <button className="icon-btn" title={translate('settingsView.t301')} onClick={() => onEdit(rule)}>
                  <Icons.Edit size={13} />
                </button>
                <button className="icon-btn" title={translate('settingsView.t157')} onClick={() => onDelete(rule.id)}>
                  <Icons.X size={13} />
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
      setError(translate('settingsView.t166'))
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
      setError(err instanceof Error ? err.message : translate('settingsView.t167'))
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
            <div className="h-title">{rule === null ? translate('settingsView.t168') : translate('settingsView.t169')}</div>
            <div className="h-sub">{translate('settingsView.tpl38Desc', { scope })}</div>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <Icons.X />
          </button>
        </div>

        <div className="slide-panel-body">
          {error && <div className="alert-banner">{error}</div>}

          <div className="subsec-h">{translate('settingsView.t61')}</div>
          <div className="form-grid">
            <label>{translate('settingsView.t398')}</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={translate('settingsView.t302')}
            />

            <label>
              {translate('settingsView.t399')}<span className="sub">{translate('settingsView.t400')}</span>
            </label>
            <Input
              type="number"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
            />

            <label>{translate('settingsView.t401')}</label>
            <TextArea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={translate('settingsView.t303Desc')}
              className="rule-textarea"
              rows={8}
              resize
            />
          </div>
        </div>

        <div className="slide-panel-foot">
          <span className="flex1" />
          <Button size="middle" type="text" onClick={onClose}>
            {translate('settingsView.t389')}
          </Button>
          <Button
            size="middle"
            type="primary"
            loading={saving}
            icon={<Icons.Check size={13} />}
            onClick={handleSave}
            disabled={saving}
          >
            {translate('settingsView.t402')}
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
      .catch((err) => setError(err instanceof Error ? err.message : translate('settingsView.t170')))
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
        toast.success(translate('settingsView.t171'))
        setStatusMap((prev) => ({
          ...prev,
          [serverId]: { connected: true, toolCount: res.toolCount },
        }))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : translate('settingsView.t172'))
      setStatusMap((prev) => ({
        ...prev,
        [serverId]: {
          connected: false,
          toolCount: 0,
          error: err instanceof Error ? err.message : translate('settingsView.t172'),
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
        toast.success(translate('settingsView.t173'))
        setStatusMap((prev) => ({ ...prev, [serverId]: { connected: false, toolCount: 0 } }))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : translate('settingsView.t174'))
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
      toast.success(translate('settingsView.t175'))
      setDeleteConfirmId(null)
      refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : translate('settingsView.t176'))
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
      setFormError(translate('settingsView.t177'))
      return
    }
    if (draft.type === 'stdio' && !draft.command.trim()) {
      setFormError(translate('settingsView.t178Desc'))
      return
    }
    if (draft.type === 'sse' && !draft.url.trim()) {
      setFormError(translate('settingsView.t179Desc'))
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
        toast.success(translate('settingsView.t180'))
      } else {
        await createMcp({
          name,
          scope: draft.scope,
          configJson: JSON.stringify(config),
          enabled: true,
        })
        toast.success(translate('settingsView.t181'))
      }
      closeForm()
      refresh()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : translate('settingsView.t182'))
      toast.error(err instanceof Error ? err.message : translate('settingsView.t182'))
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
          <h2 className="section-h2">{translate('settingsView.t403')}</h2>
          <div className="lede section-lede">
            {translate('settingsView.t404LongDesc')}
          </div>
        </div>
        <span className="badge primary dot">
          {translate('settingsView.tpl39Desc', { running: runningCount, total: servers.length })}
        </span>
        <Button
          type="primary"
          icon={<Icons.Plus size={13} />}
          onClick={openAddForm}
          style={{ marginLeft: 10 }} /* dynamic */
        >
          {translate('settingsView.t387')}
        </Button>
      </div>

      {error && <div className="alert-banner">{error}</div>}

      {loading ? (
        <div className="card loading-card">{translate('settingsView.t405Desc')}</div>
      ) : servers.length === 0 ? (
        <div className="mcp-empty-state">
          <Icons.MCP size={24} />
          <div className="strong mcp-empty-title">{translate('settingsView.t406')}</div>
          <div className="mcp-empty-desc">{translate('settingsView.t407Desc')}</div>
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
                      <span>{translate('settingsView.tpl40Desc', { count: toolCount })}</span>
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
                        size="middle"
                        type="text"
                        icon={<Icons.Stop size={11} />}
                        onClick={() => void handleStop(server.id)}
                        title={translate('settingsView.t304')}
                      >
                        {translate('settingsView.t304')}
                      </Button>
                    ) : (
                      <Button
                        size="middle"
                        type="text"
                        icon={<Icons.Play size={11} />}
                        onClick={() => void handleStart(server.id)}
                        title={translate('settingsView.t5')}
                      >
                        {translate('settingsView.t5')}
                      </Button>
                    )}
                    <button className="icon-btn" title={translate('settingsView.t301')} onClick={() => openEditForm(server)}>
                      <Icons.Edit size={13} />
                    </button>
                    <button
                      className="icon-btn"
                      title={translate('settingsView.t157')}
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
                        <div className="mcp-detail-label">{translate('settingsView.t408')}</div>
                        <div className="mcp-detail-value">
                          <span
                            className={`badge ${isConnected ? 'success' : hasError ? 'danger' : ''} dot`}
                          >
                            {isConnected ? translate('settingsView.t183') : hasError ? translate('settingsView.t184') : translate('settingsView.t185')}
                          </span>
                        </div>
                      </div>
                      <div className="mcp-detail-col">
                        <div className="mcp-detail-label">{translate('settingsView.t409')}</div>
                        <div className="mcp-detail-value">
                          {transport === 'stdio' ? 'Stdio' : 'SSE'}
                        </div>
                      </div>
                      <div className="mcp-detail-col">
                        <div className="mcp-detail-label">{translate('settingsView.t410')}</div>
                        <div className="mcp-detail-value">{toolCount}</div>
                      </div>
                      <div className="mcp-detail-col">
                        <div className="mcp-detail-label">{translate('settingsView.t411')}</div>
                        <div className="mcp-detail-value">{server.scope}</div>
                      </div>
                    </div>

                    {hasError && (
                      <div className="mcp-detail-error">
                        <Icons.AlertTriangle size={13} />
                        <span>{status?.error}</span>
                      </div>
                    )}

                    <div className="mcp-detail-tools-h">{translate('settingsView.t412')}</div>
                    {(() => {
                      const tools = toolsMap[server.id]
                      if (tools == null) {
                        return (
                          <div className="mcp-detail-loading">
                            <Icons.Spinner size={13} /> {translate('settingsView.t413')}
                          </div>
                        )
                      }
                      if (tools.length === 0) {
                        return (
                          <div className="mcp-detail-empty">
                            {translate('settingsView.t414Desc')}
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
                  {editingId ? translate('settingsView.t186') : translate('settingsView.t187')}
                </div>
                <div className="modal-subtitle">
                  {draft.type === 'stdio' ? translate('settingsView.t188') : translate('settingsView.t189')}
                </div>
              </div>
              <button className="icon-btn" onClick={closeForm}>
                <Icons.X />
              </button>
            </div>

            <div className="modal-body modal-body-scroll">
              {formError && <div className="alert-banner">{formError}</div>}

              <div className="subsec-h">{translate('settingsView.t415')}</div>
              <div className="form-grid">
                <label>
                  {translate('settingsView.t398')}<span className="sub">{translate('settingsView.t416')}</span>
                </label>
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder={translate('settingsView.t305')}
                />

                <label>
                  {translate('settingsView.t411')}<span className="sub">{translate('settingsView.t417')}</span>
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
                  {translate('settingsView.t409')}<span className="sub">{translate('settingsView.t418Desc')}</span>
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
                    { label: translate('settingsView.t190'), value: 'stdio' },
                    { label: translate('settingsView.t191'), value: 'sse' },
                  ]}
                />
              </div>

              {draft.type === 'stdio' ? (
                <>
                  <div className="subsec-h mt-lg">{translate('settingsView.t419')}</div>
                  <div className="form-grid">
                    <label>
                      {translate('settingsView.t420')}<span className="sub">{translate('settingsView.t421')}</span>
                    </label>
                    <Input
                      className="mono-sm"
                      value={draft.command}
                      onChange={(e) => setDraft((prev) => ({ ...prev, command: e.target.value }))}
                      placeholder="npx"
                    />

                    <label>
                      {translate('settingsView.t422')}<span className="sub">{translate('settingsView.t423')}</span>
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
                  <div className="subsec-h mt-lg">{translate('settingsView.t424')}</div>
                  <div className="form-grid">
                    <label>
                      URL<span className="sub">{translate('settingsView.t425')}</span>
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
                {translate('settingsView.t426')}
                <Button
                  className="mcp-env-add-btn"
                  size="middle"
                  type="text"
                  icon={<Icons.Plus size={11} />}
                  onClick={addEnvPair}
                >
                  {translate('settingsView.t387')}
                </Button>
              </div>
              {draft.envPairs.length === 0 ? (
                <div className="mcp-env-empty">{translate('settingsView.t427')}</div>
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
                        title={translate('settingsView.t157')}
                      >
                        <Icons.X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="modal-foot">
              <span className="flex1" />
              <Button size="middle" type="text" onClick={closeForm}>
                {translate('settingsView.t389')}
              </Button>
              <Button
                size="middle"
                type="primary"
                loading={formSaving}
                icon={<Icons.Check size={13} />}
                onClick={() => void handleFormSave()}
                disabled={formSaving}
              >
                {translate('settingsView.t402')}
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
                <div className="modal-title">{translate('settingsView.t428')}</div>
                <div className="modal-subtitle">
                  {servers.find((s) => s.id === deleteConfirmId)?.name ?? ''}
                </div>
              </div>
            </div>
            <div className="modal-body">
              <div className="mcp-delete-warning">
                {translate('settingsView.tpl41Desc')}
                {statusMap[deleteConfirmId]?.connected ? translate('settingsView.t192Desc') : ''}
                {translate('settingsView.tpl42Desc')}
              </div>
            </div>
            <div className="modal-foot">
              <span className="flex1" />
              <Button size="middle" type="text" onClick={() => setDeleteConfirmId(null)}>
                {translate('settingsView.t389')}
              </Button>
              <Button
                size="middle"
                type="text"
                danger
                loading={actionLoading[deleteConfirmId] ?? false}
                onClick={() => void handleDelete(deleteConfirmId)}
                disabled={actionLoading[deleteConfirmId] ?? false}
              >
                {translate('settingsView.t429')}
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
      toast.success(translate('settingsView.t193'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : translate('settingsView.t194'))
    } finally {
      setSavingPrompt(false)
    }
  }

  const handleReset = () => {
    setSystemPrompt(savedPrompt)
  }

  const charCount = systemPrompt.length
  const estimatedTokenCount = estimateTokens(systemPrompt)

  return (
    <div className="settings-section">
      <div className="row section-header-row">
        <div className="flex1">
          <h2 className="section-h2">{translate('settingsView.t104')}</h2>
          <div className="lede section-lede">{translate('settingsView.t430Desc')}</div>
        </div>
        {isDirty && <span className="badge warning dot">{translate('settingsView.t431')}</span>}
      </div>

      <TextArea
        className="prompt-textarea"
        value={systemPrompt}
        onChange={(event) => setSystemPrompt(event.target.value)}
        placeholder={translate('settingsView.t306LongDesc')}
        rows={14}
      />

      <div className="prompt-editor-footer">
        <div className="prompt-editor-stats">
          <span>{translate('settingsView.tpl43Desc', { count: charCount })}</span>
          <span className="prompt-stats-sep">·</span>
          <span>{translate('settingsView.tpl44Desc', { count: estimatedTokenCount })}</span>
          {charCount > 10000 && (
            <>
              <span className="prompt-stats-sep">·</span>
              <span className="prompt-stats-warn">{translate('settingsView.t432')}</span>
            </>
          )}
        </div>
        <div className="row row-gap-xs">
          {isDirty && (
            <Button size="middle" type="text" onClick={handleReset}>
              {translate('settingsView.t433')}
            </Button>
          )}
          <Button
            size="middle"
            type="primary"
            loading={savingPrompt}
            icon={<Icons.Check size={13} />}
            onClick={() => void saveSystemPrompt()}
            disabled={savingPrompt || !isDirty}
          >
            {translate('settingsView.t402')}
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ───────── WORKFLOW TEMPLATES ───────── */
/* ───────── PERMISSIONS ───────── */
export function PermissionsSection() {
  useI18n()
  const [profiles, setProfiles] = useState<PermissionProfileItem[]>([])
  const [activeProfileId, setActiveProfileId] = useState('project-standard')
  const [loading, setLoading] = useState(true)
  const [runtimePrefs, setRuntimePrefs] = useState<RuntimePermissionPrefs>(() =>
    readRuntimePermissionPrefs(),
  )
  const { toast } = useToast()

  const { invoke: listProfiles } = useIpcInvoke('permission:list-profiles')
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

  const handleRuleChange = (action: string, mode: PermissionMode) => {
    if (!activeProfile) return
    void updateRule({ profileId: activeProfile.id, action, mode }).then(refresh)
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
    if (adapter !== 'codex') return

    void window.spark
      .invoke('sdk:integrity-check', { checkLatest: false })
      .then((result) => {
        const codex = result.sdks.find((sdk) => sdk.packageName === '@openai/codex-sdk')
        if (codex?.runtime?.installed !== false) return
        AntdModal.confirm({
          title: translate('settingsView.t195Desc'),
          content:
            translate('settingsView.t196LongDesc'),
          okText: translate('settingsView.t197'),
          cancelText: translate('settingsView.t198'),
          onOk: async () => {
            const installed = await window.spark.invoke('sdk:integrity-install', {
              packageName: '@openai/codex-sdk',
            })
            if (!installed.success) {
              toast.error(installed.message)
              throw new Error(installed.message)
            }
            toast.success(installed.message)
          },
        })
      })
      .catch((error: unknown) => {
        toast.error(
          translate('settingsView.tpl3Desc', { message: error instanceof Error ? error.message : String(error) }),
        )
      })
  }

  const RULE_META: Array<{
    action: string
    icon: ReactNode
    name: string
    hint: string
  }> = [
    {
      action: 'file_read',
      icon: <Icons.File />,
      name: translate('settingsView.t199'),
      hint: translate('settingsView.t200Desc'),
    },
    {
      action: 'file_write',
      icon: <Icons.Edit />,
      name: translate('settingsView.t201'),
      hint: translate('settingsView.t202Desc'),
    },
    {
      action: 'command_exec',
      icon: <Icons.Terminal />,
      name: translate('settingsView.t203'),
      hint: translate('settingsView.t204'),
    },
    {
      action: 'command_dangerous',
      icon: <Icons.AlertTriangle />,
      name: translate('settingsView.t205'),
      hint: translate('settingsView.t206Desc'),
    },
    {
      action: 'network_known',
      icon: <Icons.Globe />,
      name: translate('settingsView.t207'),
      hint: translate('settingsView.t208Desc'),
    },
    {
      action: 'network_unknown',
      icon: <Icons.Globe />,
      name: translate('settingsView.t209'),
      hint: translate('settingsView.t210Desc'),
    },
    {
      action: 'mcp_tool',
      icon: <Icons.MCP />,
      name: translate('settingsView.t211'),
      hint: translate('settingsView.t212Desc'),
    },
  ]

  const PROFILE_META: Record<string, { icon: ReactNode; desc: string }> = {
    strict: { icon: <Icons.Lock />, desc: translate('settingsView.t213') },
    'project-standard': { icon: <Icons.Shield />, desc: translate('settingsView.t214') },
    trusted: { icon: <Icons.CheckCircle />, desc: translate('settingsView.t215') },
  }

  return (
    <div className="settings-section">
      <h2>{translate('settingsView.t68')}</h2>
      <div className="lede">
        {translate('settingsView.tpl45LongDesc')}
      </div>

      <div className="subsec-h">{translate('settingsView.t434')}</div>
      <div className="card runtime-permission-card">
        <SettingsRow
          title={translate('settingsView.t307')}
          desc={translate('settingsView.t308Desc')}
          right={
            <div className="select-sm">
              <Select
                value={runtimeAdapter}
                onChange={(v) => handleRuntimeAdapterChange(v as SessionAgentAdapter)}
                options={[
                  { label: 'Claude SDK', value: 'claude-sdk' },
                  { label: 'Codex', value: 'codex' },
                  { label: 'Spark', value: 'spark' },
                ]}
              />
            </div>
          }
        />
        <SettingsRow title={translate('settingsView.t309')} desc={translate('settingsView.t310Desc')} />
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
              {translate('settingsView.t435LongDesc')}
            </span>
          </div>
        )}
      </div>

      <div className="subsec-h">{translate('settingsView.t436')}</div>
      {loading ? (
        <div className="loading-sm">{translate('settingsView.t437')}</div>
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
                desc={meta?.desc ?? p.name}
              />
            )
          })}
        </div>
      )}

      {activeProfile && (
        <>
          <div className="subsec-h">{translate('settingsView.tpl46Desc', { name: activeProfile.name })}</div>
          <div className="card">
            {RULE_META.map(({ action, icon, name, hint }) => {
              const rule = activeProfile.rules.find((r) => r.action === action)
              const mode = (rule?.mode ?? 'ask') as PermissionMode
              return (
                <PermRule
                  key={action}
                  icon={icon}
                  name={name}
                  hint={hint}
                  mode={mode}
                  onModeChange={(m) => handleRuleChange(action, m)}
                />
              )
            })}
          </div>
        </>
      )}
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
  mode,
  onModeChange,
}: {
  icon: ReactNode
  name: string
  hint: string
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
          value={mode}
          onChange={(v) => onModeChange?.(v as PermissionMode)}
          options={[
            { label: translate('settingsView.t70'), value: 'allow' },
            { label: translate('settingsView.t216'), value: 'ask' },
            { label: translate('settingsView.t217'), value: 'ask-twice' },
            { label: translate('settingsView.t71'), value: 'deny' },
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
    <div className="settings-section settings-section--fill">
      <h2>{translate('settingsView.t121')}</h2>
      <div className="lede">
        {translate('settingsView.t438Desc')}
      </div>

      {/* ── 本地日志级别 ── */}
      <div className="form-grid">
        <label>{translate('settingsView.t439')}</label>
        <Select
          value={s.logLevel}
          onChange={(v) => set({ logLevel: v as TelemetrySettings['logLevel'] })}
          options={[
            { label: 'error', value: 'error' },
            { label: 'warn', value: 'warn' },
            { label: 'info', value: 'info' },
            { label: 'debug', value: 'debug' },
          ]}
        />
      </div>

      {/* ── 运行时日志开关 ── */}
      <div className="form-grid">
        <label>
          {translate('settingsView.t440')}
          <span className="sub">
            {translate('settingsView.t441Desc')}
          </span>
        </label>
        <Switch
          size="middle"
          checked={s.runtimeLogEnabled}
          onChange={(v) => set({ runtimeLogEnabled: v })}
        />
      </div>

      <SettingsLogViewer />
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
      recordCount: number
    }
    currentMonth: {
      totalInputTokens: number
      totalOutputTokens: number
      totalCacheReadTokens: number
      totalCacheWriteTokens: number
      recordCount: number
    }
    recentRecords: Array<{
      id: string
      session_id: string
      provider_id: string
      model_id: string
      input_tokens: number
      output_tokens: number
      cache_read_tokens: number
      cache_write_tokens: number
      request_timestamp: string
      created_at: string
    }>
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [purging, setPurging] = useState(false)

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

  const fmtDate = (ts: string) => {
    try {
      const d = new Date(ts)
      return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
    } catch {
      return ts
    }
  }

  const purgeOldRecords = useCallback(async () => {
    setPurging(true)
    setError(null)
    try {
      await window.spark.invoke('usage:purge', { olderThanDays: 90 })
      // 记录已删除：清掉热力图缓存，避免 6 个月 / 1 年档位回显已清理的数据。
      clearUsageHeatmapCache()
      await loadDashboard()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPurging(false)
    }
  }, [loadDashboard])

  const month = dashboard?.currentMonth
  const total = dashboard?.total
  const records = dashboard?.recentRecords ?? []

  return (
    <div className="settings-section">
      <h2>{translate('settingsView.t89')}</h2>
      <div className="lede">{translate('settingsView.t442Desc')}</div>

      {error && <div className="card usage-error-card">{error}</div>}

      {/* ── Overview Cards ── */}
      <div className="subsec-h">{translate('settingsView.t443')}</div>
      <div className="usage-overview-grid">
        <div className="usage-stat-card">
          <div className="usage-stat-label">{translate('settingsView.t444')}</div>
          <div className="usage-stat-value">
            {loading ? '—' : fmt(month?.totalInputTokens ?? 0)}
          </div>
        </div>
        <div className="usage-stat-card">
          <div className="usage-stat-label">{translate('settingsView.t445')}</div>
          <div className="usage-stat-value">
            {loading ? '—' : fmt(month?.totalOutputTokens ?? 0)}
          </div>
        </div>
        <div className="usage-stat-card">
          <div className="usage-stat-label">{translate('settingsView.t446')}</div>
          <div className="usage-stat-value">
            {loading ? '—' : fmt(month?.totalCacheReadTokens ?? 0)}
          </div>
        </div>
        <div className="usage-stat-card">
          <div className="usage-stat-label">{translate('settingsView.t447')}</div>
          <div className="usage-stat-value">
            {loading ? '—' : fmt(month?.totalCacheWriteTokens ?? 0)}
          </div>
        </div>
      </div>

      {/* ── All-time summary ── */}
      <div className="subsec-h">{translate('settingsView.t448')}</div>
      <div className="usage-alltime-grid">
        <div className="usage-stat-card with-icon">
          <div className="usage-stat-icon">
            <Icons.Hash size={14} />
          </div>
          <div className="usage-stat-label">{translate('settingsView.t449')}</div>
          <div className="usage-stat-value">{loading ? '—' : String(total?.recordCount ?? 0)}</div>
        </div>
        <div className="usage-stat-card with-icon">
          <div className="usage-stat-icon">
            <Icons.ArrowUp size={14} />
          </div>
          <div className="usage-stat-label">{translate('settingsView.t450')}</div>
          <div className="usage-stat-value">
            {loading ? '—' : fmt(total?.totalInputTokens ?? 0)}
          </div>
        </div>
        <div className="usage-stat-card with-icon">
          <div className="usage-stat-icon">
            <Icons.ArrowDown size={14} />
          </div>
          <div className="usage-stat-label">{translate('settingsView.t451')}</div>
          <div className="usage-stat-value">
            {loading ? '—' : fmt(total?.totalOutputTokens ?? 0)}
          </div>
        </div>
        <div className="usage-stat-card with-icon">
          <div className="usage-stat-icon">
            <Icons.Database size={14} />
          </div>
          <div className="usage-stat-label">{translate('settingsView.t452')}</div>
          <div className="usage-stat-value">
            {loading ? '—' : fmt(total?.totalCacheReadTokens ?? 0)}
          </div>
        </div>
        <div className="usage-stat-card with-icon">
          <div className="usage-stat-icon">
            <Icons.Zap size={14} />
          </div>
          <div className="usage-stat-label">{translate('settingsView.t453')}</div>
          <div className="usage-stat-value">
            {loading ? '—' : fmt(total?.totalCacheWriteTokens ?? 0)}
          </div>
        </div>
      </div>

      {/* ── Usage ranking（模型 / 渠道 tab + 时间区间）── */}
      <UsageRankingCard />

      {/* ── Recent Records ── */}
      <div className="subsec-h">{translate('settingsView.t454')}</div>
      <div className="card usage-records-card">
        {records.length === 0 && !loading && (
          <div className="settings-card-row usage-empty">{translate('settingsView.t455')}</div>
        )}
        <div className="usage-records-table">
          {records.map((r) => (
            <div key={r.id} className="usage-record-row">
              <span className="usage-rec-time">{fmtDate(r.request_timestamp)}</span>
              <span className="usage-rec-model">{r.model_id}</span>
              <span className="usage-rec-tokens mono-sm">
                ↑{fmt(r.input_tokens)} ↓{fmt(r.output_tokens)}
                {r.cache_read_tokens > 0 && translate('settingsView.tpl4Desc', { value: fmt(r.cache_read_tokens) })}
                {r.cache_write_tokens > 0 && translate('settingsView.tpl5Desc', { value: fmt(r.cache_write_tokens) })}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Actions ── */}
      <div className="subsec-h">{translate('settingsView.t456')}</div>
      <div className="card">
        <SettingsRow
          title={translate('settingsView.t311')}
          desc={translate('settingsView.t312')}
          right={
            <Button
              size="middle"
              type="text"
              loading={loading}
              icon={<Icons.Refresh size={11} />}
              onClick={loadDashboard}
              disabled={loading}
            >
              {translate('settingsView.t393')}
            </Button>
          }
        />
        <SettingsRow
          title={translate('settingsView.t313')}
          desc={translate('settingsView.t314Desc')}
          right={
            <Button
              size="middle"
              type="text"
              danger
              loading={purging}
              onClick={purgeOldRecords}
              disabled={loading || purging}
            >
              {translate('settingsView.t96')}
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
    attachmentsDir: string
    attachmentsBytes: number
    canvasProjectsBytes: number
    logsPath: string
    logsBytes: number
    totalBytes: number
  } | null>(null)
  const [canvasProjectsRoot, setCanvasProjectsRoot] = useState('')
  const [statsLoading, setStatsLoading] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [canvasMaintaining, setCanvasMaintaining] = useState(false)
  const [clearingLogs, setClearingLogs] = useState(false)
  const [clearingSnapshots, setClearingSnapshots] = useState(false)
  const { toast } = useToast()
  const { requestConfirm } = useApp()
  const { t: tr } = useI18n()
  const { setHistoryImportOpen } = useSessionSidebar()
  const { invoke: getCurrentWorkspace } = useIpcInvoke('workspace:get-current')
  const { invoke: openWorkspace } = useIpcInvoke('workspace:open')
  const { invoke: closeWorkspace } = useIpcInvoke('workspace:close')
  const { invoke: openDirectory } = useIpcInvoke('dialog:open-directory')
  const { invoke: getStorageStats } = useIpcInvoke('app:get-storage-stats')
  const { invoke: clearCache } = useIpcInvoke('app:clear-cache')
  const { invoke: openDataDir } = useIpcInvoke('app:open-data-dir')
  const { invoke: getSetting } = useIpcInvoke('settings:get')
  const { invoke: setSetting } = useIpcInvoke('settings:set')
  const { invoke: getInheritInfo } = useIpcInvoke('data:get-inherit-info')
  const { invoke: inheritProductionDb } = useIpcInvoke('data:inherit-production-db')
  const [inheritInfo, setInheritInfo] = useState<Awaited<ReturnType<typeof getInheritInfo>> | null>(
    null,
  )
  const [inheriting, setInheriting] = useState(false)

  useEffect(() => {
    let cancelled = false
    void getInheritInfo({})
      .then((info) => {
        if (!cancelled) setInheritInfo(info)
      })
      .catch(() => {
        if (!cancelled) {
          setInheritInfo({ available: false, currentIsDev: false, reason: translate('settingsView.t218') })
        }
      })
    return () => {
      cancelled = true
    }
  }, [getInheritInfo])

  const handleInheritProductionDb = useCallback(async () => {
    const confirmed = await requestConfirm({
      title: translate('settingsView.t219'),
      description:
        translate('settingsView.t220LongDesc'),
      confirmText: translate('settingsView.t221'),
      danger: true,
    })
    if (!confirmed) return
    setInheriting(true)
    try {
      const res = await inheritProductionDb({})
      toast.success(
        translate('settingsView.tpl6Desc', { size: formatBytes(res.incomingBytes ?? 0) }),
      )
      // 不复位 loading：应用马上重启
    } catch (err) {
      toast.error(err instanceof Error ? err.message : translate('settingsView.t222'))
      setInheriting(false)
    }
  }, [inheritProductionDb, requestConfirm, toast])

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
      console.error(translate('settingsView.t223'), err)
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
      toast.error(err instanceof Error ? err.message : translate('settingsView.t224'))
    }
  }

  const handleClearCache = async (pruneOrphan: boolean) => {
    const label = pruneOrphan ? translate('settingsView.t225Desc') : translate('settingsView.t226')
    const confirmed = await requestConfirm({
      title: `${label}？`,
      description: translate('settingsView.t227Desc'),
      confirmText: translate('settingsView.t228'),
      danger: true,
    })
    if (!confirmed) return
    setClearing(true)
    try {
      const res = await clearCache({ pruneOrphanProjects: pruneOrphan })
      toast.success(translate('settingsView.tpl7Desc', { size: formatBytes(res.clearedBytes) }))
      await refreshStats()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : translate('settingsView.t229'))
    } finally {
      setClearing(false)
    }
  }

  const handleClearLogs = async () => {
    const confirmed = await requestConfirm({
      title: translate('settingsView.t230'),
      description: translate('settingsView.t231Desc'),
      confirmText: translate('settingsView.t228'),
      danger: true,
    })
    if (!confirmed) return
    setClearingLogs(true)
    try {
      const res = await clearCache({ clearLogs: true })
      if (res.clearedLogs) {
        toast.success(translate('settingsView.t232'))
      } else {
        toast.error(translate('settingsView.t233'))
      }
      await refreshStats()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : translate('settingsView.t233'))
    } finally {
      setClearingLogs(false)
    }
  }

  const handleClearRuntimeSnapshots = async () => {
    const confirmed = await requestConfirm({
      title: translate('settingsView.t234'),
      description:
        translate('settingsView.t235LongDesc'),
      confirmText: translate('settingsView.t236'),
      danger: true,
    })
    if (!confirmed) return
    setClearingSnapshots(true)
    try {
      const res = await clearCache({ clearRuntimeSnapshots: true })
      if (res.prunedSnapshotRows > 0) {
        toast.success(translate('settingsView.tpl8Desc', { count: res.prunedSnapshotRows }))
      } else {
        toast.info(translate('settingsView.t237'))
      }
      await refreshStats()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : translate('settingsView.t238'))
    } finally {
      setClearingSnapshots(false)
    }
  }

  const handleOpenWorkspace = async () => {
    try {
      const selected = await openDirectory({ title: translate('settingsView.t239') })
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
        title: translate('settingsView.t240Desc'),
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
      toast.success(translate('settingsView.t241Desc'))
      await refreshStats()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : translate('settingsView.t242Desc'))
    }
  }

  const handleMigrateCanvasAssets = async () => {
    const confirmed = await requestConfirm({
      title: translate('settingsView.t243'),
      description: translate('settingsView.t244Desc'),
      confirmText: translate('settingsView.t245'),
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
        translate('settingsView.tpl9Desc', { moved, skipped: skipped > 0 ? translate('settingsView.tpl9bDesc', { count: skipped }) : '' }),
      )
      await refreshStats()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : translate('settingsView.t246'))
    } finally {
      setCanvasMaintaining(false)
    }
  }

  const handleCleanupCanvasAssets = async () => {
    const confirmed = await requestConfirm({
      title: translate('settingsView.t247'),
      description: translate('settingsView.t248Desc'),
      confirmText: translate('settingsView.t96'),
      danger: true,
    })
    if (!confirmed) return
    setCanvasMaintaining(true)
    try {
      const result = await canvasApi.cleanupLegacyCanvasAssets()
      toast.success(translate('settingsView.tpl10Desc', { count: result.deletedFiles, size: formatBytes(result.deletedBytes) }))
      await refreshStats()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : translate('settingsView.t249'))
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
      <h2>{translate('settingsView.t93')}</h2>
      <div className="lede">{translate('settingsView.t457Desc')}</div>

      <div className="form-grid">
        <label>{translate('settingsView.t458')}</label>
        <div className="control">
          <Input
            className="flex1"
            size="middle"
            value={stats?.userDataPath ?? translate('settingsView.t250')}
            readOnly
          />
          <Button
            size="middle"
            type="text"
            icon={<Icons.Folder size={13} />}
            onClick={handleOpenDataDir}
          >
            {translate('settingsView.t459')}
          </Button>
        </div>

        <label>
          {translate('settingsView.t460')}<span className="sub">{translate('settingsView.t461Desc')}</span>
        </label>
        <div className="control">
          <Input
            className="flex1"
            size="middle"
            value={workspace?.rootPath ?? translate('settingsView.t251')}
            readOnly
          />
          <Button
            size="middle"
            type="text"
            icon={<Icons.Folder size={13} />}
            onClick={handleOpenWorkspace}
          >
            {translate('settingsView.t462')}
          </Button>
          <Button
            size="middle"
            type="text"
            onClick={handleCloseWorkspace}
            disabled={workspace === null}
          >
            {translate('settingsView.t463')}
          </Button>
        </div>

        <label>
          {translate('settingsView.t464')}<span className="sub">{translate('settingsView.t465')}</span>
        </label>
        <div className="control">
          <Input
            className="flex1"
            size="middle"
            value={canvasProjectsRoot || stats?.canvasProjectsRoot || translate('settingsView.t250')}
            readOnly
          />
          <Button
            size="middle"
            type="text"
            icon={<Icons.Folder size={13} />}
            onClick={() => void handleChooseCanvasRoot()}
          >
            {translate('settingsView.t462')}
          </Button>
        </div>
      </div>

      {error !== null && <div className="card storage-card">{error}</div>}

      <div
        className="subsec-h"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end' }}
      >
        {translate('settingsView.t466')}
        <Button
          size="small"
          type="text"
          loading={statsLoading}
          onClick={() => void refreshStats()}
          disabled={statsLoading}
          style={{ marginLeft: 8, fontSize: 12 }}
        >
          {translate('settingsView.t393')}
        </Button>
      </div>
      <div className="card">
        {stats === null ? (
          <div className="empty-compact">
            <div className="empty-desc">{statsLoading ? translate('settingsView.t252') : translate('settingsView.t253')}</div>
          </div>
        ) : (
          <>
            <UsageRow
              label={translate('settingsView.t315Desc')}
              used={formatBytes(stats.databaseBytes)}
              pct={percent(stats.databaseBytes, stats.totalBytes)}
            />
            <UsageRow
              label={translate('settingsView.t316Desc')}
              used={formatBytes(stats.projectsBytes)}
              pct={percent(stats.projectsBytes, stats.totalBytes)}
            />
            <UsageRow
              label={translate('settingsView.t317Desc')}
              used={formatBytes(stats.attachmentsBytes)}
              pct={percent(stats.attachmentsBytes, stats.totalBytes)}
            />
            <UsageRow
              label={translate('settingsView.t318')}
              used={formatBytes(stats.canvasProjectsBytes)}
              pct={percent(stats.canvasProjectsBytes, stats.totalBytes)}
            />
            <UsageRow
              label={translate('settingsView.t319Desc')}
              used={formatBytes(stats.cacheBytes)}
              pct={percent(stats.cacheBytes, stats.totalBytes)}
            />
            <UsageRow
              label={translate('settingsView.t320')}
              used={formatBytes(stats.logsBytes)}
              pct={percent(stats.logsBytes, stats.totalBytes)}
            />
            <div className="usage-total-hint">
              {translate('settingsView.tpl47Desc', { total: formatBytes(stats.totalBytes), path: stats.databasePath })}
            </div>
          </>
        )}
      </div>

      <div className="subsec-h">{translate('settingsView.t467')}</div>
      <div className="card">
        <SettingsRow
          title={translate('settingsView.t321')}
          desc={translate('settingsView.t322Desc')}
        />
        <SettingsRow
          title={tr('app.sidebar.importHistory')}
          desc={translate('settingsView.t323LongDesc')}
          right={
            <Button
              size="middle"
              type="text"
              icon={<Icons.Upload size={11} />}
              onClick={() => setHistoryImportOpen(true)}
            >
              {translate('settingsView.t468')}
            </Button>
          }
        />
        {inheritInfo?.available && (
          <SettingsRow
            title={translate('settingsView.t324')}
            desc={`${translate('settingsView.tpl48LongDesc')}${inheritInfo.productionDbPath ? translate('settingsView.tpl48bDesc', { path: inheritInfo.productionDbPath }) : ''}`}
            right={
              <Button
                size="middle"
                type="text"
                danger
                loading={inheriting}
                disabled={inheriting}
                onClick={() => void handleInheritProductionDb()}
              >
                {translate('settingsView.t221')}
              </Button>
            }
          />
        )}
      </div>

      <div className="subsec-h">{translate('settingsView.t96')}</div>
      <div className="card">
        <SettingsRow
          title={translate('settingsView.t325')}
          desc={`${translate('settingsView.tpl49LongDesc')}${stats ? translate('settingsView.tpl49bDesc', { size: formatBytes(stats.cacheBytes) }) : ''}${translate('settingsView.tpl49cDesc')}`}
          right={
            <Button
              size="middle"
              type="text"
              danger
              loading={clearing}
              onClick={() => void handleClearCache(false)}
              disabled={clearing}
            >
              {translate('settingsView.t228')}
            </Button>
          }
        />
        <SettingsRow
          title={translate('settingsView.t326')}
          desc={translate('settingsView.t327Desc')}
          right={
            <Button
              size="middle"
              type="text"
              danger
              loading={clearing}
              onClick={() => void handleClearCache(true)}
              disabled={clearing}
            >
              {translate('settingsView.t228')}
            </Button>
          }
        />
        <SettingsRow
          title={translate('settingsView.t328')}
          desc={`${translate('settingsView.tpl50LongDesc')}${stats ? translate('settingsView.tpl50bDesc', { size: formatBytes(stats.logsBytes) }) : ''}${translate('settingsView.tpl50cDesc')}`}
          right={
            <Button
              size="middle"
              type="text"
              danger
              loading={clearingLogs}
              onClick={() => void handleClearLogs()}
              disabled={clearingLogs}
            >
              {translate('settingsView.t228')}
            </Button>
          }
        />
        <SettingsRow
          title={translate('settingsView.t329')}
          desc={translate('settingsView.t330LongDesc')}
          right={
            <Button
              size="middle"
              type="text"
              danger
              loading={clearingSnapshots}
              onClick={() => void handleClearRuntimeSnapshots()}
              disabled={clearingSnapshots}
            >
              {translate('settingsView.t236')}
            </Button>
          }
        />
        <SettingsRow
          title={translate('settingsView.t331')}
          desc={translate('settingsView.t332LongDesc')}
          right={
            <Button
              size="middle"
              type="text"
              loading={canvasMaintaining}
              onClick={() => void handleMigrateCanvasAssets()}
              disabled={canvasMaintaining}
            >
              {translate('settingsView.t245')}
            </Button>
          }
        />
        <SettingsRow
          title={translate('settingsView.t333')}
          desc={translate('settingsView.t334Desc')}
          right={
            <Button
              size="middle"
              type="text"
              danger
              loading={canvasMaintaining}
              onClick={() => void handleCleanupCanvasAssets()}
              disabled={canvasMaintaining}
            >
              {translate('settingsView.t96')}
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
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<SessionId>>(new Set())
  const [batchDeleting, setBatchDeleting] = useState(false)
  const { toast } = useToast()
  const { requestConfirm } = useApp()
  const { refreshData } = useSessionSidebar()

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
      // 列表刷新后清空选中，避免选中已不存在的会话
      setSelectedSessionIds(new Set())
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
      toast.success(translate('settingsView.tpl14Desc', { name: workspace.name }))
      await Promise.all([refresh(), refreshData()])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : translate('settingsView.t254'))
    }
  }

  const handleRestoreSession = async (session: SessionListResponse['sessions'][number]) => {
    try {
      await updateSession({ sessionId: session.id, archived: false })
      toast.success(translate('settingsView.tpl15Desc', { title: session.title || translate('settingsView.t255') }))
      await Promise.all([refresh(), refreshData()])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : translate('settingsView.t256'))
    }
  }

  const handleDeleteWorkspace = async (workspace: WorkspaceInfo) => {
    const confirmed = await requestConfirm({
      title: translate('settingsView.tpl16Desc', { name: workspace.name }),
      description: translate('settingsView.t257'),
      confirmText: translate('settingsView.t258'),
      danger: true,
    })
    if (!confirmed) return
    try {
      await deleteWorkspace({ workspaceId: workspace.id })
      toast.success(translate('settingsView.tpl17Desc', { name: workspace.name }))
      refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : translate('settingsView.t259'))
    }
  }

  const handleDeleteSession = async (session: SessionListResponse['sessions'][number]) => {
    const confirmed = await requestConfirm({
      title: translate('settingsView.tpl18Desc'),
      description: translate('settingsView.t257'),
      confirmText: translate('settingsView.t258'),
      danger: true,
    })
    if (!confirmed) return
    try {
      await deleteSession({ sessionId: session.id })
      toast.success(translate('settingsView.tpl19Desc', { title: session.title || translate('settingsView.t255') }))
      refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : translate('settingsView.t260'))
    }
  }

  const toggleSelectSession = (id: SessionId, checked: boolean) => {
    setSelectedSessionIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const allSessionsSelected = sessions.length > 0 && selectedSessionIds.size === sessions.length
  const someSessionsSelected = selectedSessionIds.size > 0 && !allSessionsSelected

  const toggleSelectAllSessions = (checked: boolean) => {
    setSelectedSessionIds(checked ? new Set(sessions.map((s) => s.id)) : new Set())
  }

  const handleBatchDeleteSessions = async () => {
    const ids = Array.from(selectedSessionIds)
    if (ids.length === 0) return
    const confirmed = await requestConfirm({
      title: translate('settingsView.tpl20Desc', { count: ids.length }),
      description: translate('settingsView.t257'),
      confirmText: translate('settingsView.t258'),
      danger: true,
    })
    if (!confirmed) return
    setBatchDeleting(true)
    let ok = 0
    let fail = 0
    try {
      // 顺序删除：每个会话删除时会清理 PTY / executor 等副作用，
      // 串行执行更安全，归档会话数量有限（≤100）性能足够。
      for (const id of ids) {
        try {
          await deleteSession({ sessionId: id })
          ok++
        } catch {
          fail++
        }
      }
      if (fail === 0) {
        toast.success(translate('settingsView.tpl21Desc', { ok }))
      } else {
        toast.warning(translate('settingsView.tpl22Desc', { ok, fail }))
      }
    } finally {
      setBatchDeleting(false)
      refresh()
    }
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—'
    const d = new Date(dateStr)
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
  }

  return (
    <div className="settings-section">
      <h2>{translate('settingsView.t124')}</h2>
      <div className="lede">{translate('settingsView.t469Desc')}</div>

      {error && <div className="card storage-card">{error}</div>}

      {/* ── Archived Workspaces ── */}
      <div className="subsec-h">{translate('settingsView.tpl51Desc', { count: workspaces.length })}</div>
      <div className="card">
        {loading && <div className="settings-card-row">{translate('settingsView.t250')}</div>}
        {!loading && workspaces.length === 0 && (
          <div className="settings-card-row">{translate('settingsView.t470')}</div>
        )}
        {!loading &&
          workspaces.length > 0 &&
          workspaces.map((w) => (
            <div key={w.id} className="settings-card-row archived-item-row">
              <div className="flex1 min-w-0">
                <div className="row-title">{w.name}</div>
                <div className="row-desc mono-sm">{w.rootPath}</div>
                <div className="row-desc">{translate('settingsView.tpl52Desc', { date: formatDate(w.archivedAt) })}</div>
              </div>
              <div className="archived-item-actions">
                <Button
                  size="middle"
                  type="text"
                  icon={<Icons.Refresh size={11} />}
                  onClick={() => handleRestoreWorkspace(w)}
                >
                  {translate('settingsView.t95')}
                </Button>
                <Button
                  size="middle"
                  type="text"
                  danger
                  icon={<Icons.Trash size={11} />}
                  onClick={() => handleDeleteWorkspace(w)}
                >
                  {translate('settingsView.t157')}
                </Button>
              </div>
            </div>
          ))}
      </div>

      {/* ── Archived Sessions ── */}
      <div className="subsec-h">{translate('settingsView.tpl53Desc', { count: sessions.length })}</div>
      <div className="card">
        {loading && <div className="settings-card-row">{translate('settingsView.t250')}</div>}
        {!loading && sessions.length === 0 && (
          <div className="settings-card-row">{translate('settingsView.t471')}</div>
        )}
        {!loading && sessions.length > 0 && (
          <>
            {/* 批量操作栏 */}
            <div
              className="settings-card-row"
              style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--pad-sm)' }}
            >
              <Checkbox
                checked={allSessionsSelected}
                indeterminate={someSessionsSelected}
                onChange={(checked) => toggleSelectAllSessions(checked)}
              >
                {translate('settingsView.t472')}
              </Checkbox>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--pad-sm)' }}>
                {selectedSessionIds.size > 0 && (
                  <span className="row-desc">{translate('settingsView.tpl54Desc', { count: selectedSessionIds.size })}</span>
                )}
                <Button
                  size="middle"
                  type="text"
                  danger
                  icon={<Icons.Trash size={11} />}
                  disabled={selectedSessionIds.size === 0 || batchDeleting}
                  loading={batchDeleting}
                  onClick={handleBatchDeleteSessions}
                >
                  {translate('settingsView.t473')}
                </Button>
              </div>
            </div>
            {sessions.map((s) => (
              <div key={s.id} className="settings-card-row archived-item-row">
                <div style={{ flexShrink: 0, alignSelf: 'center' }}>
                  <Checkbox
                    checked={selectedSessionIds.has(s.id)}
                    onChange={(checked) => toggleSelectSession(s.id, checked)}
                  />
                </div>
                <div className="flex1 min-w-0">
                  <div className="row-title">{s.title || translate('settingsView.t255')}</div>
                  <div className="row-desc">
                    {translate('settingsView.tpl55Desc', { count: s.messageCount, date: formatDate(s.createdAt), sep: ' ' })}
                    {formatDate(s.archivedAt)}
                  </div>
                </div>
                <div className="archived-item-actions">
                  <Button
                    size="middle"
                    type="text"
                    icon={<Icons.Refresh size={11} />}
                    onClick={() => handleRestoreSession(s)}
                  >
                    {translate('settingsView.t95')}
                  </Button>
                  <Button
                    size="middle"
                    type="text"
                    danger
                    icon={<Icons.Trash size={11} />}
                    onClick={() => handleDeleteSession(s)}
                  >
                    {translate('settingsView.t157')}
                  </Button>
                </div>
              </div>
            ))}
          </>
        )}
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
  const [installProgress, setInstallProgress] = useState<SdkIntegrityInstallProgress | null>(null)
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
    const unsubProgress = window.spark?.on('stream:sdk:install-progress', (payload) => {
      setInstallProgress(payload)
      const active = payload.state !== 'done' && payload.state !== 'error'
      setInstallingPkg(active ? payload.packageName : null)
    })
    return () => {
      unsub?.()
      unsubProgress?.()
    }
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
      toast.error(translate('settingsView.tpl23Desc', { message: err instanceof Error ? err.message : String(err) }))
    } finally {
      setIsChecking(false)
      setIsCheckingLatest(false)
    }
  }

  const handleInstall = async (packageName: string) => {
    if (installingPkg != null) return
    setInstallingPkg(packageName)
    setInstallResult(null)
    setInstallProgress({
      packageName,
      state: 'preparing',
      downloaded: 0,
      total: 0,
      // percent 为 null 表示尚无法计算进度：按钮显示「下载中」、进度条走
      // indeterminate 动画；写成 0 会让进行中与完成后都显示成 0% 空条。
      percent: null,
      message: translate('settingsView.t261'),
    })
    try {
      const result = await window.spark.invoke('sdk:integrity-install', { packageName })
      setInstallResult({ pkg: packageName, success: result.success, message: result.message })
      if (result.success) {
        toast.success(result.message)
        // 部分安装路径（如 claude-agent-sdk 的 pnpm 安装）全程不发进度事件；
        // 成功后必须把合成进度收敛为 done/100%，否则条目下会一直挂着 0% 空进度条。
        setInstallProgress((current) =>
          current?.packageName === packageName
            ? {
                packageName,
                state: 'done',
                downloaded: current.downloaded,
                total: current.total,
                percent: 100,
                message: result.message,
              }
            : current,
        )
        // Re-check after install
        await handleCheck(true)
      } else {
        toast.error(result.message)
        setInstallProgress((current) => ({
          packageName,
          state: 'error',
          downloaded: current?.packageName === packageName ? current.downloaded : 0,
          total: current?.packageName === packageName ? current.total : 0,
          percent: current?.packageName === packageName ? current.percent : null,
          message: result.message,
        }))
      }
    } catch (err) {
      const message = translate('settingsView.tpl24Desc', { message: err instanceof Error ? err.message : String(err) })
      toast.error(message)
      setInstallProgress((current) => ({
        packageName,
        state: 'error',
        downloaded: current?.packageName === packageName ? current.downloaded : 0,
        total: current?.packageName === packageName ? current.total : 0,
        percent: current?.packageName === packageName ? current.percent : null,
        message,
      }))
    } finally {
      setInstallingPkg(null)
    }
  }

  const getStatusBadge = (sdk: SdkIntegrityItem) => {
    if (sdk.runtime && !sdk.runtime.installed) {
      return <span className="badge error dot">{translate('settingsView.t474')}</span>
    }
    if (sdk.runtime?.updateAvailable) {
      return <span className="badge warning dot">{translate('settingsView.tpl56Desc', { version: sdk.runtime.latestVersion })}</span>
    }
    if (!sdk.installed) {
      return <span className="badge error dot">{translate('settingsView.t267')}</span>
    }
    if (sdk.updateAvailable) {
      return <span className="badge warning dot">{translate('settingsView.tpl57Desc', { version: sdk.latestVersion })}</span>
    }
    if (sdk.latestChecked && sdk.latestVersion && !sdk.updateAvailable) {
      return <span className="badge success dot">{translate('settingsView.t280')}</span>
    }
    if (sdk.installed) {
      return <span className="badge success dot">{translate('settingsView.t264')}</span>
    }
    return <span className="badge dot">{translate('settingsView.t475')}</span>
  }

  const getToolBadge = (tool: RuntimeToolStatus) => {
    if (tool.available) {
      return <span className="badge success dot">{translate('settingsView.t476')}</span>
    }
    return <span className="badge error dot">{translate('settingsView.t265')}</span>
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
    if (!iso) return translate('settingsView.t262')
    try {
      return new Date(iso).toLocaleString('zh-CN')
    } catch {
      return iso
    }
  }

  // Count installed / total for summary (SDKs + tools combined)
  const sdkInstalled = sdks.filter((s) => s.installed).length
  const sdkRuntimeReady = sdks.filter((s) => s.runtime == null || s.runtime.installed).length
  const sdkHealthy = sdks.filter(
    (s) => s.installed && (s.runtime == null || s.runtime.installed),
  ).length
  const toolAvailable = tools.filter((t) => t.available).length
  const totalItems = sdks.length + tools.length
  const allOk =
    totalItems > 0 &&
    sdkInstalled === sdks.length &&
    sdkRuntimeReady === sdks.length &&
    toolAvailable === tools.length
  const isInstallingSdk = installingPkg != null

  return (
    <div className="settings-section">
      <h2>{translate('settingsView.t477')}</h2>
      <div className="lede">{translate('settingsView.t478Desc')}</div>

      {/* ── Status summary + actions ── */}
      <div className="integrity-toolbar">
        <div className="integrity-status-row">
          {totalItems > 0 ? (
            <div className={`integrity-status-badge ${allOk ? 'ok' : 'warn'}`}>
              {allOk ? <Icons.CheckCircle size={14} /> : <Icons.AlertTriangle size={14} />}
              <span>{allOk ? translate('settingsView.t263') : translate('settingsView.tpl25Desc', { ok: sdkHealthy + toolAvailable, total: totalItems })}</span>
            </div>
          ) : (
            <div className="integrity-status-badge unknown">
              <Icons.Refresh size={14} />
              <span>{translate('settingsView.t479')}</span>
            </div>
          )}
          {checkedAt && (
            <span className="muted" style={{ fontSize: '11px' }}>
              {translate('settingsView.tpl58Desc', { time: formatCheckedTime(checkedAt) })}
            </span>
          )}
        </div>
        <div className="integrity-actions">
          <Button
            size="middle"
            type="text"
            loading={isChecking}
            disabled={isChecking || isCheckingLatest}
            icon={<Icons.Refresh size={13} className={isChecking ? 'spin' : ''} />}
            onClick={() => void handleCheck(false)}
          >
            {translate('settingsView.t335')}
          </Button>
          <Button
            size="middle"
            type="text"
            loading={isCheckingLatest}
            disabled={isChecking || isCheckingLatest}
            icon={<Icons.Globe size={13} className={isCheckingLatest ? 'spin' : ''} />}
            onClick={() => void handleCheck(true)}
          >
            {translate('settingsView.t480')}
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
            size="middle"
            type="text"
            icon={<Icons.X size={13} />}
            onClick={() => setInstallResult(null)}
            style={{ marginLeft: 'auto', padding: '0 4px', height: 20 }}
          />
        </div>
      )}

      {/* ── Environment tools (node, npm, git) ── */}
      <div className="subsec-h" style={{ marginTop: 0 }}>
        {translate('settingsView.t481')}
      </div>
      <div className="settings-card integrity-sdk-card">
        {tools.map((tool, idx) => (
          <div key={tool.command} className={`integrity-sdk-row ${idx > 0 ? 'bordered' : ''}`}>
            <div className="integrity-tool-icon">{getToolIcon(tool.command)}</div>
            <div className="integrity-sdk-info">
              <div className="integrity-sdk-name">{tool.displayName}</div>
              <div className="integrity-sdk-version">
                {tool.available
                  ? (tool.version ?? translate('settingsView.t264'))
                  : tool.resolvedPath
                    ? tool.resolvedPath
                    : translate('settingsView.t265')}
              </div>
            </div>
            <div className="integrity-sdk-right">
              {tool.available && tool.source === 'bundled' && (
                <span className="badge dot">{translate('settingsView.t482')}</span>
              )}
              {tool.available && tool.source === 'system' && (
                <span className="badge dot">{translate('settingsView.t112')}</span>
              )}
              {getToolBadge(tool)}
              {!tool.available && (
                <Button
                  size="middle"
                  type="text"
                  icon={<Icons.ExternalLink size={13} />}
                  href={tool.downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {translate('settingsView.t56')}
                </Button>
              )}
            </div>
          </div>
        ))}
        {tools.length === 0 && !isChecking && (
          <div className="integrity-empty">
            <Icons.Terminal size={24} />
            <span>{translate('settingsView.t483Desc')}</span>
          </div>
        )}
      </div>

      {/* ── SDK list ── */}
      <div className="subsec-h">{translate('settingsView.t484')}</div>
      <div className="settings-card integrity-sdk-card">
        {sdks.map((sdk, idx) => (
          <div key={sdk.packageName}>
            <div className={`integrity-sdk-row ${idx > 0 ? 'bordered' : ''}`}>
              <div className="integrity-sdk-info">
                <div className="integrity-sdk-name">{sdk.displayName}</div>
                <div className="integrity-sdk-version">
                  {sdk.installedVersion
                    ? translate('settingsView.tpl26Desc', { version: sdk.installedVersion, suffix: sdk.runtime?.installedVersion ? translate('settingsView.tpl26bDesc', { version: sdk.runtime.installedVersion }) : sdk.runtime ? translate('settingsView.tpl26cDesc') : '' })
                    : sdk.installed
                      ? translate('settingsView.t264')
                      : translate('settingsView.t267')}
                </div>
              </div>
              <div className="integrity-sdk-right">
                {getStatusBadge(sdk)}
                {needsSdkInstallAction(sdk) && (
                  <Button
                    size="middle"
                    type="primary"
                    loading={installingPkg === sdk.packageName}
                    disabled={isInstallingSdk}
                    icon={<Icons.Download size={13} />}
                    onClick={() => void handleInstall(sdk.packageName)}
                  >
                    {installingPkg === sdk.packageName
                      ? installProgress?.percent != null
                        ? `${Math.round(installProgress.percent)}%`
                        : translate('settingsView.t268')
                      : installingPkg != null
                        ? translate('settingsView.t269')
                        : sdk.runtime && !sdk.runtime.installed
                          ? translate('settingsView.t197')
                          : sdk.installed
                            ? translate('settingsView.t128')
                            : translate('settingsView.t270')}
                  </Button>
                )}
              </div>
            </div>
            {installProgress?.packageName === sdk.packageName && (
              <div className="integrity-sdk-progress-wrap">
                <SdkInstallProgressView progress={installProgress} />
              </div>
            )}
            {(sdk.error || sdk.runtime?.error) && (
              <div className="integrity-sdk-error">{sdk.error || sdk.runtime?.error}</div>
            )}
            {!sdk.error && !sdk.runtime?.error && sdk.runtime?.note && (
              <div className="integrity-sdk-note">{sdk.runtime.note}</div>
            )}
          </div>
        ))}
        {sdks.length === 0 && !isChecking && (
          <div className="integrity-empty">
            <Icons.Package size={24} />
            <span>{translate('settingsView.t485Desc')}</span>
          </div>
        )}
      </div>

      {/* ── Reference ── */}
      <div className="subsec-h">{translate('settingsView.t486')}</div>
      <div className="integrity-ref-card">
        <div className="integrity-ref-item">
          <div className="integrity-ref-left">
            <div className="integrity-ref-name">Node.js</div>
            <div className="integrity-ref-desc">
              {translate('settingsView.t487LongDesc')}
            </div>
          </div>
          <span className="badge dot">{translate('settingsView.t488')}</span>
        </div>
        <div className="integrity-ref-item bordered">
          <div className="integrity-ref-left">
            <div className="integrity-ref-name">npm</div>
            <div className="integrity-ref-desc">
              {translate('settingsView.t489LongDesc')}
            </div>
          </div>
          <span className="badge dot">{translate('settingsView.t488')}</span>
        </div>
        <div className="integrity-ref-item bordered">
          <div className="integrity-ref-left">
            <div className="integrity-ref-name">Git</div>
            <div className="integrity-ref-desc">
              {translate('settingsView.t490Desc')}
            </div>
          </div>
          <span className="badge dot">{translate('settingsView.t488')}</span>
        </div>
        <div className="integrity-ref-item bordered">
          <div className="integrity-ref-left">
            <div className="integrity-ref-name">Claude Agent SDK</div>
            <div className="integrity-ref-desc">
              {translate('settingsView.t491LongDesc')}
            </div>
          </div>
          <span className="badge dot">{translate('settingsView.t488')}</span>
        </div>
        <div className="integrity-ref-item bordered">
          <div className="integrity-ref-left">
            <div className="integrity-ref-name">OpenAI Codex SDK</div>
            <div className="integrity-ref-desc">
              {translate('settingsView.tpl59LongDesc')}
            </div>
          </div>
          <span className="badge dot">{translate('settingsView.t488')}</span>
        </div>
      </div>

      {/* ── FFmpeg (视频处理工作台依赖) ── */}
      <FfmpegStatusCard />

      <CodexRuntimeDiagnosticsCard />

      {/* ── 语音输入 (ASR) 语音包完整性 ── */}
      <VoiceIntegritySettingsItem />

      <OptionalCapabilitiesSettingsCard />
    </div>
  )
}

/* ───────── UPDATES ───────── */
function UpdatesSection() {
  const [s, set] = usePersistedSettings(SETTINGS_UPDATES_KEY, DEFAULT_UPDATES)
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const installActionLabel = isPlatformDarwin ? translate('settingsView.t271') : translate('settingsView.t272')
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
  const updateSourceLabel = getUpdateSourceLabel(status?.updateSource)
  const downloadSourceLabel = getUpdateSourceLabel(status?.downloadSource)

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
    if (isError) return translate('settingsView.tpl27Desc', { message: status?.error ?? translate('settingsView.t273') })
    if (isChecking) return translate('settingsView.t274')
    if (isDownloading)
      return translate('settingsView.tpl28Desc', { percent: status?.progress != null ? `(${Math.round(status.progress.percent)}%)` : '' })
    if (isDownloaded) return translate('settingsView.tpl29Desc', { version: status?.updateInfo?.version ?? '?' })
    if (hasUpdate) return translate('settingsView.tpl30Desc', { version: status?.updateInfo?.version ?? '?' })
    return translate('settingsView.tpl31Desc')
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
      <h2>{translate('settingsView.t128')}</h2>
      <div className="lede">{translate('settingsView.t492Desc')}</div>

      <div className="card update-card">
        <div className={`update-icon ${getStatusClass()}`}>{getStatusIcon()}</div>
        <div className="flex1">
          <div className="strong update-version">{getStatusLabel()}</div>
          <div className="muted update-meta">
            SparkWork {currentVersion}
            {lastChecked ? translate('settingsView.tpl32Desc', { time: lastChecked }) : ''}
          </div>
          <div className="update-source-line">
            <Tag>{translate('settingsView.t493')}</Tag>
            <span>{translate('settingsView.tpl60Desc', { source: updateSourceLabel })}</span>
            {status?.downloadSource != null && <span>{translate('settingsView.tpl61Desc', { source: downloadSourceLabel })}</span>}
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
              {translate('settingsView.t494')}
            </Button>
          ) : isDownloading ? (
            <Button icon={<Icons.Download size={14} />} className="update-action-btn" disabled>
              {translate('settingsView.tpl62Desc', { percent: status?.progress != null ? `${Math.round(status.progress.percent)}%` : '' })}
            </Button>
          ) : (
            <Button
              // icon={<Icons.Refresh size={14} className={isChecking ? 'spin' : ''} />}
              className="update-action-btn"
              onClick={() => void handleCheckUpdate()}
              disabled={isChecking || isDownloading}
            >
              {isChecking ? translate('settingsView.t275') : translate('settingsView.t131')}
            </Button>
          )}
        </div>
      </div>

      {hasUpdate && status?.updateInfo != null && (
        <UpdateReleaseNotesCard
          version={status.updateInfo.version}
          releaseDate={status.updateInfo.releaseDate}
          releaseNotes={status.updateInfo.releaseNotes ?? null}
        />
      )}

      <div className="card">
        <SettingsRow
          title={translate('settingsView.t336')}
          desc={translate('settingsView.t337Desc')}
          right={
            <Button
              icon={<Icons.GitHub size={14} />}
              className="update-action-btn"
              onClick={handleOpenReleasesPage}
            >
              {translate('settingsView.t495')}
            </Button>
          }
        />
      </div>

      <div className="subsec-h">{translate('settingsView.t496')}</div>
      <div className="card">
        <SettingsRow
          title={translate('settingsView.t338')}
          desc={translate('settingsView.t339LongDesc')}
          right={
            <Switch
              size="middle"
              checked={s.autoCheck}
              onChange={(v) => handleSettingsChange('autoCheck', v)}
            />
          }
        />
        <SettingsRow
          title={translate('settingsView.t340')}
          desc={translate('settingsView.t341Desc')}
          right={
            <Switch
              size="middle"
              checked={s.autoDownload}
              onChange={(v) => handleSettingsChange('autoDownload', v)}
            />
          }
        />
        <SettingsRow
          title={translate('settingsView.t342')}
          desc={
            autoInstallSupported
              ? translate('settingsView.t276')
              : translate('settingsView.t277Desc')
          }
          right={
            <Switch
              size="middle"
              checked={s.autoInstall}
              disabled={!autoInstallSupported}
              onChange={(v) => handleSettingsChange('autoInstall', v)}
            />
          }
        />
        <SettingsRow
          title={translate('settingsView.t343')}
          desc={translate('settingsView.tpl33Desc', { source: updateSourceLabel })}
          right={
            <span className="badge">
              {status?.updateSource === 'github'
                ? 'GitHub'
                : status?.updateSource === 'version-center'
                  ? translate('settingsView.t278')
                  : translate('settingsView.t279')}
            </span>
          }
        />
      </div>

      <div className="subsec-h">{translate('settingsView.t129')}</div>
      <div className="card">
        <SettingsRow
          title="SparkWork"
          desc={`${currentVersion}`}
          right={
            <span className={hasUpdate ? 'badge warning dot' : 'badge success dot'}>
              {hasUpdate ? translate('settingsView.tpl34Desc', { version: status?.updateInfo?.version }) : translate('settingsView.t280')}
            </span>
          }
        />

        <SettingsRow title="Electron" desc="31.x" right={<span className="badge">{translate('settingsView.t497')}</span>} />
      </div>
    </div>
  )
}

/* ───────── Helpers ───────── */
const CLAUDE_RUNTIME_PERMISSION_OPTIONS: RuntimePermissionModeOption[] = [
  { value: 'claude-ask', label: translate('settingsView.t281'), desc: translate('settingsView.t282') },
  { value: 'claude-plan', label: translate('settingsView.t283'), desc: translate('settingsView.t284') },
  {
    value: 'claude-auto-edits',
    label: translate('settingsView.t285'),
    desc: translate('settingsView.t286'),
    tone: 'auto',
  },
  { value: 'claude-auto', label: translate('settingsView.t287'), desc: translate('settingsView.t288'), tone: 'auto' },
  {
    value: 'claude-bypass',
    label: translate('settingsView.t289'),
    desc: translate('settingsView.t290'),
    tone: 'danger',
  },
]

const CODEX_RUNTIME_PERMISSION_OPTIONS: RuntimePermissionModeOption[] =
  SHARED_CODEX_PERMISSION_MODE_OPTIONS.map(({ value, label, description, tone }) => ({
    value,
    label,
    desc: description,
    ...(tone === 'auto' || tone === 'danger' ? { tone } : {}),
  }))

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
        <div className="about-title">SparkWork</div>
        <div className="about-subtitle">{translate('settingsView.t498')}</div>
        <div className="about-version">{translate('settingsView.tpl63Desc', { version: sysInfo?.appVersion ?? '0.1.0' })}</div>
      </div>
      <div className="subsec-h">{translate('settingsView.t499')}</div>
      <div className="card">
        <SettingsRow
          title="Electron"
          desc={translate('settingsView.t344')}
          right={<span className="mono-sm tech-version">{sysInfo?.electronVersion ?? '31.x'}</span>}
        />
        <SettingsRow
          title="Chromium"
          desc={translate('settingsView.t345')}
          right={
            <span className="mono-sm tech-version">{sysInfo?.chromeVersion ?? 'unknown'}</span>
          }
        />
        <SettingsRow
          title="Node.js"
          desc={translate('settingsView.t346Desc')}
          right={<span className="mono-sm tech-version">{sysInfo?.nodeVersion ?? 'unknown'}</span>}
        />
        <SettingsRow
          title="React"
          desc={translate('settingsView.t347')}
          right={<span className="mono-sm tech-version">19.x</span>}
        />
        <SettingsRow
          title="TypeScript"
          desc={translate('settingsView.t348')}
          right={<span className="mono-sm tech-version">5.x</span>}
        />
        <SettingsRow
          title={translate('settingsView.t349')}
          desc={translate('settingsView.t350')}
          right={<span className="mono-sm tech-version">SQLite (better-sqlite3)</span>}
        />
        <SettingsRow
          title={translate('settingsView.t351')}
          desc="Agent Runtime"
          right={<span className="mono-sm tech-version">Claude / OpenAI / DeepSeek / Ollama</span>}
        />
      </div>

      <div className="subsec-h">{translate('settingsView.t500')}</div>
      <div className="card">
        <SettingsRow
          title={translate('settingsView.t352')}
          desc={translate('settingsView.t353')}
          right={<span className="mono-sm tech-version">{sysInfo?.platform ?? '—'}</span>}
        />
        <SettingsRow
          title="User Agent"
          desc={translate('settingsView.t354')}
          right={
            <span className="mono-sm tech-version about-user-agent">
              {navigator.userAgent.slice(0, 60)}…
            </span>
          }
        />
      </div>

      <div className="subsec-h">{translate('settingsView.t501')}</div>
      <div className="card">
        <SettingsRow
          title="GitHub"
          desc={translate('settingsView.t355')}
          right={
            <a href="https://github.com" target="_blank" rel="noreferrer" className="about-link">
              github.com →
            </a>
          }
        />
        <SettingsRow
          title={translate('settingsView.t356')}
          desc={translate('settingsView.t357')}
          right={
            <a
              href="https://docs.spark-agent.dev"
              target="_blank"
              rel="noreferrer"
              className="about-link"
            >
              {translate('settingsView.t502')}
            </a>
          }
        />
        <SettingsRow
          title={translate('settingsView.t358')}
          desc={translate('settingsView.t359')}
          right={
            <a
              href="https://github.com/issues"
              target="_blank"
              rel="noreferrer"
              className="about-link"
            >
              {translate('settingsView.t503')}
            </a>
          }
        />
      </div>

      <div className="about-footer">© 2026 SparkWork Team. All rights reserved.</div>
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
