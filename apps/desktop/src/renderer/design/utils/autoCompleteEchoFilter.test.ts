// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

import { createEchoTolerantFilterOption, matchesValueOrLabel } from './autoCompleteEchoFilter'

const voiceOptions = [
  { value: 'male-qn-qingse', label: 'male-qn-qingse' },
  { value: 'female-shaonv', label: 'female-shaonv' },
  { value: 'cute_boy', label: 'cute_boy' },
]

describe('createEchoTolerantFilterOption', () => {
  it('搜索词等于已选值（输入框回显）时放行全部候选，而非只剩已选项', () => {
    const filter = createEchoTolerantFilterOption(() => 'female-shaonv', matchesValueOrLabel)
    // 回归场景：选完 female-shaonv 再展开下拉，输入框回填已选值当搜索词。
    expect(voiceOptions.every((option) => filter('female-shaonv', option))).toBe(true)
  })

  it('已选值大小写不同也视为回显（输入框与候选大小写不一致时不误过滤）', () => {
    const filter = createEchoTolerantFilterOption(() => 'Cute_Boy', matchesValueOrLabel)
    expect(voiceOptions.every((option) => filter('cute_boy', option))).toBe(true)
  })

  it('用户输入真正的搜索词后恢复正常过滤', () => {
    const filter = createEchoTolerantFilterOption(() => 'female-shaonv', matchesValueOrLabel)
    const hit = voiceOptions.filter((option) => filter('cute', option))
    expect(hit.map((option) => option.value)).toEqual(['cute_boy'])
  })

  it('空搜索词放行全部（includes("") 恒真，保持原生行为）', () => {
    const filter = createEchoTolerantFilterOption(() => '', matchesValueOrLabel)
    expect(voiceOptions.every((option) => filter('', option))).toBe(true)
  })

  it('option 缺省时按未命中处理（与 antd filterOption 语义一致）', () => {
    const filter = createEchoTolerantFilterOption(() => 'female-shaonv', matchesValueOrLabel)
    expect(filter('cute')).toBe(false)
    // 回显词仍放行，即使 option 缺省也不影响「展开即全量」。
    expect(filter('female-shaonv')).toBe(true)
  })

  it('自定义匹配逻辑只负责真实搜索分支，回显放行由工厂统一处理', () => {
    const exactValueMatch = createEchoTolerantFilterOption(
      () => '16:9',
      (query, option) =>
        String(option.value ?? '')
          .toLowerCase()
          .includes(query),
    )
    // 画布比例场景：选中 16:9 后再展开 → 全量可见。
    expect(exactValueMatch('16:9', { value: '1:1' })).toBe(true)
    // 输入其他词 → 仅按 value 匹配。
    expect(exactValueMatch('9:1', { value: '1:1' })).toBe(false)
  })
})
