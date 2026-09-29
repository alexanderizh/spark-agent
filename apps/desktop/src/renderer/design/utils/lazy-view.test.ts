/**
 * lazy-view 单测 — 动态导入失败的自愈语义
 *
 * 覆盖：错误识别、瞬态失败自动重试、确定性失败不重试、持续失败如实抛出。
 */
import { describe, expect, it, vi } from 'vitest'
import { isDynamicImportFetchError, withDynamicImportRetry } from './lazy-view'

const importFetchError = (): Error =>
  new TypeError(
    'Failed to fetch dynamically imported module: http://localhost:5173/design/views/ChatView.tsx',
  )

describe('isDynamicImportFetchError', () => {
  it('识别 Chromium 的动态导入失败消息', () => {
    expect(isDynamicImportFetchError(importFetchError())).toBe(true)
  })

  it('识别 WebKit / Firefox 变体消息', () => {
    expect(isDynamicImportFetchError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isDynamicImportFetchError(new Error('Error loading dynamically imported module'))).toBe(
      true,
    )
  })

  it('拒绝非错误值与普通渲染错误', () => {
    expect(isDynamicImportFetchError(undefined)).toBe(false)
    expect(isDynamicImportFetchError('string error')).toBe(false)
    expect(isDynamicImportFetchError(new TypeError('Cannot read properties of undefined'))).toBe(
      false,
    )
  })
})

describe('withDynamicImportRetry', () => {
  it('瞬态失败（重启空窗）后自愈：重试期间成功即返回', async () => {
    let calls = 0
    const loader = vi.fn(async (): Promise<string> => {
      calls += 1
      if (calls < 3) throw importFetchError()
      return 'recovered'
    })
    await expect(withDynamicImportRetry(loader)).resolves.toBe('recovered')
    expect(loader).toHaveBeenCalledTimes(3)
  }, 10_000)

  it('确定性失败不重试：直接抛出原始错误', async () => {
    const boom = new TypeError('x is not a function')
    const loader = vi.fn(async (): Promise<string> => {
      throw boom
    })
    await expect(withDynamicImportRetry(loader)).rejects.toBe(boom)
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('持续失败在约 20s 自愈窗口耗尽后如实抛出（1 次初始 + 9 次重试，覆盖整链重启）', async () => {
    vi.useFakeTimers()
    try {
      const loader = vi.fn(async (): Promise<string> => {
        throw importFetchError()
      })
      const pending = withDynamicImportRetry(loader)
      // 先挂接断言再推进时钟，避免 rejection 短暂无人处理
      const expectation = expect(pending).rejects.toThrow(/Failed to fetch/)
      // 消化全部退避等待（总窗口约 20.4s，fake timers 下瞬间完成）
      await vi.runAllTimersAsync()
      await expectation
      expect(loader).toHaveBeenCalledTimes(10)
    } finally {
      vi.useRealTimers()
    }
  })

  it('重启空窗内自愈：第 8 秒恢复的 loader 仍能成功返回', async () => {
    vi.useFakeTimers()
    try {
      let calls = 0
      const loader = vi.fn(async (): Promise<string> => {
        calls += 1
        // 模拟 vite server 重启数秒后才就绪：前 4 次都失败（累计等待 5.4s）
        if (calls <= 4) throw importFetchError()
        return 'recovered-after-restart'
      })
      const pending = withDynamicImportRetry(loader)
      await vi.runAllTimersAsync()
      await expect(pending).resolves.toBe('recovered-after-restart')
      expect(loader).toHaveBeenCalledTimes(5)
    } finally {
      vi.useRealTimers()
    }
  })
})
