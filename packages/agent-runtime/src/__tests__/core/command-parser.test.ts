import { describe, it, expect } from 'vitest'
import { parseCommand, isCommand } from '../../core/command-parser.js'

describe('CommandParser', () => {
  describe('isCommand', () => {
    it('returns true for slash-prefixed input', () => {
      expect(isCommand('/help')).toBe(true)
      expect(isCommand('  /status')).toBe(true)
    })

    it('returns false for regular text', () => {
      expect(isCommand('hello')).toBe(false)
      expect(isCommand('')).toBe(false)
    })
  })

  describe('parseCommand', () => {
    it('parses simple command', () => {
      const result = parseCommand('/help')
      expect(result).toMatchObject({ name: 'help', args: [], flags: {} })
    })

    it('parses command with args', () => {
      const result = parseCommand('/model claude-3-5-sonnet')
      expect(result).toMatchObject({ name: 'model', args: ['claude-3-5-sonnet'] })
    })

    it('parses flags', () => {
      const result = parseCommand('/compact --force true')
      expect(result?.flags).toEqual({ force: 'true' })
    })

    it('parses quoted args', () => {
      const result = parseCommand('/help "my command"')
      expect(result?.args).toEqual(['my command'])
    })

    it('returns null for non-command', () => {
      expect(parseCommand('hello')).toBeNull()
    })

    it('normalizes command name to lowercase', () => {
      expect(parseCommand('/HELP')?.name).toBe('help')
    })
  })
})
