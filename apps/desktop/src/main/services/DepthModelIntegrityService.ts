import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import {
  fetchSparkInstallManifest,
  resolveArtifactUrl,
  resolveArtifactUrlString,
} from '../../../../../packages/agent-runtime/src/services/skill-registry/artifact-manifest.js'
import { installBinaryArchive } from '../../../../../packages/agent-runtime/src/services/skill-registry/tarball-installer.js'

export const DEPTH_MODEL_PACKAGE_ID = 'depth-anything-v2-small-int8'
export const DEPTH_MODEL_ARTIFACT_ID = 'model.depth-anything-v2-small-int8-1.0.0'

type DepthModelPackage = {
  schemaVersion: 1
  modelId: string
  version: string
  files: Record<string, string>
}

export type DepthModelIntegrityState =
  | { state: 'missing'; modelDir: string }
  | { state: 'ready'; version: string; modelDir: string }
  | { state: 'error'; modelDir: string; error: string }

export type DepthModelIntegrityServiceOptions = {
  userDataDir: string
  fetchManifest?: typeof fetchSparkInstallManifest
  installArchive?: typeof installBinaryArchive
}

const REQUIRED_FILES = [
  'config.json',
  'preprocessor_config.json',
  'onnx/model_int8.onnx',
  'LICENSE',
] as const

export class DepthModelIntegrityService {
  readonly modelDir: string
  private readonly fetchManifest: typeof fetchSparkInstallManifest
  private readonly installArchive: typeof installBinaryArchive
  private installPromise: Promise<Extract<DepthModelIntegrityState, { state: 'ready' }>> | null =
    null

  constructor(options: DepthModelIntegrityServiceOptions) {
    this.modelDir = join(options.userDataDir, 'models', DEPTH_MODEL_PACKAGE_ID)
    this.fetchManifest = options.fetchManifest ?? fetchSparkInstallManifest
    this.installArchive = options.installArchive ?? installBinaryArchive
  }

  async inspect(): Promise<DepthModelIntegrityState> {
    const packagePath = join(this.modelDir, 'model-package.json')
    try {
      await access(packagePath)
    } catch {
      return { state: 'missing', modelDir: this.modelDir }
    }

    try {
      const packageJson = JSON.parse(
        await readFile(packagePath, 'utf8'),
      ) as Partial<DepthModelPackage>
      if (
        packageJson.schemaVersion !== 1 ||
        packageJson.modelId !== DEPTH_MODEL_PACKAGE_ID ||
        typeof packageJson.version !== 'string' ||
        !packageJson.files ||
        typeof packageJson.files !== 'object'
      ) {
        throw new Error('model-package.json 格式无效')
      }

      for (const relativePath of REQUIRED_FILES) {
        const expectedHash = packageJson.files[relativePath]
        if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/i.test(expectedHash)) {
          throw new Error(`模型包缺少文件哈希：${relativePath}`)
        }
        const filePath = safeModelFilePath(this.modelDir, relativePath)
        const actualHash = await sha256File(filePath)
        if (actualHash !== expectedHash.toLowerCase()) {
          throw new Error(`模型文件 SHA-256 校验失败：${relativePath}`)
        }
      }

      return { state: 'ready', version: packageJson.version, modelDir: this.modelDir }
    } catch (error) {
      return {
        state: 'error',
        modelDir: this.modelDir,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async install(
    onProgress?: (downloaded: number, total: number) => void,
  ): Promise<Extract<DepthModelIntegrityState, { state: 'ready' }>> {
    const current = await this.inspect()
    if (current.state === 'ready') return current
    if (this.installPromise) return this.installPromise

    this.installPromise = this.installModel(onProgress).finally(() => {
      this.installPromise = null
    })
    return this.installPromise
  }

  private async installModel(
    onProgress?: (downloaded: number, total: number) => void,
  ): Promise<Extract<DepthModelIntegrityState, { state: 'ready' }>> {
    const manifest = await this.fetchManifest()
    const artifact = manifest.artifacts.find(
      (candidate) =>
        candidate.type === 'model' && candidate.id === DEPTH_MODEL_ARTIFACT_ID,
    )
    if (!artifact) {
      throw new Error(`Spark 制品仓库缺少受支持的深度模型：${DEPTH_MODEL_ARTIFACT_ID}`)
    }
    if (!artifact.sha256 || !/^[a-f0-9]{64}$/i.test(artifact.sha256)) {
      throw new Error('深度模型制品缺少有效的归档 SHA-256')
    }
    if (!Number.isSafeInteger(artifact.size) || (artifact.size ?? 0) <= 0) {
      throw new Error('深度模型制品缺少有效的归档大小')
    }
    await this.installArchive({
      url: resolveArtifactUrl(manifest, artifact),
      ...(artifact.fallbackUrls?.length
        ? {
            fallbackUrls: artifact.fallbackUrls.map((url) =>
              resolveArtifactUrlString(manifest, url),
            ),
          }
        : {}),
      sha256: artifact.sha256,
      ...(artifact.archive?.format ? { format: artifact.archive.format } : {}),
      ...(artifact.archive?.contentRoot != null
        ? { contentRoot: artifact.archive.contentRoot }
        : {}),
      destDir: this.modelDir,
      ...(onProgress ? { onProgress } : {}),
    })
    const installed = await this.inspect()
    if (installed.state !== 'ready') {
      throw new Error(
        installed.state === 'error' ? installed.error : '模型归档安装完成但必需文件缺失',
      )
    }
    if (installed.version !== artifact.version) {
      throw new Error(
        `模型包版本与制品清单不一致：${installed.version} != ${artifact.version}`,
      )
    }
    return installed
  }
}

function safeModelFilePath(modelDir: string, relativePath: string): string {
  const root = resolve(modelDir)
  const filePath = resolve(root, relativePath)
  if (!filePath.startsWith(root + sep)) {
    throw new Error(`模型包包含不安全路径：${relativePath}`)
  }
  return filePath
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', resolvePromise)
    stream.on('error', reject)
  })
  return hash.digest('hex')
}
