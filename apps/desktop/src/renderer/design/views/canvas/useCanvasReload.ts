import { useCallback, useRef, useState } from 'react'
import { message } from 'antd'
import { isCanvasDirty, revertProject } from './canvas.api'

type CanvasReloadConfirmation = (options: {
  title: string
  description: string
  confirmText: string
  cancelText: string
  danger: boolean
}) => Promise<boolean>

export function useCanvasReload(options: {
  projectId: string
  savingRef: { readonly current: boolean }
  requestConfirm: CanvasReloadConfirmation
  refresh: (options?: { resetHistory?: boolean }) => Promise<void>
  onBeforeReload: () => void
  onReloaded: () => void
}) {
  const [refreshing, setRefreshing] = useState(false)
  const refreshingRef = useRef(false)

  const reload = useCallback(async () => {
    if (refreshingRef.current || options.savingRef.current) return

    const hasUnsavedChanges = isCanvasDirty(options.projectId)
    if (hasUnsavedChanges) {
      const confirmed = await options.requestConfirm({
        title: '重新加载画布？',
        description: '当前画布有未保存修改。继续刷新会放弃这些修改，并重新读取已保存数据。',
        confirmText: '放弃修改并刷新',
        cancelText: '取消',
        danger: true,
      })
      if (!confirmed) return
    }

    // 确认框停留期间自动保存可能已经启动；保存与重载不能并发写同一个项目。
    if (refreshingRef.current || options.savingRef.current) return
    refreshingRef.current = true
    setRefreshing(true)
    try {
      options.onBeforeReload()
      if (hasUnsavedChanges) await revertProject(options.projectId)
      await options.refresh({ resetHistory: true })
      options.onReloaded()
      message.success('画布已刷新')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '刷新画布失败')
    } finally {
      refreshingRef.current = false
      setRefreshing(false)
    }
  }, [options])

  return { refreshing, reload }
}
