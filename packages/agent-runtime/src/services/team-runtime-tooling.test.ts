import { describe, expect, it, vi } from 'vitest'
import { buildTeamRuntimeToolDefinitions, cleanupTeamRuntimeState } from './team-runtime-tooling.js'

describe('team runtime tooling', () => {
  it('composes all four adapter definition groups in stable order', () => {
    const adapters = {
      taskGraph: { buildToolDefinitions: vi.fn(() => [{ name: 'task', description: '', schema: {}, handler: vi.fn() }]) },
      deliberation: { buildToolDefinitions: vi.fn(() => [{ name: 'deliberation', description: '', schema: {}, handler: vi.fn() }]) },
      evidenceCost: { buildToolDefinitions: vi.fn(() => [{ name: 'evidence', description: '', schema: {}, handler: vi.fn() }]) },
      replayPlaybook: { buildToolDefinitions: vi.fn(() => [{ name: 'replay', description: '', schema: {}, handler: vi.fn() }]) },
    }

    expect(buildTeamRuntimeToolDefinitions(adapters as never).map((definition) => definition.name)).toEqual([
      'task',
      'deliberation',
      'evidence',
      'replay',
    ])
    expect(adapters.taskGraph.buildToolDefinitions).toHaveBeenCalledOnce()
    expect(adapters.deliberation.buildToolDefinitions).toHaveBeenCalledOnce()
    expect(adapters.evidenceCost.buildToolDefinitions).toHaveBeenCalledOnce()
    expect(adapters.replayPlaybook.buildToolDefinitions).toHaveBeenCalledOnce()
  })

  it('runs all four session cleanup operations exactly once', () => {
    const operations = {
      taskGraph: vi.fn(() => 1),
      deliberation: vi.fn(() => 2),
      evidenceCost: vi.fn(() => 3),
      replayPlaybook: vi.fn(() => 4),
    }
    expect(cleanupTeamRuntimeState(operations)).toBe(10)
    for (const operation of Object.values(operations)) expect(operation).toHaveBeenCalledOnce()
  })
})
