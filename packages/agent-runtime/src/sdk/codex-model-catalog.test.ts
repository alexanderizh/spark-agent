import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createCodexModelCatalog,
  ensureCodexModelCatalog,
  isCodexModelCatalogRejected,
  markCodexModelCatalogRejected,
  usesLegacyModelCatalogSchema,
  withCodexModelCatalog,
  LEGACY_MODEL_CATALOG_RUNTIME_CEILING,
} from './codex-model-catalog.js'
import { buildCodexConfig } from './codex-sdk-executor.js'

describe('codex model catalog bridge', () => {
  it('overrides the selected custom model metadata without dropping the source catalog', () => {
    const catalog = createCodexModelCatalog({
      model: 'deepseek-v4.1-flash',
      contextWindowTokens: 1_000_000,
      sourceCatalog: {
        models: [
          {
            slug: 'gpt-5.5',
            display_name: 'GPT-5.5',
            context_window: 272_000,
            max_context_window: 272_000,
            model_messages: { instructions_template: 'gpt-only instructions' },
          },
        ],
      },
    })

    expect(catalog.models).toHaveLength(2)
    expect(catalog.models[0]).toMatchObject({ slug: 'gpt-5.5', context_window: 272_000 })
    expect(catalog.models[1]).toMatchObject({
      slug: 'deepseek-v4.1-flash',
      context_window: 1_000_000,
      max_context_window: 1_000_000,
      effective_context_window_percent: 100,
      auto_compact_token_limit: null,
    })
    expect(catalog.models[1]).not.toHaveProperty(
      'model_messages.instructions_template',
      'gpt-only instructions',
    )
  })

  it('writes a valid reusable catalog under the configured Codex home', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'spark-codex-catalog-test-'))
    try {
      await writeFile(
        join(codexHome, 'models_cache.json'),
        JSON.stringify({
          models: [
            {
              slug: 'gpt-5.5',
              display_name: 'GPT-5.5',
              context_window: 272_000,
              max_context_window: 272_000,
            },
          ],
        }),
        'utf8',
      )

      const catalogPath = await ensureCodexModelCatalog({
        model: 'deepseek-v4.1-flash',
        contextWindowTokens: 1_000_000,
        codexHome,
      })
      expect(catalogPath).toMatch(/^.+\/spark-model-catalog-[a-f0-9]{20}\.json$/)
      if (catalogPath == null) throw new Error('catalog path was not generated')
      const catalog = JSON.parse(await readFile(catalogPath, 'utf8')) as {
        models: Array<Record<string, unknown>>
      }
      expect(catalog.models.at(-1)).toMatchObject({
        slug: 'deepseek-v4.1-flash',
        context_window: 1_000_000,
        max_context_window: 1_000_000,
      })

      const secondPath = await ensureCodexModelCatalog({
        model: 'deepseek-v4.1-flash',
        contextWindowTokens: 1_000_000,
        codexHome,
      })
      expect(secondPath).toBe(catalogPath)
    } finally {
      await rm(codexHome, { recursive: true, force: true })
    }
  })

  it('uses the effective custom CODEX_HOME when building the executor config', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'spark-codex-catalog-config-test-'))
    try {
      const config = await withCodexModelCatalog({
        apiKey: 'test-key',
        model: 'deepseek-v4.1-flash',
        permissionMode: 'codex-default',
        workspaceRootPath: process.cwd(),
        contextWindowTokens: 1_000_000,
        customEnv: { CODEX_HOME: codexHome },
        codexCliProvider: { id: 'opencode', wireApi: 'responses' },
      })
      expect(config.codexModelCatalogPath).toBeDefined()
      if (config.codexModelCatalogPath == null) throw new Error('catalog path was not generated')
      expect(dirname(config.codexModelCatalogPath)).toBe(codexHome)
    } finally {
      await rm(codexHome, { recursive: true, force: true })
    }
  })

  it('passes the generated catalog path alongside the configured context window', () => {
    expect(
      buildCodexConfig({
        apiKey: 'test-key',
        model: 'deepseek-v4.1-flash',
        permissionMode: 'codex-default',
        workspaceRootPath: process.cwd(),
        contextWindowTokens: 1_000_000,
        codexModelCatalogPath: '/tmp/spark-model-catalog.json',
      }),
    ).toMatchObject({
      model_context_window: 1_000_000,
      model_catalog_json: '/tmp/spark-model-catalog.json',
    })
  })
  // 回归：0.144.5 等旧 native runtime 把 base_instructions 当必需字段，
  // 缺失会导致整份 catalog 解析失败、codex 进程在启动阶段退出、对话直接不可用。
  // 形状依据本仓库对 0.144.5 / 0.149.0 / 0.153.4 的 `codex debug models` 实测矩阵。
  describe('legacy runtime compatibility', () => {
    const legacySourceCatalog = {
      models: [
        {
          // 0.149+ 写出的条目：没有 base_instructions / supports_reasoning_summaries
          slug: 'gpt-5.5',
          display_name: 'GPT-5.5',
          context_window: 272_000,
          max_context_window: 272_000,
          model_messages: { instructions_template: 'gpt-only instructions' },
        },
      ],
    }

    it('always emits legacy-required fields on the synthesized fallback entry', () => {
      const catalog = createCodexModelCatalog({
        model: 'deepseek-v4.1-flash',
        contextWindowTokens: 1_000_000,
        runtimeVersion: '0.144.5',
      })
      expect(catalog.models).toHaveLength(1)
      expect(catalog.models[0]).toHaveProperty('base_instructions', '')
      expect(catalog.models[0]).toHaveProperty('supports_reasoning_summaries')
    })

    it('classifies runtimes below the verified ceiling as legacy', () => {
      expect(usesLegacyModelCatalogSchema('0.144.5')).toBe(true)
      expect(usesLegacyModelCatalogSchema('0.146.0')).toBe(true)
      expect(usesLegacyModelCatalogSchema('0.149.0')).toBe(false)
      expect(usesLegacyModelCatalogSchema('0.153.4')).toBe(false)
      expect(usesLegacyModelCatalogSchema(null)).toBe(false)
      expect(LEGACY_MODEL_CATALOG_RUNTIME_CEILING).toBe('0.149.0')
    })

    it('drops modern-shaped source entries for legacy runtimes instead of failing to parse', () => {
      const catalog = createCodexModelCatalog({
        model: 'deepseek-v4.1-flash',
        contextWindowTokens: 1_000_000,
        sourceCatalog: legacySourceCatalog,
        runtimeVersion: '0.144.5',
      })
      // 现代形状条目会让旧 runtime 拒绝整份 catalog，必须整批剔除。
      expect(catalog.models).toHaveLength(1)
      expect(catalog.models[0]).toMatchObject({ slug: 'deepseek-v4.1-flash' })
      expect(catalog.models.every((model) => model.base_instructions != null)).toBe(true)
    })

    it('keeps reusing source entries on modern runtimes', () => {
      const catalog = createCodexModelCatalog({
        model: 'deepseek-v4.1-flash',
        contextWindowTokens: 1_000_000,
        sourceCatalog: legacySourceCatalog,
        runtimeVersion: '0.153.4',
      })
      expect(catalog.models.map((model) => model.slug)).toEqual(['gpt-5.5', 'deepseek-v4.1-flash'])
    })
  })

  // 回归：目录一旦被本机 runtime 拒绝，必须停止注入而不是每轮重新失败，
  // 否则用户会陷入「修不好也进不去对话」的死循环。
  describe('rejected catalog self-healing', () => {
    it('stops injecting a catalog the runtime already rejected', async () => {
      const codexHome = await mkdtemp(join(tmpdir(), 'spark-codex-catalog-reject-test-'))
      try {
        const first = await ensureCodexModelCatalog({
          model: 'deepseek-v4.1-flash',
          contextWindowTokens: 1_000_000,
          codexHome,
          runtimeVersion: '0.144.5',
        })
        if (first == null) throw new Error('catalog path was not generated')
        expect(isCodexModelCatalogRejected(first)).toBe(false)
        expect(await markCodexModelCatalogRejected(first, '0.144.5')).toBe(true)
        expect(isCodexModelCatalogRejected(first, '0.144.5')).toBe(true)

        const second = await ensureCodexModelCatalog({
          model: 'deepseek-v4.1-flash',
          contextWindowTokens: 1_000_000,
          codexHome,
          runtimeVersion: '0.144.5',
        })
        expect(second).toBeNull()

        // 换成另一个 runtime 版本后，旧结论不再成立：目录必须重新参与注入，
        // 否则用户升级 runtime 也会被永久锁在「不注入 catalog」的降级状态。
        const afterUpgrade = await ensureCodexModelCatalog({
          model: 'deepseek-v4.1-flash',
          contextWindowTokens: 1_000_000,
          codexHome,
          runtimeVersion: '0.153.4',
        })
        expect(afterUpgrade).not.toBeNull()
      } finally {
        await rm(codexHome, { recursive: true, force: true })
      }
    })
  })
})
