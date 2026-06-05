/**
 * SkillStoreView — Skill 管理页面
 *
 * Tab 切换：已安装（Installed）+ 创建（Create）
 * 已安装 Tab：Skill 卡片网格 + 批量管理
 * 创建 Tab：手动创建 / 文件导入 / 目录导入 / 检测导入本地 Skill
 */
import { useState, useCallback, useEffect, useMemo } from 'react'
import type { LocalSkillCandidate, SkillItem } from '@spark/protocol'
import { Icons } from '../Icons'
import { SparkInput, SparkSelect, SparkTextarea } from '../components/FormControls'
import { useApp } from '../AppContext'
import {
  useSkills,
  parseSkillManifest,
  filterSkills,
  filterCandidates,
  getCandidateSources,
  deduplicateSkills,
  deduplicateCandidates,
  SKILL_PAGE_SIZE,
  paginate,
} from '../utils/skills-data'
import { useIpcInvoke } from '../hooks/useIpc'
import { useToast } from '../components/Toast'

function deferEffect(task: () => void | Promise<void>): () => void {
  const id = window.setTimeout(() => {
    void task()
  }, 0)
  return () => window.clearTimeout(id)
}

// ─── Main View ────────────────────────────────────────────────────────
type TabType = 'installed' | 'create'

export function SkillStoreView() {
  const [activeTab, setActiveTab] = useState<TabType>('installed')
  const [refreshKey, setRefreshKey] = useState(0)

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1)
  }, [])

  return (
    <div className="view-body" style={{ position: 'relative' }}>
      <div className="page">
        {/* ── Tab bar ── */}
        <div className="store-tabbar">
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
        {activeTab === 'installed' ? (
          <InstalledTab key={`installed-${refreshKey}`} />
        ) : (
          <CreateTab key={`create-${refreshKey}`} onCreated={handleRefresh} />
        )}
      </div>
    </div>
  )
}

// ─── Installed Tab ────────────────────────────────────────────────────

function InstalledTab() {
  const { skills, loading, error, toggleSkill, deleteSkill, total, enabledCount, refresh } = useSkills()
  const { requestConfirm } = useApp()
  const [search, setSearch] = useState('')
  // Pagination for installed skills
  const [installedPage, setInstalledPage] = useState(1)
  // Management mode (multi-select for batch delete)
  const [managementMode, setManagementMode] = useState(false)
  const [selectedDeleteIds, setSelectedDeleteIds] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const { toast } = useToast()

  const dedupedSkills = useMemo(() => deduplicateSkills(skills), [skills])
  const filtered = useMemo(() => {
    const list = filterSkills(dedupedSkills, search)
    return [
      ...list.filter((s) => s.id.startsWith('builtin:')),
      ...list.filter((s) => !s.id.startsWith('builtin:')),
    ]
  }, [dedupedSkills, search])
  const visibleInstalled = useMemo(
    () => paginate(filtered, installedPage, SKILL_PAGE_SIZE),
    [filtered, installedPage],
  )
  const hasMoreInstalled = installedPage * SKILL_PAGE_SIZE < filtered.length

  // Reset installed page when search changes
  useEffect(() => {
    return deferEffect(() => setInstalledPage(1))
  }, [search])

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

  // ── Single delete with confirm ──
  const handleDeleteSkill = useCallback(async (id: string) => {
    const confirmed = await requestConfirm({
      title: '删除 Skill？',
      description: '删除后该 Skill 将从本地移除，相关能力将不再可用。',
      confirmText: '删除',
      danger: true,
    })
    if (!confirmed) return
    await deleteSkill(id)
    toast.success('已删除 Skill')
  }, [requestConfirm, deleteSkill, toast])

  // ── Batch delete with confirm ──
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
            disabled={total === 0}
          >
            <Icons.CheckSquare size={12} /> 管理
          </button>
        )}
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
          <div className="empty-desc">前往「创建」Tab 手动创建或导入 Skill</div>
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
                onDelete={handleDeleteSkill}
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
            {!skill.id.startsWith('builtin:') && (
              <button className="icon-btn" title="删除" onClick={() => onDelete(skill.id)}>
                <Icons.Trash size={11} />
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Create Tab (New Skill Creation / Import) ──────────────────────────

type ImportMode = 'none' | 'file' | 'directory' | 'detect'

function CreateTab({ onCreated }: { onCreated: () => void }) {
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
  const [importMode, setImportMode] = useState<ImportMode>('none')
  const { toast } = useToast()

  // ── IPC hooks ──
  const { invoke: createSkill } = useIpcInvoke('skill:create')
  const { invoke: importFile } = useIpcInvoke('skill:import-file')
  const { invoke: importDirectory } = useIpcInvoke('skill:import-directory')
  const { invoke: openFileDialog } = useIpcInvoke('dialog:open-file')
  const { invoke: openDirectoryDialog } = useIpcInvoke('dialog:open-directory')
  const { invoke: detectLocalSkills } = useIpcInvoke('skill:detect-local')
  const { invoke: importBatchLocal } = useIpcInvoke('skill:import-batch-local')

  // ── Local detection state ──
  const [localCandidates, setLocalCandidates] = useState<LocalSkillCandidate[]>([])
  const [detecting, setDetecting] = useState(false)
  const [importingIds, setImportingIds] = useState<Set<string>>(new Set())
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [candidateSearch, setCandidateSearch] = useState('')
  const [activeSourceTab, setActiveSourceTab] = useState<string>('全部')

  // ── Local candidates: dedup -> filter by source tab -> filter by search ──
  const dedupedCandidates = useMemo(() => deduplicateCandidates(localCandidates), [localCandidates])
  const candidateSources = useMemo(() => getCandidateSources(dedupedCandidates), [dedupedCandidates])
  const sourceFiltered = useMemo(() => (
    activeSourceTab === '全部'
      ? dedupedCandidates
      : dedupedCandidates.filter((c) => c.source === activeSourceTab)
  ), [activeSourceTab, dedupedCandidates])
  const searchFiltered = useMemo(
    () => filterCandidates(sourceFiltered, candidateSearch),
    [candidateSearch, sourceFiltered],
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
      const tags = tagsInput.split(',').map((t) => t.trim()).filter(Boolean)
      const tools = requiredTools.split(',').map((t) => t.trim()).filter(Boolean)
      const id = `user:${name.trim().toLowerCase().replace(/[^a-z0-9一-龥]+/g, '-')}`

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
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '导入文件失败')
      } finally {
        setCreating(false)
      }
    } catch {
      // dialog cancelled
    }
  }, [openFileDialog, importFile, toast, onCreated])

  // ── Directory import ──
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

  // ── Detect local skills ──
  const handleDetectLocal = useCallback(async () => {
    setDetecting(true)
    setSelectedIds(new Set())
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
      onCreated()
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
  }, [importDirectory, onCreated, refreshCandidates, toast])

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
  }, [importableCandidates, selectedIds, importBatchLocal, onCreated, refreshCandidates, toast])

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
        <button
          className={`store-tab ${importMode === 'detect' ? 'active' : ''}`}
          onClick={() => setImportMode('detect')}
        >
          <Icons.Refresh size={13} />
          检测导入
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
                <SparkInput
                  placeholder="例如：代码审查助手"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label className="form-label">版本</label>
                <SparkInput
                  placeholder="1.0.0"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label className="form-label">作者</label>
                <SparkInput
                  placeholder="作者名称"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                />
              </div>
              <div className="form-field">
                <label className="form-label">分类</label>
                <SparkSelect
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
                </SparkSelect>
              </div>
            </div>
          </div>

          <div className="create-form-section">
            <div className="create-section-title">描述与标签</div>
            <div className="form-field">
              <label className="form-label">
                简短描述 <span className="required">*</span>
              </label>
              <SparkTextarea
                rows={3}
                placeholder="一句话描述 Skill 的功能，例如：自动化代码审查，检测潜在 Bug 和安全问题"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label className="form-label">标签（逗号分隔）</label>
              <SparkInput
                placeholder="code-review, security, quality"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label className="form-label">所需工具（逗号分隔）</label>
              <SparkInput
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
              <SparkTextarea
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
      ) : importMode === 'directory' ? (
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
      ) : (
        /* ── Detect & Import Local Skills ── */
        <div>
          <div className="row" style={{ marginBottom: '12px', gap: '8px' }}>
            <button
              className="btn primary"
              onClick={() => void handleDetectLocal()}
              disabled={detecting || isImporting}
            >
              <Icons.Refresh size={12} /> {detecting ? '检测中...' : '检测本地 Skill'}
            </button>
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
            </div>
          )}

          {localCandidates.length === 0 && !detecting && (
            <div className="empty-state">
              <div className="empty-icon"><Icons.Refresh /></div>
              <div className="empty-title">点击上方按钮检测本地 Skill</div>
              <div className="empty-desc">
                扫描本地目录中包含 SKILL.md 的 Skill，一键批量导入
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
