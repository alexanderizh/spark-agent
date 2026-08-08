import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import './ProviderManifestContractEditor.less'
import { ProviderManifestParameterEditor } from './ProviderManifestParameterEditor'
import {
  ADAPTER_BASE_TEMPLATE_OPTIONS,
  applyAdapterBaseTemplate,
  resolveAdapterBaseTemplate,
} from './providerManifestBaseTemplates'
import { Checkbox, Input, Select, Tag } from '@lobehub/ui'
import type {
  MediaArtifactRetrieval,
  MediaDirectArtifactRetrieval,
  MediaInvocationBody,
  MediaErrorContract,
  MediaInvocationAuth,
  MediaInvocationRequest,
  MediaModelCapabilityManifest,
  MediaModelManifest,
  MediaModelParamPolicy,
  MediaParamForbiddenEntry,
  MediaTaskIdPlacement,
} from '@spark/protocol'

interface ProviderManifestContractEditorProps {
  manifest: MediaModelManifest | null
  onChange: (next: MediaModelManifest) => void
}

/**
 * 自定义 manifest 的 Contract V2 结构化编辑器。
 *
 * 与 ProvidersView 的 raw JSON textarea 双向配合：用户在 UI 上的修改通过 onChange
 * 回传给父组件，父组件再把 manifest 序列化为 JSON 同步到 textarea。raw JSON 的修改
 * 在反序列化成功后也会反映到结构化控件。
 *
 * 多数自定义 manifest 只有 1 个 capability；多于 1 个时按 capability 分组折叠。
 * paramPolicy 缺失时显示空状态，提示用户「未声明 = 兼容模式透传」。
 */
export function ProviderManifestContractEditor({
  manifest,
  onChange,
}: ProviderManifestContractEditorProps) {
  if (!manifest) {
    return <div style={{ opacity: 0.6 }}>尚未提供 manifest，无法编辑 Contract V2。</div>
  }
  const editableManifest = normalizeEditorManifest(manifest)
  const capabilities = editableManifest.capabilities ?? []
  return (
    <div className="pv_contract_editor">
      <EditorOverview manifest={editableManifest} onChange={onChange} />
      <CapabilityIoEditor manifest={editableManifest} onChange={onChange} />
      <InvocationEditor manifest={editableManifest} onChange={onChange} />
      {capabilities.length === 0 && <div style={{ opacity: 0.6 }}>当前配置尚未声明任何能力。</div>}
      {capabilities.map((capability, index) => (
        <CapabilityEditor
          key={capability.id ?? index}
          manifest={editableManifest}
          capability={capability}
          index={index}
          onChange={onChange}
        />
      ))}
      <DocsAndSafetyEditor manifest={editableManifest} onChange={onChange} />
    </div>
  )
}

function normalizeEditorManifest(manifest: MediaModelManifest): MediaModelManifest {
  const fallbackCapability: MediaModelCapabilityManifest = {
    id: 'image.generate',
    label: '文生图',
    input: { required: ['prompt'] },
    output: { types: ['image'] },
    paramSchema: { type: 'object', properties: {} },
  }
  const capabilities = (Array.isArray(manifest.capabilities) ? manifest.capabilities : []).map(
    (capability) => ({
      ...fallbackCapability,
      ...capability,
      input:
        capability.input &&
        !Array.isArray(capability.input) &&
        Array.isArray(capability.input.required)
          ? capability.input
          : fallbackCapability.input,
      output:
        capability.output &&
        !Array.isArray(capability.output) &&
        Array.isArray(capability.output.types)
          ? capability.output
          : fallbackCapability.output,
      paramSchema: isRecord(capability.paramSchema)
        ? capability.paramSchema
        : fallbackCapability.paramSchema,
    }),
  )
  return {
    ...manifest,
    id: manifest.id || `custom:${manifest.modelId || 'model'}`,
    contractVersion: 2,
    adapterMode: manifest.adapterMode ?? 'template',
    providerKind: manifest.providerKind || 'custom',
    modelId: manifest.modelId || 'custom-model',
    displayName: manifest.displayName || manifest.modelId || 'Custom Media Model',
    domains:
      Array.isArray(manifest.domains) && manifest.domains.length ? manifest.domains : ['image'],
    capabilities: capabilities.length ? capabilities : [fallbackCapability],
    invocation: manifest.invocation ?? {
      mode: 'sync',
      endpoint: '/images/generations',
      method: 'POST',
      contentType: 'json',
      requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}' },
      request: {
        method: 'POST',
        endpoint: '/images/generations',
        auth: { kind: 'bearer', credentialRef: 'apiKey' },
        body: { kind: 'json', template: { model: '{{modelId}}', prompt: '{{prompt}}' } },
      },
      response: { kind: 'url', jsonPaths: ['data[].url', 'url'], download: true },
    },
    docs: manifest.docs ?? { sourceUrls: [] },
    ...(manifest.version ? { version: manifest.version } : {}),
    ...(manifest.safety ? { safety: manifest.safety } : {}),
    ...(manifest.error ? { error: manifest.error } : {}),
  }
}

function EditorOverview({ manifest, onChange }: ProviderManifestContractEditorProps) {
  if (!manifest) return null
  const update = (patch: Partial<MediaModelManifest>) =>
    onChange({
      ...manifest,
      ...patch,
      contractVersion: 2,
      adapterMode: patch.adapterMode ?? manifest.adapterMode ?? 'template',
    })
  const domain = manifest.domains?.[0] ?? 'image'
  const baseTemplate = resolveAdapterBaseTemplate(manifest)
  const applyBaseTemplate = (
    template: Parameters<typeof applyAdapterBaseTemplate>[1] = baseTemplate,
  ): void => onChange(applyAdapterBaseTemplate(manifest, template))
  const capabilityId = manifest.capabilities[0]?.id ?? `${domain}.generate`
  const setDomain = (next: string) => {
    const nextDomain = next as MediaModelManifest['domains'][number]
    const nextCapabilityId =
      nextDomain === 'video'
        ? 'video.generate'
        : nextDomain === 'audio'
          ? 'audio.speech'
          : 'image.generate'
    const nextCapabilities =
      manifest.capabilities.length > 0
        ? manifest.capabilities.map((cap, index) =>
            index === 0 ? { ...cap, id: cap.id === capabilityId ? nextCapabilityId : cap.id } : cap,
          )
        : []
    const nextManifest = {
      ...manifest,
      domains: [nextDomain],
      capabilities: nextCapabilities,
      contractVersion: 2 as const,
    }
    if (manifest.baseTemplate) {
      const compatibleTemplate =
        manifest.baseTemplate === 'toapis-image' && nextDomain !== 'image'
          ? 'custom'
          : manifest.baseTemplate
      onChange(applyAdapterBaseTemplate({ ...nextManifest, capabilities: [] }, compatibleTemplate))
      return
    }
    onChange(nextManifest)
  }
  return (
    <section className="pv_adapter_section pv_adapter_overview">
      <div className="pv_adapter_section_head">
        <div>
          <strong>① 路由与模型</strong>
          <div className="pv_adapter_hint">
            选择协议基底会初始化能力、参数、鉴权、请求、响应和错误契约；生成后所有表单项仍可修改。
          </div>
        </div>
        <div className="pv_adapter_tags">
          <Tag color="blue">
            {baseTemplate === 'openai-compatible'
              ? 'OpenAI 协议基底'
              : baseTemplate === 'custom'
                ? '完全自定义'
                : '预置协议基底'}
          </Tag>
          <Tag color={manifest.adapterMode === 'native' ? 'default' : 'green'}>
            {manifest.adapterMode === 'native'
              ? '原生适配器（native）'
              : '自定义适配器（template）'}
          </Tag>
        </div>
      </div>
      <div className="pv_adapter_preset_row">
        <span>适配器协议基底</span>
        <Select
          value={baseTemplate}
          options={ADAPTER_BASE_TEMPLATE_OPTIONS}
          onChange={(value) =>
            applyBaseTemplate(value as Parameters<typeof applyAdapterBaseTemplate>[1])
          }
        />
        <button type="button" className="pv_adapter_chip" onClick={() => applyBaseTemplate()}>
          重新套用当前基底
        </button>
        {baseTemplate === 'openai-compatible' && domain === 'image' && (
          <>
            <span>OpenAI 图片接口</span>
            <Select
              value={
                manifest.capabilities[0]?.id === 'image.edit' ? 'image.edit' : 'image.generate'
              }
              options={[
                { label: '文生图（/images/generations）', value: 'image.generate' },
                { label: '图生图 / 图片编辑（/images/edits）', value: 'image.edit' },
              ]}
              onChange={(value) => {
                const capabilityId = String(value)
                const capability = createEditorCapability(capabilityId)
                onChange(
                  applyAdapterBaseTemplate(
                    {
                      ...manifest,
                      capabilities: [
                        {
                          ...capability,
                          label: capabilityDisplayName(capabilityId),
                        },
                      ],
                    },
                    'openai-compatible',
                  ),
                )
              }}
            />
          </>
        )}
        {baseTemplate === 'openai-compatible' && domain === 'video' && (
          <>
            <span>OpenAI 视频接口</span>
            <Select
              value={
                manifest.capabilities[0]?.id === 'video.image_to_video'
                  ? 'video.image_to_video'
                  : 'video.generate'
              }
              options={[
                { label: '文生视频', value: 'video.generate' },
                { label: '参考图生视频（文件上传）', value: 'video.image_to_video' },
              ]}
              onChange={(value) => {
                const capabilityId = String(value)
                const capability = createEditorCapability(capabilityId)
                onChange(
                  applyAdapterBaseTemplate(
                    {
                      ...manifest,
                      capabilities: [
                        {
                          ...capability,
                          label: capabilityDisplayName(capabilityId),
                        },
                      ],
                    },
                    'openai-compatible',
                  ),
                )
              }}
            />
          </>
        )}
        <span className="pv_adapter_hint">
          选择后会替换当前协议字段并立即回显；保留模型 ID、显示名称和 Provider API Key。
        </span>
      </div>
      <div className="pv_adapter_grid pv_adapter_grid_2">
        <Field label="模型 ID" required hint="渠道真实模型 ID（modelId）">
          <Input
            value={manifest.modelId}
            onChange={(e) =>
              onChange({
                ...manifest,
                modelId: e.target.value,
                displayName:
                  manifest.displayName === manifest.modelId ? e.target.value : manifest.displayName,
              })
            }
          />
        </Field>
        <Field label="显示名称" required hint="在模型清单中展示的名称（displayName）">
          <Input
            value={manifest.displayName}
            onChange={(e) => onChange({ ...manifest, displayName: e.target.value })}
          />
        </Field>
        <Field label="媒体类型" required hint="协议字段：domains">
          <Select
            value={domain}
            options={[
              { label: '图片', value: 'image' },
              { label: '视频', value: 'video' },
              { label: '音频', value: 'audio' },
            ]}
            onChange={(value) => setDomain(String(value))}
          />
        </Field>
        <Field label="适配器模式" hint="协议字段：adapterMode；template 才会使用下方声明式请求配置">
          <Select
            value={manifest.adapterMode ?? 'template'}
            options={[
              { label: '自定义 HTTP 适配器（template）', value: 'template' },
              { label: '原生适配器（native）', value: 'native' },
            ]}
            onChange={(value) =>
              update({ adapterMode: value as MediaModelManifest['adapterMode'] })
            }
          />
        </Field>
        <Field label="协议版本" hint="当前使用 Contract V2（contractVersion）">
          <Input value="2" disabled />
        </Field>
        <Field label="配置版本" hint="用于标记你的适配器配置版本（version）">
          <Input
            value={manifest.version ?? ''}
            placeholder="例如 1.0.0"
            onChange={(e) => update({ version: e.target.value || undefined })}
          />
        </Field>
      </div>
      <div className="pv_adapter_id_line">
        <span>配置唯一标识</span>
        <code>{manifest.id}</code>
        <span className="pv_adapter_hint">
          仅用于区分配置，不会发给渠道；修改渠道模型 ID 时不会变化
        </span>
      </div>
    </section>
  )
}

function Field({
  label,
  required = false,
  hint,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="pv_adapter_field">
      <span className="pv_adapter_field_label">
        {label}
        {required && <em>*</em>}
        {hint && <small>{hint}</small>}
      </span>
      {children}
    </label>
  )
}

const EDITOR_CAPABILITY_IDS = [
  'image.generate',
  'image.edit',
  'image.variations',
  'video.generate',
  'video.image_to_video',
  'video.reference_to_video',
  'video.edit',
  'video.extend',
  'audio.speech',
  'audio.music',
  'audio.transcription',
] as const

const CAPABILITY_DISPLAY_NAMES: Record<string, string> = {
  'image.generate': '文生图',
  'image.edit': '图生图 / 图片编辑',
  'image.variations': '图片变体',
  'video.generate': '文生视频',
  'video.image_to_video': '图生视频',
  'video.reference_to_video': '参考图生视频',
  'video.edit': '视频编辑',
  'video.extend': '视频扩展',
  'audio.speech': '语音合成',
  'audio.music': '音乐生成',
  'audio.transcription': '语音转文字',
}

const INPUT_DISPLAY_NAMES: Record<string, string> = {
  prompt: '文本提示词',
  image: '单张图片',
  images: '多张图片',
  video: '视频文件',
  audio: '音频文件',
  mask: '蒙版图片',
  file: '其他文件',
}

function capabilityDisplayName(id: string): string {
  return CAPABILITY_DISPLAY_NAMES[id] ?? '自定义能力'
}

function inputKindDisplayName(kind: string): string {
  return INPUT_DISPLAY_NAMES[kind] ?? kind
}

function bodyKindDisplayName(kind: string): string {
  return (
    (
      { none: '无请求体', json: 'JSON', multipart: '表单上传', binary: '二进制' } as Record<
        string,
        string
      >
    )[kind] ?? kind
  )
}

function createEditorCapability(id: string): MediaModelCapabilityManifest {
  const isImage = id.startsWith('image.')
  const isVideo = id.startsWith('video.')
  const inputRequired: MediaModelCapabilityManifest['input']['required'] = ['prompt']
  if (id === 'image.edit' || id === 'image.variations' || id === 'video.reference_to_video')
    inputRequired.push('image')
  if (id === 'video.image_to_video') inputRequired.push('image')
  if (id === 'video.edit') inputRequired.push('video')
  if (id === 'video.extend') inputRequired.push('video')
  return {
    id,
    label: id,
    input: {
      required: inputRequired,
      ...(isImage || isVideo ? { maxImages: id === 'video.image_to_video' ? 2 : 16 } : {}),
    },
    rolePolicy:
      id === 'image.edit' || id === 'image.variations' || id === 'video.reference_to_video'
        ? { imageRoles: ['reference_image'], defaultRoleAssignment: 'all_reference' }
        : id === 'video.image_to_video'
          ? {
              imageRoles: ['first_frame', 'last_frame'],
              defaultRoleAssignment: 'first_then_last_then_reference',
            }
          : undefined,
    output: { types: [isVideo ? 'video' : isImage ? 'image' : 'audio'] },
    paramSchema: { type: 'object', additionalProperties: true, properties: {} },
  }
}

function CapabilityIoEditor({ manifest, onChange }: ProviderManifestContractEditorProps) {
  const [selectedCapabilityId, setSelectedCapabilityId] = useState(
    manifest?.capabilities[0]?.id ?? '',
  )
  if (!manifest) return null
  const activeCapabilityId = manifest.capabilities.some((item) => item.id === selectedCapabilityId)
    ? selectedCapabilityId
    : (manifest.capabilities[0]?.id ?? '')
  const capability =
    manifest.capabilities.find((item) => item.id === activeCapabilityId) ?? manifest.capabilities[0]
  if (!capability) return null
  const capabilityIndex = manifest.capabilities.findIndex((item) => item.id === capability.id)
  const input =
    capability.input && !Array.isArray(capability.input)
      ? capability.input
      : { required: [] as MediaModelCapabilityManifest['input']['required'] }
  const output =
    capability.output && !Array.isArray(capability.output)
      ? capability.output
      : { types: ['image'] as MediaModelCapabilityManifest['output']['types'] }
  const updateCapability = (patch: Partial<MediaModelCapabilityManifest>) =>
    onChange({
      ...manifest,
      capabilities: manifest.capabilities.map((item, index) =>
        index === capabilityIndex ? { ...item, ...patch } : item,
      ),
    })
  const updateInput = (patch: Partial<MediaModelCapabilityManifest['input']>) =>
    updateCapability({ input: { ...input, ...patch } })
  const updateOutput = (patch: Partial<MediaModelCapabilityManifest['output']>) =>
    updateCapability({ output: { ...output, ...patch } })
  const toggleInput = (kind: MediaModelCapabilityManifest['input']['required'][number]) => {
    const current = input.required
    updateInput({
      required: current.includes(kind)
        ? current.filter((item) => item !== kind)
        : [...current, kind],
    })
  }
  const addCapability = (id: string) => {
    if (!id || manifest.capabilities.some((item) => item.id === id)) return
    const next = createEditorCapability(id)
    onChange({ ...manifest, capabilities: [...manifest.capabilities, next] })
    setSelectedCapabilityId(id)
  }
  return (
    <section className="pv_adapter_section">
      <div className="pv_adapter_section_head">
        <div>
          <strong>② 能力与输入输出</strong>
          <div className="pv_adapter_hint">
            声明画布可以调用的能力、输入角色、文件格式限制和产物类型。
          </div>
        </div>
        <Tag color="blue">{manifest.capabilities.length} 项能力</Tag>
      </div>
      <div className="pv_adapter_cap_tabs">
        {manifest.capabilities.map((item) => (
          <button
            type="button"
            className={`pv_adapter_chip${item.id === capability.id ? ' is-on' : ''}`}
            key={item.id}
            onClick={() => setSelectedCapabilityId(item.id)}
          >
            {capabilityDisplayName(item.id)}
            <small>（{item.id}）</small>
          </button>
        ))}
        <select
          className="pv_adapter_capability_add"
          defaultValue=""
          onChange={(event) => {
            addCapability(event.target.value)
            event.currentTarget.value = ''
          }}
        >
          <option value="">+ 添加能力</option>
          {EDITOR_CAPABILITY_IDS.filter(
            (id) => !manifest.capabilities.some((item) => item.id === id),
          ).map((id) => (
            <option key={id} value={id}>
              {capabilityDisplayName(id)}（{id}）
            </option>
          ))}
        </select>
      </div>
      <div className="pv_adapter_grid pv_adapter_grid_2">
        <Field label="能力标识" required hint="协议字段：capability id">
          <Input
            value={capability.id}
            onChange={(e) => {
              const id = e.target.value
              const nextCapabilities = manifest.capabilities.map((item, index) =>
                index === capabilityIndex ? { ...item, id } : item,
              )
              onChange({ ...manifest, capabilities: nextCapabilities })
              setSelectedCapabilityId(id)
            }}
          />
        </Field>
        <Field label="能力名称" required hint="画布中展示的名称（label）">
          <Input
            value={capability.label}
            onChange={(e) => updateCapability({ label: e.target.value })}
          />
        </Field>
        <Field label="需要的输入" hint="选择画布调用时需要的媒体类型（input.required）">
          <div className="pv_adapter_chip_row">
            {(['prompt', 'image', 'images', 'video', 'audio', 'mask', 'file'] as const).map(
              (kind) => (
                <button
                  type="button"
                  key={kind}
                  className={`pv_adapter_chip${input.required.includes(kind) ? ' is-on' : ''}`}
                  onClick={() => toggleInput(kind)}
                >
                  {inputKindDisplayName(kind)}
                </button>
              ),
            )}
          </div>
        </Field>
        <Field label="支持的文件格式" hint="多个格式用逗号分隔（acceptedMimeTypes）">
          <Input
            value={(input.acceptedMimeTypes ?? []).join(', ')}
            placeholder="image/png, image/jpeg"
            onChange={(e) => updateInput({ acceptedMimeTypes: splitList(e.target.value) })}
          />
        </Field>
        <Field label="最多图片数量" hint="协议字段：maxImages">
          <Input
            type="number"
            value={input.maxImages == null ? '' : String(input.maxImages)}
            onChange={(e) => updateInput({ maxImages: numberOrUndefined(e.target.value) })}
          />
        </Field>
        <Field label="输出类型" required hint="协议字段：output.types">
          <Input
            value={output.types.join(', ')}
            placeholder="image"
            onChange={(e) =>
              updateOutput({
                types: splitList(e.target.value) as MediaModelCapabilityManifest['output']['types'],
              })
            }
          />
        </Field>
      </div>
    </section>
  )
}

function InvocationEditor({ manifest, onChange }: ProviderManifestContractEditorProps) {
  if (!manifest) return null
  const request = toEditableRequest(manifest)
  const response = manifest.invocation.response
  const updateManifest = (nextRequest: MediaInvocationRequest): void => {
    const legacyFields = legacyInvocationFields(nextRequest, manifest.invocation.contentType)
    onChange({
      ...manifest,
      contractVersion: 2,
      adapterMode: manifest.adapterMode ?? 'template',
      invocation: { ...manifest.invocation, ...legacyFields, request: nextRequest },
    })
  }
  return (
    <section
      style={{ borderTop: '1px solid var(--lobe-outline)', padding: '12px 0', marginBottom: 8 }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <strong>请求与响应传输</strong>
        <Tag color={manifest.adapterMode === 'native' ? 'default' : 'blue'}>
          {manifest.adapterMode === 'native' ? '原生适配器（native）' : '自定义适配器（template）'}
        </Tag>
        <Tag color={manifest.contractVersion === 2 ? 'green' : 'default'}>
          Contract V{manifest.contractVersion ?? 1}
        </Tag>
      </header>
      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>
        这里编辑 Provider 的 HTTP 传输骨架；请求体模板和 JSON 路径仍保留在下方原始 JSON
        中，便于处理复杂嵌套结构。
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 2fr) minmax(120px, 1fr)',
          gap: 8,
          marginBottom: 8,
        }}
      >
        <label>
          <span className="pv_form_label">提交端点</span>
          <Input
            value={request.endpoint}
            placeholder="如 /v1/images/generations"
            onChange={(event) => updateManifest({ ...request, endpoint: event.target.value })}
          />
        </label>
        <label>
          <span className="pv_form_label">HTTP 方法</span>
          <Select
            value={request.method}
            options={['POST', 'GET', 'PUT', 'PATCH', 'DELETE'].map((value) => ({
              label: value,
              value,
            }))}
            onChange={(value) =>
              updateManifest({ ...request, method: value as MediaInvocationRequest['method'] })
            }
          />
        </label>
      </div>
      <AuthEditor auth={request.auth} onChange={(auth) => updateManifest({ ...request, auth })} />
      <RequestBodyEditor request={request} onChange={updateManifest} />
      <UploadEditor manifest={manifest} onChange={onChange} />
      <ResponseKindEditor manifest={manifest} onChange={onChange} />
      {response.kind === 'task_poll' && (
        <PollEditor
          response={response}
          polling={manifest.invocation.polling}
          onChange={(nextResponse, polling) => {
            onChange({
              ...manifest,
              contractVersion: 2,
              adapterMode: manifest.adapterMode ?? 'template',
              invocation: { ...manifest.invocation, response: nextResponse, polling },
            })
          }}
        />
      )}
    </section>
  )
}

function ResponseKindEditor({ manifest, onChange }: ProviderManifestContractEditorProps) {
  if (!manifest) return null
  const response = manifest.invocation.response
  const setKind = (kind: MediaArtifactRetrieval['kind']) => {
    if (kind === 'task_poll') {
      onChange({
        ...manifest,
        invocation: {
          ...manifest.invocation,
          mode: 'async_polling',
          response: {
            kind,
            taskIdPaths: ['id', 'task_id'],
            resultPaths: ['data[].url', 'result.data[].url'],
            poll: {
              method: 'GET',
              endpoint: '/tasks/{{taskId}}',
              auth: { kind: 'inherit' },
              body: { kind: 'none' },
            },
            taskId: { location: 'path', name: 'taskId' },
          },
          polling: manifest.invocation.polling ?? {
            intervalMs: 5000,
            timeoutMs: 600000,
            maxAttempts: 120,
            unknownStatus: 'fail',
            statusMap: {
              queued: 'queued',
              pending: 'queued',
              running: 'running',
              completed: 'succeeded',
              failed: 'failed',
            },
          },
        },
      })
    } else if (kind === 'inline_base64')
      onChange({
        ...manifest,
        invocation: {
          ...manifest.invocation,
          mode: 'sync',
          response: { kind, jsonPaths: ['data[].b64_json', 'data[].base64'] },
        },
      })
    else if (kind === 'binary_response')
      onChange({
        ...manifest,
        invocation: { ...manifest.invocation, mode: 'sync', response: { kind } },
      })
    else
      onChange({
        ...manifest,
        invocation: {
          ...manifest.invocation,
          mode: 'sync',
          response: { kind: 'url', jsonPaths: ['data[].url', 'output.url', 'url'], download: true },
        },
      })
  }
  return (
    <section className="pv_adapter_subsection">
      <div className="pv_adapter_subhead">
        <strong>⑤ 响应与轮询</strong>
        <span>提交请求和异步查询请求分别配置</span>
      </div>
      <Field label="结果类型" required hint="协议字段：response.kind">
        <Select
          value={response.kind}
          options={[
            { label: '图片/视频地址（url）', value: 'url' },
            { label: 'Base64 数据（inline_base64）', value: 'inline_base64' },
            { label: '异步任务轮询（task_poll）', value: 'task_poll' },
            { label: '二进制响应（binary_response）', value: 'binary_response' },
          ]}
          onChange={(value) => setKind(value as MediaArtifactRetrieval['kind'])}
        />
      </Field>
      {response.kind !== 'task_poll' && response.kind !== 'binary_response' && (
        <Field label="产物地址路径" hint="JSON 路径，多个路径按顺序取首个命中">
          <Input
            value={response.jsonPaths.join(', ')}
            onChange={(e) =>
              onChange({
                ...manifest,
                invocation: {
                  ...manifest.invocation,
                  response: { ...response, jsonPaths: splitList(e.target.value) },
                },
              })
            }
          />
        </Field>
      )}
      {response.kind === 'url' && (
        <label className="pv_adapter_checkbox">
          <Checkbox
            checked={response.download}
            onChange={(checked) =>
              onChange({
                ...manifest,
                invocation: {
                  ...manifest.invocation,
                  response: { ...response, download: checked },
                },
              })
            }
          />
          下载到本地后入库
        </label>
      )}
    </section>
  )
}

function toEditableRequest(manifest: MediaModelManifest): MediaInvocationRequest {
  if (manifest.invocation.request) return manifest.invocation.request
  return {
    method: manifest.invocation.method,
    endpoint: manifest.invocation.endpoint,
    headers: manifest.invocation.headers,
    auth: { kind: 'bearer', credentialRef: 'apiKey' },
    body:
      manifest.invocation.method === 'GET'
        ? { kind: 'none' }
        : manifest.invocation.contentType === 'json'
          ? { kind: 'json', template: manifest.invocation.requestTemplate }
          : manifest.invocation.contentType === 'multipart'
            ? {
                kind: 'multipart',
                parts: Object.entries(manifest.invocation.requestTemplate).map(([name, value]) => ({
                  name,
                  kind: 'text' as const,
                  value,
                })),
              }
            : { kind: 'binary', variable: '{{inputFiles}}' },
  }
}

function legacyInvocationFields(
  request: MediaInvocationRequest,
  fallbackContentType: MediaModelManifest['invocation']['contentType'],
): Pick<
  MediaModelManifest['invocation'],
  'endpoint' | 'method' | 'headers' | 'contentType' | 'requestTemplate'
> {
  const body = request.body
  if (body?.kind === 'json') {
    return {
      endpoint: request.endpoint,
      method: request.method,
      headers: request.headers,
      contentType: 'json',
      requestTemplate: isRecord(body.template) ? body.template : { value: body.template },
    }
  }
  if (body?.kind === 'multipart') {
    return {
      endpoint: request.endpoint,
      method: request.method,
      headers: request.headers,
      contentType: 'multipart',
      requestTemplate: Object.fromEntries(body.parts.map((part) => [part.name, part.value])),
    }
  }
  if (body?.kind === 'binary') {
    return {
      endpoint: request.endpoint,
      method: request.method,
      headers: request.headers,
      contentType: 'binary',
      requestTemplate: { input: body.variable },
    }
  }
  return {
    endpoint: request.endpoint,
    method: request.method,
    headers: request.headers,
    contentType: fallbackContentType,
    requestTemplate: {},
  }
}

function RequestBodyEditor({
  request,
  onChange,
  title = '③ 鉴权与提交',
  description = '请求方法、端点、请求头和请求体均可配置',
}: {
  request: MediaInvocationRequest
  onChange: (next: MediaInvocationRequest) => void
  title?: string
  description?: string
}) {
  const body = request.body ?? { kind: 'none' as const }
  const bodyKind = body.kind
  const setBodyKind = (kind: MediaInvocationBody['kind']) => {
    if (kind === 'json')
      onChange({
        ...request,
        body: { kind, template: { model: '{{modelId}}', prompt: '{{prompt}}' } },
      })
    else if (kind === 'multipart')
      onChange({
        ...request,
        body: { kind, parts: [{ name: 'file', kind: 'file', value: '{{upload.item}}' }] },
      })
    else if (kind === 'binary') onChange({ ...request, body: { kind, variable: '{{inputFiles}}' } })
    else onChange({ ...request, body: { kind: 'none' } })
  }
  return (
    <section className="pv_adapter_subsection">
      <div className="pv_adapter_subhead">
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      <div className="pv_adapter_grid pv_adapter_grid_2">
        <Field label="查询参数" hint="JSON；支持 {{modelId}} 等变量（query）">
          <JsonInput
            value={request.query ?? {}}
            onChange={(query) =>
              onChange({
                ...request,
                query: isRecord(query) && Object.keys(query).length ? query : undefined,
              })
            }
          />
        </Field>
        <Field label="请求头" hint="JSON；不要在这里硬编码 API Key（headers）">
          <JsonInput
            value={request.headers ?? {}}
            onChange={(headers) =>
              onChange({
                ...request,
                headers: isRecord(headers) && Object.keys(headers).length ? headers : undefined,
              })
            }
          />
        </Field>
      </div>
      <Field label="请求体类型" hint="数字、布尔、数组字段请使用整字段变量（body）">
        <div className="pv_adapter_chip_row">
          {(['none', 'json', 'multipart', 'binary'] as const).map((kind) => (
            <button
              type="button"
              key={kind}
              className={`pv_adapter_chip${bodyKind === kind ? ' is-on' : ''}`}
              onClick={() => setBodyKind(kind)}
            >
              {bodyKindDisplayName(kind)}
            </button>
          ))}
        </div>
      </Field>
      {body.kind === 'json' && (
        <Field
          label="JSON 请求体模板"
          hint="支持 {{modelId}}、{{prompt}}、{{params.xxx}}、{{uploads.name.urls}}"
        >
          <JsonInput
            rows={12}
            value={body.template}
            onChange={(template) => onChange({ ...request, body: { kind: 'json', template } })}
          />
        </Field>
      )}
      {body.kind === 'multipart' && (
        <Field label="表单字段配置（multipart）" hint="kind 可填 text / json / file">
          <JsonInput
            rows={8}
            value={body.parts}
            onChange={(parts) => {
              if (Array.isArray(parts))
                onChange({
                  ...request,
                  body: {
                    kind: 'multipart',
                    parts: parts as Extract<MediaInvocationBody, { kind: 'multipart' }>['parts'],
                  },
                })
            }}
          />
        </Field>
      )}
      {body.kind === 'binary' && (
        <Field label="二进制输入变量" hint="协议字段：binary variable">
          <Input
            value={body.variable}
            onChange={(e) =>
              onChange({ ...request, body: { kind: 'binary', variable: e.target.value } })
            }
          />
        </Field>
      )}
    </section>
  )
}

function UploadEditor({ manifest, onChange }: ProviderManifestContractEditorProps) {
  if (!manifest) return null
  const uploads = manifest.invocation.uploads ?? []
  return (
    <section className="pv_adapter_subsection">
      <div className="pv_adapter_subhead">
        <strong>④ 文件与上传</strong>
        <span>本地文件先上传，再把返回地址注入主请求</span>
      </div>
      <Field label="文件上传配置" hint="每个上传定义名称、输入、请求、结果路径、限制和清理策略">
        <JsonInput
          rows={Math.max(6, uploads.length ? 12 : 6)}
          value={uploads}
          onChange={(nextUploads) => {
            if (Array.isArray(nextUploads))
              onChange({
                ...manifest,
                invocation: {
                  ...manifest.invocation,
                  uploads: nextUploads.length ? (nextUploads as typeof uploads) : undefined,
                },
              })
          }}
        />
      </Field>
      <div className="pv_adapter_hint">
        上传失败不会发送主请求；上传鉴权独立配置，inherit 只继承 credential profile，不复制已渲染
        Header。
      </div>
    </section>
  )
}

function AuthEditor({
  auth,
  onChange,
  allowInherit = false,
}: {
  auth: MediaInvocationAuth | undefined
  onChange: (auth: MediaInvocationAuth) => void
  allowInherit?: boolean
}) {
  const effectiveAuth =
    auth ??
    (allowInherit
      ? ({ kind: 'inherit' } as const)
      : ({ kind: 'bearer', credentialRef: 'apiKey' } as const))
  const authOptions: Array<readonly [MediaInvocationAuth['kind'], string]> = [
    ...(allowInherit ? ([['inherit', '继承提交请求的鉴权方式']] as const) : []),
    ['bearer', 'Bearer 令牌 · 使用 Provider API Key'],
    ['api_key_header', 'API Key · 请求头'],
    ['api_key_query', 'API Key · 查询参数'],
    ['none', '无鉴权'],
  ]
  const changeKind = (kind: MediaInvocationAuth['kind']): void => {
    if (kind === 'api_key_header') onChange({ kind, name: 'X-API-Key', credentialRef: 'apiKey' })
    else if (kind === 'api_key_query') onChange({ kind, name: 'api_key', credentialRef: 'apiKey' })
    else if (kind === 'bearer') onChange({ kind, credentialRef: 'apiKey' })
    else if (kind === 'inherit') onChange({ kind })
    else onChange({ kind })
  }
  return (
    <div style={{ marginBottom: 8 }}>
      <label className="pv_form_label">鉴权方式</label>
      <Select
        value={effectiveAuth.kind}
        options={authOptions.map(([value, label]) => ({ label, value }))}
        onChange={(value) => changeKind(value as MediaInvocationAuth['kind'])}
      />
      {(effectiveAuth.kind === 'api_key_header' || effectiveAuth.kind === 'api_key_query') && (
        <Input
          style={{ marginTop: 6 }}
          value={effectiveAuth.name}
          placeholder={effectiveAuth.kind === 'api_key_header' ? 'X-API-Key' : 'api_key'}
          onChange={(event) => onChange({ ...effectiveAuth, name: event.target.value })}
        />
      )}
    </div>
  )
}

function PollEditor({
  response,
  polling,
  onChange,
}: {
  response: Extract<MediaArtifactRetrieval, { kind: 'task_poll' }>
  polling: MediaModelManifest['invocation']['polling']
  onChange: (
    next: MediaArtifactRetrieval,
    polling: MediaModelManifest['invocation']['polling'],
  ) => void
}) {
  const poll = response.poll ?? {
    method: 'GET' as const,
    endpoint: response.statusEndpoint ?? '',
    auth: { kind: 'inherit' as const },
    body: { kind: 'none' as const },
  }
  const updatePoll = (next: Partial<MediaInvocationRequest>): void => {
    onChange({ ...response, poll: { ...poll, ...next } }, polling)
  }
  const taskId = response.taskId ?? { location: 'path' as const, name: 'taskId' }
  const updateTaskId = (next: Partial<MediaTaskIdPlacement>): void => {
    onChange({ ...response, taskId: { ...taskId, ...next } }, polling)
  }
  const effectivePolling = polling ?? { intervalMs: 5000, timeoutMs: 600_000, statusMap: {} }
  const artifact = response.artifact
  const updateArtifactRequest = (next: MediaInvocationRequest): void => {
    if (!artifact) return
    onChange({ ...response, artifact: { ...artifact, request: next } }, polling)
  }
  const setArtifactEnabled = (enabled: boolean): void => {
    if (!enabled) {
      const { artifact: _artifact, ...nextResponse } = response
      onChange(nextResponse, polling)
      return
    }
    onChange(
      {
        ...response,
        artifact: {
          request: {
            method: 'GET',
            endpoint: '/tasks/{{taskId}}/content',
            auth: { kind: 'inherit' },
            body: { kind: 'none' },
          },
          response: { kind: 'binary_response' },
        },
      },
      polling,
    )
  }
  const setArtifactResponseKind = (
    kind: NonNullable<typeof response.artifact>['response']['kind'],
  ): void => {
    if (!artifact) return
    let nextResponse: MediaDirectArtifactRetrieval
    if (kind === 'binary_response') nextResponse = { kind }
    else if (kind === 'inline_base64')
      nextResponse = { kind, jsonPaths: ['data[].b64_json', 'data.base64'] }
    else nextResponse = { kind: 'url', jsonPaths: ['data.url', 'url'], download: true }
    onChange({ ...response, artifact: { ...artifact, response: nextResponse } }, polling)
  }
  const updateArtifactResponsePaths = (jsonPaths: string[]): void => {
    if (!artifact || artifact.response.kind === 'binary_response') return
    onChange(
      {
        ...response,
        artifact: {
          ...artifact,
          response: { ...artifact.response, jsonPaths },
        },
      },
      polling,
    )
  }
  return (
    <div style={{ borderTop: '1px dashed var(--lobe-outline)', paddingTop: 8, marginTop: 4 }}>
      <strong style={{ fontSize: 12 }}>异步轮询</strong>
      <div className="pv_adapter_grid pv_adapter_grid_2" style={{ marginTop: 6 }}>
        <Field label="任务 ID 提取路径" hint="从提交响应提取任务 ID（taskIdPaths）">
          <Input
            value={response.taskIdPaths.join(', ')}
            onChange={(event) =>
              onChange({ ...response, taskIdPaths: splitList(event.target.value) }, polling)
            }
          />
        </Field>
        <Field label="结果提取路径" required hint="从完成响应提取产物地址（resultPaths）">
          <Input
            value={response.resultPaths.join(', ')}
            onChange={(event) =>
              onChange({ ...response, resultPaths: splitList(event.target.value) }, polling)
            }
          />
        </Field>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 2fr) minmax(120px, 1fr)',
          gap: 8,
          marginTop: 6,
        }}
      >
        <Field label="轮询端点" required>
          <Input
            value={poll.endpoint}
            placeholder="如 /v1/tasks/{taskId}"
            onChange={(event) => updatePoll({ endpoint: event.target.value })}
          />
        </Field>
        <Field label="轮询请求方法" required>
          <Select
            value={poll.method}
            options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((value) => ({
              label: value,
              value,
            }))}
            onChange={(value) => updatePoll({ method: value as MediaInvocationRequest['method'] })}
          />
        </Field>
        <Field label="任务 ID 放置位置" required>
          <Select
            value={taskId.location}
            options={[
              { label: '路径', value: 'path' },
              { label: '查询参数', value: 'query' },
              { label: '请求头', value: 'header' },
              { label: '请求体', value: 'body' },
            ]}
            onChange={(value) =>
              updateTaskId({ location: value as MediaTaskIdPlacement['location'] })
            }
          />
        </Field>
        <Field label="任务 ID 参数名" required hint="路径模式通常填写 taskId">
          <Input
            value={taskId.name}
            placeholder="taskId"
            onChange={(event) => updateTaskId({ name: event.target.value })}
          />
        </Field>
      </div>
      <AuthEditor auth={poll.auth} allowInherit onChange={(auth) => updatePoll({ auth })} />
      <RequestBodyEditor
        request={poll}
        title="轮询请求参数"
        description="轮询可独立配置查询参数、请求头和请求体"
        onChange={(nextPoll) => onChange({ ...response, poll: nextPoll }, polling)}
      />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
        <Input
          type="number"
          value={String(effectivePolling.intervalMs)}
          onChange={(event) =>
            onChange(response, {
              ...effectivePolling,
              intervalMs: Math.max(1, Number(event.target.value) || 1),
            })
          }
        />
        <Input
          type="number"
          value={String(effectivePolling.maxAttempts ?? 120)}
          onChange={(event) =>
            onChange(response, {
              ...effectivePolling,
              maxAttempts: Math.max(1, Number(event.target.value) || 1),
            })
          }
        />
      </div>
      <div className="pv_adapter_grid pv_adapter_grid_2" style={{ marginTop: 6 }}>
        <Field label="轮询超时时间（毫秒）" hint="协议字段：timeoutMs">
          <Input
            type="number"
            value={String(effectivePolling.timeoutMs)}
            onChange={(event) =>
              onChange(response, {
                ...effectivePolling,
                timeoutMs: Math.max(1000, Number(event.target.value) || 1000),
              })
            }
          />
        </Field>
        <Field label="遇到未知状态时" hint="协议字段：unknownStatus">
          <Select
            value={effectivePolling.unknownStatus ?? 'fail'}
            options={[
              { label: '终止任务（fail）', value: 'fail' },
              { label: '继续轮询（running）', value: 'running' },
            ]}
            onChange={(value) =>
              onChange(response, {
                ...effectivePolling,
                unknownStatus: value as 'fail' | 'running',
              })
            }
          />
        </Field>
      </div>
      <Field
        label="任务状态映射"
        hint="JSON：渠道状态 → 排队中 / 处理中 / 成功 / 失败（statusMap）"
      >
        <JsonInput
          value={effectivePolling.statusMap}
          onChange={(statusMap) =>
            onChange(response, {
              ...effectivePolling,
              statusMap: isRecord(statusMap)
                ? (statusMap as typeof effectivePolling.statusMap)
                : {},
            })
          }
        />
      </Field>
      <label className="pv_adapter_checkbox">
        <Checkbox checked={Boolean(artifact)} onChange={setArtifactEnabled} />
        任务完成后再请求一次产物（适用于 OpenAI 视频等二阶段下载接口）
      </label>
      {artifact && (
        <section className="pv_adapter_subsection" style={{ marginTop: 8 }}>
          <div className="pv_adapter_subhead">
            <strong>完成后产物请求</strong>
            <span>
              可使用 {'{{taskId}}'} 和 {'{{poll.xxx}}'} 变量
            </span>
          </div>
          <div className="pv_adapter_grid pv_adapter_grid_2">
            <Field label="产物端点" required hint="例如 /videos/{{taskId}}/content">
              <Input
                value={artifact.request.endpoint}
                onChange={(event) =>
                  updateArtifactRequest({ ...artifact.request, endpoint: event.target.value })
                }
              />
            </Field>
            <Field label="产物请求方法" required>
              <Select
                value={artifact.request.method}
                options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((value) => ({
                  label: value,
                  value,
                }))}
                onChange={(value) =>
                  updateArtifactRequest({
                    ...artifact.request,
                    method: value as MediaInvocationRequest['method'],
                  })
                }
              />
            </Field>
          </div>
          <AuthEditor
            auth={artifact.request.auth}
            allowInherit
            onChange={(auth) => updateArtifactRequest({ ...artifact.request, auth })}
          />
          <RequestBodyEditor
            request={artifact.request}
            title="产物请求参数"
            description="配置查询参数、请求头和请求体；API Key 仍引用 Provider 凭据"
            onChange={updateArtifactRequest}
          />
          <Field label="产物响应类型" required>
            <Select
              value={artifact.response.kind}
              options={[
                { label: '二进制文件', value: 'binary_response' },
                { label: '产物地址', value: 'url' },
                { label: 'Base64 数据', value: 'inline_base64' },
              ]}
              onChange={(value) =>
                setArtifactResponseKind(
                  value as NonNullable<typeof response.artifact>['response']['kind'],
                )
              }
            />
          </Field>
          {artifact.response.kind !== 'binary_response' && (
            <Field label="产物提取路径" required hint="多个 JSON 路径用逗号分隔">
              <Input
                value={artifact.response.jsonPaths.join(', ')}
                onChange={(event) => updateArtifactResponsePaths(splitList(event.target.value))}
              />
            </Field>
          )}
        </section>
      )}
      <div style={{ display: 'flex', gap: 8, fontSize: 12, opacity: 0.65, marginTop: 4 }}>
        <span>间隔（ms）</span>
        <span>最大轮询次数</span>
      </div>
      <div style={{ fontSize: 12, opacity: 0.65, marginTop: 4 }}>
        任务状态、结果 JSON 路径和请求体仍在原始 JSON 中维护；保存前会执行结构校验和安全校验。
      </div>
    </div>
  )
}

interface CapabilityEditorProps {
  manifest: MediaModelManifest
  capability: MediaModelCapabilityManifest
  index: number
  onChange: (next: MediaModelManifest) => void
}

function CapabilityEditor({ manifest, capability, index, onChange }: CapabilityEditorProps) {
  const policy = capability.paramPolicy ?? { strict: false, passthrough: { enabled: true } }
  const errorContract = manifest.error

  const updateCapability = (next: Partial<MediaModelCapabilityManifest>): void => {
    const nextCapabilities = manifest.capabilities.map((cap, i) =>
      i === index ? { ...cap, ...next } : cap,
    )
    onChange({ ...manifest, capabilities: nextCapabilities })
  }

  const updatePolicy = (next: Partial<MediaModelParamPolicy>): void => {
    const merged: MediaModelParamPolicy = { ...policy, ...next }
    updateCapability({ paramPolicy: merged })
  }

  const updateErrorContract = (next: Partial<MediaErrorContract>): void => {
    const merged: MediaErrorContract = { ...(errorContract ?? {}), ...next }
    onChange({ ...manifest, error: merged })
  }

  return (
    <section
      style={{ borderTop: '1px solid var(--lobe-outline)', padding: '12px 0', marginBottom: 8 }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <strong>{capability.label || capability.id}</strong>
        <Tag color={policy.strict ? 'red' : 'default'}>
          {policy.strict ? '严格校验' : '兼容模式'}
        </Tag>
        <Tag color={policy.passthrough?.enabled ? 'blue' : 'default'}>
          未声明参数透传：{policy.passthrough?.enabled ? '开启' : '关闭'}
        </Tag>
      </header>

      <section className="pv_adapter_subsection">
        <div className="pv_adapter_subhead">
          <strong>⑥ 参数定义</strong>
          <span>JSON Schema 决定画布参数面板与运行时校验</span>
        </div>
        <ProviderManifestParameterEditor
          capability={capability}
          onChange={(nextCapability) => updateCapability(nextCapability)}
        />
        <details className="pv_parameter_advanced">
          <summary>高级：直接编辑 JSON Schema</summary>
          <Field label="完整参数规则" hint="仅在可视化表单无法表达复杂 Schema 时使用">
            <JsonInput
              value={capability.paramSchema ?? { type: 'object', properties: {} }}
              rows={10}
              onChange={(paramSchema) =>
                updateCapability({ paramSchema: isRecord(paramSchema) ? paramSchema : {} })
              }
            />
          </Field>
        </details>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Checkbox
            checked={policy.strict === true}
            onChange={(checked) => updatePolicy({ strict: checked })}
          />
          严格模式（strict）
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Checkbox
            checked={policy.passthrough?.enabled ?? false}
            onChange={(checked) =>
              updatePolicy({
                passthrough: { enabled: checked, ...(policy.passthrough ?? {}) },
              })
            }
          />
          允许透传未声明参数
        </label>
      </div>

      <section className="pv_adapter_subsection">
        <div className="pv_adapter_subhead">
          <strong>⑦ 参数组装与错误契约</strong>
          <span>严格裁剪、转换、互斥字段和错误归一</span>
        </div>
        <div className="pv_adapter_grid pv_adapter_grid_2">
          <Field label="参数转换规则" hint="JSON（transforms）">
            <JsonInput
              value={policy.transforms ?? []}
              rows={6}
              onChange={(transforms) =>
                updatePolicy({
                  transforms: Array.isArray(transforms)
                    ? (transforms as MediaModelParamPolicy['transforms'])
                    : [],
                })
              }
            />
          </Field>
          <Field label="参数冲突规则" hint="JSON（conflicts）">
            <JsonInput
              value={policy.conflicts ?? []}
              rows={6}
              onChange={(conflicts) =>
                updatePolicy({
                  conflicts: Array.isArray(conflicts)
                    ? (conflicts as MediaModelParamPolicy['conflicts'])
                    : [],
                })
              }
            />
          </Field>
        </div>
      </section>

      <PolicyListField
        label="允许透传的参数（白名单）"
        values={policy.passthrough?.allow ?? []}
        placeholder="如 aspect_ratio / output_format"
        onChange={(allow) =>
          updatePolicy({
            passthrough: { ...(policy.passthrough ?? { enabled: false }), allow },
          })
        }
      />
      <PolicyListField
        label="禁止透传的参数（黑名单）"
        values={policy.passthrough?.deny ?? []}
        placeholder="如 mask / tools"
        onChange={(deny) =>
          updatePolicy({
            passthrough: { ...(policy.passthrough ?? { enabled: false }), deny },
          })
        }
      />
      <ForbiddenField
        entries={policy.forbidden ?? []}
        onChange={(forbidden) => updatePolicy({ forbidden })}
      />

      <ErrorContractField
        contract={errorContract}
        onChange={updateErrorContract}
        onClear={() => onChange({ ...manifest, error: undefined })}
      />
    </section>
  )
}

interface PolicyListFieldProps {
  label: string
  values: string[]
  placeholder?: string
  onChange: (next: string[]) => void
}

function PolicyListField({ label, values, placeholder, onChange }: PolicyListFieldProps) {
  const text = values.join(', ')
  return (
    <div style={{ marginBottom: 8 }}>
      <label style={{ display: 'block', marginBottom: 4, fontSize: 12, opacity: 0.75 }}>
        {label}
      </label>
      <Input
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          const next = String(e.target.value)
            .split(/[\s,]+/)
            .map((s) => s.trim())
            .filter(Boolean)
          onChange(next)
        }}
      />
      {values.length > 0 && (
        <div style={{ marginTop: 4 }}>
          {values.map((v) => (
            <Tag key={v} style={{ marginRight: 4 }}>
              {v}
            </Tag>
          ))}
        </div>
      )}
    </div>
  )
}

interface ForbiddenFieldProps {
  entries: MediaParamForbiddenEntry[]
  onChange: (next: MediaParamForbiddenEntry[]) => void
}

function ForbiddenField({ entries, onChange }: ForbiddenFieldProps) {
  const text = useMemo(
    () => entries.map((entry) => `${entry.name}: ${entry.reason}`).join('\n'),
    [entries],
  )
  return (
    <div style={{ marginBottom: 8 }}>
      <label style={{ display: 'block', marginBottom: 4, fontSize: 12, opacity: 0.75 }}>
        禁止使用的参数
        <span style={{ opacity: 0.6 }}>
          （forbidden；每行一个，格式：<code>字段名: 原因</code>）
        </span>
      </label>
      <textarea
        value={text}
        rows={Math.max(2, entries.length)}
        placeholder={'size: 当前模型不支持 size，请改用 aspectRatio'}
        onChange={(e) => {
          const next = String(e.target.value)
            .split(/\n+/)
            .map((line) => {
              const trimmed = line.trim()
              if (!trimmed) return null
              const idx = trimmed.indexOf(':')
              if (idx <= 0) return { name: trimmed, reason: '' }
              const name = trimmed.slice(0, idx).trim()
              const reason = trimmed.slice(idx + 1).trim()
              return name ? { name, reason } : null
            })
            .filter(
              (entry): entry is MediaParamForbiddenEntry => entry != null && entry.name.length > 0,
            )
          onChange(next)
        }}
        style={{ width: '100%', fontFamily: 'inherit', fontSize: 12 }}
      />
    </div>
  )
}

interface ErrorContractFieldProps {
  contract: MediaErrorContract | undefined
  onChange: (next: MediaErrorContract) => void
  onClear: () => void
}

function ErrorContractField({ contract, onChange, onClear }: ErrorContractFieldProps) {
  const paths: Array<[keyof MediaErrorContract, string]> = [
    ['codePaths', '错误代码路径（如 error.code）'],
    ['messagePaths', '错误消息路径'],
    ['paramNamePaths', '错误参数名路径（如 error.param）'],
    ['requestIdPaths', '请求 ID 路径'],
  ]
  return (
    <div style={{ borderTop: '1px dashed var(--lobe-outline)', paddingTop: 8 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 4,
        }}
      >
        <strong style={{ fontSize: 12 }}>错误信息提取规则（manifest.error）</strong>
        {contract && (
          <a onClick={onClear} style={{ fontSize: 12 }}>
            清除
          </a>
        )}
      </div>
      {!contract && (
        <div style={{ opacity: 0.6, fontSize: 12 }}>
          未声明错误契约，provider 400 时退回通用错误。
        </div>
      )}
      {paths.map(([key, label]) => (
        <PolicyListField
          key={key as string}
          label={label}
          values={(contract?.[key] as string[] | undefined) ?? []}
          placeholder="error.code / error.type"
          onChange={(next) => onChange({ ...(contract ?? {}), [key]: next })}
        />
      ))}
    </div>
  )
}

function DocsAndSafetyEditor({ manifest, onChange }: ProviderManifestContractEditorProps) {
  if (!manifest) return null
  const safety = manifest.safety ?? {}
  return (
    <section className="pv_adapter_section">
      <div className="pv_adapter_section_head">
        <div>
          <strong>⑧ 预览与测试 / ⑨ 兼容与发布</strong>
          <div className="pv_adapter_hint">
            保存前会执行 schema + semantic 校验；右侧请求预览使用脱敏凭据，不会发起网络调用。
          </div>
        </div>
        <Tag color="green">向后兼容</Tag>
      </div>
      <div className="pv_adapter_grid pv_adapter_grid_2">
        <Field label="官方文档地址" hint="每行一个文档 URL（docs.sourceUrls）">
          <textarea
            className="pv_adapter_textarea"
            rows={4}
            value={manifest.docs.sourceUrls.join('\n')}
            onChange={(e) =>
              onChange({
                ...manifest,
                docs: {
                  ...manifest.docs,
                  sourceUrls: e.target.value
                    .split(/\n+/)
                    .map((value) => value.trim())
                    .filter(Boolean),
                },
              })
            }
          />
        </Field>
        <Field label="文档核对日期" hint="格式：YYYY-MM-DD（docs.lastCheckedAt）">
          <Input
            value={manifest.docs.lastCheckedAt ?? ''}
            placeholder="YYYY-MM-DD"
            onChange={(e) =>
              onChange({
                ...manifest,
                docs: { ...manifest.docs, lastCheckedAt: e.target.value || undefined },
              })
            }
          />
        </Field>
        <Field label="提示词最大长度" hint="字符数（safety.maxPromptLength）">
          <Input
            type="number"
            value={safety.maxPromptLength == null ? '' : String(safety.maxPromptLength)}
            onChange={(e) =>
              onChange({
                ...manifest,
                safety: { ...safety, maxPromptLength: numberOrUndefined(e.target.value) },
              })
            }
          />
        </Field>
        <Field label="允许本地文件输入" hint="安全设置（safety.allowLocalFiles）">
          <label className="pv_adapter_checkbox">
            <Checkbox
              checked={safety.allowLocalFiles ?? true}
              onChange={(checked) =>
                onChange({ ...manifest, safety: { ...safety, allowLocalFiles: checked } })
              }
            />
            允许本地文件输入
          </label>
        </Field>
      </div>
    </section>
  )
}

function JsonInput({
  value,
  onChange,
  rows = 4,
}: {
  value: unknown
  onChange: (next: unknown) => void
  rows?: number
}) {
  const serializedValue = useMemo(() => JSON.stringify(value, null, 2), [value])
  const [text, setText] = useState(() => serializedValue)
  const [error, setError] = useState('')
  const previousSerializedValue = useRef(serializedValue)
  const emittedSerializedValue = useRef<string | null>(null)
  useEffect(() => {
    if (serializedValue === previousSerializedValue.current) return
    previousSerializedValue.current = serializedValue
    if (serializedValue === emittedSerializedValue.current) {
      emittedSerializedValue.current = null
      return
    }
    if (error) return
    // 只同步来自其它结构化控件或 raw JSON 的外部更新；不格式化用户刚输入的合法草稿。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setText(serializedValue)
  }, [error, serializedValue])
  return (
    <>
      <textarea
        className="pv_adapter_json"
        rows={rows}
        value={text}
        onChange={(event) => {
          const next = event.target.value
          setText(next)
          const parsed = parseJson(next)
          if (parsed === undefined || parsed == null || typeof parsed !== 'object')
            setError('JSON 必须是对象或数组')
          else {
            setError('')
            emittedSerializedValue.current = JSON.stringify(parsed, null, 2)
            onChange(parsed as Record<string, unknown>)
          }
        }}
      />
      {error && <span className="pv_adapter_json_error">{error}</span>}
    </>
  )
}

function parseJson(value: string): unknown | undefined {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function splitList(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function numberOrUndefined(value: string): number | undefined {
  const number = Number(value)
  return value.trim() && Number.isFinite(number) ? number : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
