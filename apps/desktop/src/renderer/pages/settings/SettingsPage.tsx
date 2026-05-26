/**
 * Settings 页面
 *
 * 设计规范（参考设计稿 Spark-Agent-Standalone.html §4.3）：
 *   - 左侧 Tab 导航（Provider / Model / Rules / Permissions / MCP / Skill / About）
 *   - 右侧内容区（各子页配置表单）
 *   - 整体紧凑，标签式切换
 *
 * 路由：/settings/*
 * 子路由：
 *   /settings          → 重定向到 /settings/providers
 *   /settings/providers → Provider 配置
 *   /settings/models    → Model Profiles
 *   /settings/rules     → 规则管理
 *   /settings/permissions → 权限策略
 *   /settings/mcp       → MCP 连接
 *   /settings/skills    → Skill 管理
 *   /settings/about     → 关于
 */

import { Navigate, Routes, Route, NavLink } from 'react-router-dom'
import { ScrollArea } from '@spark/ui-kit'
import {
  Server,
  Brain,
  BookOpen,
  Shield,
  Plug,
  Sparkles,
  Info,
} from 'lucide-react'
import { ProvidersSubPage } from './sub-pages/ProvidersSubPage'
import { ModelsSubPage } from './sub-pages/ModelsSubPage'
import { RulesSubPage } from './sub-pages/RulesSubPage'
import { PermissionsSubPage } from './sub-pages/PermissionsSubPage'
import { McpSubPage } from './sub-pages/McpSubPage'
import { SkillsSubPage } from './sub-pages/SkillsSubPage'
import { AboutSubPage } from './sub-pages/AboutSubPage'

/* ---- 子页导航配置 ---- */
const subPages = [
  { path: 'providers', icon: Server, label: 'Providers', desc: '配置 AI 服务提供商' },
  { path: 'models', icon: Brain, label: 'Model Profiles', desc: '管理模型配置' },
  { path: 'rules', icon: BookOpen, label: 'Rules', desc: '规则管理' },
  { path: 'permissions', icon: Shield, label: 'Permissions', desc: '权限策略' },
  { path: 'mcp', icon: Plug, label: 'MCP', desc: 'MCP 服务器连接' },
  { path: 'skills', icon: Sparkles, label: 'Skills', desc: '技能管理' },
  { path: 'about', icon: Info, label: 'About', desc: '关于 Spark Agent' },
] as const

export function SettingsPage() {
  return (
    <div className="flex h-full">
      {/* 左侧子导航 */}
      <nav className="flex w-[200px] shrink-0 flex-col border-r border-border bg-bg-soft p-2">
        <h2 className="mb-2 px-3 pt-1 text-[var(--font-base)] font-semibold text-text-strong">
          Settings
        </h2>
        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-0.5">
            {subPages.map(({ path, icon: Icon, label }) => (
              <NavLink
                key={path}
                to={`/settings/${path}`}
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-xs px-3 py-1.5 text-[var(--font-sm)] transition-colors duration-150 ${
                    isActive
                      ? 'bg-primary-soft text-primary font-medium'
                      : 'text-text-muted hover:bg-hover hover:text-text'
                  }`
                }
              >
                <Icon size={14} strokeWidth={1.8} />
                <span>{label}</span>
              </NavLink>
            ))}
          </div>
        </ScrollArea>
      </nav>

      {/* 右侧内容区 */}
      <main className="flex-1 overflow-hidden">
        <Routes>
          <Route index element={<Navigate to="providers" replace />} />
          <Route path="providers" element={<ProvidersSubPage />} />
          <Route path="models" element={<ModelsSubPage />} />
          <Route path="rules" element={<RulesSubPage />} />
          <Route path="permissions" element={<PermissionsSubPage />} />
          <Route path="mcp" element={<McpSubPage />} />
          <Route path="skills" element={<SkillsSubPage />} />
          <Route path="about" element={<AboutSubPage />} />
        </Routes>
      </main>
    </div>
  )
}
