import React, { useEffect, useState } from 'react'
import type { ManagedAgent } from '@spark/protocol'
import { Dropdown } from 'antd'
import { Icons } from '../../Icons'
import { getAgentAvatarConfig, resolveAvatarSrc } from '../../avatar'
import { AvatarImage } from '../../components/AvatarImage'
import { formatShortcut } from '../../hooks/useKeyboard'
import {
  EMPTY_HERO_THEMES,
  getClassicEmptyHeroTitle,
  getEmptyHeroTheme,
  getEmptyHeroTitleLines,
  type EmptyHeroThemeId,
} from './emptyHeroThemes'

export function resolveAgentDisplay(agents: ManagedAgent[], agentId: string | null | undefined) {
  if (agentId == null || agentId.length === 0) return null
  return agents.find((agent) => agent.id === agentId) ?? null
}

/**
 * 空会话推荐卡片：桌面端每次展示 4 个，5s 自动轮换一组，鼠标悬停暂停。
 *
 * 卡片规范：
 * - 标题 ≤ 6 字，简短有力
 * - desc 一行：Agent · 关键技能，便于一眼判断能力归属
 * - prompt 简洁：携带技能推荐 + 示例话术；点击后带入输入框，由 Agent 自行判断
 *   是否需要安装技能（如 ppt-master 需走 skill-installer 流程）。
 */
const SINGLE_AGENT_HERO_ACTIONS = [
  {
    title: '制作网页',
    desc: 'Web · 从设计到部署',
    Icon: Icons.Globe,
    prompt: '使用spark-web-tool 技能。做一个在线网页，主题是：',
  },
  {
    title: '创建团队',
    desc: 'Teams · 多 Agent 协作',
    Icon: Icons.Team,
    prompt: '帮我创建一个团队，用来做：',
  },
  {
    title: '打开浏览器',
    desc: 'Browser · 浏览与操作',
    Icon: Icons.Monitor,
    prompt:
      '优先 browser-use 技能。告诉我你想打开的网址、要做什么（抓取信息 / 操作页面 / 截图），确认后再执行。',
  },
  {
    title: '分析项目',
    desc: 'Codebase · 理清结构',
    Icon: Icons.Search,
    prompt:
      '请先阅读当前项目，梳理架构、关键执行流程和需要优先关注的风险，然后给我一份简洁的项目导览。',
  },
  {
    title: '创建 Agent',
    desc: 'Agent · 定义专属角色',
    Icon: Icons.Bot,
    prompt:
      '使用 agent-identifier 技能。先问我 Agent 的职责、适用场景和权限边界，给一份可落地的配置方案，等我确认再落地。',
  },
  {
    title: '安装 Skill',
    desc: 'Skills · 扩展新能力',
    Icon: Icons.Skills,
    prompt: '优先 skill-installer 技能。先列出候选技能清单和风险，等我选定再装，不要自动安装。',
  },
  {
    title: '制作 PPT',
    desc: 'Slides · 可编辑演示稿',
    Icon: Icons.Sparkles,
    prompt:
      '先检查是否已安装 ppt-master；未安装时请通过精选市场 catalog 安装（优先 Spark 自建安装源），再使用 ppt-master 制作高质量可编辑 PPTX。主题是：',
  },
  {
    title: '继续开发',
    desc: 'Workspace · 接续上下文',
    Icon: Icons.Code,
    prompt:
      '请读取当前工作区和最近改动，概括上次做到哪里、还有哪些未完成事项，然后从最合理的下一步继续开发。',
  },
] as const

/** 空会话推荐卡片：宽屏每页展示几张（与主题 CSS grid 保持一致）。 */
const SINGLE_AGENT_HERO_VISIBLE_COUNT = 4
/** 轮换间隔，参考底部 hero-tips 节奏（5s）。 */
const SINGLE_AGENT_HERO_ROTATE_MS = 5000

const EMPTY_HERO_THEME_SHORT_LABELS: Record<EmptyHeroThemeId, string> = {
  none: '经典',
  celestial: '星图',
  studio: '灵感',
  midnight: '午夜',
  geometry: '几何',
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

function EmptyHeroThemeSwitcher({
  themeId,
  onSelectTheme,
}: {
  themeId: EmptyHeroThemeId
  onSelectTheme: (themeId: EmptyHeroThemeId) => void
}) {
  const [open, setOpen] = useState(false)
  const theme = getEmptyHeroTheme(themeId)

  return (
    <Dropdown
      menu={{ items: [] }}
      open={open}
      trigger={['click']}
      placement="bottomLeft"
      autoAdjustOverflow
      onOpenChange={setOpen}
      overlayClassName="empty-hero-theme-dropdown"
      getPopupContainer={(triggerNode) =>
        triggerNode.closest<HTMLElement>('.chat-main-empty') ?? document.body
      }
      popupRender={() => (
        <div className="empty-hero-theme-menu" role="menu" aria-label="选择会话主题">
          {EMPTY_HERO_THEMES.map((option) => {
            const selected = option.id === theme.id
            return (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={selected ? 'is-active' : ''}
                onClick={() => {
                  setOpen(false)
                  if (!selected) onSelectTheme(option.id)
                }}
              >
                <span
                  className="empty-hero-theme-swatch"
                  style={{ background: option.preview }}
                  aria-hidden="true"
                />
                <span className="empty-hero-theme-option-copy">
                  <strong>{option.name}</strong>
                  <span>{option.description}</span>
                </span>
                {selected && <Icons.Check size={13} aria-hidden="true" />}
              </button>
            )
          })}
        </div>
      )}
    >
      <button
        type="button"
        className="empty-hero-theme-trigger"
        aria-label={`切换会话主题，当前为${theme.name}`}
        aria-expanded={open}
      >
        <span>{EMPTY_HERO_THEME_SHORT_LABELS[theme.id]}</span>
        <Icons.ChevronDown size={11} aria-hidden="true" />
      </button>
    </Dropdown>
  )
}

export function SingleAgentEmptyHero({
  themeId,
  onSelectPrompt,
  onSelectTheme,
}: {
  themeId: EmptyHeroThemeId
  onSelectPrompt: (prompt: string) => void
  onSelectTheme: (themeId: EmptyHeroThemeId) => void
}) {
  const theme = getEmptyHeroTheme(themeId)
  const isClassicTheme = theme.id === 'none'
  const [localHour, setLocalHour] = useState(() => new Date().getHours())

  useEffect(() => {
    if (theme.id !== 'celestial' && !isClassicTheme) return
    const timer = window.setInterval(() => setLocalHour(new Date().getHours()), 60_000)
    return () => window.clearInterval(timer)
  }, [isClassicTheme, theme.id])

  const titleLines = getEmptyHeroTitleLines(theme, localHour)

  // 推荐卡片按窗口宽度决定每页展示几张；移动端 grid 会塌成单列（见 .less），
  // 用 matchMedia 跟 grid 列数同步：宽屏 4 列、中等窗口 2 列、窄屏 1 列。
  // 双层 cross-fade 用一个 phase state 描述：activePage 是当前渲染页；
  // outgoingPage 是正在淡出的旧页（动画完成前为非 null）。
  // 用 setState callback 在 setInterval 回调里推进，避免 effect 同步 setState。
  const [visibleCount, setVisibleCount] = useState(
    isClassicTheme ? 3 : SINGLE_AGENT_HERO_VISIBLE_COUNT,
  )
  const [paused, setPaused] = useState(false)
  const [phase, setPhase] = useState<{ activePage: number; outgoingPage: number | null }>({
    activePage: 0,
    outgoingPage: null,
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const narrowMql = window.matchMedia('(max-width: 720px)')
    const mediumMql = window.matchMedia('(max-width: 1100px)')
    const apply = () => {
      // 列数变化时同步重置 phase（避免越界）。回调里 setState 是合法的。
      setVisibleCount(
        narrowMql.matches
          ? 1
          : isClassicTheme
            ? 3
            : mediumMql.matches
              ? 2
              : SINGLE_AGENT_HERO_VISIBLE_COUNT,
      )
      setPhase({ activePage: 0, outgoingPage: null })
    }
    apply()
    // Safari < 14 走 addListener；新版走 addEventListener。
    if (typeof narrowMql.addEventListener === 'function') {
      narrowMql.addEventListener('change', apply)
      mediumMql.addEventListener('change', apply)
      return () => {
        narrowMql.removeEventListener('change', apply)
        mediumMql.removeEventListener('change', apply)
      }
    }
    narrowMql.addListener(apply)
    mediumMql.addListener(apply)
    return () => {
      narrowMql.removeListener(apply)
      mediumMql.removeListener(apply)
    }
  }, [isClassicTheme])

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
    <section
      className={
        isClassicTheme ? 'single-empty-hero' : `single-empty-hero single-empty-hero-${theme.id}`
      }
      data-empty-theme={isClassicTheme ? undefined : theme.id}
      aria-label={isClassicTheme ? '空会话欢迎提示' : `${theme.name}空会话欢迎提示`}
    >
      {isClassicTheme ? (
        <div className="single-empty-copy">
          <div className="single-empty-title-row">
            <h1 className="chat-hero-title single-empty-title">
              {getClassicEmptyHeroTitle(localHour)}
            </h1>
            <EmptyHeroThemeSwitcher themeId={theme.id} onSelectTheme={onSelectTheme} />
          </div>
        </div>
      ) : (
        <div className="single-empty-heading">
          <div className="single-empty-copy">
            <span className="single-empty-eyebrow">{theme.eyebrow}</span>
            <div className="single-empty-title-row">
              <h1 className="chat-hero-title single-empty-title">
                {titleLines.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </h1>
              <EmptyHeroThemeSwitcher themeId={theme.id} onSelectTheme={onSelectTheme} />
            </div>
            <p className="single-empty-body">{theme.body}</p>
          </div>
        </div>
      )}
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
              {!isClassicTheme && (
                <span className="single-empty-action-arrow" aria-hidden="true">
                  →
                </span>
              )}
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
          {hostAgent?.name ?? 'Spark助手'} 将协调成员 Agent 分工、执行和汇总结果
        </span>
        {memberCount ? (
          <div className="team-empty-meta">
            <span>Host：{hostAgent?.name ?? 'Spark助手'}</span>
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
