/**
 * mediaArtifactActions — 产物「复制图片 / 另存为」的公用动作
 *
 * 查看器、历史右键菜单、结果面板都要做同样两件事，统一在这里实现，避免各写一份：
 *   - copyMediaImage：把已解析的展示 URL（safe-file:// / http(s):// / data:）读成 Blob
 *     再写进剪贴板。渲染端 CSP 的 connect-src 不含 data:，data: 必须走本地解码而不是 fetch。
 *   - saveMediaArtifact：弹系统保存对话框把产物另存到用户选择的位置，并记住目录，
 *     下次默认落在同一目录（与 ImagePreviewModal / MediaArtifactViewer 的历史行为一致）。
 *
 * 两者失败时都直接抛错，由调用方按自己的模板（toast / antd message）提示，不静默失败。
 */
import { dataUrlToBlob } from '../views/canvas/canvas-safe-file'
import { readLastMediaDownloadDir, writeLastMediaDownloadDir } from './mediaViewerPreferences'

/** 复制图片到剪贴板；失败抛错（含「当前环境不支持」这类环境原因）。 */
export async function copyMediaImage(src: string): Promise<void> {
  if (!src) throw new Error('没有可复制的图片')
  const blob = await loadMediaBlob(src)
  const ClipboardItemCtor = (window as unknown as { ClipboardItem?: typeof ClipboardItem })
    .ClipboardItem
  if (typeof ClipboardItemCtor !== 'function' || !navigator.clipboard?.write) {
    throw new Error('当前环境不支持复制图片，请用下载')
  }
  await navigator.clipboard.write([new ClipboardItemCtor({ [blob.type || 'image/png']: blob })])
}

/** 展示 URL → Blob。data: 走本地解码，其余（safe-file:// / http(s)://）用 fetch。 */
async function loadMediaBlob(src: string): Promise<Blob> {
  if (src.startsWith('data:')) return dataUrlToBlob(src)
  const response = await fetch(src)
  if (!response.ok) throw new Error(`无法读取图片数据（${response.status}）`)
  return response.blob()
}

export type SaveMediaResult = { saved: boolean; savedPath: string; error?: string }

/**
 * 产物另存为：源必须是本地文件（file:save-image 只接受 safe-file 白名单内的路径）。
 * 用户取消对话框时返回 saved:false 且无 error，调用方不需要提示。
 */
export async function saveMediaArtifact(input: {
  filePath?: string | undefined
  fileName?: string | undefined
}): Promise<SaveMediaResult> {
  const filePath = input.filePath
  if (!filePath) throw new Error('当前产物没有本地文件')
  if (!window.spark?.invoke) throw new Error('桌面能力尚未就绪')
  const lastDir = readLastMediaDownloadDir()
  const result = await window.spark.invoke('file:save-image', {
    sourcePath: filePath,
    ...(input.fileName ? { suggestedFileName: input.fileName } : {}),
    ...(lastDir ? { defaultDirectory: lastDir } : {}),
  })
  if (result.saved && result.savedPath) writeLastMediaDownloadDir(dirOf(result.savedPath))
  return result
}

/** 在系统文件管理器中定位产物；失败抛错或返回 error。 */
export async function revealMediaArtifact(
  filePath: string,
): Promise<{ revealed: boolean; error?: string }> {
  if (!filePath) throw new Error('当前产物没有本地文件')
  if (!window.spark?.invoke) throw new Error('桌面能力尚未就绪')
  return window.spark.invoke('file:reveal', { filePath })
}

/** 取路径的目录部分；两种分隔符都兼容（Windows 上保存对话框返回 \） */
function dirOf(filePath: string): string {
  const index = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return index > 0 ? filePath.slice(0, index) : ''
}
