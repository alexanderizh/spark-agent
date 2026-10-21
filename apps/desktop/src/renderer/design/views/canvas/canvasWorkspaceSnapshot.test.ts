// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
  collectSelectableGroupChildNodeIds,
  isolateCanvasSnapshotContent,
  normalizeColorsForHtml2Canvas,
} from './canvasWorkspaceSnapshot'
import type { CanvasNode } from './canvas.types'

function node(id: string, overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id,
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    type: 'text',
    parentNodeId: null,
    x: 0,
    y: 0,
    width: 300,
    height: 200,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: {},
    createdAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-09T00:00:00.000Z',
    ...overrides,
  }
}

describe('collectSelectableGroupChildNodeIds', () => {
  it('只返回组的直接可选子节点，不穿透嵌套组', () => {
    const nodes = [
      node('group', { type: 'group' }),
      node('child-a', { parentNodeId: 'group' }),
      node('child-b', { parentNodeId: 'group' }),
      node('nested-group', { type: 'group', parentNodeId: 'group' }),
      node('nested-child', { parentNodeId: 'nested-group' }),
      node('outside'),
    ]

    expect(collectSelectableGroupChildNodeIds(nodes, 'group')).toEqual([
      'child-a',
      'child-b',
      'nested-group',
    ])
  })

  it('跳过隐藏和锁定子节点', () => {
    const nodes = [
      node('group', { type: 'group' }),
      node('visible', { parentNodeId: 'group' }),
      node('locked', { parentNodeId: 'group', locked: true }),
      node('hidden', { parentNodeId: 'group', hidden: true }),
    ]

    expect(collectSelectableGroupChildNodeIds(nodes, 'group')).toEqual(['visible'])
  })
})

describe('isolateCanvasSnapshotContent', () => {
  it('只保留目标内容节点并隐藏组遮罩、重叠节点和交互浮层', () => {
    document.body.innerHTML = `
      <div class="canvas-stage-area">
        <div class="canvas-stage-quick-actions">快捷操作</div>
        <div class="react-flow__edge">连线</div>
        <div class="react-flow__node selected" data-id="group">
          <div data-canvas-node-id="group" class="canvas-node canvas-node-group">组遮罩</div>
        </div>
        <div class="react-flow__node" data-id="image-a">
          <div data-canvas-node-id="image-a" class="canvas-node canvas-node-image">
            图片 A
            <div class="canvas-node-quick-footer">悬浮操作</div>
          </div>
        </div>
        <div class="react-flow__node" data-id="image-b">
          <div data-canvas-node-id="image-b" class="canvas-node canvas-node-image">图片 B</div>
        </div>
        <div class="react-flow__node" data-id="outside">
          <div data-canvas-node-id="outside" class="canvas-node canvas-node-image">重叠节点</div>
        </div>
      </div>
    `
    const stage = document.querySelector<HTMLElement>('.canvas-stage-area')
    if (!stage) throw new Error('测试画布未创建')

    isolateCanvasSnapshotContent(stage, ['image-a', 'image-b'])

    expect(stage?.classList.contains('canvas-stage-snapshot-content-only')).toBe(true)
    expect(stage?.querySelector<HTMLElement>('[data-id="group"]')?.style.visibility).toBe('hidden')
    expect(stage?.querySelector<HTMLElement>('[data-id="outside"]')?.style.visibility).toBe(
      'hidden',
    )
    expect(stage?.querySelector<HTMLElement>('[data-id="image-a"]')?.style.visibility).toBe('')
    expect(stage?.querySelector<HTMLElement>('[data-id="image-b"]')?.style.visibility).toBe('')
    expect(stage?.querySelector<HTMLElement>('.canvas-stage-quick-actions')?.style.visibility).toBe(
      'hidden',
    )
    expect(stage?.querySelector<HTMLElement>('.react-flow__edge')?.style.visibility).toBe('hidden')
    expect(stage?.querySelector<HTMLElement>('.canvas-node-quick-footer')?.style.visibility).toBe(
      'hidden',
    )
  })
})

describe('normalizeColorsForHtml2Canvas', () => {
  it('把伪元素里的现代颜色函数改写进作用域覆盖样式，还原时清理干净', () => {
    document.body.innerHTML = '<div id="share-root"><div id="share-child">内容</div></div>'
    const root = document.querySelector<HTMLElement>('#share-root')
    const child = document.querySelector<HTMLElement>('#share-child')
    if (!root || !child) throw new Error('测试节点未创建')

    const pseudoStyle = document.createElement('span').style
    pseudoStyle.setProperty('color', 'color(display-p3 1 0 0)')
    const fakeWindow = {
      getComputedStyle: (element: Element, pseudo?: string | null) =>
        element === child && pseudo === '::before'
          ? pseudoStyle
          : window.getComputedStyle(element, pseudo),
    } as unknown as Window

    const restore = normalizeColorsForHtml2Canvas(root, fakeWindow)
    expect(restore).toBeDefined()

    // 子节点带伪元素定位属性（elements 中下标 1），root 带作用域属性，覆盖样式进入 DOM。
    expect(root.getAttribute('data-html2canvas-color-scope')).toMatch(/^snapshot-\d+$/)
    expect(child.getAttribute('data-html2canvas-color-pseudo')).toBe('1')
    const override = root.querySelector('style')
    expect(override?.textContent).toContain('[data-html2canvas-color-pseudo="1"]::before')
    expect(override?.textContent).toContain('rgb(255, 0, 0)')

    restore?.()
    expect(root.getAttribute('data-html2canvas-color-scope')).toBeNull()
    expect(child.getAttribute('data-html2canvas-color-pseudo')).toBeNull()
    expect(root.querySelector('style')).toBeNull()
  })

  it('伪元素没有现代颜色函数时不注入作用域样式', () => {
    document.body.innerHTML = '<div id="plain-root"><span>文本</span></div>'
    const root = document.querySelector<HTMLElement>('#plain-root')
    if (!root) throw new Error('测试节点未创建')

    normalizeColorsForHtml2Canvas(root)

    expect(root.getAttribute('data-html2canvas-color-scope')).toBeNull()
    expect(root.querySelector('style')).toBeNull()
  })
})
