import { describe, expect, it } from 'vitest'
import {
  createDefaultAvatar,
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

  it('falls back to Dicebear for agents and users', () => {
    const agent = getAgentAvatarConfig({}, 'reviewer', 'Reviewer')
    const user = getUserAvatarConfig(null)

    expect(resolveAvatarSrc(agent)).toContain('api.dicebear.com/9.x/')
    expect(resolveAvatarSrc(agent)).toContain('seed=Reviewer')
    expect(resolveAvatarSrc(user)).toContain('api.dicebear.com/9.x/')
    expect(resolveAvatarSrc(user)).toContain('seed=User')
  })

  it('keeps custom Dicebear seeds URL encoded', () => {
    const avatar = createDefaultAvatar('Agent One')

    expect(resolveAvatarSrc(avatar)).toContain('seed=Agent%20One')
  })
})
