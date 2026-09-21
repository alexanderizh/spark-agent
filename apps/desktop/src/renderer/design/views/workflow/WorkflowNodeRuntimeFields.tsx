import { Select as LobeSelect } from '@lobehub/ui'
import type { ManagedAgent, ProviderProfile, WorkflowNode } from '@spark/protocol'
import { InspectorField } from './inspector-fields'
import {
  NODE_REASONING_EFFORT_OPTIONS,
  buildProviderPatch,
  buildReasoningEffortPatch,
  nodeReasoningEffortDescription,
  nodeReasoningEffortLabel,
  normalizeNodeReasoningEffort,
  rawNodeReasoningEffort,
  resolveNodeModelSelectState,
} from './node-model-options'

/**
 * 执行节点的「渠道（Provider）+ 模型 + 推理强度」字段。
 *
 * 从 WorkflowView.tsx 拆出（检查器字段块）：渠道/模型是独立的 config 配置，但运行时
 * 必须配套——渠道决定模型归属，因此选中渠道后模型候选只能来自该渠道；换渠道（或换
 * 继承来源的绑定 Agent）时，不属于新渠道的模型会被清空回落「继承 Agent」。
 * 推理强度是独立覆盖（换渠道/换 Agent 不清理），未配置时运行时回落成员 Agent 的档位。
 * 推导规则见 node-model-options.ts。
 */
export function WorkflowNodeRuntimeFields({
  config,
  providers,
  providerModelIndex,
  allModelIds,
  agents,
  onPatchConfig,
}: {
  config: WorkflowNode['config']
  providers: ProviderProfile[]
  providerModelIndex: ReadonlyMap<string, string[]>
  allModelIds: string[]
  agents: ManagedAgent[]
  onPatchConfig: (patch: WorkflowNode['config']) => void
}) {
  const boundAgent = agents.find((agent) => agent.id === String(config.agentId ?? '')) ?? null
  const boundAgentProviderId = boundAgent?.providerProfileId ?? null
  const modelSelect = resolveNodeModelSelectState({
    providerModelIndex,
    allModelIds,
    configProviderProfileId: config.providerProfileId,
    boundAgentProviderId,
    currentModelId: config.modelId,
  })
  const providerName =
    providers.find((provider) => provider.id === modelSelect.providerId)?.name ??
    modelSelect.providerId
  const modelOptions = [
    { label: '继承 Agent', value: '' },
    ...(modelSelect.staleModelId == null
      ? []
      : [
          { label: `${modelSelect.staleModelId}（不属于该渠道）`, value: modelSelect.staleModelId },
        ]),
    ...modelSelect.modelIds.map((modelId) => ({ label: modelId, value: modelId })),
  ]
  const modelHint =
    modelSelect.staleModelId != null
      ? `当前保存的模型不属于渠道「${providerName}」，请重新选择，或改用「继承 Agent」。`
      : modelSelect.scope === 'all'
        ? '未固定渠道（继承宿主 Agent）时无法确定渠道，候选为全部渠道模型的并集，请确认与宿主 Agent 的渠道一致。'
        : modelSelect.modelIds.length === 0
          ? `渠道「${providerName}」未配置模型，请先在该渠道启用模型。`
          : `候选模型来自渠道「${providerName}」；换渠道后不属于该渠道的模型会自动清空。`

  const rawEffort = rawNodeReasoningEffort(config.reasoningEffort)
  const effortValue = normalizeNodeReasoningEffort(rawEffort)
  // 非空但不在档位内（导入包/手写 JSON 带入）：显式展示，不静默吞掉。
  const staleEffort = rawEffort !== '' && effortValue == null ? rawEffort : null
  const effortOptions = [
    { label: '继承 Agent', value: '' },
    ...(staleEffort == null
      ? []
      : [{ label: `${staleEffort}（无效值）`, value: staleEffort }]),
    ...NODE_REASONING_EFFORT_OPTIONS.map((option) => ({
      label: option.label,
      value: option.value,
    })),
  ]
  const boundAgentEffort =
    boundAgent == null ? null : normalizeNodeReasoningEffort(boundAgent.reasoningEffort)
  const effortHint =
    staleEffort != null
      ? `当前保存的推理强度「${staleEffort}」不是有效档位，运行时会按无效配置透传，请重新选择，或改用「继承 Agent」。`
      : effortValue != null
        ? `${nodeReasoningEffortDescription(effortValue)}；此设置覆盖 Agent 的推理强度。`
        : boundAgent != null
          ? `继承绑定 Agent「${boundAgent.name}」的推理强度（${
              boundAgentEffort == null
                ? String(boundAgent.reasoningEffort)
                : nodeReasoningEffortLabel(boundAgentEffort)
            }）。`
          : '未固定时继承宿主 Agent（当前会话执行者）的推理强度。'

  return (
    <>
      <InspectorField label="Provider">
        <LobeSelect
          value={String(config.providerProfileId ?? '')}
          onChange={(value) =>
            onPatchConfig(
              buildProviderPatch({
                providerModelIndex,
                configModelId: config.modelId,
                nextProviderId: String(value ?? ''),
              }),
            )
          }
          options={[
            { label: '继承 Agent', value: '' },
            ...providers.map((provider) => ({ label: provider.name, value: provider.id })),
          ]}
        />
      </InspectorField>
      <InspectorField label="模型">
        <LobeSelect
          value={String(config.modelId ?? '')}
          onChange={(value) => {
            const modelId = String(value ?? '')
            onPatchConfig({ modelId: modelId === '' ? null : modelId })
          }}
          options={modelOptions}
        />
        <div
          className={
            modelSelect.staleModelId == null ? 'wf-field-help' : 'wf-field-help wf-field-warn'
          }
        >
          {modelHint}
        </div>
      </InspectorField>
      <InspectorField label="推理强度">
        <LobeSelect
          value={effortValue ?? staleEffort ?? ''}
          onChange={(value) => onPatchConfig(buildReasoningEffortPatch(String(value ?? '')))}
          options={effortOptions}
        />
        <div
          className={staleEffort == null ? 'wf-field-help' : 'wf-field-help wf-field-warn'}
        >
          {effortHint}
        </div>
      </InspectorField>
    </>
  )
}
