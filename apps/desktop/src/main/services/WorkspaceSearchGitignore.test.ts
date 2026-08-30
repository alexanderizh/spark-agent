import { describe, expect, it } from 'vitest'
import {
  createGitignoreMatcher,
  isIgnoredByStack,
  parseGitignore,
  type GitignoreStackEntry,
} from './WorkspaceSearchGitignore'

describe('parseGitignore', () => {
  it('跳过空行与注释行', () => {
    const rules = parseGitignore('# comment\n\n  \nnode_modules\n')
    expect(rules).toHaveLength(1)
    expect(rules[0]?.source).toBe('node_modules')
  })

  it('识别否定 / dirOnly / 锚定', () => {
    const rules = parseGitignore('!keep.txt\ndist/\nbuild/*.js\n/logs')
    expect(rules[0]).toMatchObject({ negated: true, dirOnly: false, anchored: false })
    expect(rules[1]).toMatchObject({ negated: false, dirOnly: true, anchored: false })
    expect(rules[2]).toMatchObject({ anchored: true })
    expect(rules[3]).toMatchObject({ anchored: true })
  })
})

describe('createGitignoreMatcher.decide', () => {
  it('浮动规则匹配任意层级 basename', () => {
    const m = createGitignoreMatcher('node_modules')
    expect(m.decide('node_modules', true)).toBe('ignore')
    expect(m.decide('packages/app/node_modules', true)).toBe('ignore')
    expect(m.decide('src/main.ts', false)).toBeNull()
  })

  it('尾 / 规则仅匹配目录', () => {
    const m = createGitignoreMatcher('dist/')
    expect(m.decide('dist', true)).toBe('ignore')
    expect(m.decide('dist', false)).toBeNull()
  })

  it('锚定规则 * 不跨目录', () => {
    const m = createGitignoreMatcher('build/*.js')
    expect(m.decide('build/a.js', false)).toBe('ignore')
    expect(m.decide('build/sub/a.js', false)).toBeNull()
  })

  it('**/ 跨目录前缀', () => {
    const m = createGitignoreMatcher('**/logs')
    expect(m.decide('logs', true)).toBe('ignore')
    expect(m.decide('a/b/logs', true)).toBe('ignore')
  })

  it('同文件内后规则覆盖先规则（否定保留）', () => {
    const m = createGitignoreMatcher('*.log\n!important.log')
    expect(m.decide('a.log', false)).toBe('ignore')
    expect(m.decide('important.log', false)).toBe('keep')
  })
})

describe('isIgnoredByStack', () => {
  const rootMatcher = createGitignoreMatcher('*.log\nsub/\n')

  function stackOf(entries: Array<{ content: string; depth: number }>): GitignoreStackEntry[] {
    return entries.map((e) => ({ matcher: createGitignoreMatcher(e.content), depth: e.depth }))
  }

  it('空栈不忽略', () => {
    expect(isIgnoredByStack([], 'a.ts', false)).toBe(false)
  })

  it('根层规则生效', () => {
    expect(isIgnoredByStack([{ matcher: rootMatcher, depth: 0 }], 'debug.log', false)).toBe(true)
    expect(isIgnoredByStack([{ matcher: rootMatcher, depth: 0 }], 'src/main.ts', false)).toBe(false)
  })

  it('深层 gitignore 的否定可覆盖上层忽略', () => {
    // 根忽略 *.log，但不会剪枝 sub 目录；sub/.gitignore 可重新纳入 keep.log。
    const stack = stackOf([
      { content: '*.log\n', depth: 0 },
      { content: '!keep.log\n', depth: 1 },
    ])
    expect(isIgnoredByStack(stack, 'sub/keep.log', false)).toBe(false)
    expect(isIgnoredByStack(stack, 'sub/other.log', false)).toBe(true)
  })

  it('深层 ignore 不影响上层无关路径', () => {
    const stack = stackOf([
      { content: '*.log\n', depth: 0 },
      { content: 'secret/\n', depth: 1 },
    ])
    expect(isIgnoredByStack(stack, 'sub/secret', true)).toBe(true)
    expect(isIgnoredByStack(stack, 'debug.log', false)).toBe(true)
    expect(isIgnoredByStack(stack, 'sub/ok.ts', false)).toBe(false)
  })
})
