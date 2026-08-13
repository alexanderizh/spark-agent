/**
 * 路径安全守卫（纯函数，零运行时依赖）。
 *
 * 从 registerFileOperationsIpc 抽出，便于单测覆盖核心安全逻辑。
 * 仅依赖 node:path —— 词法层面的越界检测；canonical（symlink 逃逸）校验仍由
 * isSafeFilePathAllowed 在 handler 层完成。
 */

import path from 'node:path'

/**
 * 把相对 workspace root 的 posix 路径解析为绝对路径，并校验词法落在 root 内。
 * 拒绝：空路径、`../` 越界、跨盘绝对路径、解析后等于 root 本身（防误操作整个工作区）。
 * 越界时抛 Error，由调用方 catch 转成 response.error。
 */
export function resolveInsideRoot(rootPath: string, relPath: string): string {
  if (!relPath || typeof relPath !== 'string') {
    throw new Error('路径不能为空')
  }
  // posix 分隔符 → 当前平台；path.normalize 处理 ../、./、重复分隔符
  const platformRel = relPath.split('/').join(path.sep)
  const abs = path.resolve(rootPath, platformRel)
  const rel = path.relative(rootPath, abs)
  // rel === ''  → abs === root（禁止操作根目录本身）
  // rel 以 '..' 开头 → 逃出 root
  // rel 为绝对路径 → 跨盘（Windows 盘符）
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('路径超出工作区范围')
  }
  return abs
}

/**
 * toAbs 是否落在 fromAbs 之内（含自身）。
 * 用于禁止把目录移入/复制进自身或其子目录（move 会自嵌套死循环，copy 会无限递归）。
 */
export function isPathNestedIn(fromAbs: string, toAbs: string): boolean {
  const rel = path.relative(fromAbs, toAbs)
  // rel === '' → 同一路径；不以 '..' 开头且非绝对 → to 在 from 之内
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}
