// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageHoverBar } from './MessageHoverBar'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const appearanceState = vi.hoisted(() => ({
  timestampFormat: 'abs' as 'abs' | 'relative',
}))

vi.mock('../../hooks/useAppearance', () => ({
  readAppearance: () => appearanceState,
}))

describe('MessageHoverBar', () => {
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

  it('places the fork icon before delete and keeps it icon-only', () => {
    const onFork = vi.fn()
    const onDelete = vi.fn()

    act(() => {
      root.render(
        <MessageHoverBar
          timestamp="2026-08-14T00:00:00.000Z"
          textContent="内容"
          position="left"
          onFork={onFork}
          onDelete={onDelete}
        />,
      )
    })

    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.msg-hover-bar button'),
    )
    expect(buttons.map((button) => button.className)).toEqual([
      'msg-hover-copy',
      'msg-hover-fork',
      'msg-hover-delete',
    ])
    expect(buttons[1]?.textContent).toBe('')
    expect(buttons[1]?.getAttribute('aria-label')).toBe('从此处分支')

    act(() => buttons[1]?.click())
    expect(onFork).toHaveBeenCalledOnce()
  })

  it('shows and invokes the edit action when the caller marks a message editable', () => {
    const onEdit = vi.fn()
    act(() => {
      root.render(<MessageHoverBar textContent="内容" position="right" onEdit={onEdit} />)
    })

    const button = container.querySelector<HTMLButtonElement>('.msg-hover-edit')
    expect(button?.getAttribute('aria-label')).toBe('编辑消息')
    act(() => button?.click())
    expect(onEdit).toHaveBeenCalledOnce()
  })
})

describe('MessageHoverBar 语音播报按钮', () => {
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

  it('未传 onSpeechToggle（未配置 TTS）时不显示播报按钮', () => {
    act(() => {
      root.render(<MessageHoverBar textContent="内容" position="left" />)
    })
    expect(container.querySelector('.msg-hover-speech')).toBeNull()
  })

  it('正文为空时不显示播报按钮', () => {
    act(() => {
      root.render(
        <MessageHoverBar textContent="" position="left" onSpeechToggle={() => undefined} />,
      )
    })
    expect(container.querySelector('.msg-hover-speech')).toBeNull()
  })

  it('off 态展示播报图标，点击触发播报', () => {
    const onSpeechToggle = vi.fn()
    act(() => {
      root.render(
        <MessageHoverBar textContent="内容" position="left" onSpeechToggle={onSpeechToggle} />,
      )
    })
    const button = container.querySelector<HTMLButtonElement>('.msg-hover-speech')
    expect(button?.getAttribute('aria-label')).toBe('语音播报')
    expect(button?.classList.contains('is-playing')).toBe(false)
    act(() => button?.click())
    expect(onSpeechToggle).toHaveBeenCalledOnce()
  })

  it('loading 态展示加载图标，点击同样是停止（合成中可打断），标题为「停止播报」', () => {
    act(() => {
      root.render(
        <MessageHoverBar
          textContent="内容"
          position="left"
          onSpeechToggle={() => undefined}
          speechStatus="loading"
        />,
      )
    })
    const button = container.querySelector<HTMLButtonElement>('.msg-hover-speech')
    expect(button?.getAttribute('aria-label')).toBe('停止播报')
    expect(button?.querySelector('svg')?.classList.contains('spin')).toBe(true)
    expect(button?.classList.contains('is-playing')).toBe(false)
  })

  it('playing 态切声波跳动视觉与「停止播报」标题并带高亮态', () => {
    act(() => {
      root.render(
        <MessageHoverBar
          textContent="内容"
          position="left"
          onSpeechToggle={() => undefined}
          speechStatus="playing"
        />,
      )
    })
    const button = container.querySelector<HTMLButtonElement>('.msg-hover-speech')
    expect(button?.getAttribute('aria-label')).toBe('停止播报')
    expect(button?.classList.contains('is-playing')).toBe(true)
    // 声波视觉容器锁死 12×12（与图标等 footprint，不改变按钮盒与两侧间距）
    expect(button?.querySelectorAll('.speech-wave').length).toBe(4)
    expect(button?.querySelector('.speech-playing-visual')).not.toBeNull()
    // 停止提示图标存在（hover 时经 CSS 淡入），且视觉容器对读屏隐藏、aria-label 由按钮承担
    expect(button?.querySelector('.speech-stop-hint')).not.toBeNull()
    expect(button?.querySelector('.speech-playing-visual')?.getAttribute('aria-hidden')).toBe(
      'true',
    )
  })

  it('按钮顺序：播报紧随复制、位于编辑/分叉之前', () => {
    act(() => {
      root.render(
        <MessageHoverBar
          textContent="内容"
          position="left"
          onSpeechToggle={() => undefined}
          onEdit={() => undefined}
          onFork={() => undefined}
          onDelete={() => undefined}
        />,
      )
    })
    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.msg-hover-bar button'),
    )
    expect(buttons.map((button) => button.className.replace(' is-playing', ''))).toEqual([
      'msg-hover-copy',
      'msg-hover-speech',
      'msg-hover-edit',
      'msg-hover-fork',
      'msg-hover-delete',
    ])
  })
})

describe('MessageHoverBar 消息时间显示', () => {
  let container: HTMLDivElement
  let root: Root

  const pad = (n: number) => String(n).padStart(2, '0')
  // 本地时间字符串（无时区后缀按本地解析），避免用例结果随时区漂移
  const stamp = (y: number, m: number, d: number, hh: number, mm: number) =>
    `${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mm)}:00`

  beforeEach(() => {
    appearanceState.timestampFormat = 'abs'
    // 固定「今天」为 2026-09-30 15:00 本地时间
    vi.setSystemTime(new Date(2026, 8, 30, 15, 0, 0))
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    vi.useRealTimers()
    act(() => root.unmount())
    container.remove()
  })

  function renderTime(timestamp?: string): string {
    act(() => {
      root.render(<MessageHoverBar timestamp={timestamp} textContent="内容" position="left" />)
    })
    return container.querySelector('.msg-hover-time')?.textContent ?? ''
  }

  it('当天消息只显示 HH:mm', () => {
    expect(renderTime(stamp(2026, 9, 30, 9, 41))).toBe('09:41')
  })

  it('本月非当天的消息补充「日」', () => {
    expect(renderTime(stamp(2026, 9, 15, 9, 41))).toBe('15日 09:41')
  })

  it('本年非本月的消息补充「月日」', () => {
    expect(renderTime(stamp(2026, 8, 14, 8, 5))).toBe('8月14日 08:05')
  })

  it('跨年的消息补充「年月日」', () => {
    expect(renderTime(stamp(2025, 12, 1, 23, 59))).toBe('2025年12月1日 23:59')
  })

  it('相对格式下非当天消息显示日期，不再显示「N 小时前」', () => {
    appearanceState.timestampFormat = 'relative'
    expect(renderTime(stamp(2026, 9, 29, 20, 0))).toBe('29日 20:00')
  })

  it('相对格式下当天消息仍显示「N 小时前」', () => {
    appearanceState.timestampFormat = 'relative'
    expect(renderTime(stamp(2026, 9, 30, 13, 0))).toBe('2 小时前')
  })
})
