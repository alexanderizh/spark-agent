/**
 * PermissionService 单元测试 — 覆盖 PR1-2 修复的三个 Bug：
 *
 *   1. TOOL_ACTION_MAP 已包含 bash/git → ask（不再被默认 'allow' 漏掉）
 *   2. session allow/deny 只写内存，不再 updateRuleMode 写穿 DB
 *   3. 审批 Promise 有 timeout，cancelPendingApprovals 能主动拒绝挂起项
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PermissionProfileRepository, PermissionRuleRow } from '@spark/storage'
import { PermissionService } from '../../services/permission.service.js'

/** 最小 in-memory 实现，足以驱动 PermissionService 的所有路径 */
function makeMockRepo(
  initialRules: Array<Partial<PermissionRuleRow>> = [],
): PermissionProfileRepository {
  const rules: PermissionRuleRow[] = initialRules.map((r, i) => ({
    id: r.id ?? `rule-${i}`,
    profile_id: r.profile_id ?? 'project-standard',
    action: r.action ?? 'file_read',
    scope: r.scope ?? 'workspace',
    mode: r.mode ?? 'allow',
    sort_order: r.sort_order ?? i,
  }))
  const profiles: Array<{
    id: string
    name: string
    sandbox_level: number
    is_builtin: number
    created_at: string
  }> = []
  const settings = new Map<string, string>()
  const decisions: Array<{
    id: string
    scope: 'project' | 'global'
    project_id: string | null
    workspace_ids_json: string | null
    action: string
    tool_name: string
    decision: 'allow' | 'deny'
    created_at: string
    updated_at: string
  }> = []
  return {
    ensureSchema: vi.fn(),
    hasProfiles: () => profiles.length > 0,
    listProfiles: () => profiles.slice(),
    getProfile: (id: string) => profiles.find((p) => p.id === id) ?? null,
    createProfile: vi.fn((params) => {
      const row = {
        id: params.id,
        name: params.name,
        sandbox_level: params.sandboxLevel ?? 2,
        is_builtin: params.isBuiltin ? 1 : 0,
        created_at: new Date().toISOString(),
      }
      profiles.push(row)
      return row
    }),
    updateProfile: vi.fn(() => null),
    deleteProfile: vi.fn(() => true),
    listRules: vi.fn((_profileId: string) => rules.slice()),
    upsertRule: vi.fn((params) => {
      const row: PermissionRuleRow = {
        id: params.id,
        profile_id: params.profileId,
        action: params.action,
        scope: params.scope,
        mode: params.mode,
        sort_order: params.sortOrder ?? rules.length,
      }
      const existing = rules.findIndex((r) => r.id === params.id)
      if (existing >= 0) rules[existing] = row
      else rules.push(row)
      return row
    }),
    updateRuleMode: vi.fn((id: string, mode: string) => {
      const r = rules.find((x) => x.id === id)
      if (r) r.mode = mode
    }),
    getSetting: vi.fn((key: string) => settings.get(key) ?? null),
    setSetting: vi.fn((key: string, value: string) => {
      settings.set(key, value)
    }),
    upsertDecision: vi.fn((params) => {
      const row = {
        id: params.id,
        scope: params.scope,
        project_id: params.projectId ?? null,
        workspace_ids_json:
          params.workspaceIds != null ? JSON.stringify(params.workspaceIds) : null,
        action: params.action,
        tool_name: params.toolName,
        decision: params.decision,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      const existing = decisions.findIndex(
        (d) =>
          d.scope === row.scope &&
          (d.project_id ?? '') === (row.project_id ?? '') &&
          d.action === row.action &&
          d.tool_name === row.tool_name,
      )
      if (existing >= 0) decisions.splice(existing, 1)
      decisions.push(row)
      return row
    }),
    findDecision: vi.fn((params) => {
      const projectMatch = decisions.find(
        (d) =>
          d.scope === 'project' &&
          d.project_id === (params.projectId ?? null) &&
          d.action === params.action &&
          d.tool_name === params.toolName,
      )
      if (projectMatch != null) return projectMatch
      return (
        decisions.find(
          (d) =>
            d.scope === 'global' && d.action === params.action && d.tool_name === params.toolName,
        ) ?? null
      )
    }),
  } as unknown as PermissionProfileRepository
}

describe('PermissionService', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('TOOL_ACTION_MAP coverage (Bug 1)', () => {
    it('Claude SDK 原生工具名会归一化为对应 permission action', async () => {
      const repo = makeMockRepo([
        { action: 'file_read', mode: 'allow' },
        { action: 'file_write', mode: 'ask' },
        { action: 'network_known', mode: 'allow' },
      ])
      const svc = new PermissionService(repo)
      const push = vi.fn()

      await expect(
        svc.requestApproval('sess-1', 'Read', { file_path: 'README.md' }, push),
      ).resolves.toBe(true)
      expect(push).not.toHaveBeenCalled()

      const editPromise = svc.requestApproval('sess-1', 'Edit', { file_path: 'README.md' }, push)
      expect(push).toHaveBeenCalledTimes(1)
      expect(push.mock.calls[0]![0]).toMatchObject({
        toolName: 'Edit',
        action: 'file_write',
        riskLevel: 'medium',
      })
      svc.resolveApproval(push.mock.calls[0]![0].requestId, 'allow-once')
      await expect(editPromise).resolves.toBe(true)

      push.mockClear()
      await expect(
        svc.requestApproval('sess-1', 'WebSearch', { query: 'docs' }, push),
      ).resolves.toBe(true)
      expect(push).not.toHaveBeenCalled()
    })

    it('bash 工具被识别为 command_exec，命中 ask 而不是默认 allow', async () => {
      // command_exec 默认规则 mode = 'ask'
      const repo = makeMockRepo([{ action: 'command_exec', mode: 'ask' }])
      const svc = new PermissionService(repo)
      const push = vi.fn()
      const promise = svc.requestApproval('sess-1', 'bash', { command: 'ls' }, push)

      // 应该真的调用 pushFn（即触发了 ask，而不是被默认 allow 路径短路）
      expect(push).toHaveBeenCalledTimes(1)
      const req = push.mock.calls[0]![0]
      expect(req.toolName).toBe('bash')

      // 模拟用户拒绝
      svc.resolveApproval(req.requestId, 'deny')
      await expect(promise).resolves.toBe(false)
    })

    it('危险 Bash 命令会归类为 command_dangerous 并执行双重确认', async () => {
      const repo = makeMockRepo([{ action: 'command_dangerous', mode: 'ask-twice' }])
      const svc = new PermissionService(repo)
      const push = vi.fn()
      const promise = svc.requestApproval('sess-1', 'Bash', { command: 'git clean -fdx' }, push)

      expect(push).toHaveBeenCalledTimes(1)
      expect(push.mock.calls[0]![0]).toMatchObject({
        action: 'command_dangerous',
        riskLevel: 'high',
      })
      svc.resolveApproval(push.mock.calls[0]![0].requestId, 'allow-once')

      await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(2))
      expect(push.mock.calls[1]![0]).toMatchObject({
        action: 'command_dangerous',
        riskLevel: 'high',
      })
      svc.resolveApproval(push.mock.calls[1]![0].requestId, 'allow-once')

      await expect(promise).resolves.toBe(true)
    })

    it('未知工具默认归类为 command_exec + ask（更安全）', async () => {
      const repo = makeMockRepo([{ action: 'command_exec', mode: 'ask' }])
      const svc = new PermissionService(repo)
      const push = vi.fn()
      const promise = svc.requestApproval('sess-1', 'mystery_unknown_tool', {}, push)

      expect(push).toHaveBeenCalledTimes(1)
      svc.resolveApproval(push.mock.calls[0]![0].requestId, 'allow-once')
      await expect(promise).resolves.toBe(true)
    })
  })

  describe('session-scoped approval decisions (Bug 2)', () => {
    it('allow-session 不会调用 updateRuleMode（不再写穿 DB）', async () => {
      const repo = makeMockRepo([{ id: 'r1', action: 'command_exec', mode: 'ask' }])
      const svc = new PermissionService(repo)
      const push = vi.fn()
      const promise = svc.requestApproval('sess-A', 'bash', { command: 'ls' }, push)
      svc.resolveApproval(push.mock.calls[0]![0].requestId, 'allow-session')
      await expect(promise).resolves.toBe(true)

      expect(repo.updateRuleMode).not.toHaveBeenCalled()
    })

    it('allow-session 对同一 session 后续请求免审批，对其他 session 仍要 ask', async () => {
      const repo = makeMockRepo([{ id: 'r1', action: 'command_exec', mode: 'ask' }])
      const svc = new PermissionService(repo)
      const push = vi.fn()

      // sess-A 第一次：弹审批 → 允许本会话
      const p1 = svc.requestApproval('sess-A', 'bash', { command: 'ls' }, push)
      svc.resolveApproval(push.mock.calls[0]![0].requestId, 'allow-session')
      await expect(p1).resolves.toBe(true)

      // sess-A 第二次：不应再弹审批，直接 allow
      push.mockClear()
      const p2 = svc.requestApproval('sess-A', 'bash', { command: 'pwd' }, push)
      await expect(p2).resolves.toBe(true)
      expect(push).not.toHaveBeenCalled()

      // sess-B 第一次：仍需弹审批
      push.mockClear()
      const p3 = svc.requestApproval('sess-B', 'bash', { command: 'ls' }, push)
      expect(push).toHaveBeenCalledTimes(1)
      svc.resolveApproval(push.mock.calls[0]![0].requestId, 'deny')
      await expect(p3).resolves.toBe(false)
    })

    it('deny-session 对同一 session 后续请求直接拒绝，对其他 session 仍要 ask', async () => {
      const repo = makeMockRepo([{ id: 'r1', action: 'command_exec', mode: 'ask' }])
      const svc = new PermissionService(repo)
      const push = vi.fn()

      const p1 = svc.requestApproval('sess-A', 'bash', { command: 'ls' }, push)
      svc.resolveApproval(push.mock.calls[0]![0].requestId, 'deny-session')
      await expect(p1).resolves.toBe(false)

      push.mockClear()
      await expect(svc.requestApproval('sess-A', 'bash', { command: 'pwd' }, push)).resolves.toBe(
        false,
      )
      expect(push).not.toHaveBeenCalled()

      push.mockClear()
      const p3 = svc.requestApproval('sess-B', 'bash', { command: 'ls' }, push)
      expect(push).toHaveBeenCalledTimes(1)
      svc.resolveApproval(push.mock.calls[0]![0].requestId, 'allow-once')
      await expect(p3).resolves.toBe(true)
    })

    it('cancelPendingApprovals 清除该 session 的临时放行', async () => {
      const repo = makeMockRepo([{ id: 'r1', action: 'command_exec', mode: 'ask' }])
      const svc = new PermissionService(repo)
      const push = vi.fn()

      // 给 sess-A 临时放行
      const p1 = svc.requestApproval('sess-A', 'bash', { command: 'ls' }, push)
      svc.resolveApproval(push.mock.calls[0]![0].requestId, 'allow-session')
      await p1

      // 取消 session → 放行也被清掉
      svc.cancelPendingApprovals('sess-A')

      // 现在再请求应该重新弹审批
      push.mockClear()
      const p2 = svc.requestApproval('sess-A', 'bash', { command: 'ls' }, push)
      expect(push).toHaveBeenCalledTimes(1)
      svc.resolveApproval(push.mock.calls[0]![0].requestId, 'deny')
      await p2
    })

    it('cancelPendingApprovals 清除该 session 的临时拒绝', async () => {
      const repo = makeMockRepo([{ id: 'r1', action: 'command_exec', mode: 'ask' }])
      const svc = new PermissionService(repo)
      const push = vi.fn()

      const p1 = svc.requestApproval('sess-A', 'bash', { command: 'ls' }, push)
      svc.resolveApproval(push.mock.calls[0]![0].requestId, 'deny-session')
      await expect(p1).resolves.toBe(false)

      svc.cancelPendingApprovals('sess-A')

      push.mockClear()
      const p2 = svc.requestApproval('sess-A', 'bash', { command: 'ls' }, push)
      expect(push).toHaveBeenCalledTimes(1)
      svc.resolveApproval(push.mock.calls[0]![0].requestId, 'deny')
      await expect(p2).resolves.toBe(false)
    })
  })

  describe('remembered project/global decisions', () => {
    it('reports the selected approval scope to adapter callers', async () => {
      const repo = makeMockRepo([{ id: 'r1', action: 'command_exec', mode: 'ask' }])
      const svc = new PermissionService(repo)
      const push = vi.fn()
      const onDecision = vi.fn()

      const approval = svc.requestApproval('sess-A', 'Bash', { command: 'git status' }, push, {
        projectId: 'project-1',
        sdkRequestId: 'control-request-1',
        onDecision,
      })
      expect(push.mock.calls[0]![0]).toMatchObject({ sdkRequestId: 'control-request-1' })
      svc.resolveApproval(push.mock.calls[0]![0].requestId, 'allow-project')

      await expect(approval).resolves.toBe(true)
      expect(onDecision).toHaveBeenCalledWith('allow-project')
    })

    it('allow-project persists an action/tool decision and skips the next approval in the same project', async () => {
      const repo = makeMockRepo([{ id: 'r1', action: 'command_exec', mode: 'ask' }])
      const svc = new PermissionService(repo)
      const push = vi.fn()

      const p1 = svc.requestApproval('sess-A', 'bash', { command: 'ls' }, push, {
        projectId: 'project-1',
      })
      svc.resolveApproval(push.mock.calls[0]![0].requestId, 'allow-project')
      await expect(p1).resolves.toBe(true)
      expect(repo.upsertDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: 'project',
          projectId: 'project-1',
          action: 'command_exec',
          toolName: 'bash',
          decision: 'allow',
        }),
      )

      push.mockClear()
      await expect(
        svc.requestApproval('sess-B', 'bash', { command: 'pwd' }, push, { projectId: 'project-1' }),
      ).resolves.toBe(true)
      expect(push).not.toHaveBeenCalled()
    })

    it('deny-project persists a denial and blocks later matching requests', async () => {
      const repo = makeMockRepo([{ id: 'r1', action: 'command_exec', mode: 'ask' }])
      const svc = new PermissionService(repo)
      const push = vi.fn()

      const p1 = svc.requestApproval('sess-A', 'bash', { command: 'ls' }, push, {
        projectId: 'project-1',
      })
      svc.resolveApproval(push.mock.calls[0]![0].requestId, 'deny-project')
      await expect(p1).resolves.toBe(false)

      push.mockClear()
      await expect(
        svc.requestApproval('sess-B', 'bash', { command: 'pwd' }, push, { projectId: 'project-1' }),
      ).resolves.toBe(false)
      expect(push).not.toHaveBeenCalled()
    })
  })

  describe('Approval timeout & cancellation (Bug 3)', () => {
    it('5 分钟内无响应自动视为 deny（不会永久挂起）', async () => {
      const repo = makeMockRepo([{ action: 'command_exec', mode: 'ask' }])
      const svc = new PermissionService(repo)
      const push = vi.fn()
      const promise = svc.requestApproval('sess-1', 'bash', { command: 'ls' }, push)

      // 推进时间到 5 分钟 + 1ms
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1)
      await expect(promise).resolves.toBe(false)
    })

    it('cancelPendingApprovals 立即解析所有该 session 的挂起 approval 为 deny', async () => {
      const repo = makeMockRepo([{ action: 'command_exec', mode: 'ask' }])
      const svc = new PermissionService(repo)
      const push = vi.fn()
      const promise = svc.requestApproval('sess-X', 'bash', { command: 'ls' }, push)

      const cancelled = svc.cancelPendingApprovals('sess-X')
      expect(cancelled).toBe(1)
      await expect(promise).resolves.toBe(false)
    })

    it('cancelPendingApprovals 只影响指定 session，其他 session 的挂起不动', async () => {
      const repo = makeMockRepo([{ action: 'command_exec', mode: 'ask' }])
      const svc = new PermissionService(repo)
      const push = vi.fn()

      const pX = svc.requestApproval('sess-X', 'bash', { command: 'ls' }, push)
      const pY = svc.requestApproval('sess-Y', 'bash', { command: 'pwd' }, push)

      const cancelled = svc.cancelPendingApprovals('sess-X')
      expect(cancelled).toBe(1)
      await expect(pX).resolves.toBe(false)

      // sess-Y 仍然挂起，手动 resolve
      const yReqId = push.mock.calls.find((c) => c[0].sessionId === 'sess-Y')![0].requestId
      svc.resolveApproval(yReqId, 'allow-once')
      await expect(pY).resolves.toBe(true)
    })

    it('resolveApproval 后再 cancel 不会重复 resolve（无 unhandled）', async () => {
      const repo = makeMockRepo([{ action: 'command_exec', mode: 'ask' }])
      const svc = new PermissionService(repo)
      const push = vi.fn()
      const promise = svc.requestApproval('sess-1', 'bash', { command: 'ls' }, push)

      svc.resolveApproval(push.mock.calls[0]![0].requestId, 'allow-once')
      const cancelled = svc.cancelPendingApprovals('sess-1')
      expect(cancelled).toBe(0) // 已经 resolved，无可取消
      await expect(promise).resolves.toBe(true)
    })
  })

  describe('allow / deny / ask routing', () => {
    it('rule mode = allow → 立即返回 true，不调用 pushFn', async () => {
      const repo = makeMockRepo([{ action: 'file_read', mode: 'allow' }])
      const svc = new PermissionService(repo)
      const push = vi.fn()
      await expect(svc.requestApproval('s', 'read_file', { path: 'a.txt' }, push)).resolves.toBe(
        true,
      )
      expect(push).not.toHaveBeenCalled()
    })

    it('forcePrompt 会让 allow 规则仍然弹审批（用于会话 ask 模式）', async () => {
      const repo = makeMockRepo([{ action: 'file_write', mode: 'allow' }])
      const svc = new PermissionService(repo)
      const push = vi.fn()
      const promise = svc.requestApproval(
        's',
        'write_file',
        { path: 'new.txt', content: 'data' },
        push,
        { forcePrompt: true },
      )

      expect(push).toHaveBeenCalledTimes(1)
      svc.resolveApproval(push.mock.calls[0]![0].requestId, 'allow-once')
      await expect(promise).resolves.toBe(true)
    })

    it('forcePrompt 会忽略本会话旧拒绝并重新弹审批', async () => {
      const repo = makeMockRepo([{ action: 'command_exec', mode: 'ask' }])
      const svc = new PermissionService(repo)
      const push = vi.fn()

      const first = svc.requestApproval('s', 'bash', { command: 'git fetch origin main' }, push)
      svc.resolveApproval(push.mock.calls[0]![0].requestId, 'deny-session')
      await expect(first).resolves.toBe(false)

      push.mockClear()
      const second = svc.requestApproval(
        's',
        'bash',
        { command: 'git fetch origin main' },
        push,
        { forcePrompt: true },
      )

      expect(push).toHaveBeenCalledTimes(1)
      svc.resolveApproval(push.mock.calls[0]![0].requestId, 'allow-once')
      await expect(second).resolves.toBe(true)
    })

    it('forcePrompt 会忽略项目级旧拒绝并重新弹审批', async () => {
      const repo = makeMockRepo([{ action: 'command_exec', mode: 'ask' }])
      const svc = new PermissionService(repo)
      const push = vi.fn()

      const first = svc.requestApproval('s1', 'bash', { command: 'git merge feature' }, push, {
        projectId: 'project-1',
      })
      svc.resolveApproval(push.mock.calls[0]![0].requestId, 'deny-project')
      await expect(first).resolves.toBe(false)

      push.mockClear()
      const second = svc.requestApproval(
        's1',
        'bash',
        { command: 'git merge feature' },
        push,
        { forcePrompt: true, projectId: 'project-1' },
      )

      expect(push).toHaveBeenCalledTimes(1)
      svc.resolveApproval(push.mock.calls[0]![0].requestId, 'allow-once')
      await expect(second).resolves.toBe(true)
    })

    it('rule mode = deny → 立即返回 false，不调用 pushFn', async () => {
      const repo = makeMockRepo([{ action: 'command_exec', mode: 'deny' }])
      const svc = new PermissionService(repo)
      const push = vi.fn()
      await expect(svc.requestApproval('s', 'bash', { command: 'ls' }, push)).resolves.toBe(false)
      expect(push).not.toHaveBeenCalled()
    })

    it('forcePrompt 会让 deny 规则也重新弹审批（用于显式请求批准模式）', async () => {
      const repo = makeMockRepo([{ action: 'file_write', mode: 'deny' }])
      const svc = new PermissionService(repo)
      const push = vi.fn()
      const promise = svc.requestApproval(
        's',
        'write_file',
        { path: 'new.txt', content: 'data' },
        push,
        {
          forcePrompt: true,
        },
      )

      expect(push).toHaveBeenCalledTimes(1)
      svc.resolveApproval(push.mock.calls[0]![0].requestId, 'allow-once')
      await expect(promise).resolves.toBe(true)
    })
  })
})
