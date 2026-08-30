import type { CanvasNode } from './canvas.types'
import { getNodeCurrentSubtype } from './canvasNodeSubtypeSwitch'

const MAX_CONTEXT_NODES = 10
const TEXT_PREVIEW_LENGTH = 200

/**
 * 把当前选中节点序列化为可注入会话的上下文文本，让画布 agent 能用 node id 精准定位
 * 用户所说"这个节点"。只摘摘要，避免撑爆 prompt。
 */
export function buildSelectedNodesContext(nodes: CanvasNode[]): string {
  if (nodes.length === 0) return ''
  const limited = nodes.slice(0, MAX_CONTEXT_NODES)
  const lines = limited.map((node) => {
    const subtype = getNodeCurrentSubtype(node)
    const parts = [`- 节点 ${node.id} | 类型 ${node.type} | 子类型 ${subtype}`]
    if (node.title) parts.push(`标题「${node.title}」`)
    if (node.data.pipelineRole) parts.push(`流水线角色 ${node.data.pipelineRole}`)
    if (node.data.productionState) parts.push(`生产状态 ${node.data.productionState}`)
    if (node.type === 'text' || node.type === 'prompt') {
      const text = node.data.text ?? ''
      const preview =
        text.length > TEXT_PREVIEW_LENGTH
          ? `${text.slice(0, TEXT_PREVIEW_LENGTH)}…`
          : text
      if (preview) parts.push(`内容预览: ${preview.replace(/\n+/g, ' ')}`)
    } else if (node.type === 'image') {
      if (node.data.panorama360) parts.push('360全景图')
      if (node.data.url) parts.push(`图片地址 ${node.data.url}`)
    }
    return parts.join(' | ')
  })
  const truncated =
    nodes.length > MAX_CONTEXT_NODES
      ? `\n(还有 ${nodes.length - MAX_CONTEXT_NODES} 个选中节点未列出)`
      : ''
  return [
    `[当前选中节点]\n${lines.join('\n')}${truncated}`,
    '[节点能力使用要求] 针对以上节点行动前，先调用 canvas_get_available_actions；优先使用返回的 pipeline / recommended_flow 动作，不要绕过节点能力自行臆测下一步。',
  ].join('\n\n')
}
