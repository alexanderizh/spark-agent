import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import {
  createDefaultAvatar,
  generateDefaultAvatarUrl,
  getAgentAvatarConfig,
  getUserAvatarConfig,
  normalizeAvatarConfig,
  resolveAvatarSrc,
} from '../design/avatar'

describe('avatar config', () => {
  it('normalizes uploaded image data URLs', () => {
    const avatar = normalizeAvatarConfig({ kind: 'upload', dataUrl: 'data:image/png;base64,abc' })

    expect(avatar).toEqual({ kind: 'upload', dataUrl: 'data:image/png;base64,abc' })
    expect(resolveAvatarSrc(avatar!)).toBe('data:image/png;base64,abc')
  })

  it('falls back to local generated avatars for agents and users', () => {
    const agent = getAgentAvatarConfig({}, 'reviewer', 'Reviewer')
    const user = getUserAvatarConfig(null)

    expect(resolveAvatarSrc(agent)).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)
    expect(decodeURIComponent(resolveAvatarSrc(agent))).toContain('RE')
    expect(resolveAvatarSrc(user)).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)
    expect(decodeURIComponent(resolveAvatarSrc(user))).toContain('US')
  })

  it('keeps custom default avatars offline', () => {
    const avatar = createDefaultAvatar('Agent One')

    expect(resolveAvatarSrc(avatar)).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)
    expect(decodeURIComponent(resolveAvatarSrc(avatar))).toContain('AO')
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
