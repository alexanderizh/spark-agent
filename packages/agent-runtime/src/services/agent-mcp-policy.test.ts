import { describe, expect, it } from 'vitest'
import {
  AGENT_MCP_OPTIONAL_BUILTIN_NAMES,
  AGENT_MCP_REQUIRED_BUILTIN_NAMES,
  BUILTIN_MCP_ID_PREFIX,
  agentMcpSelectionSignature,
  resolveAgentMcpAllowList,
  shouldMountBuiltinMcp,
  splitAgentMcpSelection,
} from './agent-mcp-policy.js'

const fullSelection = splitAgentMcpSelection(undefined)

describe('splitAgentMcpSelection', () => {
  it('未配置 / 空数组 / 畸形输入 → 全量模式（D1/D6「空=全量」）', () => {
    for (const input of [undefined, null, [], ['  ']] as const) {
      const selection = splitAgentMcpSelection(input)
      expect(selection.userServerIds).toBeUndefined()
      expect(selection.builtinNames.size).toBe(0)
      expect(selection.partial).toBe(false)
    }
  })

  it('仅用户 server id → 白名单模式，builtinNames 为空集', () => {
    const selection = splitAgentMcpSelection(['srv-a', 'srv-b'])
    expect(selection.partial).toBe(true)
    expect(selection.userServerIds).toEqual(new Set(['srv-a', 'srv-b']))
    expect(selection.builtinNames.size).toBe(0)
  })

  it('builtin:spark_* 合成 id 拆分为内置名（D3）', () => {
    const selection = splitAgentMcpSelection([
      'srv-a',
      `${BUILTIN_MCP_ID_PREFIX}platform`,
      `${BUILTIN_MCP_ID_PREFIX}search`,
    ])
    expect(selection.userServerIds).toEqual(new Set(['srv-a']))
    expect(selection.builtinNames).toEqual(new Set(['spark_platform', 'spark_search']))
  })

  it('前缀残留空名（builtin:spark_）与非字符串项被丢弃', () => {
    const selection = splitAgentMcpSelection([
      BUILTIN_MCP_ID_PREFIX,
      'srv-a',
      // @ts-expect-error 畸形输入兜底
      42,
    ])
    expect(selection.userServerIds).toEqual(new Set(['srv-a']))
    expect(selection.builtinNames.size).toBe(0)
  })
})

describe('resolveAgentMcpAllowList', () => {
  it('空 → undefined（与 buildMcpServersForSDK 裸调完全等价）', () => {
    expect(resolveAgentMcpAllowList(undefined)).toBeUndefined()
    expect(resolveAgentMcpAllowList([])).toBeUndefined()
  })

  it('含合成 id 的选择中，合成 id 不进用户 server 白名单（不命中 DB 行 id，无害）', () => {
    // 仅勾选内置（未勾任何用户 server）→ 用户 server 空集全摘（部分点选语义）
    expect(resolveAgentMcpAllowList([`${BUILTIN_MCP_ID_PREFIX}platform`])).toEqual(new Set())
    expect(resolveAgentMcpAllowList(['srv-a', `${BUILTIN_MCP_ID_PREFIX}search`])).toEqual(
      new Set(['srv-a']),
    )
  })
})

describe('shouldMountBuiltinMcp（D4 分级 + D5 引擎归位）', () => {
  it('必需档恒挂载（无视选择与引擎）', () => {
    for (const name of AGENT_MCP_REQUIRED_BUILTIN_NAMES) {
      expect(shouldMountBuiltinMcp(name, 'claude-sdk', fullSelection)).toBe(true)
      const noneSelected = splitAgentMcpSelection([`${BUILTIN_MCP_ID_PREFIX}platform`])
      expect(shouldMountBuiltinMcp(name, 'spark', noneSelected)).toBe(true)
    }
  })

  it('不进分级的内置（自身已有门控）恒挂载', () => {
    expect(shouldMountBuiltinMcp('spark_ui', 'claude-sdk', fullSelection)).toBe(true)
    const noneSelected = splitAgentMcpSelection(['srv-a'])
    expect(shouldMountBuiltinMcp('spark_wiki', 'codex', noneSelected)).toBe(true)
  })

  it('全量模式下可选档全挂（存量兼容 + 全选提交 []）', () => {
    for (const name of AGENT_MCP_OPTIONAL_BUILTIN_NAMES) {
      expect(shouldMountBuiltinMcp(name, 'claude-sdk', fullSelection)).toBe(true)
    }
  })

  it('仅选择用户 server（builtinNames 空）→ 可选档全不挂（与 UI「未勾选即不挂载」单一语义）', () => {
    const selection = splitAgentMcpSelection(['srv-a'])
    expect(shouldMountBuiltinMcp('spark_platform', 'claude-sdk', selection)).toBe(false)
    expect(shouldMountBuiltinMcp('spark_browser', 'claude-sdk', selection)).toBe(false)
    expect(shouldMountBuiltinMcp('spark_search', 'codex', selection)).toBe(false)
    // D5 引擎归位不受影响：spark_platform 在 spark / codex 引擎仍强制挂载
    expect(shouldMountBuiltinMcp('spark_platform', 'spark', selection)).toBe(true)
    // 必需档与不进分级的内置不受影响
    expect(shouldMountBuiltinMcp('spark_files', 'claude-sdk', selection)).toBe(true)
    expect(shouldMountBuiltinMcp('spark_ui', 'claude-sdk', selection)).toBe(true)
  })

  it('部分点选内置 → 未勾选的可选档被摘除，勾选的保留', () => {
    const selection = splitAgentMcpSelection([
      'srv-a',
      `${BUILTIN_MCP_ID_PREFIX}platform`,
      `${BUILTIN_MCP_ID_PREFIX}search`,
    ])
    expect(shouldMountBuiltinMcp('spark_platform', 'claude-sdk', selection)).toBe(true)
    expect(shouldMountBuiltinMcp('spark_search', 'claude-sdk', selection)).toBe(true)
    expect(shouldMountBuiltinMcp('spark_browser', 'claude-sdk', selection)).toBe(false)
    expect(shouldMountBuiltinMcp('spark_computer', 'codex', selection)).toBe(false)
  })

  it('D5：spark_platform 在 spark / codex 引擎强制归位必需档', () => {
    const selection = splitAgentMcpSelection([`${BUILTIN_MCP_ID_PREFIX}search`])
    expect(shouldMountBuiltinMcp('spark_platform', 'spark', selection)).toBe(true)
    expect(shouldMountBuiltinMcp('spark_platform', 'codex', selection)).toBe(true)
    // claude-sdk 引擎（有原生 Skill 工具兜底）按选择摘除
    expect(shouldMountBuiltinMcp('spark_platform', 'claude-sdk', selection)).toBe(false)
  })

  it('必需档 id 出现在选择里也不改变必需档恒挂载语义', () => {
    const selection = splitAgentMcpSelection([
      `${BUILTIN_MCP_ID_PREFIX}files`,
      `${BUILTIN_MCP_ID_PREFIX}platform`,
    ])
    expect(shouldMountBuiltinMcp('spark_files', 'spark', selection)).toBe(true)
    expect(shouldMountBuiltinMcp('spark_memory', 'spark', selection)).toBe(true)
    expect(shouldMountBuiltinMcp('spark_platform', 'spark', selection)).toBe(true)
    expect(shouldMountBuiltinMcp('spark_browser', 'claude-sdk', selection)).toBe(false)
  })
})

describe('agentMcpSelectionSignature', () => {
  it('顺序无关且空选择有稳定签名（resume 快照保护用）', () => {
    expect(agentMcpSelectionSignature(['b', 'a'])).toBe(agentMcpSelectionSignature(['a', 'b']))
    expect(agentMcpSelectionSignature(undefined)).toBe('')
    expect(agentMcpSelectionSignature([])).toBe('')
    expect(agentMcpSelectionSignature(['a'])).not.toBe(agentMcpSelectionSignature(['a', 'b']))
  })
})
