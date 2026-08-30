/**
 * ProviderMarquee — 首页「已接入主流大模型平台」跑马灯。
 *
 * - 两行反向无限滚动（CSS marquee），每项 = 品牌色点缀 + @lobehub/icons Mono 图标 + 名称 + 最新模型。
 * - 边缘渐隐遮罩、hover 暂停、prefers-reduced-motion 静态降级。
 * - 官网为轻量静态站，只用 Mono 单色图标（零 antd 依赖）；品牌色作为点缀提供识别度。
 */
import {
  OpenAI,
  Claude,
  Gemini,
  DeepSeek,
  Grok,
  Qwen,
  Zhipu,
  Moonshot,
  Minimax,
  Doubao,
  Baidu,
  Hunyuan,
  IFlyTekCloud,
  Ollama,
  OpenRouter,
  SiliconCloud,
} from '@lobehub/icons'
import { showcaseProviders, type ShowcaseProvider } from '../content/providers'

const ICONS: Record<ShowcaseProvider['icon'], React.ComponentType<{ size?: number }>> = {
  OpenAI,
  Claude,
  Gemini,
  DeepSeek,
  Grok,
  Qwen,
  Zhipu,
  Moonshot,
  Minimax,
  Doubao,
  Baidu,
  Hunyuan,
  IFlyTekCloud,
  Ollama,
  OpenRouter,
  SiliconCloud,
}

function ProviderCard({ provider }: { provider: ShowcaseProvider }) {
  const Icon = ICONS[provider.icon]
  return (
    <span
      className="pmq-card"
      style={{ '--brand': provider.color } as React.CSSProperties}
    >
      <span className="pmq-icon">
        <Icon size={18} />
      </span>
      <span className="pmq-name">{provider.name}</span>
      <span className="pmq-sep" aria-hidden="true" />
      <span className="pmq-model">{provider.model}</span>
    </span>
  )
}

function MarqueeRow({ items, direction }: { items: ShowcaseProvider[]; direction: 'left' | 'right' }) {
  // 复制一份以保证无缝循环（track 平移 -50%）
  const loop = [...items, ...items]
  return (
    <div className={`pmq-row pmq-${direction}`}>
      <div className="pmq-track">
        {loop.map((p, i) => (
          <ProviderCard key={`${p.icon}-${i}`} provider={p} />
        ))}
      </div>
    </div>
  )
}

export function ProviderMarquee() {
  const half = Math.ceil(showcaseProviders.length / 2)
  const rowA = showcaseProviders.slice(0, half)
  const rowB = showcaseProviders.slice(half)
  return (
    <div className="pmq" aria-label="已接入的大模型平台">
      <MarqueeRow items={rowA} direction="left" />
      <MarqueeRow items={rowB} direction="right" />
    </div>
  )
}
