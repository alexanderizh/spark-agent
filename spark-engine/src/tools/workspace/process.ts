import { StringDecoder } from 'node:string_decoder';
import { spawn } from 'node:child_process';

import { KernelError } from '../../kernel/errors.js';
import { ToolExecutionError } from '../execution-error.js';

export interface ProcessOptions {
  readonly cwd: string;
  readonly signal: AbortSignal;
  readonly env?: NodeJS.ProcessEnv;
  readonly maxOutputBytes?: number;
  readonly onOutput?: (text: string) => void;
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
      // The group leader may have exited while descendants still hold pipes.
      terminateTree(child.pid, 'SIGKILL');
    }, 1_500);
    killTimer.unref();
  };
  const emitOutput = (value: string): void => {
    if (!value) return;
    try {
      options.onOutput?.(value);
    } catch {
      /* Observers cannot interrupt process cleanup. */
    }
  };
  const stdoutDecoder = new StringDecoder('utf8');
  const stderrDecoder = new StringDecoder('utf8');
  const capture =
    (target: Buffer[], decoder: StringDecoder) =>
    (chunk: Buffer): void => {
      const remaining = Math.max(0, maxOutputBytes - outputBytes);
      if (remaining > 0) {
        const captured = Buffer.from(chunk.subarray(0, remaining));
        target.push(captured);
        const decoded = decoder.write(captured);
        emitOutput(decoded);
      }
      outputBytes += chunk.byteLength;
      if (outputBytes > maxOutputBytes && !outputExceeded) {
        outputExceeded = true;
        terminate();
      }
    };
  child.stdout.on('data', capture(stdout, stdoutDecoder));
  child.stderr.on('data', capture(stderr, stderrDecoder));
  const abort = (): void => {
    terminate();
  };
  options.signal.addEventListener('abort', abort, { once: true });

  try {
    const exitCode = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => {
        const tail = stdoutDecoder.end() + stderrDecoder.end();
        emitOutput(tail);
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
  } catch (error) {
    const output = [Buffer.concat(stdout).toString('utf8'), Buffer.concat(stderr).toString('utf8')]
      .filter(Boolean)
      .join('\n');
    if (!output) throw error;
    const failure = new ToolExecutionError(
      error instanceof Error ? error.message : String(error),
      output,
      { cause: error },
    );
    // Keep cancellation recognizable to callers outside ToolRunner too.
    if (options.signal.aborted) failure.name = 'AbortError';
    throw failure;
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

/**
 * Adds explicitly configured session variables to a child-process environment.
 *
 * Ambient secrets remain filtered, while values deliberately supplied through
 * customEnv are allowed through to the requested tool subprocess. The overlay
 * never mutates process.env.
 */
export function withCustomEnvironment(
  customEnv: Readonly<Record<string, string>> | undefined,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const result = safeShellEnvironment(source);
  for (const [name, value] of Object.entries(customEnv ?? {})) {
    validateEnvironmentEntry(name, value);
    result[name] = value;
  }
  return result;
}

function validateEnvironmentEntry(name: string, value: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) {
    throw new Error(`Invalid custom environment variable name: ${name}`);
  }
  if (value.includes('\0')) {
    throw new Error(`Custom environment variable contains NUL: ${name}`);
  }
}

function isSecretName(name: string): boolean {
  return /(?:^|_)(?:API_?KEY|KEY|TOKEN|SECRET|PASSWORD|PASS|PWD|CREDENTIALS?)(?:_|$)/iu.test(name);
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
