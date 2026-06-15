import { describe, expect, it } from 'vitest'

import { sanitizeBranchSlug } from '../../services/worktree-name-generator.js'

describe('sanitizeBranchSlug', () => {
  it('lowercases and kebab-cases free text', () => {
    expect(sanitizeBranchSlug('Add Login Form')).toBe('add-login-form')
  })

  it('strips non-alphanumerics and collapses separators', () => {
    expect(sanitizeBranchSlug('fix: cache  bug!! (urgent)')).toBe('fix-cache-bug-urgent')
  })

  it('takes only the first non-empty line', () => {
    expect(sanitizeBranchSlug('\n\nimplement-auth\nextra stuff')).toBe('implement-auth')
  })

  it('trims leading/trailing hyphens', () => {
    expect(sanitizeBranchSlug('---hello---')).toBe('hello')
  })

  it('returns empty string when no usable characters', () => {
    expect(sanitizeBranchSlug('！！！中文标题')).toBe('')
  })

  it('caps length at 40 chars without trailing hyphen', () => {
    const slug = sanitizeBranchSlug('a'.repeat(30) + ' ' + 'b'.repeat(30))
    expect(slug.length).toBeLessThanOrEqual(40)
    expect(slug.endsWith('-')).toBe(false)
  })
})
