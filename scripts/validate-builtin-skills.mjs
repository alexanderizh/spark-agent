#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '..')
const skillsRoot = join(repositoryRoot, 'apps', 'desktop', 'resources', 'skills')
const errors = []
const ids = new Map()

for (const entry of readdirSync(skillsRoot).sort()) {
  const skillRoot = join(skillsRoot, entry)
  if (!statSync(skillRoot).isDirectory()) continue

  const skillFile = join(skillRoot, 'SKILL.md')
  const manifestFile = join(skillRoot, 'manifest.json')
  if (!existsSync(skillFile)) {
    errors.push(`${entry}: missing SKILL.md`)
    continue
  }
  if (!existsSync(manifestFile)) {
    errors.push(`${entry}: missing manifest.json`)
    continue
  }

  const skillText = readFileSync(skillFile, 'utf8')
  const frontmatter = parseFrontmatter(skillText)
  if (!frontmatter.name) errors.push(`${entry}: SKILL.md frontmatter is missing name`)
  if (!frontmatter.description) errors.push(`${entry}: SKILL.md frontmatter is missing description`)

  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
  } catch (error) {
    errors.push(`${entry}: invalid manifest.json (${String(error)})`)
    continue
  }
  if (typeof manifest.id !== 'string' || !manifest.id.startsWith('builtin:')) {
    errors.push(`${entry}: manifest id must start with builtin:`)
  } else if (ids.has(manifest.id)) {
    errors.push(`${entry}: duplicate manifest id ${manifest.id} (also ${ids.get(manifest.id)})`)
  } else {
    ids.set(manifest.id, entry)
  }
  if (!Array.isArray(manifest.requiredTools)) {
    errors.push(`${entry}: manifest requiredTools must be an array`)
  }
  if (manifest.requiredTools?.some((tool) => tool === 'WebSearch' || tool === 'WebFetch')) {
    errors.push(`${entry}: use mcp__spark_search__* instead of legacy WebSearch/WebFetch`)
  }

  for (const markdownFile of listMarkdownFiles(skillRoot)) {
    validateMarkdownReferences(skillRoot, markdownFile)
  }
}

if (errors.length > 0) {
  console.error(
    `Built-in skill validation failed (${errors.length} issue${errors.length === 1 ? '' : 's'}):`,
  )
  for (const issue of errors) console.error(`- ${issue}`)
  process.exit(1)
}

console.log(`Validated ${ids.size} built-in skills`)

function parseFrontmatter(text) {
  if (!text.startsWith('---')) return {}
  const end = text.indexOf('\n---', 3)
  if (end < 0) return {}
  const output = {}
  for (const line of text.slice(3, end).split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!match) continue
    output[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '')
  }
  return output
}

function listMarkdownFiles(root) {
  const output = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) output.push(...listMarkdownFiles(path))
    else if (entry.isFile() && entry.name.endsWith('.md')) output.push(path)
  }
  return output
}

function validateMarkdownReferences(skillRoot, markdownFile) {
  const text = readFileSync(markdownFile, 'utf8')
  const displayPath = relative(repositoryRoot, markdownFile)

  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].trim().split(/\s+/)[0].replace(/^<|>$/g, '')
    if (!target || /^(?:https?:|mailto:|#|\{\{)/i.test(target)) continue
    const cleanTarget = target.split('#')[0].split('?')[0]
    if (cleanTarget && !existsSync(resolve(dirname(markdownFile), cleanTarget))) {
      errors.push(`${displayPath}: missing linked resource ${target}`)
    }
  }

  const commandPattern =
    /(?:bash|python3?|node)\s+(?:\{\{SKILLS_DIR\}\}\/skills\/[^/]+\/|skills\/[^/]+\/)?(scripts\/[^\s"'`]+)/g
  for (const match of text.matchAll(commandPattern)) {
    const target = match[1].replace(/[),.;:]+$/, '')
    if (/[<{]/.test(target)) continue
    if (!existsSync(join(skillRoot, target))) {
      errors.push(`${displayPath}: missing command resource ${target}`)
    }
  }
}
