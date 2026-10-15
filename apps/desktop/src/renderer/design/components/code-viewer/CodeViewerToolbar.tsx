/**
 * CodeViewerToolbar —— 代码查看器顶部工具栏。
 *
 * 组成：路径面包屑（title 显示绝对路径） · [源码/预览/本次改动] 分段切换 · 分屏 · 刷新预览
 *      · 保存状态（脏 / 外部已变更）· 保存按钮（脏或保存中可见）
 *      · 「打开方式」入口（复用 SessionFileOpenPicker，含 IDE / 文件夹 / 默认应用）。
 */

import { Fragment } from 'react'
import type { PreviewFileType } from '../FileDisplay'
import { Icons } from '../../Icons'
import { SessionFileOpenPicker } from '../SessionFileOpenPicker'
import { ToolbarTooltip } from './ToolbarTooltip'
import type { CodeViewMode } from './types'

export interface CodeViewerToolbarProps {
  absPath: string
  displayPath: string
  viewMode: CodeViewMode
  onViewModeChange: (mode: CodeViewMode) => void
  dirty: boolean
  externalChanged: boolean
  saving: boolean
  readOnly: boolean
  hasDiff: boolean
  /** 当前文件能否预览（markdown/html/图片/音视频/office）；决定「预览」分段是否可用 */
  canPreview: boolean
  /** 当前文件能否分屏（可编辑 + 可预览，如 html/md/svg/csv）；决定分屏按钮是否可用 */
  canSplit: boolean
  /** 当前文件有无源码视图（纯文本/代码/双向文件有；只能预览的二进制富媒体没有）；决定「源码」分段是否可用 */
  canShowSource: boolean
  minimapEnabled: boolean
  onToggleMinimap: () => void
  onSave: () => void
  /** 刷新预览：仅在预览/分屏模式下可用（整页重载 html / 重建媒体元素 / 重读磁盘内容） */
  onRefreshPreview: () => void
  /** 应用内预览入口（可选：不传时「打开方式」主按钮回落为用默认应用打开） */
  onPreview?: ((filePath: string, fileType: PreviewFileType) => void) | undefined
}

export function CodeViewerToolbar({
  absPath,
  displayPath,
  viewMode,
  onViewModeChange,
  dirty,
  externalChanged,
  saving,
  readOnly,
  hasDiff,
  canPreview,
  canSplit,
  canShowSource,
  minimapEnabled,
  onToggleMinimap,
  onSave,
  onRefreshPreview,
  onPreview,
}: CodeViewerToolbarProps) {
  const crumbs = displayPath.replace(/\\/g, '/').split('/').filter(Boolean)
  const previewOn = viewMode === 'preview' || viewMode === 'split'
  return (
    <div className="cv-toolbar">
      <div className="cv-crumbs" title={absPath}>
        {crumbs.map((c, i) => (
          <Fragment key={`${c}-${i}`}>
            <span className="cv-crumb">{c}</span>
            {i < crumbs.length - 1 && <span className="cv-crumb-sep">›</span>}
          </Fragment>
        ))}
      </div>
      <div className="cv-toolbar-right">
        {externalChanged && (
          <span className="cv-tag cv-tag-warn" title="磁盘文件已被外部（如 agent）修改">
            外部已变更
          </span>
        )}
        {dirty && !readOnly && <span className="cv-tag cv-tag-dirty">未保存</span>}
        <div className="cv-seg" role="tablist" aria-label="代码视图切换">
          <ToolbarTooltip
            label={canShowSource ? '查看源码' : '该文件类型没有源码视图'}
            placement="bottom"
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'source'}
              className={viewMode === 'source' ? 'on' : ''}
              disabled={!canShowSource}
              onClick={() => canShowSource && onViewModeChange('source')}
            >
              源码
            </button>
          </ToolbarTooltip>
          <ToolbarTooltip
            label={canPreview ? '在内容区预览渲染结果' : '该文件类型不支持预览'}
            placement="bottom"
          >
            <button
              type="button"
              role="tab"
              aria-selected={previewOn}
              className={previewOn ? 'on' : ''}
              disabled={!canPreview}
              onClick={() => canPreview && onViewModeChange('preview')}
            >
              预览
            </button>
          </ToolbarTooltip>
          <ToolbarTooltip
            label={hasDiff ? '查看本次改动' : '该文件没有可显示的改动记录'}
            placement="bottom"
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'diff'}
              className={viewMode === 'diff' ? 'on' : ''}
              disabled={!hasDiff}
              onClick={() => hasDiff && onViewModeChange('diff')}
            >
              本次改动
            </button>
          </ToolbarTooltip>
        </div>
        <ToolbarTooltip
          label={
            !canSplit
              ? '该文件类型不支持分屏（需可编辑且可预览）'
              : viewMode === 'split'
                ? '切换为整页预览'
                : '分屏：左侧源码，右侧实时预览'
          }
          placement="bottom"
        >
          <button
            type="button"
            className={`cv-icon-btn${viewMode === 'split' ? ' on' : ''}`}
            onClick={() => canSplit && onViewModeChange(viewMode === 'split' ? 'preview' : 'split')}
            disabled={!canSplit}
            aria-label="切换分屏预览"
            aria-pressed={viewMode === 'split'}
          >
            <Icons.Columns size={14} />
          </button>
        </ToolbarTooltip>
        <ToolbarTooltip
          label={previewOn ? '刷新预览（重新加载渲染内容）' : '预览或分屏模式下可刷新'}
          placement="bottom"
        >
          <button
            type="button"
            className="cv-icon-btn"
            onClick={() => previewOn && onRefreshPreview()}
            disabled={!previewOn}
            aria-label="刷新预览"
          >
            <Icons.RotateCw size={14} />
          </button>
        </ToolbarTooltip>
        <ToolbarTooltip
          label={
            viewMode === 'diff'
              ? '小地图仅在「源码」视图可用'
              : minimapEnabled
                ? '关闭小地图'
                : '打开小地图'
          }
          placement="bottom"
        >
          <button
            type="button"
            className={`cv-icon-btn${minimapEnabled ? ' on' : ''}`}
            onClick={onToggleMinimap}
            disabled={viewMode === 'diff'}
            aria-label="切换小地图"
            aria-pressed={minimapEnabled}
          >
            <Icons.Map size={14} />
          </button>
        </ToolbarTooltip>
        {!readOnly && (dirty || saving) && (
          <ToolbarTooltip label="保存（Cmd/Ctrl+S）" placement="bottom">
            <button
              type="button"
              className="cv-save-btn"
              onClick={onSave}
              disabled={saving || !dirty}
            >
              {saving ? <Icons.Spinner size={12} /> : <Icons.Check size={12} />}
              {saving ? '保存中' : '保存'}
            </button>
          </ToolbarTooltip>
        )}
        <SessionFileOpenPicker
          filePath={absPath}
          compact
          {...(onPreview != null ? { onPreview } : {})}
        />
      </div>
    </div>
  )
}
