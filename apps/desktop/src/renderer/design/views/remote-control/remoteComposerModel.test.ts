import { describe, expect, it } from 'vitest'
import type { MobileBridgeCatalog, MobileBridgeSessionRuntime } from '@spark/protocol'
import {
  REMOTE_DEFAULT_AGENT_LABEL,
  REMOTE_DEFAULT_MODEL_LABEL,
  REMOTE_DEFAULT_PERMISSION_LABEL,
  REMOTE_DEFAULT_REASONING_LABEL,
  agentLabel,
  applyCommandPick,
  buildAgentOptions,
  buildModelOptions,
  buildPermissionOptions,
  buildReasoningOptions,
  filterRemoteCommands,
  modelLabel,
  permissionLabel,
  reasoningLabel,
  resolveAdapter,
  slashTriggerAt,
} from './remoteComposerModel'

const catalog: MobileBridgeCatalog = {
  agents: [
    {
      id: 'a1',
      name: '主人',
      description: '默认助手',
      agentAdapter: 'claude',
      isDefault: true,
    },
    {
      id: 'a2',
      name: '代码审查',
      description: '只读审查',
      agentAdapter: 'codex',
      isDefault: false,
    },
  ],
  workflows: [],
  providers: [
    {
      id: 'p-auto',
      name: '智能路由',
      providerType: 'auto',
      isAutoRouter: true,
      models: [],
    },
    {
      id: 'p-deepseek',
      name: 'DeepSeek',
      providerType: 'openai',
      isAutoRouter: false,
      models: [
        { id: 'deepseek-v4', name: 'V4.1-Flash' },
        { id: 'deepseek-r', name: 'R2' },
      ],
    },
  ],
  permissionModes: {
    claude: ['claude-ask', 'claude-auto', 'claude-bypass'],
    codex: ['codex-default', 'codex-full-access'],
  },
  reasoningEfforts: ['low', 'medium', 'high'],
}

describe('resolveAdapter', () => {
  it('优先使用会话生效的 adapter', () => {
    expect(resolveAdapter(catalog, { agentAdapter: 'codex' })).toBe('codex')
  })

  it('会话没给 adapter 时取默认助手', () => {
    expect(resolveAdapter(catalog, {})).toBe('claude')
  })

  it('目录也缺失时兜底 claude', () => {
    expect(resolveAdapter(null, null)).toBe('claude')
  })
})

describe('buildAgentOptions', () => {
  it('映射名称/描述并标记当前助手', () => {
    const options = buildAgentOptions(catalog, { agentId: 'a2' })
    expect(options.map((item) => item.label)).toEqual(['主人', '代码审查'])
    expect(options[1]?.selected).toBe(true)
    expect(options[0]?.selected).toBe(false)
    expect(options[0]?.description).toBe('默认助手')
  })

  it('目录缺失时没有选项（调用方据此隐藏 chip）', () => {
    expect(buildAgentOptions(null, {})).toEqual([])
  })
})

describe('buildModelOptions', () => {
  it('自动路由渠道合成一条「默认模型」项，modelId 为 null', () => {
    const options = buildModelOptions(catalog, {})
    const auto = options.find((item) => item.providerProfileId === 'p-auto')
    expect(auto?.modelId).toBeNull()
    expect(auto?.label).toContain('自动路由')
  })

  it('普通渠道按模型逐个展开，并标记当前选中项', () => {
    const options = buildModelOptions(catalog, {
      providerProfileId: 'p-deepseek',
      modelId: 'deepseek-r',
    })
    const deepseek = options.filter((item) => item.providerProfileId === 'p-deepseek')
    expect(deepseek).toHaveLength(2)
    expect(deepseek.find((item) => item.modelId === 'deepseek-r')?.selected).toBe(true)
    expect(deepseek.find((item) => item.modelId === 'deepseek-v4')?.selected).toBe(false)
  })
})

describe('buildPermissionOptions', () => {
  it('按目标端给出的合法档位生成，标签复用桌面端文案', () => {
    const options = buildPermissionOptions(catalog, 'claude', 'claude-auto')
    expect(options.map((item) => item.id)).toEqual(['claude-ask', 'claude-auto', 'claude-bypass'])
    expect(options[0]?.label).toBe('请求批准')
    expect(options[1]?.selected).toBe(true)
  })

  it('完全访问档带 danger 语气', () => {
    const options = buildPermissionOptions(catalog, 'claude', null)
    expect(options.find((item) => item.id === 'claude-bypass')?.tone).toBe('danger')
  })

  it('目录里没有该 adapter 的档位时返回空（隐藏权限 chip）', () => {
    expect(buildPermissionOptions(catalog, 'spark', 'spark-default')).toEqual([])
  })
})

describe('buildReasoningOptions', () => {
  it('按目标端枚举生成选项，中文标签复用桌面端文案并标记当前档', () => {
    const options = buildReasoningOptions(catalog, { reasoningEffort: 'high' })

    expect(options.map((item) => item.id)).toEqual(['low', 'medium', 'high'])
    expect(options.map((item) => item.label)).toEqual(['低', '平衡', '高'])
    expect(options[0]?.description).toBe('减少推理开销，适合明确而简单的任务')
    expect(options[2]?.selected).toBe(true)
    expect(options[0]?.selected).toBe(false)
  })

  it('目录缺失或枚举为空时没有选项（调用方据此隐藏 chip）', () => {
    expect(buildReasoningOptions(null, {})).toEqual([])
    expect(buildReasoningOptions({ ...catalog, reasoningEfforts: [] }, {})).toEqual([])
  })

  it('目标端比桌面端新（未收录的档位）时按裸值显示，不吞掉', () => {
    const options = buildReasoningOptions({ ...catalog, reasoningEfforts: ['ultra'] }, {})

    expect(options).toHaveLength(1)
    expect(options[0]).toMatchObject({ id: 'ultra', label: 'ultra' })
  })
})

describe('reasoningLabel', () => {
  it('已知档位走中文文案', () => {
    expect(reasoningLabel({ reasoningEffort: 'xhigh' })).toBe('超高')
  })

  it('runtime 没给值 = 跟随电脑端默认', () => {
    expect(reasoningLabel({})).toBe(REMOTE_DEFAULT_REASONING_LABEL)
    expect(reasoningLabel(null)).toBe(REMOTE_DEFAULT_REASONING_LABEL)
  })

  it('未知档位按裸值显示', () => {
    expect(reasoningLabel({ reasoningEffort: 'ultra' })).toBe('ultra')
  })
})

describe('chip 文案', () => {
  it('助手：缺省用兜底文案', () => {
    expect(agentLabel(catalog, {})).toBe(REMOTE_DEFAULT_AGENT_LABEL)
    expect(agentLabel(catalog, { agentId: 'a1' })).toBe('主人')
  })

  it('模型：优先模型名，其次渠道名', () => {
    expect(modelLabel(catalog, { providerProfileId: 'p-deepseek', modelId: 'deepseek-v4' })).toBe(
      'V4.1-Flash',
    )
    expect(modelLabel(catalog, { providerProfileId: 'p-auto', modelId: null })).toBe(
      '智能路由 · 自动',
    )
    expect(modelLabel(catalog, {})).toBe(REMOTE_DEFAULT_MODEL_LABEL)
  })

  it('模型：渠道里已找不到的 modelId 不直接当名字', () => {
    expect(modelLabel(catalog, { providerProfileId: 'p-deepseek', modelId: 'gone' })).toBe(
      'DeepSeek · 自定义模型',
    )
  })

  it('权限：高危档标记 danger，缺省为兜底文案', () => {
    expect(permissionLabel(catalog, { permissionMode: 'claude-bypass' })).toEqual({
      label: '完全访问',
      danger: true,
    })
    expect(permissionLabel(catalog, {})).toEqual({
      label: REMOTE_DEFAULT_PERMISSION_LABEL,
      danger: false,
    })
  })

  it('权限：目录缺失时按裸值显示且不误报高危', () => {
    expect(permissionLabel(null, { permissionMode: 'claude-bypass' })).toEqual({
      label: 'claude-bypass',
      danger: false,
    })
  })
})

describe('slashTriggerAt', () => {
  it('行首的 / 触发补全', () => {
    expect(slashTriggerAt('/rev', 4)).toEqual({ start: 0, end: 4, query: 'rev' })
  })

  it('空白之后的 / 触发补全', () => {
    expect(slashTriggerAt('帮我看看 /rev', 9)).toEqual({ start: 5, end: 9, query: 'rev' })
  })

  it('路径中间不触发', () => {
    expect(slashTriggerAt('/Users/me', 9)).toBeNull()
  })

  it('光标落在 / 之前时不触发', () => {
    expect(slashTriggerAt('使用 /rev 命令', 1)).toBeNull()
  })

  it('token 里再出现 / 视为路径，不触发', () => {
    expect(slashTriggerAt('/Users/me', 9)).toBeNull()
  })

  it('过长的 token 不当作命令', () => {
    expect(slashTriggerAt(`/${'x'.repeat(40)}`, 41)).toBeNull()
  })
})

describe('filterRemoteCommands', () => {
  const commands = [
    { name: 'review', description: '代码审查' },
    { name: 'clear', description: '清空上下文' },
    { name: 'revise', description: '改写上一段' },
    { name: 're', description: '另一个' },
  ]

  it('空前缀按原顺序返回', () => {
    expect(filterRemoteCommands(commands, '').map((item) => item.name)).toEqual([
      'review',
      'clear',
      'revise',
      're',
    ])
  })

  it('名称前缀优先于描述命中', () => {
    expect(filterRemoteCommands(commands, 'rev').map((item) => item.name)).toEqual([
      'review',
      'revise',
    ])
  })

  it('按描述也能搜到', () => {
    expect(filterRemoteCommands(commands, '上下文').map((item) => item.name)).toEqual(['clear'])
  })

  it('结果数量受限', () => {
    expect(filterRemoteCommands(commands, '', 2)).toHaveLength(2)
  })
})

describe('applyCommandPick', () => {
  it('替换 / 开头的 token 并把光标放到插入点之后', () => {
    const text = '请 /rev'
    const trigger = slashTriggerAt(text, text.length)
    if (trigger == null) throw new Error('应当触发命令补全')
    const result = applyCommandPick(text, trigger, 'review')
    expect(result.text).toBe('请 /review ')
    expect(result.caret).toBe(result.text.length)
  })

  it('保留 token 之后的内容', () => {
    const text = '/re 剩下的'
    const trigger = slashTriggerAt(text, 3)
    if (trigger == null) throw new Error('应当触发命令补全')
    const result = applyCommandPick(text, trigger, 'review')
    expect(result.text).toBe('/review  剩下的')
  })
})

describe('运行时缺字段的容错', () => {
  it('runtime 为 null 时不抛错', () => {
    const runtime: MobileBridgeSessionRuntime | null = null
    expect(() => agentLabel(catalog, runtime)).not.toThrow()
    expect(() => modelLabel(catalog, runtime)).not.toThrow()
    expect(() => permissionLabel(catalog, runtime)).not.toThrow()
  })
})
