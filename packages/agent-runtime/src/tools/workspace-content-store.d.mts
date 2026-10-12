/**
 * workspace-content-store.mjs 的类型声明（对齐 tool-result-artifact-store.d.mts 惯例）。
 * 原语语义：可信目录段白名单、符号链接/逃逸防御、wx 独占创建、0600 权限。
 */

export interface TrustedWorkspaceDirectory {
  root: string
  directory: string
}

export interface ContentAddressedWorkspaceFile {
  path: string
  relativePath: string
  sha256: string
  bytes: number
  reused: boolean
}

export interface ResolvedContentAddressedFile {
  root: string
  directory: string
  path: string
  relativePath: string
  extension: string
  bytes: number
}

export function resolveWorkspaceRoot(workspaceRoot: string): string
export function ensureTrustedWorkspaceDirectory(
  workspaceRoot: string,
  directorySegments: string[],
): TrustedWorkspaceDirectory
export function resolveTrustedWorkspaceDirectory(
  workspaceRoot: string,
  directorySegments: string[],
): TrustedWorkspaceDirectory | null
export function writeContentAddressedWorkspaceFile(params: {
  workspaceRoot: string
  directorySegments: string[]
  content: string
  extension: string
  maxBytes?: number
  label?: string
}): ContentAddressedWorkspaceFile
export function resolveContentAddressedWorkspaceFile(params: {
  workspaceRoot: string
  directorySegments: string[]
  artifactId: string
  extensions: string[]
}): ResolvedContentAddressedFile | null
export function assertInsideWorkspace(workspaceRoot: string, candidate: string): void
