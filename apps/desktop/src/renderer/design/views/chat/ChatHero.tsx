import { useEffect, useState } from 'react'
import type { ManagedAgent } from '@spark/protocol'
import { Icons } from '../../Icons'
import { getAgentAvatarConfig, resolveAvatarSrc } from '../../avatar'
import { AvatarImage } from '../../components/AvatarImage'
import { formatShortcut } from '../../hooks/useKeyboard'
import { getEmptyHeroTheme, getEmptyHeroTitleLines, type EmptyHeroThemeId } from './emptyHeroThemes'

export function resolveAgentDisplay(agents: ManagedAgent[], agentId: string | null | undefined) {
  if (agentId == null || agentId.length === 0) return null
  return agents.find((agent) => agent.id === agentId) ?? null
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

export function SingleAgentEmptyHero({ themeId }: { themeId: EmptyHeroThemeId }) {
  const theme = getEmptyHeroTheme(themeId)
  const [localHour, setLocalHour] = useState(() => new Date().getHours())

  useEffect(() => {
    const timer = window.setInterval(() => setLocalHour(new Date().getHours()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const titleLines = getEmptyHeroTitleLines(localHour)

  return (
    <section
      className={`single-empty-hero single-empty-hero-${theme.id}`}
      data-empty-theme={theme.id}
      aria-label={`${theme.name}空会话欢迎提示`}
    >
      <div className="single-empty-heading">
        <div className="single-empty-copy">
          <span className="single-empty-eyebrow">{theme.eyebrow}</span>
          <div className="single-empty-title-row">
            <h1 className="chat-hero-title single-empty-title">
              {titleLines.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </h1>
          </div>
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
