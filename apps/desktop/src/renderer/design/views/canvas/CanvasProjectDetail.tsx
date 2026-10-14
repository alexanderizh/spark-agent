/**
 * CanvasProjectDetail — 画布项目详情页。
 *
 * 配合侧栏列表（CanvasProjectSidebarList）的「单击选中」交互：
 * 用户在侧栏点项目 → 主区显示详情页 → 详情页里的「打开画布」按钮
 * 才真正在独立窗口打开画布。
 *
 * 布局：顶部完整封面预览 + 标题栏（左标题/右项目操作，
 * 两侧排列垂直居中，超长标题 ellipsis）+ 描述/统计/时间线。
 * 视觉元素沿用 CanvasProjectCard，展开成纵向详情布局。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Checkbox, Modal, Spin, message } from 'antd'
import { Button, Dropdown, Tag, Tooltip } from '@lobehub/ui'
import { Pin, PinOff } from 'lucide-react'
import { Icons } from '../../Icons'
import { translate, useI18n } from '../../i18n'
import { canvasApi } from './canvas.api'
import type { CanvasAsset, CanvasAssetType, CanvasProject } from './canvas.types'

/** 资源瀑布流每页数量，点击「加载更多」累加显示。 */
const ASSET_PAGE_SIZE = 20
/**
 * 批量删除/多选上限。管理页一次选太多既会拖慢 Modal，也会让用户
 * 误以为能「全选一键清理」——参考 CanvasAssetManagerPanel 的 MAX_SELECTION
 * 与 CanvasProviderFilesTab 的 MAX_BATCH_DELETE 收敛在 20。
 */
const MAX_ASSET_SELECTION = 20

/**
 * 取资源可作为项目封面的图片 URL。
 *
 * - 图片：优先 url（原图，与「上传封面」一致），fallback thumbnailUrl
 * - 视频：只能用 thumbnailUrl（视频 url 不能被 <img> 加载，无法做封面）
 * - 都没有：返回 null，调用方据此隐藏「设为封面」入口，避免点了存成坏封面
 */
export function getAssetCoverUrl(asset: CanvasAsset): string | null {
  if (asset.type === 'video') return asset.thumbnailUrl ?? null
  return asset.url ?? asset.thumbnailUrl ?? null
}

export type CanvasProjectDetailProps = {
  project: CanvasProject
  /** 正在独立窗口打开（异步等待中） */
  opening: boolean
  onOpen: (projectId: string) => void
  onEdit: (projectId: string) => void
  onExport: (projectId: string) => void
  onArchive: (projectId: string) => void
  onDelete: (projectId: string) => void
  onOpenFolder: (projectId: string) => void
  onTogglePin: (projectId: string) => void
  /** 点击封面上传/更换封面图（file 已通过类型/大小校验） */
  onUploadCover?: (file: File) => void
  /** 从资源瀑布流「设为封面」：用资源自身的 URL 作为项目封面 */
  onSetCoverFromAsset?: (asset: CanvasAsset) => void
}

function formatDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

/**
 * 资源缩略图——处理图片/视频的不同加载策略与失败占位。
 *
 * - 图片：优先 thumbnailUrl（缩略图，快），fallback url（原图）
 * - 视频：优先 thumbnailUrl；若无（数据层未生成），用 <video> 标签本身渲染
 *   第一帧——`src={url}#t=1` 让 Chromium seek 到第 1 秒并显示画面，
 *   `preload="metadata"` 只下载头部元数据，不全量下载视频。
 *   视频文件的 url 不能用 <img> 加载（必然失败），所以视频必须走 video 分支。
 * - onError：broken link、格式不支持等，切换到图标占位，避免瀑布流塌缩。
 */
function AssetThumbnail({ asset }: { asset: CanvasAsset }) {
  const isVideo = asset.type === 'video'
  const [failed, setFailed] = useState(false)

  // 占位（失败或无可用源）
  if (failed) {
    return (
      <span className="canvas-detail-asset-tile-empty">
        {isVideo ? <Icons.Video size={22} /> : <Icons.Image size={22} />}
      </span>
    )
  }

  if (!isVideo) {
    const thumb = asset.thumbnailUrl ?? asset.url
    if (!thumb) {
      return (
        <span className="canvas-detail-asset-tile-empty">
          <Icons.Image size={22} />
        </span>
      )
    }
    return (
      <img
        src={thumb}
        alt={asset.title ?? ''}
        loading="lazy"
        draggable={false}
        onError={() => setFailed(true)}
      />
    )
  }

  // 视频：优先用 thumbnailUrl（图片，最快）；否则用 <video> 渲染第一帧
  if (asset.thumbnailUrl) {
    return (
      <img
        src={asset.thumbnailUrl}
        alt={asset.title ?? ''}
        loading="lazy"
        draggable={false}
        onError={() => setFailed(true)}
      />
    )
  }
  if (asset.url) {
    return (
      <video
        src={`${asset.url}#t=1`}
        preload="metadata"
        muted
        playsInline
        onError={() => setFailed(true)}
      />
    )
  }
  return (
    <span className="canvas-detail-asset-tile-empty">
      <Icons.Video size={22} />
    </span>
  )
}

export function CanvasProjectDetail({
  project,
  opening,
  onOpen,
  onEdit,
  onExport,
  onArchive,
  onDelete,
  onOpenFolder,
  onTogglePin,
  onUploadCover,
  onSetCoverFromAsset,
}: CanvasProjectDetailProps) {
  // 本文件使用非响应式 translate()：顶层订阅语言变化，保证切换语言后整树重渲染。
  useI18n()
  const coverInputRef = useRef<HTMLInputElement | null>(null)
  const [coverPreviewOpen, setCoverPreviewOpen] = useState(false)
  const [coverFailed, setCoverFailed] = useState(false)
  const hasUsableCover = Boolean(project.coverUrl) && !coverFailed

  useEffect(() => {
    setCoverPreviewOpen(false)
    setCoverFailed(false)
  }, [project.id, project.coverUrl])

  const openCoverPicker = useCallback(() => {
    if (onUploadCover) coverInputRef.current?.click()
  }, [onUploadCover])
  const openCoverPreview = useCallback(() => {
    if (hasUsableCover) setCoverPreviewOpen(true)
  }, [hasUsableCover])
  const handleCoverFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file && onUploadCover) onUploadCover(file)
      e.target.value = '' // 允许重复选同一文件触发 onChange
    },
    [onUploadCover],
  )
  const stats = [
    { label: translate('canvasProjectDetail.t1'), value: project.nodeCount, icon: <Icons.Canvas size={15} /> },
    { label: translate('canvasProjectDetail.t2'), value: project.taskCount, icon: <Icons.Clock size={15} /> },
    { label: translate('canvasProjectDetail.t3'), value: project.assetCount, icon: <Icons.Image size={15} /> },
  ]
  const times = [
    { label: translate('canvasProjectDetail.t4'), value: formatDate(project.createdAt), icon: <Icons.Calendar size={13} /> },
    { label: translate('canvasProjectDetail.t5'), value: formatDate(project.updatedAt), icon: <Icons.Clock size={13} /> },
    {
      label: translate('canvasProjectDetail.t6'),
      value: formatDate(project.lastOpenedAt),
      icon: <Icons.ExternalLink size={13} />,
    },
  ]

  // ── 项目资源（图片/视频），从 snapshot 拉取 ──────────────────────────────
  // openSnapshot 返回整个项目快照，这里只取 assets。「全部」=图片+视频
  // （text/prompt/file/audio 无视觉预览，不在详情页展示）。
  const [assets, setAssets] = useState<CanvasAsset[]>([])
  const [assetsLoading, setAssetsLoading] = useState(true)
  const [assetFilter, setAssetFilter] = useState<'all' | CanvasAssetType>('all')
  /**
   * 右键「删除」二次确认与提交：
   *  - hardDelete=true：明确的资产管理入口使用「硬删」语义，连同源文件一起清理；
   *    仅画布节点/Agent 的治理删除不传该选项，只移除引用
   *  - assetRev：删除后触发 useEffect 重新拉一次 snapshot，避免乐观更新与 DB 漂移
   */
  const [assetRev, setAssetRev] = useState(0)
  /**
   * 多选状态：Set<assetId>，点击 tile 上的 checkbox 切换；右键菜单「删除」在
   * 有选中态时改为批量删除。MAX_ASSET_SELECTION 防止一次选几百把 Modal 拖崩。
   * 切换项目 / 切换筛选时统一清空，避免选中 ID 跨项目指向不存在的资源。
   */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [batchDeleting, setBatchDeleting] = useState(false)

  useEffect(() => {
    let cancelled = false
    setAssetsLoading(true)
    void canvasApi
      .openSnapshot(project.id)
      .then((snapshot) => {
        if (!cancelled) setAssets(snapshot.assets ?? [])
      })
      .catch(() => {
        if (!cancelled) setAssets([])
      })
      .finally(() => {
        if (!cancelled) setAssetsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [project.id, assetRev])

  // 切换项目 / 切换筛选 tab：清空多选。Set 复用稳定引用即可。
  useEffect(() => {
    setSelectedIds((current) => (current.size === 0 ? current : new Set()))
  }, [project.id, assetFilter])

  const handleRequestDeleteAsset = useCallback(
    (asset: CanvasAsset) => {
      const label = asset.title ?? translate('canvasProjectDetail.t7')
      Modal.confirm({
        title: translate('canvasProjectDetail.tpl1Desc', { name: label }),
        content:
          translate('canvasProjectDetail.t8LongDesc'),
        okText: translate('canvasProjectDetail.t9'),
        okButtonProps: { danger: true },
        cancelText: translate('canvasProjectDetail.t10'),
        onOk: async () => {
          // 乐观更新：先把被删条目从本地列表移除
          setAssets((current) => current.filter((item) => item.id !== asset.id))
          try {
            // hardDelete=true 表示管理入口的删除要连源文件一起清理；
            // 仅画布节点/Agent 的治理删除保留不动磁盘与 Provider 文件的语义。
            await canvasApi.deleteFilmAsset(project.id, asset.id, { hardDelete: true })
            message.success(translate('canvasProjectDetail.t11'))
          } catch (error) {
            message.error(error instanceof Error ? error.message : translate('canvasProjectDetail.t12'))
          } finally {
            // 触发后台同步一次完整 snapshot，避免本地乐观更新与 DB 长期漂移
            setAssetRev((value) => value + 1)
          }
        },
      })
    },
    [project.id],
  )

  /**
   * 批量删除：单次调用 batchDeleteFilmAssets——一次遍历移除全部目标 + 级联软删
   * 引用节点 + 源文件清理单次 IPC（assetLibrary 缺陷 4，替换串行 N+1）。
   * 失败时保留选中项便于用户重试。
   */
  const handleRequestDeleteAssets = useCallback(
    (assetIds: string[]) => {
      if (assetIds.length === 0) return
      const targets = assetIds.slice(0, MAX_ASSET_SELECTION)
      const targetCount = targets.length
      Modal.confirm({
        title: translate('canvasProjectDetail.tpl2Desc', { count: targetCount }),
        content:
          translate('canvasProjectDetail.t13LongDesc'),
        okText: translate('canvasProjectDetail.tpl3Desc', { count: targetCount }),
        okButtonProps: { danger: true },
        cancelText: translate('canvasProjectDetail.t10'),
        onOk: async () => {
          // 乐观更新：一次性从本地列表移除所选条目
          const removeSet = new Set(targets)
          setAssets((current) => current.filter((item) => !removeSet.has(item.id)))
          setBatchDeleting(true)
          try {
            await canvasApi.batchDeleteFilmAssets(project.id, targets, { hardDelete: true })
            message.success(translate('canvasProjectDetail.tpl4Desc', { count: targetCount }))
            setSelectedIds((current) => {
              if (current.size === 0) return current
              const next = new Set(current)
              for (const id of targets) next.delete(id)
              return next.size === current.size ? current : next
            })
          } catch (error) {
            message.error(error instanceof Error ? error.message : translate('canvasProjectDetail.t12'))
            message.warning(translate('canvasProjectDetail.tpl5Desc', { count: targetCount }))
          } finally {
            setBatchDeleting(false)
            // 只触发一次重拉，把列表与 DB 对齐
            setAssetRev((value) => value + 1)
          }
        },
      })
    },
    [project.id],
  )

  // ── 多选切换 ───────────────────────────────────────────────────────
  const toggleSelect = useCallback((assetId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(assetId)) {
        next.delete(assetId)
        return next
      }
      if (next.size >= MAX_ASSET_SELECTION) {
        message.warning(translate('canvasProjectDetail.tpl6Desc', { max: MAX_ASSET_SELECTION }))
        return prev
      }
      next.add(assetId)
      return next
    })
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedIds((current) => (current.size === 0 ? current : new Set()))
  }, [])

  // 「全部」只含图片+视频；筛选时按 type 过滤；分页加载（首批 20，点击加载更多）
  const filteredAssets = useMemo(
    () =>
      assetFilter === 'all'
        ? assets.filter((a) => a.type === 'image' || a.type === 'video')
        : assets.filter((a) => a.type === assetFilter),
    [assets, assetFilter],
  )
  const [assetPage, setAssetPage] = useState(1)
  const visibleAssets = useMemo(
    () => filteredAssets.slice(0, assetPage * ASSET_PAGE_SIZE),
    [filteredAssets, assetPage],
  )
  const hasMoreAssets = visibleAssets.length < filteredAssets.length

  // 全选/全不选：仅作用于「当前可见筛选集合」，避免和分页/筛选语义打架
  const allFilteredSelected = useMemo(
    () => filteredAssets.length > 0 && filteredAssets.every((a) => selectedIds.has(a.id)),
    [filteredAssets, selectedIds],
  )
  const toggleSelectAll = useCallback(() => {
    if (allFilteredSelected) {
      setSelectedIds(new Set())
      return
    }
    // 超 MAX 时只截前 N 个并提示，避免一次选几百把 Modal 拖崩
    const next =
      filteredAssets.length > MAX_ASSET_SELECTION
        ? filteredAssets.slice(0, MAX_ASSET_SELECTION).map((a) => a.id)
        : filteredAssets.map((a) => a.id)
    setSelectedIds(new Set(next))
    if (filteredAssets.length > MAX_ASSET_SELECTION) {
      message.info(translate('canvasProjectDetail.tpl7Desc', { max: MAX_ASSET_SELECTION }))
    }
  }, [allFilteredSelected, filteredAssets])

  // 切换筛选 tab 时重置分页到第 1 页
  const handleSetAssetFilter = useCallback((f: 'all' | CanvasAssetType) => {
    setAssetFilter(f)
    setAssetPage(1)
  }, [])

  const assetFilterLabel = (f: 'all' | CanvasAssetType) =>
    f === 'all' ? translate('canvasProjectDetail.t14') : f === 'image' ? translate('canvasProjectDetail.t15') : f === 'video' ? translate('canvasProjectDetail.t16') : null
  const filterTabs: Array<'all' | CanvasAssetType> = ['all', 'image', 'video']

  // ── 资源预览 + 右键复制 ──────────────────────────────────────────────────
  const [previewAsset, setPreviewAsset] = useState<CanvasAsset | null>(null)

  // 预览翻页：在 visibleAssets 内左右切换。currentIndex 由 previewAsset 反查，
  // 这样切换筛选 tab 后再预览也能正确定位。
  const previewIndex = useMemo(
    () => (previewAsset ? visibleAssets.findIndex((a) => a.id === previewAsset.id) : -1),
    [previewAsset, visibleAssets],
  )
  const canPreviewPrev = previewIndex > 0
  const canPreviewNext = previewIndex >= 0 && previewIndex < visibleAssets.length - 1
  const goPreviewPrev = useCallback(() => {
    if (canPreviewPrev) {
      const next = visibleAssets[previewIndex - 1]
      if (next) setPreviewAsset(next)
    }
  }, [canPreviewPrev, previewIndex, visibleAssets])
  const goPreviewNext = useCallback(() => {
    if (canPreviewNext) {
      const next = visibleAssets[previewIndex + 1]
      if (next) setPreviewAsset(next)
    }
  }, [canPreviewNext, previewIndex, visibleAssets])

  // 键盘左右键翻页（Modal 打开时）
  useEffect(() => {
    if (!previewAsset) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        goPreviewPrev()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        goPreviewNext()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [previewAsset, goPreviewPrev, goPreviewNext])

  // 复制图片到剪贴板：fetch url → blob → clipboard.write。失败（safe-file
  // 协议不可 fetch、跨域、blob 过大）则 fallback 复制 URL 文本。
  const handleCopyImage = useCallback(async (asset: CanvasAsset) => {
    const url = asset.url ?? asset.thumbnailUrl
    if (!url) {
      message.warning(translate('canvasProjectDetail.t17'))
      return
    }
    try {
      const response = await fetch(url)
      const blob = await response.blob()
      if (blob.size > 0 && blob.type.startsWith('image/')) {
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
        message.success(translate('canvasProjectDetail.t18'))
        return
      }
    } catch {
      // fetch 失败（协议限制/跨域），fallback 到复制 URL
    }
    try {
      await navigator.clipboard.writeText(url)
      message.success(translate('canvasProjectDetail.t19'))
    } catch {
      message.error(translate('canvasProjectDetail.t20'))
    }
  }, [])

  const handleCopyUrl = useCallback(async (asset: CanvasAsset) => {
    const url = asset.url ?? asset.thumbnailUrl
    if (!url) {
      message.warning(translate('canvasProjectDetail.t17'))
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      message.success(translate('canvasProjectDetail.t21'))
    } catch {
      message.error(translate('canvasProjectDetail.t20'))
    }
  }, [])

  return (
    <div className="canvas-project-detail">
      {/* 封面只负责完整预览；上传/更换使用独立按钮，避免单击语义冲突。 */}
      <div className={`canvas-detail-cover${onUploadCover ? ' is-uploadable' : ''}`}>
        {hasUsableCover && project.coverUrl ? (
          <>
            <button
              type="button"
              className="canvas-detail-cover-preview-trigger"
              aria-label={translate('canvasProjectDetail.tpl8Desc', { title: project.title })}
              onClick={openCoverPreview}
            >
              <img
                className="canvas-detail-cover-ambient"
                src={project.coverUrl}
                alt=""
                aria-hidden="true"
                draggable={false}
              />
              <img
                className="canvas-detail-cover-image"
                src={project.coverUrl}
                alt={project.title}
                draggable={false}
                onError={() => setCoverFailed(true)}
              />
            </button>
            <div className="canvas-detail-cover-toolbar">
              <button
                type="button"
                className="canvas-detail-cover-tool"
                onClick={openCoverPreview}
                aria-label={translate('canvasProjectDetail.t48')}
              >
                <Icons.Maximize size={14} />
                <span>{translate('canvasProjectDetail.t59')}</span>
              </button>
              {onUploadCover && (
                <button
                  type="button"
                  className="canvas-detail-cover-tool"
                  onClick={openCoverPicker}
                  aria-label={translate('canvasProjectDetail.t49')}
                >
                  <Icons.Edit size={14} />
                  <span>{translate('canvasProjectDetail.t60')}</span>
                </button>
              )}
            </div>
          </>
        ) : onUploadCover ? (
          <button
            type="button"
            className="canvas-detail-cover-empty"
            onClick={openCoverPicker}
            aria-label={translate('canvasProjectDetail.t50')}
          >
            <Icons.Canvas size={36} />
            <span>{coverFailed ? translate('canvasProjectDetail.t22Desc') : translate('canvasProjectDetail.t23')}</span>
          </button>
        ) : (
          <div className="canvas-detail-cover-empty">
            <Icons.Canvas size={36} />
            <span>{coverFailed ? translate('canvasProjectDetail.t24') : translate('canvasProjectDetail.t25Desc')}</span>
          </div>
        )}
        <input
          ref={coverInputRef}
          type="file"
          accept="image/*"
          className="canvas-detail-cover-input"
          onChange={handleCoverFileChange}
        />
      </div>

      {/* 标题栏：左侧标题+状态，右侧项目操作。 */}
      <div className="canvas-detail-header">
        <div className="canvas-detail-header-left">
          <h1 className="canvas-detail-title" title={project.title}>
            {project.title}
          </h1>
          <Tag color={project.status === 'archived' ? 'default' : 'green'}>
            {project.status === 'archived' ? translate('canvasProjectDetail.t26') : translate('canvasProjectDetail.t27')}
          </Tag>
          {project.pinned && (
            <Tooltip title={translate('canvasProjectDetail.t51')}>
              <Pin size={13} fill="currentColor" className="canvas-detail-title-pin" />
            </Tooltip>
          )}
        </div>
        <div className="canvas-detail-header-right">
          <Tooltip title={project.pinned ? translate('canvasProjectDetail.t28') : translate('canvasProjectDetail.t29')}>
            <button
              type="button"
              className={`canvas-detail-pin-btn${project.pinned ? ' is-pinned' : ''}`}
              aria-label={project.pinned ? translate('canvasProjectDetail.t28') : translate('canvasProjectDetail.t29')}
              onClick={() => onTogglePin(project.id)}
            >
              {project.pinned ? <Pin size={14} fill="currentColor" /> : <PinOff size={14} />}
            </button>
          </Tooltip>
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{
              items: [
                {
                  key: 'edit',
                  icon: <Icons.Edit size={14} />,
                  label: translate('canvasProjectDetail.t30'),
                  onClick: () => onEdit(project.id),
                },
                {
                  key: 'open-folder',
                  icon: <Icons.Folder size={14} />,
                  label: translate('canvasProjectDetail.t31'),
                  onClick: () => onOpenFolder(project.id),
                },
                {
                  key: 'export',
                  icon: <Icons.Download size={14} />,
                  label: translate('canvasProjectDetail.t32'),
                  onClick: () => onExport(project.id),
                },
                { type: 'divider' as const },
                {
                  key: 'archive',
                  icon: <Icons.Archive size={14} />,
                  label: project.status === 'archived' ? translate('canvasProjectDetail.t33') : translate('canvasProjectDetail.t34'),
                  onClick: () => onArchive(project.id),
                },
                {
                  key: 'delete',
                  icon: <Icons.Trash size={14} />,
                  label: translate('canvasProjectDetail.t9'),
                  onClick: () => onDelete(project.id),
                },
              ],
            }}
          >
            <Tooltip title={translate('canvasProjectDetail.t52')}>
              <button type="button" className="canvas-detail-icon-btn" aria-label={translate('canvasProjectDetail.t53')}>
                <Icons.More size={15} />
              </button>
            </Tooltip>
          </Dropdown>
          <Button
            type="primary"
            size="middle"
            loading={opening}
            disabled={opening}
            icon={<Icons.ExternalLink size={14} />}
            onClick={() => onOpen(project.id)}
            aria-label={
                  opening
                    ? translate('canvasProjectDetail.tpl9Desc', { title: project.title })
                    : translate('canvasProjectDetail.tpl10Desc', { title: project.title })
                }
          >
            {opening ? translate('canvasProjectDetail.t35') : translate('canvasProjectDetail.t36')}
          </Button>
        </div>
      </div>

      {/* 描述 */}
      <p className="canvas-detail-description">
        {project.description || translate('canvasProjectDetail.t37Desc')}
      </p>

      {/* 项目资源（图片/视频）——首批 20 个，支持筛选。
          从 snapshot.assets 拉取，只展示有视觉预览的 image/video 类型。 // i18n-exempt-line: JSX 注释块内说明 */}
      <section className="canvas-detail-assets">
        <div className="canvas-detail-assets-header">
          <h3>{translate('canvasProjectDetail.t61')}</h3>
          <div className="canvas-detail-asset-filters" role="tablist" aria-label={translate('canvasProjectDetail.t54')}>
            {filterTabs.map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={assetFilter === f}
                className={`canvas-detail-asset-filter${assetFilter === f ? ' active' : ''}`}
                onClick={() => handleSetAssetFilter(f)}
              >
                {assetFilterLabel(f)}
              </button>
            ))}
          </div>
        </div>

        {assetsLoading ? (
          <div className="canvas-detail-assets-loading" role="status" aria-label={translate('canvasProjectDetail.t55')}>
            <Spin size="small" />
          </div>
        ) : visibleAssets.length === 0 ? (
          <div className="canvas-detail-assets-empty">
            {translate('canvasProjectDetail.tpl11Desc', {
              type: assetFilter === 'image'
                ? translate('canvasProjectDetail.t15')
                : assetFilter === 'video'
                  ? translate('canvasProjectDetail.t16')
                  : translate('canvasProjectDetail.t38'),
            })}
          </div>
        ) : (
          <>
            {selectedIds.size > 0 && (
              <div
                className="canvas-detail-asset-batchbar"
                role="toolbar"
                aria-label={translate('canvasProjectDetail.t56')}
              >
                <span className="canvas-detail-asset-batchbar-count">
                  {translate('canvasProjectDetail.tpl12Desc', { count: selectedIds.size })}
                  {filteredAssets.length > MAX_ASSET_SELECTION
                    ? translate('canvasProjectDetail.tpl13Desc', { max: MAX_ASSET_SELECTION })
                    : ''}
                </span>
                <div className="canvas-detail-asset-batchbar-actions">
                  <Button
                    size="small"
                    type="text"
                    onClick={toggleSelectAll}
                    disabled={batchDeleting}
                  >
                    {allFilteredSelected
                      ? translate('canvasProjectDetail.t39')
                      : filteredAssets.length > MAX_ASSET_SELECTION
                        ? translate('canvasProjectDetail.tpl14Desc', { max: MAX_ASSET_SELECTION })
                        : translate('canvasProjectDetail.t40')}
                  </Button>
                  <Button
                    size="small"
                    variant="solid"
                    danger
                    loading={batchDeleting}
                    onClick={() => handleRequestDeleteAssets(Array.from(selectedIds))}
                  >
                    {translate('canvasProjectDetail.tpl15Desc', { count: Math.min(selectedIds.size, MAX_ASSET_SELECTION) })}
                  </Button>
                  <Button
                    size="small"
                    type="text"
                    onClick={clearSelection}
                    disabled={batchDeleting}
                  >
                    {translate('canvasProjectDetail.t10')}
                  </Button>
                </div>
              </div>
            )}
            <div className="canvas-detail-asset-grid">
              {visibleAssets.map((asset) => {
                const isSelected = selectedIds.has(asset.id)
                const inSelectionMode = selectedIds.size > 0
                const assetCoverUrl = getAssetCoverUrl(asset)
                const isCurrentCover = Boolean(assetCoverUrl) && assetCoverUrl === project.coverUrl
                return (
                  <Dropdown
                    key={asset.id}
                    trigger={['contextMenu']}
                    menu={{
                      items: [
                        {
                          key: 'preview',
                          label: translate('canvasProjectDetail.t41'),
                          onClick: () => setPreviewAsset(asset),
                        },
                        ...(onSetCoverFromAsset && assetCoverUrl
                          ? [
                              {
                                key: 'set-cover',
                                icon: <Icons.Image size={14} />,
                                label: isCurrentCover ? translate('canvasProjectDetail.t42') : translate('canvasProjectDetail.t43'),
                                disabled: isCurrentCover,
                                onClick: () => onSetCoverFromAsset(asset),
                              },
                            ]
                          : []),
                        { type: 'divider' as const },
                        {
                          key: 'copy-image',
                          label: translate('canvasProjectDetail.t44'),
                          onClick: () => void handleCopyImage(asset),
                        },
                        {
                          key: 'copy-url',
                          label: translate('canvasProjectDetail.t45'),
                          onClick: () => void handleCopyUrl(asset),
                        },
                        { type: 'divider' as const },
                        {
                          key: 'delete',
                          icon: <Icons.Trash size={14} />,
                          label: inSelectionMode ? translate('canvasProjectDetail.tpl16Desc', { count: selectedIds.size }) : translate('canvasProjectDetail.t9'),
                          danger: true,
                          onClick: () => {
                            if (inSelectionMode) {
                              handleRequestDeleteAssets(Array.from(selectedIds))
                            } else {
                              handleRequestDeleteAsset(asset)
                            }
                          },
                        },
                      ],
                    }}
                  >
                    <div
                      className={`canvas-detail-asset-tile${isSelected ? ' is-selected' : ''}`}
                      title={asset.title ?? ''}
                      onClick={() => {
                        if (inSelectionMode) {
                          toggleSelect(asset.id)
                        } else {
                          setPreviewAsset(asset)
                        }
                      }}
                    >
                      <AssetThumbnail asset={asset} />
                      {asset.type === 'video' && (
                        <span className="canvas-detail-asset-badge" aria-label={translate('canvasProjectDetail.t16')}>
                          <Icons.Play size={10} />
                        </span>
                      )}
                      {/* checkbox 单独 span 包一层，stopPropagation 避免和 tile
                          onClick 互相触发（tile 在 selectionMode 下会切换选中， // i18n-exempt-line: JSX 注释块内说明
                          否则预览；checkbox 永远只切换选中） // i18n-exempt-line: JSX 注释块内说明 */}
                      <span
                        className="canvas-detail-asset-tile-checkbox"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Checkbox
                          checked={isSelected}
                          disabled={batchDeleting}
                          onChange={() => toggleSelect(asset.id)}
                          aria-label={
                            isSelected
                              ? translate('canvasProjectDetail.tpl17Desc', { title: asset.title ?? translate('canvasProjectDetail.t7') })
                              : translate('canvasProjectDetail.tpl18Desc', { title: asset.title ?? translate('canvasProjectDetail.t7') })
                          }
                        />
                      </span>
                    </div>
                  </Dropdown>
                )
              })}
            </div>
          </>
        )}

        {/* 加载更多：首批 20 个，点击累加下一页 20 个，直到全部加载完 */}
        {hasMoreAssets && !assetsLoading && (
          <Button
            type="text"
            className="canvas-detail-load-more"
            onClick={() => setAssetPage((p) => p + 1)}
          >
            {translate('canvasProjectDetail.tpl19Desc', { count: filteredAssets.length - visibleAssets.length })}
          </Button>
        )}
      </section>

      {/* 时间线（移到最底下） */}
      <div className="canvas-detail-times">
        {times.map((t) => (
          <div key={t.label} className="canvas-detail-time-row">
            <span className="canvas-detail-time-icon">{t.icon}</span>
            <span className="canvas-detail-time-label">{t.label}</span>
            <span className="canvas-detail-time-value">{t.value}</span>
          </div>
        ))}
      </div>

      {/* 项目封面预览与资源预览互相独立，避免参与资源翻页状态。 */}
      <Modal
        open={coverPreviewOpen && hasUsableCover}
        onCancel={() => setCoverPreviewOpen(false)}
        footer={null}
        width="min(92vw, 1200px)"
        centered
        title={translate('canvasProjectDetail.tpl20Desc', { title: project.title })}
        className="canvas-detail-cover-preview-modal"
        destroyOnHidden
      >
        {project.coverUrl && (
          <img
            src={project.coverUrl}
            alt={translate('canvasProjectDetail.tpl20Desc', { title: project.title })}
            className="canvas-detail-cover-preview-image"
          />
        )}
      </Modal>

      {/* 资源预览 lightbox：点击缩略图触发，图片用大图、视频用 video 播放 */}
      <Modal
        open={!!previewAsset}
        onCancel={() => setPreviewAsset(null)}
        footer={null}
        width="auto"
        centered
        title={previewAsset?.title || (previewAsset?.type === 'video' ? translate('canvasProjectDetail.t46') : translate('canvasProjectDetail.t47'))}
        className="canvas-detail-preview-modal"
        destroyOnHidden
      >
        {previewAsset &&
          (previewAsset.type === 'video' && previewAsset.url ? (
            <video
              src={previewAsset.url}
              poster={previewAsset.thumbnailUrl ?? undefined}
              controls
              autoPlay
              className="canvas-detail-preview-media"
            />
          ) : (
            <img
              src={previewAsset.url ?? previewAsset.thumbnailUrl ?? ''}
              alt={previewAsset.title ?? ''}
              className="canvas-detail-preview-media"
            />
          ))}
      </Modal>

      {/* 翻页按钮 portal 到 body：和 Modal 同在根 stacking context，
          fixed 定位真正相对视口，z-index 1002 可盖过 Modal wrap(1000)。 // i18n-exempt-line: JSX 注释块内说明
          不放 canvas-project-detail 内是因为 DOM 祖先链可能创建 stacking // i18n-exempt-line: JSX 注释块内说明
          context 导致按钮无论 z-index 多大都盖不过 Modal。 // i18n-exempt-line: JSX 注释块内说明 */}
      {previewAsset &&
        createPortal(
          <>
            {canPreviewPrev && (
              <button
                type="button"
                className="canvas-detail-preview-nav prev"
                onClick={goPreviewPrev}
                aria-label={translate('canvasProjectDetail.t57')}
              >
                <Icons.ChevronRight size={20} style={{ transform: 'rotate(180deg)' }} />
              </button>
            )}
            {canPreviewNext && (
              <button
                type="button"
                className="canvas-detail-preview-nav next"
                onClick={goPreviewNext}
                aria-label={translate('canvasProjectDetail.t58')}
              >
                <Icons.ChevronRight size={20} />
              </button>
            )}
          </>,
          document.body,
        )}
    </div>
  )
}
