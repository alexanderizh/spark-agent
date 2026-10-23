import { describe, expect, it } from 'vitest'
import {
  buildCapabilityCatalogPrompt,
  CAPABILITY_IDS,
  resolveCapabilityGuide,
} from './capability-disclosure.js'

describe('buildCapabilityCatalogPrompt', () => {
  it('returns an empty string when no capability is mounted', () => {
    expect(buildCapabilityCatalogPrompt([])).toBe('')
  })

  it('renders one metadata-only entry per mounted capability and teaches capability_load', () => {
    const prompt = buildCapabilityCatalogPrompt([
      'media-generation',
      'computer-use',
      'browser-automation',
      'session-schedule',
      'render-html',
      'render-diagram',
      'image-generation',
    ])
    expect(prompt).toContain('[Capability Catalog]')
    expect(prompt).toContain('mcp__spark_platform__capability_load')
    for (const id of CAPABILITY_IDS) {
      expect(prompt).toContain(`- ${id} — `)
    }
    // 目录必须保持有界：全量挂载（7 项）也不超过 2k 字符。
    expect(prompt.length).toBeLessThan(2000)
  })

  it('dedupes repeated ids while preserving first-seen order', () => {
    const prompt = buildCapabilityCatalogPrompt(['session-schedule', 'session-schedule'])
    expect(prompt.match(/- session-schedule —/g)).toHaveLength(1)
  })

  it('keeps per-turn behavioral contracts out of the catalog (Tier A stays resident)', () => {
    const prompt = buildCapabilityCatalogPrompt([...CAPABILITY_IDS])
    expect(prompt).not.toContain('suggest_replies')
    expect(prompt).not.toContain('present_files')
    expect(prompt).not.toContain('Quick replies')
  })
})

describe('resolveCapabilityGuide', () => {
  it('returns a non-empty guide with the key semantic lines for every capability', () => {
    const expectations: Record<string, string[]> = {
      'computer-use': ['stale_tree', 'One action per tool call', 'start_task'],
      'browser-automation': ['playwright install chromium', 'OMIT `profileId` by default'],
      'media-generation': ['describe_model', 'present_files', 'maxImages'],
      'image-generation': ['extraJson', 'materialize it in the configured output directory'],
      'session-schedule': ['session_schedule_create', 'Scheduled Task Context'],
      'render-html': ['200,000', 'network-enabled sandbox'],
      'render-diagram': ['markmap', 'flowchart TD'],
    }
    for (const id of CAPABILITY_IDS) {
      const { guide } = resolveCapabilityGuide(id)
      expect(guide.trim().length).toBeGreaterThan(200)
      for (const fragment of expectations[id] ?? []) {
        expect(guide).toContain(fragment)
      }
    }
  })

  it('throws a usable error listing valid ids for unknown capability ids', () => {
    expect(() => resolveCapabilityGuide('not-a-capability')).toThrow(/Unknown capability id/)
    expect(() => resolveCapabilityGuide('not-a-capability')).toThrow(
      new RegExp(CAPABILITY_IDS.join('.*')),
    )
  })
})
