import { describe, expect, it } from 'vitest'
import { WEB_SEARCH_SYSTEM_PROMPT } from './session-mcp-tooling-helpers.js'

describe('WEB_SEARCH_SYSTEM_PROMPT', () => {
  it('routes changing claims to search and stable knowledge to direct answers', () => {
    expect(WEB_SEARCH_SYSTEM_PROMPT).toContain('Search based on how quickly the answer can change')
    expect(WEB_SEARCH_SYSTEM_PROMPT).toContain('software versions')
    expect(WEB_SEARCH_SYSTEM_PROMPT).toContain('Stable concepts')
  })

  it('requires source quality, page inspection, conflict handling, and calibrated absence claims', () => {
    expect(WEB_SEARCH_SYSTEM_PROMPT).toContain('primary and authoritative sources')
    expect(WEB_SEARCH_SYSTEM_PROMPT).toContain('Fetch the underlying page')
    expect(WEB_SEARCH_SYSTEM_PROMPT).toContain('reconcile material conflicts')
    expect(WEB_SEARCH_SYSTEM_PROMPT).toContain('absence of a search result')
  })
})
