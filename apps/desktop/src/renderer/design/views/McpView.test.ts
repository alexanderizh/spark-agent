// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

import { normalizeConnectorCapabilities, parseSelectedRepos } from './McpView'

describe('McpView GitHub connector helpers', () => {
  it('keeps user-disabled capabilities disabled', () => {
    expect(normalizeConnectorCapabilities(['repositories'])).toEqual(['repositories'])
  })

  it('normalizes repo inputs from owner/repo values and pasted GitHub URLs', () => {
    expect(
      parseSelectedRepos(
        'https://github.com/OpenAI/Codex/, owner/repo.git\nOWNER/repo/',
      ),
    ).toEqual(['openai/codex', 'owner/repo'])
  })
})
