import { describe, expect, it } from 'vitest'
import { ATTACHMENT_ONLY_TEXT, toReusableDraft } from './remoteMessageReuse'

describe('toReusableDraft', () => {
  it('普通正文原样返回（保留缩进与换行，用户可能靠它排版提示词）', () => {
    const text = '第一行\n  第二行带缩进'
    expect(toReusableDraft(text)).toBe(text)
  })

  it('纯附件消息的占位正文回填成空草稿', () => {
    expect(ATTACHMENT_ONLY_TEXT).toBe('\u200B请查看附件')
    expect(toReusableDraft(ATTACHMENT_ONLY_TEXT)).toBe('')
  })

  it('占位文本与正文混在一起时只去掉占位', () => {
    expect(toReusableDraft(`${ATTACHMENT_ONLY_TEXT}\n看下这张图`)).toBe('看下这张图')
  })

  it('用户手写的「请查看附件」（无零宽标记）不被误删', () => {
    expect(toReusableDraft('请查看附件里的第二页')).toBe('请查看附件里的第二页')
  })
})
