import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  Brain,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  Clapperboard,
  CornerDownLeft,
  FileText,
  Hand,
  Home,
  Image as ImageIcon,
  LayoutGrid,
  LoaderCircle,
  Minus,
  MousePointer2,
  MoreHorizontal,
  PanelLeft,
  PanelLeftClose,
  Pin,
  Play,
  Plus,
  Puzzle,
  Search,
  Send,
  Settings,
  Shield,
  Sparkles,
  Speech,
  SquareTerminal,
  Workflow,
} from 'lucide-react'
import { Logo } from './Logo'

// 「翻牌器」标签：label 变化时新值从下方滑入、旧值向上滑出离场。
// 与桌面端 ComposerSelectLabelTicker 思路一致：当前帧撑开容器做静态主体，
// 离场帧用 absolute 脱离文档流，避免卸载触发 layout。
function HeroTicker({ label, minWidthCh }: { label: string; minWidthCh?: number }) {
  const currentRef = useRef(label)
  const [leaving, setLeaving] = useState<string | null>(null)

  useEffect(() => {
    if (label === currentRef.current) return
    setLeaving(currentRef.current)
    currentRef.current = label
    const timer = window.setTimeout(() => setLeaving(null), 260)
    return () => window.clearTimeout(timer)
  }, [label])

  return (
    <span
      className="hero-app__ticker"
      style={minWidthCh ? { minWidth: `${minWidthCh}ch` } : undefined}
    >
      <span key={label} className="hero-app__ticker-item is-current">
        {label}
      </span>
      {leaving != null && leaving !== label && (
        <span className="hero-app__ticker-item is-leaving">{leaving}</span>
      )}
    </span>
  )
}

// assistant 正文按段渲染，code 段用 <code> 样式；打字机按字符推进。
type Seg = { t?: string; c?: string }
const SEGMENTS: Seg[] = [
  { t: '已完成拆分：' },
  { c: 'verifyToken' },
  { t: ' 负责令牌校验，' },
  { c: 'loadSession' },
  { t: ' 负责读取会话。补充 6 个回归用例，' },
  { c: 'pnpm test auth' },
  { t: ' 已通过。' },
]
const FULL_TEXT = SEGMENTS.map((s) => s.t ?? s.c).join('')

// 会话界面头像：直接复用桌面端内置默认头像（public/avatars/），
// 保证与真实应用「用户默认 / Agent 默认」头像像素级一致。
const AGENT_AVATAR = '/avatars/agent-default.png'
const USER_AVATAR = '/avatars/user-default.png'

// 按"已显示字符数"把 segments 切成已渲染节点。
function renderTyped(count: number) {
  const out: ReactNode[] = []
  let used = 0
  SEGMENTS.forEach((seg, i) => {
    const text = seg.t ?? seg.c ?? ''
    if (used >= count) return
    const show = Math.min(text.length, count - used)
    const piece = text.slice(0, show)
    out.push(
      seg.c ? (
        <code key={i}>{piece}</code>
      ) : (
        <span key={i}>{piece}</span>
      ),
    )
    used += text.length
  })
  return out
}

type View = 'workbench' | 'canvas'

/* ---------------- 工作台视图（两栏精修：单面板菜单栏 + 主区） ---------------- */
// 导航项与桌面端 NAV_ITEMS 对齐：助手 / 模型 / 技能 / 定时任务 / 连接器与 MCP / 任务面板 / 工作流 / 无限画布。
// 桌面端默认只展开前 3 项 + 置顶项，其余折进「更多」。这里让「无限画布」置顶以呼应切换器。
type NavDef = { label: string; icon: React.FC<{ size?: number }> }
const NAV_ITEMS: NavDef[] = [
  { label: '助手', icon: Speech },
  { label: '模型', icon: LayoutGrid },
  { label: '技能', icon: Sparkles },
  { label: '定时任务', icon: CalendarClock },
  { label: '连接器与 MCP', icon: Puzzle },
  { label: '任务面板', icon: LayoutGrid },
  { label: '工作流', icon: Workflow },
  { label: '无限画布', icon: Workflow },
]
const PINNED_LABEL = '无限画布'

function WorkbenchView() {
  const [revealedTools, setRevealedTools] = useState(0)
  const [typed, setTyped] = useState(0)
  // 参数 ticker 状态：模型 / 模式 / 思考强度，独立计时器错峰切换，
  // 让 banner 看起来有「在调参」的活人感。
  const [modelIdx, setModelIdx] = useState(0)
  const [modeIdx, setModeIdx] = useState(0)
  const [effortIdx, setEffortIdx] = useState(0)

  const MODELS = ['Claude Sonnet 4.5', 'GPT-5', 'Gemini 2.5 Pro', 'Claude Opus 4.5']
  const MODES = ['自动', '极速', '深度']
  const EFFORTS = ['高', '中', '低']

  // 三个 ticker 的 interval 句柄都存到 ref，
  // 避免 setTimeout 回调里启动的 setInterval 在 cleanup 时被漏掉（泄漏 + setState on unmounted 警告）。
  const tickerModelRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const tickerModeRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const tickerEffortRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      setRevealedTools(2)
      setTyped(FULL_TEXT.length)
      return
    }
    const ta = setTimeout(() => setRevealedTools(1), 700)
    const tb = setTimeout(() => setRevealedTools(2), 1300)
    let i = 0
    const startTyping = setTimeout(() => {
      const tick = setInterval(() => {
        i += 1
        setTyped(i)
        if (i >= FULL_TEXT.length) clearInterval(tick)
      }, 32)
    }, 900)

    // 三个 ticker 错开启动（0 / 1.4s / 2.8s），周期 4.2s，避免同时切导致眼花
    tickerModelRef.current = setInterval(
      () => setModelIdx((v) => (v + 1) % MODELS.length),
      4200,
    )
    const timerMode = setTimeout(() => {
      setModeIdx((v) => (v + 1) % MODES.length)
      tickerModeRef.current = setInterval(
        () => setModeIdx((v) => (v + 1) % MODES.length),
        4200,
      )
    }, 1400)
    const timerEffort = setTimeout(() => {
      setEffortIdx((v) => (v + 1) % EFFORTS.length)
      tickerEffortRef.current = setInterval(
        () => setEffortIdx((v) => (v + 1) % EFFORTS.length),
        4200,
      )
    }, 2800)

    return () => {
      clearTimeout(ta)
      clearTimeout(tb)
      clearTimeout(startTyping)
      if (tickerModelRef.current) clearInterval(tickerModelRef.current)
      clearTimeout(timerMode)
      if (tickerModeRef.current) clearInterval(tickerModeRef.current)
      clearTimeout(timerEffort)
      if (tickerEffortRef.current) clearInterval(tickerEffortRef.current)
      tickerModelRef.current = null
      tickerModeRef.current = null
      tickerEffortRef.current = null
    }
  }, [])

  const typing = typed < FULL_TEXT.length

  // 与桌面端一致的折叠逻辑：置顶项常驻最前；其余取前 2 个可见，剩下折进「更多」。
  const pinned = NAV_ITEMS.filter((n) => n.label === PINNED_LABEL)
  const rest = NAV_ITEMS.filter((n) => n.label !== PINNED_LABEL)
  const visible = [...pinned, ...rest.slice(0, 2)]
  const collapsed = rest.slice(2)

  return (
    <div className="hero-app__work">
      {/* 单面板菜单栏：header → 新建任务 + 导航 → 分割线 → 搜索 + 会话列表 → 底部用户 */}
      <aside className="hero-app__sidebar" aria-label="菜单栏">
        <div className="hero-app__side-head">
          <span className="hero-app__brand">
            <Logo size={16} />
          </span>
          <span className="hero-app__side-actions">
            <PanelLeftClose size={14} />
          </span>
        </div>

        {/* 导航：新建任务 + 功能菜单项（统一间距） */}
        <div className="hero-app__nav-section">
          <button className="hero-app__nav-item" type="button">
            <span className="hero-app__nav-ic">
              <Plus size={15} />
            </span>
            <span className="hero-app__nav-label">新建任务</span>
          </button>
          {visible.map((item) => {
            const isActive = item.label === PINNED_LABEL
            return (
              <button
                key={item.label}
                className={`hero-app__nav-item${isActive ? ' is-active' : ''}`}
                type="button"
              >
                <span className="hero-app__nav-ic">
                  <item.icon size={15} />
                </span>
                <span className="hero-app__nav-label">{item.label}</span>
                {isActive && <Pin size={11} className="hero-app__nav-pin" />}
              </button>
            )
          })}
          {collapsed.length > 0 && (
            <button className="hero-app__nav-item hero-app__nav-more" type="button">
              <span className="hero-app__nav-ic">
                <MoreHorizontal size={15} />
              </span>
              <span className="hero-app__nav-label">更多</span>
              <ChevronDown size={11} className="hero-app__nav-chev" />
            </button>
          )}
        </div>

        <div className="hero-app__nav-divider" />

        {/* 会话列表：搜索 + 分组 */}
        <div className="hero-app__search">
          <Search size={12} />
          <span>搜索会话…</span>
        </div>

        <div className="hero-app__sessions">
          <div className="hero-app__group">今天</div>
          <div className="hero-app__sess is-active">
            <span className="hero-app__dot is-waiting" />
            <span className="hero-app__sess-name">排查接口 502 并生成修复方案</span>
            <span className="hero-app__badge">待权限</span>
          </div>
          <div className="hero-app__sess">
            <span className="hero-app__dot is-done" />
            <span className="hero-app__sess-name">登录稳定性修复与回归测试</span>
          </div>
          <div className="hero-app__sess">
            <span className="hero-app__dot is-done" />
            <span className="hero-app__sess-name">新品短片分镜板·6 镜头</span>
          </div>

          <div className="hero-app__group">昨天</div>
          <div className="hero-app__sess">
            <span className="hero-app__dot is-input" />
            <span className="hero-app__sess-name">客户方案·视觉素材整理</span>
          </div>
          <div className="hero-app__sess">
            <span className="hero-app__dot is-done" />
            <span className="hero-app__sess-name">竞品调研与卖点提炼</span>
          </div>
        </div>

        {/* 底部：用户信息 + 设置 */}
        <div className="hero-app__user">
          <img className="hero-app__avatar hero-app__avatar-img" src={USER_AVATAR} alt="" />
          <span className="hero-app__user-name">你的工作台</span>
          <ChevronDown size={11} className="hero-app__user-chev" />
          <span className="hero-app__user-cog" title="设置">
            <Settings size={13} />
          </span>
        </div>
      </aside>

      {/* 主区 */}
      <main className="hero-app__main">
        <div className="hero-app__tabbar">
          <div className="hero-app__tab-left">
            <strong className="hero-app__tab-title">登录稳定性修复与回归测试</strong>
            <span className="hero-app__runstate">
              <span className="hero-app__run-dot" />
              <LoaderCircle size={12} className="hero-app__spin" />
              运行中
            </span>
          </div>
          <div className="hero-app__tab-right">
            <span className="hero-app__model-chip">
              <HeroTicker label={MODELS[modelIdx]} minWidthCh={12} />
              <ChevronDown size={11} />
            </span>
            <PanelLeft size={14} />
          </div>
        </div>

        <div className="hero-app__msgs">
          {/* 轮次 1：紧凑一来一回，让会话区呈现真实多轮对话（用户右、助手左） */}
          <div className="hero-app__msg--user">
            <div className="hero-app__bubble">登录接口偶发 502，帮我定位下根因。</div>
            <img
              className="hero-app__avatar hero-app__avatar--sm hero-app__avatar-img"
              src={USER_AVATAR}
              alt=""
            />
          </div>

          <div className="hero-app__msg--ai">
            <img
              className="hero-app__avatar hero-app__avatar--sm hero-app__avatar-img hero-app__avatar--ai"
              src={AGENT_AVATAR}
              alt=""
            />
            <div className="hero-app__ai-body">
              <p className="hero-app__ai-text">
                找到了：<code>middleware.ts</code> 把令牌校验和会话查询耦合在一起，高并发时会拖慢响应。建议拆成两步并补回归测试。
              </p>
            </div>
          </div>

          {/* 轮次 2：详细任务（保留思考链 / 工具调用 / diff / 打字机） */}
          <div className="hero-app__msg--user">
            <div className="hero-app__bubble">
              <code>src/auth/middleware.ts</code> 里令牌校验和会话查询耦合了，帮我抽成{' '}
              <code>verifyToken</code> + <code>loadSession</code> 两步，并补充回归测试。
            </div>
            <img
              className="hero-app__avatar hero-app__avatar--sm hero-app__avatar-img"
              src={USER_AVATAR}
              alt=""
            />
          </div>
     
          <div className="hero-app__msg--ai">
            <img
              className="hero-app__avatar hero-app__avatar--sm hero-app__avatar-img hero-app__avatar--ai"
              src={AGENT_AVATAR}
              alt=""
            />
            <div className="hero-app__ai-body">
              <div className={`hero-app__tool ${revealedTools >= 1 ? 'is-in' : ''}`}>
                <span className="hero-app__tool-main">
                  <FileText size={13} /> Read <code>src/auth/middleware.ts</code>
                </span>
                <span className="hero-app__tool-ok">
                  <Check size={12} /> 1.2s
                </span>
                <ChevronDown size={12} className="hero-app__tool-chev" />
              </div>

              <div className={`hero-app__diff ${revealedTools >= 1 ? 'is-in' : ''}`}>
                <div className="hero-app__diff-row">
                  <span className="hero-app__diff-stat minus">−3</span>
                  <code className="hero-app__diff-line hero-app__diff-del">
                    const s = await db.find(payload.sid)
                  </code>
                </div>
                <div className="hero-app__diff-row">
                  <span className="hero-app__diff-stat plus">+6</span>
                  <code className="hero-app__diff-line hero-app__diff-add">
                    export const loadSession = (sid) =&gt; db.find(sid)
                  </code>
                </div>
              </div>

              <div className={`hero-app__tool ${revealedTools >= 2 ? 'is-in' : ''}`}>
                <span className="hero-app__tool-main">
                  <SquareTerminal size={13} /> Run <code>pnpm test auth</code>
                </span>
                <span className="hero-app__tool-ok">
                  <Check size={12} /> 6/6
                </span>
                <ChevronDown size={12} className="hero-app__tool-chev" />
              </div>

              <p className="hero-app__ai-text">
                {renderTyped(typed)}
                {typing && <span className="hero-app__caret" />}
              </p>
            </div>
          </div>
        </div>

        <div className="hero-app__composer">
          <div className="hero-app__comp-input">
            <Plus size={16} className="hero-app__comp-plus" />
            <span className="hero-app__comp-ph">询问、修改、运行任务…</span>
            <CornerDownLeft size={12} className="hero-app__comp-enter" />
            发送
          </div>
          <div className="hero-app__comp-row">
            <div className="hero-app__comp-left">
              <span className="hero-app__comp-chip">
                <img className="hero-app__mini-ava hero-app__avatar-img" src={USER_AVATAR} alt="" />{' '}
                当前项目
              </span>
              <span className="hero-app__comp-chip">
                <HeroTicker label={MODELS[modelIdx]} minWidthCh={10} /> <ChevronDown size={10} />
              </span>
              <span className="hero-app__comp-chip">
                <Shield size={11} /> <HeroTicker label={MODES[modeIdx]} minWidthCh={2} />
              </span>
              <span className="hero-app__comp-chip">
                <Brain size={11} /> <HeroTicker label={EFFORTS[effortIdx]} minWidthCh={1} />
              </span>
              <span className="hero-app__ctx">
                <span className="hero-app__ctx-bar">
                  <i />
                </span>
                <small>42k / 200k</small>
              </span>
            </div>
            <button className="hero-app__send" aria-label="发送">
              <Send size={13} />
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}

/* ---------------- 无限画布视图 ---------------- */
function CanvasView() {
  return (
    <div className="hero-canvas">
      {/* 顶栏：项目名 + Main canvas tab + 保存状态 */}
      <div className="hero-canvas__topbar">
        <span className="hero-canvas__proj">
          <Clapperboard size={13} /> 短片《同频》·分镜板
        </span>
        <span className="hero-canvas__tab is-active">Main canvas</span>
        <span className="hero-canvas__topstate">
          <i className="is-unsaved">未保存</i>
          <i className="is-saved">
            <Check size={10} /> 已保存
          </i>
        </span>
      </div>

      {/* 中部三栏：节点库 + 画布 + 检查器 */}
      <div className="hero-canvas__mid">
        <aside className="hero-canvas__library" aria-label="节点库">
          <p className="hero-canvas__lib-title">节点库</p>
          <div className="hero-canvas__lib-tags">
            <span className="is-active">剧本</span>
            <span>角色</span>
            <span>场景</span>
            <span>分镜</span>
            <span>AI</span>
          </div>
          <div className="hero-canvas__lib-item">
            <span className="hero-canvas__lib-thumb is-text">
              <FileText size={14} />
            </span>
            <span className="hero-canvas__lib-name">剧本节点</span>
          </div>
          <div className="hero-canvas__lib-item">
            <span className="hero-canvas__lib-thumb is-avatar">主</span>
            <span className="hero-canvas__lib-name">角色节点</span>
          </div>
          <div className="hero-canvas__lib-item">
            <span className="hero-canvas__lib-thumb is-scene">
              <ImageIcon size={14} />
            </span>
            <span className="hero-canvas__lib-name">场景节点</span>
          </div>
          <div className="hero-canvas__lib-item">
            <span className="hero-canvas__lib-thumb is-shot">
              <Clapperboard size={14} />
            </span>
            <span className="hero-canvas__lib-name">分镜节点</span>
          </div>
        </aside>

        {/* 画布：点阵网格 + 节点 + SVG 连线 */}
        <div className="hero-canvas__board">
          <svg
            className="hero-canvas__wires"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden
          >
            {/* 剧本 → 场景 */}
            <path className="is-dim" d="M19,24 C30,24 30,45 35,45" />
            {/* 角色 → 场景 */}
            <path className="is-dim" d="M19,66 C30,66 30,45 35,45" />
            {/* 场景 → 分镜（选中链路，高亮） */}
            <path className="is-hot" d="M45,45 C55,45 55,24 61,24" />
            {/* 场景 → AI 视频 */}
            <path className="is-dim" d="M45,45 C55,45 55,66 61,66" />
          </svg>

          {/* 剧本 */}
          <div className="hero-canvas__node is-text" style={{ left: '14%', top: '24%' }}>
            <span className="hero-canvas__node-thumb">
              <FileText size={16} />
            </span>
            <span className="hero-canvas__node-title">剧本·开篇</span>
            <span className="hero-canvas__node-kind">剧本</span>
          </div>

          {/* 角色（主角 符青黛）：用真实人物设定表作为缩略图，aspect 1:1 适配人像竖版。 */}
          <div
            className="hero-canvas__node is-avatar"
            style={{ left: '14%', top: '66%', '--thumb-aspect': '1 / 1' } as CSSProperties}
          >
            <span className="hero-canvas__node-thumb is-image">
              <img
                className="hero-canvas__node-img"
                src="/canvas-nodes/fu-qingdai.jpg"
                alt="主角·符青黛"
                loading="lazy"
                decoding="async"
              />
            </span>
            <span className="hero-canvas__node-title">主角·符青黛</span>
            <span className="hero-canvas__node-kind">角色</span>
          </div>

          {/* 场景（卧室）：用真实场景分镜作为缩略图，aspect 16:9 适配横版场景图。 */}
          <div
            className="hero-canvas__node is-scene"
            style={{ left: '40%', top: '45%', '--thumb-aspect': '16 / 9' } as CSSProperties}
          >
            <span className="hero-canvas__node-thumb is-image">
              <img
                className="hero-canvas__node-img"
                src="/canvas-nodes/fu-qingdai-bedroom.jpg"
                alt="场景·符青黛的卧室"
                loading="lazy"
                decoding="async"
              />
            </span>
            <span className="hero-canvas__node-title">场景·卧室</span>
            <span className="hero-canvas__node-kind">场景</span>
          </div>

          {/* 分镜（选中）：分镜 03 取苏烬作为画面主体，aspect 1:1 适配人像。 */}
          <div
            className="hero-canvas__node is-shot is-selected"
            style={{ left: '66%', top: '24%', '--thumb-aspect': '1 / 1' } as CSSProperties}
          >
            <span className="hero-canvas__node-thumb is-image">
              <img
                className="hero-canvas__node-img"
                src="/canvas-nodes/su-jin.jpg"
                alt="分镜 03·苏烬"
                loading="lazy"
                decoding="async"
              />
            </span>
            <span className="hero-canvas__node-title">分镜 03·苏烬</span>
            <span className="hero-canvas__node-kind">分镜</span>
          </div>

          {/* AI 生视频（仍用占位 icon：AI 生成中还没有真实画面） */}
          <div className="hero-canvas__node is-video" style={{ left: '66%', top: '66%' }}>
            <span className="hero-canvas__node-thumb is-video-bg">
              <Play size={15} />
            </span>
            <span className="hero-canvas__node-title">AI 视频</span>
            <span className="hero-canvas__node-kind">AI · 生成</span>
          </div>
        </div>

        {/* 检查器：任务队列 + AI 操作 */}
        <aside className="hero-canvas__inspector" aria-label="任务与 AI 面板">
          <p className="hero-canvas__insp-title">任务队列</p>
          <div className="hero-canvas__queue">
            <span className="hero-canvas__q">
              <strong>8</strong>
              <small>全部</small>
            </span>
            <span className="hero-canvas__q">
              <strong>1</strong>
              <small>进行</small>
            </span>
            <span className="hero-canvas__q">
              <strong>0</strong>
              <small>失败</small>
            </span>
            <span className="hero-canvas__q is-ok">
              <strong>7</strong>
              <small>完成</small>
            </span>
          </div>

          <p className="hero-canvas__insp-title">AI 操作</p>
          <div className="hero-canvas__task">
            <div className="hero-canvas__task-head">
              <span className="hero-canvas__task-name">
                <Play size={11} /> 图片转视频
              </span>
              <span className="hero-canvas__task-tag is-running">进行中</span>
            </div>
            <div className="hero-canvas__progress">
              <i style={{ width: '70%' }} />
            </div>
            <small className="hero-canvas__task-meta">grok-imagine-video · 70%</small>
          </div>
          <div className="hero-canvas__task">
            <div className="hero-canvas__task-head">
              <span className="hero-canvas__task-name">
                <ImageIcon size={11} /> 重生图
              </span>
              <span className="hero-canvas__task-tag is-done">
                <CheckCircle2 size={11} /> 完成
              </span>
            </div>
            <div className="hero-canvas__progress is-done">
              <i style={{ width: '100%' }} />
            </div>
            <small className="hero-canvas__task-meta">分镜 03 · 已生成</small>
          </div>
        </aside>
      </div>

      {/* 底栏：缩放 + 工具 + 小地图 */}
      <div className="hero-canvas__toolbar">
        <div className="hero-canvas__zoom">
          <Minus size={12} />
          <span>75%</span>
          <Plus size={12} />
        </div>
        <div className="hero-canvas__tools">
          <span className="is-active" title="选择">
            <MousePointer2 size={13} />
          </span>
          <span title="拖拽">
            <Hand size={13} />
          </span>
          <span title="对齐">
            <Workflow size={13} />
          </span>
          <span title="添加节点">
            <Plus size={13} />
          </span>
          <span title="导演台">
            <Clapperboard size={13} />
          </span>
        </div>
        <div className="hero-canvas__minimap" aria-label="小地图">
          <i />
          <i />
          <i />
        </div>
      </div>
    </div>
  )
}

/* ---------------- 外壳 + 轮播 + 切换器 ---------------- */

// 窄屏等比缩放基准：容器宽 < 此值时，把整张桌面 mockup 按此宽渲染再 scale 到容器宽，
// 保留桌面三栏比例，避免固定列宽在窄屏被挤压变形。
const SCALE_BASE = 720

export function HeroAppMockup() {
  const [view, setView] = useState<View>('workbench')
  const [hovering, setHovering] = useState(false)
  const [reduce, setReduce] = useState(false)
  const [resetKey, setResetKey] = useState(0)

  const outerRef = useRef<HTMLDivElement>(null)
  const scalerRef = useRef<HTMLDivElement>(null)

  // 等比缩放：宽屏保持原样；窄屏整体 scale，内部桌面布局不再被挤压变形。
  useLayoutEffect(() => {
    const outer = outerRef.current
    const scaler = scalerRef.current
    if (!outer || !scaler) return

    // 基准高度：SCALE_BASE 宽下缩放器的自然高度，窄屏按它折算父层占位高度。
    scaler.style.width = `${SCALE_BASE}px`
    scaler.style.transform = 'none'
    const naturalHeight = scaler.offsetHeight

    const apply = () => {
      const w = outer.clientWidth
      if (w <= 0) return
      let nextHeight: number
      if (w >= SCALE_BASE) {
        scaler.style.width = '100%'
        scaler.style.transform = 'none'
        nextHeight = scaler.offsetHeight
      } else {
        const s = w / SCALE_BASE
        scaler.style.width = `${SCALE_BASE}px`
        scaler.style.transform = `scale(${s})`
        nextHeight = naturalHeight * s
      }
      const next = `${nextHeight}px`
      if (outer.style.height !== next) outer.style.height = next
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(outer)
    return () => {
      ro.disconnect()
      scaler.style.width = ''
      scaler.style.transform = ''
      outer.style.height = ''
    }
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduce(mq.matches)
    update()
    mq.addEventListener?.('change', update)
    return () => mq.removeEventListener?.('change', update)
  }, [])

  useEffect(() => {
    if (reduce || hovering) return
    const id = setInterval(() => {
      setView((v) => (v === 'workbench' ? 'canvas' : 'workbench'))
    }, 5000)
    return () => clearInterval(id)
  }, [reduce, hovering])

  const switchTo = (v: View) => {
    setView(v)
    setResetKey((k) => k + 1)
  }

  return (
    <div
      className="hero-app"
      ref={outerRef}
      aria-label="Spark Agent 桌面工作台界面预览"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <div className="hero-app__scaler" ref={scalerRef}>
      <div className="hero-app__chrome">
        {/* titlebar */}
        <div className="hero-app__titlebar">
          <span className="hero-app__dots">
            <i />
            <i />
            <i />
          </span>
          <span className="hero-app__title">Spark Agent</span>

          {/* 视图切换器（手动切换），进度条独立放到下方作为全宽细条 */}
          <div className="hero-app__switch" role="tablist" aria-label="预览视图切换">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'workbench'}
              className={`hero-app__switch-btn ${view === 'workbench' ? 'is-active' : ''}`}
              onClick={() => switchTo('workbench')}
            >
              <Home size={12} /> 工作台
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'canvas'}
              className={`hero-app__switch-btn ${view === 'canvas' ? 'is-active' : ''}`}
              onClick={() => switchTo('canvas')}
            >
              <Workflow size={12} /> 无限画布
            </button>
          </div>
        </div>

        {/* 自动轮播进度条：全宽细条，放在 titlebar 下方、body 上方 */}
        {!reduce && (
          <div
            key={`${view}-${resetKey}`}
            className={`hero-app__progress${hovering ? ' is-paused' : ''}`}
            aria-hidden
          >
            <i />
          </div>
        )}

        <div className="hero-app__body">
          {view === 'workbench' ? <WorkbenchView /> : <CanvasView />}
        </div>
      </div>
      </div>

      {/* SEO / 无障碍：完整正文以隐藏文本输出，避免打字机导致爬虫拿不到 */}
      <span className="hero-app__sr-only">{FULL_TEXT}</span>
    </div>
  )
}
