import type {
  AgentEvent,
  CanvasMediaTaskInputFile,
  CanvasPromptTaskFields,
} from '@spark/protocol'
import { composeCanvasMediaProviderPrompt } from '@spark/protocol'
import { createLogger } from '@spark/shared'
import { statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, isAbsolute } from 'node:path'

const log = createLogger('canvas-prompt-runtime')

export type CanvasRuntimeRequest = {
  prompt: string
  system: string
  images: Array<{ url?: string; dataUrl?: string; mimeType?: string }>
  relationManifest: CanvasPromptTaskFields['relationManifest']
}

export type CanvasAgentTurnPollResult = {
  terminal: boolean
  text?: string
  error?: string
}

/**
 * Select output for a background SessionService turn.
 * Intermediate Codex messages can be mode=complete while the turn is still running;
 * only isFinal is authoritative before a terminal status arrives.
 */
export function resolveCanvasAgentTurnResult(events: AgentEvent[]): CanvasAgentTurnPollResult {
  const terminalError = events.find((event) => event.type === 'agent_error')
  if (terminalError?.type === 'agent_error') {
    return { terminal: true, error: terminalError.message }
  }

  const assistantMessages = events.filter(
    (event): event is Extract<AgentEvent, { type: 'assistant_message' }> =>
      event.type === 'assistant_message' &&
      event.mode === 'complete' &&
      event.content.trim().length > 0,
  )
  let finalMessage: Extract<AgentEvent, { type: 'assistant_message' }> | undefined
  for (let index = assistantMessages.length - 1; index >= 0; index -= 1) {
    const candidate = assistantMessages[index]
    if (candidate?.isFinal === true) {
      finalMessage = candidate
      break
    }
  }
  if (finalMessage != null) return { terminal: true, text: finalMessage.content }

  let terminalStatus: Extract<AgentEvent, { type: 'agent_status' }> | undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const candidate = events[index]
    if (
      candidate?.type === 'agent_status' &&
      (candidate.status === 'completed' ||
        candidate.status === 'cancelled' ||
        candidate.status === 'error')
    ) {
      terminalStatus = candidate
      break
    }
  }
  if (terminalStatus == null) return { terminal: false }
  if (terminalStatus.status !== 'completed') {
    return {
      terminal: true,
      error: terminalStatus.message || `本地 Agent 状态：${terminalStatus.status}`,
    }
  }
  const fallback = assistantMessages.at(-1)
  return {
    terminal: true,
    ...(fallback != null ? { text: fallback.content } : {}),
  }
}

export function buildCanvasSystemPrompt(input: {
  capabilityPrompt?: string
  presetPrompt?: string
  agentPrompt?: string
  skillPrompts?: string[]
  negativePrompt?: string
}): string {
  const sections = [
    input.agentPrompt,
    ...(input.skillPrompts && input.skillPrompts.length > 0
      ? [`[Selected Skills]\n${input.skillPrompts.filter((item) => item.trim()).join('\n\n')}`]
      : []),
    input.presetPrompt,
    // Functional capability contracts come last so an agent persona or selected
    // skill cannot silently replace a required output schema.
    input.capabilityPrompt,
    input.negativePrompt?.trim() ? `约束（不可违反）：${input.negativePrompt.trim()}` : undefined,
  ]
  return sections
    .map((section) => section?.trim())
    .filter((section): section is string => Boolean(section))
    .join('\n\n')
}

export function buildCanvasRuntimeRequest(input: {
  prompt?: string
  inputFiles?: CanvasMediaTaskInputFile[]
} & CanvasPromptTaskFields): CanvasRuntimeRequest {
  const images = (input.inputFiles ?? [])
    .filter((file) => file.type === 'image')
    .map((file) => ({
      ...(file.url != null ? { url: file.url } : {}),
      ...(file.dataUrl != null ? { dataUrl: file.dataUrl } : {}),
      ...(file.mimeType != null ? { mimeType: file.mimeType } : {}),
    }))
    .filter((image) => image.url != null || image.dataUrl != null)
  return {
    prompt: (input.compiledUserText ?? input.prompt ?? '').trim(),
    system: input.systemPrompt?.trim() ?? '',
    images,
    relationManifest: input.relationManifest ?? [],
  }
}

export function buildCanvasMediaProviderPrompt(input: {
  systemPrompt?: string
  userPrompt: string
}): string {
  return composeCanvasMediaProviderPrompt(input)
}

/** 按扩展名推断 vision 输入 MIME；快速创建/画布输入拷贝只覆盖常见位图格式。 */
const VISION_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/** 单张本地图片读入内存的上限（与快速创建 72MB 输入限制解耦，防极端大图撑爆请求体）。 */
const VISION_IMAGE_MAX_BYTES = 30 * 1024 * 1024

/**
 * `safe-file://<base64url(绝对路径)>` → 绝对路径。
 * 与 SafeFileProtocol.decodeSafeFileUrl 保持同一编码格式；此处内联轻量实现，
 * 避免 ipc 纯逻辑模块引入 electron 依赖链（vitest node 环境无法加载）。
 */
function decodeSafeFileUrl(url: string): string | null {
  if (!url.startsWith('safe-file://')) return null
  try {
    const rest = url.slice('safe-file://'.length)
    const slashIdx = rest.indexOf('/')
    if (slashIdx < 0) return null
    const base64 = rest
      .slice(slashIdx + 1)
      .replace(/-/g, '+')
      .replace(/_/g, '/')
    const padding = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4))
    const decoded = Buffer.from(base64 + padding, 'base64').toString('utf8')
    return decoded && isAbsolute(decoded) ? decoded : null
  } catch {
    return null
  }
}

function resolveVisionInputLocalPath(file: CanvasMediaTaskInputFile): string | null {
  const trimmedPath = file.path?.trim()
  if (trimmedPath) return trimmedPath
  if (file.url && file.url.startsWith('safe-file://')) return decodeSafeFileUrl(file.url)
  return null
}

/**
 * 把画布文本任务的输入图片归一化为上游 vision 接口可用的形态。
 *
 * 快速创建/画布提交的 inputFiles 只有本地 `path` 与渲染端展示用的 `safe-file://`
 * URL，而 generateCanvasText 的 Anthropic/OpenAI 图片转换只认 `http(s)://` 公网
 * URL 与 `data:` base64——此前 safe-file URL 会被静默丢弃（Anthropic）或原样发给
 * 上游导致不可达（OpenAI），表现为「图片反推没有把图片发给模型」。
 * 这里把本地文件读成 base64 dataUrl，保证 HTTP 直连路径真正携带图片。
 */
export async function resolveCanvasRuntimeImages(input: {
  inputFiles?: CanvasMediaTaskInputFile[]
}): Promise<CanvasRuntimeRequest['images']> {
  const images: CanvasRuntimeRequest['images'] = []
  let localCount = 0
  let localBytes = 0
  for (const file of input.inputFiles ?? []) {
    if (file.type !== 'image') continue
    if (file.url && /^https?:\/\//i.test(file.url)) {
      images.push({ url: file.url })
      continue
    }
    if (file.dataUrl?.startsWith('data:')) {
      images.push({
        ...(file.mimeType != null ? { mimeType: file.mimeType } : {}),
        dataUrl: file.dataUrl,
      })
      continue
    }
    const localPath = resolveVisionInputLocalPath(file)
    if (!localPath) {
      log.warn(
        `vision input skipped (no resolvable source), name=${file.path ?? file.url ?? '(unnamed)'}`,
      )
      continue
    }
    let bytes: Buffer
    try {
      const stat = statSync(localPath)
      if (!stat.isFile()) throw new Error('不是文件')
      if (stat.size > VISION_IMAGE_MAX_BYTES) {
        throw new Error(
          `图片 ${(stat.size / 1024 / 1024).toFixed(1)}MB 超过单图 ${VISION_IMAGE_MAX_BYTES / 1024 / 1024}MB 上限`,
        )
      }
      bytes = await readFile(localPath)
    } catch (err) {
      throw new Error(
        `读取反推输入图片失败: ${localPath}（${err instanceof Error ? err.message : String(err)}）`,
        { cause: err },
      )
    }
    localCount += 1
    localBytes += bytes.byteLength
    const mimeType = file.mimeType ?? VISION_MIME_BY_EXT[extname(localPath).toLowerCase()]
    images.push({
      ...(mimeType ? { mimeType } : {}),
      dataUrl: `data:${mimeType ?? 'image/png'};base64,${bytes.toString('base64')}`,
    })
  }
  if (localCount > 0) {
    log.info(
      `vision inputs resolved, total=${images.length} local=${localCount} localBytes=${localBytes}`,
    )
  }
  return images
}
