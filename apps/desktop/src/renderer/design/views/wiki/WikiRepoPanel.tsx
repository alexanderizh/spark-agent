/**
 * WikiRepoPanel — Repo Wiki 标签页（S4：代码仓库 → 结构化知识页，可重建）。
 *
 * 与知识库 Tab 的关键差异（方案 §4.1 / §11.1）：
 *   - 内容**派生自代码**，可随代码变更重建，因此生成页默认**只读**
 *     （source_type='repo-scan'，本面板不给编辑器）；
 *   - 用户可「转人工维护」或「忽略该页」——此后重建一律跳过，人的改动
 *     不会被自动内容冲掉（所有权由后端 source_type 承载，不靠前端状态）；
 *   - **漂移可感知**：空间记录生成时的 repo_rev，与当前 HEAD 比较，
 *     落后提交数超过设置阈值即提示重建；
 *   - `repo/mode='auto'` 时，打开本面板若检测到漂移会自动重建
 *     （不挂后台调度器：自动触发发生在用户可见的时刻，成本与预期都明确）；
 *   - 模块页（repo-module-*）与综述页（repo-overview）展示「AI 导读」块（WikiRepoEnrich）：扫描/重建后
 *     自动增强（总闸 repo/enrich/enabled），或经入口行 / ↻ 单页生成（不受闸限制）。
 *
 * 写入纪律：扫描 / 重建 / 所有权切换全部走 wiki:repo:* IPC，渲染端不直接
 * 拼装扫描参数或绕过服务栈。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Dropdown, Modal, Spin } from 'antd'
import type { MenuProps } from 'antd'
import type {
  WikiPageDetail,
  WikiPageMeta,
  WikiRepoDriftStatus,
  WikiRepoEnrichmentProgress,
  WikiRepoEnrichmentRunReceipt,
  WikiRepoEnrichmentSection,
  WikiRepoPageOwnership,
  WikiSpaceSummary,
  WorkspaceInfo,
} from '@spark/protocol'
import { Icons } from '../../Icons'
import { useToast } from '../../components/Toast'
import { useIpcInvoke } from '../../hooks/useIpc'
import { MarkdownText } from '../chat/ChatMarkdown'
import { WikiRepoEnrichBlock, WikiRepoEnrichPill } from './WikiRepoEnrich'
import { WikiPageTree, buildWikiTree, filterWikiTree, findAncestorIds } from './WikiPageTree'

const OWNERSHIP_LABEL: Record<WikiRepoPageOwnership, string> = {
  generated: '生成态（可重建）',
  manual: '人工维护（不再重建）',
  ignored: '已忽略（不再重建）',
}

const DEFAULT_IGNORE_TEXT = 'node_modules\ndist\nbuild\nout\n.git'

export interface WikiRepoPanelProps {
  /** 空间集合变化后回调（供外层刷新 Badge / 空间列表） */
  onChanged: () => void
}

export function WikiRepoPanel({ onChanged }: WikiRepoPanelProps) {
  const { toast } = useToast()
  const { invoke: listSpaces } = useIpcInvoke('wiki:space:list')
  const { invoke: listPages } = useIpcInvoke('wiki:page:list')
  const { invoke: getPage } = useIpcInvoke('wiki:page:get')
  const { invoke: scanRepo } = useIpcInvoke('wiki:repo:scan')
  const { invoke: rebuildRepo } = useIpcInvoke('wiki:repo:rebuild')
  const { invoke: repoStatus } = useIpcInvoke('wiki:repo:status')
  const { invoke: setOwnership } = useIpcInvoke('wiki:repo:page:ownership')
  const { invoke: getEnrichment } = useIpcInvoke('wiki:repo:enrichment:get')
  const { invoke: runEnrichment } = useIpcInvoke('wiki:repo:enrichment:run')
  const { invoke: enrichStatus } = useIpcInvoke('wiki:repo:enrichment:status')

  const [spaces, setSpaces] = useState<WikiSpaceSummary[]>([])
  const [spacesLoading, setSpacesLoading] = useState(true)
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null)
  const [pages, setPages] = useState<WikiPageMeta[]>([])
  const [pagesLoading, setPagesLoading] = useState(false)
  const [activePageId, setActivePageId] = useState<string | null>(null)
  const [page, setPage] = useState<WikiPageDetail | null>(null)
  const [pageLoading, setPageLoading] = useState(false)
  const [treeQuery, setTreeQuery] = useState('')
  const [drift, setDrift] = useState<WikiRepoDriftStatus | null>(null)
  const [ownership, setOwnershipState] = useState<WikiRepoPageOwnership>('generated')
  const [scanning, setScanning] = useState(false)
  /** 当前页 AI 导读：undefined=查询中（不渲染）/ null=无导读 / 对象=有导读 */
  const [enrichSection, setEnrichSection] = useState<WikiRepoEnrichmentSection | null | undefined>(
    undefined,
  )
  /** 用户主动触发的单页生成进行中（run 回执即完成，骨架窗口 = await 期间） */
  const [pageEnriching, setPageEnriching] = useState(false)
  /** 空间级自动增强进度（扫描/重建后 hook 触发；轮询维护，pill 数据源） */
  const [enrichProgress, setEnrichProgress] = useState<WikiRepoEnrichmentProgress | null>(null)
  const [enrichPolling, setEnrichPolling] = useState(false)
  const [spaceMenuOpen, setSpaceMenuOpen] = useState(false)
  /** 「为仓库生成 Wiki」弹窗 */
  const [scanOpen, setScanOpen] = useState(false)
  const [repoPath, setRepoPath] = useState('')
  const [ignoreText, setIgnoreText] = useState(DEFAULT_IGNORE_TEXT)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const activeSpace = useMemo(
    () => spaces.find((s) => s.id === activeSpaceId) ?? null,
    [spaces, activeSpaceId],
  )

  /** 读取设置（(category,key) 二元组契约）。 */
  const readSetting = useCallback(async (key: string): Promise<unknown> => {
    try {
      const res = await window.spark.invoke('settings:get', { category: 'wiki', key })
      return res.value
    } catch {
      return undefined
    }
  }, [])

  const refreshSpaces = useCallback(async () => {
    setSpacesLoading(true)
    try {
      const res = await listSpaces({ spaceType: 'repo' })
      setSpaces(res.spaces)
      return res.spaces
    } finally {
      setSpacesLoading(false)
    }
  }, [listSpaces])

  const refreshPages = useCallback(
    async (spaceId: string) => {
      setPagesLoading(true)
      try {
        const res = await listPages({ spaceId, includeArchived: true })
        setPages(res.pages)
        return res.pages
      } finally {
        setPagesLoading(false)
      }
    },
    [listPages],
  )

  const refreshDrift = useCallback(
    async (spaceId: string) => {
      try {
        setDrift(await repoStatus({ spaceId }))
      } catch {
        // 漂移是辅助信息：取不到不影响浏览（如 git 运行时不可用）
        setDrift(null)
      }
    },
    [repoStatus],
  )

  // 首屏：加载 repo 空间并选中第一个
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const list = await refreshSpaces()
        if (cancelled) return
        const enabled = await readSetting('repo/enabled')
        if (enabled === false) return
        const first = list[0]
        if (first != null) setActiveSpaceId(first.id)
      } catch (err) {
        if (!cancelled) toast.error(`Repo Wiki 加载失败：${errText(err)}`)
      } finally {
        if (!cancelled) setSpacesLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshSpaces, readSetting, toast])

  // 切换空间：重载页面 + 漂移状态
  useEffect(() => {
    if (activeSpaceId == null) {
      setPages([])
      setActivePageId(null)
      setPage(null)
      setDrift(null)
      return
    }
    setActivePageId(null)
    setPage(null)
    void (async () => {
      try {
        const list = await refreshPages(activeSpaceId)
        const first = list.find((p) => p.status !== 'archived') ?? list[0]
        if (first != null) setActivePageId(first.id)
        await refreshDrift(activeSpaceId)
      } catch (err) {
        toast.error(`页面列表加载失败：${errText(err)}`)
      }
    })()
  }, [activeSpaceId, refreshPages, refreshDrift, toast])

  /**
   * auto 模式：进入面板（或切换空间）后若检测到漂移就自动重建。
   * 去重守卫避免同一空间在一次会话内反复触发（用户也可随时手动重建）。
   */
  const autoRebuiltRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (activeSpaceId == null || drift == null || !drift.stale) return
    if (autoRebuiltRef.current.has(activeSpaceId)) return
    let cancelled = false
    void (async () => {
      const mode = await readSetting('repo/mode')
      if (cancelled || mode !== 'auto') return
      autoRebuiltRef.current.add(activeSpaceId)
      const result = await rebuildRepo({ spaceId: activeSpaceId })
      if (cancelled) return
      if (result.ok) {
        toast.success(`已按最新代码重建（${result.pagesUpdated} 页更新）`)
        await refreshPages(activeSpaceId)
        await refreshDrift(activeSpaceId)
        onChanged()
      } else {
        toast.error(`自动重建失败：${result.message ?? '未知错误'}`)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeSpaceId, drift, readSetting, rebuildRepo, refreshPages, refreshDrift, toast, onChanged])

  // 页面加载 + 所有权推断
  useEffect(() => {
    if (activePageId == null) {
      setPage(null)
      return
    }
    void (async () => {
      setPageLoading(true)
      try {
        const res = await getPage({ pageId: activePageId })
        setPage(res.page)
        const meta = pages.find((p) => p.id === activePageId)
        setOwnershipState(ownershipFromSourceType(meta?.sourceType ?? null))
      } catch (err) {
        toast.error(`页面加载失败：${errText(err)}`)
      } finally {
        setPageLoading(false)
      }
    })()
  }, [activePageId, getPage, pages, toast])

  // ── AI 导读（S0–S2 后端收尾）：页面级读取 / 空间级轮询 / 单页触发 ──

  /** 当前页在目录列表中的元数据（slug / sourceType 判定基础）。 */
  const activePageMeta = useMemo(
    () => pages.find((p) => p.id === activePageId) ?? null,
    [pages, activePageId],
  )

  const refreshEnrichSection = useCallback(async () => {
    if (activePageId == null) return
    try {
      const res = await getEnrichment({ pageId: activePageId })
      setEnrichSection(res.section)
    } catch {
      // 导读是辅助信息：取不到静默当无，不打扰页面主体
      setEnrichSection(null)
    }
  }, [activePageId, getEnrichment])

  // 打开页面：与 getPage 并行拉导读（后端已过滤无效态，null = 无块）
  useEffect(() => {
    if (activePageId == null) {
      setEnrichSection(undefined)
      return
    }
    setEnrichSection(undefined)
    void refreshEnrichSection()
  }, [activePageId, refreshEnrichSection])

  // 切换空间：清页面级导读 + 感知空间级增强是否在跑（在跑则接管轮询）
  useEffect(() => {
    setEnrichProgress(null)
    if (activeSpaceId == null) {
      setEnrichPolling(false)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const p = await enrichStatus({ spaceId: activeSpaceId })
        if (cancelled) return
        setEnrichProgress(p)
        setEnrichPolling(p.running)
      } catch {
        // 进度取不到不影响浏览
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeSpaceId, enrichStatus])

  // 空间级轮询：2s 间隔 → running=false 停轮询，收尾刷新当前页 + 完成 toast
  useEffect(() => {
    if (activeSpaceId == null || !enrichPolling) return
    let stopped = false
    let timer: ReturnType<typeof setInterval> | null = null
    const poll = async (): Promise<void> => {
      try {
        const p = await enrichStatus({ spaceId: activeSpaceId })
        if (stopped) return
        setEnrichProgress(p)
        if (!p.running) {
          setEnrichPolling(false)
          const done = p.ready + p.failed
          if (done > 0) {
            toast.success(
              `AI 导读已生成（${p.ready} 页${p.failed > 0 ? ` / 失败 ${p.failed}` : ''}）`,
            )
          }
          // 当前页若为无导读的模块页：S3 骨架 → S1 正文 / 回 S2 入口
          await refreshEnrichSection()
        }
      } catch {
        // 单次失败不中断轮询（下轮重试）
      }
    }
    void poll()
    timer = setInterval(() => void poll(), 2000)
    return () => {
      stopped = true
      if (timer != null) clearInterval(timer)
    }
  }, [activeSpaceId, enrichPolling, enrichStatus, refreshEnrichSection, toast])

  /** 扫描 / 重建成功后感知自动增强（总闸开时 enrichHook 已 fire-and-forget 启动）。 */
  const checkEnrichAfterScan = useCallback(
    async (spaceId?: string) => {
      const target = spaceId ?? activeSpaceId
      if (target == null) return
      try {
        const p = await enrichStatus({ spaceId: target })
        setEnrichProgress(p)
        if (p.running) {
          setEnrichPolling(true)
          toast.info('AI 导读生成中…')
        }
      } catch {
        // 感知失败不阻塞扫描主流程
      }
    },
    [activeSpaceId, enrichStatus, toast],
  )

  /** 单页强制重跑（入口行 / ↻；不受总闸限制，回执即完成）。 */
  const handleEnrichRun = useCallback(async () => {
    if (activeSpaceId == null || activePageMeta == null) return
    setPageEnriching(true)
    try {
      const receipt = await runEnrichment({ spaceId: activeSpaceId, slug: activePageMeta.slug })
      if (!receipt.ok) {
        toast.error(`AI 导读生成失败：${enrichRunErrorText(receipt)}`)
      } else if (receipt.failed > 0) {
        toast.error('AI 导读生成失败，请稍后重试')
      }
      await refreshEnrichSection()
    } catch (err) {
      toast.error(`AI 导读生成失败：${errText(err)}`)
    } finally {
      setPageEnriching(false)
    }
  }, [activeSpaceId, activePageMeta, refreshEnrichSection, runEnrichment, toast])

  /** 导读槽可见：模块页/综述页 + 生成态（manual/ignored 页后端必返 null，前端先判少一次 IPC）。 */
  const enrichPageKind: 'module' | 'overview' | null =
    activePageMeta != null && ownership === 'generated'
      ? activePageMeta.slug.startsWith('repo-module-')
        ? 'module'
        : activePageMeta.slug === 'repo-overview'
          ? 'overview'
          : null
      : null
  const enrichSlotVisible = enrichPageKind != null
  /** S3/S4 骨架态：用户单页触发中，或空间级增强进行中且本页尚无导读。 */
  const enrichRunning = pageEnriching || (enrichProgress?.running === true && enrichSection == null)

  const treeNodes = useMemo(() => buildWikiTree(pages), [pages])
  // filterWikiTree 返回 { nodes, matchedIds }：命中过滤 + 命中集合一次算出
  const { nodes: visibleNodes, matchedIds } = useMemo(
    () => filterWikiTree(treeNodes, treeQuery),
    [treeNodes, treeQuery],
  )
  // 选中深层页时自动展开其祖先链（Repo Wiki 页面平铺，展开态不必由用户维护）
  const expandedIds = useMemo(
    () =>
      activePageId == null ? new Set<string>() : new Set(findAncestorIds(pages, activePageId)),
    [pages, activePageId],
  )

  const spaceMenu: MenuProps = {
    items: spaces.map((s) => ({ key: s.id, label: s.name })),
    onClick: ({ key }) => setActiveSpaceId(key),
  }

  const handleScan = useCallback(async () => {
    const path = repoPath.trim()
    if (path.length === 0) {
      toast.error('请填写仓库路径')
      return
    }
    const ignoreGlobs = ignoreText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    setScanning(true)
    try {
      const result = await scanRepo({ repoPath: path, ignoreGlobs })
      if (!result.ok) {
        toast.error(`扫描失败：${result.message ?? '未知错误'}`)
        return
      }
      toast.success(
        `已生成 Repo Wiki：新增 ${result.pagesCreated} 页` +
          `${result.pagesUpdated > 0 ? ` / 更新 ${result.pagesUpdated} 页` : ''}` +
          `${result.truncated ? '（受文件数上限约束，已截断）' : ''}`,
      )
      setScanOpen(false)
      setRepoPath('')
      const list = await refreshSpaces()
      const target = result.spaceId != null ? list.find((s) => s.id === result.spaceId) : null
      if (target != null) {
        setActiveSpaceId(target.id)
      } else {
        onChanged()
      }
      // 总闸开时 enrichHook 已随扫描启动：感知并接管进度（含新扫空间）
      await checkEnrichAfterScan(result.spaceId ?? undefined)
    } catch (err) {
      toast.error(`扫描失败：${errText(err)}`)
    } finally {
      setScanning(false)
    }
  }, [checkEnrichAfterScan, ignoreText, onChanged, refreshSpaces, repoPath, scanRepo, toast])

  const handleRebuild = useCallback(async () => {
    if (activeSpaceId == null) return
    setScanning(true)
    try {
      const result = await rebuildRepo({ spaceId: activeSpaceId })
      if (!result.ok) {
        toast.error(`重建失败：${result.message ?? '未知错误'}`)
        return
      }
      toast.success(`已重建：${result.pagesUpdated} 页更新 / ${result.pagesSkipped} 页跳过`)
      await refreshPages(activeSpaceId)
      await refreshDrift(activeSpaceId)
      onChanged()
      // 重建同样触发 enrichHook：感知并接管进度
      await checkEnrichAfterScan()
    } catch (err) {
      toast.error(`重建失败：${errText(err)}`)
    } finally {
      setScanning(false)
    }
  }, [
    activeSpaceId,
    checkEnrichAfterScan,
    onChanged,
    rebuildRepo,
    refreshDrift,
    refreshPages,
    toast,
  ])

  const handleOwnership = useCallback(
    async (next: WikiRepoPageOwnership) => {
      if (activePageId == null) return
      try {
        await setOwnership({ pageId: activePageId, ownership: next })
        setOwnershipState(next)
        const label = OWNERSHIP_LABEL[next]
        toast.success(next === 'generated' ? `已恢复${label}` : `已标记为${label}`)
        await refreshPages(activeSpaceId ?? '')
        onChanged()
      } catch (err) {
        toast.error(`切换失败：${errText(err)}`)
      }
    },
    [activePageId, activeSpaceId, onChanged, refreshPages, setOwnership, toast],
  )

  const ownershipMenu: MenuProps = {
    items: (Object.keys(OWNERSHIP_LABEL) as WikiRepoPageOwnership[]).map((key) => ({
      key,
      label: OWNERSHIP_LABEL[key],
    })),
    onClick: ({ key }) => void handleOwnership(key as WikiRepoPageOwnership),
  }

  if (spacesLoading) {
    return (
      <div className="wiki_body">
        <div className="wiki_empty" style={{ minHeight: 200 }}>
          <Spin size="small" />
        </div>
      </div>
    )
  }

  // 空态：一个主动作（为仓库生成 Wiki），不堆特性文案
  if (spaces.length === 0) {
    return (
      <div className="wiki_body">
        <div className="wiki_empty">
          <div className="wiki_empty_graph">
            <svg width="76" height="76" viewBox="0 0 76 76" fill="none" aria-hidden>
              <circle cx="24" cy="20" r="6" fill="var(--primary)" />
              <circle cx="52" cy="32" r="6" stroke="var(--wiki-t3)" strokeWidth="1.5" />
              <circle cx="30" cy="54" r="6" stroke="var(--wiki-t3)" strokeWidth="1.5" />
              <path
                d="M29 23 47 29"
                stroke="var(--wiki-t4)"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <path
                d="M26 26 29 48"
                stroke="var(--wiki-t4)"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div className="wiki_empty_title">为仓库生成 Wiki</div>
          <div className="wiki_empty_desc">
            扫描代码仓库结构，生成总览 / 目录 / 技术栈与各模块页。生成内容可随代码变更重建，
            也可转人工维护。
          </div>
          <button
            type="button"
            className="wiki_btn_primary"
            style={{ height: 30, marginTop: 16 }}
            onClick={() => setScanOpen(true)}
          >
            <Icons.Branch size={14} />
            选择仓库并扫描
          </button>
        </div>

        <WikiScanModal
          open={scanOpen}
          scanning={scanning}
          repoPath={repoPath}
          ignoreText={ignoreText}
          onRepoPath={setRepoPath}
          onIgnoreText={setIgnoreText}
          onCancel={() => setScanOpen(false)}
          onScan={() => void handleScan()}
        />
      </div>
    )
  }

  return (
    <div className="wiki_repo">
      <div className="wiki_repo_rail">
        <div className="wiki_rail_head">
          <span className="wiki_rail_icon">
            <Icons.Branch size={12} />
          </span>
          <Dropdown
            open={spaceMenuOpen}
            onOpenChange={setSpaceMenuOpen}
            menu={spaceMenu}
            trigger={['click']}
          >
            <button
              type="button"
              className="wiki_rail_switcher"
              title="切换仓库"
              aria-label="切换仓库"
            >
              <span className="wiki_rail_name">{activeSpace?.name ?? '选择仓库'}</span>
              <span className="wiki_rail_arrow">
                <Icons.ChevronDown size={12} />
              </span>
            </button>
          </Dropdown>
          <button
            type="button"
            className="wiki_rail_ib wiki_rail_ib_pri"
            title="为仓库生成 Wiki"
            aria-label="为仓库生成 Wiki"
            onClick={() => setScanOpen(true)}
          >
            <Icons.Plus size={15} />
          </button>
        </div>

        <div className="wiki_rail_filter">
          <div className="wiki_search">
            <Icons.Search size={13} />
            <input
              ref={searchInputRef}
              value={treeQuery}
              placeholder="过滤页面"
              aria-label="过滤 Repo Wiki 页面"
              onChange={(e) => setTreeQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="wiki_rail_label">页面 · {pages.length}</div>
        {pagesLoading ? (
          <div className="wiki_hint" style={{ padding: '8px 12px' }}>
            加载页面…
          </div>
        ) : visibleNodes.length === 0 ? (
          <div className="wiki_hint" style={{ padding: '26px 12px', textAlign: 'center' }}>
            {treeQuery.trim().length > 0 ? '未找到匹配页面' : '这个仓库还没有生成页面'}
          </div>
        ) : (
          <WikiPageTree
            nodes={visibleNodes}
            activeId={activePageId}
            expandedIds={expandedIds}
            matchedIds={matchedIds}
            query={treeQuery}
            onToggle={() => undefined}
            onSelect={(target) => setActivePageId(target.id)}
            // Repo Wiki 页面只读：结构性操作一律不提供（不渲染假按钮）
            onCreateChild={noopPage}
            onRename={noopPage}
            onArchive={noopPage}
            onRestore={noopPage}
            onDelete={noopPage}
          />
        )}
      </div>

      <div className="wiki_main">
        <div className="wiki_topbar">
          <div className="wiki_crumb">
            <span className="wiki_crumb_seg">{activeSpace?.name ?? 'Repo Wiki'}</span>
            {page != null && (
              <>
                <span className="wiki_crumb_sep">
                  <Icons.ChevronRight size={11} />
                </span>
                <span className="wiki_crumb_seg is-end">{page.title}</span>
              </>
            )}
          </div>
          <span className="wiki_rail_spacer" />
          {enrichProgress?.running === true && <WikiRepoEnrichPill progress={enrichProgress} />}
          {drift != null && drift.commitsBehind != null && drift.commitsBehind > 0 && (
            <span
              className={`wiki_repo_drift${drift.stale ? ' is-stale' : ''}`}
              title={`生成版本 ${drift.generatedRev ?? '未知'} → 当前 ${drift.currentRev ?? '未知'}`}
            >
              <Icons.Branch size={12} />
              落后 {drift.commitsBehind} 个提交
            </span>
          )}
          <button
            type="button"
            className="wiki_top_ib"
            title="重建（按当前代码重新生成）"
            aria-label="重建"
            disabled={scanning}
            onClick={() => void handleRebuild()}
          >
            <Icons.Refresh size={15} />
          </button>
          {page != null && (
            <Dropdown menu={ownershipMenu} trigger={['click']} placement="bottomRight">
              <button
                type="button"
                className="wiki_top_ib"
                title={`所有权：${OWNERSHIP_LABEL[ownership]}`}
                aria-label="页面所有权"
              >
                <Icons.Shield size={15} />
              </button>
            </Dropdown>
          )}
        </div>

        {pageLoading && page == null ? (
          <div className="wiki_empty" style={{ minHeight: 200 }}>
            <Spin size="small" />
          </div>
        ) : page == null ? (
          <div className="wiki_empty">
            <div className="wiki_empty_title">选择左侧页面查看</div>
          </div>
        ) : (
          <div className="wiki_body">
            <div className="wiki_results_head">
              <span className={`wiki_repo_badge is-${ownership}`}>
                {OWNERSHIP_LABEL[ownership]}
              </span>
              {page.updatedAt > 0 && <span>更新于 {formatTime(page.updatedAt)}</span>}
            </div>
            <div className="wiki_repo_page">
              <h1 className="wiki_repo_title">{page.title}</h1>
              {page.summary.length > 0 && <div className="wiki_repo_summary">{page.summary}</div>}
              {enrichSlotVisible && (
                <WikiRepoEnrichBlock
                  section={enrichSection}
                  running={enrichRunning}
                  onRun={() => void handleEnrichRun()}
                  kind={enrichPageKind}
                />
              )}
              <MarkdownText content={page.body} />
            </div>
            {ownership === 'generated' && (
              <div className="wiki_repo_note">
                这一页由代码扫描生成，下次重建会被覆盖。想自己改？先点右上角盾牌图标「转人工维护」。
              </div>
            )}
          </div>
        )}
      </div>

      <WikiScanModal
        open={scanOpen}
        scanning={scanning}
        repoPath={repoPath}
        ignoreText={ignoreText}
        onRepoPath={setRepoPath}
        onIgnoreText={setIgnoreText}
        onCancel={() => setScanOpen(false)}
        onScan={() => void handleScan()}
      />
    </div>
  )
}

/** 只读树的占位回调：Repo Wiki 页面不提供结构性操作。 */
const noopPage = (_page: WikiPageMeta): void => {
  /*  intentionally empty */
}

/**
 * 「为仓库生成 Wiki」弹窗（空态与顶栏入口共用，消除两份重复 JSX）。
 *
 * 三种来源统一落到 repoPath → wiki:repo:scan：
 *   - 选择文件夹：系统目录选择器（dialog:open-directory），git 与否都可扫；
 *   - 应用内项目：workspace:list 的项目（取 rootPath）；
 *   - 手动输入路径：兜底文本框。
 * 非 git 目录正常扫描，仅漂移检测自动降级（repoRev=null 已有兜底）。
 */
function WikiScanModal(props: {
  open: boolean
  scanning: boolean
  repoPath: string
  ignoreText: string
  onRepoPath: (v: string) => void
  onIgnoreText: (v: string) => void
  onCancel: () => void
  onScan: () => void
}) {
  const { invoke: openDirectory } = useIpcInvoke('dialog:open-directory')
  const { invoke: listWorkspaces } = useIpcInvoke('workspace:list')
  const [source, setSource] = useState<'folder' | 'project' | 'manual'>('folder')
  const [projects, setProjects] = useState<WorkspaceInfo[]>([])
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [browsing, setBrowsing] = useState(false)

  // 每次打开弹窗拉一次项目列表（项目可能在会话间增减，不做跨开合缓存）
  useEffect(() => {
    if (!props.open) return
    let cancelled = false
    setProjectsLoading(true)
    void (async () => {
      try {
        const res = await listWorkspaces({})
        if (!cancelled) setProjects(res.workspaces)
      } catch {
        // 项目列表取不到不阻塞：手动路径仍可用
      } finally {
        if (!cancelled) setProjectsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [props.open, listWorkspaces])

  const browse = async (): Promise<void> => {
    setBrowsing(true)
    try {
      const res = await openDirectory({ title: '选择要生成 Wiki 的文件夹' })
      if (!res.canceled && res.filePath != null && res.filePath.length > 0) {
        props.onRepoPath(res.filePath)
      }
    } catch {
      // 目录选择器失败时回退手动输入路径
    } finally {
      setBrowsing(false)
    }
  }

  const tabs: Array<{ key: typeof source; label: string }> = [
    { key: 'folder', label: '选择文件夹' },
    { key: 'project', label: '应用内项目' },
    { key: 'manual', label: '手动输入路径' },
  ]

  return (
    <Modal
      className="wiki_modal"
      title="为仓库生成 Wiki"
      open={props.open}
      onCancel={props.onCancel}
      onOk={props.onScan}
      okText="开始扫描"
      cancelText="取消"
      confirmLoading={props.scanning}
    >
      <div className="wiki_repo_form">
        <div className="wiki_repo_tabs" role="tablist" aria-label="选择扫描来源">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={source === t.key}
              className={`wiki_repo_tab${source === t.key ? ' is-active' : ''}`}
              onClick={() => setSource(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {source === 'folder' && (
          <div className="wiki_repo_field">
            <span className="wiki_repo_label">本地文件夹</span>
            <div className="wiki_repo_pick">
              <input value={props.repoPath} placeholder="点击「浏览…」选择文件夹" readOnly />
              <button
                type="button"
                className="wiki_btn_ghost"
                disabled={browsing}
                onClick={() => void browse()}
              >
                {browsing ? '打开中…' : '浏览…'}
              </button>
            </div>
          </div>
        )}

        {source === 'project' && (
          <div className="wiki_repo_field">
            <span className="wiki_repo_label">应用内项目</span>
            <select
              className="wiki_repo_select"
              aria-label="选择应用内项目"
              value={projects.some((p) => p.rootPath === props.repoPath) ? props.repoPath : ''}
              onChange={(e) => props.onRepoPath(e.target.value)}
            >
              <option value="">{projectsLoading ? '加载项目…' : '选择项目…'}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.rootPath}>
                  {p.name}
                </option>
              ))}
            </select>
            {props.repoPath.length > 0 && (
              <div className="wiki_repo_tip" style={{ marginTop: 4 }}>
                将扫描：{props.repoPath}
              </div>
            )}
          </div>
        )}

        {source === 'manual' && (
          <label className="wiki_repo_field">
            <span className="wiki_repo_label">仓库路径</span>
            <input
              value={props.repoPath}
              placeholder="例如 /Users/me/projects/my-repo"
              onChange={(e) => props.onRepoPath(e.target.value)}
            />
          </label>
        )}

        <label className="wiki_repo_field">
          <span className="wiki_repo_label">忽略路径（每行一条）</span>
          <textarea
            value={props.ignoreText}
            rows={5}
            onChange={(e) => props.onIgnoreText(e.target.value)}
          />
        </label>
        <div className="wiki_repo_tip">
          扫描只读文件名、大小与清单内容，不读取业务源码正文；文件数超上限时会截断并如实告知。
        </div>
      </div>
    </Modal>
  )
}

/** source_type → 所有权（与后端 WIKI_REPO_SOURCE_TYPE_* 常量同口径）。 */
function ownershipFromSourceType(sourceType: string | null): WikiRepoPageOwnership {
  switch (sourceType) {
    case 'repo-scan-manual':
      return 'manual'
    case 'repo-scan-ignored':
      return 'ignored'
    default:
      return 'generated'
  }
}

/** 导读 run 回执失败原因 → 用户可读文案（单页 run 不受总闸限制，无 disabled 分支）。 */
function enrichRunErrorText(receipt: WikiRepoEnrichmentRunReceipt): string {
  switch (receipt.reason) {
    case 'busy':
      return '该空间的导读正在生成中，请稍候'
    case 'no_provider':
      return '没有可用的导读模型渠道，请先在设置中配置模型'
    case 'no_rev':
      return '空间未记录代码版本，请先完成一次扫描'
    case 'not_repo_space':
      return '空间不存在或不是 Repo Wiki 空间'
    case 'no_repo_path':
      return '空间未关联仓库路径'
    case 'no_pages':
      return '没有可增强的页面'
    default:
      return receipt.message ?? '未知错误'
  }
}

function formatTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`
}

function errText(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
