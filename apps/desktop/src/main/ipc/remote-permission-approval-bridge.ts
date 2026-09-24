import { randomInt } from 'node:crypto'
import type {
  PermissionApprovalDecision,
  PermissionApprovalRequest,
  PermissionApprovalResolved,
} from '@spark/protocol'

export type RemotePermissionApprovalTarget = {
  connectionId: string
  externalId: string
}

export type RemotePermissionApprovalCommand = {
  requestCode: string
  decision: 'allow-once' | 'deny'
}

export type RemotePermissionApprovalReply = {
  ok: boolean
  title: string
  text: string
  requestId?: string
  sessionId?: string
  decision?: 'allow-once' | 'deny'
}

type PendingRemoteApproval = {
  request: PermissionApprovalRequest
  target: RemotePermissionApprovalTarget
  code: string
  expiresAt: number
}

type RemotePermissionApprovalBridgeDeps = {
  resolveApproval: (requestId: string, decision: PermissionApprovalDecision) => boolean
  sendReply: (target: RemotePermissionApprovalTarget, text: string) => Promise<void>
}

const REMOTE_APPROVAL_TTL_MS = 30 * 60_000

function sameTarget(
  first: RemotePermissionApprovalTarget,
  second: RemotePermissionApprovalTarget,
): boolean {
  return first.connectionId === second.connectionId && first.externalId === second.externalId
}

function redactApprovalValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[已省略]'
  if (typeof value === 'string') {
    return value
      .replace(/```/gu, '[代码块]')
      .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/giu, '$1[已隐藏]')
      .replace(
        /(^|[^A-Z0-9_])((?:[A-Z0-9]+[_-])*(?:API[_-]?KEY|ACCESS[_-]?KEY(?:[_-][A-Z0-9]+)*|ACCESS[_-]?TOKEN|REFRESH[_-]?TOKEN|AUTH[_-]?TOKEN|AUTHORIZATION|TOKEN|SECRET(?:[_-][A-Z0-9]+)*|PASSWORD|PASSWD|PRIVATE[_-]?KEY|CREDENTIAL|COOKIE))(\s*[:=]\s*|\s+)(?:"[^"]*"|'[^']*'|[^\s'",;]+)/giu,
        '$1$2$3[已隐藏]',
      )
      .slice(0, 500)
  }
  if (Array.isArray(value))
    return value.slice(0, 20).map((item) => redactApprovalValue(item, depth + 1))
  if (value != null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 30)
        .map(([key, item]) => [
          key,
          /api[_-]?key|access[_-]?key|token|secret|password|passwd|authorization|credential|cookie|private[_-]?key/iu.test(
            key,
          )
            ? '[已隐藏]'
            : redactApprovalValue(item, depth + 1),
        ]),
    )
  }
  return value
}

function newApprovalCode(existing: Set<string>): string {
  // Permission request IDs are random UUIDs. A separate short, unambiguous code
  // keeps the remote reply usable while the target chat check limits its scope.
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
  for (;;) {
    const code = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join('')
    if (!existing.has(code)) return code
  }
}

export function parseRemotePermissionApprovalCommand(
  text: string,
  commandPrefix = '/',
): { kind: 'command'; command: RemotePermissionApprovalCommand } | { kind: 'usage' } | null {
  const trimmed = text.trim()
  const prefix = commandPrefix.trim() || '/'
  if (!trimmed.startsWith(prefix)) return null

  const [rawName = '', ...args] = trimmed.slice(prefix.length).trim().split(/\s+/u).filter(Boolean)
  const name = rawName.toLowerCase().replace(/_/gu, '-')
  if (!['approve', 'allow', 'deny', 'reject'].includes(name)) return null
  if (args.length !== 1 || !/^[2-9A-HJ-NP-Z]{8}$/iu.test(args[0] ?? '')) {
    return { kind: 'usage' }
  }
  return {
    kind: 'command',
    command: {
      requestCode: (args[0] ?? '').toUpperCase(),
      decision: name === 'approve' || name === 'allow' ? 'allow-once' : 'deny',
    },
  }
}

export function formatRemotePermissionApprovalMessage(
  request: PermissionApprovalRequest,
  code: string,
  commandPrefix = '/',
): string {
  const riskLabel = { low: '低', medium: '中', high: '高' }[request.riskLevel]
  const safeInput = JSON.stringify(redactApprovalValue(request.toolInput), null, 2)
    .replace(/```/gu, '[代码块]')
    .slice(0, 1_200)
  const prefix = commandPrefix.trim() || '/'
  return [
    '⏸️ 远程会话正在等待权限审批',
    `工具：${request.toolName}`,
    `风险：${riskLabel}`,
    `审批码：${code}`,
    ...(safeInput === '{}' ? [] : [`请求内容：\n${safeInput}`]),
    '',
    `仅本次允许：${prefix}approve ${code}`,
    `拒绝：${prefix}deny ${code}`,
    '远程批准仅对这一次请求生效。',
  ].join('\n')
}

export function formatRemotePermissionApprovalExpired(expired: PermissionApprovalResolved): string {
  switch (expired.reason) {
    case 'timeout': {
      const minutes = Math.round((expired.timeoutMs ?? REMOTE_APPROVAL_TTL_MS) / 60_000)
      return `权限审批已超时（${minutes} 分钟未处理），本次操作已按拒绝处理。`
    }
    case 'cancelled':
      return '权限审批已随会话取消，本次操作不会执行。'
    case 'remote-approved':
      return '权限审批已在远程聊天中批准，本次操作将继续。'
    case 'remote-denied':
      return '权限审批已在远程聊天中拒绝，本次操作不会执行。'
  }
  return '权限审批状态已更新。'
}

export class RemotePermissionApprovalBridge {
  private readonly pendingByCode = new Map<string, PendingRemoteApproval>()
  private readonly codeByRequestId = new Map<string, string>()

  constructor(private readonly deps: RemotePermissionApprovalBridgeDeps) {}

  forwardRequest(
    request: PermissionApprovalRequest,
    target: RemotePermissionApprovalTarget,
    options: { enabled: boolean; commandPrefix: string },
  ): void {
    this.pruneExpired()
    if (!options.enabled) {
      void this.sendReply(
        target,
        `当前远程连接未开启「远程审批权限」。请在桌面端处理 ${request.toolName} 的权限请求。`,
      )
      return
    }

    const existingCode = this.codeByRequestId.get(request.requestId)
    if (existingCode != null) {
      const existing = this.pendingByCode.get(existingCode)
      if (existing != null && sameTarget(existing.target, target)) return
      this.removeRequest(request.requestId)
    }

    const code = newApprovalCode(new Set(this.pendingByCode.keys()))
    const entry: PendingRemoteApproval = {
      request,
      target,
      code,
      expiresAt: Date.now() + REMOTE_APPROVAL_TTL_MS,
    }
    this.pendingByCode.set(code, entry)
    this.codeByRequestId.set(request.requestId, code)
    void this.sendReply(
      target,
      formatRemotePermissionApprovalMessage(request, code, options.commandPrefix),
    )
  }

  async respond(
    target: RemotePermissionApprovalTarget,
    command: RemotePermissionApprovalCommand,
  ): Promise<RemotePermissionApprovalReply> {
    this.pruneExpired()
    const entry = this.pendingByCode.get(command.requestCode.toUpperCase())
    if (entry == null || !sameTarget(entry.target, target)) {
      return {
        ok: false,
        title: '审批无效',
        text: '审批码无效、已过期，或不属于当前远程聊天。请检查审批消息后重试。',
      }
    }

    const accepted = this.deps.resolveApproval(entry.request.requestId, command.decision)
    this.removeRequest(entry.request.requestId)
    if (!accepted) {
      return {
        ok: false,
        title: '审批已失效',
        text: '该权限请求已经超时或被取消，本次回复没有生效。',
        requestId: entry.request.requestId,
        sessionId: entry.request.sessionId,
      }
    }

    return {
      ok: true,
      title: command.decision === 'allow-once' ? '已批准一次' : '已拒绝',
      text:
        command.decision === 'allow-once'
          ? `已仅对 ${entry.request.toolName} 的本次请求授权，任务将继续。`
          : `已拒绝 ${entry.request.toolName} 的本次请求，任务将继续。`,
      requestId: entry.request.requestId,
      sessionId: entry.request.sessionId,
      decision: command.decision,
    }
  }

  notifyExpired(expired: PermissionApprovalResolved): void {
    const code = this.codeByRequestId.get(expired.requestId)
    if (code == null) return
    const entry = this.pendingByCode.get(code)
    this.removeRequest(expired.requestId)
    if (entry == null) return
    void this.sendReply(entry.target, formatRemotePermissionApprovalExpired(expired))
  }

  private removeRequest(requestId: string): void {
    const code = this.codeByRequestId.get(requestId)
    if (code == null) return
    this.codeByRequestId.delete(requestId)
    this.pendingByCode.delete(code)
  }

  private pruneExpired(): void {
    const now = Date.now()
    for (const [code, entry] of this.pendingByCode) {
      if (entry.expiresAt <= now) this.removeRequest(entry.request.requestId)
    }
  }

  private async sendReply(target: RemotePermissionApprovalTarget, text: string): Promise<void> {
    try {
      await this.deps.sendReply(target, text)
    } catch {
      // A remote send failure must not cancel the local approval or its timeout.
    }
  }
}
