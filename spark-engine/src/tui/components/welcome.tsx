import { Box, Text } from 'ink'
import type { ReactElement } from 'react'

import type { TerminalCapabilities, TuiTheme } from '../theme.js'

export interface WelcomeBoxProps {
  readonly version: string
  readonly model: string | undefined
  readonly cwd?: string | undefined
  readonly capabilities: TerminalCapabilities
  readonly theme: TuiTheme
}

// Pixel infinity knot: the Spark app mark (two interlocked bands, the right
// one crossing over) flattened into half-block pixels, so every monospace
// font renders the same silhouette. Terminal cells are about twice as tall as
// they are wide, so three rows give the lemniscate a wide 13:6 outline while
// staying flush with the three identity lines beside it. The diamond waist —
// top edge dipping, bottom edge rising, both pinched to one cell — is what
// keeps the center crossing readable at this size. Each row splits at the
// crossing: the left band renders in the edge tone and the right band plus
// the crossing in the core tone, echoing the app icon's dark-left /
// colorful-right split.
const MARK_ROWS: readonly { readonly edge: string; readonly core: string }[] = [
  { edge: '▄▀▀▀▀▄', core: '▄▄▀▀▀▀▄' },
  { edge: '█', core: '     █     █' },
  { edge: '▀▄▄▄▄▀', core: '▀▀▄▄▄▄▀' },
]

/**
 * Empty-state welcome panel: pixel brand mark beside model and workspace, with
 * the handful of keys that matter on first contact. Replaced by the
 * transcript as soon as the first turn starts.
 */
export function WelcomeBox(props: WelcomeBoxProps): ReactElement {
  const width = Math.min(props.capabilities.width - 2, 64)
  const coreColor = props.theme.accentStrong ?? props.theme.accent
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={props.theme.dim}
      paddingX={2}
      paddingY={1}
      width={width}
    >
      <Box flexShrink={0}>
        <Box flexDirection="column">
          {MARK_ROWS.map((row, index) => (
            <Text key={index}>
              <Text color={props.theme.accent}>{row.edge}</Text>
              <Text color={coreColor}>{row.core}</Text>
            </Text>
          ))}
        </Box>
        <Box flexDirection="column" marginLeft={2}>
          <Text>
            <Text color={props.theme.accentStrong ?? props.theme.accent} bold>
              Spark
            </Text>
            <Text color={props.theme.dim}> v{props.version}</Text>
          </Text>
          <Text>
            <Text color={props.theme.dim}>模型 </Text>
            <Text {...(props.theme.fg === undefined ? {} : { color: props.theme.fg })}>
              {props.model ?? '未选择模型'}
            </Text>
          </Text>
          {props.cwd !== undefined && props.cwd !== '' && (
            <Text color={props.theme.dim}>目录 {props.cwd}</Text>
          )}
        </Box>
      </Box>
      <Text> </Text>
      <Text color={props.theme.dim}>输入任务直接开始 · /help 查看全部命令</Text>
      <Text color={props.theme.dim}>
        Ctrl+V 粘贴图片 · ↑↓ 历史 · Shift+Enter 换行 · Esc 中断 · Ctrl+C 两次退出
      </Text>
    </Box>
  )
}
