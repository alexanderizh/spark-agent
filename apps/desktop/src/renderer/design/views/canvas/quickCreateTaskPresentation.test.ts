import { describe, expect, it } from 'vitest'
import { decodeCanvasSafeFileUrl } from './canvas-safe-file'
import {
  copyableTaskPrompt,
  isLocalInputPath,
  promptCoverFromTaskAssets,
  quickInputKindForPath,
  retryTaskRecord,
  selectQuickCreateInputPaths,
  textOutputCopyMeta,
} from './quickCreateTaskPresentation'

describe('quickCreateTaskPresentation 输入素材路径过滤', () => {
  it('图片模式只接收本地图片路径', () => {
    const selected = selectQuickCreateInputPaths(
      ['/Users/a/照片.PNG', '/Users/a/clip.mp4', '/Users/a/doc.pdf'],
      'image',
    )
    expect(selected).toEqual(['/Users/a/照片.PNG'])
  })

  it('视频模式接收图片与视频路径', () => {
    const selected = selectQuickCreateInputPaths(
      ['/Users/a/frame.jpg', '/Users/a/clip.MOV', '/Users/a/clip.avi'],
      'video',
    )
    expect(selected).toEqual(['/Users/a/frame.jpg', '/Users/a/clip.MOV'])
  })

  it('拒绝浏览器拖出的远程地址与 data URL', () => {
    const selected = selectQuickCreateInputPaths(
      ['https://cdn.example.com/a.png', 'data:image/png;base64,aaa', '/Users/a/real.png'],
      'image',
    )
    expect(selected).toEqual(['/Users/a/real.png'])
  })

  it('反推模式与图片模式共用同一套扩展名约束', () => {
    const selected = selectQuickCreateInputPaths(
      ['/Users/a/clip.mp4', '/Users/a/pic.webp'],
      'reverse',
    )
    expect(selected).toEqual(['/Users/a/pic.webp'])
  })

  it('识别本地绝对路径（含 Windows 盘符）', () => {
    expect(isLocalInputPath('/Users/a/x.png')).toBe(true)
    expect(isLocalInputPath('D:\\素材\\x.png')).toBe(true)
    expect(isLocalInputPath('https://a/b.png')).toBe(false)
    expect(isLocalInputPath('素材/x.png')).toBe(false)
  })

  it('按扩展名判断输入素材类型', () => {
    expect(quickInputKindForPath('/a/clip.mp4')).toBe('video')
    expect(quickInputKindForPath('/a/clip.WEBM')).toBe('video')
    expect(quickInputKindForPath('/a/pic.png')).toBe('image')
  })
})

describe('quickCreateTaskPresentation 提示词封面提取', () => {
  it('跳过视频产物，取第一张图片并编码为 safe-file 封面', () => {
    const cover = promptCoverFromTaskAssets([
      { type: 'video', filePath: '/tmp/a.mp4', mimeType: 'video/mp4' },
      { type: 'image', filePath: '/tmp/out.png', mimeType: 'image/png' },
      { type: 'image', previewDataUrl: 'data:image/jpeg;base64,small' },
    ])
    expect(cover).not.toBeNull()
    expect(cover?.mimeType).toBe('image/png')
    expect(decodeCanvasSafeFileUrl(cover?.url)).toBe('/tmp/out.png')
  })

  it('没有磁盘路径时回退小图 dataUrl，并沿用其 mime', () => {
    const cover = promptCoverFromTaskAssets([
      { type: 'image', previewDataUrl: 'data:image/jpeg;base64,small' },
    ])
    expect(cover).toEqual({ url: 'data:image/jpeg;base64,small', mimeType: 'image/jpeg' })
  })

  it('纯视频任务与不可解析的图片产物都返回 null', () => {
    expect(promptCoverFromTaskAssets([{ type: 'video', filePath: '/tmp/a.mp4' }])).toBeNull()
    expect(promptCoverFromTaskAssets([{ type: 'image' }])).toBeNull()
    expect(promptCoverFromTaskAssets([])).toBeNull()
  })

  it('图片产物缺失或异常 mime 时回退 image/png', () => {
    const cover = promptCoverFromTaskAssets([{ type: 'image', filePath: '/tmp/out' }])
    expect(cover).toEqual({ url: expect.stringContaining('safe-file://x/'), mimeType: 'image/png' })
  })
})

describe('quickCreateTaskPresentation 成功任务重试记录', () => {
  const baseTask = {
    id: 'task-a',
    mode: 'image' as const,
    operation: 'text_to_image' as const,
    prompt: '示例提示词',
    inputFiles: [],
    modelParams: {},
    status: 'succeeded' as const,
    assets: [{ type: 'image' as const, filePath: '/tmp/out.png' }],
    createdAt: '2026-09-14T00:00:00.000Z',
    updatedAt: '2026-09-14T00:00:00.000Z',
  }

  it('换新 id 与新创建时间，其余配置原样保留', () => {
    const retried = retryTaskRecord(baseTask)
    expect(retried.id).not.toBe(baseTask.id)
    expect(retried.id).toMatch(/^quick-create-/)
    expect(retried.createdAt).not.toBe(baseTask.createdAt)
    expect(retried.prompt).toBe(baseTask.prompt)
    expect(retried.modelParams).toBe(baseTask.modelParams)
    expect(retried.assets).toBe(baseTask.assets)
    expect(new Date(retried.createdAt).getTime()).not.toBeNaN()
  })

  it('连续两次重试生成不同 id', () => {
    expect(retryTaskRecord(baseTask).id).not.toBe(retryTaskRecord(baseTask).id)
  })
})

describe('quickCreateTaskPresentation 可复制的提示词', () => {
  it('普通任务复制用户输入的提示词', () => {
    expect(copyableTaskPrompt({ mode: 'image', prompt: ' 清晨窗边的静物 ' })).toEqual({
      label: '复制提示词',
      doneMessage: '提示词已复制',
      text: '清晨窗边的静物',
    })
  })

  it('反推任务优先复制反推产物，产物未回来时退回用户填写的补充要求', () => {
    expect(
      copyableTaskPrompt({ mode: 'reverse', prompt: '重点描述光线', text: '逆光下的柯基特写' }),
    ).toEqual({
      label: '复制反推提示词',
      doneMessage: '反推提示词已复制',
      text: '逆光下的柯基特写',
    })

    expect(copyableTaskPrompt({ mode: 'reverse', prompt: '重点描述光线', text: '  ' })).toEqual({
      label: '复制反推提示词',
      doneMessage: '反推提示词已复制',
      text: '重点描述光线',
    })
  })

  it('反推任务既无产物也无要求时不给复制入口', () => {
    expect(copyableTaskPrompt({ mode: 'reverse', prompt: '' })).toBeNull()
    expect(copyableTaskPrompt({ mode: 'image', prompt: '   ' })).toBeNull()
  })

  it('文本产物块的标题与复制提示按模式区分', () => {
    expect(textOutputCopyMeta('reverse')).toEqual({
      label: '反推提示词',
      doneMessage: '反推提示词已复制',
    })
    expect(textOutputCopyMeta('image')).toEqual({
      label: '文本输出',
      doneMessage: '文本输出已复制',
    })
  })
})
