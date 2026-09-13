function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function safeLink(href: string): string | null {
  try {
    const url = new URL(href)
    return ['http:', 'https:', 'mailto:', 'tel:', 'tg:'].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

function formatInlineMarkdown(text: string): string {
  const tokens: string[] = []
  const stash = (html: string): string => {
    const token = `\uE000${tokens.length}\uE001`
    tokens.push(html)
    return token
  }
  let formatted = text.replace(/`([^`\n]+)`/gu, (_match, code: string) =>
    stash(`<code>${escapeHtml(code)}</code>`),
  )
  formatted = formatted.replace(
    /\[([^\]\n]+)\]\(([^\s)]+)(?:\s+["'][^"']*["'])?\)/gu,
    (match, label: string, href: string) => {
      const target = safeLink(href)
      return target == null
        ? match
        : stash(`<a href="${escapeHtml(target)}">${escapeHtml(label)}</a>`)
    },
  )
  formatted = escapeHtml(formatted)
    .replace(/\*\*(\S(?:.*?\S)?)\*\*/gu, '<b>$1</b>')
    .replace(/~~(\S(?:.*?\S)?)~~/gu, '<s>$1</s>')
    .replace(/(?<!\*)\*(\S(?:.*?\S)?)\*(?!\*)/gu, '<i>$1</i>')

  return formatted.replace(
    /\uE000(\d+)\uE001/gu,
    (_match, index: string) => tokens[Number(index)] ?? '',
  )
}

/** Converts common GFM output to the safe HTML subset supported by Telegram Bot API. */
export function formatTelegramMarkdown(markdown: string): string {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n')
  const output: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const fence = line.match(/^\s*```([\w+-]*)\s*$/u)
    if (fence != null) {
      const code: string[] = []
      index += 1
      while (index < lines.length && !/^\s*```\s*$/u.test(lines[index] ?? '')) {
        code.push(lines[index] ?? '')
        index += 1
      }
      const language = fence[1]?.replace(/[^\w+-]/gu, '') ?? ''
      output.push(
        language.length > 0
          ? `<pre><code class="language-${language}">${escapeHtml(code.join('\n'))}</code></pre>`
          : `<pre>${escapeHtml(code.join('\n'))}</pre>`,
      )
      continue
    }
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+)$/u)
    if (heading != null) {
      output.push(`<b>${formatInlineMarkdown(heading[1] ?? '')}</b>`)
      continue
    }
    const quote = line.match(/^\s*>\s?(.*)$/u)
    if (quote != null) {
      output.push(`<blockquote>${formatInlineMarkdown(quote[1] ?? '')}</blockquote>`)
      continue
    }
    const bullet = line.match(/^\s*[-+*]\s+(.+)$/u)
    if (bullet != null) {
      output.push(`• ${formatInlineMarkdown(bullet[1] ?? '')}`)
      continue
    }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/u.test(line)) {
      output.push('────────')
      continue
    }
    output.push(formatInlineMarkdown(line))
  }
  return output.join('\n').trim()
}

export function isTelegramFormattingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /failed:\s*400\b.*(?:parse entities|unsupported start tag|can't find end tag)/iu.test(
    message,
  )
}
