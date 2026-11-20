import { useEffect, useState } from 'react'
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import type { MobileBridgeUpdateSessionRequest } from '../../../packages/protocol/src/mobile-bridge'
import { PERMISSION_LABELS, REASONING_LABELS } from '../../mobile/src/utils/session-config-labels'
import { object, type Device, type Project, type Relay } from './relay'
import { ReasoningSlider } from './ReasoningSlider'
import { useUi } from './ui'

export interface WorkbenchConfig {
  project?: Project
  runtime: MobileBridgeUpdateSessionRequest
  providerName?: string
  modelName?: string
}

function catalogOptions(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw: unknown) => {
    const item = object(raw)
    return typeof item?.id === 'string' && typeof item.name === 'string'
      ? [
          {
            id: item.id,
            name: item.name,
            models: item.models,
            isAutoRouter: item.isAutoRouter === true,
          },
        ]
      : []
  })
}

function stringOptions(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item: unknown): item is string => typeof item === 'string')
    : []
}

type Choice = { id: string; label: string; select(): void }
const choices = {
  device: '选择电脑',
  project: '选择项目',
  model: '选择模型渠道',
  permission: '权限策略',
}
type ChoiceKind = keyof typeof choices

export function WorkbenchSettings({
  device,
  devices,
  relay,
  config,
  change,
  selectDevice,
  close,
}: {
  device: Device
  devices?: Device[]
  relay: Relay
  config: WorkbenchConfig
  change(value: WorkbenchConfig): void
  selectDevice?(device: Device): void
  close(): void
}) {
  const { ui, colors, r, theme } = useUi()
  const [data, setData] = useState<{ projects: Project[]; catalog?: Record<string, unknown> }>()
  const [chooser, setChooser] = useState<ChoiceKind>()
  const [failed, setFailed] = useState(false)
  const [revision, setRevision] = useState(0)
  const { deviceId } = device
  const showTargetOptions = !!selectDevice
  useEffect(() => {
    let active = true
    void Promise.all([
      showTargetOptions ? relay.projects(deviceId) : Promise.resolve([]),
      relay.catalog(deviceId),
    ])
      .then(([projects, catalog]) => {
        if (active) setData({ projects, catalog })
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [deviceId, relay, revision, showTargetOptions])
  useEffect(() => {
    const handle = BackHandler.addEventListener('hardwareBackPress', () => {
      if (chooser) setChooser(undefined)
      else close()
      return true
    })
    return () => handle.remove()
  }, [chooser, close])

  const catalog = data?.catalog
  const agents = Array.isArray(catalog?.agents) ? catalog.agents : []
  const agent = object(agents.find((item: unknown) => object(item)?.isDefault === true))
  const adapter = typeof agent?.agentAdapter === 'string' ? agent.agentAdapter : 'claude'
  const permissions = stringOptions(object(catalog?.permissionModes)?.[adapter])
  const efforts = stringOptions(catalog?.reasoningEfforts)
  const permission =
    permissions.find((id) => id === (config.runtime.permissionMode ?? agent?.permissionMode)) ??
    permissions[0]
  const effort =
    efforts.find((id) => id === (config.runtime.reasoningEffort ?? agent?.reasoningEffort)) ??
    efforts.find((id) => id === 'medium') ??
    efforts[0]
  const selectedModel = config.runtime.providerProfileId
    ? `${config.runtime.providerProfileId}::${config.runtime.modelId ?? ''}`
    : ''
  const modelChoices: Choice[] = [
    {
      id: '',
      label: '电脑默认模型',
      select: () => {
        const { permissionMode, reasoningEffort } = config.runtime
        change({
          project: config.project,
          runtime: {
            ...(permissionMode !== undefined && { permissionMode }),
            ...(reasoningEffort !== undefined && { reasoningEffort }),
          },
        })
      },
    },
    ...catalogOptions(catalog?.providers).flatMap((provider) => {
      const models = catalogOptions(provider.models)
      const items =
        provider.isAutoRouter || models.length === 0
          ? [{ id: null, name: provider.isAutoRouter ? '自动路由' : '默认模型' }]
          : models
      return items.map((model) => ({
        id: `${provider.id}::${model.id ?? ''}`,
        label: `${provider.name} · ${model.name}`,
        select: () =>
          change({
            ...config,
            providerName: provider.name,
            modelName: model.id ? model.name : undefined,
            runtime: { ...config.runtime, providerProfileId: provider.id, modelId: model.id },
          }),
      }))
    }),
  ]
  const deviceLabel = (row: Device) =>
    `${row.label} · ${devices?.some((item) => item.deviceId === row.deviceId) ? '在线' : '离线'}`
  const list: Record<ChoiceKind, { selected: string; rows: Choice[] }> = {
    device: {
      selected: deviceId,
      rows: (devices ?? []).map((row) => ({
        id: row.deviceId,
        label: deviceLabel(row),
        select: () => selectDevice?.(row),
      })),
    },
    project: {
      selected: config.project?.id ?? '',
      rows: [
        { id: '', label: '未归属项目', select: () => change({ ...config, project: undefined }) },
        ...(data?.projects ?? [])
          .filter((row) => row.id !== 'default')
          .map((row) => ({
            id: row.id,
            label: row.name,
            select: () => change({ ...config, project: row }),
          })),
      ],
    },
    model: { selected: selectedModel, rows: modelChoices },
    permission: {
      selected: permission ?? '',
      rows: permissions.map((id) => ({
        id,
        label: PERMISSION_LABELS[id] ?? id,
        select: () => change({ ...config, runtime: { ...config.runtime, permissionMode: id } }),
      })),
    },
  }
  const dark = theme.mode === 'dark'
  const sheet = {
    paddingHorizontal: r(32),
    paddingTop: r(28),
    paddingBottom: r(28),
    borderTopLeftRadius: r(28),
    borderTopRightRadius: r(28),
    backgroundColor: dark ? colors.paper : '#FAF9F7',
  }
  const rowStyle = {
    minHeight: r(88),
    gap: r(14),
    borderTopWidth: r(1),
    borderColor: dark ? colors.line : '#EEECE8',
  }
  const labelStyle = { width: r(142), color: dark ? colors.muted : '#706D67', fontSize: r(24) }
  const valueColor = dark ? colors.text : '#252422'
  const pendingLabel = failed ? '读取失败' : '读取中…'
  const row = (kind: ChoiceKind, label: string, value: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={value}
      disabled={list[kind].rows.length === 0 || (kind !== 'device' && !data)}
      onPress={() => setChooser(kind)}
      style={({ pressed }) => [
        ui.row,
        rowStyle,
        { backgroundColor: pressed ? colors.tint : 'transparent' },
      ]}
    >
      <Text style={labelStyle}>{label}</Text>
      <Text
        numberOfLines={1}
        style={{ flex: 1, minWidth: 0, textAlign: 'right', color: valueColor, fontSize: r(25) }}
      >
        {value}
      </Text>
      <Svg
        width={r(30)}
        height={r(24)}
        viewBox="0 0 24 24"
        fill="none"
        stroke={colors.placeholder}
        strokeWidth={1.5}
      >
        <Path d="m6 9 6 6 6-6" />
      </Svg>
    </Pressable>
  )
  const sheetHead = (title: string, dismiss: () => void, subtitle?: string) => (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        paddingBottom: r(18),
      }}
    >
      <View style={{ flex: 1 }}>
        <Text
          accessibilityRole="header"
          style={[ui.section, { fontSize: r(32), lineHeight: r(44) }]}
        >
          {title}
        </Text>
        {subtitle && (
          <Text
            style={{
              color: dark ? colors.placeholder : '#8A8782',
              marginTop: r(8),
              fontSize: r(22),
              lineHeight: r(30),
            }}
          >
            {subtitle}
          </Text>
        )}
      </View>
      <Pressable accessibilityRole="button" hitSlop={8} onPress={dismiss}>
        <Text
          style={{
            minWidth: r(72),
            color: colors.accent,
            fontSize: r(24),
            lineHeight: r(56),
            textAlign: 'right',
          }}
        >
          完成
        </Text>
      </Pressable>
    </View>
  )
  const closeChooser = () => setChooser(undefined)
  return (
    <View style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end', zIndex: 10 }]}>
      <Pressable
        style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(20,20,20,0.38)' }]}
        accessible={false}
        onPress={close}
      />
      <View
        accessibilityViewIsModal
        accessibilityElementsHidden={!!chooser}
        importantForAccessibility={chooser ? 'no-hide-descendants' : 'auto'}
        style={[sheet, { maxHeight: '95%' }]}
      >
        {sheetHead(selectDevice ? '新建会话配置' : '模型配置', close, '选择只影响本次新会话')}
        <ScrollView style={{ flexGrow: 0 }} keyboardShouldPersistTaps="handled">
          {selectDevice && row('device', '电脑', deviceLabel(device))}
          {selectDevice &&
            row('project', '项目', data ? (config.project?.name ?? '未归属项目') : pendingLabel)}
          {row(
            'model',
            '模型渠道',
            modelChoices.find((item) => item.id === selectedModel)?.label ?? '电脑默认模型',
          )}
          {row(
            'permission',
            '权限模式',
            permission
              ? (PERMISSION_LABELS[permission] ?? permission)
              : data
                ? '不可切换'
                : pendingLabel,
          )}
          <View style={[ui.row, rowStyle]}>
            <Text style={labelStyle}>推理强度</Text>
            <ReasoningSlider
              count={efforts.length}
              index={effort ? efforts.indexOf(effort) : 0}
              label={effort ? (REASONING_LABELS[effort] ?? effort) : data ? '—' : pendingLabel}
              change={(index) => {
                const reasoningEffort = efforts[index]
                if (reasoningEffort && reasoningEffort !== effort) {
                  change({ ...config, runtime: { ...config.runtime, reasoningEffort } })
                }
              }}
            />
          </View>
          {!data && (
            <Text style={failed ? ui.error : { color: colors.muted, fontSize: r(22) }}>
              {failed ? '加载配置失败。' : '正在读取这台电脑的项目和模型…'}
              {failed && (
                <Text
                  accessibilityRole="button"
                  style={{ color: colors.accent }}
                  onPress={() => {
                    setFailed(false)
                    setRevision((value) => value + 1)
                  }}
                >
                  重试
                </Text>
              )}
            </Text>
          )}
        </ScrollView>
      </View>
      {chooser && (
        <View style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end' }]}>
          <Pressable
            style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(20,20,20,0.38)' }]}
            accessible={false}
            onPress={closeChooser}
          />
          <View accessibilityViewIsModal style={[sheet, { maxHeight: '55%' }]}>
            {sheetHead(choices[chooser], closeChooser)}
            <ScrollView style={{ flexGrow: 0 }}>
              {list[chooser].rows.map((option) => {
                const selected = option.id === list[chooser].selected
                return (
                  <Pressable
                    key={option.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => {
                      closeChooser()
                      option.select()
                    }}
                    style={({ pressed }) => [
                      ui.row,
                      rowStyle,
                      {
                        justifyContent: 'space-between',
                        backgroundColor: pressed ? colors.tint : 'transparent',
                      },
                    ]}
                  >
                    <Text
                      style={{
                        flex: 1,
                        color: selected ? colors.accent : valueColor,
                        fontSize: r(26),
                      }}
                    >
                      {option.label}
                    </Text>
                    {selected && <Text style={{ color: colors.accent }}>✓</Text>}
                  </Pressable>
                )
              })}
            </ScrollView>
          </View>
        </View>
      )}
    </View>
  )
}
