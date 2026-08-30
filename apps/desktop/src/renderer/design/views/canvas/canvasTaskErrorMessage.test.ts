import { describe, expect, it } from 'vitest'
import { canvasTaskErrorMessage } from './canvasTaskErrorMessage'

describe('canvasTaskErrorMessage', () => {
  it('localizes the generic missing-provider error', () => {
    expect(canvasTaskErrorMessage('provider_not_configured', 'No media provider configured')).toBe(
      '请先在『模型 / Agent 配置』中添加可用模型',
    )
  })

  it('preserves actionable provider-specific diagnostics', () => {
    expect(
      canvasTaskErrorMessage(
        'provider_not_configured',
        'APIMart 图片超过 3 MiB 或来自本地文件，需要先登录 Spark',
      ),
    ).toBe('APIMart 图片超过 3 MiB 或来自本地文件，需要先登录 Spark')
  })

  it('preserves errors with other codes', () => {
    expect(canvasTaskErrorMessage('auth_required', '请登录 Spark 后重试')).toBe(
      '请登录 Spark 后重试',
    )
  })
})
