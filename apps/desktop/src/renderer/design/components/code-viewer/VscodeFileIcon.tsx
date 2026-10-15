/**
 * 文件/文件夹图标。
 *
 * 设计规范（对齐主体「图标继承文字色阶」原则）：
 * - 文件夹：主体单色线性图标（Icons.Folder / FolderOpen），颜色继承文字色阶，
 *   不再使用 vscode-icons 的大面积彩色文件夹；
 * - 文件：保留 vscode-icons-js 彩色类型图标（.ts/.md/.json 等辨识度），按需从
 *   public/icons/vscode/ 加载，深色主题优先「非 light」变体，失败沿候选链回退；
 * - 仅依赖文件/文件夹名做映射（后缀或全文匹配），与节点路径无关。
 */
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { DEFAULT_FILE, getIconForFile } from 'vscode-icons-js'
import { Icons } from '../../Icons'
import { useResolvedTheme } from '../../hooks/useResolvedTheme'

export type VscodeIconKind = 'file' | 'folder'

export interface VscodeFileIconProps {
  /** 文件或文件夹名（仅 name，非完整路径；映射依据 name 的后缀/全文） */
  name: string
  kind: VscodeIconKind
  /** 目录是否展开（展开态使用 FolderOpen 线性图标） */
  open?: boolean
  size?: number
  className?: string
}

// 用 document.baseURI 解析图标 URL（与 officeViewerOptions 一致）：
// - dev：http://localhost:PORT/ → 相对解析出 /icons/vscode/...
// - prod：file:///.../renderer/index.html → 相对解析到 renderer 同级 icons 目录
// 绝对前缀 `/icons/...` 在 file:// 加载下会落到文件系统根导致 404。
const iconBaseUrl = typeof document === 'undefined' ? 'http://localhost/' : document.baseURI

// 分派器按 kind 路由到两个子组件：kind 翻转时 React 按不同组件类型整体重挂载，
// 两边各自的 hook 序列天然无条件一致（不能在同一组件里提前 return 绕过 hooks）。
export function VscodeFileIcon({
  name,
  kind,
  open = false,
  size = 14,
  className,
}: VscodeFileIconProps): ReactNode {
  if (kind === 'folder') {
    return <FolderIcon open={open} size={size} className={className} />
  }
  return <FileTypeIcon name={name} size={size} className={className} />
}

// 可选属性显式带 | undefined：exactOptionalPropertyTypes 下分派器解构出的
// 值可能是 undefined，需要允许显式传入（Pick 会保留「仅可省略」语义而报 TS2375）
interface FolderIconProps {
  open?: boolean | undefined
  size?: number | undefined
  className?: string | undefined
}

// 文件夹：单色线性图标，颜色继承文字色（fe-icon / gp-file-type-icon 容器色）
function FolderIcon({ open, size = 14, className }: FolderIconProps): ReactNode {
  const FolderGlyph = open ? Icons.FolderOpen : Icons.Folder
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        color: 'var(--icon, var(--text-muted))',
        pointerEvents: 'none',
      }}
    >
      <FolderGlyph size={size + 1} />
    </span>
  )
}

interface FileTypeIconProps {
  name: string
  size?: number | undefined
  className?: string | undefined
}

// 文件：vscode-icons 彩色类型图标，失败沿候选链回退
function FileTypeIcon({ name, size = 14, className }: FileTypeIconProps): ReactNode {
  const theme = useResolvedTheme()
  const isDark = theme === 'dark'

  // 候选 iconId 链：[深色优先非light?, vscode-icons-js 原始 id, default]
  const candidates = useMemo<string[]>(() => {
    const baseId = getIconForFile(name) ?? DEFAULT_FILE
    const list: string[] = []
    // 深色背景优先非 light 变体（file_type_light_json → file_type_json）
    if (isDark && baseId.includes('_light_')) {
      list.push(baseId.replace('_light_', '_'))
    }
    list.push(baseId)
    list.push(DEFAULT_FILE)
    return Array.from(new Set(list))
  }, [name, isDark])

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
