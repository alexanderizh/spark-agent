import { describe, expect, it } from 'vitest'
import { REMOTE_CREATED_TITLE_SUFFIX, SESSION_TITLE_MAX_LENGTH } from '@spark/agent-runtime'
import { buildBridgeSessionTitle } from './mobile-bridge-session-title'

describe('buildBridgeSessionTitle', () => {
  it('没给标题时落可派生的占位 + 来源后缀', () => {
    expect(buildBridgeSessionTitle()).toBe(`新会话${REMOTE_CREATED_TITLE_SUFFIX}`)
    expect(buildBridgeSessionTitle('   ')).toBe(`新会话${REMOTE_CREATED_TITLE_SUFFIX}`)
    expect(buildBridgeSessionTitle(null)).toBe(`新会话${REMOTE_CREATED_TITLE_SUFFIX}`)
  })

  it('调用方给了标题就沿用并挂后缀', () => {
    expect(buildBridgeSessionTitle('修复登录闪退')).toBe(
      `修复登录闪退${REMOTE_CREATED_TITLE_SUFFIX}`,
    )
    expect(buildBridgeSessionTitle('  修复登录闪退  ')).toBe(
      `修复登录闪退${REMOTE_CREATED_TITLE_SUFFIX}`,
    )
  })

  it('后缀幂等：已经带了就不重复追加', () => {
    const once = buildBridgeSessionTitle('修复登录闪退')
    expect(buildBridgeSessionTitle(once)).toBe(once)
  })

  it('正文部分按字符截断，整体不超过标题上限', () => {
    const long = '把'.repeat(80)
    const title = buildBridgeSessionTitle(long)
    expect(title.endsWith(REMOTE_CREATED_TITLE_SUFFIX)).toBe(true)
    expect(Array.from(title).length).toBe(SESSION_TITLE_MAX_LENGTH)
  })

  it('emoji 不会被劈成半个代理对', () => {
    const title = buildBridgeSessionTitle('🚀'.repeat(60))
    expect(title.endsWith(REMOTE_CREATED_TITLE_SUFFIX)).toBe(true)
    expect(title).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
  })
})
