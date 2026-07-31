import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Computer Use IPC production wiring', () => {
  it('invokes both isolated registrars from the application IPC bootstrap', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

    expect(source).toContain('registerComputerUseIpc()')
    expect(source).toContain('registerApplicationSnapshotIpc()')
  })

  it('resolves Computer Use services lazily during module bootstrap', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

    expect(source).not.toContain('timeline: getComputerUseServices().timeline')
    expect(source).toContain('record: (event) => getComputerUseServices().timeline.record(event)')
  })
})
