import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const stageSource = readFileSync(new URL('./CanvasStage.tsx', import.meta.url), 'utf8')
const nodeSource = readFileSync(new URL('./CanvasNode.tsx', import.meta.url), 'utf8')
const collapsedGroupSource = readFileSync(
  new URL('./CanvasCollapsedGroup.tsx', import.meta.url),
  'utf8',
)
const collapsedGroupStyles = readFileSync(
  new URL('./CanvasCollapsedGroup.less', import.meta.url),
  'utf8',
)
const cinematicStyles = readFileSync(new URL('./cinematic/nodes.less', import.meta.url), 'utf8')

describe('canvas collapsible group integration', () => {
  it('applies the collapse projection after the operation projection', () => {
    expect(stageSource).toContain('buildCanvasGroupCollapseProjection')
    expect(stageSource).toContain('groupCollapseProjection.visibleNodes.map')
    expect(stageSource).toContain('groupCollapseProjection.visibleEdges')
    expect(stageSource).toContain('collapsedGroupPresentation')
    expect(stageSource).toContain('shouldDelegateNodeDoubleClickToCollapsedGroup(target)')
  })

  it('renders the folder cover and toggles group state without changing regular edit behavior', () => {
    expect(nodeSource).toContain('canvas-node-collapsed-group')
    expect(nodeSource).toContain("import { CanvasCollapsedGroup } from './CanvasCollapsedGroup'")
    expect(nodeSource).toContain('<CanvasCollapsedGroup')
    expect(nodeSource).toContain("collapsedGroupPresentation ? '展开编组' : '折叠编组'")
    expect(nodeSource).toContain('collapsed: !collapsedGroupPresentation')
    expect(nodeSource).toContain('aria-label="折叠编组"')
    expect(nodeSource).toContain("actions.updateNodeData?.(node.id, { collapsed: true })")
    expect(nodeSource).toContain('actions.editNode(node.id)')
    expect(collapsedGroupSource).toContain('viewBox="0 0 420 360"')
    expect(collapsedGroupSource).toContain('activation="doubleClick"')
    expect(collapsedGroupSource).toContain('canvas-collapsed-group-color-trigger')
    expect(collapsedGroupSource).toContain('canvas-collapsed-group-color-palette')
    expect(collapsedGroupSource).toContain('aria-label="展开编组"')
    expect(nodeSource).toContain("onExpand={() => actions.updateNodeData?.(node.id, { collapsed: false })}")
  })

  it('keeps the three-layer inserted-card motion accessible across themes', () => {
    expect(collapsedGroupSource).toContain("import './CanvasCollapsedGroup.less'")
    expect(collapsedGroupStyles).toContain('.canvas-collapsed-group-back')
    expect(collapsedGroupStyles).toContain('.canvas-collapsed-group-insert')
    expect(collapsedGroupStyles).toContain('.canvas-collapsed-group-front')
    expect(collapsedGroupStyles).toContain("[data-group-color='purple']")
    expect(collapsedGroupStyles).toContain('.canvas-collapsed-group-color-trigger')
    expect(collapsedGroupStyles).toContain('.canvas-collapsed-group-color-palette')
    expect(collapsedGroupStyles).toContain('.canvas-node-collapsed-group:hover')
    expect(collapsedGroupStyles).toContain('@media (prefers-reduced-motion: reduce)')
    expect(cinematicStyles).toContain('.canvas-node-collapsed-group')
  })
})
