import { isOperationNode } from './canvas.capabilities'
import { isRenderableShotScriptText } from './canvasShotScriptPresentation'
import type { CanvasNode } from './canvas.types'

export const CANVAS_NODE_CONTENT_TITLE_HEIGHT = 52
export const CANVAS_NODE_QUICK_FOOTER_HEIGHT = 35

function isRenderedShotScript(node: CanvasNode): boolean {
  return node.type === 'text' && isRenderableShotScriptText(node.data.text)
}

/**
 * Cinematic 画布把图片和视频都当作“素材本身就是节点”的扁平媒体 Frame。
 * loaded / empty 共用相同外框，避免资源加载前后节点高度因标题栏、footer 切换而跳动。
 */
export function canvasNodeUsesFlatMediaFrame(node: Pick<CanvasNode, 'type'>): boolean {
  return node.type === 'image' || node.type === 'video'
}

/** 图片节点的顶部栏优先展示用户可识别的节点名称。 */
export function resolveCanvasNodeMetaLabel(
  node: Pick<CanvasNode, 'type' | 'title'>,
  fallback: string,
): string {
  const title = node.title?.trim()
  return node.type === 'image' && title ? title : fallback
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
  if (canvasNodeUsesFlatMediaFrame(node)) return 0
  return (
    CANVAS_NODE_QUICK_FOOTER_HEIGHT +
    (canvasNodeHasContentTitle(node) ? CANVAS_NODE_CONTENT_TITLE_HEIGHT : 0)
  )
}
