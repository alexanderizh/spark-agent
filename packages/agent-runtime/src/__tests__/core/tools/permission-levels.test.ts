import { describe, it, expect } from 'vitest'
import { getToolPermissionLevel } from '../../../core/agent-loop.js'

describe('getToolPermissionLevel', () => {
  // --- bash tool permission levels ---

  describe('bash', () => {
    it('auto-approves read-only commands (ls)', () => {
      expect(getToolPermissionLevel('bash', { command: 'ls -la' })).toBe('auto')
    })

    it('auto-approves read-only commands (cat)', () => {
      expect(getToolPermissionLevel('bash', { command: 'cat file.txt' })).toBe('auto')
    })

    it('auto-approves read-only commands (find)', () => {
      expect(getToolPermissionLevel('bash', { command: 'find . -name "*.ts"' })).toBe('auto')
    })

    it('auto-approves read-only commands (echo)', () => {
      expect(getToolPermissionLevel('bash', { command: 'echo $PATH' })).toBe('auto')
    })

    it('auto-approves read-only commands (pwd)', () => {
      expect(getToolPermissionLevel('bash', { command: 'pwd' })).toBe('auto')
    })

    it('auto-approves read-only commands (which)', () => {
      expect(getToolPermissionLevel('bash', { command: 'which node' })).toBe('auto')
    })

    it('asks for write commands (npm install)', () => {
      expect(getToolPermissionLevel('bash', { command: 'npm install' })).toBe('ask')
    })

    it('asks for write commands (rm)', () => {
      expect(getToolPermissionLevel('bash', { command: 'rm file.txt' })).toBe('ask')
    })

    it('asks for write commands (mkdir)', () => {
      expect(getToolPermissionLevel('bash', { command: 'mkdir new-dir' })).toBe('ask')
    })

    it('asks for write commands (cp)', () => {
      expect(getToolPermissionLevel('bash', { command: 'cp a.txt b.txt' })).toBe('ask')
    })

    it('auto-approves piped read-only commands', () => {
      expect(getToolPermissionLevel('bash', { command: 'cat file.txt | grep pattern' })).toBe('auto')
    })

    it('auto-approves sudo read-only commands', () => {
      expect(getToolPermissionLevel('bash', { command: 'sudo ls /var/log' })).toBe('auto')
    })
  })

  // --- git tool permission levels ---

  describe('git', () => {
    it('auto-approves read-only operations (status)', () => {
      expect(getToolPermissionLevel('git', { operation: 'status' })).toBe('auto')
    })

    it('auto-approves read-only operations (log)', () => {
      expect(getToolPermissionLevel('git', { operation: 'log' })).toBe('auto')
    })

    it('auto-approves read-only operations (diff)', () => {
      expect(getToolPermissionLevel('git', { operation: 'diff' })).toBe('auto')
    })

    it('auto-approves read-only operations (branch)', () => {
      expect(getToolPermissionLevel('git', { operation: 'branch' })).toBe('auto')
    })

    it('auto-approves read-only operations (show)', () => {
      expect(getToolPermissionLevel('git', { operation: 'show' })).toBe('auto')
    })

    it('auto-approves read-only operations (remote)', () => {
      expect(getToolPermissionLevel('git', { operation: 'remote' })).toBe('auto')
    })

    it('auto-approves read-only operations (tag)', () => {
      expect(getToolPermissionLevel('git', { operation: 'tag' })).toBe('auto')
    })

    it('auto-approves read-only operations (stash_list)', () => {
      expect(getToolPermissionLevel('git', { operation: 'stash_list' })).toBe('auto')
    })

    it('auto-approves read-only operations (blame)', () => {
      expect(getToolPermissionLevel('git', { operation: 'blame' })).toBe('auto')
    })

    it('asks for write operations (checkout)', () => {
      expect(getToolPermissionLevel('git', { operation: 'checkout' })).toBe('ask')
    })

    it('asks for write operations (add)', () => {
      expect(getToolPermissionLevel('git', { operation: 'add' })).toBe('ask')
    })

    it('asks for write operations (commit)', () => {
      expect(getToolPermissionLevel('git', { operation: 'commit' })).toBe('ask')
    })

    it('asks for write operations (stash)', () => {
      expect(getToolPermissionLevel('git', { operation: 'stash' })).toBe('ask')
    })

    it('asks for write operations (branch_create)', () => {
      expect(getToolPermissionLevel('git', { operation: 'branch_create' })).toBe('ask')
    })

    it('asks for write operations (branch_delete)', () => {
      expect(getToolPermissionLevel('git', { operation: 'branch_delete' })).toBe('ask')
    })

    it('denies dangerous operations (push)', () => {
      expect(getToolPermissionLevel('git', { operation: 'push' })).toBe('deny')
    })

    it('denies dangerous operations (push_force)', () => {
      expect(getToolPermissionLevel('git', { operation: 'push_force' })).toBe('deny')
    })

    it('denies dangerous operations (reset_hard)', () => {
      expect(getToolPermissionLevel('git', { operation: 'reset_hard' })).toBe('deny')
    })

    it('denies dangerous operations (clean)', () => {
      expect(getToolPermissionLevel('git', { operation: 'clean' })).toBe('deny')
    })

    it('denies dangerous operations (cherry_pick)', () => {
      expect(getToolPermissionLevel('git', { operation: 'cherry_pick' })).toBe('deny')
    })
  })

  // --- Default for unknown tools ---

  describe('other tools', () => {
    it('defaults to ask for unknown tools', () => {
      expect(getToolPermissionLevel('unknown_tool', {})).toBe('ask')
    })
  })
})
