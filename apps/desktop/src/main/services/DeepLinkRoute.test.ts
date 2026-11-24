import { describe, expect, it } from 'vitest'
import { findDeepLinkRoute, parseDeepLinkRoute } from './DeepLinkRoute.js'

const STATE = 'a'.repeat(64)

describe('deep link routes', () => {
  it('extracts an encoded redemption code from app launch arguments', () => {
    expect(
      findDeepLinkRoute([
        '/Applications/Spark Agent.app',
        'spark-agent://redeem?code=SPARK-CODE-123',
      ]),
    ).toEqual({ kind: 'redeem', code: 'SPARK-CODE-123' })
  })

  it('rejects unrelated schemes, routes, and unsafe redeem codes', () => {
    expect(parseDeepLinkRoute('https://redeem?code=secret')).toBeNull()
    expect(parseDeepLinkRoute('spark-agent://settings?code=secret')).toBeNull()
    expect(parseDeepLinkRoute('spark-agent://redeem?code=line%0Abreak')).toBeNull()
  })

  it('extracts the state from a desktop auth callback link', () => {
    expect(parseDeepLinkRoute(`spark-agent://auth-callback?state=${STATE}`)).toEqual({
      kind: 'auth-callback',
      state: STATE,
    })
  })

  it('rejects auth callback links without a well-formed state', () => {
    expect(parseDeepLinkRoute('spark-agent://auth-callback')).toBeNull()
    expect(parseDeepLinkRoute('spark-agent://auth-callback?state=')).toBeNull()
    expect(parseDeepLinkRoute('spark-agent://auth-callback?state=short')).toBeNull()
    expect(parseDeepLinkRoute(`spark-agent://auth-callback?state=${'Z'.repeat(64)}`)).toBeNull()
    // 内嵌换行（trim 无法消除）必须被拒绝
    expect(
      parseDeepLinkRoute(`spark-agent://auth-callback?state=${'a'.repeat(32)}%0A${'b'.repeat(32)}`),
    ).toBeNull()
  })

  it('never carries credentials in the auth callback link', () => {
    const route = parseDeepLinkRoute(`spark-agent://auth-callback?state=${STATE}&token=leaked`)
    expect(route).toEqual({ kind: 'auth-callback', state: STATE })
    expect(JSON.stringify(route)).not.toContain('leaked')
  })

  it('returns the first recognised route in an argument list', () => {
    expect(
      findDeepLinkRoute([
        '--flag',
        'spark-agent://nope',
        `spark-agent://auth-callback?state=${STATE}`,
      ]),
    ).toEqual({
      kind: 'auth-callback',
      state: STATE,
    })
    expect(findDeepLinkRoute(['--flag'])).toBeNull()
  })

  it('honours the dev package scheme only when it is the configured scheme', () => {
    const devLink = 'spark-agent-dev://redeem?code=SPARK-CODE-123'
    // 默认（生产）scheme 下，dev 链接与其他陌生协议一样被忽略
    expect(parseDeepLinkRoute(devLink)).toBeNull()
    expect(findDeepLinkRoute([devLink])).toBeNull()
    expect(parseDeepLinkRoute(devLink, 'spark-agent-dev')).toEqual({
      kind: 'redeem',
      code: 'SPARK-CODE-123',
    })
    expect(findDeepLinkRoute(['--flag', devLink], 'spark-agent-dev')).toEqual({
      kind: 'redeem',
      code: 'SPARK-CODE-123',
    })
  })

  it('stops responding to the production scheme once the dev scheme is configured', () => {
    // dev 打包产物与生产安装包抢同一条 deep link 的根因就在这里
    expect(
      parseDeepLinkRoute('spark-agent://redeem?code=SPARK-CODE-123', 'spark-agent-dev'),
    ).toBeNull()
    expect(
      parseDeepLinkRoute(`spark-agent://auth-callback?state=${STATE}`, 'spark-agent-dev'),
    ).toBeNull()
  })

  it('fails closed on a malformed scheme override', () => {
    for (const scheme of ['', 'spark agent', 'Spark-Agent', 'spark-agent:', 'a/b']) {
      expect(parseDeepLinkRoute('spark-agent://redeem?code=SPARK-CODE-123', scheme)).toBeNull()
    }
  })
})
