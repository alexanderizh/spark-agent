export type MarkdownBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'code'; lang: string; code: string }
  | { kind: 'incomplete_code'; lang: string; code: string }
  | { kind: 'quote'; text: string }
  | { kind: 'list'; ordered: boolean; items: Array<{ text: string; checked?: boolean }> }
  | { kind: 'table'; headers: string[]; rows: string[][] }
  | { kind: 'hr' }

export function parseMarkdown(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (!line.trim()) {
      index += 1
      continue
    }

    const fence = line.match(/^```([A-Za-z0-9_-]*)\s*$/)
    if (fence) {
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !/^```\s*$/.test(lines[index] ?? '')) {
        codeLines.push(lines[index] ?? '')
        index += 1
      }
      if (index < lines.length) {
        // Found closing ```
        index += 1
        blocks.push({ kind: 'code', lang: fence[1] ?? '', code: codeLines.join('\n') })
      } else {
        // No closing ``` found — incomplete code block (streaming)
        blocks.push({ kind: 'incomplete_code', lang: fence[1] ?? '', code: codeLines.join('\n') })
      }
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      blocks.push({ kind: 'heading', level: (heading[1] ?? '').length, text: heading[2] ?? '' })
      index += 1
      continue
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ kind: 'hr' })
      index += 1
      continue
    }

    const quote = line.match(/^>\s?(.*)$/)
    if (quote) {
      const quoteLines: string[] = []
      while (index < lines.length) {
        const match = (lines[index] ?? '').match(/^>\s?(.*)$/)
        if (!match) break
        quoteLines.push(match[1] ?? '')
        index += 1
      }
      blocks.push({ kind: 'quote', text: quoteLines.join('\n') })
      continue
    }

    const listMatch = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.+)$/)
    if (listMatch) {
      const ordered = /\d+[.)]/.test(listMatch[2] ?? '')
      const items: Array<{ text: string; checked?: boolean }> = []
      while (index < lines.length) {
        const match = (lines[index] ?? '').match(/^(\s*)([-*+]|\d+[.)])\s+(.+)$/)
        if (!match || /\d+[.)]/.test(match[2] ?? '') !== ordered) break
        const itemText = match[3] ?? ''
        const task = itemText.match(/^\[([ xX])]\s+(.*)$/)
        items.push(
          task
            ? { text: task[2] ?? '', checked: (task[1] ?? '').toLowerCase() === 'x' }
            : { text: itemText },
        )
        index += 1
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }

    if (
      line.includes('|') &&
      index + 1 < lines.length &&
      /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1] ?? '')
    ) {
      const headers = splitTableRow(line)
      const rows: string[][] = []
      index += 2
      while (
        index < lines.length &&
        (lines[index] ?? '').includes('|') &&
        (lines[index] ?? '').trim()
      ) {
        rows.push(splitTableRow(lines[index] ?? ''))
        index += 1
      }
      blocks.push({ kind: 'table', headers, rows })
      continue
    }

    const paragraphLines = [line]
    index += 1
    while (
      index < lines.length &&
      (lines[index] ?? '').trim() &&
      !/^```/.test(lines[index] ?? '') &&
      !/^(#{1,6})\s+/.test(lines[index] ?? '') &&
      !/^(\s*)([-*+]|\d+[.)])\s+/.test(lines[index] ?? '') &&
      !/^>\s?/.test(lines[index] ?? '') &&
      !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[index] ?? '')
    ) {
      paragraphLines.push(lines[index] ?? '')
      index += 1
    }
    blocks.push({ kind: 'paragraph', text: paragraphLines.join('\n') })
  }

  return blocks
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

