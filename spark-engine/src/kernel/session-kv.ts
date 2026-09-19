import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { stableStringify } from './stable-json.js'

/**
 * Session-scoped key/value attachments (mirrors the Codex app-server
 * `thread/attachment/*` semantics): each entry is located by
 * (attachmentType, identityKey) within one session, carries an arbitrary JSON
 * payload, and survives session resume because it is persisted beside the
 * session ledger instead of inside the in-memory turn state.
 *
 * `set` is idempotent — writing an existing (type, key) pair replaces the
 * payload and reports `existing`. Errors are surfaced to the caller; nothing
 * here is allowed to throw asynchronously in the background.
 */
export interface SessionAttachment {
  readonly id: string
  readonly attachmentType: string
  readonly identityKey: string
  readonly payload: unknown
  readonly createdAt: number
}

export interface SessionKvSetResult {
  readonly outcome: 'created' | 'existing'
  readonly attachment: SessionAttachment
}

export interface SessionKvStoreOptions {
  /** Directory that holds per-session state (one subdirectory per session id). */
  readonly stateRoot: string
  /** Injectable clock for deterministic tests. */
  readonly now?: () => number
}

const MAX_ATTACHMENT_TYPE_LENGTH = 96
const MAX_IDENTITY_KEY_LENGTH = 240
const MAX_PAYLOAD_BYTES = 512 * 1024
const MAX_ATTACHMENTS_PER_SESSION = 1_000

export class SessionKvStore {
  readonly #stateRoot: string
  readonly #now: () => number

  constructor(options: SessionKvStoreOptions) {
    this.#stateRoot = options.stateRoot
    this.#now = options.now ?? (() => Date.now())
  }

  /** Creates or replaces one attachment; idempotent per (type, key). */
  async set(
    sessionId: string,
    attachmentType: string,
    identityKey: string,
    payload: unknown,
  ): Promise<SessionKvSetResult> {
    assertComponent(sessionId, 'session id', 240)
    assertComponent(attachmentType, 'attachment type', MAX_ATTACHMENT_TYPE_LENGTH)
    assertComponent(identityKey, 'identity key', MAX_IDENTITY_KEY_LENGTH)
    const encoded = stableStringify(payload ?? null)
    if (encoded.length > MAX_PAYLOAD_BYTES) {
      throw new Error('Session attachment payload is too large')
    }
    const directory = this.#sessionDirectory(sessionId)
    await mkdir(directory, { recursive: true })
    const file = this.#attachmentFile(sessionId, attachmentType, identityKey)
    let existing: SessionAttachment | undefined
    try {
      existing = decodeAttachment(await readFile(file, 'utf8'))
    } catch {
      // Absent file is the normal created path; unreadable file is replaced.
    }
    if (existing !== undefined) {
      await this.#enforceQuota(directory, sessionId)
      const replaced: SessionAttachment = { ...existing, payload: encodedPayload(encoded) }
      await writeFile(file, stableStringify(replaced) + '\n', 'utf8')
      return { outcome: 'existing', attachment: replaced }
    }
    await this.#enforceQuota(directory, sessionId)
    const attachment: SessionAttachment = {
      id: randomUUID(),
      attachmentType,
      identityKey,
      payload: encodedPayload(encoded),
      createdAt: this.#now(),
    }
    await writeFile(file, stableStringify(attachment) + '\n', 'utf8')
    return { outcome: 'created', attachment }
  }

  /** Lists attachments of one session, optionally filtered by type. */
  async list(
    sessionId: string,
    options: { readonly attachmentType?: string } = {},
  ): Promise<readonly SessionAttachment[]> {
    const directory = this.#sessionDirectory(sessionId)
    let names: readonly string[]
    try {
      names = await readdir(directory)
    } catch {
      return []
    }
    const attachments: SessionAttachment[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      let attachment: SessionAttachment | undefined
      try {
        attachment = decodeAttachment(await readFile(join(directory, name), 'utf8'))
      } catch {
        continue
      }
      if (attachment === undefined) continue
      if (
        options.attachmentType !== undefined &&
        attachment.attachmentType !== options.attachmentType
      ) {
        continue
      }
      attachments.push(attachment)
    }
    attachments.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    return attachments
  }

  /** Deletes one attachment by (type, key); missing entries are a no-op. */
  async remove(sessionId: string, attachmentType: string, identityKey: string): Promise<void> {
    assertComponent(sessionId, 'session id', 240)
    assertComponent(attachmentType, 'attachment type', MAX_ATTACHMENT_TYPE_LENGTH)
    assertComponent(identityKey, 'identity key', MAX_IDENTITY_KEY_LENGTH)
    await rm(this.#attachmentFile(sessionId, attachmentType, identityKey), { force: true })
  }

  #sessionDirectory(sessionId: string): string {
    return join(this.#stateRoot, sanitize(sessionId))
  }

  #attachmentFile(sessionId: string, attachmentType: string, identityKey: string): string {
    return join(
      this.#sessionDirectory(sessionId),
      `${sanitize(attachmentType)}__${sanitize(identityKey)}.json`,
    )
  }

  async #enforceQuota(directory: string, sessionId: string): Promise<void> {
    let names: readonly string[]
    try {
      names = await readdir(directory)
    } catch {
      return
    }
    if (names.length < MAX_ATTACHMENTS_PER_SESSION) return
    throw new Error(`Session ${sessionId} exceeded the attachment quota`)
  }
}

function decodeAttachment(raw: string): SessionAttachment | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const record = parsed as Record<string, unknown>
  if (
    typeof record.id !== 'string' ||
    typeof record.attachmentType !== 'string' ||
    typeof record.identityKey !== 'string' ||
    typeof record.createdAt !== 'number'
  ) {
    return undefined
  }
  return {
    id: record.id,
    attachmentType: record.attachmentType,
    identityKey: record.identityKey,
    payload: record.payload ?? null,
    createdAt: record.createdAt,
  }
}

/**
 * The payload is stored as its stable JSON encoding so writes are
 * deterministic; it is parsed back on read so consumers see real JSON.
 */
function encodedPayload(encoded: string): unknown {
  try {
    return JSON.parse(encoded)
  } catch {
    return encoded
  }
}

function sanitize(value: string): string {
  const cleaned = value.replaceAll(/[^A-Za-z0-9._-]+/gu, '_')
  // Leading dots (".", "..", ".hidden") would escape the session directory or
  // create hidden files; prefix them so every path segment stays inside root.
  return cleaned.startsWith('.') ? `_${cleaned}` : cleaned
}

function assertComponent(value: string, label: string, maximum: number): void {
  if (value.length === 0 || value.length > maximum) {
    throw new Error(`Session attachment ${label} is missing or too long`)
  }
}
