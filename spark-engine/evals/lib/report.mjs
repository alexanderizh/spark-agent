export function renderMarkdown(report) {
  const lines = [
    '# Spark CLI programming eval',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Spark: ${report.sparkVersion} (\`${report.sparkBin}\`)`,
    `- Protocol: \`${report.protocol}\``,
    `- Upstream model: \`${report.upstreamModel}\``,
    `- Resolved endpoint: \`${report.resolvedEndpoint}\``,
    `- Effort: \`${report.effort}\``,
    ...(report.thinking ? [`- Thinking: \`${report.thinking}\``] : []),
    `- API key: present in the environment, not recorded`,
    `- Passed: ${report.summary.passed} / ${report.summary.total}`,
    '',
  ]
  if (report.warnings.length > 0) {
    lines.push('## Warnings', '')
    for (const warning of report.warnings) lines.push(`- ${warning}`)
    lines.push('')
  }
  lines.push(
    '| Task | Capability | Result | CLI ms | Exit | Turn | Tools |',
    '| --- | --- | --- | ---: | ---: | --- | --- |',
  )
  for (const task of report.tasks) {
    const tools =
      Object.entries(task.toolCounts)
        .map(([name, count]) => `${name}×${count}`)
        .join(', ') || '—'
    lines.push(
      `| ${task.id} | ${task.capability} | ${task.passed ? 'pass' : 'fail'} | ${task.latencyMs} | ${task.exitCode} | ${task.turnStatus} | ${tools} |`,
    )
  }
  lines.push('')
  for (const task of report.tasks) {
    lines.push(`## ${task.id}`, '', task.title, '')
    if (task.error) lines.push(`Error: ${task.error}`, '')
    lines.push('| Check | Result | Detail |', '| --- | --- | --- |')
    for (const check of task.checks) {
      lines.push(`| ${check.name} | ${check.passed ? 'pass' : 'fail'} | ${oneLine(check.detail)} |`)
    }
    lines.push('', 'Tool notes:', '')
    if (task.toolNotes.length === 0) lines.push('- none', '')
    else {
      for (const note of task.toolNotes) {
        lines.push(
          `- \`${note.tool}\` ok=${note.ok} ${note.durationMs}ms args=${oneLine(note.argsPreview)} result=${oneLine(note.resultPreview)}`,
        )
      }
      lines.push('')
    }
    if (task.stderrTail) {
      lines.push('stderr (tail):', '', '```', task.stderrTail, '```', '')
    }
  }
  lines.push(
    'This report is a spark-engine CLI run only. It is not a comparison against Cursor CLI, Codex CLI, or Claude Code.',
    '',
  )
  return lines.join('\n')
}

function oneLine(value) {
  return String(value ?? '')
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ')
    .slice(0, 240)
}
