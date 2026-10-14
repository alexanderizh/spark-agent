export function scoreStaticChecks(task, observation) {
  const checks = []
  for (const rel of task.frozen ?? []) {
    const before = observation.frozenBefore[rel]
    const after = observation.frozenAfter[rel]
    const unchanged = before !== undefined && before === after
    checks.push({
      name: `frozen:${rel}`,
      passed: unchanged,
      detail: unchanged ? 'unchanged' : 'content changed or missing',
    })
  }
  for (const requirement of task.requireTools ?? []) {
    const hit = observation.toolCalls.some(
      (call) =>
        call.tool === requirement.name &&
        (requirement.argsMatch === undefined || call.argsText.includes(requirement.argsMatch)),
    )
    const match = requirement.argsMatch ? ` matching ${JSON.stringify(requirement.argsMatch)}` : ''
    checks.push({
      name: `tool:${requirement.name}`,
      passed: hit,
      detail: hit ? `saw ${requirement.name}${match}` : `missing ${requirement.name}${match}`,
    })
  }
  return checks
}

export function taskPassed(parts) {
  return (
    parts.timedOut !== true &&
    parts.cliCode === 0 &&
    parts.turnStatus === 'completed' &&
    parts.checks.every((check) => check.passed === true)
  )
}
