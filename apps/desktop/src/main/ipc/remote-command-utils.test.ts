import { describe, expect, it } from 'vitest'
import {
  buildRemoteProviderModelRows,
  TELEGRAM_CALLBACK_DATA_LIMIT,
  buildRemoteErrorGuidance,
  buildRemoteSelectionActions,
  buildRemoteSessionActions,
  defaultRemotePermissionMode,
  filterTelegramCallbackActions,
  formatRows,
  getRemotePermissionRows,
  paginateRemoteSelection,
  parseRemotePage,
  parseRemoteSessionFilter,
  resolveRemoteSelection,
  type RemoteSelectionRow,
} from './remote-command-utils.js'

describe('buildRemoteProviderModelRows', () => {
  it('only returns the current provider enabled models and removes duplicates', () => {
    expect(
      buildRemoteProviderModelRows({
        defaultModel: 'gpt-5.6-luna',
        modelIds: ['gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-luna', '  '],
      }),
    ).toEqual([
      { id: 'gpt-5.6-luna', label: 'gpt-5.6-luna', meta: '渠道默认' },
      { id: 'gpt-5.6-sol', label: 'gpt-5.6-sol' },
    ])
  })
})

const sessionRows: RemoteSelectionRow[] = [
  { id: 'sess-a', label: '会话 A' },
  { id: 'sess-b', label: '会话 B' },
  { id: 'sess-c', label: '项目讨论' },
]

describe('parseRemoteSessionFilter', () => {
  it.each([
    [['running'], 'running'],
    [['--status', 'error'], 'error'],
    [['-s', 'idle'], 'idle'],
    [['status=idle'], 'idle'],
    [['全部'], undefined],
    [[], undefined],
  ] as const)('parses %j as %s', (args, status) => {
    expect(parseRemoteSessionFilter(args)).toEqual({ status, page: undefined })
  })

  it('accepts Chinese status aliases', () => {
    expect(parseRemoteSessionFilter(['运行中'])).toEqual({ status: 'running', page: undefined })
    expect(parseRemoteSessionFilter(['失败'])).toEqual({ status: 'error', page: undefined })
  })

  it('parses status and pagination together', () => {
    expect(parseRemoteSessionFilter(['running', '3'])).toEqual({ status: 'running', page: 3 })
    expect(parseRemoteSessionFilter(['--status', 'idle', '--page', '2'])).toEqual({
      status: 'idle',
      page: 2,
    })
  })

  it('rejects an incomplete status flag', () => {
    expect(parseRemoteSessionFilter(['--status'])).toEqual({
      error: '格式：/sessions [all|idle|running|error] [页码]',
    })
  })

  it('rejects an unknown status', () => {
    expect(parseRemoteSessionFilter(['boom'])).toEqual({
      error: '格式：/sessions [all|idle|running|error] [页码]',
    })
  })
})

describe('resolveRemoteSelection', () => {
  const opts = { kindLabel: '会话', listCommand: '/sessions' }

  it('matches by exact id', () => {
    const result = resolveRemoteSelection('sess-b', sessionRows, opts)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.row.id).toBe('sess-b')
  })

  it('matches by exact name when unique', () => {
    const result = resolveRemoteSelection('会话 A', sessionRows, opts)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.row.id).toBe('sess-a')
  })

  it('matches by partial name when unique', () => {
    const result = resolveRemoteSelection('讨论', sessionRows, opts)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.row.id).toBe('sess-c')
  })

  it('reports a non-unique exact name', () => {
    const rows: RemoteSelectionRow[] = [
      { id: 'x1', label: 'dup' },
      { id: 'x2', label: 'dup' },
    ]
    const result = resolveRemoteSelection('dup', rows, opts)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.title).toBe('会话 名称不唯一')
      expect(result.text).toContain('x1')
      expect(result.text).toContain('x2')
    }
  })

  it('reports a non-unique partial match', () => {
    const rows: RemoteSelectionRow[] = [
      { id: 'x1', label: 'alpha-1' },
      { id: 'x2', label: 'alpha-2' },
    ]
    const result = resolveRemoteSelection('alpha', rows, opts)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.title).toBe('会话 匹配不唯一')
  })

  it('reports not found', () => {
    const result = resolveRemoteSelection('zzz', sessionRows, opts)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.title).toBe('未找到会话')
  })

  it('rejects empty input', () => {
    const result = resolveRemoteSelection('   ', sessionRows, opts)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.title).toBe('缺少会话')
  })

  it('resolves a sequence number against the cached list', () => {
    const result = resolveRemoteSelection('2', sessionRows, { ...opts, cachedRows: sessionRows })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.row.id).toBe('sess-b')
  })

  it('rejects an out-of-range sequence number against the cached list', () => {
    const result = resolveRemoteSelection('9', sessionRows, { ...opts, cachedRows: sessionRows })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.title).toBe('序号不存在')
      expect(result.text).toContain('1-3')
    }
  })

  it('treats sequence 0 as out of range', () => {
    const result = resolveRemoteSelection('0', sessionRows, { ...opts, cachedRows: sessionRows })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.title).toBe('序号不存在')
  })

  it('reports an expired sequence when no cache is present', () => {
    const result = resolveRemoteSelection('2', sessionRows, opts)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.title).toBe('序号已过期')
      expect(result.text).toContain('/sessions')
    }
  })
})

describe('formatRows', () => {
  it('keeps list output human-readable without exposing internal ids', () => {
    expect(
      formatRows(
        [
          { id: 'provider-secret-id', label: '主 Provider', meta: 'openai' },
          { id: 'provider-secret-id-2', label: '备用 Provider' },
        ],
        '暂无 Provider',
      ),
    ).toBe('1. 主 Provider · openai\n2. 备用 Provider')
  })
})

describe('remote selection pagination', () => {
  it('paginates rows and emits stable id-based navigation actions', () => {
    const rows = Array.from({ length: 8 }, (_, index) => ({
      id: `model-${index + 1}`,
      label: `模型 ${index + 1}`,
    }))
    const page = paginateRemoteSelection(rows, 2)
    expect(page).toMatchObject({ page: 2, totalPages: 2, total: 8 })
    expect(page.rows.map((row) => row.id)).toEqual(['model-7', 'model-8'])
    expect(
      buildRemoteSelectionActions(page.rows, {
        selectCommand: '/use-model',
        listCommand: '/models',
        page: page.page,
        totalPages: page.totalPages,
      }).map((action) => action.command),
    ).toEqual(['/use-model model-7', '/use-model model-8', '/models 1', '/models 2'])
  })

  it('parses a plain page number and rejects invalid pages', () => {
    expect(parseRemotePage(['2'], '/models [页码]')).toEqual({ page: 2 })
    expect(parseRemotePage(['0'], '/models [页码]')).toEqual({ error: '/models [页码]' })
  })
})

describe('remote permission choices', () => {
  it('defaults each runtime to its automatic approval mode', () => {
    expect(defaultRemotePermissionMode('claude-sdk')).toBe('claude-auto')
    expect(defaultRemotePermissionMode('codex')).toBe('codex-auto-review')
    expect(defaultRemotePermissionMode('spark')).toBe('spark-auto')
  })

  it('only presents permission modes supported by the active adapter', () => {
    expect(getRemotePermissionRows('codex').map((row) => row.id)).toEqual([
      'codex-default',
      'codex-auto-review',
      'codex-full-access',
    ])
  })
})

describe('buildRemoteErrorGuidance', () => {
  it('routes model/provider/token/quota errors to the model recovery path', () => {
    expect(buildRemoteErrorGuidance('provider returned 429')).toContain(
      '/providers → /models → /use-model <序号>',
    )
    expect(buildRemoteErrorGuidance('token expired')).toContain('/use-model <序号>')
    expect(buildRemoteErrorGuidance('模型不存在')).toContain('/use-model <序号>')
  })

  it('routes session errors to the session recovery path', () => {
    expect(buildRemoteErrorGuidance('session not found')).toContain('/sessions')
    expect(buildRemoteErrorGuidance('会话已结束')).toContain('/use-session')
  })

  it('falls back to /status and /help for unknown errors', () => {
    const text = buildRemoteErrorGuidance('unknown boom')
    expect(text).toContain('/status')
    expect(text).toContain('/help')
    // Generic branch mentions /use-model only as a soft hint, never the
    // ordered model-recovery chain that is unique to the model branch.
    expect(text).not.toContain('/use-model <序号>')
    expect(text).not.toContain('→ /models →')
  })

  it('does not misfire on lookalike substrings (word boundaries)', () => {
    // "remodel" must not match "model"; "tokenize" must not match "token".
    // Both must fall through to the generic branch, not the model branch.
    expect(buildRemoteErrorGuidance('remodel done')).not.toContain('/use-model <序号>')
    expect(buildRemoteErrorGuidance('failed to tokenize input')).not.toContain('/use-model <序号>')
    expect(buildRemoteErrorGuidance('remodel done')).toContain('/status')
  })

  it('uses the connection command prefix in recovery guidance', () => {
    const text = buildRemoteErrorGuidance('provider returned 429', '!')
    expect(text).toContain('!providers → !models → !use-model <序号>')
    expect(text).not.toContain('/providers')
  })
})

describe('buildRemoteSessionActions', () => {
  it('emits session-id based switch commands, never sequence numbers', () => {
    const actions = buildRemoteSessionActions(sessionRows)
    const switchActions = actions.slice(4)
    expect(switchActions).toHaveLength(3)
    expect(switchActions.map((action) => action.command)).toEqual([
      '/use-session sess-a',
      '/use-session sess-b',
      '/use-session sess-c',
    ])
    // No button may carry a bare sequence number — that was the切错会话 root cause.
    for (const action of switchActions) {
      expect(action.command).not.toMatch(/^\/use-session \d+$/)
    }
  })

  it('labels switch buttons with the session title', () => {
    const actions = buildRemoteSessionActions(sessionRows)
    expect(actions.slice(4).map((action) => action.label)).toEqual(['会话 A', '会话 B', '项目讨论'])
  })

  it('always prepends the status filter shortcuts', () => {
    const actions = buildRemoteSessionActions([])
    expect(actions.map((action) => action.command)).toEqual([
      '/sessions',
      '/sessions running',
      '/sessions idle',
      '/sessions error',
    ])
  })

  it('caps switch buttons at six entries', () => {
    const many = Array.from({ length: 8 }, (_, index) => ({
      id: `s${index}`,
      label: `会话${index}`,
    }))
    expect(buildRemoteSessionActions(many)).toHaveLength(10)
  })

  it('uses a custom command prefix for interactive buttons', () => {
    expect(buildRemoteSessionActions(sessionRows, '!')[0]?.command).toBe('!sessions')
    expect(buildRemoteSessionActions(sessionRows, '!')[4]?.command).toBe('!use-session sess-a')
  })
})

describe('filterTelegramCallbackActions', () => {
  it('keeps commands within the 64-byte limit and drops over-long ones', () => {
    const actions = [
      { label: 'ok', command: '/use-session 11111111-1111-1111-1111-111111111111' }, // 49 bytes
      { label: 'bad', command: `x`.repeat(65) },
    ]
    const filtered = filterTelegramCallbackActions(actions)
    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.label).toBe('ok')
  })

  it('uses the default limit constant and accepts a custom limit', () => {
    expect(TELEGRAM_CALLBACK_DATA_LIMIT).toBe(64)
    const actions = [
      { label: 'a', command: '12' },
      { label: 'b', command: '12345' },
    ]
    expect(filterTelegramCallbackActions(actions, 4)).toHaveLength(1)
  })

  it('returns an empty array when every command is too long (no silent truncation)', () => {
    const actions = [{ label: 'a', command: 'x'.repeat(100) }]
    expect(filterTelegramCallbackActions(actions)).toEqual([])
  })

  it('measures Telegram callback limits in UTF-8 bytes', () => {
    expect(filterTelegramCallbackActions([{ label: 'cn', command: '选'.repeat(22) }])).toEqual([])
  })
})
