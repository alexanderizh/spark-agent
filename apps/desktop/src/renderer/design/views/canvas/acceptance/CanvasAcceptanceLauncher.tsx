import { useEffect, useMemo, useState } from 'react'
import { Alert, Checkbox, Divider, Modal, Select, Space, Tag, Typography, message } from 'antd'
import { Button } from '@lobehub/ui'
import type { CanvasMediaModelSummary, ProviderProfile } from '@spark/protocol'

import { Icons } from '../../../Icons'
import { canvasApi, saveCanvas } from '../canvas.api'
import { mediaModelKey } from '../canvasModelPickerModel'
import { CanvasAcceptanceMatrixSelector } from './CanvasAcceptanceMatrixSelector'
import { compileCanvasAcceptancePlan } from './canvasAcceptancePlan'
import { materializeCanvasAcceptanceRun } from './canvasAcceptanceProject'
import type {
  CanvasAcceptanceSelection,
  CanvasAcceptanceStageId,
  CanvasAcceptanceSuite,
  CanvasAcceptanceTargetKind,
} from './canvasAcceptanceTypes'
import {
  buildMediaTarget,
  buildMediaTargets,
  buildTextTarget,
  buildTextTargets,
  firstModelKey,
  modelMatchesKind,
} from './canvasAcceptanceTargetModel'
import {
  CANVAS_ACCEPTANCE_DEFAULT_STAGE_IDS,
  CANVAS_ACCEPTANCE_STAGE_LABELS,
  buildCanvasAcceptanceWorkflowBlueprint,
} from './canvasAcceptanceWorkflow'
import './CanvasAcceptanceLauncher.less'

const { Text } = Typography
const MAX_ACCEPTANCE_CALLS = 60

type CanvasAcceptanceLauncherProps = {
  onReady: (projectId: string) => void | Promise<void>
}

export function CanvasAcceptanceLauncher({ onReady }: CanvasAcceptanceLauncherProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [building, setBuilding] = useState(false)
  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [mediaModels, setMediaModels] = useState<CanvasMediaModelSummary[]>([])
  const [suite, setSuite] = useState<CanvasAcceptanceSuite>('workflow_smoke')
  const [stageIds, setStageIds] = useState<CanvasAcceptanceStageId[]>(
    CANVAS_ACCEPTANCE_DEFAULT_STAGE_IDS,
  )
  const [textProviderId, setTextProviderId] = useState('')
  const [textModelId, setTextModelId] = useState('')
  const [imageModelKey, setImageModelKey] = useState('')
  const [videoModelKey, setVideoModelKey] = useState('')
  const [audioModelKey, setAudioModelKey] = useState('')
  const [matrixCaseIds, setMatrixCaseIds] = useState<string[]>([
    'W2-CHARACTERS',
    'W5-CHARACTER-IMAGE',
    'W8-VIDEO-CLIP',
  ])
  const [matrixTextKeys, setMatrixTextKeys] = useState<string[]>([])
  const [matrixImageKeys, setMatrixImageKeys] = useState<string[]>([])
  const [matrixVideoKeys, setMatrixVideoKeys] = useState<string[]>([])
  const [matrixAudioKeys, setMatrixAudioKeys] = useState<string[]>([])
  const [verifyReload, setVerifyReload] = useState(true)
  const [verifyPreview, setVerifyPreview] = useState(true)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void Promise.all([
      window.spark.invoke('provider:list', {}),
      canvasApi.listMediaModels({ enabledOnly: true }),
    ])
      .then(([providerResponse, mediaResponse]) => {
        if (cancelled) return
        const nextProviders = providerResponse.profiles
        const nextModels = mediaResponse.models
        setProviders(nextProviders)
        setMediaModels(nextModels)
        const preferredText =
          nextProviders.find((provider) => provider.isDefault && provider.modelIds.length > 0) ??
          nextProviders.find((provider) => provider.modelIds.length > 0)
        if (preferredText) {
          setTextProviderId((current) => current || preferredText.id)
          setTextModelId(
            (current) => current || preferredText.defaultModel || preferredText.modelIds[0] || '',
          )
        }
        setImageModelKey((current) => current || firstModelKey(nextModels, 'image'))
        setVideoModelKey((current) => current || firstModelKey(nextModels, 'video'))
        setAudioModelKey((current) => current || firstModelKey(nextModels, 'audio'))
      })
      .catch((error) => {
        if (!cancelled) message.error(error instanceof Error ? error.message : '读取模型配置失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const selectedTextProvider = providers.find((provider) => provider.id === textProviderId)
  const textModels = selectedTextProvider
    ? Array.from(
        new Set(
          [selectedTextProvider.defaultModel, ...selectedTextProvider.modelIds].filter(Boolean),
        ),
      )
    : []
  const selection = useMemo<CanvasAcceptanceSelection>(() => {
    const textTarget = buildTextTarget(selectedTextProvider, textModelId)
    const imageTarget = buildMediaTarget('image', mediaModels, imageModelKey)
    const videoTarget = buildMediaTarget('video', mediaModels, videoModelKey)
    const audioTarget = buildMediaTarget('audio', mediaModels, audioModelKey)
    const textTargets = buildTextTargets(providers, matrixTextKeys)
    const imageTargets = buildMediaTargets('image', mediaModels, matrixImageKeys)
    const videoTargets = buildMediaTargets('video', mediaModels, matrixVideoKeys)
    const audioTargets = buildMediaTargets('audio', mediaModels, matrixAudioKeys)
    return {
      suite,
      stageIds,
      ...(suite !== 'workflow_smoke' ? { matrixCaseIds } : {}),
      ...(textTarget ? { textTarget } : {}),
      ...(imageTarget ? { imageTarget } : {}),
      ...(videoTarget ? { videoTarget } : {}),
      ...(audioTarget ? { audioTarget } : {}),
      ...(textTargets.length > 0 ? { textTargets } : {}),
      ...(imageTargets.length > 0 ? { imageTargets } : {}),
      ...(videoTargets.length > 0 ? { videoTargets } : {}),
      ...(audioTargets.length > 0 ? { audioTargets } : {}),
      verifyReload,
      verifyPreview,
    }
  }, [audioModelKey, imageModelKey, matrixAudioKeys, matrixCaseIds, matrixImageKeys, matrixTextKeys, matrixVideoKeys, mediaModels, providers, selectedTextProvider, stageIds, suite, textModelId, verifyPreview, verifyReload, videoModelKey])
  const previewPlan = useMemo(() => {
    const blueprint = buildCanvasAcceptanceWorkflowBlueprint(selection)
    return compileCanvasAcceptancePlan({
      selection,
      blueprint,
      now: () => new Date(0),
      randomId: () => 'preview',
    })
  }, [selection])
  const effectiveStageIds = previewPlan.selectedStageIds
  const exceedsCallLimit = previewPlan.cases.length > MAX_ACCEPTANCE_CALLS

  const handleBuild = async () => {
    if (stageIds.length === 0) {
      message.warning('请至少选择一个验收阶段')
      return
    }
    if (exceedsCallLimit) {
      message.error(`验收计划超过 ${MAX_ACCEPTANCE_CALLS} 次调用安全上限`)
      return
    }
    setBuilding(true)
    try {
      const result = await materializeCanvasAcceptanceRun({
        api: canvasApi,
        selection,
        persist: saveCanvas,
      })
      setOpen(false)
      message.success(
        `已生成 ${result.plan.cases.length} 个真实任务节点；不会自动调用模型，请进入画布检查后手动运行。`,
      )
      await onReady(result.projectId)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '生成验收画布失败')
    } finally {
      setBuilding(false)
    }
  }

  return (
    <>
      <Button
        size="medium"
        type="text"
        icon={<Icons.Beaker size={15} />}
        onClick={() => {
          setLoading(true)
          setOpen(true)
        }}
      >
        验收实验室
      </Button>
      <Modal
        className="canvas-acceptance-launcher"
        width={860}
        title="无限画布真实工作流验收"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void handleBuild()}
        okText="生成验收画布"
        cancelText="取消"
        confirmLoading={building}
        okButtonProps={{ disabled: loading || stageIds.length === 0 || exceedsCallLimit }}
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          message="这里只生成真实生产节点和调用前计划，不会自动调用任何模型。"
          description="进入画布后检查每个节点的渠道、模型、参数和预检阻断，再手动运行；每次运行将沿用现有画布任务和 Provider 真实链路。"
        />

        <section className="canvas-acceptance-section">
          <div className="canvas-acceptance-section-title">验收模式</div>
          <Select<CanvasAcceptanceSuite>
            value={suite}
            options={[
              { label: 'Workflow Smoke · 单主模型完整工作流', value: 'workflow_smoke' },
              { label: 'Model Matrix · 关键节点横向模型对比', value: 'model_matrix' },
              { label: 'Full Acceptance · 完整工作流 + 模型矩阵', value: 'full_acceptance' },
              { label: 'Custom · 自定义阶段', value: 'custom' },
            ]}
            onChange={setSuite}
          />
        </section>

        <section className="canvas-acceptance-section">
          <div className="canvas-acceptance-section-title">工作流阶段</div>
          <Checkbox.Group
            className="canvas-acceptance-stage-grid"
            value={stageIds}
            options={(Object.keys(CANVAS_ACCEPTANCE_STAGE_LABELS) as CanvasAcceptanceStageId[]).map(
              (stageId) => ({ label: CANVAS_ACCEPTANCE_STAGE_LABELS[stageId], value: stageId }),
            )}
            onChange={(values) => setStageIds(values as CanvasAcceptanceStageId[])}
          />
          {effectiveStageIds.length !== stageIds.length && (
            <Text type="secondary">
              为保持真实链路，系统会自动补齐上游依赖：{effectiveStageIds.join(' → ')}
            </Text>
          )}
        </section>

        <Divider />

        <section className="canvas-acceptance-section">
          <div className="canvas-acceptance-section-title">文本渠道与模型</div>
          <div className="canvas-acceptance-runtime-row">
            <Select<string>
              loading={loading}
              value={textProviderId || null}
              placeholder="选择文本 Provider"
              options={providers
                .filter((provider) => provider.modelIds.length > 0 || provider.defaultModel)
                .map((provider) => ({ label: provider.name, value: provider.id }))}
              onChange={(providerId) => {
                const provider = providers.find((item) => item.id === providerId)
                setTextProviderId(providerId)
                setTextModelId(provider?.defaultModel || provider?.modelIds[0] || '')
              }}
            />
            <Select<string>
              loading={loading}
              value={textModelId || null}
              placeholder="选择文本模型"
              options={textModels.map((modelId) => ({ label: modelId, value: modelId }))}
              onChange={setTextModelId}
            />
          </div>
        </section>

        <section className="canvas-acceptance-section">
          <div className="canvas-acceptance-section-title">多媒体模型</div>
          <div className="canvas-acceptance-runtime-row canvas-acceptance-runtime-row-three">
            <ModelSelect
              label="图片模型"
              kind="image"
              loading={loading}
              models={mediaModels}
              value={imageModelKey}
              onChange={setImageModelKey}
            />
            <ModelSelect
              label="视频模型"
              kind="video"
              loading={loading}
              models={mediaModels}
              value={videoModelKey}
              onChange={setVideoModelKey}
            />
            <ModelSelect
              label="音频模型"
              kind="audio"
              loading={loading}
              models={mediaModels}
              value={audioModelKey}
              onChange={setAudioModelKey}
            />
          </div>
        </section>

        {(suite === 'model_matrix' || suite === 'full_acceptance') && (
          <CanvasAcceptanceMatrixSelector
            providers={providers}
            mediaModels={mediaModels}
            loading={loading}
            textKeys={matrixTextKeys}
            imageKeys={matrixImageKeys}
            videoKeys={matrixVideoKeys}
            audioKeys={matrixAudioKeys}
            caseIds={matrixCaseIds}
            onTextKeysChange={setMatrixTextKeys}
            onImageKeysChange={setMatrixImageKeys}
            onVideoKeysChange={setMatrixVideoKeys}
            onAudioKeysChange={setMatrixAudioKeys}
            onCaseIdsChange={setMatrixCaseIds}
          />
        )}

        <Divider />

        <section className="canvas-acceptance-section">
          <div className="canvas-acceptance-section-title">调用前计划</div>
          <Space wrap>
            <Tag color="blue">{previewPlan.cases.length} 个真实任务节点</Tag>
            <Tag color="green">{previewPlan.executableCaseCount} 个可执行</Tag>
            <Tag color={previewPlan.blockedCaseCount > 0 ? 'orange' : 'default'}>
              {previewPlan.blockedCaseCount} 个预检阻断
            </Tag>
            <Tag color={previewPlan.highCostCaseCount > 0 ? 'magenta' : 'default'}>
              {previewPlan.highCostCaseCount} 个视频任务
            </Tag>
          </Space>
          <div className="canvas-acceptance-verification-options">
            <Checkbox checked={verifyReload} onChange={(event) => setVerifyReload(event.target.checked)}>
              记录刷新恢复验收要求
            </Checkbox>
            <Checkbox checked={verifyPreview} onChange={(event) => setVerifyPreview(event.target.checked)}>
              记录媒体预览验收要求
            </Checkbox>
          </div>
          {previewPlan.blockedCaseCount > 0 && (
            <Alert
              type="warning"
              showIcon
              message="部分节点会以“调用前阻断”状态生成"
              description="这类节点仍会出现在画布上并保留阻断依据，但应先补齐明确的渠道、模型、Manifest 或能力配置，再进行真实调用。"
            />
          )}
          {exceedsCallLimit && (
            <Alert
              type="error"
              showIcon
              message={`本次计划 ${previewPlan.cases.length} 次调用，超过安全上限 ${MAX_ACCEPTANCE_CALLS}`}
              description="请减少横向模型或比较节点；系统会阻止生成，避免意外创建大规模真实调用计划。"
            />
          )}
        </section>
      </Modal>
    </>
  )
}

function ModelSelect({
  label,
  kind,
  loading,
  models,
  value,
  onChange,
}: {
  label: string
  kind: CanvasAcceptanceTargetKind
  loading: boolean
  models: CanvasMediaModelSummary[]
  value: string
  onChange: (value: string) => void
}) {
  const filtered = models.filter((model) => modelMatchesKind(model, kind))
  return (
    <label>
      <span>{label}</span>
      <Select
        allowClear
        showSearch
        loading={loading}
        value={value || undefined}
        placeholder={`选择${label}`}
        optionFilterProp="label"
        options={filtered.map((model) => ({
          label: `${model.providerName ?? model.providerKind} · ${model.displayName}`,
          value: mediaModelKey(model),
        }))}
        onChange={(next) => onChange(next ?? '')}
      />
    </label>
  )
}
