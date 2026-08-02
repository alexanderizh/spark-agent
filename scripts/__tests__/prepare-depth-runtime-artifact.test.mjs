import assert from 'node:assert/strict'
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { prepareDepthRuntimeArtifact } from '../prepare-depth-runtime-artifact.mjs'

const roots = []
test.afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function writePackage(nodeModules, name, manifest, files = {}) {
  const directory = join(nodeModules, ...name.split('/'))
  await mkdir(directory, { recursive: true })
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({ name, version: '1.0.0', ...manifest }),
  )
  for (const [relativePath, content] of Object.entries(files)) {
    const path = join(directory, relativePath)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, content)
  }
}

test('packages the Node depth dependency closure for only the target platform', async () => {
  const root = await mkdtemp(join(tmpdir(), 'spark-depth-runtime-'))
  roots.push(root)
  const nodeModules = join(root, 'node_modules')
  await writePackage(
    nodeModules,
    '@huggingface/transformers',
    {
      version: '4.2.0',
      dependencies: { 'onnxruntime-node': '1.24.3', 'onnxruntime-web': '1.0.0' },
    },
    {
      'src/transformers.js': 'export const pipeline = () => {}',
      'src/backends/onnx.js': [
        "import * as ONNX_NODE from 'onnxruntime-node';",
        "import * as ONNX_WEB from 'onnxruntime-web/webgpu';",
        'export const ONNX = process.versions.node ? ONNX_NODE : ONNX_WEB;',
      ].join('\n'),
    },
  )
  await writePackage(
    nodeModules,
    'onnxruntime-node',
    { version: '1.24.3', dependencies: { 'onnxruntime-common': '1.24.3' } },
    {
      'bin/napi-v6/darwin/arm64/libonnxruntime.1.24.3.dylib': 'darwin-library',
      'bin/napi-v6/darwin/arm64/onnxruntime_binding.node': 'darwin',
      'bin/napi-v6/linux/x64/onnxruntime_binding.node': 'linux',
      'bin/napi-v6/win32/x64/onnxruntime.dll': 'windows-library',
      'bin/napi-v6/win32/x64/onnxruntime_binding.node': 'windows',
    },
  )
  await writePackage(nodeModules, 'onnxruntime-common', { version: '1.24.3' })
  await writePackage(
    nodeModules,
    'onnxruntime-web',
    {
      version: '1.0.0',
      exports: { './webgpu': { import: './dist/ort.webgpu.bundle.min.mjs' } },
    },
    {
      'dist/ort.webgpu.bundle.min.mjs': 'export const env = {}',
      'dist/ort-wasm-simd-threaded.wasm': 'unused wasm',
    },
  )

  const result = await prepareDepthRuntimeArtifact(nodeModules, join(root, 'output'), {
    platform: 'darwin',
    arch: 'arm64',
    revision: 1,
  })

  assert.equal(
    result.entry.id,
    'runtime.optional-depth-transformers-4.2.0-onnx-1.24.3-1-darwin-arm64',
  )
  await access(
    join(
      result.packageDirectory,
      'node_modules/onnxruntime-node/bin/napi-v6/darwin/arm64/onnxruntime_binding.node',
    ),
  )
  await assert.rejects(
    access(join(result.packageDirectory, 'node_modules/onnxruntime-node/bin/napi-v6/linux')),
  )
  await assert.rejects(access(join(result.packageDirectory, 'node_modules/onnxruntime-web')))
  const packageManifest = JSON.parse(await readFile(result.packageManifestPath, 'utf8'))
  assert.equal(
    packageManifest.runtimeEntry,
    'node_modules/@huggingface/transformers/src/transformers.js',
  )
  assert.equal(packageManifest.packages['onnxruntime-web'], undefined)
  const patchedOnnxBackend = await readFile(
    join(result.packageDirectory, 'node_modules/@huggingface/transformers/src/backends/onnx.js'),
    'utf8',
  )
  assert.doesNotMatch(patchedOnnxBackend, /from ['"]onnxruntime-web\/webgpu['"]/)

  await assert.rejects(
    prepareDepthRuntimeArtifact(nodeModules, join(root, 'signed-output'), {
      platform: 'darwin',
      arch: 'arm64',
      revision: 2,
      requireCodesign: true,
    }),
    /requires DEPTH_RUNTIME_CODESIGN_IDENTITY/,
  )

  const commands = []
  const signedResult = await prepareDepthRuntimeArtifact(nodeModules, join(root, 'signed-output'), {
    platform: 'darwin',
    arch: 'arm64',
    revision: 2,
    codesignIdentity: 'Developer ID Application: Spark (CCUUJZC28D)',
    expectedTeamId: 'CCUUJZC28D',
    requireCodesign: true,
    runCommand: async (command, args) => commands.push([command, ...args]),
    captureCommand: async () => 'TeamIdentifier=CCUUJZC28D\n',
  })
  const signedManifest = JSON.parse(await readFile(signedResult.packageManifestPath, 'utf8'))
  assert.equal(signedManifest.signingTeamId, 'CCUUJZC28D')
  const signTargets = commands.filter((args) => args.includes('--sign')).map((args) => args.at(-1))
  assert.equal(signTargets.length, 2)
  assert.match(signTargets[0], /libonnxruntime\.1\.24\.3\.dylib$/)
  assert.match(signTargets[1], /onnxruntime_binding\.node$/)

  await assert.rejects(
    prepareDepthRuntimeArtifact(nodeModules, join(root, 'unsigned-windows-output'), {
      platform: 'win32',
      arch: 'x64',
      revision: 2,
      requireWindowsCodesign: true,
    }),
    /requires sign tool, certificate, and certificate password/,
  )

  const windowsCommands = []
  const windowsResult = await prepareDepthRuntimeArtifact(
    nodeModules,
    join(root, 'windows-output'),
    {
      platform: 'win32',
      arch: 'x64',
      revision: 2,
      windowsSignTool: 'signtool.exe',
      windowsCertificate: 'spark-signing.pfx',
      windowsCertificatePassword: 'test-password',
      requireWindowsCodesign: true,
      runCommand: async (command, args) => windowsCommands.push([command, ...args]),
    },
  )
  const windowsManifest = JSON.parse(await readFile(windowsResult.packageManifestPath, 'utf8'))
  assert.equal(windowsManifest.authenticodeSigned, true)
  assert.equal(windowsResult.entry.platform, 'win32')
  assert.equal(windowsResult.entry.arch, 'x64')
  const windowsSignTargets = windowsCommands
    .filter((args) => args.includes('sign'))
    .map((args) => args.at(-1))
  assert.equal(windowsSignTargets.length, 2)
  assert.match(windowsSignTargets[0], /onnxruntime\.dll$/)
  assert.match(windowsSignTargets[1], /onnxruntime_binding\.node$/)
})
