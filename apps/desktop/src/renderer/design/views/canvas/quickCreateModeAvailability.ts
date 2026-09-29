import { MODE_ITEMS } from './quickCreateTaskPresentation'
import type { QuickCreateMode } from './quickCreateTaskStore'

/**
 * 快速创作模式的「是否对外开放」开关。
 *
 * 音乐模式（music）的实现（能力锁定、任务存储、参数面板、文案）已经落地，但暂不放开，
 * 因此入口统一在这里收口，而不是到视图里删页签：
 * - 模式 rail 页签与任务历史筛选项只渲染对外开放的模式，两处共用同一份清单；
 * - 历史偏好里的模式、旧任务「复用」、深链等路径都会被收窄到对外开放的模式，
 *   不会出现「没有页签高亮，但表单停在音乐模式」的隐形入口。
 *
 * 放开音乐模式：把 DEFAULT_MUSIC_MODE_ENABLED 改成 true（或调用
 * setQuickCreateMusicModeEnabled(true) 做灰度），视图与筛选自动恢复，无需改调用方。
 */
const DEFAULT_MUSIC_MODE_ENABLED = false

let musicModeEnabled = DEFAULT_MUSIC_MODE_ENABLED

/** 音乐模式入口当前是否对外开放。 */
export function isQuickCreateMusicModeEnabled(): boolean {
  return musicModeEnabled
}

/**
 * 覆盖音乐模式入口开关（灰度 / 测试用）。
 * 运行中调用不会触发已挂载视图重渲染，请在挂载前（应用启动或测试 beforeEach）调用。
 */
export function setQuickCreateMusicModeEnabled(enabled: boolean): void {
  musicModeEnabled = enabled
}

/** 模式 → 对外开放开关；未列出的模式默认对外开放。 */
const MODE_RELEASE_GATES: Partial<Record<QuickCreateMode, () => boolean>> = {
  music: isQuickCreateMusicModeEnabled,
}

/** 该模式当前是否允许出现在界面上。 */
export function isQuickCreateModeAvailable(mode: QuickCreateMode): boolean {
  const gate = MODE_RELEASE_GATES[mode]
  return gate ? gate() : true
}

/** 对外开放的模式页签：模式 rail 与任务历史筛选共用，保证隐藏后两处口径一致。 */
export function quickCreateModeItems(): typeof MODE_ITEMS {
  return MODE_ITEMS.filter((item) => isQuickCreateModeAvailable(item.id))
}

/** 被隐藏模式回退到的默认模式。 */
export const DEFAULT_QUICK_CREATE_MODE: QuickCreateMode = 'image'

/** 把不可见模式（历史偏好 / 旧任务复用）收窄为对外开放的模式。 */
export function resolveAvailableQuickCreateMode(
  mode: QuickCreateMode | null | undefined,
): QuickCreateMode {
  return mode && isQuickCreateModeAvailable(mode) ? mode : DEFAULT_QUICK_CREATE_MODE
}
