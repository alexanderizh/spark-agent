import type { UIMessage } from '../../services/event-mapper'
import { countDiffLines } from './ChatViewUtils'

export type PlanItemStatus = 'done' | 'running' | 'pending'

export type PlanItem = {
  status: PlanItemStatus
  text: string
  meta?: string
}

export type SidebarPlan = {
  id: string
  title: string
  explanation?: string | undefined
  items: Array<{ text: string; status: PlanItemStatus }>
  /** 原始 plan_proposed 文本，仅来自 ExitPlanMode 的计划才有，用于与待审批计划去重。 */
  rawPlan?: string | undefined
}

export type ParsedTodo = {
  id?: string
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
}

export type InspectorFileChange = {
  id: string
  path: string
  changeType: string
  adds: number
  dels: number
  hasDiff: boolean
  checkpointIds: string[]
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

/** Parse a markdown plan text into structured plan items. */
export function parsePlanToItems(plan: string): PlanItem[] {
  const items: PlanItem[] = []
  const lines = plan.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    const checkboxMatch = trimmed.match(/^[-*]\s+\[([ x*])\]\s+(.*)$/)
    if (checkboxMatch) {
      const mark = checkboxMatch[1]
      const text = checkboxMatch[2] ?? ''
      if (mark === 'x' || mark === 'X') {
        items.push({ status: 'done', text })
      } else if (mark === '*') {
        items.push({ status: 'running', text })
      } else {
        items.push({ status: 'pending', text })
      }
      continue
    }

    const numberedMatch = trimmed.match(/^\d+\.\s+(.*)$/)
    if (numberedMatch) {
      items.push({ status: 'pending', text: numberedMatch[1] ?? '' })
      continue
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.*)$/)
    if (
      bulletMatch &&
      (bulletMatch[1] ?? '').length > 0 &&
      !(bulletMatch[1] ?? '').startsWith('[')
    ) {
      items.push({ status: 'pending', text: bulletMatch[1] ?? '' })
    }
  }

  if (items.length === 0 && plan.trim().length > 0) {
    const fallbackItem: PlanItem = {
      status: 'pending',
      text: plan.trim().slice(0, 200),
    }
    if (plan.trim().length > 200) fallbackItem.meta = '...'
    items.push(fallbackItem)
  }
  return items
}

export function parseTodosFromInputOrOutput(
  input: Record<string, unknown>,
  output: string | undefined,
): ParsedTodo[] {
  if (output != null) {
    try {
      const cleaned = output
        .replace(/^```json\n?/, '')
        .replace(/\n?```$/, '')
        .trim()
      const parsed = JSON.parse(cleaned) as { todos?: unknown }
      if (Array.isArray(parsed.todos)) {
        const normalized = normalizeTodos(parsed.todos)
        if (normalized.length > 0 || parsed.todos.length === 0) return normalized
      }
    } catch {
      // Fall through to the input payload when the tool output is not JSON.
    }
  }
  const todos = input['todos']
  return Array.isArray(todos) ? normalizeTodos(todos) : []
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

export function formatCheckpointReference(checkpointId: string): string {
  return checkpointId.length > 8 ? checkpointId.slice(-6) : checkpointId
}

export function extractInspectorFileChanges(messages: UIMessage[]): InspectorFileChange[] {
  const checkpointsByPath = new Map<string, string[]>()

  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.kind !== 'checkpoint') continue
      for (const filePath of block.filePaths ?? []) {
        const checkpointIds = checkpointsByPath.get(filePath) ?? []
        const shortId = formatCheckpointReference(block.checkpointId)
        if (!checkpointIds.includes(shortId)) checkpointIds.push(shortId)
        checkpointsByPath.set(filePath, checkpointIds)
      }
    }
  }

  const changes = new Map<string, InspectorFileChange>()
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.kind !== 'file_change') continue
      const counts = countDiffLines(block.diff)
      changes.set(block.path, {
        id: `${message.id}:${block.path}`,
        path: block.path,
        changeType: block.changeType,
        adds: counts.adds,
        dels: counts.dels,
        hasDiff: block.diff != null && block.diff.trim().length > 0,
        checkpointIds: checkpointsByPath.get(block.path) ?? [],
      })
    }
  }

  return Array.from(changes.values()).slice(-12).reverse()
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
        const items = parsePlanToItems(block.plan)
        if (items.length === 0) continue
        plans.push({
          id: `${message.id}:plan_proposed`,
          title: 'Agent 计划',
          items,
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

type SessionProgressSnapshot = {
  tasks: InspectorTask[]
  messageStatus: UIMessage['status']
}

function extractLatestTodoProgressTasks(messages: UIMessage[]): SessionProgressSnapshot | null {
  let latest: SessionProgressSnapshot | null = null

  for (const message of messages) {
    for (const block of message.blocks) {
      if (
        block.kind !== 'tool_call' ||
        block.toolName !== 'todo_write' ||
        block.teamMemberContext != null
      ) {
        continue
      }
      const todos = parseTodosFromInputOrOutput(block.toolInput, block.output)
      if (todos.length === 0) continue

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
  if (messageStatus === 'streaming') return tasks
  return tasks.map((task) =>
    task.status === 'completed' ? task : { ...task, status: 'interrupted' },
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
