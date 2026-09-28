import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { FileMemoryStore } from '../../src/memory/store.js'

/**
 * 跨端读取语义固化（S0·E1/E2 证据链·engine 侧）。
 *
 * 依据 docs/plans/2026-09-25-memory-lifecycle-hardening-plan.md §3.2/S0：
 * 独立 CLI 的 FileMemoryStore 与桌面端零共享代码，契约只靠目录约定对齐 ——
 * 只扫共享目录下的 .md 文件，frontmatter 的 archived 字段是唯一归档信号。
 *
 * 桌面侧 repo.archive/repo.delete 不写回文件（反例已在
 * packages/agent-runtime/src/services/memory/memory-lifecycle.contract.test.ts
 * 用 it.fails 固化）：归档后残留文件的 frontmatter 仍是 archived:false，
 * 旧 CLI 照常加载注入 —— 跨端复活。本文件把 engine 侧"以文件为准"的读取
 * 语义固化为 documenting 测试（这是纯文件后端的既定设计，不是 engine 缺陷；
 * 修复责任在桌面侧 S1B：托管目录隔离 / 归档状态写回）。
 */
const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'spark-engine-mem-contract-'))
  roots.push(root)
  return root
}

describe('FileMemoryStore 跨端读取语义（S0 documenting）', () => {
  it('frontmatter archived:false 的文件即被加载（桌面归档/删除残留文件 → 旧 CLI 复活）', async () => {
    const root = await workspace()
    const home = join(root, 'memory-home')
    // 模拟桌面归档后的残留文件：DB 已归档，但文件 frontmatter 未写回
    await mkdir(join(home, 'memory', 'user'), { recursive: true })
    await writeFile(
      join(home, 'memory', 'user', 'usr_xdesktop1.md'),
      [
        '---',
        'id: usr_xdesktop1',
        'scope: user',
        'name: desktop-archived-remnant',
        'description: desktop archived this entry but file remains',
        'archived: false',
        '---',
        '',
        'Body that the standalone CLI will happily inject.',
      ].join('\n'),
      'utf-8',
    )

    const store = new FileMemoryStore({ cwd: root, homeDir: home })
    const entries = await store.list()

    // 语义固化：文件在 + frontmatter 未标归档 = 加载注入（无 DB 可查）
    expect(entries.map((e) => e.id)).toContain('usr_xdesktop1')
  })

  it('frontmatter archived:true 的文件被过滤（唯一归档信号来自文件本身）', async () => {
    const root = await workspace()
    const home = join(root, 'memory-home')
    await mkdir(join(home, 'memory', 'user'), { recursive: true })
    await writeFile(
      join(home, 'memory', 'user', 'usr_xdesktop2.md'),
      [
        '---',
        'id: usr_xdesktop2',
        'scope: user',
        'name: explicitly-archived',
        'description: archived in file frontmatter',
        'archived: true',
        '---',
        '',
        'Body.',
      ].join('\n'),
      'utf-8',
    )

    const store = new FileMemoryStore({ cwd: root, homeDir: home })
    const entries = await store.list()
    expect(entries.map((e) => e.id)).not.toContain('usr_xdesktop2')
  })

  it('save() 对同名条目更新时写回 archived:false（桌面归档状态可被旧 CLI 覆盖洗白）', async () => {
    const root = await workspace()
    const home = join(root, 'memory-home')
    await mkdir(join(home, 'memory', 'user'), { recursive: true })
    await writeFile(
      join(home, 'memory', 'user', 'usr_xdesktop3.md'),
      [
        '---',
        'id: usr_xdesktop3',
        'scope: user',
        'name: will-be-resaved',
        'description: archived in file frontmatter',
        'archived: true',
        '---',
        '',
        'Old body.',
      ].join('\n'),
      'utf-8',
    )

    const store = new FileMemoryStore({ cwd: root, homeDir: home })
    await store.save({
      scope: 'user',
      name: 'will-be-resaved',
      description: 'updated by standalone CLI',
      body: 'New body written by the standalone CLI.',
    })

    const entries = await store.list()
    expect(entries.map((e) => e.id)).toContain('usr_xdesktop3')
  })
})
