import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { resolvePastedImageRootDir } from './pastedImageStorage.js'

const PATHS = {
  userDataPath: path.join(
    '/',
    'Users',
    'tester',
    'Library',
    'Application Support',
    '@spark',
    'desktop',
  ),
  canvasMediaDir: path.join('/', 'Users', 'tester', 'Documents', 'spark-canvas-media'),
}

describe('resolvePastedImageRootDir', () => {
  it('无项目根 / 非 canvas：落 userData/attachments/pasted-images 持久目录（不再放 temp）', () => {
    expect(resolvePastedImageRootDir({}, PATHS)).toBe(
      path.join(PATHS.userDataPath, 'attachments', 'pasted-images'),
    )
  })

  it('storageScope=temp 显式传 temp 也落持久目录：消息记录长期引用，不能被周期清理', () => {
    expect(resolvePastedImageRootDir({ storageScope: 'temp' }, PATHS)).toBe(
      path.join(PATHS.userDataPath, 'attachments', 'pasted-images'),
    )
  })

  it('storageScope=canvas：落画布媒体目录', () => {
    expect(resolvePastedImageRootDir({ storageScope: 'canvas' }, PATHS)).toBe(PATHS.canvasMediaDir)
  })

  it('提供项目根：落项目 assets/images', () => {
    expect(
      resolvePastedImageRootDir({ projectRootPath: path.join('/', 'work', 'demo') }, PATHS),
    ).toBe(path.join('/', 'work', 'demo', 'assets', 'images'))
  })

  it('projectRootPath 仅空白时按无项目处理', () => {
    expect(resolvePastedImageRootDir({ projectRootPath: '   ' }, PATHS)).toBe(
      path.join(PATHS.userDataPath, 'attachments', 'pasted-images'),
    )
  })
})
