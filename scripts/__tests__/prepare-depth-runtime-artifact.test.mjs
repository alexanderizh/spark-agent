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
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...manifest }))
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
    { version: '4.2.0', dependencies: { 'onnxruntime-node': '1.24.3', 'onnxruntime-web': '1.0.0' } },
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
      'bin/napi-v6/darwin/arm64/onnxruntime_binding.node': 'darwin',
      'bin/napi-v6/linux/x64/onnxruntime_binding.node': 'linux',
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
  await assert.rejects(
    access(join(result.packageDirectory, 'node_modules/onnxruntime-web')),
  )
  const packageManifest = JSON.parse(await readFile(result.packageManifestPath, 'utf8'))
  assert.equal(
    packageManifest.runtimeEntry,
    'node_modules/@huggingface/transformers/src/transformers.js',
  )
  assert.equal(packageManifest.packages['onnxruntime-web'], undefined)
  const patchedOnnxBackend = await readFile(
    join(
      result.packageDirectory,
      'node_modules/@huggingface/transformers/src/backends/onnx.js',
    ),
    'utf8',
  )
  assert.doesNotMatch(patchedOnnxBackend, /from ['"]onnxruntime-web\/webgpu['"]/)
})
