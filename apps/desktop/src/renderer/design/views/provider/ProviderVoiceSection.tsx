import { useMemo, useState } from 'react'
import { Button, Input, Modal, Select, TextArea } from '@lobehub/ui'
// ⓘ 悬浮说明与项目其它设置页（知识库设置 / 语音助手设置）保持一致，统一用 antd Tooltip
import { Tooltip } from 'antd'
import {
  VOLCENGINE_SPEECH_VOICE_TABLE,
  VOICE_CATALOG_TEMPLATES,
  VOICE_CATALOG_TEMPLATE_IDS,
  type ProviderMediaVoiceCatalogConfig,
  type VoiceCatalogTemplateId,
} from '@spark/protocol'
import { Icons } from '../../Icons'

/** 内置火山音色表规模（弹层里说明用，避免手写数字与表漂移）。 */
const VOLCENGINE_SPEECH_VOICE_TABLE_SIZE = VOLCENGINE_SPEECH_VOICE_TABLE.length

/**
 * 渠道编辑页的语音相关操作行（自定义渠道适配器 / 音色获取 / 音色复刻）。
 *
 * 设计约定（与项目其它设置页一致）：
 *   - 扁平一行式：标题 + 标题旁 ⓘ 悬浮说明 + 右侧操作，行间用 1px 分割线分隔；
 *     不用「有色描边 + 底色」的盒子（那种做法层级不清，也和本页其它表单不搭）。
 *   - 长解释一律进 ⓘ，行内只留标题与状态，避免窄面板下文案挤成一坨。
 */
export interface ProviderVoiceSectionProps {
  /** 自定义媒体渠道：展示「自定义渠道适配器」入口。 */
  showCustomAdapter: boolean
  onOpenCustomAdapter: () => void
  /** 有可用音色获取方式（内置模板 / 自定义协议）时展示。 */
  showVoiceCatalog: boolean
  /** ⓘ 里的完整说明。 */
  voiceCatalogTip: string
  /** 行内次要信息，如「上次同步：32 个音色（官方 30 · 私有 2）」。 */
  voiceCatalogMeta?: string | undefined
  syncingVoices: boolean
  onSyncVoices: () => void
  onConfigureVoiceCatalog: () => void
  /** 智谱：展示「音色复刻」入口。 */
  showVoiceClone: boolean
  onOpenVoiceClone: () => void
}

export function ProviderVoiceSection({
  showCustomAdapter,
  onOpenCustomAdapter,
  showVoiceCatalog,
  voiceCatalogTip,
  voiceCatalogMeta,
  syncingVoices,
  onSyncVoices,
  onConfigureVoiceCatalog,
  showVoiceClone,
  onOpenVoiceClone,
}: ProviderVoiceSectionProps) {
  if (!showCustomAdapter && !showVoiceCatalog && !showVoiceClone) return null
  return (
    <div className="pv_voice_rows">
      {showCustomAdapter && (
        <VoiceRow
          title="自定义渠道适配器"
          tip="配置提交、鉴权、Body、上传、轮询、参数和错误契约。适用于渠道协议与内置模板不一致的情况。"
          actions={
            <Button
              icon={<Icons.Settings size={13} />}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onOpenCustomAdapter()
              }}
            >
              配置适配器
            </Button>
          }
        />
      )}
      {showVoiceCatalog && (
        <VoiceRow
          title="音色获取"
          tip={voiceCatalogTip}
          meta={voiceCatalogMeta}
          actions={
            <>
              <Button
                type="text"
                icon={<Icons.Settings size={13} />}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onConfigureVoiceCatalog()
                }}
              >
                音色获取设置
              </Button>
              <Button
                icon={<Icons.Refresh size={13} />}
                loading={syncingVoices}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onSyncVoices()
                }}
              >
                同步音色
              </Button>
            </>
          }
        />
      )}
      {showVoiceClone && (
        <VoiceRow
          title="音色复刻"
          tip="上传 3–30 秒示例音频复刻专属音色（mp3 / wav，≤10MB），复刻后可管理已复刻音色。当前仅智谱开放平台提供该接口。"
          actions={
            <Button
              icon={<Icons.Mic size={13} />}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onOpenVoiceClone()
              }}
            >
              复刻音色
            </Button>
          }
        />
      )}
    </div>
  )
}

function VoiceRow({
  title,
  tip,
  meta,
  actions,
}: {
  title: string
  tip: string
  meta?: string | undefined
  actions: React.ReactNode
}) {
  return (
    <div className="pv_voice_row">
      <div className="pv_voice_row_label">
        <span className="pv_voice_row_title">
          {title}
          <Tooltip title={tip} overlayStyle={{ maxWidth: 340 }}>
            <Icons.HelpCircle className="pv_voice_row_help" size={13} />
          </Tooltip>
        </span>
        {meta != null && meta.length > 0 && <small className="pv_voice_row_meta">{meta}</small>}
      </div>
      <div className="pv_voice_row_actions">{actions}</div>
    </div>
  )
}

/**
 * 「音色获取」配置弹层。
 *
 * 交互模型：先选模板（模板给默认接口与默认字段映射），再按需覆盖任意一项；
 * 「恢复模板默认」清空全部覆盖项。保存时只落用户真正填过的字段，
 * 因此「一个字段都没改」等于未配置 —— 渠道升级后行为与改造前一致。
 */
export function ProviderVoiceCatalogModal({
  value,
  inferredTemplateId,
  apiEndpoint,
  apiEndpointFullUrl,
  disabled,
  onCancel,
  onSave,
}: {
  value: ProviderMediaVoiceCatalogConfig | null | undefined
  /** 按渠道厂商推断出的模板；用户选「自动」时用它。 */
  inferredTemplateId: VoiceCatalogTemplateId | null
  apiEndpoint: string
  apiEndpointFullUrl: boolean
  disabled: boolean
  onCancel: () => void
  onSave: (next: ProviderMediaVoiceCatalogConfig | null) => void | Promise<void>
}) {
  // 弹层由父组件按需挂载（关闭即卸载），因此这里用惰性初值回填已保存配置，
  // 不需要「打开时同步 state」的 effect（那会引发级联渲染）。
  const [draftTemplateId, setDraftTemplateId] = useState<VoiceCatalogTemplateId | ''>(
    value?.templateId ?? '',
  )
  const [draftUrl, setDraftUrl] = useState(value?.url ?? '')
  const [draftMethod, setDraftMethod] = useState<'GET' | 'POST' | ''>(value?.method ?? '')
  const [draftHeaders, setDraftHeaders] = useState(
    value?.headers ? JSON.stringify(value.headers, null, 2) : '',
  )
  const [draftBody, setDraftBody] = useState(value?.body ?? '')
  const [draftListPath, setDraftListPath] = useState(value?.listPath ?? '')
  const [draftValueField, setDraftValueField] = useState(value?.valueField ?? '')
  const [draftLabelField, setDraftLabelField] = useState(value?.labelField ?? '')
  const [draftPrivateListPaths, setDraftPrivateListPaths] = useState(
    (value?.privateListPaths ?? []).join(', '),
  )
  const [draftPrivateFlagField, setDraftPrivateFlagField] = useState(value?.privateFlagField ?? '')
  const [draftPrivateFlagValues, setDraftPrivateFlagValues] = useState(
    (value?.privateFlagValues ?? []).join(', '),
  )
  const [error, setError] = useState('')

  const effectiveTemplateId: VoiceCatalogTemplateId =
    draftTemplateId || inferredTemplateId || 'custom'
  const template = VOICE_CATALOG_TEMPLATES[effectiveTemplateId]
  const isStaticTemplate = template.builtin === 'volcengine-speech-static'
  const usesBuiltinStaticTable = isStaticTemplate && draftUrl.trim().length === 0

  const templateOptions = useMemo(
    () => [
      {
        value: '',
        label: inferredTemplateId
          ? `自动（按渠道使用「${VOICE_CATALOG_TEMPLATES[inferredTemplateId].label}」）`
          : '自动（按渠道推断；自定义协议请选「自定义请求」）',
      },
      ...VOICE_CATALOG_TEMPLATE_IDS.map((id) => ({
        value: id,
        label: VOICE_CATALOG_TEMPLATES[id].label,
      })),
    ],
    [inferredTemplateId],
  )

  const handleReset = () => {
    setDraftUrl('')
    setDraftMethod('')
    setDraftHeaders('')
    setDraftBody('')
    setDraftListPath('')
    setDraftValueField('')
    setDraftLabelField('')
    setDraftPrivateListPaths('')
    setDraftPrivateFlagField('')
    setDraftPrivateFlagValues('')
    setError('')
  }

  const handleSave = () => {
    let headers: Record<string, string> | undefined
    const headersText = draftHeaders.trim()
    if (headersText) {
      try {
        const parsed = JSON.parse(headersText) as unknown
        if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          setError('请求头需要是一个 JSON 对象，例如 {"authorization":"Bearer {{apiKey}}"}')
          return
        }
        const entries = Object.entries(parsed as Record<string, unknown>)
          .map(([key, item]) => [key.trim(), typeof item === 'string' ? item.trim() : ''] as const)
          .filter(([key, item]) => key.length > 0 && item.length > 0)
        if (entries.length > 0) headers = Object.fromEntries(entries)
      } catch {
        setError('请求头不是合法 JSON，请检查后重试')
        return
      }
    }

    const next: ProviderMediaVoiceCatalogConfig = {
      ...(draftTemplateId ? { templateId: draftTemplateId } : {}),
      ...(draftUrl.trim() ? { url: draftUrl.trim() } : {}),
      ...(draftMethod ? { method: draftMethod } : {}),
      ...(headers ? { headers } : {}),
      ...(draftBody.trim() ? { body: draftBody.trim() } : {}),
      ...(draftListPath.trim() ? { listPath: draftListPath.trim() } : {}),
      ...(draftValueField.trim() ? { valueField: draftValueField.trim() } : {}),
      ...(draftLabelField.trim() ? { labelField: draftLabelField.trim() } : {}),
      ...(splitCsv(draftPrivateListPaths).length > 0
        ? { privateListPaths: splitCsv(draftPrivateListPaths) }
        : {}),
      ...(draftPrivateFlagField.trim() ? { privateFlagField: draftPrivateFlagField.trim() } : {}),
      ...(splitCsv(draftPrivateFlagValues).length > 0
        ? { privateFlagValues: splitCsv(draftPrivateFlagValues) }
        : {}),
    }
    setError('')
    void onSave(Object.keys(next).length > 0 ? next : null)
  }

  return (
    <Modal
      open
      title="音色获取"
      width={560}
      footer={
        <div className="pv_voice_modal_footer">
          <Button type="text" onClick={handleReset} disabled={disabled}>
            恢复模板默认
          </Button>
          <div className="pv_voice_modal_footer_right">
            <Button onClick={onCancel} disabled={disabled}>
              取消
            </Button>
            <Button type="primary" onClick={handleSave} loading={disabled}>
              保存
            </Button>
          </div>
        </div>
      }
      onCancel={onCancel}
    >
      <div className="pv_voice_modal">
        <p className="pv_voice_modal_intro">
          留空的项一律使用模板默认值，因此不改任何项就等于沿用内置实现。
        </p>

        <Field label="模板">
          <Select
            value={draftTemplateId}
            options={templateOptions}
            onChange={(next) => setDraftTemplateId((next as VoiceCatalogTemplateId | '') ?? '')}
          />
        </Field>
        <p className="pv_voice_modal_hint">{template.hint}</p>

        {usesBuiltinStaticTable && (
          <p className="pv_voice_modal_hint pv_voice_modal_hint--builtin">
            当前使用内置音色表（{VOLCENGINE_SPEECH_VOICE_TABLE_SIZE} 个系统音色，离线可用）。
            填写「请求地址」后会改为按你的接口实时拉取。
          </p>
        )}

        <Field label="请求地址">
          <Input
            value={draftUrl}
            placeholder={
              template.path
                ? `留空使用模板默认：${template.path}`
                : '完整 URL，例如 https://your-relay.example/voices'
            }
            onChange={(event) => setDraftUrl(event.target.value)}
          />
        </Field>
        {apiEndpointFullUrl && (
          <p className="pv_voice_modal_hint">
            该渠道按「完整 URL」配置，无法推导音色地址，请在这里填写完整地址。
          </p>
        )}

        <Field label="请求方式">
          <Select
            value={draftMethod}
            options={[
              { value: '', label: `留空使用模板默认（${template.method}）` },
              { value: 'GET', label: 'GET' },
              { value: 'POST', label: 'POST' },
            ]}
            onChange={(next) => setDraftMethod((next as 'GET' | 'POST' | '') ?? '')}
          />
        </Field>

        <Field label="请求头（JSON）">
          <TextArea
            value={draftHeaders}
            autoSize={{ minRows: 2, maxRows: 5 }}
            placeholder={
              template.headers
                ? JSON.stringify(template.headers, null, 2)
                : '例如 {"authorization":"Bearer {{apiKey}}"}'
            }
            onChange={(event) => setDraftHeaders(event.target.value)}
          />
        </Field>
        <p className="pv_voice_modal_hint">
          值里的 {'{{apiKey}}'} 会替换为渠道密钥；密钥不会写入配置、也不会回显。
        </p>

        {(draftMethod === 'POST' || (draftMethod === '' && template.method === 'POST')) && (
          <Field label="请求体">
            <TextArea
              value={draftBody}
              autoSize={{ minRows: 2, maxRows: 5 }}
              placeholder={template.body ?? 'POST 请求体（JSON）'}
              onChange={(event) => setDraftBody(event.target.value)}
            />
          </Field>
        )}

        <Field label="音色列表路径">
          <Input
            value={draftListPath}
            placeholder={`留空使用模板默认：${template.listPath || '响应体里的音色数组字段'}`}
            onChange={(event) => setDraftListPath(event.target.value)}
          />
        </Field>
        <Field label="音色值字段">
          <Input
            value={draftValueField}
            placeholder={`留空使用模板默认：${template.valueField || 'voice'}`}
            onChange={(event) => setDraftValueField(event.target.value)}
          />
        </Field>
        <Field label="显示名字段">
          <Input
            value={draftLabelField}
            placeholder={`留空使用模板默认：${template.labelField ?? '（无可读名，直接显示音色值）'}`}
            onChange={(event) => setDraftLabelField(event.target.value)}
          />
        </Field>
        <Field label="私有音色数组路径">
          <Input
            value={draftPrivateListPaths}
            placeholder={`多个用逗号分隔${
              template.privateListPaths.length > 0
                ? `，模板默认：${template.privateListPaths.join(' / ')}`
                : ''
            }`}
            onChange={(event) => setDraftPrivateListPaths(event.target.value)}
          />
        </Field>
        <Field label="私有标记字段">
          <Input
            value={draftPrivateFlagField}
            placeholder={`留空使用模板默认：${template.privateFlagField ?? '（不按标记判定）'}`}
            onChange={(event) => setDraftPrivateFlagField(event.target.value)}
          />
        </Field>
        <Field label="私有标记值">
          <Input
            value={draftPrivateFlagValues}
            placeholder={`多个用逗号分隔${
              template.privateFlagValues.length > 0
                ? `，模板默认：${template.privateFlagValues.join(' / ')}`
                : ''
            }`}
            onChange={(event) => setDraftPrivateFlagValues(event.target.value)}
          />
        </Field>

        {template.docsUrl != null && (
          <p className="pv_voice_modal_hint">
            接口文档：
            <a href={template.docsUrl} target="_blank" rel="noreferrer">
              {template.docsUrl}
            </a>
          </p>
        )}
        {apiEndpoint.trim().length === 0 && draftUrl.trim().length === 0 && (
          <p className="pv_voice_modal_hint">
            渠道还没配置 API 地址，请先填写或在此直接给出完整请求地址。
          </p>
        )}

        {error.length > 0 && <p className="pv_voice_modal_error">{error}</p>}
      </div>
    </Modal>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="pv_voice_modal_field">
      <span className="pv_voice_modal_field_label">{label}</span>
      {children}
    </div>
  )
}

/** 逗号分隔输入 → 去空数组（中英文逗号都接受）。 */
function splitCsv(text: string): string[] {
  return text
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}
