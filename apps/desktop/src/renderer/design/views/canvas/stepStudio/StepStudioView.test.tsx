// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CanvasSnapshot } from '../canvas.types'
import { StepStudioView } from './StepStudioView'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@lobehub/ui', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  return {
    Button: ({
      children,
      icon,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode }) =>
      ReactActual.createElement('button', { type: 'button', ...props }, icon, children),
  }
})

vi.mock('../../../Icons', () => ({
  Icons: {
    ArrowLeft: () => React.createElement('span', null, 'back'),
    Sun: () => React.createElement('span', null, 'sun'),
    Moon: () => React.createElement('span', null, 'moon'),
  },
}))

vi.mock('../../../SidebarExpandButton', () => ({
  SidebarExpandButton: () => React.createElement('button', { type: 'button' }, 'sidebar'),
}))

vi.mock('../../../components/WindowControls', () => ({
  WindowControls: () => React.createElement('div', { 'data-testid': 'window-controls' }),
}))

vi.mock('./StepModeSwitcher', () => ({
  StepModeSwitcher: () => React.createElement('div', { 'data-testid': 'mode-switcher' }),
}))

vi.mock('./StepSetupView', () => ({
  StepSetupView: () => React.createElement('div', { 'data-testid': 'setup-view' }),
}))

vi.mock('./StepStoryboardView', () => ({
  StepStoryboardView: () => React.createElement('div', { 'data-testid': 'storyboard-view' }),
}))

vi.mock('./StepAssemblyView', () => ({
  StepAssemblyView: () => React.createElement('div', { 'data-testid': 'assembly-view' }),
}))

const mounted: Array<{ root: Root; container: HTMLDivElement }> = []

afterEach(() => {
  while (mounted.length > 0) {
    const item = mounted.pop()
    if (item == null) break
    act(() => item.root.unmount())
    item.container.remove()
  }
})

function snapshotFixture(): CanvasSnapshot {
  const at = '2026-08-31T00:00:00.000Z'
  return {
    project: {
      id: 'project-1',
      userId: 0,
      title: '测试项目',
      status: 'active',
      settings: {},
      nodeCount: 0,
      assetCount: 0,
      taskCount: 0,
      createdAt: at,
      updatedAt: at,
    },
    board: {
      id: 'board-1',
      projectId: 'project-1',
      userId: 0,
      name: '主画板',
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: {},
      createdAt: at,
      updatedAt: at,
    },
    nodes: [],
    edges: [],
    assets: [],
    tasks: [],
  }
}

async function renderStepStudio(onSelectStep = vi.fn()) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  await act(async () =>
    root.render(
      <StepStudioView
        projectTitle="测试项目"
        activeStep="setup"
        snapshot={snapshotFixture()}
        setupActions={{
          onCreateFilmAsset: vi.fn(),
          onUploadImageAsset: vi.fn(),
          onCreateMediaTask: vi.fn(),
          refreshSnapshot: vi.fn(),
        }}
        storyboardActions={{
          onCreateMediaTask: vi.fn(),
          onUpdateState: vi.fn(),
          refreshSnapshot: vi.fn(),
        }}
        assemblyActions={{ onAssemble: vi.fn(), onOpenWorkbench: vi.fn() }}
        onSelectStep={onSelectStep}
        onSwitchToCanvas={vi.fn()}
        onBack={vi.fn()}
      />,
    ),
  )
  return { container, onSelectStep }
}

describe('StepStudioView navigation', () => {
  it('仅保留头部三步导航，不再渲染重复的左侧步骤栏', async () => {
    const { container } = await renderStepStudio()

    expect(container.querySelector('.step-studio-sidebar')).toBeNull()
    expect(container.querySelectorAll('.step-studio-stage')).toHaveLength(3)
    expect(container.querySelector('.step-studio-main')?.getAttribute('role')).toBeNull()
    expect(container.querySelector('[data-testid="setup-view"]')).not.toBeNull()
  })

  it('头部导航仍可切换步骤', async () => {
    const { container, onSelectStep } = await renderStepStudio()
    const buttons = container.querySelectorAll<HTMLButtonElement>('.step-studio-stage')

    await act(async () => buttons[1]?.click())
    expect(onSelectStep).toHaveBeenCalledWith('storyboard')
  })
})
