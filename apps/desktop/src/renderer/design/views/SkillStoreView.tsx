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
import { useSkills, parseSkillManifest, filterSkills } from '../utils/skills-data'
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
        {/* ── Header row ── */}
        <div className="row section-header-row">
          <div className="flex1">
            <div className="strong header-title-lg">Skill 商店</div>
            <div className="muted header-desc">发现、安装和管理 AI Skill 能力扩展</div>
          </div>
        </div>

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
function StoreTab({ onShowDetail }: { onShowDetail: (skill: RemoteSkillItem) => void }) {
  const [registries, setRegistries] = useState<SkillRegistry[]>([])
  const [activeRegistry, setActiveRegistry] = useState<string | null>(null)
  const [categories, setCategories] = useState<string[]>([])
  const [activeCategory, setActiveCategory] = useState<string>('全部')
  const [searchQuery, setSearchQuery] = useState('')
  const [skills, setSkills] = useState<RemoteSkillItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const { invoke: listRegistries } = useIpcInvoke('skill-registry:list')
  const { invoke: searchSkills } = useIpcInvoke('skill-registry:search')
  const { invoke: featuredSkills } = useIpcInvoke('skill-registry:featured')
  const { invoke: getCategories } = useIpcInvoke('skill-registry:categories')

  const debouncedQuery = useDebounce(searchQuery, 300)
  const mountedRef = useRef(true)

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
            limit: 30,
          }
          if (activeRegistry != null) searchParams.registryId = activeRegistry
          if (activeCategory !== '全部') searchParams.category = activeCategory
          const res = await searchSkills(searchParams)
          if (!cancelled) setSkills(res.skills)
        } else {
          const featuredParams: { registryId?: string; limit: number } = { limit: 24 }
          if (activeRegistry != null) featuredParams.registryId = activeRegistry
          const res = await featuredSkills(featuredParams)
          if (!cancelled) setSkills(res.skills)
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
          <div className="store-grid">
            {uninstalledSkills.map((skill) => (
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
function InstalledTab() {
  const { skills, loading, error, toggleSkill, deleteSkill, total, enabledCount, refresh } = useSkills()
  const [search, setSearch] = useState('')
  const [localCandidates, setLocalCandidates] = useState<LocalSkillCandidate[]>([])
  const [detecting, setDetecting] = useState(false)
  const [importingPath, setImportingPath] = useState<string | null>(null)
  const { toast } = useToast()
  const { invoke: detectLocalSkills } = useIpcInvoke('skill:detect-local')
  const { invoke: importDirectory } = useIpcInvoke('skill:import-directory')
  const { invoke: openDirectoryDialog } = useIpcInvoke('dialog:open-directory')
  const filtered = filterSkills(skills, search)

  const handleDetectLocal = useCallback(async () => {
    setDetecting(true)
    try {
      const res = await detectLocalSkills({})
      setLocalCandidates(res.candidates)
      toast.success(`检测到 ${res.candidates.length} 个本地 Skill`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '检测本地 Skill 失败')
    } finally {
      setDetecting(false)
    }
  }, [detectLocalSkills, toast])

  const handleImportLocal = useCallback(async (candidate: LocalSkillCandidate) => {
    setImportingPath(candidate.rootPath)
    try {
      await importDirectory({ directoryPath: candidate.rootPath, source: candidate.source })
      toast.success(`已导入 ${candidate.name}`)
      refresh()
      await handleDetectLocal()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导入本地 Skill 失败')
    } finally {
      setImportingPath(null)
    }
  }, [handleDetectLocal, importDirectory, refresh, toast])

  const handlePickImportDirectory = useCallback(async () => {
    const picked = await openDirectoryDialog({ title: '选择包含 SKILL.md 的 Skill 目录' })
    if (picked.canceled || picked.filePath == null) return
    setImportingPath(picked.filePath)
    try {
      await importDirectory({ directoryPath: picked.filePath, source: 'custom' })
      toast.success('已导入本地 Skill')
      refresh()
      await handleDetectLocal()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导入本地 Skill 失败')
    } finally {
      setImportingPath(null)
    }
  }, [handleDetectLocal, importDirectory, openDirectoryDialog, refresh, toast])

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
        <button className="btn" onClick={() => void handlePickImportDirectory()} disabled={importingPath !== null}>
          <Icons.Upload size={12} /> 导入目录
        </button>
        <button className="btn" onClick={() => void handleDetectLocal()} disabled={detecting}>
          <Icons.Refresh size={12} /> {detecting ? '检测中...' : '检测 Claude/Codex'}
        </button>
        <button className="btn">
          <Icons.Download size={12} /> 导出全部
        </button>
      </div>

      {localCandidates.length > 0 && (
        <div className="local-skill-panel">
          <div className="local-skill-head">
            <span>本地可导入</span>
            <span className="badge">{localCandidates.length}</span>
          </div>
          <div className="local-skill-list">
            {localCandidates.map((candidate) => (
              <div className="local-skill-row" key={candidate.id}>
                <div className="flex1 min-w-0">
                  <div className="strong truncate">{candidate.name}</div>
                  <div className="muted truncate">{candidate.description} · {candidate.source} · {candidate.rootPath}</div>
                </div>
                {candidate.installed ? (
                  <span className="badge success">已导入</span>
                ) : (
                  <button
                    className="btn sm"
                    onClick={() => void handleImportLocal(candidate)}
                    disabled={importingPath === candidate.rootPath}
                  >
                    {importingPath === candidate.rootPath ? '导入中...' : '导入'}
                  </button>
                )}
              </div>
            ))}
          </div>
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
          <div className="empty-desc">前往商店发现和安装 AI Skill</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon"><Icons.Search /></div>
          <div className="empty-title">未找到匹配的 Skill</div>
        </div>
      ) : (
        <div className="skill-grid">
          {filtered.map((s) => (
            <InstalledSkillCard key={s.id} skill={s} onToggle={toggleSkill} onDelete={deleteSkill} />
          ))}
        </div>
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
}: {
  skill: SkillItem
  onToggle: (skill: SkillItem) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const meta = parseSkillManifest(skill.manifestJson)
  return (
    <div className="skill-card">
      <div className="icon-wrap">{skill.name.charAt(0).toUpperCase()}</div>
      <div className="row row-gap-xs">
        <span className="name">{skill.name}</span>
        <span className="badge badge-font-sm">{meta.source}</span>
      </div>
      <div className="desc">{meta.desc}</div>
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
