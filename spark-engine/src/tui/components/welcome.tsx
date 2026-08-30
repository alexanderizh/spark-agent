import { Box, Text } from 'ink'
import type { ReactElement } from 'react'

import { glyphs, type TerminalCapabilities, type TuiTheme } from '../theme.js'

export interface WelcomeBoxProps {
  readonly version: string
  readonly model: string | undefined
  readonly cwd: string
  readonly capabilities: TerminalCapabilities
  readonly theme: TuiTheme
}

/**
 * Empty-state welcome panel: rounded frame, brand mark, the resolved model,
 * and the handful of keys that matter on first contact. Replaced by the
 * transcript as soon as the first turn starts.
 */
export function WelcomeBox(props: WelcomeBoxProps): ReactElement {
  const symbols = glyphs(props.capabilities)
  const width = Math.min(props.capabilities.width - 2, 64)
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={props.theme.dim}
      paddingX={2}
      paddingY={1}
      width={width}
    >
      <Text>
        <Text color={props.theme.accent} bold>
          {symbols.brand} Spark
        </Text>
        <Text color={props.theme.dim}> v{props.version} · 确定性编码 Agent</Text>
      </Text>
      <Text color={props.theme.dim}>
        模型 {props.model ?? '未选择'} · {props.cwd}
      </Text>
      <Text> </Text>
      <Text color={props.theme.dim}>· 输入任务开始，/help 查看全部命令</Text>
      <Text color={props.theme.dim}>· ↑↓ 历史 · Shift+Enter 换行 · esc 中断 · Ctrl+C 两次退出</Text>
    </Box>
  )
}
