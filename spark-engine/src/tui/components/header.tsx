import { Text } from 'ink';
import type { ReactElement } from 'react';

import type { TuiTheme } from '../theme.js';

export interface HeaderProps {
  readonly version: string;
  readonly model: string;
  readonly cwd: string;
  readonly sessionId: string;
  readonly width: number;
  readonly theme: TuiTheme;
}

export function Header({ version, model, cwd, sessionId, width, theme }: HeaderProps): ReactElement {
  const fixed = `spark v${version} · ${model} ·  · s:${sessionId.slice(0, 8)}`;
  const room = Math.max(8, width - fixed.length);
  const visibleCwd = cwd.length <= room ? cwd : `…${cwd.slice(-(room - 1))}`;
  return (
    <Text color={theme.dim} dimColor>
      spark v{version} · {model} · {visibleCwd} · s:{sessionId.slice(0, 8)}
    </Text>
  );
}
