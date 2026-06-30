/**
 * Goal 验收契约（Acceptance Contract）起草与解析。
 *
 * 验收门槛（Gate）：goal 启动时若缺少明确验收标准，先让编排者起草一份
 * 「目标成果 + 可验收标准 + 验证命令」契约（spark-goal-contract 块），
 * 经用户确认后才进入执行循环。镜像 spark-goal-status 的块格式约定。
 */

export interface ProposedGoalContract {
  successCriteria: string[]
  constraints: string[]
  validation: { commands?: string[]; checklist?: string[] }
}

/** 起草契约的一次性 prompt：只产出契约，不开始干活。 */
export function buildGoalContractDraftPrompt(objective: string): string {
  return [
    'You are about to start a managed persistent Goal, but its acceptance criteria are not yet defined.',
    'Do NOT start implementing anything yet. Your only job in this turn is to draft a clear acceptance contract for the objective below, so the user can confirm it before work begins.',
    '',
    `Objective:\n${objective}`,
    '',
    'Draft:',
    '- success_criteria: concrete, verifiable conditions that define "done".',
    '- constraints: non-goals / things that must not change.',
    '- validation: the narrowest safe command(s) that can verify success (or note none if not applicable).',
    '',
    'Finish your answer with this exact machine-readable block (comma-separated values):',
    '```spark-goal-contract',
    'success_criteria: <comma separated verifiable criteria>',
    'constraints: <comma separated constraints or empty>',
    'validation: <comma separated commands or empty>',
    '```',
  ].join('\n')
}

function parseCommaList(value: string | undefined): string[] {
  if (value == null) return []
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

/**
 * 解析 spark-goal-contract 块。无块、或无 success_criteria（契约不完整）时返回 null。
 */
export function parseGoalContractBlock(content: string): ProposedGoalContract | null {
  const match = /```spark-goal-contract\s*([\s\S]*?)```/i.exec(content)
  if (match == null) return null
  const fields = new Map<string, string>()
  for (const line of match[1]!.split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    fields.set(line.slice(0, idx).trim().toLowerCase(), line.slice(idx + 1).trim())
  }
  const successCriteria = parseCommaList(fields.get('success_criteria') ?? fields.get('successcriteria'))
  if (successCriteria.length === 0) return null
  const constraints = parseCommaList(fields.get('constraints'))
  const commands = parseCommaList(fields.get('validation') ?? fields.get('validation_commands'))
  return {
    successCriteria,
    constraints,
    validation: commands.length > 0 ? { commands } : {},
  }
}
