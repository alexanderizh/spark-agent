// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  VoiceComponentStatus,
  VoiceIntegrityStatus,
  VoicePackComponent,
  VoicePackState,
} from '@spark/protocol'
import { VoiceIntegritySettingsItem } from './VoiceIntegritySettingsItem'
import { useVoiceIntegrity } from './useVoiceIntegrity'

vi.mock('./useVoiceIntegrity', () => ({
  useVoiceIntegrity: vi.fn(),
}))

const mockedHook = vi.mocked(useVoiceIntegrity)

let root: Root | null = null
let container: HTMLDivElement | null = null
const install = vi.fn()
const refresh = vi.fn().mockResolvedValue(undefined)

function componentState(
  component: VoicePackComponent,
  state: VoicePackState,
): VoiceComponentStatus {
  return {
    component,
    state,
    installedVersion: state === 'ready' ? '1.0.0' : null,
    latestVersion: null,
    artifactId: null,
    percent: null,
    message: null,
  }
}

function buildStatus(
  states: Partial<Record<VoicePackComponent, VoicePackState>>,
  overrides: Partial<VoiceIntegrityStatus> = {},
): VoiceIntegrityStatus {
  const components = (['native', 'model', 'refine', 'kws', 'vad'] as const).map((key) =>
    componentState(key, states[key] ?? 'ready'),
  )
  const coreReady = (states.native ?? 'ready') === 'ready' && (states.model ?? 'ready') === 'ready'
  return {
    ready: coreReady,
    downloading: false,
    supported: true,
    unsupportedReason: null,
    components,
    lastError: null,
    ...overrides,
  }
}

function mountItem(status: VoiceIntegrityStatus): HTMLDivElement {
  mockedHook.mockReturnValue({
    status,
    progress: null,
    checking: false,
    refresh,
    install,
  })
  act(() => {
    root?.render(<VoiceIntegritySettingsItem />)
  })
  return container as HTMLDivElement
}

/** 按组件名取该行的状态徽标元素 */
function rowBadge(mounted: HTMLDivElement, key: VoicePackComponent): HTMLElement | null {
  const rows = Array.from(mounted.querySelectorAll<HTMLElement>('.integrity-sdk-row'))
  const row = rows.find((r) => r.textContent?.includes(key))
  return row?.querySelector('.badge') ?? null
}

beforeEach(() => {
  vi.clearAllMocks()
  install.mockClear()
  refresh.mockClear()
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('VoiceIntegritySettingsItem', () => {
  it('renders one status row per component in canonical order', () => {
    const mounted = mountItem(buildStatus({}))
    const names = Array.from(mounted.querySelectorAll('.integrity-sdk-name')).map(
      (el) => el.textContent,
    )
    expect(names).toEqual([
      '推理引擎 (native)',
      '识别模型 (model)',
      '精修模型 (refine)',
      '唤醒词模型 (kws)',
      '人声检测模型 (vad)',
    ])
  })

  it('shows each optional component its own state instead of copying refine (kws/vad regression)', () => {
    // 回归保护：native/model/refine 就绪但 kws/vad 未安装时，
    // 旧实现把 kws/vad 行映射到 refine 的状态而错误显示「就绪」。
    const mounted = mountItem(buildStatus({ kws: 'missing', vad: 'missing' }))

    expect(rowBadge(mounted, 'kws')?.textContent).toBe('未安装')
    expect(rowBadge(mounted, 'vad')?.textContent).toBe('未安装')
    expect(rowBadge(mounted, 'refine')?.textContent).toBe('就绪')

    // 可选组件缺失是正常状态，徽标不应渲染为红色告警
    expect(rowBadge(mounted, 'kws')?.className).not.toContain('error')
    expect(rowBadge(mounted, 'vad')?.className).not.toContain('error')
  })

  it('marks core components missing as an error badge', () => {
    const mounted = mountItem(buildStatus({ model: 'missing' }))

    expect(rowBadge(mounted, 'model')?.textContent).toBe('未安装')
    expect(rowBadge(mounted, 'model')?.className).toContain('error')
    // 可选组件仍为中性徽标
    expect(rowBadge(mounted, 'refine')?.className).not.toContain('error')
  })

  it('treats a component absent from the status list as unknown but missing', () => {
    const status = buildStatus({})
    status.components = status.components.filter((c) => c.component !== 'kws')

    const mounted = mountItem(status)

    expect(rowBadge(mounted, 'kws')?.textContent).toBe('未知')
    expect(installButton(mounted)?.textContent).toContain('安装缺失组件')
  })

  it('lists every missing optional component in the overall badge', () => {
    const onlyRefine = mountItem(buildStatus({ refine: 'missing' }))
    expect(overallBadgeText(onlyRefine)).toBe('语音包已就绪 · 未安装：精修模型')

    const threeMissing = mountItem(
      buildStatus({ refine: 'missing', kws: 'missing', vad: 'missing' }),
    )
    expect(overallBadgeText(threeMissing)).toBe(
      '语音包已就绪 · 未安装：精修模型、唤醒词模型、人声检测模型',
    )

    const allReady = mountItem(buildStatus({}))
    expect(overallBadgeText(allReady)).toBe('语音包已就绪')
  })

  it('prompts a full install when the core is not ready', () => {
    const mounted = mountItem(buildStatus({ native: 'missing', model: 'missing' }))

    expect(overallBadgeText(mounted)).toBe('语音包未就绪')
    expect(installButton(mounted)?.textContent).toContain('安装语音包')
  })

  it('reinstalls with force only when all five components are ready', async () => {
    const mounted = mountItem(buildStatus({}))

    const button = installButton(mounted)
    expect(button?.textContent).toContain('重新安装')

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    expect(install).toHaveBeenCalledWith(true)
  })

  it('installs only the refine model on demand when just refine is missing', async () => {
    const mounted = mountItem(buildStatus({ refine: 'missing' }))

    const button = installButton(mounted)
    expect(button?.textContent).toContain('安装精修模型')

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    expect(install).toHaveBeenCalledWith(false)
  })

  it('patches missing optional components on demand instead of a forced reinstall (kws/vad regression)', async () => {
    // 回归保护：核心 + 精修就绪但 kws/vad 缺失时，
    // 旧实现误判「全部就绪」而触发 380 MB 强制重装。
    const mounted = mountItem(buildStatus({ kws: 'missing', vad: 'missing' }))

    const button = installButton(mounted)
    expect(button?.textContent).toContain('安装缺失组件 (2)')

    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })
    expect(install).toHaveBeenCalledWith(false)
  })
})

function overallBadgeText(mounted: HTMLDivElement): string {
  return mounted.querySelector('.integrity-status-badge span')?.textContent ?? ''
}

function installButton(mounted: HTMLDivElement): HTMLButtonElement | null {
  return mounted.querySelector<HTMLButtonElement>('.voice-integrity-actions button')
}
