/**
 * 危险命令正则表（spark-engine 侧自持镜像）。
 *
 * 镜像源：`packages/agent-runtime/src/services/permission.service.ts` 的
 * `isDangerousCommand`（desktop 审批规则引擎的 9 条高危命令识别）。
 * spark-engine 受 `scripts/boundary-check.mjs` 约束不能依赖 workspace 包，
 * 因此两侧各持一份；agent-runtime 的漂移守卫单测
 * （`src/__tests__/services/spark-danger-rules-drift.test.ts`）断言两条数组
 * 逐一相等。**修改任一侧必须同步另一侧**，否则漂移守卫测试会失败。
 *
 * 语义与宿主一致：对 `trim().toLowerCase()` 后的命令串逐条测试。
 */

export const DANGEROUS_COMMAND_PATTERNS: readonly RegExp[] = [
  /\brm\s+(-[^\s]*r[^\s]*f|-[^\s]*f[^\s]*r)\b/,
  /\bgit\s+clean\b.*\s-[^\s]*[fx]/,
  /\bgit\s+reset\s+--hard\b/,
  /\bsudo\b/,
  /\bchmod\s+-r\b/,
  /\bchown\s+-r\b/,
  /\bdd\s+if=/,
  /\bmkfs(?:\.\w+)?\b/,
  /:\s*\(\)\s*\{\s*:\|:&\s*\};\s*:/,
]

/**
 * Returns the source of the first matching pattern, or `undefined` when the
 * command matches none of them.
 */
export function matchDangerousCommand(command: string): string | undefined {
  const normalized = command.trim().toLowerCase()
  if (normalized.length === 0) return undefined
  for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
    if (pattern.test(normalized)) return pattern.source
  }
  return undefined
}

/**
 * Extracts the command string a tool call carries, mirroring the host rule
 * engine: only top-level string `command` / `cmd` arguments count. Tools
 * without a command argument (read/write/web/…) are never assessed.
 */
export function extractCommandText(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return undefined
  const record = args as Record<string, unknown>
  if (typeof record.command === 'string') return record.command
  if (typeof record.cmd === 'string') return record.cmd
  return undefined
}
