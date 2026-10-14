import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Empty,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Select,
  Switch,
  Tag,
  Tooltip,
  message,
} from 'antd'
import { Button, Dropdown, Segmented } from '@lobehub/ui'
import type { ProviderFileObject } from '@spark/protocol'
import { Icons } from '../../Icons'
import { translate, useI18n } from '../../i18n'
import { AssetThumbnail } from './CanvasAssetThumbnail'
import { ShotSegmentTable } from './CanvasShotSegmentTable'
import { CanvasPromptEditor } from './CanvasPromptEditor'
import type { CanvasPromptLibraryEntry } from './CanvasPromptLibraryPanel'
import { CanvasFilmPromptLibraryTab } from './CanvasFilmPromptLibraryTab'
import { CanvasProviderFilesTab } from './CanvasProviderFilesTab'
import {
  FILM_ASSET_KIND_LABELS,
  FILM_ASSET_KIND_ORDER,
  FILM_REFERENCE_KIND_LABELS,
  FILM_REFERENCE_KIND_ORDER,
  filmUid,
  readAssetKind,
  readReferences,
  readTags,
  type CreateFilmAssetInput,
  type FilmAssetKind,
  type ShotGroup,
  type ShotSegment,
} from './canvasFilmAssets'
import type {
  FilmProductionBible,
  FilmReference,
  FilmReferenceKind,
  FilmStylePreset,
} from './canvasFilmTypes'
import type { CanvasAsset, CanvasSnapshot } from './canvas.types'
import { readProductionBible, readStylePresets } from './canvasPipeline'
import { BUILTIN_FILM_STYLE_PACKS, stylePackToProductionBible } from './canvasFilmStylePresets'
import { CHARACTER_SHEET_TEMPLATES, type CharacterSheetAspect } from './canvasCharacterSheetPrompts'
import {
  buildChaptersFromFiles,
  createSingleChapterResult,
  splitTextIntoChapters,
  decodeManuscriptBuffer,
  countChars,
  type ChapterSplitResult,
  type ChapterSplitMode,
  type ParsedChapter,
} from './canvasManuscript'
import { planShotsFromScene, totalPlannedDurationSec, type PlannedShot } from './canvasShotPlanner'
import { planSegmentSplit, resolveSegmentDuration, type ShotSplitPart } from './canvasShotSplit'
import { parseShotTable, type ParsedShotRow } from './canvasShotTableParse'
import { storyboardRowToSegmentDraft } from './canvasStoryboardMaterialization'
import { DEFAULT_MAX_CLIP_SEC } from './canvasAgentPromptPresets'
import { resolveCanvasAssetFocusNodeIds } from './canvasAssetFocus'
import {
  buildEdlMarkdown,
  buildTimeline,
  totalRuntimeSec,
  formatTimecode,
} from './canvasFilmTimeline'

/**
 * 影视公用资产中心 - 主弹窗（文档 §7.10）。
 *
 * 项目级公用资产管理：剧本 / 角色 / 场景 / 道具 / 提示词库。
 * 每个资产可编辑、AI 优化（text_rewrite 触发平台 agent）、插入画布。
 * 分镜分组在 ShotGroupEditor 子组件。
 *
 * 数据复用 CanvasAsset + metadata.kind，不新建表。
 */

export type TabKind = FilmAssetKind | 'shots' | 'files'

const TAB_ORDER: TabKind[] = [
  // 文稿与章节合并为「文稿」一个 tab：文稿列表 → 章节列表 → 章节正文 下钻
  'manuscript',
  'script',
  'character',
  'scene',
  'prop',
  'effect',
  'shots',
  'prompt_library',
  'files',
]

const TAB_LABELS: Record<TabKind, string> = {
  manuscript: translate('canvasFilmAsset.t1'),
  chapter: translate('canvasFilmAsset.t2'),
  script: translate('canvasFilmAsset.t3'),
  character: translate('canvasFilmAsset.t4'),
  scene: translate('canvasFilmAsset.t5'),
  prop: translate('canvasFilmAsset.t6'),
  effect: translate('canvasFilmAsset.t7'),
  shot_group: translate('canvasFilmAsset.t8'),
  shots: translate('canvasFilmAsset.t9'),
  prompt_library: translate('canvasFilmAsset.t10'),
  files: 'Files',
}

/** 资产列表分批渲染步长：文稿/章节可达上千条，一次性挂载会卡顿并撑爆 DOM */
const ASSET_PAGE_SIZE = 60

const CHAPTER_SPLIT_MODE_LABELS: Record<ChapterSplitMode, string> = {
  heading: translate('canvasFilmAsset.t11'),
  length: translate('canvasFilmAsset.t12'),
  single: translate('canvasFilmAsset.t13'),
  'multi-file': translate('canvasFilmAsset.t14'),
}

const FILM_CENTER_NESTED_MODAL_Z_INDEX = 1400

export type FilmCenterHandlers = {
  createFilmAsset: (input: CreateFilmAssetInput) => Promise<CanvasAsset>
  updateFilmAsset: (
    assetId: string,
    patch: {
      title?: string
      contentText?: string
      prompt?: string
      references?: FilmReference[]
      tags?: string[]
      attributes?: Record<string, string>
    },
  ) => Promise<void>
  deleteFilmAsset: (assetId: string, options?: { hardDelete?: boolean }) => Promise<void>
  onOptimizeAsset: (asset: CanvasAsset) => void
  onBreakdownScriptAsset?: (asset: CanvasAsset) => Promise<void>
  /** 导入文稿（设计 §S1）：接收已解析+按范围切片的章节，返回创建的章节数 */
  onImportManuscript?: (input: {
    title: string
    mode: ChapterSplitMode
    chapters: ParsedChapter[]
  }) => Promise<number>
  onOptimizeManuscriptDraft?: (text: string) => void
  /** 删除整部文稿（级联删除全部章节）：返回删除的章节数 */
  deleteManuscript?: (
    manuscriptAssetId: string,
    options?: { hardDelete?: boolean },
  ) => Promise<number>
  /** 章节转剧本（设计 §S2）：基于章节内容创建剧本资产，可继续拆解 */
  onChapterToScreenplay?: (asset: CanvasAsset) => Promise<void>
  /** 导出成片清单 EDL（设计 §S9）：把时间线文本插入画布 */
  onExportTimeline?: (input: { title: string; markdown: string }) => void
  /** 保存风格预设（设计 §S5）：运镜/画面/动作，项目级可复用 */
  onSaveStylePreset?: (preset: FilmStylePreset) => Promise<void>
  /** 应用项目视觉圣经（Production Bible），开拍前固定全片生成风格 */
  onApplyProductionBible?: (productionBible: FilmProductionBible) => Promise<void>
  /** 把分镜分组展开为画布上的分镜节点（设计 §S6 节点化）：返回创建的节点数 */
  onExpandShotsToCanvas?: (group: ShotGroup) => Promise<number>
  onGenerateAssetReference?: (asset: CanvasAsset) => void
  /** 角色多面向出图（设计 §S4）：角色身份板/表情/远近/服装/五官/武器道具 */
  onGenerateCharacterSheets?: (asset: CanvasAsset, aspects: CharacterSheetAspect[]) => void
  onGenerateSegmentVideo?: (input: {
    group: ShotGroup
    segment: ShotSegment
    characters: CanvasAsset[]
    scene?: CanvasAsset
  }) => void
  /** 分镜出关键帧（设计 §S7）：首/尾帧出图 */
  onGenerateSegmentKeyframes?: (input: {
    group: ShotGroup
    segment: ShotSegment
    characters: CanvasAsset[]
    scene?: CanvasAsset
  }) => void
  /** 把画布当前选中的图片节点设为该分镜的关键帧（§S7→S8 回链）：返回设置的关键帧数 */
  onSetSegmentKeyframesFromSelection?: (input: { group: ShotGroup; segment: ShotSegment }) => number
  /** 生成分镜图（宫格关键帧）：把整组分镜画成一张多格故事板图，发起 storyboard_grid */
  onGenerateStoryboardGrid?: (group: ShotGroup) => void
  hasPromptCanvasTarget?: () => boolean
  onApplyPromptEntryToCanvas?: (entry: CanvasPromptLibraryEntry) => Promise<boolean>
  onInsertAssetToCanvas: (assetId: string) => void
  /**
   * 把「素材中心 → Files」里的 provider 文件（如 MiniMax）作为节点加入画布。
   * 节点持有渠道 fileId（无本地 url）；提交任务时由对应 adapter 按官方协议解析，
   * 例如 MiniMax 使用 mm_file://{id}，火山方舟先解析 Files download_url。
   */
  onInsertProviderFileToCanvas?: (input: {
    providerProfileId: string
    fileId: string
    fileName?: string
    mimeType?: string
    kind?: 'image' | 'video' | 'audio'
  }) => void
  /** 定位资产对应的画布节点，并将其聚焦到画布中心 */
  onLocateAsset?: (assetId: string) => void
  /** 查询资源被谁引用（分镜片段 + 画布节点） */
  getFilmAssetUsage?: (assetId: string) => {
    shotSegments: Array<{
      groupId: string
      groupName: string
      segmentId: string
      segmentTitle: string
      segmentIndex: number
    }>
    nodes: Array<{ id: string; type: string; title: string | null }>
  }
  // 分镜分组
  createShotGroup: (input: { name: string; description?: string }) => Promise<ShotGroup>
  updateShotGroup: (
    groupId: string,
    patch: { name?: string; description?: string },
  ) => Promise<void>
  deleteShotGroup: (groupId: string) => Promise<void>
  createShotSegment: (
    groupId: string,
    input: Partial<ShotSegment> & { title: string },
  ) => Promise<ShotSegment>
  updateShotSegment: (
    groupId: string,
    segmentId: string,
    patch: Partial<ShotSegment>,
  ) => Promise<void>
  deleteShotSegment: (groupId: string, segmentId: string) => Promise<void>
}

export function CanvasFilmAssetCenter({
  open,
  onClose,
  snapshot,
  handlers,
  onUploadImage,
  initialTab,
}: {
  open: boolean
  onClose: () => void
  snapshot: CanvasSnapshot
  handlers: FilmCenterHandlers
  /** 上传图片到项目资产库，返回新 assetId */
  onUploadImage?: (file: File) => Promise<string | null>
  /** 打开时定位到的 tab（导演台深链） */
  initialTab?: TabKind
}) {
  // 本文件使用非响应式 translate()：顶层订阅语言变化，保证切换语言后整树重渲染。
  useI18n()
  const [activeTab, setActiveTab] = useState<TabKind>(initialTab ?? 'script')

  // 从导演台深链打开时，定位到目标 tab
  useEffect(() => {
    if (open && initialTab) setActiveTab(initialTab)
  }, [open, initialTab])

  const handleAddProviderFileToCanvas = useCallback(
    (file: ProviderFileObject, providerProfileId: string) => {
      handlers.onInsertProviderFileToCanvas?.({
        providerProfileId,
        fileId: file.id,
        ...(file.filename ? { fileName: file.filename } : {}),
        ...(file.mimeType ? { mimeType: file.mimeType } : {}),
      })
    },
    [handlers.onInsertProviderFileToCanvas],
  )

  if (!open) return null

  return createPortal(
    <div
      className="canvas-film-center-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <section
        className="canvas-bottom-floating-panel canvas-film-center-panel"
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="canvas-bottom-floating-head">
          <div>
            <FilmCenterHeaderTitle />
            <span>{translate('canvasFilmAsset.tpl1Desc')}</span>
          </div>
          <Button
            size="middle"
            type="text"
            icon={<Icons.X size={14} />}
            aria-label={translate('canvasFilmAsset.t146')}
            onClick={onClose}
          />
        </div>
        <div className="canvas-film-center">
          <nav className="canvas-film-center-tabs">
            {TAB_ORDER.map((kind) => (
              <button
                key={kind}
                type="button"
                className={`canvas-film-center-tab${activeTab === kind ? ' active' : ''}`}
                onClick={() => setActiveTab(kind)}
              >
                {TAB_LABELS[kind]}
              </button>
            ))}
          </nav>
          <div className="canvas-film-center-body">
            {activeTab === 'shots' ? (
              <ShotGroupTab snapshot={snapshot} handlers={handlers} />
            ) : activeTab === 'prompt_library' ? (
              <CanvasFilmPromptLibraryTab snapshot={snapshot} handlers={handlers} />
            ) : activeTab === 'files' ? (
              <CanvasProviderFilesTab
                {...(handlers.onInsertProviderFileToCanvas
                  ? { onAddToCanvas: handleAddProviderFileToCanvas }
                  : {})}
              />
            ) : activeTab === 'manuscript' ? (
              <ManuscriptTab snapshot={snapshot} handlers={handlers} />
            ) : (
              <AssetListTab
                kind={activeTab as FilmAssetKind}
                snapshot={snapshot}
                handlers={handlers}
                {...(onUploadImage ? { onUploadImage } : {})}
              />
            )}
          </div>
        </div>
      </section>
    </div>,
    document.body,
  )
}

function FilmCenterHeaderTitle() {
  return (
    <span className="canvas-film-center-title">
      <Icons.Layers size={16} />
      {translate('canvasFilmAsset.t195')}
    </span>
  )
}

// ─── 资产列表 Tab（剧本/角色/场景/道具/特效/提示词库共用）───────────────
function AssetListTab({
  kind,
  snapshot,
  handlers,
  onUploadImage,
}: {
  kind: FilmAssetKind
  snapshot: CanvasSnapshot
  handlers: FilmCenterHandlers
  onUploadImage?: (file: File) => Promise<string | null>
}) {
  const assets = useMemo(
    () => snapshot.assets.filter((asset) => readAssetKind(asset) === kind),
    [snapshot.assets, kind],
  )
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  // 角色多面向出图弹窗（设计 §S4）
  const [sheetAsset, setSheetAsset] = useState<CanvasAsset | null>(null)
  const [sheetAspects, setSheetAspects] = useState<CharacterSheetAspect[]>([
    'turnaround',
    'expression',
    'costume',
  ])
  const [query, setQuery] = useState('')
  const [tagFilter, setTagFilter] = useState<string[]>([])
  const [sortBy, setSortBy] = useState<'updated' | 'created' | 'name' | 'usage'>('updated')
  // 分批渲染：仅挂载前 visibleCount 条，滚动到底再追加，避免上千章节一次性渲染卡死
  const [visibleCount, setVisibleCount] = useState(ASSET_PAGE_SIZE)
  const tagFilterKey = tagFilter.join('|')
  useEffect(() => {
    setVisibleCount(ASSET_PAGE_SIZE)
  }, [kind, query, tagFilterKey, sortBy])

  const usageMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const node of snapshot.nodes) {
      if (node.assetId) map.set(node.assetId, (map.get(node.assetId) ?? 0) + 1)
    }
    // 分镜引用
    const film = snapshot.project.metadata?.['film']
    if (film && typeof film === 'object') {
      const groups = (film as Record<string, unknown>)['shotGroups']
      if (Array.isArray(groups)) {
        for (const group of groups) {
          if (!group || typeof group !== 'object') continue
          const segments = (group as Record<string, unknown>)['segments']
          if (!Array.isArray(segments)) continue
          for (const seg of segments) {
            if (!seg || typeof seg !== 'object') continue
            const s = seg as Record<string, unknown>
            const bump = (id: unknown) => {
              if (typeof id !== 'string') return
              map.set(id, (map.get(id) ?? 0) + 1)
            }
            if (Array.isArray(s['characterAssetIds']))
              for (const id of s['characterAssetIds']) bump(id)
            if (typeof s['sceneAssetId'] === 'string') bump(s['sceneAssetId'])
            if (Array.isArray(s['propAssetIds'])) for (const id of s['propAssetIds']) bump(id)
          }
        }
      }
    }
    return map
  }, [snapshot.nodes, snapshot.project.metadata])

  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const asset of assets) {
      for (const tag of readTags(asset.metadata)) set.add(tag)
    }
    return Array.from(set).sort()
  }, [assets])

  const resolveCoverAsset = (asset: CanvasAsset): CanvasAsset => {
    const refs = readReferences(asset.metadata)
    if (refs.length === 0) return asset
    return snapshot.assets.find((a) => a.id === refs[0]?.assetId) ?? asset
  }
  const assetHasImage = (asset: CanvasAsset): boolean => {
    const cover = resolveCoverAsset(asset)
    return Boolean(cover.thumbnailUrl ?? (cover.type === 'image' ? cover.url : null))
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = assets.filter((asset) => {
      if (tagFilter.length > 0) {
        const assetTags = readTags(asset.metadata)
        if (!tagFilter.every((t) => assetTags.includes(t))) return false
      }
      if (q) {
        const title = (asset.title ?? '').toLowerCase()
        const content = (asset.contentText ?? '').toLowerCase()
        const prompt =
          typeof asset.metadata?.['prompt'] === 'string'
            ? (asset.metadata['prompt'] as string).toLowerCase()
            : ''
        if (!title.includes(q) && !content.includes(q) && !prompt.includes(q)) return false
      }
      return true
    })
    return list.sort((a, b) => {
      const aImg = assetHasImage(a)
      const bImg = assetHasImage(b)
      if (aImg !== bImg) return aImg ? -1 : 1
      if (sortBy === 'name') return (a.title ?? '').localeCompare(b.title ?? '')
      if (sortBy === 'created') return b.createdAt.localeCompare(a.createdAt)
      if (sortBy === 'usage') return (usageMap.get(b.id) ?? 0) - (usageMap.get(a.id) ?? 0)
      return b.updatedAt.localeCompare(a.updatedAt)
    })
  }, [assets, query, tagFilter, sortBy, usageMap, snapshot])

  const editingAsset = editingId ? (assets.find((a) => a.id === editingId) ?? null) : null

  const handleDeleteAsset = (asset: CanvasAsset, usageCount: number): void => {
    Modal.confirm({
      title: translate('canvasFilmAsset.tpl2Desc', { kind: FILM_ASSET_KIND_LABELS[kind] }),
      content:
        usageCount > 0
          ? translate('canvasFilmAsset.tpl3LongDesc', {
              title: asset.title ?? translate('canvasFilmAsset.t15'),
              count: usageCount,
            })
          : translate('canvasFilmAsset.tpl4LongDesc', {
              title: asset.title ?? translate('canvasFilmAsset.t15'),
            }),
      okText: translate('canvasFilmAsset.t16'),
      cancelText: translate('canvasFilmAsset.t17'),
      okButtonProps: { danger: true },
      onOk: () => handlers.deleteFilmAsset(asset.id, { hardDelete: true }),
    })
  }

  const handleBreakdownScript = (asset: CanvasAsset): void => {
    if (!handlers.onBreakdownScriptAsset) return
    Modal.confirm({
      title: translate('canvasFilmAsset.t18'),
      content: translate('canvasFilmAsset.tpl5LongDesc'),
      okText: translate('canvasFilmAsset.t18'),
      cancelText: translate('canvasFilmAsset.t17'),
      onOk: () => handlers.onBreakdownScriptAsset?.(asset),
    })
  }

  if (creating) {
    return (
      <AssetEditor
        kind={kind}
        mode="create"
        onClose={() => setCreating(false)}
        onSave={async (input) => {
          await handlers.createFilmAsset({
            kind,
            name: input.name,
            ...(input.text ? { text: input.text } : {}),
            references: input.references,
            tags: input.tags,
            ...(input.prompt ? { prompt: input.prompt } : {}),
            ...(input.attributes ? { attributes: input.attributes } : {}),
          })
          setCreating(false)
        }}
        {...(onUploadImage ? { onUploadImage } : {})}
        assetById={(id) => snapshot.assets.find((a) => a.id === id)}
        {...(handlers.getFilmAssetUsage ? { getFilmAssetUsage: handlers.getFilmAssetUsage } : {})}
      />
    )
  }

  if (editingAsset) {
    return (
      <AssetEditor
        kind={kind}
        mode="edit"
        asset={editingAsset}
        onClose={() => setEditingId(null)}
        onSave={async (patch) => {
          await handlers.updateFilmAsset(editingAsset.id, {
            title: patch.name,
            contentText: patch.text,
            references: patch.references,
            tags: patch.tags,
            ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
            ...(patch.attributes ? { attributes: patch.attributes } : {}),
          })
          setEditingId(null)
        }}
        onOptimize={() => handlers.onOptimizeAsset(editingAsset)}
        {...(onUploadImage ? { onUploadImage } : {})}
        assetById={(id) => snapshot.assets.find((a) => a.id === id)}
        {...(handlers.getFilmAssetUsage ? { getFilmAssetUsage: handlers.getFilmAssetUsage } : {})}
      />
    )
  }

  return (
    <div className="canvas-film-asset-list-tab">
      <div className="canvas-film-asset-list-head">
        <span className="canvas-film-asset-list-count">
          {FILM_ASSET_KIND_LABELS[kind]} ·{' '}
          {translate('canvasFilmAsset.tpl6Desc', {
            filtered: filtered.length,
            total: assets.length,
          })}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            type="primary"
            size="middle"
            icon={<Icons.Plus size={13} />}
            onClick={() => setCreating(true)}
          >
            {translate('canvasFilmAsset.tpl7Desc', { kind: FILM_ASSET_KIND_LABELS[kind] })}
          </Button>
        </div>
      </div>

      <div className="canvas-film-asset-toolbar">
        <Input
          size="middle"
          allowClear
          value={query}
          placeholder={translate('canvasFilmAsset.t147Desc')}
          onChange={(e) => setQuery(e.target.value)}
          className="canvas-film-asset-search"
        />
        <Select
          size="middle"
          value={sortBy}
          onChange={(value) => setSortBy(value as typeof sortBy)}
          options={[
            { value: 'updated', label: translate('canvasFilmAsset.t19') },
            { value: 'created', label: translate('canvasFilmAsset.t20') },
            { value: 'name', label: translate('canvasFilmAsset.t21') },
            { value: 'usage', label: translate('canvasFilmAsset.t22') },
          ]}
          className="canvas-film-asset-sort"
        />
      </div>

      {allTags.length > 0 && (
        <div className="canvas-film-asset-tagfilter">
          {allTags.map((tag) => {
            const active = tagFilter.includes(tag)
            return (
              <Tag
                key={tag}
                color={active ? 'blue' : 'default'}
                className="canvas-film-tag-chip canvas-film-tag-filter"
                onClick={() => {
                  setTagFilter((prev) => (active ? prev.filter((t) => t !== tag) : [...prev, tag]))
                }}
              >
                {tag}
              </Tag>
            )
          })}
          {tagFilter.length > 0 && (
            <Button size="middle" type="text" onClick={() => setTagFilter([])}>
              {translate('canvasFilmAsset.t196')}
            </Button>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <Empty
          description={
            assets.length === 0
              ? translate('canvasFilmAsset.tpl8Desc', { kind: FILM_ASSET_KIND_LABELS[kind] })
              : translate('canvasFilmAsset.t23Desc')
          }
          className="canvas-film-empty"
        />
      ) : (
        <div
          className="canvas-film-asset-cards"
          onScroll={(e) => {
            const el = e.currentTarget
            if (
              visibleCount < filtered.length &&
              el.scrollHeight - el.scrollTop - el.clientHeight < 320
            ) {
              setVisibleCount((c) => Math.min(c + ASSET_PAGE_SIZE, filtered.length))
            }
          }}
        >
          {filtered.slice(0, visibleCount).map((asset) => {
            const refs = readReferences(asset.metadata)
            const usage = usageMap.get(asset.id) ?? 0
            const hasCanvasNode = resolveCanvasAssetFocusNodeIds(snapshot, asset.id).length > 0
            const tags = readTags(asset.metadata)
            const coverAsset = resolveCoverAsset(asset)
            const hasImage = assetHasImage(asset)
            return (
              <div key={asset.id} className="canvas-film-asset-card" data-kind={kind}>
                <div className="canvas-film-asset-card-bg">
                  {hasImage ? (
                    <AssetThumbnail asset={coverAsset} />
                  ) : (
                    <div className="canvas-film-asset-card-placeholder" data-kind={kind}>
                      <span className="canvas-film-asset-card-placeholder-icon">
                        {asset.type === 'video' ? (
                          <Icons.Play size={36} />
                        ) : asset.type === 'prompt' ? (
                          <Icons.Edit size={36} />
                        ) : (
                          <Icons.File size={36} />
                        )}
                      </span>
                    </div>
                  )}
                </div>
                {refs.length > 1 && (
                  <span
                    className="canvas-film-asset-card-refcount"
                    title={translate('canvasFilmAsset.tpl9Desc', { count: refs.length })}
                  >
                    <Icons.Image size={11} /> {refs.length}
                  </span>
                )}
                {usage > 0 && (
                  <span
                    className="canvas-film-asset-card-usage"
                    title={translate('canvasFilmAsset.tpl10Desc', { count: usage })}
                  >
                    <Icons.Link size={11} /> {usage}
                  </span>
                )}
                <div className="canvas-film-asset-card-overlay">
                  <div className="canvas-film-asset-card-name" title={asset.title ?? ''}>
                    {asset.title ?? translate('canvasFilmAsset.t15')}
                  </div>
                  <div className="canvas-film-asset-card-preview">
                    {(asset.contentText ?? refs[0]?.description ?? '').slice(0, 80) ||
                      translate('canvasFilmAsset.t24')}
                  </div>
                  {tags.length > 0 && (
                    <div className="canvas-film-asset-card-tags">
                      {tags.slice(0, 3).map((tag) => (
                        <Tag key={tag} className="canvas-film-tag-chip canvas-film-tag-small">
                          {tag}
                        </Tag>
                      ))}
                      {tags.length > 3 && (
                        <span className="canvas-film-asset-card-tagmore">+{tags.length - 3}</span>
                      )}
                    </div>
                  )}
                </div>
                <div className="canvas-film-asset-card-actions">
                  {handlers.onLocateAsset && (
                    <Tooltip
                      title={
                        hasCanvasNode
                          ? translate('canvasFilmAsset.t25')
                          : translate('canvasFilmAsset.t26')
                      }
                    >
                      <Button
                        size="middle"
                        type="text"
                        disabled={!hasCanvasNode}
                        aria-label={translate('canvasFilmAsset.tpl11Desc', {
                          title: asset.title ?? translate('canvasFilmAsset.t15'),
                        })}
                        icon={<Icons.Crosshair size={14} />}
                        onClick={() => handlers.onLocateAsset?.(asset.id)}
                      />
                    </Tooltip>
                  )}
                  {kind === 'script' && handlers.onBreakdownScriptAsset && (
                    <Tooltip title={translate('canvasFilmAsset.t148')}>
                      <Button
                        size="middle"
                        type="text"
                        icon={<Icons.Workflow size={14} />}
                        onClick={() => handleBreakdownScript(asset)}
                      />
                    </Tooltip>
                  )}
                  {kind === 'character' && handlers.onGenerateCharacterSheets && (
                    <Tooltip title={translate('canvasFilmAsset.t149Desc')}>
                      <Button
                        size="middle"
                        type="text"
                        icon={<Icons.Users size={14} />}
                        onClick={() => setSheetAsset(asset)}
                      />
                    </Tooltip>
                  )}
                  {(kind === 'character' ||
                    kind === 'scene' ||
                    kind === 'prop' ||
                    kind === 'effect') &&
                    handlers.onGenerateAssetReference && (
                      <Tooltip title={translate('canvasFilmAsset.t150')}>
                        <Button
                          size="middle"
                          type="text"
                          icon={<Icons.Image size={14} />}
                          onClick={() => handlers.onGenerateAssetReference?.(asset)}
                        />
                      </Tooltip>
                    )}
                  <Tooltip title={translate('canvasFilmAsset.t151')}>
                    <Button
                      size="middle"
                      type="text"
                      icon={<Icons.Edit size={14} />}
                      onClick={() => setEditingId(asset.id)}
                    />
                  </Tooltip>
                  <Tooltip title={translate('canvasFilmAsset.t152')}>
                    <Button
                      size="middle"
                      type="text"
                      icon={<Icons.Sparkles size={14} />}
                      onClick={() => handlers.onOptimizeAsset(asset)}
                    />
                  </Tooltip>
                  <Tooltip title={translate('canvasFilmAsset.t153')}>
                    <Button
                      size="middle"
                      type="text"
                      icon={<Icons.Plus size={14} />}
                      onClick={() => handlers.onInsertAssetToCanvas(asset.id)}
                    />
                  </Tooltip>
                  <Tooltip title={translate('canvasFilmAsset.t16')}>
                    <Button
                      size="middle"
                      type="text"
                      danger
                      icon={<Icons.Trash size={14} />}
                      onClick={() => handleDeleteAsset(asset, usage)}
                    />
                  </Tooltip>
                </div>
              </div>
            )
          })}
          {visibleCount < filtered.length && (
            <button
              type="button"
              className="canvas-film-asset-loadmore"
              onClick={() => setVisibleCount((c) => Math.min(c + ASSET_PAGE_SIZE, filtered.length))}
            >
              {translate('canvasFilmAsset.tpl12Desc', {
                shown: visibleCount,
                total: filtered.length,
              })}
            </button>
          )}
        </div>
      )}
      <Modal
        open={sheetAsset !== null}
        zIndex={FILM_CENTER_NESTED_MODAL_Z_INDEX}
        getContainer={() => document.body}
        title={translate('canvasFilmAsset.tpl13Desc', { title: sheetAsset?.title ?? '' })}
        okText={translate('canvasFilmAsset.tpl14Desc', { count: sheetAspects.length })}
        cancelText={translate('canvasFilmAsset.t17')}
        okButtonProps={{ disabled: sheetAspects.length === 0 }}
        onCancel={() => setSheetAsset(null)}
        onOk={() => {
          if (sheetAsset && sheetAspects.length > 0) {
            handlers.onGenerateCharacterSheets?.(sheetAsset, sheetAspects)
          }
          setSheetAsset(null)
        }}
      >
        <div style={{ marginBottom: 8, color: 'var(--lobe-color-text-secondary, #888)' }}>
          {translate('canvasFilmAsset.tpl15LongDesc')}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {CHARACTER_SHEET_TEMPLATES.map((template) => {
            const checked = sheetAspects.includes(template.aspect)
            return (
              <Tag.CheckableTag
                key={template.aspect}
                checked={checked}
                onChange={(next) => {
                  setSheetAspects((prev) =>
                    next
                      ? [...prev, template.aspect]
                      : prev.filter((aspect) => aspect !== template.aspect),
                  )
                }}
              >
                {template.label}
              </Tag.CheckableTag>
            )
          })}
        </div>
      </Modal>
    </div>
  )
}

// ─── 文稿 Tab：文稿列表 → 章节列表 → 章节正文（下钻 + 分页）──────────────
const CHAPTER_PAGE_SIZE = 50
const READER_PAGE_CHARS = 3000

function ManuscriptTab({
  snapshot,
  handlers,
}: {
  snapshot: CanvasSnapshot
  handlers: FilmCenterHandlers
}) {
  const manuscripts = useMemo(
    () => snapshot.assets.filter((asset) => readAssetKind(asset) === 'manuscript'),
    [snapshot.assets],
  )
  // 下钻导航状态：选中文稿 → 选中章节
  const [manuscriptId, setManuscriptId] = useState<string | null>(null)
  const [chapterId, setChapterId] = useState<string | null>(null)

  const activeManuscript = manuscriptId
    ? (manuscripts.find((m) => m.id === manuscriptId) ?? null)
    : null

  // 该文稿的章节（按 metadata.order 排序；兼容老数据按 tag 兜底）
  const chapters = useMemo(() => {
    if (!activeManuscript) return []
    const legacyTag = translate('canvasFilmAsset.tpl16Desc', {
      title: activeManuscript.title ?? '',
    })
    const list = snapshot.assets.filter((asset) => {
      if (readAssetKind(asset) !== 'chapter') return false
      const meta = asset.metadata as { manuscriptId?: unknown; tags?: unknown } | undefined
      if (typeof meta?.manuscriptId === 'string') return meta.manuscriptId === activeManuscript.id
      return Array.isArray(meta?.tags) && (meta?.tags as unknown[]).includes(legacyTag)
    })
    const orderOf = (a: CanvasAsset) => {
      const o = (a.metadata as { order?: unknown } | undefined)?.order
      return typeof o === 'number' ? o : Number.MAX_SAFE_INTEGER
    }
    return list.sort((a, b) => orderOf(a) - orderOf(b))
  }, [snapshot.assets, activeManuscript])

  const activeChapter = chapterId ? (chapters.find((c) => c.id === chapterId) ?? null) : null

  // 文稿被删/切换后，重置失效的下钻选择
  useEffect(() => {
    if (manuscriptId && !manuscripts.some((m) => m.id === manuscriptId)) {
      setManuscriptId(null)
      setChapterId(null)
    }
  }, [manuscripts, manuscriptId])

  if (activeChapter) {
    return (
      <ChapterReader
        chapter={activeChapter}
        chapters={chapters}
        onBack={() => setChapterId(null)}
        onJump={(id) => setChapterId(id)}
        {...(handlers.onChapterToScreenplay
          ? { onToScreenplay: handlers.onChapterToScreenplay }
          : {})}
      />
    )
  }

  if (activeManuscript) {
    return (
      <ChapterListView
        manuscript={activeManuscript}
        chapters={chapters}
        handlers={handlers}
        onBack={() => setManuscriptId(null)}
        onOpenChapter={(id) => setChapterId(id)}
      />
    )
  }

  return (
    <ManuscriptListView
      manuscripts={manuscripts}
      snapshot={snapshot}
      handlers={handlers}
      onOpen={(id) => {
        setManuscriptId(id)
        setChapterId(null)
      }}
    />
  )
}

/** 文稿列表 + 导入入口 */
function ManuscriptListView({
  manuscripts,
  snapshot,
  handlers,
  onOpen,
}: {
  manuscripts: CanvasAsset[]
  snapshot: CanvasSnapshot
  handlers: FilmCenterHandlers
  onOpen: (manuscriptId: string) => void
}) {
  const [importOpen, setImportOpen] = useState(false)

  // 实时统计每部文稿的章节数（一次遍历）：删单章后也准确，不依赖可能过期的 chapterCount
  const chapterCounts = useMemo(() => {
    const byId = new Map<string, number>()
    const byTag = new Map<string, number>()
    for (const a of snapshot.assets) {
      if (readAssetKind(a) !== 'chapter') continue
      const meta = a.metadata as { manuscriptId?: unknown; tags?: unknown } | undefined
      if (typeof meta?.manuscriptId === 'string') {
        byId.set(meta.manuscriptId, (byId.get(meta.manuscriptId) ?? 0) + 1)
      } else if (Array.isArray(meta?.tags)) {
        for (const tag of meta.tags as unknown[]) {
          if (typeof tag === 'string' && tag.startsWith(translate('canvasFilmAsset.t27'))) {
            byTag.set(tag, (byTag.get(tag) ?? 0) + 1)
          }
        }
      }
    }
    return { byId, byTag }
  }, [snapshot.assets])

  const chapterCountOf = (m: CanvasAsset): number =>
    chapterCounts.byId.get(m.id) ??
    chapterCounts.byTag.get(translate('canvasFilmAsset.tpl16Desc', { title: m.title ?? '' })) ??
    0

  const handleDelete = (m: CanvasAsset): void => {
    if (!handlers.deleteManuscript) return
    const count = chapterCountOf(m)
    Modal.confirm({
      title: translate('canvasFilmAsset.tpl17Desc', {
        title: m.title ?? translate('canvasFilmAsset.t15'),
      }),
      content: translate('canvasFilmAsset.tpl18LongDesc', { count }),
      okText: translate('canvasFilmAsset.t16'),
      cancelText: translate('canvasFilmAsset.t17'),
      okButtonProps: { danger: true },
      onOk: async () => {
        const deleted = await handlers.deleteManuscript!(m.id, { hardDelete: true })
        message.success(translate('canvasFilmAsset.tpl19Desc', { count: deleted }))
      },
    })
  }

  return (
    <div className="canvas-film-asset-list-tab">
      <div className="canvas-film-asset-list-head">
        <span className="canvas-film-asset-list-count">
          {translate('canvasFilmAsset.tpl20Desc', { count: manuscripts.length })}
        </span>
        {handlers.onImportManuscript && (
          <Button
            type="primary"
            size="middle"
            icon={<Icons.Upload size={13} />}
            onClick={() => setImportOpen(true)}
          >
            {translate('canvasFilmAsset.t161')}
          </Button>
        )}
      </div>
      {manuscripts.length === 0 ? (
        <Empty description={translate('canvasFilmAsset.t154Desc')} style={{ marginTop: 48 }} />
      ) : (
        <div className="canvas-film-manuscript-grid">
          {manuscripts.map((m) => (
            <div
              key={m.id}
              className="canvas-film-manuscript-card"
              role="button"
              tabIndex={0}
              onClick={() => onOpen(m.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onOpen(m.id)
              }}
            >
              <div className="canvas-film-manuscript-card-icon">
                <Icons.FileText size={20} />
              </div>
              <div className="canvas-film-manuscript-card-main">
                <div className="canvas-film-manuscript-card-name" title={m.title ?? ''}>
                  {m.title ?? translate('canvasFilmAsset.t28')}
                </div>
                <div className="canvas-film-manuscript-card-meta">
                  {translate('canvasFilmAsset.tpl21Desc', { count: chapterCountOf(m) })}
                </div>
              </div>
              {handlers.deleteManuscript && (
                <Tooltip title={translate('canvasFilmAsset.t155')}>
                  <Button
                    size="middle"
                    type="text"
                    danger
                    icon={<Icons.Trash size={14} />}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(m)
                    }}
                  />
                </Tooltip>
              )}
            </div>
          ))}
        </div>
      )}
      {handlers.onImportManuscript && (
        <ManuscriptImportModal
          open={importOpen}
          onClose={() => setImportOpen(false)}
          onImport={handlers.onImportManuscript}
          {...(handlers.onOptimizeManuscriptDraft
            ? { onOptimizeDraft: handlers.onOptimizeManuscriptDraft }
            : {})}
        />
      )}
    </div>
  )
}

/** 章节列表（分页）：轻量渲染，不展示正文 */
function ChapterListView({
  manuscript,
  chapters,
  handlers,
  onBack,
  onOpenChapter,
}: {
  manuscript: CanvasAsset
  chapters: CanvasAsset[]
  handlers: FilmCenterHandlers
  onBack: () => void
  onOpenChapter: (chapterId: string) => void
}) {
  const [page, setPage] = useState(1)
  const total = chapters.length
  const start = (page - 1) * CHAPTER_PAGE_SIZE
  const pageItems = chapters.slice(start, start + CHAPTER_PAGE_SIZE)

  const charCountOf = (c: CanvasAsset): number => {
    const n = (c.metadata as { charCount?: unknown } | undefined)?.charCount
    if (typeof n === 'number') return n
    return countChars(c.contentText ?? '')
  }

  return (
    <div className="canvas-film-asset-list-tab">
      <div className="canvas-film-chapter-head">
        <Button size="middle" type="text" icon={<Icons.ChevronLeft size={15} />} onClick={onBack}>
          {translate('canvasFilmAsset.t1')}
        </Button>
        <span className="canvas-film-chapter-head-title">
          {translate('canvasFilmAsset.tpl22Desc', {
            title: manuscript.title ?? translate('canvasFilmAsset.t28'),
            total,
          })}
        </span>
      </div>
      {total === 0 ? (
        <Empty description={translate('canvasFilmAsset.t156')} style={{ marginTop: 48 }} />
      ) : (
        <>
          <div className="canvas-film-chapter-list">
            {pageItems.map((chapter, idx) => (
              <div
                key={chapter.id}
                className="canvas-film-chapter-card"
                role="button"
                tabIndex={0}
                onClick={() => onOpenChapter(chapter.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onOpenChapter(chapter.id)
                }}
              >
                <div className="canvas-film-chapter-card-index">
                  <Icons.FileText size={12} />
                  <span>{translate('canvasFilmAsset.tpl23Desc', { index: start + idx + 1 })}</span>
                </div>
                <div className="canvas-film-chapter-card-title" title={chapter.title ?? ''}>
                  {chapter.title ?? translate('canvasFilmAsset.t29')}
                </div>
                <div className="canvas-film-chapter-card-foot">
                  <span className="canvas-film-chapter-card-count">
                    {translate('canvasFilmAsset.tpl24Desc', {
                      count: charCountOf(chapter).toLocaleString(),
                    })}
                  </span>
                  <span className="canvas-film-chapter-card-actions">
                    {handlers.onChapterToScreenplay && (
                      <Tooltip
                        title={translate('canvasFilmAsset.t157Desc')}
                        mouseEnterDelay={0.1}
                        placement="top"
                      >
                        <Button
                          size="middle"
                          type="text"
                          aria-label={translate('canvasFilmAsset.t158')}
                          icon={<Icons.Workflow size={14} />}
                          onClick={(e) => {
                            e.stopPropagation()
                            void handlers.onChapterToScreenplay?.(chapter)
                          }}
                        />
                      </Tooltip>
                    )}
                    <Tooltip
                      title={translate('canvasFilmAsset.t159Desc')}
                      mouseEnterDelay={0.1}
                      placement="top"
                    >
                      <Button
                        size="middle"
                        type="text"
                        aria-label={translate('canvasFilmAsset.t153')}
                        icon={<Icons.Plus size={14} />}
                        onClick={(e) => {
                          e.stopPropagation()
                          handlers.onInsertAssetToCanvas(chapter.id)
                        }}
                      />
                    </Tooltip>
                    <Tooltip
                      title={translate('canvasFilmAsset.t160')}
                      mouseEnterDelay={0.1}
                      placement="top"
                    >
                      <Button
                        size="middle"
                        type="text"
                        danger
                        aria-label={translate('canvasFilmAsset.t160')}
                        icon={<Icons.Trash size={14} />}
                        onClick={(e) => {
                          e.stopPropagation()
                          Modal.confirm({
                            title: translate('canvasFilmAsset.tpl25Desc', {
                              title: chapter.title ?? translate('canvasFilmAsset.t15'),
                            }),
                            okText: translate('canvasFilmAsset.t16'),
                            cancelText: translate('canvasFilmAsset.t17'),
                            okButtonProps: { danger: true },
                            onOk: () => handlers.deleteFilmAsset(chapter.id, { hardDelete: true }),
                          })
                        }}
                      />
                    </Tooltip>
                  </span>
                </div>
              </div>
            ))}
          </div>
          {total > CHAPTER_PAGE_SIZE && (
            <div className="canvas-film-chapter-pager">
              <Pagination
                size="middle"
                current={page}
                pageSize={CHAPTER_PAGE_SIZE}
                total={total}
                showSizeChanger={false}
                onChange={setPage}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** 章节正文阅读：长章节按长度分页 */
function ChapterReader({
  chapter,
  chapters,
  onBack,
  onJump,
  onToScreenplay,
}: {
  chapter: CanvasAsset
  chapters: CanvasAsset[]
  onBack: () => void
  onJump: (chapterId: string) => void
  onToScreenplay?: (asset: CanvasAsset) => Promise<void>
}) {
  const [page, setPage] = useState(1)
  const content = chapter.contentText ?? ''
  const pageCount = Math.max(1, Math.ceil(content.length / READER_PAGE_CHARS))
  // 切换章节时回到第一页
  useEffect(() => {
    setPage(1)
  }, [chapter.id])
  const safePage = Math.min(page, pageCount)
  const pageText = content.slice((safePage - 1) * READER_PAGE_CHARS, safePage * READER_PAGE_CHARS)

  const index = chapters.findIndex((c) => c.id === chapter.id)
  const prev = index > 0 ? chapters[index - 1] : null
  const next = index >= 0 && index < chapters.length - 1 ? chapters[index + 1] : null

  return (
    <div className="canvas-film-asset-list-tab canvas-film-reader">
      <div className="canvas-film-chapter-head">
        <Button size="middle" type="text" icon={<Icons.ChevronLeft size={15} />} onClick={onBack}>
          {translate('canvasFilmAsset.t197')}
        </Button>
        <span className="canvas-film-chapter-head-title">
          {chapter.title ?? translate('canvasFilmAsset.t29')}
        </span>
        {onToScreenplay && (
          <Button
            size="middle"
            icon={<Icons.Workflow size={13} />}
            onClick={() => void onToScreenplay(chapter)}
          >
            {translate('canvasFilmAsset.t198')}
          </Button>
        )}
      </div>
      <div className="canvas-film-reader-body">
        {content ? (
          pageText
        ) : (
          <span style={{ color: 'var(--lobe-color-text-secondary, #888)' }}>
            {translate('canvasFilmAsset.t199')}
          </span>
        )}
      </div>
      <div className="canvas-film-reader-footer">
        <Button
          size="middle"
          disabled={!prev}
          icon={<Icons.ChevronLeft size={14} />}
          onClick={() => prev && onJump(prev.id)}
        >
          {translate('canvasFilmAsset.t200')}
        </Button>
        {pageCount > 1 && (
          <Pagination
            size="middle"
            simple
            current={safePage}
            pageSize={READER_PAGE_CHARS}
            total={content.length}
            onChange={setPage}
          />
        )}
        <Button size="middle" disabled={!next} onClick={() => next && onJump(next.id)}>
          {translate('canvasFilmAsset.t201')}
          <Icons.ChevronRight size={14} />
        </Button>
      </div>
    </div>
  )
}

/** 文稿导入弹窗：文件/粘贴 → 解析目录 → 选择章节范围（默认前 20 章）→ 导入
 * 多选文件时强制走「一文件一章」模式，跳过分章开关与范围选择。 */
function ManuscriptImportModal({
  open,
  onClose,
  onImport,
  onOptimizeDraft,
}: {
  open: boolean
  onClose: () => void
  onImport: NonNullable<FilmCenterHandlers['onImportManuscript']>
  onOptimizeDraft?: (text: string) => void
}) {
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [files, setFiles] = useState<{ name: string; text: string }[]>([])
  const [splitChapters, setSplitChapters] = useState(true)
  const [parsing, setParsing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [rangeFrom, setRangeFrom] = useState(1)
  const [rangeTo, setRangeTo] = useState(20)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const isMultiFile = files.length >= 2
  const singleFile = files.length === 1 ? files[0] : null
  const sourceText = singleFile?.text ?? text
  const singleChapterTitle =
    title.trim() || singleFile?.name.replace(/\.[^.]+$/, '') || translate('canvasFilmAsset.t30')
  const preview = useMemo<ChapterSplitResult | null>(() => {
    if (isMultiFile) return buildChaptersFromFiles(files)
    if (!sourceText.trim()) return null
    return splitChapters
      ? splitTextIntoChapters(sourceText)
      : createSingleChapterResult(sourceText, singleChapterTitle)
  }, [files, isMultiFile, singleChapterTitle, sourceText, splitChapters])
  const total = preview?.chapters.length ?? 0

  // 解析出目录后，默认范围 1 ~ min(20, total)
  useEffect(() => {
    if (total > 0) {
      setRangeFrom(1)
      setRangeTo(Math.min(20, total))
    }
  }, [total])

  const reset = useCallback(() => {
    setTitle('')
    setText('')
    setFiles([])
    setSplitChapters(true)
    setRangeFrom(1)
    setRangeTo(20)
  }, [])

  // 打开时重置
  useEffect(() => {
    if (open) reset()
  }, [open, reset])

  const pickFiles = useCallback(async (picked: File[]) => {
    if (picked.length === 0) return
    setParsing(true)
    try {
      const decoded: { name: string; text: string }[] = []
      const skipped: string[] = []
      for (const file of picked) {
        const buffer = await file.arrayBuffer()
        const text = decodeManuscriptBuffer(buffer)
        if (!text.trim()) {
          skipped.push(file.name)
          continue
        }
        decoded.push({ name: file.name, text })
      }
      if (decoded.length === 0) {
        message.error(translate('canvasFilmAsset.t31Desc'))
        return
      }
      setFiles(decoded)
      setText('')
      if (decoded.length === 1) {
        const only = decoded[0]!
        setTitle((prev) => prev.trim() || only.name.replace(/\.[^.]+$/, ''))
      } else {
        // 多文件场景：文稿标题由用户填写，章节标题用文件名
        setTitle((prev) => prev.trim())
      }
      if (skipped.length > 0) {
        message.warning(
          translate('canvasFilmAsset.tpl26Desc', {
            count: skipped.length,
            names: skipped.join(', '),
          }),
        )
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : translate('canvasFilmAsset.t32'))
    } finally {
      setParsing(false)
    }
  }, [])

  const clampedFrom = Math.min(Math.max(1, rangeFrom), total || 1)
  const clampedTo = Math.min(Math.max(clampedFrom, rangeTo), total || 1)
  // 多文件模式：全量导入，不做范围切片
  const selectedCount = isMultiFile ? total : total > 0 ? clampedTo - clampedFrom + 1 : 0

  return (
    <Modal
      open={open}
      title={translate('canvasFilmAsset.t161')}
      zIndex={FILM_CENTER_NESTED_MODAL_Z_INDEX}
      getContainer={() => document.body}
      okText={
        selectedCount > 0
          ? translate('canvasFilmAsset.tpl27Desc', { count: selectedCount })
          : translate('canvasFilmAsset.t33')
      }
      cancelText={translate('canvasFilmAsset.t17')}
      okButtonProps={{ disabled: selectedCount === 0 || parsing, loading: importing }}
      mask={{ closable: false }}
      width={920}
      styles={{
        body: {
          height: 'min(76vh, 780px)',
          overflowY: 'auto',
        },
      }}
      onCancel={onClose}
      onOk={async () => {
        if (!preview || selectedCount === 0) return
        // 多文件模式：全量导入；单文件/粘贴：按范围切片（1-based → 0-based）
        const chapters = isMultiFile
          ? preview.chapters
          : preview.chapters.slice(clampedFrom - 1, clampedTo)
        setImporting(true)
        try {
          const count = await onImport({
            title:
              title.trim() ||
              (isMultiFile
                ? translate('canvasFilmAsset.tpl28Desc', { count: files.length })
                : singleFile?.name.replace(/\.[^.]+$/, '')) ||
              translate('canvasFilmAsset.t28'),
            mode: preview.mode,
            chapters,
          })
          message.success(translate('canvasFilmAsset.tpl29Desc', { count }))
          onClose()
        } catch (error) {
          message.error(error instanceof Error ? error.message : translate('canvasFilmAsset.t34'))
        } finally {
          setImporting(false)
        }
      }}
    >
      <Input
        placeholder={translate('canvasFilmAsset.t162Desc')}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        style={{ marginBottom: 8 }}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.md,.markdown,.text,text/plain"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? [])
          if (picked.length > 0) void pickFiles(picked)
          e.target.value = ''
        }}
      />
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <Button
          size="middle"
          icon={<Icons.FolderOpen size={13} />}
          loading={parsing}
          onClick={() => fileInputRef.current?.click()}
        >
          {files.length > 0
            ? translate('canvasFilmAsset.tpl30Desc', { count: files.length })
            : translate('canvasFilmAsset.t35Desc')}
        </Button>
        {files.length > 0 && (
          <Button size="middle" icon={<Icons.X size={13} />} onClick={() => setFiles([])}>
            {translate('canvasFilmAsset.t202')}
          </Button>
        )}
      </div>
      {!isMultiFile && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 8,
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid var(--lobe-color-border, #e5e5e5)',
            background: 'var(--lobe-color-fill-quaternary, rgba(0,0,0,0.02))',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{translate('canvasFilmAsset.t203')}</div>
            <div
              style={{
                marginTop: 2,
                color: 'var(--lobe-color-text-secondary, #888)',
                fontSize: 12,
              }}
            >
              {splitChapters
                ? translate('canvasFilmAsset.t36Desc')
                : translate('canvasFilmAsset.t37')}
            </div>
          </div>
          <Switch
            checked={splitChapters}
            checkedChildren={translate('canvasFilmAsset.t163')}
            unCheckedChildren={translate('canvasFilmAsset.t164')}
            onChange={setSplitChapters}
          />
        </div>
      )}
      {isMultiFile && (
        <div
          style={{
            marginBottom: 8,
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid var(--lobe-color-border, #e5e5e5)',
            background: 'var(--lobe-color-fill-quaternary, rgba(0,0,0,0.02))',
            fontSize: 12,
            color: 'var(--lobe-color-text-secondary, #888)',
          }}
        >
          {translate('canvasFilmAsset.tpl31LongDesc', { count: files.length, total })}
        </div>
      )}
      {files.length > 0 ? (
        <div
          style={{
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid var(--lobe-color-border, #e5e5e5)',
            background: 'var(--lobe-color-fill-quaternary, rgba(0,0,0,0.02))',
            fontSize: 13,
            maxHeight: isMultiFile ? 220 : undefined,
            overflowY: isMultiFile ? 'auto' : undefined,
          }}
        >
          {files.map((file, idx) => (
            <div
              key={`${file.name}-${idx}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontWeight: 600,
                paddingBottom: isMultiFile && idx < files.length - 1 ? 6 : 0,
                marginBottom: isMultiFile && idx < files.length - 1 ? 6 : 0,
                borderBottom:
                  isMultiFile && idx < files.length - 1
                    ? '1px solid var(--lobe-color-border, #e5e5e5)'
                    : 'none',
              }}
            >
              <Icons.FileText size={14} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {file.name}
              </span>
              <span
                style={{
                  flexShrink: 0,
                  color: 'var(--lobe-color-text-secondary, #888)',
                  fontSize: 12,
                  fontWeight: 400,
                }}
              >
                {translate('canvasFilmAsset.tpl24Desc', {
                  count: countChars(file.text).toLocaleString(),
                })}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="canvas-manuscript-rich-editor">
          <CanvasPromptEditor
            prompt={text}
            negativePrompt=""
            promptPlaceholder={
              splitChapters
                ? translate('canvasFilmAsset.tpl32LongDesc')
                : translate('canvasFilmAsset.tpl33Desc')
            }
            optimizeDisabled={text.trim().length === 0 || !onOptimizeDraft}
            onPromptChange={setText}
            onNegativePromptChange={() => undefined}
            onOptimizePrompt={() => onOptimizeDraft?.(text)}
          />
        </div>
      )}
      {preview && (
        <div style={{ marginTop: 10 }}>
          <div style={{ color: 'var(--lobe-color-text-secondary, #888)', marginBottom: 6 }}>
            {translate('canvasFilmAsset.tpl34Desc', {
              mode: CHAPTER_SPLIT_MODE_LABELS[preview.mode],
              total,
            })}
            {total > 0 &&
              translate('canvasFilmAsset.tpl35Desc', { title: preview.chapters[0]?.title ?? '' })}
          </div>
          {total > 0 && !isMultiFile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span>{translate('canvasFilmAsset.tpl36Desc')}</span>
              <InputNumber
                size="middle"
                min={1}
                max={total}
                value={clampedFrom}
                onChange={(v) => setRangeFrom(typeof v === 'number' ? v : 1)}
                style={{ width: 80 }}
              />
              <span>{translate('canvasFilmAsset.t204')}</span>
              <InputNumber
                size="middle"
                min={clampedFrom}
                max={total}
                value={clampedTo}
                onChange={(v) => setRangeTo(typeof v === 'number' ? v : clampedFrom)}
                style={{ width: 80 }}
              />
              <span>{translate('canvasFilmAsset.t205')}</span>
              {total > 20 && (
                <Button
                  size="middle"
                  type="link"
                  onClick={() => {
                    setRangeFrom(1)
                    setRangeTo(Math.min(20, total))
                  }}
                >
                  {translate('canvasFilmAsset.t206')}
                </Button>
              )}
              <span style={{ color: 'var(--lobe-color-text-secondary, #888)' }}>
                {translate('canvasFilmAsset.tpl37Desc', { count: selectedCount })}
              </span>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

// ─── 资产编辑器（新建/编辑共用，v2：多图多描述）─────────────────────────
type AssetEditorSave = {
  name: string
  text: string
  references: FilmReference[]
  tags: string[]
  prompt?: string
  attributes?: Record<string, string>
}

function AssetEditor({
  kind,
  mode,
  asset,
  onClose,
  onSave,
  onOptimize,
  onUploadImage,
  assetById,
  getFilmAssetUsage,
}: {
  kind: FilmAssetKind
  mode: 'create' | 'edit'
  asset?: CanvasAsset
  onClose: () => void
  onSave: (input: AssetEditorSave) => Promise<void>
  onOptimize?: () => void
  /** 上传图片到项目资产库，返回新 assetId */
  onUploadImage?: (file: File) => Promise<string | null>
  /** 通过 assetId 查 asset（用于 reference 缩略图） */
  assetById?: (id: string) => CanvasAsset | undefined
  /** 资源被谁引用（仅编辑模式渲染） */
  getFilmAssetUsage?: FilmCenterHandlers['getFilmAssetUsage']
}) {
  const [name, setName] = useState(asset?.title ?? '')
  const [text, setText] = useState(asset?.contentText ?? '')
  const [prompt, setPrompt] = useState((asset?.metadata?.prompt as string | undefined) ?? '')
  const [references, setReferences] = useState<FilmReference[]>(() =>
    readReferences(asset?.metadata),
  )
  const [tags, setTags] = useState<string[]>(() => readTags(asset?.metadata))
  const [tagDraft, setTagDraft] = useState('')

  const attributeFields = useMemo(() => getAttributeFields(kind), [kind])
  const [attributes, setAttributes] = useState<Record<string, string>>(() => {
    const stored = asset?.metadata?.attributes as Record<string, string> | undefined
    const init: Record<string, string> = {}
    for (const field of attributeFields) {
      init[field.key] = readStoredAttribute(stored, field.key, field.aliases) ?? ''
    }
    return init
  })

  // 上传本地图片：交给父级 onUploadImage 落库，返回新 assetId 后入 references
  const handleAddLocalImage = useCallback(
    async (file: File) => {
      if (!onUploadImage) {
        message.warning(translate('canvasFilmAsset.t38'))
        return
      }
      const assetId = await onUploadImage(file)
      if (!assetId) return
      const ref: FilmReference = {
        id: filmUid('ref'),
        kind: guessReferenceKind(file.name),
        assetId,
        description: '',
        order: references.length,
      }
      setReferences((prev) => [...prev, ref])
    },
    [onUploadImage, references.length],
  )

  const handleAddTag = () => {
    const t = tagDraft.trim()
    if (!t) return
    if (tags.includes(t)) {
      setTagDraft('')
      return
    }
    setTags((prev) => [...prev, t])
    setTagDraft('')
  }

  const handleRemoveTag = (tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag))
  }

  const handleSave = async () => {
    if (!name.trim()) {
      message.warning(translate('canvasFilmAsset.t39'))
      return
    }
    const cleanAttrs: Record<string, string> = {}
    for (const field of attributeFields) {
      const val = attributes[field.key]?.trim()
      if (val) cleanAttrs[field.key] = val
    }
    const cleanRefs = references
      .filter((ref) => ref.assetId)
      .map((ref, idx) => ({ ...ref, order: idx }))
    await onSave({
      name: name.trim(),
      text,
      references: cleanRefs,
      tags,
      ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
      ...(Object.keys(cleanAttrs).length > 0 ? { attributes: cleanAttrs } : {}),
    })
  }

  return (
    <div className="canvas-film-asset-editor">
      <div className="canvas-film-editor-head">
        <Button size="middle" type="text" icon={<Icons.ArrowLeft size={14} />} onClick={onClose}>
          {translate('canvasFilmAsset.t207')}
        </Button>
        <div className="canvas-film-editor-actions">
          {mode === 'edit' && onOptimize && (
            <Button size="middle" icon={<Icons.Sparkles size={13} />} onClick={onOptimize}>
              {translate('canvasFilmAsset.t152')}
            </Button>
          )}
          <Button
            size="middle"
            type="primary"
            icon={<Icons.Check size={13} />}
            onClick={() => void handleSave()}
          >
            {translate('canvasFilmAsset.t208')}
          </Button>
        </div>
      </div>
      <div className="canvas-film-editor-form">
        <label className="canvas-film-editor-field">
          <span>{translate('canvasFilmAsset.t209')}</span>
          <Input
            value={name}
            placeholder={translate('canvasFilmAsset.tpl38Desc', {
              kind: FILM_ASSET_KIND_LABELS[kind],
            })}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        {/* 类型专属快速字段（character/scene/prop/effect） */}
        {attributeFields.length > 0 && (
          <div className="canvas-film-editor-attributes">
            <div className="canvas-film-editor-section-title">
              {translate('canvasFilmAsset.t210')}
            </div>
            <div className="canvas-film-editor-attr-grid">
              {attributeFields.map((field) => (
                <label key={field.key} className="canvas-film-editor-field">
                  <span>{field.label}</span>
                  <Input
                    value={attributes[field.key] ?? ''}
                    placeholder={field.placeholder}
                    onChange={(e) => setAttributes({ ...attributes, [field.key]: e.target.value })}
                  />
                </label>
              ))}
            </div>
          </div>
        )}

        {/* 标签 */}
        <div className="canvas-film-editor-section">
          <div className="canvas-film-editor-section-title">
            {translate('canvasFilmAsset.t211')}
          </div>
          <div className="canvas-film-tag-list">
            {tags.map((tag) => (
              <Tag
                key={tag}
                closable
                onClose={() => handleRemoveTag(tag)}
                className="canvas-film-tag-chip"
              >
                {tag}
              </Tag>
            ))}
            <Input
              size="middle"
              value={tagDraft}
              placeholder={translate('canvasFilmAsset.t165')}
              className="canvas-film-tag-input"
              onChange={(e) => setTagDraft(e.target.value)}
              onPressEnter={handleAddTag}
              onBlur={handleAddTag}
            />
          </div>
        </div>

        {/* 多图多描述（references grid） */}
        {(kind === 'character' || kind === 'scene' || kind === 'prop' || kind === 'effect') && (
          <div className="canvas-film-editor-section">
            <div className="canvas-film-editor-section-title-row">
              <span className="canvas-film-editor-section-title">
                {translate('canvasFilmAsset.t212Desc')}
              </span>
              <ReferenceToolbar
                onAddLocal={handleAddLocalImage}
                onAddFromCanvas={() => {
                  message.info(translate('canvasFilmAsset.tpl39Desc'))
                }}
              />
            </div>
            {references.length === 0 ? (
              <div className="canvas-film-references-empty">
                {translate('canvasFilmAsset.tpl40LongDesc')}
              </div>
            ) : (
              <div className="canvas-film-references-grid">
                {references
                  .slice()
                  .sort((a, b) => a.order - b.order)
                  .map((ref, idx) => (
                    <ReferenceCard
                      key={ref.id}
                      reference={ref}
                      linkedAsset={assetById?.(ref.assetId)}
                      onChange={(next) => {
                        setReferences((prev) => {
                          const copy = prev.slice()
                          copy[idx] = next
                          return copy
                        })
                      }}
                      onRemove={() => {
                        setReferences((prev) => prev.filter((_, i) => i !== idx))
                      }}
                    />
                  ))}
              </div>
            )}
          </div>
        )}

        {/* 整体描述（剧本文本/整体设定） */}
        <label className="canvas-film-editor-field">
          <span>
            {kind === 'script'
              ? translate('canvasFilmAsset.t40')
              : kind === 'prompt_library'
                ? translate('canvasFilmAsset.t41')
                : translate('canvasFilmAsset.t42')}
          </span>
          <Input.TextArea
            rows={kind === 'script' ? 14 : kind === 'prompt_library' ? 8 : 6}
            autoSize={{
              minRows: kind === 'script' ? 14 : kind === 'prompt_library' ? 8 : 8,
              maxRows: 22,
            }}
            value={text}
            placeholder={getEditorPlaceholder(kind)}
            onChange={(e) => setText(e.target.value)}
          />
        </label>

        {/* 默认生成 prompt */}
        {(kind === 'prompt_library' ||
          kind === 'character' ||
          kind === 'scene' ||
          kind === 'prop' ||
          kind === 'effect') && (
          <label className="canvas-film-editor-field">
            <span>{translate('canvasFilmAsset.tpl41Desc')}</span>
            <div className="canvas-film-editor-prompt-count-wrap">
              <Input.TextArea
                className="canvas-film-editor-prompt-input"
                rows={5}
                autoSize={{ minRows: 5, maxRows: 16 }}
                value={prompt}
                placeholder={translate('canvasFilmAsset.t166Desc')}
                onChange={(e) => setPrompt(e.target.value)}
              />
              <span className="canvas-film-editor-prompt-count">
                {translate('canvasFilmAsset.tpl42Desc', {
                  count: prompt.trim().length.toLocaleString(),
                })}
              </span>
            </div>
          </label>
        )}

        {/* 引用关系（仅编辑模式） */}
        {mode === 'edit' && asset && getFilmAssetUsage && (
          <UsagePanel assetId={asset.id} getUsage={getFilmAssetUsage} />
        )}
      </div>
    </div>
  )
}

/** 「被谁引用」面板（编辑模式） */
function UsagePanel({
  assetId,
  getUsage,
}: {
  assetId: string
  getUsage: (assetId: string) => {
    shotSegments: Array<{
      groupId: string
      groupName: string
      segmentId: string
      segmentTitle: string
      segmentIndex: number
    }>
    nodes: Array<{ id: string; type: string; title: string | null }>
  }
}) {
  const usage = useMemo(() => getUsage(assetId), [getUsage, assetId])
  const total = usage.shotSegments.length + usage.nodes.length
  return (
    <div className="canvas-film-usage-panel">
      <div className="canvas-film-editor-section-title">
        {translate('canvasFilmAsset.tpl43Desc', { total })}
      </div>
      {total === 0 ? (
        <div className="canvas-film-references-empty">
          {translate('canvasFilmAsset.tpl44LongDesc')}
        </div>
      ) : (
        <div className="canvas-film-usage-list">
          {usage.shotSegments.length > 0 && (
            <div className="canvas-film-usage-group">
              <div className="canvas-film-usage-group-title">
                {translate('canvasFilmAsset.t213')}
              </div>
              {usage.shotSegments.map((s) => (
                <div key={`${s.groupId}:${s.segmentId}`} className="canvas-film-usage-item">
                  <Icons.Layers size={12} />
                  <span className="canvas-film-usage-groupname">{s.groupName}</span>
                  <span className="canvas-film-usage-separator">›</span>
                  <span className="canvas-film-usage-segmenttitle">
                    #{s.segmentIndex} {s.segmentTitle}
                  </span>
                </div>
              ))}
            </div>
          )}
          {usage.nodes.length > 0 && (
            <div className="canvas-film-usage-group">
              <div className="canvas-film-usage-group-title">
                {translate('canvasFilmAsset.t214')}
              </div>
              {usage.nodes.map((n) => (
                <div key={n.id} className="canvas-film-usage-item">
                  <Icons.File size={12} />
                  <span>{n.title ?? n.type}</span>
                  <Tag bordered className="canvas-film-usage-nodetype">
                    {n.type}
                  </Tag>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// 工具：从文件名猜 reference kind
function guessReferenceKind(fileName: string): FilmReferenceKind {
  const name = fileName.toLowerCase()
  if (
    name.includes('concept') ||
    name.includes(translate('canvasFilmAsset.t43')) ||
    name.includes(translate('canvasFilmAsset.t44'))
  )
    return 'concept'
  if (name.includes('expression') || name.includes(translate('canvasFilmAsset.t45')))
    return 'expression'
  if (
    name.includes('costume') ||
    name.includes(translate('canvasFilmAsset.t46')) ||
    name.includes(translate('canvasFilmAsset.t47'))
  )
    return 'costume'
  if (name.includes('action') || name.includes(translate('canvasFilmAsset.t48'))) return 'action'
  if (name.includes('storyboard') || name.includes(translate('canvasFilmAsset.t8')))
    return 'storyboard'
  if (name.includes('angle') || name.includes(translate('canvasFilmAsset.t49'))) return 'angle'
  return 'reference'
}

// ─── reference 子组件 ──────────────────────────────────────────────────────
function ReferenceCard({
  reference,
  linkedAsset,
  onChange,
  onRemove,
}: {
  reference: FilmReference
  linkedAsset: CanvasAsset | undefined
  onChange: (next: FilmReference) => void
  onRemove: () => void
}) {
  return (
    <div className="canvas-film-reference-card">
      <div className="canvas-film-reference-thumb">
        {linkedAsset ? (
          <AssetThumbnail asset={linkedAsset} />
        ) : (
          <div className="canvas-film-reference-missing">{translate('canvasFilmAsset.t216')}</div>
        )}
        <Button
          size="middle"
          type="text"
          danger
          icon={<Icons.Trash size={13} />}
          className="canvas-film-reference-remove"
          onClick={onRemove}
        />
      </div>
      <div className="canvas-film-reference-fields">
        <Select
          size="middle"
          value={reference.kind}
          onChange={(value) => onChange({ ...reference, kind: value })}
          options={FILM_REFERENCE_KIND_ORDER.map((kind) => ({
            value: kind,
            label: FILM_REFERENCE_KIND_LABELS[kind],
          }))}
        />
        <Input
          size="middle"
          value={reference.label ?? ''}
          placeholder={translate('canvasFilmAsset.t167')}
          onChange={(e) => {
            const v = e.target.value.trim()
            const next = { ...reference }
            if (v) next.label = v
            else delete (next as { label?: string }).label
            onChange(next)
          }}
        />
        <Input.TextArea
          size="middle"
          rows={3}
          value={reference.description}
          placeholder={translate('canvasFilmAsset.t168Desc')}
          onChange={(e) => onChange({ ...reference, description: e.target.value })}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Switch
            size="middle"
            checked={Boolean(reference.isPrimary)}
            onChange={(checked) => onChange({ ...reference, isPrimary: checked })}
          />
          <span style={{ fontSize: 12 }}>{translate('canvasFilmAsset.t217')}</span>
          <Switch
            size="middle"
            checked={Boolean(reference.locked)}
            onChange={(checked) => onChange({ ...reference, locked: checked })}
          />
          <span style={{ fontSize: 12 }}>{translate('canvasFilmAsset.t218')}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Select
            size="middle"
            style={{ flex: 1 }}
            value={reference.usage ?? 'other'}
            onChange={(usage) => onChange({ ...reference, usage })}
            options={[
              { value: 'identity', label: translate('canvasFilmAsset.t50') },
              { value: 'style', label: translate('canvasFilmAsset.t51') },
              { value: 'pose', label: translate('canvasFilmAsset.t52') },
              { value: 'costume', label: translate('canvasFilmAsset.t47') },
              { value: 'scene_layout', label: translate('canvasFilmAsset.t53') },
              { value: 'lighting', label: translate('canvasFilmAsset.t54') },
              { value: 'other', label: translate('canvasFilmAsset.t55') },
            ]}
          />
          <InputNumber
            size="middle"
            min={0}
            max={1}
            step={0.05}
            value={reference.strength ?? 0.6}
            onChange={(value) => onChange({ ...reference, strength: Number(value ?? 0.6) })}
          />
        </div>
      </div>
    </div>
  )
}

function ReferenceToolbar({
  onAddLocal,
  onAddFromCanvas,
}: {
  onAddLocal: (file: File) => void | Promise<void>
  onAddFromCanvas: () => void
}) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  return (
    <div className="canvas-film-reference-toolbar">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void onAddLocal(file)
          e.target.value = ''
        }}
      />
      <Button
        size="middle"
        icon={<Icons.Upload size={13} />}
        onClick={() => fileRef.current?.click()}
      >
        {translate('canvasFilmAsset.t219')}
      </Button>
      <Button size="middle" icon={<Icons.Image size={13} />} onClick={onAddFromCanvas}>
        {translate('canvasFilmAsset.t220')}
      </Button>
    </div>
  )
}

/** 各资产种类的附加属性字段 */
function getAttributeFields(
  kind: FilmAssetKind,
): Array<{ key: string; label: string; placeholder: string; aliases?: string[] }> {
  switch (kind) {
    case 'character':
      return [
        {
          key: 'age',
          label: translate('canvasFilmAsset.t56'),
          placeholder: translate('canvasFilmAsset.t57'),
          aliases: [
            translate('canvasFilmAsset.t58'),
            translate('canvasFilmAsset.t59'),
            translate('canvasFilmAsset.t60'),
          ],
        },
        {
          key: 'gender',
          label: translate('canvasFilmAsset.t61'),
          placeholder: translate('canvasFilmAsset.t62'),
          aliases: [translate('canvasFilmAsset.t61')],
        },
        {
          key: 'occupation',
          label: translate('canvasFilmAsset.t63'),
          placeholder: translate('canvasFilmAsset.t64'),
          aliases: [
            translate('canvasFilmAsset.t50'),
            translate('canvasFilmAsset.t65'),
            translate('canvasFilmAsset.t66'),
          ],
        },
        {
          key: 'appearance',
          label: translate('canvasFilmAsset.t67'),
          placeholder: translate('canvasFilmAsset.t68'),
          aliases: [
            translate('canvasFilmAsset.t69'),
            translate('canvasFilmAsset.t70'),
            translate('canvasFilmAsset.t71'),
          ],
        },
        {
          key: 'hair',
          label: translate('canvasFilmAsset.t72'),
          placeholder: translate('canvasFilmAsset.t73'),
          aliases: [
            translate('canvasFilmAsset.t72'),
            translate('canvasFilmAsset.t74'),
            translate('canvasFilmAsset.t75'),
          ],
        },
        {
          key: 'costume',
          label: translate('canvasFilmAsset.t46'),
          placeholder: translate('canvasFilmAsset.t76'),
          aliases: [
            translate('canvasFilmAsset.t46'),
            translate('canvasFilmAsset.t47'),
            translate('canvasFilmAsset.t77'),
          ],
        },
        {
          key: 'signatureProp',
          label: translate('canvasFilmAsset.t78'),
          placeholder: translate('canvasFilmAsset.t79'),
          aliases: [
            translate('canvasFilmAsset.t78'),
            translate('canvasFilmAsset.t80'),
            translate('canvasFilmAsset.t6'),
          ],
        },
        {
          key: 'personality',
          label: translate('canvasFilmAsset.t81'),
          placeholder: translate('canvasFilmAsset.t82'),
          aliases: [
            translate('canvasFilmAsset.t83'),
            translate('canvasFilmAsset.t84'),
            translate('canvasFilmAsset.t85'),
          ],
        },
        {
          key: 'voice',
          label: translate('canvasFilmAsset.t86'),
          placeholder: translate('canvasFilmAsset.t87'),
          aliases: [
            translate('canvasFilmAsset.t86'),
            translate('canvasFilmAsset.t88'),
            translate('canvasFilmAsset.t89'),
          ],
        },
      ]
    case 'scene':
      return [
        {
          key: 'settingType',
          label: translate('canvasFilmAsset.t90'),
          placeholder: translate('canvasFilmAsset.t91'),
          aliases: [
            translate('canvasFilmAsset.t92'),
            translate('canvasFilmAsset.t93'),
            translate('canvasFilmAsset.t94'),
          ],
        },
        {
          key: 'location',
          label: translate('canvasFilmAsset.t95'),
          placeholder: translate('canvasFilmAsset.t96'),
          aliases: [
            translate('canvasFilmAsset.t97'),
            translate('canvasFilmAsset.t98'),
            translate('canvasFilmAsset.t99'),
          ],
        },
        {
          key: 'timeOfDay',
          label: translate('canvasFilmAsset.t100'),
          placeholder: translate('canvasFilmAsset.t101'),
          aliases: [
            translate('canvasFilmAsset.t102'),
            translate('canvasFilmAsset.t103'),
            translate('canvasFilmAsset.t100'),
          ],
        },
        {
          key: 'weather',
          label: translate('canvasFilmAsset.t104'),
          placeholder: translate('canvasFilmAsset.t110'),
          aliases: ['天气'],
        }, // i18n-exempt-line: 字段别名（供 AI 输出匹配，非 UI 文案）
        {
          key: 'lighting',
          label: translate('canvasFilmAsset.t106'),
          placeholder: translate('canvasFilmAsset.t107'),
          aliases: [
            translate('canvasFilmAsset.t106'),
            translate('canvasFilmAsset.t54'),
            translate('canvasFilmAsset.t108'),
          ],
        },
        {
          key: 'colorTone',
          label: translate('canvasFilmAsset.t109'),
          placeholder: translate('canvasFilmAsset.t110'),
          aliases: [
            translate('canvasFilmAsset.t111'),
            translate('canvasFilmAsset.t112'),
            translate('canvasFilmAsset.t113'),
          ],
        },
        {
          key: 'artDirection',
          label: translate('canvasFilmAsset.t114'),
          placeholder: translate('canvasFilmAsset.t115'),
          aliases: [
            translate('canvasFilmAsset.t116'),
            translate('canvasFilmAsset.t114'),
            translate('canvasFilmAsset.t51'),
          ],
        },
        {
          key: 'mood',
          label: translate('canvasFilmAsset.t117'),
          placeholder: translate('canvasFilmAsset.t118'),
          aliases: [
            translate('canvasFilmAsset.t117'),
            translate('canvasFilmAsset.t119'),
            translate('canvasFilmAsset.t120'),
          ],
        },
      ]
    case 'prop':
      return [
        {
          key: 'usage',
          label: translate('canvasFilmAsset.t121'),
          placeholder: translate('canvasFilmAsset.t122'),
        },
        {
          key: 'owner',
          label: translate('canvasFilmAsset.t123'),
          placeholder: translate('canvasFilmAsset.t124'),
        },
      ]
    default:
      return []
  }
}

function readStoredAttribute(
  stored: Record<string, string> | undefined,
  key: string,
  aliases: string[] | undefined,
): string | undefined {
  const direct = stored?.[key]?.trim()
  if (direct) return direct
  for (const alias of aliases ?? []) {
    const value = stored?.[alias]?.trim()
    if (value) return value
  }
  return undefined
}

function getEditorPlaceholder(kind: FilmAssetKind): string {
  switch (kind) {
    case 'script':
      return translate('canvasFilmAsset.tpl45Instruction')
    case 'prompt_library':
      return translate('canvasFilmAsset.tpl46Instruction')
    default:
      return translate('canvasFilmAsset.tpl47Desc')
  }
}

function ShotGroupTab({
  snapshot,
  handlers,
}: {
  snapshot: CanvasSnapshot
  handlers: FilmCenterHandlers
}) {
  // 从 snapshot.project.metadata 读 shotGroups
  const shotGroups = useMemo<ShotGroup[]>(() => {
    const film = snapshot.project.metadata?.film as { shotGroups?: ShotGroup[] } | undefined
    return film?.shotGroups ?? []
  }, [snapshot.project.metadata])

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(shotGroups[0]?.id ?? null)
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [edlOpen, setEdlOpen] = useState(false)
  // 风格预设（设计 §S5）
  const stylePresets = useMemo(
    () => readStylePresets(snapshot.project.metadata),
    [snapshot.project.metadata],
  )
  const productionBible = useMemo(
    () => readProductionBible(snapshot.project.metadata),
    [snapshot.project.metadata],
  )
  const [presetOpen, setPresetOpen] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [presetKind, setPresetKind] = useState<FilmStylePreset['kind']>('camera')
  const [presetFragment, setPresetFragment] = useState('')

  const timeline = useMemo(() => buildTimeline(shotGroups), [shotGroups])
  const edlMarkdown = useMemo(
    () => buildEdlMarkdown(snapshot.project.title ?? translate('canvasFilmAsset.t125'), timeline),
    [snapshot.project.title, timeline],
  )

  const selectedGroup = shotGroups.find((g) => g.id === selectedGroupId) ?? null

  // 可选角色/场景/道具（供分镜片段引用）
  const characterAssets = useMemo(
    () => snapshot.assets.filter((a) => readAssetKind(a) === 'character'),
    [snapshot.assets],
  )
  const sceneAssets = useMemo(
    () => snapshot.assets.filter((a) => readAssetKind(a) === 'scene'),
    [snapshot.assets],
  )

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return
    const group = await handlers.createShotGroup({ name: newGroupName.trim() })
    setSelectedGroupId(group.id)
    setNewGroupName('')
    setCreatingGroup(false)
  }

  return (
    <div className="canvas-film-shots-tab">
      <div className="canvas-film-shots-sidebar">
        <div className="canvas-film-shots-sidebar-head">
          <span>{translate('canvasFilmAsset.t9')}</span>
          <div style={{ display: 'flex', gap: 2 }}>
            {handlers.onSaveStylePreset && (
              <Tooltip title={translate('canvasFilmAsset.t169Desc')}>
                <Button
                  size="middle"
                  type="text"
                  icon={<Icons.Sparkles size={14} />}
                  onClick={() => setPresetOpen(true)}
                />
              </Tooltip>
            )}
            {handlers.onExportTimeline && timeline.length > 0 && (
              <Tooltip title={translate('canvasFilmAsset.t170')}>
                <Button
                  size="middle"
                  type="text"
                  icon={<Icons.FileText size={14} />}
                  onClick={() => setEdlOpen(true)}
                />
              </Tooltip>
            )}
            <Button
              size="middle"
              type="text"
              icon={<Icons.Plus size={14} />}
              onClick={() => setCreatingGroup(true)}
            />
          </div>
        </div>
        <Modal
          open={presetOpen}
          zIndex={FILM_CENTER_NESTED_MODAL_Z_INDEX}
          getContainer={() => document.body}
          title={translate('canvasFilmAsset.t171')}
          okText={translate('canvasFilmAsset.t172')}
          cancelText={translate('canvasFilmAsset.t173')}
          okButtonProps={{ disabled: !presetName.trim() || !presetFragment.trim() }}
          onCancel={() => setPresetOpen(false)}
          onOk={async () => {
            await handlers.onSaveStylePreset?.({
              id: `preset_${Date.now().toString(36)}`,
              kind: presetKind,
              name: presetName.trim(),
              promptItemIds: [],
              promptFragment: presetFragment.trim(),
            })
            message.success(translate('canvasFilmAsset.t126'))
            setPresetName('')
            setPresetFragment('')
          }}
        >
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <Select
              size="middle"
              value={presetKind}
              style={{ width: 110 }}
              onChange={(v) => setPresetKind(v as FilmStylePreset['kind'])}
              options={[
                { value: 'production', label: translate('canvasFilmAsset.t127') },
                { value: 'color', label: translate('canvasFilmAsset.t112') },
                { value: 'camera', label: translate('canvasFilmAsset.t128') },
                { value: 'frame', label: translate('canvasFilmAsset.t129') },
                { value: 'action', label: translate('canvasFilmAsset.t48') },
                { value: 'character', label: translate('canvasFilmAsset.t4') },
                { value: 'scene', label: translate('canvasFilmAsset.t5') },
              ]}
            />
            <Input
              size="middle"
              placeholder={translate('canvasFilmAsset.t174')}
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
            />
          </div>
          <Input.TextArea
            placeholder={translate('canvasFilmAsset.tpl48LongDesc')}
            value={presetFragment}
            onChange={(e) => setPresetFragment(e.target.value)}
            autoSize={{ minRows: 3, maxRows: 6 }}
          />
          <div
            style={{
              marginTop: 12,
              padding: 10,
              border: '1px solid var(--border-color, #333)',
              borderRadius: 8,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 6 }}>
              {translate('canvasFilmAsset.t221')}
            </div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--lobe-color-text-secondary, #888)',
                marginBottom: 8,
              }}
            >
              {productionBible?.locked
                ? translate('canvasFilmAsset.t130')
                : translate('canvasFilmAsset.t131')}{' '}
              · {productionBible?.aspectRatio ?? translate('canvasFilmAsset.t132')}
            </div>
            <Input.TextArea
              rows={3}
              value={productionBible?.visualStyle ?? ''}
              readOnly
              placeholder={translate('canvasFilmAsset.t176Desc')}
            />
          </div>
          {handlers.onApplyProductionBible && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>
                {translate('canvasFilmAsset.t222Desc')}
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {BUILTIN_FILM_STYLE_PACKS.map((pack) => (
                  <div
                    key={pack.id}
                    style={{
                      padding: 10,
                      border: '1px solid var(--border-color, #333)',
                      borderRadius: 8,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{pack.name}</div>
                        <div
                          style={{ fontSize: 12, color: 'var(--lobe-color-text-secondary, #888)' }}
                        >
                          {pack.description}
                        </div>
                      </div>
                      <Button
                        size="middle"
                        onClick={() =>
                          void handlers.onApplyProductionBible?.({
                            ...stylePackToProductionBible(pack),
                            locked: true,
                          })
                        }
                      >
                        {translate('canvasFilmAsset.t223')}
                      </Button>
                    </div>
                    <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                      {pack.palette.map((color) => (
                        <Tooltip key={color.hex} title={`${color.name} ${color.hex}`}>
                          <span
                            style={{
                              width: 18,
                              height: 18,
                              borderRadius: 4,
                              background: color.hex,
                              display: 'inline-block',
                            }}
                          />
                        </Tooltip>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {stylePresets.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div
                style={{
                  fontSize: 12,
                  marginBottom: 4,
                  color: 'var(--lobe-color-text-secondary, #888)',
                }}
              >
                {translate('canvasFilmAsset.t224')}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {stylePresets.map((preset) => (
                  <Tag
                    key={preset.id}
                    color={
                      preset.kind === 'camera'
                        ? 'blue'
                        : preset.kind === 'frame'
                          ? 'purple'
                          : 'orange'
                    }
                  >
                    {preset.name}
                  </Tag>
                ))}
              </div>
            </div>
          )}
        </Modal>
        <Modal
          open={edlOpen}
          zIndex={FILM_CENTER_NESTED_MODAL_Z_INDEX}
          getContainer={() => document.body}
          title={translate('canvasFilmAsset.t177')}
          width={720}
          okText={translate('canvasFilmAsset.t178')}
          cancelText={translate('canvasFilmAsset.t173')}
          onCancel={() => setEdlOpen(false)}
          onOk={() => {
            handlers.onExportTimeline?.({
              title: snapshot.project.title ?? translate('canvasFilmAsset.t125'),
              markdown: edlMarkdown,
            })
            setEdlOpen(false)
          }}
        >
          <div style={{ marginBottom: 8, color: 'var(--lobe-color-text-secondary, #888)' }}>
            {translate('canvasFilmAsset.tpl49LongDesc', {
              count: timeline.length,
              timecode: formatTimecode(totalRuntimeSec(timeline)),
              seconds: totalRuntimeSec(timeline),
            })}
          </div>
          <Input.TextArea value={edlMarkdown} readOnly autoSize={{ minRows: 10, maxRows: 20 }} />
        </Modal>
        {creatingGroup && (
          <div className="canvas-film-shots-new-group">
            <Input
              size="middle"
              autoFocus
              value={newGroupName}
              placeholder={translate('canvasFilmAsset.t179')}
              onChange={(e) => setNewGroupName(e.target.value)}
              onPressEnter={() => void handleCreateGroup()}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setCreatingGroup(false)
              }}
            />
          </div>
        )}
        {shotGroups.length === 0 ? (
          <div className="canvas-film-empty">{translate('canvasFilmAsset.t225')}</div>
        ) : (
          <div className="canvas-film-shots-group-list">
            {shotGroups.map((group) => (
              <div
                key={group.id}
                className={`canvas-film-shots-group-item${selectedGroupId === group.id ? ' active' : ''}`}
                onClick={() => setSelectedGroupId(group.id)}
              >
                <div className="canvas-film-shots-group-name">{group.name}</div>
                <div className="canvas-film-shots-group-meta">
                  {translate('canvasFilmAsset.tpl50Desc', { count: group.segments.length })}
                </div>
                <div className="canvas-film-shots-group-actions">
                  <Button
                    size="small"
                    type="text"
                    danger
                    icon={<Icons.Trash size={12} />}
                    onClick={(e) => {
                      e.stopPropagation()
                      void handlers.deleteShotGroup(group.id)
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="canvas-film-shots-main">
        {selectedGroup ? (
          <ShotSegmentEditor
            group={selectedGroup}
            characterAssets={characterAssets}
            sceneAssets={sceneAssets}
            stylePresets={stylePresets}
            handlers={handlers}
          />
        ) : (
          <Empty description={translate('canvasFilmAsset.t180')} className="canvas-film-empty" />
        )}
      </div>
    </div>
  )
}

function ShotSegmentEditor({
  group,
  characterAssets,
  sceneAssets,
  stylePresets,
  handlers,
}: {
  group: ShotGroup
  characterAssets: CanvasAsset[]
  sceneAssets: CanvasAsset[]
  stylePresets: FilmStylePreset[]
  handlers: FilmCenterHandlers
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  // 按剧本自动分镜（设计 §S6）
  const [autoOpen, setAutoOpen] = useState(false)
  const [sceneText, setSceneText] = useState('')
  const [pacing, setPacing] = useState('3')
  const [autoBusy, setAutoBusy] = useState(false)
  // 分镜表展示方式：卡片 / 表格（按秒）
  const [viewMode, setViewMode] = useState<'card' | 'table'>('table')
  // 拆分一镜为多段（设计 §S8：适配短视频模型时长上限）
  const [splitTarget, setSplitTarget] = useState<ShotSegment | null>(null)
  const [splitMaxClip, setSplitMaxClip] = useState<string>(String(DEFAULT_MAX_CLIP_SEC))
  const [splitBusy, setSplitBusy] = useState(false)
  const splitPreview = useMemo<ShotSplitPart[]>(() => {
    if (!splitTarget) return []
    const max = Number.parseFloat(splitMaxClip)
    return planSegmentSplit(splitTarget, {
      ...(Number.isFinite(max) && max > 0 ? { maxClipSec: max } : {}),
    })
  }, [splitTarget, splitMaxClip])
  const runSplit = useCallback(async () => {
    if (!splitTarget || splitPreview.length <= 1) return
    setSplitBusy(true)
    try {
      for (const part of splitPreview) {
        await handlers.createShotSegment(group.id, {
          ...part,
        })
      }
      await handlers.deleteShotSegment(group.id, splitTarget.id)
      message.success(translate('canvasFilmAsset.tpl51Desc', { count: splitPreview.length }))
      setSplitTarget(null)
    } catch (error) {
      message.error(error instanceof Error ? error.message : translate('canvasFilmAsset.t133'))
    } finally {
      setSplitBusy(false)
    }
  }, [splitTarget, splitPreview, handlers, group.id])
  // 从分镜 agent 的 Markdown 分镜表解析并批量落库
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importBusy, setImportBusy] = useState(false)
  const parsedRows = useMemo<ParsedShotRow[]>(
    () => (importText.trim() ? parseShotTable(importText) : []),
    [importText],
  )
  const matchCharacterIds = useCallback(
    (names: string[] | undefined): string[] => {
      if (!names || names.length === 0) return []
      return names
        .map((name) => characterAssets.find((asset) => (asset.title ?? '').trim() === name.trim()))
        .filter((asset): asset is CanvasAsset => Boolean(asset))
        .map((asset) => asset.id)
    },
    [characterAssets],
  )
  const runImportTable = useCallback(async () => {
    if (parsedRows.length === 0) return
    setImportBusy(true)
    try {
      for (const row of parsedRows) {
        const characterIds = matchCharacterIds(row.characterNames)
        await handlers.createShotSegment(group.id, {
          ...storyboardRowToSegmentDraft(row),
          ...(characterIds.length > 0 ? { characterAssetIds: characterIds } : {}),
        })
      }
      message.success(translate('canvasFilmAsset.tpl52Desc', { count: parsedRows.length }))
      setImportOpen(false)
      setImportText('')
    } catch (error) {
      message.error(error instanceof Error ? error.message : translate('canvasFilmAsset.t134'))
    } finally {
      setImportBusy(false)
    }
  }, [parsedRows, matchCharacterIds, handlers, group.id])
  const plannedShots = useMemo<PlannedShot[]>(() => {
    if (!sceneText.trim()) return []
    const parsedPacing = Number.parseFloat(pacing)
    return planShotsFromScene({
      sceneText,
      ...(Number.isFinite(parsedPacing) && parsedPacing > 0
        ? { pacingSecPerShot: parsedPacing }
        : {}),
    })
  }, [sceneText, pacing])
  const editingSegment = editingId ? (group.segments.find((s) => s.id === editingId) ?? null) : null

  if (creating) {
    return (
      <SegmentEditorForm
        mode="create"
        characterAssets={characterAssets}
        sceneAssets={sceneAssets}
        stylePresets={stylePresets}
        onClose={() => setCreating(false)}
        onSave={async (input) => {
          await handlers.createShotSegment(group.id, input)
          setCreating(false)
        }}
      />
    )
  }
  if (editingSegment) {
    return (
      <SegmentEditorForm
        mode="edit"
        segment={editingSegment}
        characterAssets={characterAssets}
        sceneAssets={sceneAssets}
        stylePresets={stylePresets}
        onClose={() => setEditingId(null)}
        onSave={async (input) => {
          await handlers.updateShotSegment(group.id, editingSegment.id, input)
          setEditingId(null)
        }}
      />
    )
  }

  return (
    <div className="canvas-film-segments">
      <div className="canvas-film-segments-head">
        <div>
          <strong>{group.name}</strong>
          {group.description && (
            <span className="canvas-film-segments-desc">{group.description}</span>
          )}
        </div>
        <div className="canvas-film-segments-toolbar">
          <Segmented
            value={viewMode}
            onChange={(v) => setViewMode(v as 'table' | 'card')}
            options={[
              { label: translate('canvasFilmAsset.t135'), value: 'table' },
              { label: translate('canvasFilmAsset.t136'), value: 'card' },
            ]}
          />
          <Button
            size="middle"
            icon={<Icons.Workflow size={13} />}
            onClick={() => setAutoOpen(true)}
          >
            {translate('canvasFilmAsset.t226')}
          </Button>
          <Button
            size="middle"
            type="primary"
            icon={<Icons.Plus size={13} />}
            onClick={() => setCreating(true)}
          >
            {translate('canvasFilmAsset.t227')}
          </Button>
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{
              items: [
                ...(handlers.onGenerateStoryboardGrid && group.segments.length > 0
                  ? [
                      {
                        key: 'storyboard',
                        icon: <Icons.Combine size={14} />,
                        label: translate('canvasFilmAsset.t137'),
                        onClick: () => {
                          void handlers.onGenerateStoryboardGrid?.(group)
                        },
                      },
                    ]
                  : []),
                ...(handlers.onExpandShotsToCanvas && group.segments.length > 0
                  ? [
                      {
                        key: 'expand',
                        icon: <Icons.Layers size={14} />,
                        label: translate('canvasFilmAsset.t138'),
                        onClick: () => {
                          void (async () => {
                            const count = (await handlers.onExpandShotsToCanvas?.(group)) ?? 0
                            if (count > 0)
                              message.success(translate('canvasFilmAsset.tpl53Desc', { count }))
                          })()
                        },
                      },
                    ]
                  : []),
                {
                  key: 'import',
                  icon: <Icons.FilePlus size={14} />,
                  label: translate('canvasFilmAsset.t139'),
                  onClick: () => setImportOpen(true),
                },
              ],
            }}
          >
            <Tooltip title={translate('canvasFilmAsset.t181')}>
              <Button size="middle" type="text" icon={<Icons.More size={14} />} />
            </Tooltip>
          </Dropdown>
        </div>
      </div>
      <Modal
        open={autoOpen}
        zIndex={FILM_CENTER_NESTED_MODAL_Z_INDEX}
        getContainer={() => document.body}
        title={translate('canvasFilmAsset.t182')}
        width={680}
        okText={
          plannedShots.length > 0
            ? translate('canvasFilmAsset.tpl54Desc', { count: plannedShots.length })
            : translate('canvasFilmAsset.t140')
        }
        cancelText={translate('canvasFilmAsset.t17')}
        okButtonProps={{ disabled: plannedShots.length === 0, loading: autoBusy }}
        onCancel={() => setAutoOpen(false)}
        onOk={async () => {
          if (plannedShots.length === 0) return
          setAutoBusy(true)
          try {
            for (const shot of plannedShots) {
              await handlers.createShotSegment(group.id, {
                title: shot.title,
                description: shot.description,
                ...(shot.dialogue ? { dialogue: shot.dialogue } : {}),
                durationSec: shot.durationSec,
              })
            }
            message.success(translate('canvasFilmAsset.tpl55Desc', { count: plannedShots.length }))
            setAutoOpen(false)
            setSceneText('')
          } catch (error) {
            message.error(
              error instanceof Error ? error.message : translate('canvasFilmAsset.t141'),
            )
          } finally {
            setAutoBusy(false)
          }
        }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <span style={{ whiteSpace: 'nowrap' }}>{translate('canvasFilmAsset.t228')}</span>
          <Input
            type="number"
            min={1}
            step={0.5}
            value={pacing}
            style={{ width: 120 }}
            onChange={(e) => setPacing(e.target.value)}
          />
          {plannedShots.length > 0 && (
            <span style={{ color: 'var(--lobe-color-text-secondary, #888)' }}>
              {translate('canvasFilmAsset.tpl56Desc', {
                count: plannedShots.length,
                seconds: totalPlannedDurationSec(plannedShots),
              })}
            </span>
          )}
        </div>
        <Input.TextArea
          placeholder={translate('canvasFilmAsset.tpl57LongDesc')}
          value={sceneText}
          onChange={(e) => setSceneText(e.target.value)}
          autoSize={{ minRows: 8, maxRows: 16 }}
        />
        {plannedShots.length > 0 && (
          <div
            className="canvas-film-segment-list"
            style={{ marginTop: 8, maxHeight: 180, overflow: 'auto' }}
          >
            {plannedShots.slice(0, 12).map((shot) => (
              <div key={shot.index} style={{ fontSize: 12, padding: '2px 0' }}>
                <strong>{shot.title}</strong>（{shot.durationSec}s）
                {shot.dialogue ? `：${shot.dialogue}` : `：${shot.description}`}
              </div>
            ))}
            {plannedShots.length > 12 && (
              <div style={{ fontSize: 12 }}>
                {translate('canvasFilmAsset.tpl58Desc', { count: plannedShots.length })}
              </div>
            )}
          </div>
        )}
      </Modal>
      <Modal
        open={splitTarget != null}
        zIndex={FILM_CENTER_NESTED_MODAL_Z_INDEX}
        getContainer={() => document.body}
        title={translate('canvasFilmAsset.tpl59Desc', { title: splitTarget?.title ?? '' })}
        width={560}
        okText={
          splitPreview.length > 1
            ? translate('canvasFilmAsset.tpl60Desc', { count: splitPreview.length })
            : translate('canvasFilmAsset.t142')
        }
        cancelText={translate('canvasFilmAsset.t17')}
        okButtonProps={{ disabled: splitPreview.length <= 1, loading: splitBusy }}
        onCancel={() => setSplitTarget(null)}
        onOk={() => void runSplit()}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <span style={{ whiteSpace: 'nowrap' }}>{translate('canvasFilmAsset.t229')}</span>
          <Input
            type="number"
            min={1}
            step={0.5}
            value={splitMaxClip}
            style={{ width: 120 }}
            onChange={(e) => setSplitMaxClip(e.target.value)}
          />
          <span style={{ color: 'var(--lobe-color-text-secondary, #888)', fontSize: 12 }}>
            {translate('canvasFilmAsset.tpl61Desc', {
              seconds: splitTarget ? resolveSegmentDuration(splitTarget) : 0,
            })}
            {translate('canvasFilmAsset.tpl61bDesc')}
            {DEFAULT_MAX_CLIP_SEC}s
          </span>
        </div>
        {splitPreview.length > 1 ? (
          <div className="canvas-film-segment-list" style={{ maxHeight: 220, overflow: 'auto' }}>
            {splitPreview.map((part, idx) => (
              <div key={idx} style={{ fontSize: 12, padding: '3px 0' }}>
                <strong>{part.title}</strong> {part.inSec}s–{part.outSec}s（{part.durationSec}s）
                {part.dialogue
                  ? translate('canvasFilmAsset.tpl62Desc', { text: part.dialogue })
                  : ''}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--lobe-color-text-secondary, #888)' }}>
            {translate('canvasFilmAsset.t230Desc')}
          </div>
        )}
      </Modal>
      <Modal
        open={importOpen}
        zIndex={FILM_CENTER_NESTED_MODAL_Z_INDEX}
        getContainer={() => document.body}
        title={translate('canvasFilmAsset.t183Desc')}
        width={720}
        okText={
          parsedRows.length > 0
            ? translate('canvasFilmAsset.tpl63Desc', { count: parsedRows.length })
            : translate('canvasFilmAsset.t143')
        }
        cancelText={translate('canvasFilmAsset.t17')}
        okButtonProps={{ disabled: parsedRows.length === 0, loading: importBusy }}
        onCancel={() => setImportOpen(false)}
        onOk={() => void runImportTable()}
      >
        <div
          style={{ fontSize: 12, color: 'var(--lobe-color-text-secondary, #888)', marginBottom: 8 }}
        >
          {translate('canvasFilmAsset.tpl64LongDesc')}
        </div>
        <Input.TextArea
          placeholder={
            '| Shot | Duration(s) | Size | Move | Action | Dialogue | Character |\n| --- | --- | --- | --- | --- | --- | --- |\n| 1 | 3 | Close-up | Push | The boy grips his sword | Stop! | Boy |'
          }
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          autoSize={{ minRows: 8, maxRows: 16 }}
        />
        {parsedRows.length > 0 && (
          <div className="canvas-shot-table-wrap" style={{ marginTop: 8, maxHeight: 220 }}>
            <table className="canvas-shot-table">
              <thead>
                <tr>
                  <th>{translate('canvasFilmAsset.t231')}</th>
                  <th>{translate('canvasFilmAsset.t232')}</th>
                  <th>{translate('canvasFilmAsset.t233')}</th>
                  <th>{translate('canvasFilmAsset.t129')}</th>
                  <th>{translate('canvasFilmAsset.t234')}</th>
                  <th>{translate('canvasFilmAsset.t4')}</th>
                </tr>
              </thead>
              <tbody>
                {parsedRows.map((row, idx) => (
                  <tr key={idx}>
                    <td>{row.index ?? idx + 1}</td>
                    <td>{row.durationSec != null ? `${row.durationSec}s` : '—'}</td>
                    <td className="canvas-shot-table-shot">{row.shotPrompt || '—'}</td>
                    <td className="canvas-shot-table-desc">{row.description || '—'}</td>
                    <td className="canvas-shot-table-line">{row.dialogue || '—'}</td>
                    <td>{row.characterNames?.join('、') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
      {group.segments.length === 0 ? (
        <Empty description={translate('canvasFilmAsset.t184')} className="canvas-film-empty" />
      ) : viewMode === 'table' ? (
        <ShotSegmentTable
          group={group}
          characterAssets={characterAssets}
          sceneAssets={sceneAssets}
          handlers={handlers}
          onEdit={setEditingId}
          onSplit={setSplitTarget}
        />
      ) : (
        <div className="canvas-film-segment-list">
          {group.segments.map((segment) => {
            const characters = (segment.characterAssetIds ?? [])
              .map((id) => characterAssets.find((asset) => asset.id === id))
              .filter((asset): asset is CanvasAsset => Boolean(asset))
            const scene = segment.sceneAssetId
              ? sceneAssets.find((asset) => asset.id === segment.sceneAssetId)
              : undefined
            return (
              <div key={segment.id} className="canvas-film-segment-card">
                <div className="canvas-film-segment-card-head">
                  <div className="canvas-film-segment-index">
                    <Icons.Film size={12} />
                    <span>#{segment.index}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    {segment.durationSec != null && (
                      <span className="canvas-film-segment-dur">{segment.durationSec}s</span>
                    )}
                    {segment.keyframeNodeIds && segment.keyframeNodeIds.length > 0 && (
                      <span className="canvas-film-segment-dur">
                        🎞{segment.keyframeNodeIds.length}
                      </span>
                    )}
                  </div>
                </div>
                <div className="canvas-film-segment-body">
                  <div className="canvas-film-segment-title">{segment.title}</div>
                  {segment.description && (
                    <div className="canvas-film-segment-desc">{segment.description}</div>
                  )}
                  {segment.dialogue && (
                    <div className="canvas-film-segment-line">
                      <span>{translate('canvasFilmAsset.t234')}</span>
                      {segment.dialogue}
                    </div>
                  )}
                  {segment.narration && (
                    <div className="canvas-film-segment-line">
                      <span>{translate('canvasFilmAsset.t235')}</span>
                      {segment.narration}
                    </div>
                  )}
                  {segment.shotPrompt && (
                    <div className="canvas-film-segment-line">
                      <span>{translate('canvasFilmAsset.t233')}</span>
                      {segment.shotPrompt}
                    </div>
                  )}
                  <div className="canvas-film-segment-refs">
                    {scene && (
                      <Tag color="blue">{scene.title ?? translate('canvasFilmAsset.t5')}</Tag>
                    )}
                    {characters.map((character) => (
                      <Tag key={character.id} color="orange">
                        {character.title}
                      </Tag>
                    ))}
                  </div>
                </div>
                <div className="canvas-film-segment-actions">
                  {handlers.onGenerateSegmentKeyframes && (
                    <Tooltip title={translate('canvasFilmAsset.t185')}>
                      <Button
                        size="middle"
                        type="text"
                        icon={<Icons.Image size={13} />}
                        onClick={() =>
                          handlers.onGenerateSegmentKeyframes?.({
                            group,
                            segment,
                            characters,
                            ...(scene ? { scene } : {}),
                          })
                        }
                      />
                    </Tooltip>
                  )}
                  {handlers.onGenerateSegmentVideo && (
                    <Tooltip title={translate('canvasFilmAsset.t186')}>
                      <Button
                        size="middle"
                        type="text"
                        icon={<Icons.Play size={13} />}
                        onClick={() =>
                          handlers.onGenerateSegmentVideo?.({
                            group,
                            segment,
                            characters,
                            ...(scene ? { scene } : {}),
                          })
                        }
                      />
                    </Tooltip>
                  )}
                  {handlers.onSetSegmentKeyframesFromSelection && (
                    <Tooltip title={translate('canvasFilmAsset.t187')}>
                      <Button
                        size="middle"
                        type="text"
                        icon={<Icons.Link size={13} />}
                        onClick={() => {
                          const count =
                            handlers.onSetSegmentKeyframesFromSelection?.({ group, segment }) ?? 0
                          if (count > 0)
                            message.success(translate('canvasFilmAsset.tpl66Desc', { count }))
                          else message.warning(translate('canvasFilmAsset.t144'))
                        }}
                      />
                    </Tooltip>
                  )}
                  <Tooltip title={translate('canvasFilmAsset.t188Desc')}>
                    <Button
                      size="middle"
                      type="text"
                      icon={<Icons.Scissors size={13} />}
                      onClick={() => setSplitTarget(segment)}
                    />
                  </Tooltip>
                  <Button
                    size="middle"
                    type="text"
                    icon={<Icons.Edit size={13} />}
                    onClick={() => setEditingId(segment.id)}
                  />
                  <Button
                    size="middle"
                    type="text"
                    danger
                    icon={<Icons.Trash size={13} />}
                    onClick={() => void handlers.deleteShotSegment(group.id, segment.id)}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SegmentEditorForm({
  mode,
  segment,
  characterAssets,
  sceneAssets,
  stylePresets,
  onClose,
  onSave,
}: {
  mode: 'create' | 'edit'
  segment?: ShotSegment
  characterAssets: CanvasAsset[]
  sceneAssets: CanvasAsset[]
  stylePresets: FilmStylePreset[]
  onClose: () => void
  onSave: (input: Partial<ShotSegment> & { title: string }) => Promise<void>
}) {
  const [title, setTitle] = useState(segment?.title ?? '')
  const [description, setDescription] = useState(segment?.description ?? '')
  const [dialogue, setDialogue] = useState(segment?.dialogue ?? '')
  const [narration, setNarration] = useState(segment?.narration ?? '')
  const [shotPrompt, setShotPrompt] = useState(segment?.shotPrompt ?? '')
  const [durationSec, setDurationSec] = useState<string>(
    segment?.durationSec != null ? String(segment.durationSec) : '',
  )
  const [characterIds, setCharacterIds] = useState<string[]>(segment?.characterAssetIds ?? [])
  const [sceneId, setSceneId] = useState<string | undefined>(segment?.sceneAssetId)
  const [cameraDesignId, setCameraDesignId] = useState<string | undefined>(segment?.cameraDesignId)
  const [frameDesignId, setFrameDesignId] = useState<string | undefined>(segment?.frameDesignId)
  const [actionDesignId, setActionDesignId] = useState<string | undefined>(segment?.actionDesignId)

  const applyPreset = (preset: FilmStylePreset) => {
    const fragment = (preset.promptFragment ?? '').trim()
    if (fragment) {
      setShotPrompt((prev) => (prev.trim() ? `${prev.trim()}, ${fragment}` : fragment))
    }
    if (preset.kind === 'camera') setCameraDesignId(preset.id)
    else if (preset.kind === 'frame') setFrameDesignId(preset.id)
    else if (preset.kind === 'action') setActionDesignId(preset.id)
  }

  const toggleCharacter = (id: string) => {
    setCharacterIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const handleSave = async () => {
    if (!title.trim()) {
      message.warning(translate('canvasFilmAsset.t145'))
      return
    }
    const parsedDuration = Number.parseFloat(durationSec)
    await onSave({
      title: title.trim(),
      ...(description ? { description } : {}),
      ...(dialogue ? { dialogue } : {}),
      ...(narration ? { narration } : {}),
      ...(shotPrompt ? { shotPrompt } : {}),
      ...(Number.isFinite(parsedDuration) && parsedDuration > 0
        ? { durationSec: parsedDuration }
        : {}),
      ...(characterIds.length > 0 ? { characterAssetIds: characterIds } : {}),
      ...(sceneId ? { sceneAssetId: sceneId } : {}),
      ...(cameraDesignId ? { cameraDesignId } : {}),
      ...(frameDesignId ? { frameDesignId } : {}),
      ...(actionDesignId ? { actionDesignId } : {}),
    })
  }

  return (
    <div className="canvas-film-asset-editor">
      <div className="canvas-film-editor-head">
        <Button size="middle" type="text" icon={<Icons.ArrowLeft size={14} />} onClick={onClose}>
          {translate('canvasFilmAsset.t207')}
        </Button>
        <Button
          size="middle"
          type="primary"
          icon={<Icons.Check size={13} />}
          onClick={() => void handleSave()}
        >
          {translate('canvasFilmAsset.t208')}
        </Button>
      </div>
      <div className="canvas-film-editor-form">
        <label className="canvas-film-editor-field">
          <span>{translate('canvasFilmAsset.t236')}</span>
          <Input
            value={title}
            placeholder={translate('canvasFilmAsset.t189')}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="canvas-film-editor-field">
          <span>{translate('canvasFilmAsset.t237')}</span>
          <Input.TextArea
            rows={3}
            value={description}
            placeholder={translate('canvasFilmAsset.t190Desc')}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <div className="canvas-film-editor-field-row">
          <label className="canvas-film-editor-field">
            <span>{translate('canvasFilmAsset.t5')}</span>
            <select
              className="canvas-film-select"
              value={sceneId ?? ''}
              onChange={(e) => setSceneId(e.target.value || undefined)}
            >
              <option value="">{translate('canvasFilmAsset.t238')}</option>
              {sceneAssets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="canvas-film-editor-field">
          <span>{translate('canvasFilmAsset.t4')}</span>
          <div className="canvas-film-chip-pick">
            {characterAssets.length === 0 ? (
              <span className="canvas-film-empty-inline">
                {translate('canvasFilmAsset.t239Desc')}
              </span>
            ) : (
              characterAssets.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`canvas-film-chip${characterIds.includes(c.id) ? ' active' : ''}`}
                  onClick={() => toggleCharacter(c.id)}
                >
                  {c.title}
                </button>
              ))
            )}
          </div>
        </div>
        <label className="canvas-film-editor-field">
          <span>{translate('canvasFilmAsset.t234')}</span>
          <Input.TextArea
            rows={2}
            value={dialogue}
            placeholder={translate('canvasFilmAsset.t191')}
            onChange={(e) => setDialogue(e.target.value)}
          />
        </label>
        <label className="canvas-film-editor-field">
          <span>{translate('canvasFilmAsset.t235')}</span>
          <Input.TextArea
            rows={2}
            value={narration}
            placeholder={translate('canvasFilmAsset.t192')}
            onChange={(e) => setNarration(e.target.value)}
          />
        </label>
        {stylePresets.length > 0 && (
          <div className="canvas-film-editor-field">
            <span>{translate('canvasFilmAsset.t240Desc')}</span>
            <div className="canvas-film-chip-pick">
              {stylePresets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="canvas-film-chip"
                  onClick={() => applyPreset(preset)}
                >
                  {preset.kind === 'camera'
                    ? translate('canvasFilmAsset.t128')
                    : preset.kind === 'frame'
                      ? translate('canvasFilmAsset.t129')
                      : preset.kind === 'action'
                        ? translate('canvasFilmAsset.t48')
                        : preset.kind === 'production'
                          ? translate('canvasFilmAsset.t127')
                          : preset.kind === 'color'
                            ? translate('canvasFilmAsset.t112')
                            : preset.kind === 'character'
                              ? translate('canvasFilmAsset.t4')
                              : translate('canvasFilmAsset.t5')}{' '}
                  · {preset.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <label className="canvas-film-editor-field">
          <span>{translate('canvasFilmAsset.t241')}</span>
          <Input.TextArea
            rows={2}
            value={shotPrompt}
            placeholder={translate('canvasFilmAsset.t193Desc')}
            onChange={(e) => setShotPrompt(e.target.value)}
          />
        </label>
        <label className="canvas-film-editor-field">
          <span>{translate('canvasFilmAsset.t242')}</span>
          <Input
            type="number"
            min={0}
            step={0.5}
            value={durationSec}
            placeholder={translate('canvasFilmAsset.t194Desc')}
            onChange={(e) => setDurationSec(e.target.value)}
          />
        </label>
      </div>
    </div>
  )
}
