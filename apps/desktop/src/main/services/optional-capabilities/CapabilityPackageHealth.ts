import type { OptionalCapabilityId } from '@spark/protocol'

export interface CapabilityArtifactIdentity {
  id: string
  type: string
  version: string
  platform?: string | null | undefined
  arch?: string | null | undefined
}

const DEPTH_RUNTIME_ENTRY =
  'node_modules/@huggingface/transformers/src/transformers.js'

const OFFICE_REQUIRED_FILES = [
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
] as const

const DEPTH_MODEL_REQUIRED_FILES = [
  'LICENSE',
  'config.json',
  'onnx/model_int8.onnx',
  'preprocessor_config.json',
] as const

type PackageManifest = Record<string, unknown> & {
  files?: unknown
  runtimeEntry?: unknown
  platform?: unknown
  arch?: unknown
  packages?: unknown
  modelId?: unknown
}

export function validateCapabilityPackageHealth(
  capabilityId: OptionalCapabilityId,
  artifact: CapabilityArtifactIdentity,
  manifest: PackageManifest,
): void {
  const files = readFileHashes(artifact.id, manifest.files)
  if (capabilityId === 'office-viewer') {
    if (!artifact.id.startsWith('archive.optional-office-viewer-')) {
      throw new Error(`${artifact.id} 不是受支持的 Office Viewer 制品`)
    }
    assertRequiredFiles(artifact.id, files, OFFICE_REQUIRED_FILES)
    return
  }

  if (artifact.id.startsWith('runtime.optional-depth-')) {
    validateDepthRuntimeHealth(artifact, manifest, files)
    return
  }
  if (artifact.id.startsWith('model.depth-anything-v2-small-int8-')) {
    validateDepthModelHealth(artifact, manifest, files)
    return
  }
  throw new Error(`${artifact.id} 不是受支持的本地深度制品`)
}

function validateDepthRuntimeHealth(
  artifact: CapabilityArtifactIdentity,
  manifest: PackageManifest,
  files: Record<string, string>,
): void {
  if (manifest.runtimeEntry !== DEPTH_RUNTIME_ENTRY) {
    throw new Error(`${artifact.id} Runtime 入口不匹配`)
  }
  if (manifest.platform !== artifact.platform || manifest.arch !== artifact.arch) {
    throw new Error(`${artifact.id} Runtime 平台或架构不匹配`)
  }
  const packages = readStringRecord(artifact.id, 'packages', manifest.packages)
  for (const packageName of ['@huggingface/transformers', 'onnxruntime-node']) {
    if (!packages[packageName]) {
      throw new Error(`${artifact.id} Runtime 缺少依赖版本：${packageName}`)
    }
  }
  if (packages['onnxruntime-web']) {
    throw new Error(`${artifact.id} Runtime 不得包含 onnxruntime-web`)
  }
  assertRequiredFiles(artifact.id, files, [
    DEPTH_RUNTIME_ENTRY,
    'node_modules/@huggingface/transformers/package.json',
    'node_modules/onnxruntime-node/package.json',
  ])

  if (typeof artifact.platform !== 'string' || typeof artifact.arch !== 'string') {
    throw new Error(`${artifact.id} Runtime 缺少目标平台或架构`)
  }
  const nativeRoot = `node_modules/onnxruntime-node/bin/napi-v6/${artifact.platform}/${artifact.arch}/`
  assertRequiredFiles(artifact.id, files, [`${nativeRoot}onnxruntime_binding.node`])
  const runtimeLibraryPattern =
    artifact.platform === 'darwin'
      ? /\.dylib$/
      : artifact.platform === 'linux'
        ? /\.so(?:\.\d+)*$/
        : /\.dll$/i
  if (!Object.keys(files).some((path) => path.startsWith(nativeRoot) && runtimeLibraryPattern.test(path))) {
    throw new Error(`${artifact.id} Runtime 缺少目标平台原生动态库`)
  }
  for (const path of Object.keys(files)) {
    if (path.includes('/onnxruntime-web/')) {
      throw new Error(`${artifact.id} Runtime 不得包含 onnxruntime-web 文件`)
    }
    const nativePrefix = 'node_modules/onnxruntime-node/bin/napi-v6/'
    if (path.startsWith(nativePrefix) && !path.startsWith(nativeRoot)) {
      throw new Error(`${artifact.id} Runtime 包含异平台原生文件：${path}`)
    }
  }
}

function validateDepthModelHealth(
  artifact: CapabilityArtifactIdentity,
  manifest: PackageManifest,
  files: Record<string, string>,
): void {
  if (manifest.modelId !== 'depth-anything-v2-small-int8') {
    throw new Error(`${artifact.id} 模型身份不匹配`)
  }
  assertRequiredFiles(artifact.id, files, DEPTH_MODEL_REQUIRED_FILES)
}

function readFileHashes(artifactId: string, value: unknown): Record<string, string> {
  const files = readStringRecord(artifactId, 'files', value)
  for (const [path, hash] of Object.entries(files)) {
    if (!path || !/^[0-9a-f]{64}$/i.test(hash)) {
      throw new Error(`${artifactId} 包内文件哈希无效：${path}`)
    }
  }
  return files
}

function readStringRecord(
  artifactId: string,
  field: string,
  value: unknown,
): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${artifactId} 包内 manifest 缺少 ${field}`)
  }
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') {
      throw new Error(`${artifactId} 包内 manifest 的 ${field}.${key} 无效`)
    }
    result[key] = item
  }
  return result
}

function assertRequiredFiles(
  artifactId: string,
  files: Record<string, string>,
  requiredFiles: readonly string[],
): void {
  for (const path of requiredFiles) {
    if (!Object.hasOwn(files, path)) {
      throw new Error(`${artifactId} 缺少必需文件哈希：${path}`)
    }
  }
}
