/**
 * @module skill-registry/artifact-manifest
 *
 * Spark 自建安装源 manifest（默认托管在 MinIO）。
 * 用于国内/企业内网弱网场景下优先下载技能包、运行时安装包和离线依赖包。
 */

import { DEFAULT_SPARK_INSTALL_MANIFEST_URL } from './installable-catalog.js'

export type SparkInstallArtifactType =
  | 'skill'
  | 'runtime'
  | 'python-wheelhouse'
  | 'npm-store'
  | 'archive'
  | 'binary'

export interface SparkInstallArtifact {
  id: string
  type: SparkInstallArtifactType
  name: string
  version: string
  url: string
  sha256?: string
  size?: number
  platform?: 'any' | 'darwin' | 'linux' | 'win32'
  arch?: 'any' | 'x64' | 'arm64'
  archive?: {
    format: 'zip' | 'tar.gz'
    /** 技能目录在归档解压后的相对路径；"." 表示归档根目录 */
    skillRoot?: string
    /**
     * 归档解压后的有效内容子目录（仅 binary/archive 类型使用）。
     * 例如 gyan.dev 的 Windows ffmpeg zip 解压后有 `bin/` 子目录，
     * 设为 "bin" 后只会把 `bin/` 下的文件复制到目标目录。
     * 缺省时取归档根目录。
     */
    contentRoot?: string
  }
  dependencies?: string[]
  fallbackUrls?: string[]
  notes?: string
}

export interface SparkInstallManifest {
  schemaVersion: number
  updatedAt: string
  baseUrl?: string
  recommendedSkills?: Array<{
    slug: string
    artifactId: string
  }>
  artifacts: SparkInstallArtifact[]
}

export async function fetchSparkInstallManifest(
  manifestUrl = DEFAULT_SPARK_INSTALL_MANIFEST_URL,
): Promise<SparkInstallManifest> {
  const res = await fetch(manifestUrl, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Spark-Agent',
    },
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) {
    throw new Error(`Spark install manifest download failed: ${res.status} ${res.statusText}`)
  }
  const manifest = (await res.json()) as Partial<SparkInstallManifest>
  if (!Array.isArray(manifest.artifacts)) {
    throw new Error('Spark install manifest is invalid: artifacts must be an array')
  }
  return {
    schemaVersion: Number(manifest.schemaVersion ?? 1),
    updatedAt: String(manifest.updatedAt ?? ''),
    ...(typeof manifest.baseUrl === 'string' ? { baseUrl: manifest.baseUrl } : {}),
    ...(Array.isArray(manifest.recommendedSkills)
      ? {
          recommendedSkills: manifest.recommendedSkills.filter(
            (item): item is { slug: string; artifactId: string } =>
              typeof item?.slug === 'string' && typeof item?.artifactId === 'string',
          ),
        }
      : {}),
    artifacts: manifest.artifacts,
  }
}

export function findSparkInstallArtifact(
  manifest: SparkInstallManifest,
  artifactId: string,
): SparkInstallArtifact {
  const artifact = manifest.artifacts.find((item) => item.id === artifactId)
  if (!artifact) {
    throw new Error(`Spark install artifact not found in manifest: ${artifactId}`)
  }
  if (!artifact.url) {
    throw new Error(`Spark install artifact has no url: ${artifactId}`)
  }
  return artifact
}

export function resolveArtifactUrl(
  manifest: SparkInstallManifest,
  artifact: SparkInstallArtifact,
): string {
  return resolveArtifactUrlString(manifest, artifact.url)
}

export function resolveArtifactUrlString(manifest: SparkInstallManifest, url: string): string {
  if (/^https?:\/\//i.test(url)) return url
  const base = (
    manifest.baseUrl || DEFAULT_SPARK_INSTALL_MANIFEST_URL.replace(/\/[^/]*$/, '')
  ).replace(/\/+$/, '')
  return `${base}/${url.replace(/^\/+/, '')}`
}
