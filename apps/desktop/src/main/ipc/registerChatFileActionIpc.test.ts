import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcRequest, IpcResponse } from '@spark/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerChatFileActionIpc } from './registerChatFileActionIpc'

type Handler = (input: IpcRequest<'file:chat-action'>) => Promise<IpcResponse<'file:chat-action'>>
const mocks = vi.hoisted(() => ({
  handler: undefined as Handler | undefined,
  allowed: vi.fn<(path: string) => boolean>(),
  save: vi.fn<() => Promise<{ canceled: boolean; filePath?: string }>>(),
  writeClipboard: vi.fn(),
}))

vi.mock('./typed-ipc.js', () => ({
  typedIpcHandle: (_channel: string, handler: Handler) => {
    mocks.handler = handler
  },
}))
vi.mock('electron', () => ({ clipboard: { writeText: mocks.writeClipboard } }))
vi.mock('../services/SafeFileProtocol.js', () => ({ isSafeFilePathAllowed: mocks.allowed }))
vi.mock('../services/DialogPathMemory.js', () => ({
  showTrackedSaveDialog: mocks.save,
  showTrackedOpenDialog: vi.fn(),
}))

describe('chat file actions', () => {
  let directory: string
  let source: string
  let run: Handler

  beforeEach(async () => {
    vi.resetAllMocks()
    mocks.allowed.mockReturnValue(true)
    directory = await mkdtemp(join(tmpdir(), 'spark-chat-file-test-'))
    source = join(directory, 'report.txt')
    await writeFile(source, 'content')
    registerChatFileActionIpc()
    if (!mocks.handler) throw new Error('Missing IPC handler')
    run = mocks.handler
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('copies bytes to the selected location without moving the source', async () => {
    const destination = join(directory, 'copy.txt')
    mocks.save.mockResolvedValue({ canceled: false, filePath: destination })
    await expect(run({ filePath: source, action: 'save-as' })).resolves.toEqual({ status: 'done' })
    expect(mocks.save).toHaveBeenCalledWith({ title: '另存为', defaultPath: 'report.txt' })
    expect(await readFile(destination)).toEqual(await readFile(source))
  })

  it('does not write on cancellation or when selecting the source itself', async () => {
    const destination = join(directory, 'copy.txt')
    mocks.save.mockResolvedValueOnce({ canceled: true, filePath: destination })
    await expect(run({ filePath: source, action: 'save-as' })).resolves.toEqual({
      status: 'canceled',
    })
    await expect(readFile(destination)).rejects.toMatchObject({ code: 'ENOENT' })
    mocks.save.mockResolvedValueOnce({ canceled: false, filePath: source })
    await expect(run({ filePath: source, action: 'save-as' })).resolves.toMatchObject({
      status: 'error',
    })
    expect(await readFile(source, 'utf8')).toBe('content')
  })

  it('copies text but rejects binary and oversized content', async () => {
    await expect(run({ filePath: source, action: 'copy-content' })).resolves.toEqual({
      status: 'done',
    })
    expect(mocks.writeClipboard).toHaveBeenCalledWith('content')
    mocks.writeClipboard.mockClear()
    for (const bytes of [Buffer.from([0, 1, 0, 2, 0, 3]), Buffer.alloc(2 * 1024 * 1024 + 1, 65)]) {
      await writeFile(source, bytes)
      await expect(run({ filePath: source, action: 'copy-content' })).resolves.toMatchObject({
        status: 'error',
      })
    }
    expect(mocks.writeClipboard).not.toHaveBeenCalled()
  })

  it('rejects relative, missing and disallowed files before opening a dialog', async () => {
    mocks.allowed.mockReturnValue(false)
    for (const filePath of ['report.txt', join(directory, 'missing.txt'), source]) {
      await expect(run({ filePath, action: 'save-as' })).resolves.toMatchObject({ status: 'error' })
    }
    expect(mocks.save).not.toHaveBeenCalled()
  })
})
