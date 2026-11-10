/**
 * 胶囊输入框（Cursor 式全局输入）。
 *
 * mode=float  fixed 悬浮胶囊（首页快速发起，页面内容从其后滚过）
 * mode=dock   流式停靠（聊天页底部正常文档流）
 *
 * 键盘策略：两种模式统一关闭 adjust-position（原生整页上推在 float 模式下完全不生效、
 * 在 dock 模式下把输入框顶死在键盘上沿），改为监听 textarea 的 keyboardheightchange
 * 自行抬升：float 用内联 bottom 抬到键盘上方（安全区 padding 保留，输入区浮在键盘上沿，
 * 与首页同款）；dock 在组件尾部加等高占位把输入框顶起，
 * 页面消息区（flex:1）自动压缩，可边打字边看流式回复。keyboardchange 事件转发给页面，
 * 供页面收起底部安全区避免与键盘高度叠加出缝。
 *
 * 结构（对齐设计稿）：
 *   上半  输入区（textarea / 录音覆盖层）
 *   下半  工具条：+ 附件、模型胶囊（模型名 + 推理强度）、麦克风、发送 / 停止
 *   下方  其余配置 chips（助手 / 工作流 / 项目 / 标记），模型与权限收进模型胶囊
 *
 * 能力面：
 *   右侧圆形按钮  running 时为「停止」，否则输入非空（或已有上传完成的附件）时为「发送」
 *   麦克风        按住说话 → 松开触发 voicefile（页面层负责上传转写）
 *   加号          弹出附件菜单（页面层接管：照片 / 文件 / 技能 / 命令）
 *   模型胶囊      点开「模型 / 推理强度 / 权限」面板（modeltap 事件）
 *   命令补全      输入以 / 开头时浮出，点选填充
 */

interface ComposerAttachment {
  type: 'image' | 'file'
  path: string
  name: string
  /** 本地临时路径（图片上传前预览） */
  localPath?: string
  /** 桌面端落盘是否完成（未完成显示 loading，不可随消息提交） */
  uploaded: boolean
}

interface ComposerChip {
  key: string
  label: string
  value: string
}

interface ComposerCommand {
  key?: string
  name: string
  description: string
}

/** 模型胶囊：主值取 model chip，后缀取 reasoning chip（「电脑默认」时不显示后缀） */
interface ComposerModelChip {
  value: string
  effort: string
}

interface CapsuleComposerData {
  focus: boolean
  /** 组件内持有的实时文本（非受控：输入不经过页面回流，避免真机合成期打断/发送取旧值） */
  localValue: string
  /** 模型胶囊（输入框下方工具条内） */
  modelChip: ComposerModelChip
  /** 除模型/权限/推理外的配置 chips（助手/工作流/项目/标记） */
  extraChips: ComposerChip[]
  /** 键盘高度（px；0 = 收起）。float 抬 bottom / dock 加占位都以此为准 */
  keyboardHeight: number
  /** 有文字或已上传的附件即可发送（纯图片 / 纯文件消息） */
  canSend: boolean
}

/** 收进模型胶囊的 chip：不再在下方配置条重复出现 */
const MODEL_SHEET_CHIP_KEYS = ['model', 'permission', 'reasoning']

/** 录音管理器（微信全局单例；组件多实例复用同一份） */
let sharedRecorder: WechatMiniprogram.RecorderManager | null = null
let recorderBound = false
/** 当前持有录音的组件实例（回调事件转发目标；同屏只有一个输入框持有录音） */
let activeVoiceHost: WechatMiniprogram.Component.TrivialInstance | null = null

Component({
  properties: {
    value: { type: String, value: '' },
    mode: { type: String, value: 'float' },
    placeholder: { type: String, value: '随心输入，@ 引用文件，/ 使用命令' },
    /** 回合运行中：右侧按钮变为停止 */
    running: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    /** 配置条 chips */
    chips: {
      type: Array,
      value: [] as ComposerChip[],
      observer(chips: ComposerChip[]) {
        this.applyChips(chips)
      },
    },
    /** 附件条 */
    attachments: { type: Array, value: [] as ComposerAttachment[] },
    /** 命令补全列表（输入 / 前缀时显示；空数组隐藏） */
    commands: { type: Array, value: [] as ComposerCommand[] },
    /** 语音录制中（页面层驱动，覆盖输入框显示提示） */
    recording: { type: Boolean, value: false },
    /** 转写中 */
    transcribing: { type: Boolean, value: false },
  },

  data: {
    focus: false,
    localValue: '',
    modelChip: { value: '', effort: '' },
    extraChips: [],
    keyboardHeight: 0,
    canSend: false,
  } as CapsuleComposerData,

  observers: {
    /** 外部程序化设值（清空/语音合并/命令填充）才回写输入框；输入路径不回流 */
    value(next: string) {
      if (next !== this.data.localValue) {
        this.setData({ localValue: next })
      }
    },
    /** 发送按钮可用态：文字非空，或已有上传完成的附件（纯附件消息） */
    'localValue, attachments, running, disabled'(
      localValue: string,
      attachments: ComposerAttachment[],
      running: boolean,
      disabled: boolean,
    ) {
      const ready = (attachments ?? []).some((item) => item.uploaded === true)
      const canSend = !disabled && !running && (localValue.trim().length > 0 || ready)
      if (canSend !== this.data.canSend) this.setData({ canSend })
    },
  },

  lifetimes: {
    attached() {
      // 录音停止回调：把临时文件交给页面层（上传 → 转写 → 填输入框）。
      // getRecorderManager 是全局单例，回调只绑一次，事件转发到 activeVoiceHost。
      if (!recorderBound) {
        const recorder = wx.getRecorderManager()
        recorder.onStop((res: { tempFilePath: string; duration?: number }) => {
          activeVoiceHost?.triggerEvent('voicefile', {
            tempFilePath: res.tempFilePath,
            duration: res.duration ?? 0,
          })
        })
        recorder.onError(() => {
          activeVoiceHost?.triggerEvent('voiceerror', { message: '录音失败，请检查麦克风权限' })
        })
        sharedRecorder = recorder
        recorderBound = true
      }
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- 生命周期回调的 this 即组件实例，登记为全局录音单例的事件宿主
      activeVoiceHost = this
    },
    detached() {
      if (activeVoiceHost === this) activeVoiceHost = null
    },
  },

  methods: {
    /** chips 拆分：模型 + 推理合成胶囊，其余留下方配置条 */
    applyChips(chips: ComposerChip[]) {
      const list = chips ?? []
      const model = list.find((chip) => chip.key === 'model')
      const reasoning = list.find((chip) => chip.key === 'reasoning')
      this.setData({
        modelChip: {
          value: model?.value ?? '',
          effort: reasoning != null && reasoning.value !== '电脑默认' ? reasoning.value : '',
        },
        extraChips: list.filter((chip) => !MODEL_SHEET_CHIP_KEYS.includes(chip.key)),
      })
    },

    onInput(e: WechatMiniprogram.TextareaInput) {
      // 非受控：文本只在组件内更新，页面仅收通知（命令补全判断/语音合并用）
      this.setData({ localValue: e.detail.value })
      this.triggerEvent('input', { value: e.detail.value })
    },

    onFocus() {
      this.setData({ focus: true })
    },
    onBlur() {
      this.setData({ focus: false })
      // 兜底：个别机型键盘收起不回 keyboardheightchange(height=0)，失焦后短暂校验复位
      if (this.data.keyboardHeight > 0) {
        setTimeout(() => {
          if (!this.data.focus && this.data.keyboardHeight > 0) {
            this.setData({ keyboardHeight: 0 })
          }
        }, 400)
      }
    },

    /** 键盘高度变化：驱动 float 抬升 / dock 占位，并转发页面（收起安全区） */
    onKeyboardHeight(e: WechatMiniprogram.CustomEvent<{ height: number }>) {
      const height = Math.max(0, Math.round(e.detail.height ?? 0))
      this.setData({ keyboardHeight: height })
      this.triggerEvent('keyboardchange', { height })
    },

    onSend() {
      const value = (
        this as unknown as {
          properties: {
            running: boolean
            disabled: boolean
            attachments: ComposerAttachment[]
          }
        }
      ).properties
      if (value.running) {
        this.triggerEvent('stop')
        return
      }
      if (value.disabled) return
      const text = this.data.localValue.trim()
      // 纯图片 / 纯文件消息：无文字但已有落盘完成的附件时同样允许发送
      const hasReadyAttachments = (value.attachments ?? []).some((item) => item.uploaded === true)
      if (!text && !hasReadyAttachments) return
      this.triggerEvent('send', { value: text })
    },

    // ─── 配置 ────────────────────────────────────────────────────────────────

    onModelTap() {
      this.triggerEvent('modeltap')
    },

    onChipTap(e: WechatMiniprogram.BaseEvent) {
      const key = e.currentTarget.dataset.key as string | undefined
      if (key == null) return
      this.triggerEvent('chip', { key })
    },

    // ─── 附件 ─────────────────────────────────────────────────────────────────

    onAddAttachment() {
      this.triggerEvent('addattach')
    },

    onRemoveAttachment(e: WechatMiniprogram.BaseEvent) {
      const index = e.currentTarget.dataset.index as number | undefined
      if (index == null) return
      this.triggerEvent('removeattach', { index })
    },

    // ─── 语音（按住说话） ──────────────────────────────────────────────────────

    onVoiceStart() {
      if (sharedRecorder == null) return
      this.triggerEvent('voicestart')
      // 16k 单声道 mp3：桌面端 ffmpeg 解码链路的最佳兼容格式
      try {
        sharedRecorder.start({
          duration: 60_000,
          sampleRate: 16_000,
          numberOfChannels: 1,
          format: 'mp3',
          encodeBitRate: 48_000,
        })
      } catch {
        this.triggerEvent('voiceerror', { message: '录音启动失败' })
      }
    },

    onVoiceEnd() {
      if (sharedRecorder == null) return
      this.triggerEvent('voiceend')
      try {
        sharedRecorder.stop()
      } catch {
        /* 未在录音时忽略 */
      }
    },

    onVoiceCancel() {
      if (sharedRecorder == null) return
      this.triggerEvent('voiceend')
      try {
        sharedRecorder.stop()
      } catch {
        /* 未在录音时忽略 */
      }
    },

    // ─── 命令补全 ─────────────────────────────────────────────────────────────

    onCommandPick(e: WechatMiniprogram.BaseEvent) {
      const name = e.currentTarget.dataset.name as string | undefined
      if (name == null) return
      this.triggerEvent('commandpick', { name })
    },
  },
})
