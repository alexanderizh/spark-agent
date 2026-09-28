/**
 * 时段问候语（早上好 / 下午好 / 晚上好）。
 *
 * 空会话 Hero 的问候语有两条来源：模型生成（主进程构造 prompt 时需要知道当前时段）
 * 与本地写死兜底（渲染端展示时需要同一时段前缀）。两侧必须共用同一套时段边界，
 * 否则会出现「模型正文说早上、兜底前缀说下午」的错位，故下沉到 @spark/shared
 * 单一实现，主进程与渲染进程共同引用。
 */

/** 时段问候语的三种取值。 */
export type DayPeriodGreeting = '早上好' | '下午好' | '晚上好'

/**
 * 按本地小时数给出时段问候。
 * 边界：05:00–11:59 早上；12:00–17:59 下午；其余（18:00–04:59）晚上。
 */
export function getLocalTimeGreeting(hour: number = new Date().getHours()): DayPeriodGreeting {
  if (hour >= 5 && hour < 12) return '早上好'
  if (hour >= 12 && hour < 18) return '下午好'
  return '晚上好'
}
