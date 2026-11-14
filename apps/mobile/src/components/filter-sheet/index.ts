/**
 * 多维筛选面板（受控组件）。
 *
 * 与 sheet-panel 的分工：那个是「单选即生效」的选择器；筛选需要**多选不关闭**、
 * 跨维度组合、随时清除，所以单独一个组件：
 *   - sections 由页面计算后传入（勾选态在页面）、组件只负责渲染与冒泡 toggle；
 *   - mode='multi' 点选项切换勾选、面板不关闭；mode='single' 同维度内互斥；
 *   - head 右侧「清除」清空全部维度（activeCount > 0 时才出现，「完成」恒在）。
 *
 * 维度语义由页面决定（见 utils/session-filters、utils/project-filters）。
 */

export interface FilterSheetOption {
  id: string
  label: string
  checked: boolean
  /** 选项副文案（项目根路径、设备原名等） */
  sub?: string
}

export interface FilterSheetSection {
  key: string
  label: string
  mode: 'multi' | 'single'
  options: FilterSheetOption[]
}

Component({
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '筛选' },
    sections: { type: Array, value: [] as FilterSheetSection[] },
    /** 当前命中多少条（加载完成才显示） */
    resultText: { type: String, value: '' },
    /** 激活维度数：> 0 时显示「清除」 */
    activeCount: { type: Number, value: 0 },
  },

  methods: {
    noop() {
      /* 阻止穿透滚动 */
    },

    onClose() {
      this.triggerEvent('close')
    },

    onToggle(e: WechatMiniprogram.CustomEvent) {
      const section = String(e.currentTarget.dataset.section ?? '')
      const id = String(e.currentTarget.dataset.id ?? '')
      if (section === '' || id === '') return
      this.triggerEvent('toggle', { section, id })
    },

    onReset() {
      this.triggerEvent('reset')
    },
  },
})
