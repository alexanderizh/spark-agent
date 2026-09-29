// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import {
  quickCreateParamScope,
  readQuickCreateCustomSizeHistory,
  readQuickCreatePreferences,
  recordQuickCreateCustomSize,
  removeQuickCreateCustomSize,
  writeQuickCreatePreferences,
} from './quickCreatePreferences'

describe('quickCreatePreferences', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('保存并恢复模式、模型和按作用域隔离的参数选择', () => {
    const imageScope = quickCreateParamScope({
      operation: 'text_to_image',
      modelKey: 'provider/model-a',
      capabilityId: 'image.generate',
    })
    const videoScope = quickCreateParamScope({
      operation: 'text_to_video',
      modelKey: 'provider/model-a',
      capabilityId: 'video.generate',
    })

    writeQuickCreatePreferences({
      mode: 'image',
      modelKey: 'provider/model-a',
      textProviderId: 'vision-provider',
      textModelId: 'vision-model',
      taskView: 'grid',
      paramsByScope: {
        [imageScope]: { size: '1536x1024', n: '2' },
        [videoScope]: { durationSeconds: '8' },
      },
      customSizeHistoryByScope: {},
    })

    expect(readQuickCreatePreferences()).toEqual({
      mode: 'image',
      modelKey: 'provider/model-a',
      textProviderId: 'vision-provider',
      textModelId: 'vision-model',
      taskView: 'grid',
      paramsByScope: {
        [imageScope]: { size: '1536x1024', n: '2' },
        [videoScope]: { durationSeconds: '8' },
      },
      customSizeHistoryByScope: {},
    })
  })

  it('语音模式与语音筛选都能持久化并读回（白名单不得把 audio 丢掉）', () => {
    writeQuickCreatePreferences({ mode: 'audio', taskFilter: 'audio' })

    expect(readQuickCreatePreferences()).toEqual({
      mode: 'audio',
      taskFilter: 'audio',
      paramsByScope: {},
      customSizeHistoryByScope: {},
    })
  })

  it('忽略无效的偏好字段，损坏存储不会阻断页面初始化', () => {
    window.localStorage.setItem(
      'spark-canvas:quick-create-preferences:v1',
      JSON.stringify({
        mode: 'unknown',
        modelKey: 42,
        taskView: 'wallpaper',
        paramsByScope: { broken: null },
      }),
    )

    expect(readQuickCreatePreferences()).toEqual({
      paramsByScope: {},
      customSizeHistoryByScope: {},
    })

    window.localStorage.setItem('spark-canvas:quick-create-preferences:v1', '{bad-json')
    expect(readQuickCreatePreferences()).toEqual({})
  })

  it('记录、恢复并删除当前模型作用域下的自定义尺寸', () => {
    const scope = quickCreateParamScope({
      operation: 'text_to_image',
      modelKey: 'provider/model-a',
      capabilityId: 'image.generate',
    })

    recordQuickCreateCustomSize(scope, 'size', '1536x1024', ['1024x1024'])
    recordQuickCreateCustomSize(scope, 'size', '1:1', ['1024x1024'])
    recordQuickCreateCustomSize(scope, 'size', 'not-a-size', [])
    expect(readQuickCreateCustomSizeHistory(scope, 'size')).toEqual(['1:1', '1536x1024'])

    removeQuickCreateCustomSize(scope, 'size', '1:1')
    expect(readQuickCreateCustomSizeHistory(scope, 'size')).toEqual(['1536x1024'])
  })
})
