/**
 * SettingsView — 多分类设置（通用/外观/快捷键/Provider/模型/规则/权限/MCP/Skills/工作流/遥测/存储/更新）
 *
 * 包含：左侧分组导航 + 右侧多 section 内容。Provider 编辑使用滑入面板，Profile 编辑使用 Modal。
 */
import React, { useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { Icons } from '../Icons'
import { useApp, PRIMARIES } from '../AppContext'
import { useIpcInvoke } from '../hooks/useIpc'
import { parseSkillManifest } from '../utils/skills-data'
import type {
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
} from '@spark/protocol'

type ProviderKind = 'anthropic' | 'openai'
type ProviderForm = {
  name: string
  provider: ProviderKind
  defaultModel: string
  modelIdsText: string
  endpoint: string
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
        { id: 'skills-settings', icon: <Icons.Skills />, label: 'Skills' },
        { id: 'workflows', icon: <Icons.Workflow />, label: '工作流模板' },
      ],
    },
    {
      group: '系统',
      items: [
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
    'skills-settings': SkillsSection,
    workflows: WorkflowTemplatesSection,
    telemetry: TelemetrySection,
    storage: StorageSection,
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
  return (
    <div className="settings-section">
      <h2>通用</h2>
      <div className="lede">应用启动、语言、默认行为。</div>

      <div className="form-grid">
        <label>语言<span className="sub">界面文案语言</span></label>
        <select defaultValue="zh-CN">
          <option value="zh-CN">简体中文</option>
          <option value="en-US">English (US)</option>
          <option value="ja-JP">日本語</option>
        </select>

        <label>启动行为<span className="sub">应用启动时的默认动作</span></label>
        <select defaultValue="last">
          <option value="last">恢复上次会话</option>
          <option value="home">打开 Home</option>
          <option value="last-project">打开上次项目</option>
          <option value="blank">空白会话</option>
        </select>

        <label>默认工作区<span className="sub">新建项目会话时的预选根目录</span></label>
        <div className="control">
          <input style={{ flex: 1 }} defaultValue="/Users/hayden/work" />
          <button className="btn"><Icons.Folder size={12} /> 浏览…</button>
        </div>

        <label>系统托盘<span className="sub">关闭主窗口后保留后台运行</span></label>
        <div className="switch on" />

        <label>开机自启动</label>
        <div className="switch" />

        <label>新会话默认沙箱</label>
        <div className="seg-control">
          <button>L0 仅聊天</button>
          <button>L1 只读</button>
          <button className="active">L2 受控</button>
          <button>L3 完全</button>
        </div>

        <label>未保存修改提示<span className="sub">关闭会话或退出前提示</span></label>
        <div className="switch on" />

        <label>检查点保留<span className="sub">每个会话保留多少历史检查点</span></label>
        <div className="control">
          <input type="number" defaultValue="50" style={{ width: 80 }} />
          <span className="muted" style={{ fontSize: 12 }}>个 · 超出后按时间淘汰</span>
        </div>
      </div>

      <div className="subsec-h">通知</div>
      <div className="settings-card">
        <SettingsRow title="任务完成" desc="长任务（≥30s）结束后系统通知" right={<div className="switch on" />} />
        <SettingsRow title="权限请求" desc="需要审批时弹出系统通知" right={<div className="switch on" />} />
        <SettingsRow title="工作流失败" desc="任意节点失败时通知" right={<div className="switch on" />} />
        <SettingsRow title="MCP 离线" desc="服务器连接断开时通知" right={<div className="switch" />} />
        <SettingsRow title="新版本可用" right={<div className="switch on" />} />
      </div>

      <div className="subsec-h">隐私</div>
      <div className="settings-card">
        <SettingsRow title="匿名遥测" desc="发送匿名使用与崩溃数据，帮助改进 Spark Agent" right={<div className="switch on" />} />
        <SettingsRow title="自动诊断包" desc="崩溃时自动收集脱敏诊断包（不含密钥与代码）" right={<div className="switch on" />} />
      </div>
    </div>
  )
}

/* ───────── APPEARANCE ───────── */
function AppearanceSection() {
  const { t, setTweak } = useApp()
  return (
    <div className="settings-section">
      <h2>外观</h2>
      <div className="lede">主题、密度、字体、布局。这些设置实时生效。</div>

      <div className="subsec-h">主题</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 20 }}>
        <ThemePreview kind="light" active={t.theme === 'light'} onClick={() => setTweak('theme', 'light')} />
        <ThemePreview kind="dark" active={t.theme === 'dark'} onClick={() => setTweak('theme', 'dark')} />
        <ThemePreview kind="auto" active={false} onClick={() => setTweak('theme', 'light')} disabled />
      </div>

      <div className="subsec-h">主色</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
        {Object.entries(PRIMARIES).map(([color, info]) => (
          <button
            key={color}
            onClick={() => setTweak('primary', color)}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, border: 'none', background: 'transparent', cursor: 'default' }}
          >
            <span
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: color,
                boxShadow: t.primary === color ? `0 0 0 2px var(--bg), 0 0 0 4px ${color}` : 'none',
                transition: 'box-shadow .15s',
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
              }}
            >
              {t.primary === color && <Icons.Check size={16} />}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: t.primary === color ? 600 : 400 }}>{info.name}</span>
          </button>
        ))}
        <button style={{ width: 38, height: 38, borderRadius: 10, border: '1.5px dashed var(--border-strong)', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
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
        <select defaultValue="geist">
          <option value="geist">Geist Sans + Geist Mono（推荐）</option>
          <option value="system">系统默认</option>
          <option value="ibm-plex">IBM Plex</option>
          <option value="jetbrains">JetBrains</option>
        </select>

        <label>字号<span className="sub">基础字号，其他字号按比例缩放</span></label>
        <div className="control">
          <input type="range" min="11" max="16" defaultValue="13" style={{ flex: 1 }} />
          <span className="mono-sm muted" style={{ width: 32, textAlign: 'right' }}>13px</span>
        </div>

        <label>代码字体连字<span className="sub">Geist Mono ligature 例如 =&gt; → ⇒</span></label>
        <div className="switch" />

        <label>会话默认布局</label>
        <div className="seg-control">
          <button className="active">Vibe（聊天）</button>
          <button>Workspace（编辑器）</button>
        </div>

        <label>窗口圆角</label>
        <div className="seg-control">
          <button>直角</button>
          <button className="active">柔和</button>
          <button>圆润</button>
        </div>

        <label>背景毛玻璃<span className="sub">macOS 半透明背景（性能略低）</span></label>
        <div className="switch" />

        <label>动画</label>
        <div className="seg-control">
          <button>禁用</button>
          <button>仅过渡</button>
          <button className="active">完整</button>
        </div>
      </div>

      <div className="subsec-h">聊天显示</div>
      <div className="settings-card">
        <SettingsRow title="自动折叠工具调用" desc="超过 200 行的工具结果默认折叠" right={<div className="switch on" />} />
        <SettingsRow title="行内显示 token 计数" right={<div className="switch" />} />
        <SettingsRow title="语法高亮代码块" right={<div className="switch on" />} />
        <SettingsRow
          title="时间戳格式"
          right={
            <select style={{ height: 26, width: 120, padding: '0 8px' }} defaultValue="rel">
              <option value="rel">相对时间</option>
              <option value="abs">绝对时间</option>
            </select>
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
      style={{
        border: active ? '2px solid var(--primary)' : '1px solid var(--border)',
        borderRadius: 'var(--r-lg)',
        padding: 0,
        background: 'var(--bg-soft)',
        cursor: 'default',
        opacity: disabled ? 0.5 : 1,
        overflow: 'hidden',
      }}
    >
      <div style={{ height: 88, background: c.bg, padding: 8, display: 'flex', gap: 6 }}>
        <div style={{ width: 28, background: c.soft, borderRadius: 4, display: 'flex', flexDirection: 'column', gap: 3, padding: 3 }}>
          {[1, 2, 3].map((i) => <div key={i} style={{ height: 3, background: c.muted, borderRadius: 2, opacity: 0.5 }} />)}
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ height: 5, background: c.text, borderRadius: 2, width: '60%', opacity: 0.9 }} />
          <div style={{ height: 3, background: c.muted, borderRadius: 2, width: '90%' }} />
          <div style={{ height: 3, background: c.muted, borderRadius: 2, width: '70%' }} />
          <div style={{ height: 14, background: c.accent, borderRadius: 3, width: '40%', marginTop: 'auto' }} />
        </div>
      </div>
      <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, color: 'var(--text-strong)', borderTop: '1px solid var(--border)' }}>
        <span>{kind === 'light' ? '浅色' : kind === 'dark' ? '深色' : '跟随系统'}</span>
        {active && <Icons.Check size={13} style={{ color: 'var(--primary)' }} />}
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
    <div className="settings-section" style={{ maxWidth: 820 }}>
      <h2>快捷键</h2>
      <div className="lede">所有组合可在下方搜索并自定义。Mac 使用 ⌘，其他系统替换为 Ctrl。</div>

      <div className="row" style={{ marginBottom: 12 }}>
        <div className="search-input" style={{ flex: 1, minWidth: 0 }}><Icons.Search /><input placeholder="搜索动作或按键..." /></div>
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
  const showProviderEdit = t.showProviderEdit
  const [profiles, setProfiles] = useState<ProviderProfile[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [healthMap, setHealthMap] = useState<Record<string, ProviderHealthCheckResponse>>({})

  const { invoke: listProviders } = useIpcInvoke('provider:list')
  const { invoke: deleteProvider } = useIpcInvoke('provider:delete')
  const { invoke: healthCheck } = useIpcInvoke('provider:health-check')

  const refresh = useCallback(() => {
    listProviders({}).then(r => setProfiles(r.profiles)).catch(console.error)
  }, [listProviders])

  useEffect(() => { refresh() }, [refresh])

  const handleDelete = async (id: string) => {
    if (!window.confirm('确认删除该 Provider？')) return
    await deleteProvider({ id })
    refresh()
  }

  const handleHealthCheck = async (id: string) => {
    try {
      const r = await healthCheck({ id })
      setHealthMap(prev => ({ ...prev, [id]: r }))
    } catch {
      setHealthMap(prev => ({ ...prev, [id]: { healthy: false } }))
    }
  }

  return (
    <>
      <div className="settings-section">
        <div className="row" style={{ alignItems: 'flex-end', marginBottom: 18 }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0 }}>Provider</h2>
            <div className="lede" style={{ margin: '4px 0 0' }}>配置供应商的协议格式、请求地址、鉴权和可用模型列表。每个 Provider 本身就是一份可直接运行的模型配置。</div>
          </div>
          <button className="btn primary" onClick={() => { setEditingId(null); setTweak('showProviderEdit', true) }}>
            <Icons.Plus size={12} /> 添加 Provider
          </button>
        </div>

        {profiles.length === 0 ? (
          <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            尚未配置 Provider — 点击"添加 Provider"开始
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
          onClose={() => { setTweak('showProviderEdit', false); refresh() }}
        />
      )}
    </>
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
      <div className="provider-logo" style={{ borderColor: 'transparent' }}>{logo}</div>
      <div className="provider-info">
        <div className="row" style={{ gap: 8 }}>
          <span className="name">{name}</span>
          {status === 'ok' && <span className="badge success dot">在线</span>}
          {status === 'warning' && <span className="badge warning dot">需注意</span>}
          {status === 'error' && <span className="badge danger dot">错误</span>}
          {status === 'off' && <span className="badge dot">未启用</span>}
          {status === 'unknown' && <span className="badge dot">未验证</span>}
        </div>
        <div className="desc">{desc}</div>
        {detail && <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{detail}</div>}
      </div>
      <div className="row" style={{ gap: 4, alignSelf: 'flex-start', marginTop: 6 }}>
        <button className="btn ghost sm" onClick={onEdit}><Icons.Edit size={11} /> 编辑</button>
        <button className="icon-btn" title="健康检查" onClick={onHealthCheck}><Icons.Refresh size={13} /></button>
        <button className="icon-btn" title="删除" onClick={onDelete}><Icons.X size={13} /></button>
      </div>
    </div>
  )
}

/* ───────── PROVIDER EDIT slide panel ───────── */
export function ProviderEditPanel({ profileId = null, onClose }: { profileId?: string | null; onClose: () => void }) {
  const [form, setForm] = useState<ProviderForm>({
    name: '',
    provider: 'anthropic',
    defaultModel: '',
    modelIdsText: '',
    endpoint: '',
    apiKey: '',
    isDefault: false,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const { invoke: createProvider } = useIpcInvoke('provider:create')
  const { invoke: updateProvider } = useIpcInvoke('provider:update')
  const { invoke: listProviders } = useIpcInvoke('provider:list')

  // 编辑模式：加载现有 profile
  useEffect(() => {
    if (!profileId) {
      setForm({ name: '', provider: 'anthropic', defaultModel: '', modelIdsText: '', endpoint: '', apiKey: '', isDefault: false })
      return
    }
    listProviders({}).then(r => {
      const p = r.profiles.find(x => x.id === profileId)
      if (p) {
        setForm({
          name: p.name,
          provider: normalizeProviderKind(p.provider),
          defaultModel: p.defaultModel,
          modelIdsText: joinModelIds(p.modelIds),
          endpoint: p.apiEndpoint ?? '',
          apiKey: '',
          isDefault: p.isDefault,
        })
      }
    }).catch(console.error)
  }, [listProviders, profileId])

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
        })
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm(prev => ({ ...prev, [k]: v }))

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
          {error && <div style={{ padding: '8px 12px', background: 'var(--danger-soft, rgba(239,68,68,0.1))', color: 'var(--danger)', borderRadius: 6, fontSize: 12, marginBottom: 12 }}>{error}</div>}

          <div className="subsec-h">基础</div>
          <div className="form-grid">
            <label>显示名称</label>
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="例：Anthropic · Claude" />

            <label>协议格式<span className="sub">决定使用 Anthropic 或 OpenAI 适配器</span></label>
            <select value={form.provider} onChange={e => set('provider', normalizeProviderKind(e.target.value))} disabled={!!profileId}>
              <option value="anthropic">Anthropic 格式</option>
              <option value="openai">OpenAI 格式</option>
            </select>

            <label>默认模型 ID</label>
            <input value={form.defaultModel} onChange={e => set('defaultModel', e.target.value)} placeholder="例：claude-sonnet-4-20250514" className="mono-sm" />

            <label>可用模型 ID<span className="sub">每行一个，默认模型会自动加入</span></label>
            <textarea
              value={form.modelIdsText}
              onChange={e => set('modelIdsText', e.target.value)}
              placeholder={`claude-sonnet-4-20250514\nclaude-3-5-haiku-20241022`}
              className="mono-sm"
              rows={4}
            />

            <label>Endpoint URL<span className="sub">可选，自定义请求地址</span></label>
            <input
              value={form.endpoint}
              onChange={e => set('endpoint', e.target.value)}
              placeholder={form.provider === 'anthropic' ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1'}
              className="mono-sm"
            />

            <label>默认 Provider</label>
            <div className={`switch ${form.isDefault ? 'on' : ''}`} onClick={() => set('isDefault', !form.isDefault)} />
          </div>

          <div className="subsec-h">鉴权</div>
          <div className="form-grid">
            <label>API Key{profileId && <span className="sub">留空则不更新</span>}</label>
            <input
              type="password"
              value={form.apiKey}
              onChange={e => set('apiKey', e.target.value)}
              placeholder={profileId ? '••••••••（留空不更新）' : 'sk-ant-...'}
            />
          </div>
        </div>

        <div className="slide-panel-foot">
          <span style={{ flex: 1 }} />
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

function parseModelIds(modelIdsText: string, defaultModel: string): string[] {
  const values = [defaultModel, ...modelIdsText.split(/[\n,]/)]
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
  return [...new Set(values)]
}

function joinModelIds(modelIds: string[]): string {
  return modelIds.join('\n')
}

/* ───────── PROFILE EDIT MODAL ───────── */
export function ProfileEditModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: 580, maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <div className="modal-h-icon" style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}><Icons.Brain size={18} /></div>
          <div>
            <div className="modal-title">编辑模型 Profile</div>
            <div className="modal-subtitle">Anthropic · Claude Sonnet 4.5</div>
          </div>
        </div>
        <div className="modal-body" style={{ overflow: 'auto', flex: 1 }}>
          <div className="form-grid">
            <label>显示名称</label>
            <input defaultValue="Sonnet 4.5 · 默认" />

            <label>模型 ID</label>
            <input className="mono-sm" defaultValue="claude-sonnet-4-5-20250929" />

            <label>角色<span className="sub">该 profile 适配的角色</span></label>
            <div className="row" style={{ flexWrap: 'wrap', gap: 5 }}>
              {['default', 'planner', 'coder', 'reviewer', 'fast', 'vision', 'long-context'].map((r) => (
                <span
                  key={r}
                  className={`badge ${['default', 'coder', 'reviewer'].includes(r) ? 'primary' : ''}`}
                  style={{ cursor: 'default', fontSize: 11, padding: '2px 8px', height: 22 }}
                >
                  {r}
                </span>
              ))}
            </div>

            <label>Temperature</label>
            <div className="control">
              <input type="range" min="0" max="2" step="0.1" defaultValue="0.7" style={{ flex: 1 }} />
              <span className="mono-sm muted" style={{ width: 32, textAlign: 'right' }}>0.7</span>
            </div>

            <label>最大输入 token</label>
            <input type="number" defaultValue="180000" />

            <label>最大输出 token</label>
            <input type="number" defaultValue="8192" />

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
              <span style={{ color: 'var(--text-muted)' }}>$</span>
              <input type="number" defaultValue="5.00" step="0.50" style={{ flex: 1 }} />
              <span className="muted" style={{ fontSize: 12 }}>USD · 超出后切换到 fallback</span>
            </div>

            <label>超时</label>
            <div className="control">
              <input type="number" defaultValue="120" style={{ flex: 1 }} />
              <span className="muted" style={{ fontSize: 12 }}>秒</span>
            </div>

            <label>Fallback 链<span className="sub">主模型失败或超限时按顺序尝试</span></label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="row" style={{ padding: '6px 8px', background: 'var(--bg-soft)', borderRadius: 6, border: '1px solid var(--border)', gap: 8 }}>
                <span className="mono-sm faint">1.</span>
                <Icons.Brain size={13} style={{ color: 'var(--primary)' }} />
                <span className="strong" style={{ fontSize: 12 }}>Claude Opus 4</span>
                <span className="badge" style={{ fontSize: 9.5, marginLeft: 'auto' }}>当延迟 &gt; 5s</span>
                <button className="icon-btn" style={{ width: 20, height: 20 }}><Icons.X size={11} /></button>
              </div>
              <div className="row" style={{ padding: '6px 8px', background: 'var(--bg-soft)', borderRadius: 6, border: '1px solid var(--border)', gap: 8 }}>
                <span className="mono-sm faint">2.</span>
                <Icons.Brain size={13} style={{ color: 'var(--primary)' }} />
                <span className="strong" style={{ fontSize: 12 }}>Claude Haiku 4.5</span>
                <span className="badge" style={{ fontSize: 9.5, marginLeft: 'auto' }}>当成本超限</span>
                <button className="icon-btn" style={{ width: 20, height: 20 }}><Icons.X size={11} /></button>
              </div>
              <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }}><Icons.Plus size={11} /> 添加 fallback</button>
            </div>

            <label>启用</label>
            <div className="switch on" />
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn danger sm">删除 Profile</button>
          <div style={{ flex: 1 }} />
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
      <div className="row" style={{ alignItems: 'flex-end', marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0 }}>模型管理</h2>
          <div className="lede" style={{ margin: '4px 0 0' }}>按 Provider 分组管理可用模型，可启用/禁用或添加自定义模型。</div>
        </div>
        <span className="badge primary dot">共 {models.length} 个</span>
      </div>

      {error && (
        <div style={{ padding: '8px 12px', background: 'var(--danger-soft, rgba(239,68,68,0.1))', color: 'var(--danger)', borderRadius: 6, fontSize: 12, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {loading && (
        <div className="card" style={{ padding: 18, color: 'var(--text-muted)', fontSize: 12 }}>正在加载...</div>
      )}

      {!loading && providers.length === 0 && (
        <div className="card" style={{ padding: 18, color: 'var(--text-muted)', fontSize: 12 }}>
          暂无 Provider。请先在 Provider 页面添加。
        </div>
      )}

      {!loading && byProvider.map(({ provider, models: pModels }) => (
        <div key={provider.id} className="card" style={{ marginBottom: 12, padding: '12px 14px' }}>
          <div className="row" style={{ marginBottom: 8, gap: 8 }}>
            <span className="strong">{provider.name}</span>
            <span className="badge" style={{ fontSize: 10 }}>{provider.provider}</span>
            <span className="flex1" />
            <button className="btn ghost sm" onClick={() => { setAddingForProvider(provider.id); setNewModelName('') }}>
              <Icons.Plus size={11} /> 添加
            </button>
          </div>

          {addingForProvider === provider.id && (
            <div className="row" style={{ gap: 6, marginBottom: 8 }}>
              <input
                className="input"
                style={{ flex: 1, fontSize: 12 }}
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
            <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 0' }}>暂无模型</div>
          )}

          {pModels.map((m) => (
            <div key={m.id} className="row" style={{ padding: '6px 0', gap: 8, borderTop: '1px solid var(--border-subtle, rgba(0,0,0,0.06))' }}>
              <span className="mono-sm" style={{ flex: 1, fontSize: 12 }}>{m.name}</span>
              <div
                className={`switch${m.enabled ? ' on' : ''}`}
                onClick={() => void handleToggle(m)}
                style={{ cursor: 'pointer' }}
              />
              <button className="icon-btn" title="删除" onClick={() => void handleDelete(m.id)}><Icons.X size={12} /></button>
            </div>
          ))}
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

        <div className="row" style={{ marginBottom: 16, padding: '10px 12px', background: 'var(--primary-soft)', borderRadius: 'var(--r-md)', gap: 10, border: '1px solid var(--border)' }}>
          <Icons.Brain size={14} style={{ color: 'var(--primary)', flexShrink: 0 }} />
          <div className="flex1" style={{ fontSize: 12.5 }}>
            <strong>当前生效</strong> · {activeCount} 条启用规则来自 {RULE_LAYER_META.length} 个作用域
          </div>
          <button className="btn sm primary" onClick={refresh}><Icons.Refresh size={11} /> 刷新</button>
        </div>

        {error && (
          <div style={{ padding: '8px 12px', background: 'var(--danger-soft, rgba(239,68,68,0.1))', color: 'var(--danger)', borderRadius: 6, fontSize: 12, marginBottom: 12 }}>
            {error}
          </div>
        )}

        {loading ? (
          <div className="card" style={{ padding: 18, color: 'var(--text-muted)', fontSize: 12 }}>
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
        <span className="badge" style={{ background: badgeColor + '20', color: badgeColor, borderColor: 'transparent' }}>{badge}</span>
        <div>
          <span className="name">{scope}</span>
          <span className="desc"> · {desc}</span>
        </div>
        <div style={{ flex: 1 }} />
        {readOnly && <span className="badge" style={{ fontSize: 10 }}>只读</span>}
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
              className={`switch ${rule.enabled ? 'on' : ''}`}
              style={{ width: 28, height: 16, flexShrink: 0 }}
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
          {error && <div style={{ padding: '8px 12px', background: 'var(--danger-soft, rgba(239,68,68,0.1))', color: 'var(--danger)', borderRadius: 6, fontSize: 12, marginBottom: 12 }}>{error}</div>}

          <div className="subsec-h">规则</div>
          <div className="form-grid">
            <label>名称</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例：代码风格" />

            <label>优先级<span className="sub">数字越大越优先</span></label>
            <input type="number" value={priority} onChange={(e) => setPriority(Number(e.target.value))} />

            <label>内容</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="输入要注入到 Agent prompt 的规则内容"
              style={{ minHeight: 150, resize: 'vertical' }}
            />
          </div>
        </div>

        <div className="slide-panel-foot">
          <span style={{ flex: 1 }} />
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
type McpSettingsDraft = {
  name: string
  scope: string
  type: 'stdio' | 'sse'
  command: string
  endpoint: string
}

type McpSettingsConfig = {
  transport?: 'stdio' | 'http' | 'sse'
  command?: string
  url?: string
  tools?: string[]
}

function parseMcpConfig(configJson: string): McpSettingsConfig {
  try {
    return JSON.parse(configJson) as McpSettingsConfig
  } catch {
    return {}
  }
}

function formatMcpServerDesc(server: McpServerItem): string {
  const config = parseMcpConfig(server.configJson)
  const type = config.transport ?? 'stdio'
  const endpoint = type === 'stdio' ? config.command : config.url
  const tools = config.tools?.length != null && config.tools.length > 0 ? ` · ${config.tools.length} tools` : ''
  return `${server.scope} · ${type} · ${endpoint ?? '未配置'}${tools}`
}

function McpSection() {
  const [servers, setServers] = useState<McpServerItem[]>([])
  const [showAddForm, setShowAddForm] = useState(false)
  const [draft, setDraft] = useState<McpSettingsDraft>({
    name: '',
    scope: 'user',
    type: 'stdio',
    command: '',
    endpoint: '',
  })
  const [error, setError] = useState('')
  const { invoke: listMcp, loading } = useIpcInvoke('mcp:list')
  const { invoke: createMcp } = useIpcInvoke('mcp:create')
  const { invoke: updateMcp } = useIpcInvoke('mcp:update')
  const { invoke: deleteMcp } = useIpcInvoke('mcp:delete')

  const refresh = useCallback(() => {
    setError('')
    listMcp({})
      .then((res) => setServers(res.servers))
      .catch((err) => setError(err instanceof Error ? err.message : '加载 MCP 服务器失败'))
  }, [listMcp])

  useEffect(() => {
    refresh()
  }, [refresh])

  const resetDraft = () => {
    setDraft({ name: '', scope: 'user', type: 'stdio', command: '', endpoint: '' })
    setShowAddForm(false)
  }

  const addServer = async () => {
    const name = draft.name.trim()
    const command = draft.command.trim()
    const endpoint = draft.endpoint.trim()
    if (name.length === 0) return
    if (draft.type === 'stdio' && command.length === 0) return
    if (draft.type === 'sse' && endpoint.length === 0) return

    const config: McpSettingsConfig = {
      transport: draft.type,
      tools: [],
      ...(draft.type === 'stdio' ? { command } : { endpoint }),
    }
    await createMcp({
      name,
      scope: draft.scope,
      configJson: JSON.stringify(draft.type === 'stdio' ? config : { transport: draft.type, url: endpoint, tools: [] }),
      enabled: true,
    })
    resetDraft()
    refresh()
  }

  const removeServer = async (id: string) => {
    await deleteMcp({ id })
    refresh()
  }

  const toggleServer = async (server: McpServerItem) => {
    await updateMcp({ id: server.id, enabled: !server.enabled })
    refresh()
  }

  const activeCount = servers.filter((server) => server.enabled).length

  return (
    <div className="settings-section">
      <div className="row" style={{ alignItems: 'flex-end', marginBottom: 18 }}>
        <div className="flex1">
          <h2 style={{ margin: 0 }}>MCP 服务器</h2>
          <div className="lede" style={{ margin: '4px 0 0' }}>配置 Model Context Protocol 服务器，为 Agent 提供外部工具和数据源。</div>
        </div>
        <span className="badge primary dot">{activeCount} / {servers.length} 已连接</span>
      </div>

      {error && <div style={{ padding: '8px 12px', background: 'var(--danger-soft, rgba(239,68,68,0.1))', color: 'var(--danger)', borderRadius: 6, fontSize: 12, marginBottom: 12 }}>{error}</div>}

      <div className="card">
        {loading ? (
          <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)', fontSize: 12 }}>正在加载 MCP 服务器...</div>
        ) : servers.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
            <Icons.MCP size={24} />
            <div className="strong" style={{ marginTop: 10, color: 'var(--text)' }}>暂无 MCP 服务器</div>
            <div style={{ fontSize: 11, marginTop: 4 }}>添加 MCP 服务器以扩展 Agent 的工具能力</div>
          </div>
        ) : (
          servers.map((server) => (
            <SettingsRow
              key={server.id}
              title={server.name}
              desc={formatMcpServerDesc(server)}
              right={
                <div className="row" style={{ gap: 4 }}>
                  <span className={`badge ${server.enabled ? 'success' : 'danger'} dot`}>
                    {server.enabled ? '已启用' : '已禁用'}
                  </span>
                  <button className="btn ghost sm" onClick={() => void toggleServer(server)}>
                    {server.enabled ? '禁用' : '启用'}
                  </button>
                  <button className="icon-btn" title="删除" onClick={() => void removeServer(server.id)}>
                    <Icons.Trash size={11} />
                  </button>
                </div>
              }
            />
          ))
        )}
      </div>

      {showAddForm ? (
        <div className="card" style={{ marginTop: 12, padding: 14 }}>
          <div className="subsec-h" style={{ marginTop: 0 }}>添加 MCP 服务器</div>
          <div className="form-grid">
            <label>名称</label>
            <input value={draft.name} onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))} placeholder="例：filesystem" />

            <label>作用域</label>
            <select value={draft.scope} onChange={(e) => setDraft((prev) => ({ ...prev, scope: e.target.value }))}>
              <option value="system">system</option>
              <option value="user">user</option>
              <option value="team">team</option>
              <option value="project">project</option>
              <option value="session">session</option>
            </select>

            <label>类型</label>
            <select value={draft.type} onChange={(e) => setDraft((prev) => ({ ...prev, type: e.target.value === 'sse' ? 'sse' : 'stdio' }))}>
              <option value="stdio">stdio</option>
              <option value="sse">sse</option>
            </select>

            <label>{draft.type === 'stdio' ? '启动命令' : 'Endpoint'}</label>
            <input
              className="mono-sm"
              value={draft.type === 'stdio' ? draft.command : draft.endpoint}
              onChange={(e) => {
                const value = e.target.value
                setDraft((prev) => draft.type === 'stdio' ? { ...prev, command: value } : { ...prev, endpoint: value })
              }}
              placeholder={draft.type === 'stdio' ? 'npx -y @modelcontextprotocol/server-filesystem .' : 'https://mcp.example.com/sse'}
            />
          </div>
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <button className="btn primary sm" onClick={() => void addServer()}><Icons.Plus size={11} /> 添加</button>
            <button className="btn ghost sm" onClick={resetDraft}>取消</button>
          </div>
        </div>
      ) : (
        <button className="btn ghost sm" style={{ marginTop: 12 }} onClick={() => setShowAddForm(true)}>
          <Icons.Plus size={11} /> 添加 MCP 服务器
        </button>
      )}
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
      <div className="lede">管理 Agent 可使用的技能模块。启用或禁用会影响 Agent 在对话中可调用的能力。</div>

      {error && <div style={{ padding: '8px 12px', background: 'var(--danger-soft, rgba(239,68,68,0.1))', color: 'var(--danger)', borderRadius: 6, fontSize: 12, marginBottom: 12 }}>{error}</div>}

      <div className="card">
        {loading ? (
          <div style={{ padding: 18, color: 'var(--text-muted)', fontSize: 12 }}>正在加载 Skills...</div>
        ) : skills.map((skill) => {
          const meta = parseSkillManifest(skill.manifestJson)
          return (
            <SettingsRow
              key={skill.id}
              title={skill.name}
              desc={`${meta.desc} · ${meta.source} · ${skill.version}`}
              right={
                <div
                  className={`switch ${skill.enabled ? 'on' : ''}`}
                  onClick={() => void toggleSkill(skill)}
                />
              }
            />
          )
        })}
      </div>

      <div style={{ marginTop: 16, color: 'var(--text-muted)', fontSize: 'var(--font-xs)' }}>
        Skill 配置保存在本地 SQLite。自定义 Skill 安装将在后续版本支持。
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
      <div className="row" style={{ alignItems: 'flex-end', marginBottom: 18 }}>
        <div className="flex1">
          <h2 style={{ margin: 0 }}>工作流模板</h2>
          <div className="lede" style={{ margin: '4px 0 0' }}>管理共享 DAG 模板与版本。模板会作为 Workflow 页创建新流程时的起点。</div>
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
        <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '8px 0' }}>加载中…</div>
      ) : (
        <div className="row" style={{ gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
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
                  <input
                    type="radio"
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
            <select style={{ height: 26, padding: '0 8px' }} defaultValue="90">
              <option value="30">30 天</option>
              <option value="90">90 天</option>
              <option value="365">1 年</option>
              <option value="forever">永久</option>
            </select>
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
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px',
        border: active ? '1.5px solid var(--primary)' : '1px solid var(--border)',
        borderRadius: 'var(--r-md)',
        background: active ? 'var(--primary-soft)' : 'var(--panel)',
        cursor: 'default',
        minWidth: 180,
        textAlign: 'left',
      }}
    >
      <span style={{
        width: 28, height: 28, borderRadius: 6,
        background: active ? 'var(--primary)' : 'var(--bg-soft)',
        color: active ? '#fff' : 'var(--text-muted)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>{icon}</span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: active ? 'var(--primary)' : 'var(--text-strong)' }}>{name}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{desc}</div>
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
      <select defaultValue={scope} style={{ width: '100%' }}>
        <option>工作区内</option><option>本会话</option><option>本项目</option><option>任意</option>
        <option>profile 内</option><option>按 server</option><option>域名白名单</option>
      </select>
      <select value={mode} onChange={(e) => onModeChange?.(e.target.value as PermissionMode)} style={{ width: '100%' }}>
        <option value="allow">允许</option>
        <option value="ask">询问</option>
        <option value="ask-twice">双重确认</option>
        <option value="deny">拒绝</option>
      </select>
    </div>
  )
}

/* ───────── TELEMETRY ───────── */
function TelemetrySection() {
  return (
    <div className="settings-section">
      <h2>遥测与日志</h2>
      <div className="lede">观察会话、工作流与 Agent 内部行为；导出诊断包帮助调试。</div>

      <div className="form-grid">
        <label>本地日志级别</label>
        <select defaultValue="info">
          <option value="error">error</option>
          <option value="warn">warn</option>
          <option value="info">info</option>
          <option value="debug">debug</option>
          <option value="trace">trace</option>
        </select>

        <label>OpenTelemetry endpoint<span className="sub">可选 — 把 trace 转发到 collector</span></label>
        <input placeholder="https://otlp.example.com:4318 (可选)" />

        <label>Trace 采样率</label>
        <div className="control">
          <input type="range" min="0" max="100" defaultValue="100" style={{ flex: 1 }} />
          <span className="mono-sm muted" style={{ width: 42, textAlign: 'right' }}>100%</span>
        </div>

        <label>本地保留 trace 天数</label>
        <input type="number" defaultValue="14" style={{ maxWidth: 80 }} />
      </div>

      <div className="subsec-h">最近运行</div>
      <div className="card">
        <SettingsRow title="代码功能开发：搜索优化" desc="Run #4f3a · 5 agent · 4m 38s · $0.92" right={<button className="btn ghost sm"><Icons.Eye size={11} /> 查看 trace</button>} />
        <SettingsRow title="重构 auth 模块为 OAuth 2.1" desc="Run #41b8 · 1 agent · 6m 12s · $1.34" right={<button className="btn ghost sm"><Icons.Eye size={11} /> 查看 trace</button>} />
        <SettingsRow title="MCP gateway 性能调优" desc="Run #38c0 · 1 agent · 失败" right={<button className="btn ghost sm" style={{ color: 'var(--danger)' }}><Icons.Eye size={11} /> 查看错误</button>} />
      </div>

      <div className="subsec-h">诊断包</div>
      <div className="card">
        <SettingsRow title="生成诊断包" desc="包含 app/OS 版本、provider 健康、近期错误日志，自动脱敏" right={<button className="btn"><Icons.Download size={11} /> 生成</button>} />
        <SettingsRow title="复制最近一次错误" desc="便于发到 GitHub Issue" right={<button className="btn ghost sm"><Icons.Copy size={11} /> 复制</button>} />
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
          <input style={{ flex: 1 }} defaultValue="~/Library/Application Support/Spark Agent" readOnly />
          <button className="btn"><Icons.Folder size={12} /> 打开</button>
        </div>

        <label>当前工作区<span className="sub">Agent 文件工具的根目录</span></label>
        <div className="control">
          <input style={{ flex: 1 }} value={workspace?.rootPath ?? '未打开工作区'} readOnly />
          <button className="btn" onClick={handleOpenWorkspace}><Icons.Folder size={12} /> 选择</button>
          <button className="btn ghost" onClick={handleCloseWorkspace} disabled={workspace === null}>关闭</button>
        </div>
      </div>

      {error !== null && (
        <div className="card" style={{ padding: '10px 14px', marginTop: 12, color: 'var(--danger)' }}>
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
        <SettingsRow title="清空全部缓存与索引" desc="下次启动会重建" right={<button className="btn ghost sm" style={{ color: 'var(--danger)' }}>清空</button>} />
        <SettingsRow title="重置所有设置" desc="不影响会话与项目数据" right={<button className="btn ghost sm" style={{ color: 'var(--danger)' }}>重置</button>} />
      </div>
    </div>
  )
}

function UsageRow({ label, used, pct }: { label: string; used: string; pct: number }) {
  return (
    <div className="settings-card-row" style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div className="row">
        <span style={{ fontSize: 'var(--font-sm)', color: 'var(--text)' }}>{label}</span>
        <span style={{ flex: 1 }} />
        <span className="mono-sm strong">{used}</span>
        <span className="mono-sm faint" style={{ width: 42, textAlign: 'right' }}>{pct}%</span>
      </div>
      <div style={{ height: 4, background: 'var(--bg-soft)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--primary)' }} />
      </div>
    </div>
  )
}

/* ───────── UPDATES ───────── */
function UpdatesSection() {
  return (
    <div className="settings-section">
      <h2>更新</h2>
      <div className="lede">保持 Spark Agent 最新版本以获得最新模型与安全修复。</div>

      <div className="card" style={{ padding: '20px', display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
        <div style={{
          width: 48, height: 48, borderRadius: 12,
          background: 'var(--success-bg)', color: 'var(--success)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}><Icons.CheckCircle size={26} /></div>
        <div className="flex1">
          <div className="strong" style={{ fontSize: 15 }}>已是最新版本</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>Spark Agent 0.2.4 · 上次检查 12 分钟前</div>
        </div>
        <button className="btn"><Icons.Refresh size={12} /> 检查更新</button>
      </div>

      <div className="subsec-h">更新策略</div>
      <div className="card">
        <SettingsRow title="自动检查更新" right={<div className="switch on" />} />
        <SettingsRow title="自动下载" desc="后台下载，准备好后提示安装" right={<div className="switch on" />} />
        <SettingsRow title="自动安装" desc="退出应用时静默安装" right={<div className="switch" />} />
        <SettingsRow
          title="更新通道"
          right={
            <select style={{ height: 26, padding: '0 8px' }} defaultValue="stable">
              <option value="stable">stable</option>
              <option value="beta">beta</option>
              <option value="nightly">nightly</option>
            </select>
          }
        />
      </div>

      <div className="subsec-h">版本</div>
      <div className="card">
        <SettingsRow title="应用" desc="0.2.4 · 2026-05-20" right={<button className="btn ghost sm">更新日志</button>} />
        <SettingsRow title="Claude Agent SDK" desc="1.0.6" right={<span className="badge success dot">最新</span>} />
        <SettingsRow title="@openai/codex CLI" desc="0.4.1" right={<span className="badge warning dot">有新版 0.4.3</span>} />
        <SettingsRow title="Electron" desc="33.0.2" right={<span className="badge">嵌入</span>} />
      </div>
    </div>
  )
}

/* ───────── Helpers ───────── */
function SettingsRow({ title, desc, right }: { title: string; desc?: string; right: ReactNode }) {
  return (
    <div className="settings-card-row">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row-title">{title}</div>
        {desc && <div className="row-desc">{desc}</div>}
      </div>
      <div className="row-action">{right}</div>
    </div>
  )
}

function AboutSection() {
  return (
    <div className="settings-section">
      <div style={{ textAlign: 'center', padding: '32px 0 24px' }}>
        <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--text)' }}>Spark Agent</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>AI Agent 工作台</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>版本 0.1.0 (MVP)</div>
      </div>
      <div className="card">
        <SettingsRow title="Electron" desc="桌面应用框架" right={<span className="mono-sm" style={{ fontSize: 11 }}>33.x</span>} />
        <SettingsRow title="React" desc="UI 框架" right={<span className="mono-sm" style={{ fontSize: 11 }}>19.x</span>} />
        <SettingsRow title="TypeScript" desc="开发语言" right={<span className="mono-sm" style={{ fontSize: 11 }}>5.x</span>} />
        <SettingsRow title="数据库" desc="本地存储" right={<span className="mono-sm" style={{ fontSize: 11 }}>SQLite (better-sqlite3)</span>} />
        <SettingsRow title="AI 引擎" desc="Agent Runtime" right={<span className="mono-sm" style={{ fontSize: 11 }}>Claude / OpenAI / DeepSeek / Ollama</span>} />
      </div>
      <div style={{ textAlign: 'center', padding: 16, color: 'var(--text-muted)', fontSize: 11 }}>
        © 2026 Spark Agent Team. All rights reserved.
      </div>
    </div>
  )
}

function PlaceholderSection({ name, hint }: { name: string; hint?: string }) {
  return (
    <div className="settings-section" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: 'var(--text-muted)' }}>
      <div className="col" style={{ alignItems: 'center', gap: 8 }}>
        <Icons.Settings size={32} className="faint" />
        <div className="strong">{name}</div>
        {hint && <div className="muted" style={{ fontSize: 'var(--font-sm)' }}>{hint}</div>}
      </div>
    </div>
  )
}
