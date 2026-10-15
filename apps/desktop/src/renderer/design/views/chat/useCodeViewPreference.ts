/**
 * 跨文件视图偏好（sticky 开关）：source / preview / split。
 *
 * 用户在工具栏切到预览/分屏后，切换文件仍保持该偏好——不用每个文件重新开一次开关。
 * 与文件能力不匹配时由渲染期收窄（narrowViewModeFor），偏好本身不被覆盖：
 *  - 不可预览（纯代码/文本）：preview/split 偏好收窄显示为 source，切回可预览文件自动恢复；
 *  - 只能看不能编的富媒体（png/mp4/office 等）：无论偏好为何都显示 preview（没有源码视图）。
 *
 * diff 不参与偏好：它是「看某个文件改动」的上下文绑定视图，走 tab 级一次性覆盖
 * （OpenCodeFile.viewMode），切走再切回仍停在 diff；用户切换 source/preview/split 时清掉覆盖。
 *
 * 偏好 state 由 ChatView 持有（参与项目级快照），本 hook 负责切换/收窄逻辑：
 *  - handleViewModeChange：source/preview/split → 设偏好 + 清激活 tab 覆盖；diff → 写 tab 覆盖；
 *  - handleSelectActive：仅切激活路径，面板显示值由 panelViewMode 派生（覆盖优先，否则收窄偏好）；
 *  - panelViewMode：渲染期派生（不回写 state，避免多余渲染循环）。
 *
 * 内部用 ref 镜像最新列表/激活路径（render 阶段写入，与 ChatView 的 workspaceRootRef 同模式），
 * 回调不随文件列表变化重建。
 */

import { useCallback, useMemo, useRef, type Dispatch, type SetStateAction } from 'react'
import {
  canPreviewInCodeViewer,
  canSplitPreviewInCodeViewer,
} from '../../components/code-viewer/previewSupport'
import type {
  CodeViewMode,
  CodeViewPreference,
  OpenCodeFile,
} from '../../components/code-viewer/types'

export interface UseCodeViewPreferenceParams {
  codeFiles: OpenCodeFile[]
  activeCodePath: string | null
  viewPreference: CodeViewPreference
  setCodeFiles: Dispatch<SetStateAction<OpenCodeFile[]>>
  setViewPreference: Dispatch<SetStateAction<CodeViewPreference>>
  setActiveCodePath: Dispatch<SetStateAction<string | null>>
}

export interface UseCodeViewPreferenceResult {
  /** 传给 CodeViewerPanel 的受控 viewMode（tab 覆盖优先，否则按激活文件能力收窄偏好） */
  panelViewMode: CodeViewMode
  /** 用户切换视图：source/preview/split 设全局偏好并清 tab 覆盖；diff 写 tab 覆盖 */
  handleViewModeChange: (mode: CodeViewMode) => void
  /** 切换激活文件：仅切路径，显示值由 panelViewMode 派生（偏好自动延续） */
  handleSelectActive: (absPath: string) => void
}

/**
 * 渲染期能力收窄：按文件能力把偏好落到可显示的模式。
 *  - 不可预览（纯代码/文本）→ source；
 *  - 可预览但不可编辑的富媒体（png/mp4/office 等，无源码视图）→ preview；
 *  - 双向文件（html/md/svg/csv 等）→ 偏好原样生效。
 */
function narrowViewModeFor(pref: CodeViewPreference, absPath: string | null): CodeViewMode {
  if (absPath == null) return pref === 'split' ? 'source' : pref
  if (!canPreviewInCodeViewer(absPath)) return 'source'
  if (!canSplitPreviewInCodeViewer(absPath)) return 'preview'
  return pref
}

export function useCodeViewPreference(
  params: UseCodeViewPreferenceParams,
): UseCodeViewPreferenceResult {
  const {
    codeFiles,
    activeCodePath,
    viewPreference,
    setCodeFiles,
    setViewPreference,
    setActiveCodePath,
  } = params
  // ref 镜像最新列表 / 激活路径：回调读 ref，避免闭包陈旧与依赖重建
  const codeFilesRef = useRef(codeFiles)
  codeFilesRef.current = codeFiles
  const activeCodePathRef = useRef(activeCodePath)
  activeCodePathRef.current = activeCodePath

  const handleViewModeChange = useCallback(
    (mode: CodeViewMode) => {
      const active = activeCodePathRef.current
      if (mode === 'diff') {
        // diff 是上下文绑定视图：写入 tab 覆盖，切走再切回仍停在 diff；不动全局偏好
        if (active == null) return
        setCodeFiles((prev) =>
          prev.map((f) => (f.absPath === active ? { ...f, viewMode: 'diff' } : f)),
        )
        return
      }
      // source/preview/split：更新跨文件偏好，并清掉激活 tab 的一次性覆盖（此后跟随偏好）
      setViewPreference(mode)
      if (active == null) return
      setCodeFiles((prev) =>
        prev.some((f) => f.absPath === active && f.viewMode != null)
          ? prev.map((f) => (f.absPath === active ? { ...f, viewMode: undefined } : f))
          : prev,
      )
    },
    [setCodeFiles, setViewPreference],
  )

  const handleSelectActive = useCallback(
    (absPath: string) => {
      setActiveCodePath(absPath)
    },
    [setActiveCodePath],
  )

  const panelViewMode = useMemo<CodeViewMode>(() => {
    // tab 一次性覆盖（diff / 右键预览）优先；覆盖值同样过能力收窄兜底（防御异常数据）
    const override = codeFiles.find((f) => f.absPath === activeCodePath)?.viewMode
    if (override === 'diff') return 'diff'
    return narrowViewModeFor(override ?? viewPreference, activeCodePath)
  }, [codeFiles, activeCodePath, viewPreference])

  return { panelViewMode, handleViewModeChange, handleSelectActive }
}
