import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Drawer, Input, InputPassword, Select, Tag, TextArea, Tooltip } from '@lobehub/ui'
import { Empty, InputNumber, Switch, message } from 'antd'
import type { CustomToolSummary, HttpMethod, ProviderProfile } from '@spark/protocol'
import { Icons } from '../Icons'
import { useApp } from '../AppContext'
import { useIpcInvoke, useIpcStream } from '../hooks/useIpc'
import {
  buildCustomToolDraft,
  createCustomToolEditorDraft,
  editorDraftFromTool,
  parseTestInput,
  requiresHttpTestConfirmation,
  secretNamesFromHeaders,
  type CustomToolEditorDraft,
  type CustomToolEditorKind,
} from './custom-tools-model'
import './CustomToolsSection.less'

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

function typeLabel(type: CustomToolSummary['type']): string {
  if (type === 'provider-vision') return '图像理解'
  if (type === 'http') return 'HTTP'
  return type.toUpperCase()
}

function isSupportedVisionProvider(profile: ProviderProfile): boolean {
  return (
    profile.enabled !== false &&
    profile.modelType === 'multimodal' &&
    profile.provider !== 'anthropic' &&
    profile.codexApiKind !== 'responses' &&
    profile.codexApiKind !== 'embedding'
  )
}

function preferredVisionProvider(profiles: ProviderProfile[]): ProviderProfile | undefined {
  const supported = profiles.filter(isSupportedVisionProvider)
  return (
    supported.find((profile) => profile.name.trim() === '自部署图像理解') ??
    supported.find((profile) => profile.name.includes('图像理解')) ??
    supported[0]
  )
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

interface EditorProps {
  editor: CustomToolEditorDraft
  editingId: string | null
  providers: ProviderProfile[]
  saving: boolean
  testing: boolean
  testResult: string | null
  onChange: (next: CustomToolEditorDraft) => void
  onClose: () => void
  onSave: () => void
  onTest: () => void
  onPickImages: () => void
}

function CustomToolEditor({
  editor,
  editingId,
  providers,
  saving,
  testing,
  testResult,
  onChange,
  onClose,
  onSave,
  onTest,
  onPickImages,
}: EditorProps) {
  const patch = <K extends keyof CustomToolEditorDraft>(key: K, value: CustomToolEditorDraft[K]) =>
    onChange({ ...editor, [key]: value })
  const visionProviders = providers.filter(isSupportedVisionProvider)
  const selectedProvider = visionProviders.find(
    (profile) => profile.id === editor.providerProfileId,
  )
  const modelOptions = (selectedProvider?.modelIds ?? []).map((model) => ({
    label: model,
    value: model,
  }))
  let secretNames: string[] = []
  if (editor.kind === 'http') {
    try {
      secretNames = secretNamesFromHeaders(editor.headersJson)
    } catch {
      // The server validation error is shown on save/test; keep the editor usable meanwhile.
    }
  }

  return (
    <Drawer
      open
      width={620}
      title={editingId == null ? '新建自定义工具' : `编辑 ${editingId}`}
      onClose={onClose}
      footer={
        <div className="ct_editor_footer">
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} onClick={onSave}>
            保存并热加载
          </Button>
        </div>
      }
    >
      <div className="ct_editor">
        {editingId == null && (
          <div className="ct_template_switch" role="tablist" aria-label="工具模板">
            {(
              [
                ['http', 'HTTP API', Icons.Code],
                ['provider-vision', '图像理解', Icons.Image],
              ] as const
            ).map(([kind, label, Icon]) => (
              <button
                key={kind}
                type="button"
                role="tab"
                aria-selected={editor.kind === kind}
                className={editor.kind === kind ? 'is-active' : ''}
                onClick={() => {
                  const provider = preferredVisionProvider(providers)
                  onChange(
                    createCustomToolEditorDraft(
                      kind,
                      provider?.id ?? '',
                      provider?.defaultModel ?? '',
                    ),
                  )
                }}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>
        )}

        <section className="ct_editor_section">
          <div className="ct_editor_section_title">基本信息</div>
          <label className="ct_field">
            <span>工具 ID</span>
            <Input
              value={editor.id}
              disabled={editingId != null}
              placeholder="lowercase_tool_slug"
              onChange={(event) => patch('id', event.target.value)}
            />
            <small>小写字母开头，仅字母、数字和下划线；创建后不可修改。</small>
          </label>
          <label className="ct_field">
            <span>名称</span>
            <Input value={editor.title} onChange={(event) => patch('title', event.target.value)} />
          </label>
          <label className="ct_field">
            <span>给 Agent 的说明</span>
            <TextArea
              rows={3}
              value={editor.description}
              onChange={(event) => patch('description', event.target.value)}
            />
            <small>写清楚何时使用、返回什么；至少 10 个字符。</small>
          </label>
          <label className="ct_field ct_field_inline">
            <span>超时</span>
            <InputNumber
              min={1_000}
              max={300_000}
              step={1_000}
              value={editor.timeoutMs}
              addonAfter="ms"
              onChange={(value) => patch('timeoutMs', Number(value ?? 30_000))}
            />
          </label>
        </section>

        {editor.kind === 'http' ? (
          <>
            <section className="ct_editor_section">
              <div className="ct_editor_section_title">HTTP 请求</div>
              <div className="ct_field_grid">
                <label className="ct_field">
                  <span>方法</span>
                  <Select
                    value={editor.method}
                    options={HTTP_METHODS.map((method) => ({ label: method, value: method }))}
                    onChange={(value) => patch('method', value as HttpMethod)}
                  />
                </label>
                <label className="ct_field ct_field_switch">
                  <span>允许内网地址</span>
                  <Switch
                    checked={editor.allowPrivateNetwork}
                    onChange={(checked) => patch('allowPrivateNetwork', checked)}
                  />
                </label>
              </div>
              <label className="ct_field">
                <span>URL 模板</span>
                <Input
                  value={editor.urlTemplate}
                  onChange={(event) => patch('urlTemplate', event.target.value)}
                />
                <small>参数使用 {'{{query}}'}；运行时会按 URL 规则编码。</small>
              </label>
              <label className="ct_field">
                <span>输入参数 Schema</span>
                <TextArea
                  className="ct_code_input"
                  rows={8}
                  value={editor.inputSchemaJson}
                  onChange={(event) => patch('inputSchemaJson', event.target.value)}
                />
              </label>
              <label className="ct_field">
                <span>请求头 JSON</span>
                <TextArea
                  className="ct_code_input"
                  rows={5}
                  value={editor.headersJson}
                  onChange={(event) => patch('headersJson', event.target.value)}
                />
                <small>
                  普通值用 valueTemplate；Authorization 等敏感头必须用 secretRef，例如
                  {' [{"name":"Authorization","secretRef":"api_token"}]'}。
                </small>
              </label>
              <label className="ct_field">
                <span>JSON Body 模板（可选）</span>
                <TextArea
                  className="ct_code_input"
                  rows={5}
                  value={editor.bodyJsonTemplate}
                  placeholder={'{"query":"{{query}}"}'}
                  onChange={(event) => patch('bodyJsonTemplate', event.target.value)}
                />
              </label>
            </section>

            <section className="ct_editor_section">
              <div className="ct_editor_section_title">响应处理</div>
              <div className="ct_field_grid">
                <label className="ct_field">
                  <span>输出格式</span>
                  <Select
                    value={editor.responseFormat}
                    options={[
                      { label: 'JSON', value: 'json' },
                      { label: '纯文本', value: 'text' },
                      { label: 'Markdown 表格', value: 'markdown-table' },
                    ]}
                    onChange={(value) =>
                      patch('responseFormat', value as CustomToolEditorDraft['responseFormat'])
                    }
                  />
                </label>
                <label className="ct_field">
                  <span>最大响应字节</span>
                  <InputNumber
                    min={1}
                    max={1_048_576}
                    value={editor.maxSizeBytes}
                    onChange={(value) => patch('maxSizeBytes', Number(value ?? 262_144))}
                  />
                </label>
              </div>
              <label className="ct_field">
                <span>提取规则 JSON（可选）</span>
                <TextArea
                  className="ct_code_input"
                  rows={4}
                  value={editor.extractJson}
                  onChange={(event) => patch('extractJson', event.target.value)}
                />
                <small>{'格式：[ {"label":"标题","jsonPath":"$.items[*].title"} ]'}</small>
              </label>
            </section>

            {secretNames.length > 0 && (
              <section className="ct_editor_section">
                <div className="ct_editor_section_title">本机密钥</div>
                <div className="ct_security_note">
                  密钥写入系统 Keychain，不进入 SQLite、导出文件或工具描述。
                </div>
                {secretNames.map((name) => (
                  <label key={name} className="ct_field">
                    <span>
                      {name}
                      {editor.secretStatus[name] === true && (
                        <em className="ct_secret_ready">已保存</em>
                      )}
                    </span>
                    <InputPassword
                      value={editor.secretValues[name] ?? ''}
                      placeholder={
                        editor.secretStatus[name] === true ? '留空则保持原值' : '输入密钥'
                      }
                      onChange={(event) =>
                        patch('secretValues', {
                          ...editor.secretValues,
                          [name]: event.target.value,
                        })
                      }
                    />
                  </label>
                ))}
              </section>
            )}
          </>
        ) : (
          <section className="ct_editor_section">
            <div className="ct_editor_section_title">图像理解 Provider</div>
            {visionProviders.length === 0 && (
              <div className="ct_warning">
                没有可用的 OpenAI Chat Completions 兼容多模态 Provider。请先在模型渠道中启用一个
                multimodal Provider。
              </div>
            )}
            <label className="ct_field">
              <span>Provider</span>
              <Select
                showSearch
                value={editor.providerProfileId || undefined}
                placeholder="选择多模态 Provider"
                options={visionProviders.map((profile) => ({
                  label: `${profile.name} · ${profile.provider}`,
                  value: profile.id,
                }))}
                onChange={(value) => {
                  const provider = visionProviders.find((item) => item.id === value)
                  onChange({
                    ...editor,
                    providerProfileId: String(value ?? ''),
                    model: provider?.defaultModel ?? '',
                  })
                }}
              />
              <small>只保存 Provider 引用；API Key 继续由该渠道的 Keychain 管理。</small>
            </label>
            <label className="ct_field">
              <span>模型</span>
              {modelOptions.length > 0 ? (
                <Select
                  showSearch
                  value={editor.model || undefined}
                  options={modelOptions}
                  onChange={(value) => patch('model', String(value ?? ''))}
                />
              ) : (
                <Input
                  value={editor.model}
                  onChange={(event) => patch('model', event.target.value)}
                />
              )}
            </label>
            <label className="ct_field">
              <span>视觉系统指令</span>
              <TextArea
                rows={5}
                value={editor.instructions}
                onChange={(event) => patch('instructions', event.target.value)}
              />
            </label>
            <div className="ct_field_grid ct_field_grid_three">
              <label className="ct_field">
                <span>最多图片</span>
                <InputNumber
                  min={1}
                  max={8}
                  value={editor.maxImages}
                  onChange={(value) => patch('maxImages', Number(value ?? 4))}
                />
              </label>
              <label className="ct_field">
                <span>最大 Tokens</span>
                <InputNumber
                  min={128}
                  max={16_384}
                  value={editor.maxTokens}
                  onChange={(value) => patch('maxTokens', Number(value ?? 4_096))}
                />
              </label>
              <label className="ct_field">
                <span>温度（可选）</span>
                <Input
                  value={editor.temperature}
                  placeholder="Provider 默认"
                  onChange={(event) => patch('temperature', event.target.value)}
                />
              </label>
            </div>
            <div className="ct_route_row">
              <div>
                <strong>文本模型自动补视觉</strong>
                <span>本轮有图片且聊天模型声明为 text 时，由宿主先运行此工具。</span>
              </div>
              <Switch
                checked={editor.autoRoute}
                onChange={(checked) => patch('autoRoute', checked)}
              />
            </div>
            <label className="ct_field ct_field_inline">
              <span>路由优先级</span>
              <InputNumber
                min={0}
                max={1_000}
                value={editor.priority}
                onChange={(value) => patch('priority', Number(value ?? 100))}
              />
              <small>数值越大越优先；相同优先级按工具 ID 稳定排序。</small>
            </label>
            <div className="ct_security_note">
              此类型不会作为任意本地路径读取工具暴露给模型；只允许宿主传入本轮图片附件。
            </div>
          </section>
        )}

        <section className="ct_editor_section ct_test_section">
          <div className="ct_editor_section_title">测试运行</div>
          {editor.kind === 'http' ? (
            <label className="ct_field">
              <span>输入 JSON</span>
              <TextArea
                className="ct_code_input"
                rows={5}
                value={editor.testInputJson}
                onChange={(event) => patch('testInputJson', event.target.value)}
              />
            </label>
          ) : (
            <>
              <label className="ct_field">
                <span>问题</span>
                <Input
                  value={editor.testQuestion}
                  onChange={(event) => patch('testQuestion', event.target.value)}
                />
              </label>
              <div className="ct_test_images">
                <Button icon={<Icons.Image size={14} />} onClick={onPickImages}>
                  选择图片
                </Button>
                <span>
                  {editor.testImagePaths.length === 0
                    ? '未选择'
                    : `${editor.testImagePaths.length} 张：${editor.testImagePaths
                        .map((item) => item.split(/[\\/]/u).pop())
                        .join('、')}`}
                </span>
              </div>
            </>
          )}
          <Button icon={<Icons.Play size={14} />} loading={testing} onClick={onTest}>
            运行测试
          </Button>
          {testResult != null && <pre className="ct_test_result">{testResult}</pre>}
        </section>
      </div>
    </Drawer>
  )
}

export function CustomToolsSection() {
  const { requestConfirm } = useApp()
  const [tools, setTools] = useState<CustomToolSummary[]>([])
  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editor, setEditor] = useState<CustomToolEditorDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [pendingEnableId, setPendingEnableId] = useState<string | null>(null)
  const [restoreEnabledAfterSave, setRestoreEnabledAfterSave] = useState(false)

  const { invoke: listTools } = useIpcInvoke('custom-tools:list')
  const { invoke: getTool } = useIpcInvoke('custom-tools:get')
  const { invoke: createTool } = useIpcInvoke('custom-tools:create')
  const { invoke: updateTool } = useIpcInvoke('custom-tools:update')
  const { invoke: deleteTool } = useIpcInvoke('custom-tools:delete')
  const { invoke: setEnabled } = useIpcInvoke('custom-tools:set-enabled')
  const { invoke: testRun } = useIpcInvoke('custom-tools:test-run')
  const { invoke: writeSecret } = useIpcInvoke('custom-tools:write-secret')
  const { invoke: listProviders } = useIpcInvoke('provider:list')
  const { invoke: openFileDialog } = useIpcInvoke('dialog:open-file')

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
    if (!normalized) return tools
    return tools.filter((tool) =>
      [tool.id, tool.title, tool.description, typeLabel(tool.type)].some((value) =>
        value.toLowerCase().includes(normalized),
      ),
    )
  }, [query, tools])

  const openCreate = (kind: CustomToolEditorKind) => {
    const provider = preferredVisionProvider(providers)
    setPendingEnableId(null)
    setRestoreEnabledAfterSave(false)
    setEditingId(null)
    setTestResult(null)
    setEditor(createCustomToolEditorDraft(kind, provider?.id ?? '', provider?.defaultModel ?? ''))
  }

  const openEdit = async (id: string) => {
    try {
      const result = await getTool({ id })
      setPendingEnableId((current) => (current === id ? current : null))
      setRestoreEnabledAfterSave(result.tool.enabled)
      setEditingId(id)
      setTestResult(null)
      setEditor(editorDraftFromTool(result.tool))
    } catch (error) {
      message.error(error instanceof Error ? error.message : '工具详情加载失败')
    }
  }

  const saveEditor = useCallback(async () => {
    if (editor == null) return
    setSaving(true)
    let persistedId = editingId
    let shouldEnableAfterSecrets = pendingEnableId != null && pendingEnableId === editingId
    try {
      const spec = buildCustomToolDraft(editor)
      const secretNames = editor.kind === 'http' ? secretNamesFromHeaders(editor.headersJson) : []
      const missingSecrets = secretNames.filter(
        (name) => editor.secretStatus[name] !== true && !(editor.secretValues[name] ?? '').trim(),
      )
      if (missingSecrets.length > 0) {
        throw new Error(`请填写密钥：${missingSecrets.join('、')}`)
      }
      const result =
        editingId == null ? await createTool({ spec }) : await updateTool({ id: editingId, spec })
      persistedId = result.tool.id
      // If a later Keychain write fails, keep the editor in update mode so a
      // retry repairs the already-created record instead of hitting a duplicate ID.
      if (editingId == null) setEditingId(result.tool.id)
      if (editingId == null && secretNames.length > 0) {
        shouldEnableAfterSecrets = true
        setPendingEnableId(result.tool.id)
      }
      if (
        editingId != null &&
        restoreEnabledAfterSave &&
        secretNames.length > 0 &&
        !result.tool.enabled
      ) {
        shouldEnableAfterSecrets = true
        setPendingEnableId(result.tool.id)
      }
      for (const name of secretNames) {
        const value = (editor.secretValues[name] ?? '').trim()
        if (value) await writeSecret({ id: result.tool.id, name, value })
      }
      if (shouldEnableAfterSecrets) {
        await setEnabled({ id: result.tool.id, enabled: true })
        setPendingEnableId(null)
      }
      message.success(editingId == null ? '工具已创建并热加载' : '工具已更新并热加载')
      setEditor(null)
      setEditingId(null)
      await refresh()
    } catch (error) {
      if (persistedId != null) {
        try {
          const persisted = await getTool({ id: persistedId })
          setEditingId(persistedId)
          setEditor((current) =>
            current?.id === persistedId
              ? { ...current, secretStatus: persisted.tool.secretStatus }
              : current,
          )
        } catch {
          // Preserve the original save error. A failed recovery read must not
          // hide whether persistence or Keychain writing was the root cause.
        }
      }
      message.error(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }, [
    createTool,
    editingId,
    editor,
    getTool,
    pendingEnableId,
    refresh,
    restoreEnabledAfterSave,
    setEnabled,
    updateTool,
    writeSecret,
  ])

  useEffect(() => {
    if (editor == null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 's' || (!event.metaKey && !event.ctrlKey)) return
      event.preventDefault()
      if (!saving) void saveEditor()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [editor, saving, saveEditor])

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
      setTestResult(
        response.result.ok
          ? response.result.text
          : `[${response.result.errorCode ?? 'EXECUTION_FAILED'}] ${response.result.text}`,
      )
      if (response.result.ok) message.success('测试完成')
      else message.error('测试失败，请查看结果')
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      setTestResult(text)
      message.error(text)
    } finally {
      setTesting(false)
    }
  }

  const pickTestImages = async () => {
    if (editor == null || editor.kind !== 'provider-vision') return
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
      if (selected.canceled || paths.length === 0) return
      if (paths.length > editor.maxImages) {
        message.error(`当前工具最多接收 ${editor.maxImages} 张图片，请重新选择`)
        return
      }
      setEditor({ ...editor, testImagePaths: paths })
    } catch (error) {
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

  return (
    <div className="ct_root">
      <div className="ct_toolbar">
        <div>
          <strong>{tools.length} 个自定义工具</strong>
          <span>启停和保存后立即刷新 Agent 工具面，无需重启应用。</span>
        </div>
        <div className="ct_toolbar_actions">
          <Input
            className="ct_search"
            value={query}
            prefix={<Icons.Search size={14} />}
            placeholder="搜索工具..."
            onChange={(event) => setQuery(event.target.value)}
          />
          <Tooltip title="刷新">
            <Button icon={<Icons.Refresh size={14} />} onClick={() => void refresh()} />
          </Tooltip>
          <Button icon={<Icons.Code size={14} />} onClick={() => openCreate('http')}>
            HTTP 工具
          </Button>
          <Button
            type="primary"
            icon={<Icons.Image size={14} />}
            onClick={() => openCreate('provider-vision')}
          >
            图像理解工具
          </Button>
        </div>
      </div>

      <div className="ct_list">
        {loading && tools.length === 0 ? (
          <div className="ct_loading">正在读取本地工具配置...</div>
        ) : visibleTools.length === 0 ? (
          <Empty
            description={query ? '没有匹配的工具' : '还没有自定义工具'}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          >
            {!query && (
              <Button type="primary" onClick={() => openCreate('provider-vision')}>
                创建图像理解工具
              </Button>
            )}
          </Empty>
        ) : (
          visibleTools.map((tool) => (
            <div key={tool.id} className="ct_row">
              <div className={`ct_type_icon is-${tool.type}`}>
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
                </div>
                <p>{tool.description}</p>
                <div className="ct_row_meta">
                  <span>{tool.risk === 'read' ? '只读' : tool.risk}</span>
                  <span>{tool.timeoutMs / 1_000}s 超时</span>
                  <span>更新于 {formatUpdatedAt(tool.updatedAt)}</span>
                  {tool.lastTestAt != null && <span>已测试</span>}
                </div>
              </div>
              <div className="ct_row_actions">
                <Switch
                  size="small"
                  checked={tool.enabled}
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
                    onClick={() => void openEdit(tool.id)}
                  />
                </Tooltip>
                <Tooltip title="删除">
                  <Button
                    type="text"
                    danger
                    icon={<Icons.Trash size={14} />}
                    onClick={() => void confirmDelete(tool)}
                  />
                </Tooltip>
              </div>
            </div>
          ))
        )}
      </div>

      {editor != null && (
        <CustomToolEditor
          editor={editor}
          editingId={editingId}
          providers={providers}
          saving={saving}
          testing={testing}
          testResult={testResult}
          onChange={setEditor}
          onClose={() => {
            setEditor(null)
            setEditingId(null)
          }}
          onSave={() => void saveEditor()}
          onTest={() => void runEditorTest()}
          onPickImages={() => void pickTestImages()}
        />
      )}
    </div>
  )
}
