/**
 * 安全策略模块
 *
 * 职责：
 *   - CSP 策略管理（在 HTML meta 中已配置基础 CSP，此处管理运行时安全策略）
 *   - 文件路径边界检查（Agent 访问的文件必须在 workspace root 内）
 *   - 权限策略执行（在 P2-03 完整实现）
 *   - 危险操作审计日志
 */

/**
 * 检查文件路径是否在 workspace 根目录内
 *
 * @param filePath - 待检查的文件路径（绝对路径）
 * @param workspaceRoot - workspace 根目录（绝对路径）
 * @returns 是否在 workspace 边界内
 *
 * @example
 * isWithinWorkspace('/project/src/index.ts', '/project') // true
 * isWithinWorkspace('/etc/passwd', '/project') // false
 */
export function isWithinWorkspace(filePath: string, workspaceRoot: string): boolean {
  const normalized = filePath.normalize()
  const root = workspaceRoot.normalize()

  // 防止路径遍历攻击：确保文件路径以 workspace root 开头
  return normalized.startsWith(root + '/') || normalized === root
}
