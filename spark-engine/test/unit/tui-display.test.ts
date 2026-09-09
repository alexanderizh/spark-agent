import { describe, expect, it } from 'vitest'

import { displayModelName } from '../../src/tui/display-name.js'
import { wrapThinking } from '../../src/tui/projection.js'
import type { ConfiguredModelCatalog } from '../../src/config/model-config.js'

describe('displayModelName', () => {
  const catalog = {
    entries: [
      { id: 'sparkwork:abc-1:glm-5.3-flash', providerName: 'SparkWork', model: 'glm-5.3-flash' },
      { id: 'main', providerName: 'openai', model: 'gpt-host' },
    ],
  } as unknown as ConfiguredModelCatalog

  it('prefers the catalog model name for known routes', () => {
    expect(displayModelName('sparkwork:abc-1:glm-5.3-flash', catalog)).toBe('glm-5.3-flash')
    expect(displayModelName('main', catalog)).toBe('gpt-host')
  })

  it('falls back to the model portion of an unknown route', () => {
    expect(displayModelName('sparkwork:uuid-2:claude-x', catalog)).toBe('claude-x')
    expect(displayModelName('fake-m1', undefined)).toBe('fake-m1')
    expect(displayModelName(undefined, catalog)).toBeUndefined()
  })

  it('preserves colons in an unqualified model name', () => {
    expect(displayModelName('qwen3.8:27b', undefined)).toBe('qwen3.8:27b')
  })

  it('preserves colons in the model portion of an unknown SparkWork route', () => {
    expect(displayModelName('sparkwork:provider-1:qwen3.8:27b', undefined)).toBe('qwen3.8:27b')
  })
})

describe('wrapThinking', () => {
  it('keeps provider hard breaks as bar-prefixed lines', () => {
    const wrapped = wrapThinking('first line\nsecond line', 40, '▎')
    expect(wrapped).toBe('▎ first line\n▎ second line')
  })

  it('soft-wraps long segments at the width and caps the transcript', () => {
    const wrapped = wrapThinking(`${'长'.repeat(30)}\n${'word '.repeat(200)}`, 12, '▎')
    const lines = wrapped.split('\n')
    expect(lines.length).toBeGreaterThan(3)
    for (const line of lines.slice(0, -1)) {
      expect(line.startsWith('▎ ')).toBe(true)
      expect(Array.from(line).length).toBeLessThanOrEqual(12)
    }
    expect(lines.at(-1)).toBe('▎ …')
  })

  it('drops blank provider lines entirely', () => {
    expect(wrapThinking('\n\nidea\n\n', 40, '▎')).toBe('▎ idea')
  })
})
