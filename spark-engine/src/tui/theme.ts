export interface TerminalCapabilities {
  readonly color: 'truecolor' | '256' | '16' | 'mono'
  readonly unicode: boolean
  readonly width: number
  /** Terminal rows, available for the interactive full-screen viewport. */
  readonly height?: number
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
  /**
   * Token colors for code and diff rendering. Optional: themes written before
   * syntax highlighting keep working and fall back to {@link defaultCodePalette}.
   */
  readonly code?: TuiCodePalette
}

/**
 * Terminal code/diff token palette. Kept deliberately narrow — comments stay
 * quieter than body text and the two diff colors are the only saturated pair —
 * so dense code never competes with the mint status accent.
 */
export interface TuiCodePalette {
  readonly keyword: string
  readonly string: string
  readonly number: string
  readonly comment: string
  readonly type: string
  readonly added: string
  readonly removed: string
  readonly hunk: string
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
const defaultCodePalette: TuiCodePalette = {
  keyword: '#7fb0e8',
  string: '#b9d68f',
  number: '#e6b473',
  comment: '#5b6a73',
  type: '#78ead4',
  added: '#6fbf7f',
  removed: '#e0736f',
  hunk: '#c0a8ff',
}

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
  code: defaultCodePalette,
}

/** Resolves the code palette for a theme, tolerating themes that omit it. */
export function codePalette(theme: TuiTheme): TuiCodePalette {
  return { ...defaultCodePalette, ...theme.code }
}

/** Rich fills become noisy or unreadable when terminals quantize below 256 colors. */
export function supportsRichBackground(capabilities: TerminalCapabilities | undefined): boolean {
  return capabilities?.color === 'truecolor' || capabilities?.color === '256'
}

export function detectTerminalCapabilities(
  output: Pick<NodeJS.WriteStream, 'isTTY' | 'columns' | 'rows'> = process.stdout,
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
    ...(output.isTTY && output.rows !== undefined ? { height: output.rows } : {}),
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
    // Braille spinner frames render against the top of many terminal glyph
    // cells. Quarter-circle frames keep the same one-cell footprint while
    // staying visually centred beside the status copy.
    spinner: ['◒', '◐', '◓', '◑'],
  }
}
