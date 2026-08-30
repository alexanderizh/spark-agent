/**
 * 平台托管目录的 git 忽略治理（best-effort）。
 * 详见 workspace-git-ignore.mjs 头部说明；仅用于平台自动产生的临时产物目录。
 */
export function ensureWorkspaceManagedDirIgnored(
  workspaceRoot: string,
  directorySegments: readonly string[],
): void
