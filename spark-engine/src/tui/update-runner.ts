/**
 * In-TUI self-update contract. The release-channel plumbing (npm, network,
 * checksums) stays in the CLI layer; the TUI only sees this narrow runner,
 * injected from src/cli/main.ts the same way the LLM service is.
 */
export interface SparkUpdateRunResult {
  /** Raw `spark update` exit code (see UPDATE_EXIT_CODES). */
  readonly exitCode: number
  /** Human-readable report produced by the update transaction. */
  readonly output: string
}

export interface SparkUpdateRunner {
  run(options: { readonly checkOnly: boolean }): Promise<SparkUpdateRunResult>
}

export type UpdateOutcomeTone = 'ok' | 'info' | 'error'

export interface UpdateOutcomeNotice {
  readonly tone: UpdateOutcomeTone
  readonly lines: readonly string[]
}

const RESTART_HINT = '新版本已安装；/exit 退出后重新运行 spark 即可生效。'

/**
 * Maps documented `spark update` exit codes onto a user-facing notice:
 *   0 acted · 1 nothing to do (up to date / older remote / prerelease gated)
 *   4 another update holds the lock · anything else failed.
 */
export function describeUpdateOutcome(
  exitCode: number,
  checkOnly: boolean,
  output: string,
): UpdateOutcomeNotice {
  const detail = output.trim().split('\n').filter((line) => line.trim().length > 0)
  if (exitCode === 0) {
    return checkOnly
      ? { tone: 'info', lines: detail.length > 0 ? detail : ['发现可用更新。'] }
      : { tone: 'ok', lines: [...detail, RESTART_HINT] }
  }
  if (exitCode === 1) {
    return {
      tone: 'info',
      lines: detail.length > 0 ? detail : ['已是最新版本。'],
    }
  }
  if (exitCode === 4) {
    return {
      tone: 'error',
      lines: ['另一次更新正在进行中；请等它结束后重试。', ...detail],
    }
  }
  return { tone: 'error', lines: detail.length > 0 ? detail : ['更新失败。'] }
}
