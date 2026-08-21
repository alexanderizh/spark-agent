import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  MIN_SUPPORTED_MANAGED_CODEX_RUNTIME_VERSION,
  codexTargetTriple,
  readManagedCodexRuntimeState,
  resolveManagedCodexCli,
} from '../../sdk/codex-runtime.js'
import {
  isPersistentCodexRuntimeEnabled,
  persistentCodexRuntimePolicy,
} from '../../sdk/codex-app-server/codex-app-server-runtime.js'

describe('managed Codex runtime resolver', () => {
  it('enables persistent App Server by default and keeps an explicit rollback override', () => {
    expect(isPersistentCodexRuntimeEnabled({})).toBe(true)
    expect(persistentCodexRuntimePolicy({})).toEqual({ enabled: true, source: 'default' })
    expect(isPersistentCodexRuntimeEnabled({ SPARK_CODEX_PERSISTENT_RUNTIME: '0' })).toBe(false)
    expect(persistentCodexRuntimePolicy({ SPARK_CODEX_PERSISTENT_RUNTIME: '0' })).toEqual({
      enabled: false,
      source: 'environment',
    })
    expect(isPersistentCodexRuntimeEnabled({ SPARK_CODEX_PERSISTENT_RUNTIME: '1' })).toBe(true)
  })

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

  it('keeps a compatible installed runtime active after the JS SDK version changes', () => {
    const root = join(tmpdir(), `spark-codex-runtime-sdk-upgrade-${Date.now()}`)
    const triple = codexTargetTriple()!
    const version = MIN_SUPPORTED_MANAGED_CODEX_RUNTIME_VERSION
    const packageRoot = join(root, version, triple)
    const previousSdkVersion = process.env.SPARK_CODEX_SDK_VERSION
    try {
      mkdirSync(join(packageRoot, 'bin'), { recursive: true })
      writeFileSync(
        join(root, 'active.json'),
        JSON.stringify({
          version,
          targetTriple: triple,
          sdkPackage: `@openai/codex-sdk@${version}`,
        }),
      )
      writeFileSync(
        join(packageRoot, 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex'),
        '',
      )
      writeFileSync(join(packageRoot, 'codex-package.json'), JSON.stringify({ version }))
      process.env.SPARK_CODEX_SDK_VERSION = '0.149.0'

      expect(resolveManagedCodexCli(root)).toMatchObject({ version, targetTriple: triple })
      expect(readManagedCodexRuntimeState(root)).toMatchObject({ installed: true, version })
    } finally {
      if (previousSdkVersion == null) delete process.env.SPARK_CODEX_SDK_VERSION
      else process.env.SPARK_CODEX_SDK_VERSION = previousSdkVersion
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects a runtime older than the stable App Server protocol baseline', () => {
    for (const version of ['0.143.9', '0.144.5-beta.1']) {
      const root = join(tmpdir(), `spark-codex-runtime-too-old-${version}-${Date.now()}`)
      const triple = codexTargetTriple()!
      const packageRoot = join(root, version, triple)
      try {
        mkdirSync(join(packageRoot, 'bin'), { recursive: true })
        writeFileSync(join(root, 'active.json'), JSON.stringify({ version, targetTriple: triple }))
        writeFileSync(
          join(packageRoot, 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex'),
          '',
        )
        writeFileSync(join(packageRoot, 'codex-package.json'), JSON.stringify({ version }))

        expect(resolveManagedCodexCli(root)).toBeNull()
        expect(readManagedCodexRuntimeState(root)).toMatchObject({ installed: false, version })
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  })
})
