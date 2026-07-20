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
import { Button } from '@lobehub/ui'
import { Icons } from '../../Icons'
import { AssetThumbnail } from './CanvasAssetThumbnail'
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
  manuscript: '文稿',
  chapter: '章节',
  script: '剧本',
  character: '角色',
  scene: '场景',
  prop: '道具',
  effect: '特效',
  shot_group: '分镜',
  shots: '分镜分组',
  prompt_library: '提示词库',
  files: 'Files',
}

/** 资产列表分批渲染步长：文稿/章节可达上千条，一次性挂载会卡顿并撑爆 DOM */
const ASSET_PAGE_SIZE = 60

const CHAPTER_SPLIT_MODE_LABELS: Record<ChapterSplitMode, string> = {
  heading: '按章节标题',
  length: '按长度分片',
  single: '不分章',
  'multi-file': '多文件（一文件一章）',
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
  deleteFilmAsset: (assetId: string) => Promise<void>
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
  deleteManuscript?: (manuscriptAssetId: string) => Promise<number>
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
  const [activeTab, setActiveTab] = useState<TabKind>(initialTab ?? 'script')

  // 从导演台深链打开时，定位到目标 tab
  useEffect(() => {
    if (open && initialTab) setActiveTab(initialTab)
  }, [open, initialTab])

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
            <span>文稿、影视资产、分镜、提示词和渠道 Files</span>
          </div>
          <Button
            size="middle"
            type="text"
            icon={<Icons.X size={14} />}
            aria-label="关闭项目资产中心"
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
              <CanvasProviderFilesTab />
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
      项目资产中心
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
      if (sortBy === 'name') return (a.title ?? '').localeCompare(b.title ?? '')
      if (sortBy === 'created') return b.createdAt.localeCompare(a.createdAt)
      if (sortBy === 'usage') return (usageMap.get(b.id) ?? 0) - (usageMap.get(a.id) ?? 0)
      return b.updatedAt.localeCompare(a.updatedAt)
    })
  }, [assets, query, tagFilter, sortBy, usageMap])

  const editingAsset = editingId ? (assets.find((a) => a.id === editingId) ?? null) : null

  const handleDeleteAsset = (asset: CanvasAsset, usageCount: number): void => {
    Modal.confirm({
      title: `删除${FILM_ASSET_KIND_LABELS[kind]}？`,
      content:
        usageCount > 0
          ? `「${asset.title ?? '未命名'}」正在被引用 ${usageCount} 次。删除后分镜或画布节点会失去这个资源引用。`
          : `确认删除「${asset.title ?? '未命名'}」？此操作会从项目资源库移除该条目。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => handlers.deleteFilmAsset(asset.id),
    })
  }

  const handleBreakdownScript = (asset: CanvasAsset): void => {
    if (!handlers.onBreakdownScriptAsset) return
    Modal.confirm({
      title: '从剧本生成角色、场景与分镜草稿？',
      content:
        '会基于当前剧本文本自动抽取角色、场景，并创建一个分镜分组。生成结果仍可继续人工编辑。',
      okText: '生成草稿',
      cancelText: '取消',
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
          {FILM_ASSET_KIND_LABELS[kind]} · {filtered.length} / {assets.length} 项
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            type="primary"
            size="middle"
            icon={<Icons.Plus size={13} />}
            onClick={() => setCreating(true)}
          >
            新建{FILM_ASSET_KIND_LABELS[kind]}
          </Button>
        </div>
      </div>

      <div className="canvas-film-asset-toolbar">
        <Input
          size="middle"
          allowClear
          value={query}
          placeholder="搜索名称/描述/默认 prompt"
          onChange={(e) => setQuery(e.target.value)}
          className="canvas-film-asset-search"
        />
        <Select
          size="middle"
          value={sortBy}
          onChange={(value) => setSortBy(value as typeof sortBy)}
          options={[
            { value: 'updated', label: '最近修改' },
            { value: 'created', label: '最近创建' },
            { value: 'name', label: '按名称' },
            { value: 'usage', label: '按使用次数' },
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
              清空
            </Button>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <Empty
          description={
            assets.length === 0
              ? `暂无${FILM_ASSET_KIND_LABELS[kind]}`
              : '当前过滤条件下没有匹配的资源'
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
            const cover =
              refs.length > 0 ? snapshot.assets.find((a) => a.id === refs[0]?.assetId) : null
            const usage = usageMap.get(asset.id) ?? 0
            const hasCanvasNode = resolveCanvasAssetFocusNodeIds(snapshot, asset.id).length > 0
            const tags = readTags(asset.metadata)
            return (
              <div key={asset.id} className="canvas-film-asset-card">
                <div className="canvas-film-asset-card-thumb">
                  {cover ? <AssetThumbnail asset={cover} /> : <AssetThumbnail asset={asset} />}
                  {refs.length > 1 && (
                    <span
                      className="canvas-film-asset-card-refcount"
                      title={`${refs.length} 张参考图`}
                    >
                      <Icons.Image size={11} /> {refs.length}
                    </span>
                  )}
                  {usage > 0 && (
                    <span className="canvas-film-asset-card-usage" title={`被引用 ${usage} 次`}>
                      <Icons.Link size={11} /> {usage}
                    </span>
                  )}
                </div>
                <div className="canvas-film-asset-card-main">
                  <div className="canvas-film-asset-card-name" title={asset.title ?? ''}>
                    {asset.title ?? '未命名'}
                  </div>
                  <div className="canvas-film-asset-card-preview">
                    {(asset.contentText ?? refs[0]?.description ?? '').slice(0, 60) || '(无内容)'}
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
                    <Tooltip title={hasCanvasNode ? '定位' : '画布中暂无此资产节点'}>
                      <Button
                        size="middle"
                        type="text"
                        disabled={!hasCanvasNode}
                        aria-label={`定位资产：${asset.title ?? '未命名'}`}
                        icon={<Icons.Crosshair size={14} />}
                        onClick={() => handlers.onLocateAsset?.(asset.id)}
                      />
                    </Tooltip>
                  )}
                  {kind === 'script' && handlers.onBreakdownScriptAsset && (
                    <Tooltip title="拆解剧本">
                      <Button
                        size="middle"
                        type="text"
                        icon={<Icons.Workflow size={14} />}
                        onClick={() => handleBreakdownScript(asset)}
                      />
                    </Tooltip>
                  )}
                  {kind === 'character' && handlers.onGenerateCharacterSheets && (
                    <Tooltip title="生成角色图（身份板/表情/服装…）">
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
                      <Tooltip title="生成参考图">
                        <Button
                          size="middle"
                          type="text"
                          icon={<Icons.Image size={14} />}
                          onClick={() => handlers.onGenerateAssetReference?.(asset)}
                        />
                      </Tooltip>
                    )}
                  <Tooltip title="编辑">
                    <Button
                      size="middle"
                      type="text"
                      icon={<Icons.Edit size={14} />}
                      onClick={() => setEditingId(asset.id)}
                    />
                  </Tooltip>
                  <Tooltip title="AI 优化">
                    <Button
                      size="middle"
                      type="text"
                      icon={<Icons.Sparkles size={14} />}
                      onClick={() => handlers.onOptimizeAsset(asset)}
                    />
                  </Tooltip>
                  <Tooltip title="插入画布">
                    <Button
                      size="middle"
                      type="text"
                      icon={<Icons.Plus size={14} />}
                      onClick={() => handlers.onInsertAssetToCanvas(asset.id)}
                    />
                  </Tooltip>
                  <Tooltip title="删除">
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
              加载更多（已显示 {visibleCount} / {filtered.length}）
            </button>
          )}
        </div>
      )}
      <Modal
        open={sheetAsset !== null}
        title={`生成角色图 · ${sheetAsset?.title ?? ''}`}
        okText={`生成 ${sheetAspects.length} 组`}
        cancelText="取消"
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
          选择要生成的面向。角色身份板正面会作为角色基准图，其余面向基于基准图保持一致。
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
    const legacyTag = `文稿:${activeManuscript.title ?? ''}`
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
          if (typeof tag === 'string' && tag.startsWith('文稿:')) {
            byTag.set(tag, (byTag.get(tag) ?? 0) + 1)
          }
        }
      }
    }
    return { byId, byTag }
  }, [snapshot.assets])

  const chapterCountOf = (m: CanvasAsset): number =>
    chapterCounts.byId.get(m.id) ?? chapterCounts.byTag.get(`文稿:${m.title ?? ''}`) ?? 0

  const handleDelete = (m: CanvasAsset): void => {
    if (!handlers.deleteManuscript) return
    const count = chapterCountOf(m)
    Modal.confirm({
      title: `删除文稿《${m.title ?? '未命名'}》？`,
      content: `将同时删除其 ${count} 个章节，且无法恢复。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        const deleted = await handlers.deleteManuscript!(m.id)
        message.success(`已删除文稿及 ${deleted} 个章节`)
      },
    })
  }

  return (
    <div className="canvas-film-asset-list-tab">
      <div className="canvas-film-asset-list-head">
        <span className="canvas-film-asset-list-count">文稿 · {manuscripts.length} 部</span>
        {handlers.onImportManuscript && (
          <Button
            type="primary"
            size="middle"
            icon={<Icons.Upload size={13} />}
            onClick={() => setImportOpen(true)}
          >
            导入文稿
          </Button>
        )}
      </div>
      {manuscripts.length === 0 ? (
        <Empty description="还没有文稿，导入一部小说开始创作" style={{ marginTop: 48 }} />
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
                  {m.title ?? '未命名文稿'}
                </div>
                <div className="canvas-film-manuscript-card-meta">
                  {chapterCountOf(m)} 章 · 点击查看章节
                </div>
              </div>
              {handlers.deleteManuscript && (
                <Tooltip title="删除文稿（含全部章节）">
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
          文稿
        </Button>
        <span className="canvas-film-chapter-head-title">
          {manuscript.title ?? '未命名文稿'} · {total} 章
        </span>
      </div>
      {total === 0 ? (
        <Empty description="该文稿没有章节" style={{ marginTop: 48 }} />
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
                  <span>第 {start + idx + 1} 章</span>
                </div>
                <div className="canvas-film-chapter-card-title" title={chapter.title ?? ''}>
                  {chapter.title ?? '未命名章节'}
                </div>
                <div className="canvas-film-chapter-card-foot">
                  <span className="canvas-film-chapter-card-count">
                    {charCountOf(chapter).toLocaleString()} 字
                  </span>
                  <span className="canvas-film-chapter-card-actions">
                    {handlers.onChapterToScreenplay && (
                      <Tooltip
                        title="AI 转剧本：把本章改写为场次剧本，添加到画布"
                        mouseEnterDelay={0.1}
                        placement="top"
                      >
                        <Button
                          size="middle"
                          type="text"
                          aria-label="AI 转剧本"
                          icon={<Icons.Workflow size={14} />}
                          onClick={(e) => {
                            e.stopPropagation()
                            void handlers.onChapterToScreenplay?.(chapter)
                          }}
                        />
                      </Tooltip>
                    )}
                    <Tooltip
                      title="插入画布：把这一章作为文本节点放到画布上"
                      mouseEnterDelay={0.1}
                      placement="top"
                    >
                      <Button
                        size="middle"
                        type="text"
                        aria-label="插入画布"
                        icon={<Icons.Plus size={14} />}
                        onClick={(e) => {
                          e.stopPropagation()
                          handlers.onInsertAssetToCanvas(chapter.id)
                        }}
                      />
                    </Tooltip>
                    <Tooltip title="删除本章" mouseEnterDelay={0.1} placement="top">
                      <Button
                        size="middle"
                        type="text"
                        danger
                        aria-label="删除本章"
                        icon={<Icons.Trash size={14} />}
                        onClick={(e) => {
                          e.stopPropagation()
                          Modal.confirm({
                            title: `删除章节「${chapter.title ?? '未命名'}」？`,
                            okText: '删除',
                            cancelText: '取消',
                            okButtonProps: { danger: true },
                            onOk: () => handlers.deleteFilmAsset(chapter.id),
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
          章节列表
        </Button>
        <span className="canvas-film-chapter-head-title">{chapter.title ?? '未命名章节'}</span>
        {onToScreenplay && (
          <Button
            size="middle"
            icon={<Icons.Workflow size={13} />}
            onClick={() => void onToScreenplay(chapter)}
          >
            转剧本
          </Button>
        )}
      </div>
      <div className="canvas-film-reader-body">
        {content ? (
          pageText
        ) : (
          <span style={{ color: 'var(--lobe-color-text-secondary, #888)' }}>（本章无正文）</span>
        )}
      </div>
      <div className="canvas-film-reader-footer">
        <Button
          size="middle"
          disabled={!prev}
          icon={<Icons.ChevronLeft size={14} />}
          onClick={() => prev && onJump(prev.id)}
        >
          上一章
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
          下一章
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
  const singleChapterTitle = title.trim() || singleFile?.name.replace(/\.[^.]+$/, '') || '全文'
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
        message.error('所选文件内容均为空或无法识别')
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
        message.warning(`已跳过 ${skipped.length} 个空文件：${skipped.join('、')}`)
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '读取文件失败')
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
      title="导入文稿"
      zIndex={FILM_CENTER_NESTED_MODAL_Z_INDEX}
      okText={selectedCount > 0 ? `导入 ${selectedCount} 章` : '导入'}
      cancelText="取消"
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
                ? `多文件文稿（${files.length} 个）`
                : singleFile?.name.replace(/\.[^.]+$/, '')) ||
              '未命名文稿',
            mode: preview.mode,
            chapters,
          })
          message.success(`已导入文稿，生成 ${count} 个章节`)
          onClose()
        } catch (error) {
          message.error(error instanceof Error ? error.message : '导入文稿失败')
        } finally {
          setImporting(false)
        }
      }}
    >
      <Input
        placeholder="文稿标题（如：长安十二时辰）"
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
            ? `重新选择文件（已选 ${files.length} 个）`
            : '从文件导入（.txt / .md，支持多选；多选时一文件一章）'}
        </Button>
        {files.length > 0 && (
          <Button size="middle" icon={<Icons.X size={13} />} onClick={() => setFiles([])}>
            清除文件
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
            <div style={{ fontSize: 13, fontWeight: 600 }}>自动分章</div>
            <div
              style={{
                marginTop: 2,
                color: 'var(--lobe-color-text-secondary, #888)',
                fontSize: 12,
              }}
            >
              {splitChapters ? '标题优先，识别不到时按长度分片' : '整篇作为 1 章导入'}
            </div>
          </div>
          <Switch
            checked={splitChapters}
            checkedChildren="分章"
            unCheckedChildren="一章"
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
          已选择 {files.length} 个文件，将按「一文件一章」导入，共 {total} 章。空文件已自动跳过。
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
                {countChars(file.text).toLocaleString()} 字
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
                ? '粘贴小说/长文稿全文，或点上方按钮从文件导入。自动识别「第N章 / Chapter N / 序章 / 番外」等标题切分；识别不到时按长度分片。'
                : '粘贴小说/长文稿全文，或点上方按钮从文件导入。当前会整篇作为 1 章导入。'
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
            导入方式：{CHAPTER_SPLIT_MODE_LABELS[preview.mode]} · 共 {total} 章
            {total > 0 && `（首章：${preview.chapters[0]?.title ?? ''}）`}
          </div>
          {total > 0 && !isMultiFile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span>导入范围：第</span>
              <InputNumber
                size="middle"
                min={1}
                max={total}
                value={clampedFrom}
                onChange={(v) => setRangeFrom(typeof v === 'number' ? v : 1)}
                style={{ width: 80 }}
              />
              <span>到第</span>
              <InputNumber
                size="middle"
                min={clampedFrom}
                max={total}
                value={clampedTo}
                onChange={(v) => setRangeTo(typeof v === 'number' ? v : clampedFrom)}
                style={{ width: 80 }}
              />
              <span>章</span>
              {total > 20 && (
                <Button
                  size="middle"
                  type="link"
                  onClick={() => {
                    setRangeFrom(1)
                    setRangeTo(Math.min(20, total))
                  }}
                >
                  前 20 章
                </Button>
              )}
              <span style={{ color: 'var(--lobe-color-text-secondary, #888)' }}>
                共导入 {selectedCount} 章
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
        message.warning('当前不支持上传图片')
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
      message.warning('请输入名称')
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
          返回列表
        </Button>
        <div className="canvas-film-editor-actions">
          {mode === 'edit' && onOptimize && (
            <Button size="middle" icon={<Icons.Sparkles size={13} />} onClick={onOptimize}>
              AI 优化
            </Button>
          )}
          <Button
            size="middle"
            type="primary"
            icon={<Icons.Check size={13} />}
            onClick={() => void handleSave()}
          >
            保存
          </Button>
        </div>
      </div>
      <div className="canvas-film-editor-form">
        <label className="canvas-film-editor-field">
          <span>名称</span>
          <Input
            value={name}
            placeholder={`${FILM_ASSET_KIND_LABELS[kind]}名称`}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        {/* 类型专属快速字段（character/scene/prop/effect） */}
        {attributeFields.length > 0 && (
          <div className="canvas-film-editor-attributes">
            <div className="canvas-film-editor-section-title">快速字段</div>
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
          <div className="canvas-film-editor-section-title">标签</div>
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
              placeholder="输入标签后回车"
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
              <span className="canvas-film-editor-section-title">参考图（每张配一段描述词）</span>
              <ReferenceToolbar
                onAddLocal={handleAddLocalImage}
                onAddFromCanvas={() => {
                  message.info('请在画布上右键选择「加入资源库」,或拖拽图片节点到此。')
                }}
              />
            </div>
            {references.length === 0 ? (
              <div className="canvas-film-references-empty">
                暂无参考图。点击上方「上传」添加，或在画布右键把生成的图片加入此资源。
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
            {kind === 'script' ? '剧本内容' : kind === 'prompt_library' ? '提示词内容' : '整体描述'}
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
            <span>默认生成提示词（AI 生图/生视频时复用）</span>
            <div className="canvas-film-editor-prompt-count-wrap">
              <Input.TextArea
                className="canvas-film-editor-prompt-input"
                rows={5}
                autoSize={{ minRows: 5, maxRows: 16 }}
                value={prompt}
                placeholder="如：电影感、高质量、精细细节..."
                onChange={(e) => setPrompt(e.target.value)}
              />
              <span className="canvas-film-editor-prompt-count">
                {prompt.trim().length.toLocaleString()} 字符
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
      <div className="canvas-film-editor-section-title">被谁引用（{total}）</div>
      {total === 0 ? (
        <div className="canvas-film-references-empty">
          暂无引用。可在分镜片段或画布节点中使用此资源。
        </div>
      ) : (
        <div className="canvas-film-usage-list">
          {usage.shotSegments.length > 0 && (
            <div className="canvas-film-usage-group">
              <div className="canvas-film-usage-group-title">分镜片段</div>
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
              <div className="canvas-film-usage-group-title">画布节点</div>
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
  if (name.includes('concept') || name.includes('定妆') || name.includes('概念')) return 'concept'
  if (name.includes('expression') || name.includes('表情')) return 'expression'
  if (name.includes('costume') || name.includes('服饰') || name.includes('服装')) return 'costume'
  if (name.includes('action') || name.includes('动作')) return 'action'
  if (name.includes('storyboard') || name.includes('分镜')) return 'storyboard'
  if (name.includes('angle') || name.includes('角度')) return 'angle'
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
          <div className="canvas-film-reference-missing">图片缺失</div>
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
          placeholder="短标签（可选）"
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
          placeholder="该图的描述词（AI 生成时使用）"
          onChange={(e) => onChange({ ...reference, description: e.target.value })}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Switch
            size="middle"
            checked={Boolean(reference.isPrimary)}
            onChange={(checked) => onChange({ ...reference, isPrimary: checked })}
          />
          <span style={{ fontSize: 12 }}>主基准图</span>
          <Switch
            size="middle"
            checked={Boolean(reference.locked)}
            onChange={(checked) => onChange({ ...reference, locked: checked })}
          />
          <span style={{ fontSize: 12 }}>锁定</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Select
            size="middle"
            style={{ flex: 1 }}
            value={reference.usage ?? 'other'}
            onChange={(usage) => onChange({ ...reference, usage })}
            options={[
              { value: 'identity', label: '身份' },
              { value: 'style', label: '风格' },
              { value: 'pose', label: '姿态' },
              { value: 'costume', label: '服装' },
              { value: 'scene_layout', label: '场景布局' },
              { value: 'lighting', label: '光影' },
              { value: 'other', label: '其他' },
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
        上传
      </Button>
      <Button size="middle" icon={<Icons.Image size={13} />} onClick={onAddFromCanvas}>
        从画布选
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
          label: '年龄阶段',
          placeholder: '如：青年',
          aliases: ['年龄', '年龄段', '年纪'],
        },
        { key: 'gender', label: '性别', placeholder: '如：女', aliases: ['性别'] },
        {
          key: 'occupation',
          label: '身份/职业',
          placeholder: '如：剑客',
          aliases: ['身份', '职业', '角色定位'],
        },
        {
          key: 'appearance',
          label: '外貌特征',
          placeholder: '如：银色长发、绿色眼睛',
          aliases: ['外貌', '外形', '长相'],
        },
        {
          key: 'hair',
          label: '发型',
          placeholder: '如：短发、银色长发',
          aliases: ['发型', '发式', '头发'],
        },
        {
          key: 'costume',
          label: '服饰',
          placeholder: '如：黑色战甲、长靴',
          aliases: ['服饰', '服装', '穿着'],
        },
        {
          key: 'signatureProp',
          label: '标志道具',
          placeholder: '如：铜钥匙',
          aliases: ['标志道具', '随身道具', '道具'],
        },
        {
          key: 'personality',
          label: '性格关键词',
          placeholder: '如：坚毅、冷静',
          aliases: ['性格', '气质', '个性'],
        },
        {
          key: 'voice',
          label: '声线',
          placeholder: '如：低沉、沙哑',
          aliases: ['声线', '声音', '嗓音'],
        },
      ]
    case 'scene':
      return [
        {
          key: 'settingType',
          label: '内/外景',
          placeholder: '内景 / 外景',
          aliases: ['类型', '内外景', '场景类型'],
        },
        {
          key: 'location',
          label: '地点类型',
          placeholder: '如：街道、宫殿',
          aliases: ['地点', '位置', '场所'],
        },
        {
          key: 'timeOfDay',
          label: '时间段',
          placeholder: '如：黄昏、深夜',
          aliases: ['时间', '时段', '时间段'],
        },
        { key: 'weather', label: '天气', placeholder: '如：雨天、晴', aliases: ['天气'] },
        {
          key: 'lighting',
          label: '光线',
          placeholder: '如：逆光、柔和',
          aliases: ['光线', '光影', '照明'],
        },
        {
          key: 'colorTone',
          label: '色彩基调',
          placeholder: '如：冷色调、暖色调',
          aliases: ['色调', '色彩', '色温'],
        },
        {
          key: 'artDirection',
          label: '美术风格',
          placeholder: '如：赛博废墟',
          aliases: ['美术', '美术风格', '风格'],
        },
        {
          key: 'mood',
          label: '氛围',
          placeholder: '如：压抑、悬疑',
          aliases: ['氛围', '情绪', '气氛'],
        },
      ]
    case 'prop':
      return [
        { key: 'usage', label: '用途', placeholder: '如：战斗武器' },
        { key: 'owner', label: '归属角色', placeholder: '角色名' },
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
      return '粘贴或编写剧本内容...\n\n支持剧名、集数、章节、场次、角色、对白、旁白、动作描述。'
    case 'prompt_library':
      return '输入提示词模板内容...\n\n可包含镜头语言、风格、质量词等，供分镜生成时引用。'
    default:
      return '输入详细设定与描述...'
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
    () => buildEdlMarkdown(snapshot.project.title ?? '成片', timeline),
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
          <span>分镜分组</span>
          <div style={{ display: 'flex', gap: 2 }}>
            {handlers.onSaveStylePreset && (
              <Tooltip title="风格预设（运镜/画面/动作）">
                <Button
                  size="middle"
                  type="text"
                  icon={<Icons.Sparkles size={14} />}
                  onClick={() => setPresetOpen(true)}
                />
              </Tooltip>
            )}
            {handlers.onExportTimeline && timeline.length > 0 && (
              <Tooltip title="导出成片清单 (EDL)">
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
          title="项目风格与风格预设"
          okText="保存预设"
          cancelText="关闭"
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
            message.success('风格预设已保存')
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
                { value: 'production', label: '项目' },
                { value: 'color', label: '色彩' },
                { value: 'camera', label: '运镜' },
                { value: 'frame', label: '画面' },
                { value: 'action', label: '动作' },
                { value: 'character', label: '角色' },
                { value: 'scene', label: '场景' },
              ]}
            />
            <Input
              size="middle"
              placeholder="预设名称（如：手持跟拍）"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
            />
          </div>
          <Input.TextArea
            placeholder="提示词片段（英文短语，逗号分隔），将可一键追加到分镜镜头提示词"
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
            <div style={{ fontWeight: 600, marginBottom: 6 }}>项目视觉圣经</div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--lobe-color-text-secondary, #888)',
                marginBottom: 8,
              }}
            >
              {productionBible?.locked ? '已锁定' : '未锁定'} ·{' '}
              {productionBible?.aspectRatio ?? '未设置比例'}
            </div>
            <Input.TextArea
              rows={3}
              value={productionBible?.visualStyle ?? ''}
              readOnly
              placeholder="尚未应用项目级风格，可从下方内置风格包一键应用。"
            />
          </div>
          {handlers.onApplyProductionBible && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>内置风格包（一键应用到项目）</div>
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
                        应用并锁定
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
                已有预设
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
          title="成片清单 (EDL)"
          width={720}
          okText="插入画布为文本节点"
          cancelText="关闭"
          onCancel={() => setEdlOpen(false)}
          onOk={() => {
            handlers.onExportTimeline?.({
              title: snapshot.project.title ?? '成片',
              markdown: edlMarkdown,
            })
            setEdlOpen(false)
          }}
        >
          <div style={{ marginBottom: 8, color: 'var(--lobe-color-text-secondary, #888)' }}>
            共 {timeline.length} 镜 · 总时长 {formatTimecode(totalRuntimeSec(timeline))}（
            {totalRuntimeSec(timeline)}s）。按分组顺序 + 镜号展开，作为顺序拼接 / 交付清单。
          </div>
          <Input.TextArea value={edlMarkdown} readOnly autoSize={{ minRows: 10, maxRows: 20 }} />
        </Modal>
        {creatingGroup && (
          <div className="canvas-film-shots-new-group">
            <Input
              size="middle"
              autoFocus
              value={newGroupName}
              placeholder="分组名称"
              onChange={(e) => setNewGroupName(e.target.value)}
              onPressEnter={() => void handleCreateGroup()}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setCreatingGroup(false)
              }}
            />
          </div>
        )}
        {shotGroups.length === 0 ? (
          <div className="canvas-film-empty">暂无分组，点击 + 新建</div>
        ) : (
          <div className="canvas-film-shots-group-list">
            {shotGroups.map((group) => (
              <div
                key={group.id}
                className={`canvas-film-shots-group-item${selectedGroupId === group.id ? ' active' : ''}`}
                onClick={() => setSelectedGroupId(group.id)}
              >
                <div className="canvas-film-shots-group-name">{group.name}</div>
                <div className="canvas-film-shots-group-meta">{group.segments.length} 片段</div>
                <Button
                  size="middle"
                  type="text"
                  danger
                  icon={<Icons.Trash size={12} />}
                  onClick={(e) => {
                    e.stopPropagation()
                    void handlers.deleteShotGroup(group.id)
                  }}
                />
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
          <Empty description="选择或新建一个分镜分组" className="canvas-film-empty" />
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
      message.success(`已拆分为 ${splitPreview.length} 段`)
      setSplitTarget(null)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '拆分失败')
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
      message.success(`已从分镜表导入 ${parsedRows.length} 个分镜片段`)
      setImportOpen(false)
      setImportText('')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导入失败')
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
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            size="middle"
            type={viewMode === 'table' ? 'primary' : 'default'}
            icon={<Icons.FileText size={13} />}
            onClick={() => setViewMode('table')}
          >
            分镜表
          </Button>
          <Button
            size="middle"
            type={viewMode === 'card' ? 'primary' : 'default'}
            icon={<Icons.Grid size={13} />}
            onClick={() => setViewMode('card')}
          >
            卡片
          </Button>
          {handlers.onGenerateStoryboardGrid && group.segments.length > 0 && (
            <Tooltip title="在画布上创建分镜图（宫格）任务节点">
              <Button
                size="middle"
                icon={<Icons.Combine size={13} />}
                onClick={() => {
                  void handlers.onGenerateStoryboardGrid?.(group)
                }}
              >
                生成分镜图
              </Button>
            </Tooltip>
          )}
          {handlers.onExpandShotsToCanvas && group.segments.length > 0 && (
            <Button
              size="middle"
              icon={<Icons.Layers size={13} />}
              onClick={async () => {
                const count = (await handlers.onExpandShotsToCanvas?.(group)) ?? 0
                if (count > 0) message.success(`已在画布展开 ${count} 个分镜节点`)
              }}
            >
              展开到画布
            </Button>
          )}
          <Button
            size="middle"
            icon={<Icons.Workflow size={13} />}
            onClick={() => setAutoOpen(true)}
          >
            按剧本自动分镜
          </Button>
          <Tooltip title="粘贴分镜 agent 生成的 JSON 或 Markdown 分镜表，解析为分镜片段">
            <Button
              size="middle"
              icon={<Icons.FilePlus size={13} />}
              onClick={() => setImportOpen(true)}
            >
              导入分镜表
            </Button>
          </Tooltip>
          <Button
            size="middle"
            type="primary"
            icon={<Icons.Plus size={13} />}
            onClick={() => setCreating(true)}
          >
            新建片段
          </Button>
        </div>
      </div>
      <Modal
        open={autoOpen}
        title="按剧本自动分镜（按秒）"
        width={680}
        okText={plannedShots.length > 0 ? `生成 ${plannedShots.length} 个分镜` : '生成'}
        cancelText="取消"
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
            message.success(`已生成 ${plannedShots.length} 个分镜片段`)
            setAutoOpen(false)
            setSceneText('')
          } catch (error) {
            message.error(error instanceof Error ? error.message : '自动分镜失败')
          } finally {
            setAutoBusy(false)
          }
        }}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <span style={{ whiteSpace: 'nowrap' }}>节奏基线（秒/镜）</span>
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
              预计 {plannedShots.length} 镜 · 总时长 {totalPlannedDurationSec(plannedShots)}s
            </span>
          )}
        </div>
        <Input.TextArea
          placeholder="粘贴本场剧本：动作描述独立成行，对白用「角色：台词」。对白行按语速估时长，动作行用节奏基线。"
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
              <div style={{ fontSize: 12 }}>… 共 {plannedShots.length} 镜</div>
            )}
          </div>
        )}
      </Modal>
      <Modal
        open={splitTarget != null}
        title={`拆分「${splitTarget?.title ?? ''}」为多段`}
        width={560}
        okText={splitPreview.length > 1 ? `拆成 ${splitPreview.length} 段` : '无需拆分'}
        cancelText="取消"
        okButtonProps={{ disabled: splitPreview.length <= 1, loading: splitBusy }}
        onCancel={() => setSplitTarget(null)}
        onOk={() => void runSplit()}
      >
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <span style={{ whiteSpace: 'nowrap' }}>单段时长上限（秒）</span>
          <Input
            type="number"
            min={1}
            step={0.5}
            value={splitMaxClip}
            style={{ width: 120 }}
            onChange={(e) => setSplitMaxClip(e.target.value)}
          />
          <span style={{ color: 'var(--lobe-color-text-secondary, #888)', fontSize: 12 }}>
            原镜 {splitTarget ? resolveSegmentDuration(splitTarget) : 0}s · 多数视频模型每段 ≤
            {DEFAULT_MAX_CLIP_SEC}s
          </span>
        </div>
        {splitPreview.length > 1 ? (
          <div className="canvas-film-segment-list" style={{ maxHeight: 220, overflow: 'auto' }}>
            {splitPreview.map((part, idx) => (
              <div key={idx} style={{ fontSize: 12, padding: '3px 0' }}>
                <strong>{part.title}</strong> {part.inSec}s–{part.outSec}s（{part.durationSec}s）
                {part.dialogue ? ` 台词：${part.dialogue}` : ''}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--lobe-color-text-secondary, #888)' }}>
            当前时长未超过上限，无需拆分。
          </div>
        )}
      </Modal>
      <Modal
        open={importOpen}
        title="导入分镜表（解析 JSON / Markdown）"
        width={720}
        okText={parsedRows.length > 0 ? `导入 ${parsedRows.length} 个分镜` : '解析'}
        cancelText="取消"
        okButtonProps={{ disabled: parsedRows.length === 0, loading: importBusy }}
        onCancel={() => setImportOpen(false)}
        onOk={() => void runImportTable()}
      >
        <div
          style={{ fontSize: 12, color: 'var(--lobe-color-text-secondary, #888)', marginBottom: 8 }}
        >
          粘贴分镜 agent / 导演 agent 生成的分镜表（优先 JSON shots，兼容 Markdown
          表格）。按表头识别列，容忍列顺序与额外列； 角色名会自动匹配同名角色资产。
        </div>
        <Input.TextArea
          placeholder={
            '| 镜号 | 时长(秒) | 景别 | 运镜 | 画面/动作 | 对白 | 角色 |\n| --- | --- | --- | --- | --- | --- | --- |\n| 1 | 3 | 近景 | 推 | 少年握紧剑柄 | 住手！ | 少年 |'
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
                  <th>镜号</th>
                  <th>时长</th>
                  <th>镜头</th>
                  <th>画面</th>
                  <th>对白</th>
                  <th>角色</th>
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
        <Empty description="暂无分镜片段" className="canvas-film-empty" />
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
                      <span>对白</span>
                      {segment.dialogue}
                    </div>
                  )}
                  {segment.narration && (
                    <div className="canvas-film-segment-line">
                      <span>旁白</span>
                      {segment.narration}
                    </div>
                  )}
                  {segment.shotPrompt && (
                    <div className="canvas-film-segment-line">
                      <span>镜头</span>
                      {segment.shotPrompt}
                    </div>
                  )}
                  <div className="canvas-film-segment-refs">
                    {scene && <Tag color="blue">{scene.title ?? '场景'}</Tag>}
                    {characters.map((character) => (
                      <Tag key={character.id} color="orange">
                        {character.title}
                      </Tag>
                    ))}
                  </div>
                </div>
                <div className="canvas-film-segment-actions">
                  {handlers.onGenerateSegmentKeyframes && (
                    <Tooltip title="生成关键帧（添加到画布）">
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
                    <Tooltip title="生成视频（添加到画布）">
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
                    <Tooltip title="把画布选中图片设为关键帧">
                      <Button
                        size="middle"
                        type="text"
                        icon={<Icons.Link size={13} />}
                        onClick={() => {
                          const count =
                            handlers.onSetSegmentKeyframesFromSelection?.({ group, segment }) ?? 0
                          if (count > 0) message.success(`已设为 ${count} 张关键帧`)
                          else message.warning('请先在画布上选中图片节点')
                        }}
                      />
                    </Tooltip>
                  )}
                  <Tooltip title="拆分为多段（适配短视频模型）">
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

/**
 * 分镜表（按秒）：以表格方式展示一个分镜分组的全部片段，带累计时间码列。
 * 每行支持生成关键帧 / 设关键帧 / 生成视频 / 拆分 / 编辑 / 删除。
 */
function ShotSegmentTable({
  group,
  characterAssets,
  sceneAssets,
  handlers,
  onEdit,
  onSplit,
}: {
  group: ShotGroup
  characterAssets: CanvasAsset[]
  sceneAssets: CanvasAsset[]
  handlers: FilmCenterHandlers
  onEdit: (id: string) => void
  onSplit: (segment: ShotSegment) => void
}) {
  // 累计时间码：优先用片段自带 inSec，否则按时长顺序累加
  let cursor = 0
  const rows = group.segments.map((segment) => {
    const duration = resolveSegmentDuration(segment)
    const inSec = typeof segment.inSec === 'number' ? segment.inSec : cursor
    const outSec = typeof segment.outSec === 'number' ? segment.outSec : inSec + duration
    cursor = outSec
    const characters = (segment.characterAssetIds ?? [])
      .map((id) => characterAssets.find((asset) => asset.id === id))
      .filter((asset): asset is CanvasAsset => Boolean(asset))
    const scene = segment.sceneAssetId
      ? sceneAssets.find((asset) => asset.id === segment.sceneAssetId)
      : undefined
    return { segment, duration, inSec, outSec, characters, scene }
  })
  const totalSec = rows.reduce((sum, row) => sum + row.duration, 0)

  return (
    <div className="canvas-shot-table-wrap">
      <table className="canvas-shot-table">
        <thead>
          <tr>
            <th>镜号</th>
            <th>时间码</th>
            <th>时长</th>
            <th>画面 / 动作</th>
            <th>镜头</th>
            <th>对白</th>
            <th>角色 / 场景</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ segment, duration, inSec, outSec, characters, scene }) => {
            const overLimit = duration > DEFAULT_MAX_CLIP_SEC
            return (
              <tr key={segment.id}>
                <td className="canvas-shot-table-idx">
                  #{segment.index}
                  {segment.keyframeNodeIds && segment.keyframeNodeIds.length > 0 && (
                    <span className="canvas-shot-table-kf" title="已设关键帧">
                      🎞{segment.keyframeNodeIds.length}
                    </span>
                  )}
                </td>
                <td className="canvas-shot-table-time">
                  {formatTimecode(inSec)}–{formatTimecode(outSec)}
                </td>
                <td className={overLimit ? 'canvas-shot-table-over' : undefined}>
                  {duration}s
                  {overLimit && (
                    <Tooltip title={`超过单段上限 ${DEFAULT_MAX_CLIP_SEC}s，建议拆分`}>
                      <span className="canvas-shot-table-warn">!</span>
                    </Tooltip>
                  )}
                </td>
                <td className="canvas-shot-table-desc">
                  <div className="canvas-shot-table-title">{segment.title}</div>
                  {segment.description && <div>{segment.description}</div>}
                </td>
                <td className="canvas-shot-table-shot">{segment.shotPrompt || '—'}</td>
                <td className="canvas-shot-table-line">{segment.dialogue || '—'}</td>
                <td>
                  <div className="canvas-shot-table-refs">
                    {scene && <Tag color="blue">{scene.title ?? '场景'}</Tag>}
                    {characters.map((character) => (
                      <Tag key={character.id} color="orange">
                        {character.title}
                      </Tag>
                    ))}
                    {!scene && characters.length === 0 && '—'}
                  </div>
                </td>
                <td className="canvas-shot-table-ops">
                  {handlers.onGenerateSegmentKeyframes && (
                    <Tooltip title="生成关键帧（首/尾帧）">
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
                    <Tooltip title="生成视频">
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
                  <Tooltip title="拆分为多段（适配短视频模型）">
                    <Button
                      size="middle"
                      type="text"
                      icon={<Icons.Scissors size={13} />}
                      onClick={() => onSplit(segment)}
                    />
                  </Tooltip>
                  <Button
                    size="middle"
                    type="text"
                    icon={<Icons.Edit size={13} />}
                    onClick={() => onEdit(segment.id)}
                  />
                  <Button
                    size="middle"
                    type="text"
                    danger
                    icon={<Icons.Trash size={13} />}
                    onClick={() => void handlers.deleteShotSegment(group.id, segment.id)}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="canvas-shot-table-foot">
        共 {rows.length} 镜 · 总时长 {formatTimecode(totalSec)}（{totalSec}s）
      </div>
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
      message.warning('请输入片段标题')
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
          返回列表
        </Button>
        <Button
          size="middle"
          type="primary"
          icon={<Icons.Check size={13} />}
          onClick={() => void handleSave()}
        >
          保存
        </Button>
      </div>
      <div className="canvas-film-editor-form">
        <label className="canvas-film-editor-field">
          <span>片段标题</span>
          <Input
            value={title}
            placeholder="如：镜1 - 主角登场"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="canvas-film-editor-field">
          <span>画面描述 / 动作</span>
          <Input.TextArea
            rows={3}
            value={description}
            placeholder="描述这一镜的画面与角色动作"
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <div className="canvas-film-editor-field-row">
          <label className="canvas-film-editor-field">
            <span>场景</span>
            <select
              className="canvas-film-select"
              value={sceneId ?? ''}
              onChange={(e) => setSceneId(e.target.value || undefined)}
            >
              <option value="">不指定</option>
              {sceneAssets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="canvas-film-editor-field">
          <span>角色</span>
          <div className="canvas-film-chip-pick">
            {characterAssets.length === 0 ? (
              <span className="canvas-film-empty-inline">暂无角色资产，请先在「角色」Tab 创建</span>
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
          <span>对白</span>
          <Input.TextArea
            rows={2}
            value={dialogue}
            placeholder="角色对白"
            onChange={(e) => setDialogue(e.target.value)}
          />
        </label>
        <label className="canvas-film-editor-field">
          <span>旁白</span>
          <Input.TextArea
            rows={2}
            value={narration}
            placeholder="旁白/解说词"
            onChange={(e) => setNarration(e.target.value)}
          />
        </label>
        {stylePresets.length > 0 && (
          <div className="canvas-film-editor-field">
            <span>应用风格预设（点击追加到镜头提示词）</span>
            <div className="canvas-film-chip-pick">
              {stylePresets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="canvas-film-chip"
                  onClick={() => applyPreset(preset)}
                >
                  {preset.kind === 'camera'
                    ? '运镜'
                    : preset.kind === 'frame'
                      ? '画面'
                      : preset.kind === 'action'
                        ? '动作'
                        : preset.kind === 'production'
                          ? '项目'
                          : preset.kind === 'color'
                            ? '色彩'
                            : preset.kind === 'character'
                              ? '角色'
                              : '场景'}{' '}
                  · {preset.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <label className="canvas-film-editor-field">
          <span>镜头提示词</span>
          <Input.TextArea
            rows={2}
            value={shotPrompt}
            placeholder="景别、运镜、构图等，用于 AI 生成"
            onChange={(e) => setShotPrompt(e.target.value)}
          />
        </label>
        <label className="canvas-film-editor-field">
          <span>镜头时长（秒）</span>
          <Input
            type="number"
            min={0}
            step={0.5}
            value={durationSec}
            placeholder="如 3，用于按秒分镜与逐段视频时长"
            onChange={(e) => setDurationSec(e.target.value)}
          />
        </label>
      </div>
    </div>
  )
}
