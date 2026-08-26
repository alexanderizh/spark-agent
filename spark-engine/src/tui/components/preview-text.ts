/** Bounded plain-text preview used by cards that summarize long output. */
export function previewText(text: string, maxLines: number, maxWidth = 100): string {
  const lines = text.split('\n').slice(0, maxLines)
  const clipped = lines.map((line) =>
    Array.from(line).length > maxWidth ? `${Array.from(line).slice(0, maxWidth).join('')}…` : line,
  )
  const total = text.split('\n').length
  return total > maxLines ? `${clipped.join('\n')}\n… 共 ${total} 行` : clipped.join('\n')
}
