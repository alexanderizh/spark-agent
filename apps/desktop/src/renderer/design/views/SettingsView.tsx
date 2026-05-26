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
import type { ProviderHealthCheckResponse, ProviderProfile, ProviderUpdateRequest, WorkspaceInfo } from '@spark/protocol'

type ProviderKind = 'anthropic' | 'openai' | 'deepseek' | 'ollama' | 'openai-compatible'
type ProviderForm = {
  name: string
  provider: ProviderKind
  model: string
  endpoint: string
  apiKey: string
  isDefault: boolean
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
        { id: 'models', icon: <Icons.Brain />, label: '模型 Profile' },
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
      ],
    },
  ]

  const Section: Record<string, () => React.ReactElement> = {
    general: GeneralSection,
    appearance: AppearanceSection,
    shortcuts: ShortcutsSection,
    providers: ProvidersSection,
    models: ModelsSection,
    rules: RulesSection,
    permissions: PermissionsSection,
    'mcp-settings': () => <PlaceholderSection name="MCP 配置" hint="服务器与作用域细节在主菜单 MCP 页面管理" />,
    'skills-settings': () => <PlaceholderSection name="Skills 配置" hint="Skill 安装与作用域在主菜单 Skills 页面管理" />,
    workflows: () => <PlaceholderSection name="工作流模板" hint="管理共享 DAG 模板与版本" />,
    telemetry: TelemetrySection,
    storage: StorageSection,
    updates: UpdatesSection,
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
            <div className="lede" style={{ margin: '4px 0 0' }}>配置 LLM 提供商。每个 provider 包含多个模型 profile，由 agent/workflow/session 按角色绑定。</div>
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
                desc={`${p.provider} · ${p.model}`}
                status={status}
                detail={h?.latencyMs != null ? `延迟 ${h.latencyMs}ms` : p.isDefault ? '默认 Profile' : ''}
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
    model: '',
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
      setForm({ name: '', provider: 'anthropic', model: '', endpoint: '', apiKey: '', isDefault: false })
      return
    }
    listProviders({}).then(r => {
      const p = r.profiles.find(x => x.id === profileId)
      if (p) {
        setForm({
          name: p.name,
          provider: normalizeProviderKind(p.provider),
          model: p.model,
          endpoint: p.apiEndpoint ?? '',
          apiKey: '',
          isDefault: p.isDefault,
        })
      }
    }).catch(console.error)
  }, [listProviders, profileId])

  const handleSave = async () => {
    if (!form.name.trim() || !form.model.trim()) { setError('名称和模型 ID 不能为空'); return }
    if (!profileId && !form.apiKey.trim()) { setError('新建 Provider 需要填写 API Key'); return }
    setSaving(true); setError('')
    try {
      const endpoint = form.endpoint.trim()
      const usesCustomEndpoint = form.provider === 'ollama' || form.provider === 'openai-compatible'
      if (profileId) {
        const req: ProviderUpdateRequest = {
          id: profileId,
          name: form.name.trim(),
          model: form.model.trim(),
          isDefault: form.isDefault,
          apiEndpoint: endpoint.length > 0 ? endpoint : null,
        }
        if (form.apiKey.trim()) req.apiKey = form.apiKey
        await updateProvider(req)
      } else {
        await createProvider({
          name: form.name.trim(),
          provider: form.provider,
          model: form.model.trim(),
          apiKey: form.apiKey,
          isDefault: form.isDefault,
          ...(usesCustomEndpoint && endpoint.length > 0 && { apiEndpoint: endpoint }),
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

            <label>Provider 类型<span className="sub">决定使用哪个 adapter</span></label>
            <select value={form.provider} onChange={e => set('provider', normalizeProviderKind(e.target.value))} disabled={!!profileId}>
              <option value="anthropic">Claude Agent SDK</option>
              <option value="openai">OpenAI Responses API</option>
              <option value="deepseek">DeepSeek</option>
              <option value="ollama">Ollama (本地)</option>
              <option value="openai-compatible">OpenAI 兼容</option>
            </select>

            <label>模型 ID</label>
            <input value={form.model} onChange={e => set('model', e.target.value)} placeholder="例：claude-sonnet-4-5-20250929" className="mono-sm" />

            {(form.provider === 'ollama' || form.provider === 'openai-compatible') && (
              <>
                <label>Endpoint URL<span className="sub">兼容 OpenAI 的 base URL</span></label>
                <input
                  value={form.endpoint}
                  onChange={e => set('endpoint', e.target.value)}
                  placeholder={form.provider === 'ollama' ? 'http://localhost:11434/v1' : 'https://api.example.com/v1'}
                  className="mono-sm"
                />
              </>
            )}

            <label>默认 Profile</label>
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
  if (
    value === 'anthropic' ||
    value === 'openai' ||
    value === 'deepseek' ||
    value === 'ollama' ||
    value === 'openai-compatible'
  ) {
    return value
  }
  return 'anthropic'
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
  const [profiles, setProfiles] = useState<ProviderProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showEditor, setShowEditor] = useState(false)
  const { invoke: listProviders } = useIpcInvoke('provider:list')
  const { invoke: deleteProvider } = useIpcInvoke('provider:delete')

  const refresh = useCallback(() => {
    setLoading(true)
    setError('')
    listProviders({})
      .then((res) => setProfiles(res.profiles))
      .catch((err) => setError(err instanceof Error ? err.message : '加载模型 Profile 失败'))
      .finally(() => setLoading(false))
  }, [listProviders])

  useEffect(() => { refresh() }, [refresh])

  const filteredProfiles = profiles.filter((profile) => {
    const keyword = query.trim().toLowerCase()
    if (keyword.length === 0) return true
    return [profile.name, profile.provider, profile.model, profile.apiEndpoint ?? '']
      .some((value) => value.toLowerCase().includes(keyword))
  })

  const handleDelete = async (id: string) => {
    if (!window.confirm('确认删除该模型 Profile？关联会话将无法继续使用这个 Provider。')) return
    await deleteProvider({ id })
    refresh()
  }

  return (
    <>
      <div className="settings-section">
        <div className="row" style={{ alignItems: 'flex-end', marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0 }}>模型 Profile</h2>
            <div className="lede" style={{ margin: '4px 0 0' }}>每个 profile 绑定到 provider，并附加角色、参数与 fallback 链。</div>
          </div>
          <div className="search-input"><Icons.Search /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索 profile..." /></div>
          <button className="btn primary" onClick={() => { setEditingId(null); setShowEditor(true) }}><Icons.Plus size={12} /> 新建 Profile</button>
        </div>

        <div className="row" style={{ gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          <span className="badge primary dot">全部 {profiles.length}</span>
          <span className="badge">default</span>
          <span className="badge">chat</span>
          <span className="badge">coder</span>
        </div>

        {error && (
          <div style={{ padding: '8px 12px', background: 'var(--danger-soft, rgba(239,68,68,0.1))', color: 'var(--danger)', borderRadius: 6, fontSize: 12, marginBottom: 12 }}>
            {error}
          </div>
        )}

        {loading && (
          <div className="card" style={{ padding: 18, color: 'var(--text-muted)', fontSize: 12 }}>
            正在加载模型 Profile...
          </div>
        )}

        {!loading && profiles.length === 0 && (
          <div className="card" style={{ padding: 18, color: 'var(--text-muted)', fontSize: 12 }}>
            暂无模型 Profile。请先在 Provider 页面添加一个 Provider。
          </div>
        )}

        {!loading && profiles.length > 0 && filteredProfiles.length === 0 && (
          <div className="card" style={{ padding: 18, color: 'var(--text-muted)', fontSize: 12 }}>
            没有匹配的模型 Profile。
          </div>
        )}

        {!loading && filteredProfiles.map((profile) => (
          <ModelRowFull
            key={profile.id}
            profile={profile}
            onEdit={() => { setEditingId(profile.id); setShowEditor(true) }}
            onDelete={() => handleDelete(profile.id)}
          />
        ))}
      </div>

      {showEditor && (
        <ProviderEditPanel
          profileId={editingId}
          onClose={() => { setShowEditor(false); refresh() }}
        />
      )}
    </>
  )
}

function ModelRowFull({ profile, onEdit, onDelete }: { profile: ProviderProfile; onEdit: () => void; onDelete: () => void }) {
  const roles = profile.isDefault ? ['default', 'chat'] : ['chat']
  const ctx = profile.apiEndpoint ?? '由 Provider 配置'
  return (
    <div className="model-row" style={{ padding: '12px 14px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
        <div className="row" style={{ gap: 8 }}>
          <span className="strong" style={{ fontSize: 'var(--font-base)' }}>{profile.name}</span>
          <span className="mono-sm faint" style={{ fontSize: 11 }}>· {profile.model}</span>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className="badge" style={{ fontSize: 10 }}>{profile.provider}</span>
          {roles.map((r) => <span key={r} className="badge primary" style={{ fontSize: 10 }}>{r}</span>)}
          <span className="mono-sm muted" style={{ fontSize: 11, marginLeft: 6 }}>T=0.7 · {ctx}</span>
        </div>
      </div>
      <div className="switch on" />
      <button className="btn ghost sm" onClick={onEdit}><Icons.Edit size={11} /> 编辑</button>
      <button className="icon-btn" title="删除" onClick={onDelete}><Icons.X size={13} /></button>
    </div>
  )
}

/* ───────── RULES ───────── */
function RulesSection() {
  return (
    <div className="settings-section">
      <h2>规则</h2>
      <div className="lede">多层规则按优先级合成为有效 prompt 注入。下方按层级展示来源，并显示冲突与覆盖。</div>

      <div className="row" style={{ marginBottom: 16, padding: '10px 12px', background: 'var(--primary-soft)', borderRadius: 'var(--r-md)', gap: 10, border: '1px solid var(--border)' }}>
        <Icons.Brain size={14} style={{ color: 'var(--primary)', flexShrink: 0 }} />
        <div className="flex1" style={{ fontSize: 12.5 }}>
          <strong>当前生效</strong> · 32 条来自 5 个作用域 · 检测到 1 处冲突，已按优先级解析
        </div>
        <button className="btn sm primary"><Icons.Eye size={11} /> 预览合成结果</button>
      </div>

      <RuleLayer scope="System" badge="SYS" badgeColor="#94a3b8" desc="应用内置 · 不可删除" rules={[
        { src: 'safety.md', txt: '禁止 rm -rf 根路径、~/、.ssh/', marker: 'win' },
        { src: 'safety.md', txt: '禁止上传完整文件到外部服务，除非用户显式确认' },
        { src: 'safety.md', txt: '永不在 prompt 中明文显示 secret 引用' },
      ]} />

      <RuleLayer scope="Team" badge="TEAM" badgeColor="#8b5cf6" desc="团队管理员发布 · 8 条" rules={[
        { src: 'team/coding-style.md', txt: '所有 TS 文件用 tabWidth=2，使用 import type' },
        { src: 'team/testing.md', txt: '测试覆盖率 ≥ 80%，新增模块必须包含集成测试' },
        { src: 'team/security.md', txt: '高风险 git 操作（force push、强制 rebase）需双人审批' },
      ]} />

      <RuleLayer scope="User" badge="USER" badgeColor="#10b981" desc="用户全局偏好" rules={[
        { src: '~/.spark/rules/style.md', txt: '回答用简洁中文，代码注释用英文' },
        { src: '~/.spark/rules/style.md', txt: '优先小步提交，每个 commit 不超过 200 行' },
        { src: '~/.spark/rules/tools.md', txt: '默认禁用 web fetch；调用前必须解释目的', marker: 'lose', overridden: true },
      ]} />

      <RuleLayer scope="Project" badge="PROJ" badgeColor="#f97316" desc=".spark/rules/ · spark-agent" rules={[
        { src: '.spark/rules/project.md', txt: '本仓库使用 pnpm workspace；不要切换到 npm/yarn' },
        { src: '.spark/rules/project.md', txt: '测试用 vitest，不要引入 jest（仍保留 legacy 目录）' },
        { src: 'AGENTS.md', txt: 'TypeScript 严格模式，禁用 any 与 enum，使用 const 对象' },
        { src: '.spark/rules/tools.md', txt: '本项目允许 web fetch，但需要解释目的', marker: 'win' },
      ]} conflict />

      <RuleLayer scope="Session" badge="SESS" badgeColor="#f43f5e" desc="本次会话临时规则" rules={[
        { src: '(会话开头)', txt: 'OAuth 2.1 兼容旧 endpoint 至少保留到 v0.3' },
        { src: '(会话开头)', txt: '本次改造涉及 PKCE，请优先参考 RFC 9700' },
      ]} />
    </div>
  )
}

type Rule = { src: string; txt: string; marker?: 'win' | 'lose'; overridden?: boolean }
function RuleLayer({ scope, badge, badgeColor, desc, rules, conflict }: { scope: string; badge: string; badgeColor: string; desc: string; rules: Rule[]; conflict?: boolean }) {
  return (
    <div className="rule-layer">
      <div className="rule-layer-h">
        <span className="badge" style={{ background: badgeColor + '20', color: badgeColor, borderColor: 'transparent' }}>{badge}</span>
        <div>
          <span className="name">{scope}</span>
          <span className="desc"> · {desc}</span>
        </div>
        <div style={{ flex: 1 }} />
        {conflict && <span className="badge warning dot" style={{ fontSize: 10 }}>1 冲突</span>}
        <button className="icon-btn"><Icons.Edit size={13} /></button>
        <button className="icon-btn"><Icons.ChevronDown size={13} /></button>
      </div>
      <div className="rule-layer-body">
        {rules.map((r, i) => (
          <div key={i} className={`rule-line ${r.marker === 'lose' ? 'overridden' : ''} ${r.marker && !r.overridden && conflict ? 'conflict' : ''}`}>
            <span className="src">{r.src}</span>
            <span className="txt">{r.txt}</span>
            {r.marker === 'win' && <span className="marker win">优先</span>}
            {r.marker === 'lose' && <span className="marker lose">被覆盖</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ───────── PERMISSIONS ───────── */
function PermissionsSection() {
  const [profile, setProfile] = useState('project-standard')
  return (
    <div className="settings-section">
      <h2>权限策略</h2>
      <div className="lede">控制 Agent 能做什么、何时需要审批。沙箱等级配合策略一起决定运行时风险。</div>

      <div className="subsec-h">权限 Profile</div>
      <div className="row" style={{ gap: 8, marginBottom: 18 }}>
        <ProfileChip active={profile === 'strict'} onClick={() => setProfile('strict')} icon={<Icons.Lock />} name="strict" desc="一切都问" />
        <ProfileChip active={profile === 'project-standard'} onClick={() => setProfile('project-standard')} icon={<Icons.Shield />} name="project-standard" desc="工作区写入自动允许" />
        <ProfileChip active={profile === 'trusted'} onClick={() => setProfile('trusted')} icon={<Icons.CheckCircle />} name="trusted" desc="自动允许大多数" />
        <ProfileChip active={profile === 'team-approved'} onClick={() => setProfile('team-approved')} icon={<Icons.Team />} name="team-approved" desc="团队管理员发布" />
        <button className="btn ghost sm"><Icons.Plus size={11} /> 新建 Profile</button>
      </div>

      <div className="subsec-h">具体权限 · project-standard</div>
      <div className="card">
        <PermRule icon={<Icons.File />} name="读取工作区文件" hint="允许 · 不弹窗" scope="工作区内" mode="allow" />
        <PermRule icon={<Icons.Edit />} name="编辑工作区文件" hint="自动写入，记录到 checkpoint" scope="工作区内" mode="allow" />
        <PermRule icon={<Icons.File />} name="访问工作区外文件" hint="读取或写入 ~/ 之外路径" scope="任意" mode="ask" />
        <PermRule icon={<Icons.Terminal />} name="执行 shell 命令" hint="非破坏性命令" scope="本会话" mode="ask" />
        <PermRule icon={<Icons.AlertTriangle />} name="高风险命令" hint="rm -rf、curl | sh、密钥导出" scope="任意" mode="ask-twice" />
        <PermRule icon={<Icons.GitBranch />} name="Git 推送" hint="包含 --force / --force-with-lease" scope="任意" mode="ask" />
        <PermRule icon={<Icons.Globe />} name="网络访问" hint="HTTP/HTTPS 请求" scope="域名白名单" mode="allow" />
        <PermRule icon={<Icons.Globe />} name="访问陌生域名" hint="未在白名单中的域名" scope="任意" mode="ask" />
        <PermRule icon={<Icons.MCP />} name="调用 MCP 工具" hint="按 server allowlist" scope="按 server" mode="allow" />
        <PermRule icon={<Icons.Lock />} name="读取 secret" hint="通过 secret reference 注入" scope="profile 内" mode="ask" />
        <PermRule icon={<Icons.Clock />} name="长任务后台运行" hint="≥ 30s 的任务" scope="本会话" mode="allow" />
      </div>

      <div className="subsec-h">沙箱等级</div>
      <div className="card">
        <SettingsRow title="L0 · 仅聊天" desc="完全禁用工具调用" right={<input type="radio" name="sb" />} />
        <SettingsRow title="L1 · 只读工作区" desc="可读文件，不可写、不可执行命令" right={<input type="radio" name="sb" />} />
        <SettingsRow title="L2 · 受控写入" desc="可写工作区文件，命令需审批 — 推荐" right={<input type="radio" name="sb" defaultChecked />} />
        <SettingsRow title="L3 · 完全自动化" desc="工作区内大多数操作免审批；高风险仍审批" right={<input type="radio" name="sb" />} />
        <SettingsRow title="L4 · 隔离沙箱" desc="microVM 内执行 (实验性)" right={<input type="radio" name="sb" disabled />} />
      </div>

      <div className="subsec-h">审计</div>
      <div className="card">
        <SettingsRow title="记录所有权限决策" desc="写入 SQLite · 不可篡改" right={<div className="switch on" />} />
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

function PermRule({ icon, name, hint, scope, mode }: { icon: ReactNode; name: string; hint: string; scope: string; mode: string }) {
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
      <select defaultValue={mode} style={{ width: '100%' }}>
        <option value="allow">允许</option>
        <option value="ask">询问</option>
        <option value="ask-twice">双重确认</option>
        <option value="dry-run">仅 dry-run</option>
        <option value="team">需团队审批</option>
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
