import { Box, Text, useInput } from 'ink'
import { useEffect, useState, type ReactElement } from 'react'

import { shortSessionId } from '../../events/ledger.js'
import type { SessionMeta } from '../../seams.js'
import type { TuiTheme } from '../theme.js'

const PICKER_WINDOW = 8

export interface SessionPickerProps {
  readonly theme: TuiTheme
  readonly sessions: readonly SessionMeta[]
  readonly currentSessionId: string
  onPick(sessionId: string): void
  onClose(): void
}

/**
 * Interactive session selector opened by /sessions (or bare `spark --resume`).
 * Same interaction model as the model/effort pickers (↑↓ + enter, esc closes);
 * rows show recency, the first user input, and the compact session id.
 */
export function SessionPicker(props: SessionPickerProps): ReactElement {
  const [selected, setSelected] = useState(0)
  const [scroll, setScroll] = useState(0)

  useEffect(() => {
    if (selected < scroll) setScroll(selected)
    if (selected >= scroll + PICKER_WINDOW) setScroll(selected - PICKER_WINDOW + 1)
  }, [selected, scroll])

  useInput((input, key) => {
    if (key.escape) {
      props.onClose()
      return
    }
    if (props.sessions.length === 0) {
      if (key.return || key.escape) props.onClose()
      return
    }
    if (key.upArrow) {
      setSelected((value) => (value + props.sessions.length - 1) % props.sessions.length)
      return
    }
    if (key.downArrow) {
      setSelected((value) => (value + 1) % props.sessions.length)
      return
    }
    if (/^[1-9]$/.test(input)) {
      const session = props.sessions[Number(input) - 1]
      if (session) props.onPick(session.sessionId)
      return
    }
    if (key.return) {
      const session = props.sessions[selected]
      if (session) props.onPick(session.sessionId)
    }
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={props.theme.accent} paddingX={1}>
      <Text color={props.theme.accent}>选择会话(最近更新优先)</Text>
      {props.sessions.length === 0 ? (
        <Text color={props.theme.dim}>当前目录还没有历史会话</Text>
      ) : (
        props.sessions.slice(scroll, scroll + PICKER_WINDOW).map((session, offset) => {
          const index = scroll + offset
          const when = formatSessionTime(session.updatedAt)
          return (
            <Text key={session.sessionId}>
              {selected === index ? '❯' : ' '}
              {index + 1} {when}
              <Text color={props.theme.dim}> {session.preview ?? '(无输入)'}</Text>
              {session.sessionId === props.currentSessionId ? (
                <Text color={props.theme.ok}> ✓当前</Text>
              ) : null}
              <Text color={props.theme.dim}> · {shortSessionId(session.sessionId)}</Text>
            </Text>
          )
        })
      )}
      <Text color={props.theme.dim}>
        {props.sessions.length > PICKER_WINDOW ? `↑↓ 滚动 · ` : ''}↑↓/数字 选择 · enter 切换 · esc
        关闭
      </Text>
    </Box>
  )
}

function formatSessionTime(timestampMs: number): string {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return '??'
  const date = new Date(timestampMs)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
