import React, { useEffect, useState } from 'react'
import type { ManagedAgent } from '@spark/protocol'
import { Icons } from '../../Icons'
import { getAgentAvatarConfig, resolveAvatarSrc } from '../../avatar'
import { AvatarImage } from '../../components/AvatarImage'
import { formatShortcut } from '../../hooks/useKeyboard'

export function resolveAgentDisplay(agents: ManagedAgent[], agentId: string | null | undefined) {
  if (agentId == null || agentId.length === 0) return null
  return agents.find((agent) => agent.id === agentId) ?? null
}

type HeroGreetingCopy = {
  title: string
  body: string
}

/**
 * 空会话推荐卡片：每次展示 3 个，5s 自动轮换一组，鼠标悬停暂停。
 *
 * 卡片规范：
 * - 标题 ≤ 6 字，简短有力
 * - desc 一行：Agent · 关键技能，便于一眼判断能力归属
 * - prompt 简洁：携带技能推荐 + 示例话术；点击后带入输入框，由 Agent 自行判断
 *   是否需要安装技能（如 ppt-master 需走 skill-installer 流程）。
 */
const SINGLE_AGENT_HERO_ACTIONS = [
  {
    title: '创建 Agent',
    desc: 'agent-identifier',
    Icon: Icons.Bot,
    prompt:
      '使用 agent-identifier 技能。先问我 Agent 的职责、适用场景和权限边界，给一份可落地的配置方案，等我确认再落地。',
  },
  {
    title: '安装 Skill',
    desc: 'skill-installer',
    Icon: Icons.Skills,
    prompt: '优先 skill-installer 技能。先列出候选技能清单和风险，等我选定再装，不要自动安装。',
  },
  {
    title: '制作 PPT',
    desc: 'ppt-master',
    Icon: Icons.Sparkles,
    prompt:
      '先检查是否已安装 ppt-master；未安装时请通过精选市场 catalog 安装（优先 Spark 自建安装源），再使用 ppt-master 制作高质量可编辑 PPTX。主题是：',
  },
  {
    title: '制作网页',
    desc: 'spark-web-tool',
    Icon: Icons.Globe,
    prompt: '使用spark-web-tool 技能。做一个在线网页，主题是：',
  },
  {
    title: '创建团队',
    desc: 'teams',
    Icon: Icons.Team,
    prompt: '帮我创建一个团队，用来做：',
  },
  {
    title: '打开浏览器',
    desc: 'browser-use',
    Icon: Icons.Monitor,
    prompt:
      '优先 browser-use 技能。告诉我你想打开的网址、要做什么（抓取信息 / 操作页面 / 截图），确认后再执行。',
  },
] as const

/** 空会话推荐卡片：每页展示几张（与 CSS grid 列数保持一致）。 */
const SINGLE_AGENT_HERO_VISIBLE_COUNT = 3
/** 轮换间隔，参考底部 hero-tips 节奏（5s）。 */
const SINGLE_AGENT_HERO_ROTATE_MS = 5000

/** 单 Agent 空会话问候：按时段给出正式、稳定的开场语。 */
function getHeroGreeting(): HeroGreetingCopy {
  const h = new Date().getHours()
  if (h < 5) {
    return {
      title: '稳步推进当前任务',
      body: '把目标告诉我，我会先梳理上下文，再给出清晰的执行路径。',
    }
  }
  if (h < 11) {
    return {
      title: '早安，准备开始',
      body: '可以从一个问题、一段代码或一个项目目标开始，我会协助拆解并执行。',
    }
  }
  if (h < 18) {
    return {
      title: '下午好，继续推进',
      body: '我可以接手修改、运行验证，或先帮你把复杂需求整理成可执行步骤。',
    }
  }
  return {
    title: '晚上好，整理下一步',
    body: '适合做代码收尾、环境检查、文档更新，或把明天的任务先规划清楚。',
  }
}

/* 空会话底部：纵向轮播的功能 / 快捷键 / 小技巧提示（淡色，5s 切换，悬停暂停）。 */
type HeroTipKind = 'shortcut' | 'feature' | 'tip'

type HeroTip = {
  kind: HeroTipKind
  text: string
}

const HERO_TIP_LABEL: Record<HeroTipKind, string> = {
  shortcut: '快捷键',
  feature: '功能',
  tip: '小技巧',
}

/**
 * 文案只引用真实存在的快捷键 / 功能；修饰键按平台显示 ⌘ 或 Ctrl
 * （复用 useKeyboard.formatShortcut，与设置页一致）。
 */
const HERO_TIPS: HeroTip[] = [
  // ── 快捷键（均来自 useKeyboard.DEFAULT_SHORTCUTS，修饰键按平台显示 ⌘ / Ctrl）──
  {
    kind: 'shortcut',
    text: `按 ${formatShortcut('B')} 可随时呼出「快捷录入任务」浮窗，灵感不丢失。`,
  },
  { kind: 'shortcut', text: `${formatShortcut('F')} 打开命令面板，还能优先搜索会话与菜单。` },
  { kind: 'shortcut', text: `${formatShortcut('L')} 快速聚焦输入框并滚动到底部，开始新一轮对话。` },
  {
    kind: 'shortcut',
    text: `${formatShortcut('N')} 新建会话，${formatShortcut('N', true)} 则新建项目。`,
  },
  { kind: 'shortcut', text: `${formatShortcut(',')} 打开设置，模型、外观、快捷键都在这里。` },
  {
    kind: 'shortcut',
    text: `在 Chat 页按 ${formatShortcut('K')} 聚焦侧边栏会话搜索框，秒级定位历史会话。`,
  },
  {
    kind: 'shortcut',
    text: `${formatShortcut('3')} / ${formatShortcut('4')} / ${formatShortcut('5')} 在 Workflows、Agents、Skills 视图间快速切换。`,
  },
  { kind: 'shortcut', text: `${formatShortcut('6')} 直达连接器与 MCP 视图，管理外部服务接入。` },
  { kind: 'shortcut', text: `按 Esc 收起当前弹窗、面板或浮层，保持桌面清爽。` },
  // ── 功能（平台助手真实能力 + 应用内置功能）──
  { kind: 'feature', text: `让平台助手建 Agent：「做一个收集全球热点新闻的助手，并装好技能」。` },
  { kind: 'feature', text: `告诉平台助手你想增强的能力，它会先给安装方案等你确认。` },
  {
    kind: 'feature',
    text: `让平台助手切模型：「把默认模型换成 claude-sonnet，推理强度调到 high」。`,
  },
  { kind: 'feature', text: `让平台助手接外部服务：「帮我接上 GitHub 连接器，能读写我的仓库」。` },
  { kind: 'feature', text: `打开会话检查器，实时查看 token 用量、上下文账本与执行流程。` },
  { kind: 'feature', text: `大改动前勾选 Worktree，在隔离的工作树里放心试验。` },
  { kind: 'feature', text: `卡住时开启调试模式，让 Agent 自己定位问题再请你复现。` },
  { kind: 'feature', text: `内置联网搜索，问「最新」「今天」类问题会自动检索并带上出处。` },
  // ── 小技巧 ──
  { kind: 'tip', text: `用 /goal 设定本次会话目标，Agent 会围绕它规划与汇报。` },
  { kind: 'tip', text: `复杂需求拆成步骤再发，执行会更稳、更可控。` },
  { kind: 'tip', text: `团队模式里，用 @ 提及某个 Agent，让指令指向更明确。` },
  { kind: 'tip', text: `/checkpoint 留好快照，关键节点随时回滚到正确状态。` },
  { kind: 'tip', text: `去 Skills 视图逛逛技能市场，一键给 Agent 装上新本事。` },
  { kind: 'tip', text: `不确定怎么描述？把目标原样贴进来，让 Agent 先拆给你看。` },
  { kind: 'tip', text: `顶部头像菜单的「主题色」里 8 种配色任选，给应用换个心情。` },
  {
    kind: 'tip',
    text: `同一菜单里的「菜单栏样式」可在「悬浮态 / 扁平态」间切换，挑喜欢的桌面观感。`,
  },
]

export function HeroTipsTicker() {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (paused) return
    const timer = window.setInterval(() => {
      setIndex((i) => (i + 1) % HERO_TIPS.length)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [paused])

  const tip = HERO_TIPS[index]
  if (!tip) return null
  return (
    <div
      className="hero-tips-wrap"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* key 随 index 变化触发重挂载，重播 hero-tip-in 进入动画，实现「纵向淡入上移」的轮播切换。 */}
      <div className="hero-tips-ticker" key={index} aria-live="polite">
        <span className={`hero-tips-chip hero-tips-chip-${tip.kind}`}>
          {HERO_TIP_LABEL[tip.kind]}
        </span>
        <span className="hero-tips-text">{tip.text}</span>
      </div>
    </div>
  )
}

export function SingleAgentEmptyHero({ onSelectPrompt }: { onSelectPrompt: (prompt: string) => void }) {
  const greeting = getHeroGreeting()

  // 推荐卡片按窗口宽度决定每页展示几张；移动端 grid 会塌成单列（见 .less），
  // 用 matchMedia 跟 grid 列数同步，桌面端 3 列 / 移动端 1 列。
  // 双层 cross-fade 用一个 phase state 描述：activePage 是当前渲染页；
  // outgoingPage 是正在淡出的旧页（动画完成前为非 null）。
  // 用 setState callback 在 setInterval 回调里推进，避免 effect 同步 setState。
  const [visibleCount, setVisibleCount] = useState(SINGLE_AGENT_HERO_VISIBLE_COUNT)
  const [paused, setPaused] = useState(false)
  const [phase, setPhase] = useState<{ activePage: number; outgoingPage: number | null }>({
    activePage: 0,
    outgoingPage: null,
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia('(max-width: 720px)')
    const apply = () => {
      // 列数变化时同步重置 phase（避免越界）。回调里 setState 是合法的。
      setVisibleCount(mql.matches ? 1 : SINGLE_AGENT_HERO_VISIBLE_COUNT)
      setPhase({ activePage: 0, outgoingPage: null })
    }
    apply()
    // Safari < 14 走 addListener；新版走 addEventListener。
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', apply)
      return () => mql.removeEventListener('change', apply)
    }
    mql.addListener(apply)
    return () => mql.removeListener(apply)
  }, [])

  const totalActions = SINGLE_AGENT_HERO_ACTIONS.length
  const pageCount = Math.max(1, Math.ceil(totalActions / visibleCount))

  useEffect(() => {
    if (paused || pageCount <= 1) return
    const timer = window.setInterval(() => {
      setPhase((prev) => {
        const next = (prev.activePage + 1) % pageCount
        if (next === prev.activePage) return prev
        return { activePage: next, outgoingPage: prev.activePage }
      })
    }, SINGLE_AGENT_HERO_ROTATE_MS)
    return () => window.clearInterval(timer)
  }, [paused, pageCount])

  // 切换完成后清理 outgoingPage（动画 ~280ms，留余量到 600ms）
  useEffect(() => {
    if (phase.outgoingPage == null) return
    const t = window.setTimeout(() => {
      setPhase((prev) =>
        prev.outgoingPage == null ? prev : { activePage: prev.activePage, outgoingPage: null },
      )
    }, 600)
    return () => window.clearTimeout(t)
  }, [phase.outgoingPage])

  const sliceFor = (p: number) =>
    SINGLE_AGENT_HERO_ACTIONS.slice(p * visibleCount, p * visibleCount + visibleCount)
  const activeActions = sliceFor(phase.activePage)
  const outgoingActions = phase.outgoingPage != null ? sliceFor(phase.outgoingPage) : []

  return (
    <section className="single-empty-hero" aria-label="空会话欢迎提示">
      <div className="single-empty-copy">
        <h1 className="chat-hero-title single-empty-title">{greeting.title}</h1>
        {/* <p className="single-empty-body">{greeting.body}</p> */}
      </div>
      <div
        className="single-empty-actions"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        {/* outgoing 层：仅在切换瞬间渲染，absolute 覆盖在 active 之上向左淡出。
            用 snapshot（不可点击 + 只显示标题），减负 + 避免误点。 */}
        {outgoingActions.length > 0 && (
          <div
            className="single-empty-actions-layer single-empty-actions-layer-out"
            aria-hidden="true"
          >
            {outgoingActions.map(({ title, Icon }, i) => (
              <div
                key={`out-${phase.outgoingPage}-${title}`}
                className="single-empty-action single-empty-action-snapshot"
                style={{ '--card-i': i } as React.CSSProperties}
              >
                <span className="single-empty-action-icon">
                  <Icon size={14} />
                </span>
                <span className="single-empty-action-copy">
                  <strong>{title}</strong>
                </span>
              </div>
            ))}
          </div>
        )}
        {/* active 层：每次 activePage 变化都会重挂载（key 变化），触发 slide-in 入场动画。 */}
        <div
          key={`in-${phase.activePage}`}
          className="single-empty-actions-layer single-empty-actions-layer-in"
          aria-label="可尝试的任务类型"
        >
          {activeActions.map(({ title, desc, Icon, prompt }, i) => (
            <button
              key={title}
              type="button"
              className="single-empty-action"
              style={{ '--card-i': i } as React.CSSProperties}
              onClick={() => onSelectPrompt(prompt)}
            >
              <span className="single-empty-action-icon">
                <Icon size={14} />
              </span>
              <span className="single-empty-action-copy">
                <strong>{title}</strong>
                <span>{desc}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

function AgentAvatarBadge({
  agent,
  fallbackId,
  className = '',
  running = false,
}: {
  agent: ManagedAgent | null
  fallbackId: string
  className?: string
  running?: boolean
}) {
  const name = agent?.name ?? fallbackId
  const config = getAgentAvatarConfig(agent?.metadata, agent?.id ?? fallbackId, name)
  return (
    <span className={`team-avatar-badge ${running ? 'is-running' : ''} ${className}`}>
      <AvatarImage
        src={resolveAvatarSrc(config)}
        seed={agent?.id ?? fallbackId}
        name={name}
        alt={`${name} 头像`}
      />
      {running && <span className="team-avatar-badge-pulse" aria-hidden="true" />}
    </span>
  )
}

export function TeamModeEmptyHero({
  agents,
  hostAgentId,
  memberAgentIds,
  runningAgentIds,
  teamName,
  onOpenTeamInspector,
}: {
  agents: ManagedAgent[]
  hostAgentId: string
  memberAgentIds: string[]
  runningAgentIds: string[]
  /** 已保存团队名（临时团队为 null）；用于标题「<团队名> 已就绪」 */
  teamName?: string | null
  onOpenTeamInspector: () => void
}) {
  const hostAgent = resolveAgentDisplay(agents, hostAgentId)
  const readyTitle =
    teamName != null && teamName.trim().length > 0 ? `${teamName} 已就绪` : '团队已就绪'
  const uniqueMemberIds = memberAgentIds.filter(
    (id, index, list) => id !== hostAgentId && list.indexOf(id) === index,
  )
  const visibleMemberIds = uniqueMemberIds.slice(0, 6)
  const runningSet = new Set(runningAgentIds)
  const memberCount = uniqueMemberIds.length

  return (
    <section className="team-empty-hero" aria-label="团队模式空会话">
      <div className="team-empty-orbit" aria-hidden="true">
        <div className="team-empty-orbit-ring" />
        <div className="team-empty-host">
          <AgentAvatarBadge
            agent={hostAgent}
            fallbackId={hostAgentId || 'platform-manager-agent'}
            className="host"
            running={runningSet.has(hostAgentId)}
          />
          {/* <span className="team-empty-host-label">Host</span> */}
        </div>
        {visibleMemberIds.map((memberId, index) => {
          const member = resolveAgentDisplay(agents, memberId)
          return (
            <span
              key={memberId}
              className={`team-empty-member member-${index + 1}`}
              style={{ ['--member-index' as string]: index }}
            >
              <AgentAvatarBadge
                agent={member}
                fallbackId={memberId}
                running={runningSet.has(memberId)}
              />
            </span>
          )
        })}
        {memberCount === 0 && (
          <div className="team-empty-member-placeholder">
            <Icons.Plus size={18} />
          </div>
        )}
      </div>
      <div className="team-empty-copy">
        {/* <h1 className="chat-hero-title team-empty-title">{readyTitle}</h1> */}
        <span className="chat-hero-span team-empty-desc">
          {hostAgent?.name ?? '平台管理'} 将协调成员 Agent 分工、执行和汇总结果
        </span>
        {memberCount ? (
          <div className="team-empty-meta">
            <span>Host：{hostAgent?.name ?? '平台管理'}</span>
            <span>成员：{memberCount}</span>
            {runningAgentIds.length > 0 && <span>{runningAgentIds.length} 位成员执行中</span>}
          </div>
        ) : null}

        {memberCount === 0 && (
          <button type="button" className="team-empty-action" onClick={onOpenTeamInspector}>
            <Icons.Team size={14} /> 添加团队成员
          </button>
        )}
      </div>
    </section>
  )
}

