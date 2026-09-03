import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
} from 'react'
import {
  ArrowLeft,
  Bell,
  Bot,
  ChevronDown,
  Clock3,
  Code2,
  Download,
  FileText,
  Folder,
  GitBranch,
  LayoutGrid,
  Maximize2,
  MessageSquarePlus,
  MoreHorizontal,
  PanelLeftClose,
  PanelRight,
  Plus,
  Search,
  Server,
  Settings,
  Shield,
  SlidersHorizontal,
  Sparkles,
  SquareTerminal,
  Workflow,
  X,
} from 'lucide-react'
import './HeroAppMockup.css'
import {
  DEFAULT_PROMPT,
  HeroConversationDemo,
  SESSION_TIMELINE,
  type DemoPhase,
} from './HeroConversationDemo'

const DESIGN_WIDTH = 900
const DESIGN_HEIGHT = 570

/** 「sent」是会话真正出现的起点，「done」用于停止按钮直接跳到完成态 */
const SENT_INDEX = 2
const DONE_INDEX = SESSION_TIMELINE.length - 1

type MockIcon = ComponentType<{ size?: number; strokeWidth?: number }>

const WORKBENCH_NAV: Array<{ label: string; icon: MockIcon; beta?: boolean }> = [
  { label: '新建任务', icon: MessageSquarePlus },
  { label: '笔记本', icon: FileText },
  { label: '工作流', icon: Workflow, beta: true },
  { label: '任务面板', icon: LayoutGrid },
  { label: '更多', icon: MoreHorizontal },
]

const PROJECTS = [
  { name: 'Spark-Agent', pinned: true },
  { name: 'spark-desktop' },
  { name: 'content-studio' },
  { name: 'product-research' },
  { name: 'design-system' },
  { name: 'web-app' },
]

const SHARED_RESOURCES: Array<{ label: string; icon: MockIcon }> = [
  { label: '助手', icon: Bot },
  { label: '模型', icon: Server },
  { label: '技能', icon: Sparkles },
  { label: '扩展中心', icon: LayoutGrid },
]

const HEATMAP_COLUMNS = 16
const HEATMAP_ROWS = 7

function usageLevel(column: number, row: number) {
  if (column < 3) return (column + row) % 4 === 0 ? 1 : 0
  if (column < 7) return (column * 2 + row * 3) % 4 < 2 ? 1 : 2
  if (column < 12) return 1 + ((column + row * 2) % 3)
  if (column === 13 && row === 4) return 5
  return 2 + ((column * 3 + row) % 3)
}

function getGreeting() {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) return '早上好'
  if (hour >= 12 && hour < 18) return '下午好'
  return '晚上好'
}

function WindowDots() {
  return (
    <span className="hero-desktop__window-dots" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  )
}

function Sidebar() {
  return (
    <aside className="hero-desktop__sidebar">
      <div className="hero-desktop__sidebar-head">
        <WindowDots />
        <div className="hero-desktop__sidebar-head-actions">
          <span className="hero-desktop__update" title="有可用更新">
            <Download size={13} />
            <i />
          </span>
          <Search size={13} />
          <PanelLeftClose size={13} />
        </div>
      </div>

      <div className="hero-desktop__mode-switcher">
        <span className="is-active">
          <MessageSquarePlus size={12} /> 工作台
        </span>
        <span>
          <Workflow size={12} /> 画布
        </span>
      </div>

      <nav className="hero-desktop__nav" aria-label="工作台导航">
        {WORKBENCH_NAV.map(({ label, icon: Icon, beta }) => (
          <span className="hero-desktop__nav-item" key={label}>
            <Icon size={13} />
            <span>{label}</span>
            {beta && <i>Beta</i>}
          </span>
        ))}
      </nav>

      <div className="hero-desktop__projects-head">
        <span>项目</span>
        <span className="hero-desktop__projects-actions">
          <ArrowLeft size={11} />
          <Maximize2 size={11} />
          <SlidersHorizontal size={11} />
          <Folder size={11} />
        </span>
      </div>

      <div className="hero-desktop__projects">
        {PROJECTS.map((project, index) => (
          <div className="hero-desktop__project" key={project.name}>
            <Folder size={12} />
            <span>{project.name}</span>
            {project.pinned && <i aria-label="已置顶" />}
            {(index === 3 || index === PROJECTS.length - 1) && (
              <div className="hero-desktop__new-session">
                <Plus size={10} /> 新建此项目的会话
              </div>
            )}
          </div>
        ))}
        <div className="hero-desktop__project hero-desktop__project--temporary">
          <Folder size={12} />
          <span>临时会话</span>
        </div>
      </div>

      <div className="hero-desktop__shared-resources">
        {SHARED_RESOURCES.map(({ label, icon: Icon }) => (
          <span key={label}>
            <Icon size={13} />
            <small>{label}</small>
          </span>
        ))}
      </div>

      <div className="hero-desktop__account">
        <img src="/avatars/user-default.png" alt="" />
        <strong>你的工作台</strong>
        <ChevronDown size={10} />
        <Bell size={12} />
        <Settings size={12} />
      </div>
    </aside>
  )
}

function Topbar() {
  return (
    <div className="hero-desktop__topbar" aria-hidden="true">
      <span className="is-active">
        <Server size={13} />
      </span>
      <Code2 size={13} />
      <ChevronDown size={10} />
      <Clock3 size={13} />
      <PanelRight size={13} />
      <SlidersHorizontal size={13} />
      <MoreHorizontal size={13} />
    </div>
  )
}

function EnvironmentPanel() {
  return (
    <aside className="hero-desktop__environment">
      <div className="hero-desktop__environment-head">
        <strong>环境信息</strong>
        <span>
          <Plus size={11} />
          <X size={11} />
        </span>
      </div>
      <div className="hero-desktop__environment-row">
        <FileText size={12} />
        <span>变更</span>
        <b className="is-add">+8</b>
        <b className="is-delete">−2</b>
      </div>
      <div className="hero-desktop__environment-row">
        <GitBranch size={12} />
        <span className="is-branch">feat/website-banner</span>
        <ChevronDown size={10} />
      </div>
      <div className="hero-desktop__environment-row">
        <Shield size={12} />
        <span>提交或推送</span>
      </div>
      <div className="hero-desktop__environment-row">
        <SquareTerminal size={12} />
        <span>打开终端</span>
      </div>
    </aside>
  )
}

function UsageHeatmap() {
  return (
    <section className="hero-desktop__usage">
      <div className="hero-desktop__usage-head">
        <div>
          <strong>使用足迹</strong>
          <small>最近 16 周 · 累计 2,677.15M tokens · 活跃 71 天</small>
        </div>
        <span>查看统计 ›</span>
      </div>
      <div className="hero-desktop__months" aria-hidden="true">
        <span>6月</span>
        <span>7月</span>
        <span>8月</span>
        <span>9月</span>
      </div>
      <div className="hero-desktop__heatmap">
        <div className="hero-desktop__weekdays" aria-hidden="true">
          {['日', '一', '二', '三', '四', '五', '六'].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="hero-desktop__heatmap-grid" aria-label="最近 16 周使用热力图">
          {Array.from({ length: HEATMAP_COLUMNS }, (_, column) => (
            <span className="hero-desktop__heatmap-column" key={column}>
              {Array.from({ length: HEATMAP_ROWS }, (_, row) => (
                <i className={`is-level-${usageLevel(column, row)}`} key={`${column}-${row}`} />
              ))}
            </span>
          ))}
        </div>
      </div>
      <div className="hero-desktop__usage-foot">
        <span>单日最高 315.62M</span>
        <span className="hero-desktop__legend">
          少 <i className="is-level-0" /> <i className="is-level-2" />
          <i className="is-level-3" /> <i className="is-level-4" /> 多
        </span>
      </div>
    </section>
  )
}

function DesktopHome({
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
  const sessionActive = phase !== 'idle' && phase !== 'typing'

  return (
    <div className="hero-desktop__window" data-session={sessionActive}>
      <Sidebar />
      <div className="hero-desktop__main">
        <Topbar />
        <EnvironmentPanel />
        <div className="hero-desktop__welcome">
          <span className="hero-desktop__eyebrow">SPARK WORKSPACE</span>
          <h2>{getGreeting()}，继续推进</h2>
          <UsageHeatmap />
        </div>
        <div className="hero-desktop__shortcut">
          <span>快捷键</span> 按 Esc 收起当前弹窗、面板或浮层，保持桌面清爽。
        </div>
        <HeroConversationDemo
          phase={phase}
          prompt={prompt}
          paused={paused}
          onSend={onSend}
          onStop={onStop}
          onHold={onHold}
        />
      </div>
    </div>
  )
}

export function HeroAppMockup() {
  const outerRef = useRef<HTMLDivElement>(null)
  const scalerRef = useRef<HTMLDivElement>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [hovered, setHovered] = useState(false)
  const [held, setHeld] = useState(false)

  const paused = hovered || held
  const phase = SESSION_TIMELINE[stepIndex]?.phase ?? 'idle'

  // 会话演化时间轴：悬停或用户交互（展开菜单/聚焦输入）时暂停
  useEffect(() => {
    if (paused) return
    const duration = SESSION_TIMELINE[stepIndex]?.duration ?? 1500
    const timer = window.setTimeout(
      () => setStepIndex((current) => (current + 1) % SESSION_TIMELINE.length),
      duration,
    )
    return () => window.clearTimeout(timer)
  }, [paused, stepIndex])

  const handleSend = useCallback((nextPrompt: string) => {
    setPrompt(nextPrompt)
    setStepIndex(SENT_INDEX)
  }, [])

  const handleStop = useCallback(() => setStepIndex(DONE_INDEX), [])

  const handleHold = useCallback((hold: boolean) => setHeld(hold), [])

  useLayoutEffect(() => {
    const outer = outerRef.current
    const scaler = scalerRef.current
    if (!outer || !scaler) return

    const applyScale = () => {
      const scale = Math.min(1, outer.clientWidth / DESIGN_WIDTH)
      scaler.style.transform = `scale(${scale})`
      const nextHeight = `${DESIGN_HEIGHT * scale}px`
      if (outer.style.height !== nextHeight) outer.style.height = nextHeight
    }

    applyScale()
    const observer = new ResizeObserver(applyScale)
    observer.observe(outer)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      className="hero-app hero-desktop"
      ref={outerRef}
      role="img"
      aria-label="Spark Work 桌面端主界面动态演示：项目侧边栏、从空会话到 Agent 思考、工具调用与 HTML 模块渲染的演化，以及可交互的任务输入区"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="hero-desktop__scaler" ref={scalerRef} aria-hidden="true">
        <DesktopHome
          phase={phase}
          prompt={prompt}
          paused={paused}
          onSend={handleSend}
          onStop={handleStop}
          onHold={handleHold}
        />
      </div>
    </div>
  )
}
