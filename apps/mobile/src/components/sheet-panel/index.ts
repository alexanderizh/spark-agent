/**
 * 半屏选择面板（通用）。
 *
 * mode=list   单选列表：勾选态高亮，点选即生效并回调 select
 * mode=slider 滑块调节：推理强度等档位（用户偏好滑块交互，不用分段选择器）
 */

interface SheetOption {
  id: string
  label: string
  sub?: string
  checked?: boolean
  disabled?: boolean
}

interface SheetPanelData {
  sliderMax: number
  sliderLabel: string
  sliderTicks: string[]
}

Component({
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '选择' },
    mode: { type: String, value: 'list' },
    options: { type: Array, value: [] as SheetOption[] },
    loading: { type: Boolean, value: false },
    emptyText: { type: String, value: '' },
    /** slider 模式：档位值数组（如 ['minimal','low',...]） */
    sliderOptions: { type: Array, value: [] as string[] },
    /** slider 模式：当前档位下标 */
    sliderIndex: { type: Number, value: 0 },
  },

  data: {
    sliderMax: 0,
    sliderLabel: '',
    sliderTicks: [] as string[],
  } as SheetPanelData,

  observers: {
    'sliderOptions, sliderIndex'(options: string[], index: number) {
      this.setData({
        sliderMax: Math.max(options.length - 1, 0),
        sliderLabel: options[index] ?? '',
        sliderTicks: options,
      })
    },
  },

  methods: {
    noop() {
      /* 阻止冒泡/穿透滚动 */
    },

    onClose() {
      this.triggerEvent('close')
    },

    onSelect(e: WechatMiniprogram.CustomEvent<{ id: string; disabled: boolean }>) {
      if (e.currentTarget.dataset.disabled === true) return
      const id = e.currentTarget.dataset.id
      if (id == null) return
      this.triggerEvent('select', { id })
    },

    onSliderChanging(e: WechatMiniprogram.SliderChange) {
      const options = (this as unknown as { properties: { sliderOptions: string[] } }).properties
        .sliderOptions
      this.setData({ sliderLabel: options[e.detail.value] ?? '' })
    },

    onSliderChange(e: WechatMiniprogram.SliderChange) {
      this.triggerEvent('sliderchange', { index: e.detail.value })
    },
  },
})
