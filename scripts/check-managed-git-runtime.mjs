#!/usr/bin/env node

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runtimeRoots = [
  path.join(repoRoot, 'apps', 'desktop', 'src', 'main'),
  path.join(repoRoot, 'packages', 'agent-runtime', 'src'),
]
const forbiddenPatterns = [
  {
    label: 'direct Git process spawn',
    pattern: /\b(?:execFile|execFileAsync|spawn|spawnSync|exec)\s*\(\s*['"`]git(?:\.exe)?['"`]/g,
  },
  {
    label: 'fixed Git shell command',
    pattern: /\bexecShell\s*\(\s*['"`]git\s/g,
  },
]

const violations = []
for (const root of runtimeRoots) {
  for (const file of await walk(root)) {
    if (!/\.(?:ts|tsx|mts|mjs|js)$/.test(file)) continue
    if (isAllowedFile(file)) continue
    const source = await readFile(file, 'utf8')
    for (const { label, pattern } of forbiddenPatterns) {
      pattern.lastIndex = 0
      for (const match of source.matchAll(pattern)) {
        const line = source.slice(0, match.index).split('\n').length
        violations.push(`${path.relative(repoRoot, file)}:${line} ${label}`)
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Runtime code must execute Git through GitCommandService:')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exitCode = 1
} else {
  console.log('Managed Git runtime check passed')
}

async function walk(root) {
  const files = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name)
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'coverage'].includes(entry.name)) continue
      files.push(...(await walk(absolute)))
    } else if (entry.isFile()) {
      files.push(absolute)
    }
  }
  return files
}

function isAllowedFile(file) {
  const relative = path.relative(repoRoot, file).replaceAll(path.sep, '/')
  return (
    /(?:^|\/)__tests__(?:\/|$)/.test(relative) ||
    /\.(?:test|spec)\.[^.]+$/.test(relative) ||
    relative === 'apps/desktop/src/main/services/GitRuntimeService.ts'
  )
}
