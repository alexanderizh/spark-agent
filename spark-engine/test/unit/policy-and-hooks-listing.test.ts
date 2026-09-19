import { describe, expect, it } from 'vitest'

import { listHookEntries, discoverHookSettings } from '../../src/hooks/settings.js'
import { RulePermissionPolicy } from '../../src/permission/policy.js'

describe('RulePermissionPolicy.listRules', () => {
  it('lists rules with provenance and editability per source', () => {
    const policy = new RulePermissionPolicy({
      layers: [
        { source: 'user', rules: [{ id: 'r1', tool: 'Bash', action: 'deny' }] },
        { source: 'host', rules: [{ id: 'r2', tool: 'Read', action: 'allow' }] },
        {
          source: 'cli',
          rules: [{ id: 'r3', tool: 'WebSearch', action: 'ask', remember: 'session' }],
        },
      ],
    })
    const rules = policy.listRules()
    expect(rules).toEqual([
      expect.objectContaining({
        id: 'r1',
        source: 'user',
        editability: 'persistent',
        action: 'deny',
      }),
      expect.objectContaining({
        id: 'r2',
        source: 'host',
        editability: 'readonly',
        action: 'allow',
      }),
      expect.objectContaining({ id: 'r3', source: 'cli', editability: 'session', action: 'ask' }),
    ])
  })

  it('returns an empty listing for an empty policy', () => {
    expect(new RulePermissionPolicy().listRules()).toEqual([])
  })
})

describe('listHookEntries', () => {
  it('flattens discovered settings into per-command entries with scope order', () => {
    const read = (path: string): string => {
      if (path.startsWith('/home/u/.spark-agent')) {
        return JSON.stringify({
          Stop: [{ hooks: [{ type: 'command', command: 'echo user', timeoutMs: 5_000 }] }],
        })
      }
      if (path === '/workspace/.spark/settings.json') {
        return JSON.stringify({
          PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo project' }] }],
        })
      }
      throw new Error('missing')
    }
    const discovered = discoverHookSettings('/workspace', '/home/u/.spark-agent', read)
    const entries = listHookEntries(discovered)
    // Scope order: user first, then project.
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      event: 'Stop',
      command: 'echo user',
      timeoutMs: 5_000,
      scope: 'user',
    })
    expect(entries[1]).toMatchObject({
      event: 'PreToolUse',
      matcher: 'Bash',
      command: 'echo project',
      scope: 'project',
    })
  })

  it('returns an empty listing when no settings file exists', () => {
    const discovered = discoverHookSettings('/workspace', '/home/u/.spark-agent', () => {
      throw new Error('missing')
    })
    expect(listHookEntries(discovered)).toEqual([])
    expect(discovered.scopedConfigs).toEqual([])
  })
})
