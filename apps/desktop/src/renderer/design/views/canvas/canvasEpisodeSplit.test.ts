import { describe, expect, it } from 'vitest'
import {
  formatSplitEpisodeScreenplayText,
  parseSplitEpisodesOutput,
  splitEpisodeNodeTitle,
} from './canvasEpisodeSplit'

describe('parseSplitEpisodesOutput', () => {
  it('parses a plain episodes JSON object', () => {
    const text = JSON.stringify({
      episodes: [
        {
          episodeNo: 1,
          title: '风起',
          openingHook: '雨夜敲门',
          mainConflict: '林岚与老板对峙',
          endingSuspense: '钥匙不见了',
          script: '第1场｜内景｜茶馆｜夜\n\n林岚：还有空房吗？',
        },
        {
          episodeNo: 2,
          title: '暗涌',
          script: '第1场｜内景｜茶馆｜日\n\n老板擦拭杯子。',
        },
      ],
    })

    const episodes = parseSplitEpisodesOutput(text)
    expect(episodes).toHaveLength(2)
    expect(episodes[0]).toMatchObject({
      episodeNo: 1,
      title: '风起',
      openingHook: '雨夜敲门',
      endingSuspense: '钥匙不见了',
    })
    expect(episodes[1]).toMatchObject({ episodeNo: 2, openingHook: '' })
  })

  it('parses episodes wrapped in a fenced code block and fills missing episode numbers', () => {
    const text =
      '以下是分集结果：\n\n```json\n{"episodes":[{"title":"风起","script":"第1场｜内景｜茶馆｜夜\\n\\n林岚进门。"},{"episodeNo":5,"title":"暗涌","script":"第1场｜内景｜茶馆｜日\\n\\n老板擦杯子。"}]}\n```'
    const episodes = parseSplitEpisodesOutput(text)

    expect(episodes).toHaveLength(2)
    expect(episodes[0]?.episodeNo).toBe(1)
    expect(episodes[1]?.episodeNo).toBe(5)
  })

  it('falls back to splitting plain text by 第X集 heading lines', () => {
    const text = [
      '本剧共两集。',
      '',
      '第1集：风起',
      '第1场｜内景｜茶馆｜夜',
      '',
      '林岚：还有空房吗？',
      '',
      '## 第十二集｜暗涌',
      '第1场｜内景｜茶馆｜日',
      '',
      '老板擦拭杯子。',
    ].join('\n')

    const episodes = parseSplitEpisodesOutput(text)
    expect(episodes).toHaveLength(2)
    expect(episodes[0]).toMatchObject({
      episodeNo: 1,
      title: '风起',
      script: '本剧共两集。\n\n第1场｜内景｜茶馆｜夜\n\n林岚：还有空房吗？',
    })
    expect(episodes[1]).toMatchObject({ episodeNo: 12, title: '暗涌' })
  })

  it('supports EPISODE N headings without an episode number gap', () => {
    const text = 'EPISODE 1 - 风起\n第1场｜内景｜茶馆｜夜\n\n林岚进门。\n\nEPISODE 2 - 暗涌\n第1场｜外景｜街口｜日\n\n雨停了。'
    const episodes = parseSplitEpisodesOutput(text)

    expect(episodes.map((episode) => episode.episodeNo)).toEqual([1, 2])
    expect(episodes[0]?.title).toBe('风起')
    expect(episodes[1]?.title).toBe('暗涌')
  })

  it('returns an empty array for plain screenplay prose without episode headings', () => {
    expect(parseSplitEpisodesOutput('第1场｜内景｜茶馆｜夜\n\n林岚：还有空房吗？')).toEqual([])
    expect(parseSplitEpisodesOutput('')).toEqual([])
  })

  it('ignores JSON items without script content', () => {
    const text = JSON.stringify({
      episodes: [{ episodeNo: 1, title: '空集' }, { episodeNo: 2, title: '风起', script: '第1场｜内景｜茶馆｜夜' }],
    })

    expect(parseSplitEpisodesOutput(text)).toHaveLength(1)
    expect(parseSplitEpisodesOutput(text)[0]?.title).toBe('风起')
  })
})

describe('split episode formatting', () => {
  it('renders the node title with episode number and name', () => {
    expect(splitEpisodeNodeTitle({ episodeNo: 3, title: '风起', openingHook: '', mainConflict: '', endingSuspense: '', script: '正文' })).toBe('第3集｜风起')
    expect(splitEpisodeNodeTitle({ episodeNo: 3, title: '  ', openingHook: '', mainConflict: '', endingSuspense: '', script: '正文' })).toBe('第3集')
  })

  it('renders the screenplay text with a metadata header before the script body', () => {
    const text = formatSplitEpisodeScreenplayText({
      episodeNo: 1,
      title: '风起',
      openingHook: '雨夜敲门',
      mainConflict: '林岚与老板对峙',
      endingSuspense: '',
      script: '第1场｜内景｜茶馆｜夜\n\n林岚：还有空房吗？',
    })

    expect(text).toBe(
      [
        '【第1集｜风起】',
        '开场钩子：雨夜敲门',
        '主要冲突：林岚与老板对峙',
        '',
        '第1场｜内景｜茶馆｜夜',
        '',
        '林岚：还有空房吗？',
      ].join('\n'),
    )
  })
})
