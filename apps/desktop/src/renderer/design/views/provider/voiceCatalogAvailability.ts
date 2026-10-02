import type { CanvasMediaModelSummary } from '@spark/protocol'

/**
 * 渠道是否具备「音色获取」的落点条件 —— 至少要有一个声明 `audio.speech` 的模型。
 *
 * 音色候选最终写进 `mediaDynamicParamOptions[manifestId][voiceParam]`，而它只对
 * **渠道自己声明的模型**生效（`resolveProfileMediaModels` 只吐渠道声明过的 manifest）。
 * 因此纯 ASR、音乐生成、视频这类渠道展示「音色获取」入口只会误导：点同步要么直接
 * 报错，要么把候选写进该渠道根本没启用的 manifest，界面报「同步成功」而画布 /
 * 快速创作里一个音色都看不到。
 *
 * 三态语义（不靠猜测下结论）：
 *   - 候选为空 → `true`：新建渠道、目录尚未加载时无从判定，保留入口，
 *     避免把唯一的配置路径藏掉；
 *   - 候选非空且含 `audio.speech` → `true`；
 *   - 候选非空且都不含 `audio.speech` → `false`。
 */
export function channelSupportsAudioSpeech(models: readonly CanvasMediaModelSummary[]): boolean {
  if (models.length === 0) return true
  return models.some((model) =>
    model.capabilities.some((capability) => capability.id === 'audio.speech'),
  )
}
