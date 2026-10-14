import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  CanvasWorkflowDefinition,
  CanvasWorkflowPackage,
  CanvasWorkflowRun,
  CanvasWorkflowScope,
  CanvasWorkflowVersion,
} from '@spark/protocol'
import { Icons } from '../../Icons'
import { translate, useI18n } from '../../i18n'
import type { CanvasProject } from './canvas.types'
import { useCanvasProjects } from './canvas.store'
import { canvasWorkflowApi } from './canvasWorkflow.api'
import { buildCanvasWorkflowExport, parseCanvasWorkflowImport } from './canvasWorkflowTransfer'
import { useApp } from '../../AppContext'
import { SidebarExpandButton } from '../../SidebarExpandButton'
import './canvas-workflow.less'
import { Button } from '@lobehub/ui'

type ScopeFilter = 'all' | CanvasWorkflowScope | 'archived'
const WORKFLOW_PAGE_SIZE = 30

const EMPTY_WORKFLOW_PACKAGE: CanvasWorkflowPackage = {
  schemaVersion: 1,
  graph: { nodes: [], edges: [] },
  contract: { inputs: [], outputs: [], exposedParams: [] },
  dependencies: { modelCapabilities: [], canvasNodeKinds: [] },
}

const scopeLabels: Record<CanvasWorkflowScope, string> = {
  project: translate('canvasWorkflowLibrary.t1'),
  library: translate('canvasWorkflowLibrary.t2'),
  builtin: translate('canvasWorkflowLibrary.t3'),
}

function workflowTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    text: translate('canvasWorkflowLibrary.t4'),
    image: translate('canvasWorkflowLibrary.t5'),
    video: translate('canvasWorkflowLibrary.t6'),
    audio: translate('canvasWorkflowLibrary.t7'),
    file: translate('canvasWorkflowLibrary.t8'),
    asset: translate('canvasWorkflowLibrary.t9'),
    node: translate('canvasWorkflowLibrary.t10'),
    structured: translate('canvasWorkflowLibrary.t11'),
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
  // 本文件使用非响应式 translate()：顶层订阅语言变化，保证切换语言后整树重渲染。
  useI18n()
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
        setError(loadError instanceof Error ? loadError.message : translate('canvasWorkflowLibrary.t12'))
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
        setError(detailError instanceof Error ? detailError.message : translate('canvasWorkflowLibrary.t13'))
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
      setError(saveError instanceof Error ? saveError.message : translate('canvasWorkflowLibrary.t14'))
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
    if (!window.confirm(translate('canvasWorkflowLibrary.tpl1Desc', { name: selected.name }))) return
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
      setError(updateError instanceof Error ? updateError.message : translate('canvasWorkflowLibrary.t15'))
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
      setError(publishError instanceof Error ? publishError.message : translate('canvasWorkflowLibrary.t16'))
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
      setError(importError instanceof Error ? importError.message : translate('canvasWorkflowLibrary.t17'))
    } finally {
      setActionBusy(false)
      if (importInputRef.current) importInputRef.current.value = ''
    }
  }

  return (
    <section className="canvas-workflow-library" aria-label={translate('canvasWorkflowLibrary.t42')}>
      <header
        className="canvas-workflow-page-header canvas-view-titlebar"
        onDoubleClick={(event) => {
          const target = event.target
          if (
            target instanceof Element &&
            target.closest('button, input, textarea, select, a, [role="button"]')
          ) {
            return
          }
          window.spark?.invoke('window:maximize', {}).catch(() => {})
        }}
      >
        {t.sidebarHidden && <SidebarExpandButton />}
        <button
          type="button"
          className="canvas-workflow-back-btn"
          onClick={() => setTweak('view', 'canvas')}
          aria-label={translate('canvasWorkflowLibrary.t43')}
        >
          <Icons.ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} />
          <span>{translate('canvasWorkflowLibrary.t60')}</span>
        </button>
        <div className="canvas-workflow-page-title">
          <span>{translate('canvasWorkflowLibrary.t61')}</span>
          <h2>{translate('canvasWorkflowLibrary.t42')}</h2>
        </div>
        <div className="canvas-workflow-page-actions">
          <label className="canvas-workflow-search">
            <Icons.Search size={15} aria-hidden="true" />
            <input
              aria-label={translate('canvasWorkflowLibrary.t44')}
              value={query}
              placeholder={translate('canvasWorkflowLibrary.t45')}
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
          <div className="canvas-workflow-page-action-buttons">
            <Button
              aria-label={translate('canvasWorkflowLibrary.t46')}
              size="small"
              disabled={actionBusy}
              onClick={() => importInputRef.current?.click()}
            >
              <Icons.Upload size={15} /> {translate('canvasWorkflowLibrary.t62')}
            </Button>
            <Button size="small" aria-label={translate('canvasWorkflowLibrary.t47')} onClick={() => setCreateOpen(true)}>
              <Icons.Plus size={15} />
              {translate('canvasWorkflowLibrary.t63')}
            </Button>
          </div>
        </div>
      </header>

      {error && (
        <div className="canvas-workflow-alert" role="alert">
          {error}
        </div>
      )}

      <div className="canvas-workflow-library-layout">
        <nav className="canvas-workflow-scope-nav" aria-label={translate('canvasWorkflowLibrary.t48')}>
          {(
            [
              ['all', translate('canvasWorkflowLibrary.t18'), translate('canvasWorkflowLibrary.t19')],
              ['project', translate('canvasWorkflowLibrary.t1'), translate('canvasWorkflowLibrary.t20')],
              ['library', translate('canvasWorkflowLibrary.t2'), translate('canvasWorkflowLibrary.t21')],
              ['builtin', translate('canvasWorkflowLibrary.t3'), translate('canvasWorkflowLibrary.t22')],
              ['archived', translate('canvasWorkflowLibrary.t23'), translate('canvasWorkflowLibrary.t24')],
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
            <div className="canvas-workflow-empty">{translate('canvasWorkflowLibrary.t64')}</div>
          ) : visibleWorkflows.length === 0 ? (
            <div className="canvas-workflow-empty">
              <Icons.Workflow size={24} />
              <strong>{query ? translate('canvasWorkflowLibrary.t25') : translate('canvasWorkflowLibrary.t26')}</strong>
              <span>{translate('canvasWorkflowLibrary.t65Desc')}</span>
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
                      {workflow.description || translate('canvasWorkflowLibrary.t27')}
                    </span>
                    <span className="canvas-workflow-list-meta">
                      {scopeLabels[workflow.scope]}
                      {workflow.projectId
                        ? ` · ${projectById.get(workflow.projectId)?.title ?? translate('canvasWorkflowLibrary.t28')}`
                        : ''}
                      {' · '}
                      {translate('canvasWorkflowLibrary.tpl2Desc', {
                        inputs: workflow.package.contract.inputs.length,
                        outputs: workflow.package.contract.outputs.length,
                      })}
                    </span>
                  </span>
                  <time dateTime={workflow.updatedAt}>{formatUpdatedAt(workflow.updatedAt)}</time>
                </button>
              ))}
              <div className="canvas-workflow-pagination">
                <span>
                  {translate('canvasWorkflowLibrary.tpl3Desc', { shown: visibleWorkflows.length, total })}
                </span>
                {hasMore && (
                  <button
                    type="button"
                    aria-label={translate('canvasWorkflowLibrary.t49')}
                    disabled={loadingMore}
                    onClick={() => void load(visibleWorkflows.length)}
                  >
                    {loadingMore ? translate('canvasWorkflowLibrary.t29') : translate('canvasWorkflowLibrary.t30')}
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <aside className="canvas-workflow-detail" aria-label={translate('canvasWorkflowLibrary.t50')}>
          {selected ? (
            <>
              <div className="canvas-workflow-detail-heading">
                <span className={`canvas-workflow-scope-badge scope-${selected.scope}`}>
                  {scopeLabels[selected.scope]}
                </span>
                <h3>{selected.name}</h3>
                <p>{selected.description || translate('canvasWorkflowLibrary.t27')}</p>
                {selected.scope !== 'builtin' && (
                  <button
                    type="button"
                    aria-label={translate('canvasWorkflowLibrary.t51')}
                    onClick={() => setEditOpen((current) => !current)}
                  >
                    <Icons.Pencil size={13} /> {translate('canvasWorkflowLibrary.t66')}
                  </button>
                )}
              </div>

              {editOpen && (
                <div className="canvas-workflow-detail-edit">
                  <label>
                    {translate('canvasWorkflowLibrary.t67')}
                    <input
                      aria-label={translate('canvasWorkflowLibrary.t52')}
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                    />
                  </label>
                  <label>
                    {translate('canvasWorkflowLibrary.t68')}
                    <textarea
                      rows={3}
                      value={editDescription}
                      onChange={(event) => setEditDescription(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    aria-label={translate('canvasWorkflowLibrary.t53')}
                    disabled={actionBusy || !editName.trim()}
                    onClick={() => void saveSelectedDetails()}
                  >
                    <Icons.Check size={13} /> {translate('canvasWorkflowLibrary.t69')}
                  </button>
                </div>
              )}

              <div
                className="canvas-workflow-detail-tabs"
                role="tablist"
                aria-label={translate('canvasWorkflowLibrary.t54')}
              >
                {(
                  [
                    ['overview', translate('canvasWorkflowLibrary.t31')],
                    ['versions', translate('canvasWorkflowLibrary.tpl4Desc', { count: versions.length })],
                    ['runs', translate('canvasWorkflowLibrary.tpl5Desc', { count: runs.length })],
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
                      <h4>{translate('canvasWorkflowLibrary.t70')}</h4>
                      {selected.package.contract.inputs.length > 0 ? (
                        selected.package.contract.inputs.map((input) => (
                          <div key={input.id}>
                            <strong>{input.name}</strong>
                            <span>{workflowTypeLabel(input.valueType)}</span>
                          </div>
                        ))
                      ) : (
                        <p>{translate('canvasWorkflowLibrary.t71')}</p>
                      )}
                    </section>
                    <section>
                      <h4>{translate('canvasWorkflowLibrary.t72')}</h4>
                      {selected.package.contract.outputs.length > 0 ? (
                        selected.package.contract.outputs.map((output) => (
                          <div key={output.id}>
                            <strong>{output.name}</strong>
                            <span>{workflowTypeLabel(output.valueType)}</span>
                          </div>
                        ))
                      ) : (
                        <p>{translate('canvasWorkflowLibrary.t73')}</p>
                      )}
                    </section>
                  </div>

                  <dl className="canvas-workflow-facts">
                    <div>
                      <dt>{translate('canvasWorkflowLibrary.t10')}</dt>
                      <dd>{selected.package.graph.nodes.length}</dd>
                    </div>
                    <div>
                      <dt>{translate('canvasWorkflowLibrary.t74')}</dt>
                      <dd>v{selected.version}</dd>
                    </div>
                    <div>
                      <dt>{translate('canvasWorkflowLibrary.t75')}</dt>
                      <dd>
                        {selected.status === 'archived'
                          ? translate('canvasWorkflowLibrary.t23')
                          : selected.status === 'published'
                            ? translate('canvasWorkflowLibrary.t32')
                            : translate('canvasWorkflowLibrary.t33')}
                      </dd>
                    </div>
                  </dl>

                  {selected.scope !== 'builtin' && (
                    <button
                      type="button"
                      className="canvas-workflow-publish-button"
                      aria-label={translate('canvasWorkflowLibrary.t55')}
                      disabled={actionBusy || selected.package.graph.nodes.length === 0}
                      onClick={() => void publishSelected()}
                    >
                      <Icons.Upload size={14} />
                      {selected.status === 'published' ? translate('canvasWorkflowLibrary.t34') : translate('canvasWorkflowLibrary.t35')}
                    </button>
                  )}

                  <div className="canvas-workflow-project-target">
                    <label htmlFor="canvas-workflow-target-project">{translate('canvasWorkflowLibrary.t76')}</label>
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
                        ? translate('canvasWorkflowLibrary.t36')
                        : translate('canvasWorkflowLibrary.t37')}
                    </button>
                  </div>

                  <button
                    type="button"
                    className="canvas-workflow-export-button"
                    aria-label={translate('canvasWorkflowLibrary.t56')}
                    onClick={exportSelected}
                  >
                    <Icons.Download size={14} /> {translate('canvasWorkflowLibrary.t77')}
                  </button>

                  {selected.scope !== 'builtin' && (
                    <div className="canvas-workflow-secondary-actions">
                      <button type="button" onClick={() => void archiveSelected()}>
                        <Icons.Archive size={14} />
                        {selected.status === 'archived' ? translate('canvasWorkflowLibrary.t38') : translate('canvasWorkflowLibrary.t39')}
                      </button>
                      <button
                        type="button"
                        className="is-danger"
                        onClick={() => void deleteSelected()}
                      >
                        <Icons.Trash size={14} />
                        {translate('canvasWorkflowLibrary.t78')}
                      </button>
                    </div>
                  )}
                </>
              )}

              {detailTab === 'versions' && (
                <div className="canvas-workflow-history-list">
                  {detailLoading ? (
                    <p>{translate('canvasWorkflowLibrary.t79')}</p>
                  ) : versions.length === 0 ? (
                    <p>{translate('canvasWorkflowLibrary.t80')}</p>
                  ) : (
                    versions.map((version) => (
                      <div key={version.version}>
                        <strong>
                          v{version.version} · {version.name}
                        </strong>
                        <span>
                          {translate('canvasWorkflowLibrary.tpl6Desc', { count: version.package.graph.nodes.length })}
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
                    <p>{translate('canvasWorkflowLibrary.t81')}</p>
                  ) : runs.length === 0 ? (
                    <p>{translate('canvasWorkflowLibrary.t82')}</p>
                  ) : (
                    runs.map((run) => (
                      <div key={run.id}>
                        <strong>
                          {run.status} · v{run.workflowVersion}
                        </strong>
                        <span>
                          {run.steps.filter((step) => step.status === 'completed').length}/
                          {translate('canvasWorkflowLibrary.tpl7Desc', { count: run.steps.length, time: formatUpdatedAt(run.createdAt) })}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="canvas-workflow-detail-placeholder">{translate('canvasWorkflowLibrary.t83Desc')}</div>
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
                <h3 id="canvas-workflow-create-title">{translate('canvasWorkflowLibrary.t47')}</h3>
              </div>
              <button
                type="button"
                aria-label={translate('canvasWorkflowLibrary.t57')}
                onClick={() => setCreateOpen(false)}
              >
                <Icons.X size={16} />
              </button>
            </div>
            <div className="canvas-workflow-modal-body">
              <label>
                {translate('canvasWorkflowLibrary.t58')}
                <input
                  aria-label={translate('canvasWorkflowLibrary.t58')}
                  autoFocus
                  value={createName}
                  onChange={(event) => setCreateName(event.target.value)}
                />
              </label>
              <label>
                {translate('canvasWorkflowLibrary.t68')}
                <textarea
                  value={createDescription}
                  rows={3}
                  onChange={(event) => setCreateDescription(event.target.value)}
                />
              </label>
              <fieldset>
                <legend>{translate('canvasWorkflowLibrary.t84')}</legend>
                <label>
                  <input
                    type="radio"
                    name="canvas-workflow-scope"
                    checked={createScope === 'library'}
                    onChange={() => setCreateScope('library')}
                  />
                  {translate('canvasWorkflowLibrary.t2')}
                </label>
                <label>
                  <input
                    type="radio"
                    name="canvas-workflow-scope"
                    checked={createScope === 'project'}
                    onChange={() => setCreateScope('project')}
                  />
                  {translate('canvasWorkflowLibrary.t1')}
                </label>
              </fieldset>
              {createScope === 'project' && (
                <label>
                  {translate('canvasWorkflowLibrary.t85')}
                  <select
                    value={createProjectId}
                    onChange={(event) => setCreateProjectId(event.target.value)}
                  >
                    <option value="">{translate('canvasWorkflowLibrary.t86')}</option>
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
                {translate('canvasWorkflowLibrary.t87')}
              </button>
              <button
                type="button"
                className="canvas-workflow-primary-button"
                aria-label={translate('canvasWorkflowLibrary.t59')}
                disabled={
                  saving || !createName.trim() || (createScope === 'project' && !createProjectId)
                }
                onClick={() => void createWorkflow()}
              >
                {saving ? translate('canvasWorkflowLibrary.t40') : translate('canvasWorkflowLibrary.t41')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
