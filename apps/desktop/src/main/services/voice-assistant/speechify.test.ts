import { describe, expect, it } from 'vitest'
import {
  cleanInlineMarkdown,
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

  it('空文本返回空', () => {
    expect(speechifyText('')).toBe('')
  })
})

describe('SentenceSplitter', () => {
  it('中文句末标点切句', () => {
    const splitter = new SentenceSplitter()
    expect(splitter.push('你好。我是语音助手！')).toEqual(['你好。', '我是语音助手！'])
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

  it('换行是句边界', () => {
    const splitter = new SentenceSplitter()
    expect(splitter.push('第一行\n第二行\n')).toEqual(['第一行', '第二行'])
  })

  it('代码围栏内容不朗读，整块替换为省略句', () => {
    const splitter = new SentenceSplitter()
    const out = splitter.push('如下：\n```python\nprint("hello")\n```\n完毕。')
    expect(out).toEqual(['如下：', '（代码已省略，请在应用中查看）', '完毕。'])
    expect(splitter.flush()).toBe('')
  })

  it('未闭合围栏等待后续 delta，闭合后输出占位', () => {
    const splitter = new SentenceSplitter()
    expect(splitter.push('代码：\n```js\nconst x = 1;')).toEqual(['代码：'])
    expect(splitter.push('\n```\n结束。')).toEqual([
      '（代码已省略，请在应用中查看）',
      '结束。',
    ])
    expect(splitter.flush()).toBe('')
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

  it('纯符号句被过滤', () => {
    const splitter = new SentenceSplitter()
    expect(splitter.push('！！！？？？')).toEqual([])
  })
})

describe('splitSentences', () => {
  it('整段切分（isFinal 后权威切分入口）', () => {
    const out = splitSentences('第一点。第二点！第三点？')
    expect(out).toEqual(['第一点。', '第二点！', '第三点？'])
  })

  it('markdown 语法先清洗再切分', () => {
    const out = splitSentences('**重点**如下：\n```js\nx()\n```\n完成。')
    expect(out).toContain('重点如下：')
    expect(out).toContain('（代码已省略，请在应用中查看）')
  })
})
