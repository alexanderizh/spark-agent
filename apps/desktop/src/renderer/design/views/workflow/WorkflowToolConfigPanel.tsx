import { useEffect, useMemo, useState } from 'react'
import { Input as LobeInput, Select as LobeSelect, TextArea as LobeTextArea } from '@lobehub/ui'
import { Switch } from 'antd'
import type { McpServerItem, WorkflowNode } from '@spark/protocol'
import { WORKFLOW_RESTRICTABLE_TOOLS } from '@spark/protocol'
import { useIpcInvoke } from '../../hooks/useIpc'
import { InspectorField, TagPicker, asStringArray } from './inspector-fields'
import { WORKFLOW_BUILTIN_TOOL_SCHEMAS } from './workflow-tool-schemas'

/**
 * 工具节点（kind='tool'）与 MCP 节点（kind='mcp'）的专属配置面板。
 *
 * 工具节点四种执行模式：
 * - 受限代理（缺省）：旧的 toolIds 白名单 + 临时 LLM worker 自主决定怎么用工具；
 * - 内置工具直调（builtin）：锁定单个 SDK 内置工具 + 预渲染参数的强约束派发；
 * - MCP 工具直调（mcp）：选服务器 → 选工具（按 inputSchema 渲染参数表单），运行时原生直调不经 LLM；
 * - 平台工具直调（platform）：选自定义工具/工具包工具（按 inputSchema 渲染参数表单），
 *   运行时经平台工具目录原生 invoke，同样不经 LLM。
 *
 * MCP 节点（variant='mcp'）两种模式：受限代理（全部已启用 MCP）/ MCP 工具直调；
 * 不提供 builtin 与 platform 源（这两者是 tool 节点的职责，运行时对 mcp 节点同样不认）。
 *
 * 参数值支持 {{key}} 占位符（key = 上游节点 outputKey），运行时在派发/直调前统一插值。
 */

type ToolMode = '' | 'builtin' | 'mcp' | 'platform'

interface McpToolOption {
  name: string
  description: string
  inputSchema?: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

interface PlatformToolOption {
  /** 运行时标识：工具包工具为 `packageId/toolName`，自定义工具为其 id。 */
  name: string
  title: string
  description: string
  source: 'package' | 'custom'
  packageName?: string
  inputSchema?: McpToolOption['inputSchema']
}

interface ArgFieldSpec {
  name: string
  type: 'string' | 'number' | 'boolean' | 'json'
  description?: string
  required?: boolean
  multiline?: boolean
}

function mcpSchemaToArgFields(schema: McpToolOption['inputSchema'] | undefined): ArgFieldSpec[] {
  if (schema == null || schema.properties == null || typeof schema.properties !== 'object')
    return []
  const required = new Set(schema.required ?? [])
  return Object.entries(schema.properties).flatMap(([name, raw]) => {
    if (raw == null || typeof raw !== 'object') return []
    const record = raw as Record<string, unknown>
    const description = typeof record.description === 'string' ? record.description : undefined
    const rawType = typeof record.type === 'string' ? record.type : ''
    const type: ArgFieldSpec['type'] =
      rawType === 'number' || rawType === 'integer'
        ? 'number'
        : rawType === 'boolean'
          ? 'boolean'
          : rawType === 'array' || rawType === 'object'
            ? 'json'
            : 'string'
    const multiline = type === 'json' || String(description ?? '').length > 60
    return [
      {
        name,
        type,
        ...(description != null ? { description } : {}),
        ...(required.has(name) ? { required: true } : {}),
        ...(multiline ? { multiline: true } : {}),
      },
    ]
  })
}

function builtinSchemaToArgFields(toolName: string): ArgFieldSpec[] {
  return WORKFLOW_BUILTIN_TOOL_SCHEMAS[toolName]?.args ?? []
}

/** 按 schema 渲染参数表单：string→输入框、number→数字框、boolean→开关、json/长文本→多行框。 */
function ToolArgsForm({
  fields,
  toolArgs,
  onPatchArg,
  variableHint,
}: {
  fields: ArgFieldSpec[]
  toolArgs: Record<string, unknown>
  onPatchArg: (name: string, value: unknown) => void
  variableHint: string
}) {
  const valueText = (field: ArgFieldSpec): string => {
    const value = toolArgs[field.name]
    if (value == null) return ''
    if (typeof value === 'string') return value
    return JSON.stringify(value)
  }
  return (
    <InspectorField label="调用参数">
      {fields.map((field) => (
        <div className="wf-tool-arg-field" key={field.name}>
          <span className="agent-field-label">
            {field.name}
            {field.required ? ' *' : ''}
            {field.description != null && (
              <span className="wf-field-help"> {field.description}</span>
            )}
          </span>
          {field.type === 'boolean' ? (
            <Switch
              size="small"
              checked={toolArgs[field.name] === true}
              onChange={(checked) => onPatchArg(field.name, checked)}
            />
          ) : field.multiline ? (
            <LobeTextArea
              rows={field.type === 'json' ? 4 : 3}
              placeholder={
                field.type === 'json' ? 'JSON 值，如 {"key": "{{上游变量}}"}' : undefined
              }
              value={valueText(field)}
              onChange={(event) => onPatchArg(field.name, event.target.value)}
            />
          ) : (
            <LobeInput
              type={field.type === 'number' ? 'number' : 'text'}
              value={valueText(field)}
              onChange={(event) => {
                const raw = event.target.value
                if (field.type === 'number') {
                  const parsed = raw.trim().length > 0 ? Number(raw) : NaN
                  // 解析不了先保留原文（如含 {{var}} 的半成品），运行时按字符串透传。
                  onPatchArg(field.name, Number.isNaN(parsed) ? raw : parsed)
                  return
                }
                onPatchArg(field.name, raw)
              }}
            />
          )}
        </div>
      ))}
      <div className="wf-field-help">{variableHint}</div>
    </InspectorField>
  )
}

export function WorkflowToolConfigPanel({
  config,
  onPatchConfig,
  mcpServers,
  upstreamOutputKeys,
  variant = 'tool',
}: {
  config: WorkflowNode['config']
  onPatchConfig: (patch: WorkflowNode['config']) => void
  mcpServers: McpServerItem[]
  upstreamOutputKeys: string[]
  /** 'tool' = 工具节点（三种模式）；'mcp' = MCP 节点（受限代理 / MCP 直调，无 builtin 源）。 */
  variant?: 'tool' | 'mcp'
}) {
  const { invoke: listServerTools } = useIpcInvoke('mcp:server-tools')
  const { invoke: listPlatformTools } = useIpcInvoke('workflow:platform-tools')
  const [mcpTools, setMcpTools] = useState<McpToolOption[]>([])
  const [platformTools, setPlatformTools] = useState<PlatformToolOption[]>([])
  const [toolsLoading, setToolsLoading] = useState(false)
  const [toolsError, setToolsError] = useState('')
  // mcp 变体不认 builtin / platform 源（运行时同样视为无效配置回落 worker 模式），界面按受限代理展示。
  const toolMode: ToolMode =
    config.toolSource === 'mcp' ||
    ((config.toolSource === 'builtin' || config.toolSource === 'platform') && variant === 'tool')
      ? config.toolSource
      : ''
  const toolServerId = typeof config.toolServerId === 'string' ? config.toolServerId : ''
  const toolName = typeof config.toolName === 'string' ? config.toolName : ''
  const toolArgs =
    config.toolArgs != null &&
    typeof config.toolArgs === 'object' &&
    !Array.isArray(config.toolArgs)
      ? (config.toolArgs as Record<string, unknown>)
      : {}

  useEffect(() => {
    if (toolMode !== 'mcp' || toolServerId.length === 0) {
      setMcpTools([])
      setToolsError('')
      return
    }
    let canceled = false
    setToolsLoading(true)
    setToolsError('')
    listServerTools({ serverId: toolServerId })
      .then((res) => {
        if (canceled) return
        setMcpTools(res.tools)
      })
      .catch((error: unknown) => {
        if (canceled) return
        setMcpTools([])
        setToolsError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!canceled) setToolsLoading(false)
      })
    return () => {
      canceled = true
    }
  }, [toolMode, toolServerId, listServerTools])

  // 平台工具目录快照与执行期同源（自定义工具 + 已启用工具包），切到 platform 模式时加载一次。
  useEffect(() => {
    if (toolMode !== 'platform') {
      setPlatformTools([])
      return
    }
    let canceled = false
    setToolsLoading(true)
    setToolsError('')
    listPlatformTools({})
      .then((res: { tools: PlatformToolOption[] }) => {
        if (canceled) return
        setPlatformTools(res.tools)
      })
      .catch((error: unknown) => {
        if (canceled) return
        setPlatformTools([])
        setToolsError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!canceled) setToolsLoading(false)
      })
    return () => {
      canceled = true
    }
  }, [toolMode, listPlatformTools])

  const argFields = useMemo<ArgFieldSpec[]>(() => {
    if (toolMode === 'builtin') return builtinSchemaToArgFields(toolName)
    if (toolMode === 'mcp') {
      const selected = mcpTools.find((tool) => tool.name === toolName)
      return mcpSchemaToArgFields(selected?.inputSchema)
    }
    if (toolMode === 'platform') {
      const selected = platformTools.find((tool) => tool.name === toolName)
      return mcpSchemaToArgFields(selected?.inputSchema)
    }
    return []
  }, [toolMode, toolName, mcpTools, platformTools])

  const setToolMode = (mode: ToolMode) => {
    onPatchConfig({
      toolSource: mode === '' ? null : mode,
      toolServerId: null,
      toolName: null,
      toolArgs: {},
    })
  }

  const patchArg = (name: string, value: unknown) => {
    onPatchConfig({ toolArgs: { ...toolArgs, [name]: value } })
  }

  const variableHint =
    upstreamOutputKeys.length > 0
      ? `可用上游变量：${upstreamOutputKeys.join('、')}（在参数值里写 {{键名}} 引用，运行时替换）`
      : '当前没有可引用的上游输出（上游节点需配置 outputKey）'

  return (
    <>
      <InspectorField label="调用方式">
        <LobeSelect
          value={toolMode}
          onChange={(value) => setToolMode((value ?? '') as ToolMode)}
          options={
            variant === 'mcp'
              ? [
                  { label: '受限代理（LLM 自主调用 MCP）', value: '' },
                  { label: 'MCP 工具直调（原生调用）', value: 'mcp' },
                ]
              : [
                  { label: '受限代理（LLM 自主用工具）', value: '' },
                  { label: '内置工具直调（指定工具+参数）', value: 'builtin' },
                  { label: 'MCP 工具直调（原生调用）', value: 'mcp' },
                  { label: '平台工具直调（自定义工具/工具包）', value: 'platform' },
                ]
          }
        />
        <div className="wf-field-help">
          {toolMode === ''
            ? variant === 'mcp'
              ? '派发临时 Agent，已启用的 MCP 全部挂载，调哪个工具、传什么参数由 LLM 决定。'
              : '派发临时 Agent 并限制只能使用所选工具，调用方式与参数由 LLM 决定。'
            : toolMode === 'builtin'
              ? '锁定单个内置工具并按下方参数执行；参数已预渲染，LLM 只负责包装结果。'
              : toolMode === 'platform'
                ? '直接调用平台上已启用的自定义工具或工具包工具，不经 LLM；参数按工具 schema 填写。'
                : '直接调用所选 MCP 服务器上的工具，不经 LLM；参数按工具 schema 填写。'}
        </div>
      </InspectorField>
      {toolMode === '' &&
        (variant === 'mcp' ? (
          <InspectorField label="MCP 范围">
            <div className="wf-field-help">
              受限代理模式下所有已启用的 MCP 都会挂载给该节点；需要确定性地调用某个工具时，
              请切换为「MCP 工具直调」。
            </div>
          </InspectorField>
        ) : (
          <InspectorField label="工具">
            <TagPicker
              items={WORKFLOW_RESTRICTABLE_TOOLS.map((tool) => ({
                id: tool.name,
                label: tool.label,
              }))}
              selected={asStringArray(config.toolIds)}
              onChange={(toolIds) => onPatchConfig({ toolIds })}
            />
            <div className="wf-field-help">不选则不限制；所选之外的可限制工具对该节点禁用。</div>
          </InspectorField>
        ))}
      {toolMode === 'builtin' && (
        <>
          <InspectorField label="内置工具">
            <LobeSelect
              value={toolName}
              onChange={(value) => onPatchConfig({ toolName: String(value) || null, toolArgs: {} })}
              options={WORKFLOW_RESTRICTABLE_TOOLS.filter(
                (tool) => WORKFLOW_BUILTIN_TOOL_SCHEMAS[tool.name] != null,
              ).map((tool) => ({ label: `${tool.label}（${tool.name}）`, value: tool.name }))}
            />
          </InspectorField>
          {argFields.length > 0 ? (
            <ToolArgsForm
              fields={argFields}
              toolArgs={toolArgs}
              onPatchArg={patchArg}
              variableHint={variableHint}
            />
          ) : (
            toolName.length > 0 && (
              <div className="wf-field-help">
                该工具暂未提供参数 schema，可在节点提示词里补充说明。
              </div>
            )
          )}
        </>
      )}
      {toolMode === 'platform' && (
        <>
          <InspectorField label="平台工具">
            {toolsLoading ? (
              <div className="agents-empty-mini">正在加载工具清单…</div>
            ) : toolsError.length > 0 ? (
              <div className="wf-field-help wf-field-warn">工具清单加载失败：{toolsError}</div>
            ) : platformTools.length === 0 ? (
              <div className="agents-empty-mini">
                暂无已启用的平台工具（自定义工具需在工具工作室发布并启用；工具包需在扩展中安装并启用）
              </div>
            ) : (
              <LobeSelect
                value={toolName}
                onChange={(value) =>
                  onPatchConfig({ toolName: String(value) || null, toolArgs: {} })
                }
                options={platformTools.map((tool) => ({
                  label:
                    tool.source === 'package' && tool.packageName != null
                      ? `${tool.packageName} / ${tool.title}（${tool.name}）`
                      : `${tool.title}（${tool.name}）`,
                  value: tool.name,
                }))}
              />
            )}
            {platformTools.length > 0 && (
              <div className="wf-field-help">
                清单来自工具工作室的自定义工具与已启用的工具包；运行时即时读取目录，
                工具被禁用后运行该节点会失败并可重试。
              </div>
            )}
          </InspectorField>
          {argFields.length > 0 ? (
            <ToolArgsForm
              fields={argFields}
              toolArgs={toolArgs}
              onPatchArg={patchArg}
              variableHint={variableHint}
            />
          ) : (
            toolName.length > 0 && (
              <div className="wf-field-help">该工具暂未提供参数 schema，参数留空即可调用。</div>
            )
          )}
        </>
      )}
      {toolMode === 'mcp' && (
        <>
          <InspectorField label="MCP 服务器">
            <LobeSelect
              value={toolServerId}
              onChange={(value) =>
                onPatchConfig({ toolServerId: String(value) || null, toolName: null, toolArgs: {} })
              }
              options={mcpServers.map((server) => ({
                label: server.enabled ? server.name : `${server.name}（未启用）`,
                value: server.id,
              }))}
            />
            <div className="wf-field-help">仅已启用的服务器会在运行时真正可调用。</div>
          </InspectorField>
          {toolServerId.length > 0 && (
            <InspectorField label="MCP 工具">
              {toolsLoading ? (
                <div className="agents-empty-mini">正在加载工具清单…</div>
              ) : toolsError.length > 0 ? (
                <div className="wf-field-help wf-field-warn">
                  工具清单加载失败：{toolsError}（服务器未连接时可先启用后重试）
                </div>
              ) : mcpTools.length === 0 ? (
                <div className="agents-empty-mini">
                  未获取到工具（服务器可能未连接，进入设置页连接后刷新）
                </div>
              ) : (
                <LobeSelect
                  value={toolName}
                  onChange={(value) =>
                    onPatchConfig({ toolName: String(value) || null, toolArgs: {} })
                  }
                  options={mcpTools.map((tool) => ({
                    label: tool.name,
                    value: tool.name,
                  }))}
                />
              )}
            </InspectorField>
          )}
          {argFields.length > 0 && (
            <ToolArgsForm
              fields={argFields}
              toolArgs={toolArgs}
              onPatchArg={patchArg}
              variableHint={variableHint}
            />
          )}
        </>
      )}
    </>
  )
}
