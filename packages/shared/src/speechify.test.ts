import { describe, expect, it } from 'vitest'
import {
  cleanInlineMarkdown,
  hasMeaningfulVoiceText,
  isDegenerateVoiceTranscript,
  SentenceSplitter,
  speechifyText,
  splitSentences,
} from './speechify.js'

describe('cleanInlineMarkdown', () => {
  it('剥除粗斜体与行内代码标记但保留内容', () => {
    expect(cleanInlineMarkdown('这是**重点**和`code`的内容')).toBe('这是重点和code的内容')
  })

  it('链接保留文字剥除语法，图片保留 alt 文本（空 alt 用占位）', () => {
    expect(cleanInlineMarkdown('见[文档](https://example.com)与![截图](x.png)')).toBe(
      '见文档与截图',
    )
    expect(cleanInlineMarkdown('看这张![](x.png)图')).toBe('看这张（图片）图')
  })

  it('剥除标题/列表/引用行首标记', () => {
    expect(cleanInlineMarkdown('## 标题\n- 项目一\n> 引用')).toBe('标题\n项目一\n引用')
  })

  it('裸 URL 替换为提示', () => {
    expect(cleanInlineMarkdown('详情见 https://example.com/a?b=1 谢谢')).toBe(
      '详情见 （链接见应用） 谢谢',
    )
  })
})

describe('speechifyText', () => {
  it('代码块整体替换为省略占位', () => {
    const out = speechifyText('看这段：\n```ts\nconst a = 1\n```\n就这些。')
    expect(out).toContain('（代码已省略，请在应用中查看）')
    expect(out).not.toContain('const a = 1')
    expect(out).toContain('就这些。')
  })

  it('表格整体替换为省略占位', () => {
    const out = speechifyText('对比如下：\n| a | b |\n| --- | --- |\n| 1 | 2 |\n完成。')
    expect(out).toContain('（表格已省略，请在应用中查看）')
    expect(out).not.toContain('| a | b |')
  })

  it('超长文本截断并提示', () => {
    const long = '这是一段很长的内容。'.repeat(120)
    const out = speechifyText(long)
    expect(out.length).toBeLessThanOrEqual(900)
    expect(out).toContain('完整回复请在应用中查看')
  })

  it('maxChars 放宽上限：默认 800 截断的内容在放宽后完整保留', () => {
    const long = '这是一段很长的内容。'.repeat(120)
    const out = speechifyText(long, 5000)
    expect(out).not.toContain('完整回复请在应用中查看')
    expect(out.length).toBeGreaterThan(800)
  })

  it('maxChars 收紧上限：按更小预算截断', () => {
    const long = '这是一段很长的内容。'.repeat(120)
    const out = speechifyText(long, 60)
    expect(out.length).toBeLessThanOrEqual(120)
    expect(out).toContain('完整回复请在应用中查看')
  })

  it('maxChars 非法值（0/负数/小数）收敛为可用下限', () => {
    const text = '第一句。第二句。'
    expect(speechifyText(text, 0)).toBe(speechifyText(text, 3))
    expect(speechifyText(text, -5)).toBe(speechifyText(text, 3))
    expect(speechifyText(text, 10.9)).toBe(speechifyText(text, 10))
  })

  it('空文本返回空', () => {
    expect(speechifyText('')).toBe('')
  })
})

describe('SentenceSplitter', () => {
  it('中文句末标点切句（低于最短句长的短句并入下一句）', () => {
    const splitter = new SentenceSplitter()
    expect(splitter.push('你好。我是语音助手！')).toEqual(['你好。我是语音助手！'])
    expect(splitter.push('这是一段正常长度的句子。后面还有一句正常长度的话。')).toEqual([
      '这是一段正常长度的句子。',
      '后面还有一句正常长度的话。',
    ])
  })

  it('增量 delta 跨 chunk 切句', () => {
    const splitter = new SentenceSplitter()
    expect(splitter.push('今天天气')).toEqual([])
    expect(splitter.push('不错，')).toEqual([])
    expect(splitter.push('适合写代码。继续')).toEqual(['今天天气不错，适合写代码。'])
    expect(splitter.flush()).toBe('继续')
  })

  it('英文句点后接空白才切句（小数不切）', () => {
    const splitter = new SentenceSplitter()
    const out = splitter.push('Pi is 3.14 exactly. Next sentence here.')
    expect(out).toEqual(['Pi is 3.14 exactly.'])
  })

  it('换行是句边界：短行内容跨行合并（不丢弃）', () => {
    const splitter = new SentenceSplitter()
    expect(splitter.push('第一行\n第二行\n')).toEqual(['第一行第二行'])
    expect(splitter.push('足够长的一行文本\n足够长的第二行\n')).toEqual([
      '足够长的一行文本',
      '足够长的第二行',
    ])
  })

  it('代码围栏内容不朗读，整块替换为省略句（短尾句 flush 补出）', () => {
    const splitter = new SentenceSplitter()
    const out = splitter.push('如下：\n```python\nprint("hello")\n```\n完毕。')
    expect(out).toEqual(['如下：', '（代码已省略，请在应用中查看）'])
    expect(splitter.flush()).toBe('完毕。')
  })

  it('未闭合围栏等待后续 delta，闭合后输出占位', () => {
    const splitter = new SentenceSplitter()
    expect(splitter.push('代码：\n```js\nconst x = 1;')).toEqual(['代码：'])
    expect(splitter.push('\n```\n结束。')).toEqual(['（代码已省略，请在应用中查看）'])
    expect(splitter.flush()).toBe('结束。')
  })

  it('flush 时未闭合围栏输出省略句', () => {
    const splitter = new SentenceSplitter()
    splitter.push('看这个\n```ts\nconsole.log(1)')
    expect(splitter.flush()).toBe('（代码已省略，请在应用中查看）')
  })

  it('低于最短长度的碎片并入下一句', () => {
    const splitter = new SentenceSplitter()
    const out = splitter.push('好。这里继续说更多内容。')
    expect(out).toEqual(['好。这里继续说更多内容。'])
  })

  it('连续碎句超过等待上限强制放行（防无限合并）', () => {
    const splitter = new SentenceSplitter()
    // 三个 2 字碎句：前两次并入等待，第三次边界强制出句
    const out = splitter.push('好。嗯。哦。后面是正常句子。')
    expect(out).toEqual(['好。嗯。哦。', '后面是正常句子。'])
  })

  it('叠标点归一为单一边界（不在中间断句）', () => {
    const splitter = new SentenceSplitter()
    // 「真的吗？！」「嗯…好吧。」均低于最短句长 → 与前句合并后出句
    expect(splitter.push('这太惊人了！！！真的吗？！嗯…好吧。')).toEqual([
      '这太惊人了！！！',
      '真的吗？！嗯…好吧。',
    ])
  })

  it('长句软切：无句末边界超过 80 字在最近逗号处切', () => {
    const splitter = new SentenceSplitter()
    const longNoBoundary = '这是一段没有任何句末标点的超长文本'.repeat(5) // 75 字无边界
    const withComma = `${'这是一段没有句末标点的超长文本'.repeat(4)}，后半段还有内容继续攒。`
    const out = splitter.push(`${longNoBoundary}${withComma}`)
    const tail = splitter.flush()
    const all = [...out, ...(tail.length > 0 ? [tail] : [])]
    expect(all.length).toBeGreaterThanOrEqual(2)
    for (const sentence of all) {
      expect(sentence.length).toBeLessThanOrEqual(125)
    }
  })

  it('长句硬切：完全无边界超过 120 字强制切（残留留缓冲等 flush）', () => {
    const splitter = new SentenceSplitter()
    const giant = '中英混合无标点长串'.repeat(20) // 180 字无任何边界
    const out = splitter.push(giant)
    expect(splitter.bufferedChars).toBe(60) // 180 - 120 硬切后残留
    const tail = splitter.flush()
    const all = [...out, ...(tail.length > 0 ? [tail] : [])]
    expect(all.length).toBe(2)
    expect(all[0]?.length).toBeLessThanOrEqual(122)
    expect(all[1]?.length).toBeLessThanOrEqual(122)
  })

  it('forceTake 强制取句：不等边界整体出句、尾部补句号', () => {
    const splitter = new SentenceSplitter()
    splitter.push('好的没问题，我现在就')
    expect(splitter.bufferedChars).toBeGreaterThan(0)
    const taken = splitter.forceTake()
    expect(taken).toBe('好的没问题，我现在就。')
    expect(splitter.bufferedChars).toBe(0)
    // 取空后再 forceTake 返回 null
    expect(splitter.forceTake()).toBeNull()
  })

  it('forceTake 已有终止符不重复补句号', () => {
    const splitter = new SentenceSplitter()
    splitter.push('完成了！') // 4 字低于最短句长 → 滞留缓冲
    expect(splitter.forceTake()).toBe('完成了！')
  })

  it('forceTake 围栏未闭合时跳过快切，围栏闭合后的正文不被吞（回归）', () => {
    const splitter = new SentenceSplitter()
    // 回复以代码围栏开头、首句快切在围栏闭合前触发：
    // 若此时清掉围栏状态伪造占位句，后续闭合围栏会被误判为新开围栏，
    // 围栏之后的全部正文都会被当代码吞掉
    splitter.push('```ts\nconst x = 1;')
    expect(splitter.forceTake()).toBeNull()
    const out = splitter.push('\n```\n围栏后面是正经正文。')
    expect(out).toContain('（代码已省略，请在应用中查看）')
    expect(out).toContain('围栏后面是正经正文。')
  })

  it('纯符号句被过滤', () => {
    const splitter = new SentenceSplitter()
    expect(splitter.push('！！！？？？')).toEqual([])
  })
})

describe('splitSentences', () => {
  it('整段切分（isFinal 后权威切分入口；短句按最短句长合并）', () => {
    const out = splitSentences('第一点。第二点！第三点？')
    expect(out).toEqual(['第一点。第二点！', '第三点？'])
    expect(splitSentences('这是第一句完整内容。这是第二句完整内容！')).toEqual([
      '这是第一句完整内容。',
      '这是第二句完整内容！',
    ])
  })

  it('markdown 语法先清洗再切分（整段清洗已预替换围栏，短前缀并入占位句）', () => {
    const out = splitSentences('**重点**如下：\n```js\nx()\n```\n完成。')
    expect(out).toContain('重点如下：（代码已省略，请在应用中查看）')
    expect(out).toContain('完成。')
  })
})

describe('hasMeaningfulVoiceText', () => {
  it('纯标点/空白/符号判为无正文（噪音硬解的典型产出）', () => {
    expect(hasMeaningfulVoiceText('。')).toBe(false)
    expect(hasMeaningfulVoiceText('，。！？…—')).toBe(false)
    expect(hasMeaningfulVoiceText('  \n\t ')).toBe(false)
    expect(hasMeaningfulVoiceText('')).toBe(false)
  })

  it('含字母/数字/文字即有效（含混合标点）', () => {
    expect(hasMeaningfulVoiceText('嗯。')).toBe(true)
    expect(hasMeaningfulVoiceText('。你好')).toBe(true)
    expect(hasMeaningfulVoiceText('hello world')).toBe(true)
    expect(hasMeaningfulVoiceText('3.14 是圆周率')).toBe(true)
    expect(hasMeaningfulVoiceText('。。。嗯。')).toBe(true)
  })
})

describe('isDegenerateVoiceTranscript', () => {
  it('纯语气字碎片（≤4 有效字全为退化语气字）判为退化', () => {
    // 日志实锤的幻影形态：鼠标点击被 ASR 解成「我 我」
    expect(isDegenerateVoiceTranscript('我 我')).toBe(true)
    expect(isDegenerateVoiceTranscript('嗯嗯 嗯')).toBe(true)
    expect(isDegenerateVoiceTranscript('嗯，啊，哦。')).toBe(true)
    expect(isDegenerateVoiceTranscript('的了了了')).toBe(true)
    // 标点/空白剥离后计入：语气字 + 大量标点仍命中
    expect(isDegenerateVoiceTranscript('呃。。。啊？？')).toBe(true)
  })

  it('真实短答/短句放行（好/对/行/可以/数字/一 绝不进集合）', () => {
    expect(isDegenerateVoiceTranscript('好的')).toBe(false)
    expect(isDegenerateVoiceTranscript('对')).toBe(false)
    expect(isDegenerateVoiceTranscript('行')).toBe(false)
    expect(isDegenerateVoiceTranscript('可以')).toBe(false)
    expect(isDegenerateVoiceTranscript('一')).toBe(false)
    expect(isDegenerateVoiceTranscript('1')).toBe(false)
    expect(isDegenerateVoiceTranscript('第1个')).toBe(false)
    expect(isDegenerateVoiceTranscript('嗯，好的')).toBe(false) // 好 不在集合
    expect(isDegenerateVoiceTranscript('是的')).toBe(false)
    expect(isDegenerateVoiceTranscript('你好')).toBe(false)
    expect(isDegenerateVoiceTranscript('停止')).toBe(false)
  })

  it('超长或含非语气字内容的转写不判退化', () => {
    expect(isDegenerateVoiceTranscript('')).toBe(false)
    expect(isDegenerateVoiceTranscript('。！！')).toBe(false) // 无有效字走 hasMeaningfulVoiceText 路径
    expect(isDegenerateVoiceTranscript('嗯嗯嗯嗯嗯嗯')).toBe(false) // 6 字超出上限
    expect(isDegenerateVoiceTranscript('帮我查下日程')).toBe(false)
    expect(isDegenerateVoiceTranscript('ok')).toBe(false) // 字母不在集合
    expect(isDegenerateVoiceTranscript('嗯 ok')).toBe(false)
  })
})
