/**
 * SkillStoreView — Skill 管理页面
 *
 * Tab 切换：已安装（Installed）+ 精选推荐（Installable）+ 在线市场（SkillHub）+ 创建（Create）
 * 已安装 Tab：Cursor-style 卡片列表 + 详情双页布局
 * 创建 Tab：手动创建 / 文件导入 / 目录导入 / 检测导入本地 Skill
 */
import { Suspense, lazy, useState, useCallback, useMemo, useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { ReactNode } from 'react'
import { Modal, Pagination, Spin, Switch } from 'antd'
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
import { translate, useI18n } from '../i18n'
import { ActionIcon, Button, Empty, Input, SearchBar, Select, Tag, TextArea } from '@lobehub/ui'
import { useApp } from '../AppContext'
import { AgentsPickerModal } from '../components/AgentsPickerModal'
import { SkillAssignHintModal } from '../components/SkillAssignHintModal'
import { getAgentAvatarConfig, resolveAvatarSrc } from '../avatar'
import { AGENTS_OPEN_DETAIL_EVENT, AGENTS_OPEN_DETAIL_STORAGE_KEY } from './AgentsView'
import { MarkdownText } from './ChatView'
import { PublishSkillToTeamModal } from './SkillTeamMarket'
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

/**
 * 技能详情页按需加载：它依赖 Monaco（源码视图），同步 import 会把编辑器塞进
 * 技能管理首屏 chunk。懒加载后只有真正进入详情页才拉取编辑器与样式。
 */
const SkillDetailPage = lazy(() =>
  import('./skill-detail/SkillDetailPage').then((mod) => ({ default: mod.SkillDetailPage })),
)

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
    value === 'installed' || value === 'create' || value === 'installable' || value === 'skillhub'
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
  // 本文件使用非响应式 translate()：顶层订阅语言变化，保证切换语言后整树重渲染。
  useI18n()
  const [activeTab, setActiveTab] = useState<TabType>(readInitialSkillStoreTab)
  const [refreshKey, setRefreshKey] = useState(0)
  const [installProgress, setInstallProgress] = useState<Record<string, SkillInstallProgress>>({})
  /**
   * 技能详情页目标技能 id。
   * 放在这一层（而非 InstalledTab 内部）是为了：刷新列表时 InstalledTab 会因 key 变化
   * 重新挂载，若详情状态在子组件里就会被重置回列表 —— 保存文件后刷新正是这种场景。
   */
  const [detailSkillId, setDetailSkillId] = useState<string | null>(null)
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
      setDetailSkillId(null)
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
      toast.info(translate('skillStore.tpl1LongDesc', { count: (skill.extraCount ?? 0) + 1 }))
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
      toast.warning(translate('skillStore.tpl2Desc', { ok, fail }))
    } else {
      toast.success(translate('skillStore.tpl3Desc', { name: skillName, ok }))
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

  /** 进入某个技能的详情页（导入 / 创建完成后也会调用，便于立即预览与编辑） */
  const openSkillDetail = useCallback((skillId: string) => {
    setActiveTab('installed')
    setDetailSkillId(skillId)
  }, [])

  const detailOpen = activeTab === 'installed' && detailSkillId != null

  return (
    <div className="view-body" style={{ position: 'relative' }}>
      <div className="skills-view">
        {/* 详情页占满内容区（自带返回入口），此时隐藏 Tab 切换条避免层级混乱 */}
        {!detailOpen && (
          <div className="skill-store-tabs">
            {(['skillhub', 'installable', 'installed', 'create'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                className={`skill-store-tab ${activeTab === tab ? 'is-active' : ''}`}
                onClick={() => {
                  setDetailSkillId(null)
                  setActiveTab(tab)
                }}
              >
                {tab === 'installed'
                  ? translate('skillStore.t1')
                  : tab === 'installable'
                    ? translate('skillStore.t2')
                    : tab === 'skillhub'
                      ? translate('skillStore.t3')
                      : translate('skillStore.t4')}
              </button>
            ))}
          </div>
        )}
        {activeTab === 'installed' ? (
          <InstalledTab
            key={`installed-${refreshKey}`}
            onCreate={() => setActiveTab('create')}
            onRefresh={triggerRefresh}
            agents={agents}
            onAssignToAgents={openAssignPicker}
            onJumpToAgent={handleJumpToAgent}
            detailSkillId={detailSkillId}
            onOpenDetail={openSkillDetail}
            onCloseDetail={() => setDetailSkillId(null)}
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
            onPreviewSkill={openSkillDetail}
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
  detailSkillId,
  onOpenDetail,
  onCloseDetail,
}: {
  onCreate: () => void
  onRefresh: () => void
  agents: ManagedAgent[]
  onAssignToAgents: (skill: { id: string; name: string }) => void
  onJumpToAgent: (agentId: string) => void
  /** 当前打开详情页的技能 id（null = 停留在列表） */
  detailSkillId: string | null
  onOpenDetail: (skillId: string) => void
  onCloseDetail: () => void
}) {
  const { skills, loading, error, refresh, toggleSkill, deleteSkill, total, enabledCount } =
    useSkills()
  const { requestConfirm } = useApp()
  const { invoke: getSkillDetail } = useIpcInvoke('skill:detail')
  const [search, setSearch] = useState('')
  const [managementMode, setManagementMode] = useState(false)
  const [selectedDeleteIds, setSelectedDeleteIds] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [detailState, setDetailState] = useState<{
    skillId: string | null
    detail: SkillDetailInfo | null
    error: string
  }>({
    skillId: null,
    detail: null,
    error: '',
  })
  /** 详情页保存后递增 —— 让下方 getSkillDetail effect 重新拉取，避免整表重挂载 */
  const [detailVersion, setDetailVersion] = useState(0)
  /** 「技能概览」弹窗（沿用原有详情弹窗，用于查看完整定义 / 参数 / 分发情况） */
  const [overviewOpen, setOverviewOpen] = useState(false)
  const [publishSkill, setPublishSkill] = useState<SkillItem | null>(null)
  const { toast } = useToast()
  // 详情页保存后刷新：只重拉列表与详情，不做整表 key 重挂载。
  // 整表重挂载会把详情页的选中文件 / 预览态 / 编辑态全部重置，保存后立刻闪回列表态。
  const handleChanged = useCallback(() => {
    refresh()
    setDetailVersion((v) => v + 1)
  }, [refresh])

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
      { id: 'local', title: translate('skillStore.t1'), skills: local },
    ].filter((section) => section.skills.length > 0)
  }, [filteredSkills])

  // 详情页 / 概览弹窗的数据源：优先详情页目标技能，否则列表首项
  const activeSkillId = useMemo(() => {
    if (detailSkillId != null) return detailSkillId
    if (filteredSkills.length === 0) return null
    return filteredSkills[0]?.id ?? null
  }, [filteredSkills, detailSkillId])

  useEffect(() => {
    if (activeSkillId == null) return
    let cancelled = false

    getSkillDetail({ id: activeSkillId })
      .then((res) => {
        if (cancelled) return
        setDetailState({
          skillId: activeSkillId,
          detail: res.detail,
          error: res.detail == null ? translate('skillStore.t5Desc') : '',
        })
      })
      .catch((err) => {
        if (cancelled) return
        setDetailState({
          skillId: activeSkillId,
          detail: null,
          error: err instanceof Error ? err.message : translate('skillStore.t6Desc'),
        })
      })

    return () => {
      cancelled = true
    }
  }, [activeSkillId, getSkillDetail, detailVersion])

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
        title: translate('skillStore.t7'),
        description: translate('skillStore.t8Desc'),
        confirmText: translate('skillStore.t9'),
        danger: true,
      })
      if (!confirmed) return
      await deleteSkill(id)
      toast.success(translate('skillStore.t10'))
    },
    [requestConfirm, deleteSkill, toast],
  )

  const handleBatchDelete = useCallback(async () => {
    if (selectedDeleteIds.size === 0) return
    const confirmed = await requestConfirm({
      title: translate('skillStore.tpl4Desc', { count: selectedDeleteIds.size }),
      description: translate('skillStore.t11Desc'),
      confirmText: translate('skillStore.t12'),
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
        toast.warning(translate('skillStore.tpl5Desc', { ok: successCount, fail: failCount }))
      } else {
        toast.success(translate('skillStore.tpl6Desc', { count: successCount }))
      }
      exitManagement()
    } finally {
      setDeleting(false)
    }
  }, [selectedDeleteIds, requestConfirm, deleteSkill, exitManagement, toast])

  const openSkillDetail = useCallback(
    (skill: SkillItem) => {
      onOpenDetail(skill.id)
    },
    [onOpenDetail],
  )

  const detailSkill = useMemo(
    () => (detailSkillId != null ? (skills.find((s) => s.id === detailSkillId) ?? null) : null),
    [skills, detailSkillId],
  )
  // 列表已拉过一轮但仍找不到 → 判定为已被删除；列表为空时视为仍在加载（下方始终提供返回入口）
  const detailMissing =
    detailSkillId != null &&
    detailSkill == null &&
    !loading &&
    (skills.length > 0 || error.length > 0)
  const selectedSkill =
    detailSkill ?? filteredSkills.find((skill) => skill.id === activeSkillId) ?? null
  const detailLoading = activeSkillId != null && detailState.skillId !== activeSkillId
  const selectedDetail = detailState.skillId === activeSkillId ? detailState.detail : null
  const detailError = detailState.skillId === activeSkillId ? detailState.error : ''

  // 当前选中 skill 已分发到的 agent ids
  const assignedAgentIds = useMemo(() => {
    if (selectedSkill == null) return []
    return agents.filter((a) => a.skillIds.includes(selectedSkill.id)).map((a) => a.id)
  }, [agents, selectedSkill])

  const overviewModal = (
    <Modal
      className="skill-detail-modal"
      open={overviewOpen}
      title={null}
      width="min(680px, 92vw)"
      centered
      destroyOnClose
      onCancel={() => setOverviewOpen(false)}
      footer={
        <div className="skill-detail-modal-footer">
          <div className="skill-detail-modal-footer-left">
            {selectedSkill && !selectedSkill.id.startsWith('builtin:') && (
              <Button
                size="small"
                type="text"
                danger
                onClick={() => {
                  const id = selectedSkill.id
                  void handleDeleteSkill(id).then(() => {
                    setOverviewOpen(false)
                    onCloseDetail()
                  })
                }}
              >
                {translate('skillStore.t25')}
              </Button>
            )}
          </div>
          <div className="skill-detail-modal-footer-right">
            {selectedSkill && !selectedSkill.id.startsWith('builtin:') && (
              <Button
                size="small"
                icon={<Icons.Users size={14} />}
                onClick={() => selectedSkill && setPublishSkill(selectedSkill)}
              >
                {translate('skillStore.t95')}
              </Button>
            )}
            <Button
              size="small"
              type="primary"
              icon={<Icons.Bot size={14} />}
              onClick={() => {
                if (selectedSkill)
                  onAssignToAgents({ id: selectedSkill.id, name: selectedSkill.name })
              }}
            >
              {translate('skillStore.t96')}
            </Button>
          </div>
        </div>
      }
    >
      <SkillDetailPanel
        skill={selectedSkill}
        detail={selectedDetail}
        loading={detailLoading}
        error={detailError}
        assignedAgentIds={assignedAgentIds}
        agents={agents}
        onToggle={() => {
          if (selectedSkill) void toggleSkill(selectedSkill)
        }}
        onJumpToAgent={onJumpToAgent}
      />
    </Modal>
  )

  // ── 详情页分支：整页替换列表 ─────────────────────────────────────────
  if (detailSkillId != null) {
    return (
      <>
        <div className="skill-store-page skill-store-page--installed">
          {detailSkill != null ? (
            <Suspense
              fallback={
                <div className="skill-store-loading">
                  <Spin />
                  <span>{translate('skillStore.t14')}</span>
                </div>
              }
            >
              <SkillDetailPage
                skill={detailSkill}
                detail={selectedDetail}
                detailLoading={detailLoading}
                agents={agents}
                onBack={onCloseDetail}
                onChanged={handleChanged}
                onOpenOverview={() => setOverviewOpen(true)}
                onAssignToAgents={() =>
                  onAssignToAgents({ id: detailSkill.id, name: detailSkill.name })
                }
                onPublishToTeam={() => setPublishSkill(detailSkill)}
                onJumpToAgent={onJumpToAgent}
              />
            </Suspense>
          ) : (
            <div className="skill-store-loading">
              {!detailMissing && <Spin />}
              <span>{detailMissing ? translate('skillStore.t13Desc') : translate('skillStore.t14')}</span>
              <Button
                size="small"
                type="text"
                icon={<Icons.ArrowLeft size={14} />}
                onClick={onCloseDetail}
              >
                {translate('skillStore.t97')}
              </Button>
            </div>
          )}
        </div>
        {overviewModal}
        <PublishSkillToTeamModal
          open={publishSkill != null}
          skill={publishSkill}
          onClose={() => setPublishSkill(null)}
        />
      </>
    )
  }

  return (
    <>
      <div className="skill-store-page skill-store-page--installed">
        <div className="skill-store-header">
          <div>
            <div className="strong text-base font-semibold">Skills</div>
            <div className="muted text-xs mt-0.5">
              {translate('skillStore.tpl7Desc', { total, enabled: enabledCount })}
            </div>
          </div>
          <div className="skill-store-actions">
            <SearchBar
              placeholder={translate('skillStore.t75')}
              value={search}
              onInputChange={(value) => setSearch(value)}
              allowClear
              className="skill-store-header-search"
            />
            {/* 创建入口：搜索框右侧的主题色按钮 */}
            <Button size="small" type="primary" onClick={onCreate} icon={<Icons.Plus size={14} />}>
              {translate('skillStore.t4')}
            </Button>
            {!managementMode ? (
              <Button
                size="small"
                type="text"
                onClick={enterManagement}
                disabled={total === 0}
                icon={<Icons.Settings size={14} />}
              >
                {translate('skillStore.t98')}
              </Button>
            ) : (
              <Button
                size="small"
                type="text"
                onClick={exitManagement}
                disabled={deleting}
                icon={<Icons.X size={14} />}
              >
                {translate('skillStore.t99')}
              </Button>
            )}
            <ActionIcon
              icon={Icons.Refresh}
              size="small"
              variant="borderless"
              onClick={onRefresh}
              title={translate('skillStore.t76')}
            />
          </div>
        </div>

        {managementMode && (
          <div className="skill-store-mgmt-bar">
            <Icons.CheckSquare size={13} />
            <span>
              {translate('skillStore.t100')} <span className="mgmt-count">{selectedDeleteIds.size}</span> {translate('skillStore.t101')}
            </span>
            <Button size="small" type="text" onClick={toggleDeleteSelectAll} disabled={deleting}>
              {selectedDeleteIds.size === filteredSkills.length ? translate('skillStore.t15') : translate('skillStore.t16')}
            </Button>
            <Button
              size="small"
              type="primary"
              danger
              onClick={() => void handleBatchDelete()}
              disabled={selectedDeleteIds.size === 0 || deleting}
            >
              {deleting ? translate('skillStore.t17') : translate('skillStore.tpl8Desc', { count: selectedDeleteIds.size })}
            </Button>
          </div>
        )}

        {error && <div className="card card-error">{error}</div>}

        {loading ? (
          <div className="skill-store-loading">
            <Spin />
            <span>{translate('skillStore.t102Desc')}</span>
          </div>
        ) : total === 0 ? (
          <div className="skill-store-empty">
            <Empty description={translate('skillStore.t18Desc')} />
          </div>
        ) : filteredSkills.length === 0 ? (
          <div className="skill-store-empty">
            <Empty description={translate('skillStore.t77Desc')} />
          </div>
        ) : (
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
                      managementMode={managementMode}
                      selected={selectedDeleteIds.has(skill.id)}
                      onToggleSelect={toggleDeleteSelect}
                      onOpen={() => openSkillDetail(skill)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        <div className="skill-store-stats">
          {translate('skillStore.tpl7Desc', { total, enabled: enabledCount })}
        </div>
      </div>
      <PublishSkillToTeamModal
        open={publishSkill != null}
        skill={publishSkill}
        onClose={() => setPublishSkill(null)}
      />
      {overviewModal}
    </>
  )
}

function InstalledSkillCard({
  skill,
  onToggle,
  managementMode,
  selected,
  onToggleSelect,
  onOpen,
}: {
  skill: SkillItem
  onToggle: (skill: SkillItem) => Promise<void>
  managementMode: boolean
  selected: boolean
  onToggleSelect: (id: string) => void
  onOpen: () => void
}) {
  const meta = parseManifestExtras(skill.manifestJson)
  return (
    <div
      role="button"
      tabIndex={0}
      className="skill-store-card skill-store-card--installed"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
    >
      <div className="skill-store-card-top">
        <div className="skill-store-card-icon skill-store-card-icon--default">
          <Icons.Package size={20} />
        </div>
        <div className="skill-store-card-info">
          <div className="skill-store-card-title">{skill.name}</div>
          <div className="skill-store-card-subtitle">{meta.description || skill.version}</div>
        </div>
        {managementMode ? (
          <label className="local-skill-check" onClick={(e) => e.stopPropagation()}>
            <input type="checkbox" checked={selected} onChange={() => onToggleSelect(skill.id)} />
            <span className="checkmark" />
          </label>
        ) : (
          <div className="skill-store-card-actions" onClick={(event) => event.stopPropagation()}>
            <Switch size="small" checked={skill.enabled} onChange={() => void onToggle(skill)} />
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
  onToggle,
  onJumpToAgent,
}: {
  skill: SkillItem | null
  detail: SkillDetailInfo | null
  loading: boolean
  error: string
  agents: ManagedAgent[]
  assignedAgentIds: string[]
  onToggle?: () => void
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
  // Prompt 全屏预览：弹窗内空间有限，长 systemPrompt 单独开大窗查看完整渲染
  const [previewOpen, setPreviewOpen] = useState(false)

  if (skill == null) {
    return (
      <div className="skill-store-detail-empty">
        <Empty description={translate('skillStore.t78')} />
      </div>
    )
  }

  if (loading) {
    return (
      <div className="skill-store-detail-loading">
        <Spin />
        <span>{translate('skillStore.t103')}</span>
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
        <div className="skill-store-detail-icon">
          <Icons.Package size={24} />
        </div>
        <div className="skill-store-detail-hero-copy">
          <h3>{skill.name}</h3>
          <p>{definition?.description || manifestMeta.description}</p>
        </div>
        <div className="skill-store-detail-hero-actions">
          <Switch
            size="small"
            checked={skill.enabled}
            onChange={() => onToggle?.()}
            disabled={onToggle == null}
          />
        </div>
      </div>

      <div className="skill-store-detail-assigned">
        {assignedAgents.length > 0 ? (
          <>
            <div className="skill-store-detail-assigned-label">
              {translate('skillStore.tpl9Desc', { count: assignedAgents.length })}
            </div>
            <div className="skill-store-detail-assigned-chips">
              {assignedAgents.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="skill-store-detail-assigned-chip"
                  onClick={() => onJumpToAgent?.(a.id)}
                  title={onJumpToAgent ? translate('skillStore.tpl10Desc', { name: a.name }) : a.name}
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
            {translate('skillStore.t104Desc')}
          </div>
        )}
      </div>

      <div className="skill-store-detail-meta">
        <DetailStat label={translate('skillStore.t79')} value={manifestMeta.source} />
        <DetailStat label={translate('skillStore.t80')} value={skill.version} />
        <DetailStat
          label={translate('skillStore.t81')}
          value={definition?.category || manifestMeta.category || translate('skillStore.t19')}
        />
        <DetailStat label={translate('skillStore.t82')} value={definition?.author || manifestMeta.author || translate('skillStore.t20')} />
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
                  {parameter.description || translate('skillStore.t21')}
                </div>
              </div>
            ))}
          </div>
        </DetailSection>
      )}

      {definition?.systemPrompt && (
        <DetailSection
          title="Prompt Preview"
          action={
            <Button
              size="small"
              type="text"
              icon={<Icons.Maximize size={14} />}
              onClick={() => setPreviewOpen(true)}
            >
              {translate('skillStore.t105')}
            </Button>
          }
        >
          <div className="skill-store-prompt-preview">
            <MarkdownText content={definition.systemPrompt} />
          </div>
        </DetailSection>
      )}
      {definition?.systemPrompt && (
        <Modal
          className="skill-prompt-fullscreen-modal"
          open={previewOpen}
          title={`${skill.name} · Prompt`}
          footer={null}
          width="min(960px, 94vw)"
          centered
          destroyOnClose
          onCancel={() => setPreviewOpen(false)}
        >
          <div className="skill-prompt-fullscreen-body">
            <MarkdownText content={definition.systemPrompt} />
          </div>
        </Modal>
      )}
    </div>
  )
}

function DetailSection({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="skill-store-detail-section">
      <div className="skill-store-detail-section-head">
        <div className="skill-store-detail-section-title">{title}</div>
        {action}
      </div>
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
      const sourceName = item.source.type === 'artifact' ? translate('skillStore.t22') : translate('skillStore.t23')
      try {
        const res = await installCatalog({ slug: item.slug })
        toast.success(translate('skillStore.tpl11Desc', { source: sourceName, name: res.skill.name }))
        if (res.postInstallHint) {
          // 依赖提示单独再弹一条，避免被 success 吞掉
          toast.info(res.postInstallHint)
        }
        refresh()
        onInstalled()
        onSkillReady({ id: res.skill.id, name: res.skill.name })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : translate('skillStore.tpl12Desc', { name: item.name }))
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
        title: translate('skillStore.tpl13Desc', { name: item.name }),
        description: translate('skillStore.t24Desc'),
        confirmText: translate('skillStore.t25'),
        danger: true,
      })
      if (!ok) return
      try {
        await uninstallCatalog({ slug: item.slug })
        toast.success(translate('skillStore.tpl14Desc', { name: item.name }))
        refresh()
        onInstalled()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : translate('skillStore.tpl15Desc', { name: item.name }))
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
            <span>{translate('skillStore.t106')}</span>
            <span>{items.length}</span>
          </div>
          {loading ? (
            <div className="skill-store-loading">
              <Spin />
              <span>{translate('skillStore.t107')}</span>
            </div>
          ) : items.length === 0 ? (
            <div className="skill-store-empty">
              <Empty description={translate('skillStore.t83Desc')} />
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
        toast.success(translate('skillStore.tpl16Desc', { name: skill.name }))
        refreshMarketplace()
        onInstalled()
        onSkillReady({ id: res.skill.id, name: res.skill.name })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : translate('skillStore.tpl12Desc', { name: skill.name }))
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
        title: translate('skillStore.tpl13Desc', { name: skill.name }),
        description: translate('skillStore.t24Desc'),
        confirmText: translate('skillStore.t25'),
        danger: true,
      })
      if (!ok) return
      try {
        await uninstallRemote({ localSkillId: skill.localId })
        toast.success(translate('skillStore.tpl14Desc', { name: skill.name }))
        refreshMarketplace()
        onInstalled()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : translate('skillStore.tpl15Desc', { name: skill.name }))
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
    { key: 'recommended', label: translate('skillStore.t26') },
    { key: 'hot_downloads', label: translate('skillStore.t27') },
  ]

  return (
    <div className="skill-store-page skill-store-page--installable">
      <div className="skill-store-header"></div>

      <section className="skill-store-section skill-store-section--installable">
        <div className="skill-store-section-title skill-store-section-title--with-tools">
          <span>
            {hubSearching
              ? translate('skillStore.tpl17Desc', { query: hubQuery.trim() })
              : hubSection === 'recommended'
                ? translate('skillStore.t28Desc')
                : translate('skillStore.t29Desc')}
          </span>
          <span>{hubTotal}</span>
          <div className="skill-store-section-tools">
            <SearchBar
              placeholder={translate('skillStore.t84Desc')}
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
              title={translate('skillStore.t85')}
            />
          </div>
        </div>

        <div className="skill-store-hub-subtabs" role="tablist" aria-label={translate('skillStore.t86')}>
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

        <div className="skill-store-category-chips" role="tablist" aria-label={translate('skillStore.t87')}>
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
                ? translate('skillStore.t30Desc')
                : hubSection === 'recommended'
                  ? translate('skillStore.t31Desc')
                  : translate('skillStore.t32Desc')}
            </span>
          </div>
        ) : hubTotal === 0 ? (
          <div className="skill-store-empty">
            <Empty
              description={
                hubSearching
                  ? translate('skillStore.t33Desc')
                  : selectedCategoryKey !== 'all'
                    ? translate('skillStore.tpl38Desc', { category: hubCategories.categories.find((c) => c.key === selectedCategoryKey)?.name ?? selectedCategoryKey, kind: hubSection === 'hot_downloads' ? translate('skillStore.t34') : translate('skillStore.t35') })
                    : translate('skillStore.t36Desc')
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
              {translate('skillStore.t108')}
            </a>
          </div>
        )}
        {installing ? (
          <span className="skill-store-card-progress">
            {pct != null ? translate('skillStore.tpl19Desc', { pct }) : translate('skillStore.t37')}
          </span>
        ) : skill.installed ? (
          <>
            <span className="skill-store-card-progress">{translate('skillStore.t1')}</span>
            <Button size="small" type="text" danger onClick={onUninstall}>
              {translate('skillStore.t25')}
            </Button>
          </>
        ) : (
          <Button size="small" type="text" onClick={onInstall} icon={<Icons.Download size={14} />}>
            {translate('skillStore.t38')}
          </Button>
        )}
      </div>
    </div>
  )
}

/** 下载量格式化：1234 → 1.2k，32900 → 3.3万 */
function formatDownloadCount(n: number): string {
  if (!n || n <= 0) return ''
  if (n >= 10000) return translate('skillStore.tpl20Desc', { value: (n / 10000).toFixed(1).replace(/\.0$/, '') })
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
  const installButtonLabel = translate('skillStore.t38')
  const progressLabel = translate('skillStore.t39')
  return (
    <div className="skill-store-card skill-store-card--installable">
      <div className="skill-store-card-top">
        <div className="skill-store-card-icon skill-store-card-icon--default">
          <Icons.Package size={20} />
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
              {translate('skillStore.t108')}
            </a>
          )}
          {installing ? (
            <span className="skill-store-card-progress">
              {pct != null ? `${progressLabel} ${pct}%` : `${progressLabel}...`}
            </span>
          ) : item.installed ? (
            <>
              <span className="skill-store-card-progress">{translate('skillStore.t1')}</span>
              <Button size="small" type="text" danger onClick={onUninstall}>
                {translate('skillStore.t25')}
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
  onPreviewSkill,
}: {
  onCreated: () => void
  onBack: () => void
  onSkillReady: (skill: { id: string; name: string }) => void
  /** 创建 / 导入成功 → 直接进入技能详情页，便于立即预览与编辑 */
  onPreviewSkill: (skillId: string) => void
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
  /** 指令内容区的 编辑 / 预览 切换（预览用 MarkdownText 渲染，便于写完即看效果） */
  const [contentPreview, setContentPreview] = useState(false)
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
    setContentPreview(false)
  }, [])

  // ── Manual creation ──
  const handleCreate = useCallback(async () => {
    if (!name.trim()) {
      toast.error(translate('skillStore.t40'))
      return
    }
    if (!content.trim() && !description.trim()) {
      toast.error(translate('skillStore.t41Desc'))
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
        .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')}`

      const manifest = {
        desc: description.trim() || content.trim().slice(0, 100),
        description: description.trim(),
        source: translate('skillStore.t42'),
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

      toast.success(translate('skillStore.tpl21Desc', { name: name.trim() }))
      resetForm()
      onCreated()
      onPreviewSkill(res.skill.id)
      onSkillReady({ id: res.skill.id, name: res.skill.name })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : translate('skillStore.t43'))
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
    onPreviewSkill,
    onSkillReady,
  ])

  // ── File import ──
  const handleImportFile = useCallback(async () => {
    try {
      const picked = await openFileDialog({
        title: translate('skillStore.t44Desc'),
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      })
      if (picked.canceled || picked.filePath == null) return

      setCreating(true)
      try {
        const res = await importFile({ filePath: picked.filePath })
        toast.success(translate('skillStore.tpl22Desc', { name: res.skill.name }))
        onCreated()
        onPreviewSkill(res.skill.id)
        onSkillReady({ id: res.skill.id, name: res.skill.name })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : translate('skillStore.t45'))
      } finally {
        setCreating(false)
      }
    } catch {
      // dialog cancelled
    }
  }, [openFileDialog, importFile, toast, onCreated, onPreviewSkill, onSkillReady])

  // ── Directory import ──
  const handleImportDirectory = useCallback(async () => {
    try {
      const picked = await openDirectoryDialog({
        title: translate('skillStore.t46'),
      })
      if (picked.canceled || picked.filePath == null) return

      setCreating(true)
      try {
        const res = await importDirectory({ directoryPath: picked.filePath, source: 'custom' })
        toast.success(
          res.skills.length > 1 ? translate('skillStore.tpl23Desc', { count: res.skills.length }) : translate('skillStore.t47Desc'),
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
            // 单技能目录导入：直接进入详情页预览/编辑；多技能交给「已安装」列表逐个处理
            if (res.skills.length === 1) onPreviewSkill(skill.id)
          }
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : translate('skillStore.t48'))
      } finally {
        setCreating(false)
      }
    } catch {
      // dialog cancelled
    }
  }, [openDirectoryDialog, importDirectory, toast, onCreated, onSkillReady, onPreviewSkill])

  // ── Detect local skills ──
  const handleDetectLocal = useCallback(async () => {
    setDetecting(true)
    setSelectedIds(new Set())
    setCandidateSearch('')
    try {
      const res = await detectLocalSkills({})
      setLocalCandidates(res.candidates)
      if (res.candidates.length > 0) {
        toast.success(translate('skillStore.tpl24Desc', { count: res.candidates.length }))
      } else {
        toast.info(translate('skillStore.t49'))
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : translate('skillStore.t50'))
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
        toast.success(translate('skillStore.tpl25Desc', { name: candidate.name }))
        onCreated()
        if (readySkill) {
          onSkillReady(readySkill)
          onPreviewSkill(readySkill.id)
        }
        await refreshCandidates()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : translate('skillStore.t51'))
      } finally {
        setImportingIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }
    },
    [
      installToApp,
      importDirectory,
      onCreated,
      onSkillReady,
      onPreviewSkill,
      refreshCandidates,
      toast,
    ],
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
        toast.warning(translate('skillStore.tpl26Desc', { ok: result.skills.length, fail: result.failed }))
        for (const e of result.errors) {
          console.error('Import error:', e)
        }
      } else {
        toast.success(translate('skillStore.tpl27Desc', { count: result.skills.length }))
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
      toast.error(err instanceof Error ? err.message : translate('skillStore.t52'))
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
          {translate('skillStore.t109')}
        </button>
        <button
          className={`store-tab ${importMode === 'import' ? 'active' : ''}`}
          onClick={() => setImportMode('import')}
        >
          <Icons.Upload size={13} />
          {translate('skillStore.t110')}
        </button>
        <button
          className={`store-tab ${importMode === 'link' ? 'active' : ''}`}
          onClick={() => setImportMode('link')}
        >
          <Icons.ExternalLink size={13} />
          {translate('skillStore.t111')}
        </button>
        <button
          className={`store-tab ${importMode === 'none' ? 'active' : ''}`}
          onClick={() => setImportMode('none')}
        >
          <Icons.Edit size={13} />
          {translate('skillStore.t112')}
        </button>
      </div>

      {importMode === 'none' ? (
        /* ── Manual Creation Form ── */
        <div className="create-skill-form">
          <section className="create-panel">
            <div className="create-panel-head">
              <span className="create-panel-icon">
                <Icons.FileText size={15} />
              </span>
              <div className="create-panel-headings">
                <div className="create-panel-title">{translate('skillStore.t113')}</div>
                <div className="create-panel-desc">
                  {translate('skillStore.t114Desc')}
                </div>
              </div>
            </div>
            <div className="create-panel-body">
              <div className="create-form-grid">
                <div className="form-field">
                  <label className="form-label">
                    {translate('skillStore.t115')} <span className="required">*</span>
                  </label>
                  <Input
                    placeholder={translate('skillStore.t88')}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="form-field">
                  <label className="form-label">{translate('skillStore.t80')}</label>
                  <Input
                    placeholder="1.0.0"
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                  />
                </div>
                <div className="form-field">
                  <label className="form-label">{translate('skillStore.t82')}</label>
                  <Input
                    placeholder={translate('skillStore.t89')}
                    value={author}
                    onChange={(e) => setAuthor(e.target.value)}
                  />
                </div>
                <div className="form-field">
                  <label className="form-label">{translate('skillStore.t81')}</label>
                  <Select
                    value={category}
                    onChange={(v) => setCategory(v)}
                    options={[
                      { label: translate('skillStore.t53'), value: 'utility' },
                      { label: translate('skillStore.t54'), value: 'code-generation' },
                      { label: translate('skillStore.t55'), value: 'code-review' },
                      { label: translate('skillStore.t56'), value: 'testing' },
                      { label: translate('skillStore.t57'), value: 'documentation' },
                      { label: translate('skillStore.t58'), value: 'data-analysis' },
                      { label: translate('skillStore.t59'), value: 'web-development' },
                      { label: translate('skillStore.t60'), value: 'api-development' },
                      { label: 'DevOps', value: 'devops' },
                      { label: translate('skillStore.t61'), value: 'security' },
                      { label: 'AI/ML', value: 'ai-ml' },
                      { label: translate('skillStore.t62'), value: 'automation' },
                      { label: translate('skillStore.t63'), value: 'database' },
                      { label: translate('skillStore.t64'), value: 'frontend' },
                      { label: translate('skillStore.t65'), value: 'backend' },
                    ]}
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="create-panel">
            <div className="create-panel-head">
              <span className="create-panel-icon">
                <Icons.Tag size={15} />
              </span>
              <div className="create-panel-headings">
                <div className="create-panel-title">{translate('skillStore.t116')}</div>
                <div className="create-panel-desc">
                  {translate('skillStore.t117LongDesc')}
                </div>
              </div>
            </div>
            <div className="create-panel-body">
              <div className="form-field">
                <label className="form-label">
                  {translate('skillStore.t118')} <span className="required">*</span>
                </label>
                <TextArea
                  rows={3}
                  placeholder={translate('skillStore.t90LongDesc')}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label className="form-label">{translate('skillStore.t119')}</label>
                <Input
                  placeholder="code-review, security, quality"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label className="form-label">{translate('skillStore.t120')}</label>
                <Input
                  placeholder={translate('skillStore.t91Desc')}
                  value={requiredTools}
                  onChange={(e) => setRequiredTools(e.target.value)}
                />
              </div>
            </div>
          </section>

          <section className="create-panel">
            <div className="create-panel-head">
              <span className="create-panel-icon">
                <Icons.Edit size={15} />
              </span>
              <div className="create-panel-headings">
                <div className="create-panel-title">{translate('skillStore.t121')}</div>
                <div className="create-panel-desc">
                  {translate('skillStore.t122LongDesc')}
                </div>
              </div>
            </div>
            <div className="create-panel-body">
              <div className="form-field">
                <label className="form-label">
                  {translate('skillStore.t123Desc')} <span className="required">*</span>
                </label>
                {/* 编辑 / 预览 分段控件：写完指令立即看渲染效果，与详情页「预览|源码」同一范式 */}
                <div className="create-content-mode" role="tablist" aria-label={translate('skillStore.t92')}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={!contentPreview}
                    className={`create-content-mode-btn ${!contentPreview ? 'is-active' : ''}`}
                    onClick={() => setContentPreview(false)}
                  >
                    <Icons.Edit size={12} />
                    {translate('skillStore.t124')}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={contentPreview}
                    className={`create-content-mode-btn ${contentPreview ? 'is-active' : ''}`}
                    onClick={() => setContentPreview(true)}
                    disabled={content.trim().length === 0}
                    title={
                      content.trim().length === 0 ? translate('skillStore.t66') : translate('skillStore.t67Desc')
                    }
                  >
                    <Icons.Eye size={12} />
                    {translate('skillStore.t125')}
                  </button>
                </div>
                {contentPreview ? (
                  <div className="create-content-preview">
                    <MarkdownText content={content} />
                  </div>
                ) : (
                  <TextArea
                    className="form-textarea-lg"
                    rows={12}
                    placeholder={translate('skillStore.tpl39Instruction')}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                  />
                )}
              </div>
            </div>
          </section>

          <section className="create-panel">
            <div className="create-panel-actions">
              <Button type="text" onClick={resetForm}>
                {translate('skillStore.t126')}
              </Button>
              <Button
                type="primary"
                disabled={creating || !name.trim()}
                loading={creating}
                onClick={() => void handleCreate()}
              >
                {translate('skillStore.t127')}
              </Button>
            </div>
          </section>
        </div>
      ) : importMode === 'import' ? (
        /* ── File / Directory Import（合并）── */
        <section className="create-panel">
          <div className="create-panel-head">
            <span className="create-panel-icon">
              <Icons.Upload size={15} />
            </span>
            <div className="create-panel-headings">
              <div className="create-panel-title">{translate('skillStore.t128Desc')}</div>
              <div className="create-panel-desc">
                {translate('skillStore.t129')} <b>{translate('skillStore.t130Desc')}</b>{translate('skillStore.t131')} <b>{translate('skillStore.t132Desc')}</b>
                {translate('skillStore.tpl28LongDesc')}
              </div>
              <div className="create-panel-badges">
                <span className="badge">SKILL.md</span>
                <span className="badge">.md</span>
                <span className="badge">{translate('skillStore.t133')}</span>
              </div>
            </div>
          </div>

          <div className="create-panel-body">
            <div>
              <div className="create-panel-field-title">{translate('skillStore.t134Desc')}</div>
              <pre className="create-panel-code">{translate('skillStore.tpl29Instruction')}</pre>
            </div>
          </div>

          <div className="create-panel-actions">
            <Button
              type="text"
              size="middle"
              disabled={creating}
              loading={creating}
              icon={<Icons.FolderOpen size={14} />}
              onClick={() => void handleImportDirectory()}
            >
              {translate('skillStore.t135')}
            </Button>
            <Button
              type="primary"
              size="middle"
              disabled={creating}
              loading={creating}
              icon={<Icons.File size={14} />}
              onClick={() => void handleImportFile()}
            >
              {translate('skillStore.t136')}
            </Button>
          </div>
        </section>
      ) : importMode === 'detect' ? (
        /* ── Detect & Import Local Skills ── */
        <div>
          <div className="create-panel">
            <div className="create-panel-head">
              <span className="create-panel-icon">
                <Icons.Refresh size={15} />
              </span>
              <div className="create-panel-headings">
                <div className="create-panel-title">{translate('skillStore.t137')}</div>
                <div className="create-panel-desc">
                  {translate('skillStore.tpl30LongDesc')}
                </div>
              </div>
              <div className="create-panel-head-actions">
                {dedupedCandidates.length > 0 && (
                  <span className="create-panel-hint-text">
                    {translate('skillStore.tpl31Desc', { count: dedupedCandidates.length })}
                  </span>
                )}
                <Button
                  type="primary"
                  size="small"
                  onClick={() => void handleDetectLocal()}
                  disabled={detecting || isImporting}
                  loading={detecting}
                  icon={<Icons.Refresh size={12} />}
                >
                  {dedupedCandidates.length > 0 ? translate('skillStore.t68') : translate('skillStore.t69')}
                </Button>
              </div>
            </div>
          </div>

          {dedupedCandidates.length > 0 && (
            <section className="create-panel">
              <div className="create-panel-head">
                <span className="create-panel-icon">
                  <Icons.Package size={15} />
                </span>
                <div className="create-panel-headings">
                  <div className="create-panel-title">
                    {translate('skillStore.t138')}
                    <span className="badge">{dedupedCandidates.length}</span>
                  </div>
                  <div className="create-panel-desc">
                    {translate('skillStore.t139Desc')}
                  </div>
                </div>
                {importableCandidates.length > 0 && (
                  <div className="create-panel-head-actions">
                    <Button
                      size="middle"
                      type="text"
                      onClick={toggleSelectAll}
                      disabled={isImporting}
                    >
                      {selectedIds.size === importableCandidates.length ? translate('skillStore.t15') : translate('skillStore.t16')}
                    </Button>
                    <Button
                      size="middle"
                      type="primary"
                      loading={isImporting}
                      onClick={() => void handleBatchImport()}
                      disabled={selectedIds.size === 0 || isImporting}
                    >
                      {translate('skillStore.tpl32Desc', { count: selectedIds.size })}
                    </Button>
                  </div>
                )}
              </div>

              <div className="create-panel-body create-panel-body--flush">
                {/* Search */}
                <div className="local-skill-filter-bar">
                  <SearchBar
                    placeholder={translate('skillStore.t93Desc')}
                    value={candidateSearch}
                    onInputChange={(value) => setCandidateSearch(value)}
                    allowClear
                    style={{ width: '240px' }}
                  />
                </div>

                <div className="local-skill-list">
                  {searchFiltered.length === 0 ? (
                    <div className="create-panel-empty">{translate('skillStore.t140Desc')}</div>
                  ) : (
                    searchFiltered.map((candidate) => {
                      const importing = importingIds.has(candidate.id)
                      const selected = selectedIds.has(candidate.id)
                      return (
                        <div className="local-skill-row" key={candidate.id}>
                          {candidate.installed ? (
                            <label
                              className="local-skill-check"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input type="checkbox" checked disabled readOnly />
                              <span className="checkmark" />
                            </label>
                          ) : (
                            <label
                              className="local-skill-check"
                              onClick={(e) => e.stopPropagation()}
                            >
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
                          {/* 中间信息列：flex + min-width:0，长描述单行省略，绝不挤压右侧操作列 */}
                          <div className="local-skill-main">
                            <div className="local-skill-name truncate" title={candidate.name}>
                              {candidate.name}
                            </div>
                            <div className="local-skill-desc truncate" title={candidate.rootPath}>
                              {candidate.description || candidate.source}
                            </div>
                          </div>
                          {/* 右侧固定操作列：不参与收缩，粘在行尾 */}
                          <div className="local-skill-actions">
                            <span className="badge">{candidate.source}</span>
                            {candidate.installed ? (
                              <>
                                <span className="badge success">{translate('skillStore.t141')}</span>
                                {candidate.localSkillId != null && (
                                  <Button
                                    size="middle"
                                    type="text"
                                    icon={<Icons.Eye size={13} />}
                                    onClick={() => onPreviewSkill(candidate.localSkillId as string)}
                                  >
                                    {translate('skillStore.t125')}
                                  </Button>
                                )}
                              </>
                            ) : (
                              <Button
                                size="middle"
                                type="text"
                                onClick={() => void handleImportLocal(candidate)}
                                disabled={importing}
                                loading={importing}
                              >
                                {translate('skillStore.t142')}
                              </Button>
                            )}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            </section>
          )}

          {localCandidates.length === 0 && !detecting && (
            <div className="empty-state">
              <div className="empty-icon">
                <Icons.Refresh />
              </div>
              <div className="empty-title">{translate('skillStore.t143Desc')}</div>
              <div className="empty-desc">{translate('skillStore.t144Desc')}</div>
            </div>
          )}
        </div>
      ) : (
        /* ── Link Host Skill Directory ── */
        <LinkSkillPanel
          onCreated={onCreated}
          onSkillReady={onSkillReady}
          onPreviewSkill={onPreviewSkill}
        />
      )}
    </div>
  )
}

/** 软链接技能面板 — 将宿主机上的技能目录通过软链接引入应用 */
function LinkSkillPanel({
  onCreated,
  onSkillReady,
  onPreviewSkill,
}: {
  onCreated: () => void
  onSkillReady: (skill: { id: string; name: string }) => void
  onPreviewSkill: (skillId: string) => void
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
      toast.error(translate('skillStore.t70'))
      return
    }
    setLinking(true)
    try {
      const res = await linkSkill({
        targetPath: linkTarget.trim(),
        ...(linkName.trim() ? { name: linkName.trim() } : {}),
      })
      toast.success(translate('skillStore.t71'))
      setLinkTarget('')
      setLinkName('')
      onCreated()
      onPreviewSkill(res.skill.id)
      onSkillReady({ id: res.skill.id, name: res.skill.name })
      // 刷新路径信息
      getAppPaths({})
        .then(setAppPaths)
        .catch(() => {})
    } catch (err) {
      toast.error(err instanceof Error ? err.message : translate('skillStore.t72'))
    } finally {
      setLinking(false)
    }
  }, [linkTarget, linkName, linkSkill, onCreated, onPreviewSkill, onSkillReady, getAppPaths, toast])

  const handleBrowse = useCallback(async () => {
    try {
      const picked = await openDirectoryDialog({
        title: translate('skillStore.t73Desc'),
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
        toast.success(translate('skillStore.tpl33Desc', { name }))
        onCreated()
        getAppPaths({})
          .then(setAppPaths)
          .catch(() => {})
      } catch (err) {
        toast.error(err instanceof Error ? err.message : translate('skillStore.t74'))
      }
    },
    [unlinkSkill, onCreated, getAppPaths, toast],
  )

  return (
    <>
      <section className="create-panel">
        <div className="create-panel-head">
          <span className="create-panel-icon">
            <Icons.ExternalLink size={15} />
          </span>
          <div className="create-panel-headings">
            <div className="create-panel-title">{translate('skillStore.t145')}</div>
            <div className="create-panel-desc">
              {translate('skillStore.tpl34LongDesc')}
            </div>
            <div className="create-panel-badges">
              <span className="badge">{translate('skillStore.t111')}</span>
              <span className="badge">SKILL.md</span>
              <span className="badge">{translate('skillStore.t147')}</span>
            </div>
          </div>
        </div>

        <div className="create-panel-body">
          <div className="form-field">
            <label className="form-label">{translate('skillStore.t148')}</label>
            <div className="create-panel-input-row">
              <div className="create-panel-input">
                <Input
                  placeholder={translate('skillStore.t94Desc')}
                  value={linkTarget}
                  onChange={(e) => setLinkTarget(e.target.value)}
                />
              </div>
              <Button
                type="text"
                icon={<Icons.FolderOpen size={14} />}
                onClick={() => void handleBrowse()}
              >
                {translate('skillStore.t149')}
              </Button>
            </div>
          </div>
          <div className="form-field">
            <label className="form-label">{translate('skillStore.t150Desc')}</label>
            <Input
              placeholder="my-skill"
              value={linkName}
              onChange={(e) => setLinkName(e.target.value)}
            />
          </div>
        </div>

        <div className="create-panel-actions">
          <Button
            type="primary"
            size="middle"
            disabled={linking || !linkTarget.trim()}
            loading={linking}
            icon={<Icons.ExternalLink size={14} />}
            onClick={() => void handleLink()}
          >
            {translate('skillStore.t151')}
          </Button>
        </div>
      </section>

      <section className="create-panel">
        <div className="create-panel-head">
          <span className="create-panel-icon">
            <Icons.Link size={15} />
          </span>
          <div className="create-panel-headings">
            <div className="create-panel-title">
              {translate('skillStore.tpl35Desc')}
              {appPaths != null && <span className="badge">{appPaths.linkedSkills.length}</span>}
            </div>
            <div className="create-panel-desc">
              {translate('skillStore.t152Desc')}
            </div>
          </div>
        </div>

        <div className="create-panel-body create-panel-body--flush">
          {appPaths != null && appPaths.linkedSkills.length > 0 ? (
            <div className="local-skill-list">
              {appPaths.linkedSkills.map((name) => (
                <div key={name} className="local-skill-row">
                  <div className="local-skill-icon">{name.charAt(0).toUpperCase()}</div>
                  <div className="local-skill-main">
                    <div className="local-skill-name truncate" title={name}>
                      {name}
                    </div>
                    <div className="local-skill-desc truncate" title={name}>
                      {translate('skillStore.t153Desc')}
                    </div>
                  </div>
                  <div className="local-skill-actions">
                    <span className="badge">{translate('skillStore.t154')}</span>
                    <Button size="middle" type="text" onClick={() => void handleUnlink(name)}>
                      {translate('skillStore.t155')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="create-panel-empty">{translate('skillStore.t156')}</div>
          )}
        </div>

        {appPaths != null && (
          <div className="create-panel-footnote">
            <span>{translate('skillStore.tpl36Desc', { path: appPaths.linksDir })}</span>
            <span>{translate('skillStore.tpl37Desc', { path: appPaths.userDir })}</span>
          </div>
        )}
      </section>
    </>
  )
}
