import crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import type { FileSavePastedTextRequest, FileSavePastedTextResponse } from '@spark/protocol'

const DEFAULT_BASE_NAME = 'pasted-text'
// 48 个 Unicode 字符即使按 4 字节编码，加 UUID 与扩展名后也不会超过常见文件名上限。
const MAX_BASE_NAME_CODE_POINTS = 48

export function sanitizePastedTextBaseName(suggestedBaseName?: string): string {
  const normalized = typeof suggestedBaseName === 'string' ? suggestedBaseName.trim() : ''
  const sanitized = (normalized || DEFAULT_BASE_NAME)
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  const bounded = Array.from(sanitized).slice(0, MAX_BASE_NAME_CODE_POINTS).join('')
  return bounded || DEFAULT_BASE_NAME
}

/**
 * 把会话粘贴文本写入应用级持久目录。
 *
 * 这里不能使用系统 temp：历史会话可能在数周后继续使用，Agent 仍需通过附件路径读取原文。
 */
export async function savePastedTextToUserData(
  userDataPath: string,
  request: FileSavePastedTextRequest,
  createId: () => string = () => crypto.randomUUID(),
): Promise<FileSavePastedTextResponse> {
  if (typeof request.text !== 'string' || request.text.length === 0) {
    throw new Error('text is required')
  }

  const rootDir = path.join(userDataPath, 'attachments', 'pasted-texts')
  await fs.mkdir(rootDir, { recursive: true })
  const fileName = `${sanitizePastedTextBaseName(request.suggestedBaseName)}-${createId()}.txt`
  const filePath = path.join(rootDir, fileName)
  await fs.writeFile(filePath, request.text, 'utf8')
  return { filePath, fileName }
}
