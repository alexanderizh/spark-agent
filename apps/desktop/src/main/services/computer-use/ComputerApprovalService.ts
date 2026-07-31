import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type {
  ComputerActionEnvelope,
  ComputerApprovalTicket,
  ComputerRiskLevel,
} from '@spark/protocol'
import type { ComputerApprovalRow, CreatePendingComputerApprovalParams } from '@spark/storage'
import { ComputerApprovalTicketSchema } from '@spark/protocol'
import { ComputerUseBrokerError } from './ComputerUseBrokerError.js'

const DEFAULT_APPROVAL_TTL_MS = 5 * 60 * 1_000
const MAX_APPROVAL_TTL_MS = 15 * 60 * 1_000

export interface ComputerApprovalStore {
  createPending(params: CreatePendingComputerApprovalParams): ComputerApprovalRow
  get(id: string): ComputerApprovalRow | null
  findPendingByAction(
    computerSessionId: string,
    actionId: string,
    now: string,
  ): ComputerApprovalRow | null
  approve(params: {
    id: string
    approvedBy: 'local_user' | 'remote_device'
    approverId: string
    nonceHash: string
    approvedAt: string
  }): ComputerApprovalRow | null
  consume(params: {
    id: string
    nonceHash: string
    actionDigest: string
    targetDigest: string
    dataClassDigest: string | null
    usedAt: string
  }): boolean
  deny(id: string, computerSessionId: string, deniedAt: string): boolean
  denyPendingForSession(computerSessionId: string, deniedAt: string): number
}

export interface ComputerApprovalServiceOptions {
  repository: ComputerApprovalStore
  now?: () => Date
  createId?: () => string
  createNonce?: () => string
}

export class ComputerApprovalService {
  private readonly repository: ComputerApprovalStore
  private readonly now: () => Date
  private readonly createId: () => string
  private readonly createNonce: () => string
  private readonly approvedTickets = new Map<string, ComputerApprovalTicket>()

  constructor(options: ComputerApprovalServiceOptions) {
    this.repository = options.repository
    this.now = options.now ?? (() => new Date())
    this.createId = options.createId ?? randomUUID
    this.createNonce = options.createNonce ?? (() => randomBytes(32).toString('base64url'))
  }

  request(
    envelope: ComputerActionEnvelope,
    riskLevel: Extract<ComputerRiskLevel, 'L2' | 'L3'>,
    options: { ttlMs?: number } = {},
  ): ComputerApprovalRow {
    const ttlMs = options.ttlMs ?? DEFAULT_APPROVAL_TTL_MS
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_APPROVAL_TTL_MS) {
      throw new RangeError('Computer approval TTL is outside the supported range')
    }
    const createdAt = this.now()
    const digests = computeComputerApprovalDigests(envelope)
    const existing = this.repository.findPendingByAction(
      envelope.computerSessionId,
      envelope.actionId,
      createdAt.toISOString(),
    )
    if (existing != null) {
      if (
        existing.risk_level !== riskLevel ||
        existing.action_digest !== digests.actionDigest ||
        existing.target_digest !== digests.targetDigest ||
        existing.data_class_digest !== digests.dataClassDigest
      ) {
        throw approvalMismatch()
      }
      return existing
    }
    return this.repository.createPending({
      id: this.createId(),
      computerSessionId: envelope.computerSessionId,
      actionId: envelope.actionId,
      riskLevel,
      ...digests,
      expiresAt: new Date(createdAt.getTime() + ttlMs).toISOString(),
      createdAt: createdAt.toISOString(),
    })
  }

  approve(input: {
    computerSessionId: string
    approvalId: string
    actionDigest: string
    targetDigest: string
    dataClassDigest: string | null
    approvedBy: 'local_user' | 'remote_device'
    approverId: string
  }): ComputerApprovalTicket {
    const existing = this.repository.get(input.approvalId)
    if (existing == null) throw approvalMismatch()
    if (
      existing.computer_session_id !== input.computerSessionId ||
      existing.action_digest !== input.actionDigest ||
      existing.target_digest !== input.targetDigest ||
      existing.data_class_digest !== input.dataClassDigest
    ) {
      throw approvalMismatch()
    }
    const approvedAt = this.now().toISOString()
    if (existing.expires_at <= approvedAt) throw approvalExpired()
    if (input.approvedBy === 'remote_device' && existing.risk_level !== 'L2') {
      throw approvalMismatch()
    }

    const nonce = this.createNonce()
    const approved = this.repository.approve({
      id: input.approvalId,
      approvedBy: input.approvedBy,
      approverId: input.approverId,
      nonceHash: sha256(nonce),
      approvedAt,
    })
    if (approved == null || approved.approved_at == null || approved.approved_by == null) {
      const current = this.repository.get(input.approvalId)
      if (current != null && current.expires_at <= approvedAt) throw approvalExpired()
      throw approvalMismatch()
    }

    const ticket = ComputerApprovalTicketSchema.parse({
      id: approved.id,
      computerSessionId: approved.computer_session_id,
      actionId: approved.action_id,
      riskLevel: approved.risk_level,
      actionDigest: approved.action_digest,
      targetDigest: approved.target_digest,
      dataClassDigest: approved.data_class_digest,
      approvedBy: approved.approved_by,
      approverId: approved.approver_id,
      approvedAt: approved.approved_at,
      expiresAt: approved.expires_at,
      nonce,
      usedAt: null,
    })
    this.approvedTickets.set(ticket.id, ticket)
    return ticket
  }

  takeApprovedTicket(approvalId: string): ComputerApprovalTicket | null {
    const ticket = this.approvedTickets.get(approvalId)
    if (ticket == null) return null
    this.approvedTickets.delete(approvalId)
    return ticket
  }

  get(approvalId: string): ComputerApprovalRow | null {
    return this.repository.get(approvalId)
  }

  consume(
    ticketInput: ComputerApprovalTicket,
    envelope: ComputerActionEnvelope,
    riskLevel: Extract<ComputerRiskLevel, 'L2' | 'L3'>,
  ): void {
    const ticket = ComputerApprovalTicketSchema.parse(ticketInput)
    const usedAt = this.now().toISOString()
    if (ticket.expiresAt <= usedAt) throw approvalExpired()
    if (
      ticket.computerSessionId !== envelope.computerSessionId ||
      ticket.actionId !== envelope.actionId ||
      ticket.riskLevel !== riskLevel ||
      ticket.usedAt !== null
    ) {
      throw approvalMismatch()
    }

    const digests = computeComputerApprovalDigests(envelope)
    if (
      ticket.actionDigest !== digests.actionDigest ||
      ticket.targetDigest !== digests.targetDigest ||
      ticket.dataClassDigest !== digests.dataClassDigest
    ) {
      throw approvalMismatch()
    }

    const consumed = this.repository.consume({
      id: ticket.id,
      nonceHash: sha256(ticket.nonce),
      ...digests,
      usedAt,
    })
    if (!consumed) {
      const current = this.repository.get(ticket.id)
      if (current != null && current.expires_at <= usedAt) throw approvalExpired()
      throw approvalMismatch()
    }
    this.approvedTickets.delete(ticket.id)
  }

  cancelPending(computerSessionId: string): number {
    for (const [approvalId, ticket] of this.approvedTickets) {
      if (ticket.computerSessionId === computerSessionId) this.approvedTickets.delete(approvalId)
    }
    return this.repository.denyPendingForSession(computerSessionId, this.now().toISOString())
  }

  deny(approvalId: string, computerSessionId: string): boolean {
    return this.repository.deny(approvalId, computerSessionId, this.now().toISOString())
  }
}

export interface ComputerApprovalDigests {
  actionDigest: string
  targetDigest: string
  dataClassDigest: string | null
}

export function computeComputerApprovalDigests(
  envelope: ComputerActionEnvelope,
): ComputerApprovalDigests {
  return {
    actionDigest: sha256(
      canonicalJson({
        action: envelope.action,
        effect: envelope.policyContext.effect,
        intent: envelope.intent,
        expectedPostcondition: envelope.expectedPostcondition ?? null,
        observedFrameId: envelope.observedFrameId,
        observedTreeVersion: envelope.observedTreeVersion,
      }),
    ),
    targetDigest: sha256(
      canonicalJson({
        appId: envelope.targetAppId,
        windowId: envelope.targetWindowId,
        target: envelope.policyContext.target,
      }),
    ),
    dataClassDigest:
      envelope.policyContext.dataClasses.length === 0
        ? null
        : sha256(canonicalJson([...envelope.policyContext.dataClasses].sort())),
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value != null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function approvalMismatch(): ComputerUseBrokerError {
  return new ComputerUseBrokerError('approval_mismatch', 'Computer approval did not match action')
}

function approvalExpired(): ComputerUseBrokerError {
  return new ComputerUseBrokerError('approval_expired', 'Computer approval has expired')
}
