/**
 * 移动桥接附件白名单的路径判定（纯函数，零依赖，便于单测）。
 *
 * 使用方：registerMobileBridgeIpc 的附件读取/提交链路——小程序经中继
 * 只能读取「粘贴图目录 ∪ 已注册工作区根」内的文件，其余一律拒绝。
 * 规范化前缀比对防 ../ 逃逸；symlink 由调用方在构建白名单根时做
 * realpathSync 归一、在异步读取时补一层 realpath 复核（本函数保持
 * 同步纯函数，不做 IO）。
 */

import path from 'node:path'

/** 候选路径是否落在任一白名单根内（相等或为其子路径） */
export function isPathWithinRoots(candidate: string, roots: string[]): boolean {
  // 空串/空白串直接拒绝：path.resolve('') 会落到进程 cwd，dev 模式下
  // cwd 可能恰好是注册工作区根，放行空路径附件属于意外面
  if (typeof candidate !== 'string' || candidate.trim().length === 0) return false
  const resolved = path.resolve(candidate)
  // Windows 目录大小写不敏感（NTFS 默认），两侧折叠后比对；
  // POSIX 大小写敏感，折叠反而会误放行 A/a 兄弟目录，保持原拼写
  const fold = path.sep === '\\' ? (s: string): string => s.toLowerCase() : (s: string): string => s
  return roots.some((root) => {
    if (typeof root !== 'string' || root.length === 0) return false
    const normalized = fold(path.resolve(root))
    const candidateFolded = fold(resolved)
    return candidateFolded === normalized || candidateFolded.startsWith(normalized + path.sep)
  })
}
