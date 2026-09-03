import { Claude, DeepSeek, OpenAI, Zhipu } from '@lobehub/icons'
import {
  ArrowUp,
  AtSign,
  Bug,
  Check,
  ChevronDown,
  CircleGauge,
  Code2,
  Copy,
  Files,
  Folder,
  GitBranch,
  GitFork,
  Globe2,
  Maximize2,
  Mic,
  Paperclip,
  Plus,
  RotateCw,
  Shield,
  Sparkles,
  Square,
  SquareTerminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent } from 'react'
import './HeroConversationDemo.css'

/**
 * 会话演化阶段：空会话 → 输入 → 发送 → 思考 → 工具调用 → 流式回复 →
 * HTML 模块骨架屏 → 渲染完成 → 交付 → 完成停留，随后回到空会话循环。
 */
export type DemoPhase =
  | 'idle'
  | 'typing'
  | 'sent'
  | 'reasoning'
  | 'toolRead'
  | 'toolEdit'
  | 'stream'
  | 'htmlLoading'
  | 'htmlRendered'
  | 'deliver'
  | 'done'

export const SESSION_TIMELINE: Array<{ phase: DemoPhase; duration: number }> = [
  { phase: 'idle', duration: 3200 },
  { phase: 'typing', duration: 2200 },
  { phase: 'sent', duration: 1000 },
  { phase: 'reasoning', duration: 2100 },
  { phase: 'toolRead', duration: 1700 },
  { phase: 'toolEdit', duration: 1900 },
  { phase: 'stream', duration: 2000 },
  { phase: 'htmlLoading', duration: 1500 },
  { phase: 'htmlRendered', duration: 1500 },
  { phase: 'deliver', duration: 1100 },
  { phase: 'done', duration: 4400 },
]

const PHASE_ORDER: readonly DemoPhase[] = SESSION_TIMELINE.map((step) => step.phase)

function phaseReached(phase: DemoPhase, target: DemoPhase) {
  return PHASE_ORDER.indexOf(phase) >= PHASE_ORDER.indexOf(target)
}

export const DEFAULT_PROMPT = '继续完善官网 Banner：复刻会话区、HTML 模块和参数交互。'

const ASSISTANT_COPY =
  '已按桌面端真实结构补齐会话渲染、品牌模型图标与参数选择，下面是可直接交互的 HTML 模块预览。'

type DemoMenu = 'agent' | 'context' | 'model' | 'permission' | 'reasoning' | 'tools'

type ModelOption = {
  id: string
  label: string
  provider: string
  Icon: ComponentType<{ size?: number }>
  color: string
}

const MODEL_OPTIONS: ModelOption[] = [
  { id: 'glm-5.3', label: 'GLM-5.3', provider: '智谱 AI', Icon: Zhipu, color: '#7297ff' },
  { id: 'gpt-5.5', label: 'GPT-5.5', provider: 'OpenAI', Icon: OpenAI, color: '#49b58b' },
  {
    id: 'claude-sonnet-4.6',
    label: 'Sonnet 4.6',
    provider: 'Anthropic',
    Icon: Claude,
    color: '#d98b6b',
  },
  {
    id: 'deepseek-v4',
    label: 'DeepSeek V4',
    provider: 'DeepSeek',
    Icon: DeepSeek,
    color: '#668cff',
  },
]

const PERMISSION_OPTIONS = [
  { id: 'ask', label: '请求批准', description: '敏感操作前询问', color: '#d5a74b' },
  { id: 'workspace', label: '工作区访问', description: '只写当前项目', color: '#72a1f8' },
  { id: 'full', label: '完全访问', description: '允许执行全部操作', color: '#e07a80' },
] as const

const REASONING_OPTIONS = [
  { id: 'standard', label: '标准', description: '速度与效果均衡' },
  { id: 'high', label: '高', description: '适合复杂实现' },
  { id: 'xhigh', label: '超高', description: '更充分地推理' },
] as const

const TOOL_OPTIONS: Array<{ label: string; description: string; Icon: LucideIcon }> = [
  { label: '添加文件', description: '图片、文档或代码', Icon: Paperclip },
  { label: '引用项目文件', description: '加入工作区上下文', Icon: Files },
  { label: '提及 Skill', description: '调用已安装能力', Icon: Sparkles },
  { label: '插入命令', description: '运行会话命令', Icon: SquareTerminal },
  { label: '引用会话', description: '带入另一段上下文', Icon: AtSign },
]

function IconButton({
  Icon,
  label,
  active = false,
  onClick,
}: {
  Icon: LucideIcon
  label: string
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      className={`hero-chat__icon-button${active ? ' is-active' : ''}`}
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      <Icon size={11} />
    </button>
  )
}

function StatusDot({ running }: { running: boolean }) {
  return <i className={`hero-chat__status-dot${running ? ' is-running' : ''}`} aria-hidden="true" />
}

function CodePreview() {
  return (
    <div className="hero-chat__code-preview">
      <span>
        <b>1</b> <em>&lt;section</em> class=<q>"release-health"</q>
        <em>&gt;</em>
      </span>
      <span>
        <b>2</b> &nbsp;&nbsp;<em>&lt;Metric</em> label=<q>"UI fidelity"</q> value=<q>"96%"</q> /
        <em>&gt;</em>
      </span>
      <span>
        <b>3</b> &nbsp;&nbsp;<em>&lt;InteractionGrid</em> states=&#123;states&#125; /<em>&gt;</em>
      </span>
      <span>
        <b>4</b> <em>&lt;/section&gt;</em>
      </span>
    </div>
  )
}

function Dashboard() {
  return (
    <div className="hero-chat__dashboard">
      <div className="hero-chat__dashboard-title">
        <div>
          <small>RELEASE HEALTH</small>
          <strong>Banner 交互复刻</strong>
        </div>
        <span>
          <StatusDot running={false} /> 实时预览
        </span>
      </div>
      <div className="hero-chat__metrics">
        <span>
          <small>界面细节</small>
          <strong>96%</strong>
          <i>+18%</i>
        </span>
        <span>
          <small>交互状态</small>
          <strong>24</strong>
          <i>已覆盖</i>
        </span>
        <span>
          <small>构建状态</small>
          <strong className="is-success">通过</strong>
          <i>0 errors</i>
        </span>
      </div>
      <div className="hero-chat__chart">
        <span className="hero-chat__chart-label">验收覆盖</span>
        <div className="hero-chat__chart-bars" aria-hidden="true">
          {[38, 56, 44, 71, 66, 84, 78, 96].map((height, index) => (
            <i
              key={height}
              style={{ '--bar-height': `${height}%`, '--bar-index': index } as React.CSSProperties}
            />
          ))}
        </div>
        <div className="hero-chat__chart-legend">
          <span>布局</span>
          <span>图标</span>
          <span>参数</span>
          <span>反馈</span>
        </div>
      </div>
    </div>
  )
}

function HtmlModule({ state }: { state: 'loading' | 'ready' }) {
  const [sourceOpen, setSourceOpen] = useState(false)
  const [openMode, setOpenMode] = useState(false)

  return (
    <section className="hero-chat__html-module hero-chat__part" aria-label="HTML 内容模块预览">
      <header className="hero-chat__html-head">
        <span className="hero-chat__html-title">
          <Globe2 size={10} /> 组件复刻检查面板
          <i className={state === 'ready' ? '' : 'is-pending'}>
            {state === 'ready' ? '已渲染' : '渲染中'}
          </i>
        </span>
        <span className="hero-chat__html-actions">
          <span className="hero-chat__html-mode-wrap">
            <button
              className="hero-chat__html-mode"
              type="button"
              aria-expanded={openMode}
              onClick={() => setOpenMode((value) => !value)}
            >
              内容区 <ChevronDown size={8} />
            </button>
            {openMode && (
              <span className="hero-chat__html-mode-menu">
                {['内容区', '侧面板', '独立窗口', '外部浏览器'].map((mode) => (
                  <button key={mode} type="button" onClick={() => setOpenMode(false)}>
                    {mode === '内容区' && <Check size={8} />}
                    <span>{mode}</span>
                  </button>
                ))}
              </span>
            )}
          </span>
          <IconButton
            Icon={Code2}
            label={sourceOpen ? '返回预览' : '查看源码'}
            active={sourceOpen}
            onClick={() => setSourceOpen((value) => !value)}
          />
          <IconButton Icon={Maximize2} label="全屏查看 HTML" />
        </span>
      </header>

      <div className={`hero-chat__html-body${sourceOpen ? ' is-source' : ''}`}>
        {sourceOpen ? (
          <CodePreview />
        ) : state === 'loading' ? (
          <div className="hero-chat__skeleton" aria-hidden="true">
            <span style={{ width: '42%' }} />
            <span style={{ width: '68%' }} />
            <span style={{ width: '55%' }} />
            <span className="hero-chat__skeleton-chart">
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
          </div>
        ) : (
          <Dashboard />
        )}
      </div>
    </section>
  )
}

function MessageActions({ side }: { side: 'left' | 'right' }) {
  return (
    <span className={`hero-chat__message-actions is-${side}`}>
      <small>刚刚</small>
      {side === 'right' && <IconButton Icon={RotateCw} label="重发" />}
      <IconButton Icon={Copy} label="复制" />
      {side === 'left' && <IconButton Icon={GitFork} label="从此处分支" />}
    </span>
  )
}

function AgentAvatar() {
  return (
    <span className="hero-chat__agent-avatar">
      <img src="/avatars/agent-default.png" alt="" />
      <i aria-hidden="true" />
    </span>
  )
}

function ToolLine({
  state,
  title,
  meta,
  extra,
}: {
  state: 'running' | 'done'
  title: string
  meta: string
  extra?: React.ReactNode
}) {
  return (
    <div className="hero-chat__tool-line hero-chat__part">
      <span className={state === 'running' ? 'is-running' : 'is-done'}>
        {state === 'running' ? <CircleGauge size={10} /> : <Check size={10} />}
      </span>
      <div>
        <strong>{title}</strong>
        <small>{meta}</small>
      </div>
      {extra ?? <code>3 files</code>}
    </div>
  )
}

function Conversation({
  phase,
  prompt,
  streamed,
}: {
  phase: DemoPhase
  prompt: string
  streamed: number
}) {
  const running = !phaseReached(phase, 'deliver')
  const thinking = phase === 'sent' || phase === 'reasoning'
  const thoughtDone = phaseReached(phase, 'toolRead')

  return (
    <div className="hero-chat__messages" data-phase={phase}>
      <article className="hero-chat__message hero-chat__message--user">
        <div className="hero-chat__user-bubble">{prompt}</div>
        <MessageActions side="right" />
      </article>

      <article className="hero-chat__message hero-chat__message--assistant">
        <div className="hero-chat__assistant-head">
          <AgentAvatar />
          <strong>Spark助手</strong>
          <span>{running ? '正在执行' : '已完成'}</span>
          <StatusDot running={running} />
        </div>

        {thinking && (
          <div className="hero-chat__thinking hero-chat__part">
            <span className="hero-chat__thinking-head">
              <Sparkles size={9} /> 思考中
            </span>
            <span className="hero-chat__thinking-line">
              正在比对官网 Banner 与桌面端主界面的差异…
            </span>
            <span className="hero-chat__thinking-line is-delay">
              梳理会话渲染、HTML 模块与参数交互的复刻清单…
            </span>
          </div>
        )}
        {thoughtDone && (
          <div className="hero-chat__thought-done hero-chat__part">
            <ChevronDown size={9} />
            已深度思考 <small>6.2s</small>
          </div>
        )}

        {phaseReached(phase, 'toolRead') && (
          <ToolLine
            state={phase === 'toolRead' ? 'running' : 'done'}
            title={
              phase === 'toolRead' ? '正在读取桌面端会话组件…' : '已读取桌面端会话与 Composer 源码'
            }
            meta="HeroAppMockup.tsx · ComposerV2.tsx · RenderHtmlBlock.tsx"
            extra={<code>3 files</code>}
          />
        )}
        {phaseReached(phase, 'toolEdit') && (
          <ToolLine
            state={phase === 'toolEdit' ? 'running' : 'done'}
            title={
              phase === 'toolEdit'
                ? '正在编辑 HeroConversationDemo.tsx…'
                : '已编辑 HeroConversationDemo.tsx'
            }
            meta="补齐列对齐、主题变量与会话演化动画"
            extra={
              <span className="hero-chat__tool-badges">
                <code className="is-add">+128</code>
                <code className="is-del">−36</code>
              </span>
            }
          />
        )}

        {phaseReached(phase, 'stream') && (
          <p className="hero-chat__assistant-copy hero-chat__part">
            {ASSISTANT_COPY.slice(0, streamed)}
            {phase === 'stream' && <span className="hero-chat__typing-caret" aria-hidden="true" />}
          </p>
        )}

        {phaseReached(phase, 'htmlLoading') && (
          <HtmlModule state={phase === 'htmlLoading' ? 'loading' : 'ready'} />
        )}

        {phaseReached(phase, 'deliver') && (
          <div className="hero-chat__delivery-line hero-chat__part">
            <Check size={10} />
            <span>布局对齐、主题切换、菜单与动态阶段均已接入</span>
            <small>4.8s</small>
          </div>
        )}
        <MessageActions side="left" />
      </article>
    </div>
  )
}

function MenuShell({
  className = '',
  title,
  children,
}: {
  className?: string
  title: string
  children: React.ReactNode
}) {
  return (
    <span className={`hero-chat__menu ${className}`} role="menu">
      <strong className="hero-chat__menu-title">{title}</strong>
      {children}
    </span>
  )
}

function ModelMenu({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  return (
    <MenuShell className="hero-chat__model-menu" title="选择模型">
      <label className="hero-chat__menu-search">
        <span>⌕</span>
        <input aria-label="搜索模型" placeholder="搜索模型" />
      </label>
      <span className="hero-chat__menu-section">已配置 Provider</span>
      {MODEL_OPTIONS.map(({ id, label, provider, Icon, color }) => (
        <button
          className={selected === id ? 'is-selected' : ''}
          type="button"
          role="menuitem"
          key={id}
          onClick={() => onSelect(id)}
        >
          <i style={{ color }}>
            <Icon size={12} />
          </i>
          <span>
            <b>{label}</b>
            <small>{provider}</small>
          </span>
          {selected === id && <Check size={10} />}
        </button>
      ))}
    </MenuShell>
  )
}

function ChoiceMenu({
  type,
  selected,
  onSelect,
}: {
  type: 'permission' | 'reasoning'
  selected: string
  onSelect: (id: string) => void
}) {
  const options = type === 'permission' ? PERMISSION_OPTIONS : REASONING_OPTIONS
  return (
    <MenuShell title={type === 'permission' ? '权限模式' : '推理强度'}>
      {options.map((option) => (
        <button
          className={selected === option.id ? 'is-selected' : ''}
          type="button"
          role="menuitem"
          key={option.id}
          onClick={() => onSelect(option.id)}
        >
          {type === 'permission' && (
            <i style={{ color: 'color' in option ? option.color : undefined }}>
              <Shield size={11} />
            </i>
          )}
          <span>
            <b>{option.label}</b>
            <small>{option.description}</small>
          </span>
          {selected === option.id && <Check size={10} />}
        </button>
      ))}
      {type === 'reasoning' && (
        <span className="hero-chat__reasoning-scale" aria-hidden="true">
          <i />
          <i />
          <i className="is-active" />
        </span>
      )}
    </MenuShell>
  )
}

function ToolsMenu({ onClose }: { onClose: () => void }) {
  return (
    <MenuShell className="hero-chat__tools-menu" title="添加到会话">
      {TOOL_OPTIONS.map(({ label, description, Icon }) => (
        <button type="button" role="menuitem" key={label} onClick={onClose}>
          <i>
            <Icon size={11} />
          </i>
          <span>
            <b>{label}</b>
            <small>{description}</small>
          </span>
        </button>
      ))}
    </MenuShell>
  )
}

function AgentMenu({ onClose }: { onClose: () => void }) {
  return (
    <MenuShell className="hero-chat__agent-menu" title="选择 Agent">
      {['Spark助手', '前端设计助手', '代码审查助手'].map((agent, index) => (
        <button
          className={index === 0 ? 'is-selected' : ''}
          type="button"
          key={agent}
          onClick={onClose}
        >
          <span className="hero-chat__menu-avatar">
            {index === 0 ? <img src="/avatars/agent-default.png" alt="" /> : <Wrench size={11} />}
          </span>
          <span>
            <b>{agent}</b>
            <small>{index === 0 ? '平台管理与全栈开发' : '专注工作流'}</small>
          </span>
          {index === 0 && <Check size={10} />}
        </button>
      ))}
    </MenuShell>
  )
}

function ContextMenu() {
  return (
    <MenuShell className="hero-chat__context-menu" title="上下文用量">
      <span className="hero-chat__context-total">
        <strong>18%</strong>
        <small>36.8K / 200K tokens</small>
      </span>
      <span className="hero-chat__context-track">
        <i />
      </span>
      <span className="hero-chat__context-row">
        <i className="is-blue" /> 系统与规则 <b>14.2K</b>
      </span>
      <span className="hero-chat__context-row">
        <i className="is-purple" /> 会话消息 <b>12.8K</b>
      </span>
      <span className="hero-chat__context-row">
        <i className="is-green" /> 工具与文件 <b>9.8K</b>
      </span>
    </MenuShell>
  )
}

function Composer({
  phase,
  typingValue,
  running,
  onSend,
  onStop,
  onHold,
}: {
  phase: DemoPhase
  typingValue: string
  running: boolean
  onSend: (prompt: string) => void
  onStop: () => void
  onHold: (hold: boolean) => void
}) {
  const [activeMenu, setActiveMenu] = useState<DemoMenu | null>(null)
  const [debug, setDebug] = useState(false)
  const [draft, setDraft] = useState('')
  const [focused, setFocused] = useState(false)
  const [modelId, setModelId] = useState(MODEL_OPTIONS[0]?.id ?? '')
  const [permission, setPermission] = useState('full')
  const [reasoning, setReasoning] = useState('xhigh')
  const [worktree, setWorktree] = useState(true)
  const rootRef = useRef<HTMLDivElement>(null)

  const selectedModel = MODEL_OPTIONS.find((model) => model.id === modelId) ?? MODEL_OPTIONS[0]
  const selectedPermission = PERMISSION_OPTIONS.find((option) => option.id === permission)
  const selectedReasoning = REASONING_OPTIONS.find((option) => option.id === reasoning)

  useEffect(() => {
    onHold(activeMenu !== null || focused)
  }, [activeMenu, focused, onHold])

  useEffect(() => {
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setActiveMenu(null)
    }
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setActiveMenu(null)
    }
    document.addEventListener('pointerdown', closeOnPointerDown)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  const toggleMenu = (menu: DemoMenu) => {
    setActiveMenu((current) => (current === menu ? null : menu))
  }

  const submit = () => {
    const nextPrompt = draft.trim()
    onSend(nextPrompt || DEFAULT_PROMPT)
    setDraft('')
    setActiveMenu(null)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  if (!selectedModel || !selectedPermission || !selectedReasoning) return null
  const ModelIcon = selectedModel.Icon
  const value = phase === 'typing' ? typingValue : draft

  return (
    <div className="hero-chat__composer-wrap" ref={rootRef}>
      <div className={`hero-chat__composer${running ? ' is-running' : ''}`}>
        <textarea
          rows={1}
          value={value}
          readOnly={phase === 'typing'}
          aria-label="任务输入"
          placeholder="询问、修改、运行任务…"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <IconButton Icon={Maximize2} label="展开输入框" />

        <div className="hero-chat__submit-row">
          <span className="hero-chat__control-wrap">
            <button
              className={`hero-chat__select-control${activeMenu === 'model' ? ' is-open' : ''}`}
              type="button"
              aria-expanded={activeMenu === 'model'}
              onClick={() => toggleMenu('model')}
            >
              <i className="hero-chat__brand-icon" style={{ color: selectedModel.color }}>
                <ModelIcon size={11} />
              </i>
              <span>{selectedModel.label}</span>
              <ChevronDown size={8} />
            </button>
            {activeMenu === 'model' && (
              <ModelMenu
                selected={modelId}
                onSelect={(id) => {
                  setModelId(id)
                  setActiveMenu(null)
                }}
              />
            )}
          </span>
          <button className="hero-chat__select-control" type="button">
            <Folder size={10} />
            <span>Spark-Agent</span>
            <ChevronDown size={8} />
          </button>
          <button className="hero-chat__select-control hero-chat__branch-control" type="button">
            <GitBranch size={10} />
            <span>feat/website-banner</span>
            <ChevronDown size={8} />
          </button>
          <span className="hero-chat__submit-spacer" />
          <IconButton Icon={Mic} label="语音输入" />
          {running ? (
            <button
              className="hero-chat__send-button is-stop"
              type="button"
              aria-label="停止生成"
              onClick={onStop}
            >
              <Square size={9} fill="currentColor" />
            </button>
          ) : (
            <button
              className="hero-chat__send-button"
              type="button"
              aria-label="发送"
              onClick={submit}
            >
              <ArrowUp size={13} />
            </button>
          )}
        </div>
      </div>

      <div className="hero-chat__param-bar">
        <span className="hero-chat__control-wrap">
          <button
            className={`hero-chat__param-button hero-chat__add-button${activeMenu === 'tools' ? ' is-open' : ''}`}
            type="button"
            aria-label="添加附件、技能或命令"
            aria-expanded={activeMenu === 'tools'}
            onClick={() => toggleMenu('tools')}
          >
            <Plus size={12} />
          </button>
          {activeMenu === 'tools' && <ToolsMenu onClose={() => setActiveMenu(null)} />}
        </span>

        <span className="hero-chat__control-wrap">
          <button
            className={`hero-chat__param-button${activeMenu === 'agent' ? ' is-open' : ''}`}
            type="button"
            aria-expanded={activeMenu === 'agent'}
            onClick={() => toggleMenu('agent')}
          >
            <img src="/avatars/agent-default.png" alt="" />
            Spark助手 <ChevronDown size={8} />
          </button>
          {activeMenu === 'agent' && <AgentMenu onClose={() => setActiveMenu(null)} />}
        </span>

        <span className="hero-chat__control-wrap">
          <button
            className={`hero-chat__param-button is-danger${activeMenu === 'permission' ? ' is-open' : ''}`}
            type="button"
            aria-expanded={activeMenu === 'permission'}
            onClick={() => toggleMenu('permission')}
          >
            <Shield size={10} /> {selectedPermission.label} <ChevronDown size={8} />
          </button>
          {activeMenu === 'permission' && (
            <ChoiceMenu
              type="permission"
              selected={permission}
              onSelect={(id) => {
                setPermission(id)
                setActiveMenu(null)
              }}
            />
          )}
        </span>

        <span className="hero-chat__control-wrap">
          <button
            className={`hero-chat__param-button is-reasoning${activeMenu === 'reasoning' ? ' is-open' : ''}`}
            type="button"
            aria-expanded={activeMenu === 'reasoning'}
            onClick={() => toggleMenu('reasoning')}
          >
            <Sparkles size={10} /> {selectedReasoning.label} <ChevronDown size={8} />
          </button>
          {activeMenu === 'reasoning' && (
            <ChoiceMenu
              type="reasoning"
              selected={reasoning}
              onSelect={(id) => {
                setReasoning(id)
                setActiveMenu(null)
              }}
            />
          )}
        </span>

        <button
          className={`hero-chat__param-button${debug ? ' is-active' : ''}`}
          type="button"
          aria-pressed={debug}
          onClick={() => setDebug((value) => !value)}
        >
          <Bug size={10} /> 调试{debug ? '中' : ''}
        </button>

        <span className="hero-chat__param-spacer" />
        <span className="hero-chat__control-wrap">
          <button
            className={`hero-chat__context-button${activeMenu === 'context' ? ' is-open' : ''}`}
            type="button"
            aria-label="上下文用量 18%"
            aria-expanded={activeMenu === 'context'}
            onClick={() => toggleMenu('context')}
          >
            <span>18%</span>
            <i>
              <b />
            </i>
          </button>
          {activeMenu === 'context' && <ContextMenu />}
        </span>
        <label className={`hero-chat__worktree${worktree ? ' is-active' : ''}`}>
          <input
            type="checkbox"
            checked={worktree}
            onChange={(event) => setWorktree(event.target.checked)}
          />
          <GitBranch size={10} /> worktree
        </label>
        <span className="hero-chat__send-hint">
          <kbd>↵</kbd> {running ? '停止' : '发送'}
        </span>
      </div>
    </div>
  )
}

export function HeroConversationDemo({
  phase,
  prompt,
  paused,
  onSend,
  onStop,
  onHold,
}: {
  phase: DemoPhase
  prompt: string
  paused: boolean
  onSend: (prompt: string) => void
  onStop: () => void
  onHold: (hold: boolean) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pausedRef = useRef(paused)
  const [typed, setTyped] = useState('')
  const [streamed, setStreamed] = useState(0)

  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  // 空会话阶段：把演示提示词逐字敲进输入框
  useEffect(() => {
    if (phase !== 'typing') {
      setTyped('')
      return
    }
    let index = 0
    setTyped('')
    const timer = window.setInterval(() => {
      if (pausedRef.current) return
      index = Math.min(index + 1, prompt.length)
      setTyped(prompt.slice(0, index))
      if (index >= prompt.length) window.clearInterval(timer)
    }, 52)
    return () => window.clearInterval(timer)
  }, [phase, prompt])

  // 回复阶段：正文逐字流出；其余阶段要么清零、要么直接铺满
  useEffect(() => {
    if (phase === 'stream') {
      let index = 0
      const timer = window.setInterval(() => {
        if (pausedRef.current) return
        index = Math.min(index + 1, ASSISTANT_COPY.length)
        setStreamed(index)
        if (index >= ASSISTANT_COPY.length) window.clearInterval(timer)
      }, 26)
      return () => window.clearInterval(timer)
    }
    setStreamed(phaseReached(phase, 'htmlLoading') ? ASSISTANT_COPY.length : 0)
  }, [phase])

  // 内容逐步出现时保持滚动到底部，模拟真实会话的自动跟随
  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' })
  }, [phase, typed, streamed])

  const sessionVisible = phaseReached(phase, 'sent')
  const running = sessionVisible && !phaseReached(phase, 'deliver')

  return (
    <section className={`hero-chat${paused ? ' is-paused' : ''}`} aria-label="动态会话演示">
      <div className="hero-chat__inner">
        <div className="hero-chat__scroll" ref={scrollRef} data-empty={!sessionVisible}>
          {sessionVisible && <Conversation phase={phase} prompt={prompt} streamed={streamed} />}
        </div>
        <Composer
          phase={phase}
          typingValue={typed}
          running={running}
          onSend={onSend}
          onStop={onStop}
          onHold={onHold}
        />
      </div>
    </section>
  )
}
