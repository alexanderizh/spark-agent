/**
 * 影视表演提示词库：表情 / 动作 / 情绪 / 对白状态（文档 §7.10）。
 *
 * 这些是「短语积木」，不是单独节点（文档注意点）。应用到分镜时写入
 * shot spec 或 prompt metadata，方便追踪来源。
 */

export type PerformancePromptCategory =
  | 'expression' // 表情
  | 'action' // 动作
  | 'emotion' // 情绪
  | 'dialogue_state' // 对白状态

export type PerformancePromptItem = {
  id: string
  label: string
  promptFragment: string
}

export type PerformancePromptGroup = {
  category: PerformancePromptCategory
  label: string
  items: PerformancePromptItem[]
}

export const PERFORMANCE_PROMPT_LIBRARY: PerformancePromptGroup[] = [
  {
    category: 'expression',
    label: '表情',
    items: [
      { id: 'expression.smile', label: '微笑', promptFragment: 'gentle smile' },
      { id: 'expression.smirk', label: '冷笑', promptFragment: 'smirking, sly smile' },
      { id: 'expression.shock', label: '震惊', promptFragment: 'shocked expression, wide eyes' },
      { id: 'expression.fear', label: '恐惧', promptFragment: 'terrified, fearful expression' },
      { id: 'expression.anger', label: '愤怒', promptFragment: 'angry, furious expression, clenched jaw' },
      { id: 'expression.cry', label: '哭泣', promptFragment: 'crying, tears streaming' },
      { id: 'expression.restrain', label: '隐忍', promptFragment: 'restrained emotion, suppressed feelings' },
      { id: 'expression.confused', label: '疑惑', promptFragment: 'confused, puzzled expression' },
      { id: 'expression.contempt', label: '轻蔑', promptFragment: 'contemptuous, disdainful look' },
    ],
  },
  {
    category: 'action',
    label: '动作',
    items: [
      { id: 'action.turn', label: '转身', promptFragment: 'turning around' },
      { id: 'action.look_up', label: '抬头', promptFragment: 'looking up' },
      { id: 'action.look_down', label: '低头', promptFragment: 'looking down' },
      { id: 'action.run', label: '奔跑', promptFragment: 'running fast' },
      { id: 'action.stop', label: '停步', promptFragment: 'stopping abruptly' },
      { id: 'action.glance_back', label: '回眸', promptFragment: 'glancing back over shoulder' },
      { id: 'action.reach', label: '伸手', promptFragment: 'reaching out hand' },
      { id: 'action.embrace', label: '拥抱', promptFragment: 'embracing, hugging' },
      { id: 'action.push_door', label: '推门', promptFragment: 'pushing door open' },
      { id: 'action.draw_sword', label: '拔剑', promptFragment: 'drawing sword' },
      { id: 'action.toast', label: '举杯', promptFragment: 'raising a toast, holding up cup' },
    ],
  },
  {
    category: 'emotion',
    label: '情绪',
    items: [
      { id: 'emotion.tense', label: '紧张', promptFragment: 'tense atmosphere' },
      { id: 'emotion.suppressed', label: '压抑', promptFragment: 'oppressive, heavy mood' },
      { id: 'emotion.tender', label: '温柔', promptFragment: 'tender, gentle mood' },
      { id: 'emotion.frantic', label: '疯狂', promptFragment: 'frantic, manic energy' },
      { id: 'emotion.despair', label: '绝望', promptFragment: 'despair, hopelessness' },
      { id: 'emotion.restrained', label: '克制', promptFragment: 'restrained, controlled emotion' },
      { id: 'emotion.hesitant', label: '犹豫', promptFragment: 'hesitant, uncertain' },
      { id: 'emotion.smug', label: '得意', promptFragment: 'smug, self-satisfied' },
    ],
  },
  {
    category: 'dialogue_state',
    label: '对白状态',
    items: [
      { id: 'dialogue.whisper', label: '低声说', promptFragment: 'whispering softly' },
      { id: 'dialogue.sobbing', label: '哽咽说', promptFragment: 'speaking while sobbing' },
      { id: 'dialogue.shout', label: '怒吼', promptFragment: 'shouting angrily' },
      { id: 'dialogue.murmur', label: '耳语', promptFragment: 'murmuring, hushed tone' },
      { id: 'dialogue.calm', label: '冷静陈述', promptFragment: 'speaking calmly, composed' },
      { id: 'dialogue.argue', label: '快速争辩', promptFragment: 'arguing rapidly, heated debate' },
    ],
  },
]

/** 把选中的表演 itemIds 合并成 prompt 片段 */
export function buildPerformancePromptFragment(itemIds: string[]): string {
  if (itemIds.length === 0) return ''
  const idSet = new Set(itemIds)
  const fragments: string[] = []
  for (const group of PERFORMANCE_PROMPT_LIBRARY) {
    for (const item of group.items) {
      if (idSet.has(item.id)) fragments.push(item.promptFragment)
    }
  }
  return fragments.join(', ')
}
