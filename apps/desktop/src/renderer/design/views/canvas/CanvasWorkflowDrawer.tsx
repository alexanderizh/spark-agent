import { useCallback, useEffect, useRef, useState } from 'react'
import type { CanvasWorkflowDefinition, CanvasWorkflowPackage } from '@spark/protocol'
import { Icons } from '../../Icons'
import { canvasWorkflowApi } from './canvasWorkflow.api'
import { CANVAS_WORKFLOW_DRAG_TYPE } from './canvasWorkflowDrag'
import { useCanvasWorkflowDialogFocus } from './useCanvasWorkflowDialogFocus'

type DrawerScope = 'all' | 'project' | 'library' | 'builtin'
const DRAWER_PAGE_SIZE = 40

const EMPTY_PROJECT_WORKFLOW: CanvasWorkflowPackage = {
  schemaVersion: 1,
  graph: { nodes: [], edges: [] },
  contract: { inputs: [], outputs: [], exposedParams: [] },
  dependencies: { modelCapabilities: [], canvasNodeKinds: [] },
}

function workflowScopeLabel(workflow: CanvasWorkflowDefinition, projectId: string): string {
  if (workflow.scope === 'builtin') return '内置模板'
  if (workflow.scope === 'library') return '个人库'
  return workflow.projectId === projectId ? '当前项目' : '其他项目'
}

export function CanvasWorkflowDrawer({
  open,
  projectId,
  projectName,
  selectedNodeCount,
  onClose,
  onExtractSelection,
  onAddWorkflow,
  onUpdateFromSelection,
}: {
  open: boolean
  projectId: string
  projectName: string
  selectedNodeCount: number
  onClose: () => void
  onExtractSelection: () => void
  onAddWorkflow: (workflow: CanvasWorkflowDefinition) => void
  onUpdateFromSelection: (workflow: CanvasWorkflowDefinition) => void
}) {
  const [workflows, setWorkflows] = useState<CanvasWorkflowDefinition[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [scope, setScope] = useState<DrawerScope>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const loadSequenceRef = useRef(0)
  useCanvasWorkflowDialogFocus(dialogRef, open)

  const load = useCallback(
    async (offset = 0) => {
      const reset = offset === 0
      const sequence = ++loadSequenceRef.current
      if (reset) {
        setLoading(true)
        setHasLoaded(false)
      } else setLoadingMore(true)
      setError('')
      try {
        const response = await canvasWorkflowApi.listPage({
          ...(scope !== 'all' ? { scope } : {}),
          ...(scope === 'project' ? { projectId } : {}),
          ...(query.trim() ? { query: query.trim() } : {}),
          includeArchived: false,
          limit: DRAWER_PAGE_SIZE,
          offset,
        })
        if (sequence !== loadSequenceRef.current) return
        setWorkflows((current) => {
          if (reset) return response.workflows
          const byId = new Map(current.map((workflow) => [workflow.id, workflow]))
          for (const workflow of response.workflows) byId.set(workflow.id, workflow)
          return [...byId.values()]
        })
        setTotal(response.total)
        setHasMore(response.hasMore)
      } catch (loadError) {
        if (sequence !== loadSequenceRef.current) return
        setError(loadError instanceof Error ? loadError.message : '加载画布工作流失败')
      } finally {
        if (sequence === loadSequenceRef.current) {
          setLoading(false)
          setLoadingMore(false)
          if (reset) setHasLoaded(true)
        }
      }
    },
    [projectId, query, scope],
  )

  useEffect(() => {
    if (open) {
      void load()
      return
    }
    setHasLoaded(false)
  }, [load, open])

  const visible = workflows

  useEffect(() => {
    if (!open) return
    if (!visible.some((workflow) => workflow.id === selectedId)) {
      setSelectedId(visible[0]?.id ?? null)
    }
  }, [open, selectedId, visible])

  if (!open) return null

  const selected = workflows.find((workflow) => workflow.id === selectedId) ?? null

  const createBlankProjectWorkflow = async () => {
    setBusy(true)
    setError('')
    try {
      const created = await canvasWorkflowApi.create({
        name: '未命名画布工作流',
        description: `创建于项目“${projectName}”`,
        scope: 'project',
        projectId,
        package: EMPTY_PROJECT_WORKFLOW,
      })
      setWorkflows((current) => [created, ...current])
      setScope('project')
      setSelectedId(created.id)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '创建项目工作流失败')
    } finally {
      setBusy(false)
    }
  }

  const deleteSelected = async () => {
    if (!selected || selected.scope === 'builtin') return
    if (!window.confirm(`删除画布工作流“${selected.name}”？此操作不可撤销。`)) return
    setBusy(true)
    setError('')
    try {
      const deleted = await canvasWorkflowApi.delete(selected.id)
      if (!deleted) throw new Error('删除画布工作流失败')
      setWorkflows((current) => current.filter((workflow) => workflow.id !== selected.id))
      setTotal((current) => Math.max(0, current - 1))
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除画布工作流失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`canvas-workflow-drawer-layer${dragging ? ' is-dragging' : ''}`}>
      <button
        type="button"
        className="canvas-workflow-drawer-scrim"
        aria-label="关闭画布工作流遮罩"
        tabIndex={-1}
        onClick={onClose}
      />
      <aside
        ref={dialogRef}
        className="canvas-workflow-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="canvas-workflow-drawer-title"
      >
        <header>
          <div>
            <span>CANVAS WORKFLOW</span>
            <h2 id="canvas-workflow-drawer-title">画布工作流</h2>
            <p>{projectName}</p>
          </div>
          <button
            ref={closeButtonRef}
            data-dialog-initial-focus
            type="button"
            aria-label="关闭画布工作流"
            onClick={onClose}
          >
            <Icons.X size={16} />
          </button>
        </header>

        <div className="canvas-workflow-drawer-actions">
          <button
            type="button"
            className="is-primary"
            aria-label="从当前选区提取工作流"
            disabled={selectedNodeCount < 2}
            onClick={onExtractSelection}
          >
            <Icons.Sparkles size={15} />
            从选区提取
          </button>
          <button type="button" disabled={busy} onClick={() => void createBlankProjectWorkflow()}>
            <Icons.Plus size={15} />
            新建空白
          </button>
        </div>

        <div className="canvas-workflow-drawer-scopes" role="tablist" aria-label="画布工作流范围">
          {(
            [
              ['all', '全部', '查看全部画布工作流'],
              ['project', '当前项目', '查看当前项目工作流'],
              ['library', '个人库', '查看个人工作流'],
              ['builtin', '模板', '查看内置模板'],
            ] as const
          ).map(([value, label, ariaLabel]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={scope === value}
              aria-label={ariaLabel}
              className={scope === value ? 'is-active' : ''}
              onClick={() => setScope(value)}
            >
              {label}
            </button>
          ))}
        </div>

        <label className="canvas-workflow-drawer-search">
          <Icons.Search size={14} aria-hidden="true" />
          <input
            aria-label="搜索项目画布工作流"
            value={query}
            placeholder="搜索工作流"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        {error && (
          <div className="canvas-workflow-drawer-error" role="alert">
            {error}
          </div>
        )}

        <div
          className="canvas-workflow-drawer-list"
          data-load-state={loading ? 'loading' : hasLoaded ? 'ready' : 'idle'}
        >
          {loading ? (
            <div className="canvas-workflow-drawer-empty">正在加载…</div>
          ) : visible.length === 0 ? (
            <div className="canvas-workflow-drawer-empty">
              <Icons.Workflow size={22} />
              <strong>{scope === 'project' ? '项目还没有工作流' : '这里还没有可用工作流'}</strong>
            </div>
          ) : (
            <>
              {visible.map((workflow) => (
                <button
                  key={workflow.id}
                  type="button"
                  draggable
                  aria-label={`选择${workflow.name}`}
                  aria-pressed={workflow.id === selectedId}
                  className={workflow.id === selectedId ? 'is-selected' : ''}
                  onClick={() => setSelectedId(workflow.id)}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'copy'
                    event.dataTransfer.setData(CANVAS_WORKFLOW_DRAG_TYPE, workflow.id)
                    setDragging(true)
                  }}
                  onDragEnd={() => setDragging(false)}
                >
                  <span className="canvas-workflow-drawer-item-icon">
                    <Icons.Workflow size={15} />
                  </span>
                  <span>
                    <strong>{workflow.name}</strong>
                    <small>
                      {workflowScopeLabel(workflow, projectId)} ·{' '}
                      {workflow.package.graph.nodes.length} 节点 ·{' '}
                      {workflow.package.contract.inputs.length} 输入 ·{' '}
                      {workflow.package.contract.outputs.length} 输出
                    </small>
                  </span>
                  <em>v{workflow.version}</em>
                </button>
              ))}
              <div className="canvas-workflow-drawer-pagination">
                <span>
                  {visible.length} / {total}
                </span>
                {hasMore && (
                  <button
                    type="button"
                    aria-label="加载更多当前范围工作流"
                    disabled={loadingMore}
                    onClick={() => void load(visible.length)}
                  >
                    {loadingMore ? '正在加载…' : '加载更多'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <footer>
          {selected ? (
            <>
              <div>
                <strong>{selected.name}</strong>
                <span>{selected.description || '暂无说明'}</span>
              </div>
              <div className="canvas-workflow-drawer-footer-actions">
                {selected.scope !== 'builtin' && (
                  <button
                    type="button"
                    aria-label={`删除${selected.name}`}
                    disabled={busy}
                    onClick={() => void deleteSelected()}
                  >
                    <Icons.Trash size={14} />
                    删除
                  </button>
                )}
                {selected.scope === 'project' && (
                  <button
                    type="button"
                    aria-label="从当前选区更新工作流"
                    disabled={selectedNodeCount < 2}
                    onClick={() => onUpdateFromSelection(selected)}
                  >
                    <Icons.RotateCcw size={14} />
                    以选区更新
                  </button>
                )}
                <button
                  type="button"
                  className="is-primary"
                  aria-label={`添加${selected.name}到画布`}
                  disabled={busy || selected.package.graph.nodes.length === 0}
                  onClick={() => onAddWorkflow(selected)}
                >
                  <Icons.Plus size={14} />
                  添加到画布
                </button>
              </div>
            </>
          ) : (
            <span>选择一个工作流查看操作</span>
          )}
        </footer>
      </aside>
    </div>
  )
}
