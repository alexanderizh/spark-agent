/**
 * 会话分支横幅：展示「分支自《源会话》」与「N 个分支」入口。
 *
 * 当前会话是 fork 副本时显示来源（点击回父会话）；有子分支时显示数量
 * （点击展开分支列表）。两者都不满足时整体不渲染。
 * 跳转逻辑全部在页面侧（组件只出事件），保持组件无业务依赖。
 */

Component({
  properties: {
    /** fork 来源会话标题（空串 = 当前会话不是 fork 副本，隐藏来源半区） */
    sourceTitle: { type: String, value: '' },
    /** 直接子分支数（0 = 隐藏分支列表半区） */
    childCount: { type: Number, value: 0 },
  },

  methods: {
    onSourceTap() {
      this.triggerEvent('source')
    },

    onChildrenTap() {
      this.triggerEvent('children')
    },
  },
})
