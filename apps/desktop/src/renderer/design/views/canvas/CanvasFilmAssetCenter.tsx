import { useCallback, useMemo, useRef, useState } from 'react'
import { Empty, Input, Modal, Select, Tag, Tooltip, message } from 'antd'
import { Button } from '@lobehub/ui'
import { Icons } from '../../Icons'
import { AssetThumbnail } from './CanvasAssetThumbnail'
import { CanvasPromptLibraryPanel, type CanvasPromptLibraryEntry } from './CanvasPromptLibraryPanel'
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
import type { FilmReference, FilmReferenceKind, FilmStylePreset } from './canvasFilmTypes'
import type { CanvasAsset, CanvasSnapshot } from './canvas.types'
import { readStylePresets } from './canvasPipeline'
import {
  CHARACTER_SHEET_TEMPLATES,
  type CharacterSheetAspect,
} from './canvasCharacterSheetPrompts'
import { splitTextIntoChapters } from './canvasManuscript'
import {
  planShotsFromScene,
  totalPlannedDurationSec,
  type PlannedShot,
} from './canvasShotPlanner'
import { buildEdlMarkdown, buildTimeline, totalRuntimeSec, formatTimecode } from './canvasFilmTimeline'

/**
 * 影视公用资产中心 - 主弹窗（文档 §7.10）。
 *
 * 项目级公用资产管理：剧本 / 角色 / 场景 / 道具 / 提示词库。
 * 每个资产可编辑、AI 优化（text_rewrite 触发平台 agent）、插入画布。
 * 分镜分组在 ShotGroupEditor 子组件。
 *
 * 数据复用 CanvasAsset + metadata.kind，不新建表。
 */

type TabKind = FilmAssetKind | 'shots'

const TAB_ORDER: TabKind[] = [
  'manuscript',
  'chapter',
  'script',
  'character',
  'scene',
  'prop',
  'effect',
  'shots',
  'prompt_library',
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
}

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
  /** 导入长文稿并按章切分（设计 §S1）：返回创建的章节数 */
  onImportManuscript?: (input: { title: string; text: string }) => Promise<number>
  /** 章节转剧本（设计 §S2）：基于章节内容创建剧本资产，可继续拆解 */
  onChapterToScreenplay?: (asset: CanvasAsset) => Promise<void>
  /** 导出成片清单 EDL（设计 §S9）：把时间线文本插入画布 */
  onExportTimeline?: (input: { title: string; markdown: string }) => void
  /** 保存风格预设（设计 §S5）：运镜/画面/动作，项目级可复用 */
  onSaveStylePreset?: (preset: FilmStylePreset) => Promise<void>
  onGenerateAssetReference?: (asset: CanvasAsset) => void
  /** 角色多面向出图（设计 §S4）：三视图/表情/远近/服装/五官/武器道具 */
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
  hasPromptCanvasTarget?: () => boolean
  onApplyPromptEntryToCanvas?: (entry: CanvasPromptLibraryEntry) => Promise<boolean>
  onInsertAssetToCanvas: (assetId: string) => void
  /** 查询资源被谁引用（分镜片段 + 画布节点） */
  getFilmAssetUsage?: (assetId: string) => {
    shotSegments: Array<{ groupId: string; groupName: string; segmentId: string; segmentTitle: string; segmentIndex: number }>
    nodes: Array<{ id: string; type: string; title: string | null }>
  }
  // 分镜分组
  createShotGroup: (input: { name: string; description?: string }) => Promise<ShotGroup>
  updateShotGroup: (groupId: string, patch: { name?: string; description?: string }) => Promise<void>
  deleteShotGroup: (groupId: string) => Promise<void>
  createShotSegment: (
    groupId: string,
    input: Partial<ShotSegment> & { title: string },
  ) => Promise<void>
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
}: {
  open: boolean
  onClose: () => void
  snapshot: CanvasSnapshot
  handlers: FilmCenterHandlers
  /** 上传图片到项目资产库，返回新 assetId */
  onUploadImage?: (file: File) => Promise<string | null>
}) {
  const [activeTab, setActiveTab] = useState<TabKind>('script')

  if (!open) return null

  return (
    <section
      className="canvas-bottom-floating-panel canvas-film-center-panel"
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="canvas-bottom-floating-head">
        <div>
          <FilmCenterHeaderTitle />
          <span>剧本、角色、场景、道具、分镜和提示词库</span>
        </div>
        <Button
          size="small"
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
            <PromptLibraryTab snapshot={snapshot} handlers={handlers} />
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

function PromptLibraryTab({
  snapshot,
  handlers,
}: {
  snapshot: CanvasSnapshot
  handlers: FilmCenterHandlers
}) {
  const handleApply = async (entry: CanvasPromptLibraryEntry) => {
    if (handlers.onApplyPromptEntryToCanvas) {
      const applied = await handlers.onApplyPromptEntryToCanvas(entry)
      if (applied) return
    }

    if (entry.source === 'project' && entry.assetId) {
      handlers.onInsertAssetToCanvas(entry.assetId)
      message.success('已插入提示词到画布')
      return
    }
    await handlers.createFilmAsset({
      kind: 'prompt_library',
      name: entry.label,
      text: entry.text,
      prompt: entry.text,
      tags: [entry.group, ...(entry.tags ?? [])],
    })
    message.success(`已加入项目提示词库：${entry.label}`)
  }

  return (
    <CanvasPromptLibraryPanel
      assets={snapshot.assets}
      className="canvas-film-prompt-library"
      title="提示词库"
      subtitle="项目提示词 + 内置电影镜头/风格/表演词"
      onApply={handleApply}
      getApplyLabel={(entry) =>
        handlers.hasPromptCanvasTarget?.()
          ? '应用到画布'
          : entry.source === 'project'
            ? '插入画布'
            : '加入项目库'
      }
    />
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
  // 文稿导入弹窗（设计 §S1）
  const [importOpen, setImportOpen] = useState(false)
  const [importTitle, setImportTitle] = useState('')
  const [importText, setImportText] = useState('')
  const [importing, setImporting] = useState(false)
  const importPreview = useMemo(
    () => (importText.trim() ? splitTextIntoChapters(importText) : null),
    [importText],
  )
  const [query, setQuery] = useState('')
  const [tagFilter, setTagFilter] = useState<string[]>([])
  const [sortBy, setSortBy] = useState<'updated' | 'created' | 'name' | 'usage'>('updated')

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
            if (Array.isArray(s['characterAssetIds'])) for (const id of s['characterAssetIds']) bump(id)
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
        const prompt = typeof asset.metadata?.['prompt'] === 'string'
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

  const editingAsset = editingId ? assets.find((a) => a.id === editingId) ?? null : null

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
      content: '会基于当前剧本文本自动抽取角色、场景，并创建一个分镜分组。生成结果仍可继续人工编辑。',
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
          {kind === 'manuscript' && handlers.onImportManuscript && (
            <Button
              size="small"
              icon={<Icons.Upload size={13} />}
              onClick={() => {
                setImportTitle('')
                setImportText('')
                setImportOpen(true)
              }}
            >
              导入文稿并分章
            </Button>
          )}
          <Button type="primary" size="small" icon={<Icons.Plus size={13} />} onClick={() => setCreating(true)}>
            新建{FILM_ASSET_KIND_LABELS[kind]}
          </Button>
        </div>
      </div>

      <div className="canvas-film-asset-toolbar">
        <Input
          size="small"
          allowClear
          value={query}
          placeholder="搜索名称/描述/默认 prompt"
          onChange={(e) => setQuery(e.target.value)}
          className="canvas-film-asset-search"
        />
        <Select
          size="small"
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
                  setTagFilter((prev) =>
                    active ? prev.filter((t) => t !== tag) : [...prev, tag],
                  )
                }}
              >
                {tag}
              </Tag>
            )
          })}
          {tagFilter.length > 0 && (
            <Button size="small" type="text" onClick={() => setTagFilter([])}>
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
        <div className="canvas-film-asset-cards">
          {filtered.map((asset) => {
            const refs = readReferences(asset.metadata)
            const cover = refs.length > 0
              ? snapshot.assets.find((a) => a.id === refs[0]?.assetId)
              : null
            const usage = usageMap.get(asset.id) ?? 0
            const tags = readTags(asset.metadata)
            return (
              <div key={asset.id} className="canvas-film-asset-card">
                <div className="canvas-film-asset-card-thumb">
                  {cover ? (
                    <AssetThumbnail asset={cover} />
                  ) : (
                    <AssetThumbnail asset={asset} />
                  )}
                  {refs.length > 1 && (
                    <span className="canvas-film-asset-card-refcount" title={`${refs.length} 张参考图`}>
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
                  {kind === 'script' && handlers.onBreakdownScriptAsset && (
                    <Tooltip title="拆解剧本">
                      <Button
                        size="small"
                        type="text"
                        icon={<Icons.Workflow size={14} />}
                        onClick={() => handleBreakdownScript(asset)}
                      />
                    </Tooltip>
                  )}
                  {kind === 'chapter' && handlers.onChapterToScreenplay && (
                    <Tooltip title="转剧本">
                      <Button
                        size="small"
                        type="text"
                        icon={<Icons.Workflow size={14} />}
                        onClick={() => void handlers.onChapterToScreenplay?.(asset)}
                      />
                    </Tooltip>
                  )}
                  {kind === 'character' && handlers.onGenerateCharacterSheets && (
                    <Tooltip title="生成角色图（三视图/表情/服装…）">
                      <Button
                        size="small"
                        type="text"
                        icon={<Icons.Users size={14} />}
                        onClick={() => setSheetAsset(asset)}
                      />
                    </Tooltip>
                  )}
                  {kind !== 'script' && handlers.onGenerateAssetReference && (
                    <Tooltip title="生成参考图">
                      <Button
                        size="small"
                        type="text"
                        icon={<Icons.Image size={14} />}
                        onClick={() => handlers.onGenerateAssetReference?.(asset)}
                      />
                    </Tooltip>
                  )}
                  <Tooltip title="编辑">
                    <Button size="small" type="text" icon={<Icons.Edit size={14} />} onClick={() => setEditingId(asset.id)} />
                  </Tooltip>
                  <Tooltip title="AI 优化">
                    <Button size="small" type="text" icon={<Icons.Sparkles size={14} />} onClick={() => handlers.onOptimizeAsset(asset)} />
                  </Tooltip>
                  <Tooltip title="插入画布">
                    <Button size="small" type="text" icon={<Icons.Plus size={14} />} onClick={() => handlers.onInsertAssetToCanvas(asset.id)} />
                  </Tooltip>
                  <Tooltip title="删除">
                    <Button
                      size="small"
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
          选择要生成的面向。三视图正面会作为角色基准图，其余面向基于基准图保持一致。
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
      <Modal
        open={importOpen}
        title="导入文稿并按章切分"
        okText={
          importPreview ? `导入 ${importPreview.chapters.length} 章` : '导入'
        }
        cancelText="取消"
        okButtonProps={{
          disabled: !importPreview || importPreview.chapters.length === 0,
          loading: importing,
        }}
        width={680}
        onCancel={() => setImportOpen(false)}
        onOk={async () => {
          if (!handlers.onImportManuscript || !importText.trim()) return
          setImporting(true)
          try {
            const count = await handlers.onImportManuscript({
              title: importTitle.trim() || '未命名文稿',
              text: importText,
            })
            message.success(`已导入文稿，生成 ${count} 个章节`)
            setImportOpen(false)
          } catch (error) {
            message.error(error instanceof Error ? error.message : '导入文稿失败')
          } finally {
            setImporting(false)
          }
        }}
      >
        <Input
          placeholder="文稿标题（如：长安十二时辰）"
          value={importTitle}
          onChange={(e) => setImportTitle(e.target.value)}
          style={{ marginBottom: 8 }}
        />
        <Input.TextArea
          placeholder="粘贴小说/长文稿全文。自动识别「第N章 / Chapter N / 序章 / 番外」等标题切分；识别不到时按长度分片。"
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          autoSize={{ minRows: 8, maxRows: 16 }}
        />
        {importPreview && (
          <div style={{ marginTop: 8, color: 'var(--lobe-color-text-secondary, #888)' }}>
            识别方式：{importPreview.mode === 'heading' ? '按章节标题' : '按长度分片'} · 共{' '}
            {importPreview.chapters.length} 章
            {importPreview.chapters.length > 0 &&
              `（首章：${importPreview.chapters[0]?.title ?? ''}）`}
          </div>
        )}
      </Modal>
    </div>
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
  const [prompt, setPrompt] = useState(
    (asset?.metadata?.prompt as string | undefined) ?? '',
  )
  const [references, setReferences] = useState<FilmReference[]>(() =>
    readReferences(asset?.metadata),
  )
  const [tags, setTags] = useState<string[]>(() => readTags(asset?.metadata))
  const [tagDraft, setTagDraft] = useState('')

  const attributeFields = useMemo(() => getAttributeFields(kind), [kind])
  const [attributes, setAttributes] = useState<Record<string, string>>(() => {
    const stored = asset?.metadata?.attributes as Record<string, string> | undefined
    const init: Record<string, string> = {}
    for (const field of attributeFields) init[field.key] = stored?.[field.key] ?? ''
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
        <Button size="small" type="text" icon={<Icons.ArrowLeft size={14} />} onClick={onClose}>
          返回列表
        </Button>
        <div className="canvas-film-editor-actions">
          {mode === 'edit' && onOptimize && (
            <Button size="small" icon={<Icons.Sparkles size={13} />} onClick={onOptimize}>
              AI 优化
            </Button>
          )}
          <Button size="small" type="primary" icon={<Icons.Check size={13} />} onClick={() => void handleSave()}>
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
              size="small"
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
        {(kind === 'character' ||
          kind === 'scene' ||
          kind === 'prop' ||
          kind === 'effect') && (
          <div className="canvas-film-editor-section">
            <div className="canvas-film-editor-section-title-row">
              <span className="canvas-film-editor-section-title">
                参考图（每张配一段描述词）
              </span>
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
          <span>{kind === 'script' ? '剧本内容' : kind === 'prompt_library' ? '提示词内容' : '整体描述'}</span>
          <Input.TextArea
            rows={kind === 'script' ? 14 : kind === 'prompt_library' ? 8 : 6}
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
            <Input.TextArea
              rows={3}
              value={prompt}
              placeholder="如：电影感、高质量、精细细节..."
              onChange={(e) => setPrompt(e.target.value)}
            />
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
    shotSegments: Array<{ groupId: string; groupName: string; segmentId: string; segmentTitle: string; segmentIndex: number }>
    nodes: Array<{ id: string; type: string; title: string | null }>
  }
}) {
  const usage = useMemo(() => getUsage(assetId), [getUsage, assetId])
  const total = usage.shotSegments.length + usage.nodes.length
  return (
    <div className="canvas-film-usage-panel">
      <div className="canvas-film-editor-section-title">被谁引用（{total}）</div>
      {total === 0 ? (
        <div className="canvas-film-references-empty">暂无引用。可在分镜片段或画布节点中使用此资源。</div>
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
          size="small"
          type="text"
          danger
          icon={<Icons.Trash size={13} />}
          className="canvas-film-reference-remove"
          onClick={onRemove}
        />
      </div>
      <div className="canvas-film-reference-fields">
        <Select
          size="small"
          value={reference.kind}
          onChange={(value) => onChange({ ...reference, kind: value })}
          options={FILM_REFERENCE_KIND_ORDER.map((kind) => ({
            value: kind,
            label: FILM_REFERENCE_KIND_LABELS[kind],
          }))}
        />
        <Input
          size="small"
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
          size="small"
          rows={3}
          value={reference.description}
          placeholder="该图的描述词（AI 生成时使用）"
          onChange={(e) => onChange({ ...reference, description: e.target.value })}
        />
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
        size="small"
        icon={<Icons.Upload size={13} />}
        onClick={() => fileRef.current?.click()}
      >
        上传
      </Button>
      <Button size="small" icon={<Icons.Image size={13} />} onClick={onAddFromCanvas}>
        从画布选
      </Button>
    </div>
  )
}

/** 各资产种类的附加属性字段 */
function getAttributeFields(kind: FilmAssetKind): Array<{ key: string; label: string; placeholder: string }> {
  switch (kind) {
    case 'character':
      return [
        { key: 'age', label: '年龄阶段', placeholder: '如：青年' },
        { key: 'gender', label: '性别', placeholder: '如：女' },
        { key: 'occupation', label: '身份/职业', placeholder: '如：剑客' },
        { key: 'appearance', label: '外貌特征', placeholder: '如：银色长发、绿色眼睛' },
        { key: 'costume', label: '服饰', placeholder: '如：黑色战甲、长靴' },
        { key: 'personality', label: '性格关键词', placeholder: '如：坚毅、冷静' },
      ]
    case 'scene':
      return [
        { key: 'settingType', label: '内/外景', placeholder: '内景 / 外景' },
        { key: 'location', label: '地点类型', placeholder: '如：街道、宫殿' },
        { key: 'timeOfDay', label: '时间段', placeholder: '如：黄昏、深夜' },
        { key: 'weather', label: '天气', placeholder: '如：雨天、晴' },
        { key: 'lighting', label: '光线', placeholder: '如：逆光、柔和' },
        { key: 'colorTone', label: '色彩基调', placeholder: '如：冷色调、暖色调' },
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
                  size="small"
                  type="text"
                  icon={<Icons.Sparkles size={14} />}
                  onClick={() => setPresetOpen(true)}
                />
              </Tooltip>
            )}
            {handlers.onExportTimeline && timeline.length > 0 && (
              <Tooltip title="导出成片清单 (EDL)">
                <Button
                  size="small"
                  type="text"
                  icon={<Icons.FileText size={14} />}
                  onClick={() => setEdlOpen(true)}
                />
              </Tooltip>
            )}
            <Button size="small" type="text" icon={<Icons.Plus size={14} />} onClick={() => setCreatingGroup(true)} />
          </div>
        </div>
        <Modal
          open={presetOpen}
          title="风格预设（项目级可复用）"
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
              size="small"
              value={presetKind}
              style={{ width: 110 }}
              onChange={(v) => setPresetKind(v as FilmStylePreset['kind'])}
              options={[
                { value: 'camera', label: '运镜' },
                { value: 'frame', label: '画面' },
                { value: 'action', label: '动作' },
              ]}
            />
            <Input
              size="small"
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
          {stylePresets.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, marginBottom: 4, color: 'var(--lobe-color-text-secondary, #888)' }}>
                已有预设
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {stylePresets.map((preset) => (
                  <Tag key={preset.id} color={preset.kind === 'camera' ? 'blue' : preset.kind === 'frame' ? 'purple' : 'orange'}>
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
              size="small"
              autoFocus
              value={newGroupName}
              placeholder="分组名称"
              onChange={(e) => setNewGroupName(e.target.value)}
              onPressEnter={() => void handleCreateGroup()}
              onKeyDown={(e) => { if (e.key === 'Escape') setCreatingGroup(false) }}
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
                  size="small"
                  type="text"
                  danger
                  icon={<Icons.Trash size={12} />}
                  onClick={(e) => { e.stopPropagation(); void handlers.deleteShotGroup(group.id) }}
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
  const editingSegment = editingId ? group.segments.find((s) => s.id === editingId) ?? null : null

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
          {group.description && <span className="canvas-film-segments-desc">{group.description}</span>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="small" icon={<Icons.Workflow size={13} />} onClick={() => setAutoOpen(true)}>
            按剧本自动分镜
          </Button>
          <Button size="small" type="primary" icon={<Icons.Plus size={13} />} onClick={() => setCreating(true)}>
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
          <div className="canvas-film-segment-list" style={{ marginTop: 8, maxHeight: 180, overflow: 'auto' }}>
            {plannedShots.slice(0, 12).map((shot) => (
              <div key={shot.index} style={{ fontSize: 12, padding: '2px 0' }}>
                <strong>{shot.title}</strong>（{shot.durationSec}s）
                {shot.dialogue ? `：${shot.dialogue}` : `：${shot.description}`}
              </div>
            ))}
            {plannedShots.length > 12 && <div style={{ fontSize: 12 }}>… 共 {plannedShots.length} 镜</div>}
          </div>
        )}
      </Modal>
      {group.segments.length === 0 ? (
        <Empty description="暂无分镜片段" className="canvas-film-empty" />
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
                  <div className="canvas-film-segment-index">
                    #{segment.index}
                    {segment.durationSec != null && (
                      <span className="canvas-film-segment-dur">{segment.durationSec}s</span>
                    )}
                    {segment.keyframeNodeIds && segment.keyframeNodeIds.length > 0 && (
                      <span className="canvas-film-segment-dur">🎞{segment.keyframeNodeIds.length}</span>
                    )}
                  </div>
                  <div className="canvas-film-segment-body">
                    <div className="canvas-film-segment-title">{segment.title}</div>
                    {segment.description && <div className="canvas-film-segment-desc">{segment.description}</div>}
                    {segment.dialogue && <div className="canvas-film-segment-line"><span>对白</span>{segment.dialogue}</div>}
                    {segment.narration && <div className="canvas-film-segment-line"><span>旁白</span>{segment.narration}</div>}
                    {segment.shotPrompt && <div className="canvas-film-segment-line"><span>镜头</span>{segment.shotPrompt}</div>}
                    <div className="canvas-film-segment-refs">
                      {scene && <Tag color="blue">{scene.title ?? '场景'}</Tag>}
                      {characters.map((character) => (
                        <Tag key={character.id} color="orange">{character.title}</Tag>
                      ))}
                    </div>
                  </div>
                  <div className="canvas-film-segment-actions">
                    {handlers.onGenerateSegmentKeyframes && (
                      <Tooltip title="生成关键帧（首/尾帧）">
                        <Button
                          size="small"
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
                    {handlers.onSetSegmentKeyframesFromSelection && (
                      <Tooltip title="把画布选中图片设为关键帧（用于首尾帧出视频）">
                        <Button
                          size="small"
                          type="text"
                          icon={<Icons.Link size={13} />}
                          onClick={() => {
                            const count = handlers.onSetSegmentKeyframesFromSelection?.({ group, segment }) ?? 0
                            if (count > 0) message.success(`已设为 ${count} 张关键帧`)
                            else message.warning('请先在画布上选中图片节点')
                          }}
                        />
                      </Tooltip>
                    )}
                    {handlers.onGenerateSegmentVideo && (
                      <Tooltip title="生成视频">
                        <Button
                          size="small"
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
                    <Button size="small" type="text" icon={<Icons.Edit size={13} />} onClick={() => setEditingId(segment.id)} />
                    <Button size="small" type="text" danger icon={<Icons.Trash size={13} />} onClick={() => void handlers.deleteShotSegment(group.id, segment.id)} />
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
    else setActionDesignId(preset.id)
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
        <Button size="small" type="text" icon={<Icons.ArrowLeft size={14} />} onClick={onClose}>
          返回列表
        </Button>
        <Button size="small" type="primary" icon={<Icons.Check size={13} />} onClick={() => void handleSave()}>
          保存
        </Button>
      </div>
      <div className="canvas-film-editor-form">
        <label className="canvas-film-editor-field">
          <span>片段标题</span>
          <Input value={title} placeholder="如：镜1 - 主角登场" onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="canvas-film-editor-field">
          <span>画面描述 / 动作</span>
          <Input.TextArea rows={3} value={description} placeholder="描述这一镜的画面与角色动作" onChange={(e) => setDescription(e.target.value)} />
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
                <option key={s.id} value={s.id}>{s.title}</option>
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
          <Input.TextArea rows={2} value={dialogue} placeholder="角色对白" onChange={(e) => setDialogue(e.target.value)} />
        </label>
        <label className="canvas-film-editor-field">
          <span>旁白</span>
          <Input.TextArea rows={2} value={narration} placeholder="旁白/解说词" onChange={(e) => setNarration(e.target.value)} />
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
                  {preset.kind === 'camera' ? '运镜' : preset.kind === 'frame' ? '画面' : '动作'} · {preset.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <label className="canvas-film-editor-field">
          <span>镜头提示词</span>
          <Input.TextArea rows={2} value={shotPrompt} placeholder="景别、运镜、构图等，用于 AI 生成" onChange={(e) => setShotPrompt(e.target.value)} />
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
