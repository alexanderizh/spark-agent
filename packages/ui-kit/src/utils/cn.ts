/**
 * className 合并工具
 *
 * 基于 clsx + tailwind-merge，智能合并 Tailwind CSS 类名：
 *   - 自动去重冲突类名（如 px-2 px-4 → px-4）
 *   - 支持条件类名（cn('base', condition && 'active')）
 *   - 支持数组/对象形式
 *
 * @example
 *   cn('px-2 py-1', 'px-4')           → 'py-1 px-4'
 *   cn('text-sm', isActive && 'font-bold') → 'text-sm font-bold' (when isActive)
 */

import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
