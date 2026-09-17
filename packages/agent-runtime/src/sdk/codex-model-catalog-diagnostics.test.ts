import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isCodexModelCatalogFailureText,
  diagnoseCodexModelCatalogFailure,
} from './codex-model-catalog-diagnostics.js'
import { isCodexModelCatalogRejected } from './codex-model-catalog.js'

/**
 * 下面的原文来自本机真实复现：codex-cli 0.144.5 解析 Spark 生成的兜底目录时
 * 由 serde 输出的错误（`codex debug models -c model_catalog_json=...`）。
 */
const REAL_LEGACY_RUNTIME_ERROR =
  'Error: Codex Exec exited with code 1: Error: failed to parse model_catalog_json ' +
  'path `/tmp/catalogprobe/v1.json` as JSON: missing field `base_instructions` ' +
  'at line 54 column 5'

describe('codex model catalog failure diagnostics', () => {
  it('recognizes the raw runtime parse error', () => {
    expect(isCodexModelCatalogFailureText(REAL_LEGACY_RUNTIME_ERROR)).toBe(true)
    expect(
      isCodexModelCatalogFailureText(
        'failed to parse model_catalog_json path `/x.json` as JSON: unknown field `foo`',
      ),
    ).toBe(true)
  })

  it('does not misfire on unrelated codex failures', () => {
    expect(isCodexModelCatalogFailureText('Codex Exec exited with code 1: 401 Unauthorized')).toBe(
      false,
    )
    expect(isCodexModelCatalogFailureText('stream error: connection reset by peer')).toBe(false)
    expect(isCodexModelCatalogFailureText('')).toBe(false)
  })

  it('turns the serde error into an actionable message', async () => {
    const diagnosis = await diagnoseCodexModelCatalogFailure({
      rawMessage: REAL_LEGACY_RUNTIME_ERROR,
      catalogPath: null,
      runtimeVersion: '0.144.5',
    })
    expect(diagnosis).not.toBeNull()
    expect(diagnosis?.code).toBe('CODEX_MODEL_CATALOG_INCOMPATIBLE')
    expect(diagnosis?.catalogDisabled).toBe(false)
    // 必须说明原因、处理方式，并保留原始错误便于定位。
    expect(diagnosis?.message).toContain('Codex 运行时拒绝了 Spark 生成的模型目录')
    expect(diagnosis?.message).toContain('0.144.5')
    expect(diagnosis?.message).toContain('设置 → 完整性')
    expect(diagnosis?.message).toContain('missing field `base_instructions`')
  })

  it('marks the rejected catalog so the next turn recovers without it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spark-codex-catalog-diagnosis-test-'))
    try {
      const catalogPath = join(dir, 'spark-model-catalog-abc.json')
      const diagnosis = await diagnoseCodexModelCatalogFailure({
        rawMessage: REAL_LEGACY_RUNTIME_ERROR,
        catalogPath,
        runtimeVersion: '0.144.5',
      })
      expect(diagnosis?.catalogDisabled).toBe(true)
      expect(isCodexModelCatalogRejected(catalogPath)).toBe(true)
      expect(diagnosis?.message).toContain('已自动停用该模型目录')
      // 升级到另一个 runtime 后旧的拒绝结论自动失效，否则用户会一直被降级。
      expect(isCodexModelCatalogRejected(catalogPath, '0.153.4')).toBe(false)
      expect(isCodexModelCatalogRejected(catalogPath, '0.144.5')).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('returns null for non-catalog failures so the caller keeps its own error', async () => {
    expect(
      await diagnoseCodexModelCatalogFailure({
        rawMessage: 'Codex Exec exited with code 1: 401 Unauthorized',
        catalogPath: '/tmp/whatever.json',
      }),
    ).toBeNull()
  })
})
