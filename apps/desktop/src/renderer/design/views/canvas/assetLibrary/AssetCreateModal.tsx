/**
 * 新建影视资产弹窗（步骤模式设计文档 §5.1，P4 交付）。
 *
 * 三种来源对齐参考形态：
 *  1. AI 生成 —— 建资产后发起 `text_to_image` 任务（`createMediaTask` 的
 *     `filmOutput` 选项），产物由 `applyMediaTaskResult` 的 filmOwner 既有
 *     机制自动挂为资产参考图；进度走画布任务面板，完成后资产库刷新可见。
 *  2. 本地上传 —— `uploadImageAsset` 入项目后，将图片资产作为参考挂到
 *     新建的影视资产上（图片资产是载体，影视资产是聚合概念）。
 *  3. 从画布选择 —— 列出项目内 image 资产，勾选后逐个归类：为其创建
 *     对应 kind 的影视资产并挂引用，原 image 资产保持不动（画布节点不受影响）。
 *
 * 与设定步骤（StepSetupView）和资产库（ProjectAssetLibrary）共用：
 * 两处都以本组件作为「新建资产」入口。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Input, Modal, Spin, Tabs, Upload, message } from 'antd'
import { Button } from '@lobehub/ui'
import type { UploadFile } from 'antd'
import type { CanvasAsset } from '../canvas.types'
import { canvasApi } from '../canvas.api'
import {
  FILM_ASSET_KIND_LABELS,
  filmUid,
  type CreateFilmAssetInput,
  type FilmAssetKind,
} from '../canvasFilmAssets'
import type { FilmReference } from '../canvasFilmTypes'
import { buildFilmAssetReferencePrompt } from '../canvasWorkspaceFilm'
import { buildProductionBiblePrompt } from '../canvasPipeline'
import { CanvasOperationParameterControls } from '../CanvasOperationParameterControls'
import { CanvasTaskValidationError } from '../canvasTaskSubmissionValidation'
import { confirmCanvasTaskValidation } from '../canvasTaskValidationWarning'
import { AssetGrid } from './AssetGrid'
import type { CanvasMediaTaskSubmitter } from './assetCreateTypes'
import {
  useAssetGenerationConfig,
  type AssetGenerationConfigController,
} from './useAssetGenerationConfig'

/** 设定步骤可创建的资产类别（核心四类） */
export type SetupAssetKind = Extract<FilmAssetKind, 'character' | 'scene' | 'prop' | 'effect'>

export const SETUP_ASSET_KINDS: readonly SetupAssetKind[] = ['character', 'scene', 'prop', 'effect']

/** 各类别的结构化属性输入位（kind 感知，与 buildFilmAssetReferencePrompt 消费口径一致） */
const KIND_ATTRIBUTE_FIELDS: Record<
  SetupAssetKind,
  ReadonlyArray<{ key: string; label: string; placeholder: string }>
> = {
  character: [
    { key: '外貌', label: '外貌', placeholder: '例：黑色长发、深棕色眼睛、身形高瘦' },
    { key: '服饰', label: '服饰', placeholder: '例：米色风衣、白衬衫' },
    { key: '性格', label: '性格', placeholder: '例：沉稳内敛、偶尔锋利' },
  ],
  scene: [
    { key: '地点', label: '地点', placeholder: '例：老城巷口、深夜便利店' },
    { key: '时间', label: '时间', placeholder: '例：黄昏 / 雨夜' },
    { key: '光线', label: '光线', placeholder: '例：霓虹逆光、低色温' },
  ],
  prop: [
    { key: '类别', label: '类别', placeholder: '例：随身道具、机械装置' },
    { key: '材质', label: '材质', placeholder: '例：黄铜、旧皮革' },
    { key: '用途', label: '用途', placeholder: '例：关键线索物' },
  ],
  effect: [
    { key: '触发条件', label: '触发条件', placeholder: '例：情绪爆发时显现' },
    { key: '视觉效果', label: '视觉效果', placeholder: '例：蓝色粒子环绕、缓慢消散' },
  ],
}

export type AssetCreateModalProps = {
  open: boolean
  onClose: () => void
  projectId: string
  /** 默认选中的资产类别（进入设定步骤当前 Tab 的类别） */
  defaultKind: SetupAssetKind
  /** 任务落点画板（步骤模式传当前项目活动画板） */
  boardId: string
  /** 项目元数据（制片圣经风格注入生成 prompt） */
  projectMetadata?: Record<string, unknown> | undefined
  /** 建影视资产（store 包装，写后自动刷快照） */
  onCreateFilmAsset: (input: CreateFilmAssetInput) => Promise<CanvasAsset | null>
  /** 上传图片入项目资产库（返回新 image assetId；失败 null） */
  onUploadImageAsset: (file: File) => Promise<string | null>
  /** 发起媒体任务（步骤模式 AI 生成用） */
  onCreateMediaTask: CanvasMediaTaskSubmitter
  /**
   * 生成配置（模型 + 画幅/分辨率等参数）。缺省时弹窗内部自建；
   * 设定步骤传入顶层共享实例，与详情抽屉「生成设定图」保持同一份模型与参数。
   */
  generationController?: AssetGenerationConfigController | undefined
  /** 任一来源完成后的数据刷新回调 */
  onMutated?: (() => void) | undefined
}

type SourceTabKey = 'ai' | 'upload' | 'canvas'

function referenceFrom(assetId: string, order: number, description = ''): FilmReference {
  return { id: filmUid('ref'), kind: 'reference', assetId, description, order }
}

export function AssetCreateModal({
  open,
  onClose,
  projectId,
  defaultKind,
  boardId,
  projectMetadata,
  onCreateFilmAsset,
  onUploadImageAsset,
  onCreateMediaTask,
  generationController,
  onMutated,
}: AssetCreateModalProps) {
  const [activeSource, setActiveSource] = useState<SourceTabKey>('ai')
  const [kind, setKind] = useState<SetupAssetKind>(defaultKind)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [attributes, setAttributes] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  // AI 生成配置（模型 + 参数）：外部注入共享实例，缺省时内部自建
  //（自建仅在 AI Tab 打开时拉取模型，与注入方错开请求）
  const aiTabActive = open && activeSource === 'ai'
  const internalGeneration = useAssetGenerationConfig(
    'text_to_image',
    generationController == null && aiTabActive,
  )
  const generation = generationController ?? internalGeneration

  // 本地上传文件暂存
  const [uploadFiles, setUploadFiles] = useState<File[]>([])
  const [uploadNamePrefix, setUploadNamePrefix] = useState('')

  // 从画布选择：image 资产分页列表 + 勾选
  const [canvasImages, setCanvasImages] = useState<CanvasAsset[]>([])
  const [canvasImagesLoading, setCanvasImagesLoading] = useState(false)
  const [canvasImageTotal, setCanvasImageTotal] = useState(0)
  const [canvasImagePage, setCanvasImagePage] = useState(1)
  const [selectedImageIds, setSelectedImageIds] = useState<ReadonlySet<string>>(new Set())
  const listVersionRef = useRef(0)
  // 「从画布选择」Tab 会话：离开 canvas（切 Tab / 关弹窗 / 切项目）后再进入
  // 视为新会话，从第 1 页干净加载 —— 否则旧页码会以追加模式产生重复卡片
  const canvasSessionRef = useRef<{ projectId: string; active: boolean } | null>(null)

  // AI 生成：资产已创建但发任务失败时记住 id，重试直接复用（避免重复建资产）
  // 已创建资产的完整快照（上次发任务失败重试时复用，避免重复创建；
  // 存完整 CanvasAsset 而非仅 id：prompt 构造需要 title/payload 等字段）
  const createdAssetRef = useRef<CanvasAsset | null>(null)

  // 打开时随入口类别重置（defaultKind 变化即视为新会话）
  useEffect(() => {
    if (open) {
      setKind(defaultKind)
      setName('')
      setDescription('')
      setAttributes({})
      setUploadFiles([])
      setUploadNamePrefix('')
      setSelectedImageIds(new Set())
      setCanvasImages([])
      setCanvasImagePage(1)
      setActiveSource('ai')
      createdAssetRef.current = null
    }
  }, [open, defaultKind])

  // 从画布选择：image 资产分页（未归类图片与已归类图都列出，可再次归类为其他设定）
  useEffect(() => {
    if (!open || activeSource !== 'canvas') return
    // 新会话（首次进入 / 切走再切回 / 切项目）：清空旧列表并回到第 1 页
    const session = canvasSessionRef.current
    const freshSession = session == null || !session.active || session.projectId !== projectId
    canvasSessionRef.current = { projectId, active: true }
    if (freshSession) {
      if (canvasImagePage !== 1) {
        setCanvasImages([])
        setCanvasImagePage(1)
        return
      }
      setCanvasImages([])
    }
    const version = ++listVersionRef.current
    let cancelled = false
    setCanvasImagesLoading(true)
    void canvasApi
      .listAssetsPaged(projectId, { page: canvasImagePage, pageSize: 60, type: 'image' })
      .then((result) => {
        if (cancelled || version !== listVersionRef.current) return
        setCanvasImageTotal(result.total)
        setCanvasImages((current) =>
          canvasImagePage === 1 ? result.items : [...current, ...result.items],
        )
      })
      .catch(() => {
        if (cancelled || version !== listVersionRef.current) return
        setCanvasImages([])
        setCanvasImageTotal(0)
      })
      .finally(() => {
        if (!cancelled) setCanvasImagesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, activeSource, projectId, canvasImagePage])

  // 离开 canvas Tab（切 Tab / 关弹窗）即结束会话，下次进入重新加载
  useEffect(() => {
    if (activeSource !== 'canvas' && canvasSessionRef.current?.active) {
      canvasSessionRef.current = null
    }
  }, [activeSource])

  const resetAndClose = useCallback(() => {
    setSubmitting(false)
    onClose()
  }, [onClose])

  const toggleImageSelect = useCallback((asset: CanvasAsset) => {
    setSelectedImageIds((current) => {
      const next = new Set(current)
      if (next.has(asset.id)) next.delete(asset.id)
      else next.add(asset.id)
      return next
    })
  }, [])

  /** AI 生成：建资产 → 发起 text_to_image 任务（filmOutput 产物自动挂参考图） */
  const submitAiGenerate = useCallback(async () => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      message.warning('请先输入资产名称')
      return
    }
    if (!boardId) {
      message.warning('画板信息缺失，无法发起生成')
      return
    }
    setSubmitting(true)
    try {
      // 已建资产（上次发任务失败）直接复用，避免重试重复创建
      let asset: CanvasAsset | null = createdAssetRef.current
      if (!asset) {
        const cleanedAttributes = Object.fromEntries(
          Object.entries(attributes).filter(([, value]) => value && value.trim()),
        )
        const createdAsset = await onCreateFilmAsset({
          kind,
          name: trimmedName,
          ...(description.trim() ? { text: description.trim() } : {}),
          ...(Object.keys(cleanedAttributes).length > 0 ? { attributes: cleanedAttributes } : {}),
        })
        if (!createdAsset) {
          message.error('资产创建失败')
          return
        }
        createdAssetRef.current = createdAsset
        asset = createdAsset
      }
      const styleBible = buildProductionBiblePrompt(projectMetadata ?? undefined)
      const submitTask = async (skipValidation: boolean) => {
        await onCreateMediaTask(
          {
            boardId,
            operation: 'text_to_image',
            prompt: buildFilmAssetReferencePrompt(asset, styleBible),
            taskTitle: `生成设定图 · ${trimmedName}`,
            outputTitle: trimmedName,
            ...generation.buildSubmitConfig(),
            ...(skipValidation ? { skipParameterValidation: true } : {}),
          },
          { filmOutput: { assetId: asset.id, referenceKind: 'concept' } },
        )
      }
      try {
        await submitTask(false)
      } catch (error) {
        // 参数契约告警：与画布模式一致，弹确认后可带 skipParameterValidation 重提
        if (error instanceof CanvasTaskValidationError) {
          const { confirmed } = await confirmCanvasTaskValidation(error.issues)
          if (!confirmed) return
          try {
            await submitTask(true)
          } catch (retryError) {
            message.error(
              `发起生成失败：${retryError instanceof Error ? retryError.message : String(retryError)}`,
            )
            return
          }
        } else {
          throw error
        }
      }
      generation.rememberPreferences()
      message.success(`已发起「${trimmedName}」设定图生成，完成后自动挂到资产`)
      createdAssetRef.current = null
      onMutated?.()
      resetAndClose()
    } catch (error) {
      message.error(`发起生成失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSubmitting(false)
    }
  }, [
    name,
    boardId,
    kind,
    description,
    attributes,
    onCreateFilmAsset,
    projectMetadata,
    generation,
    onCreateMediaTask,
    onMutated,
    resetAndClose,
  ])

  /** 本地上传：逐文件入项目 → 建对应 kind 的影视资产并挂参考 */
  const submitUpload = useCallback(async () => {
    if (uploadFiles.length === 0) {
      message.warning('请先选择要上传的图片')
      return
    }
    setSubmitting(true)
    try {
      let created = 0
      let failed = 0
      // 只保留失败文件：重试时不会再为已成功文件重复建资产
      const failedFiles: File[] = []
      for (let index = 0; index < uploadFiles.length; index += 1) {
        const file = uploadFiles[index]
        if (!file) continue
        const fallbackName = file.name.replace(/\.[^.]+$/, '') || '未命名'
        const assetName =
          uploadFiles.length === 1
            ? uploadNamePrefix.trim() || fallbackName
            : `${uploadNamePrefix.trim() || FILM_ASSET_KIND_LABELS[kind]} ${index + 1}`
        try {
          const imageAssetId = await onUploadImageAsset(file)
          if (!imageAssetId) throw new Error('图片入库失败')
          await onCreateFilmAsset({
            kind,
            name: assetName,
            references: [referenceFrom(imageAssetId, 0)],
          })
          created += 1
        } catch {
          failed += 1
          failedFiles.push(file)
        }
      }
      if (created > 0) {
        message.success(`已上传并创建 ${created} 个${FILM_ASSET_KIND_LABELS[kind]}资产`)
        onMutated?.()
      }
      if (failed > 0) {
        setUploadFiles(failedFiles)
        message.warning(`${failed} 个文件处理失败，请重试`)
      }
      if (failed === 0) resetAndClose()
    } finally {
      setSubmitting(false)
    }
  }, [
    uploadFiles,
    kind,
    uploadNamePrefix,
    onUploadImageAsset,
    onCreateFilmAsset,
    onMutated,
    resetAndClose,
  ])

  /** 从画布选择：为每个勾选的 image 资产建对应 kind 的影视资产 */
  const submitCanvasSelect = useCallback(async () => {
    if (selectedImageIds.size === 0) {
      message.warning('请先勾选画布上的图片')
      return
    }
    setSubmitting(true)
    try {
      let created = 0
      let failed = 0
      let order = 0
      // 只保留失败勾选：重试时不会再为已成功图片重复归类
      const failedIds: string[] = []
      for (const imageAssetId of selectedImageIds) {
        const source = canvasImages.find((item) => item.id === imageAssetId)
        try {
          await onCreateFilmAsset({
            kind,
            name: source?.title?.trim() || '未命名',
            references: [referenceFrom(imageAssetId, order)],
          })
          created += 1
          order += 1
        } catch {
          failed += 1
          failedIds.push(imageAssetId)
        }
      }
      if (created > 0) {
        message.success(`已归类创建 ${created} 个${FILM_ASSET_KIND_LABELS[kind]}资产`)
        onMutated?.()
      }
      if (failed > 0) {
        setSelectedImageIds(new Set(failedIds))
        message.warning(`${failed} 个资产归类失败，请重试`)
      }
      if (failed === 0) resetAndClose()
    } finally {
      setSubmitting(false)
    }
  }, [selectedImageIds, kind, canvasImages, onCreateFilmAsset, onMutated, resetAndClose])

  const kindPicker = (
    <div className="asset-create-kind-row">
      {SETUP_ASSET_KINDS.map((item) => (
        <button
          key={item}
          type="button"
          className={`asset-create-kind-pill${kind === item ? ' is-active' : ''}`}
          onClick={() => setKind(item)}
        >
          <span className={`asset-library-kind-dot kind-${item}`} />
          {FILM_ASSET_KIND_LABELS[item]}
        </button>
      ))}
    </div>
  )

  const attributeInputs = KIND_ATTRIBUTE_FIELDS[kind].map((field) => (
    <label key={field.key} className="asset-create-field">
      <span className="asset-create-field-label">{field.label}</span>
      <Input
        value={attributes[field.key] ?? ''}
        placeholder={field.placeholder}
        onChange={(event) =>
          setAttributes((current) => ({ ...current, [field.key]: event.target.value }))
        }
      />
    </label>
  ))

  const uploadFileList: UploadFile[] = uploadFiles.map((file, index) => ({
    uid: `local-${index}`,
    name: file.name,
    status: 'done',
    size: file.size,
  }))

  return (
    <Modal
      open={open}
      title={`新建${FILM_ASSET_KIND_LABELS[kind] ?? '资产'}`}
      onCancel={() => {
        if (!submitting) onClose()
      }}
      width={720}
      footer={null}
      destroyOnHidden
      rootClassName="asset-create-modal"
    >
      <div className="asset-create-body">
        <Tabs
          activeKey={activeSource}
          onChange={(key) => setActiveSource(key as SourceTabKey)}
          items={[
            {
              key: 'ai',
              label: 'AI 生成',
              children: (
                <div className="asset-create-form">
                  {kindPicker}
                  <label className="asset-create-field">
                    <span className="asset-create-field-label">名称 *</span>
                    <Input
                      value={name}
                      placeholder={`例如：${kind === 'character' ? '林岸' : kind === 'scene' ? '深夜便利店' : kind === 'prop' ? '黄铜怀表' : '蓝色粒子环绕'}`}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </label>
                  <label className="asset-create-field">
                    <span className="asset-create-field-label">设定描述</span>
                    <Input.TextArea
                      value={description}
                      autoSize={{ minRows: 3, maxRows: 6 }}
                      placeholder="描述将作为生成设定图的核心依据，越具体越稳定"
                      onChange={(event) => setDescription(event.target.value)}
                    />
                  </label>
                  <div className="asset-create-fields-grid">{attributeInputs}</div>
                  <div className="asset-create-field">
                    <span className="asset-create-field-label">生成模型与参数</span>
                    <CanvasOperationParameterControls
                      variant="panel"
                      models={generation.models}
                      modelValue={generation.modelKey}
                      modelLoading={generation.modelLoading}
                      disabled={submitting}
                      showModelPicker
                      allowEmptyModel
                      emptyModelLabel="沿用平台默认模型"
                      fields={generation.fields}
                      values={generation.paramDraft}
                      onModelChange={generation.onModelChange}
                      onParameterChange={generation.onParameterChange}
                    />
                  </div>
                  <div className="asset-create-actions">
                    <Button disabled={submitting} onClick={onClose}>
                      取消
                    </Button>
                    <Button
                      type="primary"
                      loading={submitting}
                      onClick={() => void submitAiGenerate()}
                    >
                      创建并生成设定图
                    </Button>
                  </div>
                </div>
              ),
            },
            {
              key: 'upload',
              label: '本地上传',
              children: (
                <div className="asset-create-form">
                  {kindPicker}
                  <label className="asset-create-field">
                    <span className="asset-create-field-label">
                      名称{uploadFiles.length > 1 ? '前缀' : ''}
                    </span>
                    <Input
                      value={uploadNamePrefix}
                      placeholder={
                        uploadFiles.length > 1
                          ? `多图时自动编号，例「${FILM_ASSET_KIND_LABELS[kind]}」→ ${FILM_ASSET_KIND_LABELS[kind]} 1`
                          : '留空则使用文件名'
                      }
                      onChange={(event) => setUploadNamePrefix(event.target.value)}
                    />
                  </label>
                  <Upload.Dragger
                    multiple
                    accept="image/*"
                    listType="picture"
                    fileList={uploadFileList}
                    beforeUpload={() => false}
                    onChange={(info) => {
                      setUploadFiles(
                        info.fileList.flatMap((item) =>
                          item.originFileObj ? [item.originFileObj] : [],
                        ),
                      )
                    }}
                  >
                    <p className="ant-upload-text">点击或拖拽图片到此处</p>
                    <p className="ant-upload-hint">支持多选；每个文件将创建一个独立资产</p>
                  </Upload.Dragger>
                  <div className="asset-create-actions">
                    <Button disabled={submitting} onClick={onClose}>
                      取消
                    </Button>
                    <Button type="primary" loading={submitting} onClick={() => void submitUpload()}>
                      上传并创建（{uploadFiles.length}）
                    </Button>
                  </div>
                </div>
              ),
            },
            {
              key: 'canvas',
              label: '从画布选择',
              children: (
                <div className="asset-create-form">
                  {kindPicker}
                  <p className="asset-create-hint">
                    勾选项目内已有的图片资产，为其创建{FILM_ASSET_KIND_LABELS[kind]}
                    设定；原图片与画布节点保持不变。
                  </p>
                  <Spin spinning={canvasImagesLoading}>
                    <div className="asset-create-canvas-grid">
                      <AssetGrid
                        items={canvasImages}
                        hasMore={canvasImages.length < canvasImageTotal}
                        onLoadMore={() => setCanvasImagePage((page) => page + 1)}
                        emptyText="画布上暂无图片资产"
                        selectedIds={selectedImageIds}
                        onToggleSelect={toggleImageSelect}
                      />
                    </div>
                  </Spin>
                  <div className="asset-create-actions">
                    <Button disabled={submitting} onClick={onClose}>
                      取消
                    </Button>
                    <Button
                      type="primary"
                      loading={submitting}
                      disabled={selectedImageIds.size === 0}
                      onClick={() => void submitCanvasSelect()}
                    >
                      归类创建（{selectedImageIds.size}）
                    </Button>
                  </div>
                </div>
              ),
            },
          ]}
        />
      </div>
    </Modal>
  )
}
