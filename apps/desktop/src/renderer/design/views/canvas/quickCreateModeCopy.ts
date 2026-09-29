import type { QuickCreateMode } from './quickCreateTaskStore'

/**
 * 快速创作各模式的界面文案与交互开关。
 *
 * 单一事实来源：模式相关的说明、提示词区文案、生成按钮与空态引导都从这里取，
 * 避免每新增一个模式都要在视图里补一整条嵌套三元链（漏改就会出现「音乐模式
 * 显示语音文案」这类串味问题）。新增模式时 `Record` 类型会强制补齐所有字段。
 */
export interface QuickCreateModeCopy {
  /** 是否接受参考素材。语音 / 音乐是纯文本输入，没有素材语义。 */
  acceptsInputMaterials: boolean
  /** 是否要求恰好 1 个输入素材（反推、识别）。 */
  requiresSingleInput: boolean
  /** 模式 rail 下方的一句话说明；图片模式随素材数量变化。 */
  note: (inputCount: number) => string
  /** 提示词区标题。 */
  promptTitle: string
  /** 提示词区副标题。 */
  promptHint: string
  promptAriaLabel: string
  promptPlaceholder: string
  /** 提示词区底部说明。 */
  promptMeta: string
  /** 生成按钮文案。 */
  generateLabel: string
  /** 没有可用模型时的提示文案。 */
  noModelHint: string
  /** 空态是否给出「去配置」跳转（纯文本模式的模型只能来自渠道配置）。 */
  offersChannelSetup: boolean
}

const staticNote = (text: string) => () => text

export const QUICK_CREATE_MODE_COPY: Record<QuickCreateMode, QuickCreateModeCopy> = {
  image: {
    acceptsInputMaterials: true,
    requiresSingleInput: false,
    note: (inputCount) =>
      inputCount > 0 ? '已添加参考素材，当前按图像编辑处理' : '添加参考素材后自动切换为图像编辑',
    promptTitle: '提示词',
    promptHint: '描述主体、构图、光线与风格',
    promptAriaLabel: '提示词',
    promptPlaceholder: '描述主体、构图、光线和风格，例如：清晨窗边的产品静物，柔和侧光…',
    promptMeta: '建议先写清主体，再补充环境、构图和风格',
    generateLabel: '生成',
    noModelHint: '暂无匹配的已启用模型，请先到模型服务配置',
    offersChannelSetup: false,
  },
  reverse: {
    acceptsInputMaterials: true,
    requiresSingleInput: true,
    note: staticNote('上传 1 张图片，可补充文字要求，反推可编辑提示词'),
    promptTitle: '反推要求',
    promptHint: '可选 · 补充反推侧重点',
    promptAriaLabel: '反推补充要求',
    promptPlaceholder: '可选：补充反推侧重点，例如「重点描述人物服装与光线」，留空则输出完整提示词',
    promptMeta: '补充要求会与固定反推指令一起发送',
    generateLabel: '生成',
    noModelHint: '暂无匹配的已启用模型，请先到模型服务配置',
    offersChannelSetup: false,
  },
  video: {
    acceptsInputMaterials: true,
    requiresSingleInput: false,
    note: staticNote('可添加首帧或参考素材生成视频'),
    promptTitle: '提示词',
    promptHint: '描述主体、动作、镜头与氛围',
    promptAriaLabel: '提示词',
    promptPlaceholder: '描述主体、动作、镜头运动和时长，例如：雨夜街头，霓虹倒影，镜头缓慢推进…',
    promptMeta: '建议先写清主体，再补充环境、构图和风格',
    generateLabel: '生成',
    noModelHint: '暂无匹配的已启用模型，请先到模型服务配置',
    offersChannelSetup: false,
  },
  audio: {
    acceptsInputMaterials: false,
    requiresSingleInput: false,
    note: staticNote('输入文稿，选择合适的音色后合成语音'),
    promptTitle: '文稿',
    promptHint: '这里填写要朗读的内容本身，不做提示词改写',
    promptAriaLabel: '语音文稿',
    promptPlaceholder:
      '输入要转换为语音的文稿，例如：欢迎收听今天的早间资讯，我们先看一条来自产品团队的消息…',
    promptMeta: '文稿会原样送入语音合成，标点与换行会影响停顿',
    generateLabel: '生成语音',
    noModelHint: '暂无已启用的语音模型，请先配置 TTS 渠道',
    offersChannelSetup: true,
  },
  music: {
    acceptsInputMaterials: false,
    requiresSingleInput: false,
    note: staticNote('输入描述与歌词，生成可直接播放的音乐'),
    promptTitle: '音乐描述',
    promptHint: '描述风格、情绪、场景与乐器；歌词与纯音乐开关在参数面板里设置',
    promptAriaLabel: '音乐描述',
    promptPlaceholder:
      '描述你想要的音乐，例如：轻快的电子流行，夏日海边的午后，女声哼唱，带海浪与吉他分解和弦…',
    promptMeta: '描述会作为音乐生成提示词；需要成曲歌词时在参数面板补歌词',
    generateLabel: '生成音乐',
    noModelHint: '暂无已启用的音乐模型，请先配置音乐生成渠道',
    offersChannelSetup: true,
  },
  transcribe: {
    acceptsInputMaterials: true,
    requiresSingleInput: true,
    note: staticNote('选择 1 个音频文件，转写为可复制的文本'),
    promptTitle: '补充说明',
    promptHint: '可选 · 纠正专有名词的拼写提示，帮助提高识别准确率',
    promptAriaLabel: '识别补充说明',
    promptPlaceholder:
      '可选：纠正专有名词提示，例如「包含产品名 SparkWork 与人名张阳」，留空直接识别',
    promptMeta: '补充说明仅用于纠正识别结果中的专有名词，不影响音频内容',
    generateLabel: '开始识别',
    noModelHint: '暂无已启用的语音识别模型，请先配置语音识别渠道',
    offersChannelSetup: true,
  },
}

export function quickCreateModeCopy(mode: QuickCreateMode): QuickCreateModeCopy {
  return QUICK_CREATE_MODE_COPY[mode]
}
