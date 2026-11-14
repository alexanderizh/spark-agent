/**
 * 模型配置底部弹层（对齐设计稿）：模型列表 + 推理强度分段 + Options（权限入口）。
 *
 * 取代原先「模型 / 推理强度 / 权限」三个独立半屏面板：
 * 设计稿把三者收进同一张 sheet，点模型胶囊即可一次性调完。
 * 组件本身不写会话，选择后只抛事件，由页面决定 patch 哪一项：
 *   pickmodel { id }        id 形如 `${providerProfileId}::${modelId}`（'::' 后为空 = 渠道默认）
 *   pickeffort { index }    推理档位下标（对应 efforts[index].id）
 *   openpermission          权限行点击（页面自行打开权限列表 / 面板）
 *
 * 滚动：模型列表是可以滚的，底部「推理强度 / 权限」固定不滚。
 * scroll-view 必须有确定高度才滚动，所以每次打开（以及底栏内容变化）都量一次底栏高度，
 * 按 sheet 上限算出列表的 max-height（见 utils/config-sheet-layout）。
 */
import { computeConfigSheetBodyMax, resolveSafeBottom } from '../../utils/config-sheet-layout'

interface ConfigSheetModel {
  id: string
  label: string
  sub?: string
  checked?: boolean
}

interface ConfigSheetEffort {
  id: string
  label: string
}

Component({
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '模型' },
    models: { type: Array, value: [] as ConfigSheetModel[] },
    efforts: { type: Array, value: [] as ConfigSheetEffort[] },
    effortIndex: { type: Number, value: 0 },
    /** 权限当前值文案；空字符串 = 不显示 Options 段（助手不支持切换权限） */
    permissionLabel: { type: String, value: '' },
  },

  data: {
    /** 模型列表的 max-height（px）；0 = 还没量到，交给样式表兜底 */
    bodyMax: 0,
    /** 打开时滚到当前选中的模型，省得在几十个模型里翻 */
    scrollTarget: '',
  },

  observers: {
    // 只在「打开」这一下定位选中项：如果每次 pick 都重算，列表会跟着跳一下
    show(show: boolean) {
      if (!show) {
        this.setData({ scrollTarget: '' })
        return
      }
      const models = (this.data.models ?? []) as ConfigSheetModel[]
      const selected = models.findIndex((model) => model.checked === true)
      this.setData({ scrollTarget: selected >= 0 ? `cs-model-${selected}` : '' })
      this.measureBody()
    },

    // 打开状态下底栏内容变了（模型列表到达 / 出现权限行）要重新量
    'models, efforts, permissionLabel'() {
      if (!this.data.show) return
      this.measureBody()
    },
  },

  methods: {
    /**
     * 量底栏的实际高度，算出列表可用高度。
     *
     * 底栏随「推理强度 / 权限」是否出现而变高，所以不能写死；
     * 放到 nextTick 里量，等 sheet 这一帧渲染完节点才在。
     */
    measureBody() {
      const query = this.createSelectorQuery()
      if (query == null) return
      const run = () => {
        query.select('.cs-footer').boundingClientRect()
        query.exec((res) => {
          if (!this.data.show) return
          const rect = (res as Array<{ height?: number } | null> | undefined)?.[0]
          const footerHeight = rect != null && typeof rect.height === 'number' ? rect.height : 0
          const info =
            typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync()
          this.setData({
            bodyMax: computeConfigSheetBodyMax({
              windowWidth: info.windowWidth,
              windowHeight: info.windowHeight,
              safeBottom: resolveSafeBottom(info),
              footerHeight,
            }),
          })
        })
      }
      // 节点要在渲染之后才量得到；老版本没有 nextTick 就退化成下一轮事件循环
      if (typeof wx.nextTick === 'function') wx.nextTick(run)
      else setTimeout(run, 0)
    },

    noop() {
      /* 阻止蒙层点击冒泡 / 背景滚动穿透 */
    },

    onClose() {
      this.triggerEvent('close')
    },

    onPickModel(e: WechatMiniprogram.BaseEvent) {
      const id = e.currentTarget.dataset.id as string | undefined
      if (id == null) return
      this.triggerEvent('pickmodel', { id })
    },

    onPickEffort(e: WechatMiniprogram.BaseEvent) {
      const index = Number(e.currentTarget.dataset.index)
      if (!Number.isFinite(index)) return
      this.triggerEvent('pickeffort', { index })
    },

    onOpenPermission() {
      this.triggerEvent('openpermission')
    },
  },
})
