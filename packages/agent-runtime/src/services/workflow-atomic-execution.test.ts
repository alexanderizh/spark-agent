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
  isWorkflowApprovalApprovedImpl,
  extractWorkflowApprovalCommentImpl,
} from './session.service.js'
import type { NormalizedWorkflowNode } from './workflow-executor.js'
import type { UserQuestionPrompt } from '@spark/protocol'
import path from 'node:path'

function node(kind: NormalizedWorkflowNode['kind'], config: Record<string, unknown> = {}): NormalizedWorkflowNode {
  return { id: `n-${kind}`, kind, title: `节点-${kind}`, config }
}

describe('shouldRunWorkflowAtomicNodeAsAgent', () => {
  it('skill/tool/mcp/plan/review/artifact 默认真实执行', () => {
    for (const kind of ['skill', 'tool', 'mcp', 'plan', 'review', 'artifact'] as const) {
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
    const text = buildWorkflowAtomicInstruction({ title: '标题', objective: '', inputs: {}, config: {} })
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
    expect((r as { content: string }).content).toBe('原始透传内容\n\n[input 结构化解析失败，已回落透传]')
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
    const answers = { cancelled: true, answers: [{ id: 'workflow-approval-decision', optionValue: 'approve' }] }
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
  }): Promise<{ state?: 'completed'; content: string } | { state: 'failed'; content: string; error?: { code?: string; message: string } }> {
    // execution:'static' 或未注册 → 回落透传（不读 mockDispatchReply，故 thunk 形态不会触发副作用）
    if (args.execution === 'static' || !args.isRegistered) {
      return { content: args.fallback }
    }
    const reply = typeof args.mockDispatchReply === 'function'
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
      mockDispatchReply: () => { dispatchCalled = true; return { state: 'completed', content: '{}' } },
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
    expect((result as { content: string }).content).toBe('裸输入\n\n[input 结构化解析失败，已回落透传]')
  })

  it("execution:'auto' + 派发失败 → 沿用 reply.state=failed（不消化错误）", async () => {
    const result = await runInputAtomic({
      execution: 'auto',
      isRegistered: true,
      mockDispatchReply: { state: 'failed', content: '', error: { code: 'timeout', message: '派发超时' } },
      fallback: '裸输入',
    })
    expect(result.state).toBe('failed')
  })
})
