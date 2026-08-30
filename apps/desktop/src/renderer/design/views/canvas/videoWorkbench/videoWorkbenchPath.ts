import { decodeCanvasSafeFileUrl } from '../canvas-safe-file'

/** 将工作台资源 URL 解析为 FFmpeg 可读取的磁盘绝对路径。 */
export function resolveVideoWorkbenchDiskPath(url: string): string {
  if (!url) return ''
  return decodeCanvasSafeFileUrl(url) ?? url
}
