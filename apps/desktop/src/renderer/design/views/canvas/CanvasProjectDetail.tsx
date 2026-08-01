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
import { Modal, Spin, message } from 'antd'
import { Button, Dropdown, Tag, Tooltip } from '@lobehub/ui'
import { Pin, PinOff } from 'lucide-react'
import { Icons } from '../../Icons'
import { canvasApi } from './canvas.api'
import type { CanvasAsset, CanvasAssetType, CanvasProject } from './canvas.types'

/** 资源瀑布流每页数量，点击「加载更多」累加显示。 */
const ASSET_PAGE_SIZE = 20

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
}: CanvasProjectDetailProps) {
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
    { label: '节点', value: project.nodeCount, icon: <Icons.Canvas size={15} /> },
    { label: '任务', value: project.taskCount, icon: <Icons.Clock size={15} /> },
    { label: '资产', value: project.assetCount, icon: <Icons.Image size={15} /> },
  ]
  const times = [
    { label: '创建时间', value: formatDate(project.createdAt), icon: <Icons.Calendar size={13} /> },
    { label: '更新时间', value: formatDate(project.updatedAt), icon: <Icons.Clock size={13} /> },
    { label: '最后打开', value: formatDate(project.lastOpenedAt), icon: <Icons.ExternalLink size={13} /> },
  ]

  // ── 项目资源（图片/视频），从 snapshot 拉取 ──────────────────────────────
  // openSnapshot 返回整个项目快照，这里只取 assets。「全部」=图片+视频
  // （text/prompt/file/audio 无视觉预览，不在详情页展示）。
  const [assets, setAssets] = useState<CanvasAsset[]>([])
  const [assetsLoading, setAssetsLoading] = useState(true)
  const [assetFilter, setAssetFilter] = useState<'all' | CanvasAssetType>('all')

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
  }, [project.id])

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

  // 切换筛选 tab 时重置分页到第 1 页
  const handleSetAssetFilter = useCallback((f: 'all' | CanvasAssetType) => {
    setAssetFilter(f)
    setAssetPage(1)
  }, [])

  const assetFilterLabel = (f: 'all' | CanvasAssetType) =>
    f === 'all' ? '全部' : f === 'image' ? '图片' : f === 'video' ? '视频' : null
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
      message.warning('该资源无可复制的地址')
      return
    }
    try {
      const response = await fetch(url)
      const blob = await response.blob()
      if (blob.size > 0 && blob.type.startsWith('image/')) {
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
        message.success('已复制图片到剪贴板')
        return
      }
    } catch {
      // fetch 失败（协议限制/跨域），fallback 到复制 URL
    }
    try {
      await navigator.clipboard.writeText(url)
      message.success('已复制资源链接')
    } catch {
      message.error('复制失败')
    }
  }, [])

  const handleCopyUrl = useCallback(async (asset: CanvasAsset) => {
    const url = asset.url ?? asset.thumbnailUrl
    if (!url) {
      message.warning('该资源无可复制的地址')
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      message.success('已复制链接')
    } catch {
      message.error('复制失败')
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
              aria-label={`查看项目封面：${project.title}`}
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
                aria-label="查看封面大图"
              >
                <Icons.Maximize size={14} />
                <span>查看大图</span>
              </button>
              {onUploadCover && (
                <button
                  type="button"
                  className="canvas-detail-cover-tool"
                  onClick={openCoverPicker}
                  aria-label="更换项目封面"
                >
                  <Icons.Edit size={14} />
                  <span>更换封面</span>
                </button>
              )}
            </div>
          </>
        ) : onUploadCover ? (
          <button
            type="button"
            className="canvas-detail-cover-empty"
            onClick={openCoverPicker}
            aria-label="上传项目封面"
          >
            <Icons.Canvas size={36} />
            <span>{coverFailed ? '封面加载失败，点击重新上传' : '暂无封面，点击上传'}</span>
          </button>
        ) : (
          <div className="canvas-detail-cover-empty">
            <Icons.Canvas size={36} />
            <span>{coverFailed ? '封面加载失败' : '暂无封面，进入项目开始创作'}</span>
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
          <h1 className="canvas-detail-title" title={project.title}>{project.title}</h1>
          <Tag color={project.status === 'archived' ? 'default' : 'green'}>
            {project.status === 'archived' ? '已归档' : '进行中'}
          </Tag>
          {project.pinned && (
            <Tooltip title="已置顶">
              <Pin size={13} fill="currentColor" className="canvas-detail-title-pin" />
            </Tooltip>
          )}
        </div>
        <div className="canvas-detail-header-right">
          <Tooltip title={project.pinned ? '取消置顶' : '置顶'}>
            <button
              type="button"
              className={`canvas-detail-pin-btn${project.pinned ? ' is-pinned' : ''}`}
              aria-label={project.pinned ? '取消置顶' : '置顶'}
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
                  label: '基础信息',
                  onClick: () => onEdit(project.id),
                },
                {
                  key: 'open-folder',
                  icon: <Icons.Folder size={14} />,
                  label: '打开文件夹',
                  onClick: () => onOpenFolder(project.id),
                },
                {
                  key: 'export',
                  icon: <Icons.Download size={14} />,
                  label: '导出',
                  onClick: () => onExport(project.id),
                },
                { type: 'divider' as const },
                {
                  key: 'archive',
                  icon: <Icons.Archive size={14} />,
                  label: project.status === 'archived' ? '恢复' : '归档',
                  onClick: () => onArchive(project.id),
                },
                {
                  key: 'delete',
                  icon: <Icons.Trash size={14} />,
                  label: '删除',
                  onClick: () => onDelete(project.id),
                },
              ],
            }}
          >
            <Tooltip title="更多操作">
              <button
                type="button"
                className="canvas-detail-icon-btn"
                aria-label="更多项目操作"
              >
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
            aria-label={opening ? `正在打开画布：${project.title}` : `打开画布：${project.title}`}
          >
            {opening ? '打开中' : '打开画布'}
          </Button>
        </div>
      </div>

      {/* 描述 */}
      <p className="canvas-detail-description">
        {project.description || '暂无描述，点击「编辑」补充项目说明。'}
      </p>

      {/* 统计 */}
      <div className="canvas-detail-stats">
        {stats.map((s) => (
          <div key={s.label} className="canvas-detail-stat">
            <span className="canvas-detail-stat-icon">{s.icon}  <p>{s.label}</p></span>
            <span className="canvas-detail-stat-value">{s.value}</span>
            {/* <span className="canvas-detail-stat-label">{s.label}</span> */}
          </div>
        ))}
      </div>

      {/* 项目资源（图片/视频）——首批 20 个，支持筛选。
          从 snapshot.assets 拉取，只展示有视觉预览的 image/video 类型。 */}
      <section className="canvas-detail-assets">
        <div className="canvas-detail-assets-header">
          <h3>项目资源</h3>
          <div className="canvas-detail-asset-filters" role="tablist" aria-label="资源类型筛选">
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
          <div className="canvas-detail-assets-loading" role="status" aria-label="正在加载资源">
            <Spin size="small" />
          </div>
        ) : visibleAssets.length === 0 ? (
          <div className="canvas-detail-assets-empty">
            暂无{assetFilter === 'image' ? '图片' : assetFilter === 'video' ? '视频' : '图片/视频'}资源
          </div>
        ) : (
          <div className="canvas-detail-asset-grid">
            {visibleAssets.map((asset) => (
              <Dropdown
                key={asset.id}
                trigger={['contextMenu']}
                menu={{
                  items: [
                    {
                      key: 'preview',
                      label: '预览',
                      onClick: () => setPreviewAsset(asset),
                    },
                    { type: 'divider' as const },
                    {
                      key: 'copy-image',
                      label: '复制图片',
                      onClick: () => void handleCopyImage(asset),
                    },
                    {
                      key: 'copy-url',
                      label: '复制链接',
                      onClick: () => void handleCopyUrl(asset),
                    },
                  ],
                }}
              >
                <div
                  className="canvas-detail-asset-tile"
                  title={asset.title ?? ''}
                  onClick={() => setPreviewAsset(asset)}
                >
                  <AssetThumbnail asset={asset} />
                  {asset.type === 'video' && (
                    <span className="canvas-detail-asset-badge" aria-label="视频">
                      <Icons.Play size={10} />
                    </span>
                  )}
                </div>
              </Dropdown>
            ))}
          </div>
        )}

        {/* 加载更多：首批 20 个，点击累加下一页 20 个，直到全部加载完 */}
        {hasMoreAssets && !assetsLoading && (
          <Button
            type="text"
            className="canvas-detail-load-more"
            onClick={() => setAssetPage((p) => p + 1)}
          >
            加载更多（剩余 {filteredAssets.length - visibleAssets.length} 个）
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
        title={`${project.title} · 项目封面`}
        className="canvas-detail-cover-preview-modal"
        destroyOnHidden
      >
        {project.coverUrl && (
          <img
            src={project.coverUrl}
            alt={`${project.title} · 项目封面`}
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
        title={
          previewAsset?.title ||
          (previewAsset?.type === 'video' ? '视频预览' : '图片预览')
        }
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
          fixed 定位真正相对视口，z-index 1002 可盖过 Modal wrap(1000)。
          不放 canvas-project-detail 内是因为 DOM 祖先链可能创建 stacking
          context 导致按钮无论 z-index 多大都盖不过 Modal。 */}
      {previewAsset &&
        createPortal(
          <>
            {canPreviewPrev && (
              <button
                type="button"
                className="canvas-detail-preview-nav prev"
                onClick={goPreviewPrev}
                aria-label="上一张"
              >
                <Icons.ChevronRight size={20} style={{ transform: 'rotate(180deg)' }} />
              </button>
            )}
            {canPreviewNext && (
              <button
                type="button"
                className="canvas-detail-preview-nav next"
                onClick={goPreviewNext}
                aria-label="下一张"
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
