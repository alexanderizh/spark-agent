import { useEffect, useRef, useState } from 'react'
import { Alert, ScrollView, Text, TextInput, View } from 'react-native'
import type { MobileBridgeUpdateSessionRequest } from '../../../packages/protocol/src/mobile-bridge'
import { NavigationRow } from './CompanionTabs'
import { object } from './relay'
import type { Relay, Target } from './relay'
import { Action, useUi } from './ui'

function choices(value: unknown): (Record<string, unknown> & { id: string; name: string })[] {
  return Array.isArray(value)
    ? value.flatMap((raw: unknown) => {
        const item = object(raw)
        return typeof item?.id === 'string' && typeof item.name === 'string'
          ? [{ ...item, id: item.id, name: item.name }]
          : []
      })
    : []
}

export function SessionSettings({
  relay,
  deviceId,
  sessionId,
  online,
  title,
  rename,
  deleted,
  openTasks,
}: Target & {
  relay: Relay
  online: boolean
  title: string
  rename(title: string): void
  deleted(): void
  openTasks(): void
}) {
  const { ui } = useUi()
  const [name, setName] = useState(title)
  const [catalog, setCatalog] = useState<Record<string, unknown>>()
  const [runtime, setRuntime] = useState<Record<string, unknown>>()
  const [issue, setIssue] = useState('')
  const [loading, setLoading] = useState(false)
  const [revision, setRevision] = useState(0)
  const [expanded, setExpanded] = useState('')
  const pending = useRef(false)
  const target = { deviceId, sessionId }
  useEffect(() => {
    if (!online) return
    let current = true
    setLoading(true)
    void Promise.all([relay.catalog(deviceId), relay.getRuntime({ deviceId, sessionId })])
      .then(([options, currentRuntime]) => {
        if (current) {
          setCatalog(options)
          setRuntime(currentRuntime)
        }
      })
      .catch(() => {
        if (current) setIssue('加载会话配置失败')
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [deviceId, online, relay, revision, sessionId])
  const act = async (work: () => Promise<void>) => {
    if (pending.current || loading || !online) return
    setIssue('')
    setLoading(true)
    pending.current = true
    try {
      await work()
      setRevision((n) => n + 1)
    } catch (error) {
      setIssue(error instanceof Error ? error.message : '操作结果未确认')
    } finally {
      pending.current = false
      setLoading(false)
    }
  }
  const patch = (input: MobileBridgeUpdateSessionRequest) =>
    void act(async () => {
      const result = await relay.updateSession(target, input)
      if (!result) throw new Error('电脑未确认配置')
      if (input.title && typeof result.title === 'string') rename(result.title)
    })
  const providers = choices(catalog?.providers)
  const provider = providers.find((item) => item.id === runtime?.providerProfileId)
  const adapter = typeof runtime?.agentAdapter === 'string' ? runtime.agentAdapter : ''
  const workflow = object(runtime?.workflowBinding)
  const section = (
    label: string,
    selected: unknown,
    options: { id: string; name: string }[],
    choose: (id: string) => void,
  ) => (
    <View>
      <NavigationRow
        label={label}
        subtitle={
          options.find((row) => row.id === selected)?.name ||
          (typeof selected === 'string' && selected ? selected : '默认')
        }
        onPress={() => setExpanded(expanded === label ? '' : label)}
      />
      {expanded === label &&
        options.map((row) => (
          <Action
            key={row.id}
            label={row.name}
            disabled={!online || loading}
            onPress={() => choose(row.id)}
          />
        ))}
    </View>
  )
  const stringOptions = (value: unknown) =>
    Array.isArray(value)
      ? value.flatMap((item: unknown) =>
          typeof item === 'string' ? [{ id: item, name: item }] : [],
        )
      : []
  return (
    <ScrollView contentContainerStyle={ui.page} keyboardShouldPersistTaps="handled">
      {!online && <Text style={ui.muted}>电脑离线</Text>}
      {!!issue && (
        <Text style={ui.error} accessibilityLiveRegion="polite">
          {issue}
        </Text>
      )}
      <View style={ui.row}>
        <TextInput
          style={[ui.input, { flex: 1 }]}
          value={name}
          onChangeText={setName}
          accessibilityLabel="会话名称"
        />
        <Action
          label="重命名"
          disabled={!online || loading || !name.trim() || name.trim() === title}
          onPress={() => patch({ title: name.trim() })}
        />
      </View>
      {section('助手', runtime?.agentId, choices(catalog?.agents), (id) => patch({ agentId: id }))}
      {section('模型渠道', runtime?.providerProfileId, providers, (id) =>
        patch({ providerProfileId: id, modelId: null }),
      )}
      {section(
        '模型',
        runtime?.modelId,
        [{ id: '', name: '跟随渠道默认' }, ...choices(provider?.models)],
        (id) => patch({ modelId: id || null }),
      )}
      {section(
        '权限模式',
        runtime?.permissionMode,
        stringOptions(object(catalog?.permissionModes)?.[adapter]),
        (id) => patch({ permissionMode: id }),
      )}
      {section(
        '推理强度',
        runtime?.reasoningEffort,
        stringOptions(catalog?.reasoningEfforts),
        (id) => patch({ reasoningEffort: id }),
      )}
      {section(
        '工作流',
        workflow?.mode === 'override' ? workflow.workflowId : workflow?.mode,
        [
          { id: 'inherit', name: '继承默认' },
          { id: 'disabled', name: '关闭工作流' },
          ...choices(catalog?.workflows).filter((row) => row.enabled === true),
        ],
        (id) =>
          void act(() =>
            id === 'inherit' || id === 'disabled'
              ? relay.setWorkflow(target, id)
              : relay.setWorkflow(target, 'override', id),
          ),
      )}
      <NavigationRow label="定时任务" onPress={openTasks} />
      <Action
        label="刷新配置"
        disabled={!online || loading}
        onPress={() => {
          setIssue('')
          setRevision((n) => n + 1)
        }}
      />
      <Action
        label="删除会话"
        disabled={!online || loading}
        onPress={() =>
          Alert.alert('删除会话？', `「${title}」的会话记录将从电脑删除。`, [
            { text: '取消', style: 'cancel' },
            {
              text: '删除',
              style: 'destructive',
              onPress: () =>
                void act(async () => {
                  if (!(await relay.deleteSession(target))) throw new Error('桌面端未确认删除')
                  deleted()
                }),
            },
          ])
        }
      />
    </ScrollView>
  )
}
