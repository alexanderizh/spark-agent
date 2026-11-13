/**
 * 会话标题派生：占位标题识别 + 远程创建后缀的保留。
 *
 * 背景：移动桥接建的会话原先固定叫「移动端会话」，既不在默认标题集合里、
 * 也不以「 会话」结尾，于是首轮 turn 的标题派生永远跳过 —— 移动端/远程视图
 * 里一屏同名。现在占位统一成「新会话」并挂「 · 远程创建」后缀，这里锁住
 * 「占位可派生」与「派生后后缀不丢」两条语义。
 */
import { describe, expect, it } from 'vitest'
import {
  REMOTE_CREATED_TITLE_SUFFIX,
  deriveSessionTitle,
  isRemoteCreatedTitle,
  shouldDeriveSessionTitle,
  shouldDeriveSessionTitleOrRemote,
  stripRemoteCreatedTitle,
  withRemoteCreatedTitleSuffix,
} from './session-pure-utils.js'

describe('远程创建标题后缀', () => {
  it('识别并剥离后缀', () => {
    expect(isRemoteCreatedTitle(`新会话${REMOTE_CREATED_TITLE_SUFFIX}`)).toBe(true)
    expect(isRemoteCreatedTitle('  新会话 · 远程创建  ')).toBe(true)
    expect(isRemoteCreatedTitle('新会话')).toBe(false)
    expect(isRemoteCreatedTitle(null)).toBe(false)

    expect(stripRemoteCreatedTitle(`修复登录闪退${REMOTE_CREATED_TITLE_SUFFIX}`)).toBe(
      '修复登录闪退',
    )
    expect(stripRemoteCreatedTitle('普通标题')).toBe('普通标题')
    expect(stripRemoteCreatedTitle(null)).toBe('')
  })

  it('带后缀的占位标题仍算可派生（这是修「一屏同名」的关键）', () => {
    expect(shouldDeriveSessionTitle(`新会话${REMOTE_CREATED_TITLE_SUFFIX}`)).toBe(false)
    expect(shouldDeriveSessionTitleOrRemote(`新会话${REMOTE_CREATED_TITLE_SUFFIX}`)).toBe(true)
  })

  it('旧占位「移动端会话」也算可派生（存量空会话能被首条消息救回来）', () => {
    expect(shouldDeriveSessionTitle('移动端会话')).toBe(true)
    expect(shouldDeriveSessionTitleOrRemote('移动端会话')).toBe(true)
  })

  it('用户手动起的名字不覆盖', () => {
    expect(shouldDeriveSessionTitleOrRemote('交易对账脚本')).toBe(false)
    expect(shouldDeriveSessionTitleOrRemote(`交易对账脚本${REMOTE_CREATED_TITLE_SUFFIX}`)).toBe(
      false,
    )
  })

  it('派生结果保留后缀', () => {
    expect(
      withRemoteCreatedTitleSuffix(
        `新会话${REMOTE_CREATED_TITLE_SUFFIX}`,
        deriveSessionTitle('帮我把远程会话列表的空态补一下'),
      ),
    ).toBe(`帮我把远程会话列表的空态补一下${REMOTE_CREATED_TITLE_SUFFIX}`)

    // 非远程会话原样返回
    expect(withRemoteCreatedTitleSuffix('新会话', '随便一个标题')).toBe('随便一个标题')
  })

  it('后缀幂等：派生结果本身已带后缀时不重复追加', () => {
    const once = withRemoteCreatedTitleSuffix(
      `新会话${REMOTE_CREATED_TITLE_SUFFIX}`,
      '修复登录闪退',
    )
    expect(withRemoteCreatedTitleSuffix(`新会话${REMOTE_CREATED_TITLE_SUFFIX}`, once)).toBe(
      `修复登录闪退${REMOTE_CREATED_TITLE_SUFFIX}`,
    )
  })

  it('空消息派生回落到「新会话」并仍带后缀', () => {
    expect(
      withRemoteCreatedTitleSuffix(
        `新会话${REMOTE_CREATED_TITLE_SUFFIX}`,
        deriveSessionTitle('   '),
      ),
    ).toBe(`新会话${REMOTE_CREATED_TITLE_SUFFIX}`)
  })
})
