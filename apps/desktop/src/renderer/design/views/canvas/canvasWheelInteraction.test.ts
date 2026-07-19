// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { findSelectedCanvasNodeScrollRegion } from './canvasWheelInteraction'

function setElementSize(
  element: HTMLElement,
  size: { clientHeight: number; scrollHeight: number; clientWidth?: number; scrollWidth?: number },
) {
  for (const [key, value] of Object.entries({
    clientHeight: size.clientHeight,
    scrollHeight: size.scrollHeight,
    clientWidth: size.clientWidth ?? 100,
    scrollWidth: size.scrollWidth ?? 100,
  })) {
    Object.defineProperty(element, key, { configurable: true, value })
  }
}

function createNode(selected: boolean, scrollClass: string) {
  const node = document.createElement('div')
  node.className = `canvas-node${selected ? ' canvas-node-selected' : ''}`
  const scrollRegion = document.createElement('div')
  scrollRegion.className = scrollClass
  const child = document.createElement('span')
  scrollRegion.append(child)
  node.append(scrollRegion)
  return { child, scrollRegion }
}

describe('findSelectedCanvasNodeScrollRegion', () => {
  it('只让已选中节点中的长文本截留滚轮', () => {
    const selected = createNode(true, 'canvas-node-text')
    const unselected = createNode(false, 'canvas-node-text')
    setElementSize(selected.scrollRegion, { clientHeight: 100, scrollHeight: 240 })
    setElementSize(unselected.scrollRegion, { clientHeight: 100, scrollHeight: 240 })

    expect(findSelectedCanvasNodeScrollRegion(selected.child)).toBe(selected.scrollRegion)
    expect(findSelectedCanvasNodeScrollRegion(unselected.child)).toBeNull()
  })

  it('覆盖分镜、资源文本和任务产物的真实滚动容器', () => {
    for (const className of [
      'canvas-node-shot-table-wrap',
      'canvas-node-resource-text-content',
      'canvas-operation-output-json',
      'canvas-operation-output-text',
      'canvas-operation-output-list-items',
    ]) {
      const { child, scrollRegion } = createNode(true, className)
      setElementSize(scrollRegion, { clientHeight: 100, scrollHeight: 101, scrollWidth: 240 })
      expect(findSelectedCanvasNodeScrollRegion(child)).toBe(scrollRegion)
    }
  })

  it('内容没有溢出时把滚轮继续交给画布', () => {
    const { child, scrollRegion } = createNode(true, 'canvas-node-text')
    setElementSize(scrollRegion, { clientHeight: 100, scrollHeight: 100 })

    expect(findSelectedCanvasNodeScrollRegion(child)).toBeNull()
  })

  it('支持选中节点旁边同属节点外壳的内联面板', () => {
    const shell = document.createElement('div')
    shell.className = 'canvas-node-shell'
    const selectedNode = document.createElement('div')
    selectedNode.className = 'canvas-node canvas-node-selected'
    const inlinePanel = document.createElement('div')
    inlinePanel.className = 'canvas-node-inline-panel'
    const child = document.createElement('span')
    inlinePanel.append(child)
    shell.append(selectedNode, inlinePanel)
    setElementSize(inlinePanel, { clientHeight: 100, scrollHeight: 240 })

    expect(findSelectedCanvasNodeScrollRegion(child)).toBe(inlinePanel)
  })
})
