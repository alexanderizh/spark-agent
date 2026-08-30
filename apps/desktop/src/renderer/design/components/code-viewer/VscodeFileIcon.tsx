/**
 * vscode-icons 文件/文件夹图标。
 *
 * 基于 vscode-icons-js 的扩展名/文件名映射，从 public/icons/vscode/ 按需加载彩色 SVG。
 * - 深色主题下优先使用「非 light」变体（笔触更亮，深色背景更清晰）；
 * - 加载失败沿候选链回退，最终落到 default_file / default_folder；
 * - 仅依赖文件/文件夹名做映射（后缀或全文匹配），与节点路径无关。
 */
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import {
  DEFAULT_FILE,
  DEFAULT_FOLDER,
  DEFAULT_FOLDER_OPENED,
  getIconForFile,
  getIconForFolder,
  getIconForOpenFolder,
} from 'vscode-icons-js'
import { useResolvedTheme } from '../../hooks/useResolvedTheme'

export type VscodeIconKind = 'file' | 'folder'

export interface VscodeFileIconProps {
  /** 文件或文件夹名（仅 name，非完整路径；映射依据 name 的后缀/全文） */
  name: string
  kind: VscodeIconKind
  /** 目录是否展开（展开态使用 _opened 变体） */
  open?: boolean
  size?: number
  className?: string
}

// 用 document.baseURI 解析图标 URL（与 officeViewerOptions 一致）：
// - dev：http://localhost:PORT/ → 相对解析出 /icons/vscode/...
// - prod：file:///.../renderer/index.html → 相对解析到 renderer 同级 icons 目录
// 绝对前缀 `/icons/...` 在 file:// 加载下会落到文件系统根导致 404。
const iconBaseUrl = typeof document === 'undefined' ? 'http://localhost/' : document.baseURI

export function VscodeFileIcon({
  name,
  kind,
  open = false,
  size = 14,
  className,
}: VscodeFileIconProps): ReactNode {
  const theme = useResolvedTheme()
  const isDark = theme === 'dark'

  // 计算候选 iconId 链：[深色优先非light?, vscode-icons-js 原始 id, default]
  const candidates = useMemo<string[]>(() => {
    const baseId =
      kind === 'file'
        ? (getIconForFile(name) ?? DEFAULT_FILE)
        : open
          ? getIconForOpenFolder(name)
          : getIconForFolder(name)
    const list: string[] = []
    // 深色背景优先非 light 变体（file_type_light_json → file_type_json）
    if (isDark && baseId.includes('_light_')) {
      list.push(baseId.replace('_light_', '_'))
    }
    list.push(baseId)
    list.push(kind === 'file' ? DEFAULT_FILE : open ? DEFAULT_FOLDER_OPENED : DEFAULT_FOLDER)
    return Array.from(new Set(list))
  }, [name, kind, open, isDark])

  const [missIndex, setMissIndex] = useState(0)
  const [prevCandidates, setPrevCandidates] = useState(candidates)
  // 候选链变化（切换文件/主题）时重置回退位置（render 期派生状态，避免 effect 级联渲染）
  if (candidates !== prevCandidates) {
    setPrevCandidates(candidates)
    setMissIndex(0)
  }

  const iconId = candidates[Math.min(missIndex, candidates.length - 1)] ?? DEFAULT_FILE

  return (
    <img
      className={className}
      src={new URL(`icons/vscode/${iconId}`, iconBaseUrl).toString()}
      alt=""
      aria-hidden="true"
      draggable={false}
      width={size}
      height={size}
      style={{ width: size, height: size, objectFit: 'contain', pointerEvents: 'none' }}
      onError={() => setMissIndex((i) => Math.min(i + 1, candidates.length - 1))}
    />
  )
}
