import { isOperationNode } from './canvas.capabilities'
import { isShotScriptText, parseShotTable } from './canvasShotTableParse'
import type { CanvasNode } from './canvas.types'

export const CANVAS_NODE_CONTENT_TITLE_HEIGHT = 52
export const CANVAS_NODE_QUICK_FOOTER_HEIGHT = 35

function isRenderedShotScript(node: CanvasNode): boolean {
  if (node.type !== 'text' || !node.data.text || !isShotScriptText(node.data.text)) return false
  return parseShotTable(node.data.text).length >= 2
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
  return (
    CANVAS_NODE_QUICK_FOOTER_HEIGHT +
    (canvasNodeHasContentTitle(node) ? CANVAS_NODE_CONTENT_TITLE_HEIGHT : 0)
  )
}
