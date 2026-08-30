import { AgentEventSchema, CURRENT_SCHEMA_VERSION, type AgentEvent } from './schema.js';

export interface UnknownVersionedEvent {
  readonly schemaVersion: number;
  readonly [key: string]: unknown;
}

export interface EventMigration {
  readonly from: number;
  readonly to: number;
  upgrade(event: UnknownVersionedEvent): UnknownVersionedEvent;
}

const migrations = new Map<number, EventMigration>();

export function registerMigration(migration: EventMigration): () => void {
  if (migration.to !== migration.from + 1) {
    throw new Error(`Migration must advance exactly one version: ${migration.from} -> ${migration.to}`);
  }
  if (migrations.has(migration.from)) {
    throw new Error(`Migration from schema v${migration.from} is already registered`);
  }
  migrations.set(migration.from, migration);
  return () => migrations.delete(migration.from);
}

function asVersionedEvent(value: unknown): UnknownVersionedEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Event line must decode to a JSON object');
  }
  const schemaVersion: unknown = (value as Record<string, unknown>).schemaVersion;
  if (!Number.isInteger(schemaVersion) || Number(schemaVersion) < 1) {
    throw new Error('Event is missing a valid positive schemaVersion');
  }
  return value as UnknownVersionedEvent;
}

export function decodeEvent(value: unknown): AgentEvent {
  let event = asVersionedEvent(value);
  if (event.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Event schema v${event.schemaVersion} requires a newer engine (current v${CURRENT_SCHEMA_VERSION})`,
    );
  }
  while (event.schemaVersion < CURRENT_SCHEMA_VERSION) {
    const migration = migrations.get(event.schemaVersion);
    if (!migration) {
      throw new Error(
        `No event migration registered from schema v${event.schemaVersion} to v${event.schemaVersion + 1}`,
      );
    }
    event = asVersionedEvent(migration.upgrade(event));
    if (event.schemaVersion !== migration.to) {
      throw new Error(`Migration from v${migration.from} did not produce schema v${migration.to}`);
    }
  }
  return AgentEventSchema.parse(event);
}

export function decodeLine(line: string): AgentEvent {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON event line: ${message}`, { cause: error });
  }
  return decodeEvent(value);
}
