const HTML_RENDER_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/
const HOST_LABEL_HEX_LENGTH = 60

/** Create a stable, per-document capability-asset host without DNS label limits. */
export function buildHtmlRenderOriginHost(token: string): string {
  if (!HTML_RENDER_TOKEN_PATTERN.test(token)) {
    throw new Error('Invalid HTML render runtime token')
  }

  const hex = Array.from(token, (character) =>
    character.charCodeAt(0).toString(16).padStart(2, '0'),
  ).join('')
  const labels: string[] = []
  for (let index = 0; index < hex.length; index += HOST_LABEL_HEX_LENGTH) {
    labels.push(hex.slice(index, index + HOST_LABEL_HEX_LENGTH))
  }
  const first = labels.shift()
  if (first == null) throw new Error('Invalid HTML render runtime token')
  return `hr-${first}${labels.map((label) => `.${label}`).join('')}.html-render`
}
