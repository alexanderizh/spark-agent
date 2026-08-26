import { createHash } from 'node:crypto';
import { mkdir, open, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';

import type { Clock, SessionMeta, SessionStore } from '../seams.js';
import { decodeLine } from './migrations.js';
import { AgentEventSchema, type AgentEvent, type BoundEventDraft } from './schema.js';

export type FsyncPolicy = 'always' | 'step-boundary';

const storeTails = new WeakMap<SessionStore, Map<string, Promise<void>>>();

function tailsFor(store: SessionStore): Map<string, Promise<void>> {
  let tails = storeTails.get(store);
  if (!tails) {
    tails = new Map();
    storeTails.set(store, tails);
  }
  return tails;
}

function isBoundary(event: AgentEvent): boolean {
  return (
    event.type === 'session.started' ||
    event.type === 'assistant.completed' ||
    event.type === 'tool.result' ||
    event.type === 'turn.completed' ||
    event.type === 'turn.cancelled' ||
    event.type === 'turn.failed'
  );
}

export class SessionLedger {
  readonly #sessionId: string;
  readonly #store: SessionStore;
  readonly #clock: Clock;

  constructor(sessionId: string, store: SessionStore, clock: Clock) {
    this.#sessionId = sessionId;
    this.#store = store;
    this.#clock = clock;
  }

  append(draft: BoundEventDraft): Promise<AgentEvent> {
    const tails = tailsFor(this.#store);
    const previous = tails.get(this.#sessionId) ?? Promise.resolve();
    const operation = previous.then(async () => {
      const latest = await this.#store.latestSeq(this.#sessionId);
      const event = AgentEventSchema.parse({
        ...draft,
        sessionId: this.#sessionId,
        seq: latest + 1,
        ts: this.#clock.now(),
      });
      await this.#store.append(this.#sessionId, event);
      return event;
    });
    tails.set(
      this.#sessionId,
      operation.then(
        () => undefined,
        () => undefined,
      ),
    );
    return operation;
  }

  async *read(fromSeq = 0): AsyncIterable<AgentEvent> {
    await (tailsFor(this.#store).get(this.#sessionId) ?? Promise.resolve());
    for await (const event of this.#store.read(this.#sessionId, fromSeq)) yield event;
  }

  async latestSeq(): Promise<number> {
    await (tailsFor(this.#store).get(this.#sessionId) ?? Promise.resolve());
    return this.#store.latestSeq(this.#sessionId);
  }
}

export class MemorySessionStore implements SessionStore {
  readonly #sessions = new Map<string, AgentEvent[]>();
  #forkCounter = 0;

  async append(sessionId: string, event: AgentEvent): Promise<void> {
    const events = this.#sessions.get(sessionId) ?? [];
    const expectedSeq = events.length === 0 ? 0 : (events.at(-1)?.seq ?? -1) + 1;
    if (event.seq !== expectedSeq) {
      throw new Error(`Non-contiguous event sequence for ${sessionId}: expected ${expectedSeq}, got ${event.seq}`);
    }
    events.push(structuredClone(event));
    this.#sessions.set(sessionId, events);
  }

  async *read(sessionId: string, fromSeq = 0): AsyncIterable<AgentEvent> {
    for (const event of this.#sessions.get(sessionId) ?? []) {
      if (event.seq >= fromSeq) yield structuredClone(event);
    }
  }

  async latestSeq(sessionId: string): Promise<number> {
    return this.#sessions.get(sessionId)?.at(-1)?.seq ?? -1;
  }

  async fork(sessionId: string, uptoSeq: number): Promise<string> {
    const events = this.#sessions.get(sessionId);
    if (!events) throw new Error(`Session not found: ${sessionId}`);
    this.#forkCounter += 1;
    const forkId = `${sessionId}-fork-${this.#forkCounter}`;
    this.#sessions.set(
      forkId,
      events.filter((event) => event.seq <= uptoSeq).map((event) => structuredClone(event)),
    );
    return forkId;
  }

  async list(projectDir: string | null): Promise<SessionMeta[]> {
    return [...this.#sessions].map(([sessionId, events]) => ({
      sessionId,
      projectDir,
      createdAt: events[0]?.ts ?? 0,
      updatedAt: events.at(-1)?.ts ?? 0,
      latestSeq: events.at(-1)?.seq ?? -1,
    }));
  }
}

export interface JsonlSessionStoreOptions {
  readonly dataRoot: string;
  readonly projectDir: string;
  readonly fsync?: FsyncPolicy;
}

export class JsonlSessionStore implements SessionStore {
  readonly #projectRoot: string;
  readonly #projectDir: string;
  readonly #fsync: FsyncPolicy;
  readonly #tails = new Map<string, Promise<void>>();
  readonly #latestSeqs = new Map<string, number>();
  #forkCounter = 0;

  constructor(options: JsonlSessionStoreOptions) {
    this.#projectDir = resolve(options.projectDir);
    this.#projectRoot = resolve(options.dataRoot, 'projects', encodeProjectDir(this.#projectDir));
    this.#fsync = options.fsync ?? 'step-boundary';
  }

  async append(sessionId: string, event: AgentEvent): Promise<void> {
    assertSessionId(sessionId);
    const previous = this.#tails.get(sessionId) ?? Promise.resolve();
    const operation = previous.then(async () => {
      const current = this.#latestSeqs.get(sessionId) ?? (await this.#scanLatestSeq(sessionId));
      const expected = current + 1;
      if (event.seq !== expected) {
        throw new Error(
          `Non-contiguous event sequence for ${sessionId}: expected ${expected}, got ${event.seq}`,
        );
      }
      const directory = this.#sessionDirectory(sessionId);
      await mkdir(directory, { recursive: true });
      const handle = await open(resolve(directory, 'events.jsonl'), 'a');
      try {
        await handle.writeFile(`${JSON.stringify(event)}\n`, 'utf8');
        if (this.#fsync === 'always' || isBoundary(event)) await handle.sync();
      } finally {
        await handle.close();
      }
      this.#latestSeqs.set(sessionId, event.seq);
    });
    this.#tails.set(
      sessionId,
      operation.then(
        () => undefined,
        () => undefined,
      ),
    );
    return operation;
  }

  async *read(sessionId: string, fromSeq = 0): AsyncIterable<AgentEvent> {
    assertSessionId(sessionId);
    await this.#tails.get(sessionId);
    yield* this.#readFileEvents(sessionId, fromSeq);
  }

  async latestSeq(sessionId: string): Promise<number> {
    assertSessionId(sessionId);
    await this.#tails.get(sessionId);
    const cached = this.#latestSeqs.get(sessionId);
    if (cached !== undefined) return cached;
    return this.#scanLatestSeq(sessionId);
  }

  async fork(sessionId: string, uptoSeq: number): Promise<string> {
    const lines = [];
    for await (const event of this.read(sessionId)) {
      if (event.seq <= uptoSeq) lines.push(JSON.stringify(event));
    }
    if (lines.length === 0) throw new Error(`Session not found or empty: ${sessionId}`);
    while (true) {
      this.#forkCounter += 1;
      const forkId = `${sessionId}-fork-${this.#forkCounter}`;
      await mkdir(this.#sessionDirectory(forkId), { recursive: true });
      try {
        await writeFile(this.#eventPath(forkId), `${lines.join('\n')}\n`, { flag: 'wx' });
        this.#latestSeqs.set(forkId, uptoSeq);
        return forkId;
      } catch (error) {
        if (!isNodeError(error, 'EEXIST')) throw error;
      }
    }
  }

  async list(projectDir: string | null): Promise<SessionMeta[]> {
    if (projectDir !== null && resolve(projectDir) !== this.#projectDir) return [];
    let entries;
    try {
      entries = await readdir(this.#projectRoot, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return [];
      throw error;
    }
    const sessions: SessionMeta[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const events: AgentEvent[] = [];
      for await (const event of this.read(entry.name)) events.push(event);
      if (events.length === 0) continue;
      sessions.push({
        sessionId: entry.name,
        projectDir: this.#projectDir,
        createdAt: events[0]?.ts ?? 0,
        updatedAt: events.at(-1)?.ts ?? 0,
        latestSeq: events.at(-1)?.seq ?? -1,
      });
    }
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  #sessionDirectory(sessionId: string): string {
    return resolve(this.#projectRoot, sessionId);
  }

  #eventPath(sessionId: string): string {
    return resolve(this.#sessionDirectory(sessionId), 'events.jsonl');
  }

  async #scanLatestSeq(sessionId: string): Promise<number> {
    let latest = -1;
    for await (const event of this.#readFileEvents(sessionId)) latest = event.seq;
    this.#latestSeqs.set(sessionId, latest);
    return latest;
  }

  async *#readFileEvents(sessionId: string, fromSeq = 0): AsyncIterable<AgentEvent> {
    let handle;
    try {
      handle = await open(this.#eventPath(sessionId), 'r');
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return;
      throw error;
    }
    const input = handle.createReadStream({ autoClose: false, encoding: 'utf8' });
    const lines = createInterface({ input, crlfDelay: Infinity });
    let lineNumber = 0;
    try {
      for await (const line of lines) {
        lineNumber += 1;
        if (!line) continue;
        try {
          const event = decodeLine(line);
          if (event.seq >= fromSeq) yield event;
        } catch (error) {
          throw new Error(`Failed to decode ${this.#eventPath(sessionId)}:${lineNumber}`, {
            cause: error,
          });
        }
      }
    } finally {
      lines.close();
      input.destroy();
      await handle.close();
    }
  }
}

export function encodeProjectDir(projectDir: string): string {
  const absolute = resolve(projectDir);
  const readable = absolute.replaceAll(/[^a-zA-Z0-9._-]+/g, '-').replaceAll(/^-+|-+$/g, '');
  const digest = createHash('sha256').update(absolute).digest('hex').slice(0, 12);
  return `${readable.slice(-96) || 'root'}-${digest}`;
}

function assertSessionId(sessionId: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(sessionId)) {
    throw new Error(`Unsafe session id: ${sessionId}`);
  }
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code;
}
