import { describe, expect, it } from 'vitest'
import type { WorkspaceTreeEntry } from '@spark/protocol'
import {
  ROOT_PATH,
  computeVisiblePaths,
  parentPath,
  pathDepth,
  toExplorerNode,
  type FileExplorerNode,
} from './fileExplorerTypes'

describe('pathDepth', () => {
  it('root 为 0，顶级为 1，逐层 +1', () => {
    expect(pathDepth(ROOT_PATH)).toBe(0)
    expect(pathDepth('src')).toBe(1)
    expect(pathDepth('src/main')).toBe(2)
    expect(pathDepth('apps/desktop/src/main')).toBe(4)
  })
})

describe('toExplorerNode 深度推导（展开目录缩进回归）', () => {
  const entry = (path: string, type: 'file' | 'directory', depth: number): WorkspaceTreeEntry =>
    ({
      path,
      name: path.split('/').pop() ?? path,
      type,
      depth,
      childrenCount: 1,
    }) as WorkspaceTreeEntry

  it('忽略后端请求相对 depth，按 path 推导真实层级', () => {
    // 场景：展开 apps/desktop/src 时 reloadDir 传 path + maxDepth:1，
    // 后端返回子项 depth=0（相对请求起点），旧实现直接透传导致无缩进
    const node = toExplorerNode(entry('apps/desktop/src/main', 'directory', 0))
    expect(node.depth).toBe(4)
    expect(node.path).toBe('apps/desktop/src/main')
  })

  it('反斜杠路径归一为 posix 后再推导', () => {
    const node = toExplorerNode(entry('apps\\desktop\\build', 'directory', 0))
    expect(node.path).toBe('apps/desktop/build')
    expect(node.depth).toBe(3)
  })
})

describe('computeVisiblePaths 与深度的一致性', () => {
  it('可见节点的深度 = 父节点深度 + 1（缩进正确性的数据前提）', () => {
    const mk = (path: string, type: 'file' | 'directory'): FileExplorerNode => ({
      path,
      name: path.split('/').pop() ?? path,
      type,
      depth: pathDepth(path),
      ...(type === 'directory' ? { hasChildren: true } : {}),
    })
    const nodes = new Map<string, FileExplorerNode>([
      [ROOT_PATH, { path: ROOT_PATH, name: '', type: 'directory', depth: 0, hasChildren: true }],
      ['apps', mk('apps', 'directory')],
      ['apps/desktop', mk('apps/desktop', 'directory')],
      ['apps/desktop/src', mk('apps/desktop/src', 'directory')],
      ['apps/desktop/src/main.ts', mk('apps/desktop/src/main.ts', 'file')],
      ['build', mk('build', 'directory')],
      ['build/out.js', mk('build/out.js', 'file')],
    ])
    const visible = computeVisiblePaths(
      nodes,
      new Set(['apps', 'apps/desktop', 'apps/desktop/src', 'build']),
    )
    for (const p of visible) {
      const node = nodes.get(p)
      if (node == null) continue
      if (p.includes('/')) {
        expect(node.depth).toBe(nodes.get(parentPath(p))!.depth + 1)
      } else {
        expect(node.depth).toBe(1)
      }
    }
  })
})
