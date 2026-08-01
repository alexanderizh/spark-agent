/* eslint-disable @typescript-eslint/no-require-imports -- packaged verifier is CommonJS */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const { verifyPackagedOnnxRuntime } =
  require('../../../../scripts/verify-packaged-onnx-runtime.js') as {
    verifyPackagedOnnxRuntime: (options: {
      resourcesPath: string
      platform: 'darwin' | 'linux' | 'win32'
      arch: 'arm64' | 'x64'
      listAsarFiles: (asarPath: string) => Promise<string[]>
      nativeRuntime?: 'target' | 'absent'
    }) => Promise<{
      target: string
      foreignEntries: string[]
      webRuntimePresent: boolean
    }>
  }

function writeNativeEntry(resourcesPath: string, entry: string): void {
  const file = join(
    resourcesPath,
    'app.asar.unpacked/node_modules/onnxruntime-node/bin/napi-v6',
    entry,
    'onnxruntime_binding.node',
  )
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, entry)
}

describe('verifyPackagedOnnxRuntime', () => {
  let root = ''

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('accepts a package with only the target native runtime', async () => {
    root = mkdtempSync(join(tmpdir(), 'spark-packaged-onnx-'))
    writeNativeEntry(root, 'darwin/arm64')

    await expect(
      verifyPackagedOnnxRuntime({
        resourcesPath: root,
        platform: 'darwin',
        arch: 'arm64',
        listAsarFiles: async () => ['/node_modules/@huggingface/transformers/package.json'],
      }),
    ).resolves.toEqual({
      target: 'darwin/arm64',
      foreignEntries: [],
      webRuntimePresent: false,
    })
  })

  it('rejects foreign native runtime directories', async () => {
    root = mkdtempSync(join(tmpdir(), 'spark-packaged-onnx-'))
    writeNativeEntry(root, 'darwin/arm64')
    writeNativeEntry(root, 'linux/x64')

    await expect(
      verifyPackagedOnnxRuntime({
        resourcesPath: root,
        platform: 'darwin',
        arch: 'arm64',
        listAsarFiles: async () => [],
      }),
    ).rejects.toThrow('foreign ONNX runtime entries: linux/x64')
  })

  it('rejects onnxruntime-web files in app.asar', async () => {
    root = mkdtempSync(join(tmpdir(), 'spark-packaged-onnx-'))
    writeNativeEntry(root, 'darwin/arm64')

    await expect(
      verifyPackagedOnnxRuntime({
        resourcesPath: root,
        platform: 'darwin',
        arch: 'arm64',
        listAsarFiles: async () => ['/node_modules/onnxruntime-web/dist/ort.js'],
      }),
    ).rejects.toThrow('onnxruntime-web is present in app.asar')
  })

  it('rejects stale foreign native entries in the ASAR header', async () => {
    root = mkdtempSync(join(tmpdir(), 'spark-packaged-onnx-'))
    writeNativeEntry(root, 'darwin/arm64')

    await expect(
      verifyPackagedOnnxRuntime({
        resourcesPath: root,
        platform: 'darwin',
        arch: 'arm64',
        listAsarFiles: async () => [
          '/node_modules/onnxruntime-node/bin/napi-v6/darwin/arm64/onnxruntime_binding.node',
          '/node_modules/onnxruntime-node/bin/napi-v6/linux/x64/onnxruntime_binding.node',
        ],
      }),
    ).rejects.toThrow('foreign ONNX runtime entries in app.asar: linux/x64')
  })

  it('rejects a stale same-platform foreign architecture in the ASAR header', async () => {
    root = mkdtempSync(join(tmpdir(), 'spark-packaged-onnx-'))
    writeNativeEntry(root, 'win32/x64')

    await expect(
      verifyPackagedOnnxRuntime({
        resourcesPath: root,
        platform: 'win32',
        arch: 'x64',
        listAsarFiles: async () => [
          '/node_modules/onnxruntime-node/bin/napi-v6/win32/x64/onnxruntime_binding.node',
          '/node_modules/onnxruntime-node/bin/napi-v6/win32/arm64/onnxruntime_binding.node',
        ],
      }),
    ).rejects.toThrow('foreign ONNX runtime entries in app.asar: win32/arm64')
  })

  it('accepts a fully externalized base package with no native ONNX runtime', async () => {
    root = mkdtempSync(join(tmpdir(), 'spark-packaged-onnx-'))

    await expect(
      verifyPackagedOnnxRuntime({
        resourcesPath: root,
        platform: 'darwin',
        arch: 'arm64',
        nativeRuntime: 'absent',
        listAsarFiles: async () => ['/node_modules/@spark/protocol/package.json'],
      }),
    ).resolves.toMatchObject({
      target: 'darwin/arm64',
      foreignEntries: [],
      webRuntimePresent: false,
    })
  })

  it('rejects unpacked native ONNX files when the runtime must be absent', async () => {
    root = mkdtempSync(join(tmpdir(), 'spark-packaged-onnx-'))
    mkdirSync(
      join(
        root,
        'app.asar.unpacked/node_modules/onnxruntime-node/bin/napi-v6/darwin/arm64',
      ),
      { recursive: true },
    )

    await expect(
      verifyPackagedOnnxRuntime({
        resourcesPath: root,
        platform: 'darwin',
        arch: 'arm64',
        nativeRuntime: 'absent',
        listAsarFiles: async () => [],
      }),
    ).rejects.toThrow('unexpected ONNX runtime entries: darwin/arm64')
  })

  it('rejects native ONNX files inside ASAR when the runtime must be absent', async () => {
    root = mkdtempSync(join(tmpdir(), 'spark-packaged-onnx-'))

    await expect(
      verifyPackagedOnnxRuntime({
        resourcesPath: root,
        platform: 'darwin',
        arch: 'arm64',
        nativeRuntime: 'absent',
        listAsarFiles: async () => [
          '/node_modules/onnxruntime-node/bin/napi-v6/darwin/arm64/onnxruntime_binding.node',
        ],
      }),
    ).rejects.toThrow('unexpected ONNX runtime entries in app.asar: darwin/arm64')
  })
})
