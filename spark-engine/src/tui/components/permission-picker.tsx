import { Box, Text, useInput } from 'ink'
import { useEffect, useState, type ReactElement } from 'react'

import type { PermissionMode } from '../../permission/types.js'
import type { TuiTheme } from '../theme.js'

// Exactly three approval levels, mirroring the engine's PermissionMode union:
// manual asks per call, auto approves everything short of explicit deny rules,
// bypass skips the policy entirely.
export const PERMISSION_MODES: readonly {
  readonly mode: PermissionMode
  readonly label: string
  readonly hint: string
}[] = [
  { mode: 'manual', label: '手动审批', hint: '写入/命令逐次确认,只读工具直接执行' },
  { mode: 'auto', label: '自动审批', hint: '所有工具自动执行(显式 deny 规则仍生效)' },
  { mode: 'bypass', label: '完全访问', hint: '危险:跳过全部审批与规则' },
]

export interface PermissionPickerProps {
  readonly theme: TuiTheme
  readonly current: PermissionMode
  /** Selected after the destructive double-confirm; others apply immediately. */
  onPick(mode: PermissionMode): void
  onClose(): void
  onNotice(message: string): void
}

/**
 * Interactive permission-mode switcher. Switching is session-scoped: the new
 * policy applies to subsequent turns of this conversation only.
 */
export function PermissionPicker(props: PermissionPickerProps): ReactElement {
  const initialIndex = Math.max(
    0,
    PERMISSION_MODES.findIndex((entry) => entry.mode === props.current),
  )
  const [selected, setSelected] = useState(initialIndex)
  const [armingBypass, setArmingBypass] = useState(false)

  useEffect(() => {
    setArmingBypass(false)
  }, [selected])

  useInput((input, key) => {
    if (key.escape) {
      if (armingBypass) {
        setArmingBypass(false)
        return
      }
      props.onClose()
      return
    }
    if (key.upArrow) {
      setSelected((value) => (value + PERMISSION_MODES.length - 1) % PERMISSION_MODES.length)
      return
    }
    if (key.downArrow) {
      setSelected((value) => (value + 1) % PERMISSION_MODES.length)
      return
    }
    if (/^[1-9]$/.test(input)) {
      const index = Number(input) - 1
      if (index < PERMISSION_MODES.length) choose(index)
      return
    }
    if (key.return) choose(selected)
  })

  const choose = (index: number): void => {
    const entry = PERMISSION_MODES[index]
    if (!entry) return
    if (entry.mode === 'bypass' && !armingBypass) {
      setArmingBypass(true)
      props.onNotice('绕过审批会让工具不经确认执行 — 再按一次 enter 确认,esc 取消')
      return
    }
    props.onPick(entry.mode)
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={props.theme.accent} paddingX={1}>
      <Text color={props.theme.accent}>
        权限策略切换(本会话生效){armingBypass ? ' · 再次按 enter 确认危险选项' : ''}
      </Text>
      {PERMISSION_MODES.map((entry, index) => (
        <Text key={entry.mode} {...(entry.mode === 'bypass' ? { color: props.theme.warn } : {})}>
          {selected === index ? '❯' : ' '} {index + 1} {entry.label}
          <Text color={props.theme.dim}> — {entry.hint}</Text>
          {entry.mode === props.current ? <Text color={props.theme.ok}> ✓当前</Text> : null}
        </Text>
      ))}
      <Text color={props.theme.dim}>↑↓/数字 选择 · enter 应用 · esc 关闭</Text>
    </Box>
  )
}

/**
 * Cycles between the non-destructive modes only (manual ↔ auto), so a single
 * stray keypress can never arm permission bypass. Switching to `bypass` must
 * go through PermissionPicker's double confirm.
 */
export function nextPermissionMode(current: PermissionMode): PermissionMode {
  const safeModes: readonly PermissionMode[] = ['manual', 'auto']
  if (current === 'bypass') return 'manual'
  const index = safeModes.indexOf(current)
  return safeModes[(index + 1) % safeModes.length] ?? 'manual'
}
