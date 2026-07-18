import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('browser-use built-in skill recovery policy', () => {
  it('keeps task-driven download and points users to the integrity fallback', () => {
    const source = readFileSync(
      new URL('../../../../resources/skills/browser-use/SKILL.md', import.meta.url),
      'utf8',
    )

    expect(source).toContain('系统 Chrome/Edge')
    expect(source).toContain('约 150MB')
    expect(source).toContain('重试原始操作')
    expect(source).toContain('设置 → 完整性 → 浏览器自动化')
  })
})
