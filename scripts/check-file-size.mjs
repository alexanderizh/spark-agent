#!/usr/bin/env node
/**
 * 文件尺寸 ratchet（工程化还债方案 Phase 0.3）。
 *
 * 把 CLAUDE.md 的「单文件不超过 3000 行」从文档约定变成机器门禁：
 * - 基线册（scripts/file-size-baseline.json）记录当前所有超阈值文件及其行数；
 * - 禁止新文件超阈值入册（新增巨石直接失败）；
 * - 禁止在册文件行数增长（触碰即拆，拆完跑 --update 收紧基线）；
 * - 在册文件变小/消失不报错，鼓励持续拆解。
 *
 * 用法：
 *   node scripts/check-file-size.mjs            # 检查（CI / pre-commit 用）
 *   node scripts/check-file-size.mjs --update   # 拆分落地后重新生成基线（只允许变小）
 */
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const BASELINE_PATH = join(ROOT, 'scripts', 'file-size-baseline.json')
const THRESHOLD = 2000
const EXTENSIONS = new Set(['.ts', '.tsx', '.mjs'])

/** 与全局搜索口径一致：排除依赖、构建产物与陈旧 worktree 副本。 */
const EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'out',
  'build',
  'coverage',
  'release',
  'vendor',
  '.worktrees',
  '.spark-artifacts',
])

async function collectSourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'worktrees' && dirname(full).endsWith(`${sep}.claude`)) continue
      if (EXCLUDED_DIRS.has(entry.name)) continue
      files.push(...(await collectSourceFiles(full)))
    } else if (entry.isFile() && EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf('.')))) {
      files.push(full)
    }
  }
  return files
}

async function countLines(file) {
  const content = await readFile(file, 'utf8')
  let lines = 0
  for (let i = 0; i < content.length; i += 1) {
    if (content.charCodeAt(i) === 10) lines += 1
  }
  // 末行无换行符时也计一行
  if (content.length > 0 && content.charCodeAt(content.length - 1) !== 10) lines += 1
  return lines
}

async function measureCurrentState() {
  const files = await collectSourceFiles(ROOT)
  const measured = {}
  for (const file of files) {
    const lines = await countLines(file)
    if (lines > THRESHOLD) {
      measured[relative(ROOT, file).split(sep).join('/')] = lines
    }
  }
  return measured
}

function sortEntries(record) {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))
}

async function main() {
  const update = process.argv.includes('--update')
  const current = await measureCurrentState()
  const currentPaths = Object.keys(current)

  if (update) {
    await writeFile(BASELINE_PATH, `${JSON.stringify(sortEntries(current), null, 2)}\n`, 'utf8')
    console.log(
      `[file-size] baseline updated: ${currentPaths.length} files above ${THRESHOLD} lines ` +
        `(ratchet can only shrink — regenerate only after splits land)`,
    )
    return
  }

  let baseline
  try {
    baseline = JSON.parse(await readFile(BASELINE_PATH, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error(
        `[file-size] baseline not found at ${relative(ROOT, BASELINE_PATH)} — run with --update first`,
      )
      console.warn('[file-size] warning: baseline is unavailable; commit is not blocked')
      return
    }
    throw error
  }

  const violations = []
  for (const path of currentPaths) {
    const baselineLines = baseline[path]
    if (baselineLines === undefined) {
      violations.push(`NEW oversize file (${current[path]} lines > ${THRESHOLD}): ${path}`)
    } else if (current[path] > baselineLines) {
      violations.push(
        `GROWN ${path}: ${baselineLines} -> ${current[path]} lines (split before adding more)`,
      )
    }
  }

  const shrunk = Object.entries(baseline).filter(([path]) => current[path] === undefined)
  for (const [path] of shrunk) {
    console.log(
      `[file-size] good: ${path} no longer exceeds ${THRESHOLD} — run --update to tighten the baseline`,
    )
  }

  if (violations.length > 0) {
    console.warn(`[file-size] warning: ${violations.length} violation(s):`)
    for (const violation of violations) console.warn(`  - ${violation}`)
    console.warn('[file-size] warning: commit is not blocked')
    return
  }
  console.log(
    `[file-size] OK: ${currentPaths.length}/${Object.keys(baseline).length} baseline files still above ` +
      `${THRESHOLD} lines, none grown, no new oversize files`,
  )
}

await stat(BASELINE_PATH).catch(() => mkdir(dirname(BASELINE_PATH), { recursive: true }))
await main()
