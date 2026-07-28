import { describe, expect, it } from 'vitest'
import {
  PRESENT_FILES_SYSTEM_PROMPT,
  buildImageGenerationSystemPrompt,
} from '../../../services/session-mcp-tooling-helpers.js'

describe('media presentation system prompts', () => {
  it('requires generated and edited media to be rendered for the user instead of returning a path', () => {
    const imagePrompt = buildImageGenerationSystemPrompt({
      name: 'Image',
      model: 'gpt-image-1',
      provider: 'openai',
      apiType: 'images',
      outputDir: '/workspace/.spark-artifacts/images',
    })

    for (const prompt of [imagePrompt, PRESENT_FILES_SYSTEM_PROMPT]) {
      expect(prompt).toContain('mcp__spark_files__present_files')
      expect(prompt).toMatch(/image|图片/i)
      expect(prompt).toContain('path')
    }
    expect(PRESENT_FILES_SYSTEM_PROMPT).toMatch(/audio/i)
    expect(PRESENT_FILES_SYSTEM_PROMPT).toMatch(/video/i)
    expect(PRESENT_FILES_SYSTEM_PROMPT).toMatch(/screenshot/i)
  })
})
