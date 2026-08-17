import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SubAppFileStore } from '../SubAppFileStore'

/**
 * 子应用 files 域文件空间：路径逃逸防护、CRUD 语义与目录隔离。
 * 用真实临时目录验证 join+resolve 二次校验，不 mock 文件系统。
 */

const APP_A = '0b6f6c46-63f5-4a1e-8f74-9a92d68e6a11'
const APP_B = '1c7f7d57-74a6-4b2f-9a85-8bb3e79f7b22'

let root: string
let store: SubAppFileStore

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'subapp-files-'))
  store = new SubAppFileStore(root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('SubAppFileStore 路径安全', () => {
  it('拒绝 .. 逃逸路径', async () => {
    await expect(store.read(APP_A, '../escape.txt')).rejects.toThrow(/超出应用专属目录/)
    await expect(store.write(APP_A, 'a/../../escape.txt', 'x')).rejects.toThrow(/超出应用专属目录/)
    await expect(store.delete(APP_A, '../x')).rejects.toThrow(/超出应用专属目录/)
  })

  it('应用目录之间互相隔离', async () => {
    await store.write(APP_A, 'shared-name.txt', 'from-a')
    await expect(store.read(APP_B, 'shared-name.txt')).rejects.toThrow(/不存在/)
    expect((await store.read(APP_A, 'shared-name.txt')).content).toBe('from-a')
  })
})

describe('SubAppFileStore CRUD', () => {
  it('write→read 往返一致并自动建目录', async () => {
    const result = await store.write(APP_A, 'notes/deep/a.md', '# 你好')
    expect(result.byteLength).toBe(Buffer.byteLength('# 你好', 'utf8'))
    const read = await store.read(APP_A, 'notes/deep/a.md')
    expect(read.content).toBe('# 你好')
    expect(read.byteLength).toBe(result.byteLength)
  })

  it('read 不存在的文件返回 NOT_FOUND 语义错误', async () => {
    await expect(store.read(APP_A, 'missing.txt')).rejects.toThrow(/不存在/)
  })

  it('list 返回相对路径并支持前缀过滤，空目录返回空数组', async () => {
    const list1 = await store.list(APP_A)
    expect(list1.files).toEqual([])
    await store.write(APP_A, 'notes/a.md', 'a')
    await store.write(APP_A, 'notes/b.md', 'b')
    await store.write(APP_A, 'root.md', 'r')
    const all = await store.list(APP_A)
    expect(all.files.map((file) => file.path).sort()).toEqual([
      'notes/a.md',
      'notes/b.md',
      'root.md',
    ])
    const notes = await store.list(APP_A, 'notes/')
    expect(notes.files.map((file) => file.path)).toEqual(['notes/a.md', 'notes/b.md'])
    expect(notes.files[0]?.size).toBe(1)
  })

  it('delete 删除后 read 失败，重复 delete 报 NOT_FOUND', async () => {
    await store.write(APP_A, 'tmp.txt', 'x')
    await store.delete(APP_A, 'tmp.txt')
    await expect(store.read(APP_A, 'tmp.txt')).rejects.toThrow(/不存在/)
    await expect(store.delete(APP_A, 'tmp.txt')).rejects.toThrow(/不存在/)
  })

  it('removeApp 清空整个应用目录且幂等', async () => {
    await store.write(APP_A, 'a.txt', 'a')
    await store.write(APP_A, 'b/c.txt', 'c')
    await store.removeApp(APP_A)
    expect((await store.list(APP_A)).files).toEqual([])
    await store.removeApp(APP_A) // 不存在时静默成功
  })
})
