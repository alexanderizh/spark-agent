import { useMemo, useState } from 'react'
import { Button, Input, Select, TextArea } from '@lobehub/ui'
import { Switch } from 'antd'
import type { CustomToolInputSchema, CustomToolParam, CustomToolParamType } from '@spark/protocol'
import { Icons } from '../Icons'
import { classNames } from '../utils/class-names'

interface CustomToolSchemaEditorProps {
  value: string
  onChange: (value: string) => void
}

const PARAM_TYPES: Array<{ label: string; value: CustomToolParamType }> = [
  { label: '文本', value: 'string' },
  { label: '数字', value: 'number' },
  { label: '整数', value: 'integer' },
  { label: '布尔', value: 'boolean' },
  { label: '数组', value: 'array' },
]

function parseSchema(value: string): {
  schema: CustomToolInputSchema | null
  error: string | null
} {
  try {
    const parsed = JSON.parse(value) as unknown
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { schema: null, error: 'Schema 必须是 JSON 对象' }
    }
    const candidate = parsed as Partial<CustomToolInputSchema>
    if (candidate.type !== 'object' || candidate.properties == null) {
      return { schema: null, error: 'Schema 必须包含 type: object 和 properties' }
    }
    return { schema: candidate as CustomToolInputSchema, error: null }
  } catch (error) {
    return {
      schema: null,
      error: `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

function serializeSchema(schema: CustomToolInputSchema): string {
  return JSON.stringify(schema, null, 2)
}

export function CustomToolSchemaEditor({ value, onChange }: CustomToolSchemaEditorProps) {
  const [mode, setMode] = useState<'visual' | 'json'>('visual')
  const parsed = useMemo(() => parseSchema(value), [value])
  const schema = parsed.schema

  const write = (next: CustomToolInputSchema) => onChange(serializeSchema(next))
  const updateParam = (name: string, patch: Partial<CustomToolParam>) => {
    if (schema == null) return
    const current = schema.properties[name]
    if (current == null) return
    write({
      ...schema,
      properties: { ...schema.properties, [name]: { ...current, ...patch } },
    })
  }
  const renameParam = (name: string, nextName: string): boolean => {
    if (schema == null) return false
    if (nextName === name) return true
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/u.test(nextName) || schema.properties[nextName] != null)
      return false
    const entries = Object.entries(schema.properties).map(([key, param]) =>
      key === name ? [nextName, param] : [key, param],
    )
    write({
      ...schema,
      properties: Object.fromEntries(entries),
      ...(schema.required != null
        ? { required: schema.required.map((item) => (item === name ? nextName : item)) }
        : {}),
    })
    return true
  }
  const setRequired = (name: string, required: boolean) => {
    if (schema == null) return
    const next = new Set(schema.required ?? [])
    if (required) next.add(name)
    else next.delete(name)
    write({ ...schema, ...(next.size > 0 ? { required: [...next] } : { required: undefined }) })
  }
  const removeParam = (name: string) => {
    if (schema == null) return
    const properties = { ...schema.properties }
    delete properties[name]
    const required = (schema.required ?? []).filter((item) => item !== name)
    write({
      ...schema,
      properties,
      ...(required.length > 0 ? { required } : { required: undefined }),
    })
  }
  const addParam = () => {
    if (schema == null) return
    let index = Object.keys(schema.properties).length + 1
    let name = `param_${index}`
    while (schema.properties[name] != null) {
      index += 1
      name = `param_${index}`
    }
    write({
      ...schema,
      properties: {
        ...schema.properties,
        [name]: { type: 'string', description: '参数说明' },
      },
    })
  }

  return (
    <div className="ct_schema_editor">
      <div className="ct_schema_tabs" role="tablist" aria-label="输入参数 Schema 编辑方式">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'visual'}
          className={classNames(mode === 'visual' && 'is-active')}
          onClick={() => setMode('visual')}
        >
          可视字段
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'json'}
          className={classNames(mode === 'json' && 'is-active')}
          onClick={() => setMode('json')}
        >
          JSON Schema
        </button>
      </div>
      {mode === 'json' ? (
        <TextArea
          className="ct_code_input"
          rows={10}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : schema == null ? (
        <div className="ct_schema_error">
          <span>{parsed.error}</span>
          <Button size="small" onClick={() => setMode('json')}>
            修正 JSON
          </Button>
        </div>
      ) : (
        <div className="ct_schema_fields">
          {Object.entries(schema.properties).map(([name, param]) => (
            <div key={name} className="ct_schema_row">
              <Input
                defaultValue={name}
                aria-label="参数名"
                onBlur={(event) => {
                  if (!renameParam(name, event.target.value.trim()))
                    event.currentTarget.value = name
                }}
              />
              <Select
                value={param.type}
                options={PARAM_TYPES}
                onChange={(value) =>
                  updateParam(name, {
                    type: value as CustomToolParamType,
                    ...((value as CustomToolParamType) === 'array'
                      ? { items: param.items ?? { type: 'string' } }
                      : { items: undefined }),
                  })
                }
              />
              <Input
                value={param.description ?? ''}
                aria-label="参数说明"
                placeholder="参数说明"
                onChange={(event) => updateParam(name, { description: event.target.value })}
              />
              <label className="ct_schema_required">
                <Switch
                  size="small"
                  checked={(schema.required ?? []).includes(name)}
                  onChange={(checked) => setRequired(name, checked)}
                />
                必填
              </label>
              <Button
                type="text"
                danger
                icon={<Icons.Trash size={13} />}
                aria-label={`删除参数 ${name}`}
                onClick={() => removeParam(name)}
              />
            </div>
          ))}
          <Button type="text" icon={<Icons.Plus size={13} />} onClick={addParam}>
            添加参数
          </Button>
        </div>
      )}
    </div>
  )
}
