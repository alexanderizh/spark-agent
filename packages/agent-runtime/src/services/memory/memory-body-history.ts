/**
 * @module memory-body-history
 *
 * UPDATE 落库正文的 History 段合成（自动演化与候选确认共用口径）。
 *
 * 【审查修复】候选征集时正文必须保持无时间戳的稳定口径 —— 候选区以
 * content_digest（name+description+body 哈希）去重，同一冲突反复演化不
 * 累积候选票数依赖 body 稳定。History 段含确认时刻的时间戳，只能在真正
 * 落库（自动 updateEntry / confirmUpdate）时合成，不得进入征集暂存正文。
 */

/** 旧正文进入 History 摘录的字数上限（与原 buildEvolvedBody 口径一致）。 */
const HISTORY_EXCERPT_LIMIT = 500

/** History 段的段首标记（货币性比对按它剥离确认落库追加的尾段）。 */
const HISTORY_SECTION_MARKER = '\n\n## History\n'

/**
 * 在更新正文后追加旧正文的 History 摘录段；旧正文为空时原样返回
 * （无旧正文可记，不产生空段）。
 */
export function appendUpdateHistory(
  newBody: string,
  oldBody: string,
  updateName: string,
  stamp: string,
): string {
  if (oldBody.length === 0) return newBody
  const oldExcerpt = oldBody.slice(0, HISTORY_EXCERPT_LIMIT)
  return (
    `${newBody}${HISTORY_SECTION_MARKER}\n### ${stamp}（被 "${updateName}" 更新）\n` +
    `${oldExcerpt}${oldBody.length > HISTORY_EXCERPT_LIMIT ? ' …' : ''}`
  )
}

/**
 * 剥离正文末尾的 History 段（仅首个标记之前的内容）。update 候选确认落库
 * 时会追加 History；货币性比对需还原为确认时的暂存正文口径。仅剥首个
 * 标记：后续演化落库的新正文位于最前，早于任何 History 标记，剥首段后
 * 与暂存正文必不相等，从而正确判"过时"。
 */
export function stripTrailingHistorySection(body: string): string {
  const idx = body.indexOf(HISTORY_SECTION_MARKER)
  return idx === -1 ? body : body.slice(0, idx)
}
