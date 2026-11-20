import { Alert, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import type { Device } from './relay'
import { Action, useUi } from './ui'

export function QuickStart({
  device,
  initialText,
  setText,
  send,
  state,
  unlock,
  showExisting,
  showConfig,
  configSummary,
}: {
  device?: Device
  initialText: string
  setText(value: string): void
  send(): void
  state: 'ready' | 'sending' | 'unconfirmed'
  unlock(): void
  showExisting(): void
  showConfig(): void
  configSummary: string
}) {
  const { ui, colors, r, theme } = useUi()
  const dark = theme.mode === 'dark'
  const canSend = !!device && state === 'ready' && !!initialText.trim()
  const summaryColor = dark ? colors.muted : '#5D5A55'
  const footnoteColor = dark ? colors.placeholder : '#A09C95'
  return (
    <View
      style={{
        paddingHorizontal: r(24),
        paddingTop: r(12),
        borderTopWidth: StyleSheet.hairlineWidth,
        borderColor: dark ? '#353431' : '#ECEAE7',
        backgroundColor: dark ? colors.background : '#FAF9F7',
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="会话配置"
        disabled={!device}
        onPress={() => {
          Keyboard.dismiss()
          showConfig()
        }}
        style={({ pressed }) => [
          ui.row,
          {
            minHeight: r(64),
            paddingHorizontal: r(12),
            gap: r(12),
            borderRadius: r(14),
            backgroundColor: pressed ? colors.tint : 'transparent',
          },
        ]}
      >
        <Text style={{ color: colors.accent, fontSize: r(22), fontWeight: '600' }}>会话配置</Text>
        <Text numberOfLines={1} style={{ flex: 1, color: summaryColor, fontSize: r(22) }}>
          {configSummary}
        </Text>
        <Svg
          width={r(24)}
          height={r(24)}
          viewBox="0 0 24 24"
          fill="none"
          stroke={colors.placeholder}
          strokeWidth={1.5}
        >
          <Path d="m6 9 6 6 6-6" />
        </Svg>
      </Pressable>
      {state === 'unconfirmed' && (
        <View>
          <Text style={ui.error} accessibilityLiveRegion="polite">
            新建结果未确认，请先打开会话检查，避免重复提交。
          </Text>
          <View style={ui.row}>
            <Action compact label="全部会话" onPress={showExisting} />
            <Action
              compact
              label="在电脑端核对后解锁"
              onPress={() =>
                Alert.alert('确认未创建会话？', '请同时检查电脑端的会话列表。', [
                  { text: '取消', style: 'cancel' },
                  { text: '确认未创建', onPress: unlock },
                ])
              }
            />
          </View>
        </View>
      )}
      <View
        style={[
          ui.row,
          {
            minHeight: r(92),
            gap: r(12),
            padding: r(12),
            paddingLeft: r(22),
            backgroundColor: colors.paper,
            borderColor: dark ? '#3B3935' : '#E5E3DF',
            borderWidth: StyleSheet.hairlineWidth,
            borderRadius: r(24),
            boxShadow: `0 ${r(5)}px ${r(18)}px ${dark ? '#0000003D' : '#1A1A1A0B'}`,
          },
        ]}
      >
        <TextInput
          accessibilityLabel="发起一条新的远程对话"
          value={initialText}
          onChangeText={setText}
          multiline
          maxLength={8000}
          editable={state === 'ready'}
          style={{
            flex: 1,
            padding: 0,
            color: colors.text,
            fontSize: r(27),
            lineHeight: r(40.5),
            maxHeight: r(180),
          }}
          placeholder="发起一条新的远程对话…"
          placeholderTextColor={dark ? colors.placeholder : '#B3B0AB'}
        />
        <Pressable
          accessibilityRole="button"
          disabled={!canSend}
          onPress={send}
          style={({ pressed }) => ({
            minWidth: r(76),
            height: r(64),
            paddingHorizontal: r(8),
            borderRadius: r(18),
            justifyContent: 'center',
            alignItems: 'center',
            opacity: pressed ? 0.78 : 1,
            backgroundColor: canSend ? colors.text : dark ? '#353431' : '#E8E6E3',
          })}
        >
          <Text
            style={{
              fontSize: r(22),
              fontWeight: '600',
              color: canSend ? colors.onAction : dark ? colors.placeholder : '#85817A',
            }}
          >
            {state === 'sending' ? '发送中' : '发送'}
          </Text>
        </Pressable>
      </View>
      <Text
        style={{
          paddingHorizontal: r(8),
          paddingTop: r(18),
          color: footnoteColor,
          fontSize: r(19),
          lineHeight: r(26),
        }}
      >
        首条消息会在所选电脑上创建新会话
      </Text>
    </View>
  )
}
