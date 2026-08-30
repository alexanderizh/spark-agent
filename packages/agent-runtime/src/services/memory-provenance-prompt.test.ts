import { describe, expect, it } from 'vitest'
import { MEMORY_PROVENANCE_SYSTEM_PROMPT } from './memory-provenance-prompt.js'

describe('MEMORY_PROVENANCE_SYSTEM_PROMPT', () => {
  it('keeps recalled facts and decisions calibrated to their source', () => {
    expect(MEMORY_PROVENANCE_SYSTEM_PROMPT).toContain('Memory summaries may be model-generated')
    expect(MEMORY_PROVENANCE_SYSTEM_PROMPT).toContain('Never recall an agent suggestion')
    expect(MEMORY_PROVENANCE_SYSTEM_PROMPT).toContain('follow the current statement')
    expect(MEMORY_PROVENANCE_SYSTEM_PROMPT).toContain('not merely to demonstrate recall')
    expect(MEMORY_PROVENANCE_SYSTEM_PROMPT).not.toMatch(/[\u3400-\u9fff]/u)
  })
})
