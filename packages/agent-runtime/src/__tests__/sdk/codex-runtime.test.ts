import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  codexTargetTriple,
  readManagedCodexRuntimeState,
  resolveManagedCodexCli,
} from '../../sdk/codex-runtime.js'

describe('managed Codex runtime resolver', () => {
  it('maps the current platform to the Codex target triple', () => {
    expect(codexTargetTriple('darwin', 'arm64')).toBe('aarch64-apple-darwin')
    expect(codexTargetTriple('darwin', 'x64')).toBe('x86_64-apple-darwin')
    expect(codexTargetTriple('win32', 'x64')).toBe('x86_64-pc-windows-msvc')
    expect(codexTargetTriple('win32', 'arm64')).toBe('aarch64-pc-windows-msvc')
    expect(codexTargetTriple('linux', 'arm64')).toBe('aarch64-unknown-linux-musl')
    expect(codexTargetTriple('linux', 'x64')).toBe('x86_64-unknown-linux-musl')
  })

  it('only resolves an active runtime after its executable and manifest exist', () => {
    const root = join(tmpdir(), `spark-codex-runtime-${Date.now()}`)
    const triple = codexTargetTriple()!
    const packageRoot = join(root, '0.144.5', triple)
    try {
      mkdirSync(join(packageRoot, 'bin'), { recursive: true })
      writeFileSync(
        join(root, 'active.json'),
        JSON.stringify({ version: '0.144.5', targetTriple: triple }),
      )
      expect(resolveManagedCodexCli(root)).toBeNull()

      writeFileSync(
        join(packageRoot, 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex'),
        '',
      )
      writeFileSync(join(packageRoot, 'codex-package.json'), '{}')
      const resolved = resolveManagedCodexCli(root)
      expect(resolved?.version).toBe('0.144.5')
      expect(resolved?.targetTriple).toBe(triple)
      expect(readManagedCodexRuntimeState(root).installed).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
