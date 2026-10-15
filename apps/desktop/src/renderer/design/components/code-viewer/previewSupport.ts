/**
 * previewSupport —— 编辑器内预览（preview / split 视图）的能力判定。
 *
 * 路由约定（与 fileOpenRouting 保持同一判定源）：
 *  - canPreviewInCodeViewer：扩展名能被 FilePreviewPanel 渲染的富预览类型
 *    （markdown / html / image / audio / video / universal），纯文本 'text' 不算；
 *  - canSplitPreviewInCodeViewer：分屏 = 左 Monaco 右预览，要求「可编辑 + 可预览」
 *    同时成立（html / md / svg / csv 等）；二进制富媒体（png / mp4 / docx）编辑器
 *    读不出来，分屏无意义。
 *
 * 判定只依赖扩展名，无 IO；供 CodeViewerPanel / CodeViewerToolbar 复用。
 */

import { getPreviewFileType, getFileExtension } from '../FileDisplay'
import type { PreviewFileType } from '../FileDisplay'
import { isCodeLikeFile } from './codeLanguage'

/** 该文件能否在编辑器内容区以 preview 视图渲染（FilePreviewPanel embedded 变体可承载） */
export function canPreviewInCodeViewer(filePath: string): boolean {
  const previewType = getPreviewFileType(filePath)
  return previewType != null && previewType !== 'text'
}

/** 该文件能否使用 split 分屏视图（可编辑文本 + 可预览，如 html / md / svg / csv） */
export function canSplitPreviewInCodeViewer(filePath: string): boolean {
  return canPreviewInCodeViewer(filePath) && isCodeLikeFile(filePath)
}

/** 该文件在编辑器内预览时的渲染类型；不可预览返回 null */
export function previewTypeInCodeViewer(filePath: string): PreviewFileType | null {
  const previewType = getPreviewFileType(filePath)
  return previewType != null && previewType !== 'text' ? previewType : null
}

/** svg 属 image 类型但为 XML 文本：split 模式下可用未保存内容实时渲染 */
export function isSvgFile(filePath: string): boolean {
  return getFileExtension(filePath).toLowerCase() === '.svg'
}

/** 预览类型的中文标签（状态栏展示用） */
export function previewKindLabel(fileType: PreviewFileType): string {
  switch (fileType) {
    case 'markdown':
      return 'Markdown 预览'
    case 'html':
      return 'HTML 预览'
    case 'image':
      return '图片预览'
    case 'audio':
      return '音频预览'
    case 'video':
      return '视频预览'
    case 'universal':
      return '文档预览'
    default:
      return '预览'
  }
}
