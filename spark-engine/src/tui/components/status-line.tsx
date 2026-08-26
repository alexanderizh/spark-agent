import { Text } from 'ink';
import type { ReactElement } from 'react';

import type { TerminalCapabilities, TuiTheme } from '../theme.js';
import { glyphs } from '../theme.js';

export interface StatusLineProps {
  readonly busy: boolean;
  readonly action: string;
  readonly model: string;
  readonly step: number;
  readonly tokens: number;
  readonly costUsd: number;
  readonly queued: number;
  readonly frame: number;
  readonly capabilities: TerminalCapabilities;
  readonly theme: TuiTheme;
}

export function StatusLine(props: StatusLineProps): ReactElement {
  const symbols = glyphs(props.capabilities);
  if (!props.busy) {
    return (
      <Text color={props.theme.dim}>
        ● 就绪 · {props.model} · /help 帮助
      </Text>
    );
  }
  const spinner = symbols.spinner[props.frame % symbols.spinner.length] ?? symbols.spinner[0];
  return (
    <Text color={props.theme.accent}>
      {spinner} {props.action} · step {props.step} · {props.tokens} tok · ${props.costUsd.toFixed(3)}
      {props.queued > 0 ? ` · +${props.queued} 已排队` : ''} · esc 中断
    </Text>
  );
}
