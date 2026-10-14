import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

export async function loadTasks(evalsRoot) {
  const tasksDir = join(evalsRoot, 'tasks')
  const names = (await readdir(tasksDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  const tasks = []
  for (const name of names) {
    const dir = join(tasksDir, name)
    const task = JSON.parse(await readFile(join(dir, 'task.json'), 'utf8'))
    if (task.id !== name) {
      throw new Error(`Task directory ${name} does not match task.json id ${task.id}`)
    }
    if (!task.promptFile || !task.grade) throw new Error(`Task ${name} is missing prompt or grade`)
    tasks.push({
      ...task,
      dir,
      frozen: task.frozen ?? [],
      requireTools: task.requireTools ?? [],
      timeoutMs: task.timeoutMs ?? 180_000,
    })
  }
  return tasks
}

export function selectTasks(tasks, ids) {
  if (ids.length === 0) return tasks
  const known = new Map(tasks.map((task) => [task.id, task]))
  const selected = []
  for (const id of ids) {
    const task = known.get(id)
    if (!task) {
      throw new Error(`Unknown task ${id}. Known tasks: ${tasks.map((item) => item.id).join(', ')}`)
    }
    selected.push(task)
  }
  return selected
}

export function parsePrepareOutput(stdout) {
  const match = stdout.match(/^HEAD ([0-9a-f]{7,64})$/mu)
  return { head: match?.[1] }
}
