/**
 * SkillFileTree — 技能目录文件树。
 *
 * 行为约定：
 *   - 根节点为技能目录名（带文件数徽标），可整体折叠；
 *   - 目录节点可展开/收起，默认展开前两层（SKILL.md 与 references/ 直接可见）；
 *   - SKILL.md 恒置顶（排序由 sortSkillNodes 负责）；
 *   - 选中态、hover 态与键盘操作（Enter/Space 打开）齐全。
 */

import { useCallback, useMemo, useState } from 'react'
import type { SkillFileNode } from '@spark/protocol'
import { Icons } from '../../Icons'
import { VscodeFileIcon } from '../../components/code-viewer/VscodeFileIcon'
import { countFiles, formatFileSize, sortSkillNodes } from './skill-detail-utils'

interface SkillFileTreeProps {
  /** 技能目录名（根节点展示名） */
  rootName: string
  nodes: SkillFileNode[]
  /** 当前选中的文件相对路径 */
  selectedPath: string | null
  onSelectFile: (node: SkillFileNode) => void
  /** 被修改但未保存的文件路径集合（显示圆点标记） */
  dirtyPaths?: string[]
  /** 触发描述，展示在根节点下方 */
  subtitle?: string
  loading?: boolean
}

export function SkillFileTree({
  rootName,
  nodes,
  selectedPath,
  onSelectFile,
  dirtyPaths = [],
  subtitle,
  loading = false,
}: SkillFileTreeProps) {
  const sorted = useMemo(() => sortSkillNodes(nodes), [nodes])
  const totalFiles = useMemo(() => countFiles(sorted), [sorted])
  const [rootCollapsed, setRootCollapsed] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(() => collectDefaultExpanded(sorted))

  const toggleDir = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const dirtySet = useMemo(() => new Set(dirtyPaths), [dirtyPaths])

  return (
    <div className="skill-detail-rail">
      <button
        type="button"
        className="skill-detail-rail-head"
        onClick={() => setRootCollapsed((v) => !v)}
        title={rootCollapsed ? '展开技能目录' : '收起技能目录'}
      >
        <span className={`skill-detail-rail-caret ${rootCollapsed ? 'is-collapsed' : ''}`}>
          <Icons.ChevronDown size={12} />
        </span>
        <span className="skill-detail-rail-root">{rootName}</span>
        <span className="skill-detail-rail-count">{totalFiles}</span>
      </button>

      {subtitle != null && subtitle.length > 0 && (
        <div className="skill-detail-rail-subtitle" title={subtitle}>
          {subtitle}
        </div>
      )}

      {!rootCollapsed && (
        <div className="skill-detail-tree" role="tree" aria-label="技能文件">
          {loading ? (
            <div className="skill-detail-tree-hint">正在读取技能目录…</div>
          ) : sorted.length === 0 ? (
            <div className="skill-detail-tree-hint">技能目录为空</div>
          ) : (
            sorted.map((node) => (
              <SkillTreeNode
                key={node.path}
                node={node}
                depth={0}
                expanded={expanded}
                onToggleDir={toggleDir}
                selectedPath={selectedPath}
                onSelectFile={onSelectFile}
                dirtySet={dirtySet}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

/** 默认展开：第一层目录展开（让 references/ 下的内容首屏可见），更深的层收起 */
function collectDefaultExpanded(nodes: SkillFileNode[]): Set<string> {
  const set = new Set<string>()
  for (const node of nodes) {
    if (node.type === 'directory') set.add(node.path)
  }
  return set
}

function SkillTreeNode({
  node,
  depth,
  expanded,
  onToggleDir,
  selectedPath,
  onSelectFile,
  dirtySet,
}: {
  node: SkillFileNode
  depth: number
  expanded: Set<string>
  onToggleDir: (path: string) => void
  selectedPath: string | null
  onSelectFile: (node: SkillFileNode) => void
  dirtySet: Set<string>
}) {
  const isDirectory = node.type === 'directory'
  const isOpen = isDirectory && expanded.has(node.path)
  const isSelected = !isDirectory && selectedPath === node.path
  const isDirty = dirtySet.has(node.path)

  const handleActivate = useCallback(() => {
    if (isDirectory) onToggleDir(node.path)
    else onSelectFile(node)
  }, [isDirectory, node, onToggleDir, onSelectFile])

  return (
    <>
      <div
        role="treeitem"
        aria-selected={isSelected}
        aria-expanded={isDirectory ? isOpen : undefined}
        tabIndex={0}
        className={`skill-detail-tree-row ${isSelected ? 'is-selected' : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={handleActivate}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            handleActivate()
          }
        }}
        title={node.path}
      >
        <span className={`skill-detail-tree-caret ${isDirectory ? '' : 'is-hidden'} ${isOpen ? 'is-open' : ''}`}>
          {isDirectory && <Icons.ChevronRight size={11} />}
        </span>
        <VscodeFileIcon
          name={node.name}
          kind={isDirectory ? 'folder' : 'file'}
          open={isOpen}
          size={15}
        />
        <span className="skill-detail-tree-name">{node.name}</span>
        {isDirty && <span className="skill-detail-tree-dirty" title="有未保存的修改" />}
        {!isDirectory && node.size != null && (
          <span className="skill-detail-tree-size">{formatFileSize(node.size)}</span>
        )}
      </div>

      {isDirectory &&
        isOpen &&
        (node.children ?? []).map((child) => (
          <SkillTreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            onToggleDir={onToggleDir}
            selectedPath={selectedPath}
            onSelectFile={onSelectFile}
            dirtySet={dirtySet}
          />
        ))}
    </>
  )
}
