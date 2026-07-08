import { describe, it, expect } from 'vitest'
import { segmentCjk, buildFtsMatchQuery } from './segment-cjk.js'

describe('segmentCjk', () => {
  it('splits pure CJK text into single characters', () => {
    expect(segmentCjk('迁移')).toBe('迁 移')
    expect(segmentCjk('迁移到新框架')).toBe('迁 移 到 新 框 架')
  })

  it('keeps pure English text unchanged', () => {
    expect(segmentCjk('prefers pnpm over npm')).toBe('prefers pnpm over npm')
  })

  it('handles mixed CJK + English text', () => {
    expect(segmentCjk('迁移到 vite')).toBe('迁 移 到 vite')
    expect(segmentCjk('用户偏好 Arco Design 组件库')).toBe('用 户 偏 好 Arco Design 组 件 库')
    expect(segmentCjk('用Arco不用Radix')).toBe('用 Arco 不 用 Radix')
  })

  it('collapses redundant whitespace and trims', () => {
    expect(segmentCjk('  hello   世界  ')).toBe('hello 世 界')
    expect(segmentCjk('\n换\t行\n')).toBe('换 行')
  })

  it('covers CJK Extension A characters', () => {
    // U+3400 㐀 属于扩展 A 区
    expect(segmentCjk('㐀㐁')).toBe('㐀 㐁')
  })

  it('returns empty string for empty / whitespace input', () => {
    expect(segmentCjk('')).toBe('')
    expect(segmentCjk('   ')).toBe('')
  })
})

describe('buildFtsMatchQuery', () => {
  it('CJK 连续段包 phrase、英文段 AND 拆词（英文 token 也包双引号防 FTS5 语法字符）', () => {
    // 纯 CJK：连续单字 → 一个 phrase
    expect(buildFtsMatchQuery('迁移')).toBe('"迁 移"')
    // 纯英文：每个 token 包成字面量短语，FTS5 空格 = 隐式 AND（共现即可，不要求相邻）
    expect(buildFtsMatchQuery('Arco Design')).toBe('"Arco" "Design"')
    // 混合：CJK 段 phrase + 英文词 AND
    expect(buildFtsMatchQuery('迁移到 vite')).toBe('"迁 移 到" "vite"')
    expect(buildFtsMatchQuery('用Arco不用Radix')).toBe('"用" "Arco" "不 用" "Radix"')
  })

  it('多词英文查询不再要求紧邻（H5 修复核心）', () => {
    expect(buildFtsMatchQuery('react hooks performance')).toBe('"react" "hooks" "performance"')
  })

  it('双引号在 segmentCjk 阶段被去掉（FTS5 用户查询里引号无语义价值）', () => {
    // "hi" 的引号被 strip → hi；say / hi 各自包短语
    expect(buildFtsMatchQuery('say "hi" 你好')).toBe('"say" "hi" "你 好"')
  })

  it('转义 FTS5 列限定符与特殊字符，避免 "no such column" 错误（审查修复）', () => {
    // 含冒号的 token（典型：URL、或被误当成列限定）必须包成字面量短语
    expect(buildFtsMatchQuery('agent:')).toBe('"agent:"')
    expect(buildFtsMatchQuery('https://example.com')).toBe('"https://example.com"')
    // 大写词同样安全（曾触发 'no such column: Agent'）
    expect(buildFtsMatchQuery('Agent')).toBe('"Agent"')
    // 末尾 * 保留在引号外做前缀匹配
    expect(buildFtsMatchQuery('react*')).toBe('"react"*')
    // 其他特殊字符 ^ ( ) 也被字面量化
    expect(buildFtsMatchQuery('(not)')).toBe('"(not)"')
    expect(buildFtsMatchQuery('^critical')).toBe('"^critical"')
  })

  it('returns null for empty query', () => {
    expect(buildFtsMatchQuery('')).toBeNull()
    expect(buildFtsMatchQuery('   ')).toBeNull()
  })
})
