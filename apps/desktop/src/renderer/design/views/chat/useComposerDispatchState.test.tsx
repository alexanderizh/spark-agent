// @vitest-environment jsdom

import React, { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useComposerDispatchState } from './useComposerDispatchState'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null

type Deferred = {
  promise: Promise<void>
  resolve(): void
  reject(error: Error): void
}

function createDeferred(): Deferred {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function DispatchButton({
  controlledDispatching,
  onDispatchStateChange,
  task,
}: {
  controlledDispatching?: boolean
  onDispatchStateChange?: (dispatching: boolean) => void
  task: Promise<void>
}) {
  const [dispatching, setDispatching] = useComposerDispatchState(
    controlledDispatching,
    onDispatchStateChange,
  )

  const dispatch = async () => {
    setDispatching(true)
    try {
      await task
    } catch {
      // Production dispatch reports the error before finally clears the loading state.
    } finally {
      setDispatching(false)
    }
  }

  return (
    <button type="button" onClick={() => void dispatch()}>
      {dispatching ? 'sending' : 'send'}
    </button>
  )
}

function RemountHarness({ task, view }: { task: Promise<void>; view: 'hero' | 'session' }) {
  const [dispatching, setDispatching] = useState(false)
  return (
    <DispatchButton
      key={view}
      controlledDispatching={dispatching}
      onDispatchStateChange={setDispatching}
      task={task}
    />
  )
}

async function render(element: React.ReactNode): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root?.render(element))
}

afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('useComposerDispatchState', () => {
  it('preserves loading across a controlled Composer remount until dispatch completes', async () => {
    const deferred = createDeferred()
    await render(<RemountHarness task={deferred.promise} view="hero" />)

    await act(async () => container?.querySelector('button')?.click())
    expect(container?.textContent).toBe('sending')

    await act(async () => {
      root?.render(<RemountHarness task={deferred.promise} view="session" />)
    })
    expect(container?.textContent).toBe('sending')

    await act(async () => deferred.resolve())
    expect(container?.textContent).toBe('send')
  })

  it('clears local loading after a failed dispatch when no parent owns the state', async () => {
    const deferred = createDeferred()
    await render(<DispatchButton task={deferred.promise} />)

    await act(async () => container?.querySelector('button')?.click())
    expect(container?.textContent).toBe('sending')

    await act(async () => deferred.reject(new Error('send failed')))
    expect(container?.textContent).toBe('send')
  })
})
