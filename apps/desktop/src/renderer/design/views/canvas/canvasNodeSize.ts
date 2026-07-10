/**
 * 画布文本节点尺寸策略（无限画布长文本支持）。
 *
 * 背景：剧本/文稿类节点常常承载几百到几千字内容，固定 280×164 的便签尺寸
 * 容纳不下，导致卡片内部需要大量滚动、阅读体验窄。
 *
 * 设计：
 * - 短文本（< LONG_TEXT_MIN_CHARS 个字符）：便签式尺寸 420×180，行距紧凑。
 * - 长文本（≥ LONG_TEXT_MIN_CHARS 个字符）：阅读式尺寸 620×560，行距宽松。
 *   卡片内部 overflow:auto 已支持滚动（CanvasWorkspaceView.less），滚动条
 *   按 .canvas-node 作用域整体隐藏，滚轮 / 触控板 / 键盘照常工作。
 *
 * 触发条件：只按 text 字符数（JS string length，与 pipelineRole 无关）；
 * 适用范围：仅影响新建节点（createTextNode 等入口），画布上已存在的节点
 *   物理尺寸保持不变，但其渲染样式仍会按当前 text 长度切换，便于旧节点
 *   编辑后内容变长时自动应用阅读样式。
 */
import { isShotScriptText, parseShotTable } from './canvasShotTableParse'

/** 升级为「长文本视图」的最小字符数（含中英文标点；不含格式标记） */
export const LONG_TEXT_MIN_CHARS = 800

/** 短文本（便签）默认尺寸 */
export const TEXT_NODE_DEFAULT_SIZE = { width: 520, height: 240 } as const

/** 长文本（阅读）默认尺寸 */
export const TEXT_NODE_LONG_SIZE = { width: 760, height: 640 } as const

/** 分镜脚本表默认尺寸：表格列多，不能使用普通文本便签尺寸。 */
export const SHOT_SCRIPT_NODE_SIZE = { width: 980, height: 620 } as const

/** NodeResizer 默认最小尺寸（便签） */
export const TEXT_NODE_DEFAULT_MIN_SIZE = { width: 340, height: 150 } as const

/** NodeResizer 长文本最小尺寸（避免拖太窄） */
export const TEXT_NODE_LONG_MIN_SIZE = { width: 560, height: 360 } as const

/** 分镜脚本表最小尺寸 */
export const SHOT_SCRIPT_NODE_MIN_SIZE = { width: 760, height: 460 } as const

/** 媒体节点默认尺寸（新建节点使用，旧节点不批量迁移） */
export const IMAGE_NODE_DEFAULT_SIZE = { width: 540, height: 340 } as const
export const VIDEO_NODE_DEFAULT_SIZE = { width: 580, height: 320 } as const
export const AUDIO_NODE_DEFAULT_SIZE = { width: 500, height: 200 } as const

/** 节点内嵌 meta 头部高度；媒体节点尺寸计算需要把它计入节点总高度。 */
export const CANVAS_NODE_META_BAR_HEIGHT = 24

/** AI 操作节点默认尺寸：加宽以容纳操作名、状态和提示摘要。 */
export const OPERATION_NODE_DEFAULT_SIZE = { width: 560, height: 230 } as const

/** 分组节点默认尺寸 */
export const GROUP_NODE_DEFAULT_SIZE = { width: 620, height: 320 } as const

/** 通用 NodeResizer 最小尺寸 */
export const CANVAS_NODE_MIN_SIZE = {
  default: { width: 340, height: 150 },
  image: { width: 380, height: 220 },
  video: { width: 400, height: 220 },
  audio: { width: 360, height: 150 },
  operation: { width: 400, height: 170 },
  group: { width: 440, height: 260 },
} as const

/** 图片节点按素材比例拟合尺寸；返回值是节点总高度，正文区域按素材比例保留。 */
export function fitCanvasImageNodeSize(
  width?: number | null,
  height?: number | null,
): { width: number; height: number } {
  if (!width || !height) return IMAGE_NODE_DEFAULT_SIZE
  const aspect = height / width
  let nodeWidth = Math.min(Math.max(width, IMAGE_NODE_DEFAULT_SIZE.width), 580)
  let bodyHeight = Math.round(nodeWidth * aspect)
  if (bodyHeight > 720) {
    bodyHeight = 720
    nodeWidth = Math.max(300, Math.round(bodyHeight / aspect))
  }
  return {
    width: Math.round(nodeWidth),
    height: Math.max(CANVAS_NODE_MIN_SIZE.image.height, bodyHeight + CANVAS_NODE_META_BAR_HEIGHT),
  }
}

/** 文本是否达到「长文本视图」阈值 */
export function isLongText(text: string | null | undefined): boolean {
  if (!text) return false
  return text.length >= LONG_TEXT_MIN_CHARS
}

/** 给定文本，返回新建文本节点的默认宽高 */
export function pickTextNodeSize(text: string | null | undefined): {
  width: number
  height: number
} {
  if (isShotScriptText(text) && parseShotTable(text ?? '').length >= 2) return SHOT_SCRIPT_NODE_SIZE
  return isLongText(text) ? TEXT_NODE_LONG_SIZE : TEXT_NODE_DEFAULT_SIZE
}

/** 给定文本，返回 NodeResizer 的最小宽高（用户拖拽下限） */
export function pickTextNodeMinSize(text: string | null | undefined): {
  width: number
  height: number
} {
  if (isShotScriptText(text) && parseShotTable(text ?? '').length >= 2) return SHOT_SCRIPT_NODE_MIN_SIZE
  return isLongText(text) ? TEXT_NODE_LONG_MIN_SIZE : TEXT_NODE_DEFAULT_MIN_SIZE
}

/** 根据节点类型返回拖拽缩放下限，避免卡片被压到内容不可用。 */
export function pickCanvasNodeMinSize(
  type: string,
  text?: string | null,
): { width: number; height: number } {
  if (type === 'text' || type === 'prompt') return pickTextNodeMinSize(text)
  if (type === 'group') return CANVAS_NODE_MIN_SIZE.group
  if (type === 'image') return CANVAS_NODE_MIN_SIZE.image
  if (type === 'video') return CANVAS_NODE_MIN_SIZE.video
  if (type === 'audio') return CANVAS_NODE_MIN_SIZE.audio
  if (type === 'task' || type.includes('_')) return CANVAS_NODE_MIN_SIZE.operation
  return CANVAS_NODE_MIN_SIZE.default
}
