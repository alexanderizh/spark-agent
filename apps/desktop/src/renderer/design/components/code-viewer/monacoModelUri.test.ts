import { describe, expect, it } from 'vitest'

import { toMonacoModelUri } from './monacoModelUri'

describe('toMonacoModelUri', () => {
  it('POSIX 绝对路径 → 标准 file:// URI', () => {
    expect(toMonacoModelUri('/Users/x/proj/src/renderer/App.tsx')).toBe(
      'file:///Users/x/proj/src/renderer/App.tsx',
    )
  })

  it('Windows 绝对路径 → 反斜杠转正斜杠 + file:/// 盘符形式', () => {
    expect(toMonacoModelUri('C:\\Users\\x\\proj\\App.tsx')).toBe('file:///C:/Users/x/proj/App.tsx')
  })

  it('相对路径补前导斜杠，避免首段被 Uri.parse 当作 host', () => {
    expect(toMonacoModelUri('apps/desktop/src/App.tsx')).toBe('file:///apps/desktop/src/App.tsx')
  })

  it('已是 file:// URI 时保持不变', () => {
    expect(toMonacoModelUri('file:///a/b.ts')).toBe('file:///a/b.ts')
  })
})
