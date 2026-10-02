/** 与 antd AutoComplete 的 filterOption 兼容的宽松选项结构，避免耦合 rc-select 内部类型。 */
export interface AutoCompleteOptionLike {
  value?: unknown
  label?: unknown
}

/** 调用方自己的候选匹配逻辑：query 已小写化。 */
export type AutoCompleteOptionMatcher = (query: string, option: AutoCompleteOptionLike) => boolean

/**
 * AutoComplete 受控 value 的回显缺陷：已选值会回填输入框并充当搜索词，
 * 重新展开下拉时按它过滤，候选会被筛得只剩已选项本身。
 * 本工厂在「搜索词恰好等于当前已选值（用户尚未输入新词）」时放行全部候选，
 * 一旦输入变化即恢复调用方传入的正常匹配逻辑。
 */
export function createEchoTolerantFilterOption(
  getSelectedValue: () => string,
  matches: AutoCompleteOptionMatcher,
): (input: string, option?: AutoCompleteOptionLike) => boolean {
  return (input, option) => {
    const query = String(input ?? '').toLowerCase()
    if (query !== '' && query === String(getSelectedValue() ?? '').toLowerCase()) return true
    if (option == null) return false
    return matches(query, option)
  }
}

/** 常用匹配：value 或 label 任一包含搜索词即命中（大小写不敏感）。 */
export function matchesValueOrLabel(query: string, option: AutoCompleteOptionLike): boolean {
  return [option.value, option.label].some((candidate) =>
    String(candidate ?? '')
      .toLowerCase()
      .includes(query),
  )
}
