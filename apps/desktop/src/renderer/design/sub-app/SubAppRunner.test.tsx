// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SubAppRunnerProps, SubAppRunnerState } from './useSubAppRunner'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./useSubAppRunner', () => ({
  useSubAppRunner: (): SubAppRunnerState => ({
    status: 'ready',
    errorMessage: null,
    reload: vi.fn(),
    frameSrc: 'capability-asset://subapp-runtime-test/v1',
    instanceId: 'instance-1',
    frameRef: { current: null },
  }),
}))

import { SubAppRunner } from './SubAppRunner'

describe('SubAppRunner browser-capability iframe', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('does not impose iframe sandbox restrictions on the isolated app origin', () => {
    const props = {
      appId: 'test-app',
      manifest: {
        name: 'Test app',
        description: '',
        icon: null,
        entry: 'index.html',
        surface: 'content',
        permissions: [],
      },
      source: '',
      mode: 'draft',
    } satisfies SubAppRunnerProps

    act(() => root.render(<SubAppRunner {...props} />))

    const iframe = container.querySelector('iframe')
    expect(iframe?.hasAttribute('sandbox')).toBe(false)
  })
})
