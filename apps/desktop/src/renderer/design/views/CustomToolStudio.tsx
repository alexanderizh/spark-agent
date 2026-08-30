import { Button, Input, InputPassword, Select, TextArea } from '@lobehub/ui'
import { InputNumber, Switch } from 'antd'
import type {
  CustomToolInvocationTrace,
  CustomToolHostVisionRouteCheckResult,
  CustomToolTestRunResult,
  CustomToolWorkspace,
  HttpMethod,
  ProviderProfile,
} from '@spark/protocol'
import { Icons } from '../Icons'
import { classNames } from '../utils/class-names'
import { secretNamesFromHeaders, type CustomToolEditorDraft } from './custom-tools-model'
import {
  customToolFileName,
  customToolImagePreviewUrl,
  isSupportedVisionProvider,
} from './custom-tools-ui'
import { CustomToolSchemaEditor } from './CustomToolSchemaEditor'
import { CustomToolCodeEditor } from './CustomToolCodeEditor'

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

interface EditorProps {
  editor: CustomToolEditorDraft
  editingId: string | null
  providers: ProviderProfile[]
  saving: boolean
  publishing: boolean
  testing: boolean
  routeChecking: boolean
  testResult: CustomToolTestRunResult | null
  routeCheckResult: CustomToolHostVisionRouteCheckResult | null
  workspace: CustomToolWorkspace | null
  traces: CustomToolInvocationTrace[]
  onChange: (next: CustomToolEditorDraft) => void
  onClose: () => void
  onSave: () => void
  onPublish: () => void
  onRollback: (version: number) => void
  onTest: () => void
  onRouteCheck: () => void
  onPickImages: () => void
}

export function CustomToolStudio({
  editor,
  editingId,
  providers,
  saving,
  publishing,
  testing,
  routeChecking,
  testResult,
  routeCheckResult,
  workspace,
  traces,
  onChange,
  onClose,
  onSave,
  onPublish,
  onRollback,
  onTest,
  onRouteCheck,
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
    <div className="ct_studio" role="dialog" aria-label="Tool Studio">
      <header className="ct_studio_header">
        <div className="ct_studio_identity">
          <Button
            type="text"
            icon={<Icons.ArrowLeft size={15} />}
            aria-label="返回工具列表"
            onClick={onClose}
          />
          <div>
            <strong>{editingId == null ? '新工具草稿' : editor.title || editingId}</strong>
            <span>
              {workspace?.tool.publishedVersion == null
                ? '尚未发布'
                : `稳定版本 v${workspace.tool.publishedVersion}`}
              {workspace != null &&
              (workspace.tool.publishedVersion == null ||
                workspace.tool.draftVersion > workspace.tool.publishedVersion)
                ? ` · 草稿 v${workspace.tool.draftVersion}`
                : ''}
            </span>
          </div>
        </div>
        <div className="ct_studio_actions">
          <Button loading={saving} disabled={publishing} onClick={onSave}>
            保存草稿
          </Button>
          <Button type="primary" loading={publishing} disabled={saving} onClick={onPublish}>
            发布到本机
          </Button>
        </div>
      </header>
      <div className="ct_studio_body">
        <nav className="ct_studio_nav" aria-label="工具编辑章节">
          {(
            [
              ['ct-section-basic', '概览'],
              [
                'ct-section-execution',
                editor.kind === 'http' ? '执行' : editor.kind === 'code' ? '代码' : 'Provider',
              ],
              [
                'ct-section-routing',
                editor.kind === 'http'
                  ? '响应处理'
                  : editor.kind === 'code'
                    ? '能力与权限'
                    : '路由与权限',
              ],
              ['ct-section-test', '测试'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })}
            >
              {label}
            </button>
          ))}
        </nav>
        <main className="ct_studio_editor_scroll">
          <div className="ct_editor">
            <section id="ct-section-basic" className="ct_editor_section">
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
                <Input
                  value={editor.title}
                  onChange={(event) => patch('title', event.target.value)}
                />
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
                <section id="ct-section-execution" className="ct_editor_section">
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
                  <div className="ct_field">
                    <span>输入参数 Schema</span>
                    <CustomToolSchemaEditor
                      value={editor.inputSchemaJson}
                      onChange={(value) => patch('inputSchemaJson', value)}
                    />
                  </div>
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

                <section id="ct-section-routing" className="ct_editor_section">
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
            ) : editor.kind === 'code' ? (
              <CustomToolCodeEditor editor={editor} onChange={onChange} />
            ) : (
              <>
                <section id="ct-section-execution" className="ct_editor_section">
                  <div className="ct_editor_section_title">图像理解 Provider</div>
                  {visionProviders.length === 0 && (
                    <div className="ct_warning">
                      没有可用的 OpenAI Chat Completions 兼容多模态
                      Provider。请先在模型渠道中启用一个 multimodal Provider。
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
                </section>
                <section id="ct-section-routing" className="ct_editor_section">
                  <div className="ct_editor_section_title">路由与权限</div>
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
              </>
            )}

            <section id="ct-section-test" className="ct_editor_section ct_test_section">
              <div className="ct_editor_section_title">测试运行</div>
              {editor.kind !== 'provider-vision' ? (
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
                  <div className="ct_test_image_picker">
                    <div className="ct_test_images">
                      {editor.testImagePaths.map((filePath, index) => (
                        <div key={filePath} className="ct_test_image">
                          <img src={customToolImagePreviewUrl(filePath)} alt="" />
                          <span title={filePath}>
                            {index + 1}. {customToolFileName(filePath)}
                          </span>
                          <Button
                            type="text"
                            danger
                            icon={<Icons.XCircle size={12} />}
                            aria-label={`移除 ${customToolFileName(filePath)}`}
                            onClick={() =>
                              patch(
                                'testImagePaths',
                                editor.testImagePaths.filter((item) => item !== filePath),
                              )
                            }
                          />
                        </div>
                      ))}
                    </div>
                    <Button icon={<Icons.Image size={14} />} onClick={onPickImages}>
                      {editor.testImagePaths.length === 0 ? '选择图片' : '重新选择'}
                    </Button>
                    <small>
                      {editor.testImagePaths.length === 0
                        ? `最多 ${editor.maxImages} 张；选择后先在本机预览，运行测试才会发送到所选 Provider。`
                        : `已选择 ${editor.testImagePaths.length} 张；仅运行测试时发送到所选 Provider。`}
                    </small>
                  </div>
                </>
              )}
              <div className="ct_test_actions">
                <Button icon={<Icons.Play size={14} />} loading={testing} onClick={onTest}>
                  直接调用
                </Button>
                {editor.kind === 'provider-vision' && (
                  <Button
                    icon={<Icons.Wrench size={14} />}
                    loading={routeChecking}
                    disabled={workspace?.tool.publishedVersion == null || !workspace.tool.enabled}
                    onClick={onRouteCheck}
                  >
                    检查宿主路由
                  </Button>
                )}
              </div>
              {editor.kind === 'provider-vision' && (
                <small className="ct_route_check_note">
                  宿主路由检查使用当前已发布且启用的稳定版本，验证“文本模型 +
                  图片附件”的确定性路由；不调用聊天模型，也不宣称最终回答已验证。
                </small>
              )}
            </section>
          </div>
        </main>
        <aside className="ct_inspector" aria-label="Inspector">
          <div className="ct_inspector_heading">
            <div>
              <strong>Inspector</strong>
              <span>草稿测试不会影响稳定版本</span>
            </div>
            {testResult?.traceId != null && <code>Trace #{testResult.traceId}</code>}
          </div>

          <section className="ct_inspector_section">
            <div className="ct_inspector_label">最近测试</div>
            {testResult == null ? (
              <div className="ct_inspector_empty">
                运行一次直接调用测试后，这里会显示耗时、体积和精准错误。
              </div>
            ) : (
              <>
                <div
                  className={classNames('ct_result_status', testResult.ok ? 'is-ok' : 'is-error')}
                >
                  <span>{testResult.ok ? '执行成功' : (testResult.errorCode ?? '执行失败')}</span>
                  <small>
                    {testResult.meta.durationMs}ms · {testResult.meta.bytes} bytes
                  </small>
                </div>
                <pre className="ct_test_result">{testResult.text}</pre>
              </>
            )}
          </section>

          {editor.kind === 'provider-vision' && (
            <section className="ct_inspector_section">
              <div className="ct_inspector_label">宿主路由</div>
              {routeCheckResult == null ? (
                <div className="ct_inspector_empty">
                  发布并启用稳定版本后，可验证实际的宿主确定性视觉路由。
                </div>
              ) : (
                <div
                  className={classNames(
                    'ct_route_check_result',
                    routeCheckResult.ok ? 'is-ok' : 'is-error',
                  )}
                >
                  <strong>{routeCheckResult.ok ? '宿主路由已验证' : '宿主路由未通过'}</strong>
                  <span>
                    {routeCheckResult.selectedToolTitle ??
                      routeCheckResult.selectedToolId ??
                      '未选择工具'}
                    {routeCheckResult.durationMs != null
                      ? ` · ${routeCheckResult.durationMs}ms`
                      : ''}
                  </span>
                  {routeCheckResult.traceId != null && (
                    <code>Trace #{routeCheckResult.traceId}</code>
                  )}
                  <small>聊天模型最终回答未验证。</small>
                </div>
              )}
            </section>
          )}

          <section className="ct_inspector_section">
            <div className="ct_inspector_label">版本</div>
            {workspace?.versions.map((version) => (
              <div key={version.version} className="ct_version_row">
                <div>
                  <strong>v{version.version}</strong>
                  <span>
                    {version.status === 'published'
                      ? '当前稳定版本'
                      : version.status === 'draft'
                        ? '未发布草稿'
                        : version.sourceVersion == null
                          ? '历史版本'
                          : `由 v${version.sourceVersion} 回滚生成`}
                  </span>
                </div>
                {version.status === 'archived' &&
                  workspace.tool.publishedVersion != null &&
                  workspace.tool.draftVersion === workspace.tool.publishedVersion && (
                    <Button size="small" type="text" onClick={() => onRollback(version.version)}>
                      回滚
                    </Button>
                  )}
              </div>
            ))}
          </section>

          <section className="ct_inspector_section">
            <div className="ct_inspector_label">最近运行</div>
            {traces.length === 0 ? (
              <div className="ct_inspector_empty">暂无本地运行记录。</div>
            ) : (
              traces.slice(0, 8).map((trace) => (
                <div key={trace.id} className="ct_trace_row">
                  <span className={classNames(`is-${trace.status}`)}>{trace.status}</span>
                  <div>
                    <strong>
                      #{trace.id} · {trace.durationMs}ms
                    </strong>
                    <small>
                      {trace.source === 'host'
                        ? '宿主确定性路由'
                        : trace.source === 'model'
                          ? '模型选择'
                          : '直接测试'}
                      {trace.toolVersion != null ? ` · v${trace.toolVersion}` : ''}
                    </small>
                  </div>
                </div>
              ))
            )}
          </section>
        </aside>
      </div>
    </div>
  )
}
