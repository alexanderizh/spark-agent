#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const ROOT = resolve(dirname(SCRIPT_PATH), '..')
const DEFAULT_CHANGELOG_PATH = resolve(ROOT, 'CHANGELOG.md')

function normalizeVersion(version) {
  if (typeof version !== 'string' || version.trim().length === 0) {
    throw new Error('缺少目标版本号，请通过 --version 或 VERSION 提供。')
  }
  const normalized = version.trim().replace(/^v/i, '')
  if (normalized.toLowerCase() === 'unreleased') {
    throw new Error('Unreleased 不能作为正式发布版本的更新说明。')
  }
  return normalized
}

function findVersionSection(changelog, version) {
  const headings = [...changelog.matchAll(/^## \[([^\]]+)\](?:\s+-\s+.+)?\s*$/gmu)]
  const targetIndex = headings.findIndex((match) => match[1].trim() === version)
  if (targetIndex < 0) return null

  const target = headings[targetIndex]
  const contentStart = (target.index ?? 0) + target[0].length
  const contentEnd = headings[targetIndex + 1]?.index ?? changelog.length
  const content = changelog
    .slice(contentStart, contentEnd)
    .replace(/^\s*---\s*$/gmu, '')
    .trim()

  if (content.length === 0) {
    throw new Error(`CHANGELOG.md 中版本 ${version} 的更新说明为空。`)
  }
  return content
}

export async function readReleaseNotes({ version, changelogPath = DEFAULT_CHANGELOG_PATH }) {
  const normalizedVersion = normalizeVersion(version)
  let changelog
  try {
    changelog = await readFile(changelogPath, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    console.warn(`[release-notes] 未找到 ${changelogPath}，继续发布且不附带更新说明。`)
    return ''
  }

  const notes = findVersionSection(changelog, normalizedVersion)
  if (notes == null) {
    console.warn(
      `[release-notes] CHANGELOG.md 中缺少版本 ${normalizedVersion} 的条目，继续发布且不附带更新说明。`,
    )
    return ''
  }
  return notes
}

function parseArgs(argv) {
  const options = { version: undefined, changelogPath: undefined, outputPath: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index]
    const value = argv[index + 1]
    if (option === '--version') options.version = value
    else if (option === '--changelog') options.changelogPath = value
    else if (option === '--output') options.outputPath = value
    else throw new Error(`未知参数：${option}`)
    if (value == null || value.startsWith('--')) {
      throw new Error(`${option} 需要一个值。`)
    }
    index += 1
  }
  return options
}

export async function runReleaseNotesCli(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv)
  const notes = await readReleaseNotes({
    version: options.version ?? env.VERSION,
    changelogPath:
      options.changelogPath == null ? DEFAULT_CHANGELOG_PATH : resolve(options.changelogPath),
  })
  if (options.outputPath != null) {
    const outputPath = resolve(options.outputPath)
    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, `${notes}\n`, 'utf8')
  } else {
    process.stdout.write(`${notes}\n`)
  }
  return notes
}

if (process.argv[1] != null && resolve(process.argv[1]) === SCRIPT_PATH) {
  runReleaseNotesCli().catch((error) => {
    console.error(`[release-notes] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
