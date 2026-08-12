/**
 * CodeViewerToolbar —— 代码查看器顶部工具栏。
 *
 * 组成：路径面包屑（title 显示绝对路径） · [源码/本次改动] 分段切换 · 保存状态（脏 / 外部已变更）
 *      · 保存按钮（脏或保存中可见）· 「打开方式」入口（复用 SessionFileOpenPicker，含 IDE / 文件夹 / 默认应用）。
 */

import { Fragment } from 'react'
import { Icons } from '../../Icons'
import { SessionFileOpenPicker } from '../SessionFileOpenPicker'
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
  minimapEnabled: boolean
  onToggleMinimap: () => void
  onSave: () => void
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
  minimapEnabled,
  onToggleMinimap,
  onSave,
}: CodeViewerToolbarProps) {
  const crumbs = displayPath.replace(/\\/g, '/').split('/').filter(Boolean)
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
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'source'}
            className={viewMode === 'source' ? 'on' : ''}
            onClick={() => onViewModeChange('source')}
          >
            源码
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === 'diff'}
            className={viewMode === 'diff' ? 'on' : ''}
            disabled={!hasDiff}
            title={hasDiff ? '查看本次改动' : '该文件没有可显示的改动记录'}
            onClick={() => hasDiff && onViewModeChange('diff')}
          >
            本次改动
          </button>
        </div>
        <button
          type="button"
          className={`cv-icon-btn${minimapEnabled ? ' on' : ''}`}
          onClick={onToggleMinimap}
          disabled={viewMode === 'diff'}
          title={
            viewMode === 'diff'
              ? '小地图仅在「源码」视图可用'
              : minimapEnabled
                ? '关闭小地图'
                : '打开小地图'
          }
          aria-label="切换小地图"
          aria-pressed={minimapEnabled}
        >
          <Icons.Map size={14} />
        </button>
        {!readOnly && (dirty || saving) && (
          <button
            type="button"
            className="cv-save-btn"
            onClick={onSave}
            disabled={saving || !dirty}
            title="保存（Cmd/Ctrl+S）"
          >
            {saving ? <Icons.Spinner size={12} /> : <Icons.Check size={12} />}
            {saving ? '保存中' : '保存'}
          </button>
        )}
        <SessionFileOpenPicker filePath={absPath} compact />
      </div>
    </div>
  )
}
