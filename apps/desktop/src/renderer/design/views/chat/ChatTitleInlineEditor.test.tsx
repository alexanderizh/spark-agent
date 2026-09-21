// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChatTitleInlineEditor } from './ChatTitleInlineEditor'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** React 把 onBlur 挂在原生 focusout 上，jsdom 里手动触发失焦要发这个事件 */
const blur = (input: HTMLInputElement) => {
  act(() => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
  })
}

const pressKey = (input: HTMLInputElement, key: string) => {
  act(() => {
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    )
  })
}

const type = (input: HTMLInputElement, value: string) => {
  act(() => {
    // 走原生 setter 再派 input 事件，否则 React 受控值不会更新
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('ChatTitleInlineEditor', () => {
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

  const render = (props: {
    value: string
    onCommit: (title: string) => void | Promise<void>
    className?: string
  }) => {
    act(() => {
      root.render(<ChatTitleInlineEditor {...props} />)
    })
  }

  const display = () => {
    const el = container.querySelector<HTMLElement>('.chat-title-text')
    if (el == null) throw new Error('chat-title-text 未渲染')
    return el
  }
  // 找不到就直接抛，比一路非空断言更贴近失败时的真实信息
  const input = () => {
    const el = container.querySelector<HTMLInputElement>('.chat-title-input')
    if (el == null) throw new Error('chat-title-input 未渲染')
    return el
  }
  const hasInput = () => container.querySelector('.chat-title-input') != null

  it('展示态渲染标题文本，点击后切成输入框并全选', () => {
    const onCommit = vi.fn()
    render({ value: '修复画布视频节点', onCommit })

    expect(display().textContent).toBe('修复画布视频节点')
    expect(hasInput()).toBe(false)

    act(() => {
      display().click()
    })

    const field = input()
    expect(field.value).toBe('修复画布视频节点')
    // 全选：一键键入即整体替换，和侧边栏悬浮卡改名一致
    expect(field.selectionStart).toBe(0)
    expect(field.selectionEnd).toBe('修复画布视频节点'.length)
  })

  it('回车保存新标题，首尾空格被裁掉', async () => {
    const onCommit = vi.fn(async () => {})
    render({ value: '旧标题', onCommit })

    act(() => {
      display().click()
    })
    type(input(), '  新标题  ')
    pressKey(input(), 'Enter')

    expect(onCommit).toHaveBeenCalledWith('新标题')
    // 提交后退出编辑态，回到展示态
    await act(async () => {})
    expect(hasInput()).toBe(false)
  })

  it('失焦同样保存', async () => {
    const onCommit = vi.fn(async () => {})
    render({ value: '旧标题', onCommit })

    act(() => {
      display().click()
    })
    type(input(), '失焦保存')
    blur(input())

    expect(onCommit).toHaveBeenCalledWith('失焦保存')
    await act(async () => {})
    expect(hasInput()).toBe(false)
  })

  it('回车后输入框卸载触发的失焦不二次提交', async () => {
    const onCommit = vi.fn(async () => {})
    render({ value: '旧标题', onCommit })

    act(() => {
      display().click()
    })
    type(input(), '只提交一次')
    pressKey(input(), 'Enter')
    // Enter 已结算，卸载时的 onBlur 再来一次也不该发出第二个请求
    blur(input())

    expect(onCommit).toHaveBeenCalledOnce()
    await act(async () => {})
  })

  it('Esc 放弃编辑，不提交', async () => {
    const onCommit = vi.fn(async () => {})
    render({ value: '旧标题', onCommit })

    act(() => {
      display().click()
    })
    type(input(), '不想保存')
    pressKey(input(), 'Escape')

    expect(onCommit).not.toHaveBeenCalled()
    await act(async () => {})
    expect(hasInput()).toBe(false)
  })

  it('空标题与未变更都不发请求', async () => {
    const onCommit = vi.fn(async () => {})
    render({ value: '旧标题', onCommit })

    // 清空后回车：空标题直接忽略，不清掉用户的会话名
    act(() => {
      display().click()
    })
    type(input(), '   ')
    pressKey(input(), 'Enter')
    expect(onCommit).not.toHaveBeenCalled()
    await act(async () => {})

    // 原样回车：没有变更也不落库
    act(() => {
      display().click()
    })
    pressKey(input(), 'Enter')
    expect(onCommit).not.toHaveBeenCalled()
    await act(async () => {})
  })

  it('落库失败时退出编辑态，不把界面卡在输入框', async () => {
    const onCommit = vi.fn(async () => {
      throw new Error('rename failed')
    })
    render({ value: '旧标题', onCommit })

    act(() => {
      display().click()
    })
    type(input(), '保存会失败')

    await act(async () => {
      pressKey(input(), 'Enter')
    })

    expect(onCommit).toHaveBeenCalledWith('保存会失败')
    expect(hasInput()).toBe(false)
  })

  it('编辑中外部标题刷新不覆盖用户输入', () => {
    const onCommit = vi.fn(async () => {})
    render({ value: '旧标题', onCommit })

    act(() => {
      display().click()
    })
    type(input(), '用户正在输入')

    // 首轮后 LLM 异步改名会推新 title 进来，编辑中以用户输入为准
    act(() => {
      root.render(
        <ChatTitleInlineEditor value="模型生成的新标题" onCommit={onCommit} />,
      )
    })

    expect(input().value).toBe('用户正在输入')
  })

  it('className 挂在槽位上，展示态与编辑态共用同一套标题样式', () => {
    const onCommit = vi.fn(async () => {})
    render({ value: '带类名', onCommit, className: 'chat-title' })

    // 展示态必须带 truncate：长标题靠省略号收边，不能因为能编辑就丢掉
    expect(display().className).toBe('chat-title-text truncate chat-title')
    act(() => {
      display().click()
    })
    expect(input().className).toBe('chat-title-input chat-title')
  })
})
