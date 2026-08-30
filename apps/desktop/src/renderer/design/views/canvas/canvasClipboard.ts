/**
 * 画布节点工具栏「复制内容到剪贴板」能力。
 *
 * 资源节点（text / image / prompt）复制节点的文本字段或主图 URL；
 * 任务节点（image_to_image / text_generate 等）复制当前激活产物
 * （CanvasNode.activeOperationOutput）—— 与节点视觉显示一致。
 *
 * 渲染端 CSP `connect-src` 不含 `data:`，因此 `data:` URL 必须经过
 * dataUrlToBlob 手动解码，不能直接 `fetch`；safe-file:// / http(s)://
 * 走标准 fetch 拿 Blob，再写 ClipboardItem。
 *
 * 设计要点：
 *  - 图片复制失败直接抛错：原实现降级到 writeText(url) 会把
 *    safe-file://x/<base64> 这种内部 URL 塞进剪贴板，粘贴出来不是图片
 *    而是项目私有的协议字符串，给用户造成困扰。失败时让上层 toast
 *    报错即可，不偷塞任何东西。
 *  - 多产物 / 无产物 → canCopyNodeContent 返回 none，按钮 disabled；
 *  - 文本降级：纯文本节点没内容 → canCopyNodeContent 返回 none。
 */

import { dataUrlToBlob } from './canvas-safe-file'
import { resolveCanvasNodeMediaUrl } from './CanvasNodeMediaPreview'
import type { CanvasOperationOutputView } from './canvasOperationRuns'
import type { CanvasNode as SparkCanvasNode } from './canvas.types'

export type CanvasClipboardSupport = {
  kind: 'text' | 'image' | 'none'
  /** none 时给出原因，供 UI 在 tooltip 展示。 */
  reason?: string
}

const TEXT_NODE_TYPES = new Set(['text', 'prompt'])
const IMAGE_NODE_TYPES = new Set(['image'])

/** 任务节点「当前显示产物」是否可作为单一可复制内容。 */
function singleOutputAvailability(
  output: CanvasOperationOutputView | null | undefined,
): 'text' | 'image' | null {
  if (!output) return null
  const text = output.text?.trim()
  if (text) return 'text'
  // 看实际可访问的 URL/路径，不依赖 output.type：image 类型但无 url 仍是不可复制内容。
  if (output.url || output.filePath) return 'image'
  return null
}

/**
 * 判断节点 + 当前任务产物是否可复制内容到剪贴板。
 * UI 据此决定按钮显隐 / disabled。
 */
export function canCopyNodeContent(
  node: Pick<SparkCanvasNode, 'type' | 'data'>,
  output?: CanvasOperationOutputView | null,
): CanvasClipboardSupport {
  // 资源节点（text / image / prompt）
  if (TEXT_NODE_TYPES.has(node.type)) {
    const text = (node.data.text ?? '').trim()
    return text ? { kind: 'text' } : { kind: 'none', reason: '节点暂无文本' }
  }
  if (IMAGE_NODE_TYPES.has(node.type)) {
    const url = node.data.url ?? node.data.thumbnailUrl ?? ''
    return url ? { kind: 'image' } : { kind: 'none', reason: '节点暂无图片' }
  }

  // 任务节点：用调用方传入的「当前显示产物」
  const availability = singleOutputAvailability(output)
  if (availability) return { kind: availability }
  return { kind: 'none', reason: '任务尚未产出可复制内容' }
}

/** 写文本到剪贴板。失败抛错，调用方按需 toast。 */
export async function copyTextToClipboard(text: string): Promise<void> {
  if (!text) throw new Error('没有可复制的文本')
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    throw new Error('当前环境不支持剪贴板')
  }
  await navigator.clipboard.writeText(text)
}

/** 写图片 Blob 到剪贴板。 */
export async function copyImageBlobToClipboard(blob: Blob): Promise<void> {
  if (!blob) throw new Error('没有可复制的图片')
  const ClipboardItemCtor = (window as unknown as { ClipboardItem?: typeof ClipboardItem })
    .ClipboardItem
  if (typeof ClipboardItemCtor !== 'function' || !navigator.clipboard?.write) {
    throw new Error('当前环境不支持复制图片')
  }
  await navigator.clipboard.write([new ClipboardItemCtor({ [blob.type || 'image/png']: blob })])
}

/**
 * 把任意形态的资源 URL 转成 Blob。
 * - data: URL：dataUrlToBlob 手动解码（不 fetch，避开 CSP）
 * - safe-file: / http(s) / blob: / 本地绝对路径：fetch 拿 Blob
 * - 空字符串或不支持的形态：抛错
 */
export async function loadImageBlobFromUrl(src: string): Promise<Blob> {
  const resolved = resolveCanvasNodeMediaUrl(src)
  if (!resolved) throw new Error('无效的图片 URL')
  if (resolved.startsWith('data:')) return dataUrlToBlob(resolved)
  const response = await fetch(resolved)
  if (!response.ok) throw new Error(`无法读取图片数据（${response.status}）`)
  return response.blob()
}

/**
 * 把图片 URL 复制到剪贴板：URL → Blob → clipboard.write([ClipboardItem])。
 * 失败抛错，调用方按需 toast 或降级到 writeText。
 */
export async function copyImageFromUrl(src: string): Promise<void> {
  const blob = await loadImageBlobFromUrl(src)
  await copyImageBlobToClipboard(blob)
}

/** 节点 → 文本字段 / 图片 URL 解析候选。 */
function resolveCopyCandidate(
  node: Pick<SparkCanvasNode, 'type' | 'data'>,
  output?: CanvasOperationOutputView | null,
): { kind: 'text' | 'image'; value: string } | null {
  if (TEXT_NODE_TYPES.has(node.type)) {
    const text = (node.data.text ?? '').trim()
    return text ? { kind: 'text', value: text } : null
  }
  if (IMAGE_NODE_TYPES.has(node.type)) {
    const url = node.data.url ?? node.data.thumbnailUrl ?? ''
    return url ? { kind: 'image', value: url } : null
  }
  if (!output) return null
  const text = output.text?.trim()
  if (text) return { kind: 'text', value: text }
  const imageUrl = output.url ?? output.filePath ?? ''
  if (imageUrl) return { kind: 'image', value: imageUrl }
  return null
}

/**
 * 复制节点的「当前显示内容」到剪贴板。
 * - 文本节点 → writeText
 * - 图片节点 / 任务产物为图片 → ClipboardItem
 * - 任务产物为文本 → writeText
 * - 异常时：图片分支失败直接抛错，由上层 toast 报错，不再降级到 writeText
 *   （降级会把 safe-file://x/<base64> 这种内部协议字符串塞进剪贴板）。
 */
export async function copyNodeContentToClipboard(
  node: Pick<SparkCanvasNode, 'type' | 'data'>,
  output?: CanvasOperationOutputView | null,
): Promise<CanvasClipboardSupport> {
  const support = canCopyNodeContent(node, output)
  if (support.kind === 'none') return support

  const candidate = resolveCopyCandidate(node, output)
  if (!candidate) {
    return { kind: 'none', reason: '节点没有可复制内容' }
  }

  if (candidate.kind === 'text') {
    await copyTextToClipboard(candidate.value)
    return { kind: 'text' }
  }

  // 图片：失败不降级，直接抛错由上层 toast。
  await copyImageFromUrl(candidate.value)
  return { kind: 'image' }
}
