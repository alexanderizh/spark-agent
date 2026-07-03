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
  it('CJK 连续段包 phrase、英文段 AND 拆词（不再整体包死短语）', () => {
    // 纯 CJK：连续单字 → 一个 phrase
    expect(buildFtsMatchQuery('迁移')).toBe('"迁 移"')
    // 纯英文：拆词 AND（不要求相邻）
    expect(buildFtsMatchQuery('Arco Design')).toBe('Arco Design')
    // 混合：CJK 段 phrase + 英文词 AND
    expect(buildFtsMatchQuery('迁移到 vite')).toBe('"迁 移 到" vite')
    expect(buildFtsMatchQuery('用Arco不用Radix')).toBe('"用" Arco "不 用" Radix')
  })

  it('多词英文查询不再要求紧邻（H5 修复核心）', () => {
    // 旧：整体 phrase 要求紧邻，长查询零命中；新：AND 拆词，共现即可
    expect(buildFtsMatchQuery('react hooks performance')).toBe('react hooks performance')
  })

  it('escapes embedded double quotes', () => {
    // 英文段 "hi" → 转义 ""hi""；CJK 段 你好 → "你 好" phrase
    expect(buildFtsMatchQuery('say "hi" 你好')).toBe('say ""hi"" "你 好"')
  })

  it('returns null for empty query', () => {
    expect(buildFtsMatchQuery('')).toBeNull()
    expect(buildFtsMatchQuery('   ')).toBeNull()
  })
})
