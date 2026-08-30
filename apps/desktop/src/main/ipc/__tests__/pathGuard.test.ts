/**
 * pathGuard 单测 —— 覆盖文件操作的核心路径安全逻辑。
 *
 * resolveInsideRoot / isPathNestedIn 是纯词法校验（node:path），不读盘、不依赖 electron，
 * 故可在 vitest 直接测试；fs 层操作（trash/create/move/copy）由手测验证。
 */

import { describe, it, expect } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import { isPathNestedIn, resolveInsideRoot } from '../pathGuard.js'

const ROOT = path.join(os.tmpdir(), 'fe-pathguard-root')

describe('resolveInsideRoot', () => {
  it('正常相对路径解析为 root 内的绝对路径', () => {
    expect(resolveInsideRoot(ROOT, 'src/a.ts')).toBe(path.join(ROOT, 'src', 'a.ts'))
    expect(resolveInsideRoot(ROOT, 'a/b/c.txt')).toBe(path.join(ROOT, 'a', 'b', 'c.txt'))
  })

  it('含 ./ 与 ../ 的路径被 normalize 后仍在 root 内则放行', () => {
    expect(resolveInsideRoot(ROOT, 'a/../b.ts')).toBe(path.join(ROOT, 'b.ts'))
    expect(resolveInsideRoot(ROOT, './x.ts')).toBe(path.join(ROOT, 'x.ts'))
  })

  it('../ 越界路径抛错', () => {
    expect(() => resolveInsideRoot(ROOT, '../escape.txt')).toThrow(/超出工作区/)
    expect(() => resolveInsideRoot(ROOT, 'a/../../escape.txt')).toThrow(/超出工作区/)
  })

  it('解析后等于 root 本身（如 . 或空段）抛错，防误操作整个工作区', () => {
    expect(() => resolveInsideRoot(ROOT, '.')).toThrow(/超出工作区/)
  })

  it('空路径抛错', () => {
    expect(() => resolveInsideRoot(ROOT, '')).toThrow(/不能为空/)
  })

  it('绝对路径（posix）解析后越界抛错', () => {
    expect(() => resolveInsideRoot(ROOT, '/etc/passwd')).toThrow(/超出工作区/)
  })
})

describe('isPathNestedIn', () => {
  it('toAbs 在 fromAbs 之内返回 true', () => {
    expect(isPathNestedIn(path.join(ROOT, 'a'), path.join(ROOT, 'a', 'b'))).toBe(true)
    expect(isPathNestedIn(path.join(ROOT, 'a'), path.join(ROOT, 'a', 'b', 'c'))).toBe(true)
  })

  it('toAbs 等于 fromAbs（自身）返回 true', () => {
    expect(isPathNestedIn(path.join(ROOT, 'a'), path.join(ROOT, 'a'))).toBe(true)
  })

  it('toAbs 是 fromAbs 的兄弟或在外返回 false', () => {
    expect(isPathNestedIn(path.join(ROOT, 'a'), path.join(ROOT, 'b'))).toBe(false)
    // 兄弟前缀：'a' vs 'ab' 不应误判为 nested
    expect(isPathNestedIn(path.join(ROOT, 'a'), path.join(ROOT, 'ab'))).toBe(false)
    expect(isPathNestedIn(path.join(ROOT, 'a'), path.join(ROOT, 'a-sibling'))).toBe(false)
  })
})
