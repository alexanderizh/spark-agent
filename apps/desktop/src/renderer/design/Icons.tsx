/**
 * Icons — Lucide-style inline SVG icon set (1.6 stroke, 24x24)
 * 移植自 design/icons.jsx，作为 React 组件供视图调用。
 */
import type { CSSProperties, ReactNode } from 'react'

type IconProps = {
  size?: number
  className?: string
  strokeWidth?: number
  style?: CSSProperties
  title?: string
}

const IconBase = ({
  children,
  size = 16,
  className = '',
  strokeWidth = 1.6,
  ...rest
}: IconProps & { children: ReactNode }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...rest}
  >
    {children}
  </svg>
)

export const Icons = {
  Home: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M3 11l9-8 9 8" />
      <path d="M5 10v10h14V10" />
    </IconBase>
  ),
  Bug: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M8 6a4 4 0 0 1 8 0" />
      <rect x="8" y="6" width="8" height="12" rx="4" />
      <path d="M12 10v6M3 9h3m12 0h3M3 14h3m12 0h3M4.5 5.5 7 8m12.5-2.5L17 8M4.5 18.5 7 16m12.5 2.5L17 16" />
    </IconBase>
  ),
  Chat: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.7-.8L3 21l1.9-5.3A8.4 8.4 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5z" />
    </IconBase>
  ),
  /** 新建会话/任务 — 对话气泡 + 加号 */
  MessageSquarePlus: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M12 7v6M9 10h6" />
    </IconBase>
  ),
  /** 对话气泡 — 用于表示一条现有会话 */
  MessageSquare: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </IconBase>
  ),
  Folder: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </IconBase>
  ),
  FolderClosed: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      <path d="M9 3h4l2 2" />
    </IconBase>
  ),
  FolderOpen: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H7.6a2 2 0 0 0-1.8 1.1L3 18.5V8z" />
      <path d="M3 18.5 5.8 12a2 2 0 0 1 1.8-1h13a1.4 1.4 0 0 1 1.3 1.9l-2 5A2 2 0 0 1 18 19H4.1a1.2 1.2 0 0 1-1.1-.5z" />
    </IconBase>
  ),
  FolderPlus: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      <path d="M12 10v6M9 13h6" />
    </IconBase>
  ),
  FolderX: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      <path d="M9.5 9.5l5 5M14.5 9.5l-5 5" />
    </IconBase>
  ),
  ProjectFolder: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v3.2" />
      <path d="M3 7v10a2 2 0 0 0 2 2h6.2" />
      <path d="M14 15v4" />
      <circle cx="14" cy="14" r="1.2" />
      <circle cx="14" cy="20" r="1.2" />
      <circle cx="20" cy="17" r="1.2" />
      <path d="M15.2 15.2 18.8 17 15.2 18.8" />
    </IconBase>
  ),
  Board: (p: IconProps) => (
    <IconBase {...p}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M8 7v7" />
      <path d="M12 7v4" />
      <path d="M16 7v9" />
    </IconBase>
  ),
  Canvas: (p: IconProps) => (
    <IconBase {...p}>
      <circle cx="12" cy="12" r="10" />
      <path d="m14.31 8 5.74 9.94" />
      <path d="M9.69 8h11.48" />
      <path d="m7.38 12 5.74-9.94" />
      <path d="M9.69 16 3.95 6.06" />
      <path d="M14.31 16H2.83" />
      <path d="m16.62 12-5.74 9.94" />
    </IconBase>
  ),
  Workflow: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="3" y="3" width="6" height="6" rx="1.5" />
      <rect x="15" y="3" width="6" height="6" rx="1.5" />
      <rect x="9" y="15" width="6" height="6" rx="1.5" />
      <path d="M6 9v3a2 2 0 0 0 2 2h4M18 9v3a2 2 0 0 1-2 2h-4M12 14v1" />
    </IconBase>
  ),
  Agents: (p: IconProps) => (
    <IconBase {...p}>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="14" r="2.5" />
      <path d="M3 19c0-2.8 2.7-5 6-5s6 2.2 6 5M15 19c0-1.7 1.3-3 3-3s3 1.3 3 3" />
    </IconBase>
  ),
  Skills: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M12 2l2.5 5 5.5.8-4 3.9 1 5.5L12 14.5 7 17.2l1-5.5L4 7.8 9.5 7 12 2z" />
    </IconBase>
  ),
  MCP: (p: IconProps) => (
    <IconBase {...p}>
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="M8 11l8-4M8 13l8 4" />
    </IconBase>
  ),
  Team: (p: IconProps) => (
    <IconBase {...p}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2 20c0-3 3.1-5.5 7-5.5s7 2.5 7 5.5" />
      <circle cx="17.5" cy="8.5" r="2.8" />
      <path d="M16 14.2c2.9 0 6 1.8 6 4.3" />
    </IconBase>
  ),
  Settings: (p: IconProps) => (
    <IconBase {...p}>
      <circle cx="12" cy="12" r="2.8" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .4 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </IconBase>
  ),
  GitHub: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M9 19c-4.5 1.4-4.5-2.5-6-3m12 6v-3.5a3 3 0 0 0-.9-2.4c3-.3 6.1-1.5 6.1-6.6A5.1 5.1 0 0 0 19 6.2 4.7 4.7 0 0 0 18.9 3S17.7 2.7 15 4.5a13.4 13.4 0 0 0-6 0C6.3 2.7 5.1 3 5.1 3A4.7 4.7 0 0 0 5 6.2a5.1 5.1 0 0 0-1.2 3.3c0 5.1 3.1 6.3 6.1 6.6A3 3 0 0 0 9 18.5V22" />
    </IconBase>
  ),
  Plus: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M12 5v14M5 12h14" />
    </IconBase>
  ),
  Minus: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M5 12h14" />
    </IconBase>
  ),
  X: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </IconBase>
  ),
  Search: (p: IconProps) => (
    <IconBase {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </IconBase>
  ),
  ChevronDown: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M6 9l6 6 6-6" />
    </IconBase>
  ),
  ChevronRight: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M9 6l6 6-6 6" />
    </IconBase>
  ),
  ChevronLeft: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M15 6l-6 6 6 6" />
    </IconBase>
  ),
  ChevronUp: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M6 15l6-6 6 6" />
    </IconBase>
  ),
  ArrowUp: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </IconBase>
  ),
  ArrowDown: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M12 5v14M5 12l7 7 7-7" />
    </IconBase>
  ),
  Send: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
    </IconBase>
  ),
  Mail: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </IconBase>
  ),
  Mic: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8" />
    </IconBase>
  ),
  Sparkles: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M12 3l1.5 4L17.5 8.5 13.5 10 12 14l-1.5-4L6.5 8.5 10.5 7 12 3z" />
      <path d="M19 14l.7 2 2 .7-2 .7L19 19.4 18.3 17.4l-2-.7 2-.7L19 14z" />
    </IconBase>
  ),
  Code: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M8 6l-6 6 6 6M16 6l6 6-6 6" />
    </IconBase>
  ),
  Terminal: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M4 17l6-6-6-6M12 19h8" />
    </IconBase>
  ),
  BashCommand: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <path d="M7.5 10l3 2-3 2M13.5 14h3" />
    </IconBase>
  ),
  File: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </IconBase>
  ),
  FilePlus: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M12 12v6M9 15h6" />
    </IconBase>
  ),
  FileMinus: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M9 15h6" />
    </IconBase>
  ),
  Image: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="10.5" r="1.5" />
      <path d="M21 17l-5.2-5.2a2 2 0 0 0-2.8 0L5 20" />
    </IconBase>
  ),
  ImagePlus: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M16 5h6" />
      <path d="M19 2v6" />
      <path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </IconBase>
  ),
  Brush: (p: IconProps) => (
    <IconBase {...p}>
      <path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08" />
      <path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z" />
    </IconBase>
  ),
  Wand: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M15 4V2" />
      <path d="M15 16v-2" />
      <path d="M8 9h2" />
      <path d="M20 9h2" />
      <path d="M17.8 11.8 19 13" />
      <path d="M17.8 6.2 19 5" />
      <path d="m3 21 9-9" />
      <path d="M12.2 6.2 11 5" />
    </IconBase>
  ),
  Film: (p: IconProps) => (
    <IconBase {...p}>
      <rect width="20" height="20" x="2" y="2" rx="2.18" />
      <path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5" />
    </IconBase>
  ),
  Video: (p: IconProps) => (
    <IconBase {...p}>
      <path d="m22 8-6 4 6 4V8Z" />
      <rect width="14" height="12" x="2" y="6" rx="2" ry="2" />
    </IconBase>
  ),
  Scissors: (p: IconProps) => (
    <IconBase {...p}>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="20" x2="8.12" y1="4" y2="15.88" />
      <line x1="14.47" x2="20" y1="14.48" y2="20" />
      <line x1="8.12" x2="12" y1="8.12" y2="12" />
    </IconBase>
  ),
  FileText: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" x2="8" y1="13" y2="13" />
      <line x1="16" x2="8" y1="17" y2="17" />
      <line x1="10" x2="8" y1="9" y2="9" />
    </IconBase>
  ),
  AudioLines: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M2 10v3" />
      <path d="M6 6v11" />
      <path d="M10 3v18" />
      <path d="M14 8v7" />
      <path d="M18 5v13" />
      <path d="M22 10v3" />
    </IconBase>
  ),
  Grid: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </IconBase>
  ),
  Combine: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M10 18H5a3 3 0 0 1-3-3v-1" />
      <path d="M14 2a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2" />
      <path d="M20 2a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2" />
      <path d="m7 21 3-3-3-3" />
      <rect x="14" y="14" width="8" height="8" rx="2" />
    </IconBase>
  ),
  HelpCircle: (p: IconProps) => (
    <IconBase {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01" />
    </IconBase>
  ),
  Check: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M5 12l5 5L20 7" />
    </IconBase>
  ),
  CheckSquare: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 12l2 2 4-4" />
    </IconBase>
  ),
  ListTodo: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="3" y="5" width="6" height="6" rx="1" />
      <path d="m3 17 2 2 4-4" />
      <path d="M13 6h8" />
      <path d="M13 12h8" />
      <path d="M13 18h8" />
    </IconBase>
  ),
  AlertTriangle: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </IconBase>
  ),
  Shield: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z" />
    </IconBase>
  ),
  Play: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M6 4l14 8-14 8z" fill="currentColor" stroke="none" />
    </IconBase>
  ),
  Pause: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" />
      <rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" />
    </IconBase>
  ),
  Stop: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="5" y="5" width="14" height="14" rx="1.5" fill="currentColor" stroke="none" />
    </IconBase>
  ),
  Refresh: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" />
    </IconBase>
  ),
  RotateCcw: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />
    </IconBase>
  ),
  /** 换一批 — 交叉箭头（随机重排） */
  Shuffle: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M3 6h3.5a3 3 0 0 1 2.4 1.2l6.2 7.6a3 3 0 0 0 2.4 1.2H21" />
      <path d="M3 18h3.5a3 3 0 0 0 2.4-1.2l6.2-7.6a3 3 0 0 1 2.4-1.2H21" />
      <path d="M18 4l3 2-3 2M18 16l3 2-3 2" />
    </IconBase>
  ),
  /** 历史还原 — 完整表盘 + 逆时针回溯箭头（时间 + 还原） */
  History: (p: IconProps) => (
    <IconBase {...p}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l2.5 1.5" />
      <path d="M4 12a8 8 0 0 1 6.5-7" />
      <path d="M4 7.5V4h3.5" />
    </IconBase>
  ),
  RotateCw: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5" />
    </IconBase>
  ),
  Branch: (p: IconProps) => (
    <IconBase {...p}>
      <circle cx="6" cy="4" r="2" />
      <circle cx="6" cy="20" r="2" />
      <circle cx="18" cy="6" r="2" />
      <path d="M6 6v12M18 8c0 4-12 4-12 8" />
    </IconBase>
  ),
  Download: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
    </IconBase>
  ),
  CloudDownload: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M12 13v8l-4-4" />
      <path d="m12 21 4-4" />
      <path d="M4.393 15.269A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.436 8.284" />
    </IconBase>
  ),
  Upload: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M12 21V9M7 14l5-5 5 5M5 3h14" />
    </IconBase>
  ),
  Package: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M16.5 9.4l-9-5.2M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <path d="M3.3 7l8.7 5 8.7-5M12 22V12" />
    </IconBase>
  ),
  ArrowLeft: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </IconBase>
  ),
  ExternalLink: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
    </IconBase>
  ),
  Globe: (p: IconProps) => (
    <IconBase {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </IconBase>
  ),
  Server: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="3" y="4" width="18" height="6" rx="1.5" />
      <rect x="3" y="14" width="18" height="6" rx="1.5" />
      <path d="M7 7h.01M7 17h.01" />
    </IconBase>
  ),
  Cpu: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <rect x="9" y="9" width="6" height="6" rx="0.5" />
      <path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3" />
    </IconBase>
  ),
  Database: (p: IconProps) => (
    <IconBase {...p}>
      <ellipse cx="12" cy="5" rx="8" ry="2.5" />
      <path d="M4 5v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5V5M4 11v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-6" />
    </IconBase>
  ),
  Brain: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M9 3a3 3 0 0 0-3 3v.5a3 3 0 0 0-2 5.7v.6a3 3 0 0 0 2 5.7V19a3 3 0 0 0 6 0V3a3 3 0 0 0-3 0z" />
      <path d="M15 3a3 3 0 0 1 3 3v.5a3 3 0 0 1 2 5.7v.6a3 3 0 0 1-2 5.7V19a3 3 0 0 1-6 0V3a3 3 0 0 1 3 0z" />
    </IconBase>
  ),
  Beaker: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M4.5 3h15M6 3v8.5L3 19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2l-3-7.5V3" />
    </IconBase>
  ),
  Zap: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
    </IconBase>
  ),
  Eye: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
      <circle cx="12" cy="12" r="3" />
    </IconBase>
  ),
  EyeOff: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </IconBase>
  ),
  MousePointer: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M4 3l7.5 17 2.2-7 6.3-2.8L4 3z" />
      <path d="M13.6 13.6l4.2 4.2" />
    </IconBase>
  ),
  Hand: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M8 11V6.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M11 10V5.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M14 10.5V7a1.5 1.5 0 0 1 3 0v6" />
      <path d="M8 11.5 6.6 10a1.7 1.7 0 0 0-2.4 2.4l4.8 5.2A6 6 0 0 0 13.4 20H14a6 6 0 0 0 6-6v-2a1.5 1.5 0 0 0-3 0" />
    </IconBase>
  ),
  Command: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M15 6V4a2 2 0 1 1 2 2h-2zM9 6V4a2 2 0 1 0-2 2h2zM15 18v2a2 2 0 1 0 2-2h-2zM9 18v2a2 2 0 1 1-2-2h2zM6 9H4a2 2 0 1 0 2 2V9zM18 9h2a2 2 0 1 1-2 2V9zM6 15H4a2 2 0 1 1 2-2v2zM18 15h2a2 2 0 1 0-2-2v2z" />
      <rect x="9" y="9" width="6" height="6" rx="0.5" />
    </IconBase>
  ),
  Filter: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M3 4h18l-7 9v6l-4 2v-8L3 4z" />
    </IconBase>
  ),
  Sliders: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M4 6h10M18 6h2M8 12h12M4 12h1M4 18h7M15 18h5" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="7" cy="12" r="2" />
      <circle cx="13" cy="18" r="2" />
    </IconBase>
  ),
  ListFilter: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M2 5h20" />
      <path d="M6 12h12" />
      <path d="M9 19h6" />
    </IconBase>
  ),
  Maximize: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
      <path d="M3 3l6 6M21 3l-6 6M3 21l6-6M21 21l-6-6" />
    </IconBase>
  ),
  Minimize: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" />
    </IconBase>
  ),
  // 输入框展开/折叠用的简约角标图标：仅两条线相交成直角（L 形）。
  // Expand：右上 + 左下两角朝外；Collapse：左上 + 右下两角尖相对、指向中心。
  ComposerExpand: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M16 3h5v5M8 21H3v-5" />
    </IconBase>
  ),
  ComposerCollapse: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M9 3v6H3M15 21v-6h6" />
    </IconBase>
  ),
  Bell: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M14 21a2 2 0 0 1-4 0" />
    </IconBase>
  ),
  Menu: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M3 6h18M3 12h18M3 18h18" />
    </IconBase>
  ),
  PanelLeft: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </IconBase>
  ),
  PanelRight: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M15 4v16" />
    </IconBase>
  ),
  SidebarHide: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M3 19V5" />
      <path d="m13 6-6 6 6 6" />
      <path d="M7 12h14" />
    </IconBase>
  ),
  SidebarShow: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M3 5v14" />
      <path d="M21 12H7" />
      <path d="m15 18 6-6-6-6" />
    </IconBase>
  ),
  More: (p: IconProps) => (
    <IconBase {...p}>
      <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </IconBase>
  ),
  Pin: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M6 4.5A2.5 2.5 0 0 1 8.5 2h7A2.5 2.5 0 0 1 18 4.5v17l-6-4-6 4v-17z" />
    </IconBase>
  ),
  PinFill: ({ size = 16, className = '', style }: IconProps) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      style={style}
    >
      <path d="M6 4.5A2.5 2.5 0 0 1 8.5 2h7A2.5 2.5 0 0 1 18 4.5v17l-6-4-6 4v-17z" />
    </svg>
  ),
  Star: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M12 2l3 7 7.5.8-5.6 5 1.6 7.4L12 18.5 5.5 22.2 7 14.8 1.5 9.8 9 9l3-7z" />
    </IconBase>
  ),
  Trash: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14M10 11v6M14 11v6" />
    </IconBase>
  ),
  CornerUpLeft: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M9 14L4 9l5-5" />
      <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
    </IconBase>
  ),
  Archive: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M21 8v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8M21 8H3M21 8l-2-4H5L3 8M10 12h4" />
    </IconBase>
  ),
  Copy: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </IconBase>
  ),
  Edit: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </IconBase>
  ),
  /** 标注工具集（与画布图片标注弹窗配套） */
  Square: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </IconBase>
  ),
  Circle: (p: IconProps) => (
    <IconBase {...p}>
      <circle cx="12" cy="12" r="8" />
    </IconBase>
  ),
  Crosshair: (p: IconProps) => (
    <IconBase {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 1v3M12 20v3M1 12h3M20 12h3" />
    </IconBase>
  ),
  ArrowUpRight: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M7 17 17 7M8 7h9v9" />
    </IconBase>
  ),
  ArrowRight: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M5 12h14M12 5l7 7-7 7" />
    </IconBase>
  ),
  Type: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M4 7V5h16v2M9 19h6M12 5v14" />
    </IconBase>
  ),
  Crop: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M6 2v14a2 2 0 0 0 2 2h14" />
      <path d="M18 22V8a2 2 0 0 0-2-2H2" />
    </IconBase>
  ),
  Pencil: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </IconBase>
  ),
  Eraser: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M7 21h-3a1 1 0 0 1-1-1v-3.6a1 1 0 0 1 .3-.7l9.5-9.5a2 2 0 0 1 2.8 0l3.5 3.5a2 2 0 0 1 0 2.8L13.4 21H7z" />
      <path d="M10 21l8-8" />
    </IconBase>
  ),
  Undo2: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h11a6 6 0 0 1 0 12h-3" />
    </IconBase>
  ),
  Redo2: (p: IconProps) => (
    <IconBase {...p}>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H9a6 6 0 0 0 0 12h3" />
    </IconBase>
  ),
  Pipette: (p: IconProps) => (
    <IconBase {...p}>
      <path d="m2 22 1-1h3l9-9" />
      <path d="M3 21v-3l9-9" />
      <path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3L12 9.1" />
    </IconBase>
  ),
  Lock: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="4" y="11" width="16" height="11" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </IconBase>
  ),
  GitBranch: (p: IconProps) => (
    <IconBase {...p}>
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <path d="M18 8.5a8 8 0 0 1-8 8" />
    </IconBase>
  ),
  Box: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.3 7L12 12l8.7-5M12 22V12" />
    </IconBase>
  ),
  Layers: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
    </IconBase>
  ),
  Map: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6zM9 3v15M15 6v15" />
    </IconBase>
  ),
  Activity: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </IconBase>
  ),
  Bot: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="5" y="7" width="14" height="12" rx="2" />
      <path d="M9 13h.01M15 13h.01M9 17h6M12 3v4M8 7l-2-3M16 7l2-3" />
    </IconBase>
  ),
  /** 简约机器人头 — 侧栏「助手」菜单等场景 */
  Assistant: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="5" y="7" width="14" height="13" rx="2.5" />
      <path d="M12 4v3" />
      <path d="M9 13v2" />
      <path d="M15 13v2" />
    </IconBase>
  ),
  User: (p: IconProps) => (
    <IconBase {...p}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
    </IconBase>
  ),
  Phone: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="6" y="2" width="12" height="20" rx="2" />
      <path d="M10 18h4" />
    </IconBase>
  ),
  Wrench: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M14.7 6.3a4.5 4.5 0 0 0-5.4 5.7l-6.6 6.6a2 2 0 0 0 2.8 2.8L12 14.8a4.5 4.5 0 0 0 5.7-5.4l-2.7 2.7-2.8-.7-.7-2.8 2.7-2.7z" />
    </IconBase>
  ),
  CheckCircle: (p: IconProps) => (
    <IconBase {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12l3 3 5-6" />
    </IconBase>
  ),
  XCircle: (p: IconProps) => (
    <IconBase {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </IconBase>
  ),
  Clock: (p: IconProps) => (
    <IconBase {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </IconBase>
  ),
  Wifi: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M2 8.5a18 18 0 0 1 20 0" />
      <path d="M6 12.5a10 10 0 0 1 12 0" />
      <path d="M10 16.5a3 3 0 0 1 4 0" />
      <circle cx="12" cy="20" r="1" fill="currentColor" stroke="none" />
    </IconBase>
  ),
  Hash: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18" />
    </IconBase>
  ),
  Rocket: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M5 13.5L3 17l3.5-2M14 5l5 5-9 9-5-5 9-9zM14 5c2-2 5-3 8-2-1 3-2 6-4 8M9 11l4 4" />
    </IconBase>
  ),
  Compass: (p: IconProps) => (
    <IconBase {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M16.2 7.8l-2.9 5.5-5.5 2.9 2.9-5.5 5.5-2.9z" />
    </IconBase>
  ),
  Spinner: ({ size = 16, className = '', style }: IconProps) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={`spin ${className}`}
      style={style}
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        opacity="0.2"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  ),
  Link: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M9 12a3 3 0 0 1 3-3h3a3 3 0 0 1 0 6h-1.5" />
      <path d="M15 12a3 3 0 0 1-3 3H9a3 3 0 0 1 0-6h1.5" />
    </IconBase>
  ),
  StarFill: ({ size = 16, className = '', style }: IconProps) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      style={style}
    >
      <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 18.9 6.1 22l1.2-6.5L2.5 9.4l6.6-.9L12 2.5z" />
    </svg>
  ),
  Users: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19" />
      <circle cx="10" cy="9" r="3" />
      <path d="M20 19v-1.5a3.5 3.5 0 0 0-2.6-3.4" />
      <path d="M15 5.6a3.5 3.5 0 0 1 0 6.8" />
    </IconBase>
  ),
  Book: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H18a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6.5A1.5 1.5 0 0 1 5 19.5" />
      <path d="M4 4.5A1.5 1.5 0 0 0 5.5 6H20" />
      <path d="M9 10h6M9 14h4" />
    </IconBase>
  ),
  Lightbulb: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M9 18h6" />
      <path d="M10 21h4" />
      <path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.3 1 2.5h6c0-1.2.3-1.8 1-2.5A6 6 0 0 0 12 3z" />
    </IconBase>
  ),
  Calendar: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="3" y="4.5" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 3v4M16 3v4" />
      <path d="M7.5 13h2M11 13h2M14.5 13h2M7.5 16.5h2M11 16.5h2" />
    </IconBase>
  ),

  // ─── Editor/IDE Brand Icons ─────────────────────────────────────────────
  VSCode: (p: IconProps) => (
    <IconBase {...p}>
      <path
        d="M16.5 2.5L21 7v10l-4.5 4.5-7-3.5v-8l7-3.5z"
        fill="#0098FF"
        stroke="none"
      />
      <path
        d="M3 18l4.5 3.5 7-3.5v-8l-7-3.5L3 10v8z"
        fill="#0078D4"
        stroke="none"
      />
      <path d="M7.5 6.5l7 3.5v8l-7-3.5v-8z" fill="#50E6FF" stroke="none" />
    </IconBase>
  ),

  Cursor: (p: IconProps) => (
    <IconBase {...p}>
      <circle cx="12" cy="12" r="9" fill="#000" stroke="none" />
      <path
        d="M8 8h3v3H8V8zm5 0h3v3h-3V8zm-5 5h3v3H8v-3zm5 0h3v3h-3v-3z"
        fill="#fff"
        stroke="none"
      />
    </IconBase>
  ),

  Zed: (p: IconProps) => (
    <IconBase {...p}>
      <path
        d="M4 4h16v16H4V4zm2 2v12h12V6H6zm2 2l8 4-8 4V8z"
        fill="#F5A623"
        stroke="none"
      />
    </IconBase>
  ),

  WebStorm: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2" fill="#000" stroke="none" />
      <path
        d="M7 7h4v2H9v6h2v2H7V7zm6 0h4v2h-2v6h2v2h-4V7z"
        fill="#fff"
        stroke="none"
      />
    </IconBase>
  ),

  Sublime: (p: IconProps) => (
    <IconBase {...p}>
      <path
        d="M4 6l16-2v14l-16 2V6z"
        fill="#FF9800"
        stroke="none"
      />
      <path d="M6 8l12-1.5v9L6 17V8z" fill="#fff" stroke="none" opacity="0.9" />
    </IconBase>
  ),

  Vim: (p: IconProps) => (
    <IconBase {...p}>
      <path
        d="M4 4h16v16H4V4zm2 2v12h3l2-4 2 4h3V6h-3v8l-2-4-2 4V6H6z"
        fill="#019733"
        stroke="none"
      />
    </IconBase>
  ),

  Neovim: (p: IconProps) => (
    <IconBase {...p}>
      <path
        d="M4 4l6 8v8l-6-4V4zm16 0v12l-6 4v-8l6-8z"
        fill="#57A143"
        stroke="none"
      />
      <path d="M10 12l6-8v12l-6 4V12z" fill="#3C8A2E" stroke="none" />
    </IconBase>
  ),

  Windsurf: (p: IconProps) => (
    <IconBase {...p}>
      <circle cx="12" cy="12" r="9" fill="#6366F1" stroke="none" />
      <path
        d="M8 12c0-2.2 1.8-4 4-4s4 1.8 4 4-1.8 4-4 4"
        fill="none"
        stroke="#fff"
        strokeWidth="2"
      />
      <circle cx="12" cy="12" r="2" fill="#fff" stroke="none" />
    </IconBase>
  ),

  Trae: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="3" y="3" width="18" height="18" rx="3" fill="#4A90D9" stroke="none" />
      <path
        d="M8 8h8l-4 8-4-8zm4 3l2-4h-4l2 4z"
        fill="#fff"
        stroke="none"
      />
    </IconBase>
  ),

  CodeBuddy: (p: IconProps) => (
    <IconBase {...p}>
      <circle cx="12" cy="12" r="9" fill="#7C3AED" stroke="none" />
      <path
        d="M8 10l3 3-3 3M13 16h4"
        fill="none"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </IconBase>
  ),

  Kiro: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2" fill="#FF9900" stroke="none" />
      <path
        d="M7 7h3l5 5-5 5H7l5-5-5-5zm7 0h3v10h-3V7z"
        fill="#fff"
        stroke="none"
      />
    </IconBase>
  ),

  Qoder: (p: IconProps) => (
    <IconBase {...p}>
      <circle cx="12" cy="12" r="9" fill="#10B981" stroke="none" />
      <path
        d="M8 12l3-4v8l-3-4zm8 0l-3-4v8l3-4z"
        fill="#fff"
        stroke="none"
      />
    </IconBase>
  ),

  IntelliJ: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2" fill="#000" stroke="none" />
      <path d="M7 7h10v2H7V7zm0 4h10v2H7v-2zm0 4h6v2H7v-2z" fill="#fff" stroke="none" />
      <path d="M16 15l3 3" stroke="#fff" strokeWidth="2" />
    </IconBase>
  ),

  PyCharm: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="3" y="3" width="18" height="18" rx="2" fill="#21D789" stroke="none" />
      <path d="M7 7h10v2H7V7zm0 4h10v2H7v-2zm0 4h6v2H7v-2z" fill="#fff" stroke="none" />
    </IconBase>
  ),

  // ─── Terminal Brand Icons ───────────────────────────────────────────────
  ITerm2: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" fill="#000" stroke="none" />
      <path d="M6 8l4 4-4 4" stroke="#fff" strokeWidth="1.5" fill="none" />
      <path d="M12 16h6" stroke="#fff" strokeWidth="1.5" />
    </IconBase>
  ),

  TerminalApp: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" fill="#1D1D1F" stroke="none" />
      <path d="M6 8l4 4-4 4" stroke="#fff" strokeWidth="1.5" fill="none" />
      <path d="M12 16h6" stroke="#fff" strokeWidth="1.5" />
    </IconBase>
  ),

  Warp: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" fill="#01A4FF" stroke="none" />
      <path d="M6 9h12M6 12h8M6 15h4" stroke="#fff" strokeWidth="1.5" />
    </IconBase>
  ),

  Alacritty: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" fill="#F5A623" stroke="none" />
      <path d="M6 8l4 4-4 4" stroke="#fff" strokeWidth="1.5" fill="none" />
      <path d="M12 16h6" stroke="#fff" strokeWidth="1.5" />
    </IconBase>
  ),

  Kitty: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" fill="#6C5CE7" stroke="none" />
      <path d="M6 8l4 4-4 4" stroke="#fff" strokeWidth="1.5" fill="none" />
      <path d="M12 16h6" stroke="#fff" strokeWidth="1.5" />
    </IconBase>
  ),

  Hyper: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" fill="#000" stroke="none" />
      <circle cx="7" cy="12" r="2" fill="#fff" stroke="none" />
      <path d="M11 10h7M11 14h5" stroke="#fff" strokeWidth="1.5" />
    </IconBase>
  ),

  Tabby: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" fill="#00BCD4" stroke="none" />
      <path d="M6 8l4 4-4 4" stroke="#fff" strokeWidth="1.5" fill="none" />
      <path d="M12 16h6" stroke="#fff" strokeWidth="1.5" />
    </IconBase>
  ),

  PowerShell: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" fill="#012456" stroke="none" />
      <path d="M6 8l5 4-5 4" stroke="#fff" strokeWidth="1.5" fill="none" />
      <path d="M14 16h4" stroke="#fff" strokeWidth="1.5" />
    </IconBase>
  ),

  WindowsTerminal: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" fill="#0C0C0C" stroke="none" />
      <rect x="5" y="6" width="5" height="4" rx="0.5" fill="#0179D4" stroke="none" />
      <rect x="11" y="6" width="5" height="4" rx="0.5" fill="#C63A6B" stroke="none" />
      <rect x="5" y="11" width="5" height="4" rx="0.5" fill="#50B23E" stroke="none" />
      <rect x="11" y="11" width="5" height="4" rx="0.5" fill="#FFB900" stroke="none" />
    </IconBase>
  ),

  GitBash: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" fill="#1A1A1A" stroke="none" />
      <path d="M6 8l4 4-4 4" stroke="#F05032" strokeWidth="1.5" fill="none" />
      <path d="M12 16h6" stroke="#F05032" strokeWidth="1.5" />
    </IconBase>
  ),

  Sun: (p: IconProps) => (
    <IconBase {...p}>
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </IconBase>
  ),
  Moon: (p: IconProps) => (
    <IconBase {...p}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
    </IconBase>
  ),
  Monitor: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="2" y="3" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 16v5" />
    </IconBase>
  ),

  CMD: (p: IconProps) => (
    <IconBase {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" fill="#0C0C0C" stroke="none" />
      <path d="M6 8l4 4-4 4" stroke="#C0C0C0" strokeWidth="1.5" fill="none" />
      <path d="M12 16h6" stroke="#C0C0C0" strokeWidth="1.5" />
    </IconBase>
  ),
}

// 注入 spinner 旋转动画样式（仅 1 次）
if (typeof document !== 'undefined' && !document.getElementById('spinner-css')) {
  const s = document.createElement('style')
  s.id = 'spinner-css'
  s.textContent = `.spin { animation: spin 0.9s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }`
  document.head.appendChild(s)
}
