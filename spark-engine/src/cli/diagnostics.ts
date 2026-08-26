import { delimiter as pathDelimiter, resolve } from 'node:path'

import { pathExportHint, type InstallReport, type PathSparkCandidate } from './install.js'

/**
 * Human-readable rendering of installation diagnostics for `spark doctor` and
 * `spark install`. Kept beside the CLI so the install module stays pure logic.
 */
export function renderInstallReport(report: InstallReport): string {
  const lines: string[] = ['Install:']
  const resolved = report.resolved
  if (!resolved) {
    lines.push(
      '  spark on PATH: not found — run `spark install`, or install the @spark/agent npm package globally',
    )
  } else if (resolved.broken) {
    lines.push(
      `  spark on PATH: ${resolved.path} -> broken link (${resolved.targetPath} is missing) — run \`spark install\` to relink`,
    )
  } else if (report.resolvedKind === 'spark') {
    const versionNote = report.versionMatchesRunning
      ? `v${resolved.version}, matches this install`
      : `v${resolved.version} — this spark is v${report.running.version}; rerun spark install to relink`
    lines.push(`  spark on PATH: ${resolved.path} (${versionNote})`)
  } else {
    lines.push(`  spark on PATH: ${resolved.path} (not a spark launcher)`)
  }
  if (report.shadowedBy) {
    lines.push(`  WARNING: ${report.shadowedBy} shadows a spark launcher later on PATH.`)
  }
  if (!report.defaultBinDirOnPath) {
    lines.push(
      `  ${report.defaultBinDir} is not on PATH — add it with:\n    ${pathExportHint(report.defaultBinDir, process.env.SHELL)}`,
    )
  }
  if (report.node.status === 'out_of_range') {
    lines.push(`  Node ${report.node.version}: ${report.node.detail}`)
  }
  return `${lines.join('\n')}\n`
}

export function installWarnings(
  binDir: string,
  candidates: readonly PathSparkCandidate[],
  pathEnv: string | undefined = process.env.PATH,
): readonly string[] {
  const warnings: string[] = []
  const pathEntries = (pathEnv ?? '')
    .split(pathDelimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => resolve(entry))
  if (!pathEntries.includes(binDir)) {
    warnings.push(
      `NOTE: ${binDir} is not on your PATH. Add it and restart your terminal:\n  ${pathExportHint(binDir, process.env.SHELL)}`,
    )
  }
  const first = candidates[0]
  if (
    first &&
    !first.isSparkInstall &&
    !first.broken &&
    candidates.some((candidate) => candidate.isSparkInstall && !candidate.broken)
  ) {
    warnings.push(
      `WARNING: ${first.path} appears earlier on PATH and will shadow the spark launcher.`,
    )
  }
  return warnings
}
