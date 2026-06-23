/**
 * Canvas 项目路径校验工具
 *
 * 把「target 是否严格位于 root 之下」从 IPC 注册文件抽出为纯函数，单独测，
 * 避免 IPC 文件因 import electron 而无法在 Node vitest 环境直接加载。
 *
 * 这层校验是 canvas:project:delete 删除磁盘文件夹前的唯一守卫，必须稳健：
 *   - 防止 root_path 被篡改 / 迁移残留时误删用户其他目录
 *   - 拒绝根目录自身（删根会一次性干掉所有项目）
 *   - 拒绝跨卷路径（Windows 盘符不同时 path.relative 会返回绝对路径）
 */
import path from 'node:path'

export function isPathStrictlyInsideRoot(
  target: string | null | undefined,
  root: string,
): boolean {
  const trimmed = target?.trim()
  if (!trimmed) return false
  const resolvedTarget = path.resolve(trimmed)
  const resolvedRoot = path.resolve(root)
  if (resolvedTarget === resolvedRoot) return false
  const rel = path.relative(resolvedRoot, resolvedTarget)
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel)
}
