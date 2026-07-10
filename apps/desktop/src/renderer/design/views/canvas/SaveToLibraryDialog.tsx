import { useEffect, useMemo, useState } from 'react'
import { Input, Modal, Radio, message } from 'antd'
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

export function SaveToLibraryDialog({
  open,
  onClose,
  node,
  snapshot,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  node: CanvasNode | null
  snapshot: CanvasSnapshot
  onSubmit: (input: CreateFilmAssetInput) => Promise<void>
}) {
  const [kind, setKind] = useState<FilmAssetKind>('character')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const outputAsset = useMemo(() => resolveNodeOutputAsset(node, snapshot), [node, snapshot])

  // 节点变化时重置表单
  useEffect(() => {
    if (!open || !node) return
    setKind(defaultKindForNode(node))
    setName(defaultTitleForNode(node))
    setDescription(guessDescription(node, snapshot))
  }, [open, node, snapshot])

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

  if (!node) return null

  const handleSubmit = async () => {
    if (!name.trim()) {
      message.warning('请输入资源名称')
      return
    }
    setSubmitting(true)
    try {
      await onSubmit({
        kind,
        name: name.trim(),
        ...(description ? { text: description } : {}),
        ...(prefilledRefs.length > 0 ? { references: prefilledRefs } : {}),
        // 默认 prompt：task 节点的 prompt 文本
        ...(node.data?.prompt && (kind === 'prompt_library' || kind === 'character' || kind === 'scene' || kind === 'prop' || kind === 'effect')
          ? { prompt: node.data.prompt }
          : {}),
      })
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
          <Icons.Folder size={15} />
          保存到项目资源库
        </span>
      }
      width={520}
      destroyOnHidden
      footer={[
        <Button key="cancel" onClick={onClose} disabled={submitting}>
          取消
        </Button>,
        <Button key="submit" type="primary" loading={submitting} onClick={() => void handleSubmit()}>
          保存
        </Button>,
      ]}
    >
      <div className="canvas-film-save-dialog">
        <div className="canvas-film-save-preview">
          <NodePreview node={node} linkedAsset={outputAsset ?? undefined} />
        </div>

        <div className="canvas-film-save-field">
          <span>资源类型</span>
          <Radio.Group
            value={kind}
            onChange={(e) => setKind(e.target.value as FilmAssetKind)}
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

        <label className="canvas-film-save-field">
          <span>名称</span>
          <Input
            value={name}
            placeholder={`${FILM_ASSET_KIND_LABELS[kind]}名称`}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>

        {kind !== 'prompt_library' && (
          <label className="canvas-film-save-field">
            <span>整体描述</span>
            <Input.TextArea
              rows={3}
              value={description}
              placeholder="整体描述 / 设定（可留空）"
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
        )}

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
      </div>
    </Modal>
  )
}

function guessDescription(node: CanvasNode, snapshot: CanvasSnapshot): string {
  if (typeof node.data?.text === 'string' && node.data.text.trim()) return node.data.text
  if (typeof node.data?.prompt === 'string' && node.data.prompt.trim()) return node.data.prompt
  const linked = resolveNodeOutputAsset(node, snapshot)
  if (linked?.contentText) return linked.contentText
  return ''
}

function resolveNodeOutputAsset(node: CanvasNode | null, snapshot: CanvasSnapshot): CanvasAsset | null {
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

function NodePreview({ node, linkedAsset }: { node: CanvasNode; linkedAsset: CanvasAsset | undefined }) {
  const label = node.title ?? node.type
  return (
    <div className="canvas-film-save-node-preview">
      {linkedAsset && (linkedAsset.type === 'image' || linkedAsset.url) ? (
        <div className="canvas-film-save-node-thumb">
          <AssetThumbnail asset={linkedAsset} />
        </div>
      ) : (
        <div className="canvas-film-save-node-thumb canvas-film-save-node-thumb-fallback">
          <Icons.File size={20} />
        </div>
      )}
      <div className="canvas-film-save-node-meta">
        <div className="canvas-film-save-node-title" title={label}>
          {label}
        </div>
        <div className="canvas-film-save-node-type">
          来源节点：{node.type}
          {node.data?.operation ? ` · ${node.data.operation}` : ''}
        </div>
      </div>
    </div>
  )
}
