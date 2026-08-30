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

/**
 * loaded 视频已经由内嵌播放器承载预览与全屏操作，不能再让节点 action footer
 * 覆盖播放器底部控制条；空视频仍保留 footer，方便进入编辑补充素材。
 */
export function canvasNodeHasStandaloneActionFooter(node: CanvasNode): boolean {
  if (isOperationNode(node) || node.type === 'image') return false
  return node.type !== 'video' || !node.data.url
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
  // 音频播放器自身已经包含文件名 header，不再额外预留一条重复标题栏。
  if (node.type === 'audio' || node.type === 'extract_audio') return false
  if (isOperationNode(node) || isRenderedShotScript(node)) return false
  return ['text', 'prompt', 'image', 'audio', 'video'].includes(node.type)
}

/**
 * V4 在持久化节点正文尺寸之外渲染的固定卡片行。
 * React Flow 需要把它们计入视图高度；保存尺寸时再由布局层扣回。
 */
export function canvasNodeChromeExtraHeight(node: CanvasNode): number {
  // 操作节点不渲染 `.canvas-node-quick-footer`；继续预留会把任务产物舞台
  // 无端撑高，并让 contain 图片在多出的空间内产生上下留白。
  if (isOperationNode(node)) return 0
  if (canvasNodeUsesFlatMediaFrame(node)) return 0
  return (
    CANVAS_NODE_QUICK_FOOTER_HEIGHT +
    (canvasNodeHasContentTitle(node) ? CANVAS_NODE_CONTENT_TITLE_HEIGHT : 0)
  )
}
