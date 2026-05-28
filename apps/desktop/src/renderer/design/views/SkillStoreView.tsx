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
type TabType = 'store' | 'installed'

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
        </div>

        {/* ── Tab content ── */}
        {activeTab === 'store' ? (
          <StoreTab key={`store-${refreshKey}`} onShowDetail={setDetailSkill} />
        ) : (
          <InstalledTab key={`installed-${refreshKey}`} />
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

  const dedupedCandidates = deduplicateCandidates(localCandidates)
  const importableCandidates = dedupedCandidates.filter((c) => !c.installed)
  const visibleCandidates = dedupedCandidates.slice(0, candidatePage * LOCAL_CANDIDATE_PAGE_SIZE)
  const hasMoreCandidates = candidatePage * LOCAL_CANDIDATE_PAGE_SIZE < dedupedCandidates.length

  // Reset installed page when search changes
  useEffect(() => {
    setInstalledPage(1)
  }, [search])

  const handleDetectLocal = useCallback(async () => {
    setDetecting(true)
    setSelectedIds(new Set())
    setCandidatePage(1)
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
          <div className="local-skill-list">
            {visibleCandidates.map((candidate) => {
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
                    <div className="muted truncate">{candidate.description || candidate.source}</div>
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
            })}
          </div>
          {hasMoreCandidates && (
            <div className="local-skill-pagination">
              <span>已显示 {visibleCandidates.length} / {dedupedCandidates.length} 个</span>
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
