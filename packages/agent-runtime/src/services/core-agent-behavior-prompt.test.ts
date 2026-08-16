import { describe, expect, it } from 'vitest'
import {
  APPLICATION_FOUNDATION_SYSTEM_PROMPT,
  APP_IDENTITY_SYSTEM_PROMPT,
  CORE_AGENT_BEHAVIOR_SYSTEM_PROMPT,
} from './core-agent-behavior-prompt.js'

describe('SparkWork application foundation prompt', () => {
  it('combines identity and provider-neutral behavior in authority order', () => {
    expect(APPLICATION_FOUNDATION_SYSTEM_PROMPT).toBe(
      `${APP_IDENTITY_SYSTEM_PROMPT}\n\n${CORE_AGENT_BEHAVIOR_SYSTEM_PROMPT}`,
    )
    expect(APPLICATION_FOUNDATION_SYSTEM_PROMPT.indexOf('[Application Identity]')).toBeLessThan(
      APPLICATION_FOUNDATION_SYSTEM_PROMPT.indexOf('[Core Agent Behavior]'),
    )
  })

  it('covers initiative, evidence, provenance, and concise communication', () => {
    expect(CORE_AGENT_BEHAVIOR_SYSTEM_PROMPT).toContain('make a reasonable assumption')
    expect(CORE_AGENT_BEHAVIOR_SYSTEM_PROMPT).toContain('is not completion')
    expect(CORE_AGENT_BEHAVIOR_SYSTEM_PROMPT).toContain('observed evidence')
    expect(CORE_AGENT_BEHAVIOR_SYSTEM_PROMPT).toContain(
      'never automatically add an AI assistant, model provider, tool, platform, or other non-user identity as a commit author or co-author',
    )
    expect(CORE_AGENT_BEHAVIOR_SYSTEM_PROMPT).toContain('Co-authored-by')
    expect(CORE_AGENT_BEHAVIOR_SYSTEM_PROMPT).toContain('durable task-state file')
    expect(CORE_AGENT_BEHAVIOR_SYSTEM_PROMPT).toContain('every conversation turn')
    expect(CORE_AGENT_BEHAVIOR_SYSTEM_PROMPT).toContain('distinct from assistant proposals')
    expect(CORE_AGENT_BEHAVIOR_SYSTEM_PROMPT).toContain('Lead with the outcome')
    expect(CORE_AGENT_BEHAVIOR_SYSTEM_PROMPT).toContain('Format responses for readability')
    expect(CORE_AGENT_BEHAVIOR_SYSTEM_PROMPT).toContain('file link')
    expect(CORE_AGENT_BEHAVIOR_SYSTEM_PROMPT).toContain(
      'absolute path or a resolvable workspace-relative path',
    )
    expect(CORE_AGENT_BEHAVIOR_SYSTEM_PROMPT).toContain(
      'do not format it as a clickable Markdown file link',
    )
  })

  it('stays compact and does not impersonate a model provider', () => {
    expect(CORE_AGENT_BEHAVIOR_SYSTEM_PROMPT.length).toBeLessThan(3_500)
    expect(CORE_AGENT_BEHAVIOR_SYSTEM_PROMPT).not.toMatch(/Anthropic|OpenAI|Claude|ChatGPT/)
    expect(APPLICATION_FOUNDATION_SYSTEM_PROMPT).not.toMatch(/[\u3400-\u9fff]/u)
  })
})
