/**
 * TodoStore — 进程级、按 session 分桶的待办列表存储。
 *
 * 用于支撑 todo_write 工具，让 agent 在多 turn 之间持续推进同一个 plan。
 *
 * 注意：内存级实现，进程重启后丢失。如果未来需要持久化到 SQLite，
 * 把 read/write/clear 改成 repository 调用即可，工具签名不变。
 */

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export interface TodoItem {
  /** 简短动作描述（祈使句），用于 UI 一行展示 */
  content: string
  /** 当前状态 */
  status: TodoStatus
  /** in_progress 时显示的进行态描述（如 "Running tests"） */
  activeForm?: string
}

const store = new Map<string, TodoItem[]>()

export const TodoStore = {
  read(sessionId: string): TodoItem[] {
    return store.get(sessionId)?.slice() ?? []
  },
  write(sessionId: string, todos: TodoItem[]): TodoItem[] {
    store.set(sessionId, todos)
    return todos.slice()
  },
  clear(sessionId: string): void {
    store.delete(sessionId)
  },
}
