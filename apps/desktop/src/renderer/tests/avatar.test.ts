import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import {
  createDefaultAvatar,
  createBuiltinAvatar,
  generateDefaultAvatarUrl,
  getAgentAvatarConfig,
  getGuestAvatarConfig,
  getUserAvatarConfig,
  normalizeAvatarConfig,
  resolveAvatarSrc,
} from '../design/avatar'
import { DEFAULT_AGENT_AVATAR_ID, DEFAULT_USER_AVATAR_ID } from '../design/builtinAvatars'

describe('avatar config', () => {
  it('normalizes uploaded image data URLs', () => {
    const avatar = normalizeAvatarConfig({ kind: 'upload', dataUrl: 'data:image/png;base64,abc' })

    expect(avatar).toEqual({ kind: 'upload', dataUrl: 'data:image/png;base64,abc' })
    expect(resolveAvatarSrc(avatar!)).toBe('data:image/png;base64,abc')
  })

  it('maps the legacy guest builtin avatar to the generated user fallback', () => {
    const avatar = normalizeAvatarConfig({ kind: 'builtin', id: 'guest' })

    expect(avatar).toEqual({ kind: 'builtin', id: DEFAULT_USER_AVATAR_ID })
    expect(resolveAvatarSrc(avatar!)).toContain('user-default.png')
  })

  it('falls back to fixed bundled avatars for agents and unauthenticated users', () => {
    const agent = getAgentAvatarConfig({}, 'reviewer', 'Reviewer')
    const user = getUserAvatarConfig(null)

    expect(agent).toEqual({ kind: 'builtin', id: DEFAULT_AGENT_AVATAR_ID })
    expect(user).toEqual({ kind: 'builtin', id: DEFAULT_USER_AVATAR_ID })
    expect(resolveAvatarSrc(agent)).toContain('agent-default.png')
    expect(resolveAvatarSrc(user)).toContain('user-default.png')
  })

  it('resolves the guest avatar to the bundled user fallback asset', () => {
    const guest = getGuestAvatarConfig()

    expect(guest).toEqual({ kind: 'builtin', id: DEFAULT_USER_AVATAR_ID })
    expect(resolveAvatarSrc(guest)).toContain('user-default.png')
  })

  it('selects deterministic generated builtin avatars for named defaults', () => {
    const avatar = createDefaultAvatar('Agent One')

    expect(avatar.kind).toBe('builtin')
    expect(resolveAvatarSrc(avatar)).toContain('.png')
  })

  it('falls back to the agent default when a builtin id is unknown', () => {
    const avatar = createBuiltinAvatar('missing-avatar')

    expect(avatar).toEqual({ kind: 'builtin', id: DEFAULT_AGENT_AVATAR_ID })
    expect(resolveAvatarSrc(avatar)).toContain('agent-default.png')
  })

  it('generates a fully composed local SVG data URL from the agent name', () => {
    const url = generateDefaultAvatarUrl('编码 Agent')

    expect(url).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)
    expect(decodeURIComponent(url)).toContain('编A')
  })

  it('allows local data avatars through the renderer CSP', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf-8')

    expect(html).toContain('img-src')
    expect(html).toContain('data:')
  })
})
