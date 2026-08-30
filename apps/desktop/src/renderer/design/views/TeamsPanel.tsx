/**
 * TeamsPanel — AgentsView 的「Teams」Tab，长期团队 CRUD。
 *
 * 列表屏：卡片网格（主持人头像 + 启停状态 + 成员/规则标签）。
 * 编辑屏：sticky toolbar + section 卡片（基本信息 / 主持人 / 成员 / 规则 / 嵌套）。
 *
 * 数据通道：team:list-defs / get-def / create-def / update-def / delete-def。
 * 内置团队（builtIn=true）不可删除，可调整成员与规则。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import './TeamsPanel.less'
import { Icons } from '../Icons'
import { useIpcInvoke } from '../hooks/useIpc'
import { useToast } from '../components/Toast'
import {
  Button,
  Checkbox as LobeCheckbox,
  Input as LobeInput,
  Select as LobeSelect,
  TextArea as LobeTextArea,
} from '@lobehub/ui'
import { AvatarImage } from '../components/AvatarImage'
import { AvatarPicker } from '../components/AvatarPicker'
import {
  getAgentAvatarConfig,
  normalizeAvatarConfig,
  resolveAvatarSrc,
  type SparkAvatarConfig,
} from '../avatar'
import { DEFAULT_TEAM_AVATAR_ID } from '../builtinAvatars'
import { countExistingMembers, countTeamRoster } from '../teamMembership'
import type { ManagedAgent, ManagedTeam } from '@spark/protocol'

interface TeamDraft {
  id: string | null // null = 新建
  name: string
  description: string
  hostAgentId: string
  memberAgentIds: string[]
  maxDepth: number
  allowNesting: boolean
  maxDiscussionRounds: number
  enablePeerMessaging: boolean
  prompt: string
  enabled: boolean
  builtIn: boolean
  avatar: SparkAvatarConfig
}

const EMPTY_DRAFT: TeamDraft = {
  id: null,
  name: '',
  description: '',
  hostAgentId: '',
  memberAgentIds: [],
  maxDepth: 1,
  allowNesting: false,
  maxDiscussionRounds: 6,
  enablePeerMessaging: false,
  prompt: '',
  enabled: true,
  builtIn: false,
  avatar: { kind: 'builtin', id: DEFAULT_TEAM_AVATAR_ID },
}

function teamToDraft(t: ManagedTeam): TeamDraft {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    hostAgentId: t.hostAgentId,
    memberAgentIds: t.memberAgentIds,
    maxDepth: t.maxDepth,
    allowNesting: t.allowNesting,
    maxDiscussionRounds: t.maxDiscussionRounds ?? 6,
    enablePeerMessaging: t.enablePeerMessaging === true,
    prompt: t.prompt,
    enabled: t.enabled,
    builtIn: t.builtIn,
    avatar: normalizeAvatarConfig(t.metadata?.avatar) ?? {
      kind: 'builtin',
      id: DEFAULT_TEAM_AVATAR_ID,
    },
  }
}

/** 列表卡片头像：优先 team 自定义，回退固定团队默认头像 */
function resolveTeamAvatarConfig(team: ManagedTeam): SparkAvatarConfig {
  const custom = normalizeAvatarConfig(team.metadata?.avatar)
  if (custom != null) return custom
  return { kind: 'builtin', id: DEFAULT_TEAM_AVATAR_ID }
}

export function TeamsPanel({ agents }: { agents: ManagedAgent[] }) {
  const { toast } = useToast()
  const { invoke: listDefs } = useIpcInvoke('team:list-defs')
  const { invoke: createDef } = useIpcInvoke('team:create-def')
  const { invoke: updateDef } = useIpcInvoke('team:update-def')
  const { invoke: deleteDef } = useIpcInvoke('team:delete-def')

  const [teams, setTeams] = useState<ManagedTeam[]>([])
  const [loading, setLoading] = useState(false)
  const [screen, setScreen] = useState<'list' | 'detail'>('list')
  const [draft, setDraft] = useState<TeamDraft>(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await listDefs({ includeDisabled: true })
      setTeams(res.teams)
    } catch (err) {
      toast.error('加载团队列表失败：' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setLoading(false)
    }
  }, [listDefs, toast])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    return (
      window.spark?.on?.('stream:config:changed', (event) => {
        if (event.scope === 'team') void refresh()
      }) ?? (() => {})
    )
  }, [refresh])

  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents])
  const enabledAgents = useMemo(() => agents.filter((a) => a.enabled), [agents])

  const openTeam = (team: ManagedTeam) => {
    setDraft(teamToDraft(team))
    setScreen('detail')
  }
  const openNew = () => {
    const firstAgentId = enabledAgents[0]?.id ?? 'platform-manager-agent'
    setDraft({ ...EMPTY_DRAFT, hostAgentId: firstAgentId })
    setScreen('detail')
  }
  const backToList = () => {
    setScreen('list')
    setDraft(EMPTY_DRAFT)
  }

  const updateDraft = <K extends keyof TeamDraft>(key: K, value: TeamDraft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  const toggleMember = (id: string) => {
    setDraft((prev) => {
      if (id === prev.hostAgentId) return prev
      const idSet = new Set(prev.memberAgentIds)
      if (idSet.has(id)) idSet.delete(id)
      else idSet.add(id)
      return { ...prev, memberAgentIds: Array.from(idSet) }
    })
  }

  // 切换 host 时把新 host 从 members 中剔除，避免自调用。
  const switchHost = (newHostId: string) => {
    setDraft((prev) => ({
      ...prev,
      hostAgentId: newHostId,
      memberAgentIds: prev.memberAgentIds.filter((id) => id !== newHostId),
    }))
  }

  const handleSave = async () => {
    if (draft.name.trim().length === 0) {
      toast.error('请填写团队名称')
      return
    }
    if (draft.hostAgentId.length === 0) {
      toast.error('请选择主持人 Agent')
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: draft.name.trim(),
        description: draft.description.trim(),
        hostAgentId: draft.hostAgentId,
        memberAgentIds: draft.memberAgentIds,
        maxDepth: draft.maxDepth,
        allowNesting: draft.allowNesting,
        maxDiscussionRounds: draft.maxDiscussionRounds,
        enablePeerMessaging: draft.enablePeerMessaging,
        prompt: draft.prompt,
        enabled: draft.enabled,
        metadata: { avatar: draft.avatar },
      }
      if (draft.id == null) {
        await createDef(payload)
        toast.success('团队已创建')
      } else {
        await updateDef({ id: draft.id, ...payload })
        toast.success('团队已保存')
      }
      await refresh()
      backToList()
    } catch (err) {
      toast.error('保存失败：' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (draft.id == null) return
    if (draft.builtIn) {
      toast.error('内置团队不可删除，可在编辑面板停用')
      return
    }
    if (!window.confirm(`删除团队「${draft.name}」？此操作无法撤销。`)) return
    try {
      await deleteDef({ id: draft.id })
      toast.success('团队已删除')
      await refresh()
      backToList()
    } catch (err) {
      toast.error('删除失败：' + (err instanceof Error ? err.message : String(err)))
    }
  }

  // ── 列表屏 ─────────────────────────────────────
  if (screen === 'list') {
    return (
      <div className="teams-panel">
        <div className="teams-panel-head">
          <div>
            <div className="teams-panel-title">Teams</div>
            <div className="teams-panel-desc">
              长期团队是可复用的多 Agent 协作配置：主持人 + 成员 + 嵌套参数 +
              团队专属规则。会话可一键应用某个团队，也可把临时团队保存为长期团队。
            </div>
          </div>
          <div className="teams-panel-actions">
            <Button
              size="middle"
              type="text"
              onClick={() => void refresh()}
              disabled={loading}
              icon={loading ? <Icons.Spinner size={12} /> : <Icons.Activity size={12} />}
            >
              刷新
            </Button>
            <Button
              size="middle"
              type="primary"
              onClick={openNew}
              icon={<Icons.Plus size={12} />}
            >
              新建团队
            </Button>
          </div>
        </div>

        {teams.length > 0 ? (
          <div className="agents-card-grid">
            {teams.map((team) => {
              const host = agentById.get(team.hostAgentId)
              const teamAvatar = resolveTeamAvatarConfig(team)
              return (
                <button key={team.id} className="teams-card" onClick={() => openTeam(team)}>
                  <span className="teams-card-head">
                    <span className="teams-card-avatar">
                      <AvatarImage
                        src={resolveAvatarSrc(teamAvatar)}
                        seed={team.id}
                        name={team.name}
                        alt={team.name}
                      />
                    </span>
                    <span className={`teams-card-status ${team.enabled ? 'enabled' : 'disabled'}`}>
                      {team.enabled ? '启用' : '停用'}
                    </span>
                  </span>
                  <span className="teams-card-name">{team.name}</span>
                  <span className="teams-card-desc">
                    {team.description || (team.builtIn ? '内置团队' : '自定义团队')}
                  </span>
                  <span className="teams-card-meta">
                    <span>{team.builtIn ? '内置' : '自定义'}</span>
                    {host && (
                      <>
                        <span className="teams-card-meta-dot" />
                        <span>主持：{host.name}</span>
                      </>
                    )}
                  </span>
                  <span className="teams-card-tags">
                    <span className="teams-card-tag">
                      共 {countTeamRoster(team.memberAgentIds, team.hostAgentId, agents)} 人
                    </span>
                    {team.prompt.trim().length > 0 && (
                      <span className="teams-card-tag">含团队规则</span>
                    )}
                    {team.allowNesting && (
                      <span className="teams-card-tag">嵌套 ≤{team.maxDepth}</span>
                    )}
                    <span className="teams-card-tag">轮次 ≤{team.maxDiscussionRounds ?? 6}</span>
                    {team.enablePeerMessaging === true && (
                      <span className="teams-card-tag">Peer Messaging</span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        ) : (
          !loading && (
            <div className="teams-panel-empty">
              <div className="teams-panel-empty-icon">
                <Icons.Team size={24} />
              </div>
              <div className="teams-panel-empty-title">创建第一个团队</div>
              <div className="teams-panel-empty-desc">
                团队是一组 Agent 的协作约定，会话中可一键应用。
              </div>
              <div className="teams-panel-empty-cta">
                <button className="btn primary" onClick={openNew}>
                  <Icons.Plus size={12} /> 新建团队
                </button>
              </div>
            </div>
          )
        )}
      </div>
    )
  }

  // ── 编辑屏 ─────────────────────────────────────
  const memberSet = new Set(draft.memberAgentIds)
  const host = agentById.get(draft.hostAgentId)
  return (
    <div className="teams-detail">
      <div className="teams-detail-toolbar">
        <button className="btn ghost sm" onClick={backToList} title="返回列表">
          <Icons.ArrowLeft size={12} /> 列表
        </button>
        <div className="teams-detail-title">
          <span>{draft.id == null ? '新建团队' : draft.name || '编辑团队'}</span>
          {draft.builtIn && <span className="teams-detail-title-tag">内置</span>}
        </div>
        <div className="teams-detail-actions">
          {draft.id != null && !draft.builtIn && (
            <button className="btn ghost sm" onClick={() => void handleDelete()}>
              <Icons.Trash size={12} /> 删除
            </button>
          )}
          <button className="btn primary sm" onClick={() => void handleSave()} disabled={saving}>
            {saving ? <Icons.Spinner size={12} /> : <Icons.Check size={12} />} 保存
          </button>
        </div>
      </div>

      <div className="teams-detail-body">
        <div className="teams-detail-grid">
          {/* 基本信息 */}
          <section className="teams-section">
            <div className="teams-section-head">
              <div className="teams-section-title">基本信息</div>
              <div className="teams-section-hint">名称会展示在 AgentPicker「已保存团队」列表里</div>
            </div>
            <div className="teams-avatar-row">
              <AvatarPicker
                value={draft.avatar}
                defaultSeed={draft.name || draft.id || 'team'}
                defaultAvatarId={DEFAULT_TEAM_AVATAR_ID}
                title="团队头像"
                description="未单独设置时，使用内置团队默认头像。"
                onChange={(avatar) => updateDraft('avatar', avatar)}
              />
            </div>
            <div className="teams-field-grid">
              <div className="teams-field">
                <span className="teams-field-label">名称</span>
                <LobeInput
                  value={draft.name}
                  onChange={(e) => updateDraft('name', e.target.value)}
                  placeholder="例：全栈协作组"
                />
              </div>
              <div className="teams-field">
                <span className="teams-field-label">状态</span>
                <LobeSelect
                  value={draft.enabled ? 'enabled' : 'disabled'}
                  onChange={(value) => updateDraft('enabled', value === 'enabled')}
                  options={[
                    { label: '启用', value: 'enabled' },
                    { label: '停用', value: 'disabled' },
                  ]}
                />
              </div>
              <div className="teams-field wide">
                <span className="teams-field-label">描述</span>
                <LobeTextArea
                  value={draft.description}
                  onChange={(e) => updateDraft('description', e.target.value)}
                  placeholder="一两句话说明该团队适合什么场景"
                  rows={2}
                />
              </div>
            </div>
          </section>

          {/* 主持人 */}
          <section className="teams-section">
            <div className="teams-section-head">
              <div className="teams-section-title">主持人</div>
              <div className="teams-section-hint">
                用户在会话中直接对话的 Agent，由它分派任务给成员
              </div>
            </div>
            {host && (
              <div className="teams-host-row">
                <span className="teams-host-row-avatar">
                  <AvatarImage
                    src={resolveAvatarSrc(getAgentAvatarConfig(host.metadata, host.id, host.name))}
                    seed={host.id}
                    name={host.name}
                    alt={host.name}
                  />
                </span>
                <span className="teams-host-row-name">{host.name}</span>
                {host.builtIn && <span className="teams-host-row-builtin">内置</span>}
              </div>
            )}
            <LobeSelect
              value={draft.hostAgentId}
              onChange={(value) => switchHost(String(value))}
              options={enabledAgents.map((a) => ({
                label: `${a.name}${a.builtIn ? ' (内置)' : ''}`,
                value: a.id,
              }))}
            />
          </section>

          {/* 成员 */}
          <section className="teams-section">
            <div className="teams-section-head">
              <div className="teams-section-title">成员</div>
              <span className="teams-section-count">
                {countExistingMembers(draft.memberAgentIds, agents)}
              </span>
            </div>
            <div className="teams-section-hint">
              勾选可被主持人调用（dispatch）的成员。主持人本身不会出现在此列表。
            </div>
            <div className="teams-members-grid">
              {enabledAgents
                .filter((a) => a.id !== draft.hostAgentId)
                .map((a) => {
                  const checked = memberSet.has(a.id)
                  return (
                    <button
                      key={a.id}
                      type="button"
                      className={`teams-member-chip${checked ? ' active' : ''}`}
                      onClick={() => toggleMember(a.id)}
                    >
                      <span className="teams-member-chip-avatar">
                        <AvatarImage
                          src={resolveAvatarSrc(getAgentAvatarConfig(a.metadata, a.id, a.name))}
                          seed={a.id}
                          name={a.name}
                          alt={a.name}
                        />
                      </span>
                      <span className="teams-member-chip-name">{a.name}</span>
                      {checked && <Icons.Check size={12} className="teams-member-chip-check" />}
                    </button>
                  )
                })}
            </div>
          </section>

          {/* 团队专属规则 */}
          <section className="teams-section">
            <div className="teams-section-head">
              <div className="teams-section-title">团队专属规则（Prompt）</div>
              <div className="teams-section-hint">
                作为 [Team Instructions] 段注入到主持人 system prompt
              </div>
            </div>
            <LobeTextArea
              value={draft.prompt}
              onChange={(e) => updateDraft('prompt', e.target.value)}
              placeholder={`例如：\n- 接到用户需求先整理「目标 / 关键约束 / 不做什么」，再决定派工；\n- 实现细节优先派给编码 Agent，验证派给测试 Agent；\n- 每位成员各自给出独立答复后，主持人在最后一句给出「下一步建议」。`}
              rows={8}
            />
          </section>

          {/* 嵌套调用 */}
          <section className="teams-section">
            <div className="teams-section-head">
              <div className="teams-section-title">嵌套调用</div>
              <div className="teams-section-hint">
                允许成员继续 dispatch 下一层 Agent；默认关闭，避免链路失控
              </div>
            </div>
            <div className="teams-nesting-row">
              <LobeCheckbox
                checked={draft.allowNesting}
                onChange={(checked) => updateDraft('allowNesting', checked)}
              >
                允许成员发起下一层 dispatch
              </LobeCheckbox>
              <div className="teams-field" style={{ width: 160 }}>
                <span className="teams-field-label">最大深度</span>
                <LobeSelect
                  value={String(draft.maxDepth)}
                  onChange={(value) => updateDraft('maxDepth', Number(value))}
                  disabled={!draft.allowNesting}
                  options={[
                    { label: '1', value: '1' },
                    { label: '2', value: '2' },
                    { label: '3', value: '3' },
                  ]}
                />
              </div>
            </div>
          </section>

          <section className="teams-section">
            <div className="teams-section-head">
              <div className="teams-section-title">讨论协作</div>
              <div className="teams-section-hint">
                控制团队讨论最多轮数，以及是否允许成员之间直接互发协作消息
              </div>
            </div>
            <div className="teams-nesting-row">
              <LobeCheckbox
                checked={draft.enablePeerMessaging}
                onChange={(checked) => updateDraft('enablePeerMessaging', checked)}
              >
                允许成员互相留言（实验性）
              </LobeCheckbox>
              <div className="teams-field" style={{ width: 180 }}>
                <span className="teams-field-label">讨论轮次上限</span>
                <LobeSelect
                  value={String(draft.maxDiscussionRounds)}
                  onChange={(value) => updateDraft('maxDiscussionRounds', Number(value))}
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
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
