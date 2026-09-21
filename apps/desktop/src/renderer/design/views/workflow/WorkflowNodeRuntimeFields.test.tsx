// @vitest-environment jsdom

import { type ReactNode } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManagedAgent, ProviderProfile, WorkflowNode } from '@spark/protocol'
import { WorkflowNodeRuntimeFields } from './WorkflowNodeRuntimeFields'
import { buildProviderModelIndex, collectModelIds } from './node-model-options'

/** 只保留联动断言需要的信息：当前值 + 候选标签，点标签即触发 onChange。 */
vi.mock('@lobehub/ui', () => ({
  Select: ({
    value,
    options,
    onChange,
  }: {
    value?: string
    options?: Array<{ label: ReactNode; value: string }>
    onChange?: (value: string) => void
  }) => (
    <div data-select-value={String(value ?? '')}>
      {(options ?? []).map((option) => (
        <button key={option.value} onClick={() => onChange?.(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  ),
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function provider(id: string, name: string, defaultModel: string, modelIds: string[]) {
  return {
    id,
    name,
    provider: 'anthropic',
    defaultModel,
    modelIds,
    supportsMillionContext: false,
    modelType: 'multimodal',
    keystoreRef: '',
    isDefault: false,
    createdAt: '',
  } satisfies ProviderProfile
}

const providers = [
  provider('provider-a', '渠道 A', 'a-default', ['a-default', 'a-fast']),
  provider('provider-b', '渠道 B', 'b-default', ['b-default', 'b-mini']),
]
const providerModelIndex = buildProviderModelIndex(providers)
const allModelIds = collectModelIds(providerModelIndex)

function agent(id: string, overrides: Partial<ManagedAgent> = {}): ManagedAgent {
  return {
    id,
    name: id,
    description: '',
    builtIn: false,
    enabled: true,
    isDefault: false,
    providerProfileId: null,
    modelId: null,
    agentAdapter: 'claude-sdk',
    permissionMode: 'claude-ask',
    reasoningEffort: 'medium',
    prompt: '',
    ruleIds: [],
    skillIds: [],
    disabledSkillIds: [],
    mcpServerIds: [],
    hookConfig: {},
    workflowId: null,
    metadata: {},
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

describe('WorkflowNodeRuntimeFields', () => {
  let container: HTMLDivElement
  let root: Root | null = null
  let onPatchConfig: ReturnType<typeof vi.fn>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    onPatchConfig = vi.fn()
  })

  afterEach(() => {
    act(() => root?.unmount())
    container.remove()
  })

  const renderFields = (config: WorkflowNode['config'], agents: ManagedAgent[] = []) => {
    act(() => {
      root?.render(
        <WorkflowNodeRuntimeFields
          config={config}
          providers={providers}
          providerModelIndex={providerModelIndex}
          allModelIds={allModelIds}
          agents={agents}
          onPatchConfig={onPatchConfig}
        />,
      )
    })
  }

  /** 字段顺序固定为 渠道 → 模型 → 推理强度。 */
  const selectAt = (index: number): HTMLElement => {
    const select = container.querySelectorAll<HTMLElement>('[data-select-value]')[index]
    if (select == null) throw new Error(`第 ${index} 个下拉未渲染`)
    return select
  }
  const optionButtons = (index: number): HTMLButtonElement[] =>
    Array.from(selectAt(index).querySelectorAll('button'))
  const modelOptionLabels = (): string[] =>
    optionButtons(1).map((button) => String(button.textContent))
  const clickOption = (selectIndex: number, optionIndex: number) => {
    const button = optionButtons(selectIndex)[optionIndex]
    if (button == null) throw new Error(`第 ${selectIndex} 个下拉缺少第 ${optionIndex} 个选项`)
    act(() => button.click())
  }

  it('limits model candidates to the selected channel', () => {
    renderFields({ providerProfileId: 'provider-b', modelId: 'b-mini' })

    expect(modelOptionLabels()).toEqual(['继承 Agent', 'b-default', 'b-mini'])
    expect(container.textContent).toContain('候选模型来自渠道「渠道 B」')
  })

  it('keeps a stale saved model visible and warns instead of silently dropping it', () => {
    renderFields({ providerProfileId: 'provider-b', modelId: 'a-fast' })

    // 渠道 A 的模型不再作为正常候选出现，但当前保存值仍可见可辨认。
    expect(modelOptionLabels()).toEqual([
      '继承 Agent',
      'a-fast（不属于该渠道）',
      'b-default',
      'b-mini',
    ])
    expect(container.textContent).toContain('当前保存的模型不属于渠道「渠道 B」')
  })

  it('offers every channel model when the channel is inherited from the host agent', () => {
    renderFields({ modelId: 'a-fast' })

    expect(modelOptionLabels()).toEqual([
      '继承 Agent',
      'a-default',
      'a-fast',
      'b-default',
      'b-mini',
    ])
    expect(container.textContent).toContain('继承宿主 Agent')
  })

  it('clears the model that the newly selected channel cannot serve', () => {
    renderFields({ providerProfileId: 'provider-a', modelId: 'a-fast' })

    clickOption(0, 2)

    expect(onPatchConfig).toHaveBeenCalledWith({
      providerProfileId: 'provider-b',
      modelId: null,
    })
  })

  it('keeps a model that the newly selected channel can serve', () => {
    renderFields({ providerProfileId: 'provider-a', modelId: 'a-fast' })

    clickOption(0, 1)

    expect(onPatchConfig).toHaveBeenCalledWith({ providerProfileId: 'provider-a' })
  })

  it('defaults the reasoning effort to inherit and names the inherited source', () => {
    renderFields({ agentId: 'agent-x' }, [agent('agent-x', { reasoningEffort: 'xhigh' })])

    expect(selectAt(2).dataset.selectValue).toBe('')
    expect(container.textContent).toContain('继承绑定 Agent「agent-x」的推理强度（超高）')
  })

  it('falls back to the host agent wording when no agent is bound', () => {
    renderFields({})

    expect(container.textContent).toContain('未固定时继承宿主 Agent')
  })

  it('patches a chosen effort level onto the node config', () => {
    renderFields({})

    // options: 继承 Agent, 极低, 低, 平衡, 高, 超高, Max → 超高 = 下标 5
    clickOption(2, 5)

    expect(onPatchConfig).toHaveBeenCalledWith({ reasoningEffort: 'xhigh' })
  })

  it('patches undefined (not null) when switching back to inherit', () => {
    renderFields({ reasoningEffort: 'high' })

    clickOption(2, 0)

    const patch = onPatchConfig.mock.calls.at(-1)?.[0] as { reasoningEffort?: unknown }
    expect('reasoningEffort' in patch).toBe(true)
    expect(patch.reasoningEffort).toBeUndefined()
    // null 会被 config schema（z.string().optional() + strict）拒绝。
    expect(patch.reasoningEffort).not.toBeNull()
  })

  it('shows a saved invalid effort as a visible option with a warning', () => {
    renderFields({ reasoningEffort: 'ultra' })

    expect(optionButtons(2).map((button) => String(button.textContent))).toEqual([
      '继承 Agent',
      'ultra（无效值）',
      '极低',
      '低',
      '平衡',
      '高',
      '超高',
      'Max',
    ])
    expect(container.textContent).toContain('不是有效档位')
  })

  it('shows the effective description when a level is pinned on the node', () => {
    renderFields({ reasoningEffort: 'medium' })

    expect(selectAt(2).dataset.selectValue).toBe('medium')
    expect(container.textContent).toContain('速度与质量均衡')
    expect(container.textContent).toContain('覆盖 Agent 的推理强度')
  })
})
