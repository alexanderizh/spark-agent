import type { FileSavePastedTextRequest, FileSavePastedTextResponse } from '@spark/protocol'
import type { ComposerAttachment, ComposerInputHandle } from './ChatComposerTypes'

/**
 * 粘贴纯文本超过该字符数时，自动落盘为持久 .txt 文件并以附件引用，
 * 避免超长文本铺平在输入区与消息气泡中。
 */
export const PASTED_TEXT_RESOURCE_THRESHOLD = 3000

/** chip 标题里摘要的最大长度（字符数，不含省略号） */
const SUMMARY_MAX_LENGTH = 20

/** 文件名前缀里摘要的最大长度（字符数）；比 chip 摘要更短，避免文件名过长 */
const FILE_NAME_SUMMARY_MAX_LENGTH = 16

type SavePastedTextFn = (req: FileSavePastedTextRequest) => Promise<FileSavePastedTextResponse>

type PlainTextPasteTarget = Pick<ComposerInputHandle, 'focus' | 'replaceSelection'>

/**
 * 右键「粘贴为文本」必须显式绕过自动转资源阈值。
 * Clipboard API 不可用时由调用方在阈值旁路保护中执行原生 paste，避免回退路径改变语义。
 */
export async function pasteClipboardTextAsPlainText(
  target: PlainTextPasteTarget,
  deps: { readClipboardText: () => Promise<string>; pasteNativelyWithThresholdBypass: () => void },
): Promise<void> {
  target.focus()
  try {
    target.replaceSelection(await deps.readClipboardText())
  } catch {
    deps.pasteNativelyWithThresholdBypass()
  }
}

/** 粘贴文本长度超过阈值时需要转为引用资源（等于阈值不转，保持普通插入）。 */
export function shouldConvertPastedTextToResource(text: string): boolean {
  return text.length > PASTED_TEXT_RESOURCE_THRESHOLD
}

/**
 * 取文本首个非空白行作为摘要，超长截断加省略号；整段空白返回空字符串。
 */
export function summarizePastedText(text: string, maxLength = SUMMARY_MAX_LENGTH): string {
  const firstMeaningfulLine =
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ''
  if (firstMeaningfulLine.length <= maxLength) return firstMeaningfulLine
  return `${firstMeaningfulLine.slice(0, maxLength)}…`
}

/** 千分位格式化字符数，如 8214 -> "8,214"。 */
export function formatCharCount(count: number): string {
  return count.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * 把摘要清洗成文件名安全片段：保留 Unicode 字母数字与 `._-`，
 * 其余字符折叠为连字符；空白结果返回空串（由调用方回退默认名）。
 */
export function sanitizeTextFileBaseName(summary: string): string {
  return summary.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '')
}

/**
 * 把粘贴的长文本落盘为 .txt 附件：
 * - 磁盘文件名携带可读摘要（消息气泡的附件名取自 basename，必须自解释）；
 * - 输入区 chip 的 name 额外显示字符数，如 `「收到。已将你的确认…」· 8,214 字符`。
 */
export async function buildPastedTextAttachment(
  text: string,
  deps: { savePastedText: SavePastedTextFn },
): Promise<ComposerAttachment> {
  const summary = summarizePastedText(text)
  const safeSummary = sanitizeTextFileBaseName(
    summary === '' ? '' : summarizePastedText(text, FILE_NAME_SUMMARY_MAX_LENGTH),
  )
  const result = await deps.savePastedText({
    text,
    suggestedBaseName: safeSummary === '' ? 'pasted-text' : `pasted-text-${safeSummary}`,
  })
  const displayName = summary === '' ? '粘贴文本' : summary
  return {
    id: `${Date.now()}-${result.filePath}`,
    type: 'file',
    path: result.filePath,
    name: `「${displayName}」· ${formatCharCount(text.length)} 字符`,
  }
}
