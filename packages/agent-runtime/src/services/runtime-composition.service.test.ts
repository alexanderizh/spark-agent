import { describe, expect, it } from 'vitest'
import { RuntimeCompositionService } from './runtime-composition.service.js'
import type { SkillRow } from '@spark/storage'

function skillRow(overrides: Partial<SkillRow> & Pick<SkillRow, 'id' | 'name' | 'enabled'>): SkillRow {
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
    expect(result.effectivePrompt.indexOf('System prompt')).toBeLessThan(result.effectivePrompt.indexOf('Agent prompt'))
    expect(result.effectivePrompt.indexOf('Agent prompt')).toBeLessThan(result.effectivePrompt.indexOf('Project prompt'))
    expect(result.effectivePrompt.indexOf('Project prompt')).toBeLessThan(result.effectivePrompt.indexOf('Session prompt'))
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
    expect(result.skillSystemPrompt).not.toContain('Review instructions')
    expect(result.skillSystemPrompt).not.toContain('Hidden instructions')
  })
})
