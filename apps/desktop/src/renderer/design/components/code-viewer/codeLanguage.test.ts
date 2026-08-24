import { describe, expect, it } from 'vitest'
import { getMonacoLanguage, isCodeLikeFile } from './codeLanguage'

describe('isCodeLikeFile — dotfile（点开头）文件', () => {
  it('无扩展名的 dotfile 默认按可编辑文本处理（不逐一枚举 basename）', () => {
    expect(isCodeLikeFile('/repo/.gitignore')).toBe(true)
    expect(isCodeLikeFile('/repo/.gitattributes')).toBe(true)
    expect(isCodeLikeFile('/repo/.editorconfig')).toBe(true)
    expect(isCodeLikeFile('/repo/.npmrc')).toBe(true)
  })

  it('带扩展名的 dotfile 同样按可编辑文本处理（工程惯例：点开头即配置文件）', () => {
    expect(isCodeLikeFile('/repo/.prettierrc.json')).toBe(true)
    expect(isCodeLikeFile('/repo/.env.local')).toBe(true)
  })
})

describe('isCodeLikeFile — 无扩展名 / 普通文件', () => {
  it('无扩展名按 basename 白名单判定', () => {
    expect(isCodeLikeFile('/repo/Dockerfile')).toBe(true)
    expect(isCodeLikeFile('/repo/makefile')).toBe(true)
    expect(isCodeLikeFile('/repo/README')).toBe(false)
  })

  it('代码/配置/文本扩展名返回 true，二进制返回 false', () => {
    expect(isCodeLikeFile('/repo/src/a.ts')).toBe(true)
    expect(isCodeLikeFile('/repo/src/a.md')).toBe(true)
    expect(isCodeLikeFile('/repo/a.txt')).toBe(true)
    expect(isCodeLikeFile('/repo/a.csv')).toBe(true)
    expect(isCodeLikeFile('/repo/a.png')).toBe(false)
    expect(isCodeLikeFile('/repo/a.mp4')).toBe(false)
    expect(isCodeLikeFile('/repo/a.unknownext')).toBe(false)
  })
})

describe('getMonacoLanguage', () => {
  it('dotfile 与未知文件回落 plaintext，不误判扩展名', () => {
    expect(getMonacoLanguage('/repo/.gitignore')).toBe('plaintext')
    expect(getMonacoLanguage('/repo/.prettierrc.json')).toBe('json')
    expect(getMonacoLanguage('/repo/Dockerfile')).toBe('dockerfile')
    expect(getMonacoLanguage('/repo/src/a.tsx')).toBe('typescript')
  })
})
