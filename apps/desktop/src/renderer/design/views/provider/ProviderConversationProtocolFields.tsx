import { Select } from '@lobehub/ui'
import {
  isVolcengineArkConversationEndpoint,
  type ProviderApiKind,
} from './providerConversationProtocol'

export type { ProviderApiKind } from './providerConversationProtocol'

export function ProviderConversationProtocolFields({
  value,
  apiEndpoint,
  onChange,
}: {
  value: ProviderApiKind
  apiEndpoint: string
  onChange: (value: ProviderApiKind) => void
}) {
  const isVolcengineArk = isVolcengineArkConversationEndpoint(apiEndpoint)
  return (
    <>
      <label className="pv_form_label">
        API 协议
        <span className="pv_form_sub">
          {isVolcengineArk
            ? '火山方舟 Chat Completions 与 Responses 请求体不同，请按模型接入方式选择'
            : '决定请求端点、请求体和响应解析方式'}
        </span>
      </label>
      <Select
        value={value}
        onChange={(next) => onChange(next as ProviderApiKind)}
        options={[
          { label: 'Responses API', value: 'responses' },
          { label: 'Chat Completions API', value: 'chat' },
          { label: 'Embeddings API（向量模型）', value: 'embedding' },
        ]}
      />
    </>
  )
}
