export interface TerminalCapabilities {
  readonly color: 'truecolor' | '256' | '16' | 'mono'
  readonly unicode: boolean
  readonly width: number
}

export interface TuiTheme {
  readonly fg?: string
  readonly dim: string
  readonly accent: string
  readonly ok: string
  readonly warn: string
  readonly error: string
}

export interface TuiGlyphs {
  readonly brand: string
  readonly user: string
  readonly bullet: string
  readonly bar: string
  readonly tool: string
  readonly success: string
  readonly failure: string
  readonly pending: string
  readonly divider: string
  readonly spinner: readonly string[]
}

// Warm terracotta accent over quiet grays, matching the visual language of
// first-class terminal agents (Claude Code / opencode): chrome stays dim,
// content stays bright, one accent carries the brand and the busy state.
export const defaultTheme: TuiTheme = {
  dim: 'gray',
  accent: '#d97757',
  ok: '#46c46a',
  warn: '#d6a235',
  error: '#e5534b',
}

export function detectTerminalCapabilities(
  output: Pick<NodeJS.WriteStream, 'isTTY' | 'columns'> = process.stdout,
  environment: NodeJS.ProcessEnv = process.env,
): TerminalCapabilities {
  const mono =
    environment.NO_COLOR !== undefined ||
    environment.TERM === 'dumb' ||
    environment.CI === 'true' ||
    !output.isTTY
  const color = mono
    ? 'mono'
    : environment.COLORTERM === 'truecolor' || environment.COLORTERM === '24bit'
      ? 'truecolor'
      : environment.TERM?.includes('256color')
        ? '256'
        : '16'
  const locale = `${environment.LC_ALL ?? ''}${environment.LC_CTYPE ?? ''}${environment.LANG ?? ''}`
  return {
    color,
    unicode: !mono && /utf-?8/i.test(locale),
    width: output.columns ?? 80,
  }
}

export function glyphs(capabilities: TerminalCapabilities): TuiGlyphs {
  if (!capabilities.unicode) {
    return {
      brand: '*',
      user: '>',
      bullet: '>',
      bar: '|',
      tool: '+',
      success: 'v',
      failure: 'x',
      pending: '*',
      divider: '-',
      spinner: ['*', '+', 'x', '+'],
    }
  }
  return {
    brand: '✳',
    user: '❯',
    bullet: '●',
    bar: '▎',
    tool: '⏺',
    success: '✓',
    failure: '✗',
    pending: '◌',
    divider: '─',
    spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  }
}
