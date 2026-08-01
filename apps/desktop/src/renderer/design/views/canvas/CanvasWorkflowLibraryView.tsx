import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  CanvasWorkflowDefinition,
  CanvasWorkflowPackage,
  CanvasWorkflowRun,
  CanvasWorkflowScope,
  CanvasWorkflowVersion,
} from '@spark/protocol'
import { Icons } from '../../Icons'
import type { CanvasProject } from './canvas.types'
import { useCanvasProjects } from './canvas.store'
import { canvasWorkflowApi } from './canvasWorkflow.api'
import { buildCanvasWorkflowExport, parseCanvasWorkflowImport } from './canvasWorkflowTransfer'
import { useApp } from '../../AppContext'
import { SidebarExpandButton } from '../../SidebarExpandButton'
import './canvas-workflow.less'
import { Button } from  '@lobehub/ui'

type ScopeFilter = 'all' | CanvasWorkflowScope | 'archived'
const WORKFLOW_PAGE_SIZE = 30

const EMPTY_WORKFLOW_PACKAGE: CanvasWorkflowPackage = {
  schemaVersion: 1,
  graph: { nodes: [], edges: [] },
  contract: { inputs: [], outputs: [], exposedParams: [] },
  dependencies: { modelCapabilities: [], canvasNodeKinds: [] },
}

const scopeLabels: Record<CanvasWorkflowScope, string> = {
  project: '项目工作流',
  library: '个人工作流',
  builtin: '内置模板',
}

function workflowTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    text: '文本',
    image: '图片',
    video: '视频',
    audio: '音频',
    file: '文件',
    asset: '资产',
    node: '节点',
    structured: '结构化数据',
  }
  return labels[type] ?? type
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function CanvasWorkflowLibraryView({
  projects: projectsProp,
}: {
  projects?: CanvasProject[]
}) {
  // 作为独立 view 使用时不传 projects，自己从 store 获取；
  // 保留 prop 向后兼容（CanvasProjectsView 等仍可显式传入）。
  const { projects: projectsFromStore } = useCanvasProjects()
  const projects = projectsProp ?? projectsFromStore
  const { t, setTweak } = useApp()
  const [workflows, setWorkflows] = useState<CanvasWorkflowDefinition[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [scope, setScope] = useState<ScopeFilter>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [createScope, setCreateScope] = useState<'library' | 'project'>('library')
  const [createProjectId, setCreateProjectId] = useState(projects[0]?.id ?? '')
  const [saving, setSaving] = useState(false)
  const [targetProjectId, setTargetProjectId] = useState(projects[0]?.id ?? '')
  const [detailTab, setDetailTab] = useState<'overview' | 'versions' | 'runs'>('overview')
  const [versions, setVersions] = useState<CanvasWorkflowVersion[]>([])
  const [runs, setRuns] = useState<CanvasWorkflowRun[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [actionBusy, setActionBusy] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  const loadSequenceRef = useRef(0)

  const load = useCallback(
    async (offset = 0) => {
      const reset = offset === 0
      const sequence = ++loadSequenceRef.current
      if (reset) setLoading(true)
      else setLoadingMore(true)
      setError('')
      try {
        const response = await canvasWorkflowApi.listPage({
          ...(scope !== 'all' && scope !== 'archived' ? { scope } : {}),
          ...(scope === 'archived' ? { status: 'archived' as const, includeArchived: true } : {}),
          ...(query.trim() ? { query: query.trim() } : {}),
          limit: WORKFLOW_PAGE_SIZE,
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
        }
      }
    },
    [query, scope],
  )

  useEffect(() => {
    void load()
  }, [load])

  const visibleWorkflows = workflows

  useEffect(() => {
    if (visibleWorkflows.length === 0) {
      setSelectedId(null)
      return
    }
    if (!selectedId || !visibleWorkflows.some((workflow) => workflow.id === selectedId)) {
      setSelectedId(visibleWorkflows[0]!.id)
    }
  }, [selectedId, visibleWorkflows])

  const selected = workflows.find((workflow) => workflow.id === selectedId) ?? null

  useEffect(() => {
    if (!selected) {
      setVersions([])
      setRuns([])
      return
    }
    setEditName(selected.name)
    setEditDescription(selected.description ?? '')
    setEditOpen(false)
    setDetailLoading(true)
    void Promise.all([
      canvasWorkflowApi.listVersions(selected.id, 50, 0),
      canvasWorkflowApi.listRuns({ workflowId: selected.id, limit: 50, offset: 0 }),
    ])
      .then(([nextVersions, nextRuns]) => {
        setVersions(nextVersions)
        setRuns(nextRuns)
      })
      .catch((detailError) => {
        setError(detailError instanceof Error ? detailError.message : '加载版本或运行记录失败')
      })
      .finally(() => setDetailLoading(false))
  }, [selected?.id])
  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  )
  const createWorkflow = async () => {
    const name = createName.trim()
    if (!name || (createScope === 'project' && !createProjectId)) return
    setSaving(true)
    setError('')
    try {
      const workflow = await canvasWorkflowApi.create({
        name,
        description: createDescription.trim() || null,
        scope: createScope,
        ...(createScope === 'project' ? { projectId: createProjectId } : {}),
        package: EMPTY_WORKFLOW_PACKAGE,
      })
      setWorkflows((current) => [workflow, ...current])
      setSelectedId(workflow.id)
      setScope(workflow.scope)
      setCreateOpen(false)
      setCreateName('')
      setCreateDescription('')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '创建画布工作流失败')
    } finally {
      setSaving(false)
    }
  }

  const archiveSelected = async () => {
    if (!selected || selected.scope === 'builtin') return
    const updated = await canvasWorkflowApi.archive({
      id: selected.id,
      archived: selected.status !== 'archived',
    })
    const leavesCurrentFilter =
      (scope === 'archived' && updated.status !== 'archived') ||
      (scope !== 'archived' && updated.status === 'archived')
    setWorkflows((current) =>
      leavesCurrentFilter
        ? current.filter((workflow) => workflow.id !== updated.id)
        : current.map((workflow) => (workflow.id === updated.id ? updated : workflow)),
    )
    if (leavesCurrentFilter) setTotal((current) => Math.max(0, current - 1))
  }

  const deleteSelected = async () => {
    if (!selected || selected.scope === 'builtin') return
    if (!window.confirm(`删除画布工作流“${selected.name}”？此操作不可撤销。`)) return
    const deleted = await canvasWorkflowApi.delete(selected.id)
    if (deleted)
      setWorkflows((current) => current.filter((workflow) => workflow.id !== selected.id))
    if (deleted) setTotal((current) => Math.max(0, current - 1))
  }

  const applyToProject = async () => {
    if (!selected || !targetProjectId) return
    if (selected.scope === 'project' && selected.projectId === targetProjectId) {
      await window.spark.invoke('canvas:window:open', { projectId: targetProjectId })
      return
    }
    const copy = await canvasWorkflowApi.duplicate({
      id: selected.id,
      targetScope: 'project',
      targetProjectId,
      name: selected.name,
    })
    setWorkflows((current) => [copy, ...current])
    setSelectedId(copy.id)
    setScope('project')
  }

  const saveSelectedDetails = async () => {
    if (!selected || selected.scope === 'builtin' || !editName.trim()) return
    setActionBusy(true)
    setError('')
    try {
      const updated = await canvasWorkflowApi.update({
        id: selected.id,
        name: editName.trim(),
        description: editDescription.trim() || null,
      })
      setWorkflows((current) =>
        current.map((workflow) => (workflow.id === updated.id ? updated : workflow)),
      )
      setEditOpen(false)
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : '保存工作流详情失败')
    } finally {
      setActionBusy(false)
    }
  }

  const publishSelected = async () => {
    if (!selected || selected.scope === 'builtin' || selected.package.graph.nodes.length === 0)
      return
    setActionBusy(true)
    setError('')
    try {
      const result = await canvasWorkflowApi.publish(selected.id)
      setWorkflows((current) =>
        current.map((workflow) =>
          workflow.id === result.workflow.id ? result.workflow : workflow,
        ),
      )
      setVersions((current) => [
        result.version,
        ...current.filter((item) => item.version !== result.version.version),
      ])
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : '发布画布工作流失败')
    } finally {
      setActionBusy(false)
    }
  }

  const exportSelected = () => {
    if (!selected) return
    const payload = buildCanvasWorkflowExport(selected)
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${selected.name.replace(/[\\/:*?"<>|]/g, '-')}.canvas-workflow.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const importWorkflow = async (file: File) => {
    setActionBusy(true)
    setError('')
    try {
      const importedPayload = parseCanvasWorkflowImport(await file.text())
      const imported = await canvasWorkflowApi.create({
        name: importedPayload.name,
        description: importedPayload.description,
        scope: 'library',
        tags: importedPayload.tags,
        package: importedPayload.package,
      })
      setWorkflows((current) => [imported, ...current])
      setSelectedId(imported.id)
      setScope('library')
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : '导入画布工作流失败')
    } finally {
      setActionBusy(false)
      if (importInputRef.current) importInputRef.current.value = ''
    }
  }

  return (
    <section className="canvas-workflow-library" aria-label="画布工作流">
      <header
        className="canvas-workflow-page-header canvas-view-titlebar"
        onDoubleClick={() => {
          window.spark?.invoke('window:maximize', {}).catch(() => {})
        }}
      >
        {t.sidebarHidden && <SidebarExpandButton />}
        <button
          type="button"
          className="canvas-workflow-back-btn"
          onClick={() => setTweak('view', 'canvas')}
          aria-label="返回画布项目"
        >
          <Icons.ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} />
          <span>返回项目</span>
        </button>
        <h2>画布工作流</h2>
      </header>
      <div className="canvas-workflow-library-toolbar">
        <label className="canvas-workflow-search">
          <Icons.Search size={15} aria-hidden="true" />
          <input
            aria-label="搜索画布工作流"
            value={query}
            placeholder="搜索名称、用途或标签"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void importWorkflow(file)
          }}
        />
        <div>
          <Button
            aria-label="导入画布工作流"
            size='middle'
            style={{marginRight: 12}}
            disabled={actionBusy}
            onClick={() => importInputRef.current?.click()}
          >
            <Icons.Upload size={15} /> 导入
          </Button>
          <Button
            size='middle'
            aria-label="新建画布工作流"
            onClick={() => setCreateOpen(true)}
          >
            <Icons.Plus size={15} />
            新建工作流
          </Button>
        </div>
      </div>

      {error && (
        <div className="canvas-workflow-alert" role="alert">
          {error}
        </div>
      )}

      <div className="canvas-workflow-library-layout">
        <nav className="canvas-workflow-scope-nav" aria-label="工作流范围">
          {(
            [
              ['all', '全部工作流', '显示全部画布工作流'],
              ['project', '项目工作流', '只看项目工作流'],
              ['library', '个人工作流', '只看个人工作流'],
              ['builtin', '内置模板', '只看内置模板'],
              ['archived', '已归档', '只看已归档工作流'],
            ] as const
          ).map(([value, label, ariaLabel]) => (
            <button
              key={value}
              type="button"
              className={scope === value ? 'is-active' : ''}
              aria-label={ariaLabel}
              aria-current={scope === value ? 'page' : undefined}
              onClick={() => setScope(value)}
            >
              <span>{label}</span>
              {scope === value && <small>{total}</small>}
            </button>
          ))}
        </nav>

        <div className="canvas-workflow-list" aria-live="polite">
          {loading ? (
            <div className="canvas-workflow-empty">正在加载画布工作流…</div>
          ) : visibleWorkflows.length === 0 ? (
            <div className="canvas-workflow-empty">
              <Icons.Workflow size={24} />
              <strong>{query ? '没有匹配的画布工作流' : '这里还没有画布工作流'}</strong>
              <span>从当前画布选区提取，或新建一个空白草稿。</span>
            </div>
          ) : (
            <>
              {visibleWorkflows.map((workflow) => (
                <button
                  key={workflow.id}
                  type="button"
                  className={`canvas-workflow-list-item${selectedId === workflow.id ? ' is-selected' : ''}`}
                  aria-pressed={selectedId === workflow.id}
                  onClick={() => setSelectedId(workflow.id)}
                >
                  <span className="canvas-workflow-list-icon" aria-hidden="true">
                    <Icons.Workflow size={16} />
                  </span>
                  <span className="canvas-workflow-list-copy">
                    <span className="canvas-workflow-list-title">
                      <strong>{workflow.name}</strong>
                      <small>v{workflow.version}</small>
                    </span>
                    <span className="canvas-workflow-list-description">
                      {workflow.description || '暂无说明'}
                    </span>
                    <span className="canvas-workflow-list-meta">
                      {scopeLabels[workflow.scope]}
                      {workflow.projectId
                        ? ` · ${projectById.get(workflow.projectId)?.title ?? '未知项目'}`
                        : ''}
                      {' · '}
                      {workflow.package.contract.inputs.length} 输入 /{' '}
                      {workflow.package.contract.outputs.length} 输出
                    </span>
                  </span>
                  <time dateTime={workflow.updatedAt}>{formatUpdatedAt(workflow.updatedAt)}</time>
                </button>
              ))}
              <div className="canvas-workflow-pagination">
                <span>
                  已显示 {visibleWorkflows.length} / {total}
                </span>
                {hasMore && (
                  <button
                    type="button"
                    aria-label="加载更多画布工作流"
                    disabled={loadingMore}
                    onClick={() => void load(visibleWorkflows.length)}
                  >
                    {loadingMore ? '正在加载…' : '加载更多'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <aside className="canvas-workflow-detail" aria-label="工作流详情摘要">
          {selected ? (
            <>
              <div className="canvas-workflow-detail-heading">
                <span className={`canvas-workflow-scope-badge scope-${selected.scope}`}>
                  {scopeLabels[selected.scope]}
                </span>
                <h3>{selected.name}</h3>
                <p>{selected.description || '暂无说明'}</p>
                {selected.scope !== 'builtin' && (
                  <button
                    type="button"
                    aria-label="编辑工作流详情"
                    onClick={() => setEditOpen((current) => !current)}
                  >
                    <Icons.Pencil size={13} /> 编辑
                  </button>
                )}
              </div>

              {editOpen && (
                <div className="canvas-workflow-detail-edit">
                  <label>
                    名称
                    <input
                      aria-label="编辑工作流名称"
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                    />
                  </label>
                  <label>
                    说明
                    <textarea
                      rows={3}
                      value={editDescription}
                      onChange={(event) => setEditDescription(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    aria-label="保存工作流详情"
                    disabled={actionBusy || !editName.trim()}
                    onClick={() => void saveSelectedDetails()}
                  >
                    <Icons.Check size={13} /> 保存
                  </button>
                </div>
              )}

              <div
                className="canvas-workflow-detail-tabs"
                role="tablist"
                aria-label="工作流详情视图"
              >
                {(
                  [
                    ['overview', '概览'],
                    ['versions', `版本 ${versions.length}`],
                    ['runs', `运行 ${runs.length}`],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={detailTab === value}
                    onClick={() => setDetailTab(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {detailTab === 'overview' && (
                <>
                  <div className="canvas-workflow-contract">
                    <section>
                      <h4>输入</h4>
                      {selected.package.contract.inputs.length > 0 ? (
                        selected.package.contract.inputs.map((input) => (
                          <div key={input.id}>
                            <strong>{input.name}</strong>
                            <span>{workflowTypeLabel(input.valueType)}</span>
                          </div>
                        ))
                      ) : (
                        <p>尚未定义输入</p>
                      )}
                    </section>
                    <section>
                      <h4>输出</h4>
                      {selected.package.contract.outputs.length > 0 ? (
                        selected.package.contract.outputs.map((output) => (
                          <div key={output.id}>
                            <strong>{output.name}</strong>
                            <span>{workflowTypeLabel(output.valueType)}</span>
                          </div>
                        ))
                      ) : (
                        <p>尚未定义输出</p>
                      )}
                    </section>
                  </div>

                  <dl className="canvas-workflow-facts">
                    <div>
                      <dt>节点</dt>
                      <dd>{selected.package.graph.nodes.length}</dd>
                    </div>
                    <div>
                      <dt>版本</dt>
                      <dd>v{selected.version}</dd>
                    </div>
                    <div>
                      <dt>状态</dt>
                      <dd>
                        {selected.status === 'archived'
                          ? '已归档'
                          : selected.status === 'published'
                            ? '已发布'
                            : '草稿'}
                      </dd>
                    </div>
                  </dl>

                  {selected.scope !== 'builtin' && (
                    <button
                      type="button"
                      className="canvas-workflow-publish-button"
                      aria-label="发布画布工作流"
                      disabled={actionBusy || selected.package.graph.nodes.length === 0}
                      onClick={() => void publishSelected()}
                    >
                      <Icons.Upload size={14} />
                      {selected.status === 'published' ? '重新发布当前版本' : '发布当前版本'}
                    </button>
                  )}

                  <div className="canvas-workflow-project-target">
                    <label htmlFor="canvas-workflow-target-project">使用到项目</label>
                    <select
                      id="canvas-workflow-target-project"
                      value={targetProjectId}
                      onChange={(event) => setTargetProjectId(event.target.value)}
                    >
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.title}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!targetProjectId}
                      onClick={() => void applyToProject()}
                    >
                      <Icons.ArrowRight size={15} />
                      {selected.scope === 'project' && selected.projectId === targetProjectId
                        ? '打开项目'
                        : '添加到项目'}
                    </button>
                  </div>

                  <button
                    type="button"
                    className="canvas-workflow-export-button"
                    aria-label="导出画布工作流"
                    onClick={exportSelected}
                  >
                    <Icons.Download size={14} /> 导出 JSON
                  </button>

                  {selected.scope !== 'builtin' && (
                    <div className="canvas-workflow-secondary-actions">
                      <button type="button" onClick={() => void archiveSelected()}>
                        <Icons.Archive size={14} />
                        {selected.status === 'archived' ? '恢复草稿' : '归档'}
                      </button>
                      <button
                        type="button"
                        className="is-danger"
                        onClick={() => void deleteSelected()}
                      >
                        <Icons.Trash size={14} />
                        删除
                      </button>
                    </div>
                  )}
                </>
              )}

              {detailTab === 'versions' && (
                <div className="canvas-workflow-history-list">
                  {detailLoading ? (
                    <p>正在加载版本…</p>
                  ) : versions.length === 0 ? (
                    <p>暂无版本快照</p>
                  ) : (
                    versions.map((version) => (
                      <div key={version.version}>
                        <strong>
                          v{version.version} · {version.name}
                        </strong>
                        <span>
                          {version.package.graph.nodes.length} 节点 ·{' '}
                          {formatUpdatedAt(version.createdAt)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}

              {detailTab === 'runs' && (
                <div className="canvas-workflow-history-list">
                  {detailLoading ? (
                    <p>正在加载运行记录…</p>
                  ) : runs.length === 0 ? (
                    <p>暂无运行记录</p>
                  ) : (
                    runs.map((run) => (
                      <div key={run.id}>
                        <strong>
                          {run.status} · v{run.workflowVersion}
                        </strong>
                        <span>
                          {run.steps.filter((step) => step.status === 'completed').length}/
                          {run.steps.length} 步骤 · {formatUpdatedAt(run.createdAt)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="canvas-workflow-detail-placeholder">选择一个工作流查看契约和依赖</div>
          )}
        </aside>
      </div>

      {createOpen && (
        <div className="canvas-workflow-modal-backdrop">
          <div
            className="canvas-workflow-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="canvas-workflow-create-title"
          >
            <div className="canvas-workflow-modal-header">
              <div>
                <span>CANVAS WORKFLOW</span>
                <h3 id="canvas-workflow-create-title">新建画布工作流</h3>
              </div>
              <button
                type="button"
                aria-label="关闭新建工作流对话框"
                onClick={() => setCreateOpen(false)}
              >
                <Icons.X size={16} />
              </button>
            </div>
            <div className="canvas-workflow-modal-body">
              <label>
                工作流名称
                <input
                  aria-label="工作流名称"
                  autoFocus
                  value={createName}
                  onChange={(event) => setCreateName(event.target.value)}
                />
              </label>
              <label>
                说明
                <textarea
                  value={createDescription}
                  rows={3}
                  onChange={(event) => setCreateDescription(event.target.value)}
                />
              </label>
              <fieldset>
                <legend>保存范围</legend>
                <label>
                  <input
                    type="radio"
                    name="canvas-workflow-scope"
                    checked={createScope === 'library'}
                    onChange={() => setCreateScope('library')}
                  />
                  个人工作流
                </label>
                <label>
                  <input
                    type="radio"
                    name="canvas-workflow-scope"
                    checked={createScope === 'project'}
                    onChange={() => setCreateScope('project')}
                  />
                  项目工作流
                </label>
              </fieldset>
              {createScope === 'project' && (
                <label>
                  所属项目
                  <select
                    value={createProjectId}
                    onChange={(event) => setCreateProjectId(event.target.value)}
                  >
                    <option value="">选择项目</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div className="canvas-workflow-modal-footer">
              <button type="button" onClick={() => setCreateOpen(false)}>
                取消
              </button>
              <button
                type="button"
                className="canvas-workflow-primary-button"
                aria-label="创建工作流草稿"
                disabled={
                  saving || !createName.trim() || (createScope === 'project' && !createProjectId)
                }
                onClick={() => void createWorkflow()}
              >
                {saving ? '创建中…' : '创建草稿'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
