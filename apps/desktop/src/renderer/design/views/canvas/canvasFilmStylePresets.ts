import type { FilmColorSwatch, FilmProductionBible, FilmStylePreset } from './canvasFilmTypes'

export type BuiltInFilmStylePack = {
  id: string
  name: string
  description: string
  tags: string[]
  visualStyle: string
  promptFragment: string
  negativePrompt: string
  palette: FilmColorSwatch[]
  aspectRatio: string
  modelParams?: Record<string, unknown>
  suitableFor?: string[]
}

export const BUILTIN_FILM_STYLE_PACKS: BuiltInFilmStylePack[] = [
  {
    id: 'neo-noir-cinematic',
    name: '霓虹黑色电影',
    description: '高反差夜景、霓虹边缘光、冷暖撞色，适合悬疑 / 都市科幻。',
    tags: ['电影感', '悬疑', '赛博'],
    visualStyle:
      'cinematic neo-noir, high contrast, neon rim light, wet streets, realistic texture',
    promptFragment:
      'cinematic neo-noir lighting, teal and magenta neon palette, high contrast, shallow depth of field',
    negativePrompt:
      'inconsistent style, flat lighting, low contrast, oversaturated skin, text, watermark, logo, deformed face',
    palette: [
      { name: '深蓝黑', hex: '#08111f', weight: 0.4 },
      { name: '霓虹青', hex: '#22d3ee', weight: 0.28 },
      { name: '洋红', hex: '#d946ef', weight: 0.2 },
      { name: '暖橙点光', hex: '#f59e0b', weight: 0.12 },
    ],
    aspectRatio: '16:9',
    modelParams: { stylePack: 'neo-noir-cinematic' },
    suitableFor: ['短剧', '悬疑', '科幻'],
  },
  {
    id: 'warm-period-drama',
    name: '暖调年代剧',
    description: '柔和胶片颗粒、暖黄室内光、低饱和服化道，适合年代 / 情感剧。',
    tags: ['年代', '胶片', '温暖'],
    visualStyle:
      'warm period drama, soft film grain, practical tungsten light, muted wardrobe, realistic set design',
    promptFragment:
      'warm tungsten lighting, soft film grain, muted earth-tone palette, realistic period drama production design',
    negativePrompt:
      'modern objects, harsh digital look, oversharp, neon cyberpunk, text, watermark, logo, inconsistent costume',
    palette: [
      { name: '暖棕', hex: '#8b5e34', weight: 0.35 },
      { name: '钨丝黄', hex: '#f2c078', weight: 0.25 },
      { name: '米白', hex: '#e8dcc2', weight: 0.25 },
      { name: '暗绿灰', hex: '#596451', weight: 0.15 },
    ],
    aspectRatio: '2.39:1',
    modelParams: { stylePack: 'warm-period-drama' },
    suitableFor: ['年代剧', '家庭', '情感'],
  },
]

export function stylePackToPreset(pack: BuiltInFilmStylePack): FilmStylePreset {
  return {
    id: `builtin_${pack.id}`,
    kind: 'production',
    name: pack.name,
    description: pack.description,
    promptItemIds: [],
    promptFragment: pack.promptFragment,
    palette: pack.palette,
    negativePrompt: pack.negativePrompt,
    aspectRatio: pack.aspectRatio,
    ...(pack.modelParams ? { modelParams: pack.modelParams } : {}),
  }
}

export function stylePackToProductionBible(pack: BuiltInFilmStylePack): FilmProductionBible {
  return {
    source: 'preset',
    visualStyle: pack.visualStyle,
    colorPalette: pack.palette,
    negativePrompt: pack.negativePrompt,
    aspectRatio: pack.aspectRatio,
    ...(pack.modelParams ? { defaultModelParams: pack.modelParams } : {}),
    colorMood: pack.promptFragment,
  }
}
