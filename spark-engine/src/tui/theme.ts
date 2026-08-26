export interface TerminalCapabilities {
  readonly color: 'truecolor' | '256' | '16' | 'mono';
  readonly unicode: boolean;
  readonly width: number;
}

export interface TuiTheme {
  readonly fg?: string;
  readonly dim: string;
  readonly accent: string;
  readonly ok: string;
  readonly warn: string;
  readonly error: string;
}

export interface TuiGlyphs {
  readonly user: string;
  readonly bar: string;
  readonly success: string;
  readonly failure: string;
  readonly pending: string;
  readonly divider: string;
  readonly spinner: readonly string[];
}

export const defaultTheme: TuiTheme = {
  dim: 'gray',
  accent: '#5cadff',
  ok: '#46c46a',
  warn: '#d6a235',
  error: '#e5534b',
};

export function detectTerminalCapabilities(
  output: Pick<NodeJS.WriteStream, 'isTTY' | 'columns'> = process.stdout,
  environment: NodeJS.ProcessEnv = process.env,
): TerminalCapabilities {
  const mono =
    environment.NO_COLOR !== undefined ||
    environment.TERM === 'dumb' ||
    environment.CI === 'true' ||
    !output.isTTY;
  const color = mono
    ? 'mono'
    : environment.COLORTERM === 'truecolor' || environment.COLORTERM === '24bit'
      ? 'truecolor'
      : environment.TERM?.includes('256color')
        ? '256'
        : '16';
  const locale = `${environment.LC_ALL ?? ''}${environment.LC_CTYPE ?? ''}${environment.LANG ?? ''}`;
  return {
    color,
    unicode: !mono && /utf-?8/i.test(locale),
    width: output.columns ?? 80,
  };
}

export function glyphs(capabilities: TerminalCapabilities): TuiGlyphs {
  if (!capabilities.unicode) {
    return {
      user: '>',
      bar: '|',
      success: 'v',
      failure: 'x',
      pending: '*',
      divider: '-',
      spinner: ['*', '+', 'x', '+'],
    };
  }
  return {
    user: '❯',
    bar: '▎',
    success: '✓',
    failure: '✗',
    pending: '◌',
    divider: '─',
    spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  };
}
