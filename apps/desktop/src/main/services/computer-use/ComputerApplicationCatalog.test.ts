import { describe, expect, it, vi } from 'vitest'
import { ComputerApplicationCatalog } from './ComputerApplicationCatalog.js'

describe('ComputerApplicationCatalog', () => {
  it('discovers top-level macOS applications and caches the bounded result', async () => {
    const discover = vi.fn(async () => [
      '/Applications/Notes.app',
      '/Applications/Notes.app/Contents/Helpers/Notes Helper.app',
      '/System/Applications/Safari.app',
      '/not-an-app.txt',
    ])
    let now = 0
    const catalog = new ComputerApplicationCatalog('darwin', discover, () => now, 1_000)

    await expect(catalog.listInstalled()).resolves.toMatchObject([
      { app: { id: expect.stringMatching(/^installed-/), name: 'Notes' }, running: false },
      { app: { id: expect.stringMatching(/^installed-/), name: 'Safari' }, running: false },
    ])
    await catalog.listInstalled()
    expect(discover).toHaveBeenCalledOnce()

    now = 1_001
    await catalog.listInstalled()
    expect(discover).toHaveBeenCalledTimes(2)
  })

  it('degrades to an empty installed catalog outside macOS', async () => {
    const discover = vi.fn(async () => ['/Applications/Notes.app'])
    const catalog = new ComputerApplicationCatalog('win32', discover)

    await expect(catalog.listInstalled()).resolves.toEqual([])
    expect(discover).not.toHaveBeenCalled()
  })
})
