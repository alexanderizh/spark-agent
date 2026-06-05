/**
 * TeamsPanel — AgentsView 的「团队」Tab，长期团队的 CRUD 面板。
 *
 * 左侧列表 + 右侧详情编辑，与 AgentsView 的 list/detail 视觉一致。
 * 内置团队（builtIn=true）不可删除但可编辑配置。
 *
 * 数据通道：team:list-defs / get-def / create-def / update-def / delete-def。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Icons } from '../Icons'
import { useIpcInvoke } from '../hooks/useIpc'
import { useToast } from '../components/Toast'
import { SparkInput, SparkTextarea, SparkSelect, SparkCheckbox } from '../components/FormControls'
import { AvatarImage } from '../components/AvatarImage'
import { getAgentAvatarConfig, resolveAvatarSrc } from '../avatar'
import type { ManagedAgent, ManagedTeam } from '@spark/protocol'

interface TeamDraft {
  id: string | null // null = 新建
  name: string
  description: string
  hostAgentId: string
  memberAgentIds: string[]
  maxDepth: number
  allowNesting: boolean
  prompt: string
  enabled: boolean
  builtIn: boolean
}

const EMPTY_DRAFT: TeamDraft = {
  id: null,
  name: '',
  description: '',
  hostAgentId: '',
  memberAgentIds: [],
  maxDepth: 1,
  allowNesting: false,
  prompt: '',
  enabled: true,
  builtIn: false,
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
    prompt: t.prompt,
    enabled: t.enabled,
    builtIn: t.builtIn,
  }
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
      const res = await listDefs({})
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

  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents])
  const enabledAgents = useMemo(() => agents.filter((a) => a.enabled), [agents])

  const openTeam = (team: ManagedTeam) => {
    setDraft(teamToDraft(team))
    setScreen('detail')
  }
  const openNew = () => {
    const firstAgentId = enabledAgents[0]?.id ?? 'code-agent'
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
      if (id === prev.hostAgentId) return prev // 不能把 host 勾成 member
      const idSet = new Set(prev.memberAgentIds)
      if (idSet.has(id)) idSet.delete(id)
      else idSet.add(id)
      return { ...prev, memberAgentIds: Array.from(idSet) }
    })
  }

  const switchHost = (newHostId: string) => {
    setDraft((prev) => ({
      ...prev,
      hostAgentId: newHostId,
      // 自动从成员里剔除新 host
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
      if (draft.id == null) {
        await createDef({
          name: draft.name.trim(),
          description: draft.description.trim(),
          hostAgentId: draft.hostAgentId,
          memberAgentIds: draft.memberAgentIds,
          maxDepth: draft.maxDepth,
          allowNesting: draft.allowNesting,
          prompt: draft.prompt,
          enabled: draft.enabled,
        })
        toast.success('团队已创建')
      } else {
        await updateDef({
          id: draft.id,
          name: draft.name.trim(),
          description: draft.description.trim(),
          hostAgentId: draft.hostAgentId,
          memberAgentIds: draft.memberAgentIds,
          maxDepth: draft.maxDepth,
          allowNesting: draft.allowNesting,
          prompt: draft.prompt,
          enabled: draft.enabled,
        })
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

  // ── 列表屏 ──
  if (screen === 'list') {
    return (
      <div className="agents-home">
        <div className="agents-home-head">
          <div>
            <div className="agents-title-lg">Teams</div>
            <div className="agents-desc">
              长期团队是可复用的多 Agent 协作配置：主持人 + 成员 + 嵌套参数 + 团队专属提示词。会话可一键应用某个团队。
            </div>
          </div>
          <div className="agents-actions">
            <button className="btn ghost sm" onClick={() => void refresh()} disabled={loading}>
              {loading ? <Icons.Spinner size={12} /> : <Icons.Activity size={12} />} 刷新
            </button>
            <button className="btn primary sm" onClick={openNew}>
              <Icons.Plus size={12} /> 新建团队
            </button>
          </div>
        </div>
        {teams.length > 0 ? (
          <div className="agents-card-grid">
            {teams.map((team) => {
              const host = agentById.get(team.hostAgentId)
              return (
                <button key={team.id} className="agents-card" onClick={() => openTeam(team)}>
                  <span className="agents-card-head">
                    <span className="agents-card-avatar">
                      {host ? (
                        <AvatarImage
                          src={resolveAvatarSrc(getAgentAvatarConfig(host.metadata, host.id, host.name))}
                          seed={host.id}
                          name={host.name}
                          alt={host.name}
                        />
                      ) : (
                        <Icons.Team size={20} />
                      )}
                    </span>
                    <span className={`agents-card-status ${team.enabled ? 'enabled' : 'disabled'}`}>
                      {team.enabled ? '启用' : '停用'}
                    </span>
                  </span>
                  <span className="agents-card-name">{team.name}</span>
                  <span className="agents-card-desc">
                    {team.description || (team.builtIn ? '内置团队' : '自定义团队')}
                  </span>
                  <span className="agents-card-meta">
                    <span>{team.builtIn ? '内置' : '自定义'}</span>
                    {host && (
                      <>
                        <span className="agents-card-dot" />
                        <span>主持：{host.name}</span>
                      </>
                    )}
                  </span>
                  <span className="agents-card-tags">
                    <span className="agents-card-tag">{team.memberAgentIds.length} 成员</span>
                    {team.prompt.trim().length > 0 && <span className="agents-card-tag">含团队规则</span>}
                    {team.allowNesting && (
                      <span className="agents-card-tag">嵌套 ≤{team.maxDepth}</span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        ) : (
          !loading && (
            <div className="agents-empty-state">
              <div className="agents-empty-icon">
                <Icons.Team size={24} />
              </div>
              <div className="agents-empty-title">创建第一个团队</div>
              <div className="agents-empty-desc">
                团队是一组 Agent 的协作约定，可在会话中一键应用。
              </div>
              <div style={{ marginTop: 8 }}>
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

  // ── 详情屏 ──
  const memberSet = new Set(draft.memberAgentIds)
  return (
    <div className="agents-detail">
      <div className="agents-detail-head">
        <button className="btn ghost sm" onClick={backToList}>
          <Icons.ArrowLeft size={12} /> 返回
        </button>
        <div className="agents-detail-title">{draft.id == null ? '新建团队' : '编辑团队'}</div>
        <div className="agents-detail-actions">
          {draft.id != null && !draft.builtIn && (
            <button className="btn danger sm" onClick={() => void handleDelete()}>
              <Icons.Trash size={12} /> 删除
            </button>
          )}
          <button className="btn primary sm" onClick={() => void handleSave()} disabled={saving}>
            {saving ? <Icons.Spinner size={12} /> : <Icons.Check size={12} />} 保存
          </button>
        </div>
      </div>

      <div className="agents-form-grid">
        <section className="agents-form-section">
          <div className="agents-form-row">
            <label>名称</label>
            <SparkInput
              value={draft.name}
              onChange={(e) => updateDraft('name', e.target.value)}
              placeholder="例：全栈协作组"
            />
          </div>
          <div className="agents-form-row">
            <label>描述</label>
            <SparkTextarea
              value={draft.description}
              onChange={(e) => updateDraft('description', e.target.value)}
              placeholder="一两句话说明该团队适合什么场景"
              rows={2}
            />
          </div>
          <div className="agents-form-row">
            <label>启用</label>
            <SparkCheckbox
              checked={draft.enabled}
              onChange={(e) => updateDraft('enabled', e.target.checked)}
              label="未启用的团队不出现在会话的「选择团队」入口"
            />
          </div>
        </section>

        <section className="agents-form-section">
          <div className="agents-form-section-title">主持人</div>
          <div className="agents-form-row">
            <SparkSelect
              value={draft.hostAgentId}
              onChange={(e) => switchHost(e.target.value)}
            >
              {enabledAgents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} {a.builtIn ? '(内置)' : ''}
                </option>
              ))}
            </SparkSelect>
          </div>
        </section>

        <section className="agents-form-section">
          <div className="agents-form-section-title">
            成员 <span className="agents-form-section-count">{draft.memberAgentIds.length}</span>
          </div>
          <div className="agents-pick-list">
            {enabledAgents
              .filter((a) => a.id !== draft.hostAgentId)
              .map((a) => {
                const checked = memberSet.has(a.id)
                return (
                  <button
                    key={a.id}
                    type="button"
                    className={`agent-pick-item${checked ? ' active' : ''}`}
                    onClick={() => toggleMember(a.id)}
                  >
                    <span>{a.name}</span>
                    {checked && <Icons.Check size={12} />}
                  </button>
                )
              })}
          </div>
        </section>

        <section className="agents-form-section">
          <div className="agents-form-section-title">团队专属规则（Prompt）</div>
          <div className="agents-form-row">
            <SparkTextarea
              value={draft.prompt}
              onChange={(e) => updateDraft('prompt', e.target.value)}
              placeholder="将作为 [Team Instructions] 段附加到 system prompt 之后，对主持人 Agent 生效。例如：「先以问题/价值/验收标准三段澄清需求，再分派任务……」"
              rows={6}
            />
          </div>
        </section>

        <section className="agents-form-section">
          <div className="agents-form-section-title">嵌套调用</div>
          <div className="agents-form-row">
            <SparkCheckbox
              checked={draft.allowNesting}
              onChange={(e) => updateDraft('allowNesting', e.target.checked)}
              label="允许成员发起下一层 dispatch"
            />
          </div>
          <div className="agents-form-row">
            <label>最大深度</label>
            <SparkSelect
              value={String(draft.maxDepth)}
              onChange={(e) => updateDraft('maxDepth', Number(e.target.value))}
              disabled={!draft.allowNesting}
            >
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
            </SparkSelect>
          </div>
        </section>
      </div>
    </div>
  )
}
