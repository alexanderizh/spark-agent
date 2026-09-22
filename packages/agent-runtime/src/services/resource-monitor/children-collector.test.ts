/**
 * 子进程采集器单测（M1）：ps/PowerShell 输出解析、进程树遍历（含孤儿防环）、
 * kind 分类（注册表优先 / comm 启发式 / CLI 孙进程 agent-unknown）、
 * 治理口径汇总与 entries 截断、注册表对账。
 */
import { describe, it, expect } from 'vitest'
import {
  buildDescendantRows,
  classifyByComm,
  parsePsOutput,
  parseWindowsProcessOutput,
  summarizeRows,
} from './children-collector.js'
import { TrackedProcessRegistry } from './tracked-process-registry.js'

describe('parsePsOutput', () => {
  it('解析 pid/ppid/rss/comm 四列（comm 含空格路径完整保留）', () => {
    const rows = parsePsOutput(
      '  100     1   1024 /Applications/Claude.app/Contents/MacOS/claude\n  200   100    512 node',
    )
    expect(rows).toEqual([
      { pid: 100, ppid: 1, rssKb: 1024, comm: '/Applications/Claude.app/Contents/MacOS/claude' },
      { pid: 200, ppid: 100, rssKb: 512, comm: 'node' },
    ])
  })

  it('畸形行跳过不抛错（表头/空行/非数字）', () => {
    const rows = parsePsOutput(
      '  PID  PPID  RSS COMM\n\n    x     1     1 foo\n  300   100     abc bar',
    )
    // '300 100 abc bar' 的 rss 非数字 → 该行整行不匹配四列数字模式，跳过
    expect(rows).toEqual([])
  })

  it('rss 0/负值归 null（进程 RSS 缺测语义）', () => {
    const rows = parsePsOutput('  100     1     0 node')
    expect(rows[0]?.rssKb).toBeNull()
  })
})

describe('parseWindowsProcessOutput', () => {
  it('解析 Win32_Process 行并按 bytes→KB 归一', () => {
    const rows = parseWindowsProcessOutput('1234 100 1048576 node.exe')
    expect(rows).toEqual([{ pid: 1234, ppid: 100, rssKb: 1024, comm: 'node.exe' }])
  })
})

describe('classifyByComm 启发式', () => {
  it('claude/codex 家族可识别，node 不识别（交给父链）', () => {
    expect(classifyByComm('/usr/local/bin/claude')).toBe('claude-cli')
    expect(classifyByComm('CODEX.EXE')).toBe('codex-cli')
    expect(classifyByComm('codex-app-server')).toBe('codex-cli')
    expect(classifyByComm('node')).toBeNull()
    expect(classifyByComm('python3')).toBeNull()
  })
})

describe('buildDescendantRows', () => {
  it('从 rootPid 向下遍历，非后代进程排除', () => {
    const rows = [
      { pid: 1, ppid: 0, rssKb: 100, comm: 'launchd' },
      { pid: 100, ppid: 1, rssKb: 100, comm: 'app' }, // root
      { pid: 200, ppid: 100, rssKb: 100, comm: 'child-a' },
      { pid: 300, ppid: 200, rssKb: 100, comm: 'grandchild' },
      { pid: 400, ppid: 1, rssKb: 100, comm: 'unrelated' },
    ]
    const descendants = buildDescendantRows(rows, 100)
    expect(descendants.map((row) => row.pid).sort()).toEqual([200, 300])
  })

  it('环状 ppid 不死循环', () => {
    const rows = [
      { pid: 100, ppid: 300, rssKb: 1, comm: 'a' }, // root（自身成环）
      { pid: 200, ppid: 100, rssKb: 1, comm: 'b' },
      { pid: 300, ppid: 200, rssKb: 1, comm: 'c' },
    ]
    const descendants = buildDescendantRows(rows, 100)
    expect(descendants.map((row) => row.pid).sort()).toEqual([200, 300])
  })
})

describe('summarizeRows 汇总（纯函数，不依赖真实 ps）', () => {
  function makeTree() {
    const registry = new TrackedProcessRegistry()
    registry.register(500, 'mcp-bridge', 'session-1')
    const rows = [
      { pid: 100, ppid: 1, rssKb: 100_000, comm: 'app' }, // root（宿主，不计入）
      { pid: 200, ppid: 100, rssKb: 512_000, comm: '/usr/local/bin/claude' }, // claude-cli（治理）
      { pid: 300, ppid: 100, rssKb: 256_000, comm: 'codex' }, // codex-cli（治理）
      { pid: 310, ppid: 300, rssKb: 128_000, comm: 'node' }, // codex 孙进程 → agent-unknown（治理）
      { pid: 500, ppid: 100, rssKb: 64_000, comm: 'node' }, // 注册 mcp-bridge（非治理）
      { pid: 600, ppid: 100, rssKb: 32_000, comm: 'some-tool' }, // other（非治理）
      { pid: 700, ppid: 1, rssKb: 8_000, comm: 'unrelated' }, // 非后代（排除）
    ]
    return { registry, rows }
  }

  it('治理口径计数与 RSS 正确（claude + codex + agent-unknown = 3，不含 mcp 桥/other）', () => {
    const { registry, rows } = makeTree()
    const summary = summarizeRows(rows, { registry, rootPid: 100, maxEntries: 64 })
    expect(summary.totalCount).toBe(5)
    expect(summary.governedCount).toBe(3)
    expect(summary.governedRssBytes).toBe((512_000 + 256_000 + 128_000) * 1024)
    expect(summary.totalRssBytes).toBe((512_000 + 256_000 + 128_000 + 64_000 + 32_000) * 1024)
  })

  it('kind 分类：comm 启发式 + 注册表优先 + CLI 孙进程 agent-unknown', () => {
    const { registry, rows } = makeTree()
    const summary = summarizeRows(rows, { registry, rootPid: 100, maxEntries: 64 })
    const byPid = new Map(summary.entries.map((entry) => [entry.pid, entry]))
    expect(byPid.get(200)?.kind).toBe('claude-cli')
    expect(byPid.get(300)?.kind).toBe('codex-cli')
    expect(byPid.get(310)?.kind).toBe('agent-unknown')
    expect(byPid.get(310)?.governed).toBe(true)
    expect(byPid.get(500)?.kind).toBe('mcp-bridge') // 注册优先于 node 启发式
    expect(byPid.get(500)?.governed).toBe(false)
    expect(byPid.get(500)?.source).toBe('registry')
    expect(byPid.get(600)?.kind).toBe('other')
    expect(summary.byKind['agent-unknown']).toBe(1)
    expect(summary.registryTracked).toBe(1)
    expect(summary.sweepDiscovered).toBe(4)
  })

  it('entries 超限时按 RSS 取 top', () => {
    const { registry, rows } = makeTree()
    const summary = summarizeRows(rows, { registry, rootPid: 100, maxEntries: 2 })
    expect(summary.entries).toHaveLength(2)
    expect(summary.entries.map((entry) => entry.pid)).toEqual([200, 300]) // RSS top2
    // totalCount 不受截断影响
    expect(summary.totalCount).toBe(5)
  })

  it('无后代时返回空汇总并对账注册表', () => {
    const registry = new TrackedProcessRegistry()
    registry.register(999, 'codex-pool')
    const summary = summarizeRows([{ pid: 1, ppid: 0, rssKb: 1, comm: 'init' }], {
      registry,
      rootPid: 100,
      maxEntries: 64,
    })
    expect(summary.totalCount).toBe(0)
    expect(summary.entries).toEqual([])
  })
})

describe('TrackedProcessRegistry 对账', () => {
  it('连续 2 轮未见自动剔除（幽灵进程清理）', () => {
    const registry = new TrackedProcessRegistry()
    registry.register(111, 'codex-pool')
    expect(registry.reconcileWithObservedPids(new Set())).toEqual([])
    expect(registry.reconcileWithObservedPids(new Set())).toEqual([111])
    expect(registry.size).toBe(0)
  })

  it('中途再次观测到则计数清零', () => {
    const registry = new TrackedProcessRegistry()
    registry.register(111, 'codex-pool')
    registry.reconcileWithObservedPids(new Set())
    registry.reconcileWithObservedPids(new Set([111]))
    expect(registry.size).toBe(1)
  })
})
