import { useEffect, useMemo, useRef, useState } from 'react'
import { Empty, Input, Modal, Radio, Select, message } from 'antd'
import { Button } from '@lobehub/ui'
import { Icons } from '../../Icons'
import { AssetThumbnail } from './CanvasAssetThumbnail'
import {
  FILM_ASSET_KIND_LABELS,
  filmUid,
  type CreateFilmAssetInput,
  type FilmAssetKind,
} from './canvasFilmAssets'
import type { FilmReference, FilmReferenceKind } from './canvasFilmTypes'
import type { CanvasAsset, CanvasNode, CanvasSnapshot } from './canvas.types'
import { readLastPromptCategory, saveLastPromptCategory } from './canvasPromptLibraryCategories'
import { encodeToSafeFileUrl, readFileAsDataUrl } from './canvas-safe-file'
import { isPromptCoverAsset, isPromptCoverNode } from './canvasPromptLibraryCover'
import { isPromptTextNode, readPromptLibraryText } from './canvasPromptLibraryData'

/**
 * 画布节点 → 项目资源库 弹窗（文档 §7.10 升级）。
 *
 * 触发：节点右键菜单「保存到资源库」。
 * 行为：
 *   - 选 kind（character/scene/prop/effect/prompt_library）
 *   - 输入名称（默认从节点 title 推断）
 *   - 预填：image 节点 → 一张 concept reference；text/prompt 节点 → contentText；
 *          task 节点 → prompt + contentText
 *   - 提交：调 onSubmit，父级串 createFilmAsset
 */

const KINDS_FOR_NODE: FilmAssetKind[] = ['character', 'scene', 'prop', 'effect', 'prompt_library']

function defaultKindForNode(node: CanvasNode): FilmAssetKind {
  // 文本类节点默认归入 prompt_library
  if (node.type === 'text' || node.type === 'prompt') return 'prompt_library'
  // 任务与产物合一后，操作类型不再固定挂在旧 task 节点上。
  const op = node.data?.operation
  if (op) {
    if (op === 'image_to_image' || op === 'image_edit') return 'prop'
    if (
      op === 'image_to_video' ||
      op === 'text_to_video' ||
      op === 'video_edit' ||
      op === 'video_extend'
    )
      return 'scene'
    if (op === 'text_generate' || op === 'text_rewrite' || op === 'prompt_optimize')
      return 'prompt_library'
    if (op === 'text_to_audio' || op === 'audio_transcribe') return 'prop'
  }
  // 视频/音频节点默认 prop
  if (node.type === 'video' || node.type === 'audio') return 'prop'
  // 图片节点默认 character
  return 'character'
}

function defaultReferenceKindForNode(node: CanvasNode): FilmReferenceKind {
  if (node.type === 'video') return 'storyboard'
  if (node.type === 'audio') return 'reference'
  return 'concept'
}

function defaultTitleForNode(node: CanvasNode): string {
  if (node.title && node.title !== 'AI task' && node.title !== 'Text note') return node.title
  return ''
}

function assetPreviewUrl(asset: CanvasAsset | null | undefined): string | null {
  return asset?.thumbnailUrl ?? asset?.url ?? null
}

export function SaveToLibraryDialog({
  open,
  onClose,
  node,
  promptOnly = false,
  snapshot,
  categories,
  onCreateCategory,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  node: CanvasNode | null
  promptOnly?: boolean
  snapshot: CanvasSnapshot
  categories: string[]
  onCreateCategory: (name: string) => Promise<string | null>
  onSubmit: (input: CreateFilmAssetInput) => Promise<void>
}) {
  const [kind, setKind] = useState<FilmAssetKind>('prompt_library')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [newCategoryOpen, setNewCategoryOpen] = useState(false)
  const [newCategory, setNewCategory] = useState('')
  const [coverPickerOpen, setCoverPickerOpen] = useState(false)
  const [coverAssetId, setCoverAssetId] = useState<string | null>(null)
  const [coverUrl, setCoverUrl] = useState<string | null>(null)
  const [coverMimeType, setCoverMimeType] = useState<string | null>(null)
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null)
  const [textPickerOpen, setTextPickerOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const coverFileInputRef = useRef<HTMLInputElement | null>(null)
  const outputAsset = useMemo(() => resolveNodeOutputAsset(node, snapshot), [node, snapshot])
  const imageCoverNodes = useMemo(() => {
    const filtered = snapshot.nodes.filter((candidate) => {
      return isPromptCoverNode(candidate, resolveNodeOutputAsset(candidate, snapshot))
    })
    // 从画布选择封面：按更新时间从新到旧排序，缺 updatedAt 的兜底为 0
    return filtered.slice().sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
  }, [snapshot])

  // 节点变化时重置表单
  useEffect(() => {
    if (!open || (!node && !promptOnly)) return
    setKind(promptOnly ? 'prompt_library' : node ? defaultKindForNode(node) : 'prompt_library')
    setName(node ? defaultTitleForNode(node) : '')
    setDescription(node ? guessDescription(node, snapshot) : '')
    const lastCategory = readLastPromptCategory()
    setCategory(
      lastCategory && categories.includes(lastCategory) ? lastCategory : (categories[0] ?? ''),
    )
    setNewCategoryOpen(false)
    setNewCategory('')
    // 图片任务节点本身不是 `image` 类型，但它的主产物仍然可以作为提示词封面。
    const defaultCover = isPromptCoverAsset(outputAsset) ? outputAsset : null
    setCoverAssetId(defaultCover?.id ?? null)
    setCoverUrl(assetPreviewUrl(defaultCover))
    setCoverMimeType(null)
    setCoverFile(null)
    setCoverPreviewUrl(null)
    setCoverPickerOpen(false)
    setTextPickerOpen(false)
  }, [open, node?.id, promptOnly])

  useEffect(
    () => () => {
      if (coverPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(coverPreviewUrl)
    },
    [coverPreviewUrl],
  )

  // 预填的 references（仅显示，不让编辑）
  const prefilledRefs = useMemo<FilmReference[]>(() => {
    if (!node) return []
    const linkedAsset = outputAsset
    if (linkedAsset && (linkedAsset.type === 'image' || linkedAsset.url)) {
      return [
        {
          id: filmUid('ref'),
          kind: defaultReferenceKindForNode(node),
          assetId: linkedAsset.id,
          description: '',
          order: 0,
        },
      ]
    }
    return []
  }, [node, outputAsset])

  if (!node && !promptOnly) return null

  const handleCreateCategory = async () => {
    try {
      const created = await onCreateCategory(newCategory)
      if (!created) return
      setCategory(created)
      setNewCategory('')
      setNewCategoryOpen(false)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '创建分类失败')
    }
  }

  const handleCoverFile = (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      message.warning('请选择图片文件')
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      message.warning('封面图片请控制在 8MB 以内')
      return
    }
    setCoverFile(file)
    setCoverAssetId(null)
    setCoverUrl(null)
    setCoverMimeType(file.type)
    setCoverPreviewUrl(URL.createObjectURL(file))
  }

  const handlePickCover = (candidate: CanvasNode) => {
    const asset = resolveNodeOutputAsset(candidate, snapshot)
    if (!isPromptCoverNode(candidate, asset)) return
    setCoverAssetId(asset.id)
    setCoverUrl(assetPreviewUrl(asset))
    setCoverMimeType(null)
    setCoverFile(null)
    setCoverPreviewUrl(null)
    setCoverPickerOpen(false)
  }

  const handleSubmit = async () => {
    // 快捷提示词新建模式下允许名称为空（默认 "-"）；保存到资源库时名称仍必填
    if (!promptOnly && !name.trim()) {
      message.warning('请输入资源名称')
      return
    }
    if (kind === 'prompt_library' && !category.trim()) {
      message.warning('请选择分类')
      return
    }
    if (kind === 'prompt_library' && !description.trim()) {
      message.warning('请输入提示词文案')
      return
    }
    setSubmitting(true)
    try {
      let uploadedCoverUrl: string | null = null
      let uploadedCoverMimeType: string | null = null
      if (kind === 'prompt_library' && coverFile) {
        const dataUrl = await readFileAsDataUrl(coverFile)
        const written = await window.spark.invoke('canvas:asset:write-data-url', {
          projectId: snapshot.project.id,
          projectRootPath: snapshot.project.rootPath ?? null,
          dataUrl,
          mimeType: coverFile.type,
          suggestedBaseName: 'prompt-cover',
          type: 'image',
        })
        uploadedCoverUrl = encodeToSafeFileUrl(written.filePath)
        uploadedCoverMimeType = coverFile.type
      }
      const promptAttributes =
        kind === 'prompt_library'
          ? {
              promptCategory: category.trim(),
              ...(coverAssetId ? { coverAssetId } : {}),
              ...((uploadedCoverUrl ?? (!coverAssetId ? coverUrl : null))
                ? {
                    coverUrl: uploadedCoverUrl ?? coverUrl ?? '',
                    coverMimeType: uploadedCoverMimeType ?? coverMimeType ?? '',
                  }
                : {}),
            }
          : undefined
      await onSubmit({
        kind,
        name: name.trim() || (promptOnly ? '-' : ''),
        ...(description.trim() ? { text: description.trim() } : {}),
        ...(prefilledRefs.length > 0 ? { references: prefilledRefs } : {}),
        ...(kind === 'prompt_library'
          ? {
              prompt: description.trim(),
              ...(promptAttributes ? { attributes: promptAttributes } : {}),
            }
          : node?.data?.prompt &&
              (kind === 'character' || kind === 'scene' || kind === 'prop' || kind === 'effect')
            ? { prompt: node.data.prompt }
            : {}),
      })
      if (kind === 'prompt_library') saveLastPromptCategory(category)
      message.success('已保存到项目资源库')
      onClose()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <span className="canvas-film-save-dialog-title">
          {promptOnly ? <Icons.Edit size={15} /> : <Icons.Folder size={15} />}
          {promptOnly ? '新建提示词' : '保存到项目资源库'}
        </span>
      }
      width={520}
      destroyOnHidden
      footer={[
        <Button key="cancel" onClick={onClose} disabled={submitting}>
          取消
        </Button>,
        <Button
          key="submit"
          type="primary"
          loading={submitting}
          onClick={() => void handleSubmit()}
        >
          保存
        </Button>,
      ]}
    >
      <div className="canvas-film-save-dialog">
        {!promptOnly && (
          <div className="canvas-film-save-field">
            <span>资源类型</span>
            <Radio.Group
              value={kind}
              onChange={(e) => {
                const nextKind = e.target.value as FilmAssetKind
                setKind(nextKind)
                if (nextKind === 'prompt_library' && !category) {
                  setCategory(categories[0] ?? '')
                }
                if (nextKind === 'prompt_library' && !coverAssetId && !coverFile) {
                  const defaultCover = isPromptCoverAsset(outputAsset) ? outputAsset : null
                  setCoverAssetId(defaultCover?.id ?? null)
                  setCoverUrl(assetPreviewUrl(defaultCover))
                  setCoverMimeType(null)
                }
              }}
              optionType="button"
              buttonStyle="solid"
              size="middle"
            >
              {KINDS_FOR_NODE.map((k) => (
                <Radio.Button key={k} value={k}>
                  {FILM_ASSET_KIND_LABELS[k]}
                </Radio.Button>
              ))}
            </Radio.Group>
          </div>
        )}

        <label className="canvas-film-save-field">
          <span>名称</span>
          <Input
            value={name}
            placeholder={`${FILM_ASSET_KIND_LABELS[kind]}名称`}
            onChange={(e) => setName(e.target.value)}
            onPressEnter={() => void handleSubmit()}
            autoFocus
          />
        </label>

        {kind === 'prompt_library' && (
          <div className="canvas-film-save-field">
            <span className="canvas-film-save-field-label-row">
              <span>分类</span>
              <button
                type="button"
                className="canvas-film-save-inline-action"
                onClick={() => setNewCategoryOpen((current) => !current)}
              >
                + 新分类
              </button>
            </span>
            <Select
              value={category || undefined}
              placeholder="选择分类"
              options={categories.map((item) => ({ label: item, value: item }))}
              onChange={(value) => setCategory(value ?? '')}
            />
            {newCategoryOpen && (
              <div className="canvas-film-save-inline-category">
                <Input
                  size="middle"
                  autoFocus
                  value={newCategory}
                  placeholder="新分类名称"
                  onChange={(event) => setNewCategory(event.target.value)}
                  onPressEnter={() => void handleCreateCategory()}
                />
                <Button size="middle" type="primary" onClick={() => void handleCreateCategory()}>
                  添加
                </Button>
              </div>
            )}
          </div>
        )}

        {kind === 'prompt_library' && (
          <div className="canvas-film-save-field">
            <span>封面</span>
            <button
              type="button"
              className="canvas-film-save-cover-picker"
              onClick={() => coverFileInputRef.current?.click()}
            >
              {(coverPreviewUrl ?? coverUrl) ? (
                <img src={coverPreviewUrl ?? coverUrl ?? ''} alt="提示词封面" />
              ) : (
                <span className="canvas-film-save-cover-empty">
                  <Icons.ImagePlus size={20} />
                  <span>上传封面图</span>
                </span>
              )}
              <span className="canvas-film-save-cover-actions">
                <span
                  onClick={(event) => {
                    event.stopPropagation()
                    coverFileInputRef.current?.click()
                  }}
                >
                  上传
                </span>
                <span
                  onClick={(event) => {
                    event.stopPropagation()
                    setCoverPickerOpen(true)
                  }}
                >
                  画布选择
                </span>
              </span>
            </button>
            <input
              ref={coverFileInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                handleCoverFile(event.target.files?.[0])
                event.currentTarget.value = ''
              }}
            />
          </div>
        )}

        <label className="canvas-film-save-field">
          <span className="canvas-film-save-field-label-row">
            <span>{kind === 'prompt_library' ? '提示词文案' : '整体描述'}</span>
            {kind === 'prompt_library' && (
              <button
                type="button"
                className="canvas-film-save-inline-action"
                onClick={() => setTextPickerOpen(true)}
              >
                从画布选择
              </button>
            )}
          </span>
          <Input.TextArea
            rows={kind === 'prompt_library' ? 5 : 3}
            value={description}
            placeholder={kind === 'prompt_library' ? '输入提示词文案' : '整体描述 / 设定（可留空）'}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        {prefilledRefs.length > 0 && (
          <div className="canvas-film-save-field">
            <span>将添加 {prefilledRefs.length} 张参考图</span>
            <div className="canvas-film-save-reflist">
              {prefilledRefs.map((ref) => {
                const linked = snapshot.assets.find((a) => a.id === ref.assetId)
                return (
                  <div key={ref.id} className="canvas-film-save-refchip">
                    {linked ? <AssetThumbnail asset={linked} /> : null}
                    <span>{linked?.title ?? '已选图片'}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
        <PromptCoverPickerModal
          open={coverPickerOpen}
          candidates={imageCoverNodes}
          snapshot={snapshot}
          onClose={() => setCoverPickerOpen(false)}
          onPick={handlePickCover}
        />
        <PromptTextPickerModal
          open={textPickerOpen}
          snapshot={snapshot}
          onClose={() => setTextPickerOpen(false)}
          onPick={(text) => {
            setDescription(text)
            setTextPickerOpen(false)
          }}
        />
      </div>
    </Modal>
  )
}

function PromptTextPickerModal({
  open,
  snapshot,
  onClose,
  onPick,
}: {
  open: boolean
  snapshot: CanvasSnapshot
  onClose: () => void
  onPick: (text: string) => void
}) {
  const candidates = snapshot.nodes
    .filter(isPromptTextNode)
    .map((candidate) => {
      const nodeText = [candidate.data?.text, candidate.data?.prompt].find(
        (value): value is string => typeof value === 'string' && value.trim().length > 0,
      )
      const linkedAsset = candidate.assetId
        ? snapshot.assets.find((asset) => asset.id === candidate.assetId)
        : null
      return {
        node: candidate,
        text: nodeText?.trim() ?? (linkedAsset ? readPromptLibraryText(linkedAsset) : ''),
      }
    })
    .filter((candidate) => candidate.text)

  return (
    <Modal open={open} title="从画布选择提示词" onCancel={onClose} footer={null} width={620}>
      <div className="canvas-prompt-text-source-list">
        {candidates.length === 0 ? (
          <Empty description="画布上还没有文本节点" />
        ) : (
          candidates.map(({ node, text }) => (
            <button key={node.id} type="button" onClick={() => onPick(text)}>
              <span>{node.title ?? node.type}</span>
              <small>{text}</small>
            </button>
          ))
        )}
      </div>
    </Modal>
  )
}

function PromptCoverPickerModal({
  open,
  candidates,
  snapshot,
  onClose,
  onPick,
}: {
  open: boolean
  candidates: CanvasNode[]
  snapshot: CanvasSnapshot
  onClose: () => void
  onPick: (node: CanvasNode) => void
}) {
  return (
    <Modal open={open} title="从画布选择封面" onCancel={onClose} footer={null} width={560}>
      <div className="canvas-film-save-cover-grid">
        {candidates.length === 0 ? (
          <Empty description="画布上还没有图片节点" />
        ) : (
          candidates.map((candidate) => {
            const asset = resolveNodeOutputAsset(candidate, snapshot)
            if (!isPromptCoverNode(candidate, asset)) return null
            return (
              <button
                key={candidate.id}
                type="button"
                className="canvas-film-save-cover-card"
                onClick={() => onPick(candidate)}
              >
                <AssetThumbnail asset={asset} />
                <span>{candidate.title ?? asset.title ?? '未命名图片'}</span>
              </button>
            )
          })
        )}
      </div>
    </Modal>
  )
}

function guessDescription(node: CanvasNode, snapshot: CanvasSnapshot): string {
  if (typeof node.data?.text === 'string' && node.data.text.trim()) return node.data.text
  if (typeof node.data?.prompt === 'string' && node.data.prompt.trim()) return node.data.prompt
  const linked = resolveNodeOutputAsset(node, snapshot)
  if (linked) return readPromptLibraryText(linked)
  return ''
}

function resolveNodeOutputAsset(
  node: CanvasNode | null,
  snapshot: CanvasSnapshot,
): CanvasAsset | null {
  if (!node) return null
  if (node.assetId) return snapshot.assets.find((asset) => asset.id === node.assetId) ?? null
  if (!node.taskId) return null
  const task = snapshot.tasks.find((item) => item.id === node.taskId)
  if (!task) return null

  const primaryOutputId = node.data?.primaryOutputId
  if (primaryOutputId) {
    const primaryAsset = snapshot.assets.find((asset) => asset.id === primaryOutputId)
    if (primaryAsset) return primaryAsset
    const primaryNode = snapshot.nodes.find((item) => item.id === primaryOutputId)
    if (primaryNode?.assetId) {
      return snapshot.assets.find((asset) => asset.id === primaryNode.assetId) ?? null
    }
  }

  const outputNode = task.outputNodeIds
    .map((nodeId) => snapshot.nodes.find((item) => item.id === nodeId))
    .find((item) => Boolean(item?.assetId))
  if (outputNode?.assetId) {
    return snapshot.assets.find((asset) => asset.id === outputNode.assetId) ?? null
  }

  const outputAssetId = task.outputAssetIds[0]
  return outputAssetId
    ? (snapshot.assets.find((asset) => asset.id === outputAssetId) ?? null)
    : null
}
