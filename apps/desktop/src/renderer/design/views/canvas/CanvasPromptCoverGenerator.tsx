import { useEffect, useRef, useState } from 'react'
import { Button, Select, message } from 'antd'
import { Icons } from '../../Icons'
import { canvasApi } from './canvas.api'
import { promptCoverUrlToDataUrl } from './canvasPromptLibraryPackage'
import { resolveMediaDisplayUrl } from './canvas-safe-file'
import type { CanvasMediaModelSummary, CanvasMediaTaskCreateResponse } from '@spark/protocol'

const COVER_CAPABILITY = 'image.generate' as const

/**
 * 提示词详情弹窗内的「生成封面图」区块。
 *
 * 复用画布媒体任务通道（canvas:task:create-media，API key 只在主进程），
 * 以当前编辑中的提示词文案作为生图 prompt，产物落盘后转 data URL 回填封面。
 */
export function CanvasPromptCoverGenerator({
  promptText,
  disabled,
  onGenerated,
}: {
  promptText: string
  disabled?: boolean
  onGenerated: (cover: { url: string; mimeType: string }) => void
}) {
  const [models, setModels] = useState<CanvasMediaModelSummary[] | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  useEffect(() => {
    void canvasApi
      .listMediaModels({ capability: COVER_CAPABILITY, enabledOnly: true })
      .then((response) => {
        if (!aliveRef.current) return
        const usable = response.models.filter(
          (model) =>
            model.enabled &&
            model.capabilities.some((capability) => capability.id === COVER_CAPABILITY),
        )
        setModels(usable)
        setSelectedKey(usable[0] ? modelOptionKey(usable[0]) : null)
      })
      .catch(() => {
        if (!aliveRef.current) return
        setModels([])
      })
  }, [])

  const selectedModel = models?.find((model) => modelOptionKey(model) === selectedKey) ?? null

  const handleGenerate = async () => {
    if (generating || disabled) return
    if (!promptText.trim()) {
      message.warning('请先填写提示词文案，再生成封面')
      return
    }
    if (!selectedModel) {
      message.warning('没有可用的生图模型，请先在渠道设置中配置')
      return
    }
    setGenerating(true)
    try {
      const response: CanvasMediaTaskCreateResponse = await window.spark.invoke(
        'canvas:task:create-media',
        {
          operation: 'text_to_image',
          capabilityId: COVER_CAPABILITY,
          prompt: promptText,
          ...(selectedModel.providerProfileId
            ? { providerProfileId: selectedModel.providerProfileId }
            : {}),
          manifestId: selectedModel.manifestId,
          modelId: selectedModel.effectiveModelId,
          waitForCompletion: true,
        },
      )
      if (!aliveRef.current) return
      if (response.status === 'failed' || response.error) {
        throw new Error(response.error?.message ?? '封面生成失败')
      }
      const asset = response.assets.find((item) => item.type === 'image')
      if (!asset) throw new Error('生成结果中没有图片')
      const displayUrl = resolveMediaDisplayUrl({
        filePath: asset.filePath,
        dataUrl: asset.previewDataUrl,
        url: asset.url,
      })
      if (!displayUrl) throw new Error('生成结果中没有可用的图片地址')
      // 统一转 data URL 再入库，保证封面随提示词库持久保存 / 导出；
      // data:image 原样保留，safe-file 读盘转码，http(s) / 读取失败时回退 previewDataUrl
      const coverUrl = (await promptCoverUrlToDataUrl(displayUrl)) ?? asset.previewDataUrl ?? null
      if (!coverUrl) throw new Error('封面图片读取失败')
      // 弹窗已关闭时不再回写，避免把已置空的 editor 状态重新写回父组件导致弹窗复开
      if (!aliveRef.current) return
      onGenerated({ url: coverUrl, mimeType: asset.mimeType ?? 'image/png' })
      message.success('封面已生成，保存提示词后生效')
    } catch (generateError) {
      if (aliveRef.current) {
        message.error(
          generateError instanceof Error ? generateError.message : '封面生成失败，请稍后重试',
        )
      }
    } finally {
      if (aliveRef.current) setGenerating(false)
    }
  }

  return (
    <div className="canvas-prompt-cover-generator">
      <Select
        size="small"
        className="canvas-prompt-cover-generator-model"
        placeholder={
          models === null
            ? '加载生图模型…'
            : models.length === 0
              ? '暂无可用生图模型'
              : '选择生图模型'
        }
        value={selectedKey}
        loading={models === null}
        disabled={disabled || generating || !models || models.length === 0}
        options={(models ?? []).map((model) => ({
          value: modelOptionKey(model),
          label: model.providerName
            ? `${model.displayName}（${model.providerName}）`
            : model.displayName,
        }))}
        onChange={(key) => setSelectedKey(key)}
      />
      <Button
        size="small"
        className="canvas-prompt-cover-generator-button"
        icon={<Icons.ImagePlus size={13} />}
        loading={generating}
        disabled={disabled || !models || models.length === 0}
        onClick={() => void handleGenerate()}
      >
        {generating ? '生成中…' : '生成封面图'}
      </Button>
    </div>
  )
}

function modelOptionKey(model: CanvasMediaModelSummary): string {
  return `${model.providerProfileId ?? ''}:${model.manifestId}:${model.effectiveModelId}`
}
