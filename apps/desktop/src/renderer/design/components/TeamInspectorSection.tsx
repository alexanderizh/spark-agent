/**
 * TeamInspectorSection — Inspector 中的「团队成员」区块
 *
 * 设计文档 §5.3：仅在 Session 处于 Team Mode 时显示，位于 Skills 区块上方。
 * - 当前对话 Agent 行：不可关闭（灰色 disabled）。
 * - 成员行：toggle 表示是否允许在当前 Session 被 dispatch。
 * - 「邀请成员」：展开候选 Agent 列表加入。
 * - 高级：允许嵌套调用 + 最大深度。
 *
 * 本组件纯受控（props + 回调）。Phase 1 由 ChatView 本地 state 驱动；
 * Phase 2 起回调改为走 team:update IPC。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './TeamInspectorSection.less'
import { Icons } from '../Icons'
import { deriveTeamAvatar } from '../teamAvatar'
import { getAgentAvatarConfig, resolveAvatarSrc } from '../avatar'
import { AvatarImage } from './AvatarImage'
import { Checkbox as LobeCheckbox, Input as LobeInput, Select as LobeSelect, TextArea as LobeTextArea } from '@lobehub/ui'
import { useIpcInvoke } from '../hooks/useIpc'
import { useToast } from './Toast'
import type { ManagedTeam, TeamModeConfig } from '@spark/protocol'

export interface TeamInspectorAgent {
  id: string
  name: string
  description: string
  builtIn: boolean
  /** 只读详情（点击成员行展开）：供应商/模型/技能数/MCP 数 */
  providerProfileId?: string | null
  modelId?: string | null
  skillCount?: number
  mcpCount?: number
  metadata?: Record<string, unknown> | undefined
}

export interface TeamInspectorSectionProps {
  config: TeamModeConfig
  /** 所有可选 Agent（含当前对话 Agent；本组件内部会单列） */
  agents: TeamInspectorAgent[]
  runningAgentIds?: string[]
  onToggleMember: (agentId: string, enabled: boolean) => void
  onChangeConfig: (patch: Partial<TeamModeConfig>) => void
}

function AgentAvatar({
  id,
  name,
  builtIn: _builtIn,
  metadata,
}: {
  id: string
  name: string
  builtIn: boolean
  metadata?: Record<string, unknown> | undefined
}) {
  const avatar = deriveTeamAvatar(id, name)
  const src = resolveAvatarSrc(getAgentAvatarConfig(metadata, id, name))
  return (
    <span className="team-roster-avatar" style={{ ['--member-accent' as string]: avatar.color }}>
      <AvatarImage src={src} seed={id} name={name} />
    </span>
  )
}

export function TeamInspectorSection({
  config,
  agents,
  runningAgentIds = [],
  onToggleMember,
  onChangeConfig,
}: TeamInspectorSectionProps) {
  const { toast } = useToast()
  const { invoke: getTeamDef } = useIpcInvoke('team:get-def')
  const { invoke: createTeamDef } = useIpcInvoke('team:create-def')
  const { invoke: updateTeamDef } = useIpcInvoke('team:update-def')

  const [collapsed, setCollapsed] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  // 默认 'down'：TeamInspectorSection 是 inspector 的第一个 section，
  // invite 按钮天然靠近顶部，向下弹出更安全（避免首次打开方向判断前的瞬间溢出）
  const [invitePlacement, setInvitePlacement] = useState<'up' | 'down'>('down')
  const [inviteMaxH, setInviteMaxH] = useState<number>(256)
  const [hostPickerOpen, setHostPickerOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const inviteRef = useRef<HTMLDivElement | null>(null)
  const inviteBtnRef = useRef<HTMLButtonElement | null>(null)

  // 邀请浮层：点击外部关闭
  useEffect(() => {
    if (!inviteOpen) return
    const onDown = (e: MouseEvent) => {
      if (inviteRef.current && !inviteRef.current.contains(e.target as Node)) {
        setInviteOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [inviteOpen])

  // 邀请浮层方向：根据按钮在 inspector 滚动容器中的剩余可见空间选择上/下，
  // 并自适应 max-height，避免弹窗顶部溢出 inspector / viewport 顶部。
  const handleToggleInvite = () => {
    if (!inviteOpen && inviteBtnRef.current) {
      const btn = inviteBtnRef.current
      const rect = btn.getBoundingClientRect()
      // 定位最近的 inspector 滚动容器（弹窗的视觉边界由它决定）
      const container = btn.closest('.inspector.scroll') as HTMLElement | null
      const cRect = container?.getBoundingClientRect()
      const cTop = cRect?.top ?? 0
      const cBottom = cRect?.bottom ?? window.innerHeight
      // 按钮在容器内的可见空间
      const topSpace = rect.top - cTop
      const bottomSpace = cBottom - rect.bottom
      const gap = 6
      const ideal = 256 + gap // pop 理想 max-height 256 + gap 6

      let placement: 'up' | 'down'
      let maxH: number
      if (topSpace >= ideal) {
        placement = 'up'
        maxH = 256
      } else if (bottomSpace >= ideal) {
        placement = 'down'
        maxH = 256
      } else if (topSpace >= bottomSpace) {
        // 两侧都不够：选空间更大的一侧，并自适应缩小高度
        placement = 'up'
        maxH = Math.max(140, Math.floor(topSpace - gap))
      } else {
        placement = 'down'
        maxH = Math.max(140, Math.floor(bottomSpace - gap))
      }

      // 【debug-invite-overflow】方向判断证据，定位完会移除
      console.log('[debug-invite-overflow]', {
        btnTop: Math.round(rect.top),
        btnBottom: Math.round(rect.bottom),
        cTop: Math.round(cTop),
        cBottom: Math.round(cBottom),
        topSpace: Math.round(topSpace),
        bottomSpace: Math.round(bottomSpace),
        placement,
        maxH,
      })

      setInvitePlacement(placement)
      setInviteMaxH(maxH)
    }
    setInviteOpen((prev) => !prev)
  }

  // 当 config.teamId 命中长期团队时，缓存该团队定义用于：
  // 1) 显示「来自团队：<名称>」徽章
  // 2) 比较 live config 与 stored，决定是否显示「同步到团队」
  const [sourceTeam, setSourceTeam] = useState<ManagedTeam | null>(null)
  useEffect(() => {
    if (config.teamId == null) {
      setSourceTeam(null)
      return
    }
    let cancelled = false
    void getTeamDef({ id: config.teamId })
      .then((res) => {
        if (!cancelled) setSourceTeam(res.team)
      })
      .catch(() => {
        if (!cancelled) setSourceTeam(null)
      })
    return () => {
      cancelled = true
    }
  }, [config.teamId, getTeamDef])

  const dirtyVsTeam = useMemo(() => {
    if (sourceTeam == null) return false
    const sameMembers =
      sourceTeam.memberAgentIds.length === config.memberAgentIds.length &&
      new Set(sourceTeam.memberAgentIds).size ===
        new Set([...sourceTeam.memberAgentIds, ...config.memberAgentIds]).size
    const sourceMaxRounds = sourceTeam.maxDiscussionRounds ?? 6
    const configMaxRounds = config.maxDiscussionRounds ?? 6
    return (
      sourceTeam.hostAgentId !== config.hostAgentId ||
      !sameMembers ||
      sourceTeam.maxDepth !== config.maxDepth ||
      sourceTeam.allowNesting !== config.allowNesting ||
      sourceMaxRounds !== configMaxRounds ||
      (sourceTeam.enablePeerMessaging === true) !== (config.enablePeerMessaging === true)
    )
  }, [sourceTeam, config])

  // ── 保存为长期团队 / 同步回团队 表单 ──
  const [saveFormOpen, setSaveFormOpen] = useState(false)
  const [saveDraftName, setSaveDraftName] = useState('')
  const [saveDraftDesc, setSaveDraftDesc] = useState('')
  const [saveDraftPrompt, setSaveDraftPrompt] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSaveAsTeam = useCallback(async () => {
    if (saveDraftName.trim().length === 0) {
      toast.warning('请填写团队名称')
      return
    }
    setSaving(true)
    try {
      const res = await createTeamDef({
        name: saveDraftName.trim(),
        description: saveDraftDesc.trim(),
        hostAgentId: config.hostAgentId,
        memberAgentIds: config.memberAgentIds,
        maxDepth: config.maxDepth,
        allowNesting: config.allowNesting,
        maxDiscussionRounds: config.maxDiscussionRounds ?? 6,
        enablePeerMessaging: config.enablePeerMessaging === true,
        prompt: saveDraftPrompt,
        enabled: true,
      })
      toast.success(`团队「${res.team.name}」已保存`)
      onChangeConfig({ teamId: res.team.id })
      setSaveFormOpen(false)
      setSaveDraftName('')
      setSaveDraftDesc('')
      setSaveDraftPrompt('')
    } catch (err) {
      toast.error('保存失败：' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setSaving(false)
    }
  }, [createTeamDef, config, saveDraftName, saveDraftDesc, saveDraftPrompt, onChangeConfig, toast])

  const handleSyncToTeam = useCallback(async () => {
    if (sourceTeam == null) return
    if (sourceTeam.builtIn) {
      toast.warning('内置团队不可修改成员配置，请「另存为」新团队')
      return
    }
    setSaving(true)
    try {
      const res = await updateTeamDef({
        id: sourceTeam.id,
        hostAgentId: config.hostAgentId,
        memberAgentIds: config.memberAgentIds,
        maxDepth: config.maxDepth,
        allowNesting: config.allowNesting,
        maxDiscussionRounds: config.maxDiscussionRounds ?? 6,
        enablePeerMessaging: config.enablePeerMessaging === true,
      })
      setSourceTeam(res.team)
      toast.success(`已同步到团队「${res.team.name}」`)
    } catch (err) {
      toast.error('同步失败：' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setSaving(false)
    }
  }, [sourceTeam, updateTeamDef, config, toast])

  const handleDetach = useCallback(() => {
    onChangeConfig({ teamId: undefined })
  }, [onChangeConfig])

  const host = agents.find((a) => a.id === config.hostAgentId)
  const memberSet = new Set(config.memberAgentIds)
  const runningSet = new Set(runningAgentIds)
  const members = agents.filter((a) => a.id !== config.hostAgentId && memberSet.has(a.id))
  const candidates = agents.filter((a) => a.id !== config.hostAgentId && !memberSet.has(a.id))
  // 切换主持人列表：当前主持人置顶
  const hostPickerAgents = host != null ? [host, ...agents.filter((a) => a.id !== host.id)] : agents

  // 切换 Host：旧 Host 自动成为可被调用成员（保留可见性），新 Host 从成员中移除。
  // 一步原子更新，避免父组件先后 setState 触发重复 IPC 持久化。
  const handleSelectHost = (nextHostId: string) => {
    setHostPickerOpen(false)
    if (nextHostId === config.hostAgentId) return
    const nextMembers = new Set(config.memberAgentIds)
    nextMembers.delete(nextHostId) // 新 Host 不再算成员
    if (config.hostAgentId) nextMembers.add(config.hostAgentId) // 旧 Host 转为成员
    onChangeConfig({ hostAgentId: nextHostId, memberAgentIds: Array.from(nextMembers) })
  }

  return (
    <div className="inspector-section team-inspector-section">
      <h4 className="config-panel-header" onClick={() => setCollapsed(!collapsed)}>
        <span className="team-inspector-title">
          <Icons.Team size={14} /> 团队成员
          <span className="team-inspector-count">{members.length}</span>
        </span>
        {collapsed ? <Icons.ChevronRight size={14} /> : <Icons.ChevronDown size={14} />}
      </h4>

      {!collapsed && (
        <div className="team-roster">
          {/* 团队来源徽章：当 config.teamId 命中长期团队时显示 */}
          {sourceTeam != null && (
            <div className="team-roster-source">
              <span className="team-roster-source-label">
                <Icons.Team size={12} /> 来自团队
              </span>
              <span className="team-roster-source-name" title={sourceTeam.description}>
                {sourceTeam.name}
                {sourceTeam.builtIn && <span className="team-roster-source-tag">内置</span>}
              </span>
              {dirtyVsTeam && !sourceTeam.builtIn && (
                <button
                  type="button"
                  className="team-roster-source-action"
                  onClick={() => void handleSyncToTeam()}
                  disabled={saving}
                  title="把会话当前的成员/嵌套配置写回团队"
                >
                  {saving ? <Icons.Spinner size={11} /> : <Icons.Check size={11} />}
                  同步
                </button>
              )}
              <button
                type="button"
                className="team-roster-source-action ghost"
                onClick={handleDetach}
                title="解除会话与团队的关联，会话变为临时团队"
              >
                解除
              </button>
            </div>
          )}

          {/* 临时团队：提供「保存为长期团队」入口 */}
          {sourceTeam == null && config.memberAgentIds.length > 0 && !saveFormOpen && (
            <button
              type="button"
              className="team-roster-save-cta"
              onClick={() => setSaveFormOpen(true)}
            >
              <Icons.Plus size={12} /> 保存为长期团队…
            </button>
          )}
          {sourceTeam == null && saveFormOpen && (
            <div className="team-roster-save-form">
              <div className="team-roster-save-form-title">保存为长期团队</div>
              <LobeInput
                value={saveDraftName}
                onChange={(e) => setSaveDraftName(e.target.value)}
                placeholder="团队名称（必填）"
              />
              <LobeInput
                value={saveDraftDesc}
                onChange={(e) => setSaveDraftDesc(e.target.value)}
                placeholder="一句话描述（可选）"
              />
              <LobeTextArea
                value={saveDraftPrompt}
                onChange={(e) => setSaveDraftPrompt(e.target.value)}
                placeholder="团队专属规则（可选，作为 [Team Instructions] 注入到主持人）"
                rows={3}
              />
              <div className="team-roster-save-form-actions">
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() => setSaveFormOpen(false)}
                  disabled={saving}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="btn primary sm"
                  onClick={() => void handleSaveAsTeam()}
                  disabled={saving}
                >
                  {saving ? <Icons.Spinner size={11} /> : <Icons.Check size={11} />} 保存
                </button>
              </div>
            </div>
          )}

          {/* Host 行：点击展开 Agent 列表切换主持人 */}
          {host != null && (
            <>
              <div
                className="team-roster-row team-roster-row-host team-roster-row-clickable"
                onClick={() => setHostPickerOpen((prev) => !prev)}
                title="点击切换主持人"
              >
                <AgentAvatar id={host.id} name={host.name} builtIn={host.builtIn} metadata={host.metadata} />
                <span className="team-roster-info">
                  <span className="team-roster-name">{host.name}</span>
                  {host.description && <span className="team-roster-desc">{host.description.slice(0, 40)}</span>}
                </span>
                <span className="team-roster-host-badge">主持人</span>
                {hostPickerOpen ? (
                  <Icons.ChevronDown size={12} className="team-roster-host-chev" />
                ) : (
                  <Icons.ChevronRight size={12} className="team-roster-host-chev" />
                )}
              </div>
              {hostPickerOpen && (
                <div className="team-roster-host-picker">
                  {agents.length === 0 && <div className="team-roster-empty">没有可选 Agent</div>}
                  {hostPickerAgents.map((agent) => {
                    const isHost = agent.id === config.hostAgentId
                    return (
                      <button
                        key={agent.id}
                        type="button"
                        className={`team-roster-host-option${isHost ? ' active' : ''}`}
                        onClick={() => handleSelectHost(agent.id)}
                      >
                        <AgentAvatar
                          id={agent.id}
                          name={agent.name}
                          builtIn={agent.builtIn}
                          metadata={agent.metadata}
                        />
                        <span className="team-roster-name">{agent.name}</span>
                        {isHost && <Icons.Check size={13} />}
                      </button>
                    )
                  })}
                </div>
              )}
            </>
          )}

          {/* 成员行：点击行展开只读详情；toggle 控制是否允许被调 */}
          {members.map((agent) => (
            <div key={agent.id}>
              <div
                className="team-roster-row team-roster-row-clickable"
                onClick={() => setExpandedId((prev) => (prev === agent.id ? null : agent.id))}
              >
                <AgentAvatar id={agent.id} name={agent.name} builtIn={agent.builtIn} metadata={agent.metadata} />
                <span className="team-roster-info">
                  <span className="team-roster-name-line">
                    <span className="team-roster-name">{agent.name}</span>
                    {runningSet.has(agent.id) && (
                      <span className="team-roster-running" aria-label="正在执行任务">
                        <span className="team-member-running-dot" />
                        <span>执行中</span>
                      </span>
                    )}
                  </span>
                  {agent.description && <span className="team-roster-desc">{agent.description.slice(0, 40)}</span>}
                </span>
                <button
                  type="button"
                  className="team-roster-remove"
                  title="移出团队"
                  aria-label={`将 ${agent.name} 移出团队`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleMember(agent.id, false)
                  }}
                >
                  <Icons.Trash size={14} />
                </button>
              </div>
              {expandedId === agent.id && (
                <div className="team-roster-detail">
                  <div className="team-roster-detail-row">
                    <span className="team-roster-detail-k">模型</span>
                    <span className="team-roster-detail-v">{agent.modelId || '会话默认'}</span>
                  </div>
                  <div className="team-roster-detail-row">
                    <span className="team-roster-detail-k">供应商</span>
                    <span className="team-roster-detail-v">{agent.providerProfileId || '会话默认'}</span>
                  </div>
                  <div className="team-roster-detail-row">
                    <span className="team-roster-detail-k">Skills</span>
                    <span className="team-roster-detail-v">{agent.skillCount ?? 0}</span>
                  </div>
                  <div className="team-roster-detail-row">
                    <span className="team-roster-detail-k">MCP</span>
                    <span className="team-roster-detail-v">{agent.mcpCount ?? 0}</span>
                  </div>
                </div>
              )}
            </div>
          ))}

          {members.length === 0 && <div className="team-roster-empty">尚未邀请成员</div>}

          {/* 邀请成员：弹出浮层选择候选 Agent */}
          <div className="team-roster-invite-wrap" ref={inviteRef}>
            <button
              type="button"
              ref={inviteBtnRef}
              className="team-roster-invite-btn"
              disabled={candidates.length === 0}
              title={candidates.length === 0 ? '已没有可邀请的 Agent' : '邀请成员加入团队'}
              onClick={handleToggleInvite}
            >
              <Icons.Plus size={14} />
              <span>邀请成员</span>
            </button>
            {inviteOpen && candidates.length > 0 && (
              <div
                className="team-roster-invite-pop"
                data-placement={invitePlacement}
                style={{ maxHeight: inviteMaxH }}
              >
                <div className="team-roster-invite-pop-title">选择要加入的 Agent</div>
                <div className="team-roster-invite-pop-list">
                  {candidates.map((agent) => (
                    <button
                      key={agent.id}
                      type="button"
                      className="team-roster-invite-option"
                      onClick={() => {
                        onToggleMember(agent.id, true)
                        if (candidates.length === 1) setInviteOpen(false)
                      }}
                    >
                      <AgentAvatar
                        id={agent.id}
                        name={agent.name}
                        builtIn={agent.builtIn}
                        metadata={agent.metadata}
                      />
                      <span className="team-roster-invite-option-info">
                        <span className="team-roster-name">{agent.name}</span>
                        {agent.description && (
                          <span className="team-roster-desc">{agent.description.slice(0, 40)}</span>
                        )}
                      </span>
                      <Icons.Plus size={14} className="team-roster-invite-option-add" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 高级设置 */}
          <button type="button" className="team-roster-advanced-toggle" onClick={() => setAdvancedOpen(!advancedOpen)}>
            高级 {advancedOpen ? <Icons.ChevronUp size={12} /> : <Icons.ChevronDown size={12} />}
          </button>
          {advancedOpen && (
            <div className="team-roster-advanced">
              <div className="team-roster-advanced-row">
                <LobeCheckbox
                  checked={config.allowNesting}
                  onChange={(checked) => onChangeConfig({ allowNesting: checked })}
                >
                  允许 Member 嵌套调用
                </LobeCheckbox>
              </div>
              <div className="team-roster-advanced-row">
                <LobeCheckbox
                  checked={config.enablePeerMessaging === true}
                  onChange={(checked) => onChangeConfig({ enablePeerMessaging: checked })}
                >
                  允许成员互相留言（实验性）
                </LobeCheckbox>
              </div>
              <label className="team-roster-advanced-row">
                <span>最大深度</span>
                <LobeSelect
                  value={String(config.maxDepth)}
                  disabled={!config.allowNesting}
                  onChange={(value) => onChangeConfig({ maxDepth: Number(value) })}
                  options={[
                    { label: '1', value: '1' },
                    { label: '2', value: '2' },
                    { label: '3', value: '3' },
                  ]}
                />
              </label>
              <label className="team-roster-advanced-row">
                <span>讨论轮次上限</span>
                <LobeSelect
                  value={String(config.maxDiscussionRounds ?? 6)}
                  onChange={(value) => onChangeConfig({ maxDiscussionRounds: Number(value) })}
                  options={[
                    { label: '1', value: '1' },
                    { label: '3', value: '3' },
                    { label: '4', value: '4' },
                    { label: '6', value: '6' },
                    { label: '8', value: '8' },
                    { label: '12', value: '12' },
                    { label: '20', value: '20' },
                  ]}
                />
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
