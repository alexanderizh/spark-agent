/**
 * @module wiki-milestone-signals
 *
 * 里程碑触发的「交付 / 修复」信号识别（纯函数，零模型调用）。
 *
 * milestone 蒸馏的本地门槛第一道：本轮助手正文命中关键词表，或本轮产生了
 * 文件变更（fileChangeCount > 0），二者其一即视为交付信号。判定必须保持
 * 纯本地——任何模型调用都违背「触发特征门槛全部零成本」的方案约束。
 */

/** 交付 / 修复关键词表（大小写不敏感；中文无大小写，英文统一小写比较）。 */
export const WIKI_MILESTONE_DELIVERY_KEYWORDS: readonly string[] = [
  '完成',
  '已完成',
  '搞定',
  '已交付',
  '交付',
  '上线',
  '已上线',
  '已实现',
  '已修复',
  '修复完成',
  '验证通过',
  '测试通过',
  '构建成功',
  '已发布',
  '已合入',
  'done',
  'completed',
  'delivered',
  'shipped',
  'implemented',
  'fixed',
  'resolved',
  'deployed',
  'tests pass',
  'build succeeded',
  'verified',
]

/**
 * 助手正文是否命中交付信号。
 *
 * 关键词按「子串命中」判定：交付表述天然出现在正文收尾（"已修复 X，测试通过"），
 * 无需分词；短词（如 done / 完成）误命中只会多武装一次定时器，后续还有
 * minTurns / 防抖 / 间隔 / 日限四道护栏兜底。
 */
export function hasWikiMilestoneDeliverySignal(assistantTurnText: string): boolean {
  const haystack = assistantTurnText.toLowerCase()
  return WIKI_MILESTONE_DELIVERY_KEYWORDS.some((keyword) => haystack.includes(keyword))
}
