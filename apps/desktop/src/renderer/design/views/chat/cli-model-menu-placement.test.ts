import { describe, expect, it } from 'vitest'

import { resolveCliSubmenuPlacement } from './cli-model-menu-placement'

describe('resolveCliSubmenuPlacement', () => {
  it('opens to the right when the viewport has enough space', () => {
    expect(resolveCliSubmenuPlacement({ right: 600 }, 1000)).toBe('rightTop')
  })

  it('opens to the left when the right side cannot fit the submenu', () => {
    expect(resolveCliSubmenuPlacement({ right: 800 }, 1000)).toBe('leftTop')
  })
})
