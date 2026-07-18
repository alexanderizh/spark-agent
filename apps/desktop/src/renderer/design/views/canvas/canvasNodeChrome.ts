import { isOperationNode } from './canvas.capabilities'
import { isFullBleedCanvasImageNode } from './canvasImageNodePresentation'
import { isRenderableShotScriptText } from './canvasShotScriptPresentation'
import type { CanvasNode } from './canvas.types'

export const CANVAS_NODE_CONTENT_TITLE_HEIGHT = 52
export const CANVAS_NODE_QUICK_FOOTER_HEIGHT = 35

function isRenderedShotScript(node: CanvasNode): boolean {
  return node.type === 'text' && isRenderableShotScriptText(node.data.text)
}

export function canvasNodeHasContentTitle(node: CanvasNode): boolean {
  if (isOperationNode(node) || isRenderedShotScript(node)) return false
  return ['text', 'prompt', 'image', 'audio', 'video'].includes(node.type)
}

/**
 * V4 在持久化节点正文尺寸之外渲染的固定卡片行。
 * React Flow 需要把它们计入视图高度；保存尺寸时再由布局层扣回。
 */
export function canvasNodeChromeExtraHeight(node: CanvasNode): number {
  if (isFullBleedCanvasImageNode(node)) return 0
  return (
    CANVAS_NODE_QUICK_FOOTER_HEIGHT +
    (canvasNodeHasContentTitle(node) ? CANVAS_NODE_CONTENT_TITLE_HEIGHT : 0)
  )
}
