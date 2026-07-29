// @vitest-environment jsdom

import React, { useRef } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatTurnNavItem } from './chat-turn-navigation'

vi.mock('motion/react', async () => {
  const ReactModule = await import('react')
  const omitMotionProps = (props: Record<string, unknown>) => {
    const {
      layoutId: _layoutId,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      ...htmlProps
    } = props
    return htmlProps
  }
  return {
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => children,
    motion: {
      div: ReactModule.forwardRef<HTMLDivElement, Record<string, unknown>>((props, ref) =>
        ReactModule.createElement('div', { ...omitMotionProps(props), ref }),
      ),
      span: ReactModule.forwardRef<HTMLSpanElement, Record<string, unknown>>((props, ref) =>
        ReactModule.createElement('span', { ...omitMotionProps(props), ref }),
      ),
    },
    useReducedMotion: () => false,
  }
})

import { ChatTurnNavigator } from './ChatTurnNavigator'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

class ResizeObserverMock {
  observe() {}
  disconnect() {}
}

const items: ChatTurnNavItem[] = [
  {
    key: 'turn-1',
    turnId: 'turn-1',
    ordinal: 1,
    startMessageIndex: 0,
    messageIndexes: [0, 1],
    userPreview: '第一轮问题',
    assistantPreview: '第一轮回答',
    status: 'completed',
  },
  {
    key: 'turn-2',
    turnId: 'turn-2',
    ordinal: 2,
    startMessageIndex: 2,
    messageIndexes: [2, 3],
    userPreview: '第二轮问题',
    assistantPreview: '正在处理…',
    status: 'streaming',
  },
]

function Harness({
  onNavigate,
  onLoadOlder,
  navItems = items,
}: {
  onNavigate: (item: ChatTurnNavItem, behavior: ScrollBehavior) => void
  onLoadOlder: () => void
  navItems?: ChatTurnNavItem[]
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  return (
    <div className="test-chat-viewport">
      <div ref={scrollRef} className="chat-stream">
        <div className="chat-stream-inner">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} data-virtual-message-index={index}>
              message {index}
            </div>
          ))}
        </div>
      </div>
      <ChatTurnNavigator
        items={navItems}
        scrollRef={scrollRef}
        hasMoreHistory
        isLoadingOlder={false}
        onLoadOlder={onLoadOlder}
        onNavigate={onNavigate}
      />
    </div>
  )
}

describe('ChatTurnNavigator', () => {
  let container: HTMLDivElement
  let root: Root
  let rectSpy: ReturnType<typeof vi.spyOn>
  let contentLeft: number

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    )
    contentLeft = 150
    rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.classList.contains('test-chat-viewport')) {
        return { left: 0, right: 1200, top: 0, bottom: 700, width: 1200, height: 700 }
      }
      if (this.classList.contains('chat-stream-inner')) {
        return {
          left: contentLeft,
          right: contentLeft + 900,
          top: 0,
          bottom: 900,
          width: 900,
          height: 900,
        }
      }
      if (this.classList.contains('chat-stream')) {
        return { left: 0, right: 1200, top: 0, bottom: 700, width: 1200, height: 700 }
      }
      if (this.classList.contains('chat-turn-marker')) {
        return { left: 102, right: 134, top: 120, bottom: 131, width: 32, height: 11 }
      }
      return { left: 0, right: 100, top: 0, bottom: 40, width: 100, height: 40 }
    } as typeof HTMLElement.prototype.getBoundingClientRect)
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return this.classList?.contains('chat-stream') ? 700 : 40
      },
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    rectSpy.mockRestore()
    container.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('shows both sides of a turn on focus and navigates with smooth behavior', () => {
    const onNavigate = vi.fn()
    act(() => root.render(<Harness onNavigate={onNavigate} onLoadOlder={vi.fn()} />))

    const first = container.querySelector<HTMLButtonElement>('[aria-label^="第 1 轮"]')
    expect(first).not.toBeNull()
    act(() => first?.focus())
    act(() => vi.runOnlyPendingTimers())

    expect(document.body.textContent).toContain('第一轮问题')
    expect(document.body.textContent).toContain('第一轮回答')

    act(() => first?.click())
    expect(onNavigate).toHaveBeenCalledWith(items[0], 'smooth')
  })

  it('supports roving arrow focus and the older-history sentinel', () => {
    const onLoadOlder = vi.fn()
    act(() => root.render(<Harness onNavigate={vi.fn()} onLoadOlder={onLoadOlder} />))

    const first = container.querySelector<HTMLButtonElement>('[aria-label^="第 1 轮"]')
    const second = container.querySelector<HTMLButtonElement>('[aria-label^="第 2 轮"]')
    act(() => first?.focus())
    act(() =>
      first?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })),
    )
    expect(document.activeElement).toBe(second)

    const older = container.querySelector<HTMLButtonElement>('[aria-label="加载更早轮次"]')
    act(() => older?.click())
    expect(onLoadOlder).toHaveBeenCalledTimes(1)
  })

  it('refreshes an open streaming preview when the turn content changes', () => {
    const props = { onNavigate: vi.fn(), onLoadOlder: vi.fn() }
    act(() => root.render(<Harness {...props} />))
    const second = container.querySelector<HTMLButtonElement>('[aria-label^="第 2 轮"]')
    act(() => second?.focus())
    act(() => vi.runOnlyPendingTimers())
    expect(document.body.textContent).toContain('正在处理…')

    const updatedItems = items.map((item) =>
      item.key === 'turn-2'
        ? { ...item, assistantPreview: '新的流式回答片段', status: 'streaming' as const }
        : item,
    )
    act(() => root.render(<Harness {...props} navItems={updatedItems} />))
    expect(document.body.textContent).toContain('新的流式回答片段')
  })

  it('stays visible with the compact 28px content gutter', () => {
    contentLeft = 28
    act(() => root.render(<Harness onNavigate={vi.fn()} onLoadOlder={vi.fn()} />))

    expect(container.querySelector('[aria-label="对话轮次导航"]')).not.toBeNull()
  })
})
