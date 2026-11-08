import { describe, expect, it } from 'vitest'
import { PROMPT_INJECTION_SOURCES, normalizeDisabledSources } from '@spark/protocol'
import {
  extractDisabledBuiltinNames,
  FILTERABLE_PROMPT_INJECTION_SOURCES,
  mergePromptFilterLayers,
  parsePromptFilterLayer,
  promptFilterMcpSignature,
} from './prompt-injection-filter.js'

const MCP_FILTERABLE_IDS = PROMPT_INJECTION_SOURCES.filter(
  (source) => source.group === 'mcp' && source.tier === 'filterable',
).map((source) => source.id)

describe('注册表结构约束', () => {
  it('mcp:* 可过滤条目与 OPTIONAL_HEAVY 清单一一对应（防两套体系漂移）', () => {
    // agent-mcp-policy.ts 的 OPTIONAL_HEAVY_BUILTIN_MCP_NAMES（8 个）。
    const optionalHeavy = [
      'spark_platform',
      'spark_plugins',
      'spark_app',
      'spark_media',
      'spark_image',
      'spark_browser',
      'spark_computer',
      'spark_search',
    ]
    const mcpNames = new Set(
      PROMPT_INJECTION_SOURCES.filter((source) => source.tier === 'filterable' && source.mcpName)
        .map((source) => source.mcpName)
        .filter((name): name is string => name != null),
    )
    expect([...mcpNames].sort()).toEqual([...optionalHeavy].sort())
  })

  it('锁定条目不携带 mcpName 进过滤口径（requiredMcp* 仅展示）', () => {
    for (const source of PROMPT_INJECTION_SOURCES) {
      if (source.tier === 'locked' && source.mcpName != null) {
        expect(source.id.startsWith('locked:')).toBe(true)
      }
    }
  })

  it('id 全局唯一', () => {
    const ids = PROMPT_INJECTION_SOURCES.map((source) => source.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('normalizeDisabledSources', () => {
  it('只保留 filterable key：locked key / 未注册 key / 非字符串被剔除', () => {
    expect(
      normalizeDisabledSources([
        'mcp:spark_platform',
        'inject:memory',
        'locked:applicationFoundation', // 锁定项不可写入
        'locked:requiredMcpFiles',
        'mcp:spark_unknown', // 注册表外
        'not-a-key',
        42, // 畸形输入兜底（入参 unknown）
      ]),
    ).toEqual(['mcp:spark_platform', 'inject:memory'])
  })

  it('去重保序 / 畸形输入按空处理', () => {
    expect(normalizeDisabledSources(['inject:memory', 'inject:memory', 'mcp:spark_browser'])).toEqual(
      ['inject:memory', 'mcp:spark_browser'],
    )
    expect(normalizeDisabledSources(undefined)).toEqual([])
    expect(normalizeDisabledSources('nope')).toEqual([])
  })
})

describe('mergePromptFilterLayers（会话层显式接管）', () => {
  it('两层都未配置 → 空集（不过滤 = 与现状一致）', () => {
    expect(mergePromptFilterLayers(undefined, undefined).size).toBe(0)
  })

  it('仅项目层配置 → 继承项目层', () => {
    const merged = mergePromptFilterLayers(['inject:memory', 'mcp:spark_browser'], undefined)
    expect(merged).toEqual(new Set(['inject:memory', 'mcp:spark_browser']))
  })

  it('会话层已配置（显式空数组也算）→ 整体接管，可临时开回项目层禁项', () => {
    // 项目禁多媒体、本会话要用：会话层显式空数组 = 全开。
    expect(mergePromptFilterLayers(['mcp:spark_media'], []).size).toBe(0)
    // 会话层部分接管：只生效会话层清单，不与项目层叠加。
    const merged = mergePromptFilterLayers(['mcp:spark_media', 'mcp:spark_browser'], [
      'mcp:spark_media',
      'inject:memory',
    ])
    expect(merged).toEqual(new Set(['mcp:spark_media', 'inject:memory']))
  })

  it('合并结果可变性隔离：返回的 Set 不受外部数组影响', () => {
    const session = ['inject:memory']
    const merged = mergePromptFilterLayers(undefined, session)
    session.push('mcp:spark_browser')
    expect(merged.has('mcp:spark_browser')).toBe(false)
  })
})

describe('extractDisabledBuiltinNames', () => {
  it('只映射 mcp:* 条目为内置名，纯提示词条目不入集合', () => {
    const disabled = new Set([
      ...MCP_FILTERABLE_IDS,
      'inject:memory',
      'inject:projectContext',
      'prompt:toolGuidance',
    ])
    const names = extractDisabledBuiltinNames(disabled)
    expect(names).toEqual(
      new Set([
        'spark_platform',
        'spark_browser',
        'spark_computer',
        'spark_media',
        'spark_image',
        'spark_search',
        'spark_app',
        'spark_plugins',
      ]),
    )
  })

  it('空集 → 空集合（门控 no-op）', () => {
    expect(extractDisabledBuiltinNames(new Set()).size).toBe(0)
  })
})

describe('promptFilterMcpSignature（resume 快照保护签名）', () => {
  it('只含 mcp:* 键，排序稳定', () => {
    const a = new Set(['inject:memory', 'mcp:spark_browser', 'mcp:spark_platform'])
    const b = new Set(['mcp:spark_platform', 'mcp:spark_browser', 'prompt:wikiL0'])
    expect(promptFilterMcpSignature(a)).toBe('mcp:spark_browser,mcp:spark_platform')
    expect(promptFilterMcpSignature(b)).toBe(promptFilterMcpSignature(a))
  })

  it('纯提示词键变化 → 签名不变（不触发 SDK 会话重建）', () => {
    const before = new Set(['mcp:spark_browser', 'inject:memory'])
    const after = new Set(['mcp:spark_browser', 'inject:memory', 'prompt:wikiL0'])
    expect(promptFilterMcpSignature(after)).toBe(promptFilterMcpSignature(before))
  })

  it('mcp 键增删 → 签名变化（触发重建）', () => {
    const before = new Set(['mcp:spark_browser'])
    const after = new Set(['mcp:spark_browser', 'mcp:spark_search'])
    expect(promptFilterMcpSignature(after)).not.toBe(promptFilterMcpSignature(before))
    expect(promptFilterMcpSignature(new Set())).toBe('')
  })
})

describe('parsePromptFilterLayer', () => {
  it('null / 非对象 / 缺 disabledSources 数组 → undefined（未配置）', () => {
    expect(parsePromptFilterLayer(null)).toBeUndefined()
    expect(parsePromptFilterLayer('x')).toBeUndefined()
    expect(parsePromptFilterLayer({})).toBeUndefined()
    expect(parsePromptFilterLayer({ disabledSources: 'nope' })).toBeUndefined()
  })

  it('合法对象 → 归一化数组（非法 key 剔除）', () => {
    expect(
      parsePromptFilterLayer({ disabledSources: ['inject:memory', 'locked:envVars', 'bogus'] }),
    ).toEqual(['inject:memory'])
  })
})

describe('FILTERABLE_PROMPT_INJECTION_SOURCES', () => {
  it('只含 filterable 条目且与注册表一致', () => {
    expect(FILTERABLE_PROMPT_INJECTION_SOURCES.every((source) => source.tier === 'filterable')).toBe(
      true,
    )
    expect(FILTERABLE_PROMPT_INJECTION_SOURCES.length).toBe(
      PROMPT_INJECTION_SOURCES.filter((source) => source.tier === 'filterable').length,
    )
  })
})
