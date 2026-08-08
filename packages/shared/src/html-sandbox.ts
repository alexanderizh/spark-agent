export const MAX_HTML_RENDER_LENGTH = 200_000
export const MAX_HTML_RENDER_TITLE_LENGTH = 60
export const MIN_HTML_RENDER_HEIGHT = 120
export const MAX_HTML_RENDER_HEIGHT = 640
export const DEFAULT_HTML_RENDER_HEIGHT = 320

export type HtmlRenderTheme = 'light' | 'dark'

export type HtmlViewerPayload = {
  html: string
  title: string
  theme: HtmlRenderTheme
}

const HTML_RENDER_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"

const FORBIDDEN_HTML_TAG_PATTERN = /<(iframe|form|object|embed|base)\b/i
const EXTERNAL_RESOURCE_PATTERN = /(?:src|href)\s*=\s*["']\s*https?:\/\//i

export function validateHtmlViewerPayload(
  value: unknown,
): { ok: true; payload: HtmlViewerPayload } | { ok: false; reason: string } {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'HTML viewer payload must be an object' }
  }
  const input = value as Record<string, unknown>
  const html = input.html
  if (typeof html !== 'string' || html.trim().length === 0) {
    return { ok: false, reason: 'HTML content must be a non-empty string' }
  }
  if (html.length > MAX_HTML_RENDER_LENGTH) {
    return {
      ok: false,
      reason: `HTML content must not exceed ${MAX_HTML_RENDER_LENGTH} characters`,
    }
  }
  const title = input.title
  if (
    title !== undefined &&
    (typeof title !== 'string' || title.length > MAX_HTML_RENDER_TITLE_LENGTH)
  ) {
    return {
      ok: false,
      reason: `HTML title must not exceed ${MAX_HTML_RENDER_TITLE_LENGTH} characters`,
    }
  }
  const height = input.height
  if (
    height !== undefined &&
    (typeof height !== 'number' ||
      !Number.isInteger(height) ||
      height < MIN_HTML_RENDER_HEIGHT ||
      height > MAX_HTML_RENDER_HEIGHT)
  ) {
    return {
      ok: false,
      reason: `HTML height must be an integer between ${MIN_HTML_RENDER_HEIGHT} and ${MAX_HTML_RENDER_HEIGHT}`,
    }
  }
  if (FORBIDDEN_HTML_TAG_PATTERN.test(html)) {
    return {
      ok: false,
      reason: 'HTML content cannot contain iframe, form, object, embed, or base tags',
    }
  }
  const theme = input.theme === 'dark' ? 'dark' : 'light'
  return {
    ok: true,
    payload: {
      html,
      title: typeof title === 'string' && title.trim().length > 0 ? title.trim() : 'HTML 内容',
      theme,
    },
  }
}

export function findHtmlExternalResourceWarning(html: string): string | null {
  return EXTERNAL_RESOURCE_PATTERN.test(html) ? '检测到外部资源引用，沙盒 CSP 将阻止网络加载' : null
}

export function buildSandboxedHtml(html: string, theme: HtmlRenderTheme): string {
  const head = `<meta http-equiv="Content-Security-Policy" content="${HTML_RENDER_CSP}"><meta name="color-scheme" content="${theme}"><style>html,body{min-height:100%;margin:0}html{color-scheme:${theme}}body{box-sizing:border-box;overflow:auto}</style>`
  const documentMatch = html.match(/<html(?:\s[^>]*)?>/i)
  if (documentMatch != null) {
    const documentIndex = documentMatch.index ?? 0
    const htmlTag = documentMatch[0].includes('data-spark-theme=')
      ? documentMatch[0]
      : documentMatch[0].replace(/^<html/i, `<html data-spark-theme="${theme}"`)
    const themedHtml = `${html.slice(0, documentIndex)}${htmlTag}${html.slice(documentIndex + documentMatch[0].length)}`
    const headMatch = themedHtml.match(/<head(?:\s[^>]*)?>/i)
    if (headMatch != null && headMatch.index != null) {
      const insertAt = headMatch.index + headMatch[0].length
      return `${themedHtml.slice(0, insertAt)}${head}${themedHtml.slice(insertAt)}`
    }
    const themedDocumentMatch = themedHtml.match(/<html(?:\s[^>]*)?>/i)
    const insertAt =
      themedDocumentMatch?.index != null
        ? themedDocumentMatch.index + themedDocumentMatch[0].length
        : documentIndex + documentMatch[0].length
    return `${themedHtml.slice(0, insertAt)}<head>${head}</head>${themedHtml.slice(insertAt)}`
  }
  return `<!doctype html><html data-spark-theme="${theme}"><head>${head}</head><body>${html}</body></html>`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function escapeScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
}

/**
 * The standalone window and system browser receive the same outer viewer:
 * untrusted markup is never the top-level document and always enters a sandboxed
 * iframe with an opaque origin.
 */
export function buildHtmlViewerDocument(payload: HtmlViewerPayload): string {
  const srcdoc = buildSandboxedHtml(payload.html, payload.theme)
  const serializedSrcdoc = escapeScriptJson(srcdoc)
  const title = escapeHtml(payload.title)
  return `<!doctype html><html data-spark-theme="${payload.theme}"><head><meta charset="utf-8"><meta name="color-scheme" content="${payload.theme}"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src 'self'; base-uri 'none'; form-action 'none'"><title>${title}</title><style>:root{color-scheme:${payload.theme};background:#fff;color:#20201d}*{box-sizing:border-box}html,body{height:100%;margin:0}body{display:flex;flex-direction:column;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:${payload.theme === 'dark' ? '#262626' : '#fdfdfc'};color:${payload.theme === 'dark' ? '#e4e4e7' : '#20201d'}}header{height:48px;display:flex;align-items:center;padding:0 16px;border-bottom:1px solid ${payload.theme === 'dark' ? '#3d3d3d' : '#e8e5df'};font-weight:600}iframe{display:block;flex:1;width:100%;min-height:0;border:0;background:transparent}</style></head><body><header>${title}</header><iframe id="spark-html-frame" title="${title}" sandbox="allow-scripts"></iframe><script>document.getElementById('spark-html-frame').srcdoc=${serializedSrcdoc};</script></body></html>`
}
