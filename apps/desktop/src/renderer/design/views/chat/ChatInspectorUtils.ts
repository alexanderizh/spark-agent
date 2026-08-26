import type { UIMessage } from '../../services/event-mapper'

export type PlanItemStatus = 'done' | 'running' | 'pending'

type SidebarPlanBase = {
  id: string
  title: string
}

export type SidebarPlanProposal = SidebarPlanBase & {
  kind: 'proposal'
  /** ExitPlanMode 提交的不可变审批方案原文。 */
  rawPlan: string
}

export type SidebarPlanProgress = SidebarPlanBase & {
  kind: 'progress'
  explanation?: string | undefined
  items: Array<{ text: string; status: PlanItemStatus }>
}

export type SidebarPlan = SidebarPlanProposal | SidebarPlanProgress

export type ParsedTodo = {
  id?: string
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
}

export interface InspectorSubagent {
  toolCallId: string
  name: string
  role: string
  task: string
  status: 'running' | 'done' | 'error' | 'stopped' | 'paused'
  output?: string | undefined
}

export type InspectorTaskStatus = 'pending' | 'in_progress' | 'completed' | 'interrupted'

export interface InspectorTask {
  id: string
  subject: string
  description?: string | undefined
  activeForm?: string | undefined
  status: InspectorTaskStatus
  createdAt: number
}

type ToolCallBlock = Extract<UIMessage['blocks'][number], { kind: 'tool_call' }>

export function parseTodosFromInputOrOutput(
  input: Record<string, unknown>,
  output: string | undefined,
): ParsedTodo[] {
  const outputSnapshot = parseTodosFromOutput(output)
  if (outputSnapshot != null) return outputSnapshot
  const todos = input['todos']
  return Array.isArray(todos) ? normalizeTodos(todos) : []
}

/**
 * Parse an authoritative todo snapshot from a completed tool result.
 *
 * Providers currently expose several shapes:
 * - Claude TodoWrite: { oldTodos, newTodos }
 * - legacy/normalized TodoRead or TodoWrite: { todos }
 * - some adapters: a bare todo array
 *
 * `null` means the output did not contain a recognizable snapshot. An empty
 * array is deliberately distinct: it is a valid snapshot that clears stale UI.
 */
function parseTodosFromOutput(output: string | undefined): ParsedTodo[] | null {
  if (output == null) return null

  try {
    const cleaned = output
      .replace(/^```json\n?/, '')
      .replace(/\n?```$/, '')
      .trim()
    const parsed = JSON.parse(cleaned) as unknown
    if (Array.isArray(parsed)) return normalizeRecognizedTodoArray(parsed)
    if (!isRecord(parsed)) return null

    // newTodos is the post-write state and must win over oldTodos.
    for (const key of ['newTodos', 'todos'] as const) {
      const values = parsed[key]
      if (Array.isArray(values)) return normalizeRecognizedTodoArray(values)
    }
  } catch {
    // The caller may still fall back to a todo_write input snapshot.
  }

  return null
}

function parseTodosFromReadOutput(output: string | undefined): ParsedTodo[] | null {
  const snapshot = parseTodosFromOutput(output)
  if (snapshot != null) return snapshot
  if (output == null) return null

  const normalized = output.trim().toLowerCase()
  if (
    normalized.length === 0 ||
    normalized === 'no todos' ||
    normalized === 'no todos found' ||
    normalized === 'todo list is empty' ||
    normalized === '暂无待办' ||
    normalized === '待办列表为空'
  ) {
    return []
  }

  return null
}

function normalizeRecognizedTodoArray(values: unknown[]): ParsedTodo[] | null {
  const normalized = normalizeTodos(values)
  return normalized.length > 0 || values.length === 0 ? normalized : null
}

function normalizeTodos(values: unknown[]): ParsedTodo[] {
  return values.flatMap((value) => {
    const todo = normalizeTodo(value)
    return todo == null ? [] : [todo]
  })
}

function normalizeTodo(value: unknown): ParsedTodo | null {
  if (value == null || typeof value !== 'object') return null
  const todo = value as Record<string, unknown>
  const id = typeof todo['id'] === 'string' ? todo['id'] : undefined
  const activeForm = typeof todo['activeForm'] === 'string' ? todo['activeForm'] : undefined
  const status = todo['status']

  if (
    typeof todo['content'] === 'string' &&
    (status === 'pending' || status === 'in_progress' || status === 'completed')
  ) {
    return {
      ...(id != null ? { id } : {}),
      content: todo['content'],
      status,
      ...(activeForm != null ? { activeForm } : {}),
    }
  }

  // Codex SDK/CLI 的 todo_list 使用 { text, completed }，而 Claude 的
  // todo_write 使用 { content, status }。在展示边界统一为 ParsedTodo。
  if (typeof todo['text'] === 'string' && typeof todo['completed'] === 'boolean') {
    return {
      ...(id != null ? { id } : {}),
      content: todo['text'],
      status: todo['completed'] ? 'completed' : 'pending',
    }
  }

  return null
}

export function extractInspectorSubagents(messages: UIMessage[]): InspectorSubagent[] {
  const seen = new Map<string, InspectorSubagent>()
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.kind !== 'subagent') continue
      seen.set(block.toolCallId, {
        toolCallId: block.toolCallId,
        name: block.name,
        role: block.role,
        task: block.task,
        status: block.status,
        output: block.output,
      })
    }
  }
  return Array.from(seen.values())
}

export function extractPlans(messages: UIMessage[]): SidebarPlan[] {
  const plans: SidebarPlan[] = []

  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.kind === 'plan_proposed') {
        if (block.plan.trim().length === 0) continue
        plans.push({
          id: `${message.id}:plan_proposed`,
          kind: 'proposal',
          title: 'Agent 方案',
          rawPlan: block.plan,
        })
        continue
      }

      if (block.kind !== 'tool_call') continue

      const todos =
        block.toolName === 'todo_write'
          ? parseTodosFromInputOrOutput(block.toolInput, block.output)
          : []
      const rawPlan = Array.isArray(block.toolInput.plan) ? block.toolInput.plan : undefined
      if (todos.length === 0 && rawPlan == null && !isPlanToolName(block.toolName)) continue

      const items =
        todos.length > 0
          ? todos.map((todo) => ({
              text:
                todo.status === 'in_progress' ? (todo.activeForm ?? todo.content) : todo.content,
              status: normalizePlanStatus(todo.status),
            }))
          : (rawPlan ?? []).flatMap((item, index) => {
              if (!isRecord(item)) return []
              const text = String(item.step ?? item.text ?? item.title ?? `Step ${index + 1}`)
              return [{ text, status: normalizePlanStatus(item.status) }]
            })
      if (items.length === 0) continue
      plans.push({
        id: block.toolCallId,
        kind: 'progress',
        title: String(block.toolInput.title ?? (todos.length > 0 ? 'Todo 计划' : 'Agent 计划')),
        explanation:
          typeof block.toolInput.explanation === 'string' ? block.toolInput.explanation : undefined,
        items,
      })
    }
  }

  return plans.slice(-3).reverse()
}

function isPlanToolName(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.includes('update_plan') || lower.includes('todo') || lower.includes('plan')
}

function normalizePlanStatus(value: unknown): PlanItemStatus {
  if (value === 'completed' || value === 'complete' || value === 'done') return 'done'
  if (value === 'in_progress' || value === 'running' || value === 'active') return 'running'
  return 'pending'
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function extractSessionProgressTasks(messages: UIMessage[]): InspectorTask[] {
  const latestTodos = extractLatestTodoProgressTasks(messages)
  if (latestTodos != null) {
    return settleFinishedProgress(latestTodos.tasks, latestTodos.messageStatus)
  }

  const tasks = extractInspectorTasks(messages, { includeTeamMemberTasks: false })
  const messageStatus = findLatestHostTaskMessageStatus(messages)
  return settleFinishedProgress(tasks, messageStatus)
}

/**
 * Whether a host tool call contributes to the session task snapshot shown by
 * `extractSessionProgressTasks`. Keeping this predicate beside the extractor
 * prevents the inspector and the inline timeline from drifting apart.
 */
export function isSessionProgressToolBlock(
  block: UIMessage['blocks'][number],
): block is ToolCallBlock {
  if (block.kind !== 'tool_call' || block.teamMemberContext != null) return false
  if (isTaskToolName(block.toolName)) return true
  if (block.toolName === 'todo_write') {
    return Array.isArray(block.toolInput['todos']) || parseTodosFromOutput(block.output) != null
  }
  return (
    block.toolName === 'todo_read' &&
    block.status === 'success' &&
    parseTodosFromReadOutput(block.output) != null
  )
}

type SessionProgressSnapshot = {
  tasks: InspectorTask[]
  messageStatus: UIMessage['status']
}

function extractLatestTodoProgressTasks(messages: UIMessage[]): SessionProgressSnapshot | null {
  let latest: SessionProgressSnapshot | null = null

  for (const message of messages) {
    for (const block of message.blocks) {
      const isTodoWrite = block.kind === 'tool_call' && block.toolName === 'todo_write'
      const isSuccessfulTodoRead =
        block.kind === 'tool_call' && block.toolName === 'todo_read' && block.status === 'success'
      if (
        block.kind !== 'tool_call' ||
        (!isTodoWrite && !isSuccessfulTodoRead) ||
        block.teamMemberContext != null
      ) {
        continue
      }
      const outputSnapshot = isTodoWrite
        ? parseTodosFromOutput(block.output)
        : parseTodosFromReadOutput(block.output)
      const inputSnapshot = block.toolInput['todos']
      const todos = isTodoWrite
        ? (outputSnapshot ?? (Array.isArray(inputSnapshot) ? normalizeTodos(inputSnapshot) : null))
        : outputSnapshot
      // A read only becomes authoritative when its result contains a recognized
      // snapshot. In contrast, todo_write's input contract always carries the
      // full list, including [] as an explicit clear operation.
      if (todos == null) continue

      latest = {
        tasks: todos.map((todo, index) => ({
          id: typeof todo.id === 'string' && todo.id.length > 0 ? todo.id : String(index + 1),
          subject: todo.content,
          activeForm: todo.activeForm,
          status: todo.status,
          createdAt: index,
        })),
        messageStatus: message.status,
      }
    }
  }

  return latest
}

function settleFinishedProgress(
  tasks: InspectorTask[],
  messageStatus: UIMessage['status'] | null,
): InspectorTask[] {
  if (messageStatus !== 'error' && messageStatus !== 'cancelled') return tasks
  return tasks.map((task) =>
    task.status === 'in_progress' ? { ...task, status: 'interrupted' } : task,
  )
}

function findLatestHostTaskMessageStatus(messages: UIMessage[]): UIMessage['status'] | null {
  let latest: UIMessage['status'] | null = null
  for (const message of messages) {
    if (
      message.blocks.some(
        (block) =>
          block.kind === 'tool_call' &&
          block.teamMemberContext == null &&
          isTaskToolName(block.toolName),
      )
    ) {
      latest = message.status
    }
  }
  return latest
}

function isTaskToolName(name: string): boolean {
  const lower = name.toLowerCase()
  return (
    lower === 'task_create' ||
    lower === 'taskcreate' ||
    lower === 'task_update' ||
    lower === 'taskupdate'
  )
}

function parseTaskIdFromOutput(output: string | undefined): string | null {
  if (!output) return null
  const json = extractJsonObject(output)
  if (json?.task != null && typeof json.task === 'object') {
    const id = (json.task as Record<string, unknown>).id
    if (typeof id === 'string' && id.length > 0) return id
  }
  const match = output.match(/Task\s+([#A-Za-z0-9_-]+)\s+created/i)
  return match?.[1] ?? null
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/i)
  const candidate = fenced?.[1] ?? text.trim()
  if (!candidate.startsWith('{') && !candidate.startsWith('[')) return null
  try {
    const parsed = JSON.parse(candidate) as unknown
    if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Ignore malformed tool output and let the caller use the fallback id.
  }
  return null
}

function normalizeTaskId(id: string): string {
  return id.replace(/^#+/, '')
}

function findTaskById(tasks: Map<string, InspectorTask>, rawId: string): InspectorTask | undefined {
  const direct = tasks.get(rawId)
  if (direct != null) return direct
  const target = normalizeTaskId(rawId)
  if (!target) return undefined
  for (const task of tasks.values()) {
    if (normalizeTaskId(task.id) === target) return task
  }
  return undefined
}

/** Aggregate the latest TaskCreate / TaskUpdate view for the session. */
export function extractInspectorTasks(
  messages: UIMessage[],
  options: { includeTeamMemberTasks?: boolean } = {},
): InspectorTask[] {
  const tasks = new Map<string, InspectorTask>()
  let nextSeq = 0
  let fallbackCounter = 0
  const includeTeamMemberTasks = options.includeTeamMemberTasks ?? true

  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.kind !== 'tool_call' || !isTaskToolName(block.toolName)) continue
      if (!includeTeamMemberTasks && block.teamMemberContext != null) continue

      const lower = block.toolName.toLowerCase()
      const input = block.toolInput ?? {}

      if (lower === 'task_create' || lower === 'taskcreate') {
        const subject = typeof input.subject === 'string' ? input.subject : ''
        if (!subject) continue
        const parsedId = parseTaskIdFromOutput(block.output)
        const id = parsedId ?? `#task-${++fallbackCounter}`
        if (!tasks.has(id)) {
          tasks.set(id, {
            id,
            subject,
            description: typeof input.description === 'string' ? input.description : undefined,
            activeForm: typeof input.activeForm === 'string' ? input.activeForm : undefined,
            status: 'pending',
            createdAt: nextSeq++,
          })
        }
        continue
      }

      const rawId = input.taskId ?? input.task_id ?? input.id
      const id = typeof rawId === 'string' ? rawId : ''
      if (!id) continue
      const existing = findTaskById(tasks, id)
      if (!existing) continue

      const status = input.status
      if (typeof status === 'string') {
        if (status === 'deleted') {
          const keyToDelete = Array.from(tasks.entries()).find(([, task]) => task === existing)?.[0]
          if (keyToDelete != null) tasks.delete(keyToDelete)
          continue
        }
        if (status === 'pending' || status === 'in_progress' || status === 'completed') {
          existing.status = status
        }
      }
      if (typeof input.subject === 'string') existing.subject = input.subject
      if (typeof input.description === 'string') existing.description = input.description
      if (typeof input.activeForm === 'string') existing.activeForm = input.activeForm
    }
  }

  return Array.from(tasks.values()).sort((a, b) => a.createdAt - b.createdAt)
}
