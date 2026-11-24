import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isPathWithinRoots, normalizeDriveLetterPath } from './mobile-bridge-path-policy'

const onWindows = path.sep === '\\'

describe('mobile-bridge-path-policy', () => {
  describe('normalizeDriveLetterPath', () => {
    it('normalizes VSCode-style drive paths on Windows', () => {
      if (!onWindows) return // POSIX 下 /G:/ 是合法目录名，不做归一
      expect(normalizeDriveLetterPath('/G:/spark/x.md')).toBe('G:\\spark\\x.md')
      expect(normalizeDriveLetterPath('/g:/spark/reports/report.md')).toBe('G:\\spark\\reports\\report.md')
      expect(normalizeDriveLetterPath(' /D:/a/b.txt ')).toBe('D:\\a\\b.txt')
    })

    it('keeps non-drive paths untouched', () => {
      if (!onWindows) return
      expect(normalizeDriveLetterPath('G:\\ws\\a.md')).toBe('G:\\ws\\a.md')
      expect(normalizeDriveLetterPath('/unix/absolute.md')).toBe('/unix/absolute.md')
      expect(normalizeDriveLetterPath('.spark-agent/notes.md')).toBe('.spark-agent/notes.md')
      expect(normalizeDriveLetterPath('')).toBe('')
    })
  })

  describe('isPathWithinRoots', () => {
    it('accepts VSCode-style drive paths inside a whitelisted root', () => {
      if (!onWindows) return
      const roots = ['G:\\spark\\telegram-group-bot', 'C:\\Users\\dev\\AppData\\attachments']
      expect(isPathWithinRoots('/G:/spark/telegram-group-bot/.spark-agent/task-state-inbox.md', roots)).toBe(
        true,
      )
      expect(isPathWithinRoots('G:\\spark\\telegram-group-bot\\.spark-agent\\task-state-inbox.md', roots)).toBe(
        true,
      )
    })

    it('rejects paths outside every root', () => {
      if (!onWindows) return
      const roots = ['G:\\spark\\telegram-group-bot']
      expect(isPathWithinRoots('/G:/other-project/secret.md', roots)).toBe(false)
      expect(isPathWithinRoots('G:\\spark\\..\\..\\Windows\\system32\\config', roots)).toBe(false)
      expect(isPathWithinRoots('', roots)).toBe(false)
    })
  })
})
