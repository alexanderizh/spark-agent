/**
 * SettingsView — 多分类设置（通用/外观/快捷键/模型/规则/权限/MCP/Skills/工作流/遥测/存储/更新）
 *
 * 包含：左侧分组导航 + 右侧多 section 内容。Profile 编辑使用 Modal。
 * 注意：Provider 配置 UI 已抽到 ProvidersView.tsx（侧边栏一级菜单）。
 */
import React, { useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { Icons } from '../Icons'
import { SparkInput, SparkSelect, SparkTextarea } from '../components/FormControls'
import { AvatarPicker } from '../components/AvatarPicker'
import { createDefaultAvatar, getUserAvatarConfig, type SparkAvatarConfig } from '../avatar'
import { useApp, PRIMARIES } from '../AppContext'
import { useIpcInvoke } from '../hooks/useIpc'
import { useToast } from '../components/Toast'
import { parseSkillManifest } from '../utils/skills-data'
import { ModelCapabilityRegistry } from '@spark/shared'
import { PlaywrightStatusCard } from './PlaywrightStatusCard'
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
  SkillItem,
  UpdateStatus,
  SdkIntegrityItem,
  RuntimeToolStatus,
  SessionListResponse,
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

function deferEffect(task: () => void | Promise<void>): () => void {
  const id = window.setTimeout(() => {
    void task()
  }, 0)
  return () => window.clearTimeout(id)
}

/* ─── Settings persistence keys ─── */
const SETTINGS_GENERAL_KEY = 'spark-settings-general'
const SETTINGS_APPEARANCE_KEY = 'spark-settings-appearance'
const SETTINGS_TELEMETRY_KEY = 'spark-settings-telemetry'
const SETTINGS_UPDATES_KEY = 'spark-settings-updates'

/* ─── Category mapping (localStorage key → IPC category) ─── */
function localStorageKeyToCategory(key: string): string {
  return key.replace('spark-settings-', '')
}

type GeneralSettings = {
  userAvatar?: SparkAvatarConfig
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
  sessionLayout: string
  windowCorners: string
  backdropBlur: boolean
  animation: string
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
  userAvatar: createDefaultAvatar('User'),
  language: 'zh-CN',
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
  fontSize: 13,
  codeLigature: false,
  sessionLayout: 'vibe',
  windowCorners: 'soft',
  backdropBlur: false,
  animation: 'full',
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
  autoDownload: true,
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
        { id: 'system-prompt', icon: <Icons.Chat />, label: '系统提示词' },
        { id: 'skills-settings', icon: <Icons.Skills />, label: 'Skills' },
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
    'system-prompt': SystemPromptSection,
    'skills-settings': SkillsSection,
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
        {SectionBody != null ? <SectionBody /> : <PlaceholderSection name={section} />}
      </div>
    </div>
  )
}

/* ───────── GENERAL ───────── */
function GeneralSection() {
  const [s, set] = usePersistedSettings(SETTINGS_GENERAL_KEY, DEFAULT_GENERAL)
  const { invoke: openDirectory } = useIpcInvoke('dialog:open-directory')
  const userAvatar = getUserAvatarConfig(s.userAvatar)

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

  return (
    <div className="settings-section">
      <h2>通用</h2>
      <div className="lede">应用启动、语言、默认行为。</div>

      <div className="form-grid">
        <label>
          用户头像<span className="sub">显示在会话区的用户消息旁</span>
        </label>
        <AvatarPicker
          value={userAvatar}
          defaultSeed="spark-user"
          title="我的头像"
          description="默认使用 Dicebear，也可以上传并裁剪本地图片。"
          onChange={(avatar) => set({ userAvatar: avatar })}
        />

        <label>
          语言<span className="sub">界面文案语言</span>
        </label>
        <SparkSelect value={s.language} onChange={(e) => set({ language: e.target.value })}>
          <option value="zh-CN">简体中文</option>
          <option value="en-US">English (US)</option>
          <option value="ja-JP">日本語</option>
        </SparkSelect>

        <label>
          启动行为<span className="sub">应用启动时的默认动作</span>
        </label>
        <SparkSelect
          value={s.startupBehavior}
          onChange={(e) => set({ startupBehavior: e.target.value })}
        >
          <option value="last">恢复上次会话</option>
          <option value="home">打开 Home</option>
          <option value="last-project">打开上次项目</option>
          <option value="blank">空白会话</option>
        </SparkSelect>

        <label>
          默认工作区<span className="sub">新建项目会话时的预选根目录</span>
        </label>
        <div className="control">
          <SparkInput
            className="flex1"
            value={s.defaultWorkspace || ''}
            onChange={(e) => set({ defaultWorkspace: e.target.value })}
            placeholder="点击浏览选择…"
          />
          <button className="btn" onClick={() => void handleBrowseWorkspace()}>
            <Icons.Folder size={12} /> 浏览…
          </button>
        </div>

        <label>
          系统托盘<span className="sub">关闭主窗口后保留后台运行</span>
        </label>
        <div
          className={`switch ${s.systemTray ? 'on' : ''}`}
          onClick={() => set({ systemTray: !s.systemTray })}
        />

        <label>开机自启动</label>
        <div
          className={`switch ${s.autoStart ? 'on' : ''}`}
          onClick={() => set({ autoStart: !s.autoStart })}
        />

        <label>新会话默认沙箱</label>
        <div className="seg-control">
          {(
            [
              ['L0 仅聊天', 0],
              ['L1 只读', 1],
              ['L2 受控', 2],
              ['L3 完全', 3],
            ] as [string, number][]
          ).map(([label, level]) => (
            <button
              key={level}
              className={s.defaultSandbox === level ? 'active' : ''}
              onClick={() => set({ defaultSandbox: level })}
            >
              {label}
            </button>
          ))}
        </div>

        <label>
          未保存修改提示<span className="sub">关闭会话或退出前提示</span>
        </label>
        <div
          className={`switch ${s.unsavedPrompt ? 'on' : ''}`}
          onClick={() => set({ unsavedPrompt: !s.unsavedPrompt })}
        />

        <label>
          检查点保留<span className="sub">每个会话保留多少历史检查点</span>
        </label>
        <div className="control">
          <SparkInput
            type="number"
            value={s.checkpointRetention}
            onChange={(e) => set({ checkpointRetention: Number(e.target.value) || 50 })}
            className="input-w-sm"
          />
          <span className="muted text-xs-12">个 · 超出后按时间淘汰</span>
        </div>
      </div>

      <div className="subsec-h">通知</div>
      <div className="settings-card">
        <SettingsRow
          title="任务完成"
          desc="长任务（≥30s）结束后系统通知"
          right={
            <div
              className={`switch ${s.notifyTaskComplete ? 'on' : ''}`}
              onClick={() => set({ notifyTaskComplete: !s.notifyTaskComplete })}
            />
          }
        />
        <SettingsRow
          title="权限请求"
          desc="需要审批时弹出系统通知"
          right={
            <div
              className={`switch ${s.notifyPermission ? 'on' : ''}`}
              onClick={() => set({ notifyPermission: !s.notifyPermission })}
            />
          }
        />
        <SettingsRow
          title="工作流失败"
          desc="任意节点失败时通知"
          right={
            <div
              className={`switch ${s.notifyWorkflowFail ? 'on' : ''}`}
              onClick={() => set({ notifyWorkflowFail: !s.notifyWorkflowFail })}
            />
          }
        />
        <SettingsRow
          title="MCP 离线"
          desc="服务器连接断开时通知"
          right={
            <div
              className={`switch ${s.notifyMcpOffline ? 'on' : ''}`}
              onClick={() => set({ notifyMcpOffline: !s.notifyMcpOffline })}
            />
          }
        />
        <SettingsRow
          title="新版本可用"
          right={
            <div
              className={`switch ${s.notifyNewVersion ? 'on' : ''}`}
              onClick={() => set({ notifyNewVersion: !s.notifyNewVersion })}
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
            <div
              className={`switch ${s.anonymousTelemetry ? 'on' : ''}`}
              onClick={() => set({ anonymousTelemetry: !s.anonymousTelemetry })}
            />
          }
        />
        <SettingsRow
          title="自动诊断包"
          desc="崩溃时自动收集脱敏诊断包（不含密钥与代码）"
          right={
            <div
              className={`switch ${s.autoDiagPackage ? 'on' : ''}`}
              onClick={() => set({ autoDiagPackage: !s.autoDiagPackage })}
            />
          }
        />
      </div>
    </div>
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
          active={false}
          onClick={() => setTweak('theme', 'light')}
          disabled
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
        <div className="seg-control">
          <button
            className={t.density === 'compact' ? 'active' : ''}
            onClick={() => setTweak('density', 'compact')}
          >
            紧凑
          </button>
          <button
            className={t.density === 'regular' ? 'active' : ''}
            onClick={() => setTweak('density', 'regular')}
          >
            常规
          </button>
          <button
            className={t.density === 'comfy' ? 'active' : ''}
            onClick={() => setTweak('density', 'comfy')}
          >
            宽松
          </button>
        </div>

        <label>
          侧边栏<span className="sub">默认展开还是仅图标</span>
        </label>
        <div className="seg-control">
          <button
            className={t.sidebar === 'collapsed' ? 'active' : ''}
            onClick={() => setTweak('sidebar', 'collapsed')}
          >
            图标
          </button>
          <button
            className={t.sidebar === 'expanded' ? 'active' : ''}
            onClick={() => setTweak('sidebar', 'expanded')}
          >
            展开
          </button>
        </div>

        <label>字体</label>
        <SparkSelect value={a.font} onChange={(e) => setA({ font: e.target.value })}>
          <option value="geist">Geist Sans + Geist Mono（推荐）</option>
          <option value="system">系统默认</option>
          <option value="ibm-plex">IBM Plex</option>
          <option value="jetbrains">JetBrains</option>
        </SparkSelect>

        <label>
          字号<span className="sub">基础字号，其他字号按比例缩放</span>
        </label>
        <div className="control">
          <SparkInput
            type="range"
            min="11"
            max="16"
            value={a.fontSize}
            onChange={(e) => setA({ fontSize: Number(e.target.value) })}
            className="flex1"
          />
          <span className="mono-sm muted range-value">{a.fontSize}px</span>
        </div>

        <label>
          代码字体连字<span className="sub">Geist Mono ligature 例如 =&gt; → ⇒</span>
        </label>
        <div
          className={`switch ${a.codeLigature ? 'on' : ''}`}
          onClick={() => setA({ codeLigature: !a.codeLigature })}
        />

        <label>会话默认布局</label>
        <div className="seg-control">
          {(
            [
              ['Vibe（聊天）', 'vibe'],
              ['Workspace（编辑器）', 'workspace'],
            ] as [string, string][]
          ).map(([label, mode]) => (
            <button
              key={mode}
              className={a.sessionLayout === mode ? 'active' : ''}
              onClick={() => setA({ sessionLayout: mode })}
            >
              {label}
            </button>
          ))}
        </div>

        <label>窗口圆角</label>
        <div className="seg-control">
          {(
            [
              ['直角', 'sharp'],
              ['柔和', 'soft'],
              ['圆润', 'round'],
            ] as [string, string][]
          ).map(([label, mode]) => (
            <button
              key={mode}
              className={a.windowCorners === mode ? 'active' : ''}
              onClick={() => setA({ windowCorners: mode })}
            >
              {label}
            </button>
          ))}
        </div>

        <label>
          背景毛玻璃<span className="sub">macOS 半透明背景（性能略低）</span>
        </label>
        <div
          className={`switch ${a.backdropBlur ? 'on' : ''}`}
          onClick={() => setA({ backdropBlur: !a.backdropBlur })}
        />

        <label>动画</label>
        <div className="seg-control">
          {(
            [
              ['禁用', 'none'],
              ['仅过渡', 'transitions'],
              ['完整', 'full'],
            ] as [string, string][]
          ).map(([label, mode]) => (
            <button
              key={mode}
              className={a.animation === mode ? 'active' : ''}
              onClick={() => setA({ animation: mode })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="subsec-h">聊天显示</div>
      <div className="settings-card">
        <SettingsRow
          title="自动折叠工具调用"
          desc="超过 200 行的工具结果默认折叠"
          right={
            <div
              className={`switch ${a.autoCollapseTools ? 'on' : ''}`}
              onClick={() => setA({ autoCollapseTools: !a.autoCollapseTools })}
            />
          }
        />
        <SettingsRow
          title="行内显示 token 计数"
          right={
            <div
              className={`switch ${a.inlineTokenCount ? 'on' : ''}`}
              onClick={() => setA({ inlineTokenCount: !a.inlineTokenCount })}
            />
          }
        />
        <SettingsRow
          title="语法高亮代码块"
          right={
            <div
              className={`switch ${a.syntaxHighlight ? 'on' : ''}`}
              onClick={() => setA({ syntaxHighlight: !a.syntaxHighlight })}
            />
          }
        />
        <SettingsRow
          title="时间戳格式"
          right={
            <div className="select-sm">
              <SparkSelect
                value={a.timestampFormat}
                onChange={(e) => setA({ timestampFormat: e.target.value })}
              >
                <option value="rel">相对时间</option>
                <option value="abs">绝对时间</option>
              </SparkSelect>
            </div>
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
          <SparkInput placeholder="搜索动作或按键..." />
        </div>
        <button className="btn">
          <Icons.Refresh size={12} /> 重置全部
        </button>
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
            <SparkInput defaultValue="Sonnet 4.5 · 默认" />

            <label>模型 ID</label>
            <SparkInput className="mono-sm" defaultValue="claude-sonnet-4-5-20250929" />

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
              <SparkInput
                type="range"
                min="0"
                max="2"
                step="0.1"
                defaultValue="0.7"
                className="flex1"
              />
              <span className="mono-sm muted range-value">0.7</span>
            </div>

            <label>最大输入 token</label>
            <SparkInput type="number" defaultValue="180000" />

            <label>最大输出 token</label>
            <SparkInput type="number" defaultValue="8192" />

            <label>
              推理强度<span className="sub">extended thinking 时使用</span>
            </label>
            <div className="seg-control">
              <button>none</button>
              <button>minimal</button>
              <button>low</button>
              <button className="active">medium</button>
              <button>high</button>
            </div>

            <label>单次运行成本上限</label>
            <div className="control">
              <span className="muted">$</span>
              <SparkInput type="number" defaultValue="5.00" step="0.50" className="flex1" />
              <span className="muted text-xs-12">USD · 超出后切换到 fallback</span>
            </div>

            <label>超时</label>
            <div className="control">
              <SparkInput type="number" defaultValue="120" className="flex1" />
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
              <button className="btn ghost sm add-fallback-btn">
                <Icons.Plus size={11} /> 添加 fallback
              </button>
            </div>

            <label>启用</label>
            <div className="switch on" />
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn danger sm">删除 Profile</button>
          <div className="flex1" />
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={onClose}>
            <Icons.Check size={12} /> 保存
          </button>
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
              <button
                className="btn ghost sm"
                onClick={() => {
                  setAddingForProvider(provider.id)
                  setNewModelName('')
                }}
              >
                <Icons.Plus size={11} /> 添加
              </button>
            </div>

            {addingForProvider === provider.id && (
              <div className="row row-gap-sm mb-sm">
                <SparkInput
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
                <button className="btn primary sm" onClick={() => void handleAdd(provider.id)}>
                  确认
                </button>
                <button className="btn ghost sm" onClick={() => setAddingForProvider(null)}>
                  取消
                </button>
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
                  <div
                    className={`switch${m.enabled ? ' on' : ''} switch-cursor`}
                    onClick={() => void handleToggle(m)}
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
          <button className="btn sm primary" onClick={refresh}>
            <Icons.Refresh size={11} /> 刷新
          </button>
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
            <div
              className={`switch rule-switch-sm ${rule.enabled ? 'on' : ''}`}
              onClick={() => onToggle(rule.id, !rule.enabled)}
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
            <SparkInput
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：代码风格"
            />

            <label>
              优先级<span className="sub">数字越大越优先</span>
            </label>
            <SparkInput
              type="number"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
            />

            <label>内容</label>
            <SparkTextarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="输入要注入到 Agent prompt 的规则内容"
              className="rule-textarea"
            />
          </div>
        </div>

        <div className="slide-panel-foot">
          <span className="flex1" />
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={handleSave} disabled={saving}>
            <Icons.Check size={12} /> {saving ? '保存中…' : '保存'}
          </button>
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
        <button
          className="btn primary"
          onClick={openAddForm}
          style={{ marginLeft: 10 }} /* dynamic */
        >
          <Icons.Plus size={12} /> 添加
        </button>
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
                      <button
                        className="btn ghost sm"
                        onClick={() => void handleStop(server.id)}
                        title="停止"
                      >
                        <Icons.Stop size={11} /> 停止
                      </button>
                    ) : (
                      <button
                        className="btn ghost sm"
                        onClick={() => void handleStart(server.id)}
                        title="启动"
                      >
                        <Icons.Play size={11} /> 启动
                      </button>
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
                <SparkInput
                  value={draft.name}
                  onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="例：filesystem"
                />

                <label>
                  作用域<span className="sub">配置生效范围</span>
                </label>
                <SparkSelect
                  value={draft.scope}
                  onChange={(e) => setDraft((prev) => ({ ...prev, scope: e.target.value }))}
                  disabled={!!editingId}
                >
                  <option value="user">user</option>
                  <option value="team">team</option>
                  <option value="project">project</option>
                  <option value="session">session</option>
                </SparkSelect>

                <label>
                  传输类型<span className="sub">与 MCP 服务器的通信方式</span>
                </label>
                <SparkSelect
                  value={draft.type}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      type: (e.target.value === 'sse' ? 'sse' : 'stdio') as McpTransportType,
                    }))
                  }
                  disabled={!!editingId}
                >
                  <option value="stdio">Stdio（本地进程）</option>
                  <option value="sse">SSE（HTTP 流）</option>
                </SparkSelect>
              </div>

              {draft.type === 'stdio' ? (
                <>
                  <div className="subsec-h mt-lg">Stdio 配置</div>
                  <div className="form-grid">
                    <label>
                      启动命令<span className="sub">可执行文件路径</span>
                    </label>
                    <SparkInput
                      className="mono-sm"
                      value={draft.command}
                      onChange={(e) => setDraft((prev) => ({ ...prev, command: e.target.value }))}
                      placeholder="npx"
                    />

                    <label>
                      参数<span className="sub">空格分隔的命令行参数</span>
                    </label>
                    <SparkInput
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
                    <SparkInput
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
                <button className="btn ghost sm mcp-env-add-btn" onClick={addEnvPair}>
                  <Icons.Plus size={11} /> 添加
                </button>
              </div>
              {draft.envPairs.length === 0 ? (
                <div className="mcp-env-empty">未配置环境变量</div>
              ) : (
                <div className="mcp-env-list">
                  {draft.envPairs.map((pair, idx) => (
                    <div key={idx} className="mcp-env-row">
                      <SparkInput
                        className="mcp-env-key mono-sm"
                        value={pair.key}
                        onChange={(e) => updateEnvPair(idx, 'key', e.target.value)}
                        placeholder="KEY"
                      />
                      <span className="mcp-env-eq">=</span>
                      <SparkInput
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
              <button className="btn" onClick={closeForm}>
                取消
              </button>
              <button
                className="btn primary"
                onClick={() => void handleFormSave()}
                disabled={formSaving}
              >
                <Icons.Check size={12} /> {formSaving ? '保存中...' : '保存'}
              </button>
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
              <button className="btn" onClick={() => setDeleteConfirmId(null)}>
                取消
              </button>
              <button
                className="btn danger"
                onClick={() => void handleDelete(deleteConfirmId)}
                disabled={actionLoading[deleteConfirmId] ?? false}
              >
                {actionLoading[deleteConfirmId] ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
// MCP 设置 section 结束 - 保留代码以便后续启用

/* ───────── SYSTEM PROMPT ───────── */

type PromptLayerMeta = {
  scope: string
  label: string
  badge: string
  badgeColor: string
  desc: string
}

const PROMPT_LAYERS: PromptLayerMeta[] = [
  {
    scope: 'system',
    label: 'System',
    badge: 'SYS',
    badgeColor: '#94a3b8',
    desc: '全局基础 · 所有 Agent 共享',
  },
  {
    scope: 'agent',
    label: 'Agent',
    badge: 'AGENT',
    badgeColor: '#8b5cf6',
    desc: '单 Agent 定制 · 多 Agent 配置中设置',
  },
  {
    scope: 'project',
    label: 'Project',
    badge: 'PROJ',
    badgeColor: '#f97316',
    desc: '.spark/prompt.md · 当前工作区',
  },
  {
    scope: 'session',
    label: 'Session',
    badge: 'SESS',
    badgeColor: '#f43f5e',
    desc: '本次会话临时覆盖',
  },
]

type PromptTemplate = {
  id: string
  name: string
  desc: string
  content: string
}

const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'general-coder',
    name: '通用编程助手',
    desc: '适合日常编码、调试、代码审查',
    content:
      '你是一个专业的编程助手。请遵循以下原则：\n1. 优先使用项目中已有的模式和风格\n2. 修改代码时保持最小变更原则\n3. 每次修改后说明原因和影响范围\n4. 如果有多种方案，简要对比后给出推荐',
  },
  {
    id: 'strict-reviewer',
    name: '严格代码审查',
    desc: '关注安全、性能和可维护性',
    content:
      '你是一个严格的代码审查员。在审查代码时请重点关注：\n1. 安全漏洞：SQL 注入、XSS、敏感信息泄露\n2. 性能问题：N+1 查询、不必要的重渲染、内存泄漏\n3. 可维护性：命名规范、函数复杂度、模块耦合\n4. 错误处理：边界条件、异常捕获、降级策略\n给出问题时请同时提供修复建议和示例代码。',
  },
  {
    id: 'architect',
    name: '架构设计',
    desc: '系统设计、技术选型、模块划分',
    content:
      '你是一个资深架构师。在进行架构设计时请遵循：\n1. 先理解业务场景和约束条件\n2. 提供多个方案并对比权衡\n3. 考虑可扩展性、可观测性、容错能力\n4. 给出清晰的模块划分和依赖关系\n5. 使用图表和代码示例辅助说明',
  },
  {
    id: 'concise',
    name: '简洁回复',
    desc: '减少冗余，直接给出答案',
    content:
      '请简洁回复：\n1. 直接给出答案或代码，不要重复问题\n2. 仅在必要时解释\n3. 代码注释只在非显而易见的地方添加',
  },
]

function SystemPromptSection() {
  const [systemPrompt, setSystemPrompt] = useState('')
  const [savedPrompt, setSavedPrompt] = useState('')
  const [systemPromptEnabled, setSystemPromptEnabled] = useState(true)
  const [savedEnabled, setSavedEnabled] = useState(true)
  const [savingPrompt, setSavingPrompt] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const [showLayers, setShowLayers] = useState(true)
  const { toast } = useToast()
  const { invoke: getPromptConfig } = useIpcInvoke('prompt-config:get')
  const { invoke: updatePromptConfig } = useIpcInvoke('prompt-config:update')

  const isDirty = systemPrompt !== savedPrompt || systemPromptEnabled !== savedEnabled

  useEffect(() => {
    getPromptConfig({})
      .then((res) => {
        setSystemPrompt(res.system.content)
        setSavedPrompt(res.system.content)
        setSystemPromptEnabled(res.system.enabled)
        setSavedEnabled(res.system.enabled)
      })
      .catch(() => {})
  }, [getPromptConfig])

  const saveSystemPrompt = async () => {
    setSavingPrompt(true)
    try {
      const res = await updatePromptConfig({
        scope: 'system',
        value: { enabled: systemPromptEnabled, content: systemPrompt },
      })
      setSystemPrompt(res.system.content)
      setSavedPrompt(res.system.content)
      setSystemPromptEnabled(res.system.enabled)
      setSavedEnabled(res.system.enabled)
      toast.success('系统提示词已保存')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存系统提示词失败')
    } finally {
      setSavingPrompt(false)
    }
  }

  const handleReset = () => {
    setSystemPrompt(savedPrompt)
    setSystemPromptEnabled(savedEnabled)
  }

  const handleApplyTemplate = (template: PromptTemplate) => {
    setSystemPrompt(template.content)
    setShowTemplates(false)
  }

  const charCount = systemPrompt.length
  const estimatedTokens = Math.ceil(charCount / 4)

  return (
    <div className="settings-section">
      <div className="row section-header-row">
        <div className="flex1">
          <h2 className="section-h2">系统提示词</h2>
          <div className="lede section-lede">
            配置全局系统提示词，按 System → Agent → Project → Session 逐级合并，后者覆盖前者。
          </div>
        </div>
        {isDirty && <span className="badge warning dot">未保存</span>}
      </div>

      {/* ── Prompt layers overview ── */}
      <div className="subsec-h">
        提示词层级
        <button
          className="btn ghost sm"
          onClick={() => setShowLayers((prev) => !prev)}
          style={{ marginLeft: 8 }}
        >
          <Icons.ChevronDown size={12} className={showLayers ? 'spin-180' : ''} />
          {showLayers ? '收起' : '展开'}
        </button>
      </div>
      {showLayers && (
        <div className="prompt-layers">
          {PROMPT_LAYERS.map((layer) => (
            <div
              key={layer.scope}
              className={`prompt-layer ${layer.scope === 'system' ? 'active' : ''}`}
            >
              <div className="prompt-layer-left">
                <span
                  className="badge rule-badge rule-badge-dynamic"
                  style={{ background: layer.badgeColor + '20', color: layer.badgeColor }}
                >
                  {layer.badge}
                </span>
                <div className="prompt-layer-info">
                  <span className="prompt-layer-name">{layer.label}</span>
                  <span className="prompt-layer-desc">{layer.desc}</span>
                </div>
              </div>
              <div className="prompt-layer-right">
                {layer.scope === 'system' && <span className="badge success">编辑中</span>}
                {layer.scope === 'agent' && <span className="muted text-xs-12">多 Agent 配置</span>}
                {layer.scope === 'project' && (
                  <span className="muted text-xs-12">.spark/prompt.md</span>
                )}
                {layer.scope === 'session' && <span className="muted text-xs-12">会话内覆盖</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Editor card ── */}
      <div className="subsec-h">
        系统级提示词
        <button
          className="btn ghost sm"
          onClick={() => setShowTemplates((prev) => !prev)}
          style={{ marginLeft: 8 }}
        >
          <Icons.Layers size={11} /> 模板
        </button>
      </div>

      {showTemplates && (
        <div className="prompt-templates">
          <div className="prompt-templates-hint">选择一个模板快速填充，选择后仍可自由编辑。</div>
          <div className="prompt-templates-grid">
            {PROMPT_TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                className="prompt-template-card"
                onClick={() => handleApplyTemplate(tpl)}
              >
                <div className="prompt-template-name">{tpl.name}</div>
                <div className="prompt-template-desc">{tpl.desc}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card prompt-editor-card">
        <div className="settings-row prompt-editor-header">
          <div>
            <div className="settings-row-title">全局系统提示词</div>
            <div className="settings-row-desc">
              全局生效，作为所有 Agent 的基础提示词注入。支持中文和英文混合。
            </div>
          </div>
          <div
            className={`switch ${systemPromptEnabled ? 'on' : ''}`}
            onClick={() => setSystemPromptEnabled((prev) => !prev)}
          />
        </div>

        <div className={`prompt-editor-body ${!systemPromptEnabled ? 'disabled' : ''}`}>
          <SparkTextarea
            className="prompt-textarea"
            value={systemPrompt}
            onChange={(event) => setSystemPrompt(event.target.value)}
            placeholder="输入全局系统提示词...&#10;&#10;例如：你是一个专业的编程助手，请用中文回复。"
            disabled={!systemPromptEnabled}
            rows={12}
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
                <button className="btn ghost sm" onClick={handleReset}>
                  撤销修改
                </button>
              )}
              <button
                className="btn primary sm"
                onClick={() => void saveSystemPrompt()}
                disabled={savingPrompt || !isDirty}
              >
                <Icons.Check size={12} /> {savingPrompt ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      </div>

    </div>
  )
}

/* ───────── SKILLS ───────── */
function SkillsSection() {
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [error, setError] = useState('')
  const { invoke: listSkills, loading } = useIpcInvoke('skill:list')
  const { invoke: updateSkill } = useIpcInvoke('skill:update')

  const refresh = useCallback(() => {
    setError('')
    listSkills({})
      .then((res) => setSkills(res.skills))
      .catch((err) => setError(err instanceof Error ? err.message : '加载 Skills 失败'))
  }, [listSkills])

  useEffect(() => {
    return deferEffect(refresh)
  }, [refresh])

  const toggleSkill = async (skill: SkillItem) => {
    await updateSkill({ id: skill.id, enabled: !skill.enabled })
    refresh()
  }

  return (
    <div className="settings-section">
      <h2>Skills</h2>
      <div className="lede">
        管理系统级可见 Skill。系统隐藏的 Skill 不会进入任何 Agent 的可见列表。
      </div>

      {error && <div className="alert-banner">{error}</div>}

      <div className="card">
        {loading ? (
          <div className="loading-card">正在加载 Skills...</div>
        ) : (
          skills.map((skill) => {
            const meta = parseSkillManifest(skill.manifestJson)
            return (
              <SettingsRow
                key={skill.id}
                title={skill.name}
                desc={`${meta.desc} · ${meta.source} · ${skill.version}`}
                right={
                  <div className="row row-gap-xs">
                    {skill.id === 'builtin:superpowers' && <span className="badge">内置</span>}
                    <span className={`badge ${skill.enabled ? 'success' : ''}`}>
                      {skill.enabled ? '系统可见' : '系统隐藏'}
                    </span>
                    <div
                      className={`switch ${skill.enabled ? 'on' : ''}`}
                      onClick={() => void toggleSkill(skill)}
                    />
                  </div>
                }
              />
            )
          })
        )}
      </div>

      <div className="skills-hint">
        已安装不代表会被强制使用；Agent 会从系统/项目/会话合并后的可见列表中自行判断是否应用。
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
        <button className="btn ghost sm" onClick={restoreDefaults}>
          <Icons.Refresh size={11} /> 恢复内置
        </button>
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
              <SparkSelect
                value={runtimeAdapter}
                onChange={(e) => handleRuntimeAdapterChange(e.target.value as SessionAgentAdapter)}
              >
                <option value="claude-sdk">Claude SDK</option>
              </SparkSelect>
            </div>
          }
        />
        <div className="runtime-permission-grid">
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
                  <SparkInput
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
          right={<div className={`switch ${auditEnabled ? 'on' : ''}`} onClick={toggleAudit} />}
        />
        <SettingsRow
          title="导出团队审计报告"
          desc="按周生成可签发的 JSON 报告"
          right={<div className="switch" />}
        />
        <SettingsRow
          title="审计日志保留"
          right={
            <div className="select-sm">
              <SparkSelect defaultValue="90">
                <option value="30">30 天</option>
                <option value="90">90 天</option>
                <option value="365">1 年</option>
                <option value="forever">永久</option>
              </SparkSelect>
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
        <SparkSelect defaultValue={scope}>
          <option>工作区内</option>
          <option>本会话</option>
          <option>本项目</option>
          <option>任意</option>
          <option>profile 内</option>
          <option>按 server</option>
          <option>域名白名单</option>
        </SparkSelect>
      </div>
      <div className="select-full">
        <SparkSelect
          value={mode}
          onChange={(e) => onModeChange?.(e.target.value as PermissionMode)}
        >
          <option value="allow">允许</option>
          <option value="ask">询问</option>
          <option value="ask-twice">双重确认</option>
          <option value="deny">拒绝</option>
        </SparkSelect>
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
        <SparkSelect value={s.logLevel} onChange={(e) => set({ logLevel: e.target.value })}>
          <option value="error">error</option>
          <option value="warn">warn</option>
          <option value="info">info</option>
          <option value="debug">debug</option>
          <option value="trace">trace</option>
        </SparkSelect>

        <label>
          OpenTelemetry endpoint<span className="sub">可选 — 把 trace 转发到 collector</span>
        </label>
        <SparkInput
          value={s.otlpEndpoint}
          onChange={(e) => set({ otlpEndpoint: e.target.value })}
          placeholder="https://otlp.example.com:4318 (可选)"
        />

        <label>Trace 采样率</label>
        <div className="control">
          <SparkInput
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
        <SparkInput
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
            <button className="btn ghost sm">
              <Icons.Eye size={11} /> 查看 trace
            </button>
          }
        />
        <SettingsRow
          title="重构 auth 模块为 OAuth 2.1"
          desc="Run #41b8 · 1 agent · 6m 12s · $1.34"
          right={
            <button className="btn ghost sm">
              <Icons.Eye size={11} /> 查看 trace
            </button>
          }
        />
        <SettingsRow
          title="MCP gateway 性能调优"
          desc="Run #38c0 · 1 agent · 失败"
          right={
            <button className="btn ghost sm danger-btn">
              <Icons.Eye size={11} /> 查看错误
            </button>
          }
        />
      </div>

      <div className="subsec-h">诊断包</div>
      <div className="card">
        <SettingsRow
          title="生成诊断包"
          desc="包含 app/OS 版本、provider 健康、近期错误日志，自动脱敏"
          right={
            <button className="btn">
              <Icons.Download size={11} /> 生成
            </button>
          }
        />
        <SettingsRow
          title="复制最近一次错误"
          desc="便于发到 GitHub Issue"
          right={
            <button className="btn ghost sm">
              <Icons.Copy size={11} /> 复制
            </button>
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
            <button className="btn ghost sm" onClick={loadDashboard} disabled={loading}>
              <Icons.Refresh size={11} /> 刷新
            </button>
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
    databasePath: string
    databaseBytes: number
    cacheBytes: number
    projectsBytes: number
    totalBytes: number
  } | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [clearing, setClearing] = useState(false)
  const { toast } = useToast()
  const { requestConfirm } = useApp()
  const { invoke: getCurrentWorkspace } = useIpcInvoke('workspace:get-current')
  const { invoke: openWorkspace } = useIpcInvoke('workspace:open')
  const { invoke: closeWorkspace } = useIpcInvoke('workspace:close')
  const { invoke: openDirectory } = useIpcInvoke('dialog:open-directory')
  const { invoke: getStorageStats } = useIpcInvoke('app:get-storage-stats')
  const { invoke: clearCache } = useIpcInvoke('app:clear-cache')
  const { invoke: openDataDir } = useIpcInvoke('app:open-data-dir')

  const refreshWorkspace = useCallback(async () => {
    const res = await getCurrentWorkspace({})
    setWorkspace(res.workspace)
  }, [getCurrentWorkspace])

  const refreshStats = useCallback(async () => {
    setStatsLoading(true)
    try {
      const res = await getStorageStats({})
      setStats(res)
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
    })
  }, [refreshWorkspace, refreshStats])

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
          <SparkInput
            className="flex1"
            value={stats?.userDataPath ?? '加载中...'}
            readOnly
          />
          <button className="btn" onClick={handleOpenDataDir}>
            <Icons.Folder size={12} /> 打开
          </button>
        </div>

        <label>
          当前工作区<span className="sub">Agent 文件工具的根目录</span>
        </label>
        <div className="control">
          <SparkInput className="flex1" value={workspace?.rootPath ?? '未打开工作区'} readOnly />
          <button className="btn" onClick={handleOpenWorkspace}>
            <Icons.Folder size={12} /> 选择
          </button>
          <button
            className="btn ghost"
            onClick={handleCloseWorkspace}
            disabled={workspace === null}
          >
            关闭
          </button>
        </div>
      </div>

      {error !== null && <div className="card storage-card">{error}</div>}

      <div className="subsec-h">
        存储用量
        <button
          className="btn ghost sm"
          onClick={() => void refreshStats()}
          disabled={statsLoading}
          style={{ marginLeft: 8 }}
        >
          {statsLoading ? '刷新中...' : '刷新'}
        </button>
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
          right={<div className="switch on" />}
        />
        <SettingsRow
          title="备份目录"
          desc="~/Backups/SparkAgent"
          right={
            <button className="btn sm">
              <Icons.Folder size={11} /> 修改
            </button>
          }
        />
        <SettingsRow
          title="最近一次备份"
          desc="今天 03:00 · 成功 · 41 MB"
          right={<button className="btn ghost sm">查看历史</button>}
        />
        <SettingsRow
          title="导出全部数据"
          desc="JSONL + 文件 · 可在另一台机器导入"
          right={
            <button className="btn">
              <Icons.Download size={11} /> 导出
            </button>
          }
        />
      </div>

      <div className="subsec-h">清理</div>
      <div className="card">
        <SettingsRow
          title="清空浏览器与渲染缓存"
          desc={`清理 Electron / Chromium 的 Cache、Code Cache、GPUCache 等${stats ? `（当前占用 ${formatBytes(stats.cacheBytes)}）` : ''}。下次启动会自动重建，不影响会话与设置。`}
          right={
            <button
              className="btn ghost sm danger-btn"
              onClick={() => void handleClearCache(false)}
              disabled={clearing}
            >
              {clearing ? '清理中...' : '清空'}
            </button>
          }
        />
        <SettingsRow
          title="清理孤儿项目目录"
          desc="删除 projects/ 下不再被任何项目引用的临时目录。同时清空浏览器缓存。"
          right={
            <button
              className="btn ghost sm danger-btn"
              onClick={() => void handleClearCache(true)}
              disabled={clearing}
            >
              {clearing ? '清理中...' : '清空'}
            </button>
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
                <button className="btn sm" onClick={() => handleRestoreWorkspace(w)}>
                  <Icons.Refresh size={11} /> 恢复
                </button>
                <button
                  className="btn ghost sm danger-btn"
                  onClick={() => handleDeleteWorkspace(w)}
                >
                  <Icons.Trash size={11} /> 删除
                </button>
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
                <button className="btn sm" onClick={() => handleRestoreSession(s)}>
                  <Icons.Refresh size={11} /> 恢复
                </button>
                <button className="btn ghost sm danger-btn" onClick={() => handleDeleteSession(s)}>
                  <Icons.Trash size={11} /> 删除
                </button>
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
          <button
            className="btn sm"
            onClick={() => void handleCheck(false)}
            disabled={isChecking || isCheckingLatest}
          >
            <Icons.Refresh size={12} className={isChecking ? 'spin' : ''} />
            {isChecking ? '检测中…' : '立即检测'}
          </button>
          <button
            className="btn sm"
            onClick={() => void handleCheck(true)}
            disabled={isChecking || isCheckingLatest}
          >
            <Icons.Globe size={12} className={isCheckingLatest ? 'spin' : ''} />
            {isCheckingLatest ? '检查中…' : '检查最新版本'}
          </button>
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
          <button
            className="btn ghost sm"
            onClick={() => setInstallResult(null)}
            style={{ marginLeft: 'auto', padding: '0 4px', height: 20 }}
          >
            <Icons.X size={12} />
          </button>
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
                <a
                  className="btn sm"
                  href={tool.downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Icons.ExternalLink size={12} /> 下载
                </a>
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
                  <button
                    className="btn sm primary"
                    onClick={() => void handleInstall(sdk.packageName)}
                    disabled={installingPkg === sdk.packageName}
                  >
                    {installingPkg === sdk.packageName ? (
                      <>
                        <Icons.Spinner size={12} /> 安装中…
                      </>
                    ) : sdk.installed ? (
                      <>
                        <Icons.Download size={12} /> 更新
                      </>
                    ) : (
                      <>
                        <Icons.Download size={12} /> 安装
                      </>
                    )}
                  </button>
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
  const [lastChecked, setLastChecked] = useState<string | null>(() =>
    window.localStorage.getItem('spark-updates-last-checked'),
  )

  // Load lastChecked from IPC on mount
  useEffect(() => {
    window.spark
      ?.invoke('settings:get', { category: 'updates', key: 'lastChecked' })
      .then((res) => {
        if (res.value != null && typeof res.value === 'string') {
          setLastChecked(res.value)
          window.localStorage.setItem('spark-updates-last-checked', res.value)
        }
      })
      .catch(() => {
        /* ignore */
      })

    // Get initial update status
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

  const handleCheckUpdate = async () => {
    try {
      await window.spark.invoke('update:check', {})
      const now = new Date().toLocaleString('zh-CN')
      setLastChecked(now)
      window.localStorage.setItem('spark-updates-last-checked', now)
      window.spark
        ?.invoke('settings:set', { category: 'updates', key: 'lastChecked', value: now })
        .catch(() => {
          /* ignore */
        })
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

  const handleSettingsChange = (key: keyof UpdatesSettings, value: boolean | string) => {
    set({ [key]: value })
    // Sync auto-download setting to main process
    if (key === 'autoDownload' && typeof value === 'boolean') {
      void window.spark.invoke('update:settings', { autoDownload: value })
    }
    if (key === 'channel' && typeof value === 'string') {
      void window.spark.invoke('update:settings', { channel: value as 'stable' | 'beta' })
    }
  }

  const state = status?.state ?? 'idle'
  const isChecking = state === 'checking'
  const isDownloading = state === 'downloading'
  const hasUpdate = state === 'available' || state === 'downloading' || state === 'downloaded'
  const isDownloaded = state === 'downloaded'
  const isError = state === 'error'
  const currentVersion = status?.currentVersion ?? '0.1.0'

  // Update card status icon and label
  const getStatusIcon = () => {
    if (isError) return <Icons.AlertTriangle size={26} />
    if (isDownloaded) return <Icons.Download size={26} />
    if (hasUpdate) return <Icons.Refresh size={26} className="spin" />
    return <Icons.CheckCircle size={26} />
  }

  const getStatusLabel = () => {
    if (isError) return `检查失败：${status?.error ?? '未知错误'}`
    if (isChecking) return '正在检查更新…'
    if (isDownloading)
      return `正在下载 ${status?.progress != null ? `(${Math.round(status.progress.percent)}%)` : ''}`
    if (isDownloaded) return `更新已就绪：v${status?.updateInfo?.version ?? '?'}`
    if (hasUpdate) return `发现新版本：v${status?.updateInfo?.version ?? '?'}`
    return `已是最新版本`
  }

  const getStatusClass = () => {
    if (isError) return 'error'
    if (isDownloaded) return 'downloaded'
    if (hasUpdate) return 'available'
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
            <button className="btn primary" onClick={handleInstall}>
              安装并重启
            </button>
          ) : hasUpdate && state === 'available' ? (
            <button className="btn primary" onClick={() => void handleDownload()}>
              <Icons.Download size={12} /> 下载更新
            </button>
          ) : (
            <button
              className="btn"
              onClick={() => void handleCheckUpdate()}
              disabled={isChecking || isDownloading}
            >
              <Icons.Refresh size={12} /> {isChecking ? '检查中…' : '检查更新'}
            </button>
          )}
        </div>
      </div>

      <div className="subsec-h">更新策略</div>
      <div className="card">
        <SettingsRow
          title="自动检查更新"
          right={
            <div
              className={`switch ${s.autoCheck ? 'on' : ''}`}
              onClick={() => handleSettingsChange('autoCheck', !s.autoCheck)}
            />
          }
        />
        <SettingsRow
          title="自动下载"
          desc="后台下载，准备好后提示安装"
          right={
            <div
              className={`switch ${s.autoDownload ? 'on' : ''}`}
              onClick={() => handleSettingsChange('autoDownload', !s.autoDownload)}
            />
          }
        />
        <SettingsRow
          title="自动安装"
          desc="退出应用时静默安装"
          right={
            <div
              className={`switch ${s.autoInstall ? 'on' : ''}`}
              onClick={() => handleSettingsChange('autoInstall', !s.autoInstall)}
            />
          }
        />
        <SettingsRow
          title="更新通道"
          right={
            <div className="select-sm">
              <SparkSelect
                value={s.channel}
                onChange={(e) => handleSettingsChange('channel', e.target.value)}
              >
                <option value="stable">stable</option>
                <option value="beta">beta</option>
              </SparkSelect>
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
  { value: 'claude-ask', label: 'Ask permissions', desc: '每次工具执行前确认' },
  {
    value: 'claude-auto-edits',
    label: 'Auto accept edits',
    desc: '自动接受编辑，命令仍确认',
    tone: 'auto',
  },
  { value: 'claude-plan', label: 'Plan mode', desc: '先产出计划，再批准执行' },
  { value: 'claude-auto', label: 'Auto', desc: '使用 Claude SDK 自动权限策略', tone: 'auto' },
  {
    value: 'claude-bypass',
    label: 'Bypass permissions',
    desc: '危险：完全听从 agent 执行',
    tone: 'danger',
  },
]

// Codex 权限选项已移除，项目仅支持 Claude SDK

function getRuntimePermissionModeOptions(
  adapter: SessionAgentAdapter,
): RuntimePermissionModeOption[] {
  // 仅支持 Claude SDK
  return CLAUDE_RUNTIME_PERMISSION_OPTIONS
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
    source.adapter === 'claude' || source.adapter === 'claude-sdk'
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

function SettingsRow({ title, desc, right }: { title: string; desc?: string; right: ReactNode }) {
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

const HOOK_NODE_ICONS: Record<HookNodeType, (p: { size?: number; className?: string }) => React.JSX.Element> = {
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
        <div
          className={`switch ${config.enabled ? 'on' : ''}`}
          onClick={() => setConfig({ ...config, enabled: !config.enabled })}
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
                      <div
                        className={`switch ${nodeConfig.notification ? 'on' : ''}`}
                        onClick={() => updateNodeConfig(node, 'notification', !nodeConfig.notification)}
                      />
                    </div>
                    <div className="hook-toggle-row">
                      <div className="hook-toggle-info">
                        <Icons.Activity size={13} className="hook-toggle-icon" />
                        <span className="hook-toggle-label">提示音</span>
                        <span className="hook-toggle-hint">系统默认提示音</span>
                      </div>
                      <div
                        className={`switch ${nodeConfig.sound ? 'on' : ''}`}
                        onClick={() => updateNodeConfig(node, 'sound', !nodeConfig.sound)}
                      />
                    </div>
                  </div>
                  <div className="hook-node-footer">
                    <button
                      className="btn ghost sm"
                      onClick={() => void testHook(node)}
                      disabled={testing === node}
                    >
                      {testing === node ? (
                        <>
                          <Icons.Spinner size={11} /> 测试中…
                        </>
                      ) : (
                        <>
                          <Icons.Play size={11} /> 测试
                        </>
                      )}
                    </button>
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
