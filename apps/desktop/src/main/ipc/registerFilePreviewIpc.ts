import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import type { FileReadBinaryResponse } from '@spark/protocol'
import { createLogger } from '@spark/shared'
import { isSafeFilePathAllowed } from '../services/SafeFileProtocol.js'
import { typedIpcHandle } from './typed-ipc.js'

const log = createLogger('file-preview-ipc')

type ReadPreviewFileDependencies = {
  isPathAllowed: (filePath: string) => boolean
  readFileBytes: (filePath: string) => Promise<Uint8Array>
}

const defaultDependencies: ReadPreviewFileDependencies = {
  isPathAllowed: isSafeFilePathAllowed,
  readFileBytes: readFile,
}

export async function readPreviewFileBinary(
  filePath: string,
  dependencies: ReadPreviewFileDependencies = defaultDependencies,
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
    const bytes = await dependencies.readFileBytes(resolvedPath)
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
  typedIpcHandle('file:read-binary', async ({ filePath }) => readPreviewFileBinary(filePath))
}
