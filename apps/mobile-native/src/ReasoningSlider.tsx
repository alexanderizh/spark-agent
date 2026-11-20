import { useRef, useState } from 'react'
import { StyleSheet, Text, View, type GestureResponderEvent } from 'react-native'
import { useUi } from './ui'

export function ReasoningSlider({
  count,
  index,
  label,
  change,
}: {
  count: number
  index: number
  label: string
  change(index: number): void
}) {
  const { colors, r } = useUi()
  const [preview, setPreview] = useState<number>()
  const gesture = useRef<{ pageX: number; localX: number }>(null)
  const [width, setWidth] = useState(0)
  const max = Math.max(0, count - 1)
  const enabled = max > 0
  const current = preview ?? index
  const diameter = r(36)
  const padding = diameter / 2
  const fraction = max ? current / max : 0
  const offset = Math.max(0, width - diameter) * fraction
  const indexAt = (event: GestureResponderEvent) => {
    const start = gesture.current
    const track = width - diameter
    if (!start || track <= 0) return index
    const position = start.localX + event.nativeEvent.pageX - start.pageX - padding
    return Math.min(max, Math.max(0, Math.round((position / track) * max)))
  }
  return (
    <>
      <View
        accessibilityRole="adjustable"
        accessibilityLabel="推理强度"
        accessibilityState={{ disabled: !enabled }}
        accessibilityValue={{ min: 0, max, now: index, text: label }}
        accessibilityActions={enabled ? [{ name: 'increment' }, { name: 'decrement' }] : []}
        onAccessibilityAction={(event) => {
          const action = event.nativeEvent.actionName
          if (enabled && action === 'increment' && index < max) change(index + 1)
          if (enabled && action === 'decrement' && index > 0) change(index - 1)
        }}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => enabled}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(event) => {
          gesture.current = { pageX: event.nativeEvent.pageX, localX: event.nativeEvent.locationX }
          setPreview(indexAt(event))
        }}
        onResponderMove={(event) => setPreview(indexAt(event))}
        onResponderRelease={(event) => {
          change(indexAt(event))
          gesture.current = null
          setPreview(undefined)
        }}
        onResponderTerminate={() => {
          gesture.current = null
          setPreview(undefined)
        }}
        style={{
          flex: 1,
          minWidth: 0,
          height: r(64),
          justifyContent: 'center',
          opacity: enabled ? 1 : 0.5,
        }}
      >
        <View
          pointerEvents="none"
          style={{
            marginHorizontal: padding,
            height: r(4),
            borderRadius: r(2),
            backgroundColor: colors.rail,
          }}
        >
          <View
            style={{
              width: offset,
              height: r(4),
              borderRadius: r(2),
              backgroundColor: colors.accent,
            }}
          />
        </View>
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: offset,
            width: diameter,
            height: diameter,
            borderRadius: padding,
            backgroundColor: '#fff',
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: '#0002',
            boxShadow: '0 1px 4px #0002',
          }}
        />
      </View>
      <Text
        numberOfLines={1}
        style={{
          width: r(116),
          marginRight: r(44),
          textAlign: 'right',
          color: colors.text,
          fontSize: r(24),
        }}
      >
        {label}
      </Text>
    </>
  )
}
