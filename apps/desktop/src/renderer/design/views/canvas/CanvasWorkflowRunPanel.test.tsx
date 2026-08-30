// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasWorkflowDefinition, CanvasWorkflowRun } from '@spark/protocol'
import { CanvasWorkflowRunPanel } from './CanvasWorkflowRunPanel'
import { canvasWorkflowApi } from './canvasWorkflow.api'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./canvasWorkflow.api', () => ({
  canvasWorkflowApi: {
    createRun: vi.fn(),
    getRun: vi.fn(),
    listRuns: vi.fn(),
    cancelRun: vi.fn(),
    retryRunStep: vi.fn(),
    resumeRun: vi.fn(),
  },
}))

const workflow: CanvasWorkflowDefinition = {
  id: 'workflow-1',
  projectId: 'project-1',
  name: '生成主视觉',
  description: '根据主题生成主视觉',
  scope: 'project',
  status: 'published',
  version: 2,
  tags: [],
  package: {
    schemaVersion: 1,
    graph: {
      nodes: [
        {
          id: 'generate',
          kind: 'canvas_operation',
          label: '生成',
          position: { x: 0, y: 0 },
          config: { operation: 'text_to_image' },
        },
      ],
      edges: [],
    },
    contract: {
      inputs: [{ id: 'theme', name: '创作主题', valueType: 'text', required: true }],
      outputs: [],
      exposedParams: [
        {
          id: 'count',
          name: '候选数量',
          valueType: 'number',
          nodeId: 'generate',
          path: 'modelParams.count',
          defaultValue: 1,
        },
        {
          id: 'transparent',
          name: '透明背景',
          valueType: 'boolean',
          nodeId: 'generate',
          path: 'modelParams.transparent',
          defaultValue: false,
        },
      ],
    },
    dependencies: { modelCapabilities: ['text_to_image'], canvasNodeKinds: ['operation'] },
  },
  createdAt: '2026-07-23T00:00:00.000Z',
  updatedAt: '2026-07-23T00:00:00.000Z',
}

const run: CanvasWorkflowRun = {
  id: 'run-1',
  workflowId: 'workflow-1',
  workflowVersion: 2,
  projectId: 'project-1',
  status: 'queued',
  inputs: {},
  exposedParams: {},
  outputs: {},
  error: null,
  idempotencyKey: 'request-1',
  createdAt: '2026-07-23T00:00:00.000Z',
  startedAt: null,
  finishedAt: null,
  updatedAt: '2026-07-23T00:00:00.000Z',
  steps: [],
}

const mounted: Array<{ root: Root; container: HTMLDivElement }> = []

function setControlValue(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype =
    control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(control, value)
  control.dispatchEvent(new Event('input', { bubbles: true }))
  control.dispatchEvent(new Event('change', { bubbles: true }))
}

async function renderPanel(overrides: Partial<React.ComponentProps<typeof CanvasWorkflowRunPanel>> = {}) {
  const props: React.ComponentProps<typeof CanvasWorkflowRunPanel> = {
    open: true,
    projectId: 'project-1',
    workflow,
    onClose: vi.fn(),
    onExecute: vi.fn(async ({ run: createdRun }) => ({ ...createdRun, status: 'completed' })),
    ...overrides,
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  await act(async () => root.render(<CanvasWorkflowRunPanel {...props} />))
  return { container, props }
}

beforeEach(() => {
  vi.mocked(canvasWorkflowApi.createRun).mockResolvedValue({
    run,
    plan: {
      schemaVersion: 1,
      nodeOrder: ['generate'],
      steps: [],
      contract: workflow.package.contract,
      dependencies: workflow.package.dependencies,
    },
  })
  vi.mocked(canvasWorkflowApi.getRun).mockResolvedValue({ ...run, status: 'failed' })
  vi.mocked(canvasWorkflowApi.listRuns).mockResolvedValue([])
})

afterEach(() => {
  vi.clearAllMocks()
  while (mounted.length > 0) {
    const item = mounted.pop()!
    act(() => item.root.unmount())
    item.container.remove()
  }
})

describe('CanvasWorkflowRunPanel', () => {
  it('validates required inputs and submits typed custom values', async () => {
    const onExecute = vi.fn(async ({ run: createdRun }) => ({ ...createdRun, status: 'completed' as const }))
    const { container } = await renderPanel({ onExecute })

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="运行画布工作流"]')!.click(),
    )
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('创作主题')
    expect(canvasWorkflowApi.createRun).not.toHaveBeenCalled()

    const theme = container.querySelector<HTMLTextAreaElement>('[aria-label="创作主题"]')!
    const count = container.querySelector<HTMLInputElement>('[aria-label="候选数量"]')!
    const transparent = container.querySelector<HTMLInputElement>('[aria-label="透明背景"]')!
    await act(async () => {
      setControlValue(theme, '夏日海岛')
      setControlValue(count, '3')
      transparent.click()
    })
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="运行画布工作流"]')!.click(),
    )

    expect(canvasWorkflowApi.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'workflow-1',
        projectId: 'project-1',
        inputs: { theme: '夏日海岛' },
        exposedParams: { count: 3, transparent: true },
      }),
    )
    expect(onExecute).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('运行完成')
  })

  it('reloads the created run after execution fails', async () => {
    const onExecute = vi.fn(async () => {
      throw new Error('Provider 暂时不可用')
    })
    const { container } = await renderPanel({ onExecute })
    const theme = container.querySelector<HTMLTextAreaElement>('[aria-label="创作主题"]')!
    await act(async () => setControlValue(theme, '夏日海岛'))

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="运行画布工作流"]')!.click(),
    )

    expect(canvasWorkflowApi.getRun).toHaveBeenCalledWith('run-1')
    expect(container.textContent).toContain('运行失败')
  })

  it('resumes the latest failed run with its immutable plan', async () => {
    const failedRun: CanvasWorkflowRun = {
      ...run,
      status: 'failed',
      steps: [
        {
          id: 'step-1',
          runId: run.id,
          nodeId: 'generate',
          stepIndex: 0,
          status: 'failed',
          dependsOnNodeIds: [],
          taskId: null,
          input: {},
          output: null,
          error: { message: 'interrupted' },
          attempt: 1,
          startedAt: null,
          finishedAt: null,
          updatedAt: run.updatedAt,
        },
      ],
    }
    const resumedRun = {
      ...failedRun,
      status: 'running' as const,
      steps: [{ ...failedRun.steps[0]!, status: 'ready' as const, attempt: 2 }],
    }
    const resumedPlan = {
      schemaVersion: 1 as const,
      nodeOrder: ['generate'],
      steps: [],
      contract: workflow.package.contract,
      dependencies: workflow.package.dependencies,
    }
    vi.mocked(canvasWorkflowApi.listRuns).mockResolvedValue([failedRun])
    vi.mocked(canvasWorkflowApi.resumeRun).mockResolvedValue({
      run: resumedRun,
      plan: resumedPlan,
    })
    const onExecute = vi.fn(async () => ({ ...resumedRun, status: 'completed' as const }))
    const { container } = await renderPanel({ onExecute })

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="恢复上次画布工作流运行"]')!.click(),
    )

    expect(canvasWorkflowApi.resumeRun).toHaveBeenCalledWith('run-1')
    expect(onExecute).toHaveBeenCalledWith(
      expect.objectContaining({ run: resumedRun, plan: resumedPlan }),
    )
  })

  it('selects compatible canvas nodes for media inputs', async () => {
    const mediaWorkflow: CanvasWorkflowDefinition = {
      ...workflow,
      package: {
        ...workflow.package,
        contract: {
          ...workflow.package.contract,
          inputs: [
            ...workflow.package.contract.inputs,
            { id: 'product', name: '产品图', valueType: 'image', required: true },
          ],
        },
      },
    }
    const { container } = await renderPanel({
      workflow: mediaWorkflow,
      availableInputNodes: [
        {
          id: 'image-node-1',
          label: '产品正面图',
          valueTypes: ['image', 'asset', 'node'],
        },
      ],
    })
    const theme = container.querySelector<HTMLTextAreaElement>('[aria-label="创作主题"]')!
    const product = container.querySelector<HTMLSelectElement>('[aria-label="产品图"]')!
    await act(async () => {
      setControlValue(theme, '夏日海岛')
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
      setter?.call(product, 'image-node-1')
      product.dispatchEvent(new Event('change', { bubbles: true }))
    })

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="运行画布工作流"]')!.click(),
    )

    expect(canvasWorkflowApi.createRun).toHaveBeenCalledWith(
      expect.objectContaining({ inputs: { theme: '夏日海岛', product: 'image-node-1' } }),
    )
  })
})
