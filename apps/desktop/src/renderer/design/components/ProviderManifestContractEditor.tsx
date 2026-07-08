import { useMemo } from 'react'
import { Checkbox, Input, Tag } from '@lobehub/ui'
import type {
  MediaErrorContract,
  MediaModelCapabilityManifest,
  MediaModelManifest,
  MediaModelParamPolicy,
  MediaParamForbiddenEntry,
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
export function ProviderManifestContractEditor({ manifest, onChange }: ProviderManifestContractEditorProps) {
  const capabilities = manifest?.capabilities ?? []

  if (!manifest) {
    return <div style={{ opacity: 0.6 }}>尚未提供 manifest，无法编辑 Contract V2。</div>
  }
  if (capabilities.length === 0) {
    return <div style={{ opacity: 0.6 }}>manifest 未声明任何 capability。</div>
  }
  return (
    <div className="pv_contract_editor">
      {capabilities.map((capability, index) => (
        <CapabilityEditor
          key={capability.id ?? index}
          manifest={manifest}
          capability={capability}
          index={index}
          onChange={onChange}
        />
      ))}
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
    <section style={{ borderTop: '1px solid var(--lobe-outline)', padding: '12px 0', marginBottom: 8 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <strong>{capability.label || capability.id}</strong>
        <Tag color={policy.strict ? 'red' : 'default'}>{policy.strict ? 'strict' : 'compat'}</Tag>
        <Tag color={policy.passthrough?.enabled ? 'blue' : 'default'}>
          passthrough {policy.passthrough?.enabled ? 'on' : 'off'}
        </Tag>
      </header>

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
          允许 passthrough 透传未声明字段
        </label>
      </div>

      <PolicyListField
        label="passthrough.allow（白名单：聚合平台可显式允许透传）"
        values={policy.passthrough?.allow ?? []}
        placeholder="如 aspect_ratio / output_format"
        onChange={(allow) =>
          updatePolicy({
            passthrough: { ...(policy.passthrough ?? { enabled: false }), allow },
          })
        }
      />
      <PolicyListField
        label="passthrough.deny（黑名单：永远丢弃）"
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
      <label style={{ display: 'block', marginBottom: 4, fontSize: 12, opacity: 0.75 }}>{label}</label>
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
            <Tag key={v} style={{ marginRight: 4 }}>{v}</Tag>
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
        forbidden（显式禁止字段，命中即丢弃并报 forbidden_param issue）
        <span style={{ opacity: 0.6 }}>— 每行一个，格式：<code>字段名: 原因</code></span>
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
            .filter((entry): entry is MediaParamForbiddenEntry => entry != null && entry.name.length > 0)
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
    ['codePaths', '错误 code 路径（如 error.code）'],
    ['messagePaths', '错误 message 路径'],
    ['paramNamePaths', '参数名路径（如 error.param）'],
    ['requestIdPaths', 'requestId 路径'],
  ]
  return (
    <div style={{ borderTop: '1px dashed var(--lobe-outline)', paddingTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <strong style={{ fontSize: 12 }}>错误归一契约（manifest.error）</strong>
        {contract && (
          <a onClick={onClear} style={{ fontSize: 12 }}>
            清除
          </a>
        )}
      </div>
      {!contract && <div style={{ opacity: 0.6, fontSize: 12 }}>未声明错误契约，provider 400 时退回通用错误。</div>}
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
