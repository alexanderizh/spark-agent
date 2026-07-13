/**
 * SkillStoreView — Skill 管理页面
 *
 * Tab 切换：已安装（Installed）+ 精选推荐（Installable）+ 在线市场（SkillHub）+ 创建（Create）
 * 已安装 Tab：Cursor-style 卡片列表 + 详情双页布局
 * 创建 Tab：手动创建 / 文件导入 / 目录导入 / 检测导入本地 Skill
 */
import { useState, useCallback, useMemo, useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { ReactNode } from 'react'
import { Pagination, Spin, Switch } from 'antd'
import type {
  InstallableSkillCatalogItem,
  LocalSkillCandidate,
  ManagedAgent,
  RemoteSkillItem,
  SkillDetailInfo,
  SkillHubShowcaseSection,
  SkillItem,
} from '@spark/protocol'
import { Icons } from '../Icons'
import {
  ActionIcon,
  Button,
  Drawer,
  Empty,
  Input,
  SearchBar,
  Select,
  Tag,
  TextArea,
} from '@lobehub/ui'
import { useApp } from '../AppContext'
import { AgentsPickerModal } from '../components/AgentsPickerModal'
import { SkillAssignHintModal } from '../components/SkillAssignHintModal'
import { getAgentAvatarConfig, resolveAvatarSrc } from '../avatar'
import { AGENTS_OPEN_DETAIL_EVENT, AGENTS_OPEN_DETAIL_STORAGE_KEY } from './AgentsView'
import { MarkdownText } from './ChatView'
import {
  useSkills,
  useInstallableCatalog,
  useSkillHubFeatured,
  useSkillHubSearch,
  useSkillHubCategories,
  parseSkillManifest,
  filterSkills,
  filterCandidates,
  deduplicateSkills,
  deduplicateCandidates,
  paginate,
  SKILLHUB_PAGE_SIZE,
} from '../utils/skills-data'
import { useIpcInvoke, useIpcStream } from '../hooks/useIpc'
import { useRefreshable } from '../hooks/useRefreshable'
import { useToast } from '../components/Toast'
import './SkillStoreView.less'

// ─── Main View ────────────────────────────────────────────────────────
type TabType = 'installed' | 'create' | 'installable' | 'skillhub'
type SkillInstallProgress = { downloaded: number; total: number }
export const SKILL_STORE_TARGET_TAB_EVENT = 'spark-agent:skill-store-target-tab'
export const SKILL_STORE_TARGET_TAB_STORAGE_KEY = 'spark-agent:skill-store-target-tab'

function skillInstallProgressKey(source: 'catalog' | 'skillhub', slug: string): string {
  return `${source}:${slug}`
}

function isSkillStoreTab(value: unknown): value is TabType {
  return (
    value === 'installed' ||
    value === 'create' ||
    value === 'installable' ||
    value === 'skillhub'
  )
}

function readInitialSkillStoreTab(): TabType {
  if (typeof window === 'undefined') return 'installed'
  const stored = window.localStorage.getItem(SKILL_STORE_TARGET_TAB_STORAGE_KEY)
  if (!isSkillStoreTab(stored)) return 'installed'
  window.localStorage.removeItem(SKILL_STORE_TARGET_TAB_STORAGE_KEY)
  return stored
}

export function SkillStoreView() {
  const [activeTab, setActiveTab] = useState<TabType>(readInitialSkillStoreTab)
  const [refreshKey, setRefreshKey] = useState(0)
  const [installProgress, setInstallProgress] = useState<Record<string, SkillInstallProgress>>({})
  const { invoke: listInstallStatus } = useIpcInvoke('skill:install-status')

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1)
  }, [])

  const triggerRefresh = useRefreshable(handleRefresh)

  const refreshInstallProgress = useCallback(async () => {
    try {
      const res = await listInstallStatus({})
      const installing = res.installations.filter((item) => item.state === 'installing')
      setInstallProgress(
        Object.fromEntries(
          installing.map((item) => [
            skillInstallProgressKey(item.source, item.slug),
            { downloaded: item.downloaded, total: item.total },
          ]),
        ),
      )
    } catch (err) {
      console.warn('[skill-store] install status load failed:', err)
    }
  }, [listInstallStatus])

  useIpcStream(
    'stream:skill:install-progress',
    (payload) => {
      setInstallProgress((prev) => ({
        ...prev,
        [skillInstallProgressKey(payload.source, payload.slug)]: {
          downloaded: payload.downloaded,
          total: payload.total,
        },
      }))
    },
    [],
  )

  useEffect(() => {
    let cancelled = false
    refreshInstallProgress().catch((err) => {
      if (!cancelled) console.warn('[skill-store] install status load failed:', err)
    })
    return () => {
      cancelled = true
    }
  }, [refreshInstallProgress])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const handleTargetTab = (event: Event) => {
      const tab = (event as CustomEvent<{ tab?: unknown }>).detail?.tab
      if (!isSkillStoreTab(tab)) return
      window.localStorage.removeItem(SKILL_STORE_TARGET_TAB_STORAGE_KEY)
      setActiveTab(tab)
    }
    window.addEventListener(SKILL_STORE_TARGET_TAB_EVENT, handleTargetTab)
    return () => {
      window.removeEventListener(SKILL_STORE_TARGET_TAB_EVENT, handleTargetTab)
    }
  }, [])

  // ─── skill → agents 分发（顶层统一管理 picker / hint，供各 Tab 触发）───
  const { toast } = useToast()
  const { setTweak } = useApp()
  const { invoke: listAgents } = useIpcInvoke('agent:list')
  const { invoke: updateAgent } = useIpcInvoke('agent:update')
  const [agents, setAgents] = useState<ManagedAgent[]>([])
  const [assignSkill, setAssignSkill] = useState<{ id: string; name: string } | null>(null)
  const [hintSkill, setHintSkill] = useState<{
    id: string
    name: string
    extraCount?: number
  } | null>(null)
  const [pickerSelected, setPickerSelected] = useState<string[]>([])
  // 打开 picker 时的 agents 快照,串行 await 期间不再受 agents 闭包刷新影响
  const [assignSnapshot, setAssignSnapshot] = useState<{
    agentById: Map<string, ManagedAgent>
    prevAssignedIds: Set<string>
  } | null>(null)

  const refreshAgents = useCallback(async () => {
    try {
      const res = await listAgents({ includeDisabled: true })
      setAgents(res.agents)
    } catch {
      // silent — picker / chips 会用上次的数据
    }
  }, [listAgents])

  useEffect(() => {
    const id = window.setTimeout(() => {
      void refreshAgents()
    }, 0)
    return () => window.clearTimeout(id)
  }, [refreshAgents])

  // 其他视图改了 agent 配置时，同步本地 agents（chips 即时更新）
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    return (
      window.spark?.on?.('stream:config:changed', (event) => {
        if (event.scope === 'agent') void refreshAgents()
        if (event.scope === 'skill') {
          handleRefresh()
          void refreshInstallProgress()
        }
      }) ?? (() => {})
    )
  }, [handleRefresh, refreshAgents, refreshInstallProgress])

  // 打开分发 picker：预勾选当前已分发该 skill 的 agent，并冻结 agent 快照
  const openAssignPicker = useCallback(
    (skill: { id: string; name: string }) => {
      const assigned = agents.filter((a) => a.skillIds.includes(skill.id)).map((a) => a.id)
      setPickerSelected(assigned)
      setAssignSnapshot({
        agentById: new Map(agents.map((a) => [a.id, a] as const)),
        prevAssignedIds: new Set(assigned),
      })
      setAssignSkill(skill)
    },
    [agents],
  )

  // 新技能就绪提醒（精选安装 / 创建 / 导入 / 软链接 成功后触发）
  // extraCount>0 表示多 skill 模式,hint modal 会切到 installed tab 而非打开 picker
  const notifySkillReady = useCallback(
    (skill: { id: string; name: string; extraCount?: number }) => {
      setHintSkill(skill)
    },
    [],
  )

  // hint modal 的「分配 / 去已安装」统一入口:多 skill 切到 installed tab,单 skill 开 picker
  const handleHintAssign = useCallback(() => {
    const skill = hintSkill
    setHintSkill(null)
    if (skill == null) return
    if ((skill.extraCount ?? 0) > 0) {
      setActiveTab('installed')
      toast.info(`已就绪 ${(skill.extraCount ?? 0) + 1} 个 Skill,请在「已安装」中逐个分配给 Agent`)
      return
    }
    openAssignPicker({ id: skill.id, name: skill.name })
  }, [hintSkill, openAssignPicker, toast])

  // 确认分发：与原集合 diff，串行写回（agent:update 是整体替换 skillIds）
  // 使用 picker 打开时的 snapshot，避免串行 await 期间 agents 闭包被其他 effect 覆盖
  const handleAssignConfirm = useCallback(async () => {
    if (assignSkill == null) return
    const skillId = assignSkill.id
    const skillName = assignSkill.name
    const snapshot = assignSnapshot
    setAssignSkill(null)
    setAssignSnapshot(null)
    if (snapshot == null) return

    const prevSet = snapshot.prevAssignedIds
    const nextSet = new Set(pickerSelected)
    const toAdd = [...nextSet].filter((id) => !prevSet.has(id))
    const toRemove = [...prevSet].filter((id) => !nextSet.has(id))
    if (toAdd.length === 0 && toRemove.length === 0) return

    let ok = 0
    let fail = 0
    for (const id of toAdd) {
      const agent = snapshot.agentById.get(id)
      if (agent == null) {
        fail++
        continue
      }
      try {
        await updateAgent({ id, skillIds: Array.from(new Set([...agent.skillIds, skillId])) })
        ok++
      } catch (err) {
        console.error('[SkillAssign] failed to add skill to agent', { agentId: id, skillId, err })
        fail++
      }
    }
    for (const id of toRemove) {
      const agent = snapshot.agentById.get(id)
      if (agent == null) {
        fail++
        continue
      }
      try {
        await updateAgent({ id, skillIds: agent.skillIds.filter((s) => s !== skillId) })
        ok++
      } catch (err) {
        console.error('[SkillAssign] failed to remove skill from agent', {
          agentId: id,
          skillId,
          err,
        })
        fail++
      }
    }
    if (fail > 0) {
      toast.warning(`已更新 ${ok} 个 Agent,${fail} 个失败`)
    } else {
      toast.success(`已将「${skillName}」更新到 ${ok} 个 Agent`)
    }
    await refreshAgents()
  }, [assignSkill, assignSnapshot, pickerSelected, updateAgent, refreshAgents, toast])

  // chip 点击 → 跳转到 Agents 视图并打开对应 Agent 详情
  // 注意:setTweak('view', ...) 内部会调用 navGuardRef.current?.()
  // (见 AppContext.tsx),由目标视图(AgentsView)注册 unsaved-draft 检查,
  // 因此这里不需要也无法在调用前自行 inspect 其他视图状态。
  const handleJumpToAgent = useCallback(
    (agentId: string) => {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(AGENTS_OPEN_DETAIL_STORAGE_KEY, agentId)
        window.dispatchEvent(new CustomEvent(AGENTS_OPEN_DETAIL_EVENT, { detail: { agentId } }))
      }
      setTweak('view', 'agents')
    },
    [setTweak],
  )

  // Picker 入参:把 agents 投影成 picker schema,父组件每次 render 不再新建数组,
  // 让 AgentsPickerModal 内部的 useMemo(counts / filteredAgents)能正确命中缓存
  const pickerAgents = useMemo(
    () =>
      agents.map((a) => ({
        id: a.id,
        name: a.name,
        avatarSrc: resolveAvatarSrc(getAgentAvatarConfig(a.metadata, a.id, a.name)),
        builtIn: a.builtIn,
        enabled: a.enabled,
      })),
    [agents],
  )

  return (
    <div className="view-body" style={{ position: 'relative' }}>
      <div className="skills-view">
        <div className="skill-store-tabs">
          {(['skillhub', 'installable', 'installed', 'create'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className={`skill-store-tab ${activeTab === tab ? 'is-active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab === 'installed'
                ? '已安装'
                : tab === 'installable'
                  ? '精选推荐'
                  : tab === 'skillhub'
                    ? '在线市场'
                    : '创建'}
            </button>
          ))}
        </div>
        {activeTab === 'installed' ? (
          <InstalledTab
            key={`installed-${refreshKey}`}
            onCreate={() => setActiveTab('create')}
            onRefresh={triggerRefresh}
            agents={agents}
            onAssignToAgents={openAssignPicker}
            onJumpToAgent={handleJumpToAgent}
          />
        ) : activeTab === 'installable' ? (
          <InstallableTab
            key={`installable-${refreshKey}`}
            onInstalled={handleRefresh}
            onSkillReady={notifySkillReady}
            progress={installProgress}
            setProgress={setInstallProgress}
          />
        ) : activeTab === 'skillhub' ? (
          <SkillHubMarketTab
            key="skillhub"
            onInstalled={handleRefresh}
            onSkillReady={notifySkillReady}
            progress={installProgress}
            setProgress={setInstallProgress}
          />
        ) : (
          <CreateTab
            key={`create-${refreshKey}`}
            onCreated={handleRefresh}
            onBack={() => setActiveTab('installed')}
            onSkillReady={notifySkillReady}
          />
        )}
      </div>

      <AgentsPickerModal
        visible={assignSkill != null}
        skillName={assignSkill?.name ?? ''}
        agents={pickerAgents}
        selectedIds={pickerSelected}
        onChange={setPickerSelected}
        onConfirm={() => void handleAssignConfirm()}
        onClose={() => setAssignSkill(null)}
      />
      <SkillAssignHintModal
        open={hintSkill != null}
        skillName={hintSkill?.name ?? ''}
        extraCount={hintSkill?.extraCount}
        onAssign={() => handleHintAssign()}
        onClose={() => setHintSkill(null)}
      />
    </div>
  )
}

// ─── Installed Tab ────────────────────────────────────────────────────

function InstalledTab({
  onCreate,
  onRefresh,
  agents,
  onAssignToAgents,
  onJumpToAgent,
}: {
  onCreate: () => void
  onRefresh: () => void
  agents: ManagedAgent[]
  onAssignToAgents: (skill: { id: string; name: string }) => void
  onJumpToAgent: (agentId: string) => void
}) {
  const { skills, loading, error, toggleSkill, deleteSkill, total, enabledCount } = useSkills()
  const { requestConfirm } = useApp()
  const { invoke: getSkillDetail } = useIpcInvoke('skill:detail')
  const [search, setSearch] = useState('')
  const [managementMode, setManagementMode] = useState(false)
  const [selectedDeleteIds, setSelectedDeleteIds] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [preferredSkillId, setPreferredSkillId] = useState<string | null>(null)
  const [detailState, setDetailState] = useState<{
    skillId: string | null
    detail: SkillDetailInfo | null
    error: string
  }>({
    skillId: null,
    detail: null,
    error: '',
  })
  const [mobileDetailVisible, setMobileDetailVisible] = useState(false)
  const [isCompact, setIsCompact] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(max-width: 960px)').matches
  })
  const { toast } = useToast()

  const dedupedSkills = useMemo(() => deduplicateSkills(skills), [skills])
  const filteredSkills = useMemo(() => {
    const list = filterSkills(dedupedSkills, search)
    return [
      ...list.filter((s) => s.id.startsWith('builtin:')),
      ...list.filter((s) => !s.id.startsWith('builtin:')),
    ]
  }, [dedupedSkills, search])

  const sections = useMemo(() => {
    const builtin = filteredSkills.filter((skill) => skill.id.startsWith('builtin:'))
    const local = filteredSkills.filter((skill) => !skill.id.startsWith('builtin:'))
    return [
      // { id: 'builtin', title: 'Built-in Skills', skills: builtin },
      { id: 'local', title: 'Installed Skills', skills: local },
    ].filter((section) => section.skills.length > 0)
  }, [filteredSkills])

  const activeSkillId = useMemo(() => {
    if (filteredSkills.length === 0) return null
    if (preferredSkillId != null && filteredSkills.some((skill) => skill.id === preferredSkillId)) {
      return preferredSkillId
    }
    return filteredSkills[0]?.id ?? null
  }, [filteredSkills, preferredSkillId])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const mediaQuery = window.matchMedia('(max-width: 960px)')
    const sync = (matches: boolean) => setIsCompact(matches)
    sync(mediaQuery.matches)
    const handler = (event: MediaQueryListEvent) => sync(event.matches)
    mediaQuery.addEventListener('change', handler)
    return () => mediaQuery.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    if (activeSkillId == null) return
    let cancelled = false

    getSkillDetail({ id: activeSkillId })
      .then((res) => {
        if (cancelled) return
        setDetailState({
          skillId: activeSkillId,
          detail: res.detail,
          error: res.detail == null ? '未找到该 Skill 的详情。' : '',
        })
      })
      .catch((err) => {
        if (cancelled) return
        setDetailState({
          skillId: activeSkillId,
          detail: null,
          error: err instanceof Error ? err.message : '加载 Skill 详情失败',
        })
      })

    return () => {
      cancelled = true
    }
  }, [activeSkillId, getSkillDetail])

  const enterManagement = useCallback(() => {
    setManagementMode(true)
    setSelectedDeleteIds(new Set())
  }, [])

  const exitManagement = useCallback(() => {
    setManagementMode(false)
    setSelectedDeleteIds(new Set())
  }, [])

  const toggleDeleteSelect = useCallback((id: string) => {
    setSelectedDeleteIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleDeleteSelectAll = useCallback(() => {
    if (selectedDeleteIds.size === filteredSkills.length) {
      setSelectedDeleteIds(new Set())
    } else {
      setSelectedDeleteIds(new Set(filteredSkills.map((s) => s.id)))
    }
  }, [selectedDeleteIds.size, filteredSkills])

  const handleDeleteSkill = useCallback(
    async (id: string) => {
      const confirmed = await requestConfirm({
        title: '删除 Skill？',
        description: '删除后该 Skill 将从本地移除，相关能力将不再可用。',
        confirmText: '删除',
        danger: true,
      })
      if (!confirmed) return
      await deleteSkill(id)
      toast.success('已删除 Skill')
    },
    [requestConfirm, deleteSkill, toast],
  )

  const handleBatchDelete = useCallback(async () => {
    if (selectedDeleteIds.size === 0) return
    const confirmed = await requestConfirm({
      title: `批量删除 ${selectedDeleteIds.size} 个 Skill？`,
      description: '删除后所选 Skill 将从本地移除，相关能力将不再可用。',
      confirmText: '全部删除',
      danger: true,
    })
    if (!confirmed) return
    setDeleting(true)
    try {
      let successCount = 0
      let failCount = 0
      for (const id of selectedDeleteIds) {
        try {
          await deleteSkill(id)
          successCount++
        } catch {
          failCount++
        }
      }
      if (failCount > 0) {
        toast.warning(`已删除 ${successCount} 个，${failCount} 个失败`)
      } else {
        toast.success(`已批量删除 ${successCount} 个 Skill`)
      }
      exitManagement()
    } finally {
      setDeleting(false)
    }
  }, [selectedDeleteIds, requestConfirm, deleteSkill, exitManagement, toast])

  const openSkillDetail = useCallback(
    (skill: SkillItem) => {
      setPreferredSkillId(skill.id)
      if (isCompact) setMobileDetailVisible(true)
    },
    [isCompact],
  )

  const selectedSkill = filteredSkills.find((skill) => skill.id === activeSkillId) ?? null
  const detailLoading = activeSkillId != null && detailState.skillId !== activeSkillId
  const selectedDetail = detailState.skillId === activeSkillId ? detailState.detail : null
  const detailError = detailState.skillId === activeSkillId ? detailState.error : ''

  // 当前选中 skill 已分发到的 agent ids
  const assignedAgentIds = useMemo(() => {
    if (selectedSkill == null) return []
    return agents.filter((a) => a.skillIds.includes(selectedSkill.id)).map((a) => a.id)
  }, [agents, selectedSkill])

  return (
    <>
      <div className="skill-store-page skill-store-page--dual">
        <div className="skill-store-header">
          <div>
            <div className="strong text-base font-semibold">Skills</div>
            <div className="muted text-xs mt-0.5">
              {total} 个已安装 · {enabledCount} 个已启用
            </div>
          </div>
          <div className="skill-store-actions">
            <Input
              size="middle"
              placeholder="搜索已安装的 Skill..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              prefix={<Icons.Search size={14} />}
              allowClear
            />
            {/* 创建入口：搜索框右侧的主题色按钮 */}
            <Button size="middle" type="primary" onClick={onCreate} icon={<Icons.Plus size={14} />}>
              创建
            </Button>
            {!managementMode ? (
              <Button
                size="middle"
                type="text"
                onClick={enterManagement}
                disabled={total === 0}
                icon={<Icons.Settings size={14} />}
              >
                管理
              </Button>
            ) : (
              <Button
                size="middle"
                type="text"
                onClick={exitManagement}
                disabled={deleting}
                icon={<Icons.X size={14} />}
              >
                退出管理
              </Button>
            )}
            <ActionIcon
              icon={Icons.Refresh}
              size="middle"
              variant="borderless"
              onClick={onRefresh}
              title="刷新 (Ctrl+R)"
            />
          </div>
        </div>

        {managementMode && (
          <div className="skill-store-mgmt-bar">
            <Icons.CheckSquare size={13} />
            <span>
              已选择 <span className="mgmt-count">{selectedDeleteIds.size}</span> 个
            </span>
            <Button size="middle" type="text" onClick={toggleDeleteSelectAll} disabled={deleting}>
              {selectedDeleteIds.size === filteredSkills.length ? '取消全选' : '全选'}
            </Button>
            <Button
              size="middle"
              type="primary"
              danger
              onClick={() => void handleBatchDelete()}
              disabled={selectedDeleteIds.size === 0 || deleting}
            >
              {deleting ? '删除中...' : `删除所选 (${selectedDeleteIds.size})`}
            </Button>
          </div>
        )}

        {error && <div className="card card-error">{error}</div>}

        {loading ? (
          <div className="skill-store-loading">
            <Spin />
            <span>正在加载 Skills...</span>
          </div>
        ) : total === 0 ? (
          <div className="skill-store-empty">
            <Empty description='暂无已安装的 Skill，前往"创建"页手动创建或导入。' />
          </div>
        ) : filteredSkills.length === 0 ? (
          <div className="skill-store-empty">
            <Empty description="没有找到匹配的 Skill，换个关键词试试。" />
          </div>
        ) : (
          <div className="skill-store-shell">
            <div className="skill-store-list">
              {sections.map((section) => (
                <section key={section.id} className="skill-store-section">
                  <div className="skill-store-section-title">
                    <span>{section.title}</span>
                    <span>{section.skills.length}</span>
                  </div>
                  <div className="skill-store-cards">
                    {section.skills.map((skill) => (
                      <InstalledSkillCard
                        key={skill.id}
                        skill={skill}
                        onToggle={toggleSkill}
                        onDelete={handleDeleteSkill}
                        managementMode={managementMode}
                        selected={selectedDeleteIds.has(skill.id)}
                        active={skill.id === activeSkillId}
                        onToggleSelect={toggleDeleteSelect}
                        onOpen={() => openSkillDetail(skill)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>

            {!isCompact && (
              <aside className="skill-store-detail-panel">
                <SkillDetailPanel
                  skill={selectedSkill}
                  detail={selectedDetail}
                  loading={detailLoading}
                  error={detailError}
                  assignedAgentIds={assignedAgentIds}
                  agents={agents}
                  onAssignToAgents={() => {
                    if (selectedSkill)
                      onAssignToAgents({ id: selectedSkill.id, name: selectedSkill.name })
                  }}
                  onJumpToAgent={onJumpToAgent}
                />
              </aside>
            )}
          </div>
        )}

        <div className="skill-store-stats">
          {total} 个已安装 · {enabledCount} 个已启用
        </div>
      </div>
      <Drawer
        width="min(440px, 94vw)"
        open={mobileDetailVisible}
        title={selectedSkill?.name ?? 'Skill 详情'}
        footer={null}
        onClose={() => setMobileDetailVisible(false)}
      >
        <SkillDetailPanel
          skill={selectedSkill}
          detail={selectedDetail}
          loading={detailLoading}
          error={detailError}
          assignedAgentIds={assignedAgentIds}
          agents={agents}
          onAssignToAgents={() => {
            if (selectedSkill) onAssignToAgents({ id: selectedSkill.id, name: selectedSkill.name })
          }}
          onJumpToAgent={onJumpToAgent}
        />
      </Drawer>
    </>
  )
}

function InstalledSkillCard({
  skill,
  onToggle,
  onDelete,
  managementMode,
  selected,
  active,
  onToggleSelect,
  onOpen,
}: {
  skill: SkillItem
  onToggle: (skill: SkillItem) => Promise<void>
  onDelete: (id: string) => Promise<void>
  managementMode: boolean
  selected: boolean
  active: boolean
  onToggleSelect: (id: string) => void
  onOpen: () => void
}) {
  const meta = parseManifestExtras(skill.manifestJson)
  return (
    <div
      role="button"
      tabIndex={0}
      className={`skill-store-card ${active ? 'is-selected' : ''}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
    >
      <div className="skill-store-card-top">
        <div className="skill-store-card-icon">{skill.name.charAt(0).toUpperCase()}</div>
        <div className="skill-store-card-info">
          <div className="skill-store-card-title">{skill.name}</div>
          <div className="skill-store-card-subtitle">
            {/* {meta.source} */}
            <span className="skill-store-card-dot" />
            {skill.version}
          </div>
        </div>
        {managementMode && (
          <label className="local-skill-check" onClick={(e) => e.stopPropagation()}>
            <input type="checkbox" checked={selected} onChange={() => onToggleSelect(skill.id)} />
            <span className="checkmark" />
          </label>
        )}
      </div>

      <div className="skill-store-card-desc">{meta.description}</div>

      <div className="skill-store-card-foot">
        <div className="skill-store-card-tags">
          <Tag color={skill.enabled ? 'blue' : 'default'}>{skill.enabled ? '可见' : '隐藏'}</Tag>
          <Tag>{skill.id.startsWith('builtin:') ? '内置' : '本地'}</Tag>
        </div>
        {!managementMode && (
          <div className="skill-store-card-actions" onClick={(event) => event.stopPropagation()}>
            <Switch size="small" checked={skill.enabled} onChange={() => void onToggle(skill)} />
            {!skill.id.startsWith('builtin:') && (
              <Button size="small" type="text" danger onClick={() => void onDelete(skill.id)}>
                删除
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function SkillDetailPanel({
  skill,
  detail,
  loading,
  error,
  agents,
  assignedAgentIds,
  onAssignToAgents,
  onJumpToAgent,
}: {
  skill: SkillItem | null
  detail: SkillDetailInfo | null
  loading: boolean
  error: string
  agents: ManagedAgent[]
  assignedAgentIds: string[]
  onAssignToAgents: () => void
  onJumpToAgent?: (agentId: string) => void
}) {
  // Map 查表:assignedAgentIds.map(id => agents.find(...)) 是 O(N×M),
  // agents 多时肉眼可见卡顿。提前 memo,assignedAgentIds/agents 变化才重算。
  const agentMap = useMemo(() => new Map(agents.map((a) => [a.id, a] as const)), [agents])
  const assignedAgents = useMemo(
    () =>
      assignedAgentIds.map((id) => agentMap.get(id)).filter((a): a is ManagedAgent => a != null),
    [assignedAgentIds, agentMap],
  )

  if (skill == null) {
    return (
      <div className="skill-store-detail-empty">
        <Empty description="选择左侧一个 Skill 查看详情。" />
      </div>
    )
  }

  if (loading) {
    return (
      <div className="skill-store-detail-loading">
        <Spin />
        <span>正在加载详情...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="skill-store-detail-empty">
        <Empty description={error} />
      </div>
    )
  }

  const manifestMeta = parseManifestExtras(skill.manifestJson)
  const definition = detail?.definition
  const tags = definition?.tags?.length ? definition.tags : manifestMeta.tags
  const requiredTools = definition?.requiredTools ?? []
  const parameters = definition?.parameters ?? []
  const sourcePath = getSkillSourcePath(skill.rootPath)

  return (
    <div className="skill-store-detail">
      <div className="skill-store-detail-hero">
        <div className="skill-store-detail-icon">{skill.name.charAt(0).toUpperCase()}</div>
        <div className="skill-store-detail-hero-copy">
          <h3>{skill.name}</h3>
          <p>{definition?.description || manifestMeta.description}</p>
        </div>
        <div className="skill-store-detail-hero-actions">
          <Button
            size="middle"
            type="text"
            icon={<Icons.Bot size={14} />}
            onClick={onAssignToAgents}
          >
            安装给 Agent
          </Button>
        </div>
      </div>

      <div className="skill-store-detail-assigned">
        {assignedAgents.length > 0 ? (
          <>
            <div className="skill-store-detail-assigned-label">
              已分发 {assignedAgents.length} 个 Agent
            </div>
            <div className="skill-store-detail-assigned-chips">
              {assignedAgents.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="skill-store-detail-assigned-chip"
                  onClick={() => onJumpToAgent?.(a.id)}
                  title={onJumpToAgent ? `查看 Agent「${a.name}」` : a.name}
                >
                  <span className="skill-store-detail-assigned-avatar">
                    {a.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="skill-store-detail-assigned-name">{a.name}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="skill-store-detail-assigned-empty">
            尚未分发给任何 Agent · 点击「安装给 Agent」配置
          </div>
        )}
      </div>

      <div className="skill-store-detail-meta">
        <DetailStat label="来源" value={manifestMeta.source} />
        <DetailStat label="版本" value={skill.version} />
        <DetailStat
          label="分类"
          value={definition?.category || manifestMeta.category || '未分类'}
        />
        <DetailStat label="作者" value={definition?.author || manifestMeta.author || '未知'} />
      </div>

      <DetailSection title="Skill ID">
        <code className="skill-store-inline-code">{skill.id}</code>
      </DetailSection>

      <DetailSection title="Source Path">
        <code className="skill-store-inline-code">{sourcePath}</code>
      </DetailSection>

      {tags.length > 0 && (
        <DetailSection title="Tags">
          <div className="skill-store-tag-list">
            {tags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </div>
        </DetailSection>
      )}

      {requiredTools.length > 0 && (
        <DetailSection title="Required Tools">
          <div className="skill-store-tag-list">
            {requiredTools.map((tool) => (
              <Tag key={tool} color="default">
                {tool}
              </Tag>
            ))}
          </div>
        </DetailSection>
      )}

      {parameters.length > 0 && (
        <DetailSection title="Parameters">
          <div className="skill-store-parameter-list">
            {parameters.map((parameter) => (
              <div key={parameter.name} className="skill-store-parameter-item">
                <div className="skill-store-parameter-name">
                  {parameter.label} <span>{parameter.type}</span>
                </div>
                <div className="skill-store-parameter-desc">
                  {parameter.description || '未提供参数说明'}
                </div>
              </div>
            ))}
          </div>
        </DetailSection>
      )}

      {definition?.systemPrompt && (
        <DetailSection title="Prompt Preview">
          <div className="skill-store-prompt-preview">
            <MarkdownText content={definition.systemPrompt} />
          </div>
        </DetailSection>
      )}
    </div>
  )
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="skill-store-detail-section">
      <div className="skill-store-detail-section-title">{title}</div>
      {children}
    </section>
  )
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="skill-store-detail-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function parseManifestExtras(manifestJson: string): {
  description: string
  source: string
  author: string
  category: string
  tags: string[]
} {
  const fallback = parseSkillManifest(manifestJson)
  try {
    const parsed = JSON.parse(manifestJson) as {
      desc?: string
      description?: string
      source?: string
      author?: string
      category?: string
      tags?: string[]
    }
    return {
      description: parsed.desc ?? parsed.description ?? fallback.desc,
      source: parsed.source ?? fallback.source,
      author: parsed.author ?? '',
      category: parsed.category ?? '',
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.filter((tag): tag is string => typeof tag === 'string')
        : [],
    }
  } catch {
    return {
      description: fallback.desc,
      source: fallback.source,
      author: '',
      category: '',
      tags: [],
    }
  }
}

function getSkillSourcePath(rootPath: string): string {
  if (rootPath.startsWith('builtin://')) return rootPath
  if (rootPath.endsWith('.md')) return rootPath
  return `${rootPath}/SKILL.md`
}

// ─── Create Tab (New Skill Creation / Import) ──────────────────────────

// 'import' 合并了原「文件导入」与「目录导入」
type ImportMode = 'none' | 'detect' | 'import' | 'link'

// ─── Installable Tab（内置可安装技能卡片） ──────────────────────────────

function InstallableTab({
  onInstalled,
  onSkillReady,
  progress,
  setProgress,
}: {
  onInstalled: () => void
  onSkillReady: (skill: { id: string; name: string }) => void
  progress: Record<string, SkillInstallProgress>
  setProgress: Dispatch<SetStateAction<Record<string, SkillInstallProgress>>>
}) {
  const { items, loading, error, refresh } = useInstallableCatalog()
  const { invoke: installCatalog } = useIpcInvoke('skill:install-catalog')
  const { invoke: uninstallCatalog } = useIpcInvoke('skill:uninstall-catalog')
  const { requestConfirm } = useApp()
  const { toast } = useToast()

  const handleInstall = useCallback(
    async (item: InstallableSkillCatalogItem) => {
      const progressKey = skillInstallProgressKey('catalog', item.slug)
      setProgress((prev) => ({ ...prev, [progressKey]: { downloaded: 0, total: 0 } }))
      const sourceName = item.source.type === 'artifact' ? 'Spark 自建源' : '外部源'
      try {
        const res = await installCatalog({ slug: item.slug })
        toast.success(`已通过 ${sourceName} 安装「${res.skill.name}」`)
        if (res.postInstallHint) {
          // 依赖提示单独再弹一条，避免被 success 吞掉
          toast.info(res.postInstallHint)
        }
        refresh()
        onInstalled()
        onSkillReady({ id: res.skill.id, name: res.skill.name })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : `安装「${item.name}」失败`)
      } finally {
        setProgress((prev) => {
          const next = { ...prev }
          delete next[progressKey]
          return next
        })
      }
    },
    [installCatalog, refresh, onInstalled, onSkillReady, setProgress, toast],
  )

  const handleUninstall = useCallback(
    async (item: InstallableSkillCatalogItem) => {
      const ok = await requestConfirm({
        title: `卸载「${item.name}」`,
        description: '卸载后会删除磁盘上的技能目录，可随时重新安装。',
        confirmText: '卸载',
        danger: true,
      })
      if (!ok) return
      try {
        await uninstallCatalog({ slug: item.slug })
        toast.success(`已卸载「${item.name}」`)
        refresh()
        onInstalled()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : `卸载「${item.name}」失败`)
      }
    },
    [uninstallCatalog, refresh, onInstalled, requestConfirm, toast],
  )

  return (
    <>
      <div className="skill-store-page skill-store-page--installable">
        <div className="skill-store-header"></div>

        {error && <div className="card card-error">{error}</div>}

        {/* 原装精选（开箱可见，GitHub tarball + 国内镜像回退） */}
        <section className="skill-store-section skill-store-section--installable">
          <div className="skill-store-section-title">
            <span>原装精选</span>
            <span>{items.length}</span>
          </div>
          {loading ? (
            <div className="skill-store-loading">
              <Spin />
              <span>正在加载精选技能...</span>
            </div>
          ) : items.length === 0 ? (
            <div className="skill-store-empty">
              <Empty description="暂无可安装的原装精选技能。" />
            </div>
          ) : (
            <div className="skill-store-cards">
              {items.map((item) => {
                const cardProps: {
                  key: string
                  item: InstallableSkillCatalogItem
                  onInstall: () => void
                  onUninstall: () => void
                  progress?: { downloaded: number; total: number }
                } = {
                  key: item.id,
                  item,
                  onInstall: () => void handleInstall(item),
                  onUninstall: () => void handleUninstall(item),
                }
                const p = progress[skillInstallProgressKey('catalog', item.slug)]
                if (p) cardProps.progress = p
                return <InstallableSkillCard {...cardProps} />
              })}
            </div>
          )}
        </section>
      </div>
    </>
  )
}

function SkillHubMarketTab({
  onInstalled,
  onSkillReady,
  progress,
  setProgress,
}: {
  onInstalled: () => void
  onSkillReady: (skill: { id: string; name: string }) => void
  progress: Record<string, SkillInstallProgress>
  setProgress: Dispatch<SetStateAction<Record<string, SkillInstallProgress>>>
}) {
  const [hubSection, setHubSection] = useState<SkillHubShowcaseSection>('recommended')
  const hubCategories = useSkillHubCategories()
  const [selectedCategoryKey, setSelectedCategoryKey] = useState('all')
  const featured = useSkillHubFeatured({ section: hubSection, category: selectedCategoryKey })
  const refreshFeatured = featured.refresh
  const [hubQuery, setHubQuery] = useState('')
  const [hubPage, setHubPage] = useState(1)
  const hubSearch = useSkillHubSearch(hubQuery, SKILLHUB_PAGE_SIZE, {
    category: selectedCategoryKey,
    offset: (hubPage - 1) * SKILLHUB_PAGE_SIZE,
  })
  const refreshHubSearch = hubSearch.refresh
  const hubSearching = hubSearch.searching
  const { invoke: installRemote } = useIpcInvoke('skill:install-remote')
  const { invoke: uninstallRemote } = useIpcInvoke('skill-registry:uninstall')
  const { requestConfirm } = useApp()
  const { toast } = useToast()

  const refreshMarketplace = useCallback(() => {
    refreshFeatured()
    refreshHubSearch()
  }, [refreshFeatured, refreshHubSearch])

  // 外部 skill 变更（如其他 Tab 安装/卸载）时，刷新当前市场数据的 installed 标记，
  // 不重置搜索/分类/分页等 UI state —— 本 Tab 已脱离父级 refreshKey 重挂载机制。
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    return (
      window.spark?.on?.('stream:config:changed', (event) => {
        if (event.scope === 'skill') refreshMarketplace()
      }) ?? (() => {})
    )
  }, [refreshMarketplace])

  const filteredFeatured = featured.skills
  const hubTotal = hubSearching ? hubSearch.total : filteredFeatured.length
  const hubDisplay = hubSearching
    ? hubSearch.skills
    : paginate(filteredFeatured, hubPage, SKILLHUB_PAGE_SIZE)

  useEffect(() => {
    const lastPage = Math.max(1, Math.ceil(hubTotal / SKILLHUB_PAGE_SIZE))
    if (hubPage <= lastPage) return undefined
    const timer = window.setTimeout(() => setHubPage(lastPage), 0)
    return () => window.clearTimeout(timer)
  }, [hubPage, hubTotal])

  const handleInstallRemote = useCallback(
    async (skill: RemoteSkillItem) => {
      const slug = skill.id.slice(skill.registryId.length + 1)
      if (!slug) return
      const progressKey = skillInstallProgressKey('skillhub', slug)
      setProgress((prev) => ({ ...prev, [progressKey]: { downloaded: 0, total: 0 } }))
      try {
        const res = await installRemote({ registryId: skill.registryId, slug })
        toast.success(`已安装「${skill.name}」`)
        refreshMarketplace()
        onInstalled()
        onSkillReady({ id: res.skill.id, name: res.skill.name })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : `安装「${skill.name}」失败`)
      } finally {
        setProgress((prev) => {
          const next = { ...prev }
          delete next[progressKey]
          return next
        })
      }
    },
    [installRemote, refreshMarketplace, onInstalled, onSkillReady, setProgress, toast],
  )

  const handleUninstallRemote = useCallback(
    async (skill: RemoteSkillItem) => {
      if (!skill.localId) return
      const ok = await requestConfirm({
        title: `卸载「${skill.name}」`,
        description: '卸载后会删除磁盘上的技能目录，可随时重新安装。',
        confirmText: '卸载',
        danger: true,
      })
      if (!ok) return
      try {
        await uninstallRemote({ localSkillId: skill.localId })
        toast.success(`已卸载「${skill.name}」`)
        refreshMarketplace()
        onInstalled()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : `卸载「${skill.name}」失败`)
      }
    },
    [uninstallRemote, refreshMarketplace, onInstalled, requestConfirm, toast],
  )

  const handleHubSectionChange = useCallback(
    (next: SkillHubShowcaseSection) => {
      setHubSection(next)
      setHubPage(1)
      setHubQuery('')
      setSelectedCategoryKey('all')
      featured.refresh()
    },
    [featured],
  )

  const handleHubCategoryChange = useCallback((nextKey: string) => {
    setSelectedCategoryKey(nextKey)
    setHubPage(1)
  }, [])

  const HUB_TABS: Array<{ key: SkillHubShowcaseSection; label: string }> = [
    { key: 'recommended', label: '推荐精选' },
    { key: 'hot_downloads', label: '下载热榜' },
  ]

  return (
    <div className="skill-store-page skill-store-page--installable">
      <div className="skill-store-header"></div>

      <section className="skill-store-section skill-store-section--installable">
        <div className="skill-store-section-title skill-store-section-title--with-tools">
          <span>
            {hubSearching
              ? `搜索结果「${hubQuery.trim()}」`
              : hubSection === 'recommended'
                ? 'SkillHub 推荐精选'
                : 'SkillHub 下载热榜'}
          </span>
          <span>{hubTotal}</span>
          <div className="skill-store-section-tools">
            <SearchBar
              placeholder="搜索 SkillHub 技能..."
              value={hubQuery}
              onInputChange={(value) => {
                setHubQuery(value)
                setHubPage(1)
              }}
              allowClear
            />
            <ActionIcon
              icon={Icons.Shuffle}
              size="middle"
              variant="borderless"
              onClick={() => {
                featured.shuffle()
                setHubPage(1)
              }}
              title="换一批"
            />
          </div>
        </div>

        <div className="skill-store-hub-subtabs" role="tablist" aria-label="SkillHub 榜单">
          {HUB_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={hubSection === t.key}
              className={`skill-store-hub-subtab ${hubSection === t.key ? 'is-active' : ''}`}
              onClick={() => handleHubSectionChange(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="skill-store-category-chips" role="tablist" aria-label="SkillHub 分类">
          {hubCategories.categories.map((cat) => (
            <button
              key={cat.key}
              type="button"
              className={`skill-store-category-chip ${selectedCategoryKey === cat.key ? 'is-active' : ''}`}
              onClick={() => handleHubCategoryChange(cat.key)}
            >
              {cat.name}
            </button>
          ))}
        </div>

        {hubSearching && hubSearch.error ? (
          <div className="card card-error">{hubSearch.error}</div>
        ) : !hubSearching && featured.error ? (
          <div className="card card-error">{featured.error}</div>
        ) : (hubSearching ? hubSearch.loading : featured.loading) && hubTotal === 0 ? (
          <div className="skill-store-loading">
            <Spin />
            <span>
              {hubSearching
                ? '正在搜索 SkillHub 技能...'
                : hubSection === 'recommended'
                  ? '正在加载 SkillHub 推荐精选...'
                  : '正在加载 SkillHub 下载热榜...'}
            </span>
          </div>
        ) : hubTotal === 0 ? (
          <div className="skill-store-empty">
            <Empty
              description={
                hubSearching
                  ? '没有匹配的 SkillHub 技能，换个关键词试试。'
                  : selectedCategoryKey !== 'all'
                    ? `「${hubCategories.categories.find((c) => c.key === selectedCategoryKey)?.name ?? selectedCategoryKey}」分类下暂无${hubSection === 'hot_downloads' ? '热榜' : '推荐'}数据。`
                    : '未能加载 SkillHub 榜单，请检查网络后刷新。'
              }
            />
          </div>
        ) : (
          <>
            <div className="skill-store-cards">
              {hubDisplay.map((skill) => {
                const slug = skill.id.slice(skill.registryId.length + 1)
                const p = progress[skillInstallProgressKey('skillhub', slug)]
                return (
                  <SkillHubSkillCard
                    key={skill.id}
                    skill={skill}
                    {...(p ? { progress: p } : {})}
                    onInstall={() => void handleInstallRemote(skill)}
                    onUninstall={() => void handleUninstallRemote(skill)}
                  />
                )
              })}
            </div>
            {hubTotal > SKILLHUB_PAGE_SIZE && (
              <Pagination
                className="skill-store-pagination"
                size="middle"
                align="center"
                current={hubPage}
                pageSize={SKILLHUB_PAGE_SIZE}
                total={hubTotal}
                onChange={(page) => setHubPage(page)}
                showSizeChanger={false}
                hideOnSinglePage
              />
            )}
          </>
        )}
      </section>
    </div>
  )
}

function SkillHubSkillCard({
  skill,
  progress,
  onInstall,
  onUninstall,
}: {
  skill: RemoteSkillItem
  progress?: { downloaded: number; total: number }
  onInstall: () => void
  onUninstall: () => void
}) {
  const installing = progress != null && !skill.installed
  const pct =
    progress && progress.total > 0 ? Math.round((progress.downloaded / progress.total) * 100) : null
  const dlText = formatDownloadCount(skill.downloadCount)
  return (
    <div className="skill-store-card skill-store-card--remote">
      <div className="skill-store-card-top">
        <div className="skill-store-card-icon skill-store-card-icon--img">
          {skill.iconUrl ? (
            <img src={skill.iconUrl} alt="" loading="lazy" />
          ) : (
            skill.name.charAt(0).toUpperCase()
          )}
        </div>
        <div className="skill-store-card-info">
          <div className="skill-store-card-title">{skill.name}</div>
          <div className="skill-store-card-subtitle">
            {/* {skill.author} */}
            <span className="skill-store-card-dot" />
            SkillHub
          </div>
        </div>
      </div>

      <div className="skill-store-card-desc">{skill.description}</div>

      <div className="skill-store-card-foot">
        <div className="skill-store-card-tags">
          {skill.tags.slice(0, 2).map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
        </div>
      </div>
      <div className="skill-store-card-actions">
        {skill.homepageUrl && (
          <div className="skill-store-card-link">
            <a href={skill.homepageUrl} target="_blank" rel="noreferrer">
              查看来源 ↗
            </a>
          </div>
        )}
        {installing ? (
          <span className="skill-store-card-progress">
            {pct != null ? `下载中 ${pct}%` : '下载中...'}
          </span>
        ) : skill.installed ? (
          <>
            <span className="skill-store-card-progress">已安装</span>
            <Button size="small" type="text" danger onClick={onUninstall}>
              卸载
            </Button>
          </>
        ) : (
          <Button size="small" type="text" onClick={onInstall} icon={<Icons.Download size={14} />}>
            安装
          </Button>
        )}
      </div>
    </div>
  )
}

/** 下载量格式化：1234 → 1.2k，32900 → 3.3万 */
function formatDownloadCount(n: number): string {
  if (!n || n <= 0) return ''
  if (n >= 10000) return `${(n / 10000).toFixed(1).replace(/\.0$/, '')}万`
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return String(n)
}

function InstallableSkillCard({
  item,
  progress,
  onInstall,
  onUninstall,
}: {
  item: InstallableSkillCatalogItem
  progress?: { downloaded: number; total: number }
  onInstall: () => void
  onUninstall: () => void
}) {
  const installing = progress != null && !item.installed
  const pct =
    progress && progress.total > 0 ? Math.round((progress.downloaded / progress.total) * 100) : null
  const sourceLabel =
    item.source.type === 'artifact'
      ? `Spark· ${item.source.artifactId ?? 'artifact'} `
      : `GitHub · ${item.source.repo}`
  const installButtonLabel = item.source.type === 'artifact' ? '从自建源安装' : '安装'
  const progressLabel = item.source.type === 'artifact' ? '自建源下载中' : '下载中'
  return (
    <div className="skill-store-card skill-store-card--installable">
      <div className="skill-store-card-top">
        <div className="skill-store-card-icon skill-store-card-icon--text">
          {item.name
            .replace(/[^A-Za-z0-9]/g, '')
            .slice(0, 3)
            .toUpperCase() || item.name.charAt(0).toUpperCase()}
        </div>
        <div className="skill-store-card-info">
          <div className="skill-store-card-title">{item.name}</div>
          <div className="skill-store-card-subtitle">
            {/* {item.author} */}
            {/* <span className="skill-store-card-dot" /> */}
            {sourceLabel}
          </div>
        </div>
      </div>

      <div className="skill-store-card-desc">{item.description}</div>

      <div className="skill-store-card-foot">
        <div className="skill-store-card-tags">
          {item.tags.slice(0, 3).map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
        </div>
        <div className="skill-store-card-actions" style={{ width: '100%' }}>
          {item.homepageUrl && (
            <a
              className="skill-store-card-foot--inline-link"
              href={item.homepageUrl}
              target="_blank"
              rel="noreferrer"
            >
              查看来源 ↗
            </a>
          )}
          {installing ? (
            <span className="skill-store-card-progress">
              {pct != null ? `${progressLabel} ${pct}%` : `${progressLabel}...`}
            </span>
          ) : item.installed ? (
            <>
              <span className="skill-store-card-progress">已安装</span>
              <Button size="small" type="text" danger onClick={onUninstall}>
                卸载
              </Button>
            </>
          ) : (
            <Button
              size="small"
              type="text"
              onClick={onInstall}
              icon={<Icons.Download size={14} />}
            >
              {installButtonLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function CreateTab({
  onCreated,
  onBack,
  onSkillReady,
}: {
  onCreated: () => void
  onBack: () => void
  onSkillReady: (skill: { id: string; name: string }) => void
}) {
  // ── Manual creation form state ──
  const [name, setName] = useState('')
  const [version, setVersion] = useState('1.0.0')
  const [description, setDescription] = useState('')
  const [author, setAuthor] = useState('')
  const [category, setCategory] = useState('utility')
  const [tagsInput, setTagsInput] = useState('')
  const [content, setContent] = useState('')
  const [requiredTools, setRequiredTools] = useState('')
  const [creating, setCreating] = useState(false)
  // 检测导入放在第一位，作为创建页默认入口
  const [importMode, setImportMode] = useState<ImportMode>('detect')
  const { toast } = useToast()

  // ── IPC hooks ──
  const { invoke: createSkill } = useIpcInvoke('skill:create')
  const { invoke: importFile } = useIpcInvoke('skill:import-file')
  const { invoke: importDirectory } = useIpcInvoke('skill:import-directory')
  const { invoke: openFileDialog } = useIpcInvoke('dialog:open-file')
  const { invoke: openDirectoryDialog } = useIpcInvoke('dialog:open-directory')
  const { invoke: detectLocalSkills } = useIpcInvoke('skill:detect-local')
  const { invoke: importBatchLocal } = useIpcInvoke('skill:import-batch-local')
  const { invoke: installToApp } = useIpcInvoke('skill:install-to-app')
  const { invoke: linkSkill } = useIpcInvoke('skill:link')
  const { invoke: getAppPaths } = useIpcInvoke('skill:app-paths')

  // ── Local detection state ──
  const [localCandidates, setLocalCandidates] = useState<LocalSkillCandidate[]>([])
  const [detecting, setDetecting] = useState(false)
  const [importingIds, setImportingIds] = useState<Set<string>>(new Set())
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [candidateSearch, setCandidateSearch] = useState('')

  // ── Local candidates: dedup -> filter by search (Claude / Codex / Agents) ──
  const dedupedCandidates = useMemo(() => deduplicateCandidates(localCandidates), [localCandidates])
  const searchFiltered = useMemo(
    () => filterCandidates(dedupedCandidates, candidateSearch),
    [candidateSearch, dedupedCandidates],
  )
  const importableCandidates = useMemo(
    () => searchFiltered.filter((c) => !c.installed),
    [searchFiltered],
  )
  const isImporting = importingIds.size > 0

  // ── Form reset ──
  const resetForm = useCallback(() => {
    setName('')
    setVersion('1.0.0')
    setDescription('')
    setAuthor('')
    setCategory('utility')
    setTagsInput('')
    setContent('')
    setRequiredTools('')
  }, [])

  // ── Manual creation ──
  const handleCreate = useCallback(async () => {
    if (!name.trim()) {
      toast.error('请输入 Skill 名称')
      return
    }
    if (!content.trim() && !description.trim()) {
      toast.error('请输入 Skill 描述或详细内容')
      return
    }

    setCreating(true)
    try {
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
      const tools = requiredTools
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
      const id = `user:${name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9一-龥]+/g, '-')}`

      const manifest = {
        desc: description.trim() || content.trim().slice(0, 100),
        description: description.trim(),
        source: '用户创建',
        author: author.trim() || 'User',
        category,
        tags,
        systemPrompt: content.trim(),
        requiredTools: tools,
        parameters: [],
      }

      const res = await createSkill({
        id,
        scope: 'user',
        name: name.trim(),
        version: version.trim() || '1.0.0',
        rootPath: `user://${id}`,
        manifestJson: JSON.stringify(manifest),
        enabled: true,
      })

      toast.success(`Skill「${name.trim()}」创建成功`)
      resetForm()
      onCreated()
      onSkillReady({ id: res.skill.id, name: res.skill.name })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建失败')
    } finally {
      setCreating(false)
    }
  }, [
    name,
    version,
    description,
    author,
    category,
    tagsInput,
    content,
    requiredTools,
    createSkill,
    toast,
    resetForm,
    onCreated,
    onSkillReady,
  ])

  // ── File import ──
  const handleImportFile = useCallback(async () => {
    try {
      const picked = await openFileDialog({
        title: '选择 Skill 文件（SKILL.md 或 .md）',
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      })
      if (picked.canceled || picked.filePath == null) return

      setCreating(true)
      try {
        const res = await importFile({ filePath: picked.filePath })
        toast.success(`已导入 Skill：${res.skill.name}`)
        onCreated()
        onSkillReady({ id: res.skill.id, name: res.skill.name })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '导入文件失败')
      } finally {
        setCreating(false)
      }
    } catch {
      // dialog cancelled
    }
  }, [openFileDialog, importFile, toast, onCreated, onSkillReady])

  // ── Directory import ──
  const handleImportDirectory = useCallback(async () => {
    try {
      const picked = await openDirectoryDialog({
        title: '选择包含 SKILL.md 的 Skill 目录',
      })
      if (picked.canceled || picked.filePath == null) return

      setCreating(true)
      try {
        const res = await importDirectory({ directoryPath: picked.filePath, source: 'custom' })
        toast.success(
          res.skills.length > 1 ? `已导入 ${res.skills.length} 个 Skill` : '已导入本地 Skill 目录',
        )
        onCreated()
        // 多 skill 场景:第一个 skill 作为 hint 主角,其余以 extraCount 形式告知,
        // 让用户从「已安装」中逐个分配 Agent
        if (res.skills.length >= 1) {
          const skill = res.skills[0]
          if (skill) {
            onSkillReady({
              id: skill.id,
              name: skill.name,
              ...(res.skills.length > 1 ? { extraCount: res.skills.length - 1 } : {}),
            })
          }
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '导入目录失败')
      } finally {
        setCreating(false)
      }
    } catch {
      // dialog cancelled
    }
  }, [openDirectoryDialog, importDirectory, toast, onCreated, onSkillReady])

  // ── Detect local skills ──
  const handleDetectLocal = useCallback(async () => {
    setDetecting(true)
    setSelectedIds(new Set())
    setCandidateSearch('')
    try {
      const res = await detectLocalSkills({})
      setLocalCandidates(res.candidates)
      if (res.candidates.length > 0) {
        toast.success(`检测到 ${res.candidates.length} 个本地 Skill`)
      } else {
        toast.info('未检测到本地 Skill')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '检测本地 Skill 失败')
    } finally {
      setDetecting(false)
    }
  }, [detectLocalSkills, toast])

  const refreshCandidates = useCallback(async () => {
    try {
      const res = await detectLocalSkills({})
      setLocalCandidates(res.candidates)
    } catch {
      // silent refresh
    }
  }, [detectLocalSkills])

  const handleImportLocal = useCallback(
    async (candidate: LocalSkillCandidate) => {
      const id = candidate.id
      setImportingIds((prev) => new Set(prev).add(id))
      try {
        // 软链接的技能直接注册，其他来源安装到应用内
        let readySkill: { id: string; name: string; extraCount?: number } | null = null
        if (candidate.source === 'linked') {
          const res = await importDirectory({ directoryPath: candidate.rootPath, source: 'linked' })
          // 多 skill 场景:第一个 skill 作为 hint 主角,其余以 extraCount 形式告知
          if (res.skills.length >= 1) {
            const skill = res.skills[0]
            if (skill) {
              readySkill = {
                id: skill.id,
                name: skill.name,
                ...(res.skills.length > 1 ? { extraCount: res.skills.length - 1 } : {}),
              }
            }
          }
        } else {
          const res = await installToApp({ sourcePath: candidate.rootPath })
          readySkill = { id: res.skill.id, name: res.skill.name }
        }
        toast.success(`已安装 ${candidate.name}`)
        onCreated()
        if (readySkill) onSkillReady(readySkill)
        await refreshCandidates()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '安装 Skill 失败')
      } finally {
        setImportingIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }
    },
    [installToApp, importDirectory, onCreated, onSkillReady, refreshCandidates, toast],
  )

  const handleBatchImport = useCallback(async () => {
    const toImport = importableCandidates.filter((c) => selectedIds.has(c.id))
    if (toImport.length === 0) return
    setImportingIds((prev) => {
      const next = new Set(prev)
      for (const c of toImport) next.add(c.id)
      return next
    })
    try {
      const result = await importBatchLocal({
        candidates: toImport.map((c) => ({ rootPath: c.rootPath, source: c.source })),
      })
      if (result.failed > 0) {
        toast.warning(`已导入 ${result.skills.length} 个，${result.failed} 个失败`)
        for (const e of result.errors) {
          console.error('Import error:', e)
        }
      } else {
        toast.success(`已批量导入 ${result.skills.length} 个 Skill`)
      }
      // 批量场景:第一个 skill 作为 hint 主角,其余以 extraCount 形式告知
      if (result.skills.length >= 1) {
        const skill = result.skills[0]
        if (skill) {
          onSkillReady({
            id: skill.id,
            name: skill.name,
            ...(result.skills.length > 1 ? { extraCount: result.skills.length - 1 } : {}),
          })
        }
      }
      setSelectedIds(new Set())
      onCreated()
      await refreshCandidates()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '批量导入失败')
    } finally {
      setImportingIds((prev) => {
        const next = new Set(prev)
        for (const c of toImport) next.delete(c.id)
        return next
      })
    }
  }, [
    importableCandidates,
    selectedIds,
    importBatchLocal,
    onCreated,
    onSkillReady,
    refreshCandidates,
    toast,
  ])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === importableCandidates.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(importableCandidates.map((c) => c.id)))
    }
  }, [selectedIds.size, importableCandidates])

  return (
    <div className="create-skill-layout">
      {/* Mode selector — 检测导入置顶 */}
      <div className="create-mode-bar">
        <button
          className={`store-tab ${importMode === 'detect' ? 'active' : ''}`}
          onClick={() => setImportMode('detect')}
        >
          <Icons.Refresh size={13} />
          检测导入
        </button>
        <button
          className={`store-tab ${importMode === 'import' ? 'active' : ''}`}
          onClick={() => setImportMode('import')}
        >
          <Icons.Upload size={13} />
          文件/目录导入
        </button>
        <button
          className={`store-tab ${importMode === 'link' ? 'active' : ''}`}
          onClick={() => setImportMode('link')}
        >
          <Icons.ExternalLink size={13} />
          软链接
        </button>
        <button
          className={`store-tab ${importMode === 'none' ? 'active' : ''}`}
          onClick={() => setImportMode('none')}
        >
          <Icons.Edit size={13} />
          手动创建
        </button>
      </div>

      {importMode === 'none' ? (
        /* ── Manual Creation Form ── */
        <div className="create-skill-form">
          <div className="create-form-section">
            <div className="create-section-title">基本信息</div>
            <div className="create-form-grid">
              <div className="form-field">
                <label className="form-label">
                  名称 <span className="required">*</span>
                </label>
                <Input
                  placeholder="例如：代码审查助手"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label className="form-label">版本</label>
                <Input
                  placeholder="1.0.0"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label className="form-label">作者</label>
                <Input
                  placeholder="作者名称"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label className="form-label">分类</label>
                <Select
                  value={category}
                  onChange={(v) => setCategory(v)}
                  options={[
                    { label: '通用', value: 'utility' },
                    { label: '代码生成', value: 'code-generation' },
                    { label: '代码审查', value: 'code-review' },
                    { label: '测试', value: 'testing' },
                    { label: '文档', value: 'documentation' },
                    { label: '数据分析', value: 'data-analysis' },
                    { label: 'Web 开发', value: 'web-development' },
                    { label: 'API 开发', value: 'api-development' },
                    { label: 'DevOps', value: 'devops' },
                    { label: '安全', value: 'security' },
                    { label: 'AI/ML', value: 'ai-ml' },
                    { label: '自动化', value: 'automation' },
                    { label: '数据库', value: 'database' },
                    { label: '前端', value: 'frontend' },
                    { label: '后端', value: 'backend' },
                  ]}
                />
              </div>
            </div>
          </div>

          <div className="create-form-section">
            <div className="create-section-title">描述与标签</div>
            <div className="form-field">
              <label className="form-label">
                简短描述 <span className="required">*</span>
              </label>
              <TextArea
                rows={3}
                placeholder="一句话描述 Skill 的功能，例如：自动化代码审查，检测潜在 Bug 和安全问题"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label className="form-label">标签（逗号分隔）</label>
              <Input
                placeholder="code-review, security, quality"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label className="form-label">所需工具（逗号分隔）</label>
              <Input
                placeholder="例如：Bash, Read, Edit"
                value={requiredTools}
                onChange={(e) => setRequiredTools(e.target.value)}
              />
            </div>
          </div>

          <div className="create-form-section">
            <div className="create-section-title">Skill 详细内容</div>
            <div className="form-field">
              <label className="form-label">
                System Prompt / 指令内容 <span className="required">*</span>
              </label>
              <TextArea
                className="form-textarea-lg"
                rows={12}
                placeholder={`在此编写 Skill 的完整指令内容，支持 Markdown 格式。\n\n例如：\n# 代码审查助手\n\n你是一个专业的代码审查助手。请对提供的代码进行以下方面的审查：\n\n1. **代码质量**：检查代码是否清晰、可读\n2. **安全漏洞**：检测潜在的安全问题\n3. **性能优化**：发现性能瓶颈\n4. **最佳实践**：建议改进方向`}
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
              <div className="form-hint">
                支持 Markdown 格式。此内容将作为 Skill 的 System Prompt，在 Agent 运行时注入。
              </div>
            </div>
          </div>

          <div className="create-form-actions">
            <Button type="text" onClick={resetForm}>
              重置
            </Button>
            <Button
              type="primary"
              disabled={creating || !name.trim()}
              loading={creating}
              onClick={() => void handleCreate()}
            >
              创建 Skill
            </Button>
          </div>
        </div>
      ) : importMode === 'import' ? (
        /* ── File / Directory Import（合并）── */
        <div className="create-import-panel">
          <div className="import-panel-icon">
            <Icons.Upload size={48} />
          </div>
          <div className="import-panel-title">导入 Skill（文件或目录）</div>
          <div className="import-panel-desc">
            选择一个 <b>SKILL.md / Markdown 文件</b>，或一个 <b>包含 SKILL.md 的目录</b>
            。系统会自动解析 frontmatter（名称、描述、版本等）与内容，创建为本地
            Skill；目录导入会一并纳入子目录中的脚本、模板等附属文件。
          </div>
          <div className="import-panel-supported">
            <span className="badge">SKILL.md</span>
            <span className="badge">.md</span>
            <span className="badge">目录</span>
          </div>
          <div className="import-panel-format">
            <div className="import-format-title">文件格式 / 目录结构示例：</div>
            <pre className="import-format-code">{`# 单文件
---
name: 我的 Skill
description: 描述文字
version: 1.0.0
---
# Skill 指令内容...

# 目录
my-skill/
├── SKILL.md          ← 必须包含
├── scripts/helper.ts ← 辅助脚本
└── templates/out.md  ← 模板文件`}</pre>
          </div>
          <div className="row" style={{ gap: '8px', justifyContent: 'center' }}>
            <Button
              type="primary"
              size="middle"
              disabled={creating}
              loading={creating}
              icon={<Icons.File size={14} />}
              onClick={() => void handleImportFile()}
            >
              选择文件
            </Button>
            <Button
              type="text"
              size="middle"
              disabled={creating}
              loading={creating}
              icon={<Icons.FolderOpen size={14} />}
              onClick={() => void handleImportDirectory()}
            >
              选择目录
            </Button>
          </div>
        </div>
      ) : importMode === 'detect' ? (
        /* ── Detect & Import Local Skills ── */
        <div>
          <div className="row" style={{ marginBottom: '12px', gap: '8px' }}>
            <Button
              type="primary"
              size="small"
              onClick={() => void handleDetectLocal()}
              disabled={detecting || isImporting}
              loading={detecting}
              icon={<Icons.Refresh size={12} />}
            >
              检测本地 Skill
            </Button>
            {dedupedCandidates.length > 0 && (
              <span className="muted" style={{ lineHeight: '32px' }}>
                检测到 {dedupedCandidates.length} 个本地 Skill
              </span>
            )}
          </div>

          {dedupedCandidates.length > 0 && (
            <div className="local-skill-panel">
              <div className="local-skill-head">
                <span className="local-skill-title">本地可导入 Skill</span>
                <span className="badge">{dedupedCandidates.length}</span>
                <div style={{ flex: 1 }} />
                {importableCandidates.length > 0 && (
                  <>
                    <Button
                      size="middle"
                      type="text"
                      onClick={toggleSelectAll}
                      disabled={isImporting}
                    >
                      {selectedIds.size === importableCandidates.length ? '取消全选' : '全选'}
                    </Button>
                    <Button
                      size="middle"
                      type="primary"
                      loading={isImporting}
                      onClick={() => void handleBatchImport()}
                      disabled={selectedIds.size === 0 || isImporting}
                    >
                      {`导入所选 (${selectedIds.size})`}
                    </Button>
                  </>
                )}
              </div>

              {/* Search */}
              <div className="local-skill-filter-bar">
                <SearchBar
                  placeholder="搜索本地 Skill..."
                  value={candidateSearch}
                  onInputChange={(value) => setCandidateSearch(value)}
                  allowClear
                  style={{ width: '220px' }}
                />
              </div>

              <div className="local-skill-list">
                {searchFiltered.length === 0 ? (
                  <div
                    style={{
                      padding: '16px',
                      textAlign: 'center',
                      color: 'var(--text-muted)',
                      fontSize: '12px',
                    }}
                  >
                    未找到匹配的本地 Skill
                  </div>
                ) : (
                  searchFiltered.map((candidate) => {
                    const importing = importingIds.has(candidate.id)
                    const selected = selectedIds.has(candidate.id)
                    return (
                      <div className="local-skill-row" key={candidate.id}>
                        {candidate.installed ? (
                          <label className="local-skill-check" onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked disabled readOnly />
                            <span className="checkmark" />
                          </label>
                        ) : (
                          <label className="local-skill-check" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selected}
                              disabled={importing}
                              onChange={() => toggleSelect(candidate.id)}
                            />
                            <span className="checkmark" />
                          </label>
                        )}
                        <div className="local-skill-icon">
                          {candidate.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex1 min-w-0">
                          <div className="strong truncate">{candidate.name}</div>
                          <div className="muted truncate" title={candidate.rootPath}>
                            {candidate.description || candidate.source} — {candidate.rootPath}
                          </div>
                        </div>
                        <span className="badge badge-font-sm" style={{ flexShrink: 0 }}>
                          {candidate.source}
                        </span>
                        {candidate.installed ? (
                          <span className="badge success" style={{ flexShrink: 0 }}>
                            已导入
                          </span>
                        ) : (
                          <Button
                            size="middle"
                            type="text"
                            onClick={() => void handleImportLocal(candidate)}
                            disabled={importing}
                            loading={importing}
                            style={{ flexShrink: 0 }}
                          >
                            导入
                          </Button>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )}

          {localCandidates.length === 0 && !detecting && (
            <div className="empty-state">
              <div className="empty-icon">
                <Icons.Refresh />
              </div>
              <div className="empty-title">点击上方按钮检测本地 Skill</div>
              <div className="empty-desc">扫描本地目录中包含 SKILL.md 的 Skill，一键批量导入</div>
            </div>
          )}
        </div>
      ) : (
        /* ── Link Host Skill Directory ── */
        <LinkSkillPanel onCreated={onCreated} onSkillReady={onSkillReady} />
      )}
    </div>
  )
}

/** 软链接技能面板 — 将宿主机上的技能目录通过软链接引入应用 */
function LinkSkillPanel({
  onCreated,
  onSkillReady,
}: {
  onCreated: () => void
  onSkillReady: (skill: { id: string; name: string }) => void
}) {
  const [linkTarget, setLinkTarget] = useState('')
  const [linkName, setLinkName] = useState('')
  const [linking, setLinking] = useState(false)
  const [appPaths, setAppPaths] = useState<{
    bundledDir: string
    userDir: string
    linksDir: string
    linkedSkills: string[]
  } | null>(null)
  const { invoke: linkSkill } = useIpcInvoke('skill:link')
  const { invoke: unlinkSkill } = useIpcInvoke('skill:unlink')
  const { invoke: getAppPaths } = useIpcInvoke('skill:app-paths')
  const { invoke: openDirectoryDialog } = useIpcInvoke('dialog:open-directory')
  const { toast } = useToast()

  useEffect(() => {
    getAppPaths({})
      .then(setAppPaths)
      .catch(() => {})
  }, [getAppPaths])

  const handleLink = useCallback(async () => {
    if (!linkTarget.trim()) {
      toast.error('请输入或选择技能目录路径')
      return
    }
    setLinking(true)
    try {
      const res = await linkSkill({
        targetPath: linkTarget.trim(),
        ...(linkName.trim() ? { name: linkName.trim() } : {}),
      })
      toast.success('已创建软链接')
      setLinkTarget('')
      setLinkName('')
      onCreated()
      onSkillReady({ id: res.skill.id, name: res.skill.name })
      // 刷新路径信息
      getAppPaths({})
        .then(setAppPaths)
        .catch(() => {})
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建软链接失败')
    } finally {
      setLinking(false)
    }
  }, [linkTarget, linkName, linkSkill, onCreated, onSkillReady, getAppPaths, toast])

  const handleBrowse = useCallback(async () => {
    try {
      const picked = await openDirectoryDialog({
        title: '选择要链接的技能目录（需包含 SKILL.md）',
      })
      if (!picked.canceled && picked.filePath) {
        setLinkTarget(picked.filePath)
        if (!linkName.trim()) {
          setLinkName(picked.filePath.split('/').pop() || '')
        }
      }
    } catch {
      // dialog cancelled
    }
  }, [openDirectoryDialog, linkName])

  const handleUnlink = useCallback(
    async (name: string) => {
      try {
        await unlinkSkill({ name })
        toast.success(`已取消链接 ${name}`)
        onCreated()
        getAppPaths({})
          .then(setAppPaths)
          .catch(() => {})
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '取消链接失败')
      }
    },
    [unlinkSkill, onCreated, getAppPaths, toast],
  )

  return (
    <div className="create-import-panel">
      <div className="import-panel-icon">
        <Icons.ExternalLink size={48} />
      </div>
      <div className="import-panel-title">软链接技能目录</div>
      <div className="import-panel-desc">
        将宿主机上的技能目录通过软链接引入应用。链接后技能文件保持原位，应用自动读取最新内容。适用于开发中的技能，无需每次手动复制。
      </div>
      <div className="import-panel-supported">
        <span className="badge">软链接</span>
        <span className="badge">SKILL.md</span>
      </div>

      <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div className="form-field">
          <label className="form-label">技能目录路径 *</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <div style={{ flex: 1 }}>
              <Input
                placeholder="例如：/Users/you/.codex/skills/my-skill 或 /Users/you/.claude/skills/my-skill"
                value={linkTarget}
                onChange={(e) => setLinkTarget(e.target.value)}
              />
            </div>
            <Button type="text" onClick={() => void handleBrowse()}>
              浏览
            </Button>
          </div>
        </div>
        <div className="form-field">
          <label className="form-label">链接名称（可选，默认使用目录名）</label>
          <Input
            placeholder="my-skill"
            value={linkName}
            onChange={(e) => setLinkName(e.target.value)}
          />
        </div>
        <Button
          type="primary"
          disabled={linking || !linkTarget.trim()}
          loading={linking}
          icon={<Icons.ExternalLink size={14} />}
          onClick={() => void handleLink()}
        >
          创建软链接
        </Button>
      </div>

      {appPaths && appPaths.linkedSkills.length > 0 && (
        <div style={{ marginTop: '20px' }}>
          <div className="create-section-title">已链接的技能</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
            {appPaths.linkedSkills.map((name) => (
              <div key={name} className="local-skill-row">
                <div className="local-skill-icon">{name.charAt(0).toUpperCase()}</div>
                <div className="flex1 min-w-0">
                  <div className="strong truncate">{name}</div>
                </div>
                <span className="badge">链接</span>
                <Button size="middle" type="text" onClick={() => void handleUnlink(name)}>
                  取消链接
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {appPaths && (
        <div style={{ marginTop: '16px', fontSize: '11px', color: 'var(--text-muted)' }}>
          <div>链接目录：{appPaths.linksDir}</div>
          <div>应用技能目录：{appPaths.userDir}</div>
        </div>
      )}
    </div>
  )
}
