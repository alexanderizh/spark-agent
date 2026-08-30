// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CanvasWorkspaceChrome } from './CanvasWorkspaceChrome'
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

vi.mock('./CanvasToolbar', () => ({
  CanvasToolbar: () => React.createElement('div', { 'data-testid': 'canvas-toolbar' }),
}))

vi.mock('../../SidebarExpandButton', () => ({
  SidebarExpandButton: () => React.createElement('button', { type: 'button' }, 'sidebar'),
}))

vi.mock('../../Icons', () => ({
  Icons: {
    ArrowLeft: () => React.createElement('span', null, 'back'),
    Sun: () => React.createElement('span', null, 'sun'),
    Moon: () => React.createElement('span', null, 'moon'),
    Grid: () => React.createElement('span', null, 'grid'),
    Film: () => React.createElement('span', null, 'film'),
  },
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

async function renderChrome(
  overrides: Partial<React.ComponentProps<typeof CanvasWorkspaceChrome>> = {},
) {
  const props: React.ComponentProps<typeof CanvasWorkspaceChrome> = {
    title: '测试画布',
    mode: 'canvas',
    onSwitchMode: vi.fn(),
    nodeCount: 1,
    assetCount: 2,
    taskCount: 3,
    showSidebarExpandButton: false,
    saveState: {
      dirty: false,
      saving: false,
      autoSaving: false,
      autoSaveEnabled: true,
    },
    selectedCount: 0,
    arranging: false,
    refreshing: false,
    onBack: vi.fn(),
    onArrange: vi.fn().mockResolvedValue(undefined),
    onSave: vi.fn(),
    onRefresh: vi.fn(),
    onAutoSaveChange: vi.fn(),
    onExport: vi.fn(),
    onUploadFiles: vi.fn(),
    onOpenAgent: vi.fn(),
    ...overrides,
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  await act(async () => root.render(<CanvasWorkspaceChrome {...props} />))
  return { container, props }
}

describe('CanvasWorkspaceChrome mode switcher', () => {
  it('renders the step mode switcher and reports the switch intent', async () => {
    const onSwitchMode = vi.fn()
    const { container } = await renderChrome({ mode: 'canvas', onSwitchMode })

    const switcher = container.querySelector('.step-mode-switcher')
    expect(switcher).not.toBeNull()

    const canvasOption = switcher?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
    expect(canvasOption?.textContent).toContain('画布')

    const stepOption = switcher?.querySelector<HTMLButtonElement>('[aria-pressed="false"]')
    expect(stepOption?.textContent).toContain('步骤')
    await act(async () => stepOption?.click())
    expect(onSwitchMode).toHaveBeenCalledWith('step')
  })
})

describe('CanvasWorkspaceChrome theme switcher', () => {
  it('renders only for an independently controlled canvas window theme', async () => {
    const { container } = await renderChrome()
    expect(container.querySelector('.canvas-window-theme-switcher')).toBeNull()

    const onWindowThemeChange = vi.fn()
    const mountedChrome = await renderChrome({ windowTheme: 'dark', onWindowThemeChange })
    expect(mountedChrome.container.querySelector('.canvas-window-theme-switcher')).not.toBeNull()

    const lightButton =
      mountedChrome.container.querySelector<HTMLButtonElement>('[aria-label="浅色模式"]')
    expect(lightButton?.getAttribute('aria-pressed')).toBe('false')
    await act(async () => lightButton?.click())
    expect(onWindowThemeChange).toHaveBeenCalledWith('light')
  })

  it('marks the active choice for the light theme', async () => {
    const { container } = await renderChrome({
      windowTheme: 'light',
      onWindowThemeChange: vi.fn(),
    })

    expect(container.querySelector('[aria-label="浅色模式"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(container.querySelector('[aria-label="暗色模式"]')?.getAttribute('aria-pressed')).toBe(
      'false',
    )
  })

  it('renders frameless window controls only when requested', async () => {
    const { container } = await renderChrome()
    expect(container.querySelector('.canvas-workspace-window-controls')).toBeNull()

    const withControls = await renderChrome({ showWindowControls: true })
    const controls = withControls.container.querySelector('.canvas-workspace-window-controls')
    expect(controls).not.toBeNull()
    expect(controls?.querySelector('.win-ctrl-btn.minimize')).not.toBeNull()
    expect(controls?.querySelector('.win-ctrl-btn.maximize')).not.toBeNull()
    expect(controls?.querySelector('.win-ctrl-btn.close')).not.toBeNull()
  })
})
