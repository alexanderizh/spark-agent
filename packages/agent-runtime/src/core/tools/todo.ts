import type { RegisteredTool, ToolContext, ToolResult } from '../tool-registry.js'
import { TodoStore, type TodoItem, type TodoStatus } from '../todo-store.js'

const TODO_WRITE_DESCRIPTION = `Maintain a structured task list for the current coding session.

WHEN TO USE:
- Multi-step tasks (3+ distinct steps) that span several tool calls.
- Long-running work where progress visibility matters.
- After receiving new instructions that contain multiple requirements.

WHEN NOT TO USE:
- Single trivial action (one read or one edit).
- Pure conversational replies.

HOW IT WORKS:
- Always send the FULL list of todos each time you call this tool. The list replaces the previous one (no diff/merge — what you write is what's stored).
- Mark exactly ONE todo as in_progress at a time.
- Mark a todo as completed AS SOON AS it is finished — don't batch.
- The list persists across turns within the same session; you can read and update it across multiple turns.
- New tasks discovered mid-execution should be appended with status 'pending'.

STATUS MEANINGS:
- pending: not started
- in_progress: actively being worked on (exactly one at a time)
- completed: fully done; criteria met, tests pass, no errors`

const VALID_STATUSES: readonly TodoStatus[] = ['pending', 'in_progress', 'completed'] as const

export const todoWriteTool: RegisteredTool = {
  definition: {
    name: 'todo_write',
    description: TODO_WRITE_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description: 'The full updated list of todos. Replaces the previous list.',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string', description: 'Short imperative task description, e.g. "Run tests"' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
              activeForm: { type: 'string', description: 'Present continuous form for in_progress display, e.g. "Running tests"' },
            },
            required: ['content', 'status'],
          },
        },
      },
      required: ['todos'],
    },
  },
  async execute(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
    const start = Date.now()
    const sessionId = ctx.sessionId
    if (sessionId == null) {
      return { status: 'error', error: 'todo_write requires session context (ctx.sessionId missing)', durationMs: Date.now() - start }
    }

    const rawTodos = input['todos']
    if (!Array.isArray(rawTodos)) {
      return { status: 'error', error: '`todos` must be an array', durationMs: Date.now() - start }
    }

    const parsed: TodoItem[] = []
    for (let i = 0; i < rawTodos.length; i += 1) {
      const item = rawTodos[i] as Record<string, unknown> | null
      if (item == null || typeof item !== 'object') {
        return { status: 'error', error: `todos[${i}] is not an object`, durationMs: Date.now() - start }
      }
      const content = item['content']
      const status = item['status']
      const activeForm = item['activeForm']
      if (typeof content !== 'string' || content.trim().length === 0) {
        return { status: 'error', error: `todos[${i}].content must be a non-empty string`, durationMs: Date.now() - start }
      }
      if (typeof status !== 'string' || !VALID_STATUSES.includes(status as TodoStatus)) {
        return { status: 'error', error: `todos[${i}].status must be one of pending|in_progress|completed`, durationMs: Date.now() - start }
      }
      const todo: TodoItem = { content: content.trim(), status: status as TodoStatus }
      if (typeof activeForm === 'string' && activeForm.trim().length > 0) {
        todo.activeForm = activeForm.trim()
      }
      parsed.push(todo)
    }

    const inProgressCount = parsed.filter((t) => t.status === 'in_progress').length
    if (inProgressCount > 1) {
      return { status: 'error', error: `Only one todo may be in_progress at a time (found ${inProgressCount})`, durationMs: Date.now() - start }
    }

    const stored = TodoStore.write(sessionId, parsed)
    const summary = summarizeTodos(stored)
    return {
      status: 'success',
      output: { todos: stored, summary },
      durationMs: Date.now() - start,
    }
  },
}

function summarizeTodos(todos: TodoItem[]): string {
  const total = todos.length
  const done = todos.filter((t) => t.status === 'completed').length
  const inProg = todos.find((t) => t.status === 'in_progress')
  const inProgLabel = inProg?.activeForm ?? inProg?.content
  const parts = [`${done}/${total} completed`]
  if (inProgLabel) parts.push(`current: ${inProgLabel}`)
  return parts.join(' · ')
}
