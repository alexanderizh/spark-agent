#!/usr/bin/env node

import { access, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { OptionalCapabilityManager } from '../apps/desktop/src/main/services/optional-capabilities/OptionalCapabilityManager.js'
import { DepthFrameEstimator } from '../apps/desktop/src/main/services/depth-video/DepthFrameEstimator.js'

const userDataDir = resolve(process.argv[2] || '')
if (!process.argv[2])
  throw new Error(
    'Usage: pnpm --filter @spark/desktop exec vite-node ../../scripts/smoke-optional-capabilities.mts <new-user-data-dir>',
  )
await access(userDataDir).then(
  () => {
    throw new Error(`Smoke userData directory already exists: ${userDataDir}`)
  },
  () => undefined,
)

let lastProgressKey = ''
const manager = new OptionalCapabilityManager({
  userDataDir,
  platform: 'darwin',
  arch: 'arm64',
  onProgress(progress) {
    const key = `${progress.capabilityId}:${progress.phase}`
    if (key === lastProgressKey && progress.percent !== 100) return
    lastProgressKey = key
    process.stderr.write(
      `[optional-smoke] capability=${progress.capabilityId} phase=${progress.phase} percent=${progress.percent}\n`,
    )
  },
})

const initial = await manager.list()
assertState(initial.capabilities, 'office-viewer', 'missing')
assertState(initial.capabilities, 'local-depth', 'missing')

const officeInstall = await manager.install('office-viewer')
if (!officeInstall.success) throw new Error(officeInstall.message)
const depthInstall = await manager.install('local-depth')
if (!depthInstall.success) throw new Error(depthInstall.message)

const officeDir = await manager.getArtifactDirectory(
  'office-viewer',
  'archive.optional-office-viewer-',
)
const runtimeDir = await manager.getArtifactDirectory('local-depth', 'runtime.optional-depth-')
const modelDir = await manager.getArtifactDirectory(
  'local-depth',
  'model.depth-anything-v2-small-int8-',
)
if (!officeDir || !runtimeDir || !modelDir) throw new Error('安装成功后制品目录缺失')

const officeEntries = [
  'vendor/docx/docx.worker.js',
  'vendor/docx/jszip.min.js',
  'vendor/xlsx/sheet.worker.js',
  'vendor/pptx/pptx.worker.js',
  'vendor/ppt/ppt-native.wasm',
  'vendor/ppt/ppt-font-cjk.otf',
]
await Promise.all(officeEntries.map((entry) => access(join(officeDir, entry))))

const runtimeEntryPath = join(
  runtimeDir,
  'node_modules',
  '@huggingface',
  'transformers',
  'src',
  'transformers.js',
)
const estimator = new DepthFrameEstimator({ modelDir, runtimeEntryPath })
const estimate = await estimator.estimate({
  width: 8,
  height: 8,
  rgb: Uint8Array.from({ length: 8 * 8 * 3 }, (_, index) => (index * 17) % 256),
})
if (estimate.values.length !== 64 || estimate.width !== 8 || estimate.height !== 8) {
  throw new Error(`深度推理尺寸不正确: ${estimate.width}x${estimate.height}`)
}

const finalSnapshot = await manager.check(true)
assertState(finalSnapshot.capabilities, 'office-viewer', 'ready')
assertState(finalSnapshot.capabilities, 'local-depth', 'ready')
const officeManifest = JSON.parse(
  await readFile(join(officeDir, 'capability-package.json'), 'utf8'),
)
const runtimeManifest = JSON.parse(
  await readFile(join(runtimeDir, 'capability-package.json'), 'utf8'),
)

console.log(
  JSON.stringify(
    {
      userDataDir,
      capabilities: finalSnapshot.capabilities.map((capability) => ({
        id: capability.id,
        state: capability.state,
        installedVersion: capability.installedVersion,
        installedSize: capability.installedSize,
      })),
      officeArtifactId: officeManifest.artifactId,
      officeRequiredEntries: officeEntries.length,
      runtimeArtifactId: runtimeManifest.artifactId,
      runtimePackages: runtimeManifest.packages,
      depthEstimate: {
        width: estimate.width,
        height: estimate.height,
        values: estimate.values.length,
        min: Math.min(...estimate.values),
        max: Math.max(...estimate.values),
      },
    },
    null,
    2,
  ),
)

function assertState(
  capabilities: Array<{ id: string; state: string }>,
  id: string,
  expected: string,
): void {
  const capability = capabilities.find((item) => item.id === id)
  if (capability?.state !== expected) {
    throw new Error(`${id} 状态应为 ${expected}，实际为 ${capability?.state ?? 'missing-item'}`)
  }
}
