import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { sanitizePastedTextBaseName, savePastedTextToUserData } from './pastedTextStorage.js'

const cleanupRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanupRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe('savePastedTextToUserData', () => {
  it('写入 userData/attachments/pasted-texts，供历史会话持续引用', async () => {
    const userDataPath = await mkdtemp(path.join(tmpdir(), 'spark-pasted-text-user-data-'))
    cleanupRoots.push(userDataPath)

    const result = await savePastedTextToUserData(
      userDataPath,
      { text: '长期保留的会话引用', suggestedBaseName: 'pasted-text-会话引用' },
      () => 'fixed-id',
    )

    expect(result.filePath).toBe(
      path.join(userDataPath, 'attachments', 'pasted-texts', 'pasted-text-会话引用-fixed-id.txt'),
    )
    expect(result.fileName).toBe('pasted-text-会话引用-fixed-id.txt')
    await expect(readFile(result.filePath, 'utf8')).resolves.toBe('长期保留的会话引用')
  })

  it('清洗并限制建议文件名长度', () => {
    expect(sanitizePastedTextBaseName('  a/b\\c:中文  ')).toBe('a-b-c-中文')
    expect(Array.from(sanitizePastedTextBaseName('文'.repeat(80)))).toHaveLength(48)
    expect(sanitizePastedTextBaseName('？？？')).toBe('pasted-text')
  })

  it('拒绝空文本，不创建无意义附件', async () => {
    const userDataPath = await mkdtemp(path.join(tmpdir(), 'spark-pasted-text-user-data-'))
    cleanupRoots.push(userDataPath)
    await expect(savePastedTextToUserData(userDataPath, { text: '' })).rejects.toThrow(
      'text is required',
    )
    await expect(savePastedTextToUserData(userDataPath, { text: null } as never)).rejects.toThrow(
      'text is required',
    )
  })
})
