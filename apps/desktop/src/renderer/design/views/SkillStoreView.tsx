/**
 * SkillStoreView — Skill 商店页面
 *
 * Tab 切换：商店（Store）+ 已安装（Installed）
 * 商店 Tab：市场源选择器 + 搜索栏 + 分类导航 + Skill 卡片网格
 * 已安装 Tab：沿用 SkillsView 的卡片布局，增强操作按钮
 * Skill 详情面板：右侧滑出
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import type { LocalSkillCandidate, RemoteSkillItem, SkillItem, SkillRegistry } from '@spark/protocol'
import { Icons } from '../Icons'
import { SparkInput } from '../components/FormControls'
import {
  useSkills,
  parseSkillManifest,
  filterSkills,
  filterCandidates,
  getCandidateSources,
  deduplicateSkills,
  deduplicateRemoteSkills,
  deduplicateCandidates,
  SKILL_PAGE_SIZE,
  paginate,
} from '../utils/skills-data'
import { useIpcInvoke } from '../hooks/useIpc'
import { useToast } from '../components/Toast'

// ─── Debounce hook ────────────────────────────────────────────────────
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debouncedValue
}

// ─── Format helpers ───────────────────────────────────────────────────
function formatCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function renderStars(rating: number): string {
  const full = Math.floor(rating)
  const half = rating - full >= 0.5
  const empty = 5 - full - (half ? 1 : 0)
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty)
}

// ─── Main View ────────────────────────────────────────────────────────
type TabType = 'store' | 'installed' | 'create'

export function SkillStoreView() {
  const [activeTab, setActiveTab] = useState<TabType>('store')
  const [detailSkill, setDetailSkill] = useState<RemoteSkillItem | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const handleInstallChange = useCallback(() => {
    setDetailSkill(null)
    setRefreshKey((k) => k + 1)
  }, [])

  return (
    <div className="view-body" style={{ position: 'relative' }}>
      <div className="page">
        {/* ── Tab bar ── */}
        <div className="store-tabbar">
          <button
            className={`store-tab ${activeTab === 'store' ? 'active' : ''}`}
            onClick={() => setActiveTab('store')}
          >
            <Icons.Globe size={13} />
            商店
          </button>
          <button
            className={`store-tab ${activeTab === 'installed' ? 'active' : ''}`}
            onClick={() => setActiveTab('installed')}
          >
            <Icons.Package size={13} />
            已安装
          </button>
          <button
            className={`store-tab ${activeTab === 'create' ? 'active' : ''}`}
            onClick={() => setActiveTab('create')}
          >
            <Icons.Plus size={13} />
            创建
          </button>
        </div>

        {/* ── Tab content ── */}
        {activeTab === 'store' ? (
          <StoreTab key={`store-${refreshKey}`} onShowDetail={setDetailSkill} />
        ) : activeTab === 'installed' ? (
          <InstalledTab key={`installed-${refreshKey}`} />
        ) : (
          <CreateTab key={`create-${refreshKey}`} onCreated={handleInstallChange} />
        )}
      </div>

      {/* ── Detail panel (overlay) ── */}
      {detailSkill && (
        <SkillDetailPanel
          skill={detailSkill}
          onClose={() => setDetailSkill(null)}
          onInstallChange={handleInstallChange}
        />
      )}
    </div>
  )
}

// ─── Store Tab ────────────────────────────────────────────────────────
const STORE_PAGE_SIZE = 20

function StoreTab({ onShowDetail }: { onShowDetail: (skill: RemoteSkillItem) => void }) {
  const [registries, setRegistries] = useState<SkillRegistry[]>([])
  const [activeRegistry, setActiveRegistry] = useState<string | null>(null)
  const [categories, setCategories] = useState<string[]>([])
  const [activeCategory, setActiveCategory] = useState<string>('全部')
  const [searchQuery, setSearchQuery] = useState('')
  const [skills, setSkills] = useState<RemoteSkillItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [displayCount, setDisplayCount] = useState(STORE_PAGE_SIZE)

  const { invoke: listRegistries } = useIpcInvoke('skill-registry:list')
  const { invoke: searchSkills } = useIpcInvoke('skill-registry:search')
  const { invoke: featuredSkills } = useIpcInvoke('skill-registry:featured')
  const { invoke: getCategories } = useIpcInvoke('skill-registry:categories')

  const debouncedQuery = useDebounce(searchQuery, 300)
  const mountedRef = useRef(true)

  // Reset display count when filters change
  useEffect(() => {
    setDisplayCount(STORE_PAGE_SIZE)
  }, [debouncedQuery, activeRegistry, activeCategory])

  // Load registries on mount
  useEffect(() => {
    listRegistries({})
      .then((res) => {
        if (mountedRef.current) setRegistries(res.registries)
      })
      .catch(() => {})
    return () => { mountedRef.current = false }
  }, [listRegistries])

  // Load featured or search results
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')

    const load = async () => {
      try {
        if (debouncedQuery.trim()) {
          const searchParams: { query: string; registryId?: string; category?: string; limit: number } = {
            query: debouncedQuery,
            limit: 60,
          }
          if (activeRegistry != null) searchParams.registryId = activeRegistry
          if (activeCategory !== '全部') searchParams.category = activeCategory
          const res = await searchSkills(searchParams)
          if (!cancelled) setSkills(deduplicateRemoteSkills(res.skills))
        } else {
          const featuredParams: { registryId?: string; limit: number } = { limit: 60 }
          if (activeRegistry != null) featuredParams.registryId = activeRegistry
          const res = await featuredSkills(featuredParams)
          if (!cancelled) setSkills(deduplicateRemoteSkills(res.skills))
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [debouncedQuery, activeRegistry, activeCategory, searchSkills, featuredSkills])

  // Load categories when registry changes
  useEffect(() => {
    if (!activeRegistry) {
      setCategories(['全部'])
      return
    }
    getCategories({ registryId: activeRegistry })
      .then((res) => {
        if (mountedRef.current) {
          setCategories(res.categories)
          setActiveCategory('全部')
        }
      })
      .catch(() => {})
  }, [activeRegistry, getCategories])

  const enabledRegistries = registries.filter((r) => r.enabled)
  const uninstalledSkills = skills.filter((skill) => !skill.installed)
  const visibleSkills = uninstalledSkills.slice(0, displayCount)
  const hasMore = displayCount < uninstalledSkills.length

  return (
    <div className="store-layout">
      {/* ── Sidebar: registry selector ── */}
      <div className="store-sidebar">
        <div className="store-sidebar-label">市场源</div>
        <button
          className={`store-registry-btn ${activeRegistry == null ? 'active' : ''}`}
          onClick={() => { setActiveRegistry(null); setActiveCategory('全部') }}
        >
          <Icons.Layers size={13} />
          全部市场
        </button>
        {enabledRegistries.map((r) => (
          <button
            key={r.id}
            className={`store-registry-btn ${activeRegistry === r.id ? 'active' : ''}`}
            onClick={() => { setActiveRegistry(r.id); setActiveCategory('全部') }}
          >
            <span className="store-registry-dot" />
            {r.name}
          </button>
        ))}
      </div>

      {/* ── Main content area ── */}
      <div className="store-main">
        {/* Search + category bar */}
        <div className="store-toolbar">
          <div className="search-input">
            <Icons.Search />
            <SparkInput
              placeholder="搜索 Skill..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="icon-btn" onClick={() => setSearchQuery('')}>
                <Icons.X size={10} />
              </button>
            )}
          </div>
        </div>

        {/* Category pills */}
        {categories.length > 1 && (
          <div className="store-categories">
            {categories.map((cat) => (
              <button
                key={cat}
                className={`store-cat-pill ${activeCategory === cat ? 'active' : ''}`}
                onClick={() => setActiveCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="card card-error" style={{ marginBottom: '12px' }}>
            {error}
            <button className="btn sm" style={{ marginLeft: '8px' }} onClick={() => setSearchQuery(searchQuery + ' ')}>重试</button>
          </div>
        )}

        {/* Loading */}
        {loading ? (
          <div className="empty-state">
            <div className="empty-icon"><Icons.Sparkles /></div>
            <div className="empty-title">正在搜索...</div>
          </div>
        ) : uninstalledSkills.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon"><Icons.Search /></div>
            <div className="empty-title">
              {debouncedQuery.trim() ? '未找到未安装的 Skill' : '暂无未安装推荐 Skill'}
            </div>
            <div className="empty-desc">
              {debouncedQuery.trim() ? '尝试其他关键词或切换市场源' : '已安装的 Skill 会在「已安装」中管理'}
            </div>
          </div>
        ) : (
          <>
            <div className="store-grid">
              {visibleSkills.map((skill) => (
                <StoreSkillCard
                  key={skill.id}
                  skill={skill}
                  onShowDetail={onShowDetail}
                  onInstalled={(id) => {
                    setSkills((prev) => prev.map((item) => item.id === id ? { ...item, installed: true } : item))
                  }}
                />
              ))}
            </div>
            {hasMore && (
              <div className="pagination-bar">
                <span>已显示 {visibleSkills.length} / {uninstalledSkills.length} 个</span>
                <button
                  className="btn sm"
                  onClick={() => setDisplayCount((c) => c + STORE_PAGE_SIZE)}
                >
                  加载更多
                </button>
              </div>
            )}
          </>
        )}

        {/* Stats footer */}
        <div className="store-stats">
          {enabledRegistries.length} 个市场源 · {uninstalledSkills.length} 个未安装 · {skills.length - uninstalledSkills.length} 个已安装
        </div>
      </div>
    </div>
  )
}

// ─── Store Skill Card ─────────────────────────────────────────────────
function StoreSkillCard({
  skill,
  onShowDetail,
  onInstalled,
}: {
  skill: RemoteSkillItem
  onShowDetail: (skill: RemoteSkillItem) => void
  onInstalled: (skillId: string) => void
}) {
  const [installing, setInstalling] = useState(false)
  const [installed, setInstalled] = useState(skill.installed)
  const { invoke: installSkill } = useIpcInvoke('skill-registry:install')

  const handleInstall = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (installing || installed) return
    setInstalling(true)
    try {
      await installSkill({ remoteSkillId: skill.id, registryId: skill.registryId })
      setInstalled(true)
      onInstalled(skill.id)
    } catch (err) {
      console.error('Install failed:', err)
    } finally {
      setInstalling(false)
    }
  }, [installSkill, skill.id, skill.registryId, installing, installed, onInstalled])

  return (
    <div className="store-skill-card" onClick={() => onShowDetail(skill)}>
      <div className="store-card-head">
        <div className="store-card-icon">
          {skill.iconUrl ? (
            <img src={skill.iconUrl} alt="" />
          ) : (
            skill.name.charAt(0).toUpperCase()
          )}
        </div>
        <div className="store-card-info">
          <div className="store-card-name">{skill.name}</div>
          <div className="store-card-author">{skill.author}</div>
        </div>
        <div className="store-card-rating">
          <span className="stars">{renderStars(skill.rating)}</span>
          <span className="rating-num">{skill.rating.toFixed(1)}</span>
        </div>
      </div>

      <div className="store-card-desc">{skill.description}</div>

      <div className="store-card-tags">
        {skill.tags.slice(0, 3).map((tag) => (
          <span key={tag} className="store-tag">{tag}</span>
        ))}
      </div>

      <div className="store-card-foot">
        <span className="store-card-source">{skill.registryName}</span>
        <span className="store-card-downloads">{formatCount(skill.downloadCount)} 次下载</span>
        <div style={{ flex: 1 }} />
        {installed ? (
          <span className="badge success">已安装</span>
        ) : (
          <button
            className="btn sm primary"
            disabled={installing}
            onClick={handleInstall}
          >
            {installing ? '安装中...' : '安装'}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Installed Tab ────────────────────────────────────────────────────
const LOCAL_CANDIDATE_PAGE_SIZE = 10

function InstalledTab() {
  const { skills, loading, error, toggleSkill, deleteSkill, total, enabledCount, refresh } = useSkills()
  const [search, setSearch] = useState('')
  const [localCandidates, setLocalCandidates] = useState<LocalSkillCandidate[]>([])
  const [detecting, setDetecting] = useState(false)
  const [importingIds, setImportingIds] = useState<Set<string>>(new Set())
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // Pagination for installed skills
  const [installedPage, setInstalledPage] = useState(1)
  // Pagination for local candidates
  const [candidatePage, setCandidatePage] = useState(1)
  // Local candidate search & source tab
  const [candidateSearch, setCandidateSearch] = useState('')
  const [activeSourceTab, setActiveSourceTab] = useState<string>('全部')
  // Management mode (multi-select for batch delete)
  const [managementMode, setManagementMode] = useState(false)
  const [selectedDeleteIds, setSelectedDeleteIds] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const { toast } = useToast()
  const { invoke: detectLocalSkills } = useIpcInvoke('skill:detect-local')
  const { invoke: importDirectory } = useIpcInvoke('skill:import-directory')
  const { invoke: importBatchLocal } = useIpcInvoke('skill:import-batch-local')
  const { invoke: openDirectoryDialog } = useIpcInvoke('dialog:open-directory')

  const dedupedSkills = deduplicateSkills(skills)
  const filtered = filterSkills(dedupedSkills, search)
  const visibleInstalled = paginate(filtered, installedPage, SKILL_PAGE_SIZE)
  const hasMoreInstalled = installedPage * SKILL_PAGE_SIZE < filtered.length

  // Local candidates: dedup -> filter by source tab -> filter by search -> paginate
  const dedupedCandidates = deduplicateCandidates(localCandidates)
  const candidateSources = getCandidateSources(dedupedCandidates)
  const sourceFiltered = activeSourceTab === '全部'
    ? dedupedCandidates
    : dedupedCandidates.filter((c) => c.source === activeSourceTab)
  const searchFiltered = filterCandidates(sourceFiltered, candidateSearch)
  const importableCandidates = searchFiltered.filter((c) => !c.installed)
  const visibleCandidates = searchFiltered.slice(0, candidatePage * LOCAL_CANDIDATE_PAGE_SIZE)
  const hasMoreCandidates = candidatePage * LOCAL_CANDIDATE_PAGE_SIZE < searchFiltered.length

  // Reset candidate page when search or tab changes
  useEffect(() => {
    setCandidatePage(1)
  }, [candidateSearch, activeSourceTab])

  // Reset installed page when search changes
  useEffect(() => {
    setInstalledPage(1)
  }, [search])

  const handleDetectLocal = useCallback(async () => {
    setDetecting(true)
    setSelectedIds(new Set())
    setCandidatePage(1)
    setCandidateSearch('')
    setActiveSourceTab('全部')
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

  const handleImportLocal = useCallback(async (candidate: LocalSkillCandidate) => {
    const id = candidate.id
    setImportingIds((prev) => new Set(prev).add(id))
    try {
      await importDirectory({ directoryPath: candidate.rootPath, source: candidate.source })
      toast.success(`已导入 ${candidate.name}`)
      refresh()
      await refreshCandidates()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导入本地 Skill 失败')
    } finally {
      setImportingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }, [importDirectory, refresh, refreshCandidates, toast])

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
      setSelectedIds(new Set())
      refresh()
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
  }, [importableCandidates, selectedIds, importBatchLocal, refresh, refreshCandidates, toast])

  const handlePickImportDirectory = useCallback(async () => {
    const picked = await openDirectoryDialog({ title: '选择包含 SKILL.md 的 Skill 目录' })
    if (picked.canceled || picked.filePath == null) return
    const dir = picked.filePath
    try {
      await importDirectory({ directoryPath: dir, source: 'custom' })
      toast.success('已导入本地 Skill')
      refresh()
      await refreshCandidates()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导入本地 Skill 失败')
    }
  }, [importDirectory, openDirectoryDialog, refresh, refreshCandidates, toast])

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

  // ── Management mode: multi-select delete ──
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
    if (selectedDeleteIds.size === filtered.length) {
      setSelectedDeleteIds(new Set())
    } else {
      setSelectedDeleteIds(new Set(filtered.map((s) => s.id)))
    }
  }, [selectedDeleteIds.size, filtered])

  const handleBatchDelete = useCallback(async () => {
    if (selectedDeleteIds.size === 0) return
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
      refresh()
    } finally {
      setDeleting(false)
    }
  }, [selectedDeleteIds, deleteSkill, exitManagement, refresh, toast])

  const isImporting = importingIds.size > 0

  return (
    <div>
      {/* Search bar */}
      <div className="row" style={{ marginBottom: '12px', gap: '8px' }}>
        <div className="search-input" style={{ flex: 1 }}>
          <Icons.Search />
          <SparkInput
            placeholder="搜索已安装的 Skill..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {!managementMode && (
          <button
            className="btn"
            onClick={enterManagement}
            disabled={total === 0 || isImporting}
          >
            <Icons.CheckSquare size={12} /> 管理
          </button>
        )}
        <button className="btn" onClick={() => void handlePickImportDirectory()} disabled={isImporting}>
          <Icons.Upload size={12} /> 导入目录
        </button>
        <button className="btn" onClick={() => void handleDetectLocal()} disabled={detecting || isImporting}>
          <Icons.Refresh size={12} /> {detecting ? '检测中...' : '检测本地 Skill'}
        </button>
      </div>

      {/* Management mode bar */}
      {managementMode && (
        <div className="management-bar">
          <Icons.CheckSquare size={13} />
          <span>已选择 <span className="mgmt-count">{selectedDeleteIds.size}</span> 个</span>
          <button className="btn sm" onClick={toggleDeleteSelectAll} disabled={deleting}>
            {selectedDeleteIds.size === filtered.length ? '取消全选' : '全选'}
          </button>
          <button
            className="btn sm primary"
            onClick={() => void handleBatchDelete()}
            disabled={selectedDeleteIds.size === 0 || deleting}
          >
            {deleting ? '删除中...' : `删除所选 (${selectedDeleteIds.size})`}
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn sm" onClick={exitManagement} disabled={deleting}>
            退出管理
          </button>
        </div>
      )}

      {/* Local detected skills panel */}
      {dedupedCandidates.length > 0 && (
        <div className="local-skill-panel">
          <div className="local-skill-head">
            <span className="local-skill-title">本地可导入 Skill</span>
            <span className="badge">{dedupedCandidates.length}</span>
            <div style={{ flex: 1 }} />
            {importableCandidates.length > 0 && (
              <>
                <button
                  className="btn sm"
                  onClick={toggleSelectAll}
                  disabled={isImporting}
                >
                  {selectedIds.size === importableCandidates.length ? '取消全选' : '全选'}
                </button>
                <button
                  className="btn sm primary"
                  onClick={() => void handleBatchImport()}
                  disabled={selectedIds.size === 0 || isImporting}
                >
                  {isImporting ? '导入中...' : `导入所选 (${selectedIds.size})`}
                </button>
              </>
            )}
          </div>

          {/* Source tabs + search */}
          <div className="local-skill-filter-bar">
            <div className="local-skill-source-tabs">
              <button
                className={`store-cat-pill ${activeSourceTab === '全部' ? 'active' : ''}`}
                onClick={() => setActiveSourceTab('全部')}
              >
                全部 ({dedupedCandidates.length})
              </button>
              {candidateSources.map((src) => {
                const count = dedupedCandidates.filter((c) => c.source === src).length
                return (
                  <button
                    key={src}
                    className={`store-cat-pill ${activeSourceTab === src ? 'active' : ''}`}
                    onClick={() => setActiveSourceTab(src)}
                  >
                    {src} ({count})
                  </button>
                )
              })}
            </div>
            <div className="search-input" style={{ width: '180px' }}>
              <Icons.Search />
              <SparkInput
                placeholder="搜索本地 Skill..."
                value={candidateSearch}
                onChange={(e) => setCandidateSearch(e.target.value)}
              />
              {candidateSearch && (
                <button className="icon-btn" onClick={() => setCandidateSearch('')}>
                  <Icons.X size={10} />
                </button>
              )}
            </div>
          </div>

          <div className="local-skill-list">
            {searchFiltered.length === 0 ? (
              <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                未找到匹配的本地 Skill
              </div>
            ) : (
              visibleCandidates.map((candidate) => {
                const importing = importingIds.has(candidate.id)
                const selected = selectedIds.has(candidate.id)
                return (
                  <div className="local-skill-row" key={candidate.id}>
                    {!candidate.installed && (
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
                    <span className="badge badge-font-sm" style={{ flexShrink: 0 }}>{candidate.source}</span>
                    {candidate.installed ? (
                      <span className="badge success" style={{ flexShrink: 0 }}>已导入</span>
                    ) : (
                      <button
                        className="btn sm"
                        onClick={() => void handleImportLocal(candidate)}
                        disabled={importing}
                        style={{ flexShrink: 0 }}
                      >
                        {importing ? '导入中...' : '导入'}
                      </button>
                    )}
                  </div>
                )
              })
            )}
          </div>
          {hasMoreCandidates && (
            <div className="local-skill-pagination">
              <span>已显示 {visibleCandidates.length} / {searchFiltered.length} 个</span>
              <button className="btn sm" onClick={() => setCandidatePage((p) => p + 1)}>
                加载更多
              </button>
            </div>
          )}
        </div>
      )}

      {error && <div className="card card-error" style={{ marginBottom: '12px' }}>{error}</div>}

      {loading ? (
        <div className="empty-state">
          <div className="empty-icon"><Icons.Sparkles /></div>
          <div className="empty-title">正在加载...</div>
        </div>
      ) : total === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><Icons.Package /></div>
          <div className="empty-title">暂无已安装的 Skill</div>
          <div className="empty-desc">点击「检测本地 Skill」发现本地目录中的 SKILL.md 文件</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><Icons.Search /></div>
          <div className="empty-title">未找到匹配的 Skill</div>
        </div>
      ) : (
        <>
          <div className="skill-grid">
            {visibleInstalled.map((s) => (
              <InstalledSkillCard
                key={s.id}
                skill={s}
                onToggle={toggleSkill}
                onDelete={deleteSkill}
                managementMode={managementMode}
                selected={selectedDeleteIds.has(s.id)}
                onToggleSelect={toggleDeleteSelect}
              />
            ))}
          </div>
          {hasMoreInstalled && (
            <div className="pagination-bar">
              <span>已显示 {visibleInstalled.length} / {filtered.length} 个</span>
              <button
                className="btn sm"
                onClick={() => setInstalledPage((p) => p + 1)}
              >
                加载更多
              </button>
            </div>
          )}
        </>
      )}

      <div className="store-stats" style={{ marginTop: '16px' }}>
        {total} 个已安装 · {enabledCount} 个已启用
      </div>
    </div>
  )
}

function InstalledSkillCard({
  skill,
  onToggle,
  onDelete,
  managementMode,
  selected,
  onToggleSelect,
}: {
  skill: SkillItem
  onToggle: (skill: SkillItem) => Promise<void>
  onDelete: (id: string) => Promise<void>
  managementMode: boolean
  selected: boolean
  onToggleSelect: (id: string) => void
}) {
  const meta = parseSkillManifest(skill.manifestJson)
  return (
    <div className={`skill-card ${selected ? 'selected' : ''}`}>
      {managementMode ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label className="skill-card-check" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect(skill.id)}
            />
            <span className="checkmark" />
          </label>
          <div className="icon-wrap">{skill.name.charAt(0).toUpperCase()}</div>
          <div className="row row-gap-xs">
            <span className="name">{skill.name}</span>
            <span className="badge badge-font-sm">{meta.source}</span>
          </div>
        </div>
      ) : (
        <>
          <div className="icon-wrap">{skill.name.charAt(0).toUpperCase()}</div>
          <div className="row row-gap-xs">
            <span className="name">{skill.name}</span>
            <span className="badge badge-font-sm">{meta.source}</span>
          </div>
        </>
      )}
      <div className="desc">{meta.desc}</div>
      {!managementMode && (
        <>
          <div className="row skill-scope-row skill-tools-row">
            <span
              className={`badge ${skill.enabled ? 'success' : ''} tool-chip-sm`}
              onClick={() => onToggle(skill)}
            >
              {skill.enabled ? '系统可见' : '系统隐藏'}
            </span>
            {skill.id === 'builtin:superpowers' && <span className="badge">内置工作流</span>}
          </div>
          <div className="foot">
            <span>{meta.source} · {skill.version}</span>
            <div className="flex1" />
            <button className="icon-btn" title="导出">
              <Icons.Download size={11} />
            </button>
            <button className="icon-btn" title="删除" onClick={() => onDelete(skill.id)}>
              <Icons.Trash size={11} />
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Skill Detail Panel (slide-in from right) ─────────────────────────
function SkillDetailPanel({
  skill,
  onClose,
  onInstallChange,
}: {
  skill: RemoteSkillItem
  onClose: () => void
  onInstallChange: () => void
}) {
  const [installing, setInstalling] = useState(false)
  const [installed, setInstalled] = useState(skill.installed)
  const { invoke: installSkill } = useIpcInvoke('skill-registry:install')
  const { invoke: uninstallSkill } = useIpcInvoke('skill-registry:uninstall')

  const handleInstall = useCallback(async () => {
    if (installing) return
    setInstalling(true)
    try {
      if (installed && skill.localId) {
        await uninstallSkill({ localSkillId: skill.localId })
        setInstalled(false)
      } else {
        await installSkill({ remoteSkillId: skill.id, registryId: skill.registryId })
        setInstalled(true)
      }
      onInstallChange()
    } catch (err) {
      console.error('Install/uninstall failed:', err)
    } finally {
      setInstalling(false)
    }
  }, [installSkill, uninstallSkill, skill, installed, installing, onInstallChange])

  return (
    <div className="slide-panel-backdrop" onClick={onClose}>
      <div className="slide-panel skill-detail-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="slide-panel-h">
          <button className="icon-btn" onClick={onClose}>
            <Icons.ArrowLeft size={16} />
          </button>
          <div>
            <div className="h-title">Skill 详情</div>
          </div>
        </div>

        {/* Body */}
        <div className="slide-panel-body">
          {/* Icon + basic info */}
          <div className="skill-detail-hero">
            <div className="store-card-icon lg">
              {skill.iconUrl ? (
                <img src={skill.iconUrl} alt="" />
              ) : (
                skill.name.charAt(0).toUpperCase()
              )}
            </div>
            <div>
              <div className="strong" style={{ fontSize: '18px' }}>{skill.name}</div>
              <div className="muted" style={{ marginTop: '2px' }}>v{skill.version} · {skill.author}</div>
            </div>
          </div>

          {/* Stats card */}
          <div className="skill-detail-stats">
            <div className="skill-detail-stat">
              <span className="stars">{renderStars(skill.rating)}</span>
              <span className="strong">{skill.rating.toFixed(1)}</span>
            </div>
            <div className="skill-detail-stat">
              <Icons.Download size={13} />
              <span>{formatCount(skill.downloadCount)} 次下载</span>
            </div>
            <div className="skill-detail-stat">
              <Icons.Globe size={13} />
              <span>{skill.registryName}</span>
            </div>
          </div>

          {/* Description */}
          <div className="skill-detail-section">
            <div className="skill-detail-section-title">描述</div>
            <div className="skill-detail-text">{skill.description}</div>
          </div>

          {/* Tags */}
          {skill.tags.length > 0 && (
            <div className="skill-detail-section">
              <div className="skill-detail-section-title">标签</div>
              <div className="skill-detail-tags">
                {skill.tags.map((tag) => (
                  <span key={tag} className="store-tag">{tag}</span>
                ))}
              </div>
            </div>
          )}

          {/* Category */}
          {skill.category && (
            <div className="skill-detail-section">
              <div className="skill-detail-section-title">分类</div>
              <span className="store-cat-pill active">{skill.category}</span>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="slide-panel-foot">
          {skill.homepageUrl && (
            <button className="btn" onClick={() => window.open(skill.homepageUrl, '_blank')}>
              <Icons.ExternalLink size={12} /> 访问主页
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button
            className={`btn ${installed ? '' : 'primary'}`}
            disabled={installing}
            onClick={handleInstall}
          >
            {installing ? '处理中...' : installed ? '卸载' : '安装到本地'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Create Tab (New Skill Creation Form) ─────────────────────────────

function CreateTab({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('')
  const [version, setVersion] = useState('1.0.0')
  const [description, setDescription] = useState('')
  const [author, setAuthor] = useState('')
  const [category, setCategory] = useState('utility')
  const [tagsInput, setTagsInput] = useState('')
  const [content, setContent] = useState('')
  const [requiredTools, setRequiredTools] = useState('')
  const [creating, setCreating] = useState(false)
  const [importMode, setImportMode] = useState<'none' | 'file' | 'directory'>('none')
  const { toast } = useToast()
  const { invoke: createSkill } = useIpcInvoke('skill:create')
  const { invoke: importFile } = useIpcInvoke('skill:import-file')
  const { invoke: importDirectory } = useIpcInvoke('skill:import-directory')
  const { invoke: openFileDialog } = useIpcInvoke('dialog:open-file')
  const { invoke: openDirectoryDialog } = useIpcInvoke('dialog:open-directory')

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
      const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean)
      const tools = requiredTools.split(',').map((t) => t.trim()).filter(Boolean)
      const id = `user:${name.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')}`

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

      await createSkill({
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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建失败')
    } finally {
      setCreating(false)
    }
  }, [name, version, description, author, category, tagsInput, content, requiredTools, createSkill, toast, resetForm, onCreated])

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
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '导入文件失败')
      } finally {
        setCreating(false)
      }
    } catch {
      // dialog cancelled
    }
  }, [openFileDialog, importFile, toast, onCreated])

  const handleImportDirectory = useCallback(async () => {
    try {
      const picked = await openDirectoryDialog({
        title: '选择包含 SKILL.md 的 Skill 目录',
      })
      if (picked.canceled || picked.filePath == null) return

      setCreating(true)
      try {
        await importDirectory({ directoryPath: picked.filePath, source: 'custom' })
        toast.success('已导入本地 Skill 目录')
        onCreated()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '导入目录失败')
      } finally {
        setCreating(false)
      }
    } catch {
      // dialog cancelled
    }
  }, [openDirectoryDialog, importDirectory, toast, onCreated])

  return (
    <div className="create-skill-layout">
      {/* Mode selector */}
      <div className="create-mode-bar">
        <button
          className={`store-tab ${importMode === 'none' ? 'active' : ''}`}
          onClick={() => setImportMode('none')}
        >
          <Icons.Edit size={13} />
          手动创建
        </button>
        <button
          className={`store-tab ${importMode === 'file' ? 'active' : ''}`}
          onClick={() => setImportMode('file')}
        >
          <Icons.File size={13} />
          文件导入
        </button>
        <button
          className={`store-tab ${importMode === 'directory' ? 'active' : ''}`}
          onClick={() => setImportMode('directory')}
        >
          <Icons.FolderOpen size={13} />
          目录导入
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
                <input
                  className="form-input"
                  type="text"
                  placeholder="例如：代码审查助手"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label className="form-label">版本</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="1.0.0"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label className="form-label">作者</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="作者名称"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label className="form-label">分类</label>
                <select
                  className="form-select"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="utility">通用</option>
                  <option value="code-generation">代码生成</option>
                  <option value="code-review">代码审查</option>
                  <option value="testing">测试</option>
                  <option value="documentation">文档</option>
                  <option value="data-analysis">数据分析</option>
                  <option value="web-development">Web 开发</option>
                  <option value="api-development">API 开发</option>
                  <option value="devops">DevOps</option>
                  <option value="security">安全</option>
                  <option value="ai-ml">AI/ML</option>
                  <option value="automation">自动化</option>
                  <option value="database">数据库</option>
                  <option value="frontend">前端</option>
                  <option value="backend">后端</option>
                </select>
              </div>
            </div>
          </div>

          <div className="create-form-section">
            <div className="create-section-title">描述与标签</div>
            <div className="form-field">
              <label className="form-label">
                简短描述 <span className="required">*</span>
              </label>
              <textarea
                className="form-textarea"
                rows={3}
                placeholder="一句话描述 Skill 的功能，例如：自动化代码审查，检测潜在 Bug 和安全问题"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label className="form-label">标签（逗号分隔）</label>
              <input
                className="form-input"
                type="text"
                placeholder="code-review, security, quality"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label className="form-label">所需工具（逗号分隔）</label>
              <input
                className="form-input"
                type="text"
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
              <textarea
                className="form-textarea form-textarea-lg"
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
            <button className="btn" onClick={resetForm}>
              重置
            </button>
            <button
              className="btn primary"
              disabled={creating || !name.trim()}
              onClick={() => void handleCreate()}
            >
              {creating ? '创建中...' : '创建 Skill'}
            </button>
          </div>
        </div>
      ) : importMode === 'file' ? (
        /* ── File Import ── */
        <div className="create-import-panel">
          <div className="import-panel-icon">
            <Icons.File size={48} />
          </div>
          <div className="import-panel-title">导入 Skill 文件</div>
          <div className="import-panel-desc">
            选择一个 SKILL.md 或 Markdown 文件，系统会自动解析文件中的 frontmatter（名称、描述、版本等）和内容，创建为本地 Skill。
          </div>
          <div className="import-panel-supported">
            <span className="badge">SKILL.md</span>
            <span className="badge">.md</span>
          </div>
          <div className="import-panel-format">
            <div className="import-format-title">支持的文件格式：</div>
            <pre className="import-format-code">{`---
name: 我的 Skill
description: 描述文字
version: 1.0.0
author: 作者名
category: utility
tags: [tag1, tag2]
---

# Skill 指令内容

这里是 Skill 的详细指令...`}</pre>
          </div>
          <button
            className="btn primary lg"
            disabled={creating}
            onClick={() => void handleImportFile()}
          >
            <Icons.Upload size={14} />
            {creating ? '导入中...' : '选择文件并导入'}
          </button>
        </div>
      ) : (
        /* ── Directory Import ── */
        <div className="create-import-panel">
          <div className="import-panel-icon">
            <Icons.FolderOpen size={48} />
          </div>
          <div className="import-panel-title">导入 Skill 目录</div>
          <div className="import-panel-desc">
            选择一个包含 SKILL.md 文件的目录。目录中的所有文件将被作为 Skill 内容导入。
          </div>
          <div className="import-panel-supported">
            <span className="badge">SKILL.md</span>
            <span className="badge">目录</span>
          </div>
          <div className="import-panel-format">
            <div className="import-format-title">目录结构示例：</div>
            <pre className="import-format-code">{`my-skill/
├── SKILL.md          ← 必须包含
├── scripts/
│   └── helper.ts     ← 辅助脚本
└── templates/
    └── output.md     ← 模板文件`}</pre>
          </div>
          <button
            className="btn primary lg"
            disabled={creating}
            onClick={() => void handleImportDirectory()}
          >
            <Icons.Upload size={14} />
            {creating ? '导入中...' : '选择目录并导入'}
          </button>
        </div>
      )}
    </div>
  )
}
