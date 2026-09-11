import { describe, expect, it } from 'vitest'
import { SPARK_KERNEL_PROMPT } from '../../src/prompts/kernel.js'

describe('Spark kernel prompt', () => {
  it('defines response organization and document provenance rules', () => {
    expect(SPARK_KERNEL_PROMPT).toContain("The user's request remains authoritative")
    expect(SPARK_KERNEL_PROMPT).toContain('Lead with the outcome')
    expect(SPARK_KERNEL_PROMPT).toContain("Organize the response around the user's goal")
    expect(SPARK_KERNEL_PROMPT).toContain('Use Markdown deliberately')
    expect(SPARK_KERNEL_PROMPT).toContain('observed facts, reasonable inferences, assumptions')
    expect(SPARK_KERNEL_PROMPT).toContain('final response independently useful')
    expect(SPARK_KERNEL_PROMPT).toContain('smallest actionable next step')
  })

  it('stays provider-neutral and bounded', () => {
    expect(SPARK_KERNEL_PROMPT).not.toMatch(/Anthropic|OpenAI|Claude|ChatGPT/)
    expect(SPARK_KERNEL_PROMPT.length).toBeLessThan(5_000)
  })
})
