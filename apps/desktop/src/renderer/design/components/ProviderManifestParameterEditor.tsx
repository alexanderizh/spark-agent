import { useState } from 'react'
import type { ReactNode } from 'react'
import { Checkbox, Input, Select } from '@lobehub/ui'
import type { MediaModelCapabilityManifest, MediaModelParamPolicy } from '@spark/protocol'

interface ProviderManifestParameterEditorProps {
  capability: MediaModelCapabilityManifest
  onChange: (next: MediaModelCapabilityManifest) => void
}

type ParameterType = 'string' | 'integer' | 'number' | 'boolean' | 'array'

const TYPE_OPTIONS = [
  { label: '文本', value: 'string' },
  { label: '整数', value: 'integer' },
  { label: '小数', value: 'number' },
  { label: '开关', value: 'boolean' },
  { label: '列表', value: 'array' },
]

export function ProviderManifestParameterEditor({
  capability,
  onChange,
}: ProviderManifestParameterEditorProps) {
  const schema = asRecord(capability.paramSchema)
  const properties = asRecord(schema.properties)
  const required = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === 'string')
    : []

  const updateProperty = (name: string, patch: Record<string, unknown>) => {
    const property = { ...asRecord(properties[name]), ...patch }
    onChange(withProperties(capability, { ...properties, [name]: property }))
  }

  const updateRequired = (name: string, checked: boolean) => {
    const nextRequired = checked
      ? Array.from(new Set([...required, name]))
      : required.filter((item) => item !== name)
    onChange(
      withSchema(capability, {
        ...schema,
        ...(nextRequired.length ? { required: nextRequired } : {}),
        ...(!nextRequired.length ? { required: undefined } : {}),
      }),
    )
  }

  const updateDefault = (name: string, rawValue: string, type: ParameterType) => {
    const defaults = { ...(capability.defaults ?? {}) }
    const property = { ...asRecord(properties[name]) }
    if (!rawValue.trim()) {
      delete defaults[name]
      delete property.default
    } else {
      const value = parseDefaultValue(rawValue, type)
      defaults[name] = value
      property.default = value
    }
    onChange({
      ...withProperties(capability, { ...properties, [name]: property }),
      defaults: Object.keys(defaults).length ? defaults : undefined,
    })
  }

  const updateAlias = (name: string, value: string) => {
    const aliases = { ...(capability.aliases ?? {}) }
    if (value.trim()) aliases[name] = value.trim()
    else delete aliases[name]
    const policyAliases = { ...(capability.paramPolicy?.aliases ?? {}) }
    delete policyAliases[name]
    onChange({
      ...capability,
      aliases: Object.keys(aliases).length ? aliases : undefined,
      paramPolicy: capability.paramPolicy
        ? {
            ...capability.paramPolicy,
            aliases: Object.keys(policyAliases).length ? policyAliases : undefined,
          }
        : undefined,
    })
  }

  const addParameter = () => {
    let index = Object.keys(properties).length + 1
    while (properties[`param${index}`]) index += 1
    const name = `param${index}`
    onChange(
      withProperties(capability, {
        ...properties,
        [name]: { type: 'string', title: '新参数' },
      }),
    )
  }

  const renameParameter = (oldName: string, nextName: string) => {
    const name = nextName.trim()
    if (name === oldName) return true
    if (!isValidParameterName(name) || properties[name]) return false
    const nextProperties: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(properties)) {
      nextProperties[key === oldName ? name : key] = value
    }
    onChange(renameCapabilityReferences(withProperties(capability, nextProperties), oldName, name))
    return true
  }

  const removeParameter = (name: string) => {
    const nextProperties = { ...properties }
    delete nextProperties[name]
    const defaults = { ...(capability.defaults ?? {}) }
    const aliases = { ...(capability.aliases ?? {}) }
    delete defaults[name]
    delete aliases[name]
    const next = renameCapabilityReferences(withProperties(capability, nextProperties), name, '')
    onChange({
      ...next,
      defaults: Object.keys(defaults).length ? defaults : undefined,
      aliases: Object.keys(aliases).length ? aliases : undefined,
    })
  }

  return (
    <div className="pv_parameter_editor">
      <div className="pv_parameter_toolbar">
        <span>已配置 {Object.keys(properties).length} 个模型参数</span>
        <button type="button" className="pv_parameter_add" onClick={addParameter}>
          + 添加参数
        </button>
      </div>

      {Object.entries(properties).map(([name, rawProperty]) => {
        const property = asRecord(rawProperty)
        const type = normalizeParameterType(property.type)
        const enumValues = Array.isArray(property.enum) ? property.enum.map(String).join(', ') : ''
        const defaultValue = capability.defaults?.[name] ?? property.default
        return (
          <div className="pv_parameter_card" key={name}>
            <div className="pv_parameter_card_head">
              <strong>{String(property.title || name)}</strong>
              <button
                type="button"
                className="pv_parameter_remove"
                onClick={() => removeParameter(name)}
              >
                删除
              </button>
            </div>
            <div className="pv_parameter_grid">
              <ParameterNameInput
                name={name}
                onRename={(nextName) => renameParameter(name, nextName)}
              />
              <ParameterField label="显示名称" hint="在画布参数面板中展示">
                <Input
                  value={String(property.title ?? '')}
                  placeholder="例如：画面尺寸"
                  onChange={(event) => updateProperty(name, { title: event.target.value })}
                />
              </ParameterField>
              <ParameterField label="参数类型">
                <Select
                  value={type}
                  options={TYPE_OPTIONS}
                  onChange={(value) => updateProperty(name, { type: value })}
                />
              </ParameterField>
              <ParameterField label="渠道字段名" hint="不填则与参数标识一致">
                <Input
                  value={
                    capability.aliases?.[name] ?? capability.paramPolicy?.aliases?.[name] ?? ''
                  }
                  placeholder="例如：aspect_ratio"
                  onChange={(event) => updateAlias(name, event.target.value)}
                />
              </ParameterField>
              <ParameterField label="可选值" hint="多个值用逗号分隔">
                <Input
                  value={enumValues}
                  placeholder="例如：1:1, 16:9, 9:16"
                  onChange={(event) =>
                    updateProperty(name, { enum: parseEnumValues(event.target.value, type) })
                  }
                />
              </ParameterField>
              <ParameterField label="默认值">
                {type === 'boolean' ? (
                  <Select
                    value={defaultValue === undefined ? '' : String(defaultValue)}
                    options={[
                      { label: '无默认值', value: '' },
                      { label: '开启（true）', value: 'true' },
                      { label: '关闭（false）', value: 'false' },
                    ]}
                    onChange={(value) => updateDefault(name, value, type)}
                  />
                ) : (
                  <Input
                    value={formatDefaultValue(defaultValue)}
                    placeholder="留空表示无默认值"
                    onChange={(event) => updateDefault(name, event.target.value, type)}
                  />
                )}
              </ParameterField>
              {(type === 'integer' || type === 'number') && (
                <>
                  <ParameterField label="最小值">
                    <Input
                      type="number"
                      value={formatDefaultValue(property.minimum)}
                      onChange={(event) =>
                        updateProperty(name, { minimum: numberOrUndefined(event.target.value) })
                      }
                    />
                  </ParameterField>
                  <ParameterField label="最大值">
                    <Input
                      type="number"
                      value={formatDefaultValue(property.maximum)}
                      onChange={(event) =>
                        updateProperty(name, { maximum: numberOrUndefined(event.target.value) })
                      }
                    />
                  </ParameterField>
                </>
              )}
            </div>
            <label className="pv_parameter_required">
              <Checkbox
                checked={required.includes(name)}
                onChange={(checked) => updateRequired(name, checked)}
              />
              必填参数
            </label>
          </div>
        )
      })}

      {!Object.keys(properties).length && (
        <div className="pv_parameter_empty">尚未配置模型参数，点击“添加参数”开始。</div>
      )}
    </div>
  )
}

function ParameterNameInput({
  name,
  onRename,
}: {
  name: string
  onRename: (name: string) => boolean
}) {
  const [value, setValue] = useState(name)
  return (
    <ParameterField label="参数标识" hint="应用内部使用的稳定名称">
      <Input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => {
          if (!onRename(value)) setValue(name)
        }}
      />
    </ParameterField>
  )
}

function ParameterField({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="pv_parameter_field">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      {children}
    </label>
  )
}

function withSchema(
  capability: MediaModelCapabilityManifest,
  schema: Record<string, unknown>,
): MediaModelCapabilityManifest {
  return { ...capability, paramSchema: schema }
}

function withProperties(
  capability: MediaModelCapabilityManifest,
  properties: Record<string, unknown>,
): MediaModelCapabilityManifest {
  const schema = asRecord(capability.paramSchema)
  return withSchema(capability, { ...schema, type: 'object', properties })
}

function renameCapabilityReferences(
  capability: MediaModelCapabilityManifest,
  from: string,
  to: string,
): MediaModelCapabilityManifest {
  const rename = (value: string) => (value === from ? to : value)
  const compact = (values: string[]) => values.map(rename).filter(Boolean)
  const schema = asRecord(capability.paramSchema)
  const defaults = renameRecordKey(capability.defaults, from, to)
  const aliases = renameRecordKey(capability.aliases, from, to) as
    | Record<string, string>
    | undefined
  const policy = capability.paramPolicy
  const nextPolicy: MediaModelParamPolicy | undefined = policy
    ? {
        ...policy,
        aliases: renameRecordKey(policy.aliases, from, to) as Record<string, string> | undefined,
        passthrough: policy.passthrough
          ? {
              ...policy.passthrough,
              allow: policy.passthrough.allow ? compact(policy.passthrough.allow) : undefined,
              deny: policy.passthrough.deny ? compact(policy.passthrough.deny) : undefined,
            }
          : undefined,
        forbidden: policy.forbidden
          ?.map((item) => ({ ...item, name: rename(item.name) }))
          .filter((item) => item.name),
        conflicts: policy.conflicts
          ?.map((item) => ({ ...item, fields: compact(item.fields) }))
          .filter((item) => item.fields.length > 1),
        transforms: policy.transforms
          ?.map((rule) => {
            if (rule.kind === 'rename')
              return { ...rule, from: rename(rule.from), to: rename(rule.to) }
            if (rule.kind === 'map_value' || rule.kind === 'drop_when_input_kind')
              return { ...rule, field: rename(rule.field) }
            if (from === 'size' || from === 'aspectRatio') return undefined
            return rule
          })
          .filter((rule): rule is NonNullable<typeof rule> =>
            Boolean(
              rule &&
              (!('field' in rule) || rule.field) &&
              (rule.kind !== 'rename' || (rule.from && rule.to)),
            ),
          ),
        conditionals: policy.conditionals
          ?.map((rule) => ({
            ...rule,
            field: rename(rule.field),
            target: rule.target ? rename(rule.target) : undefined,
          }))
          .filter((rule) => rule.field),
      }
    : undefined
  return {
    ...capability,
    paramSchema: {
      ...schema,
      required: compact(
        Array.isArray(schema.required)
          ? schema.required.filter((item): item is string => typeof item === 'string')
          : [],
      ),
    },
    defaults,
    aliases,
    paramPolicy: nextPolicy,
  }
}

function renameRecordKey<T extends Record<string, unknown> | undefined>(
  record: T,
  from: string,
  to: string,
): T | undefined {
  if (!record) return undefined
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (key !== from || to) next[key === from ? to : key] = value
  }
  return Object.keys(next).length ? (next as T) : undefined
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function normalizeParameterType(value: unknown): ParameterType {
  return value === 'integer' || value === 'number' || value === 'boolean' || value === 'array'
    ? value
    : 'string'
}

function splitValues(value: string): string[] | undefined {
  const values = value
    .split(/[,\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
  return values.length ? values : undefined
}

function parseEnumValues(value: string, type: ParameterType): unknown[] | undefined {
  const values = splitValues(value)
  if (!values) return undefined
  if (type === 'integer')
    return values.map((item) => Math.trunc(Number(item))).filter(Number.isFinite)
  if (type === 'number') return values.map(Number).filter(Number.isFinite)
  if (type === 'boolean')
    return values
      .filter((item) => item === 'true' || item === 'false')
      .map((item) => item === 'true')
  return values
}

function isValidParameterName(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9._-]*$/.test(value)
}

function numberOrUndefined(value: string): number | undefined {
  const parsed = Number(value)
  return value.trim() && Number.isFinite(parsed) ? parsed : undefined
}

function parseDefaultValue(value: string, type: ParameterType): unknown {
  if (type === 'integer') return Math.trunc(Number(value))
  if (type === 'number') return Number(value)
  if (type === 'boolean') return value === 'true'
  if (type === 'array') return splitValues(value) ?? []
  return value
}

function formatDefaultValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}
