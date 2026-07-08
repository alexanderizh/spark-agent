/**
 * 首页跑马灯展示的「已接入大模型平台」清单。
 *
 * - icon：与 apps/desktop 内 VENDOR_AVATAR_MAP 对齐，使用 @lobehub/icons 的 Mono 单色图标
 *   （官网为轻量静态站，不引入 antd / @lobehub/ui，故只用 Mono 而非彩色 Avatar）。
 * - color：品牌主色，用作卡片点缀（描边 / 光点），在单色图标基础上提供品牌识别度。
 * - model：该平台代表性的最新模型名（与 packages/protocol provider-presets 对齐）。
 */
export interface ShowcaseProvider {
  /** 对应 ProviderMarquee 中 @lobehub/icons 的导入键 */
  icon:
    | 'OpenAI'
    | 'Claude'
    | 'Gemini'
    | 'DeepSeek'
    | 'Grok'
    | 'Qwen'
    | 'Zhipu'
    | 'Moonshot'
    | 'Minimax'
    | 'Doubao'
    | 'Baidu'
    | 'Hunyuan'
    | 'IFlyTekCloud'
    | 'Ollama'
    | 'OpenRouter'
    | 'SiliconCloud'
  name: string
  model: string
  color: string
}

export const showcaseProviders: ShowcaseProvider[] = [
  { icon: 'OpenAI', name: 'OpenAI', model: 'GPT-5.5', color: '#10a37f' },
  { icon: 'Claude', name: 'Claude', model: 'Sonnet 4.6', color: '#d97757' },
  { icon: 'Gemini', name: 'Gemini', model: '2.5 Pro', color: '#4285f4' },
  { icon: 'DeepSeek', name: 'DeepSeek', model: 'V4 Flash', color: '#4d6bfe' },
  { icon: 'Grok', name: 'Grok', model: 'Grok 4', color: '#e7e9ea' },
  { icon: 'Qwen', name: '通义千问', model: 'Qwen3.7', color: '#6f42c1' },
  { icon: 'Zhipu', name: '智谱 GLM', model: 'GLM-5.2', color: '#3b5cff' },
  { icon: 'Moonshot', name: 'Kimi', model: 'K2.6', color: '#1a1a2e' },
  { icon: 'Minimax', name: 'MiniMax', model: 'M3', color: '#6c5ce7' },
  { icon: 'Doubao', name: '豆包', model: 'Seed 2.1', color: '#1a73e8' },
  { icon: 'Baidu', name: '百度文心', model: 'ERNIE 4.5', color: '#2932e1' },
  { icon: 'Hunyuan', name: '腾讯混元', model: 'Hunyuan T1', color: '#006eff' },
  { icon: 'IFlyTekCloud', name: '讯飞星火', model: 'Spark X2', color: '#1e88e5' },
  { icon: 'SiliconCloud', name: '硅基流动', model: '多模型聚合', color: '#7c3aed' },
  { icon: 'OpenRouter', name: 'OpenRouter', model: '300+ 模型', color: '#6d28d9' },
  { icon: 'Ollama', name: 'Ollama', model: '本地部署', color: '#6366f1' },
]
