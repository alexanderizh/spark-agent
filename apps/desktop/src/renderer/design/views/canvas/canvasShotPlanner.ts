/**
 * 分镜自动切分（设计 §S6「按秒出分镜」）。
 *
 * 纯逻辑：把一段场次剧本文本按「对白时长 + 动作节拍 + 节奏基线」切成分镜草稿，
 * 每镜带预估时长（秒）。无 DOM/IPC，便于单测。
 *
 * 切分依据（设计 §3 P6）：
 * - 对白行：按朗读语速估时长（中文约 5 字/秒）。
 * - 动作/描述行：用节奏基线（pacingSecPerShot，默认 3 秒）。
 * - 统一夹到 [minSec, maxSec]，避免过短/过长。
 */

export type PlannedShot = {
  index: number
  title: string
  description: string
  dialogue?: string
  durationSec: number
}

/** 中文朗读默认语速（字/秒） */
export const DEFAULT_CHARS_PER_SEC = 5

/** 估算一段对白的朗读时长（秒），至少 1 秒 */
export function estimateSpeechDurationSec(
  text: string,
  charsPerSec = DEFAULT_CHARS_PER_SEC,
): number {
  const chars = text.replace(/\s+/g, '').length
  if (chars === 0) return 0
  return Math.max(1, chars / Math.max(1, charsPerSec))
}

/** 对白行解析：返回 { speaker?, line } 或 null（非对白） */
function parseDialogueLine(raw: string): { speaker?: string; line: string } | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  // 引号包裹：“...” 或 "..."
  const quoteMatch = trimmed.match(/[“"]([^”"]+)[”"]/)
  // 「角色：对白」或「角色:对白」（冒号前较短视为说话人）
  const colonMatch = trimmed.match(/^([^：:]{1,12})[：:]\s*(.+)$/)
  if (colonMatch && colonMatch[2]) {
    const speaker = colonMatch[1]?.trim()
    return { ...(speaker ? { speaker } : {}), line: colonMatch[2].trim() }
  }
  if (quoteMatch && quoteMatch[1]) {
    return { line: quoteMatch[1].trim() }
  }
  return null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 四舍五入到 0.5 秒 */
function roundHalf(value: number): number {
  return Math.round(value * 2) / 2
}

/**
 * 把场次剧本文本切成分镜草稿。
 * 以非空行为「节拍」单位：对白行按语速估时长，其余按节奏基线。
 */
export function planShotsFromScene(input: {
  sceneText: string
  pacingSecPerShot?: number
  minSec?: number
  maxSec?: number
  charsPerSec?: number
}): PlannedShot[] {
  const pacing = input.pacingSecPerShot && input.pacingSecPerShot > 0 ? input.pacingSecPerShot : 3
  const minSec = input.minSec && input.minSec > 0 ? input.minSec : 1.5
  const maxSec = input.maxSec && input.maxSec > 0 ? input.maxSec : 8
  const charsPerSec = input.charsPerSec ?? DEFAULT_CHARS_PER_SEC

  const lines = input.sceneText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const shots: PlannedShot[] = []
  for (const line of lines) {
    // 跳过场次标题行（【内/外景 …】或 场N）
    if (/^[【[]/.test(line) || /^场\s*[0-9零一二三四五六七八九十]+/.test(line)) continue
    const dialogue = parseDialogueLine(line)
    if (dialogue) {
      const duration = clamp(
        roundHalf(estimateSpeechDurationSec(dialogue.line, charsPerSec)),
        minSec,
        maxSec,
      )
      shots.push({
        index: shots.length + 1,
        title: `镜${shots.length + 1}${dialogue.speaker ? ` · ${dialogue.speaker}` : ''}`,
        description: dialogue.speaker ? `${dialogue.speaker} 说话` : '对白镜头',
        dialogue: dialogue.line,
        durationSec: duration,
      })
    } else {
      shots.push({
        index: shots.length + 1,
        title: `镜${shots.length + 1}`,
        description: line,
        durationSec: clamp(roundHalf(pacing), minSec, maxSec),
      })
    }
  }
  return shots
}

/** 分镜草稿总时长（秒） */
export function totalPlannedDurationSec(shots: PlannedShot[]): number {
  return roundHalf(shots.reduce((sum, shot) => sum + shot.durationSec, 0))
}
