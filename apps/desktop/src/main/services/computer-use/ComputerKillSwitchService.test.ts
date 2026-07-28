import { describe, expect, it, vi } from 'vitest'
import { ComputerKillSwitchService } from './ComputerKillSwitchService.js'

describe('ComputerKillSwitchService', () => {
  it('arms only after the operating system accepts the shortcut', () => {
    let callback: (() => void) | undefined
    const registrar = {
      register: vi.fn((_accelerator: string, handler: () => void) => {
        callback = handler
        return true
      }),
      unregister: vi.fn(),
    }
    const onTrigger = vi.fn()
    const service = new ComputerKillSwitchService(registrar)

    expect(service.arm('CommandOrControl+Shift+Escape', onTrigger)).toBe(true)
    expect(service.isArmed()).toBe(true)
    callback?.()
    expect(onTrigger).toHaveBeenCalledTimes(1)

    service.dispose()
    expect(registrar.unregister).toHaveBeenCalledWith('CommandOrControl+Shift+Escape')
    expect(service.isArmed()).toBe(false)
  })

  it('fails closed and removes the old registration when reconfiguration fails', () => {
    const registrar = {
      register: vi.fn((accelerator: string) => accelerator === 'Control+Escape'),
      unregister: vi.fn(),
    }
    const service = new ComputerKillSwitchService(registrar)

    expect(service.arm('Control+Escape', vi.fn())).toBe(true)
    expect(service.arm('Control+Shift+Escape', vi.fn())).toBe(false)
    expect(registrar.unregister).toHaveBeenCalledWith('Control+Escape')
    expect(service.isArmed()).toBe(false)
  })

  it('coalesces repeated key events while an async kill is still running', async () => {
    let callback: (() => void) | undefined
    let finish: (() => void) | undefined
    const registrar = {
      register: vi.fn((_accelerator: string, handler: () => void) => {
        callback = handler
        return true
      }),
      unregister: vi.fn(),
    }
    const onTrigger = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const service = new ComputerKillSwitchService(registrar)
    service.arm('Control+Escape', onTrigger)

    callback?.()
    callback?.()
    expect(onTrigger).toHaveBeenCalledTimes(1)
    if (finish == null) throw new Error('Expected kill switch callback to start')
    finish()
    await vi.waitFor(() => {
      callback?.()
      expect(onTrigger).toHaveBeenCalledTimes(2)
    })
  })
})
