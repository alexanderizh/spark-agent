import { beforeEach, describe, expect, it, vi } from 'vitest'

const updateTitle = vi.fn()
const getSession = vi.fn()

vi.mock('@spark/storage', () => ({
  SessionRepository: vi.fn(() => ({ get: getSession, updateTitle })),
}))
vi.mock('../session-title-generator.js', () => ({ generateSessionTitle: vi.fn(async () => null) }))
vi.mock('./session-title-target.js', () => ({
  resolveSessionTitleTarget: vi.fn(async () => ({ ok: false })),
}))

const { initializeCommandSessionTitle } = await import('./session-command-title-refinement.js')
const { REMOTE_CREATED_TITLE_SUFFIX } = await import('./session-pure-utils.js')

describe('initializeCommandSessionTitle：首轮命令命名', () => {
  beforeEach(() => {
    updateTitle.mockReset()
    getSession.mockReset()
  })

  it('远程创建的会话派生标题后保留「 · 远程创建」后缀', () => {
    getSession.mockReturnValue({ id: 's1', title: `新会话${REMOTE_CREATED_TITLE_SUFFIX}` })
    const onSessionRenamed = vi.fn()
    initializeCommandSessionTitle({
      db: {} as never,
      sessionId: 's1',
      userMessage: '改用表格展示',
      onSessionRenamed,
    })
    expect(updateTitle).toHaveBeenCalledWith('s1', `改用表格展示${REMOTE_CREATED_TITLE_SUFFIX}`)
    expect(onSessionRenamed).toHaveBeenCalledWith(
      's1',
      `改用表格展示${REMOTE_CREATED_TITLE_SUFFIX}`,
    )
  })

  it('普通占位会话照旧只写派生标题', () => {
    getSession.mockReturnValue({ id: 's1', title: '新会话' })
    initializeCommandSessionTitle({ db: {} as never, sessionId: 's1', userMessage: '改用表格展示' })
    expect(updateTitle).toHaveBeenCalledWith('s1', '改用表格展示')
  })

  it('用户手动改过名的会话不覆盖', () => {
    getSession.mockReturnValue({ id: 's1', title: '我自己起的名字' })
    initializeCommandSessionTitle({ db: {} as never, sessionId: 's1', userMessage: '改用表格展示' })
    expect(updateTitle).not.toHaveBeenCalled()
  })
})
