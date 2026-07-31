#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export const DEPTH_MODEL_ID = 'depth-anything-v2-small-int8'
export const DEPTH_MODEL_UPSTREAM = 'onnx-community/depth-anything-v2-small'
export const DEPTH_MODEL_REVISION = '4472b7362082ad9968fee890ca0f1e5aca36b93d'
export const DEPTH_MODEL_ONNX_SHA256 =
  '01aa7a23de3f4a0ee1a2bb9997e6918104c85a9f95dea46d27b9b3fb0c6b9001'

const REQUIRED_FILES = [
  'LICENSE',
  'config.json',
  'onnx/model_int8.onnx',
  'preprocessor_config.json',
]
const ARCHIVE_FILES = [
  'LICENSE',
  'config.json',
  'model-package.json',
  'onnx/model_int8.onnx',
  'preprocessor_config.json',
]
const NORMALIZED_TIME = new Date('2000-01-01T00:00:00.000Z')

export async function prepareDepthModelArtifact(
  sourceDirectory,
  outputDirectory,
  options = {},
) {
  const version = options.version ?? '1.0.0'
  assertVersion(version)
  const sourceDir = resolve(sourceDirectory)
  const outputDir = resolve(outputDirectory)
  const packageDir = join(outputDir, 'package')
  await rm(packageDir, { recursive: true, force: true })
  await mkdir(join(packageDir, 'onnx'), { recursive: true })

  for (const relativePath of REQUIRED_FILES) {
    const sourcePath = join(sourceDir, relativePath)
    await access(sourcePath)
    const fileStats = await stat(sourcePath)
    if (!fileStats.isFile() || fileStats.size === 0) {
      throw new Error(`模型源文件无效：${relativePath}`)
    }
    const destination = join(packageDir, relativePath)
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(sourcePath, destination)
  }
  JSON.parse(await readFile(join(packageDir, 'config.json'), 'utf8'))
  JSON.parse(await readFile(join(packageDir, 'preprocessor_config.json'), 'utf8'))

  const files = {}
  for (const relativePath of REQUIRED_FILES) {
    files[relativePath] = await sha256File(join(packageDir, relativePath))
  }
  const packageManifest = {
    schemaVersion: 1,
    modelId: DEPTH_MODEL_ID,
    version,
    upstream: {
      repository: DEPTH_MODEL_UPSTREAM,
      revision: DEPTH_MODEL_REVISION,
      license: 'Apache-2.0',
      licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0.txt',
    },
    files,
  }
  const packageManifestPath = join(packageDir, 'model-package.json')
  await writeFile(packageManifestPath, `${JSON.stringify(packageManifest, null, 2)}\n`)
  await normalizePackageTimes(packageDir)

  const archiveName = `${DEPTH_MODEL_ID}-${version}.tar.gz`
  const tarPath = join(outputDir, `${DEPTH_MODEL_ID}-${version}.tar`)
  const archivePath = join(outputDir, archiveName)
  await rm(tarPath, { force: true })
  await rm(archivePath, { force: true })
  await run('tar', ['-cf', tarPath, '-C', packageDir, ...ARCHIVE_FILES])
  await run('gzip', ['-n', '-9', '-f', tarPath])

  const entry = {
    id: `model.${DEPTH_MODEL_ID}-${version}`,
    type: 'model',
    name: `Depth Anything V2 Small INT8 ${version}`,
    version,
    platform: 'any',
    arch: 'any',
    url: `dependencies/models/depth-anything-v2/${archiveName}`,
    sha256: await sha256File(archivePath),
    size: (await stat(archivePath)).size,
    archive: { format: 'tar.gz', contentRoot: '.' },
    notes:
      'Depth Anything V2 Small INT8 ONNX model for fully local canvas depth-video inference; Apache-2.0.',
  }
  const releaseManifestPath = join(outputDir, `${DEPTH_MODEL_ID}-${version}-manifest.json`)
  await writeFile(releaseManifestPath, `${JSON.stringify(entry, null, 2)}\n`)
  return {
    archivePath,
    entry,
    files: [...ARCHIVE_FILES],
    packageManifestPath,
    releaseManifestPath,
  }
}

async function downloadPinnedSource(destination) {
  const resolveBase = `https://huggingface.co/${DEPTH_MODEL_UPSTREAM}/resolve/${DEPTH_MODEL_REVISION}`
  const downloads = [
    ['config.json', `${resolveBase}/config.json`],
    ['preprocessor_config.json', `${resolveBase}/preprocessor_config.json`],
    ['onnx/model_int8.onnx', `${resolveBase}/onnx/model_int8.onnx`],
    ['LICENSE', 'https://www.apache.org/licenses/LICENSE-2.0.txt'],
  ]
  for (const [relativePath, url] of downloads) {
    const destinationPath = join(destination, relativePath)
    await mkdir(dirname(destinationPath), { recursive: true })
    console.log(`[depth-model] downloading ${relativePath}`)
    await download(url, destinationPath)
  }
  const onnxHash = await sha256File(join(destination, 'onnx/model_int8.onnx'))
  if (onnxHash !== DEPTH_MODEL_ONNX_SHA256) {
    throw new Error(`上游 INT8 ONNX SHA-256 不匹配：${onnxHash}`)
  }
}

async function normalizePackageTimes(packageDir) {
  for (const relativePath of ARCHIVE_FILES) {
    await utimes(join(packageDir, relativePath), NORMALIZED_TIME, NORMALIZED_TIME)
  }
  await utimes(join(packageDir, 'onnx'), NORMALIZED_TIME, NORMALIZED_TIME)
  await utimes(packageDir, NORMALIZED_TIME, NORMALIZED_TIME)
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} for ${url}`)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination))
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
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`无效的模型制品版本：${version}`)
  }
}

async function main() {
  const version = process.argv[2]
  if (!version) {
    console.error('Usage: node scripts/prepare-depth-model-artifact.mjs <version> [output-dir]')
    process.exitCode = 1
    return
  }
  assertVersion(version)
  const outputDir = resolve(
    process.argv[3] || `/private/tmp/spark-depth-model-${version}`,
  )
  const sourceDir = await mkdtemp(join(tmpdir(), 'spark-depth-model-source-'))
  try {
    await downloadPinnedSource(sourceDir)
    const result = await prepareDepthModelArtifact(sourceDir, outputDir, { version })
    console.log(
      JSON.stringify(
        {
          archive: basename(result.archivePath),
          size: result.entry.size,
          sha256: result.entry.sha256,
          releaseManifest: basename(result.releaseManifestPath),
          upstreamRevision: DEPTH_MODEL_REVISION,
        },
        null,
        2,
      ),
    )
  } finally {
    await rm(sourceDir, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main()
}
