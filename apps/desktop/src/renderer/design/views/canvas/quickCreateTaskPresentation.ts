import type { CanvasMediaTaskAsset } from '@spark/protocol'
import { resolveMediaDisplayUrl } from './canvas-safe-file'
import type {
  QuickCreateMode,
  QuickCreateTaskRecord,
  QuickCreateTaskStatus,
} from './quickCreateTaskStore'

export const MODE_ITEMS: Array<{
  id: QuickCreateMode
  label: string
}> = [
  { id: 'image', label: '生图' },
  { id: 'reverse', label: '反推' },
  { id: 'video', label: '视频' },
  { id: 'audio', label: '语音' },
  { id: 'transcribe', label: '识别' },
]

export function modeLabel(mode: QuickCreateMode): string {
  return MODE_ITEMS.find((item) => item.id === mode)?.label ?? mode
}

const IMAGE_INPUT_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'heic', 'heif']
const VIDEO_INPUT_EXTENSIONS = ['mp4', 'mov', 'webm', 'm4v']
/** 语音识别模式可接收的音频文件扩展（覆盖常见压缩/无损封装与浏览器录音格式）。 */
const AUDIO_INPUT_EXTENSIONS = [
  'mp3',
  'wav',
  'm4a',
  'aac',
  'flac',
  'ogg',
  'opus',
  'aiff',
  'aif',
  'wma',
]

/** 拖拽来源可能是浏览器里拖出的图片 URL；只有磁盘绝对路径才能作为输入素材读取。 */
export function isLocalInputPath(filePath: string): boolean {
  return filePath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(filePath)
}

/**
 * 按模式过滤可接收的输入素材路径；视频模式额外接收视频文件，识别模式只接收音频文件。
 *
 * 语音（TTS）是纯文本输入，没有参考素材语义，这里返回空集合把住「文件选择」与
 * 「拖拽」两个入口（粘贴图片由视图层的 handlePasteInput 单独拦截）。
 */
export function selectQuickCreateInputPaths(
  filePaths: readonly string[],
  mode: QuickCreateMode,
): string[] {
  if (mode === 'audio') return []
  const extensions =
    mode === 'video'
      ? [...IMAGE_INPUT_EXTENSIONS, ...VIDEO_INPUT_EXTENSIONS]
      : mode === 'transcribe'
        ? AUDIO_INPUT_EXTENSIONS
        : IMAGE_INPUT_EXTENSIONS
  const pattern = new RegExp(`\\.(${extensions.join('|')})$`, 'i')
  return filePaths.filter((filePath) => isLocalInputPath(filePath) && pattern.test(filePath))
}

export function quickInputKindForPath(filePath: string): 'image' | 'video' | 'audio' {
  if (new RegExp(`\\.(${VIDEO_INPUT_EXTENSIONS.join('|')})$`, 'i').test(filePath)) return 'video'
  return new RegExp(`\\.(${AUDIO_INPUT_EXTENSIONS.join('|')})$`, 'i').test(filePath)
    ? 'audio'
    : 'image'
}

export function titleForPrompt(prompt: string, mode: QuickCreateMode): string {
  const firstLine = prompt
    .split(/\r?\n/)
    .find((line) => line.trim())
    ?.trim()
  // 识别任务提示词可选，为空时标题用音频文件名之外的通用兜底，避免出现「识别提示词」误导。
  return (
    firstLine?.slice(0, 40) ||
    `${modeLabel(mode)}${mode === 'audio' ? '文稿' : mode === 'transcribe' ? '任务' : '提示词'}`
  )
}

/**
 * 任务的文本类产物：识别任务的转写结果落在 text 资产（contentText），
 * 反推任务落在 task.text；这里统一取第一个非空来源，供输出面板与历史列表共用。
 */
export function taskTextOutput(
  task: Partial<Pick<QuickCreateTaskRecord, 'assets' | 'text'>>,
): string {
  // assets/text 均允许缺省：部分调用方（测试构造、旧记录）只带其中一字段。
  const fromAsset = (task.assets ?? []).find(
    (asset) =>
      asset.type === 'text' && typeof asset.contentText === 'string' && asset.contentText.trim(),
  )
  return fromAsset?.contentText ?? task.text ?? ''
}

/**
 * 重试成功任务时的新记录：任务存储对同 id 是替换语义，复用原 id 会把已有产物清空，
 * 因此必须换新 id 与创建时间；其余配置（提示词/素材/模型/参数）原样保留。
 */
export function retryTaskRecord(task: QuickCreateTaskRecord): QuickCreateTaskRecord {
  return {
    ...task,
    id: `quick-create-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  }
}

/**
 * 文本产物块的标题与复制成功提示：反推任务的产物本身就是提示词，
 * 标题、复制按钮与成功提示统一从这里取，避免各处写散。
 */
export function textOutputCopyMeta(mode: QuickCreateMode): { label: string; doneMessage: string } {
  if (mode === 'reverse') return { label: '反推提示词', doneMessage: '反推提示词已复制' }
  if (mode === 'transcribe') return { label: '转写文本', doneMessage: '转写文本已复制' }
  return { label: '文本输出', doneMessage: '文本输出已复制' }
}

/** 一键复制提示词的按钮文案、成功提示与待复制文本。 */
export type TaskPromptCopy = {
  label: string
  doneMessage: string
  text: string
}

/**
 * 取任务内「可一键复制的提示词」。
 *
 * 反推任务（image_prompt_reverse）的产物就是提示词本身（task.text），用户填写的
 * 只是可选的补充要求，因此反推优先复制产物；产物未回来时才退回补充要求，
 * 两者都没有则返回 null，由调用方决定是否渲染复制入口。
 */
export function copyableTaskPrompt(
  // text/assets 允许缺省（产物未回来、旧记录、测试构造），与 taskTextOutput 的宽入参一致。
  task: Pick<QuickCreateTaskRecord, 'mode' | 'prompt'> &
    Partial<Pick<QuickCreateTaskRecord, 'text' | 'assets'>>,
): TaskPromptCopy | null {
  const prompt = task.prompt.trim()
  // 反推与识别的产物本身就是文本（反推提示词 / 转写文本），优先复制产物
  if (task.mode === 'reverse' || task.mode === 'transcribe') {
    const output = taskTextOutput(task).trim()
    const text = output || (task.mode === 'reverse' ? prompt : '')
    if (!text) return null
    return task.mode === 'reverse'
      ? { label: '复制反推提示词', doneMessage: '反推提示词已复制', text }
      : { label: '复制转写文本', doneMessage: '转写文本已复制', text }
  }
  return prompt ? { label: '复制提示词', doneMessage: '提示词已复制', text: prompt } : null
}

export function statusLabel(status: QuickCreateTaskStatus): string {
  return { running: '处理中', succeeded: '已完成', failed: '未完成', cancelled: '已取消' }[status]
}

export function taskOutputUrl(asset: CanvasMediaTaskAsset | undefined): string {
  return asset
    ? resolveMediaDisplayUrl({
        url: asset.url,
        filePath: asset.filePath,
        dataUrl: asset.previewDataUrl,
      })
    : ''
}

/**
 * 取任务产物中第一张可显示的图片作为提示词封面。
 *
 * 封面 URL 与产物缩略图同源（磁盘路径优先编码为 safe-file://，避免把大段
 * base64 持久化进设置存储）；纯视频/音频任务没有图片产物，返回 null 表示无封面。
 */
export function promptCoverFromTaskAssets(
  assets: readonly CanvasMediaTaskAsset[],
): { url: string; mimeType: string } | null {
  for (const asset of assets) {
    if (asset.type !== 'image') continue
    const url = taskOutputUrl(asset)
    if (!url) continue
    const dataUrlMime = /^data:(image\/[\w.+-]+)/i.exec(url)?.[1]
    const mimeType =
      asset.mimeType && /^image\//i.test(asset.mimeType)
        ? asset.mimeType
        : (dataUrlMime ?? 'image/png')
    return { url, mimeType }
  }
  return null
}
