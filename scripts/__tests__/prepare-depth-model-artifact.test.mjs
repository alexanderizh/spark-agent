import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { prepareDepthModelArtifact } from '../prepare-depth-model-artifact.mjs'

test('builds a verified depth model package with the required files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'spark-depth-artifact-test-'))
  const sourceDir = join(root, 'source')
  const outputDir = join(root, 'output')
  await mkdir(join(sourceDir, 'onnx'), { recursive: true })
  await Promise.all([
    writeFile(join(sourceDir, 'config.json'), '{"model_type":"depth_anything"}\n'),
    writeFile(join(sourceDir, 'preprocessor_config.json'), '{"size":518}\n'),
    writeFile(join(sourceDir, 'onnx', 'model_int8.onnx'), 'fixture-onnx'),
    writeFile(join(sourceDir, 'LICENSE'), 'Apache License 2.0 fixture\n'),
  ])

  const result = await prepareDepthModelArtifact(sourceDir, outputDir, { version: '1.0.0' })

  assert.deepEqual(result.files, [
    'LICENSE',
    'config.json',
    'model-package.json',
    'onnx/model_int8.onnx',
    'preprocessor_config.json',
  ])
  assert.match(result.entry.sha256, /^[a-f0-9]{64}$/)
  assert.ok(result.entry.size > 0)
  assert.equal(result.entry.type, 'model')
  assert.equal(result.entry.id, 'model.depth-anything-v2-small-int8-1.0.0')

  const packageJson = JSON.parse(await readFile(result.packageManifestPath, 'utf8'))
  assert.equal(packageJson.modelId, 'depth-anything-v2-small-int8')
  assert.deepEqual(Object.keys(packageJson.files).sort(), [
    'LICENSE',
    'config.json',
    'onnx/model_int8.onnx',
    'preprocessor_config.json',
  ])
  for (const hash of Object.values(packageJson.files)) assert.match(hash, /^[a-f0-9]{64}$/)
})
