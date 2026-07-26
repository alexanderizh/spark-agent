import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
}))
vi.mock('../../db.js', () => ({
  getDatabase: () => ({ raw: { prepare: () => ({ all: () => [] }) } }),
}))

import { evaluateExternalUrl, isWebviewSourceAllowed } from '../ExternalUrlPolicy.js'

describe('ExternalUrlPolicy', () => {
  it('keeps web and custom developer protocols available', () => {
    expect(evaluateExternalUrl('https://example.com').allowed).toBe(true)
    expect(evaluateExternalUrl('vscode://file/project/readme.md').allowed).toBe(true)
    expect(evaluateExternalUrl('spark-extension://open/resource').allowed).toBe(true)
  })

  it('blocks renderer-executable protocols from reaching the operating system', () => {
    expect(evaluateExternalUrl('javascript:alert(1)').allowed).toBe(false)
    expect(evaluateExternalUrl('data:text/html,<script>alert(1)</script>').allowed).toBe(false)
    expect(evaluateExternalUrl('safe-file://x/secret').allowed).toBe(false)
    expect(isWebviewSourceAllowed('devtools://devtools/bundled/inspector.html')).toBe(false)
  })

  it('allows file URLs only when the resolved file belongs to a registered root', () => {
    expect(evaluateExternalUrl('file:///workspace/demo.png', () => true).allowed).toBe(true)
    expect(evaluateExternalUrl('file:///Users/test/.ssh/id_rsa', () => false).allowed).toBe(false)
  })
})
