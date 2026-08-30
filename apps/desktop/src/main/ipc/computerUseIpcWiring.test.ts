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

    // IPC bootstrap 不直接持有 Computer Use 服务；timeline 记录收敛到 registrar 内部，
    // 由 registerComputerUseIpc 在 handler 调用时惰性解析。
    expect(source).not.toContain('timeline: getComputerUseServices().timeline')
    expect(source).not.toContain('getComputerUseServices().timeline.record(event)')
    expect(source).not.toContain('getComputerUseServices()')

    const registrar = readFileSync(new URL('./registerComputerUseIpc.ts', import.meta.url), 'utf8')
    expect(registrar).toContain('runtime.timeline.record(')
  })
})
