import { Box, Text, useInput } from 'ink'
import { useMemo, useState, type ReactElement } from 'react'

import type { ConfiguredModelCatalog } from '../config/model-config.js'
import { shouldSwallowImeKeypress } from './ime-guard.js'
import type { ModelProtocol } from '../llm/registry.js'
import type { TuiTheme } from './theme.js'

const MAX_VISIBLE_ENTRIES = 15

export interface LocalProviderDraft {
  readonly alias: string
  readonly protocol: ModelProtocol
  readonly baseUrl?: string
  readonly apiKeyEnv: string
  readonly modelId: string
}

export interface ModelPickerProps {
  readonly catalog: ConfiguredModelCatalog | undefined
  readonly refreshing: boolean
  readonly busy: boolean
  readonly notice: string | undefined
  readonly error: string | undefined
  readonly selectedModel: string | undefined
  readonly theme: TuiTheme
  readonly canClose: boolean
  onSelect(modelId: string): void
  onConfigureLocal(): void
  onRefresh(): void
  onClose(): void
  onExit(): void
}

export function ModelPicker(props: ModelPickerProps): ReactElement {
  const entries = props.catalog?.entries ?? []
  const [cursor, setCursor] = useState(0)
  const visible = entries.slice(0, MAX_VISIBLE_ENTRIES)
  const clampCursor = (next: number): number =>
    visible.length === 0 ? 0 : Math.min(visible.length - 1, Math.max(0, next))

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      props.onExit()
      return
    }
    if (shouldSwallowImeKeypress(key.return ? { name: 'return' } : {})) return
    if (key.upArrow || input === 'k') setCursor((position) => clampCursor(position - 1))
    else if (key.downArrow || input === 'j') setCursor((position) => clampCursor(position + 1))
    else if (key.return) {
      const entry = visible[cursor]
      if (entry) props.onSelect(entry.id)
    } else if (input === 'c') props.onConfigureLocal()
    else if (input === 'r') props.onRefresh()
    else if (key.escape || input === 'q') {
      if (props.canClose) props.onClose()
    }
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={props.theme.accent} paddingX={1}>
      <Text bold color={props.theme.accent}>
        {props.notice ?? '选择模型'}
      </Text>
      {props.busy && <Text color={props.theme.dim}>正在加载模型…</Text>}
      {props.catalog && (
        <Text color={props.theme.dim}>
          SparkWork：{props.catalog.sparkWorkConnected ? '已连接' : '未连接'}
          {props.catalog.sparkWorkStaleBridgeDescriptors > 0
            ? ` · ${props.catalog.sparkWorkStaleBridgeDescriptors} 个陈旧 bridge 描述`
            : ''}
          {props.catalog.sparkWorkDiagnostic ? ` · ${props.catalog.sparkWorkDiagnostic}` : ''}
        </Text>
      )}
      {props.refreshing && <Text color={props.theme.dim}>刷新目录中…</Text>}
      {visible.length === 0 ? (
        <Text>
          没有可用模型。打开 SparkWork（渠道会自动同步），或按 <Text bold>c</Text>{' '}
          配置本地渠道，或按 <Text bold>r</Text> 刷新。
        </Text>
      ) : (
        <Box flexDirection="column">
          {visible.map((entry, index) => (
            <Text key={entry.id} dimColor={props.busy}>
              {index === cursor ? '❯' : ' '}
              {entry.selected ? '*' : ' '}
              {entry.model}
              <Text color={props.theme.dim}>
                {'  '}
                {entry.providerName} · {entry.protocol} · [{entry.source}]
              </Text>
            </Text>
          ))}
          {entries.length > visible.length && (
            <Text color={props.theme.dim}>
              … 共 {entries.length} 个，仅显示前 {visible.length} 个
            </Text>
          )}
        </Box>
      )}
      <Text color={props.theme.dim}>
        ↑↓ 选择 · Enter 确认 · c 配置本地渠道 · r 刷新
        {props.canClose ? ' · esc 返回' : ' · Ctrl+C 退出'}
      </Text>
      {props.error && <Text color={props.theme.warn}>{props.error}</Text>}
    </Box>
  )
}

export interface ProviderConfigFormProps {
  readonly theme: TuiTheme
  readonly error: string | undefined
  onSubmit(draft: LocalProviderDraft): void
  onCancel(): void
  onExit(): void
}

type FormStep = 'protocol' | 'model' | 'baseUrl' | 'apiKeyEnv' | 'alias' | 'summary'

const DEFAULT_KEY_ENV: Record<ModelProtocol, string> = {
  'anthropic-messages': 'ANTHROPIC_API_KEY',
  'openai-responses': 'OPENAI_API_KEY',
}

export function ProviderConfigForm(props: ProviderConfigFormProps): ReactElement {
  const [step, setStep] = useState<FormStep>('protocol')
  const [protocol, setProtocol] = useState<ModelProtocol>('openai-responses')
  const [modelId, setModelId] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKeyEnv, setApiKeyEnv] = useState('')
  const [alias, setAlias] = useState('')

  const draft = useMemo<LocalProviderDraft>(() => {
    const normalizedAlias = (alias.trim() || modelId.trim().toLowerCase())
      .replace(/[^a-z0-9-]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 64)
    const url = baseUrl.trim()
    return {
      alias: normalizedAlias,
      protocol,
      ...(url === '' ? {} : { baseUrl: url }),
      apiKeyEnv: apiKeyEnv.trim() || DEFAULT_KEY_ENV[protocol],
      modelId: modelId.trim(),
    }
  }, [alias, apiKeyEnv, baseUrl, modelId, protocol])

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      props.onExit()
      return
    }
    if (key.escape) {
      props.onCancel()
      return
    }
    if (step === 'protocol') {
      if (input === '1') setProtocol('openai-responses')
      else if (input === '2') setProtocol('anthropic-messages')
      else if (key.return) setStep('model')
      return
    }
    if (step === 'summary') {
      if (input === 'b') setStep('alias')
      else if (key.return) props.onSubmit(draft)
      return
    }
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={props.theme.accent} paddingX={1}>
      <Text bold color={props.theme.accent}>
        配置本地模型渠道（凭据只存环境变量名，绝不写入文件）
      </Text>
      <Text color={props.theme.dim}>
        协议：<Text bold={protocol === 'openai-responses'}>1 OpenAI Responses</Text>
        {' / '}
        <Text bold={protocol === 'anthropic-messages'}>2 Anthropic Messages</Text>
        {step === 'protocol' ? '（按 1/2 切换，Enter 下一步）' : ''}
      </Text>
      {step === 'model' && (
        <TextField
          label="上游模型 ID（如 gpt-5.6 / claude-sonnet-4-5）"
          value={modelId}
          onChange={setModelId}
          onSubmit={() => {
            setStep('baseUrl')
          }}
          theme={props.theme}
        />
      )}
      {step === 'baseUrl' && (
        <TextField
          label="base_url（留空 = 官方端点；自定义渠道填完整地址）"
          value={baseUrl}
          onChange={setBaseUrl}
          onSubmit={() => {
            setStep('apiKeyEnv')
          }}
          theme={props.theme}
        />
      )}
      {step === 'apiKeyEnv' && (
        <TextField
          label={`凭据环境变量名（留空 = ${DEFAULT_KEY_ENV[protocol]}）`}
          value={apiKeyEnv}
          onChange={setApiKeyEnv}
          onSubmit={() => {
            setStep('alias')
          }}
          theme={props.theme}
        />
      )}
      {step === 'alias' && (
        <TextField
          label="本地别名（留空 = 由模型 ID 派生）"
          value={alias}
          onChange={setAlias}
          onSubmit={() => {
            setStep('summary')
          }}
          theme={props.theme}
        />
      )}
      {step === 'summary' && (
        <Box flexDirection="column">
          <Text>确认写入 ~/.spark/config.toml（已存在同名别名会被覆盖）：</Text>
          <Text color={props.theme.dim}>
            [models.{draft.alias}] provider={draft.alias} model={draft.modelId} · [providers.
            {draft.alias}] {draft.protocol}
            {draft.baseUrl ? ` · base_url=${draft.baseUrl}` : ''} · api_key_env={draft.apiKeyEnv}
          </Text>
          <Text color={props.theme.dim}>
            启动前请设置环境变量：export {draft.apiKeyEnv}=&lt;你的密钥&gt;
          </Text>
          <Text color={props.theme.dim}>Enter 确认 · b 返回修改 · esc 取消</Text>
        </Box>
      )}
      {props.error && <Text color={props.theme.warn}>{props.error}</Text>}
    </Box>
  )
}

interface TextFieldProps {
  readonly label: string
  readonly value: string
  readonly theme: TuiTheme
  onChange(value: string): void
  onSubmit(): void
}

function TextField(props: TextFieldProps): ReactElement {
  const [cursor, setCursor] = useState(props.value.length)
  const characters = useMemo(() => Array.from(props.value), [props.value])

  useInput((input, key) => {
    if (shouldSwallowImeKeypress(key.return ? { name: 'return' } : {})) return
    if (key.leftArrow) setCursor((position) => Math.max(0, position - 1))
    else if (key.rightArrow) setCursor((position) => Math.min(characters.length, position + 1))
    else if (key.home) setCursor(0)
    else if (key.end) setCursor(characters.length)
    else if (key.backspace) {
      if (cursor > 0) {
        props.onChange(
          characters
            .slice(0, cursor - 1)
            .concat(characters.slice(cursor))
            .join(''),
        )
        setCursor(cursor - 1)
      }
    } else if (key.return) {
      setCursor(characters.length)
      props.onSubmit()
    } else if (input && !key.ctrl && !key.meta) {
      props.onChange(
        characters.slice(0, cursor).concat(Array.from(input), characters.slice(cursor)).join(''),
      )
      setCursor(cursor + Array.from(input).length)
    }
  })

  return (
    <Box>
      <Text color={props.theme.dim}>{props.label}</Text>
      <Text>
        {characters.slice(0, cursor).join('')}
        <Text inverse> </Text>
        {characters.slice(cursor).join('')}
      </Text>
    </Box>
  )
}
