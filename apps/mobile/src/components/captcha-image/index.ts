/**
 * 图片验证码展示组件。
 *
 * 服务端返回 data:image/svg+xml;base64,...（edu-server captcha.service.ts）。
 * <image> 组件对 SVG data URI 的支持在不同端上不一致，这里做两级降级：
 *   1. 直接用 data URI；
 *   2. binderror 时把 base64 写入 USER_DATA_PATH 本地文件，改用本地路径（绝大多数端可渲染）；
 *   3. 仍失败则展示重试占位。
 */

Component({
  properties: {
    /** data:image/svg+xml;base64,... */
    svg: {
      type: String,
      value: '',
    },
    /** 验证码 id（变化即视为换了一张新图） */
    captchaId: {
      type: String,
      value: '',
    },
  },

  data: {
    localPath: '',
    useLocal: false,
    failed: false,
  },

  observers: {
    'svg, captchaId': function (svg: string, captchaId: string) {
      if (!captchaId) return
      this.setData({ localPath: '', useLocal: false, failed: false })
      void svg
    },
  },

  methods: {
    onImageError() {
      if (this.data.useLocal || this.data.failed) {
        this.setData({ failed: true })
        return
      }
      const svg = this.data.svg || ''
      const match = /^data:image\/svg\+xml;base64,(.+)$/.exec(svg)
      if (!match) {
        this.setData({ failed: true })
        return
      }
      const filePath = `${wx.env.USER_DATA_PATH}/captcha-${Date.now()}.svg`
      try {
        wx.getFileSystemManager().writeFile({
          filePath,
          data: match[1],
          encoding: 'base64',
          success: () => this.setData({ localPath: filePath, useLocal: true }),
          fail: () => this.setData({ failed: true }),
        })
      } catch {
        this.setData({ failed: true })
      }
    },

    onTap() {
      this.triggerEvent('refresh')
    },
  },
})
