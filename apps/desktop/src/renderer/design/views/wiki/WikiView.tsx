/**
 * WikiView — 知识库 / Wiki 主视图（重设计稿 v3）。
 *
 * 布局：
 *   顶部 Tab：知识库 | Repo Wiki（space_type 分流；repo/enabled 关闭时隐藏）
 *   ┌ 左栏 252px：空间切换器（名称 + 箭头）→ 过滤框（⌘K）→
 *   │             层级树（1px 引导线 / 类型色点 / hover 行内操作）→
 *   │             底部固定：归档 · 候选区 · 技能提议 · 知识库设置
 *   └ 主区：46px 单顶栏（面包屑 + 检索框 + 历史 + 更多）→ 检索结果 / 空态 /
 *            阅读态（WikiPagePanel）| 候选区 | 技能提议区 | Repo Wiki 面板
 *
 * 选择语言（全应用统一）：填充 = 选中，实心主色 = 主动作，中性描边 = 次动作。
 *
 * 写入纪律：全部写操作走 wiki:* IPC → 主进程 WikiWriteService（统一写入原语：
 * CAS + 版本记录 + FTS 同事务 + indexReady 回执），渲染端不自行拼装存储语义。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Dropdown, Modal } from 'antd'
import type { MenuProps } from 'antd'
import type {
  WikiBacklinkEntry,
  WikiPageDetail,
  WikiPageKind,
  WikiPageMeta,
  WikiPageVersionEntry,
  WikiSearchHitItem,
  WikiSpaceSummary,
} from '@spark/protocol'
import { Icons } from '../../Icons'
import { useApp } from '../../AppContext'
import { useToast } from '../../components/Toast'
import { useIpcInvoke } from '../../hooks/useIpc'
import { WikiPagePanel, type WikiPagePatch } from './WikiPagePanel'
import {
  WikiPageTree,
  buildWikiTree,
  filterArchivedTree,
  filterWikiTree,
  findAncestorIds,
} from './WikiPageTree'
import { WikiVersionHistory } from './WikiVersionHistory'
import { WikiCandidatePanel } from './WikiCandidatePanel'
import { WikiSkillPanel } from './WikiSkillPanel'
import { WikiRepoPanel } from './WikiRepoPanel'
import './wiki.less'

const KIND_OPTIONS: Array<{ value: WikiPageKind; label: string }> = [
  { value: 'knowledge', label: '知识' },
  { value: 'experience', label: '经验' },
  { value: 'pattern', label: '模式' },
  { value: 'reference', label: '参考' },
  { value: 'note', label: '随笔' },
]

type PageDialogState =
  | { mode: 'create'; parentId: string | null; title: string; kind: WikiPageKind }
  | { mode: 'rename'; pageId: string; title: string; kind: WikiPageKind }
  | null

/**
 * 新建页面的初始正文。
 *
 * WikiWriteService.createPage 拒绝空正文（"新建页面必须提供正文"：contentless FTS
 * 不建空行、正文文件也不该是 0 字节），所以这里必须给一个非空种子。用单个换行而不是
 * 占位文字：渲染后仍是空白页，WikiPagePanel 的「这一页还没有正文」引导态照常出现，
 * 用户从编辑态写进去的就是自己的内容，不用先删掉模板。
 */
const NEW_PAGE_BODY_SEED = '\n'

/** 空态主图形：三节点知识网络（扁平，无渐变无光晕，守项目扁平约定）。 */
function WikiEmptyGraph() {
  return (
    <div className="wiki_empty_graph">
      <svg width="76" height="76" viewBox="0 0 76 76" fill="none" aria-hidden>
        <path d="M26 24 48 38" stroke="var(--wiki-t4)" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M48 38 24 54" stroke="var(--wiki-t4)" strokeWidth="1.5" strokeLinecap="round" />
        <path
          d="M26 24 24 54"
          stroke="var(--wiki-t4)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray="3 4"
        />
        <circle cx="26" cy="24" r="7.5" fill="var(--primary)" />
        <circle cx="48" cy="38" r="5.5" stroke="var(--wiki-t3)" strokeWidth="1.5" />
        <circle cx="24" cy="54" r="4" fill="var(--wiki-t4)" />
      </svg>
    </div>
  )
}

export function WikiView() {
  const { toast } = useToast()
  const { setTweak } = useApp()
  const { invoke: listSpaces } = useIpcInvoke('wiki:space:list')
  const { invoke: createSpace } = useIpcInvoke('wiki:space:create')
  const { invoke: listPages } = useIpcInvoke('wiki:page:list')
  const { invoke: getPage } = useIpcInvoke('wiki:page:get')
  const { invoke: createPage } = useIpcInvoke('wiki:page:create')
  const { invoke: updatePage } = useIpcInvoke('wiki:page:update')
  const { invoke: archivePage } = useIpcInvoke('wiki:page:archive')
  const { invoke: restorePage } = useIpcInvoke('wiki:page:restore')
  const { invoke: deletePage } = useIpcInvoke('wiki:page:delete')
  const { invoke: pageHistory } = useIpcInvoke('wiki:page:history')
  const { invoke: readRevision } = useIpcInvoke('wiki:page:revision:read')
  const { invoke: restoreRevision } = useIpcInvoke('wiki:page:revision:restore')
  const { invoke: pageBacklinks } = useIpcInvoke('wiki:page:backlinks')
  const { invoke: searchWiki } = useIpcInvoke('wiki:search')
  const { invoke: listCandidates } = useIpcInvoke('wiki:candidate:list')
  const { invoke: listSkillProposals } = useIpcInvoke('wiki:skill:list')
  const { invoke: listSessions } = useIpcInvoke('session:list')

  const [spaces, setSpaces] = useState<WikiSpaceSummary[]>([])
  const [spacesLoading, setSpacesLoading] = useState(true)
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null)
  const [pages, setPages] = useState<WikiPageMeta[]>([])
  const [pagesLoading, setPagesLoading] = useState(false)
  const [activePageId, setActivePageId] = useState<string | null>(null)
  const [page, setPage] = useState<WikiPageDetail | null>(null)
  const [pageLoading, setPageLoading] = useState(false)
  const [pageError, setPageError] = useState('')
  const [saving, setSaving] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [treeQuery, setTreeQuery] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [hits, setHits] = useState<WikiSearchHitItem[] | null>(null)
  const [searchBusy, setSearchBusy] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [versions, setVersions] = useState<WikiPageVersionEntry[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [backlinks, setBacklinks] = useState<WikiBacklinkEntry[] | undefined>(undefined)
  const [spaceDialogOpen, setSpaceDialogOpen] = useState(false)
  const [spaceName, setSpaceName] = useState('')
  const [dialog, setDialog] = useState<PageDialogState>(null)
  /** 归档视图：只看已归档页（含其非归档后代），再点一次返回全部页面。 */
  const [archivedOnly, setArchivedOnly] = useState(false)
  /** 面板编辑态提升到此处：顶栏「更多 → 编辑」与面板内 ⌘S / Esc 共用。 */
  const [panelEditing, setPanelEditing] = useState(false)
  const [spaceMenuOpen, setSpaceMenuOpen] = useState(false)
  // 顶层 Tab：知识库（manual 空间）| Repo Wiki（space_type='repo'，S4）
  const [repoEnabled, setRepoEnabled] = useState(true)
  const [mainTab, setMainTab] = useState<'wiki' | 'repo'>('wiki')
  // 知识库 Tab 内的三种互斥视图：页面 / 候选区（S2）/ 技能提议区（S3）
  const [candidateView, setCandidateView] = useState(false)
  const [skillView, setSkillView] = useState(false)
  const [candidateCount, setCandidateCount] = useState(0)
  const [skillCount, setSkillCount] = useState(0)
  const [sessions, setSessions] = useState<
    Array<{ id: string; title: string; turnCount?: number }>
  >([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const activeSpace = useMemo(
    () => spaces.find((s) => s.id === activeSpaceId) ?? null,
    [spaces, activeSpaceId],
  )

  /** 空间加载：空库时按设置 space/autoCreate 自动建「我的知识库」。 */
  const refreshSpaces = useCallback(
    async (autoCreateAllowed: boolean): Promise<WikiSpaceSummary[]> => {
      // 只取 manual 空间：repo 空间由 Repo Wiki Tab 自己按 spaceType 过滤加载，
      // 混在一起会让"我的知识库"里出现一堆代码仓库条目。
      const res = await listSpaces({ spaceType: 'manual' })
      if (res.spaces.length > 0 || !autoCreateAllowed) {
        setSpaces(res.spaces)
        return res.spaces
      }
      try {
        await createSpace({ scope: 'user', name: '我的知识库', description: '' })
      } catch {
        // 并发创建撞唯一名：忽略，下面重取即可拿到既有空间
      }
      const retry = await listSpaces({})
      setSpaces(retry.spaces)
      return retry.spaces
    },
    [listSpaces, createSpace],
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        let autoCreate = true
        try {
          const raw = await window.spark.invoke('settings:get', {
            category: 'wiki',
            key: 'space/autoCreate',
          })
          if (typeof raw.value === 'boolean') autoCreate = raw.value
        } catch {
          // 设置不可读时按默认（自动建空间）继续
        }
        const list = await refreshSpaces(autoCreate)
        if (cancelled) return
        const preferred = list.find((s) => s.scope === 'user') ?? list[0]
        if (preferred != null) setActiveSpaceId(preferred.id)
      } catch (err) {
        if (!cancelled) toast.error(`知识库空间加载失败：${errorText(err)}`)
      } finally {
        if (!cancelled) setSpacesLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshSpaces, toast])

  const refreshPages = useCallback(
    async (spaceId: string, keepActive = true) => {
      setPagesLoading(true)
      try {
        // includeArchived：归档页必须可见，否则用户无法取消归档或彻底删除
        // （归档是软删除，界面上要留得回来）。
        const res = await listPages({ spaceId, includeArchived: true })
        setPages(res.pages)
        if (!keepActive) setActivePageId(null)
        return res.pages
      } finally {
        setPagesLoading(false)
      }
    },
    [listPages],
  )

  useEffect(() => {
    if (activeSpaceId == null) {
      setPages([])
      setActivePageId(null)
      return
    }
    setActivePageId(null)
    setPage(null)
    setArchivedOnly(false)
    void (async () => {
      try {
        const list = await refreshPages(activeSpaceId)
        const first = list[0]
        if (first != null) setActivePageId(first.id)
      } catch (err) {
        toast.error(`页面列表加载失败：${errorText(err)}`)
      }
    })()
  }, [activeSpaceId, refreshPages, toast])

  /** 候选区待确认数量（导航 Badge；确认 / 拒绝 / 沉淀后由调用方刷新）。 */
  const refreshCandidateCount = useCallback(async () => {
    try {
      const res = await listCandidates({ status: 'pending' })
      setCandidateCount(res.pendingTotal)
    } catch {
      // Badge 是辅助信息，加载失败不影响主流程
    }
  }, [listCandidates])

  useEffect(() => {
    void refreshCandidateCount()
  }, [refreshCandidateCount])

  /** 技能提议待确认数量（S3 Badge）。 */
  const refreshSkillCount = useCallback(async () => {
    try {
      const res = await listSkillProposals({ status: 'pending' })
      setSkillCount(res.pendingTotal)
    } catch {
      // Badge 是辅助信息，加载失败不影响主流程
    }
  }, [listSkillProposals])

  useEffect(() => {
    void refreshSkillCount()
  }, [refreshSkillCount])

  /** repo/enabled 关闭时隐藏 Repo Wiki Tab（设置项即时生效，不做假开关）。 */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await window.spark.invoke('settings:get', {
          category: 'wiki',
          key: 'repo/enabled',
        })
        if (cancelled) return
        if (typeof res.value === 'boolean') setRepoEnabled(res.value)
      } catch {
        // 设置不可读时按默认（启用）继续
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /** 会话列表（「从对话沉淀」选择器用；按需加载，不进常驻路径）。 */
  const loadSessions = useCallback(async () => {
    setSessionsLoading(true)
    try {
      const res = await listSessions({ limit: 50 })
      setSessions(
        res.sessions.map((s) => ({
          id: s.id,
          title: s.title,
          ...(s.turnCount != null ? { turnCount: s.turnCount } : {}),
        })),
      )
    } catch (err) {
      toast.error(`会话列表加载失败：${errorText(err)}`)
    } finally {
      setSessionsLoading(false)
    }
  }, [listSessions, toast])

  const loadPage = useCallback(
    async (pageId: string) => {
      setPageLoading(true)
      setPageError('')
      try {
        const res = await getPage({ pageId })
        setPage(res.page)
      } catch (err) {
        setPage(null)
        setPageError(`页面加载失败：${errorText(err)}`)
      } finally {
        setPageLoading(false)
      }
    },
    [getPage],
  )

  useEffect(() => {
    if (activePageId == null) {
      setPage(null)
      return
    }
    void loadPage(activePageId)
  }, [activePageId, loadPage])

  // 选中深层页时自动展开其祖先路径（首次进入也能看到所在位置）
  const prevPageRef = useRef<string | null>(null)
  useEffect(() => {
    if (activePageId == null || activePageId === prevPageRef.current) return
    prevPageRef.current = activePageId
    const ancestors = findAncestorIds(pages, activePageId)
    if (ancestors.length === 0) return
    setExpandedIds((prev) => {
      const next = new Set(prev)
      for (const id of ancestors) next.add(id)
      return next
    })
  }, [activePageId, pages])

  /** 树数据：构建 → 标题过滤 →（可选）归档视图过滤。 */
  const { nodes: treeNodes, matchedIds } = useMemo(() => {
    const built = buildWikiTree(pages)
    const filtered = filterWikiTree(built, treeQuery)
    return {
      nodes: archivedOnly ? filterArchivedTree(filtered.nodes) : filtered.nodes,
      matchedIds: filtered.matchedIds,
    }
  }, [pages, treeQuery, archivedOnly])

  const archivedCount = useMemo(() => pages.filter((p) => p.status === 'archived').length, [pages])

  /** 面包屑分段：空间 / 父页 / … / 当前页（结构化渲染，当前段加粗）。 */
  const crumbSegments = useMemo<string[]>(() => {
    if (activeSpace == null) return []
    if (page == null) return [activeSpace.name]
    const byId = new Map(pages.map((p) => [p.id, p]))
    const chain: string[] = [page.title]
    let cursor = page.parentId
    while (cursor != null) {
      const parent = byId.get(cursor)
      if (parent == null) break
      chain.unshift(parent.title)
      cursor = parent.parentId
    }
    return [activeSpace.name, ...chain]
  }, [page, pages, activeSpace])

  // ⌘K / Ctrl+K 聚焦主区检索框（不做全屏命令面板，先保证快捷键有确定行为）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /** 保存：CAS 冲突时重取最新版本并提示，绝不静默覆盖他人改动。 */
  const handleSave = useCallback(
    async (patch: WikiPagePatch): Promise<boolean> => {
      if (page == null) return false
      setSaving(true)
      setPageError('')
      try {
        const res = await updatePage({
          pageId: page.id,
          expectedVersion: page.version,
          ...patch,
        })
        await loadPage(page.id)
        if (activeSpaceId != null) await refreshPages(activeSpaceId)
        if (!res.indexReady) {
          toast.warning('已保存，但全文索引尚未就绪：检索可能暂时查不到该页')
        } else {
          toast.success('已保存')
        }
        return true
      } catch (err) {
        const message = errorText(err)
        if (message.includes('版本') || message.includes('冲突')) {
          await loadPage(page.id)
          setPageError('该页已被其他改动更新，已为你重新加载最新版本，请重新编辑。')
        } else {
          setPageError(`保存失败：${message}`)
        }
        toast.error(`保存失败：${message}`)
        return false
      } finally {
        setSaving(false)
      }
    },
    [page, updatePage, loadPage, refreshPages, activeSpaceId, toast],
  )

  const submitDialog = useCallback(async () => {
    if (dialog == null) return
    const title = dialog.title.trim()
    if (title.length === 0) {
      toast.error('标题不能为空')
      return
    }
    try {
      if (dialog.mode === 'create') {
        if (activeSpaceId == null) return
        const res = await createPage({
          spaceId: activeSpaceId,
          title,
          kind: dialog.kind,
          body: NEW_PAGE_BODY_SEED,
          ...(dialog.parentId != null ? { parentId: dialog.parentId } : {}),
        })
        await refreshPages(activeSpaceId)
        setActivePageId(res.id)
        if (dialog.parentId != null) {
          setExpandedIds((prev) => new Set(prev).add(dialog.parentId!))
        }
        toast.success('已创建页面')
      } else {
        setSaving(true)
        await updatePage({
          pageId: dialog.pageId,
          expectedVersion: pages.find((p) => p.id === dialog.pageId)?.version ?? 1,
          title,
        })
        if (activeSpaceId != null) await refreshPages(activeSpaceId)
        if (activePageId === dialog.pageId) await loadPage(dialog.pageId)
        toast.success('已重命名')
      }
      setDialog(null)
    } catch (err) {
      toast.error(`${dialog.mode === 'create' ? '创建' : '重命名'}失败：${errorText(err)}`)
    } finally {
      setSaving(false)
    }
  }, [
    dialog,
    activeSpaceId,
    createPage,
    updatePage,
    refreshPages,
    loadPage,
    activePageId,
    pages,
    toast,
  ])

  const handleArchive = useCallback(
    (target: WikiPageMeta) => {
      Modal.confirm({
        title: `归档「${target.title}」？`,
        content: '归档后该页从目录树与检索中隐藏，历史版本与正文文件保留。',
        okText: '归档',
        cancelText: '取消',
        onOk: async () => {
          try {
            await archivePage({ pageId: target.id })
            if (activeSpaceId != null) await refreshPages(activeSpaceId)
            if (activePageId === target.id) {
              setActivePageId(null)
              setPage(null)
            }
            toast.success('已归档')
          } catch (err) {
            toast.error(`归档失败：${errorText(err)}`)
          }
        },
      })
    },
    [archivePage, refreshPages, activeSpaceId, activePageId, toast],
  )

  // 反向链接随当前页变化重取；undefined 期间不渲染区块（避免"没有引用"误报）
  useEffect(() => {
    if (page == null) {
      setBacklinks(undefined)
      return
    }
    let cancelled = false
    setBacklinks(undefined)
    void (async () => {
      try {
        const res = await pageBacklinks({ pageId: page.id })
        if (!cancelled) setBacklinks(res.items)
      } catch {
        // 反链是辅助信息：失败时保持未加载态，不打断主阅读路径
        if (!cancelled) setBacklinks(undefined)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [page?.id, page?.version, pageBacklinks])

  const handleRestore = useCallback(
    (target: WikiPageMeta) => {
      void (async () => {
        try {
          await restorePage({ pageId: target.id })
          if (activeSpaceId != null) await refreshPages(activeSpaceId)
          toast.success('已取消归档')
        } catch (err) {
          toast.error(`取消归档失败：${errorText(err)}`)
        }
      })()
    },
    [restorePage, refreshPages, activeSpaceId, toast],
  )

  const handleDelete = useCallback(
    (target: WikiPageMeta) => {
      Modal.confirm({
        title: `永久删除「${target.title}」？`,
        content: '删除会同时清理正文文件与全部历史版本快照，不可恢复。若只是暂时不用，请改用归档。',
        okText: '永久删除',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: async () => {
          try {
            const receipt = await deletePage({ pageId: target.id })
            if (activeSpaceId != null) await refreshPages(activeSpaceId, activePageId !== target.id)
            if (activePageId === target.id) {
              setActivePageId(null)
              setPage(null)
            }
            // 文件/快照清理未完成时如实告知，不假装彻底删干净
            const pending = [
              receipt.fileCleaned ? null : '正文文件',
              receipt.revisionsCleaned ? null : '历史快照',
            ].filter((v): v is string => v != null)
            if (pending.length > 0) {
              toast.warning(`已删除，但${pending.join('与')}清理未完成（可稍后重试删除或手动清理）`)
            } else {
              toast.success('已删除')
            }
          } catch (err) {
            toast.error(`删除失败：${errorText(err)}`)
          }
        },
      })
    },
    [deletePage, refreshPages, activeSpaceId, activePageId, toast],
  )

  const openHistory = useCallback(async () => {
    if (page == null) return
    setHistoryOpen(true)
    setVersionsLoading(true)
    try {
      const res = await pageHistory({ pageId: page.id })
      setVersions(res.versions)
    } catch (err) {
      setVersions([])
      toast.error(`版本历史加载失败：${errorText(err)}`)
    } finally {
      setVersionsLoading(false)
    }
  }, [page, pageHistory, toast])

  /** 还原历史版本：先读快照预览（用户在弹层里看过），再 CAS 提交。 */
  const handleRestoreVersion = useCallback(
    async (version: number): Promise<boolean> => {
      if (page == null) return false
      try {
        await restoreRevision({ pageId: page.id, version, expectedVersion: page.version })
        await loadPage(page.id)
        if (activeSpaceId != null) await refreshPages(activeSpaceId)
        await openHistory()
        toast.success(`已还原到 v${version}`)
        return true
      } catch (err) {
        toast.error(`还原失败：${errorText(err)}`)
        return false
      }
    },
    [page, restoreRevision, loadPage, refreshPages, activeSpaceId, openHistory, toast],
  )

  const loadRevisionPreview = useCallback(
    async (version: number) => {
      if (page == null) return null
      const res = await readRevision({ pageId: page.id, version })
      return res.revision
    },
    [page, readRevision],
  )

  const runSearch = useCallback(async () => {
    const query = searchQuery.trim()
    if (query.length === 0) {
      setHits(null)
      return
    }
    setSearchBusy(true)
    try {
      const res = await searchWiki({
        query,
        ...(activeSpaceId != null ? { spaceIds: [activeSpaceId] } : {}),
      })
      setHits(res.items)
    } catch (err) {
      setHits([])
      toast.error(`检索失败：${errorText(err)}`)
    } finally {
      setSearchBusy(false)
    }
  }, [searchQuery, searchWiki, activeSpaceId, toast])

  const openResult = useCallback((hit: WikiSearchHitItem) => {
    setActivePageId(hit.id)
    setSearchQuery('')
    setHits(null)
  }, [])

  const submitSpace = useCallback(async () => {
    const name = spaceName.trim()
    if (name.length === 0) {
      toast.error('空间名不能为空')
      return
    }
    try {
      const res = await createSpace({ scope: 'user', name })
      const list = await refreshSpaces(false)
      setSpaceDialogOpen(false)
      setSpaceName('')
      setActiveSpaceId(res.spaceId)
      if (list.length === 0) await refreshSpaces(false)
      toast.success('已创建空间')
    } catch (err) {
      toast.error(`创建空间失败：${errorText(err)}`)
    }
  }, [spaceName, createSpace, refreshSpaces, toast])

  /** 打开设置视图并定位到知识库分区（与设置页内部跳转同一范式）。 */
  const openWikiSettings = useCallback(() => {
    setTweak('view', 'settings')
    setTweak('settingsSection', 'wiki')
  }, [setTweak])

  /** 空间切换菜单：switcher 名称区与顶部图标按钮共用（受控 open 避免两个浮层）。 */
  const spaceMenu = useMemo<MenuProps>(
    () => ({
      items: [
        ...spaces.map((space) => ({
          key: space.id,
          label: space.name,
          disabled: space.id === activeSpaceId,
        })),
        { type: 'divider' as const },
        { key: 'new', label: '新建空间…' },
      ],
      onClick: ({ key }) => {
        setSpaceMenuOpen(false)
        if (key === 'new') {
          setSpaceDialogOpen(true)
          return
        }
        setActiveSpaceId(key)
      },
    }),
    [spaces, activeSpaceId],
  )

  /** 页面级「更多」菜单：编辑入口 / 归档·还原 / 复制链接 / 删除。 */
  const pageMenu = useMemo<MenuProps | null>(() => {
    if (page == null) return null
    const target = pages.find((p) => p.id === page.id)
    const archived = page.status === 'archived'
    return {
      items: [
        { key: 'edit', label: '编辑', disabled: archived },
        archived ? { key: 'restore', label: '取消归档' } : { key: 'archive', label: '归档' },
        { key: 'copy', label: '复制双链' },
        { type: 'divider' },
        { key: 'delete', label: '删除', danger: true },
      ],
      onClick: ({ key, domEvent }) => {
        domEvent.stopPropagation()
        if (key === 'edit') setPanelEditing(true)
        else if (key === 'copy') void navigator.clipboard?.writeText(`[[${page.title}]]`)
        else if (target == null) return
        else if (key === 'archive') handleArchive(target)
        else if (key === 'restore') handleRestore(target)
        else if (key === 'delete') handleDelete(target)
      },
    }
  }, [page, pages, handleArchive, handleRestore, handleDelete])

  const startCreate = useCallback((parentId: string | null) => {
    setDialog({ mode: 'create', parentId, title: '', kind: 'knowledge' })
  }, [])

  const showSpaceEmpty = activeSpaceId == null
  const showFirstRunEmpty = !showSpaceEmpty && pages.length === 0 && page == null && hits == null

  return (
    <div className="wiki_root">
      {/* ── 顶层 Tab：知识库 | Repo Wiki ────────────────────────── */}
      <div className="wiki_tabs" role="tablist" aria-label="知识库视图">
        <button
          type="button"
          role="tab"
          aria-selected={mainTab === 'wiki'}
          className={`wiki_tab${mainTab === 'wiki' ? ' is-active' : ''}`}
          onClick={() => setMainTab('wiki')}
        >
          <Icons.Book size={13} />
          知识库
        </button>
        {repoEnabled && (
          <button
            type="button"
            role="tab"
            aria-selected={mainTab === 'repo'}
            className={`wiki_tab${mainTab === 'repo' ? ' is-active' : ''}`}
            onClick={() => setMainTab('repo')}
          >
            <Icons.Branch size={13} />
            Repo Wiki
          </button>
        )}
      </div>

      {mainTab === 'repo' ? (
        <WikiRepoPanel
          onChanged={() => {
            void refreshSpaces(false)
          }}
        />
      ) : (
        <div className="wiki_workspace">
          {/* ── 左栏 ─────────────────────────────────────────────── */}
          <div className="wiki_rail">
            <div className="wiki_rail_head">
              <span className="wiki_rail_icon">
                <Icons.Book size={12} />
              </span>
              {/* 空间切换唯一入口：名称 + 箭头整块可点。不可再并第二个触发器——
              两个 Dropdown 共享同一 open 状态会同时弹出两份菜单。 */}
              <Dropdown
                open={spaceMenuOpen}
                onOpenChange={setSpaceMenuOpen}
                menu={spaceMenu}
                trigger={['click']}
              >
                <button
                  type="button"
                  className="wiki_rail_switcher"
                  title="切换知识库空间"
                  aria-label="切换知识库空间"
                >
                  <span className="wiki_rail_name">
                    {spacesLoading ? '加载中…' : (activeSpace?.name ?? '选择空间')}
                  </span>
                  <span className="wiki_rail_arrow">
                    <Icons.ChevronDown size={12} />
                  </span>
                </button>
              </Dropdown>
              <button
                type="button"
                className="wiki_rail_ib wiki_rail_ib_pri"
                title="新建空间"
                aria-label="新建空间"
                onClick={() => setSpaceDialogOpen(true)}
              >
                <Icons.Plus size={15} />
              </button>
            </div>

            <div className="wiki_rail_filter">
              <div className="wiki_search">
                <Icons.Search size={13} />
                <input
                  value={treeQuery}
                  placeholder="过滤页面"
                  aria-label="过滤页面"
                  onChange={(e) => setTreeQuery(e.target.value)}
                />
                <span className="wiki_kbd">⌘K</span>
              </div>
            </div>

            {candidateView || skillView ? (
              <>
                <div className="wiki_rail_label">
                  {skillView ? '技能提议区' : '候选区'} · {skillView ? skillCount : candidateCount}
                </div>
                <div className="wiki_rail_note">
                  {skillView
                    ? 'Agent 认为某几页知识可固化成技能时，会把草案提到这里。你确认后才生成 SKILL.md 与 PURPOSE.md。'
                    : '抽取产物先落在候选区。在右侧确认后才会成为知识页， 并带上来源轮次与依据片段。'}
                </div>
              </>
            ) : (
              <>
                <div className="wiki_rail_label">
                  {archivedOnly ? '归档' : '页面'} · {pages.length}
                </div>

                {pagesLoading ? (
                  <div className="wiki_hint" style={{ padding: '8px 12px' }}>
                    加载页面…
                  </div>
                ) : treeNodes.length === 0 ? (
                  <div className="wiki_hint" style={{ padding: '26px 12px', textAlign: 'center' }}>
                    {archivedOnly
                      ? '没有已归档的页面'
                      : treeQuery.trim().length > 0
                        ? '未找到匹配页面'
                        : '还没有页面，从右侧创建第一页'}
                  </div>
                ) : (
                  <WikiPageTree
                    nodes={treeNodes}
                    activeId={activePageId}
                    expandedIds={expandedIds}
                    matchedIds={matchedIds}
                    query={treeQuery}
                    onToggle={(id) =>
                      setExpandedIds((prev) => {
                        const next = new Set(prev)
                        if (next.has(id)) next.delete(id)
                        else next.add(id)
                        return next
                      })
                    }
                    onSelect={(target) => setActivePageId(target.id)}
                    onCreateChild={(target) =>
                      setDialog({
                        mode: 'create',
                        parentId: target.id,
                        title: '',
                        kind: 'knowledge',
                      })
                    }
                    onRename={(target) =>
                      setDialog({
                        mode: 'rename',
                        pageId: target.id,
                        title: target.title,
                        kind: target.kind,
                      })
                    }
                    onArchive={handleArchive}
                    onRestore={handleRestore}
                    onDelete={handleDelete}
                  />
                )}
              </>
            )}

            <div className="wiki_rail_foot">
              <button
                type="button"
                className="wiki_rail_foot_row"
                onClick={() => setArchivedOnly((prev) => !prev)}
              >
                <Icons.Archive size={14} />
                <span>{archivedOnly ? '返回全部页面' : '归档'}</span>
                <span className="wiki_tree_count">{archivedCount}</span>
              </button>
              <button
                type="button"
                className={`wiki_rail_foot_row${candidateView ? ' is-active' : ''}`}
                aria-pressed={candidateView}
                onClick={() => {
                  setHits(null)
                  setSearchQuery('')
                  setSkillView(false)
                  setCandidateView((prev) => !prev)
                }}
              >
                <Icons.Sparkles size={14} />
                <span>候选区</span>
                {candidateCount > 0 && (
                  <span className="wiki_cand_badge">
                    {candidateCount > 99 ? '99+' : candidateCount}
                  </span>
                )}
              </button>
              <button
                type="button"
                className={`wiki_rail_foot_row${skillView ? ' is-active' : ''}`}
                aria-pressed={skillView}
                onClick={() => {
                  setHits(null)
                  setSearchQuery('')
                  setCandidateView(false)
                  setSkillView((prev) => !prev)
                }}
              >
                <Icons.Skills size={14} />
                <span>技能提议</span>
                {skillCount > 0 && (
                  <span className="wiki_cand_badge">{skillCount > 99 ? '99+' : skillCount}</span>
                )}
              </button>
              <button type="button" className="wiki_rail_foot_row" onClick={openWikiSettings}>
                <Icons.Settings size={14} />
                <span>知识库设置</span>
              </button>
            </div>
          </div>

          {/* ── 主区 ─────────────────────────────────────────────── */}
          <div className="wiki_main">
            <div className="wiki_topbar">
              <div className="wiki_crumb">
                {crumbSegments.length === 0 ? (
                  <span className="wiki_crumb_seg">知识库</span>
                ) : (
                  crumbSegments.map((seg, i) => (
                    <span
                      key={`${i}-${seg}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 5 }}
                    >
                      {i > 0 && (
                        <span className="wiki_crumb_sep">
                          <Icons.ChevronRight size={11} />
                        </span>
                      )}
                      <span
                        className={`wiki_crumb_seg${i === crumbSegments.length - 1 ? ' is-end' : ''}`}
                      >
                        {seg}
                      </span>
                    </span>
                  ))
                )}
              </div>
              <span className="wiki_rail_spacer" />
              <div className="wiki_search wiki_topsearch">
                <Icons.Search size={13} />
                <input
                  ref={searchInputRef}
                  value={searchQuery}
                  placeholder="检索知识（回车）"
                  aria-label="检索知识"
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void runSearch()
                  }}
                />
              </div>
              {searchBusy && <span className="wiki_hint">检索中…</span>}
              {!candidateView && !skillView && page != null && (
                <div className="wiki_actions">
                  <button
                    type="button"
                    className="wiki_top_ib"
                    title="版本历史"
                    aria-label="版本历史"
                    onClick={() => void openHistory()}
                  >
                    <Icons.History size={15} />
                  </button>
                  {pageMenu != null && (
                    <Dropdown menu={pageMenu} trigger={['click']} placement="bottomRight">
                      <button
                        type="button"
                        className="wiki_top_ib"
                        title="更多"
                        aria-label="更多操作"
                      >
                        <Icons.More size={15} />
                      </button>
                    </Dropdown>
                  )}
                </div>
              )}
            </div>

            {candidateView ? (
              <WikiCandidatePanel
                spaces={spaces}
                sessions={sessions}
                sessionsLoading={sessionsLoading}
                onRefreshSessions={() => void loadSessions()}
                onPromoted={() => {
                  void refreshCandidateCount()
                  if (activeSpaceId != null) void refreshPages(activeSpaceId)
                }}
              />
            ) : skillView ? (
              <WikiSkillPanel
                onDecided={() => {
                  void refreshSkillCount()
                  if (activeSpaceId != null) void refreshPages(activeSpaceId)
                }}
              />
            ) : hits != null ? (
              <div className="wiki_body">
                <div className="wiki_results_head">
                  检索「<b>{searchQuery.trim()}</b>」命中 {hits.length} 条
                  <span className="wiki_rail_spacer" />
                  <button
                    type="button"
                    className="wiki_btn_ghost"
                    style={{ height: 26 }}
                    onClick={() => {
                      setHits(null)
                      setSearchQuery('')
                    }}
                  >
                    清除
                  </button>
                </div>
                {hits.length === 0 ? (
                  <div className="wiki_empty" style={{ minHeight: 200 }}>
                    <div className="wiki_empty_title">没有命中</div>
                    <div className="wiki_empty_desc">
                      换一个关键词；或先在左侧新建一页把你需要的内容沉淀下来。
                    </div>
                  </div>
                ) : (
                  <div className="wiki_results">
                    {hits.map((hit) => (
                      <div
                        key={hit.id}
                        className="wiki_result_row"
                        role="button"
                        tabIndex={0}
                        onClick={() => openResult(hit)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') openResult(hit)
                        }}
                      >
                        <div className="wiki_result_head">
                          <span className={`wiki_tree_dot k-${hit.kind}`} aria-hidden />
                          <span className="wiki_result_title">{hit.title}</span>
                        </div>
                        {hit.summary.length > 0 && (
                          <div className="wiki_result_summary">{hit.summary}</div>
                        )}
                        <div className="wiki_result_meta">
                          {hit.tags.length > 0 && <span>{hit.tags.join(' · ')}</span>}
                          {hit.tokens > 0 && <span>约 {hit.tokens} token</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : showSpaceEmpty ? (
              <div className="wiki_body">
                <div className="wiki_empty">
                  <WikiEmptyGraph />
                  <div className="wiki_empty_title">创建你的第一座知识库</div>
                  <div className="wiki_empty_desc">
                    知识库用来沉淀可检索、可复用、会随版本演进的知识：Agent 只在需要时按需检索，
                    不会常驻占用上下文。
                  </div>
                  <div className="wiki_empty_cta">
                    <button
                      type="button"
                      className="wiki_btn_primary"
                      onClick={() => setSpaceDialogOpen(true)}
                    >
                      <Icons.Plus size={14} />
                      新建知识库
                    </button>
                  </div>
                </div>
              </div>
            ) : showFirstRunEmpty ? (
              <div className="wiki_body">
                <div className="wiki_empty">
                  <WikiEmptyGraph />
                  <div className="wiki_empty_title">把经验沉淀成可检索的知识</div>
                  <div className="wiki_empty_desc">
                    每一页都是一条独立知识。写完后 Agent 会按需检索，不会常驻占用上下文。
                  </div>
                  <div className="wiki_empty_cta">
                    <button
                      type="button"
                      className="wiki_btn_primary"
                      onClick={() => startCreate(null)}
                    >
                      <Icons.Plus size={14} />
                      新建第一页
                    </button>
                  </div>
                  <div className="wiki_empty_hr" />
                  <div className="wiki_feats">
                    <span className="wiki_feat">
                      <span className="wiki_tree_dot k-knowledge" />
                      Markdown 正文
                    </span>
                    <span className="wiki_feat">
                      <span className="wiki_tree_dot k-reference" />
                      双链与反向链接
                    </span>
                    <span className="wiki_feat">
                      <span className="wiki_tree_dot k-pattern" />
                      版本历史可回滚
                    </span>
                  </div>
                </div>
              </div>
            ) : pageLoading && page == null ? (
              <div className="wiki_body">
                <div className="wiki_empty" style={{ minHeight: 200 }}>
                  <span className="wiki_hint">加载页面…</span>
                </div>
              </div>
            ) : page == null ? (
              <div className="wiki_body">
                <div className="wiki_empty">
                  <WikiEmptyGraph />
                  <div className="wiki_empty_title">
                    {archivedOnly ? '归档是空的' : '选择一个页面开始'}
                  </div>
                  <div className="wiki_empty_desc">
                    {archivedOnly
                      ? '归档页会保留历史版本与正文文件，可随时取消归档。'
                      : '从左侧目录树选择页面；也可以新建一页，或把对话中的经验沉淀进来。'}
                  </div>
                  {!archivedOnly && (
                    <div className="wiki_empty_cta">
                      <button
                        type="button"
                        className="wiki_btn_primary"
                        onClick={() => startCreate(null)}
                      >
                        <Icons.Plus size={14} />
                        新建页面
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="wiki_body">
                <WikiPagePanel
                  page={page}
                  saving={saving}
                  error={pageError}
                  editing={panelEditing}
                  onEditingChange={setPanelEditing}
                  onSave={handleSave}
                  backlinks={backlinks}
                  onOpenBacklink={(pageId) => setActivePageId(pageId)}
                />
              </div>
            )}
          </div>
        </div>
      )}

      <WikiVersionHistory
        open={historyOpen}
        page={page}
        versions={versions}
        loading={versionsLoading}
        onClose={() => setHistoryOpen(false)}
        onPreview={loadRevisionPreview}
        onRestore={handleRestoreVersion}
      />

      <Modal
        open={spaceDialogOpen}
        title="新建知识库空间"
        okText="创建"
        cancelText="取消"
        onOk={() => void submitSpace()}
        onCancel={() => setSpaceDialogOpen(false)}
      >
        <input
          className="wiki_editor_input"
          style={{ width: '100%' }}
          value={spaceName}
          placeholder="如：我的知识库"
          aria-label="空间名称"
          onChange={(e) => setSpaceName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submitSpace()
          }}
        />
      </Modal>

      <Modal
        open={dialog != null}
        title={dialog?.mode === 'rename' ? '重命名页面' : '新建页面'}
        okText={dialog?.mode === 'rename' ? '保存' : '创建'}
        cancelText="取消"
        confirmLoading={saving}
        onOk={() => void submitDialog()}
        onCancel={() => setDialog(null)}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            className="wiki_editor_input"
            style={{ width: '100%' }}
            value={dialog?.title ?? ''}
            placeholder="页面标题"
            aria-label="页面标题"
            onChange={(e) =>
              setDialog((prev) => (prev == null ? prev : { ...prev, title: e.target.value }))
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitDialog()
            }}
          />
          {dialog?.mode === 'create' && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {KIND_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`wiki_tag${dialog.kind === opt.value ? ' is-kind' : ''}`}
                  style={{ cursor: 'pointer', border: 'none', fontFamily: 'inherit' }}
                  onClick={() =>
                    setDialog((prev) => (prev == null ? prev : { ...prev, kind: opt.value }))
                  }
                >
                  <span className={`wiki_tree_dot k-${opt.value}`} aria-hidden />
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
