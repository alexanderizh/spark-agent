/**
 * CanvasProjectSelectionContext — 画布项目「当前选中」状态。
 *
 * 设计意图：侧栏画布列表（CanvasProjectSidebarList）和主区项目视图
 * （CanvasProjectsView）是兄弟组件，需要共享「当前选中的项目 id」，
 * 让侧栏点击 → 主区详情页联动。参考 SessionSidebarContext 的职责划分，
 * 这里只管一个 UI 状态（选中 id），不持久化、不涉及项目数据。
 *
 * 非持久化理由：每次进入画布模式默认不选中任何项目，主区显示欢迎页，
 * 避免上次选中的项目已删除/归档导致主区空白。
 */
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

type CanvasProjectSelectionCtx = {
  /** 当前选中的画布项目 id；null 表示未选中 */
  selectedProjectId: string | null
  /** 设置选中项；传 null 清除选中 */
  selectProject: (id: string | null) => void
}

const Ctx = createContext<CanvasProjectSelectionCtx | null>(null)

export function CanvasProjectSelectionProvider({ children }: { children: ReactNode }) {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const selectProject = useCallback((id: string | null) => setSelectedProjectId(id), [])
  return <Ctx.Provider value={{ selectedProjectId, selectProject }}>{children}</Ctx.Provider>
}

export function useCanvasProjectSelection(): CanvasProjectSelectionCtx {
  const ctx = useContext(Ctx)
  if (!ctx) {
    throw new Error(
      'useCanvasProjectSelection must be used within CanvasProjectSelectionProvider',
    )
  }
  return ctx
}
