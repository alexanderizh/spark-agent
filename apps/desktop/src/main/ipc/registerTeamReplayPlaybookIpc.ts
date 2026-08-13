import type { IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { SparkError } from '@spark/shared'
import { getDatabase } from '../db.js'
import { getMainWindow } from '../windows/index.js'
import { ReplayIpcSchemaRegistry } from '../../../../../packages/protocol/src/replay-playbook.js'
import { typedIpcHandle } from './typed-ipc.js'
import { TeamReplayPlaybookBackend, type DesktopPlaybookMutationRequest, type ReplayPlaybookListRequest } from './teamReplayPlaybookBackend.js'

const ID = z.string().trim().min(1).max(160)
const sessionId = z.string().uuid()
const limit = z.number().int().min(1).max(100).optional()
const scope = { sessionId, expectedDiscussionId: ID, opId: ID }
const json = z.unknown().superRefine((value, context) => {
  try {
    const seen = new Set<object>()
    let nodes = 0
    let bytes = 0
    const visit = (current: unknown, depth: number): void => {
      if (current == null) { bytes += 4; return }
      if (typeof current === 'string') { bytes += current.length + 2; return }
      if (typeof current === 'boolean' || typeof current === 'number') { if (typeof current === 'number' && !Number.isFinite(current)) throw new Error('Replay JSON must contain finite numbers'); bytes += 8; return }
      if (typeof current !== 'object' || seen.has(current)) throw new Error('Replay JSON must contain acyclic JSON values')
      if (depth >= 8 || ++nodes > 160) throw new Error('Replay JSON exceeds nesting or node limit')
      seen.add(current)
      for (const [key, item] of Array.isArray(current) ? current.entries() : Object.entries(current)) { bytes += String(key).length + 3; visit(item, depth + 1) }
      seen.delete(current)
    }
    visit(value, 0)
    if (bytes > 12_000) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Replay JSON exceeds serialized size limit' })
  } catch (error) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: error instanceof Error ? error.message : String(error) })
  }
})

const playbookMutation = z.union([
  z.object({ ...scope, action: z.literal('propose'), id: ID, name: ID, graph: json, roles: json, handoffRules: json, gateRules: json, deliberationRules: json, expectedVersion: z.number().int().nonnegative().optional() }).strict(),
  z.object({ ...scope, action: z.enum(['publish', 'archive']), id: ID, expectedVersion: z.number().int().positive() }).strict(),
  z.object({ ...scope, action: z.literal('apply'), id: ID, expectedVersion: z.number().int().positive(), targetDiscussionId: ID }).strict(),
])

export const TeamReplayPlaybookIpcSchemas = {
  timeline: ReplayIpcSchemaRegistry['replay:timeline'],
  diff: ReplayIpcSchemaRegistry['replay:diff'],
  fork: ReplayIpcSchemaRegistry['replay:fork'],
  list: z.object({ sessionId, expectedDiscussionId: ID, id: ID, limit }).strict(),
  mutate: playbookMutation,
} as const

export interface RegisterTeamReplayPlaybookIpcOptions {
  backend?: Pick<TeamReplayPlaybookBackend, 'getTimeline' | 'getDiff' | 'fork' | 'listPlaybook' | 'mutate'>
  authorizeRenderer?: (event: IpcMainInvokeEvent) => boolean
}

export function registerTeamReplayPlaybookIpc(options: RegisterTeamReplayPlaybookIpcOptions = {}): void {
  const backend = options.backend ?? new TeamReplayPlaybookBackend({ db: getDatabase() })
  const authorize = options.authorizeRenderer ?? ((event: IpcMainInvokeEvent) => {
    const window = getMainWindow()
    return window != null && !window.isDestroyed() && event.sender === window.webContents
  })
  const assertTrusted = (event: IpcMainInvokeEvent) => {
    if (!authorize(event)) throw new SparkError('PERMISSION_DENIED', 'Replay/Playbook 仅允许主应用窗口访问。')
  }
  const localHandle = (channel: string, handler: (request: unknown, event: IpcMainInvokeEvent) => Promise<unknown>) => typedIpcHandle(channel as never, handler as never)

  localHandle('replay:timeline', async (request, event) => { assertTrusted(event); return backend.getTimeline(TeamReplayPlaybookIpcSchemas.timeline.parse(request)) })
  localHandle('replay:diff', async (request, event) => { assertTrusted(event); return backend.getDiff(TeamReplayPlaybookIpcSchemas.diff.parse(request)) })
  localHandle('replay:fork', async (request, event) => { assertTrusted(event); return backend.fork(TeamReplayPlaybookIpcSchemas.fork.parse(request)) })
  localHandle('playbook:list', async (request, event) => { assertTrusted(event); return backend.listPlaybook(TeamReplayPlaybookIpcSchemas.list.parse(request) as ReplayPlaybookListRequest) })
  localHandle('playbook:mutate', async (request, event) => { assertTrusted(event); return backend.mutate(TeamReplayPlaybookIpcSchemas.mutate.parse(request) as DesktopPlaybookMutationRequest) })
}
