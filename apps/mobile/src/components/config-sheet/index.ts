/**
 * 模型配置底部弹层（对齐设计稿）：模型列表 + 推理强度分段 + Options（权限入口）。
 *
 * 取代原先「模型 / 推理强度 / 权限」三个独立半屏面板：
 * 设计稿把三者收进同一张 sheet，点模型胶囊即可一次性调完。
 * 组件本身不写会话，选择后只抛事件，由页面决定 patch 哪一项：
 *   pickmodel { id }        id 形如 `${providerProfileId}::${modelId}`（'::' 后为空 = 渠道默认）
 *   pickeffort { index }    推理档位下标（对应 efforts[index].id）
 *   openpermission          权限行点击（页面自行打开权限列表 / 面板）
 */

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

  methods: {
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
