import { spawn } from 'node:child_process';

import { KernelError } from '../../kernel/errors.js';

export interface ProcessOptions {
  readonly cwd: string;
  readonly signal: AbortSignal;
  readonly env?: NodeJS.ProcessEnv;
  readonly maxOutputBytes?: number;
}

export interface ProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export async function runProcess(
  command: string,
  args: readonly string[],
  options: ProcessOptions,
): Promise<ProcessResult> {
  options.signal.throwIfAborted();
  const maxOutputBytes = options.maxOutputBytes ?? 8 * 1024 * 1024;
  const child = spawn(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let outputBytes = 0;
  let outputExceeded = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const terminate = (): void => {
    terminateTree(child.pid, 'SIGTERM');
    if (killTimer) return;
    killTimer = setTimeout(() => {
      if (child.exitCode === null) terminateTree(child.pid, 'SIGKILL');
    }, 1_500);
    killTimer.unref();
  };
  const capture = (target: Buffer[]) => (chunk: Buffer): void => {
    outputBytes += chunk.byteLength;
    if (outputBytes <= maxOutputBytes) target.push(Buffer.from(chunk));
    else if (!outputExceeded) {
      outputExceeded = true;
      terminate();
    }
  };
  child.stdout.on('data', capture(stdout));
  child.stderr.on('data', capture(stderr));
  const abort = (): void => {
    terminate();
  };
  options.signal.addEventListener('abort', abort, { once: true });

  try {
    const exitCode = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => {
        if (code !== null) resolve(code);
        else if (options.signal.aborted) reject(abortError());
        else if (outputExceeded) resolve(1);
        else reject(new Error(`Process exited from signal ${signal ?? 'unknown'}`));
      });
    });
    if (options.signal.aborted) throw abortError();
    if (outputExceeded) {
      throw new KernelError(
        'tool.process_output_limit',
        `Process output exceeded ${maxOutputBytes} bytes and was terminated`,
      );
    }
    return {
      exitCode,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    };
  } finally {
    if (killTimer) clearTimeout(killTimer);
    options.signal.removeEventListener('abort', abort);
  }
}

export function safeShellEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined || isSecretName(name)) continue;
    result[name] = value;
  }
  return result;
}

function isSecretName(name: string): boolean {
  return /(?:^|_)(?:API_?KEY|KEY|TOKEN|SECRET|PASSWORD|PASS|PWD|CREDENTIALS?)(?:_|$)/iu.test(
    name,
  );
}

function terminateTree(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!pid) return;
  try {
    if (process.platform === 'win32') process.kill(pid, signal);
    else process.kill(-pid, signal);
  } catch (error) {
    if (!isMissingProcess(error)) throw error;
  }
}

function isMissingProcess(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 'ESRCH'
  );
}

function abortError(): DOMException {
  return new DOMException('Process aborted', 'AbortError');
}
