/**
 * GitCommitFiles —— 一条提交展开后的文件清单，以及单文件的提交历史。
 *
 * 文件历史也按需加载：点击文件后才查询，点击历史提交可在代码查看器中打开该提交的 diff。
 */

import { useState } from 'react'
import type { WorkspaceGitCommitFile } from '@spark/protocol'
import { Icons } from '../../../Icons'
import { VscodeFileIcon } from '../VscodeFileIcon'
import { formatGitRelativeTime, buildGitPanelFileLabels } from './gitPanelViewUtils'
import { useGitCommitFiles } from './useGitCommitFiles'
import { useGitFileHistory } from './useGitFileHistory'

type HistoricalChangeType = 'create' | 'modify' | 'delete' | 'rename'

function getHistoricalChangeType(status: string): HistoricalChangeType {
  switch (status[0]) {
    case 'A':
      return 'create'
    case 'D':
      return 'delete'
    case 'R':
      return 'rename'
    default:
      return 'modify'
  }
}

function getFileStatusClass(status: string): 'add' | 'del' | 'mod' {
  switch (status[0]) {
    case 'A':
    case 'C':
      return 'add'
    case 'D':
      return 'del'
    default:
      return 'mod'
  }
}

function getFileName(filePath: string): string {
  return filePath.split('/').pop() ?? filePath
}

interface GitCommitFileRowProps {
  workspaceId: string | null
  file: WorkspaceGitCommitFile
  label: { name: string; shortDir: string | null }
  onOpenHistoricalFile?:
    | ((path: string, commitHash: string, changeType?: HistoricalChangeType) => void)
    | undefined
}

function GitCommitFileRow({
  workspaceId,
  file,
  label,
  onOpenHistoricalFile,
}: GitCommitFileRowProps) {
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const history = useGitFileHistory(workspaceId, historyExpanded ? file.path : null)
  const statusClass = getFileStatusClass(file.status)
  const changeType = getHistoricalChangeType(file.status)

  return (
    <div className="gp-commit-file-group">
      <button
        type="button"
        className={`gp-commit-file-row${historyExpanded ? ' expanded' : ''}`}
        onClick={() => setHistoryExpanded((expanded) => !expanded)}
        aria-expanded={historyExpanded}
        title={
          file.previousPath == null
            ? `查看 ${file.path} 的变更历史`
            : `查看 ${file.previousPath} → ${file.path} 的变更历史`
        }
      >
        <Icons.ChevronRight
          size={12}
          className={`gp-commit-file-chevron${historyExpanded ? ' open' : ''}`}
        />
        <span className="gp-file-type-icon">
          <VscodeFileIcon name={label.name} kind="file" size={13} />
        </span>
        <span className={`gp-file-badge ${statusClass}`}>{file.status}</span>
        {label.shortDir != null && <span className="gp-file-dir">{label.shortDir}</span>}
        <span className="gp-file-name">{label.name}</span>
      </button>
      {historyExpanded && (
        <div className="gp-commit-file-history">
          {history.loading && (
            <div className="gp-commit-history-state">
              <Icons.Spinner size={12} className="gp-spin" /> 加载文件历史…
            </div>
          )}
          {!history.loading && history.error != null && (
            <div className="gp-commit-history-state error">{history.error}</div>
          )}
          {!history.loading && history.error == null && history.commits.length === 0 && (
            <div className="gp-commit-history-state">暂无文件历史</div>
          )}
          {!history.loading && history.error == null && history.commits.length > 0 && (
            <div className="gp-commit-history-list">
              {history.commits.map((historyCommit) => (
                <button
                  key={historyCommit.hash}
                  type="button"
                  className="gp-commit-history-row"
                  disabled={onOpenHistoricalFile == null}
                  onClick={() =>
                    onOpenHistoricalFile?.(historyCommit.path, historyCommit.hash, changeType)
                  }
                  title="在代码查看器中打开此提交的 diff"
                >
                  <span className="gp-commit-history-hash">{historyCommit.shortHash}</span>
                  <span className="gp-commit-history-subject">{historyCommit.subject}</span>
                  <span className="gp-commit-history-meta">
                    {historyCommit.authorName} · {formatGitRelativeTime(historyCommit.date)}
                  </span>
                  {onOpenHistoricalFile != null && <Icons.Code size={12} />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function GitCommitFiles({
  workspaceId,
  commitHash,
  onOpenHistoricalFile,
}: {
  workspaceId: string | null
  commitHash: string
  onOpenHistoricalFile?:
    | ((path: string, commitHash: string, changeType?: HistoricalChangeType) => void)
    | undefined
}) {
  const state = useGitCommitFiles(workspaceId, commitHash)
  const labels = buildGitPanelFileLabels(state.files.map((file) => file.path))

  if (state.loading) {
    return (
      <div className="gp-commit-files-state">
        <Icons.Spinner size={12} className="gp-spin" /> 加载提交文件…
      </div>
    )
  }
  if (state.error != null) return <div className="gp-commit-files-state error">{state.error}</div>
  if (state.files.length === 0)
    return <div className="gp-commit-files-state">此提交没有文件变更</div>

  return (
    <div className="gp-commit-files" id={`gp-commit-files-${commitHash}`}>
      {state.files.map((file) => (
        <GitCommitFileRow
          key={`${file.status}:${file.path}:${file.previousPath ?? ''}`}
          workspaceId={workspaceId}
          file={file}
          label={labels.get(file.path) ?? { name: getFileName(file.path), shortDir: null }}
          onOpenHistoricalFile={onOpenHistoricalFile}
        />
      ))}
    </div>
  )
}
