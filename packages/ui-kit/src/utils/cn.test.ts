/**
 * @spark/ui-kit 工具函数单元测试
 */

import { describe, it, expect } from 'vitest'
import { cn } from './cn'

describe('cn', () => {
  it('should merge class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('should handle conditional classes', () => {
    const isVisible = false
    expect(cn('base', isVisible && 'hidden', 'extra')).toBe('base extra')
  })

  it('should merge conflicting tailwind classes', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })

  it('should handle undefined and null', () => {
    expect(cn('base', undefined, null, 'end')).toBe('base end')
  })

  it('should handle array input', () => {
    expect(cn(['px-2', 'py-1'])).toBe('px-2 py-1')
  })
})
