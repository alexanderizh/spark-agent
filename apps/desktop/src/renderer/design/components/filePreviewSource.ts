type BinaryFileReader = (request: { filePath: string }) => Promise<{
  content?: ArrayBuffer
  error?: string
}>

export type ViewerLoadSource =
  | { kind: 'remote'; url: string }
  | { kind: 'local'; buffer: ArrayBuffer }

export function isRemotePreviewUrl(filePath: string): boolean {
  return /^https?:\/\//i.test(filePath)
}

export function decodeSafeFileUrl(filePath: string): string | null {
  if (!filePath.startsWith('safe-file://')) return null

  try {
    const rest = filePath.slice('safe-file://'.length)
    const slashIndex = rest.indexOf('/')
    if (slashIndex < 0) return null
    const encoded = rest.slice(slashIndex + 1)
    if (!encoded) return null
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const padding = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4))
    return decodeURIComponent(escape(atob(base64 + padding)))
  } catch {
    return null
  }
}

export async function resolveViewerLoadSource(
  filePath: string,
  readBinaryFile: BinaryFileReader,
): Promise<ViewerLoadSource> {
  if (isRemotePreviewUrl(filePath)) {
    return { kind: 'remote', url: filePath }
  }

  const localPath = filePath.startsWith('safe-file://') ? decodeSafeFileUrl(filePath) : filePath
  if (!localPath) {
    throw new Error('无法解析本地预览文件路径')
  }

  const result = await readBinaryFile({ filePath: localPath })
  if (result.error) {
    throw new Error(result.error)
  }
  if (!(result.content instanceof ArrayBuffer)) {
    throw new Error('读取预览文件失败：未返回二进制内容')
  }
  return { kind: 'local', buffer: result.content }
}
