import { Text } from 'ink'
import type { ReactElement } from 'react'

import { diffLineKind, type DiffLine, type DiffLineKind } from '../diff.js'
import { tokenizeLine, type CodeLanguage, type CodeTokenKind } from '../syntax.js'
import { codePalette, type TuiTheme } from '../theme.js'

/** A styled run: plain text stays a string so the frame keeps its exact width. */
export type CodeSegment = string | ReactElement

/** Syntax-highlighted runs for one code line, in source order. */
export function codeSegments(text: string, language: CodeLanguage, theme: TuiTheme): CodeSegment[] {
  return tokenizeLine(text, language).map((token, index) => {
    const color = codeColor(token.kind, theme)
    return color === undefined ? token.text : run(token.text, color, index)
  })
}

/** Token kind → theme color; `undefined` keeps the terminal's own foreground. */
export function codeColor(kind: CodeTokenKind, theme: TuiTheme): string | undefined {
  const palette = codePalette(theme)
  switch (kind) {
    case 'keyword':
      return palette.keyword
    case 'string':
      return palette.string
    case 'number':
      return palette.number
    case 'comment':
      return palette.comment
    case 'type':
      return palette.type
    default:
      return undefined
  }
}

/** Diff line kind → theme color; `undefined` keeps the default foreground. */
export function diffColor(kind: DiffLineKind, theme: TuiTheme): string | undefined {
  const palette = codePalette(theme)
  switch (kind) {
    case 'add':
      return palette.added
    case 'remove':
      return palette.removed
    case 'hunk':
      return palette.hunk
    case 'meta':
      return theme.dim
    case 'context':
      return undefined
  }
}

/** Colors one unified-diff line by its role. */
export function diffSegments(line: DiffLine, theme: TuiTheme): CodeSegment[] {
  const color = diffColor(line.kind, theme)
  if (color === undefined) return [line.text]
  return [run(line.text, color, 0, line.kind === 'hunk')]
}

/** Classifies raw diff text and returns its single styled run. */
export function diffTextSegments(text: string, theme: TuiTheme): CodeSegment[] {
  return diffSegments({ kind: diffLineKind(text), text }, theme)
}

function run(text: string, color: string, index: number, bold = false): ReactElement {
  return (
    <Text key={index} bold={bold} color={color}>
      {text}
    </Text>
  )
}

export type { DiffLine, DiffLineKind }
