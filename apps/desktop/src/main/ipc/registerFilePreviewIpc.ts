import { open, readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import type { FileReadBinaryResponse } from '@spark/protocol'
import { createLogger } from '@spark/shared'
import { isSafeFilePathAllowed } from '../services/SafeFileProtocol.js'
import { typedIpcHandle } from './typed-ipc.js'

const log = createLogger('file-preview-ipc')

type ReadPreviewFileDependencies = {
  isPathAllowed: (filePath: string) => boolean
  readFileBytes: (filePath: string) => Promise<Uint8Array>
  readFileBytesUpTo?: (filePath: string, maxBytes: number) => Promise<Uint8Array | null>
}

const MAX_BOUNDED_BINARY_READ_BYTES = 20 * 1024 * 1024

async function readFileBytesUpTo(filePath: string, maxBytes: number): Promise<Uint8Array | null> {
  const file = await open(filePath, 'r')
  try {
    const fileStat = await file.stat()
    if (!fileStat.isFile()) throw new Error('预览路径不是文件')
    if (fileStat.size > maxBytes) return null

    const chunks: Buffer[] = []
    const chunkBuffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1))
    let totalBytes = 0
    while (totalBytes <= maxBytes) {
      const bytesToRead = Math.min(chunkBuffer.byteLength, maxBytes + 1 - totalBytes)
      const { bytesRead } = await file.read(chunkBuffer, 0, bytesToRead, totalBytes)
      if (bytesRead === 0) break
      totalBytes += bytesRead
      if (totalBytes > maxBytes) return null
      chunks.push(Buffer.from(chunkBuffer.subarray(0, bytesRead)))
    }

    const bytes = Buffer.concat(chunks, totalBytes)
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  } finally {
    await file.close()
  }
}

const defaultDependencies: ReadPreviewFileDependencies = {
  isPathAllowed: isSafeFilePathAllowed,
  readFileBytes: readFile,
  readFileBytesUpTo,
}

export async function readPreviewFileBinary(
  filePath: string,
  dependencies: ReadPreviewFileDependencies = defaultDependencies,
  maxBytes?: number,
): Promise<FileReadBinaryResponse> {
  if (!filePath || typeof filePath !== 'string') {
    return { error: 'filePath is required' }
  }
  if (!isAbsolute(filePath)) {
    return { error: '预览文件路径必须是绝对路径' }
  }

  const resolvedPath = resolve(filePath)
  if (!dependencies.isPathAllowed(resolvedPath)) {
    log.warn(`file:read-binary rejected path outside allowed roots: ${resolvedPath}`)
    return { error: '预览文件不在允许读取的目录中' }
  }

  try {
    let bytes: Uint8Array
    if (maxBytes != null) {
      if (
        !Number.isSafeInteger(maxBytes) ||
        maxBytes <= 0 ||
        maxBytes > MAX_BOUNDED_BINARY_READ_BYTES
      ) {
        return {
          error: `maxBytes must be a positive safe integer no greater than ${MAX_BOUNDED_BINARY_READ_BYTES}`,
        }
      }
      if (dependencies.readFileBytesUpTo == null) {
        return { error: '本次文件读取未配置安全的大小限制' }
      }
      const boundedBytes = await dependencies.readFileBytesUpTo(resolvedPath, maxBytes)
      if (boundedBytes == null) {
        return { error: `文件超过本次读取上限（${maxBytes} bytes）` }
      }
      bytes = boundedBytes
    } else {
      bytes = await dependencies.readFileBytes(resolvedPath)
    }
    const content = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer
    return { content }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.warn(`file:read-binary failed, path=${resolvedPath}, error=${message}`)
    return { error: message }
  }
}

export function registerFilePreviewIpc(): void {
  typedIpcHandle('file:read-binary', async ({ filePath, maxBytes }) =>
    readPreviewFileBinary(filePath, defaultDependencies, maxBytes),
  )
}
