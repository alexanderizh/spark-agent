// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { shouldDelegateNodeDoubleClickToCollapsedGroup } from './canvasStageDoubleClick'

describe('canvas stage double click routing', () => {
  it('delegates every target inside a collapsed group to the node interaction layer', () => {
    const collapsedGroup = document.createElement('div')
    collapsedGroup.className = 'canvas-node canvas-node-collapsed-group'
    collapsedGroup.dataset.canvasNodeId = 'group-1'
    collapsedGroup.innerHTML = `
      <div class="canvas-collapsed-group-cover">
        <button aria-label="重命名节点">分组标题</button>
        <button aria-label="更改文件夹颜色">颜色</button>
      </div>
    `

    const title = collapsedGroup.querySelector('[aria-label="重命名节点"]')!
    const color = collapsedGroup.querySelector('[aria-label="更改文件夹颜色"]')!

    expect(shouldDelegateNodeDoubleClickToCollapsedGroup(collapsedGroup)).toBe(true)
    expect(shouldDelegateNodeDoubleClickToCollapsedGroup(title)).toBe(true)
    expect(shouldDelegateNodeDoubleClickToCollapsedGroup(color)).toBe(true)
  })

  it('keeps regular canvas nodes on the stage capture path', () => {
    const regularNode = document.createElement('div')
    regularNode.className = 'canvas-node canvas-node-text'
    regularNode.dataset.canvasNodeId = 'text-1'
    const content = document.createElement('div')
    regularNode.append(content)

    expect(shouldDelegateNodeDoubleClickToCollapsedGroup(content)).toBe(false)
  })
})
