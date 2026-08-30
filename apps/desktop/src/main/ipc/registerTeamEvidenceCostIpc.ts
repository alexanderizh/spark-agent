import type { IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { SparkError } from '@spark/shared'
import { getDatabase } from '../db.js'
import { getMainWindow } from '../windows/index.js'
import { typedIpcHandle } from './typed-ipc.js'
import { TeamEvidenceCostBackend, type EvidenceCostMutation } from './teamEvidenceCostBackend.js'

const ID = z.string().trim().min(1).max(160)
const TEXT = z.string().trim().min(1).max(4_000)
const sessionId = z.string().uuid()
const scope = { sessionId, expectedDiscussionId: ID, opId: ID }
const link = z.object({ type: z.enum(['claim', 'task', 'handoff', 'deliberation', 'ledger']), id: ID }).strict()
const source = z.object({ type: z.enum(['file', 'test', 'tool', 'url', 'manual']), ref: z.string().trim().min(1).max(500) }).strict()
const bounded = <T extends z.ZodTypeAny>(item: T) => z.array(item).max(100)

export const TeamEvidenceCostIpcSchemas = {
  get: z.object({ sessionId, expectedDiscussionId: ID }).strict(),
  mutate: z.union([
    z.object({ ...scope, kind: z.literal('evidence'), action: z.literal('add'), id: ID, claim: TEXT, links: bounded(link), source, version: z.string().max(160).nullable().optional(), summary: TEXT, hash: z.string().max(256).nullable().optional() }).strict(),
    z.object({ ...scope, kind: z.literal('evidence'), action: z.enum(['verify', 'invalidate']), id: ID, expectedVersion: z.number().int().positive(), reason: TEXT.optional() }).strict(),
    z.object({ ...scope, kind: z.literal('usage'), action: z.literal('record'), id: ID, taskId: ID.nullable().optional(), agentId: ID.nullable().optional(), dispatchId: ID.nullable().optional(), tokens: z.number().int().nonnegative().nullable().optional(), amount: z.number().nonnegative().nullable().optional(), currency: z.string().trim().max(16).nullable().optional(), latencyMs: z.number().int().nonnegative().nullable().optional(), status: z.enum(['estimated', 'recorded', 'failed', 'unknown']), source: z.string().trim().max(500).nullable().optional() }).strict(),
    z.object({ ...scope, kind: z.literal('budget'), action: z.literal('set'), expectedVersion: z.number().int().nonnegative(), tokens: z.number().int().nonnegative().nullable().optional(), amount: z.number().nonnegative().nullable().optional(), currency: z.string().trim().max(16).nullable().optional() }).strict(),
  ]),
} as const

export function registerTeamEvidenceCostIpc(options: { backend?: Pick<TeamEvidenceCostBackend, 'getSnapshot' | 'mutate'>; authorizeRenderer?: (event: IpcMainInvokeEvent) => boolean } = {}): void {
  const backend = options.backend ?? new TeamEvidenceCostBackend({ db: getDatabase() })
  const authorize = options.authorizeRenderer ?? ((event: IpcMainInvokeEvent) => { const window = getMainWindow(); return window != null && !window.isDestroyed() && event.sender === window.webContents })
  const assertTrusted = (event: IpcMainInvokeEvent) => { if (!authorize(event)) throw new SparkError('PERMISSION_DENIED', 'Evidence Cost 仅允许主应用窗口访问。') }
  const localHandle = (channel: string, handler: (request: any, event: IpcMainInvokeEvent) => Promise<unknown>) => typedIpcHandle(channel as never, handler as never)
  localHandle('evidence-cost:get', async (request, event) => {
    assertTrusted(event)
    const parsed = TeamEvidenceCostIpcSchemas.get.parse(request)
    return backend.getSnapshot(parsed.sessionId, parsed.expectedDiscussionId)
  })
  localHandle('evidence-cost:mutate', async (request, event) => { assertTrusted(event); return backend.mutate(TeamEvidenceCostIpcSchemas.mutate.parse(request) as EvidenceCostMutation) })
}
