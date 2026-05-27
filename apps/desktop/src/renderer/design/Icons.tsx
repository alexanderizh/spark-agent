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
  Home: (p: IconProps) => <IconBase {...p}><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></IconBase>,
  Chat: (p: IconProps) => <IconBase {...p}><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.7-.8L3 21l1.9-5.3A8.4 8.4 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5z" /></IconBase>,
  Folder: (p: IconProps) => <IconBase {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /></IconBase>,
  Workflow: (p: IconProps) => <IconBase {...p}><rect x="3" y="3" width="6" height="6" rx="1.5" /><rect x="15" y="3" width="6" height="6" rx="1.5" /><rect x="9" y="15" width="6" height="6" rx="1.5" /><path d="M6 9v3a2 2 0 0 0 2 2h4M18 9v3a2 2 0 0 1-2 2h-4M12 14v1" /></IconBase>,
  Agents: (p: IconProps) => <IconBase {...p}><circle cx="9" cy="8" r="3" /><circle cx="17" cy="14" r="2.5" /><path d="M3 19c0-2.8 2.7-5 6-5s6 2.2 6 5M15 19c0-1.7 1.3-3 3-3s3 1.3 3 3" /></IconBase>,
  Skills: (p: IconProps) => <IconBase {...p}><path d="M12 2l2.5 5 5.5.8-4 3.9 1 5.5L12 14.5 7 17.2l1-5.5L4 7.8 9.5 7 12 2z" /></IconBase>,
  MCP: (p: IconProps) => <IconBase {...p}><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M8 11l8-4M8 13l8 4" /></IconBase>,
  Team: (p: IconProps) => <IconBase {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2 20c0-3 3.1-5.5 7-5.5s7 2.5 7 5.5" /><circle cx="17.5" cy="8.5" r="2.8" /><path d="M16 14.2c2.9 0 6 1.8 6 4.3" /></IconBase>,
  Settings: (p: IconProps) => <IconBase {...p}><circle cx="12" cy="12" r="2.8" /><path d="M19.4 15a1.7 1.7 0 0 0 .4 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></IconBase>,
  Plus: (p: IconProps) => <IconBase {...p}><path d="M12 5v14M5 12h14" /></IconBase>,
  X: (p: IconProps) => <IconBase {...p}><path d="M6 6l12 12M18 6L6 18" /></IconBase>,
  Search: (p: IconProps) => <IconBase {...p}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></IconBase>,
  ChevronDown: (p: IconProps) => <IconBase {...p}><path d="M6 9l6 6 6-6" /></IconBase>,
  ChevronRight: (p: IconProps) => <IconBase {...p}><path d="M9 6l6 6-6 6" /></IconBase>,
  ChevronLeft: (p: IconProps) => <IconBase {...p}><path d="M15 6l-6 6 6 6" /></IconBase>,
  ChevronUp: (p: IconProps) => <IconBase {...p}><path d="M6 15l6-6 6 6" /></IconBase>,
  ArrowUp: (p: IconProps) => <IconBase {...p}><path d="M12 19V5M5 12l7-7 7 7" /></IconBase>,
  Send: (p: IconProps) => <IconBase {...p}><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></IconBase>,
  Mic: (p: IconProps) => <IconBase {...p}><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8" /></IconBase>,
  Sparkles: (p: IconProps) => <IconBase {...p}><path d="M12 3l1.5 4L17.5 8.5 13.5 10 12 14l-1.5-4L6.5 8.5 10.5 7 12 3z" /><path d="M19 14l.7 2 2 .7-2 .7L19 19.4 18.3 17.4l-2-.7 2-.7L19 14z" /></IconBase>,
  Code: (p: IconProps) => <IconBase {...p}><path d="M8 6l-6 6 6 6M16 6l6 6-6 6" /></IconBase>,
  Terminal: (p: IconProps) => <IconBase {...p}><path d="M4 17l6-6-6-6M12 19h8" /></IconBase>,
  File: (p: IconProps) => <IconBase {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></IconBase>,
  Check: (p: IconProps) => <IconBase {...p}><path d="M5 12l5 5L20 7" /></IconBase>,
  AlertTriangle: (p: IconProps) => <IconBase {...p}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></IconBase>,
  Shield: (p: IconProps) => <IconBase {...p}><path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z" /></IconBase>,
  Play: (p: IconProps) => <IconBase {...p}><path d="M6 4l14 8-14 8z" fill="currentColor" stroke="none" /></IconBase>,
  Pause: (p: IconProps) => <IconBase {...p}><rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" /><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" /></IconBase>,
  Stop: (p: IconProps) => <IconBase {...p}><rect x="5" y="5" width="14" height="14" rx="1.5" fill="currentColor" stroke="none" /></IconBase>,
  Refresh: (p: IconProps) => <IconBase {...p}><path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" /></IconBase>,
  Branch: (p: IconProps) => <IconBase {...p}><circle cx="6" cy="4" r="2" /><circle cx="6" cy="20" r="2" /><circle cx="18" cy="6" r="2" /><path d="M6 6v12M18 8c0 4-12 4-12 8" /></IconBase>,
  Download: (p: IconProps) => <IconBase {...p}><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></IconBase>,
  Upload: (p: IconProps) => <IconBase {...p}><path d="M12 21V9M7 14l5-5 5 5M5 3h14" /></IconBase>,
  Package: (p: IconProps) => <IconBase {...p}><path d="M16.5 9.4l-9-5.2M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="M3.3 7l8.7 5 8.7-5M12 22V12" /></IconBase>,
  ArrowLeft: (p: IconProps) => <IconBase {...p}><path d="M19 12H5M12 19l-7-7 7-7" /></IconBase>,
  ExternalLink: (p: IconProps) => <IconBase {...p}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" /></IconBase>,
  Globe: (p: IconProps) => <IconBase {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></IconBase>,
  Server: (p: IconProps) => <IconBase {...p}><rect x="3" y="4" width="18" height="6" rx="1.5" /><rect x="3" y="14" width="18" height="6" rx="1.5" /><path d="M7 7h.01M7 17h.01" /></IconBase>,
  Cpu: (p: IconProps) => <IconBase {...p}><rect x="5" y="5" width="14" height="14" rx="2" /><rect x="9" y="9" width="6" height="6" rx="0.5" /><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3" /></IconBase>,
  Database: (p: IconProps) => <IconBase {...p}><ellipse cx="12" cy="5" rx="8" ry="2.5" /><path d="M4 5v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5V5M4 11v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-6" /></IconBase>,
  Brain: (p: IconProps) => <IconBase {...p}><path d="M9 3a3 3 0 0 0-3 3v.5a3 3 0 0 0-2 5.7v.6a3 3 0 0 0 2 5.7V19a3 3 0 0 0 6 0V3a3 3 0 0 0-3 0z" /><path d="M15 3a3 3 0 0 1 3 3v.5a3 3 0 0 1 2 5.7v.6a3 3 0 0 1-2 5.7V19a3 3 0 0 1-6 0V3a3 3 0 0 1 3 0z" /></IconBase>,
  Beaker: (p: IconProps) => <IconBase {...p}><path d="M4.5 3h15M6 3v8.5L3 19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2l-3-7.5V3" /></IconBase>,
  Zap: (p: IconProps) => <IconBase {...p}><path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" /></IconBase>,
  Eye: (p: IconProps) => <IconBase {...p}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" /><circle cx="12" cy="12" r="3" /></IconBase>,
  Command: (p: IconProps) => <IconBase {...p}><path d="M15 6V4a2 2 0 1 1 2 2h-2zM9 6V4a2 2 0 1 0-2 2h2zM15 18v2a2 2 0 1 0 2-2h-2zM9 18v2a2 2 0 1 1-2-2h2zM6 9H4a2 2 0 1 0 2 2V9zM18 9h2a2 2 0 1 1-2 2V9zM6 15H4a2 2 0 1 1 2-2v2zM18 15h2a2 2 0 1 0-2-2v2z" /><rect x="9" y="9" width="6" height="6" rx="0.5" /></IconBase>,
  Filter: (p: IconProps) => <IconBase {...p}><path d="M3 4h18l-7 9v6l-4 2v-8L3 4z" /></IconBase>,
  Sliders: (p: IconProps) => <IconBase {...p}><path d="M4 6h10M18 6h2M8 12h12M4 12h1M4 18h7M15 18h5" /><circle cx="16" cy="6" r="2" /><circle cx="7" cy="12" r="2" /><circle cx="13" cy="18" r="2" /></IconBase>,
  Maximize: (p: IconProps) => <IconBase {...p}><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" /><path d="M3 3l6 6M21 3l-6 6M3 21l6-6M21 21l-6-6" /></IconBase>,
  Minimize: (p: IconProps) => <IconBase {...p}><path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" /></IconBase>,
  Bell: (p: IconProps) => <IconBase {...p}><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M14 21a2 2 0 0 1-4 0" /></IconBase>,
  Menu: (p: IconProps) => <IconBase {...p}><path d="M3 6h18M3 12h18M3 18h18" /></IconBase>,
  PanelLeft: (p: IconProps) => <IconBase {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></IconBase>,
  PanelRight: (p: IconProps) => <IconBase {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></IconBase>,
  More: (p: IconProps) => <IconBase {...p}><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" /></IconBase>,
  Pin: (p: IconProps) => <IconBase {...p}><path d="M12 17v5M9 10.8V4h6v6.8c.6.4 3 2 3 4.2H6c0-2.2 2.4-3.8 3-4.2z" /></IconBase>,
  Star: (p: IconProps) => <IconBase {...p}><path d="M12 2l3 7 7.5.8-5.6 5 1.6 7.4L12 18.5 5.5 22.2 7 14.8 1.5 9.8 9 9l3-7z" /></IconBase>,
  Trash: (p: IconProps) => <IconBase {...p}><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14M10 11v6M14 11v6" /></IconBase>,
  Copy: (p: IconProps) => <IconBase {...p}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></IconBase>,
  Edit: (p: IconProps) => <IconBase {...p}><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></IconBase>,
  Lock: (p: IconProps) => <IconBase {...p}><rect x="4" y="11" width="16" height="11" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></IconBase>,
  GitBranch: (p: IconProps) => <IconBase {...p}><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><path d="M18 8.5a8 8 0 0 1-8 8" /></IconBase>,
  Box: (p: IconProps) => <IconBase {...p}><path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.3 7L12 12l8.7-5M12 22V12" /></IconBase>,
  Layers: (p: IconProps) => <IconBase {...p}><path d="M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></IconBase>,
  Map: (p: IconProps) => <IconBase {...p}><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6zM9 3v15M15 6v15" /></IconBase>,
  Activity: (p: IconProps) => <IconBase {...p}><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></IconBase>,
  Bot: (p: IconProps) => <IconBase {...p}><rect x="5" y="7" width="14" height="12" rx="2" /><path d="M9 13h.01M15 13h.01M9 17h6M12 3v4M8 7l-2-3M16 7l2-3" /></IconBase>,
  User: (p: IconProps) => <IconBase {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-7 8-7s8 3 8 7" /></IconBase>,
  Wrench: (p: IconProps) => <IconBase {...p}><path d="M14.7 6.3a4.5 4.5 0 0 0-5.4 5.7l-6.6 6.6a2 2 0 0 0 2.8 2.8L12 14.8a4.5 4.5 0 0 0 5.7-5.4l-2.7 2.7-2.8-.7-.7-2.8 2.7-2.7z" /></IconBase>,
  CheckCircle: (p: IconProps) => <IconBase {...p}><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></IconBase>,
  XCircle: (p: IconProps) => <IconBase {...p}><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></IconBase>,
  Clock: (p: IconProps) => <IconBase {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></IconBase>,
  Wifi: (p: IconProps) => <IconBase {...p}><path d="M2 8.5a18 18 0 0 1 20 0" /><path d="M6 12.5a10 10 0 0 1 12 0" /><path d="M10 16.5a3 3 0 0 1 4 0" /><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none" /></IconBase>,
  Hash: (p: IconProps) => <IconBase {...p}><path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18" /></IconBase>,
  Rocket: (p: IconProps) => <IconBase {...p}><path d="M5 13.5L3 17l3.5-2M14 5l5 5-9 9-5-5 9-9zM14 5c2-2 5-3 8-2-1 3-2 6-4 8M9 11l4 4" /></IconBase>,
  Compass: (p: IconProps) => <IconBase {...p}><circle cx="12" cy="12" r="9" /><path d="M16.2 7.8l-2.9 5.5-5.5 2.9 2.9-5.5 5.5-2.9z" /></IconBase>,
  Spinner: ({ size = 16, className = '', style }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" className={`spin ${className}`} style={style} xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.4" opacity="0.2" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  ),
}

// 注入 spinner 旋转动画样式（仅 1 次）
if (typeof document !== 'undefined' && !document.getElementById('spinner-css')) {
  const s = document.createElement('style')
  s.id = 'spinner-css'
  s.textContent = `.spin { animation: spin 0.9s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }`
  document.head.appendChild(s)
}
