import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  expandCustomCommand,
  loadCustomCommands,
  matchCustomCommand,
} from '../../src/commands/custom-commands.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'spark-commands-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('loadCustomCommands', () => {
  it('loads user and project commands with project precedence', async () => {
    const userDir = join(root, 'user');
    const cwd = join(root, 'ws');
    await mkdir(join(userDir, 'commands'), { recursive: true });
    await mkdir(join(cwd, '.spark', 'commands'), { recursive: true });
    await writeFile(join(userDir, 'commands', 'review.md'), 'user review body');
    await writeFile(join(cwd, '.spark', 'commands', 'review.md'), 'project review body');
    await writeFile(join(cwd, '.spark', 'commands', 'deploy.md'), 'deploy body');

    const commands = await loadCustomCommands({ cwd, userDir });

    expect(commands.map((command) => command.name)).toEqual(['deploy', 'review']);
    const review = commands.find((command) => command.name === 'review');
    expect(review?.scope).toBe('project');
    expect(review?.template).toBe('project review body');
  });

  it('reads frontmatter descriptions and nested folder names', async () => {
    const cwd = join(root, 'ws');
    const commandsDir = join(cwd, '.spark', 'commands');
    await mkdir(join(commandsDir, 'git'), { recursive: true });
    await writeFile(
      join(commandsDir, 'fix.md'),
      '---\ndescription: 修复一个 issue\n---\n请修复 $ARGUMENTS',
    );
    await writeFile(join(commandsDir, 'git', 'sync.md'), '同步远端分支');

    const commands = await loadCustomCommands({ cwd });

    expect(commands.find((command) => command.name === 'fix')?.description).toBe(
      '修复一个 issue',
    );
    expect(commands.find((command) => command.name === 'git/sync')?.template).toBe(
      '同步远端分支',
    );
  });

  it('skips reserved builtin names and invalid names', async () => {
    const cwd = join(root, 'ws');
    const commandsDir = join(cwd, '.spark', 'commands');
    await mkdir(commandsDir, { recursive: true });
    await writeFile(join(commandsDir, 'help.md'), 'shadow builtin');
    await writeFile(join(commandsDir, 'valid-name.md'), 'ok');
    await writeFile(join(commandsDir, 'has space.md'), 'invalid');

    const commands = await loadCustomCommands({ cwd, reservedNames: ['/help'] });

    expect(commands.map((command) => command.name)).toEqual(['valid-name']);
  });
});

describe('expandCustomCommand', () => {
  const command = {
    name: 'fix',
    description: '',
    scope: 'project' as const,
    filePath: '/ws/.spark/commands/fix.md',
    template: '修复 issue：$1 优先级 $2，全文：$ARGUMENTS',
  };

  it('substitutes $ARGUMENTS and positional words in one pass', () => {
    expect(expandCustomCommand(command, '登录bug P0')).toBe(
      '修复 issue：登录bug 优先级 P0，全文：登录bug P0',
    );
    // $ARGUMENTS keeps the raw argument string, including inner spacing.
    expect(expandCustomCommand(command, '登录bug  P0')).toBe(
      '修复 issue：登录bug 优先级 P0，全文：登录bug  P0',
    );
  });

  it('never re-substitutes content injected through $ARGUMENTS', () => {
    const templateCommand = { ...command, template: 'body=$ARGUMENTS' };
    expect(expandCustomCommand(templateCommand, '$1 $ARGUMENTS')).toBe('body=$1 $ARGUMENTS');
  });

  it('appends arguments when the template declares no placeholder', () => {
    const plain = { ...command, template: '请检查当前仓库' };
    expect(expandCustomCommand(plain, '重点看 src')).toBe('请检查当前仓库\n\n重点看 src');
  });

  it('leaves missing positional words empty', () => {
    expect(expandCustomCommand(command, '只给了一个词')).toBe(
      '修复 issue：只给了一个词 优先级 ，全文：只给了一个词',
    );
  });
});

describe('matchCustomCommand', () => {
  const commands = [
    {
      name: 'fix',
      description: '',
      scope: 'project' as const,
      filePath: '/f.md',
      template: 't',
    },
  ];

  it('splits the name from the remaining arguments', () => {
    expect(matchCustomCommand('/fix 登录页 崩溃', commands)).toEqual({
      command: commands[0],
      args: '登录页 崩溃',
    });
  });

  it('returns undefined for unknown names and non-commands', () => {
    expect(matchCustomCommand('/nope', commands)).toBeUndefined();
    expect(matchCustomCommand('plain text', commands)).toBeUndefined();
  });
});
