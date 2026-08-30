import { describe, expect, it } from 'vitest'
import {
  TELEGRAM_CALLBACK_DATA_LIMIT,
  buildRemoteErrorGuidance,
  buildRemoteSessionActions,
  filterTelegramCallbackActions,
  parseRemoteSessionFilter,
  resolveRemoteSelection,
  type RemoteSelectionRow,
} from './remote-command-utils.js'

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
    expect(parseRemoteSessionFilter(args)).toEqual({ status })
  })

  it('accepts Chinese status aliases', () => {
    expect(parseRemoteSessionFilter(['运行中'])).toEqual({ status: 'running' })
    expect(parseRemoteSessionFilter(['失败'])).toEqual({ status: 'error' })
  })

  it('rejects an incomplete status flag', () => {
    expect(parseRemoteSessionFilter(['--status'])).toEqual({
      error: '状态筛选格式：/sessions [all|idle|running|error]',
    })
  })

  it('rejects an unknown status', () => {
    expect(parseRemoteSessionFilter(['boom'])).toEqual({
      error: '状态筛选格式：/sessions [all|idle|running|error]',
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
})

describe('buildRemoteSessionActions', () => {
  it('emits session-id based switch commands, never sequence numbers', () => {
    const actions = buildRemoteSessionActions(sessionRows)
    const switchActions = actions.filter((action) => action.style === 'primary')
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
    const switchActions = actions.filter((action) => action.style === 'primary')
    expect(switchActions.map((action) => action.label)).toEqual([
      '切换 会话 A',
      '切换 会话 B',
      '切换 项目讨论',
    ])
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
    const switchActions = buildRemoteSessionActions(many).filter(
      (action) => action.style === 'primary',
    )
    expect(switchActions).toHaveLength(6)
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
})
