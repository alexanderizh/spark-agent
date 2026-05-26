/**
 * AppLayout — 应用主布局
 *
 * 三栏布局：左侧导航 | 中间内容区 | 右侧 Inspector（仅 Chat 页）
 * 设计规范：整体紧凑，内容区弹性宽度
 */

import { Outlet } from 'react-router-dom'
import { Sidebar } from '../components/Sidebar'

export function AppLayout() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg text-text">
      {/* 左侧导航 */}
      <Sidebar />

      {/* 中间内容区 */}
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}
