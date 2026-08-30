import type { ToolDefinition } from '../contract.js';

const path = { type: 'string', minLength: 1 } as const;

export const workspaceToolDefinitions: readonly ToolDefinition[] = [
  {
    name: 'read',
    description:
      'Read a UTF-8 workspace file with line numbers and a SHA-256 revision for conflict-safe edits.',
    inputSchema: {
      type: 'object',
      properties: {
        path,
        offset: { type: 'integer', minimum: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 20_000 },
      },
      required: ['path'],
      additionalProperties: false,
    },
    readonly: true,
    permissionClass: 'read',
    approval: 'never',
    concurrency: 'parallel',
    timeoutMs: 10_000,
    interruptible: true,
    costClass: 'io',
  },
  {
    name: 'glob',
    description: 'List workspace files matching one or more gitignore-aware glob patterns.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          oneOf: [
            { type: 'string', minLength: 1 },
            { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1, maxItems: 32 },
          ],
        },
        max_results: { type: 'integer', minimum: 1, maximum: 10_000 },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
    readonly: true,
    permissionClass: 'read',
    approval: 'never',
    concurrency: 'parallel',
    timeoutMs: 30_000,
    interruptible: true,
    costClass: 'io',
  },
  {
    name: 'grep',
    description: 'Search UTF-8 workspace files with ripgrep-compatible regular expressions.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', minLength: 1 },
        path,
        glob: { type: 'string', minLength: 1 },
        case_sensitive: { type: 'boolean' },
        max_results: { type: 'integer', minimum: 1, maximum: 5_000 },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
    readonly: true,
    permissionClass: 'read',
    approval: 'never',
    concurrency: 'parallel',
    timeoutMs: 30_000,
    interruptible: true,
    costClass: 'cpu',
  },
  {
    name: 'write',
    description:
      'Atomically create or replace a UTF-8 file. Overwriting requires the SHA-256 revision returned by read.',
    inputSchema: {
      type: 'object',
      properties: {
        path,
        content: { type: 'string' },
        expected_sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    readonly: false,
    permissionClass: 'workspace-write',
    approval: 'session',
    concurrency: 'serial',
    timeoutMs: 30_000,
    interruptible: true,
    costClass: 'io',
  },
  {
    name: 'edit',
    description:
      'Atomically replace one exact occurrence in a UTF-8 file using a required SHA-256 revision.',
    inputSchema: {
      type: 'object',
      properties: {
        path,
        old: { type: 'string', minLength: 1 },
        new: { type: 'string' },
        expected_sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      },
      required: ['path', 'old', 'new', 'expected_sha256'],
      additionalProperties: false,
    },
    readonly: false,
    permissionClass: 'workspace-write',
    approval: 'session',
    concurrency: 'serial',
    timeoutMs: 30_000,
    interruptible: true,
    costClass: 'io',
  },
  {
    name: 'bash',
    description:
      'Run a non-interactive shell command in the workspace with bounded output and process-group cancellation.',
    inputSchema: {
      type: 'object',
      properties: { command: { type: 'string', minLength: 1, maxLength: 100_000 } },
      required: ['command'],
      additionalProperties: false,
    },
    readonly: false,
    destructive: true,
    permissionClass: 'command',
    approval: 'always',
    concurrency: 'exclusive',
    timeoutMs: 120_000,
    interruptible: true,
    costClass: 'cpu',
  },
];
