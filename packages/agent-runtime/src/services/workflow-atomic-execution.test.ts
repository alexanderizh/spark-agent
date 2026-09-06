/**
 * 工作流原子节点真实执行 helper 单测
 *
 * 覆盖（任务 A）：
 *  - execution 开关判定、临时 worker 构造与只读工具收窄、指令组装、artifact 导出路径穿越防护。
 *
 * 覆盖（任务 3：input 节点 LLM 结构化解析）：
 *  - shouldRunWorkflowAtomicNodeAsAgent 现把 'input' 视为真实执行。
 *  - buildWorkflowAtomicInstruction 对 input kind 输出严格 JSON schema 指令。
 *  - validateWorkflowInputStructuredContent：合法 JSON（含 ```json fence）通过、非法 JSON 回落透传 + 提示。
 *  - execution:'static' 时 input 经 shouldRunWorkflowAtomicNodeAsAgent 判定为 false（回落透传）。
 *
 * 覆盖（任务 4：审批节点双问询 decision + comment）：
 *  - decision（下标 0）按 approve/批准 / reject/拒绝 判定；comment（下标 1）文本提取；
 *    comment 为空 → content 不含 [审批修改意见] 段；comment 非空 → content 末尾追加；
 *    cancelled/declined/skipped → 未批准；这些纯函数覆盖 executeAtomicNode 回调中
 *    runWorkflowApprovalNode 的核心解析逻辑（通过 isWorkflowApprovalApprovedImpl / extractWorkflowApprovalCommentImpl）。
 *
 * 注：runSingleDispatch/onQuestion 是 SessionService 实例内部闭包，全量集成测试需实例化整个
 * SessionService（重依赖 db/bridge），不符合本文件「helper 单测」定位。这里通过把核心解析逻辑
 * 提为导出纯函数直接覆盖；executeAtomicNode 回调里只是把 buildWorkflowAtomicInstruction →
 * runSingleDispatch(reply) → validateWorkflowInputStructuredContent 串起来。
 */
import { describe, it, expect } from 'vitest'
import {
  workflowAtomicMemberId,
  shouldRunWorkflowAtomicNodeAsAgent,
  buildWorkflowAtomicInstruction,
  resolveWorkflowArtifactExportPath,
  validateWorkflowInputStructuredContent,
  validateWorkflowRouteDecisionContent,
  isWorkflowApprovalCancelledImpl,
  isWorkflowApprovalApprovedImpl,
  extractWorkflowApprovalCommentImpl,
} from './session.service.js'
import {
  createWorkflowSubagentMember,
  createWorkflowAtomicMember,
  buildWorkflowToolInvocationInstruction,
  formatWorkflowMcpToolResult,
  formatWorkflowPlatformToolResult,
  formatWorkflowVerifyCommandOutput,
  getDefaultWorkflowAtomicContent,
  getWorkflowToolInvocationSpec,
  memberDisallowedToolsFromConfig,
  buildWorkflowProgressNodes,
  buildWorkflowProgressNodeMetas,
  WORKFLOW_PROGRESS_PREVIEW_MAX_CHARS,
  shouldAttachWorkflowSessionMcp,
} from './session-workflow-helpers.js'
import type { AgentItem } from '@spark/storage'
import type { NormalizedWorkflowNode } from './workflow-executor.js'
import type { UserQuestionPrompt } from '@spark/protocol'
import path from 'node:path'

function node(
  kind: NormalizedWorkflowNode['kind'],
  config: Record<string, unknown> = {},
): NormalizedWorkflowNode {
  return { id: `n-${kind}`, kind, title: `节点-${kind}`, config }
}

describe('shouldRunWorkflowAtomicNodeAsAgent', () => {
  it('route/skill/tool/mcp/plan/review/artifact 默认真实执行', () => {
    for (const kind of ['route', 'skill', 'tool', 'mcp', 'plan', 'review', 'artifact'] as const) {
      expect(shouldRunWorkflowAtomicNodeAsAgent(node(kind))).toBe(true)
    }
  })

  it('input 现在也走真实执行（任务 3：LLM 结构化解析）', () => {
    expect(shouldRunWorkflowAtomicNodeAsAgent(node('input'))).toBe(true)
  })

  it('verify/approval/agent/subagent 仍不真实执行（各有专用路径）', () => {
    for (const kind of ['verify', 'approval', 'agent', 'subagent'] as const) {
      expect(shouldRunWorkflowAtomicNodeAsAgent(node(kind))).toBe(false)
    }
  })

  it('config.execution=static 强制回落静态回显（含 input）', () => {
    expect(shouldRunWorkflowAtomicNodeAsAgent(node('skill', { execution: 'static' }))).toBe(false)
    expect(shouldRunWorkflowAtomicNodeAsAgent(node('plan', { execution: 'static' }))).toBe(false)
    // input 走 static 也回落透传（任务 3 兜底要求）
    expect(shouldRunWorkflowAtomicNodeAsAgent(node('input', { execution: 'static' }))).toBe(false)
  })

  it('config.execution=auto 显式指定也真实执行', () => {
    expect(shouldRunWorkflowAtomicNodeAsAgent(node('mcp', { execution: 'auto' }))).toBe(true)
    expect(shouldRunWorkflowAtomicNodeAsAgent(node('input', { execution: 'auto' }))).toBe(true)
  })
})

describe('workflowAtomicMemberId', () => {
  it('与 agent/subagent workerId 命名空间隔离', () => {
    expect(workflowAtomicMemberId('abc')).toBe('workflow-atomic:abc')
  })
})

describe('createWorkflowSubagentMember binding inheritance', () => {
  it('inherits a bound Agent profile and preserves fields without node overrides', () => {
    const boundAgent = {
      id: 'specialist',
      name: 'Specialist',
      description: 'Bound specialist',
      builtIn: false,
      enabled: true,
      isDefault: false,
      providerProfileId: 'provider-specialist',
      modelId: 'model-specialist',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-ask',
      reasoningEffort: 'high',
      prompt: 'SPECIALIST_SENTINEL',
      ruleIds: ['rule-specialist'],
      skillIds: ['skill-specialist'],
      disabledSkillIds: ['skill-disabled'],
      mcpServerIds: ['mcp-specialist'],
      hookConfig: { hooks: [] },
      workflowId: null,
      metadata: { reasoningBudgetTokens: 4096 },
      createdAt: '2026-07-26T00:00:00.000Z',
      updatedAt: '2026-07-26T00:00:00.000Z',
    } satisfies AgentItem

    const member = createWorkflowSubagentMember(
      { id: 'research', kind: 'subagent', title: 'Research', config: {} },
      boundAgent,
      boundAgent.id,
    )

    expect(member).toMatchObject({
      id: 'specialist',
      providerProfileId: 'provider-specialist',
      modelId: 'model-specialist',
      prompt: 'SPECIALIST_SENTINEL',
      ruleIds: ['rule-specialist'],
      skillIds: ['skill-specialist'],
      disabledSkillIds: ['skill-disabled'],
      mcpServerIds: ['mcp-specialist'],
    })
    expect(member.metadata).toMatchObject({
      workflowNodeId: 'research',
      temporaryWorkflowSubagent: true,
      reasoningBudgetTokens: 4096,
    })
  })

  it('isolates two nodes bound to the same Agent and applies each node override', () => {
    const boundAgent = {
      id: 'specialist',
      name: 'Specialist',
      description: '',
      builtIn: false,
      enabled: true,
      isDefault: false,
      providerProfileId: 'provider-base',
      modelId: 'model-base',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-ask',
      reasoningEffort: 'high',
      prompt: 'base prompt',
      ruleIds: ['base-rule'],
      skillIds: ['base-skill'],
      disabledSkillIds: [],
      mcpServerIds: [],
      hookConfig: {},
      workflowId: null,
      metadata: {},
      createdAt: '2026-07-26T00:00:00.000Z',
      updatedAt: '2026-07-26T00:00:00.000Z',
    } satisfies AgentItem

    const first = createWorkflowSubagentMember(
      node('subagent', { prompt: 'first prompt', modelId: 'model-first' }),
      boundAgent,
      'workflow-subagent:first',
      true,
    )
    const second = createWorkflowSubagentMember(
      { ...node('subagent', { prompt: 'second prompt', modelId: 'model-second' }), id: 'second' },
      boundAgent,
      'workflow-subagent:second',
      true,
    )

    expect(first).toMatchObject({
      id: 'workflow-subagent:first',
      prompt: 'first prompt',
      modelId: 'model-first',
    })
    expect(second).toMatchObject({
      id: 'workflow-subagent:second',
      prompt: 'second prompt',
      modelId: 'model-second',
    })
  })

  it('lets an explicit empty toolIds override clear the bound Agent tool profile', () => {
    const boundAgent = {
      id: 'restricted',
      name: 'Restricted',
      description: '',
      builtIn: false,
      enabled: true,
      isDefault: false,
      providerProfileId: null,
      modelId: null,
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-ask',
      reasoningEffort: 'high',
      prompt: '',
      ruleIds: [],
      skillIds: [],
      disabledSkillIds: [],
      mcpServerIds: [],
      hookConfig: {},
      workflowId: null,
      metadata: { toolIds: ['Read'] },
      createdAt: '2026-07-26T00:00:00.000Z',
      updatedAt: '2026-07-26T00:00:00.000Z',
    } satisfies AgentItem

    const member = createWorkflowSubagentMember(
      node('subagent', { toolIds: [] }),
      boundAgent,
      'workflow-subagent:clear-tools',
      true,
    )

    expect(member.metadata).not.toHaveProperty('toolIds')
    expect(memberDisallowedToolsFromConfig(member)).toEqual([])
  })
})

describe('createWorkflowAtomicMember capability policy', () => {
  const hostAgent = {
    id: 'host',
    name: 'Host',
    description: '',
    builtIn: false,
    enabled: true,
    isDefault: false,
    providerProfileId: 'provider',
    modelId: 'model',
    agentAdapter: 'claude-sdk',
    permissionMode: 'claude-plan',
    reasoningEffort: 'high',
    prompt: '',
    ruleIds: [],
    skillIds: [],
    disabledSkillIds: [],
    mcpServerIds: [],
    hookConfig: {},
    workflowId: null,
    metadata: { reasoningBudgetTokens: 8192 },
    createdAt: '2026-07-26T00:00:00.000Z',
    updatedAt: '2026-07-26T00:00:00.000Z',
  } satisfies AgentItem

  it('marks input/route/plan/review/artifact workers as explicitly readonly', () => {
    for (const kind of ['input', 'route', 'plan', 'review', 'artifact'] as const) {
      expect(createWorkflowAtomicMember(node(kind), hostAgent).metadata).toMatchObject({
        workflowCapability: 'readonly',
      })
    }
    for (const kind of ['tool', 'mcp', 'skill'] as const) {
      expect(
        createWorkflowAtomicMember(node(kind, { toolIds: ['Read'] }), hostAgent).metadata,
      ).not.toHaveProperty('workflowCapability')
    }
  })

  it('inherits the host explicit reasoning token budget for temporary workers', () => {
    expect(createWorkflowAtomicMember(node('review'), hostAgent).metadata).toMatchObject({
      reasoningBudgetTokens: 8192,
    })
  })

  it('does not attach the session mutation MCP to readonly atomic workers', () => {
    expect(
      shouldAttachWorkflowSessionMcp(createWorkflowAtomicMember(node('plan'), hostAgent)),
    ).toBe(false)
    expect(
      shouldAttachWorkflowSessionMcp(createWorkflowAtomicMember(node('review'), hostAgent)),
    ).toBe(false)
    expect(
      shouldAttachWorkflowSessionMcp(createWorkflowAtomicMember(node('artifact'), hostAgent)),
    ).toBe(false)
    expect(
      shouldAttachWorkflowSessionMcp(createWorkflowAtomicMember(node('tool'), hostAgent)),
    ).toBe(true)
  })
})

describe('formatWorkflowVerifyCommandOutput', () => {
  it('keeps an explicit zero exit code when a successful command has no output', () => {
    expect(formatWorkflowVerifyCommandOutput('git diff --check', '', '', 0)).toBe(
      '$ git diff --check\n[exit code: 0]',
    )
  })

  it('keeps stderr and an unknown exit code for non-numeric failures', () => {
    expect(formatWorkflowVerifyCommandOutput('pnpm test', '', 'timed out', null)).toBe(
      '$ pnpm test\n[exit code: unknown]\ntimed out',
    )
  })
})

describe('buildWorkflowAtomicInstruction', () => {
  it('prompt 优先，并拼上目标与上游 inputs', () => {
    const text = buildWorkflowAtomicInstruction({
      title: 't',
      objective: '完成登录',
      inputs: { plan: '步骤1' },
      config: { prompt: '做这件事' },
    })
    expect(text).toContain('做这件事')
    expect(text).toContain('[Workflow objective]')
    expect(text).toContain('完成登录')
    expect(text).toContain('[Upstream inputs]')
    expect(text).toContain('步骤1')
  })

  it('无 prompt 时回落标题；无目标/inputs 时不加多余段', () => {
    const text = buildWorkflowAtomicInstruction({
      title: '标题',
      objective: '',
      inputs: {},
      config: {},
    })
    expect(text).toBe('标题')
  })

  it('input kind：要求结构化 JSON 输出，喂入 prompt/value/objective/constraint/inputs', () => {
    const text = buildWorkflowAtomicInstruction({
      kind: 'input',
      title: '需求录入',
      objective: '工作流目标',
      inputs: { upstream: '上游产物' },
      config: {
        prompt: '把下面这句话拆成结构化需求',
        value: '做一个登录页',
        objective: '节点级目标',
        constraint: '必须支持手机号',
      },
    })
    // 节点字段全部喂入
    expect(text).toContain('prompt: 把下面这句话拆成结构化需求')
    expect(text).toContain('value: 做一个登录页')
    expect(text).toContain('objective: 节点级目标')
    expect(text).toContain('constraint: 必须支持手机号')
    expect(text).toContain('upstream_inputs:')
    // 严格 JSON schema
    expect(text).toContain('{"objective":"...","constraints":["..."],"deliverables":["..."]}')
    expect(text).toContain('只输出 JSON')
    expect(text.toLowerCase()).toContain('不要')
  })

  it('input kind：缺省字段时也不崩（只用 title）', () => {
    const text = buildWorkflowAtomicInstruction({
      kind: 'input',
      title: '裸输入',
      objective: '',
      inputs: {},
      config: {},
    })
    expect(text).toContain('裸输入')
    expect(text).toContain('{"objective":"...","constraints":["..."],"deliverables":["..."]}')
    expect(text).toContain('(no fields configured)')
  })

  it('input kind：value 为对象时序列化为 JSON 字符串', () => {
    const text = buildWorkflowAtomicInstruction({
      kind: 'input',
      title: 't',
      objective: '',
      inputs: {},
      config: { value: { a: 1, b: ['x'] } },
    })
    expect(text).toContain('value: {"a":1,"b":["x"]}')
  })

  it('route kind：列出允许分支并要求只输出 value', () => {
    const text = buildWorkflowAtomicInstruction({
      kind: 'route',
      title: '复杂度路由',
      objective: '实现工作流',
      inputs: { objective: '补条件节点' },
      config: {
        prompt: '判断复杂度。',
        routeOptions: [
          { value: 'deep', label: '深度处理', description: '完整实现' },
          { value: 'quick', label: '快速处理' },
        ],
      },
    })
    expect(text).toContain('工作流「复杂度路由」的路由节点')
    expect(text).toContain('- deep (深度处理): 完整实现')
    expect(text).toContain('- quick (快速处理)')
    expect(text).toContain('[Workflow objective]')
    expect(text).toContain('[Upstream inputs]')
    expect(text).toContain('严格只输出一个分支 value 本身')
  })
})

describe('validateWorkflowInputStructuredContent', () => {
  it('合法 JSON（无 fence）原样返回、ok:true', () => {
    const raw = '{"objective":"登录","constraints":[],"deliverables":["页面"]}'
    const r = validateWorkflowInputStructuredContent(raw, 'fallback')
    expect(r.ok).toBe(true)
    expect((r as { content: string }).content).toBe(raw)
  })

  it('合法 JSON（```json fence 包裹）通过校验、原样返回内容（保留 fence）', () => {
    const raw = '```json\n{"objective":"x","constraints":[],"deliverables":[]}\n```'
    const r = validateWorkflowInputStructuredContent(raw, 'fallback')
    expect(r.ok).toBe(true)
    expect((r as { content: string }).content).toBe(raw)
  })

  it('非法 JSON：回落透传 fallback + 追加 [input 结构化解析失败，已回落透传] 提示，ok:false', () => {
    const r = validateWorkflowInputStructuredContent('这不是 JSON', '原始透传内容')
    expect(r.ok).toBe(false)
    expect((r as { content: string }).content).toBe(
      '原始透传内容\n\n[input 结构化解析失败，已回落透传]',
    )
  })

  it('空串：视为非法、回落透传', () => {
    const r = validateWorkflowInputStructuredContent('', 'fb')
    expect(r.ok).toBe(false)
    expect((r as { content: string }).content).toContain('[input 结构化解析失败，已回落透传]')
  })

  it('半截 JSON：视为非法、回落透传', () => {
    const r = validateWorkflowInputStructuredContent('{"objective":"x"', 'fb')
    expect(r.ok).toBe(false)
  })
})

describe('getDefaultWorkflowAtomicContent 静态值契约（input 静态值 / route 固定分支 UI 的运行时依赖）', () => {
  it('input：配了 value 时优先于 prompt/objective 透传（静态回显即固定输入）', () => {
    expect(
      getDefaultWorkflowAtomicContent({
        kind: 'input',
        title: '需求输入',
        objective: '工作流目标',
        config: { prompt: '解析需求', value: '{"objective":"固定输入"}' },
      }),
    ).toBe('{"objective":"固定输入"}')
  })

  it('input：value 为 number/boolean 时转字符串，对象 JSON 序列化', () => {
    expect(
      getDefaultWorkflowAtomicContent({
        kind: 'input',
        title: 't',
        objective: '',
        config: { value: 42 },
      }),
    ).toBe('42')
    expect(
      getDefaultWorkflowAtomicContent({
        kind: 'input',
        title: 't',
        objective: '',
        config: { value: { a: 1 } },
      }),
    ).toBe('{"a":1}')
  })

  it('route：value 命中 routeOptions 时直接输出该分支（固定路由，不经 LLM）', () => {
    expect(
      getDefaultWorkflowAtomicContent({
        kind: 'route',
        title: '决策路由',
        objective: '',
        config: {
          value: 'quick',
          routeOptions: [{ value: 'deep' }, { value: 'quick' }],
        },
      }),
    ).toBe('quick')
  })

  it('route：value 不在 routeOptions 内时回落首个分支，未配 value 时也回落首个分支', () => {
    const routeOptions = [{ value: 'deep' }, { value: 'quick' }]
    expect(
      getDefaultWorkflowAtomicContent({
        kind: 'route',
        title: 't',
        objective: '',
        config: { value: 'stale', routeOptions },
      }),
    ).toBe('deep')
    expect(
      getDefaultWorkflowAtomicContent({
        kind: 'route',
        title: 't',
        objective: '',
        config: { routeOptions },
      }),
    ).toBe('deep')
  })
})

describe('validateWorkflowRouteDecisionContent', () => {
  it('纯文本分支值命中 routeOptions 时返回规范 value', () => {
    const r = validateWorkflowRouteDecisionContent(' deep \n原因不用看', {
      routeOptions: [{ value: 'deep' }, { value: 'quick' }],
    })
    expect(r.ok).toBe(true)
    expect((r as { content: string }).content).toBe('deep')
  })

  it('Provider 聚合过程文本时接受末尾独占一行的合法分支值', () => {
    const r = validateWorkflowRouteDecisionContent(
      '先核对上游证据。\n\n验证完成，准备给出路由结果：\n\npass',
      {
        routeOptions: [{ value: 'pass' }, { value: 'follow_up' }],
      },
    )
    expect(r.ok).toBe(true)
    expect((r as { content: string }).content).toBe('pass')
  })

  it('不从普通说明文字中截取分支词', () => {
    const r = validateWorkflowRouteDecisionContent('证据里提到了 pass，但没有给出最终分支。', {
      routeOptions: [{ value: 'pass' }, { value: 'follow_up' }],
    })
    expect(r.ok).toBe(false)
  })

  it('JSON 字符串或对象也可解析为分支值', () => {
    const stringResult = validateWorkflowRouteDecisionContent('"quick"', {
      routeOptions: [{ value: 'deep' }, { value: 'quick' }],
    })
    const objectResult = validateWorkflowRouteDecisionContent('{"route":"deep"}', {
      routeOptions: [{ value: 'deep' }, { value: 'quick' }],
    })
    expect(stringResult.ok).toBe(true)
    expect((stringResult as { content: string }).content).toBe('quick')
    expect(objectResult.ok).toBe(true)
    expect((objectResult as { content: string }).content).toBe('deep')
  })

  it('输出不在 routeOptions 中时失败，避免误走错误分支', () => {
    const r = validateWorkflowRouteDecisionContent('maybe', {
      routeOptions: [{ value: 'deep' }, { value: 'quick' }],
    })
    expect(r.ok).toBe(false)
    expect((r as { message: string }).message).toContain('不在允许分支值中')
  })

  it('未配置 routeOptions 时接受任意非空分支值', () => {
    const r = validateWorkflowRouteDecisionContent('manual', {})
    expect(r.ok).toBe(true)
    expect((r as { content: string }).content).toBe('manual')
  })
})

describe('resolveWorkflowArtifactExportPath', () => {
  const root = path.resolve('/tmp/workspace-root')

  it('未配置 exportPath 时返回 ok:false 且无 reason（静默透传）', () => {
    const r = resolveWorkflowArtifactExportPath({}, root)
    expect(r.ok).toBe(false)
    expect((r as { reason?: string }).reason).toBeUndefined()
  })

  it('工作区内的相对路径解析为绝对路径', () => {
    const r = resolveWorkflowArtifactExportPath({ exportPath: 'out/report.md' }, root)
    expect(r.ok).toBe(true)
    expect((r as { absolutePath: string }).absolutePath).toBe(path.join(root, 'out/report.md'))
  })

  it('路径穿越（../）被拒', () => {
    const r = resolveWorkflowArtifactExportPath({ exportPath: '../evil.md' }, root)
    expect(r.ok).toBe(false)
    expect((r as { reason?: string }).reason).toBeTruthy()
  })

  it('绝对路径被拒', () => {
    const r = resolveWorkflowArtifactExportPath({ exportPath: '/etc/passwd' }, root)
    expect(r.ok).toBe(false)
    expect((r as { reason?: string }).reason).toBeTruthy()
  })

  it('同前缀的兄弟目录（root-evil）不被误判为工作区内', () => {
    const r = resolveWorkflowArtifactExportPath({ exportPath: '../workspace-root-evil/x.md' }, root)
    expect(r.ok).toBe(false)
  })
})

// ── 任务 4：审批节点双问询答案解析 ──────────────────────────────────────────────
//
// 模拟 runWorkflowApprovalNode 里 onQuestion([decision, comment]) 返回的 answers 形态：
// decision 在 answers.answers[0]（按 id/question/index 定位），comment 在 answers.answers[1]。

const decisionQuestion: UserQuestionPrompt = {
  id: 'workflow-approval-decision',
  header: '工作流审批',
  question: '工作流节点「N」请求继续',
  type: 'single_choice',
  options: [
    { label: '批准', value: 'approve' },
    { label: '拒绝', value: 'reject' },
  ],
}
const commentQuestion: UserQuestionPrompt = {
  id: 'workflow-approval-comment',
  header: '修改意见（可选）',
  question: '附带修改意见，将随审批结果传递给下游节点',
  type: 'text',
  multiline: true,
  placeholder: '可选：附带修改意见，将随审批结果传递给下游节点',
  allowSkip: true,
}

describe('审批 decision 解析（isWorkflowApprovalApprovedImpl）', () => {
  it('approve（optionValue）→ 已批准', () => {
    const answers = {
      answers: [
        { id: 'workflow-approval-decision', optionValue: 'approve', optionLabel: '批准' },
        { id: 'workflow-approval-comment', answer: '' },
      ],
    }
    expect(isWorkflowApprovalApprovedImpl(answers, decisionQuestion, 0)).toBe(true)
  })

  it('reject（optionValue）→ 未批准', () => {
    const answers = {
      answers: [
        { id: 'workflow-approval-decision', optionValue: 'reject', optionLabel: '拒绝' },
        { id: 'workflow-approval-comment', answer: '' },
      ],
    }
    expect(isWorkflowApprovalApprovedImpl(answers, decisionQuestion, 0)).toBe(false)
  })

  it('cancelled → 未批准', () => {
    const answers = {
      cancelled: true,
      answers: [{ id: 'workflow-approval-decision', optionValue: 'approve' }],
    }
    expect(isWorkflowApprovalApprovedImpl(answers, decisionQuestion, 0)).toBe(false)
  })

  it('declined → 未批准', () => {
    const answers = { declined: true, answers: [{ optionValue: 'approve' }] }
    expect(isWorkflowApprovalApprovedImpl(answers, decisionQuestion, 0)).toBe(false)
  })

  it('skipped 单条 → 未批准', () => {
    const answers = { answers: [{ id: 'workflow-approval-decision', skipped: true }] }
    expect(isWorkflowApprovalApprovedImpl(answers, decisionQuestion, 0)).toBe(false)
  })

  it('无明确取值 → 未批准', () => {
    const answers = { answers: [{ id: 'workflow-approval-decision' }] }
    expect(isWorkflowApprovalApprovedImpl(answers, decisionQuestion, 0)).toBe(false)
  })

  it('映射形态的 answers（按 id key）也能解析', () => {
    const answers = {
      answers: {
        'workflow-approval-decision': { optionValue: 'approve' },
        'workflow-approval-comment': { answer: 'xx' },
      },
    }
    expect(isWorkflowApprovalApprovedImpl(answers, decisionQuestion, 0)).toBe(true)
  })
})

describe('审批中断识别（isWorkflowApprovalCancelledImpl）', () => {
  it('会话或应用退出导致的 cancelled 应视为中断', () => {
    expect(isWorkflowApprovalCancelledImpl({ cancelled: true })).toBe(true)
  })

  it('用户明确选择 reject 不是系统中断', () => {
    expect(
      isWorkflowApprovalCancelledImpl({
        answers: [{ id: 'workflow-approval-decision', optionValue: 'reject' }],
      }),
    ).toBe(false)
  })
})

describe('审批 comment 解析（extractWorkflowApprovalCommentImpl）', () => {
  it('comment 非空文本 → 返回 trim 后的文本', () => {
    const answers = {
      answers: [
        { id: 'workflow-approval-decision', optionValue: 'approve' },
        { id: 'workflow-approval-comment', answer: '  请把按钮换成红色  ' },
      ],
    }
    expect(extractWorkflowApprovalCommentImpl(answers, commentQuestion, 1)).toBe('请把按钮换成红色')
  })

  it('comment 字段为 text/value 也能取值', () => {
    const answers = {
      answers: [
        { id: 'workflow-approval-decision', optionValue: 'approve' },
        { id: 'workflow-approval-comment', text: '改成夜间模式' },
      ],
    }
    expect(extractWorkflowApprovalCommentImpl(answers, commentQuestion, 1)).toBe('改成夜间模式')
  })

  it('comment 空串 → 返回空（content 不含修改意见段）', () => {
    const answers = {
      answers: [
        { id: 'workflow-approval-decision', optionValue: 'approve' },
        { id: 'workflow-approval-comment', answer: '' },
      ],
    }
    expect(extractWorkflowApprovalCommentImpl(answers, commentQuestion, 1)).toBe('')
  })

  it('comment skipped → 视为无意见（空串）', () => {
    const answers = {
      answers: [
        { id: 'workflow-approval-decision', optionValue: 'approve' },
        { id: 'workflow-approval-comment', skipped: true },
      ],
    }
    expect(extractWorkflowApprovalCommentImpl(answers, commentQuestion, 1)).toBe('')
  })

  it('comment 字段缺失（无 answers[1]）→ 返回空', () => {
    const answers = { answers: [{ id: 'workflow-approval-decision', optionValue: 'approve' }] }
    expect(extractWorkflowApprovalCommentImpl(answers, commentQuestion, 1)).toBe('')
  })
})

describe('审批节点 content 组装（任务 4 端到端契约）', () => {
  // 模拟 runWorkflowApprovalNode 批准后 content 组装逻辑：
  //   const comment = extractWorkflowApprovalCommentImpl(...)
  //   return comment.length > 0
  //     ? { content: `${base}\n\n[审批修改意见] ${comment}` }
  //     : { content: base }
  it('approve + comment → content 含 [审批修改意见] 段', () => {
    const answers = {
      answers: [
        { id: 'workflow-approval-decision', optionValue: 'approve' },
        { id: 'workflow-approval-comment', answer: '改成夜间模式' },
      ],
    }
    const approved = isWorkflowApprovalApprovedImpl(answers, decisionQuestion, 0)
    const comment = extractWorkflowApprovalCommentImpl(answers, commentQuestion, 1)
    expect(approved).toBe(true)
    expect(comment).toBe('改成夜间模式')
    const base = '工作流节点「N」请求继续：内容'
    const content = comment.length > 0 ? `${base}\n\n[审批修改意见] ${comment}` : base
    expect(content).toBe('工作流节点「N」请求继续：内容\n\n[审批修改意见] 改成夜间模式')
  })

  it('approve 无 comment → content 不含修改意见段', () => {
    const answers = {
      answers: [
        { id: 'workflow-approval-decision', optionValue: 'approve' },
        { id: 'workflow-approval-comment', answer: '' },
      ],
    }
    const approved = isWorkflowApprovalApprovedImpl(answers, decisionQuestion, 0)
    const comment = extractWorkflowApprovalCommentImpl(answers, commentQuestion, 1)
    expect(approved).toBe(true)
    expect(comment).toBe('')
    const base = '工作流节点「N」请求继续：内容'
    const content = comment.length > 0 ? `${base}\n\n[审批修改意见] ${comment}` : base
    expect(content).toBe('工作流节点「N」请求继续：内容')
    expect(content).not.toContain('[审批修改意见]')
  })

  it('reject → failed（未批准）', () => {
    const answers = {
      answers: [
        { id: 'workflow-approval-decision', optionValue: 'reject' },
        { id: 'workflow-approval-comment', answer: '理由' },
      ],
    }
    const approved = isWorkflowApprovalApprovedImpl(answers, decisionQuestion, 0)
    expect(approved).toBe(false)
    // 拒绝时 content 不重要，state=failed——runWorkflowApprovalNode 直接返回 failed。
  })
})

// ── 任务 3：input 节点 executeAtomicNode 回调端到端契约 ─────────────────────────
//
// 模拟 executeAtomicNode 回调里 input 分支的组装逻辑：
//   1. execution:'static' / 未注册 worker → 回落透传 getDefaultWorkflowAtomicContent
//   2. 经 runSingleDispatch 派发 → 拿到 reply.content
//   3. validateWorkflowInputStructuredContent(reply.content, fallback) → 最终 content
// 这里用 mock dispatch 函数模拟 runSingleDispatch。

describe('input 节点 executeAtomicNode 端到端契约（任务 3）', () => {
  // 模拟 executeAtomicNode input 分支主体（注入 mockDispatch = runSingleDispatch）。
  // mockDispatchReply 支持「值」或「thunk」两种形态：thunk 用于验证 static/未注册分支
  // 不应触发派发副作用（提前 return 时根本不会求值 thunk）。
  type MockDispatchReply =
    | { state?: 'completed'; content: string }
    | { state: 'failed'; content: string; error: { code?: string; message: string } }
  async function runInputAtomic(args: {
    execution: string
    isRegistered: boolean
    mockDispatchReply: MockDispatchReply | (() => MockDispatchReply)
    fallback: string
  }): Promise<
    | { state?: 'completed'; content: string }
    | { state: 'failed'; content: string; error?: { code?: string; message: string } }
  > {
    // execution:'static' 或未注册 → 回落透传（不读 mockDispatchReply，故 thunk 形态不会触发副作用）
    if (args.execution === 'static' || !args.isRegistered) {
      return { content: args.fallback }
    }
    const reply =
      typeof args.mockDispatchReply === 'function'
        ? args.mockDispatchReply()
        : args.mockDispatchReply
    if (reply.state !== 'completed') {
      return {
        state: 'failed' as const,
        content: reply.content,
        error: 'error' in reply ? reply.error : { message: 'dispatch failed' },
      }
    }
    const validated = validateWorkflowInputStructuredContent(reply.content, args.fallback)
    return { content: validated.content }
  }

  it("execution:'auto' + LLM 输出合法 JSON → content 是结构化结果（保留 LLM 原文）", async () => {
    const structured = '{"objective":"登录","constraints":["必须手机号"],"deliverables":["页面"]}'
    const result = await runInputAtomic({
      execution: 'auto',
      isRegistered: true,
      mockDispatchReply: { state: 'completed', content: structured },
      fallback: '裸输入',
    })
    expect(result.state ?? 'completed').toBe('completed')
    expect((result as { content: string }).content).toBe(structured)
  })

  it("execution:'auto' + LLM 输出 ```json fence 包裹 → 仍判为合法、原样保留", async () => {
    const fenced = '```json\n{"objective":"x","constraints":[],"deliverables":[]}\n```'
    const result = await runInputAtomic({
      execution: 'auto',
      isRegistered: true,
      mockDispatchReply: { state: 'completed', content: fenced },
      fallback: '裸输入',
    })
    expect((result as { content: string }).content).toBe(fenced)
  })

  it("execution:'static' → 直接回落透传 fallback、不经派发", async () => {
    let dispatchCalled = false
    const result = await runInputAtomic({
      execution: 'static',
      isRegistered: true,
      mockDispatchReply: () => {
        dispatchCalled = true
        return { state: 'completed', content: '{}' }
      },
      fallback: '静态值',
    })
    expect(dispatchCalled).toBe(false)
    expect((result as { content: string }).content).toBe('静态值')
  })

  it("execution:'auto' 但 worker 未注册 → 回落透传 fallback", async () => {
    const result = await runInputAtomic({
      execution: 'auto',
      isRegistered: false,
      mockDispatchReply: { state: 'completed', content: '{}' },
      fallback: '未注册时的裸值',
    })
    expect((result as { content: string }).content).toBe('未注册时的裸值')
  })

  it("execution:'auto' + LLM 输出非法 JSON → 回落透传 fallback + 追加失败提示", async () => {
    const result = await runInputAtomic({
      execution: 'auto',
      isRegistered: true,
      mockDispatchReply: { state: 'completed', content: '这不是 JSON 啊' },
      fallback: '裸输入',
    })
    expect((result as { content: string }).content).toBe(
      '裸输入\n\n[input 结构化解析失败，已回落透传]',
    )
  })

  it("execution:'auto' + 派发失败 → 沿用 reply.state=failed（不消化错误）", async () => {
    const result = await runInputAtomic({
      execution: 'auto',
      isRegistered: true,
      mockDispatchReply: {
        state: 'failed',
        content: '',
        error: { code: 'timeout', message: '派发超时' },
      },
      fallback: '裸输入',
    })
    expect(result.state).toBe('failed')
  })
})

// ─── 工具节点确定性调用 ──────────────────────────────────────────────────────

describe('getWorkflowToolInvocationSpec', () => {
  it('mcp 源：toolSource+toolServerId+toolName 齐备才生效，toolArgs 原样带出', () => {
    const spec = getWorkflowToolInvocationSpec({
      toolSource: 'mcp',
      toolServerId: ' srv-1 ',
      toolName: ' search ',
      toolArgs: { query: '{{brief}}' },
    })
    expect(spec).toEqual({
      source: 'mcp',
      serverId: 'srv-1',
      toolName: 'search',
      args: { query: '{{brief}}' },
    })
  })

  it('mcp 源缺 serverId → null（回落受限 worker 模式）', () => {
    expect(getWorkflowToolInvocationSpec({ toolSource: 'mcp', toolName: 'search' })).toBeNull()
  })

  it('builtin 源：工具名须在可限制目录内', () => {
    expect(getWorkflowToolInvocationSpec({ toolSource: 'builtin', toolName: 'Bash' })).toEqual({
      source: 'builtin',
      toolName: 'Bash',
      args: {},
    })
    expect(
      getWorkflowToolInvocationSpec({ toolSource: 'builtin', toolName: 'NotARealTool' }),
    ).toBeNull()
  })

  it('未配 toolSource / toolName、null 值 → 一律 null（向后兼容）', () => {
    expect(getWorkflowToolInvocationSpec({})).toBeNull()
    expect(getWorkflowToolInvocationSpec({ toolName: 'Bash' })).toBeNull()
    expect(getWorkflowToolInvocationSpec({ toolSource: null, toolName: 'Bash' })).toBeNull()
    expect(getWorkflowToolInvocationSpec({ toolSource: 'builtin', toolName: null })).toBeNull()
  })

  it('toolArgs 非对象（数组/字符串）按空参数处理', () => {
    expect(
      getWorkflowToolInvocationSpec({ toolSource: 'builtin', toolName: 'Grep', toolArgs: 'oops' }),
    ).toEqual({
      source: 'builtin',
      toolName: 'Grep',
      args: {},
    })
  })

  it('kind=mcp：mcp 源照常生效，builtin 源视为无效配置回落 worker 模式', () => {
    expect(
      getWorkflowToolInvocationSpec(
        {
          toolSource: 'mcp',
          toolServerId: 'srv-9',
          toolName: 'fetch',
          toolArgs: { url: '{{source}}' },
        },
        'mcp',
      ),
    ).toEqual({
      source: 'mcp',
      serverId: 'srv-9',
      toolName: 'fetch',
      args: { url: '{{source}}' },
    })
    // mcp 节点 UI 不提供 builtin 入口；手改 JSON 配了也按无效处理，
    // 避免锁定派发落在一个工具面未收窄的 worker 上（createWorkflowAtomicMember 只锁 tool kind）。
    expect(
      getWorkflowToolInvocationSpec({ toolSource: 'builtin', toolName: 'Bash' }, 'mcp'),
    ).toBeNull()
    // 未传 kind 的旧调用保持三态兼容（tool 节点路径）。
    expect(getWorkflowToolInvocationSpec({ toolSource: 'builtin', toolName: 'Bash' })?.source).toBe(
      'builtin',
    )
  })

  it('platform 源：tool 节点生效（无需 serverId，名字不校验存在性），mcp 节点不认', () => {
    // 工具包工具标识 `packageId/toolName` 与自定义工具 id（slug）都合法；
    // 存在性在执行期查目录（目录动态，解析期校验无意义）。
    expect(
      getWorkflowToolInvocationSpec({
        toolSource: 'platform',
        toolName: ' qr-generator/generate_qr ',
        toolArgs: { text: '{{url}}' },
      }),
    ).toEqual({
      source: 'platform',
      toolName: 'qr-generator/generate_qr',
      args: { text: '{{url}}' },
    })
    expect(getWorkflowToolInvocationSpec({ toolSource: 'platform', toolName: 'my_tool' })).toEqual({
      source: 'platform',
      toolName: 'my_tool',
      args: {},
    })
    // mcp 节点 UI 不提供 platform 入口；手改 JSON 配了同样按无效回落。
    expect(
      getWorkflowToolInvocationSpec({ toolSource: 'platform', toolName: 'my_tool' }, 'mcp'),
    ).toBeNull()
    expect(getWorkflowToolInvocationSpec({ toolSource: 'platform', toolName: '   ' })).toBeNull()
  })
})

describe('formatWorkflowPlatformToolResult', () => {
  it('string 原样；空串/空值归一为占位提示', () => {
    expect(formatWorkflowPlatformToolResult('纯文本结果')).toBe('纯文本结果')
    expect(formatWorkflowPlatformToolResult('')).toBe('(平台工具未返回内容)')
    expect(formatWorkflowPlatformToolResult(null)).toBe('(平台工具未返回内容)')
    expect(formatWorkflowPlatformToolResult(undefined)).toBe('(平台工具未返回内容)')
  })

  it('{ text } 形态（自定义工具目录）取 text', () => {
    expect(formatWorkflowPlatformToolResult({ text: 'custom tool output', meta: { ms: 12 } })).toBe(
      'custom tool output',
    )
    // text 为空时继续走后续归一分支（meta 序列化兜底），不返回空串。
    expect(formatWorkflowPlatformToolResult({ text: '', meta: { ms: 12 } })).toContain('"ms": 12')
  })

  it('{ content: [...] } 形态（工具包 mcp-import）复用 MCP 拼接', () => {
    const result = formatWorkflowPlatformToolResult({
      content: [
        { type: 'text', text: '第一段' },
        { type: 'text', text: '第二段' },
      ],
    })
    expect(result).toBe('第一段\n第二段')
  })

  it('其余对象 JSON 序列化兜底（工具包 remote-http/process 的任意返回）', () => {
    expect(formatWorkflowPlatformToolResult({ rows: [1, 2], ok: true })).toBe(
      JSON.stringify({ rows: [1, 2], ok: true }, null, 2),
    )
  })
})

describe('createWorkflowAtomicMember 工具锁定（确定性调用）', () => {
  const hostAgent = {
    id: 'host',
    name: 'Host',
    description: '',
    builtIn: false,
    enabled: true,
    isDefault: false,
    providerProfileId: 'provider',
    modelId: 'model',
    agentAdapter: 'claude-sdk',
    permissionMode: 'claude-plan',
    reasoningEffort: 'high',
    prompt: '',
    ruleIds: [],
    skillIds: [],
    disabledSkillIds: [],
    mcpServerIds: [],
    hookConfig: {},
    workflowId: null,
    metadata: {},
    createdAt: '2026-07-26T00:00:00.000Z',
    updatedAt: '2026-07-26T00:00:00.000Z',
  } satisfies AgentItem

  it('builtin 源强制 metadata.toolIds=[toolName]，覆盖残留的旧 toolIds', () => {
    const member = createWorkflowAtomicMember(
      node('tool', { toolSource: 'builtin', toolName: 'Bash', toolIds: ['Read', 'Grep'] }),
      hostAgent,
    )
    expect(member.metadata).toMatchObject({ toolIds: ['Bash'] })
    expect(member.metadata).not.toHaveProperty('workflowCapability')
  })

  it('mcp 源不强制锁定 toolIds（原生直调不经 worker 工具面）', () => {
    const member = createWorkflowAtomicMember(
      node('tool', { toolSource: 'mcp', toolServerId: 's1', toolName: 'search' }),
      hostAgent,
    )
    expect(member.metadata).not.toHaveProperty('toolIds')
  })

  it('未配确定性调用的 tool 节点保持旧行为（toolIds 原样透传）', () => {
    const member = createWorkflowAtomicMember(node('tool', { toolIds: ['Read'] }), hostAgent)
    expect(member.metadata).toMatchObject({ toolIds: ['Read'] })
  })
})

describe('buildWorkflowToolInvocationInstruction', () => {
  it('包含工具名、参数 JSON、节点指令、目标与上游输入', () => {
    const instruction = buildWorkflowToolInvocationInstruction(
      {
        title: '跑测试',
        objective: '验证改动',
        inputs: { plan_result: '步骤1' },
        config: { prompt: '只跑受影响的包' },
      },
      { source: 'builtin', toolName: 'Bash', args: { command: 'pnpm test {{pkg}}' } },
    )
    expect(instruction).toContain('`Bash`')
    expect(instruction).toContain('"command":"pnpm test {{pkg}}"')
    expect(instruction).toContain('[Node directive]\n只跑受影响的包')
    expect(instruction).toContain('[Workflow objective]\n验证改动')
    expect(instruction).toContain('[Upstream inputs]')
    expect(instruction).toContain('plan_result')
  })
})

describe('formatWorkflowMcpToolResult', () => {
  it('text 内容按行拼接，非文本块降级为可读摘要', () => {
    const content = formatWorkflowMcpToolResult({
      content: [
        { type: 'text', text: '第一段' },
        { type: 'image', mimeType: 'image/png', data: 'abcd' },
        { type: 'text', text: '第二段' },
      ],
    })
    expect(content).toContain('第一段')
    expect(content).toContain('第二段')
    expect(content).toContain('[image: image/png')
  })

  it('空结果给出占位提示', () => {
    expect(formatWorkflowMcpToolResult({ content: [] })).toBe('(MCP 工具未返回内容)')
  })
})

describe('buildWorkflowProgressNodes', () => {
  const metas = [
    { nodeId: 'research', title: 'Research', kind: 'agent' },
    { nodeId: 'verify', title: 'Verify', kind: 'verify' },
    { nodeId: 'publish', title: 'Publish', kind: 'agent', agentId: 'writer', agentName: 'Writer' },
  ]

  it('终态快照携带 error/outputPreview/时间戳，failedNode 的 error 优先', () => {
    const nodes = buildWorkflowProgressNodes({
      metas,
      executions: [
        {
          nodeId: 'research',
          agentId: 'researcher',
          instruction: '',
          inputs: {},
          attempt: 1,
          state: 'completed',
          content: 'facts',
          startedAt: '2026-09-04T10:00:00.000Z',
          endedAt: '2026-09-04T10:00:05.000Z',
        },
        {
          nodeId: 'research',
          agentId: 'researcher',
          instruction: '',
          inputs: {},
          attempt: 2,
          state: 'completed',
          content: 'facts v2',
          startedAt: '2026-09-04T10:00:06.000Z',
          endedAt: '2026-09-04T10:00:09.000Z',
        },
      ],
      atomicExecutions: [
        {
          nodeId: 'verify',
          kind: 'verify',
          state: 'failed',
          outputKey: 'v',
          content: 'pnpm test exited 1',
          error: { code: 'verify_failed', message: 'record level error' },
          startedAt: '2026-09-04T10:00:10.000Z',
          endedAt: '2026-09-04T10:00:12.000Z',
        },
      ],
      runningNodeIds: new Set<string>(),
      completedNodeIds: new Set(['research']),
      skippedNodeIds: new Set(['publish']),
      failedNodeId: 'verify',
      failedNodeError: { code: 'workflow_failed', message: 'failedNode level error' },
      terminal: true,
    })

    expect(nodes).toHaveLength(3)
    const research = nodes[0]!
    expect(research.status).toBe('completed')
    // 重试两条记录：startedAt 取首条、endedAt 取末条，输出预览取末条 content。
    expect(research.startedAt).toBe('2026-09-04T10:00:00.000Z')
    expect(research.endedAt).toBe('2026-09-04T10:00:09.000Z')
    expect(research.outputPreview).toBe('facts v2')
    expect(research.error).toBeUndefined()

    const verify = nodes[1]!
    expect(verify.status).toBe('failed')
    // failedNode 的 error 优先于执行记录的 error。
    expect(verify.error).toEqual({ code: 'workflow_failed', message: 'failedNode level error' })
    // 失败节点的 content 也作为输出预览携带（常含诊断信息）。
    expect(verify.outputPreview).toBe('pnpm test exited 1')

    const publish = nodes[2]!
    expect(publish.status).toBe('skipped')
    expect(publish.agentName).toBe('Writer')
    expect(publish.outputPreview).toBeUndefined()
    expect(publish.startedAt).toBeUndefined()
  })

  it('运行中快照不带 outputPreview，重试失败记录的 error 也透出', () => {
    const nodes = buildWorkflowProgressNodes({
      metas,
      executions: [
        {
          nodeId: 'research',
          agentId: 'researcher',
          instruction: '',
          inputs: {},
          attempt: 1,
          state: 'failed',
          content: 'partial output',
          error: { message: 'attempt 1 failed' },
          startedAt: '2026-09-04T10:00:00.000Z',
          endedAt: '2026-09-04T10:00:02.000Z',
        },
      ],
      atomicExecutions: [],
      runningNodeIds: new Set(['research']),
      completedNodeIds: new Set<string>(),
      skippedNodeIds: new Set<string>(),
      terminal: false,
    })

    const research = nodes[0]!
    expect(research.status).toBe('running')
    expect(research.outputPreview).toBeUndefined()
    expect(research.error).toEqual({ message: 'attempt 1 failed' })
  })

  it('超长输出按上限截断并追加省略号', () => {
    const longContent = 'x'.repeat(WORKFLOW_PROGRESS_PREVIEW_MAX_CHARS + 100)
    const nodes = buildWorkflowProgressNodes({
      metas: [{ nodeId: 'n1', title: 'N1', kind: 'agent' }],
      executions: [
        {
          nodeId: 'n1',
          agentId: 'w',
          instruction: '',
          inputs: {},
          attempt: 1,
          state: 'completed',
          content: longContent,
          startedAt: '2026-09-04T10:00:00.000Z',
          endedAt: '2026-09-04T10:00:01.000Z',
        },
      ],
      atomicExecutions: [],
      runningNodeIds: new Set<string>(),
      completedNodeIds: new Set(['n1']),
      skippedNodeIds: new Set<string>(),
      terminal: true,
    })
    expect(nodes[0]!.outputPreview).toBe(`${'x'.repeat(WORKFLOW_PROGRESS_PREVIEW_MAX_CHARS)}…`)
  })
})

describe('buildWorkflowProgressNodeMetas', () => {
  it('不把空绑定或失效绑定的 Agent 节点展示为宿主身份', () => {
    const metas = buildWorkflowProgressNodeMetas(
      [
        node('agent'),
        { ...node('agent', { agentId: 'deleted-agent' }), id: 'stale-agent' },
        {
          ...node('agent', { agentId: 'writer', modelId: 'node-model' }),
          id: 'valid-agent',
        },
      ],
      [
        { id: 'host-agent', name: 'Host', modelId: 'host-model' },
        { id: 'writer', name: 'Writer', modelId: 'writer-model' },
      ],
    )

    expect(metas).toEqual([
      { nodeId: 'n-agent', title: '节点-agent', kind: 'agent' },
      { nodeId: 'stale-agent', title: '节点-agent', kind: 'agent' },
      {
        nodeId: 'valid-agent',
        title: '节点-agent',
        kind: 'agent',
        agentId: 'writer',
        agentName: 'Writer',
        modelId: 'node-model',
      },
    ])
  })
})
