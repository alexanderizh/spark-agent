export function buildPromptOptimizationInstruction(
  prompt: string,
  negativePrompt: string,
  requirement?: string,
): string {
  const sections = [
    '请把下面的提示词优化为适合影视/多媒体生成模型使用的专业提示词。',
    '要求：保留原意，直接输出优化后的提示词本身，不要解释过程，不要加多余的前后缀说明。',
  ]
  if (requirement?.trim()) {
    sections.push(`本次优化的具体要求：${requirement.trim()}`)
  } else {
    sections.push('补充主体、场景、镜头语言、光影、风格、质量要求。')
  }
  sections.push(`原提示词：\n${prompt.trim()}`)
  if (negativePrompt.trim()) {
    sections.push(`反向提示词：\n${negativePrompt.trim()}`)
  }
  return sections.join('\n\n')
}

export function appendPromptFragment(current: string, fragment: string): string {
  const clean = fragment.trim()
  if (!clean) return current
  const base = current.trimEnd()
  return base ? `${base}\n${clean}` : clean
}
