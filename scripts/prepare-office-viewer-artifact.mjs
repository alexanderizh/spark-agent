#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, lstat, mkdir, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'

export const OFFICE_VIEWER_CAPABILITY_ID = 'office-viewer'
export const OFFICE_VIEWER_UPSTREAM_VERSION = '2.3.0'
const NORMALIZED_TIME = new Date('2000-01-01T00:00:00.000Z')

export async function prepareOfficeViewerArtifact(sourceDirectory, outputDirectory, options = {}) {
  const version = options.version ?? `${OFFICE_VIEWER_UPSTREAM_VERSION}-1`
  assertVersion(version)
  const source = resolve(sourceDirectory)
  const output = resolve(outputDirectory)
  const packageDirectory = join(output, 'package')
  await rm(packageDirectory, { recursive: true, force: true })
  await mkdir(packageDirectory, { recursive: true })

  const sourceFiles = await collectRegularFiles(source)
  if (sourceFiles.length === 0) throw new Error('Office Viewer source directory is empty')
  const files = {}
  for (const relativePath of sourceFiles) {
    const sourcePath = safeJoin(source, relativePath)
    const destination = safeJoin(packageDirectory, relativePath)
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(sourcePath, destination)
    await utimes(destination, NORMALIZED_TIME, NORMALIZED_TIME)
    files[relativePath] = await sha256File(destination)
  }

  const artifactId = `archive.optional-office-viewer-${version}`
  const packageManifest = {
    schemaVersion: 1,
    capabilityId: OFFICE_VIEWER_CAPABILITY_ID,
    artifactId,
    version,
    upstream: {
      package: '@file-viewer/web',
      version: OFFICE_VIEWER_UPSTREAM_VERSION,
      license: 'Apache-2.0',
    },
    files,
  }
  const packageManifestPath = join(packageDirectory, 'capability-package.json')
  await writeFile(packageManifestPath, `${JSON.stringify(packageManifest, null, 2)}\n`)
  await utimes(packageManifestPath, NORMALIZED_TIME, NORMALIZED_TIME)
  await normalizeDirectories(packageDirectory)

  const archiveName = `office-viewer-${version}.tar.gz`
  const tarPath = join(output, `office-viewer-${version}.tar`)
  const archivePath = join(output, archiveName)
  await rm(tarPath, { force: true })
  await rm(archivePath, { force: true })
  const archiveFiles = ['capability-package.json', ...sourceFiles].sort()
  await run('tar', ['-cf', tarPath, '-C', packageDirectory, ...archiveFiles])
  await run('gzip', ['-n', '-9', '-f', tarPath])

  const entry = {
    id: artifactId,
    type: 'archive',
    name: `Offline Office Viewer ${version}`,
    version,
    platform: 'any',
    arch: 'any',
    url: `dependencies/office-viewer/${archiveName}`,
    sha256: await sha256File(archivePath),
    size: (await stat(archivePath)).size,
    archive: { format: 'tar.gz', contentRoot: '.' },
    notes:
      'Optional offline assets for @file-viewer/react, including workers, WASM, fonts and static render resources; Apache-2.0 and bundled third-party licenses.',
  }
  const releaseManifestPath = join(output, `office-viewer-${version}-manifest.json`)
  await writeFile(releaseManifestPath, `${JSON.stringify(entry, null, 2)}\n`)
  return { archivePath, entry, packageManifestPath, releaseManifestPath }
}

async function collectRegularFiles(root) {
  const files = []
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name)
      const relativePath = relative(root, absolutePath).split(sep).join('/')
      const stats = await lstat(absolutePath)
      if (stats.isSymbolicLink()) {
        throw new Error(`Office Viewer source contains a symbolic link: ${relativePath}`)
      }
      if (stats.isDirectory()) await visit(absolutePath)
      else if (stats.isFile()) files.push(relativePath)
      else throw new Error(`Office Viewer source contains an unsupported entry: ${relativePath}`)
    }
  }
  await visit(root)
  return files.sort()
}

async function normalizeDirectories(root) {
  const directories = [root]
  for (let index = 0; index < directories.length; index += 1) {
    const directory = directories[index]
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) directories.push(join(directory, entry.name))
    }
  }
  for (const directory of directories.reverse()) {
    await utimes(directory, NORMALIZED_TIME, NORMALIZED_TIME)
  }
}

function safeJoin(root, relativePath) {
  const target = resolve(root, relativePath)
  if (!target.startsWith(resolve(root) + sep)) {
    throw new Error(`Unsafe Office Viewer path: ${relativePath}`)
  }
  return target
}

function sha256File(filePath) {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', rejectHash)
    stream.on('end', () => resolveHash(hash.digest('hex')))
  })
}

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: 'inherit' })
    child.on('error', rejectRun)
    child.on('exit', (code) => {
      if (code === 0) resolveRun()
      else rejectRun(new Error(`${command} failed with exit code ${code ?? 'unknown'}`))
    })
  })
}

function assertVersion(version) {
  if (!/^\d+\.\d+\.\d+-\d+$/.test(version)) {
    throw new Error(`Invalid Office Viewer artifact version: ${version}`)
  }
}

async function main() {
  const version = process.argv[2] || `${OFFICE_VIEWER_UPSTREAM_VERSION}-1`
  const source = resolve(process.argv[3] || 'apps/desktop/public/file-viewer')
  const output = resolve(process.argv[4] || `/private/tmp/spark-office-viewer-${version}`)
  const result = await prepareOfficeViewerArtifact(source, output, { version })
  console.log(
    JSON.stringify({
      archive: basename(result.archivePath),
      size: result.entry.size,
      sha256: result.entry.sha256,
      releaseManifest: basename(result.releaseManifestPath),
    }),
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main()
}
