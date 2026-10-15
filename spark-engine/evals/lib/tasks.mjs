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
    if (task.tier !== 'smoke' && task.tier !== 'hard') {
      throw new Error(`Task ${name} tier must be "smoke" or "hard"`)
    }
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

const TIER_NAMES = ['smoke', 'hard', 'all']

/**
 * Choose tasks for one run.
 *
 * `tier` omitted and no selectors: smoke only, so a bare live run does not
 * mix smoke and hard scores. Selectors with no tier: those tasks only.
 * `--self-test` passes `tier: "all"` when the flag is omitted.
 * A numeric `09-14` selector is a prefix range. `09` or `09,10` selects those ids. `09-*` is a glob.
 */
export function selectTasks(tasks, options = {}) {
  const ids = options.ids ?? []
  const picked = ids.length > 0 ? expandTaskSelectors(tasks, ids) : [...tasks]
  const tier = options.tier ?? (ids.length > 0 ? 'all' : 'smoke')
  if (!TIER_NAMES.includes(tier)) {
    throw new Error(`Unsupported --tier: ${tier} (smoke | hard | all)`)
  }
  const selected = tier === 'all' ? picked : picked.filter((task) => task.tier === tier)
  if (selected.length === 0) {
    throw new Error(
      `No tasks matched${ids.length > 0 ? ` selector ${ids.join(', ')}` : ''} and tier ${tier}.`,
    )
  }
  return { tier, tasks: selected }
}

function expandTaskSelectors(tasks, selectors) {
  const tokens = []
  for (const selector of selectors) {
    for (const part of String(selector).split(',')) {
      const token = part.trim()
      if (token) tokens.push(token)
    }
  }
  const selected = []
  const seen = new Set()
  for (const token of tokens) {
    const matches = matchTaskToken(tasks, token)
    if (matches.length === 0) {
      throw new Error(
        `Unknown task selector ${token}. Known tasks: ${tasks.map((task) => task.id).join(', ')}`,
      )
    }
    for (const task of matches) {
      if (seen.has(task.id)) continue
      seen.add(task.id)
      selected.push(task)
    }
  }
  return selected
}

function matchTaskToken(tasks, token) {
  const range = /^(\d{2})-(\d{2})$/u.exec(token)
  if (range) {
    const start = Number(range[1])
    const end = Number(range[2])
    if (end < start) return []
    return tasks.filter((task) => {
      const prefix = Number(task.id.slice(0, 2))
      return task.id[2] === '-' && Number.isInteger(prefix) && prefix >= start && prefix <= end
    })
  }
  if (token.includes('*') || token.includes('?')) {
    const pattern = `^${token
      .replace(/[.+^${}()|[\]\\]/gu, '\\$&')
      .replaceAll('*', '.*')
      .replaceAll('?', '.')}$`
    const expression = new RegExp(pattern, 'u')
    return tasks.filter((task) => expression.test(task.id))
  }
  const exact = tasks.find((task) => task.id === token)
  if (exact) return [exact]
  if (/^\d{2}$/u.test(token)) {
    return tasks.filter((task) => task.id.startsWith(`${token}-`))
  }
  return []
}

export function parsePrepareOutput(stdout) {
  const match = stdout.match(/^HEAD ([0-9a-f]{7,64})$/mu)
  return { head: match?.[1] }
}
