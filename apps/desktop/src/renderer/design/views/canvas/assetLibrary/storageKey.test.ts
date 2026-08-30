import { describe, expect, it } from 'vitest'
import {
  isAbsoluteStoragePath,
  resolveStorageKeyToAbsolutePath,
  toRelativeStorageKey,
} from './storageKey'

describe('storageKey 归一 helper', () => {
  describe('isAbsoluteStoragePath', () => {
    it('识别 POSIX 与 Windows 绝对路径', () => {
      expect(isAbsoluteStoragePath('/tmp/project-1/a.png')).toBe(true)
      expect(isAbsoluteStoragePath('C:\\project\\a.png')).toBe(true)
      expect(isAbsoluteStoragePath('D:/project/a.png')).toBe(true)
      expect(isAbsoluteStoragePath('\\\\server\\share\\a.png')).toBe(true)
    })

    it('相对 key / 空值返回 false', () => {
      expect(isAbsoluteStoragePath('assets/images/a.png')).toBe(false)
      expect(isAbsoluteStoragePath('')).toBe(false)
      expect(isAbsoluteStoragePath(null)).toBe(false)
      expect(isAbsoluteStoragePath(undefined)).toBe(false)
    })
  })

  describe('toRelativeStorageKey', () => {
    it('项目目录内的路径归一为 posix 相对 key', () => {
      expect(toRelativeStorageKey('/tmp/project-1/assets/images/a.png', '/tmp/project-1')).toBe(
        'assets/images/a.png',
      )
    })

    it('Windows 反斜杠路径同样归一', () => {
      expect(toRelativeStorageKey('C:\\proj\\assets\\a.png', 'C:\\proj')).toBe('assets/a.png')
    })

    it('项目根目录带尾部斜杠也能匹配', () => {
      expect(toRelativeStorageKey('/tmp/project-1/a.png', '/tmp/project-1/')).toBe('a.png')
    })

    it('项目目录外 / 无根目录 / 相对输入原样返回', () => {
      expect(toRelativeStorageKey('/tmp/elsewhere/a.png', '/tmp/project-1')).toBe(
        '/tmp/elsewhere/a.png',
      )
      expect(toRelativeStorageKey('/tmp/project-1/a.png', null)).toBe('/tmp/project-1/a.png')
      expect(toRelativeStorageKey('/tmp/project-1/a.png', '')).toBe('/tmp/project-1/a.png')
      expect(toRelativeStorageKey('assets/a.png', '/tmp/project-1')).toBe('assets/a.png')
    })
  })

  describe('resolveStorageKeyToAbsolutePath', () => {
    it('历史绝对路径原样返回（读取端兼容）', () => {
      expect(resolveStorageKeyToAbsolutePath('/tmp/project-1/a.png', '/tmp/project-1')).toBe(
        '/tmp/project-1/a.png',
      )
    })

    it('相对 key 拼接项目根目录（双端兼容新写入）', () => {
      expect(resolveStorageKeyToAbsolutePath('assets/images/a.png', '/tmp/project-1')).toBe(
        '/tmp/project-1/assets/images/a.png',
      )
      expect(resolveStorageKeyToAbsolutePath('assets\\a.png', 'C:\\proj')).toBe(
        'C:/proj/assets/a.png',
      )
    })

    it('相对 key 无根目录 / 空值返回 null', () => {
      expect(resolveStorageKeyToAbsolutePath('assets/a.png', null)).toBeNull()
      expect(resolveStorageKeyToAbsolutePath('', '/tmp/project-1')).toBeNull()
      expect(resolveStorageKeyToAbsolutePath(null, '/tmp/project-1')).toBeNull()
    })
  })
})
