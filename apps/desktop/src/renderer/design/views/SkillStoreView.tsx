/**
 * SkillStoreView — Skill 管理页面
 *
 * Tab 切换：已安装（Installed）+ 创建（Create）
 * 已安装 Tab：Cursor-style 卡片列表 + 详情双页布局
 * 创建 Tab：手动创建 / 文件导入 / 目录导入 / 检测导入本地 Skill
 */
import { useState, useCallback, useMemo, useEffect } from 'react'
import type { ReactNode } from 'react'
import { Spin, Switch } from 'antd'
import type { LocalSkillCandidate, SkillDetailInfo, SkillItem } from '@spark/protocol'
import { Icons } from '../Icons'
import { ActionIcon, Button, Drawer, Empty, Input, SearchBar, Select, Tag, TextArea } from '@lobehub/ui'
import { MacWindowDragHeader } from '../components/MacWindowDragHeader'
import { useApp } from '../AppContext'
import {
  useSkills,
  parseSkillManifest,
  filterSkills,
  filterCandidates,
  deduplicateSkills,
  deduplicateCandidates,
} from '../utils/skills-data'
import { useIpcInvoke } from '../hooks/useIpc'
import { useRefreshable } from '../hooks/useRefreshable'
import { useToast } from '../components/Toast'
import './SkillStoreView.less'

// ─── Main View ────────────────────────────────────────────────────────
type TabType = 'installed' | 'create'
export const SKILL_STORE_TARGET_TAB_EVENT = 'spark-agent:skill-store-target-tab'
export const SKILL_STORE_TARGET_TAB_STORAGE_KEY = 'spark-agent:skill-store-target-tab'

function isSkillStoreTab(value: unknown): value is TabType {
  return value === 'installed' || value === 'create'
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

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1)
  }, [])

  const triggerRefresh = useRefreshable(handleRefresh)

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

  return (
    <div className="view-body" style={{ position: 'relative' }}>
      <div className="page">
        <MacWindowDragHeader />
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
          <div className="flex items-center store-tabbar-refresh">
            <ActionIcon
              icon={Icons.Refresh}
              size="small"
              variant="borderless"
              onClick={triggerRefresh}
              title="刷新 (Ctrl+R)"
            />
          </div>
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
      { id: 'builtin', title: 'Built-in Skills', skills: builtin },
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

  const openSkillDetail = useCallback((skill: SkillItem) => {
    setPreferredSkillId(skill.id)
    if (isCompact) setMobileDetailVisible(true)
  }, [isCompact])

  const selectedSkill = filteredSkills.find((skill) => skill.id === activeSkillId) ?? null
  const detailLoading = activeSkillId != null && detailState.skillId !== activeSkillId
  const selectedDetail = detailState.skillId === activeSkillId ? detailState.detail : null
  const detailError = detailState.skillId === activeSkillId ? detailState.error : ''

  return (
    <>
      <div className="skill-store-page">
        <div className="skill-store-header">
          <div>
            <div className="strong text-base font-semibold">Skills</div>
            <div className="muted text-xs mt-0.5">
              {total} 个已安装 · {enabledCount} 个已启用
            </div>
          </div>
          <div className="skill-store-actions">
            <SearchBar
              placeholder="搜索已安装的 Skill..."
              value={search}
              onInputChange={(value) => setSearch(value)}
              allowClear
            />
            {!managementMode ? (
              <Button onClick={enterManagement} disabled={total === 0}>
                 管理
              </Button>
            ) : (
              <Button onClick={exitManagement} disabled={deleting}>
                退出管理
              </Button>
            )}
          </div>
        </div>

        {managementMode && (
          <div className="skill-store-mgmt-bar">
            <Icons.CheckSquare size={13} />
            <span>已选择 <span className="mgmt-count">{selectedDeleteIds.size}</span> 个</span>
            <button className="btn sm" onClick={toggleDeleteSelectAll} disabled={deleting}>
              {selectedDeleteIds.size === filteredSkills.length ? '取消全选' : '全选'}
            </button>
            <button
              className="btn sm primary"
              onClick={() => void handleBatchDelete()}
              disabled={selectedDeleteIds.size === 0 || deleting}
            >
              {deleting ? '删除中...' : `删除所选 (${selectedDeleteIds.size})`}
            </button>
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
            {meta.source}
            <span className="skill-store-card-dot" />
            {skill.version}
          </div>
        </div>
        {managementMode && (
          <label className="local-skill-check" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect(skill.id)}
            />
            <span className="checkmark" />
          </label>
        )}
      </div>

      <div className="skill-store-card-desc">{meta.description}</div>

      <div className="skill-store-card-foot">
        <div className="skill-store-card-tags">
          <Tag color={skill.enabled ? 'blue' : 'default'}>
            {skill.enabled ? '可见' : '隐藏'}
          </Tag>
          <Tag>{skill.id.startsWith('builtin:') ? '内置' : '本地'}</Tag>
        </div>
        {!managementMode && (
          <div className="skill-store-card-actions" onClick={(event) => event.stopPropagation()}>
            <Switch
              size="small"
              checked={skill.enabled}
              onChange={() => void onToggle(skill)}
            />
            {!skill.id.startsWith('builtin:') && (
              <Button size="small" danger onClick={() => void onDelete(skill.id)}>
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
}: {
  skill: SkillItem | null
  detail: SkillDetailInfo | null
  loading: boolean
  error: string
}) {
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
      </div>

      <div className="skill-store-detail-meta">
        <DetailStat label="来源" value={manifestMeta.source} />
        <DetailStat label="版本" value={skill.version} />
        <DetailStat label="分类" value={definition?.category || manifestMeta.category || '未分类'} />
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
              <Tag key={tool} color="default">{tool}</Tag>
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
          <pre className="skill-store-prompt-preview">{definition.systemPrompt}</pre>
        </DetailSection>
      )}
    </div>
  )
}

function DetailSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
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
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter((tag): tag is string => typeof tag === 'string') : [],
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

type ImportMode = 'none' | 'file' | 'directory' | 'detect' | 'link'

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
      // 软链接的技能直接注册，其他来源安装到应用内
      if (candidate.source === 'linked') {
        await importDirectory({ directoryPath: candidate.rootPath, source: 'linked' })
      } else {
        await installToApp({ sourcePath: candidate.rootPath })
      }
      toast.success(`已安装 ${candidate.name}`)
      onCreated()
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
  }, [installToApp, importDirectory, onCreated, refreshCandidates, toast])

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
        <button
          className={`store-tab ${importMode === 'link' ? 'active' : ''}`}
          onClick={() => setImportMode('link')}
        >
          <Icons.ExternalLink size={13} />
          软链接
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
      ) : importMode === 'detect' ? (
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
      ) : (
        /* ── Link Host Skill Directory ── */
        <LinkSkillPanel onCreated={onCreated} />
      )}
    </div>
  )
}

/** 软链接技能面板 — 将宿主机上的技能目录通过软链接引入应用 */
function LinkSkillPanel({ onCreated }: { onCreated: () => void }) {
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
    getAppPaths({}).then(setAppPaths).catch(() => {})
  }, [getAppPaths])

  const handleLink = useCallback(async () => {
    if (!linkTarget.trim()) {
      toast.error('请输入或选择技能目录路径')
      return
    }
    setLinking(true)
    try {
      await linkSkill({ targetPath: linkTarget.trim(), ...(linkName.trim() ? { name: linkName.trim() } : {}) })
      toast.success('已创建软链接')
      setLinkTarget('')
      setLinkName('')
      onCreated()
      // 刷新路径信息
      getAppPaths({}).then(setAppPaths).catch(() => {})
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建软链接失败')
    } finally {
      setLinking(false)
    }
  }, [linkTarget, linkName, linkSkill, onCreated, getAppPaths, toast])

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

  const handleUnlink = useCallback(async (name: string) => {
    try {
      await unlinkSkill({ name })
      toast.success(`已取消链接 ${name}`)
      onCreated()
      getAppPaths({}).then(setAppPaths).catch(() => {})
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '取消链接失败')
    }
  }, [unlinkSkill, onCreated, getAppPaths, toast])

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
            <button className="btn" onClick={() => void handleBrowse()}>
              浏览
            </button>
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
        <button
          className="btn primary lg"
          disabled={linking || !linkTarget.trim()}
          onClick={() => void handleLink()}
        >
          <Icons.ExternalLink size={14} />
          {linking ? '链接中...' : '创建软链接'}
        </button>
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
                <button
                  className="btn sm"
                  onClick={() => void handleUnlink(name)}
                >
                  取消链接
                </button>
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
