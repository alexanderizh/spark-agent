/**
 * MemoryPanel — 长期记忆管理面板（V2）
 *
 * 三个区块：列表（scope/type/失效过滤）、详情/编辑 Drawer、新增 Drawer、配置 Drawer。
 * memory 配置走 settings:get/set；CRUD 走 memory:* IPC。子组件各自 useIpcInvoke 拿 typed invoke。
 * 仅 LobeHub + antd 组件，样式落 MemoryPanel.less（mp_ 前缀）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  Tag,
  Tooltip,
  Drawer,
  Empty,
  Input as LobeInput,
  Select as LobeSelect,
  TextArea,
} from '@lobehub/ui'
import { Switch, message, Modal, Segmented, Spin, Checkbox } from 'antd'
import { Icons } from '../Icons'
import { MEMORY_PENDING_CHANGED_EVENT } from '../hooks/useMemoryPendingCount'
import { MemoryCandidateDetailModal, type MemoryCandidate } from './MemoryCandidateDetailModal'
import type {
  MemoryEntry,
  MemoryHistoryResponse,
  MemoryScope,
  MemoryType,
  ProviderProfile,
  ManagedAgent,
} from '@spark/protocol'
import { useIpcInvoke } from '../hooks/useIpc'
import { useRefreshable } from '../hooks/useRefreshable'
import { useSessionSidebar } from '../SessionSidebarContext'
import './MemoryPanel.less'

type ScopeFilter = 'user' | 'project' | 'agent'
type TypeFilter = 'all' | MemoryType

const TYPE_OPTIONS: Array<{ label: string; value: TypeFilter }> = [
  { label: '全部类型', value: 'all' },
  { label: 'User', value: 'user' },
  { label: 'Feedback', value: 'feedback' },
  { label: 'Project', value: 'project' },
  { label: 'Reference', value: 'reference' },
]

/** 【审查修复 C6】有效期是否按日精度（解析 meta，替代脆弱的 JSON 子串匹配） */
function isDatePrecision(metaJson: string | null | undefined): boolean {
  if (metaJson == null) return false
  try {
    return (JSON.parse(metaJson) as { precision?: unknown }).precision === 'date'
  } catch {
    return false
  }
}

/** 【S2.5】可解释证据状态（补充计划 §3.1）：展示层用状态替代裸分数 */
function memoryEvidenceState(entry: {
  archived: boolean
  invalidAt: number | null
  evidenceStatus?: string | null
  authorRole?: string | null
}): string {
  if (entry.invalidAt != null) return '已失效'
  if (entry.archived) return '已归档'
  if (entry.evidenceStatus === 'unavailable') return '证据不可用'
  switch (entry.authorRole) {
    case 'manual_user':
      return '用户明确表达'
    case 'consolidation':
      return '整合推断'
    case 'sync_import':
      return '同步导入'
    default:
      return '模型推断'
  }
}

/** 【P0.1】authorRole → 来源短标签（列表行灰阶标签用）；未知角色回退显示原值 */
const AUTHOR_ROLE_SHORT: Record<string, string> = {
  manual_user: '手动',
  host_agent: '对话',
  consolidation: '整合',
  sync_import: '导入',
}

export function MemoryPanel() {
  const { invoke: listMemory } = useIpcInvoke('memory:list')
  const { invoke: listAgents } = useIpcInvoke('agent:list')
  // 从 sidebar context 拿当前项目/会话，让 project/agent scope 默认绑当前上下文
  // （用户不用手填 UUID —— 这是"写入成功但面板看不到"的 UX 根因）
  const { workspaces, activeWorkspaceId, sessions, activeSessionId } = useSessionSidebar()
  // 从活跃会话推导当前 agentId（agent scope 默认选它）
  const activeAgentId = useMemo(() => {
    if (activeSessionId == null) return null
    return sessions.find((s) => s.id === activeSessionId)?.agentId ?? null
  }, [sessions, activeSessionId])
  const getContextScopeRef = useCallback(
    (next: ScopeFilter): string => {
      if (next === 'project') return activeWorkspaceId ?? ''
      if (next === 'agent') return activeAgentId ?? ''
      return ''
    },
    [activeWorkspaceId, activeAgentId],
  )
  const [agents, setAgents] = useState<ManagedAgent[]>([])
  useEffect(() => {
    void listAgents({})
      .then((r) => setAgents(r?.agents ?? []))
      .catch(() => {})
  }, [listAgents])
  const [scope, setScope] = useState<ScopeFilter>('user')
  const [scopeRef, setScopeRef] = useState<string>('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  // 【P1-⑥】三态视图：仅有效（默认）/ 含失效 / 已归档。
  // 后端 includeArchived=true 是「包含归档」而非「只看归档」，归档视图需客户端过滤
  const [viewMode, setViewMode] = useState<'active' | 'withInvalid' | 'archived'>('active')
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  // 前端文本搜索（按 name/description 模糊匹配）
  const [searchText, setSearchText] = useState('')
  const switchScope = useCallback((next: ScopeFilter) => {
    setScope(next)
    // 列表筛选改为"未选 project/agent 时查该 scope 全部"；
    // 当前上下文仅保留给手动新增抽屉作为默认值，不再强制塞进筛选条件。
    setScopeRef('')
    setScopeRefInput('')
  }, [])
  // workspaces → Select options（project scope 用）
  const workspaceOptions = useMemo(
    () => workspaces.map((w) => ({ label: w.name || w.id, value: w.id })),
    [workspaces],
  )
  // agents → Select options（agent scope 用，仅启用项）
  const agentOptions = useMemo(
    () => agents.filter((a) => a.enabled).map((a) => ({ label: a.name || a.id, value: a.id })),
    [agents],
  )
  const filteredEntries = useMemo(() => {
    // 归档视图只显示归档条目（后端 includeArchived 是包含语义，见 viewMode 注释）
    const base = viewMode === 'archived' ? entries.filter((e) => e.archived) : entries
    const q = searchText.trim().toLowerCase()
    if (q === '') return base
    return base.filter(
      (e) => e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q),
    )
  }, [entries, searchText, viewMode])
  const [detailId, setDetailId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // 多选 + 批量操作（审查诉求：批量移除/归档）
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const { invoke: deleteMemory } = useIpcInvoke('memory:delete')
  const { invoke: archiveMemory } = useIpcInvoke('memory:archive')
  // 【P1-⑥】恢复归档（主进程直连 repo，幂等：非归档条目重放也返回 complete）
  const { invoke: unarchiveMemory } = useIpcInvoke('memory:unarchive')
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  // 全选当前过滤后可见的条目（非全库，避免误删搜索外的）
  const visibleIds = useMemo(() => filteredEntries.map((e) => e.id), [filteredEntries])
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id))
  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allSelected) visibleIds.forEach((id) => next.delete(id))
      else visibleIds.forEach((id) => next.add(id))
      return next
    })
  }, [allSelected, visibleIds])
  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])
  // 切 scope/过滤维度时清空选择，避免跨批次误操作
  useEffect(() => {
    clearSelection()
  }, [scope, scopeRef, typeFilter, viewMode, clearSelection])
  const batchDelete = async () => {
    const ids = [...selectedIds]
    Modal.confirm({
      title: `批量删除 ${ids.length} 条记忆？`,
      okType: 'danger',
      content:
        '删除后不可恢复：将一并移除数据库记录、检索索引、markdown 文件与 MEMORY.md 索引。归档比删除安全，建议优先归档。',
      onOk: async () => {
        let ok = 0
        let blocked = 0
        for (const id of ids) {
          try {
            // S1B.4：status 处理 —— blocked_locally = 清理未完成（可重试），
            // 部分失败不得计入成功（S1A.4 状态如实化延续）
            const res = await deleteMemory({ id })
            if (res?.status === 'blocked_locally') blocked++
            else ok++
          } catch {
            /* 单条失败不阻断，继续删下一条 */
          }
        }
        if (ok === ids.length) message.success(`已删除 ${ok}/${ids.length} 条`)
        else if (ok + blocked === ids.length && blocked > 0) {
          message.warning(`已删除 ${ok} 条，${blocked} 条清理未完成（磁盘文件待重试，详见日志）`)
        } else {
          message.warning(`已删除 ${ok}/${ids.length} 条，${ids.length - ok} 条失败（详见日志）`)
        }
        clearSelection()
        void refreshFn()
      },
    })
  }
  // 【P0.4】批量归档对齐删除先例：Modal.confirm 二次确认（归档可恢复，文案弱于删除）
  const batchArchive = () => {
    const ids = [...selectedIds]
    Modal.confirm({
      title: `批量归档 ${ids.length} 条记忆？`,
      content: '归档后将从列表移除，可在已归档视图中恢复。',
      onOk: async () => {
        let ok = 0
        let blocked = 0
        for (const id of ids) {
          try {
            const res = await archiveMemory({ id })
            if (res?.status === 'blocked_locally') blocked++
            else ok++
          } catch {
            /* 单条失败不阻断 */
          }
        }
        if (blocked === 0) message.success(`已归档 ${ok}/${ids.length} 条`)
        else message.warning(`已归档 ${ok} 条，${blocked} 条清理未完成（详见日志）`)
        clearSelection()
        void refreshFn()
      },
    })
  }

  // 【P1-⑥】批量恢复（归档视图）：与 batchDelete 同构；unarchive 幂等（非归档重放也成功）
  const batchRestore = async () => {
    const ids = [...selectedIds].filter((id) => entries.find((e) => e.id === id)?.archived)
    if (ids.length === 0) return
    let ok = 0
    for (const id of ids) {
      try {
        const res = await unarchiveMemory({ id })
        if (res?.ok) ok++
      } catch {
        /* 单条失败不阻断 */
      }
    }
    if (ok === ids.length) message.success(`已恢复 ${ok}/${ids.length} 条`)
    else message.warning(`已恢复 ${ok}/${ids.length} 条（详见日志）`)
    clearSelection()
    void refreshFn()
  }

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const ref = scope === 'user' ? null : scopeRef.trim() || null
      const res = await listMemory({
        scope,
        scopeRef: ref,
        ...(typeFilter !== 'all' ? { type: typeFilter } : {}),
        // 归档视图：includeArchived（包含语义）+ includeInvalid（归档条目可能已失效），
        // 客户端再过滤只留 archived；含失效视图同旧行为
        ...(viewMode === 'archived' ? { includeArchived: true, includeInvalid: true } : {}),
        ...(viewMode === 'withInvalid' ? { includeInvalid: true } : {}),
      })
      setEntries(res?.entries ?? [])
    } catch (err) {
      message.error(`加载失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }, [listMemory, scope, scopeRef, typeFilter, viewMode])

  const refreshFn = useRefreshable(refresh)

  // 【P0.3】supersededBy 跳转：关闭详情抽屉露出列表 → 目标行短暂高亮 + 滚动居中；
  // 目标不在当前过滤列表时给提示态（不静默失败）
  const [jumpTargetId, setJumpTargetId] = useState<string | null>(null)
  useEffect(() => {
    if (jumpTargetId == null) return undefined
    const t = setTimeout(() => setJumpTargetId(null), 3000)
    return () => clearTimeout(t)
  }, [jumpTargetId])
  const jumpToMemory = useCallback(
    (targetId: string) => {
      if (!entries.some((e) => e.id === targetId)) {
        message.info('目标记忆不在当前列表（可能属于其他层级/类型或已归档），请调整筛选后查看')
        return
      }
      setDetailId(null)
      setJumpTargetId(targetId)
      // 行已在列表渲染，rAF 等 Drawer 关闭动效启动后滚动不影响目标存在性
      requestAnimationFrame(() => {
        document
          .getElementById(`mp-row-${targetId}`)
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      })
    },
    [entries],
  )

  // S2.3 候选确认区：推断行为规则晋级须真实用户确认（N12 —— 模型自称确认不可达）
  const { invoke: listCandidates } = useIpcInvoke('memory:candidate:list')
  const { invoke: confirmCandidate } = useIpcInvoke('memory:candidate:confirm')
  const { invoke: rejectCandidate } = useIpcInvoke('memory:candidate:reject')
  // 【审查改进】候选结构复用协议派生类型（与详情弹窗同源），消除手工复写的字段漂移风险
  const [candidates, setCandidates] = useState<MemoryCandidate[]>([])
  const [candidateBusy, setCandidateBusy] = useState<number | null>(null)
  const [candidateLoadError, setCandidateLoadError] = useState(false)
  const refreshCandidates = useCallback(async () => {
    try {
      const res = await listCandidates({})
      setCandidates(res?.candidates ?? [])
      setCandidateLoadError(false)
    } catch {
      // 【审查改进】失败不阻断主列表，但置错误态渲染可见提示（区分「无候选」与「加载失败」）
      setCandidateLoadError(true)
    }
  }, [listCandidates])
  const onConfirmCandidate = useCallback(
    async (id: number, contentDigest: string) => {
      setCandidateBusy(id)
      // 成功文案按候选动作分化（与确认按钮文案同口径）；列表与详情弹窗共用本回调
      const action = candidates.find((c) => c.id === id)?.payload?.action
      try {
        const res = await confirmCandidate({ id, contentDigest })
        if (res?.ok) {
          window.dispatchEvent(new CustomEvent(MEMORY_PENDING_CHANGED_EVENT))
          const successText =
            action === 'update'
              ? '已确认更新该记忆'
              : action === 'delete'
                ? '已确认移除该记忆'
                : action === 'merge'
                  ? '已确认合并记忆'
                  : '已确认并保存为正式记忆'
          message.success(successText)
        }
        else {
          const reasonText: Record<string, string> = {
            digest_mismatch: '内容已变化，请重新查看后确认',
            not_pending: '该候选已处理过',
            expired: '候选已过期',
            not_found: '候选不存在',
            payload_unreadable: '候选内容不可解析',
            sensitive_content: '内容含敏感信息（疑似密钥/凭证），已拒绝保存',
            // 【审查修复 F3】同名冲突：候选确认被拒的独立类别（含恢复路径）
            name_collision: '已存在同名记忆且内容不符，未保存候选内容（可改名或拒绝）',
            // 【审查修复】P2-A/P2-B 失败原因补齐：目标被并发修改可重试
            version_conflict: '目标记忆刚被其他修改，请重试确认',
            unsupported_action: '该候选动作暂不支持，请拒绝后等待重新征集',
            commit_failed: '保存失败（详见日志，候选已恢复待确认）',
          }
          message.warning(reasonText[res?.reason ?? ''] ?? '确认失败')
        }
      } catch {
        message.error('确认失败（IPC 异常）')
      } finally {
        setCandidateBusy(null)
      }
      void refreshCandidates()
      void refreshFn()
    },
    [confirmCandidate, refreshCandidates, refreshFn, candidates],
  )
  const onRejectCandidate = useCallback(
    async (id: number) => {
      setCandidateBusy(id)
      try {
        const res = await rejectCandidate({ id })
        if (res?.ok) {
          window.dispatchEvent(new CustomEvent(MEMORY_PENDING_CHANGED_EVENT))
          message.success('已忽略该提议')
        }
        else message.warning('该候选不在待确认状态')
      } catch {
        message.error('操作失败（IPC 异常）')
      } finally {
        setCandidateBusy(null)
      }
      void refreshCandidates()
    },
    [rejectCandidate, refreshCandidates],
  )
  // 候选详情弹层：点击候选行主体打开，审阅完整正文后再确认/忽略
  const [detailCandidateId, setDetailCandidateId] = useState<number | null>(null)
  const detailCandidate = useMemo(
    () => candidates.find((c) => c.id === detailCandidateId) ?? null,
    [candidates, detailCandidateId],
  )
  // 确认/忽略成功后（handler 内 dispatch MEMORY_PENDING_CHANGED_EVENT）立即关闭详情；
  // 刷新后候选从列表消失时 detailCandidate 变 null，弹层也会随之关闭（双保险）
  useEffect(() => {
    if (detailCandidateId == null) return undefined
    const close = () => setDetailCandidateId(null)
    window.addEventListener(MEMORY_PENDING_CHANGED_EVENT, close)
    return () => window.removeEventListener(MEMORY_PENDING_CHANGED_EVENT, close)
  }, [detailCandidateId])
  // scopeRef 输入 debounce 300ms，避免每字符触发请求
  const [scopeRefInput, setScopeRefInput] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setScopeRef(scopeRefInput), 300)
    return () => clearTimeout(t)
  }, [scopeRefInput])
  const createDefaultScopeRef = scopeRef || getContextScopeRef(scope)
  // 初始加载 + 任一过滤维度变化自动刷新（refresh 是 useCallback，依赖 scope/scopeRef/typeFilter/includeInvalid）
  useEffect(() => {
    void refresh()
  }, [refresh])
  // 候选区与主列表同刷（候选不随 scope 过滤 —— 是全局待确认队列）
  useEffect(() => {
    void refreshCandidates()
  }, [refreshCandidates])

  return (
    <div className="mp_root">
      <header className="mp_header">
        <div className="mp_title">
          <Icons.Brain size={18} />
          <span>长期记忆</span>
          <Tag size="middle">{entries.length}</Tag>
        </div>
        <div className="mp_actions">
          <Tooltip title="刷新">
            <Button icon={<Icons.History size={16} />} onClick={refreshFn} loading={loading}>
              刷新
            </Button>
          </Tooltip>
          <Button icon={<Icons.Sparkles size={16} />} onClick={() => setCreateOpen(true)}>
            新增
          </Button>
          <Button onClick={() => setSettingsOpen(true)}>配置</Button>
        </div>
      </header>

      <div className="mp_toolbar">
        <Segmented
          value={scope}
          onChange={(v) => switchScope(v as ScopeFilter)}
          options={[
            { label: 'User（跨项目）', value: 'user' },
            { label: 'Project', value: 'project' },
            { label: 'Agent', value: 'agent' },
          ]}
        />
        {scope === 'project' && (
          <LobeSelect
            value={scopeRefInput || undefined}
            onChange={(v) => setScopeRefInput((v as string) ?? '')}
            options={workspaceOptions}
            placeholder="选择项目（不选则全部）"
            style={{ width: 240 }}
            allowClear
            showSearch
          />
        )}
        {scope === 'agent' && (
          <LobeSelect
            value={scopeRefInput || undefined}
            onChange={(v) => setScopeRefInput((v as string) ?? '')}
            options={agentOptions}
            placeholder="选择 Agent（不选则全部）"
            style={{ width: 240 }}
            allowClear
            showSearch
          />
        )}
        <LobeSelect
          value={typeFilter}
          onChange={(v) => setTypeFilter((v as TypeFilter) ?? 'all')}
          options={TYPE_OPTIONS}
          style={{ width: 140 }}
          allowClear
        />
        <Segmented
          value={viewMode === 'archived' ? 'archived-only' : viewMode === 'withInvalid' ? 'with-invalid' : 'active-only'}
          onChange={(v) =>
            setViewMode(
              v === 'archived-only' ? 'archived' : v === 'with-invalid' ? 'withInvalid' : 'active',
            )
          }
          options={[
            { label: '仅有效', value: 'active-only' },
            { label: '含失效', value: 'with-invalid' },
            { label: '已归档', value: 'archived-only' },
          ]}
        />
        <LobeInput
          value={searchText}
          onChange={(e) => setSearchText((e.target as HTMLInputElement).value)}
          placeholder="搜索 name / description"
          // 弹性收缩：宽足够时撑到 240 占据右侧剩余空间，窄宽时优先收缩（min 120）
          // 而不是把整行挤换行；marginLeft:auto 兜底把它推到最右
          style={{ flex: '1 1 140px', minWidth: 120, maxWidth: 240, marginLeft: 'auto' }}
          allowClear
        />
      </div>

      {/* 【审查改进】加载失败可见：区分「没有候选」与「候选区加载失败」
          （仅空列表时显示，避免与正常列表叠噪；有候选时刷新失败沿用旧列表） */}
      {candidates.length === 0 && candidateLoadError && (
        <div className="mp_candidate_error">
          <span>候选区加载失败，可能有等待确认的提议</span>
          <a onClick={() => void refreshCandidates()}>重试</a>
        </div>
      )}

      {candidates.length > 0 && (
        <section className="mp_candidate_section">
          <div className="mp_candidate_header">
            <span className="mp_candidate_title">待确认提议</span>
            <span className="mp_candidate_hint">
              整合升华与冲突写入的待确认队列 · 确认后才会生效（{candidates.length} 条待处理）
            </span>
          </div>
          {candidates.map((c) => (
            <div className="mp_candidate_row" key={c.id}>
              <div className="mp_candidate_body" onClick={() => setDetailCandidateId(c.id)}>
                <div className="mp_candidate_name">
                  {c.payload?.name ?? '（内容不可解析）'}
                  <Tag size="middle">{c.scope}</Tag>
                  {c.payload != null && <Tag size="middle">{c.payload.type}</Tag>}
                  {/* 【P2-A】动作分化标签：冲突写入产生的 update/delete 候选醒目区分 */}
                  {c.payload?.action === 'update' && (
                    <Tag size="middle" color="orange">
                      更新提议
                    </Tag>
                  )}
                  {c.payload?.action === 'delete' && (
                    <Tag size="middle" color="red">
                      删除提议
                    </Tag>
                  )}
                  {/* 【审查改进】delete 候选目标正文读取失败标注（灰阶中性提示，区别于动作标签） */}
                  {c.payload?.action === 'delete' && c.payload.targetBodyUnavailable && (
                    <Tag size="middle">正文不可读</Tag>
                  )}
                  {c.payload?.action === 'merge' && (
                    <Tag size="middle" color="purple">
                      合并提议
                    </Tag>
                  )}
                </div>
                <div className="mp_candidate_desc">
                  {c.payload?.description ?? '该候选内容无法解析，建议忽略'}
                  {c.payload != null && c.payload.sourceIds.length > 0 && (
                    <span className="mp_candidate_sources">
                      {' '}
                      · 依据 {c.payload.sourceIds.length} 条既有记忆
                    </span>
                  )}
                </div>
              </div>
              <div className="mp_candidate_actions">
                <Button
                  size="middle"
                  type="primary"
                  danger={c.payload?.action === 'delete'}
                  disabled={c.payload == null}
                  loading={candidateBusy === c.id}
                  onClick={(ev) => {
                    ev.stopPropagation()
                    void onConfirmCandidate(c.id, c.contentDigest)
                  }}
                >
                  {c.payload?.action === 'update'
                    ? '确认更新'
                    : c.payload?.action === 'delete'
                      ? '确认删除'
                      : c.payload?.action === 'merge'
                        ? '确认合并'
                        : '确认保存'}
                </Button>
                <Button
                  size="middle"
                  loading={candidateBusy === c.id}
                  onClick={(ev) => {
                    ev.stopPropagation()
                    void onRejectCandidate(c.id)
                  }}
                >
                  忽略
                </Button>
              </div>
            </div>
          ))}
        </section>
      )}

      {selectedIds.size > 0 && (
        <div className="mp_batch_bar">
          <span>已选 {selectedIds.size} 条</span>
          {/* 归档视图：归档无意义改为批量恢复；删除对归档条目同样合法（清理场景） */}
          {viewMode === 'archived' ? (
            <Button size="middle" onClick={batchRestore}>
              批量恢复
            </Button>
          ) : (
            <Button size="middle" onClick={batchArchive}>
              批量归档
            </Button>
          )}
          <Button size="middle" danger onClick={batchDelete}>
            批量删除
          </Button>
          <Button size="middle" type="link" onClick={clearSelection}>
            取消选择
          </Button>
        </div>
      )}

      <div className="mp_list">
        {loading ? (
          <div className="mp_list_loading">
            <Spin />
          </div>
        ) : filteredEntries.length === 0 ? (
          <Empty
            description={
              viewMode === 'archived'
                ? searchText.trim()
                  ? '无匹配的归档记忆'
                  : '暂无归档记忆'
                : searchText.trim()
                  ? '无匹配记忆'
                  : '暂无记忆'
            }
          />
        ) : (
          <>
            <div className="mp_list_header">
              <Checkbox checked={allSelected} onChange={toggleSelectAll}>
                全选（当前 {visibleIds.length} 条）
              </Checkbox>
            </div>
            {filteredEntries.map((e) => (
              <MemoryRow
                key={e.id}
                entry={e}
                selected={selectedIds.has(e.id)}
                highlighted={jumpTargetId === e.id}
                onToggleSelect={() => toggleSelect(e.id)}
                onOpen={() => setDetailId(e.id)}
                onRestored={refreshFn}
              />
            ))}
          </>
        )}
      </div>

      <MemoryCandidateDetailModal
        candidate={detailCandidate}
        busy={detailCandidate != null && candidateBusy === detailCandidate.id}
        onConfirm={(id, contentDigest) => void onConfirmCandidate(id, contentDigest)}
        onReject={(id) => void onRejectCandidate(id)}
        onClose={() => setDetailCandidateId(null)}
      />
      <Drawer
        open={detailId != null}
        onClose={() => setDetailId(null)}
        title="记忆详情"
        width={560}
        destroyOnHidden
      >
        {detailId != null && (
          <MemoryDetail
            id={detailId}
            onArchivedOrDeleted={() => {
              setDetailId(null)
              void refreshFn()
            }}
            onSaved={refreshFn}
            onJumpToSuperseded={jumpToMemory}
          />
        )}
      </Drawer>
      <Drawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="手动新增记忆"
        width={520}
        destroyOnHidden
      >
        <MemoryCreate
          defaultScope={scope}
          defaultScopeRef={createDefaultScopeRef}
          onDone={() => {
            setCreateOpen(false)
            void refreshFn()
          }}
        />
      </Drawer>
      <Drawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="记忆系统配置"
        width={560}
        destroyOnHidden
      >
        <MemorySettings />
      </Drawer>
    </div>
  )
}

function typeColor(type: MemoryType): string {
  switch (type) {
    case 'feedback':
      return 'orange'
    case 'user':
      return 'blue'
    case 'project':
      return 'green'
    case 'reference':
      return 'default'
  }
}

function MemoryRow({
  entry: e,
  selected,
  highlighted,
  onToggleSelect,
  onOpen,
  onRestored,
}: {
  entry: MemoryEntry
  selected: boolean
  highlighted: boolean
  onToggleSelect: () => void
  onOpen: () => void
  /** 【P1-⑥】归档行恢复成功后通知父组件刷新列表 */
  onRestored: () => void
}) {
  const invalid = e.invalidAt != null
  // 【P1-⑥】行级恢复：仅归档条目显示；幂等（非归档重放也成功），失败静默降级到提示
  const { invoke: unarchiveMemory } = useIpcInvoke('memory:unarchive')
  const [restoring, setRestoring] = useState(false)
  const restore = async () => {
    setRestoring(true)
    try {
      const res = await unarchiveMemory({ id: e.id })
      if (res?.ok) {
        message.success('已恢复（回到有效视图可见）')
        onRestored()
      } else {
        message.warning(`恢复失败：${res?.error ?? res?.status ?? '未知原因'}`)
      }
    } catch (err) {
      message.error(`恢复失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRestoring(false)
    }
  }
  // 【P0.1】legacy 回退：旧数据无 authorRole，沿用 sourceSessionId==='consolidation' 识别整合
  const authorRole = e.authorRole ?? (e.sourceSessionId === 'consolidation' ? 'consolidation' : null)
  const evidenceState = memoryEvidenceState({
    archived: e.archived,
    invalidAt: e.invalidAt,
    // exactOptionalPropertyTypes：optional 属性直传会带 undefined，归一为 null
    evidenceStatus: e.evidenceStatus ?? null,
    authorRole,
  })
  const roleShort = authorRole != null ? (AUTHOR_ROLE_SHORT[authorRole] ?? authorRole) : null
  // scopeRef 截断显示（project/agent scope 列出全部时，让用户能区分各条属于哪个项目/agent）
  const refTail = e.scopeRef != null && e.scopeRef.length > 8 ? e.scopeRef.slice(-8) : e.scopeRef
  return (
    <div
      id={`mp-row-${e.id}`}
      className={`mp_row${invalid ? ' mp_row_invalid' : ''}${selected ? ' mp_row_selected' : ''}${
        highlighted ? ' mp_row_highlight' : ''
      }`}
    >
      <Checkbox
        checked={selected}
        onChange={onToggleSelect}
        onClick={(ev) => ev.stopPropagation()}
      />
      <div className="mp_row_main" onClick={onOpen}>
        <div className="mp_row_title">
          <span className="mp_row_name">{e.name}</span>
          <Tag size="middle" color={typeColor(e.type)}>
            {e.type}
          </Tag>
          {e.scopeRef != null && (
            <Tag size="middle" color="cyan">
              …{refTail}
            </Tag>
          )}
          {invalid && (
            <Tag size="middle" color="red">
              失效
            </Tag>
          )}
          {/* 【P0.1】证据状态 + 来源角色短标签：灰阶紧凑、原生 title 提示、过长截断；
              失效/归档已有专属标签，状态标签不重复显示（原紫色「整合」标签并入灰阶体系） */}
          {!invalid && !e.archived && (
            <Tag
              size="middle"
              className="mp_row_tag"
              title={`证据状态：${evidenceState}（来源角色：${authorRole ?? '未知'} · 证据：${
                e.evidenceStatus ?? '默认可用'
              }）`}
            >
              {evidenceState}
            </Tag>
          )}
          {roleShort != null && (
            <Tag size="middle" className="mp_row_tag" title={`来源角色：${authorRole}`}>
              {roleShort}
            </Tag>
          )}
          {e.archived && <Tag size="middle">归档</Tag>}
        </div>
        <div className="mp_row_desc">{e.description}</div>
      </div>
      <div className="mp_row_meta">
        {/* <span>命中 {e.hitCount}</span> */}
        <span>{new Date(e.updatedAt).toLocaleDateString()}</span>
        {e.archived && (
          <Button
            size="small"
            loading={restoring}
            onClick={(ev) => {
              ev.stopPropagation()
              void restore()
            }}
          >
            恢复
          </Button>
        )}
      </div>
    </div>
  )
}

function MemoryDetail({
  id,
  onSaved,
  onArchivedOrDeleted,
  onJumpToSuperseded,
}: {
  id: string
  onSaved: () => void
  onArchivedOrDeleted: () => void
  onJumpToSuperseded: (targetId: string) => void
}) {
  const { invoke: getMemory } = useIpcInvoke('memory:get')
  const { invoke: updateMemory } = useIpcInvoke('memory:update')
  const { invoke: archiveMemory } = useIpcInvoke('memory:archive')
  const { invoke: deleteMemory } = useIpcInvoke('memory:delete')
  // 【P1-⑤】撤回作废：停止作为当前事实但保留历史，是删除之外的安全一档
  const { invoke: retractMemory } = useIpcInvoke('memory:retract')
  const [entry, setEntry] = useState<MemoryEntry | null>(null)
  const [body, setBody] = useState('')
  const [desc, setDesc] = useState('')
  const [saving, setSaving] = useState(false)

  // 【审查修复 C5】加载错误不再永久转圈：IPC 异常时给出错误态 + 关闭引导
  //（条目可能刚被批量删除/同步清理，getMemory 抛错时 entry 恒 null）
  const [loadError, setLoadError] = useState<string | null>(null)
  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await getMemory({ id })
      setEntry(res?.entry ?? null)
      setBody(res?.body ?? '')
      setDesc(res?.entry?.description ?? '')
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    }
  }, [getMemory, id])
  useEffect(() => {
    void load()
  }, [load])

  if (entry == null)
    return (
      <div className="mp_list_loading">
        {loadError != null ? (
          <>
            <div>详情加载失败：{loadError}</div>
            <div style={{ marginTop: 8, opacity: 0.7 }}>该记忆可能已被删除或网络异常，请关闭后重试。</div>
          </>
        ) : (
          <Spin />
        )}
      </div>
    )

  // 【P0.2】来源可读化：会话 ID 截前 8 位；整合/手工保留语义标签（title 提供完整原始值）
  const sourceLabel =
    entry.sourceSessionId == null
      ? '手工/对话'
      : entry.sourceSessionId === 'consolidation'
        ? '整合生成'
        : `会话 ${entry.sourceSessionId.slice(0, 8)}…`
  // 【P0.3】提局部 const：supersededBy 的 TS 窄化在闭包内保留（属性访问不保留）
  const supersededBy = entry.supersededBy

  const save = async () => {
    setSaving(true)
    try {
      const patch: { description?: string; body?: string } = {}
      if (desc !== entry.description) patch.description = desc
      // body 与当前磁盘版本对比（同时取当前 version 作 CAS 期望值——
      // 保存期间被其他修改推进则后端返回冲突，本地提示刷新，不静默覆盖）
      const cur = await getMemory({ id })
      if (body !== (cur.body ?? '')) patch.body = body
      if (Object.keys(patch).length === 0) {
        message.info('无变更')
        return
      }
      await updateMemory({
        id,
        ...patch,
        ...(cur.entry?.version != null ? { expectedVersion: cur.entry.version } : {}),
      })
      message.success('已保存')
      await load()
      onSaved()
    } catch (err) {
      message.error(`保存失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mp_detail">
      {entry.invalidAt != null && (
        <div className="mp_warn">
          此记忆已于 {new Date(entry.invalidAt).toLocaleString()} 失效
          {supersededBy != null ? (
            <>
              ，已被{' '}
              <span
                className="mp_jump_link"
                title={`跳转到取代它的记忆（${supersededBy}）`}
                onClick={() => onJumpToSuperseded(supersededBy)}
              >
                {supersededBy.slice(0, 8)}…
              </span>{' '}
              取代
            </>
          ) : null}
          。仅作历史参考。
        </div>
      )}
      <div className="mp_field">
        <label>描述</label>
        <LobeInput value={desc} onChange={(e) => setDesc((e.target as HTMLInputElement).value)} />
      </div>
      <div className="mp_field">
        <label>正文（markdown）</label>
        <TextArea
          value={body}
          onChange={(e) => setBody((e.target as HTMLTextAreaElement).value)}
          rows={14}
        />
      </div>
      <div className="mp_meta_grid">
        <span>ID: {entry.id}</span>
        <span>
          scope: {entry.scope}/{entry.scopeRef ?? '∅'}
        </span>
        <span>类型: {entry.type}</span>
        <span>状态: {memoryEvidenceState(entry)}</span>
        <span>legacy 置信: {entry.confidence}（仅参考）</span>
        {entry.validUntil != null && (
          <span>
            {/* 【审查修复 C6】valid_until 是半开区间右端（date 精度 = 次日 00:00）——
                直接展示右端会让人误读成"多出一天"。按日精度展示"最后适用日"
                （右端 -1ms 的本地日期），与后端 describeValidUntil 口径一致 */}
            最后适用日:{' '}
            {isDatePrecision(entry.validUntilMeta)
              ? new Date(entry.validUntil - 1).toLocaleDateString()
              : new Date(entry.validUntil).toLocaleString()}
            {isDatePrecision(entry.validUntilMeta) ? '（该日内仍适用）' : '（精确时间点）'}
          </span>
        )}
        <span>命中: {entry.hitCount}</span>
        <span title={entry.sourceSessionId ?? undefined}>来源: {sourceLabel}</span>
        {/* 【P2-D】抽取方式/模型明细（migration 107 归因；手动/整合写入为 null 不显示） */}
        {(entry.extractionKind != null || entry.extractionModel != null) && (
          <span>
            抽取: {entry.extractionKind ?? '—'}
            {entry.extractionModel != null ? ` · ${entry.extractionModel}` : ''}
          </span>
        )}
        <span>创建: {new Date(entry.createdAt).toLocaleString()}</span>
        <span>更新: {new Date(entry.updatedAt).toLocaleString()}</span>
      </div>
      {/* 【P1-④】历史版本区：懒加载（点击才拉 memory:history），不增加详情打开成本 */}
      <MemoryHistorySection id={id} onJumpToMemory={onJumpToSuperseded} />
      <div className="mp_detail_actions">
        <Button type="primary" onClick={save} loading={saving}>
          保存
        </Button>
        {/* 【P0.4】归档也走二次确认（对齐删除先例）；归档可恢复，文案弱于删除的 danger 措辞 */}
        <Button
          onClick={() =>
            Modal.confirm({
              title: '归档该记忆？',
              content: '归档后将从列表移除，可在已归档视图中恢复。',
              onOk: async () => {
                try {
                  // S1B.4：返回 status（complete/blocked_locally/not_found）
                  const res = await archiveMemory({ id })
                  if (res?.status === 'blocked_locally') {
                    message.warning('已归档，但部分清理未完成（磁盘文件或索引待重试，详见日志）')
                  } else {
                    message.success('已归档')
                  }
                  onArchivedOrDeleted()
                } catch (err) {
                  message.error(`归档失败：${err instanceof Error ? err.message : String(err)}`)
                }
              },
            })
          }
        >
          归档
        </Button>
        {/* 【P1-⑤】撤回作废：仅当前有效条目可撤回（已失效/已归档无此动作）。
            撤回后 invalidAt 置位、不再参与检索，历史版本保留可查 —— 文案明确弱于删除 */}
        {entry.invalidAt == null && !entry.archived && (
          <Button
            onClick={() =>
              Modal.confirm({
                title: '撤回该记忆？',
                content:
                  '撤回后停止作为当前事实（不再参与检索），但内容与历史版本保留，可在「含失效」视图中查看。比删除安全。',
                onOk: async () => {
                  try {
                    const res = await retractMemory({ id })
                    if (res?.ok) {
                      message.success('已撤回（可在「含失效」视图中查看）')
                      await load()
                      onSaved()
                    } else {
                      message.warning(`撤回失败：${res?.error ?? res?.status ?? '未知原因'}`)
                    }
                  } catch (err) {
                    message.error(`撤回失败：${err instanceof Error ? err.message : String(err)}`)
                  }
                },
              })
            }
          >
            撤回
          </Button>
        )}
        <Button
          danger
          onClick={() =>
            Modal.confirm({
              title: '永久删除该记忆？',
              okType: 'danger',
              content:
                '删除后不可恢复：将一并移除数据库记录、检索索引、markdown 文件与 MEMORY.md 索引。归档比删除安全，建议优先归档。',
              onOk: async () => {
                try {
                  const res = await deleteMemory({ id })
                  if (res?.status === 'blocked_locally') {
                    message.warning(
                      '已删除，但磁盘文件清理未完成（下次启动或重试时继续，详见日志）',
                    )
                  } else {
                    message.success('已删除')
                  }
                  onArchivedOrDeleted()
                } catch (err) {
                  message.error(`删除失败：${err instanceof Error ? err.message : String(err)}`)
                }
              },
            })
          }
        >
          删除
        </Button>
      </div>
    </div>
  )
}

/** 【P1-④】supersedeKind → 中文短标签（历史版本链的动作标注） */
const SUPERSEDE_KIND_LABEL: Record<string, string> = {
  update: '更新',
  merge: '合并',
  supersede: '替代',
  retract: '撤回',
}

/** 单条历史版本：v{N} + 动作标签 + 时间 + name，点击展开 description/body/note */
function MemoryRevisionItemRow({
  rev,
  expanded,
  onToggle,
  onJumpToMemory,
}: {
  rev: NonNullable<MemoryHistoryResponse['revisions']>[number]
  expanded: boolean
  onToggle: () => void
  onJumpToMemory: (targetId: string) => void
}) {
  // 提局部 const：successorId 的 TS 窄化在 JSX 闭包内不保留（属性访问不保留），
  // 与详情 supersededBy 跳转（P0.3）同款处理
  const successorId = rev.successorId
  return (
    <div className={`mp_history_item${expanded ? ' mp_history_item_open' : ''}`}>
      <div className="mp_history_item_head" onClick={onToggle}>
        <span className="mp_history_version">v{rev.version}</span>
        <Tag size="middle" className="mp_row_tag">
          {SUPERSEDE_KIND_LABEL[rev.supersedeKind] ?? rev.supersedeKind}
        </Tag>
        <span className="mp_history_name" title={rev.description}>
          {rev.name}
        </span>
        <span className="mp_history_time">{new Date(rev.supersededAt).toLocaleString()}</span>
      </div>
      {expanded && (
        <div className="mp_history_body">
          {rev.description !== '' && <div className="mp_history_desc">{rev.description}</div>}
          {rev.body !== '' && (
            <div className="mp_history_text" title={rev.body}>
              {rev.body}
            </div>
          )}
          {rev.note != null && rev.note !== '' && (
            <div className="mp_history_note">备注：{rev.note}</div>
          )}
          {successorId != null && (
            <div className="mp_history_note">
              后继：
              <span
                className="mp_jump_link"
                title={`跳转到取代它的记忆（${successorId}）`}
                onClick={() => onJumpToMemory(successorId)}
              >
                {successorId.slice(0, 8)}…
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 【P1-④】历史版本区（memory:history）：版本链（旧 → 新，不含当前版）+ 派生关系 +
 * coverage 说明（migration 108 之前的历史不存在，如实展示不补造）。懒加载：首次点击才拉取。
 */
function MemoryHistorySection({
  id,
  onJumpToMemory,
}: {
  id: string
  onJumpToMemory: (targetId: string) => void
}) {
  const { invoke: getHistory } = useIpcInvoke('memory:history')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [data, setData] = useState<MemoryHistoryResponse | null>(null)
  const [expandedVersion, setExpandedVersion] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await getHistory({ id })
      if (res?.ok) setData(res)
      else setLoadError(res?.error ?? '加载失败')
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [getHistory, id])

  const toggleOpen = () => {
    const next = !open
    setOpen(next)
    // 首次展开才拉取；再次展开复用已加载数据（详情抽屉内操作后重新打开会重挂载）
    if (next && data == null && loadError == null) void load()
  }

  if (!open) {
    return (
      <div className="mp_history_section">
        <Button size="small" onClick={toggleOpen}>
          查看历史版本
          {data?.entry != null ? `（当前 v${data.entry.currentVersion}）` : ''}
        </Button>
      </div>
    )
  }

  const revisions = data?.revisions ?? []
  // 展示顺序：新 → 旧（最近的变更在最上，与"更新于"直觉一致）
  const ordered = [...revisions].reverse()
  const derivFrom = data?.derivationsFrom ?? []
  const derivOf = data?.derivationsOf ?? []

  return (
    <div className="mp_history_section mp_history_open">
      <div className="mp_history_header">
        <span className="mp_history_title">
          历史版本{data?.entry != null ? `（当前 v${data.entry.currentVersion}）` : ''}
        </span>
        <Button size="small" type="link" onClick={toggleOpen}>
          收起
        </Button>
      </div>
      {loading ? (
        <div className="mp_list_loading">
          <Spin />
        </div>
      ) : loadError != null ? (
        <div className="mp_history_coverage">
          历史加载失败：{loadError}
          <Button size="small" type="link" onClick={() => void load()}>
            重试
          </Button>
        </div>
      ) : (
        <>
          {ordered.length === 0 ? (
            <div className="mp_history_coverage">
              暂无历史版本（{data?.coverage?.complete === false ? '此条目的变更记录早于历史功能上线，早期轨迹不可追溯' : '尚未发生过修改'}）
            </div>
          ) : (
            <div className="mp_history_list">
              {ordered.map((rev) => (
                <MemoryRevisionItemRow
                  key={rev.version}
                  rev={rev}
                  expanded={expandedVersion === rev.version}
                  onToggle={() =>
                    setExpandedVersion((cur) => (cur === rev.version ? null : rev.version))
                  }
                  onJumpToMemory={onJumpToMemory}
                />
              ))}
            </div>
          )}
          {derivFrom.length > 0 && (
            <div className="mp_history_deriv">
              派生出 {derivFrom.length} 条下游记忆（撤回来源时的待复核范围）
            </div>
          )}
          {derivOf.length > 0 && (
            <div className="mp_history_deriv">
              由 {derivOf.length} 条既有记忆派生而来
              {derivOf.length <= 3 && (
                <span className="mp_history_deriv_ids">
                  {' '}
                  （{derivOf.map((d) => `${d.sourceId.slice(0, 8)}…`).join('、')}）
                </span>
              )}
            </div>
          )}
          {data?.coverage != null && data.coverage.complete === false && (
            <div className="mp_history_coverage">{data.coverage.note}</div>
          )}
        </>
      )}
    </div>
  )
}

function MemoryCreate({
  defaultScope,
  defaultScopeRef,
  onDone,
}: {
  defaultScope: ScopeFilter
  defaultScopeRef: string
  onDone: () => void
}) {
  const { invoke: createMemory } = useIpcInvoke('memory:create')
  const [cScope, setCScope] = useState<MemoryScope>(defaultScope)
  const [cScopeRef, setCScopeRef] = useState(defaultScopeRef)
  const [type, setType] = useState<MemoryType>('feedback')
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [body, setBody] = useState('')
  const [entities, setEntities] = useState('')
  // 【S2.6 / N5】有效期（可选，date 精度按本机时区；到期不再作为当前事实）
  const [validUntil, setValidUntil] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!name.trim() || !desc.trim()) {
      message.warning('name 与 description 必填')
      return
    }
    setSaving(true)
    try {
      const ents = entities
        .split(/[,，\n]/)
        .map((s) => s.trim())
        .filter(Boolean)
      await createMemory({
        scope: cScope,
        scopeRef: cScope === 'user' ? null : cScopeRef.trim() || null,
        type,
        name: name.trim(),
        description: desc.trim(),
        body,
        ...(ents.length > 0 ? { entities: ents } : {}),
        ...(validUntil.trim() !== ''
          ? { validUntil: validUntil.trim(), validUntilPrecision: 'date' as const }
          : {}),
      })
      message.success('已新增')
      onDone()
    } catch (err) {
      message.error(`新增失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mp_create">
      <div className="mp_field">
        <label>层级 scope</label>
        <Segmented
          value={cScope}
          onChange={(v) => setCScope(v as MemoryScope)}
          options={[
            { label: 'User', value: 'user' },
            { label: 'Project', value: 'project' },
            { label: 'Agent', value: 'agent' },
          ]}
        />
      </div>
      {cScope !== 'user' && (
        <div className="mp_field">
          <label>{cScope === 'project' ? 'workspaceId' : 'agentId'}</label>
          <LobeInput
            value={cScopeRef}
            onChange={(e) => setCScopeRef((e.target as HTMLInputElement).value)}
          />
        </div>
      )}
      <div className="mp_field">
        <label>type</label>
        <Segmented
          value={type}
          onChange={(v) => setType(v as MemoryType)}
          options={[
            { label: 'User', value: 'user' },
            { label: 'Feedback', value: 'feedback' },
            { label: 'Project', value: 'project' },
            { label: 'Reference', value: 'reference' },
          ]}
        />
      </div>
      <div className="mp_field">
        <label>name（kebab-case，scope 内唯一）</label>
        <LobeInput
          value={name}
          onChange={(e) => setName((e.target as HTMLInputElement).value)}
          placeholder="如 prefer-arco-over-radix"
        />
      </div>
      <div className="mp_field">
        <label>description（≤80 字）</label>
        <LobeInput value={desc} onChange={(e) => setDesc((e.target as HTMLInputElement).value)} />
      </div>
      <div className="mp_field">
        <label>正文 body（markdown，feedback/project 建议含 Why / How to apply）</label>
        <TextArea
          value={body}
          onChange={(e) => setBody((e.target as HTMLTextAreaElement).value)}
          rows={6}
        />
      </div>
      <div className="mp_field">
        <label>有效期至（可选，YYYY-MM-DD：该日内仍适用，之后仅作历史参考）</label>
        <LobeInput
          value={validUntil}
          onChange={(e) => setValidUntil((e.target as HTMLInputElement).value)}
          placeholder="如 2026-10-31（留空 = 长期）"
        />
      </div>
      <div className="mp_field">
        <label>实体（逗号分隔，可选）</label>
        <LobeInput
          value={entities}
          onChange={(e) => setEntities((e.target as HTMLInputElement).value)}
          placeholder="如 Arco Design, vite, React"
        />
      </div>
      <Button type="primary" onClick={submit} loading={saving}>
        创建
      </Button>
    </div>
  )
}

function MemorySettings() {
  const { invoke: settingsSet } = useIpcInvoke('settings:set')
  const { invoke: settingsGetCategory } = useIpcInvoke('settings:get-category')
  const { invoke: listProviders } = useIpcInvoke('provider:list')
  const { invoke: rebuildVectors } = useIpcInvoke('memory:rebuild-vectors')
  const { invoke: testExtraction } = useIpcInvoke('memory:test-extraction')
  const [cfg, setCfg] = useState<Record<string, unknown>>({})
  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [rebuilding, setRebuilding] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    void settingsGetCategory({ category: 'memory' }).then((r) => setCfg(r?.settings ?? {}))
    void listProviders({})
      .then((r) => setProviders(r?.profiles ?? []))
      .catch(() => {})
  }, [settingsGetCategory, listProviders])

  const getStr = (k: string) => (typeof cfg[k] === 'string' ? (cfg[k] as string) : '')
  const getNum = (k: string) => (typeof cfg[k] === 'number' ? String(cfg[k]) : '')
  const getBool = (k: string, dflt: boolean) =>
    typeof cfg[k] === 'boolean' ? (cfg[k] as boolean) : dflt
  const set = (k: string, v: unknown) => {
    // 空字符串 / null / undefined 统一视为"未设置"：本地状态移除该 key，
    // IPC 发送 value=null 触发后端 repo.delete()。这样 Provider 下拉清除、
    // 模型名输入框清空、数字框清空都能回到"未配置"语义（触发 agent 对话模型回退 / 默认值）。
    const isBlank = v === '' || v === null || v === undefined
    setCfg((c) => {
      const next = { ...c }
      if (isBlank) delete next[k]
      else next[k] = v
      return next
    })
    void settingsSet({ category: 'memory', key: k, value: isBlank ? null : v })
  }
  // 抽取支持 anthropic 原生 + OpenAI 兼容；embedding 仅 OpenAI 兼容。
  // provider_type 不在 IPC DTO 上，按 provider 字符串识别 anthropic。
  const isAnthropicProvider = (p: ProviderProfile): boolean =>
    p.provider.toLowerCase() === 'anthropic'
  const isOpenAICompatibleProvider = (p: ProviderProfile): boolean =>
    p.provider.toLowerCase() !== 'anthropic'
  // 抽取 provider 过滤（保持原逻辑不动）：排除 responses API（不支持 /chat/completions）+
  // 纯多媒体（image/voice/video 无 chat 能力）。embedding 专用 provider 也排除（不做 chat）。
  const isResponsesApiProvider = (p: ProviderProfile): boolean =>
    (p as ProviderProfile & { codexApiKind?: string }).codexApiKind === 'responses'
  const isEmbeddingOnlyProvider = (p: ProviderProfile): boolean =>
    (p as ProviderProfile & { codexApiKind?: string }).codexApiKind === 'embedding'
  const isMultimediaProvider = (p: ProviderProfile): boolean => {
    const t = (p as ProviderProfile & { modelType?: string }).modelType
    return t === 'image' || t === 'voice' || t === 'video'
  }
  const extractionProviderOptions = useMemo(
    () =>
      providers
        .filter(
          (p) =>
            !isResponsesApiProvider(p) && !isEmbeddingOnlyProvider(p) && !isMultimediaProvider(p),
        )
        .map((p) => ({
          label: `${p.name}（${p.provider}${isAnthropicProvider(p) ? ' · 原生 /v1/messages' : ' · OpenAI兼容'}）`,
          value: p.id,
        })),
    [providers],
  )
  // 向量 provider 必须显式声明 codexApiKind='embedding'（用户在 provider 编辑页选 Embeddings）。
  // 这样筛选准确：只有专门配的 embedding provider 出现，code1 那种"看着 chat 实际不支持 /v1/embeddings"
  // 的 provider 不会漏进来。anthropic 无 embedding 模型，天然排除。
  const isEmbeddingProvider = (p: ProviderProfile): boolean =>
    (p as ProviderProfile & { codexApiKind?: string }).codexApiKind === 'embedding'
  const embeddingProviderOptions = useMemo(
    () =>
      providers
        .filter((p) => isOpenAICompatibleProvider(p) && isEmbeddingProvider(p))
        .map((p) => ({ label: `${p.name}（${p.provider} · Embeddings）`, value: p.id })),
    [providers],
  )
  // 选中 provider 的可用模型（从 provider:list 返回的 modelIds 生成）
  // 选 provider 后模型字段从 Input 升级为 Select；modelIds 为空时 fallback Input 兜底。
  const modelOptionsFor = (providerId: string): Array<{ label: string; value: string }> => {
    const p = providers.find((x) => x.id === providerId)
    if (p == null) return []
    return (p.modelIds ?? []).map((m) => ({ label: m, value: m }))
  }
  const extractionModelOptions = useMemo(
    () => modelOptionsFor(getStr('extractionProviderId')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [providers, cfg.extractionProviderId],
  )
  const embeddingModelOptions = useMemo(
    () => modelOptionsFor(getStr('embeddingProviderId')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [providers, cfg.embeddingProviderId],
  )
  // 选 provider 时，若当前 model 不在新 provider 的 modelIds 里，清空 model（防跨 provider 串味）
  const pickProvider = (
    key: 'extractionProviderId' | 'embeddingProviderId',
    providerId: string,
  ) => {
    const modelKey = key === 'extractionProviderId' ? 'extractionModel' : 'embeddingModel'
    const modelIds = providers.find((p) => p.id === providerId)?.modelIds ?? []
    const curModel = getStr(modelKey)
    set(key, providerId)
    if (curModel.length > 0 && !modelIds.includes(curModel)) {
      set(modelKey, null) // 当前 model 不属于新 provider，清空让用户重选
    }
  }

  return (
    <div className="mp_settings">
      <section className="mp_settings_section">
        <h4>总开关</h4>
        <div className="mp_settings_row">
          <span>启用长期记忆（关闭后注入/写入/整合全停）</span>
          <Switch checked={getBool('enabled', true)} onChange={(v) => set('enabled', v)} />
        </div>
      </section>
      <section className="mp_settings_section">
        <h4>
          抽取模型
          <span className="mp_section_hint">
            （写入必需；支持 anthropic 原生 + OpenAI 兼容 /chat，不支持 responses API）
          </span>
        </h4>
        <div className="mp_field">
          <label>Provider（可清除，清除后回退到对话模型）</label>
          <LobeSelect
            value={getStr('extractionProviderId') || undefined}
            onChange={(v) => pickProvider('extractionProviderId', (v as string) ?? '')}
            options={extractionProviderOptions}
            placeholder="选择抽取 provider（anthropic 或 OpenAI 兼容）"
            allowClear
            showSearch
          />
        </div>
        <div className="mp_field">
          <label>
            模型名
            {extractionModelOptions.length > 0
              ? '（从该 provider 可用模型选）'
              : '（该 provider 未预拉模型列表，手动填写）'}
          </label>
          {extractionModelOptions.length > 0 ? (
            <LobeSelect
              value={getStr('extractionModel') || undefined}
              onChange={(v) => set('extractionModel', (v as string) ?? '')}
              options={extractionModelOptions}
              placeholder="选择抽取模型"
              allowClear
              showSearch
            />
          ) : (
            <LobeInput
              value={getStr('extractionModel')}
              onChange={(e) => set('extractionModel', (e.target as HTMLInputElement).value)}
              placeholder="留空则回退到对话模型"
            />
          )}
        </div>
        <div className="mp_settings_hint_inline">
          未配置时自动回退到当前会话 / @mention agent 的对话模型（团队主持 agent 用会话默认模型）。
        </div>
        <Button
          loading={testing}
          onClick={async () => {
            setTesting(true)
            try {
              const r = await testExtraction({})
              if (r?.ok) {
                const via =
                  r.source === 'fallback'
                    ? '（回退到对话模型，settings 未配）'
                    : `（settings 显式配置：${r.model ?? '?'}）`
                message.success(
                  `抽取配置可用${via}${r.sample != null ? `，返回：${r.sample.slice(0, 50)}` : ''}`,
                )
              } else {
                message.warning(
                  `抽取配置不可用：${r?.reason ?? '未知'}${r?.source === 'none' ? '（settings 未配且无对话模型回退上下文；会话中实际使用时会回退）' : ''}`,
                )
              }
            } catch (err) {
              message.error(`测试失败：${err instanceof Error ? err.message : String(err)}`)
            } finally {
              setTesting(false)
            }
          }}
        >
          测试抽取配置
        </Button>
      </section>
      <section className="mp_settings_section">
        <h4>
          向量模型
          <span className="mp_section_hint">
            （可选，不配则 FTS-only；仅 OpenAI 兼容 /chat 风格，不支持 anthropic 与 responses API）
          </span>
        </h4>
        <div className="mp_field">
          <label>Provider（可清除）</label>
          <LobeSelect
            value={getStr('embeddingProviderId') || undefined}
            onChange={(v) => pickProvider('embeddingProviderId', (v as string) ?? '')}
            options={embeddingProviderOptions}
            placeholder="选择 embedding provider"
            allowClear
            showSearch
          />
        </div>
        <div className="mp_field">
          <label>
            模型名
            {embeddingModelOptions.length > 0
              ? '（从该 provider 可用模型选）'
              : '（该 provider 未预拉模型列表，手动填写，如 text-embedding-3-small）'}
          </label>
          {embeddingModelOptions.length > 0 ? (
            <LobeSelect
              value={getStr('embeddingModel') || undefined}
              onChange={(v) => set('embeddingModel', (v as string) ?? '')}
              options={embeddingModelOptions}
              placeholder="选择 embedding 模型"
              allowClear
              showSearch
            />
          ) : (
            <LobeInput
              value={getStr('embeddingModel')}
              onChange={(e) => set('embeddingModel', (e.target as HTMLInputElement).value)}
              placeholder="留空则 FTS-only"
            />
          )}
        </div>
        <Button
          loading={rebuilding}
          onClick={async () => {
            setRebuilding(true)
            try {
              const r = await rebuildVectors({})
              if (r?.ok)
                message.success(
                  '向量表已重建，后台正按新模型回填全部记忆（条目多时可能持续几分钟，期间向量检索会逐步恢复）。',
                )
              else message.warning(`未重建：${r?.reason ?? '未知'}`)
            } catch (err) {
              message.error(`重建失败：${err instanceof Error ? err.message : String(err)}`)
            } finally {
              setRebuilding(false)
            }
          }}
        >
          重建向量索引
        </Button>
      </section>
      <section className="mp_settings_section">
        <h4>整合 job</h4>
        <div className="mp_settings_row">
          <span>启用整合</span>
          <Switch
            checked={getBool('consolidationEnabled', true)}
            onChange={(v) => set('consolidationEnabled', v)}
          />
        </div>
        {/* 【P2-B】合并需确认：开启后整合 MERGE 不直接落库，先进候选区等用户确认
            （与 ELEVATE 晋级同路径；默认关闭 = 保持全自动合并的现行为） */}
        <div className="mp_settings_row">
          <span>合并需确认（MERGE 转候选）</span>
          <Switch
            checked={getBool('consolidationMergeRequiresConfirm', false)}
            onChange={(v) => set('consolidationMergeRequiresConfirm', v)}
          />
        </div>
        <div className="mp_field">
          <label>触发阈值（条数，默认 30；真机测试可设 2；留空用默认）</label>
          <LobeInput
            value={getNum('consolidationThreshold')}
            onChange={(e) => {
              const raw = (e.target as HTMLInputElement).value
              if (raw === '') {
                set('consolidationThreshold', null)
                return
              }
              const n = Number(raw)
              if (Number.isFinite(n)) set('consolidationThreshold', n)
            }}
            placeholder="留空用默认 30"
          />
        </div>
        <div className="mp_field">
          <label>触发间隔（天，默认 7；真机测试可设 0.01；留空用默认）</label>
          <LobeInput
            value={getNum('consolidationIntervalDays')}
            onChange={(e) => {
              const raw = (e.target as HTMLInputElement).value
              if (raw === '') {
                set('consolidationIntervalDays', null)
                return
              }
              const n = Number(raw)
              if (Number.isFinite(n)) set('consolidationIntervalDays', n)
            }}
            placeholder="留空用默认 7"
          />
        </div>
      </section>
      <section className="mp_settings_section">
        <h4>检索调参（高级）</h4>
        <div className="mp_field">
          <label>会话注入 token 上限（默认 4000；留空用默认）</label>
          <LobeInput
            value={getNum('maxInjectTokens')}
            onChange={(e) => {
              const raw = (e.target as HTMLInputElement).value
              if (raw === '') {
                set('maxInjectTokens', null)
                return
              }
              const n = Number(raw)
              if (Number.isFinite(n)) set('maxInjectTokens', n)
            }}
            placeholder="留空用默认 4000"
          />
        </div>
        <div className="mp_field">
          <label>时间衰减 λ（默认 0.01；越大旧记忆沉降越快；留空用默认）</label>
          <LobeInput
            value={getNum('timeDecayLambda')}
            onChange={(e) => {
              const raw = (e.target as HTMLInputElement).value
              if (raw === '') {
                set('timeDecayLambda', null)
                return
              }
              const n = Number(raw)
              if (Number.isFinite(n)) set('timeDecayLambda', n)
            }}
            placeholder="留空用默认 0.01"
          />
        </div>
      </section>
      <div className="mp_settings_hint">
        配置改完<b>下一个新会话生效</b>。抽取（extract）支持 <b>OpenAI 兼容 provider</b>
        （deepseek/openrouter/openai/自部署 vLLM）和 <b>anthropic 原生</b>
        （claude，provider_type=anthropic）；<b>未配置时自动回退</b>到当前会话 / @mention agent
        的对话模型（团队主持 agent 用会话默认）。向量（embedding）仅支持 OpenAI 兼容（anthropic
        本身不提供 embedding 模型）；不配向量则自动 FTS-only。
      </div>
    </div>
  )
}
