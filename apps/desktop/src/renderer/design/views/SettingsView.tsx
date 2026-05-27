/**
 * SettingsView — 多分类设置（通用/外观/快捷键/Provider/模型/规则/权限/MCP/Skills/工作流/遥测/存储/更新）
 *
 * 包含：左侧分组导航 + 右侧多 section 内容。Provider 编辑使用滑入面板，Profile 编辑使用 Modal。
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react'
import type { ReactNode } from 'react'
import { Icons } from '../Icons'
import { SparkInput, SparkSelect } from '../components/FormControls'
import { useApp, PRIMARIES } from '../AppContext'
import { useIpcInvoke } from '../hooks/useIpc'
import { useToast } from '../components/Toast'
import { parseSkillManifest } from '../utils/skills-data'
import {
  PROVIDER_PRESETS,
  VENDOR_CATALOG,
  getProviderPresetById,
  getVendorMeta,
  getPresetsByVendor,
  getUniqueVendorIds,
} from '@spark/protocol'
import { ModelCapabilityRegistry } from '@spark/shared'
import type {
  ProviderPreset,
  VendorMeta,
  ProviderHealthCheckResponse,
  ProviderProfile,
  ProviderUpdateRequest,
  PermissionMode,
  PermissionProfileItem,
  RuleItem,
  RuleScope,
  WorkspaceInfo,
  ModelProfile,
  McpServerItem,
  SkillItem,
  UpdateStatus,
} from '@spark/protocol'

type ProviderKind = 'anthropic' | 'openai'
type CodexApiKind = 'chat' | 'responses'
type ProviderForm = {
  presetId: string
  name: string
  provider: ProviderKind
  defaultModel: string
  modelIdsText: string
  endpoint: string
  codexApiKind: CodexApiKind
  apiKey: string
  isDefault: boolean
}

type WorkflowTemplate = {
  id: string
  name: string
  desc: string
  nodes: number
  updatedAt: string
}

const PERM_PROFILE_KEY = 'spark-perm-profile'
const SANDBOX_LEVEL_KEY = 'spark-sandbox-level'
const AUDIT_ENABLED_KEY = 'spark-audit-enabled'
const WORKFLOW_TEMPLATES_KEY = 'spark-workflow-templates'

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

const DEFAULT_GENERAL: GeneralSettings = {
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
    window.spark?.invoke('settings:get', { category, key: 'data' })
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

  const update = useCallback((patch: Partial<T>) => {
    setState(prev => {
      const next = { ...prev, ...patch }
      writeStoredJson(key, next)
      // Persist to IPC/SQLite (fire-and-forget)
      window.spark?.invoke('settings:set', { category, key: 'data', value: next })
        .catch(() => { /* ignore IPC errors */ })
      return next
    })
  }, [key, category])
  return [state, update]
}

const DEFAULT_WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  { id: 'template:agent-dev', name: 'Agent 开发流程', desc: '需求分析、计划、编码、测试、审查', nodes: 6, updatedAt: '内置模板' },
  { id: 'template:research', name: '资料研究流程', desc: '检索、摘要、交叉验证、报告生成', nodes: 4, updatedAt: '内置模板' },
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
  const section = t.settingsSection || 'providers'
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
        { id: 'providers', icon: <Icons.Bot />, label: 'Provider' },
        { id: 'rules', icon: <Icons.Beaker />, label: '规则' },
        { id: 'permissions', icon: <Icons.Shield />, label: '权限策略' },
      ],
    },
    {
      group: '生态',
      items: [
        { id: 'mcp-settings', icon: <Icons.MCP />, label: 'MCP' },
        { id: 'system-prompt', icon: <Icons.Chat />, label: '系统提示词' },
        { id: 'skills-settings', icon: <Icons.Skills />, label: 'Skills' },
        { id: 'workflows', icon: <Icons.Workflow />, label: '工作流模板' },
      ],
    },
    {
      group: '系统',
      items: [
        { id: 'usage', icon: <Icons.Activity />, label: '用量统计' },
        { id: 'telemetry', icon: <Icons.Activity />, label: '遥测与日志' },
        { id: 'storage', icon: <Icons.Database />, label: '存储与备份' },
        { id: 'updates', icon: <Icons.Refresh />, label: '更新' },
        { id: 'about', icon: <Icons.Sparkles />, label: '关于' },
      ],
    },
  ]

  const Section: Record<string, () => React.ReactElement> = {
    general: GeneralSection,
    appearance: AppearanceSection,
    shortcuts: ShortcutsSection,
    providers: ProvidersSection,
    rules: RulesSection,
    permissions: PermissionsSection,
    'mcp-settings': McpSection,
    'system-prompt': SystemPromptSection,
    'skills-settings': SkillsSection,
    workflows: WorkflowTemplatesSection,
    telemetry: TelemetrySection,
    storage: StorageSection,
    usage: UsageSection,
    updates: UpdatesSection,
    about: AboutSection,
  }
  const Body = Section[section] || (() => <PlaceholderSection name={section} />)

  return (
    <div className="settings-layout">
      <div className="settings-nav scroll">
        {nav.map((g) => (
          <div key={g.group}>
            <div className="settings-nav-h">{g.group}</div>
            {g.items.map((it) => (
              <button key={it.id} className={`nav-item ${section === it.id ? 'active' : ''}`} onClick={() => setSection(it.id)}>
                <span className="nav-icon">{it.icon}</span>
                <span className="nav-label">{it.label}</span>
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="settings-content scroll">
        <Body />
      </div>
    </div>
  )
}

/* ───────── GENERAL ───────── */
function GeneralSection() {
  const [s, set] = usePersistedSettings(SETTINGS_GENERAL_KEY, DEFAULT_GENERAL)
  const { invoke: openDirectory } = useIpcInvoke('dialog:open-directory')

  const handleBrowseWorkspace = async () => {
    try {
      const selected = await openDirectory({ title: '选择默认工作区' })
      if (!selected.canceled && selected.filePath !== undefined) {
        set({ defaultWorkspace: selected.filePath })
      }
    } catch { /* user cancelled */ }
  }

  return (
    <div className="settings-section">
      <h2>通用</h2>
      <div className="lede">应用启动、语言、默认行为。</div>

      <div className="form-grid">
        <label>语言<span className="sub">界面文案语言</span></label>
        <SparkSelect value={s.language} onChange={(e) => set({ language: e.target.value })}>
          <option value="zh-CN">简体中文</option>
          <option value="en-US">English (US)</option>
          <option value="ja-JP">日本語</option>
        </SparkSelect>

        <label>启动行为<span className="sub">应用启动时的默认动作</span></label>
        <SparkSelect value={s.startupBehavior} onChange={(e) => set({ startupBehavior: e.target.value })}>
          <option value="last">恢复上次会话</option>
          <option value="home">打开 Home</option>
          <option value="last-project">打开上次项目</option>
          <option value="blank">空白会话</option>
        </SparkSelect>

        <label>默认工作区<span className="sub">新建项目会话时的预选根目录</span></label>
        <div className="control">
          <SparkInput className="flex1" value={s.defaultWorkspace || ''} onChange={(e) => set({ defaultWorkspace: e.target.value })} placeholder="点击浏览选择…" />
          <button className="btn" onClick={() => void handleBrowseWorkspace()}><Icons.Folder size={12} /> 浏览…</button>
        </div>

        <label>系统托盘<span className="sub">关闭主窗口后保留后台运行</span></label>
        <div className={`switch ${s.systemTray ? 'on' : ''}`} onClick={() => set({ systemTray: !s.systemTray })} />

        <label>开机自启动</label>
        <div className={`switch ${s.autoStart ? 'on' : ''}`} onClick={() => set({ autoStart: !s.autoStart })} />

        <label>新会话默认沙箱</label>
        <div className="seg-control">
          {([['L0 仅聊天', 0], ['L1 只读', 1], ['L2 受控', 2], ['L3 完全', 3]] as [string, number][]).map(([label, level]) => (
            <button key={level} className={s.defaultSandbox === level ? 'active' : ''} onClick={() => set({ defaultSandbox: level })}>{label}</button>
          ))}
        </div>

        <label>未保存修改提示<span className="sub">关闭会话或退出前提示</span></label>
        <div className={`switch ${s.unsavedPrompt ? 'on' : ''}`} onClick={() => set({ unsavedPrompt: !s.unsavedPrompt })} />

        <label>检查点保留<span className="sub">每个会话保留多少历史检查点</span></label>
        <div className="control">
          <SparkInput type="number" value={s.checkpointRetention} onChange={(e) => set({ checkpointRetention: Number(e.target.value) || 50 })} className="input-w-sm" />
          <span className="muted text-xs-12">个 · 超出后按时间淘汰</span>
        </div>
      </div>

      <div className="subsec-h">通知</div>
      <div className="settings-card">
        <SettingsRow title="任务完成" desc="长任务（≥30s）结束后系统通知" right={<div className={`switch ${s.notifyTaskComplete ? 'on' : ''}`} onClick={() => set({ notifyTaskComplete: !s.notifyTaskComplete })} />} />
        <SettingsRow title="权限请求" desc="需要审批时弹出系统通知" right={<div className={`switch ${s.notifyPermission ? 'on' : ''}`} onClick={() => set({ notifyPermission: !s.notifyPermission })} />} />
        <SettingsRow title="工作流失败" desc="任意节点失败时通知" right={<div className={`switch ${s.notifyWorkflowFail ? 'on' : ''}`} onClick={() => set({ notifyWorkflowFail: !s.notifyWorkflowFail })} />} />
        <SettingsRow title="MCP 离线" desc="服务器连接断开时通知" right={<div className={`switch ${s.notifyMcpOffline ? 'on' : ''}`} onClick={() => set({ notifyMcpOffline: !s.notifyMcpOffline })} />} />
        <SettingsRow title="新版本可用" right={<div className={`switch ${s.notifyNewVersion ? 'on' : ''}`} onClick={() => set({ notifyNewVersion: !s.notifyNewVersion })} />} />
      </div>

      <div className="subsec-h">隐私</div>
      <div className="settings-card">
        <SettingsRow title="匿名遥测" desc="发送匿名使用与崩溃数据，帮助改进 Spark Agent" right={<div className={`switch ${s.anonymousTelemetry ? 'on' : ''}`} onClick={() => set({ anonymousTelemetry: !s.anonymousTelemetry })} />} />
        <SettingsRow title="自动诊断包" desc="崩溃时自动收集脱敏诊断包（不含密钥与代码）" right={<div className={`switch ${s.autoDiagPackage ? 'on' : ''}`} onClick={() => set({ autoDiagPackage: !s.autoDiagPackage })} />} />
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
        <ThemePreview kind="light" active={t.theme === 'light'} onClick={() => setTweak('theme', 'light')} />
        <ThemePreview kind="dark" active={t.theme === 'dark'} onClick={() => setTweak('theme', 'dark')} />
        <ThemePreview kind="auto" active={false} onClick={() => setTweak('theme', 'light')} disabled />
      </div>

      <div className="subsec-h">主色</div>
      <div className="color-swatch-row">
        {Object.entries(PRIMARIES).map(([color, info]) => (
          <button
            key={color}
            onClick={() => setTweak('primary', color)}
            className="color-swatch"
          >
            <span
              className={`color-swatch-circle ${t.primary === color ? 'active' : ''}`}
              style={{ background: color, boxShadow: t.primary === color ? `0 0 0 2px var(--bg), 0 0 0 4px ${color}` : 'none' }} /* dynamic */
            >
              {t.primary === color && <Icons.Check size={16} />}
            </span>
            <span className={`color-swatch-label ${t.primary === color ? 'active' : ''}`}>{info.name}</span>
          </button>
        ))}
        <button className="color-add-btn">
          <Icons.Plus size={14} />
        </button>
      </div>

      <div className="subsec-h">布局与字体</div>
      <div className="form-grid">
        <label>密度<span className="sub">界面元素紧凑度</span></label>
        <div className="seg-control">
          <button className={t.density === 'compact' ? 'active' : ''} onClick={() => setTweak('density', 'compact')}>紧凑</button>
          <button className={t.density === 'regular' ? 'active' : ''} onClick={() => setTweak('density', 'regular')}>常规</button>
          <button className={t.density === 'comfy' ? 'active' : ''} onClick={() => setTweak('density', 'comfy')}>宽松</button>
        </div>

        <label>侧边栏<span className="sub">默认展开还是仅图标</span></label>
        <div className="seg-control">
          <button className={t.sidebar === 'collapsed' ? 'active' : ''} onClick={() => setTweak('sidebar', 'collapsed')}>图标</button>
          <button className={t.sidebar === 'expanded' ? 'active' : ''} onClick={() => setTweak('sidebar', 'expanded')}>展开</button>
        </div>

        <label>字体</label>
        <SparkSelect value={a.font} onChange={(e) => setA({ font: e.target.value })}>
          <option value="geist">Geist Sans + Geist Mono（推荐）</option>
          <option value="system">系统默认</option>
          <option value="ibm-plex">IBM Plex</option>
          <option value="jetbrains">JetBrains</option>
        </SparkSelect>

        <label>字号<span className="sub">基础字号，其他字号按比例缩放</span></label>
        <div className="control">
          <SparkInput type="range" min="11" max="16" value={a.fontSize} onChange={(e) => setA({ fontSize: Number(e.target.value) })} className="flex1" />
          <span className="mono-sm muted range-value">{a.fontSize}px</span>
        </div>

        <label>代码字体连字<span className="sub">Geist Mono ligature 例如 =&gt; → ⇒</span></label>
        <div className={`switch ${a.codeLigature ? 'on' : ''}`} onClick={() => setA({ codeLigature: !a.codeLigature })} />

        <label>会话默认布局</label>
        <div className="seg-control">
          {([['Vibe（聊天）', 'vibe'], ['Workspace（编辑器）', 'workspace']] as [string, string][]).map(([label, mode]) => (
            <button key={mode} className={a.sessionLayout === mode ? 'active' : ''} onClick={() => setA({ sessionLayout: mode })}>{label}</button>
          ))}
        </div>

        <label>窗口圆角</label>
        <div className="seg-control">
          {([['直角', 'sharp'], ['柔和', 'soft'], ['圆润', 'round']] as [string, string][]).map(([label, mode]) => (
            <button key={mode} className={a.windowCorners === mode ? 'active' : ''} onClick={() => setA({ windowCorners: mode })}>{label}</button>
          ))}
        </div>

        <label>背景毛玻璃<span className="sub">macOS 半透明背景（性能略低）</span></label>
        <div className={`switch ${a.backdropBlur ? 'on' : ''}`} onClick={() => setA({ backdropBlur: !a.backdropBlur })} />

        <label>动画</label>
        <div className="seg-control">
          {([['禁用', 'none'], ['仅过渡', 'transitions'], ['完整', 'full']] as [string, string][]).map(([label, mode]) => (
            <button key={mode} className={a.animation === mode ? 'active' : ''} onClick={() => setA({ animation: mode })}>{label}</button>
          ))}
        </div>
      </div>

      <div className="subsec-h">聊天显示</div>
      <div className="settings-card">
        <SettingsRow title="自动折叠工具调用" desc="超过 200 行的工具结果默认折叠" right={<div className={`switch ${a.autoCollapseTools ? 'on' : ''}`} onClick={() => setA({ autoCollapseTools: !a.autoCollapseTools })} />} />
        <SettingsRow title="行内显示 token 计数" right={<div className={`switch ${a.inlineTokenCount ? 'on' : ''}`} onClick={() => setA({ inlineTokenCount: !a.inlineTokenCount })} />} />
        <SettingsRow title="语法高亮代码块" right={<div className={`switch ${a.syntaxHighlight ? 'on' : ''}`} onClick={() => setA({ syntaxHighlight: !a.syntaxHighlight })} />} />
        <SettingsRow
          title="时间戳格式"
          right={
            <div className="select-sm">
              <SparkSelect value={a.timestampFormat} onChange={(e) => setA({ timestampFormat: e.target.value })}>
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

function ThemePreview({ kind, active, onClick, disabled }: { kind: 'light' | 'dark' | 'auto'; active: boolean; onClick: () => void; disabled?: boolean }) {
  const colors = {
    light: { bg: '#ffffff', soft: '#f7f7f8', text: '#18181b', muted: '#9ca3af', accent: 'var(--primary)' },
    dark: { bg: '#16161b', soft: '#0d0d10', text: '#fafafa', muted: '#6b7280', accent: 'var(--primary)' },
    auto: { bg: 'linear-gradient(135deg, #fff 50%, #16161b 50%)', soft: '#444', text: '#888', muted: '#888', accent: 'var(--primary)' },
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
          {[1, 2, 3].map((i) => <div key={i} className="theme-preview-line" style={{ background: c.muted }} /* dynamic */ />)}
        </div>
        <div className="theme-preview-main">
          <div className="theme-preview-title" style={{ background: c.text }} /* dynamic */ />
          <div className="theme-preview-text" style={{ background: c.muted, width: '90%' }} /* dynamic */ />
          <div className="theme-preview-text" style={{ background: c.muted, width: '70%' }} /* dynamic */ />
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
      name: '导航',
      items: [
        ['打开命令面板', ['⌘', 'K']],
        ['搜索会话', ['⌘', 'P']],
        ['切换 Vibe / Workspace', ['⌘', '/']],
        ['跳转到 Home', ['⌘', '1']],
        ['跳转到会话', ['⌘', '2']],
        ['新建会话', ['⌘', 'N']],
        ['打开项目', ['⌘', 'O']],
        ['切换侧边栏', ['⌘', '\\']],
      ],
    },
    {
      name: '会话',
      items: [
        ['发送消息', ['⌘', '↵']],
        ['新行', ['⇧', '↵']],
        ['取消运行', ['⌘', '.']],
        ['批准权限请求', ['⌘', 'Y']],
        ['拒绝权限请求', ['⌘', 'N']],
        ['接受当前 diff', ['⌘', '⇧', 'A']],
        ['拒绝当前 diff', ['⌘', '⇧', 'R']],
        ['创建检查点', ['⌘', 'S']],
        ['回到上一个检查点', ['⌘', 'Z']],
      ],
    },
    {
      name: '编辑器',
      items: [
        ['快速文件查找', ['⌘', 'P']],
        ['符号查找', ['⌘', '⇧', 'O']],
        ['切换终端', ['⌘', '`']],
        ['切换右侧 Agent 面板', ['⌘', 'J']],
      ],
    },
    {
      name: '工作流',
      items: [
        ['运行工作流', ['⌘', 'R']],
        ['停止工作流', ['⌘', '⇧', '.']],
        ['新建节点', ['N']],
        ['删除节点', ['⌫']],
        ['适应画布', ['⌘', '0']],
      ],
    },
  ]

  return (
    <div className="settings-section section-wider">
      <h2>快捷键</h2>
      <div className="lede">所有组合可在下方搜索并自定义。Mac 使用 ⌘，其他系统替换为 Ctrl。</div>

      <div className="row row-mb-sm">
        <div className="search-input flex1"><Icons.Search /><SparkInput placeholder="搜索动作或按键..." /></div>
        <button className="btn"><Icons.Refresh size={12} /> 重置全部</button>
      </div>

      {groups.map((g) => (
        <div key={g.name}>
          <div className="subsec-h">{g.name}</div>
          <div className="keymap">
            {g.items.map(([label, keys]) => (
              <div key={label} className="km-row">
                <div className="km-action">{label}</div>
                <div className="km-keys">
                  {keys.map((k, i) => <span key={i} className="kbd">{k}</span>)}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ───────── PROVIDERS ───────── */
function ProvidersSection() {
  const { setTweak, t } = useApp()
  const { toast } = useToast()
  const showProviderEdit = t.showProviderEdit
  const [profiles, setProfiles] = useState<ProviderProfile[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [healthMap, setHealthMap] = useState<Record<string, ProviderHealthCheckResponse>>({})
  const [showPresetCatalog, setShowPresetCatalog] = useState(false)
  /** 从预设创建时，传递给 ProviderEditPanel 的初始 presetId */
  const [initialPresetId, setInitialPresetId] = useState<string | null>(null)

  const { invoke: listProviders } = useIpcInvoke('provider:list')
  const { invoke: deleteProvider } = useIpcInvoke('provider:delete')
  const { invoke: healthCheck } = useIpcInvoke('provider:health-check')

  const refresh = useCallback(() => {
    listProviders({}).then(r => setProfiles(r.profiles)).catch(console.error)
  }, [listProviders])

  useEffect(() => { refresh() }, [refresh])

  const handleDelete = async (id: string) => {
    if (!window.confirm('确认删除该 Provider？')) return
    try {
      await deleteProvider({ id })
      toast.success('Provider 已删除')
      refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败')
    }
  }

  const handleHealthCheck = async (id: string) => {
    try {
      const r = await healthCheck({ id })
      setHealthMap(prev => ({ ...prev, [id]: r }))
      if (r.healthy) {
        toast.success(`连接成功${r.latencyMs != null ? ` · 延迟 ${r.latencyMs}ms` : ''}`)
      } else {
        toast.error('连接失败：Provider 返回不健康状态')
      }
    } catch (err) {
      setHealthMap(prev => ({ ...prev, [id]: { healthy: false } }))
      toast.error(err instanceof Error ? err.message : '连接测试失败')
    }
  }

  /** 点击 vendor 卡片 → 选择格式 → 打开编辑面板 */
  const handleSelectVendor = (vendorId: string) => {
    const presets = getPresetsByVendor(vendorId)
    if (presets.length >= 1 && presets[0]) {
      // 只有一种格式，直接打开
      setInitialPresetId(presets[0].id)
      setEditingId(null)
      setShowPresetCatalog(false)
      setTweak('showProviderEdit', true)
    }
    // 多种格式时在 VendorPresetCard 内部处理
  }

  const handleSelectPreset = (presetId: string) => {
    setInitialPresetId(presetId)
    setEditingId(null)
    setShowPresetCatalog(false)
    setTweak('showProviderEdit', true)
  }

  /** 已配置的 vendor 名称集合（用于标记已添加） */
  const configuredNames = useMemo(() => new Set(profiles.map(p => p.name)), [profiles])

  return (
    <>
      <div className="settings-section">
        <div className="row section-header-row">
          <div className="flex1">
            <h2 className="section-h2">Provider</h2>
            <div className="lede section-lede">配置供应商的协议格式、请求地址、鉴权和可用模型列表。每个 Provider 本身就是一份可直接运行的模型配置。</div>
          </div>
          <div className="row row-gap-xs">
            <button
              className={`btn ${showPresetCatalog ? 'active' : ''}`}
              onClick={() => setShowPresetCatalog(prev => !prev)}
            >
              <Icons.Layers size={12} /> 从模板添加
            </button>
            <button className="btn primary" onClick={() => { setEditingId(null); setInitialPresetId(null); setTweak('showProviderEdit', true) }}>
              <Icons.Plus size={12} /> 自定义添加
            </button>
          </div>
        </div>

        {/* ─── 预设模板目录 ─── */}
        {showPresetCatalog && (
          <div className="preset-catalog">
            <div className="preset-catalog-hint">
              选择供应商模板快速配置，选择后仍可自定义所有字段。
            </div>
            <div className="preset-catalog-grid">
              {getUniqueVendorIds().map((vendorId) => {
                const meta = getVendorMeta(vendorId)
                if (!meta) return null
                const presets = getPresetsByVendor(vendorId)
                const isAdded = configuredNames.has(meta.name)
                return (
                  <VendorPresetCard
                    key={vendorId}
                    vendor={meta}
                    presets={presets}
                    isAdded={isAdded}
                    onSelectVendor={handleSelectVendor}
                    onSelectPreset={handleSelectPreset}
                  />
                )
              })}
            </div>
          </div>
        )}

        {profiles.length === 0 && !showPresetCatalog ? (
          <div className="empty-placeholder-lg">
            尚未配置 Provider — 点击"从模板添加"快速开始，或"自定义添加"手动配置
          </div>
        ) : (
          profiles.map(p => {
            const h = healthMap[p.id]
            const status = h == null ? 'unknown' : h.healthy ? 'ok' : 'error'
            return (
              <ProviderCardX
                key={p.id}
                logo={(p.name[0] ?? p.provider[0] ?? '?').toUpperCase()}
                name={p.name}
                desc={`${p.provider} · 默认 ${p.defaultModel}`}
                status={status}
                detail={h?.latencyMs != null ? `延迟 ${h.latencyMs}ms` : `${p.modelIds.length} 个模型${p.isDefault ? ' · 默认 Provider' : ''}`}
                onEdit={() => { setEditingId(p.id); setTweak('showProviderEdit', true) }}
                onDelete={() => handleDelete(p.id)}
                onHealthCheck={() => handleHealthCheck(p.id)}
              />
            )
          })
        )}
      </div>

      {/* Provider 编辑面板 */}
      {showProviderEdit && (
        <ProviderEditPanel
          profileId={editingId}
          initialPresetId={initialPresetId}
          onClose={() => { setTweak('showProviderEdit', false); setInitialPresetId(null); refresh() }}
        />
      )}
    </>
  )
}

/* ─── VENDOR PRESET CARD（模板目录卡片） ─── */
function VendorPresetCard({
  vendor,
  presets,
  isAdded,
  onSelectVendor,
  onSelectPreset,
}: {
  vendor: VendorMeta
  presets: ProviderPreset[]
  isAdded: boolean
  onSelectVendor: (vendorId: string) => void
  onSelectPreset: (presetId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)

  const handleClick = () => {
    if (presets.length === 1) {
      onSelectVendor(vendor.id)
    } else {
      setExpanded((prev) => !prev)
    }
  }

  return (
    <div className={`preset-card${isAdded ? ' preset-added' : ''}`}>
      <div className="preset-card-main" onClick={handleClick}>
        <div className="preset-card-logo" style={{ background: vendor.color, color: '#fff' }}>
          {vendor.emoji}
        </div>
        <div className="preset-card-info">
          <div className="preset-card-name">
            {vendor.name}
            {isAdded && <span className="preset-card-badge">已添加</span>}
          </div>
          <div className="preset-card-desc">{vendor.desc}</div>
        </div>
        {presets.length > 1 && (
          <span className="preset-card-formats">
            {presets.length} 种格式
          </span>
        )}
      </div>
      {expanded && presets.length > 1 && (
        <div className="preset-card-formats-list">
          {presets.map((preset) => (
            <button
              key={preset.id}
              className="preset-format-btn"
              onClick={(e) => { e.stopPropagation(); onSelectPreset(preset.id) }}
            >
              <span className={`preset-format-dot ${preset.provider}`} />
              {preset.provider === 'anthropic' ? 'Anthropic 格式' : 'OpenAI 格式'}
              <span className="preset-format-model">{preset.defaultModel}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ProviderCardX({
  logo, name, desc, status, detail, onEdit, onDelete, onHealthCheck,
}: {
  logo: string
  name: string
  desc: string
  status: 'ok' | 'warning' | 'off' | 'error' | 'unknown'
  detail: string
  onEdit: () => void
  onDelete: () => void
  onHealthCheck: () => void
}) {
  return (
    <div className="provider-card">
      <div className="provider-logo border-transparent">{logo}</div>
      <div className="provider-info">
        <div className="row row-gap-sm">
          <span className="name">{name}</span>
          {status === 'ok' && <span className="badge success dot">在线</span>}
          {status === 'warning' && <span className="badge warning dot">需注意</span>}
          {status === 'error' && <span className="badge danger dot">错误</span>}
          {status === 'off' && <span className="badge dot">未启用</span>}
          {status === 'unknown' && <span className="badge dot">未验证</span>}
        </div>
        <div className="desc">{desc}</div>
        {detail && <div className="muted detail-sm">{detail}</div>}
      </div>
      <div className="row row-gap-xs self-start mt-sm">
        <button className="btn ghost sm" onClick={onEdit}><Icons.Edit size={11} /> 编辑</button>
        <button className="icon-btn" title="健康检查" onClick={onHealthCheck}><Icons.Refresh size={13} /></button>
        <button className="icon-btn" title="删除" onClick={onDelete}><Icons.X size={13} /></button>
      </div>
    </div>
  )
}

/* ───────── PROVIDER EDIT slide panel ───────── */
export function ProviderEditPanel({ profileId = null, initialPresetId = null, onClose }: { profileId?: string | null; initialPresetId?: string | null; onClose: () => void }) {
  const { toast } = useToast()
  const [form, setForm] = useState<ProviderForm>({
    presetId: 'custom',
    name: '',
    provider: 'anthropic',
    defaultModel: '',
    modelIdsText: '',
    endpoint: '',
    codexApiKind: 'chat',
    apiKey: '',
    isDefault: false,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const { invoke: createProvider } = useIpcInvoke('provider:create')
  const { invoke: updateProvider } = useIpcInvoke('provider:update')
  const { invoke: listProviders } = useIpcInvoke('provider:list')

  // 编辑模式：加载现有 profile；新建模式：支持 initialPresetId 预填
  useEffect(() => {
    if (!profileId) {
      // 从预设模板打开：自动填充 preset 数据
      if (initialPresetId) {
        const preset = getProviderPresetById(initialPresetId)
        if (preset) {
          setForm({
            presetId: preset.id,
            name: preset.name,
            provider: preset.provider,
            defaultModel: preset.defaultModel,
            modelIdsText: joinModelIds(preset.modelIds, preset.defaultModel),
            endpoint: preset.apiEndpoint,
            codexApiKind: 'chat',
            apiKey: '',
            isDefault: false,
          })
          return
        }
      }
      setForm({ presetId: 'custom', name: '', provider: 'anthropic', defaultModel: '', modelIdsText: '', endpoint: '', codexApiKind: 'chat', apiKey: '', isDefault: false })
      return
    }
    listProviders({}).then(r => {
      const p = r.profiles.find(x => x.id === profileId)
      if (p) {
        setForm({
          presetId: 'custom',
          name: p.name,
          provider: normalizeProviderKind(p.provider),
          defaultModel: p.defaultModel,
          modelIdsText: joinModelIds(p.modelIds, p.defaultModel),
          endpoint: p.apiEndpoint ?? '',
          codexApiKind: p.codexApiKind ?? 'chat',
          apiKey: '',
          isDefault: p.isDefault,
        })
      }
    }).catch(console.error)
  }, [listProviders, profileId, initialPresetId])

  const handleSave = async () => {
    if (!form.name.trim() || !form.defaultModel.trim()) { setError('名称和默认模型 ID 不能为空'); return }
    if (!profileId && !form.apiKey.trim()) { setError('新建 Provider 需要填写 API Key'); return }
    setSaving(true); setError('')
    try {
      const endpoint = form.endpoint.trim()
      const modelIds = parseModelIds(form.modelIdsText, form.defaultModel)
      if (profileId) {
        const req: ProviderUpdateRequest = {
          id: profileId,
          name: form.name.trim(),
          defaultModel: form.defaultModel.trim(),
          modelIds,
          isDefault: form.isDefault,
          apiEndpoint: endpoint.length > 0 ? endpoint : null,
          ...(form.provider === 'openai' && { codexApiKind: form.codexApiKind }),
        }
        if (form.apiKey.trim()) req.apiKey = form.apiKey
        await updateProvider(req)
      } else {
        await createProvider({
          name: form.name.trim(),
          provider: form.provider,
          defaultModel: form.defaultModel.trim(),
          modelIds,
          apiKey: form.apiKey,
          isDefault: form.isDefault,
          ...(endpoint.length > 0 && { apiEndpoint: endpoint }),
          ...(form.provider === 'openai' && { codexApiKind: form.codexApiKind }),
        })
      }
      onClose()
      toast.success(profileId ? 'Provider 已更新' : 'Provider 已创建')
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
      toast.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm(prev => ({ ...prev, [k]: v }))
  const applyPreset = (preset: ProviderPreset) => {
    setForm(prev => ({
      ...prev,
      presetId: preset.id,
      name: preset.name,
      provider: preset.provider,
      defaultModel: preset.defaultModel,
      modelIdsText: joinModelIds(preset.modelIds, preset.defaultModel),
      endpoint: preset.apiEndpoint,
      codexApiKind: 'chat',
    }))
  }

  return (
    <div className="slide-panel-backdrop" onClick={onClose}>
      <div className="slide-panel" onClick={(e) => e.stopPropagation()}>
        <div className="slide-panel-h">
          <div className="h-icon">{(form.name[0] ?? form.provider[0] ?? 'P').toUpperCase()}</div>
          <div className="flex1">
            <div className="h-title">{profileId ? '编辑 Provider' : '添加 Provider'}</div>
            <div className="h-sub">{form.provider} · API key 鉴权</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icons.X /></button>
        </div>

        <div className="slide-panel-body">
          {error && <div className="alert-banner">{error}</div>}

          <div className="subsec-h">基础</div>
          <div className="form-grid">
            <label>供应商模板<span className="sub">基于官方公开文档预填，后续仍可修改</span></label>
            <SparkSelect
              value={form.presetId}
              disabled={!!profileId}
              onChange={e => {
                const presetId = e.target.value
                if (presetId === 'custom') {
                  set('presetId', 'custom')
                  return
                }
                const preset = getProviderPresetById(presetId)
                if (preset) applyPreset(preset)
              }}
            >
              <option value="custom">自定义</option>
              {PROVIDER_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name} · {preset.provider === 'anthropic' ? 'Anthropic 格式' : 'OpenAI 格式'}
                </option>
              ))}
            </SparkSelect>

            <label>显示名称</label>
            <SparkInput value={form.name} onChange={e => set('name', e.target.value)} placeholder="例：Anthropic · Claude" />

            <label>协议格式<span className="sub">决定使用 Anthropic 或 OpenAI 适配器</span></label>
            <SparkSelect
              value={form.provider}
              onChange={e => setForm(prev => ({ ...prev, presetId: 'custom', provider: normalizeProviderKind(e.target.value), codexApiKind: 'chat' }))}
              disabled={!!profileId}
            >
              <option value="anthropic">Anthropic 格式</option>
              <option value="openai">OpenAI 格式</option>
            </SparkSelect>

            {form.provider === 'openai' && (
              <>
                <label>OpenAI API 类型<span className="sub">Responses 用于 gpt-5-codex，Chat 兼容更多后端</span></label>
                <SparkSelect
                  value={form.codexApiKind}
                  onChange={e => set('codexApiKind', normalizeCodexApiKind(e.target.value))}
                >
                  <option value="chat">Chat Completions</option>
                  <option value="responses">Responses API</option>
                </SparkSelect>
              </>
            )}

            <label>默认模型 ID</label>
            <SparkInput value={form.defaultModel} onChange={e => set('defaultModel', e.target.value)} placeholder="例：claude-sonnet-4-20250514" className="mono-sm" />

            <label>可用模型 ID<span className="sub">每行一个，默认模型会自动加入</span></label>
            <textarea
              value={form.modelIdsText}
              onChange={e => set('modelIdsText', e.target.value)}
              placeholder={`claude-sonnet-4-20250514\nclaude-3-5-haiku-20241022`}
              className="mono-sm"
              rows={4}
            />

            <label>Endpoint URL<span className="sub">可选，自定义请求地址</span></label>
            <SparkInput
              value={form.endpoint}
              onChange={e => set('endpoint', e.target.value)}
              placeholder={form.provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'}
              className="mono-sm"
            />

            <label>默认 Provider</label>
            <div className={`switch ${form.isDefault ? 'on' : ''}`} onClick={() => set('isDefault', !form.isDefault)} />
          </div>

          <div className="subsec-h">鉴权</div>
          <div className="form-grid">
            <label>API Key{profileId && <span className="sub">留空则不更新</span>}</label>
            <SparkInput
              type="password"
              value={form.apiKey}
              onChange={e => set('apiKey', e.target.value)}
              placeholder={profileId ? '••••••••（留空不更新）' : 'sk-ant-...'}
            />
          </div>
        </div>

        <div className="slide-panel-foot">
          <span className="flex1" />
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn primary" onClick={handleSave} disabled={saving}>
            <Icons.Check size={12} /> {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

function normalizeProviderKind(value: string): ProviderKind {
  return value === 'anthropic' ? 'anthropic' : 'openai'
}

function normalizeCodexApiKind(value: string): CodexApiKind {
  return value === 'responses' ? 'responses' : 'chat'
}

function parseModelIds(modelIdsText: string, defaultModel: string): string[] {
  const values = [defaultModel, ...modelIdsText.split(/[\n,]/)]
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
  return [...new Set(values)]
}

function joinModelIds(modelIds: string[], defaultModel?: string): string {
  return modelIds.filter((modelId) => modelId !== defaultModel).join('\n')
}

/* ───────── PROFILE EDIT MODAL ───────── */
export function ProfileEditModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <div className="modal-h-icon modal-h-icon-primary"><Icons.Brain size={18} /></div>
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

            <label>角色<span className="sub">该 profile 适配的角色</span></label>
            <div className="row row-gap-xs">
              {['default', 'planner', 'coder', 'reviewer', 'fast', 'vision', 'long-context'].map((r) => (
                <span
                  key={r}
                  className={`badge ${['default', 'coder', 'reviewer'].includes(r) ? 'primary' : ''} badge-role-tag`}
                >
                  {r}
                </span>
              ))}
            </div>

            <label>Temperature</label>
            <div className="control">
              <SparkInput type="range" min="0" max="2" step="0.1" defaultValue="0.7" className="flex1" />
              <span className="mono-sm muted range-value">0.7</span>
            </div>

            <label>最大输入 token</label>
            <SparkInput type="number" defaultValue="180000" />

            <label>最大输出 token</label>
            <SparkInput type="number" defaultValue="8192" />

            <label>推理强度<span className="sub">extended thinking 时使用</span></label>
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

            <label>Fallback 链<span className="sub">主模型失败或超限时按顺序尝试</span></label>
            <div className="fallback-list">
              <div className="row fallback-row">
                <span className="mono-sm faint">1.</span>
                <Icons.Brain size={13} className="color-primary" />
                <span className="strong fallback-name">Claude Opus 4</span>
                <span className="badge fallback-badge">当延迟 &gt; 5s</span>
                <button className="icon-btn fallback-close"><Icons.X size={11} /></button>
              </div>
              <div className="row fallback-row">
                <span className="mono-sm faint">2.</span>
                <Icons.Brain size={13} className="color-primary" />
                <span className="strong fallback-name">Claude Haiku 4.5</span>
                <span className="badge fallback-badge">当成本超限</span>
                <button className="icon-btn fallback-close"><Icons.X size={11} /></button>
              </div>
              <button className="btn ghost sm add-fallback-btn"><Icons.Plus size={11} /> 添加 fallback</button>
            </div>

            <label>启用</label>
            <div className="switch on" />
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn danger sm">删除 Profile</button>
          <div className="flex1" />
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn primary" onClick={onClose}><Icons.Check size={12} /> 保存</button>
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

  const refresh = useCallback(() => {
    setLoading(true)
    setError('')
    Promise.all([listModels({}), listProviders({})])
      .then(([mRes, pRes]) => { setModels(mRes.models); setProviders(pRes.profiles) })
      .catch((err) => setError(err instanceof Error ? err.message : '加载失败'))
      .finally(() => setLoading(false))
  }, [listModels, listProviders])

  useEffect(() => { refresh() }, [refresh])

  const handleToggle = async (m: ModelProfile) => {
    await updateModel({ id: m.id, enabled: !m.enabled })
    refresh()
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('确认删除该模型？')) return
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
          <div className="lede section-lede">按 Provider 分组管理可用模型，可启用/禁用或添加自定义模型。</div>
        </div>
        <span className="badge primary dot">共 {models.length} 个</span>
      </div>

      {error && (
        <div className="alert-banner">{error}</div>
      )}

      {loading && (
        <div className="card loading-card">正在加载...</div>
      )}

      {!loading && providers.length === 0 && (
        <div className="card loading-card">
          暂无 Provider。请先在 Provider 页面添加。
        </div>
      )}

      {!loading && byProvider.map(({ provider, models: pModels }) => (
        <div key={provider.id} className="card model-card">
          <div className="row model-card-header">
            <span className="strong">{provider.name}</span>
            <span className="badge model-provider-badge">{provider.provider}</span>
            <span className="flex1" />
            <button className="btn ghost sm" onClick={() => { setAddingForProvider(provider.id); setNewModelName('') }}>
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
                onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd(provider.id); if (e.key === 'Escape') setAddingForProvider(null) }}
                autoFocus
              />
              <button className="btn primary sm" onClick={() => void handleAdd(provider.id)}>确认</button>
              <button className="btn ghost sm" onClick={() => setAddingForProvider(null)}>取消</button>
            </div>
          )}

          {pModels.length === 0 && (
            <div className="model-card-empty">暂无模型</div>
          )}

          {pModels.map((m) => {
            const cap = ModelCapabilityRegistry.getCapabilities(m.name)
            return (
              <div key={m.id} className="row model-row-border">
                <span className="mono-sm model-name-sm flex1">{m.name}</span>
                {cap && (
                  <div className="row model-cap-tags">
                    {cap.supportsVision && <span className="model-cap-tag vision">Vision</span>}
                    {cap.supportsToolUse && <span className="model-cap-tag tool">Tools</span>}
                    {cap.supportsExtendedThinking && <span className="model-cap-tag thinking">Thinking</span>}
                    <span className="model-cap-tag ctx">{cap.contextWindow >= 1_000_000 ? `${cap.contextWindow / 1_000_000}M` : `${cap.contextWindow / 1_000}K`}</span>
                  </div>
                )}
                <div
                  className={`switch${m.enabled ? ' on' : ''} switch-cursor`}
                  onClick={() => void handleToggle(m)}
                />
                <button className="icon-btn" title="删除" onClick={() => void handleDelete(m.id)}><Icons.X size={12} /></button>
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
  { scope: 'system', label: 'System', badge: 'SYS', badgeColor: '#94a3b8', desc: '应用内置 · 不可删除' },
  { scope: 'team', label: 'Team', badge: 'TEAM', badgeColor: '#8b5cf6', desc: '团队管理员发布' },
  { scope: 'user', label: 'User', badge: 'USER', badgeColor: '#10b981', desc: '用户全局偏好' },
  { scope: 'project', label: 'Project', badge: 'PROJ', badgeColor: '#f97316', desc: '.spark/rules · 当前工作区' },
  { scope: 'session', label: 'Session', badge: 'SESS', badgeColor: '#f43f5e', desc: '本次会话临时规则' },
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

  const refresh = useCallback(() => {
    setLoading(true)
    setError('')
    listRules({})
      .then((res) => setRules(res.rules))
      .catch((err) => setError(err instanceof Error ? err.message : '加载规则失败'))
      .finally(() => setLoading(false))
  }, [listRules])

  useEffect(() => { refresh() }, [refresh])

  const grouped = RULE_LAYER_META.reduce<Record<RuleScope, RuleItem[]>>((acc, meta) => {
    acc[meta.scope] = rules.filter((rule) => rule.scope === meta.scope)
    return acc
  }, { system: [], team: [], user: [], project: [], session: [] })

  const activeCount = rules.filter((rule) => rule.enabled).length

  const handleToggle = async (id: string, enabled: boolean) => {
    await updateRule({ id, enabled })
    refresh()
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('确认删除该规则？')) return
    await deleteRule({ id })
    refresh()
  }

  const handleSave = async (draft: { scope: RuleScope; id?: string; name: string; content: string; priority: number }) => {
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
        <div className="lede">多层规则按优先级合成为有效 prompt 注入。下方按层级展示来源，并显示冲突与覆盖。</div>

        <div className="row info-banner">
          <Icons.Brain size={14} className="color-primary flex-shrink-0" />
          <div className="flex1 info-banner-text">
            <strong>当前生效</strong> · {activeCount} 条启用规则来自 {RULE_LAYER_META.length} 个作用域
          </div>
          <button className="btn sm primary" onClick={refresh}><Icons.Refresh size={11} /> 刷新</button>
        </div>

        {error && (
          <div className="alert-banner">{error}</div>
        )}

        {loading ? (
          <div className="card loading-card">
            正在加载规则...
          </div>
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
        <span className="badge rule-badge rule-badge-dynamic" style={{ background: badgeColor + '20', color: badgeColor }} /* dynamic */>{badge}</span>
        <div>
          <span className="name">{scope}</span>
          <span className="desc"> · {desc}</span>
        </div>
        <div className="flex1" />
        {readOnly && <span className="badge rule-readonly-badge">只读</span>}
        {!readOnly && <button className="icon-btn" title="新增规则" onClick={onAdd}><Icons.Plus size={13} /></button>}
        <button className="icon-btn"><Icons.ChevronDown size={13} /></button>
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
                <button className="icon-btn" title="编辑" onClick={() => onEdit(rule)}><Icons.Edit size={12} /></button>
                <button className="icon-btn" title="删除" onClick={() => onDelete(rule.id)}><Icons.X size={12} /></button>
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
  onSave: (draft: { scope: RuleScope; id?: string; name: string; content: string; priority: number }) => Promise<void>
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
          <button className="icon-btn" onClick={onClose}><Icons.X /></button>
        </div>

        <div className="slide-panel-body">
          {error && <div className="alert-banner">{error}</div>}

          <div className="subsec-h">规则</div>
          <div className="form-grid">
            <label>名称</label>
            <SparkInput value={name} onChange={(e) => setName(e.target.value)} placeholder="例：代码风格" />

            <label>优先级<span className="sub">数字越大越优先</span></label>
            <SparkInput type="number" value={priority} onChange={(e) => setPriority(Number(e.target.value))} />

            <label>内容</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="输入要注入到 Agent prompt 的规则内容"
              className="rule-textarea"
            />
          </div>
        </div>

        <div className="slide-panel-foot">
          <span className="flex1" />
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn primary" onClick={handleSave} disabled={saving}>
            <Icons.Check size={12} /> {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ───────── MCP ───────── */
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
    refresh()
  }, [refresh])

  const loadTools = useCallback(async (serverId: string) => {
    try {
      const res = await getServerTools({ serverId })
      setToolsMap((prev) => ({ ...prev, [serverId]: res.tools }))
    } catch {
      setToolsMap((prev) => ({ ...prev, [serverId]: [] }))
    }
  }, [getServerTools])

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
        setStatusMap((prev) => ({ ...prev, [serverId]: { connected: true, toolCount: res.toolCount } }))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '启动失败')
      setStatusMap((prev) => ({ ...prev, [serverId]: { connected: false, toolCount: 0, error: err instanceof Error ? err.message : '启动失败' } }))
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
        try { await stopServer({ serverId }) } catch { /* ignore */ }
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
    if (!name) { setFormError('名称不能为空'); return }
    if (draft.type === 'stdio' && !draft.command.trim()) { setFormError('stdio 类型需要填写启动命令'); return }
    if (draft.type === 'sse' && !draft.url.trim()) { setFormError('SSE 类型需要填写 URL'); return }

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
      envPairs: prev.envPairs.map((p, i) => i === index ? { ...p, [field]: val } : p),
    }))
  }

  const runningCount = servers.filter((s) => statusMap[s.id]?.connected).length

  return (
    <div className="settings-section">
      <div className="row section-header-row">
        <div className="flex1">
          <h2 className="section-h2">MCP 服务器</h2>
          <div className="lede section-lede">配置 Model Context Protocol 服务器，为 Agent 提供外部工具和数据源。</div>
        </div>
        <span className="badge primary dot">{runningCount} / {servers.length} 运行中</span>
        <button className="btn primary" onClick={openAddForm} style={{ marginLeft: 10 }} /* dynamic */>
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
                  <span className={`mcp-status-dot ${isConnected ? 'running' : hasError ? 'error' : 'stopped'}`} />
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
                  <div className="row row-gap-xs mcp-server-actions" onClick={(e) => e.stopPropagation()}>
                    {isLoading ? (
                      <span className="mcp-action-loading"><Icons.Spinner size={13} /></span>
                    ) : isConnected ? (
                      <button className="btn ghost sm" onClick={() => void handleStop(server.id)} title="停止">
                        <Icons.Stop size={11} /> 停止
                      </button>
                    ) : (
                      <button className="btn ghost sm" onClick={() => void handleStart(server.id)} title="启动">
                        <Icons.Play size={11} /> 启动
                      </button>
                    )}
                    <button className="icon-btn" title="编辑" onClick={() => openEditForm(server)}>
                      <Icons.Edit size={12} />
                    </button>
                    <button className="icon-btn" title="删除" onClick={() => setDeleteConfirmId(server.id)}>
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
                          <span className={`badge ${isConnected ? 'success' : hasError ? 'danger' : ''} dot`}>
                            {isConnected ? '已连接' : hasError ? '错误' : '已停止'}
                          </span>
                        </div>
                      </div>
                      <div className="mcp-detail-col">
                        <div className="mcp-detail-label">传输类型</div>
                        <div className="mcp-detail-value">{transport === 'stdio' ? 'Stdio' : 'SSE'}</div>
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
                        return <div className="mcp-detail-loading"><Icons.Spinner size={13} /> 加载工具列表...</div>
                      }
                      if (tools.length === 0) {
                        return <div className="mcp-detail-empty">暂无工具（服务器未运行或未提供工具）</div>
                      }
                      return (
                        <div className="mcp-detail-tools">
                          {tools.map((tool) => (
                            <div key={tool.name} className="mcp-tool-item">
                              <span className="mcp-tool-name"><Icons.Wrench size={11} /> {tool.name}</span>
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
              <div className="modal-h-icon modal-h-icon-primary"><Icons.MCP size={18} /></div>
              <div className="flex1">
                <div className="modal-title">{editingId ? '编辑 MCP 服务器' : '添加 MCP 服务器'}</div>
                <div className="modal-subtitle">{draft.type === 'stdio' ? 'Stdio 传输' : 'SSE 传输'}</div>
              </div>
              <button className="icon-btn" onClick={closeForm}><Icons.X /></button>
            </div>

            <div className="modal-body modal-body-scroll">
              {formError && <div className="alert-banner">{formError}</div>}

              <div className="subsec-h">基础配置</div>
              <div className="form-grid">
                <label>名称<span className="sub">服务器唯一标识名称</span></label>
                <SparkInput value={draft.name} onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))} placeholder="例：filesystem" />

                <label>作用域<span className="sub">配置生效范围</span></label>
                <SparkSelect value={draft.scope} onChange={(e) => setDraft((prev) => ({ ...prev, scope: e.target.value }))} disabled={!!editingId}>
                  <option value="user">user</option>
                  <option value="team">team</option>
                  <option value="project">project</option>
                  <option value="session">session</option>
                </SparkSelect>

                <label>传输类型<span className="sub">与 MCP 服务器的通信方式</span></label>
                <SparkSelect value={draft.type} onChange={(e) => setDraft((prev) => ({ ...prev, type: (e.target.value === 'sse' ? 'sse' : 'stdio') as McpTransportType }))} disabled={!!editingId}>
                  <option value="stdio">Stdio（本地进程）</option>
                  <option value="sse">SSE（HTTP 流）</option>
                </SparkSelect>
              </div>

              {draft.type === 'stdio' ? (
                <>
                  <div className="subsec-h mt-lg">Stdio 配置</div>
                  <div className="form-grid">
                    <label>启动命令<span className="sub">可执行文件路径</span></label>
                    <SparkInput className="mono-sm" value={draft.command} onChange={(e) => setDraft((prev) => ({ ...prev, command: e.target.value }))} placeholder="npx" />

                    <label>参数<span className="sub">空格分隔的命令行参数</span></label>
                    <SparkInput className="mono-sm" value={draft.args} onChange={(e) => setDraft((prev) => ({ ...prev, args: e.target.value }))} placeholder="-y @modelcontextprotocol/server-filesystem ." />
                  </div>
                </>
              ) : (
                <>
                  <div className="subsec-h mt-lg">SSE 配置</div>
                  <div className="form-grid">
                    <label>URL<span className="sub">SSE 端点地址</span></label>
                    <SparkInput className="mono-sm" value={draft.url} onChange={(e) => setDraft((prev) => ({ ...prev, url: e.target.value }))} placeholder="https://mcp.example.com/sse" />
                  </div>
                </>
              )}

              <div className="subsec-h mt-lg">
                环境变量
                <button className="btn ghost sm mcp-env-add-btn" onClick={addEnvPair}><Icons.Plus size={11} /> 添加</button>
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
                      <button className="icon-btn mcp-env-del" onClick={() => removeEnvPair(idx)} title="删除">
                        <Icons.X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="modal-foot">
              <span className="flex1" />
              <button className="btn" onClick={closeForm}>取消</button>
              <button className="btn primary" onClick={() => void handleFormSave()} disabled={formSaving}>
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
              <div className="modal-h-icon" style={{ background: 'var(--danger-bg, #fef2f2)', color: 'var(--danger)' }} /* dynamic */>
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
                确认删除此 MCP 服务器？{statusMap[deleteConfirmId]?.connected ? '该服务器正在运行，将自动停止。' : ''}此操作无法撤销。
              </div>
            </div>
            <div className="modal-foot">
              <span className="flex1" />
              <button className="btn" onClick={() => setDeleteConfirmId(null)}>取消</button>
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

/* ───────── SYSTEM PROMPT ───────── */
function SystemPromptSection() {
  const [systemPrompt, setSystemPrompt] = useState('')
  const [systemPromptEnabled, setSystemPromptEnabled] = useState(true)
  const [savingPrompt, setSavingPrompt] = useState(false)
  const { toast } = useToast()
  const { invoke: getPromptConfig } = useIpcInvoke('prompt-config:get')
  const { invoke: updatePromptConfig } = useIpcInvoke('prompt-config:update')

  useEffect(() => {
    getPromptConfig({})
      .then((res) => {
        setSystemPrompt(res.system.content)
        setSystemPromptEnabled(res.system.enabled)
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
      setSystemPromptEnabled(res.system.enabled)
      toast.success('系统提示词已保存')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存系统提示词失败')
    } finally {
      setSavingPrompt(false)
    }
  }

  return (
    <div className="settings-section">
      <h2>系统提示词</h2>
      <div className="lede">配置全局系统提示词，会和后续 Agent、项目、会话提示词逐级合并。</div>

      <div className="card prompt-config-card">
        <div className="settings-row">
          <div>
            <div className="settings-row-title">系统级提示词</div>
            <div className="settings-row-desc">全局生效，作为所有 Agent 的基础提示词注入。</div>
          </div>
          <div
            className={`switch ${systemPromptEnabled ? 'on' : ''}`}
            onClick={() => setSystemPromptEnabled((prev) => !prev)}
          />
        </div>
        <textarea
          className="spark-textarea prompt-textarea"
          value={systemPrompt}
          onChange={(event) => setSystemPrompt(event.target.value)}
          placeholder="输入全局系统提示词..."
        />
        <div className="row prompt-actions">
          <span className="muted">Agent 级提示词会在多 Agent 配置功能中开放。</span>
          <span className="flex1" />
          <button className="btn primary sm" onClick={() => void saveSystemPrompt()} disabled={savingPrompt}>
            <Icons.Check size={12} /> {savingPrompt ? '保存中...' : '保存'}
          </button>
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
    refresh()
  }, [refresh])

  const toggleSkill = async (skill: SkillItem) => {
    await updateSkill({ id: skill.id, enabled: !skill.enabled })
    refresh()
  }

  return (
    <div className="settings-section">
      <h2>Skills</h2>
      <div className="lede">管理系统级可见 Skill。系统隐藏的 Skill 不会进入任何 Agent 的可见列表。</div>

      {error && <div className="alert-banner">{error}</div>}

      <div className="card">
        {loading ? (
          <div className="loading-card">正在加载 Skills...</div>
        ) : skills.map((skill) => {
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
        })}
      </div>

      <div className="skills-hint">
        已安装不代表会被强制使用；Agent 会从系统/项目/会话合并后的可见列表中自行判断是否应用。
      </div>
    </div>
  )
}

/* ───────── WORKFLOW TEMPLATES ───────── */
function WorkflowTemplatesSection() {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>(() => readStoredJson(WORKFLOW_TEMPLATES_KEY, DEFAULT_WORKFLOW_TEMPLATES))

  const restoreDefaults = () => {
    setTemplates(DEFAULT_WORKFLOW_TEMPLATES)
    writeStoredJson(WORKFLOW_TEMPLATES_KEY, DEFAULT_WORKFLOW_TEMPLATES)
  }

  return (
    <div className="settings-section">
      <div className="row section-header-row">
        <div className="flex1">
          <h2 className="section-h2">工作流模板</h2>
          <div className="lede section-lede">管理共享 DAG 模板与版本。模板会作为 Workflow 页创建新流程时的起点。</div>
        </div>
        <button className="btn ghost sm" onClick={restoreDefaults}><Icons.Refresh size={11} /> 恢复内置</button>
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

/* ───────── PERMISSIONS ───────── */
function PermissionsSection() {
  const [profiles, setProfiles] = useState<PermissionProfileItem[]>([])
  const [activeProfileId, setActiveProfileId] = useState(() => window.localStorage.getItem(PERM_PROFILE_KEY) || 'project-standard')
  const [loading, setLoading] = useState(true)
  const [auditEnabled, setAuditEnabled] = useState(() => window.localStorage.getItem(AUDIT_ENABLED_KEY) !== 'false')

  const { invoke: listProfiles } = useIpcInvoke('permission:list-profiles')
  const { invoke: updateSandbox } = useIpcInvoke('permission:update-sandbox')
  const { invoke: updateRule } = useIpcInvoke('permission:update-rule')

  const refresh = useCallback(() => {
    setLoading(true)
    listProfiles({})
      .then((res) => {
        setProfiles(res.profiles)
        const storedProfileId = window.localStorage.getItem(PERM_PROFILE_KEY)
        setActiveProfileId(storedProfileId !== null && res.profiles.some((p) => p.id === storedProfileId) ? storedProfileId : res.activeProfileId)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [listProfiles])

  useEffect(() => { refresh() }, [refresh])

  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? profiles[0]

  const handleProfileChange = (profileId: string) => {
    setActiveProfileId(profileId)
    window.localStorage.setItem(PERM_PROFILE_KEY, profileId)
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

  const RULE_META: Array<{ action: string; icon: ReactNode; name: string; hint: string; scope: string }> = [
    { action: 'file_read', icon: <Icons.File />, name: '读取工作区文件', hint: '允许 · 不弹窗', scope: '工作区内' },
    { action: 'file_write', icon: <Icons.Edit />, name: '编辑工作区文件', hint: '自动写入，记录到 checkpoint', scope: '工作区内' },
    { action: 'file_read_any', icon: <Icons.File />, name: '访问工作区外文件', hint: '读取或写入 ~/ 之外路径', scope: '任意' },
    { action: 'command_exec', icon: <Icons.Terminal />, name: '执行 shell 命令', hint: '非破坏性命令', scope: '本会话' },
    { action: 'command_dangerous', icon: <Icons.AlertTriangle />, name: '高风险命令', hint: 'rm -rf、curl | sh、密钥导出', scope: '任意' },
    { action: 'git_push', icon: <Icons.GitBranch />, name: 'Git 推送', hint: '包含 --force / --force-with-lease', scope: '任意' },
    { action: 'network_known', icon: <Icons.Globe />, name: '网络访问', hint: 'HTTP/HTTPS 请求', scope: '域名白名单' },
    { action: 'network_unknown', icon: <Icons.Globe />, name: '访问陌生域名', hint: '未在白名单中的域名', scope: '任意' },
    { action: 'mcp_tool', icon: <Icons.MCP />, name: '调用 MCP 工具', hint: '按 server allowlist', scope: '按 server' },
    { action: 'secret_read', icon: <Icons.Lock />, name: '读取 secret', hint: '通过 secret reference 注入', scope: 'profile 内' },
    { action: 'long_task', icon: <Icons.Clock />, name: '长任务后台运行', hint: '≥ 30s 的任务', scope: '本会话' },
  ]

  const PROFILE_META: Record<string, { icon: ReactNode; desc: string }> = {
    strict: { icon: <Icons.Lock />, desc: '一切都问' },
    'project-standard': { icon: <Icons.Shield />, desc: '工作区写入自动允许' },
    trusted: { icon: <Icons.CheckCircle />, desc: '自动允许大多数' },
  }

  return (
    <div className="settings-section">
      <h2>权限策略</h2>
      <div className="lede">控制 Agent 能做什么、何时需要审批。沙箱等级配合策略一起决定运行时风险。</div>

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
            {([
              [0, 'L0 · 仅聊天', '完全禁用工具调用', false],
              [1, 'L1 · 只读工作区', '可读文件，不可写、不可执行命令', false],
              [2, 'L2 · 受控写入', '可写工作区文件，命令需审批 — 推荐', false],
              [3, 'L3 · 完全自动化', '工作区内大多数操作免审批；高风险仍审批', false],
              [4, 'L4 · 隔离沙箱', 'microVM 内执行 (实验性)', true],
            ] as [number, string, string, boolean][]).map(([level, title, desc, disabled]) => (
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
        <SettingsRow title="记录所有权限决策" desc="写入 SQLite · 不可篡改" right={<div className={`switch ${auditEnabled ? 'on' : ''}`} onClick={toggleAudit} />} />
        <SettingsRow title="导出团队审计报告" desc="按周生成可签发的 JSON 报告" right={<div className="switch" />} />
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

function ProfileChip({ active, onClick, icon, name, desc }: { active: boolean; onClick: () => void; icon: ReactNode; name: string; desc: string }) {
  return (
    <button
      onClick={onClick}
      className={`profile-chip ${active ? 'active' : ''}`}
    >
      <span className={`profile-chip-icon ${active ? 'active' : ''}`}>{icon}</span>
      <div>
        <div className={`profile-chip-name ${active ? 'active' : ''}`}>{name}</div>
        <div className="profile-chip-desc">{desc}</div>
      </div>
    </button>
  )
}

function PermRule({ icon, name, hint, scope, mode, onModeChange }: { icon: ReactNode; name: string; hint: string; scope: string; mode: PermissionMode; onModeChange?: (m: PermissionMode) => void }) {
  return (
    <div className="perm-rule">
      <span className="ico">{icon}</span>
      <div className="desc">
        <div className="name">{name}</div>
        <div className="hint">{hint}</div>
      </div>
      <div className="select-full">
        <SparkSelect defaultValue={scope}>
          <option>工作区内</option><option>本会话</option><option>本项目</option><option>任意</option>
          <option>profile 内</option><option>按 server</option><option>域名白名单</option>
        </SparkSelect>
      </div>
      <div className="select-full">
        <SparkSelect value={mode} onChange={(e) => onModeChange?.(e.target.value as PermissionMode)}>
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

        <label>OpenTelemetry endpoint<span className="sub">可选 — 把 trace 转发到 collector</span></label>
        <SparkInput value={s.otlpEndpoint} onChange={(e) => set({ otlpEndpoint: e.target.value })} placeholder="https://otlp.example.com:4318 (可选)" />

        <label>Trace 采样率</label>
        <div className="control">
          <SparkInput type="range" min="0" max="100" value={s.traceSamplingRate} onChange={(e) => set({ traceSamplingRate: Number(e.target.value) })} className="flex1" />
          <span className="mono-sm muted range-value">{s.traceSamplingRate}%</span>
        </div>

        <label>本地保留 trace 天数</label>
        <SparkInput type="number" value={s.traceRetentionDays} onChange={(e) => set({ traceRetentionDays: Number(e.target.value) || 14 })} className="input-max-sm" />
      </div>

      <div className="subsec-h">最近运行</div>
      <div className="card">
        <SettingsRow title="代码功能开发：搜索优化" desc="Run #4f3a · 5 agent · 4m 38s · $0.92" right={<button className="btn ghost sm"><Icons.Eye size={11} /> 查看 trace</button>} />
        <SettingsRow title="重构 auth 模块为 OAuth 2.1" desc="Run #41b8 · 1 agent · 6m 12s · $1.34" right={<button className="btn ghost sm"><Icons.Eye size={11} /> 查看 trace</button>} />
        <SettingsRow title="MCP gateway 性能调优" desc="Run #38c0 · 1 agent · 失败" right={<button className="btn ghost sm danger-btn"><Icons.Eye size={11} /> 查看错误</button>} />
      </div>

      <div className="subsec-h">诊断包</div>
      <div className="card">
        <SettingsRow title="生成诊断包" desc="包含 app/OS 版本、provider 健康、近期错误日志，自动脱敏" right={<button className="btn"><Icons.Download size={11} /> 生成</button>} />
        <SettingsRow title="复制最近一次错误" desc="便于发到 GitHub Issue" right={<button className="btn ghost sm"><Icons.Copy size={11} /> 复制</button>} />
      </div>
    </div>
  )
}

/* ───────── USAGE ───────── */
function UsageSection() {
  const [dashboard, setDashboard] = useState<{
    total: { totalInputTokens: number; totalOutputTokens: number; totalCacheReadTokens: number; totalCacheWriteTokens: number; totalCostUsd: number; recordCount: number }
    currentMonth: { totalInputTokens: number; totalOutputTokens: number; totalCacheReadTokens: number; totalCacheWriteTokens: number; totalCostUsd: number; recordCount: number }
    topModels: Array<{ modelId: string; providerId: string; totalInputTokens: number; totalOutputTokens: number; totalCostUsd: number; recordCount: number }>
    recentRecords: Array<{ id: string; session_id: string; provider_id: string; model_id: string; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number; cost_usd: number; request_timestamp: string; created_at: string }>
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
    loadDashboard()
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
          <div className="usage-stat-value">{loading ? '—' : fmt(month?.totalInputTokens ?? 0)}</div>
        </div>
        <div className="usage-stat-card">
          <div className="usage-stat-label">输出 Token</div>
          <div className="usage-stat-value">{loading ? '—' : fmt(month?.totalOutputTokens ?? 0)}</div>
        </div>
        <div className="usage-stat-card">
          <div className="usage-stat-label">缓存命中</div>
          <div className="usage-stat-value">{loading ? '—' : fmt(month?.totalCacheReadTokens ?? 0)}</div>
        </div>
        <div className="usage-stat-card">
          <div className="usage-stat-label">预估费用</div>
          <div className="usage-stat-value usage-cost-value">{loading ? '—' : fmtUsd(month?.totalCostUsd ?? 0)}</div>
        </div>
      </div>

      {/* ── All-time summary ── */}
      <div className="subsec-h">累计统计</div>
      <div className="card">
        <SettingsRow
          title="总请求数"
          right={<span className="mono-sm strong">{loading ? '—' : String(total?.recordCount ?? 0)}</span>}
        />
        <SettingsRow
          title="总输入 Token"
          right={<span className="mono-sm strong">{loading ? '—' : fmt(total?.totalInputTokens ?? 0)}</span>}
        />
        <SettingsRow
          title="总输出 Token"
          right={<span className="mono-sm strong">{loading ? '—' : fmt(total?.totalOutputTokens ?? 0)}</span>}
        />
        <SettingsRow
          title="总费用"
          right={<span className="mono-sm strong usage-cost-value">{loading ? '—' : fmtUsd(total?.totalCostUsd ?? 0)}</span>}
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
              <span className="usage-rec-tokens mono-sm">↑{fmt(r.input_tokens)} ↓{fmt(r.output_tokens)}</span>
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
          right={<button className="btn ghost sm" onClick={loadDashboard} disabled={loading}><Icons.Refresh size={11} /> 刷新</button>}
        />
      </div>
    </div>
  )
}

/* ───────── STORAGE ───────── */
function StorageSection() {
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { invoke: getCurrentWorkspace } = useIpcInvoke('workspace:get-current')
  const { invoke: openWorkspace } = useIpcInvoke('workspace:open')
  const { invoke: closeWorkspace } = useIpcInvoke('workspace:close')
  const { invoke: openDirectory } = useIpcInvoke('dialog:open-directory')

  const refreshWorkspace = useCallback(async () => {
    const res = await getCurrentWorkspace({})
    setWorkspace(res.workspace)
  }, [getCurrentWorkspace])

  useEffect(() => {
    refreshWorkspace().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [refreshWorkspace])

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
          <SparkInput className="flex1" defaultValue="~/Library/Application Support/Spark Agent" readOnly />
          <button className="btn"><Icons.Folder size={12} /> 打开</button>
        </div>

        <label>当前工作区<span className="sub">Agent 文件工具的根目录</span></label>
        <div className="control">
          <SparkInput className="flex1" value={workspace?.rootPath ?? '未打开工作区'} readOnly />
          <button className="btn" onClick={handleOpenWorkspace}><Icons.Folder size={12} /> 选择</button>
          <button className="btn ghost" onClick={handleCloseWorkspace} disabled={workspace === null}>关闭</button>
        </div>
      </div>

      {error !== null && (
        <div className="card storage-card">
          {error}
        </div>
      )}

      <div className="subsec-h">存储用量</div>
      <div className="card">
        <UsageRow label="会话事件 (agent_events)" used="284.2 MB" pct={48} />
        <UsageRow label="文件 artifact (大文本)" used="156.8 MB" pct={26} />
        <UsageRow label="索引与缓存" used="98.4 MB" pct={17} />
        <UsageRow label="检查点快照" used="42.1 MB" pct={7} />
        <UsageRow label="日志与 trace" used="12.4 MB" pct={2} />
      </div>

      <div className="subsec-h">备份</div>
      <div className="card">
        <SettingsRow title="自动备份" desc="每日凌晨 3:00 增量备份到 Time Machine / 指定目录" right={<div className="switch on" />} />
        <SettingsRow title="备份目录" desc="~/Backups/SparkAgent" right={<button className="btn sm"><Icons.Folder size={11} /> 修改</button>} />
        <SettingsRow title="最近一次备份" desc="今天 03:00 · 成功 · 41 MB" right={<button className="btn ghost sm">查看历史</button>} />
        <SettingsRow title="导出全部数据" desc="JSONL + 文件 · 可在另一台机器导入" right={<button className="btn"><Icons.Download size={11} /> 导出</button>} />
      </div>

      <div className="subsec-h">清理</div>
      <div className="card">
        <SettingsRow title="清理 30 天前的检查点" right={<button className="btn ghost sm">运行</button>} />
        <SettingsRow title="清空全部缓存与索引" desc="下次启动会重建" right={<button className="btn ghost sm danger-btn">清空</button>} />
        <SettingsRow title="重置所有设置" desc="不影响会话与项目数据" right={<button className="btn ghost sm danger-btn">重置</button>} />
      </div>
    </div>
  )
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

/* ───────── UPDATES ───────── */
function UpdatesSection() {
  const [s, set] = usePersistedSettings(SETTINGS_UPDATES_KEY, DEFAULT_UPDATES)
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [lastChecked, setLastChecked] = useState<string | null>(() => window.localStorage.getItem('spark-updates-last-checked'))

  // Load lastChecked from IPC on mount
  useEffect(() => {
    window.spark?.invoke('settings:get', { category: 'updates', key: 'lastChecked' })
      .then((res) => {
        if (res.value != null && typeof res.value === 'string') {
          setLastChecked(res.value)
          window.localStorage.setItem('spark-updates-last-checked', res.value)
        }
      })
      .catch(() => { /* ignore */ })

    // Get initial update status
    window.spark?.invoke('update:get-status', {})
      .then((res) => {
        setStatus(res.status)
      })
      .catch(() => { /* ignore */ })
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
      window.spark?.invoke('settings:set', { category: 'updates', key: 'lastChecked', value: now })
        .catch(() => { /* ignore */ })
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
    if (isDownloading) return `正在下载 ${status?.progress != null ? `(${Math.round(status.progress.percent)}%)` : ''}`
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
        <div className={`update-icon ${getStatusClass()}`}>
          {getStatusIcon()}
        </div>
        <div className="flex1">
          <div className="strong update-version">{getStatusLabel()}</div>
          <div className="muted update-meta">
            Spark Agent {currentVersion}
            {lastChecked ? ` · 上次检查 ${lastChecked}` : ''}
          </div>
          {isDownloading && status?.progress != null && (
            <div className="update-progress-bar">
              <div className="update-progress-fill" style={{ width: `${status.progress.percent}%` }} />
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
            <button className="btn" onClick={() => void handleCheckUpdate()} disabled={isChecking || isDownloading}>
              <Icons.Refresh size={12} /> {isChecking ? '检查中…' : '检查更新'}
            </button>
          )}
        </div>
      </div>

      <div className="subsec-h">更新策略</div>
      <div className="card">
        <SettingsRow title="自动检查更新" right={<div className={`switch ${s.autoCheck ? 'on' : ''}`} onClick={() => handleSettingsChange('autoCheck', !s.autoCheck)} />} />
        <SettingsRow title="自动下载" desc="后台下载，准备好后提示安装" right={<div className={`switch ${s.autoDownload ? 'on' : ''}`} onClick={() => handleSettingsChange('autoDownload', !s.autoDownload)} />} />
        <SettingsRow title="自动安装" desc="退出应用时静默安装" right={<div className={`switch ${s.autoInstall ? 'on' : ''}`} onClick={() => handleSettingsChange('autoInstall', !s.autoInstall)} />} />
        <SettingsRow
          title="更新通道"
          right={
            <div className="select-sm">
              <SparkSelect value={s.channel} onChange={(e) => handleSettingsChange('channel', e.target.value)}>
                <option value="stable">stable</option>
                <option value="beta">beta</option>
              </SparkSelect>
            </div>
          }
        />
      </div>

      <div className="subsec-h">版本</div>
      <div className="card">
        <SettingsRow title="Spark Agent" desc={`${currentVersion}`} right={<span className={hasUpdate ? 'badge warning dot' : 'badge success dot'}>{hasUpdate ? `有新版 ${status?.updateInfo?.version}` : '最新'}</span>} />
        <SettingsRow title="Claude Agent SDK" desc="1.0.6" right={<span className="badge success dot">最新</span>} />
        <SettingsRow title="@openai/codex CLI" desc="0.4.1" right={<span className="badge warning dot">有新版 0.4.3</span>} />
        <SettingsRow title="Electron" desc="31.x" right={<span className="badge">嵌入</span>} />
      </div>
    </div>
  )
}

/* ───────── Helpers ───────── */
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
    electronVersion: string
    chromeVersion: string
    nodeVersion: string
    platform: string
    arch: string
  } | null>(null)

  useEffect(() => {
    // In Electron renderer, these are available via preload or process
    try {
      const info = {
        electronVersion: (window as unknown as Record<string, string>).electronVersion ?? '31.x',
        chromeVersion: (window as unknown as Record<string, string>).chromeVersion ?? (navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? 'unknown'),
        nodeVersion: typeof process !== 'undefined' ? process.versions.node : 'unknown',
        platform: navigator.platform ?? 'unknown',
        arch: (window as unknown as Record<string, string>).systemArch ?? 'arm64',
      }
      setSysInfo(info)
    } catch {
      setSysInfo(null)
    }
  }, [])

  return (
    <div className="settings-section">
      <div className="about-header">
        <div className="about-title">Spark Agent</div>
        <div className="about-subtitle">AI Agent 工作台</div>
        <div className="about-version">版本 0.1.0 (MVP)</div>
      </div>
      <div className="subsec-h">技术栈</div>
      <div className="card">
        <SettingsRow title="Electron" desc="桌面应用框架" right={<span className="mono-sm tech-version">{sysInfo?.electronVersion ?? '31.x'}</span>} />
        <SettingsRow title="Chromium" desc="渲染引擎" right={<span className="mono-sm tech-version">{sysInfo?.chromeVersion ?? '—'}</span>} />
        <SettingsRow title="Node.js" desc="运行时" right={<span className="mono-sm tech-version">{sysInfo?.nodeVersion ?? '—'}</span>} />
        <SettingsRow title="React" desc="UI 框架" right={<span className="mono-sm tech-version">19.x</span>} />
        <SettingsRow title="TypeScript" desc="开发语言" right={<span className="mono-sm tech-version">5.x</span>} />
        <SettingsRow title="数据库" desc="本地存储" right={<span className="mono-sm tech-version">SQLite (better-sqlite3)</span>} />
        <SettingsRow title="AI 引擎" desc="Agent Runtime" right={<span className="mono-sm tech-version">Claude / OpenAI / DeepSeek / Ollama</span>} />
      </div>

      <div className="subsec-h">系统信息</div>
      <div className="card">
        <SettingsRow title="平台" desc="操作系统" right={<span className="mono-sm tech-version">{sysInfo?.platform ?? '—'}</span>} />
        <SettingsRow title="架构" desc="CPU 架构" right={<span className="mono-sm tech-version">{sysInfo?.arch ?? '—'}</span>} />
        <SettingsRow title="User Agent" desc="浏览器标识" right={<span className="mono-sm tech-version about-user-agent">{navigator.userAgent.slice(0, 60)}…</span>} />
      </div>

      <div className="subsec-h">链接</div>
      <div className="card">
        <SettingsRow title="GitHub" desc="源代码仓库" right={<a href="https://github.com" target="_blank" rel="noreferrer" className="about-link">github.com →</a>} />
        <SettingsRow title="文档" desc="使用指南与 API 参考" right={<a href="https://docs.spark-agent.dev" target="_blank" rel="noreferrer" className="about-link">文档 →</a>} />
        <SettingsRow title="反馈" desc="问题报告与功能建议" right={<a href="https://github.com/issues" target="_blank" rel="noreferrer" className="about-link">提交 Issue →</a>} />
      </div>

      <div className="about-footer">
        © 2026 Spark Agent Team. All rights reserved.
      </div>
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
