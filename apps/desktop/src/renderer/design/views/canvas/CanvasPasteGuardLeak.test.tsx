// @vitest-environment jsdom
//
// 回归防护：任务面板（CanvasOperationPanel 展开输入，即 CanvasPromptMentionTextArea
// 渲染的 Lexical contenteditable）与 agent 侧栏（ChatPanel 原生 textarea）内粘贴时，
// window 级画布 paste handler（useCanvasFileInsertion.ts / CanvasWorkspaceView.tsx）
// 必须放行，不得再把同一段文本落成画布文本节点（互斥）。

import { describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { CanvasNode } from './canvas.types'
import { CanvasPromptMentionTextArea } from './CanvasPromptMentionTextArea'
import { isEditableKeyboardTarget } from './canvasPasteGuard'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// jsdom 未实现 DragEvent / ClipboardEvent；Lexical 的 paste 命令用 instanceof 分流事件类型，
// 补 stub 消除环境噪音（不影响本测试只看 event.target 的判定）。
if (typeof (globalThis as { DragEvent?: unknown }).DragEvent === 'undefined') {
  ;(globalThis as { DragEvent?: unknown }).DragEvent = class DragEvent extends Event {}
}
if (typeof (globalThis as { ClipboardEvent?: unknown }).ClipboardEvent === 'undefined') {
  ;(globalThis as { ClipboardEvent?: unknown }).ClipboardEvent = class ClipboardEvent extends (
    Event
  ) {}
}

const mentionNode: CanvasNode = {
  id: 'hero',
  projectId: 'p',
  boardId: 'b',
  userId: 1,
  type: 'image',
  title: '小满',
  assetId: null,
  taskId: null,
  parentNodeId: null,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  zIndex: 0,
  locked: false,
  hidden: false,
  data: { url: 'https://example.com/hero.png' },
  createdAt: '',
  updatedAt: '',
}

type PasteObservation = {
  targetTag: string
  targetClass: string
  isContentEditable: boolean
  intercepted: boolean
}

function observePaste(target: Element): PasteObservation {
  const observations: PasteObservation[] = []
  const handler = (event: Event) => {
    observations.push({
      targetTag: (event.target as Element).tagName,
      targetClass: (event.target as Element).className?.toString?.() ?? '',
      isContentEditable: (event.target as HTMLElement).isContentEditable,
      intercepted: isEditableKeyboardTarget(event.target),
    })
  }
  window.addEventListener('paste', handler)
  // jsdom 无 ClipboardEvent 构造器；target 判定只依赖事件名与目标，Event 即可。
  // 补一个最小 clipboardData，避免 Lexical root 监听读 event.clipboardData.files 抛环境噪音错误。
  const event = new Event('paste', { bubbles: true })
  Object.defineProperty(event, 'clipboardData', {
    value: { files: [] as File[], items: [] as unknown as DataTransferItemList, getData: () => '' },
  })
  target.dispatchEvent(event)
  window.removeEventListener('paste', handler)
  const first = observations[0]
  expect(first, 'window paste handler 应当收到冒泡的 paste 事件').toBeDefined()
  return first!
}

describe('画布粘贴守卫 vs 面板输入框（互斥）', () => {
  it('任务面板 Lexical 提示词输入内粘贴时，window paste handler 应放行（不创建文本节点）', async () => {
    const container = window.document.createElement('div')
    window.document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <CanvasPromptMentionTextArea
          value="初始提示词"
          rows={4}
          mentionNodes={[mentionNode]}
          assets={[]}
          onChange={() => undefined}
        />,
      )
    })

    const editable = container.querySelector<HTMLElement>('.canvas-prompt-lexical-input')
    expect(editable, 'Lexical contenteditable 输入应已渲染').toBeTruthy()
    expect(editable!.getAttribute('contenteditable')).toBe('true')

    editable!.focus()
    expect(window.document.activeElement).toBe(editable)

    const observation = observePaste(editable!)
    // 核心断言：粘贴穿透 = intercepted false（画布会创建文本节点）
    expect(
      observation.intercepted,
      `粘贴 target=<${observation.targetTag} class="${observation.targetClass}"> 应被判定为可编辑`,
    ).toBe(true)

    await act(async () => {
      root.unmount()
    })
    container.remove()
  })

  it('agent 侧栏的原生 textarea 粘贴时应被 tagName 判定拦截', () => {
    const container = window.document.createElement('div')
    container.className = 'canvas-agent-modal'
    const textarea = window.document.createElement('textarea')
    textarea.className = 'chat-panel-input'
    container.appendChild(textarea)
    window.document.body.appendChild(container)

    const observation = observePaste(textarea)
    expect(observation.intercepted, 'textarea 粘贴应被 tagName 检查拦截').toBe(true)
    container.remove()
  })

  it('面板容器（canvas-operation-panel / workbench / 展开编辑容器）内任意子元素粘贴都应被白名单兜底拦截', () => {
    for (const className of [
      'canvas-operation-panel is-inline is-composer',
      'canvas-operation-workbench',
      'canvas-node-bottom-editor nodrag nopan',
    ]) {
      const container = window.document.createElement('div')
      const panel = window.document.createElement('div')
      panel.className = className
      const inner = window.document.createElement('div')
      inner.className = 'canvas-operation-composer-inputs'
      panel.appendChild(inner)
      container.appendChild(panel)
      window.document.body.appendChild(container)

      const observation = observePaste(inner)
      expect(observation.intercepted, `${className} 内粘贴应被容器白名单拦截`).toBe(true)
      container.remove()
    }
  })

  it('事件 target 落在 body 而真实焦点仍在输入框时，activeElement 兜底应放行', () => {
    const body = window.document.body
    const input = window.document.createElement('textarea')
    body.appendChild(input)
    input.focus()

    expect(isEditableKeyboardTarget(body)).toBe(true)

    input.remove()
  })

  it('焦点在画布空白处（body）且无输入焦点时，粘贴守卫应放行画布接管', () => {
    const body = window.document.body
    const canvasHost = window.document.createElement('div')
    canvasHost.className = 'canvas-stage-viewport'
    body.appendChild(canvasHost)
    canvasHost.focus?.()

    // activeElement 回落到 body（无可编辑焦点）时不得拦截，画布正常落节点
    expect(isEditableKeyboardTarget(canvasHost)).toBe(false)
    canvasHost.remove()
  })
})
