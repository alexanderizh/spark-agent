import { Box, Text, useInput } from 'ink'
import { type ReactElement } from 'react'

import { previewText } from './preview-text.js'
import type { TuiTheme } from '../theme.js'

export interface PlanApprovalCardProps {
  readonly proposal: string
  readonly theme: TuiTheme
  /** Approve: leaves plan mode and executes the plan with full tooling. */
  onApprove(): void
  /** Dismiss: stays in plan mode for another iteration. */
  onDismiss(): void
}

/**
 * End-of-plan approval flow (plan mode): after a read-only turn produced a
 * plan, the user either approves it — switching to acceptEdits and executing —
 * or keeps iterating in plan mode.
 */
export function PlanApprovalCard(props: PlanApprovalCardProps): ReactElement {
  useInput((_input, key) => {
    if (key.escape) props.onDismiss()
    else if (key.return) props.onApprove()
  })
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={props.theme.ok} paddingX={1}>
      <Text color={props.theme.ok}>计划模式 turn 已完成 · 计划摘要</Text>
      <Text>{previewText(props.proposal, 12)}</Text>
      <Text>
        <Text color={props.theme.ok}>enter 批准并执行</Text>
        <Text color={props.theme.dim}> · esc 继续留在计划模式迭代</Text>
      </Text>
    </Box>
  )
}
