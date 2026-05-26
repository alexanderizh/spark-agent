/**
 * Sidebar — 左侧导航栏
 *
 * 设计规范：
 *   - 窄图标栏（56px）
 *   - 5 项导航：Home / Chat / Projects / Workflows / Settings
 *   - 选中态：primary-soft 高亮
 *   - Tooltip：右侧弹出
 */

import { NavLink } from 'react-router-dom'
import {
  Home,
  MessageSquare,
  FolderKanban,
  Workflow,
  Settings,
} from 'lucide-react'
import { Tooltip } from '@spark/ui-kit'

const navItems = [
  { to: '/', icon: Home, label: 'Home' },
  { to: '/chat', icon: MessageSquare, label: 'Chat' },
  { to: '/projects', icon: FolderKanban, label: 'Projects' },
  { to: '/workflows', icon: Workflow, label: 'Workflows' },
  { to: '/settings', icon: Settings, label: 'Settings' },
] as const

export function Sidebar() {
  return (
    <aside className="flex h-screen w-[56px] flex-col items-center border-r border-border bg-bg-soft py-3">
      {/* Logo */}
      <div className="mb-4 flex h-8 w-8 items-center justify-center rounded-md bg-primary">
        <span className="text-[var(--font-xs)] font-bold text-primary-fg">S</span>
      </div>

      {/* 导航项 */}
      <nav className="flex flex-1 flex-col items-center gap-1">
        {navItems.map(({ to, icon: Icon, label }) => (
          <Tooltip key={to} content={label} side="right" delayDuration={200}>
            <NavLink
              to={to}
              className={({ isActive }) =>
                `flex h-9 w-9 items-center justify-center rounded-md transition-colors duration-150 ${
                  isActive
                    ? 'bg-primary-soft text-primary'
                    : 'text-text-muted hover:bg-hover hover:text-text'
                }`
              }
            >
              <Icon size={18} strokeWidth={1.8} />
            </NavLink>
          </Tooltip>
        ))}
      </nav>

      {/* 底部版本号 */}
      <div className="text-[10px] text-text-faint">v0.1</div>
    </aside>
  )
}
