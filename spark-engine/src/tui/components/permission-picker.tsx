import { Text, useInput } from 'ink'
import { useEffect, useState, type ReactElement } from 'react'

import type { PermissionMode } from '../../permission/types.js'
import type { TerminalCapabilities, TuiTheme } from '../theme.js'
import { PickerFrame, PickerRow } from './picker-layout.js'

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
  readonly capabilities?: TerminalCapabilities | undefined
  readonly current: PermissionMode
  /** Selected after the destructive double-confirm; others apply immediately. */
  onPick(mode: PermissionMode): void
  onClose(): void
  onNotice(message: string): void
}

/**
 * Interactive permission-mode switcher. The new policy applies to subsequent
 * turns and is persisted as the CLI default by the owning TUI.
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
    <PickerFrame
      title="权限策略切换"
      titleSuffix={armingBypass ? ' · 再次按 enter 确认危险选项' : ' · 本会话生效'}
      footer="↑↓/数字 选择 · enter 应用 · esc 关闭"
      theme={props.theme}
    >
      {PERMISSION_MODES.map((entry, index) => (
        <PickerRow
          key={entry.mode}
          selected={selected === index}
          theme={props.theme}
          capabilities={props.capabilities}
          warning={entry.mode === 'bypass'}
        >
          {selected === index ? '❯' : ' '} {index + 1} {entry.label}
          <Text color={props.theme.dim}> — {entry.hint}</Text>
          {entry.mode === props.current ? <Text color={props.theme.ok}> ✓当前</Text> : null}
        </PickerRow>
      ))}
    </PickerFrame>
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
