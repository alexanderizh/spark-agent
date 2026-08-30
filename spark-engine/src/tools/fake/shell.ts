import { abortError, throwIfAborted } from '../../kernel/cancellation.js';

export interface FakeShellReply {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode: number;
  readonly delaySteps?: number;
}

export class FakeShell {
  readonly #replies: ReadonlyMap<string, FakeShellReply>;
  readonly calls: string[] = [];
  readonly signals: ('term' | 'kill')[] = [];

  constructor(replies: Readonly<Record<string, FakeShellReply>> = {}) {
    this.#replies = new Map(Object.entries(replies));
  }

  async run(command: string, signal: AbortSignal): Promise<FakeShellReply> {
    this.calls.push(command);
    const reply = this.#replies.get(command) ?? {
      stdout: '',
      stderr: `fake shell: command not scripted: ${command}`,
      exitCode: 127,
    };
    try {
      for (let index = 0; index < (reply.delaySteps ?? 0); index += 1) {
        throwIfAborted(signal);
        await Promise.resolve();
      }
      throwIfAborted(signal);
      return reply;
    } catch (error) {
      if (signal.aborted) {
        this.signals.push('term', 'kill');
        throw abortError(signal.reason);
      }
      throw error;
    }
  }
}
