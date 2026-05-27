/**
 * Sanity tests for the new tools added in PR2:
 *   - todo_write
 *   - multi_edit
 *   - background-tasks (start / monitor / stop)
 *   - exit_plan_mode
 *
 * web_fetch / web_search are network-bound and not covered here; they're
 * verified end-to-end by the agent loop during real usage.
 */
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { todoWriteTool } from '../../../core/tools/todo.js'
import { TodoStore } from '../../../core/todo-store.js'
import { multiEditTool } from '../../../core/tools/multi-edit.js'
import { monitorTool, startBackgroundTask, stopBackgroundTask, listBackgroundTasks } from '../../../core/tools/background-tasks.js'
import { exitPlanModeTool } from '../../../core/tools/exit-plan-mode.js'
import type { ToolContext } from '../../../core/tool-registry.js'

const CTX = (workspaceRootPath: string, sessionId?: string): ToolContext =>
  sessionId == null ? { workspaceRootPath } : { workspaceRootPath, sessionId }

describe('todo_write', () => {
  beforeEach(() => TodoStore.clear('s1'))

  it('rejects calls without session context', async () => {
    const res = await todoWriteTool.execute(CTX('/tmp'), { todos: [] })
    expect(res.status).toBe('error')
    expect(res.error).toMatch(/session context/)
  })

  it('rejects non-array todos input', async () => {
    const res = await todoWriteTool.execute(CTX('/tmp', 's1'), { todos: 'not-an-array' })
    expect(res.status).toBe('error')
  })

  it('rejects todos with missing content', async () => {
    const res = await todoWriteTool.execute(CTX('/tmp', 's1'), { todos: [{ status: 'pending' }] })
    expect(res.status).toBe('error')
    expect(res.error).toMatch(/content/)
  })

  it('rejects invalid status values', async () => {
    const res = await todoWriteTool.execute(CTX('/tmp', 's1'), { todos: [{ content: 'a', status: 'done' }] })
    expect(res.status).toBe('error')
    expect(res.error).toMatch(/status/)
  })

  it('rejects >1 in_progress', async () => {
    const res = await todoWriteTool.execute(CTX('/tmp', 's1'), {
      todos: [
        { content: 'a', status: 'in_progress' },
        { content: 'b', status: 'in_progress' },
      ],
    })
    expect(res.status).toBe('error')
    expect(res.error).toMatch(/one todo/)
  })

  it('stores todos per session and returns summary', async () => {
    const res = await todoWriteTool.execute(CTX('/tmp', 's1'), {
      todos: [
        { content: 'task 1', status: 'completed' },
        { content: 'task 2', status: 'in_progress', activeForm: 'Doing task 2' },
        { content: 'task 3', status: 'pending' },
      ],
    })
    expect(res.status).toBe('success')
    const out = res.output as { todos: unknown[]; summary: string }
    expect(out.todos).toHaveLength(3)
    expect(out.summary).toContain('1/3 completed')
    expect(out.summary).toContain('Doing task 2')

    // Reading back via TodoStore
    const stored = TodoStore.read('s1')
    expect(stored).toHaveLength(3)
    expect(stored[1]?.activeForm).toBe('Doing task 2')
  })

  it('subsequent calls replace the previous list (not merge)', async () => {
    await todoWriteTool.execute(CTX('/tmp', 's1'), { todos: [{ content: 'old', status: 'pending' }] })
    await todoWriteTool.execute(CTX('/tmp', 's1'), { todos: [{ content: 'new', status: 'completed' }] })
    const stored = TodoStore.read('s1')
    expect(stored).toHaveLength(1)
    expect(stored[0]?.content).toBe('new')
  })

  it('TodoStore.clear isolates sessions', async () => {
    await todoWriteTool.execute(CTX('/tmp', 's1'), { todos: [{ content: 'a', status: 'pending' }] })
    await todoWriteTool.execute(CTX('/tmp', 's2'), { todos: [{ content: 'b', status: 'pending' }] })
    TodoStore.clear('s1')
    expect(TodoStore.read('s1')).toHaveLength(0)
    expect(TodoStore.read('s2')).toHaveLength(1)
  })
})

describe('multi_edit', () => {
  let tmpDir: string
  let target: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spark-multi-edit-'))
    target = path.join(tmpDir, 'src.txt')
    await fs.writeFile(target, 'foo\nbar\nbaz\nfoo\n', 'utf-8')
  })
  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('rejects path outside workspace', async () => {
    const res = await multiEditTool.execute(CTX(tmpDir), {
      path: '../escape.txt',
      edits: [{ oldText: 'a', newText: 'b' }],
    })
    expect(res.status).toBe('error')
    expect(res.error).toMatch(/outside workspace/)
  })

  it('rejects empty edits array', async () => {
    const res = await multiEditTool.execute(CTX(tmpDir), { path: 'src.txt', edits: [] })
    expect(res.status).toBe('error')
  })

  it('rejects identical oldText/newText (no-op)', async () => {
    const res = await multiEditTool.execute(CTX(tmpDir), {
      path: 'src.txt',
      edits: [{ oldText: 'foo', newText: 'foo' }],
    })
    expect(res.status).toBe('error')
    expect(res.error).toMatch(/identical/)
  })

  it('refuses non-unique oldText without replaceAll', async () => {
    const res = await multiEditTool.execute(CTX(tmpDir), {
      path: 'src.txt',
      edits: [{ oldText: 'foo', newText: 'FOO' }],
    })
    expect(res.status).toBe('error')
    expect(res.error).toMatch(/2 times/)
    // File should be unchanged
    const after = await fs.readFile(target, 'utf-8')
    expect(after).toBe('foo\nbar\nbaz\nfoo\n')
  })

  it('atomically applies multiple edits in order', async () => {
    const res = await multiEditTool.execute(CTX(tmpDir), {
      path: 'src.txt',
      edits: [
        { oldText: 'foo', newText: 'FOO', replaceAll: true },
        { oldText: 'bar', newText: 'BAR' },
      ],
    })
    expect(res.status).toBe('success')
    const after = await fs.readFile(target, 'utf-8')
    expect(after).toBe('FOO\nBAR\nbaz\nFOO\n')
    const out = res.output as { editsApplied: number; replacementsByEdit: number[] }
    expect(out.editsApplied).toBe(2)
    expect(out.replacementsByEdit).toEqual([2, 1])
  })

  it('aborts entire batch if any edit fails (atomic)', async () => {
    const res = await multiEditTool.execute(CTX(tmpDir), {
      path: 'src.txt',
      edits: [
        { oldText: 'bar', newText: 'BAR' },          // would succeed
        { oldText: 'NONEXISTENT', newText: 'X' },    // fails
      ],
    })
    expect(res.status).toBe('error')
    // File must be unchanged (atomic guarantee)
    const after = await fs.readFile(target, 'utf-8')
    expect(after).toBe('foo\nbar\nbaz\nfoo\n')
  })
})

describe('background-tasks + monitor', () => {
  let tmpDir: string
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spark-bg-'))
  })
  afterEach(async () => {
    // Stop any leftover tasks then cleanup
    for (const t of listBackgroundTasks()) {
      if (t.running) stopBackgroundTask(t.id, 'SIGKILL')
    }
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('start → monitor reads incremental stdout → stop', async () => {
    const { id } = startBackgroundTask(
      `for i in 1 2 3; do echo "line $i"; sleep 0.05; done`,
      tmpDir,
    )
    expect(id).toMatch(/^[0-9a-f-]+$/)

    // Wait for output
    await new Promise((r) => setTimeout(r, 300))

    const read1 = await monitorTool.execute(CTX(tmpDir), { action: 'read', taskId: id })
    expect(read1.status).toBe('success')
    const out1 = read1.output as { stdout: string; running: boolean }
    expect(out1.stdout).toContain('line 1')
    expect(out1.stdout).toContain('line 3')

    // Second read should return empty (cursor advanced)
    const read2 = await monitorTool.execute(CTX(tmpDir), { action: 'read', taskId: id })
    const out2 = read2.output as { stdout: string }
    expect(out2.stdout).toBe('')
  })

  it('action:list returns tasks', async () => {
    const { id } = startBackgroundTask('sleep 2', tmpDir)
    const res = await monitorTool.execute(CTX(tmpDir), { action: 'list' })
    expect(res.status).toBe('success')
    const out = res.output as { tasks: Array<{ id: string; running: boolean }> }
    expect(out.tasks.some((t) => t.id === id)).toBe(true)
    stopBackgroundTask(id, 'SIGKILL')
  })

  it('action:stop terminates a running task', async () => {
    const { id } = startBackgroundTask('sleep 10', tmpDir)
    const res = await monitorTool.execute(CTX(tmpDir), { action: 'stop', taskId: id, signal: 'SIGKILL' })
    expect(res.status).toBe('success')

    await new Promise((r) => setTimeout(r, 100))
    const after = await monitorTool.execute(CTX(tmpDir), { action: 'read', taskId: id })
    const out = after.output as { running: boolean }
    expect(out.running).toBe(false)
  })

  it('action:stop on nonexistent task → error', async () => {
    const res = await monitorTool.execute(CTX(tmpDir), { action: 'stop', taskId: 'nope' })
    expect(res.status).toBe('error')
  })

  it('action:read requires taskId', async () => {
    const res = await monitorTool.execute(CTX(tmpDir), { action: 'read' })
    expect(res.status).toBe('error')
    expect(res.error).toMatch(/taskId/)
  })
})

describe('exit_plan_mode', () => {
  it('rejects empty plan', async () => {
    const res = await exitPlanModeTool.execute(CTX('/tmp'), { plan: '   ' })
    expect(res.status).toBe('error')
  })

  it('returns __planProposed marker on success', async () => {
    const res = await exitPlanModeTool.execute(CTX('/tmp'), { plan: '1. step one\n2. step two' })
    expect(res.status).toBe('success')
    const out = res.output as { __planProposed: boolean; plan: string }
    expect(out.__planProposed).toBe(true)
    expect(out.plan).toContain('step one')
  })
})
