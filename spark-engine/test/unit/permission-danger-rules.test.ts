import { describe, expect, it } from 'vitest';

import {
  DANGEROUS_COMMAND_PATTERNS,
  extractCommandText,
  matchDangerousCommand,
} from '../../src/permission/danger-rules.js';

describe('danger rules', () => {
  it('mirrors the host rule engine pattern count (drift hint)', () => {
    // 宿主镜像源：packages/agent-runtime permission.service isDangerousCommand。
    // 逐条 .source 相等由 agent-runtime 的漂移守卫测试断言；这里守数量红线。
    expect(DANGEROUS_COMMAND_PATTERNS).toHaveLength(9);
  });

  it.each([
    ['rm -rf /tmp/build', 'recursive force remove'],
    ['rm -fr build', 'force-recursive reorder'],
    ['git clean -fd', 'git clean force'],
    ['git clean -x node_modules', 'git clean ignored'],
    ['git reset --hard HEAD~1', 'hard reset'],
    ['sudo apt install curl', 'sudo'],
    ['chmod -R 777 /', 'recursive chmod'],
    ['chown -R user:group /srv', 'recursive chown'],
    ['dd if=/dev/zero of=/dev/sda', 'raw device write'],
    ['mkfs.ext4 /dev/sdb1', 'filesystem creation'],
    [':(){ :|:& };:', 'fork bomb'],
  ])('flags %s (%s)', (command) => {
    expect(matchDangerousCommand(command)).toBeDefined();
  });

  it.each([
    ['rm src/notes.txt', 'plain remove'],
    ['git clean -n', 'dry-run clean'],
    ['git reset --soft HEAD~1', 'soft reset'],
    ['git status', 'read-only git'],
    ['npm test', 'build command'],
    ['chmod +x run.sh', 'non-recursive chmod'],
    ['dd bs=1 count=0', 'dd without if='],
    ['ls -la', 'listing'],
  ])('passes %s through (%s)', (command) => {
    expect(matchDangerousCommand(command)).toBeUndefined();
  });

  it('matches case-insensitively like the host engine', () => {
    expect(matchDangerousCommand('RM -RF build')).toBeDefined();
    expect(matchDangerousCommand('SUDO reboot')).toBeDefined();
  });

  it('treats whitespace-only commands as safe', () => {
    expect(matchDangerousCommand('   ')).toBeUndefined();
    expect(matchDangerousCommand('')).toBeUndefined();
  });

  describe('extractCommandText', () => {
    it('reads top-level string command and cmd', () => {
      expect(extractCommandText({ command: 'npm test' })).toBe('npm test');
      expect(extractCommandText({ cmd: 'echo hi' })).toBe('echo hi');
    });

    it('prefers command over cmd', () => {
      expect(extractCommandText({ command: 'a', cmd: 'b' })).toBe('a');
    });

    it('ignores non-string and nested values', () => {
      expect(extractCommandText({ command: 123 })).toBeUndefined();
      expect(extractCommandText({ nested: { command: 'x' } })).toBeUndefined();
      expect(extractCommandText({})).toBeUndefined();
    });

    it('ignores non-object args', () => {
      expect(extractCommandText(undefined)).toBeUndefined();
      expect(extractCommandText(null)).toBeUndefined();
      expect(extractCommandText(['command'])).toBeUndefined();
      expect(extractCommandText('rm -rf')).toBeUndefined();
    });
  });
});
