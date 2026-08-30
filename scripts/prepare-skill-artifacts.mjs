#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { cp, lstat, mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const NORMALIZED_TIME = new Date('2000-01-01T00:00:00.000Z')

const SKILLS = [
  ...[
    'gitnexus-cli',
    'gitnexus-debugging',
    'gitnexus-exploring',
    'gitnexus-guide',
    'gitnexus-impact-analysis',
    'gitnexus-refactoring',
  ].map((name) => ({
    name,
    archivePrefix: 'gitnexus',
    upstreamRoot: '/.claude/skills',
  })),
  ...[
    'brainstorming',
    'dispatching-parallel-agents',
    'executing-plans',
    'finishing-a-development-branch',
    'receiving-code-review',
    'requesting-code-review',
    'subagent-driven-development',
    'systematic-debugging',
    'test-driven-development',
    'using-git-worktrees',
    'using-superpowers',
    'verification-before-completion',
    'writing-plans',
    'writing-skills',
  ].map((name) => ({
    name,
    archivePrefix: 'superpowers',
    upstreamRoot: '/skills',
  })),
]

export async function prepareSkillArtifacts({
  version,
  currentArchiveDirectory,
  outputDirectory,
  gitnexusDirectory,
  superpowersDirectory,
  gitnexusCommit,
  superpowersCommit,
  currentVersion = '2026.07.07',
}) {
  assertVersion(version)
  const currentRoot = resolve(currentArchiveDirectory)
  const outputRoot = resolve(outputDirectory)
  await mkdir(outputRoot, { recursive: true })
  const workRoot = await mkdtemp(join(tmpdir(), `spark-skill-build-${version}-`))
  const entries = []

  try {
    for (const skill of SKILLS) {
      const artifactName =
        skill.archivePrefix === 'superpowers' ? `superpowers-${skill.name}` : skill.name
      const archiveName = `${artifactName}-${version.replaceAll('.', '-')}.zip`
      const currentArchiveName =
        skill.archivePrefix === 'gitnexus'
          ? `${skill.name}-${currentVersion}.zip`
          : `${skill.archivePrefix}-${skill.name}-${currentVersion}.zip`
      const currentArchive = join(currentRoot, currentArchiveName)
      const upstreamBase =
        skill.archivePrefix === 'gitnexus' ? gitnexusDirectory : superpowersDirectory
      const upstreamDirectory = join(resolve(upstreamBase), skill.upstreamRoot, skill.name)
      const stage = join(workRoot, skill.name)
      const oldDirectory = join(workRoot, `${skill.name}-old`)
      await mkdir(stage, { recursive: true })
      await run('unzip', ['-q', currentArchive, '-d', oldDirectory])
      await cp(oldDirectory, stage, { recursive: true })
      await cp(upstreamDirectory, stage, { recursive: true, force: true })
      await normalizeTree(stage)

      const archivePath = join(outputRoot, archiveName)
      await rm(archivePath, { force: true })
      await run('zip', ['-X', '-q', '-r', archivePath, '.'], { cwd: stage })
      await run('unzip', ['-tq', archivePath])
      const stats = await fileStatAndHash(archivePath)
      entries.push({
        id: `skill.${artifactName}`,
        type: 'skill',
        name: artifactName,
        version,
        platform: 'any',
        arch: 'any',
        url: `skills/${artifactName}/${archiveName}`,
        sha256: stats.sha256,
        size: stats.size,
        archive: { format: 'zip', skillRoot: '.' },
        dependencies: [],
        fallbackUrls: [],
        notes: `Synced from ${skill.archivePrefix === 'gitnexus' ? 'abhigyanpatwari/GitNexus' : 'obra/superpowers'} at ${skill.archivePrefix === 'gitnexus' ? gitnexusCommit : superpowersCommit}; existing Spark-specific files were preserved unless replaced by the upstream path.`,
      })
      console.log(`[skill] prepared ${skill.name}: ${stats.size} bytes ${stats.sha256}`)
    }

    const manifestPath = join(outputRoot, `skill-release-${version}.json`)
    await writeFile(manifestPath, `${JSON.stringify(entries, null, 2)}\n`)
    return { entries, manifestPath, outputDirectory: outputRoot }
  } finally {
    await rm(workRoot, { recursive: true, force: true })
  }
}

async function normalizeTree(root) {
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name)
      const stats = await lstat(absolutePath)
      if (stats.isSymbolicLink())
        throw new Error(`Skill contains a symbolic link: ${relative(root, absolutePath)}`)
      if (stats.isDirectory()) await visit(absolutePath)
      else if (!stats.isFile())
        throw new Error(`Skill contains an unsupported entry: ${relative(root, absolutePath)}`)
      await utimes(absolutePath, NORMALIZED_TIME, NORMALIZED_TIME)
    }
  }
  await visit(root)
  await utimes(root, NORMALIZED_TIME, NORMALIZED_TIME)
}

function fileStatAndHash(filePath) {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash('sha256')
    let size = 0
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => {
      size += chunk.length
      hash.update(chunk)
    })
    stream.on('error', rejectHash)
    stream.on('end', () => resolveHash({ size, sha256: hash.digest('hex') }))
  })
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options })
    child.on('error', rejectRun)
    child.on('exit', (code) => {
      if (code === 0) resolveRun()
      else rejectRun(new Error(`${command} failed with exit code ${code ?? 'unknown'}`))
    })
  })
}

function assertVersion(version) {
  if (!/^\d{4}\.\d{2}\.\d{2}$/.test(version))
    throw new Error(`Invalid Skill release version: ${version}`)
}

async function main() {
  const version = process.argv[2] || '2026.08.21'
  const currentArchiveDirectory = process.argv[3] || '/private/tmp/spark-skill-audit-U9uodT'
  const outputDirectory = process.argv[4] || `/private/tmp/spark-skill-release-${version}`
  const result = await prepareSkillArtifacts({
    version,
    currentArchiveDirectory,
    outputDirectory,
    gitnexusDirectory: process.argv[5] || '/private/tmp/spark-upstream-gitnexus',
    superpowersDirectory: process.argv[6] || '/private/tmp/spark-upstream-superpowers',
    gitnexusCommit: process.argv[7] || 'aac7515d2a8c50a1f8f923c6fb77218b333560d6',
    superpowersCommit: process.argv[8] || 'b36e0829c6d0140e93cfef2ca599b1b07d4a7797',
    currentVersion: process.argv[9] || '2026.07.07',
  })
  console.log(
    JSON.stringify(
      { manifest: basename(result.manifestPath), artifacts: result.entries.length },
      null,
      2,
    ),
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main()
