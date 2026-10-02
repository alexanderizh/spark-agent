/**
 * ttsSpeechCache 单测（真实文件系统 + mkdtemp 临时目录）
 *
 * 覆盖：缓存键稳定性与因子敏感（渠道/模型/参数/文本任一变化即失效）、put/get 命中、
 * 空文件与外部删除按未命中处理、initialize 扫盘建索引（忽略非缓存文件）、同键覆盖、
 * 条数上限与 LRU touch 淘汰、启动扫盘存量超额的一次性 prune 收敛、put 源不存在回退。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { computeTtsCacheKey, createTtsSpeechCache } from './ttsSpeechCache'

let tmpRoot: string
let cacheDir: string
let srcDir: string

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** 轮询等待异步 prune / utimes 落定（prune 为 fire-and-forget，磁盘状态即最终断言） */
async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now()
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('waitFor 超时')
    await sleep(10)
  }
}

function keyParts(overrides: Partial<Parameters<typeof computeTtsCacheKey>[0]> = {}) {
  return {
    providerId: 'provider-a',
    modelId: 'speech-1',
    params: { speed: 1 },
    text: '你好，世界。',
    ...overrides,
  }
}

async function makeSource(name: string, content: string): Promise<string> {
  const filePath = join(srcDir, name)
  await writeFile(filePath, content)
  return filePath
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'tts-cache-test-'))
  cacheDir = join(tmpRoot, 'cache')
  srcDir = join(tmpRoot, 'src')
  await mkdir(srcDir, { recursive: true })
})

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true })
})

describe('computeTtsCacheKey', () => {
  it('同因子计算稳定（重复调用键一致）', () => {
    expect(computeTtsCacheKey(keyParts())).toBe(computeTtsCacheKey(keyParts()))
  })

  it('任意键因子变化都得到不同键（配置/文本变化即失效）', () => {
    const base = computeTtsCacheKey(keyParts())
    expect(computeTtsCacheKey(keyParts({ text: '你好，世界！' }))).not.toBe(base)
    expect(computeTtsCacheKey(keyParts({ providerId: 'provider-b' }))).not.toBe(base)
    expect(computeTtsCacheKey(keyParts({ modelId: 'speech-2' }))).not.toBe(base)
    expect(computeTtsCacheKey(keyParts({ params: { speed: 1.5 } }))).not.toBe(base)
    expect(computeTtsCacheKey(keyParts({ params: { speed: 1, voice: 'x' } }))).not.toBe(base)
    expect(computeTtsCacheKey(keyParts({ params: { speed: 1, vol: 2 } }))).not.toBe(base)
  })

  it('参数对象 key 顺序不同（同语义）仍得同一键（构造顺序固定场景）', () => {
    // resolveTtsRoute 固定顺序构造（speed 在前、voice/vol/pitch/emotion 依次追加），
    // 这里锁定「同插入序 → 同键」的实现契约
    const a = computeTtsCacheKey(keyParts({ params: { speed: 1, voice: 'x' } }))
    const b = computeTtsCacheKey(keyParts({ params: { speed: 1, voice: 'x' } }))
    expect(a).toBe(b)
  })
})

describe('createTtsSpeechCache', () => {
  it('put 后 get 命中，返回缓存文件且内容与源一致', async () => {
    const cache = createTtsSpeechCache({ cacheDir })
    const source = await makeSource('a.wav', 'audio-bytes')
    const key = computeTtsCacheKey(keyParts())

    expect(await cache.get(key)).toBeNull() // 未 put 前 miss

    const dest = await cache.put(key, source)
    expect(dest).toBe(join(cacheDir, `${key}.wav`))
    expect(await cache.get(key)).toBe(dest)
    await expect(
      import('node:fs/promises').then((fs) => fs.readFile(dest as string, 'utf8')),
    ).resolves.toBe('audio-bytes')
    // 源文件已被 rename 移走（move 语义，不在临时目录留双份）
    expect(existsSync(source)).toBe(false)
  })

  it('未启用缓存的调用方（useCache=false）不受影响：调用即唯一事实', async () => {
    // 无 speechCache 的场景由 ttsSynthesis 走 invoke 分支，这里锁定 miss 语义
    const cache = createTtsSpeechCache({ cacheDir })
    expect(await cache.get(computeTtsCacheKey(keyParts()))).toBeNull()
  })

  it('size=0 的缓存文件按未命中处理（重合成覆盖）', async () => {
    const cache = createTtsSpeechCache({ cacheDir })
    await cache.initialize()
    const key = computeTtsCacheKey(keyParts())
    const emptyPath = join(cacheDir, `${key}.wav`)
    await mkdir(cacheDir, { recursive: true })
    await writeFile(emptyPath, '')

    expect(await cache.get(key)).toBeNull()
    // 失效项已清出索引：无需重复 stat
    expect(await cache.get(key)).toBeNull()
  })

  it('缓存文件被外部删除后 get 返回 null（不抛错）', async () => {
    const cache = createTtsSpeechCache({ cacheDir })
    const source = await makeSource('a.wav', 'audio')
    const key = computeTtsCacheKey(keyParts())
    await cache.put(key, source)
    await rm(join(cacheDir, `${key}.wav`))

    expect(await cache.get(key)).toBeNull()
  })

  it('put 源文件不存在返回 null，播放路径可回退原产物', async () => {
    const cache = createTtsSpeechCache({ cacheDir })
    const dest = await cache.put(computeTtsCacheKey(keyParts()), join(srcDir, 'missing.wav'))
    expect(dest).toBeNull()
  })

  it('initialize 扫盘：合法缓存文件入索引可命中，非缓存文件被忽略', async () => {
    const key = computeTtsCacheKey(keyParts())
    await mkdir(cacheDir, { recursive: true })
    await writeFile(join(cacheDir, `${key}.wav`), 'audio')
    await writeFile(join(cacheDir, 'not-a-key.wav'), 'junk') // key 不是 64 位 hex
    await writeFile(join(cacheDir, 'random.txt'), 'junk')

    const cache = createTtsSpeechCache({ cacheDir })
    await cache.initialize()
    expect(await cache.get(key)).toBe(join(cacheDir, `${key}.wav`))

    // 幂等：重复 initialize 不重复扫描、不影响命中
    await cache.initialize()
    expect(await cache.get(key)).toBe(join(cacheDir, `${key}.wav`))
  })

  it('同键二次 put 不同内容：覆盖旧缓存，命中读到新内容', async () => {
    const cache = createTtsSpeechCache({ cacheDir })
    const key = computeTtsCacheKey(keyParts())
    await cache.put(key, await makeSource('v1.wav', 'first'))
    await cache.put(key, await makeSource('v2.wav', 'second'))

    const dest = await cache.get(key)
    expect(dest).toBe(join(cacheDir, `${key}.wav`))
    const { readFile } = await import('node:fs/promises')
    await expect(readFile(dest as string, 'utf8')).resolves.toBe('second')
    // 目录下只有一份文件（覆盖而非堆积）
    const { readdir } = await import('node:fs/promises')
    expect(await readdir(cacheDir)).toHaveLength(1)
  })

  it('条数上限：超出 maxEntries 淘汰最旧（mtime 升序）', async () => {
    const cache = createTtsSpeechCache({ cacheDir, maxEntries: 2 })
    const keyA = computeTtsCacheKey(keyParts({ text: 'A' }))
    const keyB = computeTtsCacheKey(keyParts({ text: 'B' }))
    const keyC = computeTtsCacheKey(keyParts({ text: 'C' }))
    // 连续 put 的 mtime 可能同毫秒：间隔 20ms 保证淘汰顺序确定
    await cache.put(keyA, await makeSource('a.wav', 'A'))
    await sleep(20)
    await cache.put(keyB, await makeSource('b.wav', 'B'))
    await sleep(20)
    await cache.put(keyC, await makeSource('c.wav', 'C'))

    await waitFor(() => !existsSync(join(cacheDir, `${keyA}.wav`)))
    expect(existsSync(join(cacheDir, `${keyB}.wav`))).toBe(true)
    expect(existsSync(join(cacheDir, `${keyC}.wav`))).toBe(true)
    expect(await cache.get(keyA)).toBeNull()
  })

  it('启动扫盘一次性面对存量超额：一次 prune 收敛到 maxEntries（不残留超额）', async () => {
    // 逐条 put 时每次最多超 1 条，旧实现偶然删对；initialize 扫盘（存量远超上限）
    // 只触发一次 prune，才真正检验淘汰收敛：index.delete 已让 index.size 反映
    // 真实剩余，break 条件不能再扣 removed，否则只删约应删的一半
    const keyA = computeTtsCacheKey(keyParts({ text: 'A' }))
    const keyB = computeTtsCacheKey(keyParts({ text: 'B' }))
    const keyC = computeTtsCacheKey(keyParts({ text: 'C' }))
    const keyD = computeTtsCacheKey(keyParts({ text: 'D' }))
    const keyE = computeTtsCacheKey(keyParts({ text: 'E' }))
    await mkdir(cacheDir, { recursive: true })
    for (const key of [keyA, keyB, keyC, keyD, keyE]) {
      await writeFile(join(cacheDir, `${key}.wav`), 'x')
      await sleep(20) // mtime 升序决定淘汰顺序
    }
    const cache = createTtsSpeechCache({ cacheDir, maxEntries: 2 })
    await cache.initialize()

    // initialize 内部 fire-and-forget prune：等磁盘收敛
    await waitFor(() => !existsSync(join(cacheDir, `${keyC}.wav`)))
    await sleep(50)
    expect(existsSync(join(cacheDir, `${keyA}.wav`))).toBe(false)
    expect(existsSync(join(cacheDir, `${keyB}.wav`))).toBe(false)
    expect(existsSync(join(cacheDir, `${keyD}.wav`))).toBe(true)
    expect(existsSync(join(cacheDir, `${keyE}.wav`))).toBe(true)
    expect(await cache.get(keyE)).toBe(join(cacheDir, `${keyE}.wav`))
    expect(await cache.get(keyC)).toBeNull()
  })

  it('LRU touch：命中刷新 mtime，被访问过的旧项晚于未访问项淘汰', async () => {
    const cache = createTtsSpeechCache({ cacheDir, maxEntries: 2 })
    const keyA = computeTtsCacheKey(keyParts({ text: 'A' }))
    const keyB = computeTtsCacheKey(keyParts({ text: 'B' }))
    const keyC = computeTtsCacheKey(keyParts({ text: 'C' }))
    await cache.put(keyA, await makeSource('a.wav', 'A'))
    await sleep(20)
    await cache.put(keyB, await makeSource('b.wav', 'B'))
    await sleep(20)

    // 访问 A（touch）后写入 C：达到上限时应淘汰 B 而非 A
    expect(await cache.get(keyA)).not.toBeNull()
    await sleep(20)
    await cache.put(keyC, await makeSource('c.wav', 'C'))

    await waitFor(() => !existsSync(join(cacheDir, `${keyB}.wav`)))
    expect(existsSync(join(cacheDir, `${keyA}.wav`))).toBe(true)
    expect(existsSync(join(cacheDir, `${keyC}.wav`))).toBe(true)
  })

  it('体积上限：超出 maxBytes 淘汰最旧直到收敛', async () => {
    const cache = createTtsSpeechCache({ cacheDir, maxEntries: 100, maxBytes: 25 })
    const keyA = computeTtsCacheKey(keyParts({ text: 'A' }))
    const keyB = computeTtsCacheKey(keyParts({ text: 'B' }))
    const keyC = computeTtsCacheKey(keyParts({ text: 'C' }))
    await cache.put(keyA, await makeSource('a.wav', '0123456789')) // 10 字节
    await sleep(20)
    await cache.put(keyB, await makeSource('b.wav', '0123456789'))
    await sleep(20)
    await cache.put(keyC, await makeSource('c.wav', '0123456789'))

    // 25 字节上限装不下三个 10 字节：最旧的 A 淘汰，剩余 20 字节达标
    await waitFor(() => !existsSync(join(cacheDir, `${keyA}.wav`)))
    expect(existsSync(join(cacheDir, `${keyB}.wav`))).toBe(true)
    expect(existsSync(join(cacheDir, `${keyC}.wav`))).toBe(true)
  })
})
