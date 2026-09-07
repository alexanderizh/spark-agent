export interface TerminalCapabilities {
  readonly color: 'truecolor' | '256' | '16' | 'mono'
  readonly unicode: boolean
  readonly width: number
}

export interface TuiTheme {
  readonly fg?: string
  readonly dim: string
  readonly faint?: string
  readonly accent: string
  readonly accentStrong?: string
  readonly ok: string
  readonly warn: string
  readonly error: string
  /** Quiet separators used by flat panels and the status bar. */
  readonly line?: string
  /** Solid focus fill; only emitted on truecolor/256-color terminals. */
  readonly selectedBg?: string
  /** Bottom chrome fill; only emitted on truecolor/256-color terminals. */
  readonly chromeBg?: string
  /** User-message block background; terminals below 256 colors drop it. */
  readonly userBg?: string
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

// Industrial console palette: graphite surfaces carry the hierarchy while a
// single cool mint accent communicates focus and activity. Amber is reserved
// for warnings so selection and risk never compete for attention.
export const defaultTheme: TuiTheme = {
  fg: '#dce6ea',
  dim: '#7d8b94',
  faint: '#52606a',
  accent: '#55d6be',
  accentStrong: '#78ead4',
  ok: '#55d6be',
  warn: '#f0b35a',
  error: '#ff716c',
  line: '#293640',
  selectedBg: '#163a38',
  chromeBg: '#0a1015',
  userBg: '#16222c',
}

/** Rich fills become noisy or unreadable when terminals quantize below 256 colors. */
export function supportsRichBackground(capabilities: TerminalCapabilities | undefined): boolean {
  return capabilities?.color === 'truecolor' || capabilities?.color === '256'
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
