/**
 * 远程消息「重新发送」的草稿还原（纯函数，便于单测）。
 *
 * 远程气泡里的内容是目标端事件的原文，直接回填输入区有两处要处理：
 *   1. 纯附件消息端上用 U+200B + 「请查看附件」占位（/turns 的 text 必填，空串会 400），
 *      回填时必须抹掉，否则会把占位句子当正文再发一次；
 *   2. 附件已经落在目标电脑上，回填时直接复用原路径即可，不必重新上传。
 */

/**
 * 纯附件消息的占位正文。
 *
 * 与小程序端同一约定：`/v1/sessions/:id/turns` 的 text 必填，纯图片消息用零宽字符 +
 * 提示语占位。桌面端远程输入区发送时也走这条。
 */
export const ATTACHMENT_ONLY_TEXT = '\u200B请查看附件'

/** 端上占位标记：出现零宽空格即认为是本应用塞的占位，不是用户手写 */
const ZERO_WIDTH_MARK = '\u200B'

/**
 * 消息正文 → 可直接回填输入框的草稿。
 * 普通正文原样返回（不做 trim：用户可能刻意用缩进/换行排版提示词）。
 */
export function toReusableDraft(text: string): string {
  if (!text.includes(ZERO_WIDTH_MARK)) return text
  return text
    .replace(/\u200B/g, '')
    .replace('请查看附件', '')
    .trim()
}
