import { describe, expect, it, vi } from 'vitest'

import { installSingleInstanceLock } from './single-instance.js'

type SecondInstanceHandler = (event: unknown, commandLine: string[]) => void

function createFakeApp(hasLock: boolean): {
  app: {
    requestSingleInstanceLock: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
    quit: ReturnType<typeof vi.fn>
  }
  getSecondInstanceHandler: () => SecondInstanceHandler | null
} {
  let secondInstanceHandler: SecondInstanceHandler | null = null
  return {
    app: {
      requestSingleInstanceLock: vi.fn(() => hasLock),
      on: vi.fn((eventName: string, handler: SecondInstanceHandler) => {
        if (eventName === 'second-instance') {
          secondInstanceHandler = handler
        }
      }),
      quit: vi.fn(),
    },
    getSecondInstanceHandler: () => secondInstanceHandler,
  }
}

describe('single instance lock', () => {
  it('skips the application lock when locking is disabled for development', () => {
    const { app } = createFakeApp(false)
    const revealPrimaryWindow = vi.fn()

    const canStart = installSingleInstanceLock(app, revealPrimaryWindow, undefined, false)

    expect(canStart).toBe(true)
    expect(app.requestSingleInstanceLock).not.toHaveBeenCalled()
    expect(app.quit).not.toHaveBeenCalled()
    expect(app.on).not.toHaveBeenCalled()
  })

  it('quits immediately when another app instance already owns the lock', () => {
    const { app } = createFakeApp(false)
    const revealPrimaryWindow = vi.fn()

    const ownsLock = installSingleInstanceLock(app, revealPrimaryWindow)

    expect(ownsLock).toBe(false)
    expect(app.requestSingleInstanceLock).toHaveBeenCalledOnce()
    expect(app.quit).toHaveBeenCalledOnce()
    expect(app.on).not.toHaveBeenCalled()
    expect(revealPrimaryWindow).not.toHaveBeenCalled()
  })

  it('reveals the primary window when a second instance is launched', () => {
    const { app, getSecondInstanceHandler } = createFakeApp(true)
    const revealPrimaryWindow = vi.fn()

    const ownsLock = installSingleInstanceLock(app, revealPrimaryWindow)

    expect(ownsLock).toBe(true)
    expect(app.quit).not.toHaveBeenCalled()
    expect(app.on).toHaveBeenCalledWith('second-instance', expect.any(Function))

    getSecondInstanceHandler()?.({}, [])

    expect(revealPrimaryWindow).toHaveBeenCalledOnce()
  })

  it('forwards second-instance launch arguments before revealing the window', () => {
    const { app, getSecondInstanceHandler } = createFakeApp(true)
    const order: string[] = []
    const revealPrimaryWindow = vi.fn(() => order.push('reveal'))
    const handleArguments = vi.fn(() => order.push('arguments'))
    installSingleInstanceLock(app, revealPrimaryWindow, handleArguments)

    const commandLine = ['Spark Agent.exe', 'spark-agent://redeem?code=CODE-1']
    getSecondInstanceHandler()?.({}, commandLine)

    expect(handleArguments).toHaveBeenCalledWith(commandLine)
    expect(order).toEqual(['arguments', 'reveal'])
  })
})
