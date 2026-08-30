import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  handlers: new Map<string, (request: any) => Promise<any>>(),
}))

vi.mock('./typed-ipc.js', () => ({
  typedIpcHandle: (channel: string, handler: (request: any) => Promise<any>) => {
    harness.handlers.set(channel, handler)
  },
}))

vi.mock('@spark/shared', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import { registerPromptLibraryPackageIpc } from './registerPromptLibraryPackageIpc.js'

const PNG_DATA_URL = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')}`

function packageJson(items: unknown[], categories: string[] = ['风格']): string {
  return JSON.stringify({
    kind: 'spark.prompt-library',
    version: 1,
    exportedAt: '2026-08-26T00:00:00.000Z',
    app: 'Spark-Agent',
    categories,
    items,
  })
}

function item(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'prompt_a',
    title: '夜景城市',
    text: 'a cyberpunk city at night',
    category: '风格',
    tags: ['夜景'],
    coverUrl: PNG_DATA_URL,
    coverMimeType: 'image/png',
    usageCount: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  }
}

async function tempParent(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'spark-prompt-library-'))
}

beforeEach(() => {
  registerPromptLibraryPackageIpc()
})

describe('prompt-library:export-package', () => {
  it('writes manifest and binary cover files into a stamped package folder', async () => {
    const parent = await tempParent()
    const handler = harness.handlers.get('prompt-library:export-package')!
    const response = await handler({
      targetParentDirectory: parent,
      packageName: '我的提示词库',
      packageJson: packageJson([
        item(),
        item({ id: 'prompt_b', coverUrl: null, coverMimeType: null }),
      ]),
    })

    expect(response.exported).toBe(true)
    expect(response.exportedCount).toBe(2)
    expect(response.directoryPath).toMatch(/我的提示词库-\d{4}-\d{2}-\d{2}/)

    const entries = await readdir(response.directoryPath)
    expect(entries).toContain('prompt-library.json')

    const coversDir = join(response.directoryPath, 'covers')
    const covers = await readdir(coversDir)
    expect(covers).toHaveLength(1)
    const coverFile = covers[0] ?? ''
    expect(coverFile).toMatch(/^0001-prompt_a\.png$/)
    const bytes = await readFile(join(coversDir, coverFile))
    expect(Array.from(bytes)).toEqual([0x89, 0x50, 0x4e, 0x47])

    const manifest = JSON.parse(
      await readFile(join(response.directoryPath, 'prompt-library.json'), 'utf-8'),
    )
    expect(manifest.kind).toBe('spark.prompt-library')
    expect(manifest.items[0].coverUrl).toBeUndefined()
    expect(manifest.items[0].coverFile).toBe(`covers/${coverFile}`)
    expect(manifest.items[0].coverMimeType).toBe('image/png')
    expect(manifest.items[1].coverFile).toBeNull()
    await rm(parent, { recursive: true, force: true })
  })

  it('reports invalid payloads without throwing', async () => {
    const handler = harness.handlers.get('prompt-library:export-package')!
    const response = await handler({
      targetParentDirectory: await tempParent(),
      packageJson: JSON.stringify({ kind: 'other' }),
    })
    expect(response.exported).toBe(false)
    expect(response.error).toBeTruthy()
  })
})

describe('prompt-library:read-package', () => {
  it('round-trips an exported package with covers re-inlined as data urls', async () => {
    const parent = await tempParent()
    const exportHandler = harness.handlers.get('prompt-library:export-package')!
    const exported = await exportHandler({
      targetParentDirectory: parent,
      packageJson: packageJson([item()]),
    })
    expect(exported.exported).toBe(true)

    const readHandler = harness.handlers.get('prompt-library:read-package')!
    const response = await readHandler({ directory: exported.directoryPath })
    expect(response.found).toBe(true)

    const payload = JSON.parse(response.packageJson)
    expect(payload.items).toHaveLength(1)
    expect(payload.items[0].coverFile).toBeUndefined()
    expect(payload.items[0].coverUrl).toBe(PNG_DATA_URL)
    await rm(parent, { recursive: true, force: true })
  })

  it('returns found:false for folders without a manifest', async () => {
    const parent = await tempParent()
    const readHandler = harness.handlers.get('prompt-library:read-package')!
    const response = await readHandler({ directory: parent })
    expect(response.found).toBe(false)
    expect(response.error).toBeTruthy()
    await rm(parent, { recursive: true, force: true })
  })

  it('drops covers that escape the package or exceed the allowed extension list', async () => {
    const parent = await tempParent()
    await writeFile(
      join(parent, 'prompt-library.json'),
      packageJson([
        item({ id: 'evil', coverFile: '../../../etc/passwd.png' }),
        item({ id: 'bad_ext', coverFile: 'covers/bad.exe' }),
        item({ id: 'missing', coverFile: 'covers/ghost.png' }),
      ]),
      'utf-8',
    )

    const readHandler = harness.handlers.get('prompt-library:read-package')!
    const response = await readHandler({ directory: parent })
    expect(response.found).toBe(true)
    const payload = JSON.parse(response.packageJson)
    for (const entry of payload.items) {
      expect(entry.coverUrl).toBeNull()
    }
    await rm(parent, { recursive: true, force: true })
  })

  it('re-inlines hand-placed cover files with a mime type derived from the extension', async () => {
    const parent = await tempParent()
    await mkdir(join(parent, 'covers'), { recursive: true })
    await writeFile(join(parent, 'covers', '0001-x.jpg'), Buffer.from([1, 2, 3]))
    await writeFile(
      join(parent, 'prompt-library.json'),
      packageJson([
        item({ id: 'x', coverUrl: undefined, coverFile: 'covers/0001-x.jpg', coverMimeType: null }),
      ]),
      'utf-8',
    )

    const readHandler = harness.handlers.get('prompt-library:read-package')!
    const response = await readHandler({ directory: parent })
    const payload = JSON.parse(response.packageJson)
    expect(payload.items[0].coverUrl).toBe(
      `data:image/jpeg;base64,${Buffer.from([1, 2, 3]).toString('base64')}`,
    )
    await rm(parent, { recursive: true, force: true })
  })
})
