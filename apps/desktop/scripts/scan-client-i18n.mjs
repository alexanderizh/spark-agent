#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const files = []
const ignoredParts = new Set(['assets', 'i18n'])

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      if (ignoredParts.has(entry)) continue
      walk(path)
      continue
    }
    if (!/\.(ts|tsx|html)$/.test(entry)) continue
    if (/\.test\.tsx?$/.test(entry)) continue
    files.push(path)
  }
}

walk(join(root, 'src/renderer'))

const han = /[\u4e00-\u9fff]/
const findings = []

function stripLineComment(line) {
  let quote = null
  let escaped = false
  for (let i = 0; i < line.length - 1; i += 1) {
    const ch = line[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }
    if (quote != null) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '/' && line[i + 1] === '/') return line.slice(0, i)
  }
  return line
}

for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const lines = text.split(/\r?\n/)
  let inBlockComment = false
  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false
      return
    }
    if (trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      if (!trimmed.includes('*/')) inBlockComment = true
      return
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('{/*')) return
    const code = stripLineComment(line)
    if (!han.test(code)) return
    findings.push({ file: relative(root, file), line: index + 1, text: code.trim() })
  })
}

if (findings.length > 0) {
  console.error(
    `Found ${findings.length} renderer client-text lines containing CJK characters outside i18n resources.`,
  )
  for (const item of findings.slice(0, 200)) {
    console.error(`${item.file}:${item.line}: ${item.text}`)
  }
  if (findings.length > 200) {
    console.error(`... ${findings.length - 200} more findings omitted`)
  }
  process.exitCode = 1
} else {
  console.log('No hard-coded CJK renderer client text found outside i18n resources.')
}
