import type { ToolCallContext, ToolExecutor } from '../../seams.js';
import type { ResolvedToolCall, ToolDefinition, ToolOutcome } from '../contract.js';
import { FakeShell } from './shell.js';
import { VirtualFileSystem } from './virtual-fs.js';

const pathSchema = { type: 'string', minLength: 1 } as const;

export const fakeToolDefinitions: readonly ToolDefinition[] = [
  {
    name: 'read',
    description: 'Read a text file, optionally by line range.',
    inputSchema: {
      type: 'object',
      properties: {
        path: pathSchema,
        offset: { type: 'integer', minimum: 1 },
        limit: { type: 'integer', minimum: 0 },
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
    name: 'write',
    description: 'Write a complete text file.',
    inputSchema: {
      type: 'object',
      properties: { path: pathSchema, content: { type: 'string' } },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    readonly: false,
    permissionClass: 'workspace-write',
    approval: 'session',
    concurrency: 'serial',
    timeoutMs: 10_000,
    interruptible: true,
    costClass: 'io',
  },
  {
    name: 'edit',
    description: 'Replace one exact text occurrence in a file.',
    inputSchema: {
      type: 'object',
      properties: {
        path: pathSchema,
        old: { type: 'string', minLength: 1 },
        new: { type: 'string' },
      },
      required: ['path', 'old', 'new'],
      additionalProperties: false,
    },
    readonly: false,
    permissionClass: 'workspace-write',
    approval: 'session',
    concurrency: 'serial',
    timeoutMs: 10_000,
    interruptible: true,
    costClass: 'io',
  },
  {
    name: 'bash',
    description: 'Run a shell command in the session workspace.',
    inputSchema: {
      type: 'object',
      properties: { command: { type: 'string', minLength: 1 } },
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

export class FakeToolExecutor implements ToolExecutor {
  constructor(
    readonly fs: VirtualFileSystem = new VirtualFileSystem(),
    readonly shell: FakeShell = new FakeShell(),
  ) {}

  async execute(call: ResolvedToolCall, context: ToolCallContext): Promise<ToolOutcome> {
    context.signal.throwIfAborted();
    const args = call.args as Record<string, unknown>;
    switch (call.name) {
      case 'read':
        return {
          ok: true,
          content: this.fs.read(
            String(args.path),
            args.offset === undefined ? 1 : Number(args.offset),
            args.limit === undefined ? undefined : Number(args.limit),
          ),
        };
      case 'write':
        this.fs.write(String(args.path), String(args.content));
        return { ok: true, content: `Wrote ${String(args.path)}` };
      case 'edit':
        this.fs.edit(String(args.path), String(args.old), String(args.new));
        return { ok: true, content: `Edited ${String(args.path)}` };
      case 'bash': {
        const reply = await this.shell.run(String(args.command), context.signal);
        const output = [reply.stdout, reply.stderr].filter(Boolean).join('\n');
        return { ok: reply.exitCode === 0, content: `${output}\nexit ${reply.exitCode}`.trim() };
      }
      default:
        return { ok: false, content: `Unknown fake tool: ${call.name}` };
    }
  }
}
