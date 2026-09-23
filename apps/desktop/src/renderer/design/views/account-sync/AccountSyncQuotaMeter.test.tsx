// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AccountSyncStatus } from '@spark/protocol'
import { AccountSyncQuotaInline, AccountSyncQuotaPanel } from './AccountSyncQuotaMeter'

function status(overrides: Partial<AccountSyncStatus> = {}): AccountSyncStatus {
  return {
    maxPayloadBytes: 20 * 1024 * 1024,
    lastPayloadBytes: null,
    lastSyncAt: null,
    lastStatus: null,
    lastDeviceLabel: null,
    source: 'server',
    ...overrides,
  }
}

describe('AccountSyncQuotaMeter', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  async function render(element: React.ReactElement): Promise<void> {
    await act(async () => {
      root.render(element)
    })
  }

  it('renders the inline quota copy and a progress bar sized by usage', async () => {
    await render(<AccountSyncQuotaInline status={status({ lastPayloadBytes: 3_565_158 })} />)

    expect(container.textContent).toContain('单次同步上限 20 MiB')
    expect(container.textContent).toContain('上次数据 3.4 MiB')
    expect(container.textContent).toContain('余量 16.6 MiB')

    const bar = container.querySelector('.account-sync-quota-bar')
    expect(bar?.getAttribute('role')).toBe('progressbar')
    expect(bar?.getAttribute('aria-valuenow')).toBe('17')
    expect(
      container.querySelector('.account-sync-quota-bar-fill')?.getAttribute('style'),
    ).toContain('width: 17%')
  })

  it('switches the inline tone when the pending payload exceeds the limit', async () => {
    await render(<AccountSyncQuotaInline status={status()} pendingBytes={25 * 1024 * 1024} />)

    expect(container.textContent).toContain('本次待同步 25 MiB')
    expect(container.textContent).toContain('已超出 5 MiB')
    expect(container.querySelector('.account-sync-quota-inline.is-over')).not.toBeNull()
  })

  it('explains the never-synced state instead of showing a dash-only row', async () => {
    // 服务端无 /status 时主进程回退的形状：保守默认上限 + fallback 标记
    await render(
      <AccountSyncQuotaInline
        status={status({
          maxPayloadBytes: 5 * 1024 * 1024,
          source: 'fallback',
        })}
      />,
    )

    expect(container.textContent).toContain('单次同步上限 5 MiB')
    expect(container.textContent).toContain('尚无同步记录')
    expect(container.textContent).toContain('服务端版本较低，仅供参考')
  })

  it('shows a loading row in the panel while the status is unresolved', async () => {
    await render(<AccountSyncQuotaPanel status={null} loading />)
    expect(container.textContent).toContain('正在读取同步余量…')
  })

  it('renders the panel rows, meter and caveat for a known account', async () => {
    await render(
      <AccountSyncQuotaPanel
        status={status({
          lastPayloadBytes: 19 * 1024 * 1024,
          lastSyncAt: '2026-09-23T12:00:00.000Z',
          lastStatus: 'partial',
          lastDeviceLabel: 'macOS #ab12',
        })}
      />,
    )

    expect(container.textContent).toContain('单次同步上限')
    expect(container.textContent).toContain('上次同步数据')
    expect(container.textContent).toContain('19 MiB')
    expect(container.textContent).toContain('macOS #ab12')
    expect(container.textContent).toContain('部分成功')
    expect(container.textContent).toContain('1 MiB 可用')
    expect(container.textContent).toContain('不是累计存储配额')
    expect(
      container.querySelector('.account-sync-quota-panel-meter-head strong.is-warn'),
    ).not.toBeNull()
  })
})
