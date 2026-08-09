import { describe, expect, it } from 'vitest'
import { hasChatConfigScope } from './chat-config-panel-state'

describe('ChatConfigPanel scope', () => {
  it('keeps the project scope available before an empty session is created', () => {
    expect(hasChatConfigScope(undefined, 'workspace-1')).toBe(true)
  })

  it('does not load runtime configuration without a project or session', () => {
    expect(hasChatConfigScope(undefined, undefined)).toBe(false)
  })
})
