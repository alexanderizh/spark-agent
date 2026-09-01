import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('multimedia-use built-in skill route policy', () => {
  it('does not let Spark image tools override native model or executor generation', () => {
    const source = readFileSync(
      new URL('../../../../resources/skills/multimedia-use/SKILL.md', import.meta.url),
      'utf8',
    )

    expect(source).toContain('模型、SDK、CLI 或执行器原生提供的图片生成/编辑能力')
    expect(source).toContain('以下是路由建议，不是限制其他能力的硬规则')
    expect(source).toContain('同时存在多条合适路径时')
    expect(source).toContain('可以列出简短选项询问用户')
    expect(source).toContain('不必为了询问而阻断任务')
    expect(source).toContain('默认优先考虑当前模型或执行器的原生图片能力')
    expect(source).toContain('Spark 平台工具在更适合任务')
    expect(source).not.toContain('严格使用该方式')
    expect(source).not.toContain('得到答复后再生成')
  })
})
