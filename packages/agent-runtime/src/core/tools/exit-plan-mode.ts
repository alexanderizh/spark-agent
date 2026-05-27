import type { RegisteredTool, ToolContext, ToolResult } from '../tool-registry.js'

const DESCRIPTION = `Signal that you have finished researching and have a concrete plan ready for user approval.

Use this ONLY in claude-plan permission mode, after you've gathered enough context.
The tool itself does not change state — it returns the plan text back so that the
UI can render a "review plan" prompt to the user and (on approval) switch the
session to claude-auto-edits to continue execution.

You should still wait for the user to react in the UI; do not assume approval.

Argument:
  plan: a structured plan in markdown (numbered list of steps, brief rationale,
        any open questions). Keep it short and actionable.`

/**
 * exit_plan_mode — Only registered when permissionMode === 'claude-plan'.
 * Implemented as a marker tool: it returns the plan text to the agent loop,
 * which emits a special event the UI consumes to show an approval prompt.
 */
export const exitPlanModeTool: RegisteredTool = {
  definition: {
    name: 'exit_plan_mode',
    description: DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        plan: { type: 'string', description: 'Markdown plan to present to the user' },
      },
      required: ['plan'],
    },
  },
  async execute(_ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
    const start = Date.now()
    const plan = String(input['plan'] ?? '').trim()
    if (plan.length === 0) {
      return { status: 'error', error: 'plan must be a non-empty markdown string', durationMs: Date.now() - start }
    }
    // The agent loop will see this special output and emit a plan_proposed event
    // (see agent-loop.ts handling). Until the user approves, no write tools will
    // be allowed because we are still in claude-plan mode.
    return {
      status: 'success',
      output: { __planProposed: true, plan },
      durationMs: Date.now() - start,
    }
  },
}
