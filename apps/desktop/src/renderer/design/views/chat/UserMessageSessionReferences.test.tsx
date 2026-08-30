// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { UserMessageSessionReferences } from './UserMessageSessionReferences'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('UserMessageSessionReferences', () => {
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

  it('renders reference tags above the user bubble content', () => {
    act(() => {
      root.render(
        <UserMessageSessionReferences
          references={[
            {
              sourceSessionId: 'source-session',
              title: '每个成员发一个 js 排序算法给我',
            },
          ]}
        />,
      )
    })

    const strip = container.querySelector('.msg-user-session-references')
    expect(strip?.getAttribute('aria-label')).toBe('参考会话')
    expect(container.querySelector('.msg-user-session-reference-chip')?.textContent).toContain(
      '每个成员发一个 js 排序算法给我',
    )
  })
})
