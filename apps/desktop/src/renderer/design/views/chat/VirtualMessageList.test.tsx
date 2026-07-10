// @vitest-environment jsdom

import React, { createRef } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const virtualMocks = vi.hoisted(() => ({
  measureElement: vi.fn(),
  scrollToIndex: vi.fn(),
  useVirtualizer: vi.fn(),
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: virtualMocks.useVirtualizer.mockImplementation(
    ({ count, getItemKey }: { count: number; getItemKey: (index: number) => React.Key }) => ({
      getVirtualItems: () =>
        Array.from({ length: Math.min(count, 5) }, (_, index) => ({
          index,
          key: getItemKey(index),
          start: index * 120,
          size: 120,
        })),
      getTotalSize: () => count * 120,
      measureElement: virtualMocks.measureElement,
      scrollToIndex: virtualMocks.scrollToIndex,
    }),
  ),
}))

import { VirtualMessageList, type VirtualMessageListHandle } from './VirtualMessageList'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('VirtualMessageList', () => {
  let container: HTMLDivElement
  let root: Root
  let scrollElement: HTMLDivElement
  let scrollElementRef: React.RefObject<HTMLDivElement | null>

  beforeEach(() => {
    virtualMocks.measureElement.mockClear()
    virtualMocks.scrollToIndex.mockClear()
    virtualMocks.useVirtualizer.mockClear()
    container = document.createElement('div')
    scrollElement = document.createElement('div')
    scrollElementRef = { current: scrollElement }
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('keeps long conversations to a bounded set of measured DOM rows', () => {
    const items = Array.from({ length: 100 }, (_, index) => ({ id: `message-${index}` }))

    act(() => {
      root.render(
        <VirtualMessageList
          items={items}
          scrollElementRef={scrollElementRef}
          getItemKey={(item) => item.id}
          renderItem={(item) => <div>{item.id}</div>}
        />,
      )
    })

    expect(container.querySelectorAll('[data-virtual-message-index]')).toHaveLength(5)
    expect(container.querySelector<HTMLElement>('[data-virtual-message-list]')?.style.height).toBe(
      '12000px',
    )
    expect(virtualMocks.measureElement).toHaveBeenCalledTimes(5)
  })

  it('renders short conversations normally and exposes indexed scrolling for long ones', () => {
    const handleRef = createRef<VirtualMessageListHandle>()
    const shortItems = Array.from({ length: 3 }, (_, index) => ({ id: `short-${index}` }))

    act(() => {
      root.render(
        <VirtualMessageList
          ref={handleRef}
          items={shortItems}
          scrollElementRef={scrollElementRef}
          getItemKey={(item) => item.id}
          renderItem={(item) => <div>{item.id}</div>}
        />,
      )
    })

    expect(container.querySelectorAll('[data-virtual-message-index]')).toHaveLength(3)
    expect(container.querySelector('[data-virtual-message-list]')).toBeNull()
    expect(virtualMocks.useVirtualizer).not.toHaveBeenCalled()

    const longItems = Array.from({ length: 50 }, (_, index) => ({ id: `long-${index}` }))
    act(() => {
      root.render(
        <VirtualMessageList
          ref={handleRef}
          items={longItems}
          scrollElementRef={scrollElementRef}
          getItemKey={(item) => item.id}
          renderItem={(item) => <div>{item.id}</div>}
        />,
      )
    })
    act(() => handleRef.current?.scrollToIndex(37, 'center'))

    expect(virtualMocks.scrollToIndex).toHaveBeenCalledWith(37, { align: 'center' })
  })

  it('does not add an empty list before the chat empty state', () => {
    act(() => {
      root.render(
        <VirtualMessageList
          items={[]}
          scrollElementRef={scrollElementRef}
          getItemKey={(item: { id: string }) => item.id}
          renderItem={(item) => <div>{item.id}</div>}
        />,
      )
    })

    expect(container.childElementCount).toBe(0)
  })
})
