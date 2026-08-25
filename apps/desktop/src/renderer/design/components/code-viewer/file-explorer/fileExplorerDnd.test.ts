import { describe, expect, it } from 'vitest'
import {
  FILE_EXPLORER_NODE_MIME,
  hasFileExplorerNodeDrag,
  isAcceptableMoveTarget,
  readFileExplorerNodeDragPayload,
  setActiveDragRelPath,
  writeFileExplorerNodeDragPayload,
} from './fileExplorerDnd'

/** node 环境无 DataTransfer：用等价 stub（setData/getData/types/effectAllowed），同 session-reference-dnd.test */
function createDataTransfer(): DataTransfer {
  const values = new Map<string, string>()
  return {
    effectAllowed: 'none',
    getData: (format: string) => values.get(format) ?? '',
    setData: (format: string, value: string) => {
      values.set(format, value)
    },
    get types() {
      return Array.from(values.keys())
    },
  } as unknown as DataTransfer
}

const PAYLOAD = {
  relPath: 'apps/desktop/src',
  absPath: '/work/Spark/apps/desktop/src',
  name: 'src',
  type: 'directory',
} as const

describe('fileExplorerDnd payload', () => {
  it('写入 → 读回 round-trip，且带 text/plain 兜底与 copyMove', () => {
    const dt = createDataTransfer()
    writeFileExplorerNodeDragPayload(dt, { ...PAYLOAD })
    expect(dt.effectAllowed).toBe('copyMove')
    expect(dt.types).toContain(FILE_EXPLORER_NODE_MIME)
    expect(dt.getData('text/plain')).toBe(PAYLOAD.absPath)
    expect(readFileExplorerNodeDragPayload(dt)).toEqual({ ...PAYLOAD })
  })

  it('hasFileExplorerNodeDrag 按 MIME 类型判定', () => {
    const dt = createDataTransfer()
    expect(hasFileExplorerNodeDrag(dt)).toBe(false)
    writeFileExplorerNodeDragPayload(dt, { ...PAYLOAD })
    expect(hasFileExplorerNodeDrag(dt)).toBe(true)
  })

  it('缺字段 / 非法类型 / 坏 JSON 一律返回 null（防外部伪造）', () => {
    const bad = createDataTransfer()
    bad.setData(FILE_EXPLORER_NODE_MIME, JSON.stringify({ relPath: 'src' }))
    expect(readFileExplorerNodeDragPayload(bad)).toBeNull()

    const badType = createDataTransfer()
    badType.setData(FILE_EXPLORER_NODE_MIME, JSON.stringify({ ...PAYLOAD, type: 'symlink' }))
    expect(readFileExplorerNodeDragPayload(badType)).toBeNull()

    const badJson = createDataTransfer()
    badJson.setData(FILE_EXPLORER_NODE_MIME, '{not-json')
    expect(readFileExplorerNodeDragPayload(badJson)).toBeNull()

    expect(readFileExplorerNodeDragPayload(null)).toBeNull()
  })
})

describe('isAcceptableMoveTarget（不能移到自身 / 子孙目录）', () => {
  it('无拖拽上下文时不拦截（drop 侧兜底校验）', () => {
    setActiveDragRelPath(null)
    expect(isAcceptableMoveTarget('apps')).toBe(true)
  })

  it('目标为源自身或其子孙 → 拒绝', () => {
    setActiveDragRelPath('apps/desktop')
    expect(isAcceptableMoveTarget('apps/desktop')).toBe(false)
    expect(isAcceptableMoveTarget('apps/desktop/src')).toBe(false)
    expect(isAcceptableMoveTarget('apps/desktopification')).toBe(true) // 前缀相同但非子孙
  })

  it('其余目录 → 允许；dragend 清除后恢复默认', () => {
    setActiveDragRelPath('apps/desktop')
    expect(isAcceptableMoveTarget('')).toBe(true)
    expect(isAcceptableMoveTarget('build')).toBe(true)
    setActiveDragRelPath(null)
    expect(isAcceptableMoveTarget('apps/desktop')).toBe(true)
  })
})
