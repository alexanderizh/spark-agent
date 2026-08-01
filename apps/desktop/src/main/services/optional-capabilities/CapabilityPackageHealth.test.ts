import { describe, expect, it } from 'vitest'
import type { SparkInstallArtifact } from '../../../../../../packages/agent-runtime/src/services/skill-registry/artifact-manifest'
import { validateCapabilityPackageHealth } from './CapabilityPackageHealth'

const hash = 'a'.repeat(64)

function artifact(overrides: Partial<SparkInstallArtifact>): SparkInstallArtifact {
  return {
    id: 'archive.optional-office-viewer-2.2.3-1',
    type: 'archive',
    name: 'Office Viewer',
    version: '2.2.3-1',
    platform: 'any',
    arch: 'any',
    url: 'https://example.invalid/office.tar.gz',
    sha256: hash,
    size: 1,
    archive: { format: 'tar.gz', contentRoot: '.' },
    ...overrides,
  }
}

function hashed(paths: string[]): Record<string, string> {
  return Object.fromEntries(paths.map((path) => [path, hash]))
}

describe('validateCapabilityPackageHealth', () => {
  it('requires every Office entry needed for DOCX, XLSX, PPT and PPTX previews', () => {
    expect(() =>
      validateCapabilityPackageHealth(
        'office-viewer',
        artifact({}),
        {
          files: hashed([
            'flyfish-viewer-manifest.json',
            'flyfish-viewer-assets.json',
            'vendor/docx/docx.worker.js',
            'vendor/docx/jszip.min.js',
            'vendor/xlsx/sheet.worker.js',
            'vendor/pptx/pptx.worker.js',
            'vendor/ppt/index.mjs',
            'vendor/ppt/worker.mjs',
            'vendor/ppt/frame-cache.mjs',
            'vendor/ppt/ppt-native.wasm',
            'vendor/ppt/ppt-font-cjk.otf',
            'vendor/ppt/manifest.json',
            'vendor/ppt/package.json',
            'vendor/ppt/LICENSE',
            'vendor/ppt/NOTICE',
          ]),
        },
      ),
    ).not.toThrow()

    expect(() =>
      validateCapabilityPackageHealth('office-viewer', artifact({}), {
        files: hashed(['vendor/docx/jszip.min.js']),
      }),
    ).toThrow('缺少必需文件哈希：flyfish-viewer-manifest.json')
  })

  it('requires the exact runtime entry, target native binding and runtime library', () => {
    const runtime = artifact({
      id: 'runtime.optional-depth-transformers-4.2.0-onnx-1.24.3-1-darwin-arm64',
      type: 'runtime',
      name: 'Depth Runtime',
      version: '4.2.0-1.24.3-1',
      platform: 'darwin',
      arch: 'arm64',
    })
    const runtimeEntry = 'node_modules/@huggingface/transformers/src/transformers.js'
    const nativeRoot = 'node_modules/onnxruntime-node/bin/napi-v6/darwin/arm64/'
    const manifest = {
      platform: 'darwin',
      arch: 'arm64',
      runtimeEntry,
      packages: {
        '@huggingface/transformers': '4.2.0',
        'onnxruntime-node': '1.24.3',
      },
      files: hashed([
        runtimeEntry,
        'node_modules/@huggingface/transformers/package.json',
        'node_modules/onnxruntime-node/package.json',
        `${nativeRoot}onnxruntime_binding.node`,
        `${nativeRoot}libonnxruntime.1.24.3.dylib`,
      ]),
    }

    expect(() => validateCapabilityPackageHealth('local-depth', runtime, manifest)).not.toThrow()
    expect(() =>
      validateCapabilityPackageHealth('local-depth', runtime, {
        ...manifest,
        runtimeEntry: '../outside.js',
      }),
    ).toThrow('Runtime 入口不匹配')
    expect(() =>
      validateCapabilityPackageHealth('local-depth', runtime, {
        ...manifest,
        files: hashed([runtimeEntry, `${nativeRoot}onnxruntime_binding.node`]),
      }),
    ).toThrow('缺少必需文件哈希')
  })

  it('requires model config, preprocessor, INT8 ONNX and license hashes', () => {
    const model = artifact({
      id: 'model.depth-anything-v2-small-int8-1.0.0',
      type: 'model',
      name: 'Depth Model',
      version: '1.0.0',
    })
    const required = [
      'LICENSE',
      'config.json',
      'onnx/model_int8.onnx',
      'preprocessor_config.json',
    ]
    expect(() =>
      validateCapabilityPackageHealth('local-depth', model, {
        modelId: 'depth-anything-v2-small-int8',
        files: hashed(required),
      }),
    ).not.toThrow()
    expect(() =>
      validateCapabilityPackageHealth('local-depth', model, {
        modelId: 'depth-anything-v2-small-int8',
        files: hashed(required.filter((path) => path !== 'LICENSE')),
      }),
    ).toThrow('缺少必需文件哈希：LICENSE')
  })
})
