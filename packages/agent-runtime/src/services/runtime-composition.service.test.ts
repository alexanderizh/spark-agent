import { describe, expect, it } from 'vitest'
import { RuntimeCompositionService } from './runtime-composition.service.js'
import type { SkillRow } from '@spark/storage'

function skillRow(
  overrides: Partial<SkillRow> & Pick<SkillRow, 'id' | 'name' | 'enabled'>,
): SkillRow {
  return {
    id: overrides.id,
    scope: 'user',
    name: overrides.name,
    version: '1.0.0',
    root_path: `/skills/${overrides.id}`,
    manifest_json: JSON.stringify({
      description: `${overrides.name} description`,
      source: 'Test',
      systemPrompt: `${overrides.name} instructions`,
      requiredTools: ['read_file'],
      tags: ['test'],
    }),
    enabled: overrides.enabled,
    created_at: '2026-05-27T00:00:00.000Z',
    updated_at: '2026-05-27T00:00:00.000Z',
    registry_id: null,
    remote_id: null,
    author: 'Test',
    category: 'coding',
    tags_json: '["test"]',
    rating: 0,
    download_count: 0,
    homepage_url: null,
    icon_url: null,
  }
}

function makeSkillRepo(rows: SkillRow[]) {
  return {
    list: () => rows,
    get: (id: string) => rows.find((row) => row.id === id),
  } as never
}

function makeSettingsRepo(values: Record<string, unknown>) {
  return {
    get: (category: string, key: string) => values[`${category}:${key}`] ?? null,
    set: (category: string, key: string, value: unknown) => {
      values[`${category}:${key}`] = value
    },
    delete: (category: string, key: string) => delete values[`${category}:${key}`],
  } as never
}

describe('RuntimeCompositionService', () => {
  it('merges system-visible skills with project and session selections while honoring disabled gates', () => {
    const service = new RuntimeCompositionService(
      makeSkillRepo([
        skillRow({ id: 'skill:review', name: 'Review', enabled: 1 }),
        skillRow({ id: 'skill:test', name: 'Test', enabled: 1 }),
        skillRow({ id: 'skill:hidden', name: 'Hidden', enabled: 0 }),
      ]),
      makeSettingsRepo({
        'runtime.skills:project:workspace-1': ['skill:test', 'skill:hidden'],
        'runtime.skills:session:session-1': ['skill:review', 'skill:hidden'],
        'runtime.skills.disabled:session:session-1': ['skill:test'],
      }),
    )

    const config = service.getSkillConfig({
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
    })

    expect(config.systemSkillIds).toEqual(expect.arrayContaining(['skill:review', 'skill:test']))
    expect(config.systemSkillIds).not.toContain('skill:hidden')
    expect(config.projectSkillIds).toEqual(['skill:test', 'skill:hidden'])
    expect(config.sessionSkillIds).toEqual(['skill:review', 'skill:hidden'])
    expect(config.sessionDisabledSkillIds).toEqual(['skill:test'])
    expect(config.effectiveSkillIds).toContain('skill:review')
    expect(config.effectiveSkillIds).not.toContain('skill:hidden')
    expect(config.effectiveSkillIds).not.toContain('skill:test')
  })

  it('builds layered prompt text in system, agent, project, session order', () => {
    const service = new RuntimeCompositionService(
      makeSkillRepo([]),
      makeSettingsRepo({
        'runtime.prompts:system': { enabled: true, content: 'System prompt' },
        'runtime.prompts:agent:code-agent': { enabled: true, content: 'Agent prompt' },
        'runtime.prompts:project:workspace-1': { enabled: true, content: 'Project prompt' },
        'runtime.prompts:session:session-1': { enabled: true, content: 'Session prompt' },
      }),
    )

    const result = service.getPromptConfig({
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
      agentId: 'code-agent',
    })

    expect(result.effectivePrompt).toContain('[System Prompt]\nSystem prompt')
    expect(result.effectivePrompt).toContain('[Agent Prompt]\nAgent prompt')
    expect(result.effectivePrompt).toContain('[Project Prompt]\nProject prompt')
    expect(result.effectivePrompt).toContain('[Session Prompt]\nSession prompt')
    expect(result.effectivePrompt.indexOf('System prompt')).toBeLessThan(
      result.effectivePrompt.indexOf('Agent prompt'),
    )
    expect(result.effectivePrompt.indexOf('Agent prompt')).toBeLessThan(
      result.effectivePrompt.indexOf('Project prompt'),
    )
    expect(result.effectivePrompt.indexOf('Project prompt')).toBeLessThan(
      result.effectivePrompt.indexOf('Session prompt'),
    )
  })

  it('merges env vars with session overriding project and masks values in the prompt', () => {
    const service = new RuntimeCompositionService(
      makeSkillRepo([]),
      makeSettingsRepo({
        'runtime.env:project:workspace-1': {
          enabled: true,
          vars: [
            { key: 'API_KEY', value: 'project-secret-value', description: '后端密钥' },
            { key: 'SHARED', value: 'from-project' },
          ],
        },
        'runtime.env:session:session-1': {
          enabled: true,
          vars: [{ key: 'SHARED', value: 'from-session' }],
        },
      }),
    )

    const envConfig = service.getEnvConfig({
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
    })

    // 会话级覆盖项目级同名键
    expect(envConfig.effectiveEnv.SHARED).toBe('from-session')
    expect(envConfig.effectiveEnv.API_KEY).toBe('project-secret-value')
    // 脱敏提示词只暴露键名/描述/掩码，不含真实值
    expect(envConfig.envSystemPrompt).toContain('[Environment Variables]')
    expect(envConfig.envSystemPrompt).toContain('API_KEY')
    expect(envConfig.envSystemPrompt).toContain('后端密钥')
    expect(envConfig.envSystemPrompt).not.toContain('project-secret-value')
    expect(envConfig.envSystemPrompt).not.toContain('from-session')
  })

  it('disabled env layer is ignored and empty config yields no customEnv', () => {
    const service = new RuntimeCompositionService(
      makeSkillRepo([]),
      makeSettingsRepo({
        'runtime.env:session:session-1': {
          enabled: false,
          vars: [{ key: 'TOKEN', value: 'x' }],
        },
      }),
    )

    const result = service.composeRuntimeContext({
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
    })

    expect(result.customEnv).toBeUndefined()
    expect(result.envSystemPrompt).toBeUndefined()
  })

  it('exposes effective env and masked prompt through composeRuntimeContext', () => {
    const service = new RuntimeCompositionService(
      makeSkillRepo([]),
      makeSettingsRepo({
        'runtime.env:session:session-1': {
          enabled: true,
          vars: [{ key: 'OPENAI_API_KEY', value: 'sk-1234567890', description: 'OpenAI 密钥' }],
        },
      }),
    )

    const result = service.composeRuntimeContext({ sessionId: 'session-1' })

    expect(result.customEnv).toEqual({ OPENAI_API_KEY: 'sk-1234567890' })
    expect(result.envSystemPrompt).toContain('OPENAI_API_KEY')
    expect(result.envSystemPrompt).not.toContain('sk-1234567890')
  })

  it('composes available skill catalog without loading full instructions', () => {
    const service = new RuntimeCompositionService(
      makeSkillRepo([
        skillRow({ id: 'skill:review', name: 'Review', enabled: 1 }),
        skillRow({ id: 'skill:hidden', name: 'Hidden', enabled: 0 }),
      ]),
      makeSettingsRepo({
        'runtime.skills:project:workspace-1': ['skill:hidden'],
        'runtime.prompts:system': { enabled: true, content: 'Base system prompt' },
      }),
    )

    const result = service.composeRuntimeContext({
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
    })

    expect(result.systemPrompt).toContain('Base system prompt')
    expect(result.skillSystemPrompt).toContain('[Available Skills Catalog]')
    expect(result.skillSystemPrompt).toContain('Review description')
    expect(result.skillSystemPrompt).not.toContain('Tags:')
    expect(result.skillSystemPrompt).not.toContain('Required tools:')
    expect(result.skillSystemPrompt).not.toContain('Review instructions')
    expect(result.skillSystemPrompt).not.toContain('Hidden instructions')
  })

  it('allows an explicit empty skill selection without falling back to every enabled skill', () => {
    const service = new RuntimeCompositionService(
      makeSkillRepo([
        skillRow({ id: 'skill:review', name: 'Review', enabled: 1 }),
        skillRow({ id: 'skill:test', name: 'Test', enabled: 1 }),
      ]),
      makeSettingsRepo({
        'runtime.skills:project:workspace-1': ['skill:test'],
      }),
    )

    const result = service.composeRuntimeContext(
      { agentId: 'platform-manager-agent', workspaceId: 'workspace-1' },
      undefined,
      { agentSkillIds: [], replaceAgentSkills: true },
    )

    expect(result.skillConfig.effectiveSkillIds).toEqual([])
    expect(result.skillSystemPrompt).toBeUndefined()
  })
})

describe('RuntimeCompositionService bundle-skill isolation', () => {
  const bundleSkillId = 'bundle:wfb-test:web-search'

  it('excludes bundle:* skills from the fallback-to-all base', () => {
    const service = new RuntimeCompositionService(
      makeSkillRepo([
        skillRow({ id: 'skill:regular', name: 'Regular', enabled: 1 }),
        skillRow({ id: bundleSkillId, name: 'web-search', enabled: 1 }),
      ]),
      makeSettingsRepo({}),
    )

    const config = service.getSkillConfig({})
    expect(config.effectiveSkillIds).toContain('skill:regular')
    expect(config.effectiveSkillIds).not.toContain(bundleSkillId)
  })

  it('keeps bundle:* skills usable when explicitly configured', () => {
    const service = new RuntimeCompositionService(
      makeSkillRepo([
        skillRow({ id: 'skill:regular', name: 'Regular', enabled: 1 }),
        skillRow({ id: bundleSkillId, name: 'web-search', enabled: 1 }),
      ]),
      makeSettingsRepo({
        'runtime.skills:agent:platform-manager-agent': [bundleSkillId],
      }),
    )

    const config = service.getSkillConfig({ agentId: 'platform-manager-agent' })
    // 显式配置后本就不回落全量(bundle 或其他),但显式引用的 bundle 技能必须生效
    expect(config.effectiveSkillIds).toContain(bundleSkillId)
    expect(config.effectiveSkillIds).not.toContain('skill:regular')
  })
})

describe('RuntimeCompositionService prompt-filter（提示词注入过滤）', () => {
  it('两层都未配置 → 空集生效（不过滤 = 与现状一致），configured 均为 false', () => {
    const service = new RuntimeCompositionService(makeSkillRepo([]), makeSettingsRepo({}))

    const config = service.getPromptFilterConfig({
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
    })

    expect(config.project).toEqual({ configured: false, disabledSources: [] })
    expect(config.session).toEqual({ configured: false, disabledSources: [] })
    expect(config.effectiveDisabledSources).toEqual([])
  })

  it('仅项目层配置 → 会话层继承项目层', () => {
    const service = new RuntimeCompositionService(
      makeSkillRepo([]),
      makeSettingsRepo({
        'runtime.prompt-filter:project:workspace-1': {
          disabledSources: ['inject:memory', 'mcp:spark_browser'],
        },
      }),
    )

    const config = service.getPromptFilterConfig({
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
    })

    expect(config.project).toEqual({
      configured: true,
      disabledSources: ['inject:memory', 'mcp:spark_browser'],
    })
    expect(config.session.configured).toBe(false)
    // 排序输出（Set 迭代序不稳定，统一 sort）
    expect(config.effectiveDisabledSources).toEqual(['inject:memory', 'mcp:spark_browser'])
  })

  it('会话层显式接管：空数组 = 全开，可临时开回项目层禁项', () => {
    const service = new RuntimeCompositionService(
      makeSkillRepo([]),
      makeSettingsRepo({
        'runtime.prompt-filter:project:workspace-1': { disabledSources: ['mcp:spark_media'] },
        'runtime.prompt-filter:session:session-1': { disabledSources: [] },
      }),
    )

    const config = service.getPromptFilterConfig({
      workspaceId: 'workspace-1',
      sessionId: 'session-1',
    })

    expect(config.session).toEqual({ configured: true, disabledSources: [] })
    expect(config.effectiveDisabledSources).toEqual([])
  })

  it('update 写入归一化（locked/非法 key 剔除），undefined 删除行恢复继承', () => {
    const values: Record<string, unknown> = {}
    const service = new RuntimeCompositionService(makeSkillRepo([]), makeSettingsRepo(values))
    const refs = { workspaceId: 'workspace-1', sessionId: 'session-1' }

    // 会话层接管（非法 key 被剔除）
    const updated = service.updatePromptFilterConfig('session', 'session-1', [
      'inject:memory',
      'locked:envVars',
      'bogus-key',
    ])
    expect(updated.session).toEqual({ configured: true, disabledSources: ['inject:memory'] })

    // 删除会话行 → 恢复继承（两层都未配置）
    const restored = service.updatePromptFilterConfig('session', 'session-1', undefined)
    expect(restored.session.configured).toBe(false)

    // refs 无对应层时也安全（未配置 → 空集）
    expect(service.getPromptFilterConfig(refs).effectiveDisabledSources).toEqual([])
  })

  it('composeRuntimeContext 暴露 effectiveDisabled，skillCatalog 过滤时目录段消失', () => {
    const service = new RuntimeCompositionService(
      makeSkillRepo([skillRow({ id: 'skill:review', name: 'Review', enabled: 1 })]),
      makeSettingsRepo({
        'runtime.prompt-filter:session:session-1': { disabledSources: ['inject:skillCatalog'] },
      }),
    )

    const filtered = service.composeRuntimeContext({ sessionId: 'session-1' })
    expect(filtered.promptFilter?.effectiveDisabled.has('inject:skillCatalog')).toBe(true)
    expect(filtered.skillSystemPrompt).toBeUndefined()

    // 未过滤会话（对照）目录段正常
    const baseline = service.composeRuntimeContext({})
    expect(baseline.skillSystemPrompt).toContain('[Available Skills Catalog]')
    expect(baseline.promptFilter?.effectiveDisabled.size).toBe(0)
  })

  it('skillCatalog 过滤时 explicitSkillPrompt（用户点选技能）保留', () => {
    const service = new RuntimeCompositionService(
      makeSkillRepo([]),
      makeSettingsRepo({
        'runtime.prompt-filter:session:session-1': { disabledSources: ['inject:skillCatalog'] },
      }),
    )

    const result = service.composeRuntimeContext(
      { sessionId: 'session-1' },
      '[Selected Project Skill: demo]\n完整指令正文',
    )

    expect(result.skillSystemPrompt).toContain('[Selected Project Skill: demo]')
    expect(result.skillSystemPrompt).not.toContain('[Available Skills Catalog]')
  })
})
