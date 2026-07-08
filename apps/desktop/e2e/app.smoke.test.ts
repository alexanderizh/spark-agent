/**
 * E2E 冒烟测试 — Spark Agent Desktop
 *
 * 静态验证：应用元数据、IPC channel 覆盖率、设计 token 完整性。
 * 不依赖 Electron 运行时，纯 Node.js 文件读取。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..')

/** 递归收集目录下的所有 .ts 文件内容，便于扫描所有 register*.ts 拆分出去的 IPC 注册文件。 */
function readAllTsUnder(dir: string): string {
  let out = ''
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules' || entry.name === 'e2e') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out += readAllTsUnder(full)
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out += readFileSync(full, 'utf-8') + '\n'
    }
  }
  return out
}

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
    // 扫描 main/ipc + main/services（registerAuthIpc / registerTerminalIpc 等都贡献 channel 注册）
    const handlerSrc =
      readAllTsUnder(join(ROOT, 'src/main/ipc')) + '\n' + readAllTsUnder(join(ROOT, 'src/main/services'))
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
