import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, Modal, Select, Tag, Tooltip } from '@lobehub/ui'
import { Empty, Switch, message } from 'antd'
import type {
  CustomToolInvocationTrace,
  CustomToolHostVisionRouteCheckResult,
  CustomToolSummary,
  CustomToolTestRunResult,
  CustomToolWorkspace,
  ProviderProfile,
} from '@spark/protocol'
import { Icons } from '../Icons'
import { useApp } from '../AppContext'
import { useIpcInvoke, useIpcStream } from '../hooks/useIpc'
import { classNames } from '../utils/class-names'
import {
  buildCustomToolDraft,
  createCustomToolEditorDraft,
  editorDraftFromDraft,
  parseTestInput,
  requiresHttpTestConfirmation,
  secretNamesFromHeaders,
  type CustomToolEditorDraft,
  type CustomToolEditorKind,
} from './custom-tools-model'
import {
  customToolTypeLabel as typeLabel,
  formatCustomToolTime as formatUpdatedAt,
  preferredVisionProvider,
} from './custom-tools-ui'
import { CustomToolStudio } from './CustomToolStudio'
import { ToolPackagesPanel } from './ToolPackagesPanel'
import { ToolPackageImportModal } from './ToolPackageImportModal'
import { CustomToolCurlImportModal } from './CustomToolCurlImportModal'
import {
  consumePendingCustomToolTrace,
  OPEN_CUSTOM_TOOL_TRACE_EVENT,
  targetFromCustomToolTraceEvent,
  type CustomToolTraceTarget,
} from './customToolTraceNavigation'
import { CustomToolCreateSources, CustomToolTemplateSources } from './CustomToolCreateSources'
import './CustomToolsSection.less'

export function CustomToolsSection() {
  const { requestConfirm } = useApp()
  const [tools, setTools] = useState<CustomToolSummary[]>([])
  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [activeView, setActiveView] = useState<'tools' | 'packages' | 'drafts' | 'runs'>('tools')
  const [createOpen, setCreateOpen] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [curlImportOpen, setCurlImportOpen] = useState(false)
  const [packageImportOpen, setPackageImportOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editor, setEditor] = useState<CustomToolEditorDraft | null>(null)
  const [workspace, setWorkspace] = useState<CustomToolWorkspace | null>(null)
  const [traces, setTraces] = useState<CustomToolInvocationTrace[]>([])
  const [retentionDays, setRetentionDays] = useState(30)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [testing, setTesting] = useState(false)
  const [routeChecking, setRouteChecking] = useState(false)
  const [testResult, setTestResult] = useState<CustomToolTestRunResult | null>(null)
  const [routeCheckResult, setRouteCheckResult] =
    useState<CustomToolHostVisionRouteCheckResult | null>(null)
  const [focusedTraceId, setFocusedTraceId] = useState<number | null>(null)
  const editorRequestRef = useRef(0)

  const { invoke: listTools } = useIpcInvoke('custom-tools:list')
  const { invoke: getStudio } = useIpcInvoke('custom-tools:studio:get')
  const { invoke: createDraft } = useIpcInvoke('custom-tools:draft:create')
  const { invoke: saveDraft } = useIpcInvoke('custom-tools:draft:save')
  const { invoke: publishDraft } = useIpcInvoke('custom-tools:publish')
  const { invoke: rollbackVersion } = useIpcInvoke('custom-tools:rollback')
  const { invoke: listInvocations } = useIpcInvoke('custom-tools:invocations:list')
  const { invoke: setInvocationRetention } = useIpcInvoke('custom-tools:invocations:retention:set')
  const { invoke: clearInvocations } = useIpcInvoke('custom-tools:invocations:clear')
  const { invoke: exportTools } = useIpcInvoke('custom-tools:export')
  const { invoke: importTools } = useIpcInvoke('custom-tools:import')
  const { invoke: deleteTool } = useIpcInvoke('custom-tools:delete')
  const { invoke: setEnabled } = useIpcInvoke('custom-tools:set-enabled')
  const { invoke: testRun } = useIpcInvoke('custom-tools:test-run')
  const { invoke: checkHostVisionRoute } = useIpcInvoke('custom-tools:host-vision-route-check')
  const { invoke: writeSecret } = useIpcInvoke('custom-tools:write-secret')
  const { invoke: listProviders } = useIpcInvoke('provider:list')
  const { invoke: openFileDialog } = useIpcInvoke('dialog:open-file')
  const { invoke: saveFileDialog } = useIpcInvoke('dialog:save-file')
  const { invoke: readTextFile } = useIpcInvoke('file:read-text')
  const { invoke: writeTextFile } = useIpcInvoke('file:write-text')

  const refresh = useCallback(async () => {
    const [toolResult, providerResult] = await Promise.allSettled([
      listTools({}),
      listProviders({ includeDisabled: false }),
    ])
    if (toolResult.status === 'fulfilled') {
      setTools(toolResult.value.tools)
    } else {
      message.error(
        toolResult.reason instanceof Error ? toolResult.reason.message : '自定义工具加载失败',
      )
    }
    if (providerResult.status === 'fulfilled') {
      setProviders(providerResult.value.profiles)
    } else {
      message.error(
        providerResult.reason instanceof Error
          ? providerResult.reason.message
          : 'Provider 列表加载失败',
      )
    }
    setLoading(false)
  }, [listProviders, listTools])

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timer)
  }, [refresh])
  useIpcStream('stream:custom-tools:changed', () => {
    void refresh()
  })

  const visibleTools = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    const scoped =
      activeView === 'drafts'
        ? tools.filter((tool) => tool.hasUnpublishedDraft)
        : activeView === 'runs'
          ? []
          : tools
    if (!normalized) return scoped
    return scoped.filter((tool) =>
      [tool.id, tool.title, tool.description, typeLabel(tool.type)].some((value) =>
        value.toLowerCase().includes(normalized),
      ),
    )
  }, [activeView, query, tools])

  const refreshTraces = useCallback(
    async (toolId?: string, editorRequest?: number) => {
      try {
        const result = await listInvocations({ ...(toolId != null ? { toolId } : {}), limit: 100 })
        if (editorRequest != null && editorRequestRef.current !== editorRequest) return
        setTraces(result.traces)
        setRetentionDays(result.retentionDays)
      } catch (error) {
        if (editorRequest != null && editorRequestRef.current !== editorRequest) return
        message.error(error instanceof Error ? error.message : '运行记录加载失败')
      }
    },
    [listInvocations],
  )

  useEffect(() => {
    const applyTarget = (target: CustomToolTraceTarget) => {
      setActiveView('runs')
      setFocusedTraceId(target.traceId ?? null)
      void refreshTraces(target.toolId)
    }
    const pending = consumePendingCustomToolTrace()
    if (pending != null) applyTarget(pending)
    const handleOpen = (event: Event) => {
      const target = targetFromCustomToolTraceEvent(event)
      if (target != null) {
        consumePendingCustomToolTrace()
        applyTarget(target)
      }
    }
    window.addEventListener(OPEN_CUSTOM_TOOL_TRACE_EVENT, handleOpen)
    return () => window.removeEventListener(OPEN_CUSTOM_TOOL_TRACE_EVENT, handleOpen)
  }, [refreshTraces])

  useEffect(() => {
    if (focusedTraceId == null) return
    document
      .querySelector<HTMLElement>(`[data-custom-tool-trace-id="${focusedTraceId}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [focusedTraceId, traces])

  const openCreate = (kind: CustomToolEditorKind) => {
    editorRequestRef.current += 1
    const provider = preferredVisionProvider(providers)
    setCreateOpen(false)
    setTemplateOpen(false)
    setEditingId(null)
    setWorkspace(null)
    setTraces([])
    setTestResult(null)
    setRouteCheckResult(null)
    setEditor(createCustomToolEditorDraft(kind, provider?.id ?? '', provider?.defaultModel ?? ''))
  }

  const openImportedEditor = (nextEditor: CustomToolEditorDraft) => {
    editorRequestRef.current += 1
    setCreateOpen(false)
    setCurlImportOpen(false)
    setEditingId(null)
    setWorkspace(null)
    setTraces([])
    setTestResult(null)
    setRouteCheckResult(null)
    setEditor(nextEditor)
  }

  const openEdit = async (id: string) => {
    const editorRequest = ++editorRequestRef.current
    try {
      const result = await getStudio({ id })
      if (editorRequestRef.current !== editorRequest) return
      setEditingId(id)
      setWorkspace(result.workspace)
      setTestResult(null)
      setRouteCheckResult(null)
      setEditor(editorDraftFromDraft(result.workspace.draft, result.workspace.tool.secretStatus))
      await refreshTraces(id, editorRequest)
    } catch (error) {
      if (editorRequestRef.current !== editorRequest) return
      message.error(error instanceof Error ? error.message : '工具详情加载失败')
    }
  }

  const persistEditorDraft = useCallback(async (): Promise<CustomToolWorkspace> => {
    if (editor == null) throw new Error('没有可保存的工具草稿')
    const editorRequest = editorRequestRef.current
    const spec = buildCustomToolDraft(editor)
    const result =
      editingId == null ? await createDraft({ spec }) : await saveDraft({ id: editingId, spec })
    const persistedId = result.workspace.tool.id
    const secretNames = editor.kind === 'http' ? secretNamesFromHeaders(editor.headersJson) : []
    for (const name of secretNames) {
      const value = (editor.secretValues[name] ?? '').trim()
      if (value) await writeSecret({ id: persistedId, name, value })
    }
    const refreshed = await getStudio({ id: persistedId })
    if (editorRequestRef.current === editorRequest) {
      if (editingId == null) setEditingId(persistedId)
      setWorkspace(refreshed.workspace)
      setEditor((current) =>
        current == null
          ? current
          : {
              ...current,
              secretStatus: refreshed.workspace.tool.secretStatus,
              secretValues: {},
            },
      )
    }
    await refresh()
    return refreshed.workspace
  }, [createDraft, editingId, editor, getStudio, refresh, saveDraft, writeSecret])

  const saveEditor = useCallback(async () => {
    const editorRequest = editorRequestRef.current
    setSaving(true)
    try {
      await persistEditorDraft()
      if (editorRequestRef.current === editorRequest) {
        message.success('草稿已保存，当前稳定版本未受影响')
      }
    } catch (error) {
      if (editorRequestRef.current === editorRequest) {
        message.error(error instanceof Error ? error.message : '草稿保存失败')
      }
    } finally {
      setSaving(false)
    }
  }, [persistEditorDraft])

  const publishEditor = useCallback(async () => {
    const editorRequest = editorRequestRef.current
    setPublishing(true)
    try {
      const saved = await persistEditorDraft()
      const result = await publishDraft({
        id: saved.tool.id,
        expectedDraftVersion: saved.tool.draftVersion,
      })
      if (editorRequestRef.current === editorRequest) {
        setWorkspace(result.workspace)
        setEditor(editorDraftFromDraft(result.workspace.draft, result.workspace.tool.secretStatus))
        message.success(`v${result.workspace.tool.publishedVersion ?? ''} 已原子发布到本机`)
      }
      await refresh()
      await refreshTraces(saved.tool.id, editorRequest)
    } catch (error) {
      if (editorRequestRef.current === editorRequest) {
        message.error(error instanceof Error ? error.message : '发布失败，稳定版本保持不变')
      }
    } finally {
      setPublishing(false)
    }
  }, [persistEditorDraft, publishDraft, refresh, refreshTraces])

  useEffect(() => {
    if (editor == null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 's' || (!event.metaKey && !event.ctrlKey)) return
      event.preventDefault()
      if (!saving && !publishing) void saveEditor()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [editor, publishing, saving, saveEditor])

  const runEditorTest = async () => {
    if (editor == null) return
    if (editor.kind === 'http' && requiresHttpTestConfirmation(editor.method)) {
      const confirmed = await requestConfirm({
        title: `运行 ${editor.method} 测试请求？`,
        description: `这会向「${editor.urlTemplate.trim() || '未填写的 URL 模板'}」发送真实请求，可能创建、修改或删除远端数据。`,
        confirmText: '运行测试',
        danger: editor.method === 'DELETE',
      })
      if (!confirmed) return
    }
    const editorRequest = editorRequestRef.current
    setTesting(true)
    setTestResult(null)
    try {
      const spec = buildCustomToolDraft(editor)
      const secretNames = editor.kind === 'http' ? secretNamesFromHeaders(editor.headersJson) : []
      const input =
        editor.kind === 'provider-vision'
          ? { images: editor.testImagePaths, question: editor.testQuestion }
          : parseTestInput(editor.testInputJson)
      if (editor.kind === 'provider-vision' && editor.testImagePaths.length === 0) {
        throw new Error('请先选择至少一张测试图片')
      }
      if (secretNames.length > 0 && editingId == null) {
        throw new Error('引用 Keychain 密钥的 HTTP 工具需要先保存，再运行测试')
      }
      const response = await testRun({
        ...(editingId != null ? { toolId: editingId } : {}),
        draftSpec: spec,
        input,
      })
      if (editorRequestRef.current !== editorRequest) return
      setTestResult(response.result)
      if (editingId != null) await refreshTraces(editingId, editorRequest)
      if (response.result.ok) message.success('测试完成')
      else message.error('测试失败，请查看结果')
    } catch (error) {
      if (editorRequestRef.current !== editorRequest) return
      const text = error instanceof Error ? error.message : String(error)
      setTestResult({
        ok: false,
        text,
        errorCode: 'EDITOR_VALIDATION',
        meta: { durationMs: 0, bytes: 0, truncated: false },
      })
      message.error(text)
    } finally {
      setTesting(false)
    }
  }

  const rollbackEditor = async (version: number) => {
    if (editingId == null || workspace == null) return
    const confirmed = await requestConfirm({
      title: `回滚到 v${version}？`,
      description: `SparkWork 会从 v${version} 创建一个新的稳定版本；当前 v${workspace.tool.publishedVersion ?? '-'} 会保留在历史中，可再次恢复。`,
      confirmText: '执行回滚',
    })
    if (!confirmed) return
    const editorRequest = editorRequestRef.current
    try {
      const result = await rollbackVersion({ id: editingId, version })
      if (editorRequestRef.current === editorRequest) {
        setWorkspace(result.workspace)
        setEditor(editorDraftFromDraft(result.workspace.draft, result.workspace.tool.secretStatus))
        message.success(`已回滚并发布为 v${result.workspace.tool.publishedVersion ?? ''}`)
      }
      await refresh()
    } catch (error) {
      if (editorRequestRef.current !== editorRequest) return
      message.error(error instanceof Error ? error.message : '回滚失败')
    }
  }

  const runHostVisionRouteCheck = async () => {
    if (editor == null || editor.kind !== 'provider-vision') return
    if (editor.testImagePaths.length === 0) {
      message.error('请先选择至少一张测试图片')
      return
    }
    const editorRequest = editorRequestRef.current
    setRouteChecking(true)
    setRouteCheckResult(null)
    try {
      const response = await checkHostVisionRoute({
        imagePaths: editor.testImagePaths,
        question: editor.testQuestion.trim() || '请描述图片内容。',
      })
      if (editorRequestRef.current !== editorRequest) return
      setRouteCheckResult(response.result)
      if (response.result.ok) message.success('宿主确定性路由检查通过')
      else message.error('宿主路由检查未通过，请查看 Inspector')
      if (editingId != null) await refreshTraces(editingId, editorRequest)
    } catch (error) {
      if (editorRequestRef.current !== editorRequest) return
      message.error(error instanceof Error ? error.message : '宿主路由检查失败')
    } finally {
      setRouteChecking(false)
    }
  }

  const pickTestImages = async () => {
    if (editor == null || editor.kind !== 'provider-vision') return
    const editorRequest = editorRequestRef.current
    try {
      const selected = await openFileDialog({
        title: '选择测试图片',
        multiple: true,
        filters: [
          {
            name: '图片',
            extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'heic', 'heif'],
          },
        ],
      })
      const paths = selected.filePaths ?? (selected.filePath != null ? [selected.filePath] : [])
      if (editorRequestRef.current !== editorRequest) return
      if (selected.canceled || paths.length === 0) return
      if (paths.length > editor.maxImages) {
        message.error(`当前工具最多接收 ${editor.maxImages} 张图片，请重新选择`)
        return
      }
      setEditor({ ...editor, testImagePaths: paths })
    } catch (error) {
      if (editorRequestRef.current !== editorRequest) return
      message.error(error instanceof Error ? error.message : '测试图片选择失败')
    }
  }

  const confirmDelete = async (tool: CustomToolSummary) => {
    const confirmed = await requestConfirm({
      title: `删除「${tool.title}」？`,
      description: '删除后工具配置及其专属 Keychain 密钥会被移除，Agent 将立即停止使用它。',
      confirmText: '删除',
      danger: true,
    })
    if (!confirmed) return
    try {
      await deleteTool({ id: tool.id })
      message.success('工具已删除')
      await refresh()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '工具删除失败')
    }
  }

  const exportToolFile = async () => {
    if (tools.length === 0) {
      message.warning('当前没有可导出的自定义工具')
      return
    }
    try {
      const response = await exportTools({})
      const selected = await saveFileDialog({
        title: '导出自定义工具',
        defaultPath: `spark-custom-tools-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      if (selected.canceled || selected.filePath == null) return
      await writeTextFile({
        path: selected.filePath,
        content: JSON.stringify(response.payload, null, 2),
      })
      message.success(`已导出 ${response.payload.tools.length} 个工具；密钥未写入文件`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '自定义工具导出失败')
    }
  }

  const importToolFile = async () => {
    try {
      const selected = await openFileDialog({
        title: '导入自定义工具',
        filters: [{ name: 'Spark 自定义工具 JSON', extensions: ['json'] }],
      })
      const filePath = selected.filePaths?.[0] ?? selected.filePath
      if (selected.canceled || filePath == null) return
      const file = await readTextFile({ path: filePath })
      const payload = JSON.parse(file.content) as unknown
      const response = await importTools({ payload })
      setCreateOpen(false)
      await refresh()
      const summary = [`导入 ${response.imported.length} 个待审草稿`]
      if (response.skipped.length > 0) summary.push(`跳过 ${response.skipped.length} 个`)
      message.success(summary.join('，'))
      setActiveView('drafts')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '自定义工具导入失败')
    }
  }

  const changeRetentionDays = async (days: number) => {
    try {
      const result = await setInvocationRetention({ retentionDays: days })
      setRetentionDays(result.retentionDays)
      await refreshTraces()
      message.success(
        result.deleted > 0
          ? `保留期已更新，并清理 ${result.deleted} 条过期记录`
          : '本地运行记录保留期已更新',
      )
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保留期更新失败')
    }
  }

  const clearTraceHistory = async () => {
    const confirmed = await requestConfirm({
      title: '清空本地运行记录？',
      description: '这只会删除本机的脱敏 Trace，不影响工具、草稿、版本或 Keychain 密钥。',
      confirmText: '清空记录',
      danger: true,
    })
    if (!confirmed) return
    try {
      const result = await clearInvocations({})
      setTraces([])
      message.success(`已清理 ${result.deleted} 条本地运行记录`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '运行记录清理失败')
    }
  }

  return (
    <div className="ct_root">
      <div className="ct_toolbar">
        <div>
          <strong>Tool Studio</strong>
          <span>开发、测试、发布和观测自定义工具；草稿不会影响 Agent 当前使用的版本。</span>
        </div>
        <div className="ct_toolbar_actions">
          {activeView !== 'packages' && (
            <Input
              className="ct_search"
              value={query}
              prefix={<Icons.Search size={14} />}
              placeholder="搜索工具..."
              onChange={(event) => setQuery(event.target.value)}
            />
          )}
          <Tooltip title="刷新">
            <Button
              icon={<Icons.Refresh size={14} />}
              aria-label="刷新自定义工具"
              onClick={() => {
                void refresh()
                if (activeView === 'runs') void refreshTraces()
              }}
            />
          </Tooltip>
          {activeView !== 'packages' && (
            <Button icon={<Icons.Upload size={14} />} onClick={() => void importToolFile()}>
              导入
            </Button>
          )}
          {activeView === 'packages' && (
            <Button icon={<Icons.Upload size={14} />} onClick={() => setPackageImportOpen(true)}>
              导入工具包
            </Button>
          )}
          {activeView !== 'packages' && (
            <Button icon={<Icons.Download size={14} />} onClick={() => void exportToolFile()}>
              导出
            </Button>
          )}
          {activeView !== 'packages' && (
            <Button
              type="primary"
              icon={<Icons.Plus size={14} />}
              onClick={() => setCreateOpen(true)}
            >
              创建工具
            </Button>
          )}
        </div>
      </div>

      {activeView === 'runs' && (
        <div className="ct_trace_controls">
          <span>运行记录仅保存在本机</span>
          <Select
            value={retentionDays}
            options={[
              { label: '保留 7 天', value: 7 },
              { label: '保留 30 天', value: 30 },
              { label: '保留 90 天', value: 90 },
              { label: '保留 365 天', value: 365 },
            ]}
            onChange={(value) => void changeRetentionDays(Number(value))}
          />
          <Button danger type="text" onClick={() => void clearTraceHistory()}>
            清空记录
          </Button>
        </div>
      )}

      <div className="ct_view_tabs" role="tablist" aria-label="Tool Studio 视图">
        {(
          [
            ['tools', `工具 ${tools.length}`],
            ['packages', '工具包'],
            ['drafts', `开发中 ${tools.filter((tool) => tool.hasUnpublishedDraft).length}`],
            ['runs', '运行记录'],
          ] as const
        ).map(([view, label]) => (
          <button
            key={view}
            type="button"
            role="tab"
            aria-selected={activeView === view}
            className={classNames(activeView === view && 'is-active')}
            onClick={() => {
              setActiveView(view)
              if (view === 'runs') void refreshTraces()
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="ct_list">
        {activeView === 'packages' ? (
          <ToolPackagesPanel onImport={() => setPackageImportOpen(true)} />
        ) : activeView === 'runs' ? (
          traces.length === 0 ? (
            <Empty description="还没有本地运行记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            traces.map((trace) => {
              const tool = tools.find((item) => item.id === trace.toolId)
              return (
                <button
                  key={trace.id}
                  type="button"
                  className={classNames('ct_run_row', focusedTraceId === trace.id && 'is-focused')}
                  data-custom-tool-trace-id={trace.id}
                  aria-current={focusedTraceId === trace.id ? 'true' : undefined}
                  onClick={() => void openEdit(trace.toolId)}
                >
                  <span className={classNames('ct_run_status', `is-${trace.status}`)}>
                    {trace.status}
                  </span>
                  <div>
                    <strong>{tool?.title ?? trace.toolId}</strong>
                    <span>
                      Trace #{trace.id} · {trace.durationMs}ms
                      {trace.toolVersion != null ? ` · v${trace.toolVersion}` : ''}
                    </span>
                  </div>
                  <div className="ct_run_source">
                    {trace.source === 'host'
                      ? '宿主确定性路由'
                      : trace.source === 'model'
                        ? '模型选择'
                        : '直接测试'}
                    <span>{formatUpdatedAt(trace.createdAt)}</span>
                  </div>
                </button>
              )
            })
          )
        ) : loading && tools.length === 0 ? (
          <div className="ct_loading">正在读取本地工具配置...</div>
        ) : visibleTools.length === 0 ? (
          <Empty
            description={
              query
                ? '没有匹配的工具'
                : activeView === 'drafts'
                  ? '没有待发布草稿'
                  : '还没有自定义工具'
            }
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          >
            {!query && activeView === 'tools' && (
              <Button type="primary" onClick={() => setCreateOpen(true)}>
                创建第一个工具
              </Button>
            )}
          </Empty>
        ) : (
          visibleTools.map((tool) => (
            <div key={tool.id} className="ct_row">
              <div className={classNames('ct_type_icon', `is-${tool.type}`)}>
                {tool.type === 'provider-vision' ? (
                  <Icons.Image size={17} />
                ) : (
                  <Icons.Code size={17} />
                )}
              </div>
              <div className="ct_row_main">
                <div className="ct_row_title">
                  <strong>{tool.title}</strong>
                  <code>{tool.id}</code>
                  <Tag color={tool.type === 'provider-vision' ? 'purple' : 'blue'}>
                    {typeLabel(tool.type)}
                  </Tag>
                  {tool.origin === 'imported' && <Tag>导入</Tag>}
                  {tool.hasUnpublishedDraft && <Tag color="gold">草稿 v{tool.draftVersion}</Tag>}
                </div>
                <p>{tool.description}</p>
                <div className="ct_row_meta">
                  <span>{tool.risk === 'read' ? '只读' : tool.risk}</span>
                  <span>{tool.timeoutMs / 1_000}s 超时</span>
                  <span>
                    {tool.publishedVersion == null ? '未发布' : `稳定版 v${tool.publishedVersion}`}
                  </span>
                  <span>更新于 {formatUpdatedAt(tool.updatedAt)}</span>
                  {tool.lastTestAt != null && <span>已测试</span>}
                </div>
              </div>
              <div className="ct_row_actions">
                <Switch
                  size="small"
                  checked={tool.enabled}
                  disabled={tool.publishedVersion == null}
                  aria-label={`${tool.title}启用状态`}
                  onChange={async (enabled) => {
                    try {
                      await setEnabled({ id: tool.id, enabled })
                      await refresh()
                    } catch (error) {
                      message.error(error instanceof Error ? error.message : '状态更新失败')
                    }
                  }}
                />
                <Tooltip title="编辑与测试">
                  <Button
                    type="text"
                    icon={<Icons.Edit size={14} />}
                    aria-label={`编辑 ${tool.title}`}
                    onClick={() => void openEdit(tool.id)}
                  />
                </Tooltip>
                <Tooltip title="删除">
                  <Button
                    type="text"
                    danger
                    icon={<Icons.Trash size={14} />}
                    aria-label={`删除 ${tool.title}`}
                    onClick={() => void confirmDelete(tool)}
                  />
                </Tooltip>
              </div>
            </div>
          ))
        )}
      </div>

      <Modal
        open={createOpen}
        width={620}
        title="创建自定义工具"
        footer={null}
        onCancel={() => setCreateOpen(false)}
      >
        <CustomToolCreateSources
          onBlank={() => openCreate('code')}
          onCurl={() => {
            setCreateOpen(false)
            setCurlImportOpen(true)
          }}
          onCode={() => openCreate('code')}
          onOpenTemplates={() => {
            setCreateOpen(false)
            setTemplateOpen(true)
          }}
          onImportPackage={() => void importToolFile()}
        />
      </Modal>

      <Modal
        open={templateOpen}
        width={620}
        title="选择工具模板"
        footer={null}
        onCancel={() => setTemplateOpen(false)}
      >
        <CustomToolTemplateSources
          onHttp={() => openCreate('http')}
          onVision={() => openCreate('provider-vision')}
        />
      </Modal>

      {curlImportOpen && (
        <CustomToolCurlImportModal
          open
          onCancel={() => setCurlImportOpen(false)}
          onImport={openImportedEditor}
        />
      )}

      {packageImportOpen && (
        <ToolPackageImportModal
          open
          onCancel={() => setPackageImportOpen(false)}
          onImported={() => setActiveView('packages')}
        />
      )}

      {editor != null && (
        <CustomToolStudio
          editor={editor}
          editingId={editingId}
          providers={providers}
          saving={saving}
          publishing={publishing}
          testing={testing}
          routeChecking={routeChecking}
          testResult={testResult}
          routeCheckResult={routeCheckResult}
          workspace={workspace}
          traces={traces}
          onChange={setEditor}
          onClose={() => {
            editorRequestRef.current += 1
            setEditor(null)
            setEditingId(null)
            setWorkspace(null)
            setTraces([])
            if (activeView === 'runs') void refreshTraces()
          }}
          onSave={() => void saveEditor()}
          onPublish={() => void publishEditor()}
          onRollback={(version) => void rollbackEditor(version)}
          onTest={() => void runEditorTest()}
          onRouteCheck={() => void runHostVisionRouteCheck()}
          onPickImages={() => void pickTestImages()}
        />
      )}
    </div>
  )
}
