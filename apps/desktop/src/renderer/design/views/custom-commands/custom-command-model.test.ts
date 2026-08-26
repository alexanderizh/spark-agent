import { describe, expect, it } from 'vitest'

import {
  mergeCustomCommandImports,
  normalizeCustomCommandInput,
  parseCustomCommandExportPayload,
  parseCustomCommandItems,
  type CustomCommandItem,
} from './custom-command-model'

function makeCommand(overrides: Partial<CustomCommandItem> = {}): CustomCommandItem {
  return {
    id: 'custom-1',
    name: '/custom-plan',
    description: 'desc',
    prompt: 'prompt',
    script: '',
    scriptLanguage: 'javascript',
    enabled: true,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('normalizeCustomCommandInput', () => {
  it('normalizes slashes, casing and whitespace', () => {
    expect(normalizeCustomCommandInput('Custom-Plan')).toBe('/custom-plan')
    expect(normalizeCustomCommandInput('  /REVIEW-NOW  ')).toBe('/review-now')
  })

  it('rejects names that cannot form a valid slash command', () => {
    expect(normalizeCustomCommandInput('/1abc')).toBeNull()
    expect(normalizeCustomCommandInput('/a')).toBeNull()
    expect(normalizeCustomCommandInput('/has space')).toBeNull()
    expect(normalizeCustomCommandInput('')).toBeNull()
  })
})

describe('parseCustomCommandItems', () => {
  it('parses stored JSON with per-field fallbacks', () => {
    const items = parseCustomCommandItems(
      JSON.stringify([{ id: 'x', name: '/ok', scriptLanguage: 'python', enabled: false }, {}]),
    )
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      id: 'x',
      name: '/ok',
      scriptLanguage: 'python',
      enabled: false,
    })
    expect(items[1]).toMatchObject({
      description: '',
      prompt: '',
      script: '',
      scriptLanguage: 'javascript',
      enabled: true,
    })
  })

  it('returns empty list for malformed payloads', () => {
    expect(parseCustomCommandItems(null)).toEqual([])
    expect(parseCustomCommandItems('not-json')).toEqual([])
    expect(parseCustomCommandItems('{"a":1}')).toEqual([])
  })
})

describe('parseCustomCommandExportPayload', () => {
  it('parses a standard export file and normalizes command names', () => {
    const raw = JSON.stringify({
      version: 1,
      exportedAt: '2026-08-01T00:00:00.000Z',
      commands: [makeCommand({ id: 'a', name: 'Review-Now' })],
    })
    const result = parseCustomCommandExportPayload(raw)
    expect(result).not.toBeNull()
    expect(result?.version).toBe(1)
    expect(result?.exportedAt).toBe('2026-08-01T00:00:00.000Z')
    expect(result?.accepted).toHaveLength(1)
    expect(result?.accepted[0]?.name).toBe('/review-now')
    expect(result?.rejected).toHaveLength(0)
  })

  it('accepts a bare command array as legacy payload', () => {
    const result = parseCustomCommandExportPayload(
      JSON.stringify([makeCommand({ name: '/legacy' })]),
    )
    expect(result?.accepted.map((item) => item.name)).toEqual(['/legacy'])
    expect(result?.version).toBeNull()
  })

  it('rejects entries with invalid names and reports them', () => {
    const result = parseCustomCommandExportPayload(
      JSON.stringify({ commands: [makeCommand({ id: 'bad', name: '/1invalid' })] }),
    )
    expect(result?.accepted).toHaveLength(0)
    expect(result?.rejected).toHaveLength(1)
    expect(result?.rejected[0]?.name).toBe('/1invalid')
  })

  it('returns null for non-object or malformed JSON', () => {
    expect(parseCustomCommandExportPayload('{{')).toBeNull()
    expect(parseCustomCommandExportPayload('"text"')).toBeNull()
    expect(parseCustomCommandExportPayload('{"nope": true}')).toBeNull()
  })
})

describe('mergeCustomCommandImports', () => {
  it('appends new commands and skips same-name ones in skip mode', () => {
    const existing = [makeCommand({ id: 'local-1', name: '/plan' })]
    const incoming = [
      makeCommand({ id: 'remote-1', name: 'Plan' }),
      makeCommand({ id: 'remote-2', name: '/deploy' }),
    ]
    const merged = mergeCustomCommandImports(existing, incoming, 'skip')
    expect(merged).toMatchObject({ added: 1, updated: 0, skipped: 1 })
    expect(merged.commands.map((command) => command.name)).toEqual(['/plan', '/deploy'])
    expect(merged.commands[0]?.id).toBe('local-1')
  })

  it('overwrites same-name commands while keeping the local id and position', () => {
    const existing = [
      makeCommand({ id: 'local-1', name: '/plan', prompt: 'old' }),
      makeCommand({ id: 'local-2', name: '/keep' }),
    ]
    const incoming = [makeCommand({ id: 'remote-1', name: '/PLAN', prompt: 'new' })]
    const merged = mergeCustomCommandImports(existing, incoming, 'overwrite')
    expect(merged).toMatchObject({ added: 0, updated: 1, skipped: 0 })
    expect(merged.commands).toHaveLength(2)
    expect(merged.commands[0]).toMatchObject({ id: 'local-1', name: '/plan', prompt: 'new' })
  })

  it('resolves duplicate names inside the incoming payload by mode', () => {
    const incoming = [
      makeCommand({ id: 'a', name: '/dup', prompt: 'first' }),
      makeCommand({ id: 'b', name: '/dup', prompt: 'second' }),
    ]
    const skip = mergeCustomCommandImports([], incoming, 'skip')
    expect(skip.commands).toHaveLength(1)
    expect(skip.commands[0]?.prompt).toBe('first')

    const overwrite = mergeCustomCommandImports([], incoming, 'overwrite')
    expect(overwrite).toMatchObject({ added: 1, updated: 1 })
    expect(overwrite.commands).toHaveLength(1)
    expect(overwrite.commands[0]?.prompt).toBe('second')
  })

  it('regenerates the id when an incoming id collides with a local one', () => {
    const existing = [makeCommand({ id: 'shared', name: '/local' })]
    const incoming = [makeCommand({ id: 'shared', name: '/imported' })]
    const merged = mergeCustomCommandImports(existing, incoming, 'skip')
    expect(merged.commands).toHaveLength(2)
    expect(new Set(merged.commands.map((command) => command.id)).size).toBe(2)
    expect(merged.commands[1]?.name).toBe('/imported')
  })
})
