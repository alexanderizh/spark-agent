import { describe, expect, it } from 'vitest'
import {
  diagnoseCodeEditor,
  formatCodeEditorDiagnostic,
  isReportableDiagnostic,
  type CodeEditorMarkerLike,
} from './codeEditorDiagnostics'
import { codeEditorHeightForRows } from './codeEditorLayout'
import { detectStructuredTextLanguage } from './structuredTextLanguage'

function marker(overrides: Partial<CodeEditorMarkerLike> = {}): CodeEditorMarkerLike {
  return {
    severity: 8,
    message: 'Unexpected token',
    startLineNumber: 1,
    startColumn: 1,
    ...overrides,
  }
}

describe('diagnoseCodeEditor', () => {
  it('reports the earliest JSON syntax error with the total count', () => {
    const summary = diagnoseCodeEditor('json', [
      marker({ startLineNumber: 7, message: 'Property keys must be doublequoted' }),
      marker({ startLineNumber: 3, startColumn: 5, message: 'Unexpected token }' }),
    ])
    expect(summary).not.toBeNull()
    expect(summary?.line).toBe(3)
    expect(summary?.column).toBe(5)
    expect(summary?.message).toBe('Unexpected token }')
    expect(summary?.total).toBe(2)
  })

  it('ignores non-error markers', () => {
    expect(diagnoseCodeEditor('json', [marker({ severity: 4 })])).toBeNull()
    expect(diagnoseCodeEditor('json', [])).toBeNull()
  })

  it('keeps TS grammar errors and drops semantic ones', () => {
    const markers: CodeEditorMarkerLike[] = [
      marker({ code: 2304, message: "Cannot find name 'Buffer'" }),
      marker({ code: 2339, message: 'Property does not exist' }),
      marker({ code: 1005, message: "',' expected" }),
    ]
    const summary = diagnoseCodeEditor('typescript', markers)
    expect(summary?.message).toBe("',' expected")
    expect(summary?.total).toBe(1)
  })

  it('reads TS diagnostic codes in object form', () => {
    expect(isReportableDiagnostic('javascript', marker({ code: { value: 1002 } }))).toBe(true)
    expect(isReportableDiagnostic('typescript', marker({ code: { value: 2580 } }))).toBe(false)
    expect(isReportableDiagnostic('typescript', marker({ code: 'json-pointer' }))).toBe(false)
  })

  it('stays silent for languages without a validating language service', () => {
    for (const language of ['shell', 'yaml', 'plaintext', 'spark-json-template']) {
      expect(diagnoseCodeEditor(language, [marker()])).toBeNull()
      expect(isReportableDiagnostic(language, marker())).toBe(false)
    }
  })
})

describe('formatCodeEditorDiagnostic', () => {
  it('renders a single line summary with the line number', () => {
    expect(
      formatCodeEditorDiagnostic({
        line: 3,
        column: 1,
        message: 'Unexpected token }',
        total: 1,
      }),
    ).toBe('第 3 行：Unexpected token }')
  })

  it('collapses multi-line messages and appends the error count', () => {
    expect(
      formatCodeEditorDiagnostic({
        line: 12,
        column: 4,
        message: "',' expected.\n\n  详情见文档",
        total: 3,
      }),
    ).toBe("第 12 行：',' expected. 详情见文档（共 3 处）")
  })
})

describe('codeEditorHeightForRows', () => {
  it('maps rows to a deterministic pixel height', () => {
    expect(codeEditorHeightForRows(5)).toBe(5 * 18 + 12 + 10)
    expect(codeEditorHeightForRows(20)).toBeGreaterThan(codeEditorHeightForRows(10))
  })

  it('clamps invalid rows to a single visible line', () => {
    expect(codeEditorHeightForRows(0)).toBe(codeEditorHeightForRows(1))
    expect(codeEditorHeightForRows(2.7)).toBe(codeEditorHeightForRows(2))
    expect(codeEditorHeightForRows(Number.NaN)).toBe(codeEditorHeightForRows(1))
  })
})

describe('detectStructuredTextLanguage', () => {
  it('detects JSON by the first non-space character', () => {
    expect(detectStructuredTextLanguage('{"openapi":"3.0.0"}')).toBe('json')
    expect(detectStructuredTextLanguage('\n\n  [1, 2]')).toBe('json')
  })

  it('falls back to YAML for anything else', () => {
    expect(detectStructuredTextLanguage('openapi: 3.0.0')).toBe('yaml')
    expect(detectStructuredTextLanguage('# comment\npaths: {}')).toBe('yaml')
    expect(detectStructuredTextLanguage('')).toBe('yaml')
    expect(detectStructuredTextLanguage('   \n')).toBe('yaml')
  })
})
