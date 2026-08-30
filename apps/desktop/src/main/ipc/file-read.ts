import { open } from 'node:fs/promises'
import type { FileReadRequest, FileReadResponse } from '@spark/protocol'
import { decodeTextFileBuffer, looksLikeBinaryTextBuffer } from '../services/TextFileEncoding.js'

const BINARY_SNIFF_BYTES = 8 * 1024

function formatMiB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

function normalizedMaxBytes(maxBytes: number | undefined): number | null {
  if (maxBytes == null) return null
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error('maxBytes must be a positive safe integer')
  }
  return maxBytes
}

/**
 * `file:read` 的可测读取核心。限制与二进制探测均发生在完整 readFile / IPC 传输之前；
 * 未传保护参数时保持旧调用方的全量文本读取行为。
 */
export async function readTextFileForRenderer(req: FileReadRequest): Promise<FileReadResponse> {
  const maxBytes = normalizedMaxBytes(req.maxBytes)
  const handle = await open(req.filePath, 'r')
  try {
    const stats = await handle.stat()
    if (!stats.isFile()) {
      return {
        error: '该路径不是文件，无法在代码编辑器中打开',
        errorCode: 'not-a-file',
        size: stats.size,
      }
    }
    if (maxBytes != null && stats.size > maxBytes) {
      return {
        error: `文件过大（${formatMiB(stats.size)}），代码编辑器最多打开 ${formatMiB(maxBytes)} 的文件`,
        errorCode: 'file-too-large',
        size: stats.size,
      }
    }

    if (req.rejectBinary === true && stats.size > 0) {
      const sample = Buffer.allocUnsafe(Math.min(stats.size, BINARY_SNIFF_BYTES))
      const { bytesRead } = await handle.read(sample, 0, sample.length, 0)
      if (looksLikeBinaryTextBuffer(sample.subarray(0, bytesRead))) {
        return {
          error: '检测到二进制内容，无法在代码编辑器中打开',
          errorCode: 'binary-file',
          size: stats.size,
        }
      }
    }

    // 上面的 sample 使用显式 position=0，不移动 FileHandle 当前偏移；这里仍从头读取。
    const buf = await handle.readFile()
    const decoded = decodeTextFileBuffer(buf)
    return { content: decoded.content, encoding: decoded.encoding, size: buf.length }
  } finally {
    await handle.close()
  }
}
