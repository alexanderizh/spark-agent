/**
 * App — 应用根组件
 *
 * 接入 React Router，渲染三栏布局：
 *   - 左侧：Sidebar 导航栏（56px 图标栏）
 *   - 中间：内容区（各页面路由）
 *   - 右侧：Inspector 面板（仅 Chat 页面，Phase 1 实现）
 */

import type { ReactElement } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AppLayout } from './layouts/AppLayout'
import { HomePage } from './pages/home/HomePage'
import { ChatPage } from './pages/chat/ChatPage'
import { ProjectsPage } from './pages/PlaceholderPage'
import { WorkflowsPage } from './pages/WorkflowsPage'
import { SettingsPage } from './pages/settings/SettingsPage'

export function App(): ReactElement {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/workflows" element={<WorkflowsPage />} />
          <Route path="/settings/*" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
