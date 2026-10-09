/**
 * @module wiki-settings.test
 *
 * 知识库设置项的契约测试（S1 出口验收的「设置项读写 / 越界防护」部分）。
 *
 * 为什么这些断言重要：设置项是三处共用的一份定义（运行时预算裁剪、主进程写入
 * 校验、渲染端控件）。任何"键名漂移 / 默认值漂移 / 越界被静默接受"都会让用户
 * 以为改生效了、实际没生效 —— 方案 §12.2 明确要求越界**拒绝**而非钳制。
 */

import { describe, it, expect } from 'vitest'
import {
  WIKI_SETTING_BY_KEY,
  WIKI_SETTING_DEFINITIONS,
  WIKI_SETTING_GROUPS,
  WIKI_GROUP_KEY_PREFIXES,
  WIKI_SETTINGS_CATEGORY,
  isWikiSettingActive,
  validateWikiSettingValue,
} from './wiki-settings.js'

describe('知识库设置契约', () => {
  it('键名 / 分组自洽：无重复键，分组全部有定义，键前缀与分组一致', () => {
    const keys = WIKI_SETTING_DEFINITIONS.map((d) => d.key)
    expect(new Set(keys).size).toBe(keys.length)
    const groupIds = new Set(WIKI_SETTING_GROUPS.map((g) => g.id))
    for (const def of WIKI_SETTING_DEFINITIONS) {
      expect(groupIds.has(def.group)).toBe(true)
      // key 前缀必须落在该分组声明的前缀集合内（candidate/* 归 extract、
      // store/* 归 space 这类跨前缀映射在分组元数据里显式声明）
      const prefixes = WIKI_GROUP_KEY_PREFIXES.get(def.group) ?? []
      expect(
        prefixes.some((p) => def.key.startsWith(p)),
        `${def.key} 不属于分组 ${def.group} 的前缀集合 ${prefixes.join(',')}`,
      ).toBe(true)
      expect(def.label.length).toBeGreaterThan(0)
      expect(def.description.length).toBeGreaterThan(0)
    }
  })

  it('category 契约：设置落在 (category=wiki, key=<子路径>) 二元组', () => {
    expect(WIKI_SETTINGS_CATEGORY).toBe('wiki')
    // 方案文档里的扁平键 wiki/budget/xxx 语义等价于本文件的子路径键
    expect(WIKI_SETTING_BY_KEY.get('budget/readMaxTokens')?.default).toBe(3000)
  })

  it('布尔项：只接受布尔值', () => {
    expect(validateWikiSettingValue('budget/helpDisclosure', true)).toEqual({
      ok: true,
      value: true,
    })
    const bad = validateWikiSettingValue('budget/helpDisclosure', 'yes')
    expect(bad.ok).toBe(false)
    expect(bad.message).toContain('布尔')
  })

  it('数字项：区间内通过，越界拒绝（不静默钳制），非数字拒绝', () => {
    expect(validateWikiSettingValue('budget/readMaxTokens', 5000)).toEqual({
      ok: true,
      value: 5000,
    })
    // 服务端硬上限 8000
    const tooBig = validateWikiSettingValue('budget/readMaxTokens', 999_999)
    expect(tooBig.ok).toBe(false)
    expect(tooBig.message).toContain('8000')
    // 低于硬下限（防止调到 0 导致功能不可用）
    expect(validateWikiSettingValue('budget/readMaxTokens', 1).ok).toBe(false)
    // settings 存储形态是 JSON，字符串数字也应容错归一
    expect(validateWikiSettingValue('budget/searchLimit', '12')).toEqual({
      ok: true,
      value: 12,
    })
    expect(validateWikiSettingValue('budget/searchLimit', 'abc').ok).toBe(false)
    // 小数向下取整（UI 输入 3000.9）
    expect(validateWikiSettingValue('budget/readMaxTokens', 3000.9)).toEqual({
      ok: true,
      value: 3000,
    })
  })

  it('单轮总闸的硬上限 20000 生效（误设会撑爆上下文）', () => {
    expect(validateWikiSettingValue('budget/turnTotal', 20_000).ok).toBe(true)
    expect(validateWikiSettingValue('budget/turnTotal', 20_001).ok).toBe(false)
  })

  it('选择项：枚举外的取值被拒绝', () => {
    expect(validateWikiSettingValue('ui/defaultView', 'grid')).toEqual({
      ok: true,
      value: 'grid',
    })
    expect(validateWikiSettingValue('ui/defaultView', 'kanban').ok).toBe(false)
    expect(validateWikiSettingValue('store/bodyLocation', 'project').ok).toBe(true)
  })

  it('文本项：接受文本、拒绝非字符串、超长截断拒绝', () => {
    expect(validateWikiSettingValue('repo/ignoreGlobs', 'node_modules\ndist')).toEqual({
      ok: true,
      value: 'node_modules\ndist',
    })
    expect(validateWikiSettingValue('repo/ignoreGlobs', 42).ok).toBe(false)
    expect(validateWikiSettingValue('repo/ignoreGlobs', 'x'.repeat(4001)).ok).toBe(false)
  })

  it('未知键一律拒绝（防止把任意键写进 wiki 分类）', () => {
    const result = validateWikiSettingValue('budget/notARealKey', 1)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('未知')
  })

  it('默认值本身必须全部合法（否则回退默认会写出非法状态）', () => {
    for (const def of WIKI_SETTING_DEFINITIONS) {
      const checked = validateWikiSettingValue(def.key, def.default)
      expect(checked.ok, `${def.key} 的默认值 ${String(def.default)} 不合法`).toBe(true)
    }
  })

  it('抽取开关默认值符合 §9.6「人在回路优先」：自动抽取全关，显式沉淀开', () => {
    expect(WIKI_SETTING_BY_KEY.get('extract/enabled')?.default).toBe(false)
    expect(WIKI_SETTING_BY_KEY.get('extract/idle')?.default).toBe(false)
    expect(WIKI_SETTING_BY_KEY.get('extract/schedule')?.default).toBe(false)
    expect(WIKI_SETTING_BY_KEY.get('extract/manual')?.default).toBe(true)
    expect(WIKI_SETTING_BY_KEY.get('extract/milestone')?.default).toBe(true)
    // 工具瘦身默认关（全量挂载优先保证能力）
    expect(WIKI_SETTING_BY_KEY.get('budget/helpDisclosure')?.default).toBe(false)
  })

  it('梦境整理（dream）键契约：默认关、阈值 85 百分数、危险项默认关、枚举合法', () => {
    // 总开关与危险项默认关（计划 §5.1 / §12.1：不制造自动执行的默认行为）
    expect(WIKI_SETTING_BY_KEY.get('dream/enabled')?.default).toBe(false)
    expect(WIKI_SETTING_BY_KEY.get('dream/autoDeleteEnabled')?.default).toBe(false)
    // 自动落库阈值默认 85（用户已确认，计划 §12.1），存储为百分数整数
    expect(WIKI_SETTING_BY_KEY.get('dream/autoApplyThreshold')?.default).toBe(85)
    expect(validateWikiSettingValue('dream/autoApplyThreshold', 85)).toEqual({
      ok: true,
      value: 85,
    })
    expect(validateWikiSettingValue('dream/autoApplyThreshold', 101).ok).toBe(false)
    // 阈值 0 被硬下限拒绝：否则连 confidence 缺失（clamp 归 0）的垃圾提案都会自动落库
    expect(validateWikiSettingValue('dream/autoApplyThreshold', 0).ok).toBe(false)
    expect(validateWikiSettingValue('dream/autoApplyThreshold', 1)).toEqual({ ok: true, value: 1 })
    // 触发方式枚举：off / interval / cron
    expect(validateWikiSettingValue('dream/scheduleTrigger', 'cron')).toEqual({
      ok: true,
      value: 'cron',
    })
    expect(validateWikiSettingValue('dream/scheduleTrigger', 'hourly').ok).toBe(false)
    // 间隔分钟硬上下限（防误设过短导致烧 token）
    expect(validateWikiSettingValue('dream/scheduleIntervalMinutes', 1440).ok).toBe(true)
    expect(validateWikiSettingValue('dream/scheduleIntervalMinutes', 5).ok).toBe(false)
    // 渠道/模型留空合法（回落链：dream → extract/modelProfile → 会话默认）
    expect(validateWikiSettingValue('dream/providerProfile', '')).toEqual({
      ok: true,
      value: '',
    })
  })

  it('分片生效判定：S2 / S4 分组在 S1 标注为未生效', () => {
    const extract = WIKI_SETTING_BY_KEY.get('extract/enabled')!
    expect(isWikiSettingActive(extract, 'S1')).toBe(false)
    expect(isWikiSettingActive(extract, 'S2')).toBe(true)
    const repo = WIKI_SETTING_BY_KEY.get('repo/enabled')!
    expect(isWikiSettingActive(repo, 'S2')).toBe(false)
    expect(isWikiSettingActive(repo, 'S4')).toBe(true)
    // S1 已生效项
    expect(isWikiSettingActive(WIKI_SETTING_BY_KEY.get('budget/readMaxTokens')!, 'S1')).toBe(true)
  })
})
