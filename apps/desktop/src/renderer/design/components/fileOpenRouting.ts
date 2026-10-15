/**
 * 统一文件打开路由。
 *
 * 决定「点击一个文件后默认以哪种方式打开」：
 *   - 从代码 tab / 文件树上下文打开 → 一律进代码 tab，初始视图跟随跨文件视图偏好
 *     （useCodeViewPreference），按文件能力收窄：二进制富媒体（office / 图片 / 音视频等）
 *     只能以 preview 模式原地预览，其余文本/代码类默认源码模式；
 *   - 从聊天流消息卡片打开（FileOpenHandler 无显式 mode 的默认路由）→ 富预览类型
 *     （markdown / html / office / 图片 / 音视频）仍走独立侧面板预览 tab；
 *   - txt/log/csv 等纯文本与代码/配置类 → 代码 tab（Monaco 可编辑、带行号）；
 *   - 右键菜单可显式指定打开方式（预览 / 编辑），由 FileOpenHandler 的 opts.mode 承载。
 *
 * 路由判定只依赖扩展名（getPreviewFileType / isCodeLikeFile），无 IO。
 */

import { getFileExtension, getPreviewFileType, type PreviewFileType } from './FileDisplay'
import { isCodeLikeFile } from './code-viewer/codeLanguage'

/** 显式打开方式：preview = 预览面板；edit = 代码 tab（Monaco 编辑） */
export type FileOpenMode = 'preview' | 'edit'

/** 打开回调的可选第三参；不传 mode 时按默认路由自动分流 */
export interface FileOpenModeOpts {
  mode?: FileOpenMode
}

/**
 * 统一文件打开回调签名。
 * 与旧签名 `(filePath, fileType) => void` 兼容（第三参可选），
 * 供消息卡片 / 右键菜单 / 文件树等入口复用同一条路由链。
 */
export type FileOpenHandler = (
  filePath: string,
  fileType: PreviewFileType,
  opts?: FileOpenModeOpts,
) => void

/** csv/tsv 可被 Flyfish 以表格预览（universal），但本质是可编辑纯文本，默认仍进代码 tab */
const SPREADSHEET_TEXT_EXTENSIONS = new Set(['.csv', '.tsv'])

/**
 * 是否「富预览优先」——点击后默认进预览面板而非代码 tab。
 * md/html/office/图片/音视频返回 true；txt/log 等 'text' 类型返回 false
 * （纯文本用 Monaco 打开体验更好，仍走代码 tab）；csv/tsv 同理按纯文本处理。
 */
export function shouldPreviewFirst(filePath: string): boolean {
  const previewType = getPreviewFileType(filePath)
  if (previewType == null || previewType === 'text') return false
  if (previewType === 'universal') {
    const ext = getFileExtension(filePath).toLowerCase()
    if (SPREADSHEET_TEXT_EXTENSIONS.has(ext)) return false
  }
  return true
}

/** 右键菜单「预览」项是否可用（csv/tsv 的 Flyfish 表格预览也算显式可预览入口） */
export function canOpenPreview(filePath: string): boolean {
  const previewType = getPreviewFileType(filePath)
  return previewType != null && previewType !== 'text'
}

/** 右键菜单「编辑」项是否可用（Monaco 可编辑的代码/文本/markup 类） */
export function canOpenInEditor(filePath: string): boolean {
  return isCodeLikeFile(filePath)
}

/**
 * 文件树单击/双击的默认路由：是否以源码模式进代码编辑器（Monaco）。
 *
 * 编辑器优先：md/html/svg 等文本类富预览类型默认进编辑器源码模式，
 * 预览入口由右键菜单「预览」显式提供（canOpenPreview 白名单）；
 * 返回 false 的是 Monaco 无法承载的二进制富媒体（图片/音视频/office/pdf 等），
 * 现也统一进代码 tab，只是没有源码视图——由 useCodeViewPreference 的收窄逻辑
 * 固定以 preview 模式原地预览，不再跳独立侧面板 tab。
 */
export function shouldOpenInEditorByDefault(filePath: string): boolean {
  const previewType = getPreviewFileType(filePath)
  if (previewType == null || previewType === 'text') return true
  if (previewType === 'markdown' || previewType === 'html') return true
  const ext = getFileExtension(filePath).toLowerCase()
  // svg 属 'image' 但为 XML 文本；csv/tsv 属 'universal'（表格预览）但为可编辑纯文本
  if (ext === '.svg' || SPREADSHEET_TEXT_EXTENSIONS.has(ext)) return true
  // 其余 image / audio / video / universal（office/pdf 等）为二进制富媒体 → 编辑器内预览
  return false
}
