import { useCallback, useMemo, useRef, useState } from 'react'
import { Button, Empty, Input, Modal, Select, Tag, Tooltip, message } from 'antd'
import { Icons } from '../../Icons'
import { AssetThumbnail } from './CanvasAssetThumbnail'
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
} from './canvasFilmAssets'
import type { FilmReference, FilmReferenceKind } from './canvasFilmTypes'
import type { CanvasAsset, CanvasSnapshot } from './canvas.types'

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

const TAB_ORDER: TabKind[] = ['script', 'character', 'scene', 'prop', 'effect', 'shots', 'prompt_library']

const TAB_LABELS: Record<TabKind, string> = {
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
  createFilmAsset: (input: CreateFilmAssetInput) => Promise<void>
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
  onInsertAssetToCanvas: (assetId: string) => void
  // 分镜分组
  createShotGroup: (input: { name: string; description?: string }) => Promise<void>
  updateShotGroup: (groupId: string, patch: { name?: string; description?: string }) => Promise<void>
  deleteShotGroup: (groupId: string) => Promise<void>
  createShotSegment: (
    groupId: string,
    input: Partial<import('./canvasFilmAssets').ShotSegment> & { title: string },
  ) => Promise<void>
  updateShotSegment: (
    groupId: string,
    segmentId: string,
    patch: Partial<import('./canvasFilmAssets').ShotSegment>,
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

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={960}
      title={<FilmCenterHeaderTitle />}
      styles={{ body: { padding: 0, height: '70vh' } }}
      destroyOnHidden
    >
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
    </Modal>
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

  const editingAsset = editingId ? assets.find((a) => a.id === editingId) ?? null : null

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
      />
    )
  }

  return (
    <div className="canvas-film-asset-list-tab">
      <div className="canvas-film-asset-list-head">
        <span className="canvas-film-asset-list-count">
          {FILM_ASSET_KIND_LABELS[kind]} · {assets.length} 项
        </span>
        <Button type="primary" size="small" icon={<Icons.Plus size={13} />} onClick={() => setCreating(true)}>
          新建{FILM_ASSET_KIND_LABELS[kind]}
        </Button>
      </div>
      {assets.length === 0 ? (
        <Empty description={`暂无${FILM_ASSET_KIND_LABELS[kind]}`} className="canvas-film-empty" />
      ) : (
        <div className="canvas-film-asset-cards">
          {assets.map((asset) => (
            <div key={asset.id} className="canvas-film-asset-card">
              <div className="canvas-film-asset-card-thumb">
                <AssetThumbnail asset={asset} />
              </div>
              <div className="canvas-film-asset-card-main">
                <div className="canvas-film-asset-card-name" title={asset.title ?? ''}>
                  {asset.title ?? '未命名'}
                </div>
                <div className="canvas-film-asset-card-preview">
                  {(asset.contentText ?? '').slice(0, 60) || '(无内容)'}
                </div>
              </div>
              <div className="canvas-film-asset-card-actions">
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
                  <Button size="small" type="text" danger icon={<Icons.Trash size={14} />} onClick={() => void handlers.deleteFilmAsset(asset.id)} />
                </Tooltip>
              </div>
            </div>
          ))}
        </div>
      )}
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
      </div>
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

// 占位：分镜分组 Tab（下个文件实现完整逻辑，这里先导出接口）
import type { FilmCenterHandlers as FCH } from './CanvasFilmAssetCenter'
import type { ShotGroup } from './canvasFilmAssets'

function ShotGroupTab({
  snapshot,
  handlers,
}: {
  snapshot: CanvasSnapshot
  handlers: FCH
}) {
  // 从 snapshot.project.metadata 读 shotGroups
  const shotGroups = useMemo<ShotGroup[]>(() => {
    const film = snapshot.project.metadata?.film as { shotGroups?: ShotGroup[] } | undefined
    return film?.shotGroups ?? []
  }, [snapshot.project.metadata])

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(shotGroups[0]?.id ?? null)
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')

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
    await handlers.createShotGroup({ name: newGroupName.trim() })
    setNewGroupName('')
    setCreatingGroup(false)
  }

  return (
    <div className="canvas-film-shots-tab">
      <div className="canvas-film-shots-sidebar">
        <div className="canvas-film-shots-sidebar-head">
          <span>分镜分组</span>
          <Button size="small" type="text" icon={<Icons.Plus size={14} />} onClick={() => setCreatingGroup(true)} />
        </div>
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
  handlers,
}: {
  group: ShotGroup
  characterAssets: CanvasAsset[]
  sceneAssets: CanvasAsset[]
  handlers: FCH
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const editingSegment = editingId ? group.segments.find((s) => s.id === editingId) ?? null : null

  if (creating) {
    return (
      <SegmentEditorForm
        mode="create"
        characterAssets={characterAssets}
        sceneAssets={sceneAssets}
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
        <Button size="small" type="primary" icon={<Icons.Plus size={13} />} onClick={() => setCreating(true)}>
          新建片段
        </Button>
      </div>
      {group.segments.length === 0 ? (
        <Empty description="暂无分镜片段" className="canvas-film-empty" />
      ) : (
        <div className="canvas-film-segment-list">
          {group.segments.map((segment) => (
            <div key={segment.id} className="canvas-film-segment-card">
              <div className="canvas-film-segment-index">#{segment.index}</div>
              <div className="canvas-film-segment-body">
                <div className="canvas-film-segment-title">{segment.title}</div>
                {segment.description && <div className="canvas-film-segment-desc">{segment.description}</div>}
                {segment.dialogue && <div className="canvas-film-segment-line"><span>对白</span>{segment.dialogue}</div>}
                {segment.narration && <div className="canvas-film-segment-line"><span>旁白</span>{segment.narration}</div>}
                {segment.shotPrompt && <div className="canvas-film-segment-line"><span>镜头</span>{segment.shotPrompt}</div>}
                <div className="canvas-film-segment-refs">
                  {segment.sceneAssetId && <Tag color="blue">场景</Tag>}
                  {segment.characterAssetIds?.map((id) => {
                    const c = characterAssets.find((a) => a.id === id)
                    return c ? <Tag key={id} color="orange">{c.title}</Tag> : null
                  })}
                </div>
              </div>
              <div className="canvas-film-segment-actions">
                <Button size="small" type="text" icon={<Icons.Edit size={13} />} onClick={() => setEditingId(segment.id)} />
                <Button size="small" type="text" danger icon={<Icons.Trash size={13} />} onClick={() => void handlers.deleteShotSegment(group.id, segment.id)} />
              </div>
            </div>
          ))}
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
  onClose,
  onSave,
}: {
  mode: 'create' | 'edit'
  segment?: import('./canvasFilmAssets').ShotSegment
  characterAssets: CanvasAsset[]
  sceneAssets: CanvasAsset[]
  onClose: () => void
  onSave: (input: Partial<import('./canvasFilmAssets').ShotSegment> & { title: string }) => Promise<void>
}) {
  const [title, setTitle] = useState(segment?.title ?? '')
  const [description, setDescription] = useState(segment?.description ?? '')
  const [dialogue, setDialogue] = useState(segment?.dialogue ?? '')
  const [narration, setNarration] = useState(segment?.narration ?? '')
  const [shotPrompt, setShotPrompt] = useState(segment?.shotPrompt ?? '')
  const [characterIds, setCharacterIds] = useState<string[]>(segment?.characterAssetIds ?? [])
  const [sceneId, setSceneId] = useState<string | undefined>(segment?.sceneAssetId)

  const toggleCharacter = (id: string) => {
    setCharacterIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const handleSave = async () => {
    if (!title.trim()) {
      message.warning('请输入片段标题')
      return
    }
    await onSave({
      title: title.trim(),
      ...(description ? { description } : {}),
      ...(dialogue ? { dialogue } : {}),
      ...(narration ? { narration } : {}),
      ...(shotPrompt ? { shotPrompt } : {}),
      ...(characterIds.length > 0 ? { characterAssetIds: characterIds } : {}),
      ...(sceneId ? { sceneAssetId: sceneId } : {}),
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
        <label className="canvas-film-editor-field">
          <span>镜头提示词</span>
          <Input.TextArea rows={2} value={shotPrompt} placeholder="景别、运镜、构图等，用于 AI 生成" onChange={(e) => setShotPrompt(e.target.value)} />
        </label>
      </div>
    </div>
  )
}
