import { describe, expect, it } from 'vitest'
import { BUILTIN_AVATARS } from '../builtinAvatars'
import {
  parseAutoRouterWorkerIndex,
  resolveAutoRouterWorkerAvatarId,
  resolveAutoRouterWorkerName,
} from './auto-router-display'

/**
 * AutoRouter 一次性 worker 的身份解析：worker id 形如
 * autorouter:{routerId}:{turnId}:{index}，不入 Agent 表——渲染端按尾段序号
 * 推导「子任务 N」+ 内置动物头像（同轮不重复、跨轮同序号稳定）。
 */

describe('parseAutoRouterWorkerIndex', () => {
  it.each([
    ['autorouter:r1:t1:0', 0],
    ['autorouter:router:turn:3', 3],
    ['autorouter:r:t:12', 12],
  ])('%s → %i', (id, expected) => {
    expect(parseAutoRouterWorkerIndex(id)).toBe(expected)
  })

  it.each([
    ['member-1'],
    ['autorouter:r:t:abc'],
    ['autorouter:r:t:-1'],
    ['autorouter:r:t:01'],
    ['autorouter:r:t:'],
    [''],
  ])('非法 id %s → null', (id) => {
    expect(parseAutoRouterWorkerIndex(id)).toBeNull()
  })
})

describe('resolveAutoRouterWorkerName', () => {
  it('事件 workerName 优先', () => {
    expect(resolveAutoRouterWorkerName('autorouter:r:t:0', '子任务1')).toBe('子任务1')
  })

  it('workerName 缺省/空白 → 按 id 序号回退「子任务 N」', () => {
    expect(resolveAutoRouterWorkerName('autorouter:r:t:0')).toBe('子任务1')
    expect(resolveAutoRouterWorkerName('autorouter:r:t:2', '  ')).toBe('子任务3')
    expect(resolveAutoRouterWorkerName('autorouter:r:t:2', undefined)).toBe('子任务3')
  })

  it('非 autorouter worker → null（普通成员不受影响）', () => {
    expect(resolveAutoRouterWorkerName('member-1', '随便')).toBeNull()
  })
})

describe('resolveAutoRouterWorkerAvatarId', () => {
  const animalIds = BUILTIN_AVATARS.filter((avatar) => avatar.category === 'animal').map(
    (avatar) => avatar.id,
  )

  it('同轮不同序号 → 动物池内互不重复', () => {
    const ids = [0, 1, 2, 3, 4].map(
      (index) => resolveAutoRouterWorkerAvatarId(`autorouter:r:t:${index}`)!,
    )
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(animalIds).toContain(id)
  })

  it('跨轮同序号 → 稳定同款头像', () => {
    const first = resolveAutoRouterWorkerAvatarId('autorouter:r1:t1:0')
    const second = resolveAutoRouterWorkerAvatarId('autorouter:r2:t2:0')
    expect(first).toBe(second)
  })

  it('非 autorouter worker → null', () => {
    expect(resolveAutoRouterWorkerAvatarId('member-1')).toBeNull()
  })
})
