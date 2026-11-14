// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

import type { McpServerItem } from '@spark/protocol'

import {
  draftFromItem,
  normalizeConnectorCapabilities,
  parseSelectedRepos,
  serializeConfig,
  validateHeaderRows,
} from './McpView'

function makeItem(configJson: string): McpServerItem {
  return {
    id: 'srv-1',
    scope: 'user',
    name: 'remote',
    configJson,
    enabled: true,
    createdAt: '2026-11-15T00:00:00.000Z',
    updatedAt: '2026-11-15T00:00:00.000Z',
  }
}

describe('McpView GitHub connector helpers', () => {
  it('keeps user-disabled capabilities disabled', () => {
    expect(normalizeConnectorCapabilities(['repositories'])).toEqual(['repositories'])
  })

  it('normalizes repo inputs from owner/repo values and pasted GitHub URLs', () => {
    expect(
      parseSelectedRepos('https://github.com/OpenAI/Codex/, owner/repo.git\nOWNER/repo/'),
    ).toEqual(['openai/codex', 'owner/repo'])
  })
})

describe('McpView custom request headers', () => {
  const bearerConfig = JSON.stringify({
    transport: 'http',
    url: 'https://mcp.example.com/mcp',
    headers: { Authorization: 'Bearer sk-test', 'X-API-Key': 'abc' },
  })

  it('reads agent-written headers back into the draft instead of dropping them', () => {
    const draft = draftFromItem(makeItem(bearerConfig))
    expect(draft.headers).toEqual([
      { key: 'Authorization', value: 'Bearer sk-test' },
      { key: 'X-API-Key', value: 'abc' },
    ])
  })

  it('writes headers into configJson so the server can be authorized manually', () => {
    const draft = { ...draftFromItem(makeItem(bearerConfig)), transport: 'sse' as const }
    const config = JSON.parse(serializeConfig(draft)) as Record<string, unknown>
    expect(config.headers).toEqual({ Authorization: 'Bearer sk-test', 'X-API-Key': 'abc' })
  })

  it('round-trips headers through edit → save without losing them', () => {
    const configJson = serializeConfig(draftFromItem(makeItem(bearerConfig)))
    const config = JSON.parse(configJson) as Record<string, unknown>
    expect(config).toMatchObject({
      transport: 'http',
      url: 'https://mcp.example.com/mcp',
      headers: { Authorization: 'Bearer sk-test', 'X-API-Key': 'abc' },
    })
  })

  it('keeps headers in the draft but out of configJson when transport is stdio', () => {
    const draft = {
      ...draftFromItem(makeItem(bearerConfig)),
      transport: 'stdio' as const,
      command: 'npx',
    }
    expect(draft.headers).toHaveLength(2)
    const config = JSON.parse(serializeConfig(draft)) as Record<string, unknown>
    expect(config.headers).toBeUndefined()
  })

  it('omits the headers field entirely when no header row is filled in', () => {
    const draft = {
      ...draftFromItem(makeItem('{}')),
      transport: 'http' as const,
      url: 'https://mcp.example.com/mcp',
    }
    const config = JSON.parse(serializeConfig(draft)) as Record<string, unknown>
    expect(config.headers).toBeUndefined()
  })

  it('skips rows whose header name is blank', () => {
    const draft = {
      ...draftFromItem(makeItem(bearerConfig)),
      headers: [{ key: '  ', value: 'dropped' }],
    }
    const config = JSON.parse(serializeConfig(draft)) as Record<string, unknown>
    expect(config.headers).toBeUndefined()
  })
})

describe('validateHeaderRows', () => {
  it('accepts a Bearer authorization header', () => {
    expect(validateHeaderRows([{ key: 'Authorization', value: 'Bearer sk-test' }])).toBeNull()
  })

  it('rejects header names with illegal characters', () => {
    expect(validateHeaderRows([{ key: 'Bad Header', value: 'x' }])).not.toBeNull()
  })

  it('rejects header values containing line breaks', () => {
    expect(validateHeaderRows([{ key: 'X-Test', value: 'a\r\nX-Evil: 1' }])).not.toBeNull()
  })

  it('ignores rows with a blank header name', () => {
    expect(validateHeaderRows([{ key: '', value: '' }])).toBeNull()
  })
})
