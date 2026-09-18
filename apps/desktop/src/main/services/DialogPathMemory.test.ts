import { beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// electron 在 vitest node 环境不可加载；mock 掉 app(dialog) 的最小子集。
const showOpenDialog = vi.fn()
const showSaveDialog = vi.fn()
const userDataDir = join(tmpdir(), `dialog-path-memory-test-${process.pid}`)

vi.mock('electron', () => ({
  app: { getPath: (_name: string) => userDataDir },
  dialog: {
    showOpenDialog: (...args: unknown[]) => showOpenDialog(...args),
    showSaveDialog: (...args: unknown[]) => showSaveDialog(...args),
  },
}))

async function importModule() {
  return import('./DialogPathMemory')
}

function makeRealDir(name: string): string {
  const dir = join(tmpdir(), `dialog-path-memory-dir-${process.pid}-${name}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

beforeEach(() => {
  rmSync(userDataDir, { recursive: true, force: true })
  mkdirSync(userDataDir, { recursive: true })
  showOpenDialog.mockReset()
  showSaveDialog.mockReset()
  showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
  showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined })
  vi.resetModules()
})

describe('DialogPathMemory', () => {
  it('injects the remembered open directory when the caller does not pass defaultPath', async () => {
    const openDir = makeRealDir('open')
    writeFileSync(
      join(userDataDir, 'dialog-path-memory.json'),
      JSON.stringify({ lastOpenDir: openDir }),
      'utf8',
    )
    const mod = await importModule()

    await mod.showTrackedOpenDialog({ properties: ['openFile'] })

    expect(showOpenDialog).toHaveBeenCalledWith({
      properties: ['openFile'],
      defaultPath: openDir,
    })
  })

  it('keeps an explicit defaultPath and remembers the chosen directory after success', async () => {
    const chosenDir = makeRealDir('chosen')
    const mod = await importModule()
    showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [join(chosenDir, 'a.png')],
    })

    const result = await mod.showTrackedOpenDialog({
      properties: ['openFile'],
      defaultPath: '/tmp/explicit',
    })

    expect(showOpenDialog).toHaveBeenCalledWith({
      properties: ['openFile'],
      defaultPath: '/tmp/explicit',
    })
    expect(result.canceled).toBe(false)
    const saved = JSON.parse(readStateFile()) as { lastOpenDir?: string }
    expect(saved.lastOpenDir).toBe(chosenDir)
  })

  it('joins a filename-only save defaultPath with the remembered save directory', async () => {
    const saveDir = makeRealDir('save')
    writeFileSync(
      join(userDataDir, 'dialog-path-memory.json'),
      JSON.stringify({ lastSaveDir: saveDir }),
      'utf8',
    )
    const mod = await importModule()
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: join(saveDir, 'out.json') })

    await mod.showTrackedSaveDialog({ defaultPath: 'out.json' })

    expect(showSaveDialog).toHaveBeenCalledWith({
      defaultPath: join(saveDir, 'out.json'),
    })
  })

  it('ignores remembered directories that no longer exist on disk', async () => {
    writeFileSync(
      join(userDataDir, 'dialog-path-memory.json'),
      JSON.stringify({ lastOpenDir: '/tmp/does-not-exist-anywhere' }),
      'utf8',
    )
    const mod = await importModule()

    await mod.showTrackedOpenDialog({ properties: ['openFile'] })

    expect(showOpenDialog).toHaveBeenCalledWith({ properties: ['openFile'] })
  })

  it('does not persist anything when the dialog is canceled', async () => {
    const mod = await importModule()
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })

    await mod.showTrackedOpenDialog({ properties: ['openFile'] })

    expect(existsSync(join(userDataDir, 'dialog-path-memory.json'))).toBe(false)
  })
})

function readStateFile(): string {
  return readFileSync(join(userDataDir, 'dialog-path-memory.json'), 'utf8')
}
