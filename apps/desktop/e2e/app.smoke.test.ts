/**
 * E2E 冒烟测试 — Spark Agent Desktop
 *
 * 静态验证：应用元数据、IPC channel 覆盖率、设计 token 完整性。
 * 不依赖 Electron 运行时，纯 Node.js 文件读取。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..')

describe('App Smoke Tests', () => {
  it('should have correct app metadata', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')) as Record<string, unknown>
    expect(pkg.name).toBe('@spark/desktop-dev')
    expect(typeof pkg.version).toBe('string')
    expect((pkg.version as string)).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('should register all IPC channels defined in protocol', () => {
    const protocolSrc = readFileSync(
      join(ROOT, '../../packages/protocol/src/ipc/index.ts'),
      'utf-8',
    )
    const handlerSrc = readFileSync(
      join(ROOT, 'src/main/ipc/index.ts'),
      'utf-8',
    )
    const mapBlock = protocolSrc.slice(
      protocolSrc.indexOf('export interface IpcChannelMap {'),
      protocolSrc.indexOf('\n}', protocolSrc.indexOf('export interface IpcChannelMap {')),
    )
    const defined = [...new Set((mapBlock.match(/'[a-z]+:[a-z-]+'/g) ?? []).map((m) => m.slice(1, -1)))]
    const registered = [...new Set((handlerSrc.match(/'[a-z]+:[a-z-]+'/g) ?? []).map((m) => m.slice(1, -1)))]
    const missing = defined.filter((ch) => !registered.includes(ch))
    expect(missing, `Unregistered channels: ${missing.join(', ')}`).toHaveLength(0)
    expect(defined.length).toBeGreaterThanOrEqual(19)
  })

  it('should have design tokens CSS with core variables', () => {
    const css = readFileSync(
      join(ROOT, 'src/renderer/design/styles/styles.css'),
      'utf-8',
    )
    for (const token of ['--bg', '--panel', '--primary', '--text']) {
      expect(css, `Missing token: ${token}`).toContain(token)
    }
  })

  it.todo('should launch Electron window and render Home page')
  it.todo('should navigate to Settings via sidebar')
})
