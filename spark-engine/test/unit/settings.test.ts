import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  loadSparkSettings,
  readSetting,
  removeSetting,
  resolveDefaultPermissionMode,
  resolveEngineSettings,
  resolveSessionPermissionMode,
  SparkSettingsError,
  writeSetting,
} from '../../src/config/settings.js'
import { parseSettingValue } from '../../src/config/config-file.js'
import { createDefaultEnv, createResilientEnv } from '../../src/env.js'
import { FakeModel } from '../../src/llm/fake/model.js'
import { text, toolCall } from '../../src/llm/fake/reply-dsl.js'
import { Agent } from '../../src/sdk/agent.js'
import type { PermissionCheckContext } from '../../src/permission/types.js'
import type { ResolvedToolCall } from '../../src/tools/contract.js'
import { workspaceToolDefinitions } from '../../src/tools/workspace/definitions.js'
import { collectEvents } from '../helpers.js'

// TOML basic strings treat backslashes as escapes, so the embedded server
// path is written with forward slashes (Windows APIs accept those too).
const debugServer = resolve(process.cwd(), '../scripts/debug-mcp/stdio-echo-server.mjs').replaceAll(
  String.fromCharCode(92),
  '/',
)
const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'spark-settings-'))
  roots.push(root)
  await mkdir(join(root, '.spark'), { recursive: true })
  return root
}

async function writeProjectConfig(root: string, toml: string): Promise<void> {
  await mkdir(join(root, '.spark'), { recursive: true })
  await writeFile(join(root, '.spark', 'config.toml'), toml)
}

describe('layered settings', () => {
  it('merges the user layer with the project layer and lets the project win', async () => {
    const root = await workspace()
    const home = join(root, 'home')
    await writeSetting({
      cwd: root,
      sparkHome: home,
      key: 'permissions.mode',
      value: 'auto',
    })
    await writeSetting({
      cwd: root,
      sparkHome: home,
      key: 'permissions.allow',
      value: ['read', 'glob'],
    })
    await writeSetting({
      cwd: root,
      sparkHome: home,
      key: 'permissions.allow',
      value: ['read'],
      scope: 'project',
    })

    const settings = await loadSparkSettings({ cwd: root, sparkHome: home })
    // Arrays replace instead of concatenating, so the project file is the
    // single source of truth once it sets a list.
    expect(settings.config.permissions?.allow).toEqual(['read'])
    expect(resolveDefaultPermissionMode(settings)).toBe('auto')
    const projectEntry = await readSetting({
      cwd: root,
      sparkHome: home,
      key: 'permissions.allow',
    })
    expect(projectEntry.scope).toBe('project')
  })

  it('prefers a saved interactive choice over the static [permissions].mode default', async () => {
    const root = await workspace()
    const home = join(root, 'home')
    await writeSetting({ cwd: root, sparkHome: home, key: 'permissions.mode', value: 'auto' })
    const configured = await loadSparkSettings({ cwd: root, sparkHome: home })
    expect(resolveSessionPermissionMode(configured)).toBe('auto')

    // `/perm` persists `agent.permission_mode`; that explicit choice outranks
    // the static default without needing any code change in the TUI.
    await writeSetting({
      cwd: root,
      sparkHome: home,
      key: 'agent.permission_mode',
      value: 'manual',
    })
    const overridden = await loadSparkSettings({ cwd: root, sparkHome: home })
    expect(resolveSessionPermissionMode(overridden)).toBe('manual')
  })

  it('rejects an unknown top-level section instead of ignoring it', async () => {
    const root = await workspace()
    await writeProjectConfig(root, '[permisions]\nmode = "auto"\n')
    await expect(loadSparkSettings({ cwd: root, sparkHome: join(root, 'home') })).rejects.toThrow(
      /Invalid Spark configuration/u,
    )
  })

  it('writes 0600 files and refuses edits that would produce an invalid config', async () => {
    const root = await workspace()
    const home = join(root, 'home')
    await writeSetting({ cwd: root, sparkHome: home, key: 'permissions.mode', value: 'manual' })
    if (process.platform !== 'win32') {
      expect((await stat(join(home, 'config.toml'))).mode & 0o077).toBe(0)
    }

    await expect(
      writeSetting({ cwd: root, sparkHome: home, key: 'permissions.mode', value: 'yolo' }),
    ).rejects.toThrow(SparkSettingsError)

    const content = await readFile(join(home, 'config.toml'), 'utf8')
    expect(content).toContain('mode = "manual"')
    expect(content).not.toContain('yolo')
  })

  it('prunes empty sections on unset and reports unknown keys', async () => {
    const root = await workspace()
    const home = join(root, 'home')
    await writeSetting({
      cwd: root,
      sparkHome: home,
      key: 'mcp.servers.filesystem.command',
      value: 'npx',
    })
    await removeSetting({ cwd: root, sparkHome: home, key: 'mcp.servers.filesystem.command' })

    const content = await readFile(join(home, 'config.toml'), 'utf8')
    expect(content).not.toContain('filesystem')
    await expect(
      removeSetting({ cwd: root, sparkHome: home, key: 'mcp.servers.filesystem.command' }),
    ).rejects.toThrow(/No global setting/u)
  })

  it('parses command-line values with TOML/JSON typing', () => {
    expect(parseSettingValue('auto')).toBe('auto')
    expect(parseSettingValue('true')).toBe(true)
    expect(parseSettingValue('120000')).toBe(120_000)
    expect(parseSettingValue('["read","glob"]')).toEqual(['read', 'glob'])
    expect(parseSettingValue('"quoted value"')).toBe('quoted value')
    expect(() => parseSettingValue('["broken"')).toThrow(/Invalid JSON value/u)
  })
})

describe('tool configuration', () => {
  it('hides disabled tools from the model and denies them at execution time', async () => {
    const root = await workspace()
    const settings = await settingsWith(root, '[tools]\ndisabled = ["bash", "task"]\n')
    const inputs = resolveEngineSettings(settings)
    const env = createDefaultEnv({
      cwd: root,
      dataRoot: join(root, '.spark-data'),
      llm: new FakeModel([text('ok')]),
      ...inputs,
    })

    const names = env.tools.registry.list().map((tool) => tool.name)
    expect(names).not.toContain('bash')
    expect(names).not.toContain('task')
    expect(names).toContain('read')

    // A resumed session can still replay a call for a tool that was hidden
    // after the fact; the policy must deny it in every mode.
    for (const mode of ['manual', 'auto', 'bypass'] as const) {
      await expect(
        env.permission.policy.check(call('bash', { command: 'ls' }), context(mode)),
      ).resolves.toMatchObject({ decision: 'deny' })
    }
  })

  it('applies an exclusive allowlist when one is configured', async () => {
    const root = await workspace()
    const settings = await settingsWith(root, '[tools]\nenabled = ["read", "grep"]\n')
    const env = createDefaultEnv({
      cwd: root,
      dataRoot: join(root, '.spark-data'),
      llm: new FakeModel([text('ok')]),
      ...resolveEngineSettings(settings),
    })
    expect(
      env.tools.registry
        .list()
        .map((tool) => tool.name)
        .sort(),
    ).toEqual(['grep', 'read'])
  })

  it('rejects a config that sets both enabled and disabled', async () => {
    const root = await workspace()
    await writeProjectConfig(root, '[tools]\nenabled = ["read"]\ndisabled = ["bash"]\n')
    await expect(loadSparkSettings({ cwd: root, sparkHome: join(root, 'home') })).rejects.toThrow(
      /mutually exclusive/u,
    )
  })
})

describe('permission configuration', () => {
  it('turns deny entries into hard denies and allow entries into silent approvals', async () => {
    const root = await workspace()
    const settings = await settingsWith(root, '[permissions]\nallow = ["bash"]\ndeny = ["edit"]\n')
    const env = createDefaultEnv({
      cwd: root,
      dataRoot: join(root, '.spark-data'),
      llm: new FakeModel([text('ok')]),
      ...resolveEngineSettings(settings),
    })

    await expect(
      env.permission.policy.check(call('bash', { command: 'ls' }), context('manual')),
    ).resolves.toMatchObject({ decision: 'allow' })
    // Bypass skips ordinary rules but never a configured deny.
    await expect(
      env.permission.policy.check(call('edit', { path: 'a.ts' }), context('bypass')),
    ).resolves.toMatchObject({ decision: 'deny' })
  })

  it('keeps ask entries interactive in manual mode', async () => {
    const root = await workspace()
    const settings = await settingsWith(root, '[permissions]\nask = ["write"]\n')
    const env = createDefaultEnv({
      cwd: root,
      dataRoot: join(root, '.spark-data'),
      llm: new FakeModel([text('ok')]),
      ...resolveEngineSettings(settings),
    })
    const decision = await env.permission.policy.check(
      call('write', { path: 'a.ts', content: 'x' }),
      context('manual'),
    )
    expect(decision.decision).toBe('ask')
    expect(decision.rule?.id).toBe('settings-ask-1')

    // auto mode still auto-approves: it removes the interactive asks only.
    await expect(
      env.permission.policy.check(call('write', { path: 'a.ts', content: 'x' }), context('auto')),
    ).resolves.toMatchObject({ decision: 'allow' })
  })
})

describe('MCP configuration', () => {
  it('maps stdio and http servers and skips disabled ones', async () => {
    const root = await workspace()
    const settings = await settingsWith(
      root,
      [
        '[mcp.servers.echo]',
        `command = "node"`,
        `args = ["${debugServer}"]`,
        '',
        '[mcp.servers.remote]',
        'url = "https://example.com/mcp"',
        'headers = { Authorization = "Bearer ${SPARK_TEST_TOKEN}" }',
        '',
        '[mcp.servers.off]',
        'command = "node"',
        'enabled = false',
        '',
      ].join('\n'),
    )
    const resolved = resolveEngineSettings(settings, { SPARK_TEST_TOKEN: 'token-value' })
    expect(resolved.mcpServers.echo).toMatchObject({ command: 'node' })
    expect(resolved.mcpServers.remote).toEqual({
      type: 'http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer token-value' },
    })
    expect(resolved.mcpServers.off).toBeUndefined()
  })

  it('fails loudly when a referenced environment variable is missing', async () => {
    const root = await workspace()
    const settings = await settingsWith(
      root,
      '[mcp.servers.remote]\nurl = "https://example.com/mcp"\nheaders = { Authorization = "${SPARK_MISSING_TOKEN}" }\n',
    )
    expect(() => resolveEngineSettings(settings, {})).toThrow(/SPARK_MISSING_TOKEN/u)
  })

  it('connects a configured stdio server and exposes its tools', async () => {
    const root = await workspace()
    const settings = await settingsWith(
      root,
      `[mcp.servers.echo]\ncommand = "node"\nargs = ["${debugServer}"]\n`,
    )
    const managed = await createResilientEnv({
      cwd: root,
      dataRoot: join(root, '.spark-data'),
      llm: new FakeModel([text('ok')]),
      ...resolveEngineSettings(settings),
    })
    try {
      expect(managed.mcpError).toBeUndefined()
      expect(managed.env.tools.registry.list().map((tool) => tool.name)).toContain(
        'mcp__echo__debug_echo',
      )
    } finally {
      await managed.close()
    }
  })

  it('runs a configured MCP tool end to end inside a session turn', async () => {
    const root = await workspace()
    const settings = await settingsWith(
      root,
      `[mcp.servers.echo]\ncommand = "node"\nargs = ["${debugServer}"]\n`,
    )
    const model = new FakeModel([
      toolCall('call-1', 'mcp__echo__debug_echo', { message: 'hello-from-settings' }),
      text('done'),
    ])
    const managed = await createResilientEnv({
      cwd: root,
      dataRoot: join(root, '.spark-data'),
      llm: model,
      ...resolveEngineSettings(settings),
    })
    try {
      const agent = Agent.open({ cwd: root, env: managed.env })
      const session = await agent.newSession({ permissionMode: 'auto' })
      await session.turn('call the echo tool')
      const events = await collectEvents(session)
      expect(events.find((event) => event.type === 'tool.result')).toMatchObject({
        ok: true,
        content: expect.stringContaining('hello-from-settings'),
      })
    } finally {
      await managed.close()
    }
  })

  it('degrades to built-in tools when a configured server cannot start', async () => {
    const root = await workspace()
    const settings = await settingsWith(
      root,
      '[mcp.servers.broken]\ncommand = "spark-missing-binary-for-tests"\n',
    )
    const managed = await createResilientEnv({
      cwd: root,
      dataRoot: join(root, '.spark-data'),
      llm: new FakeModel([text('ok')]),
      ...resolveEngineSettings(settings),
    })
    try {
      expect(managed.mcpError).toBeTruthy()
      expect(managed.env.tools.registry.list().map((tool) => tool.name)).toContain('read')
    } finally {
      await managed.close()
    }
  })
})

async function settingsWith(root: string, toml: string) {
  await writeProjectConfig(root, toml)
  return loadSparkSettings({ cwd: root, sparkHome: join(root, 'home') })
}

function call(name: string, args: unknown): ResolvedToolCall {
  const definition = workspaceToolDefinitions.find((candidate) => candidate.name === name)
  if (!definition) throw new Error(`Missing tool definition: ${name}`)
  return { callId: `call-${name}`, name, args, definition }
}

function context(mode: 'manual' | 'auto' | 'bypass'): PermissionCheckContext {
  return { sessionId: 'session-1', mode, cwd: '/workspace' }
}
