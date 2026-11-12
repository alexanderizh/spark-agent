import { describe, expect, it, beforeEach } from 'vitest'
import {
  MAX_REMOTE_DRAFTS,
  clearRemoteDraft,
  readRemoteDraft,
  resetRemoteDrafts,
  writeRemoteDraft,
} from './remoteDrafts'

const text = (value: string) => ({ text: value, attachments: [] })

describe('remoteDrafts', () => {
  beforeEach(() => {
    resetRemoteDrafts()
  })

  it('读写草稿', () => {
    writeRemoteDraft('dev-1', 's1', text('先跑一遍类型检查'))
    expect(readRemoteDraft('dev-1', 's1')).toEqual({ text: '先跑一遍类型检查', attachments: [] })
  })

  it('没写过的会话返回 null', () => {
    expect(readRemoteDraft('dev-1', 's2')).toBeNull()
  })

  it('按设备与会话双重隔离，不会串台', () => {
    writeRemoteDraft('dev-1', 's1', text('设备一的会话一'))
    writeRemoteDraft('dev-1', 's2', text('设备一的会话二'))
    writeRemoteDraft('dev-2', 's1', text('设备二的会话一'))
    expect(readRemoteDraft('dev-1', 's1')?.text).toBe('设备一的会话一')
    expect(readRemoteDraft('dev-1', 's2')?.text).toBe('设备一的会话二')
    expect(readRemoteDraft('dev-2', 's1')?.text).toBe('设备二的会话一')
  })

  it('空白草稿等同于删除', () => {
    writeRemoteDraft('dev-1', 's1', text('写了点东西'))
    writeRemoteDraft('dev-1', 's1', text('   \n  '))
    expect(readRemoteDraft('dev-1', 's1')).toBeNull()
  })

  it('只有附件没有文字时仍然保留', () => {
    writeRemoteDraft('dev-1', 's1', {
      text: '',
      attachments: [{ type: 'image', path: '/remote/shot.png' }],
    })
    expect(readRemoteDraft('dev-1', 's1')?.attachments).toHaveLength(1)
  })

  it('读出来的附件是副本，外部改动不会污染缓存', () => {
    writeRemoteDraft('dev-1', 's1', {
      text: '',
      attachments: [{ type: 'image', path: '/remote/shot.png' }],
    })
    readRemoteDraft('dev-1', 's1')?.attachments.push({ type: 'file', path: '/remote/x.pdf' })
    expect(readRemoteDraft('dev-1', 's1')?.attachments).toHaveLength(1)
  })

  it('超出上限时淘汰最久未写的草稿', () => {
    for (let index = 0; index < MAX_REMOTE_DRAFTS; index += 1) {
      writeRemoteDraft('dev-1', `s${index}`, text(`草稿 ${index}`))
    }
    // 重新写一次 s0，让它成为「最近使用」
    writeRemoteDraft('dev-1', 's0', text('草稿 0 更新'))
    writeRemoteDraft('dev-1', 'fresh', text('最新的草稿'))

    expect(readRemoteDraft('dev-1', 'fresh')).not.toBeNull()
    expect(readRemoteDraft('dev-1', 's0')?.text).toBe('草稿 0 更新')
    expect(readRemoteDraft('dev-1', 's1')).toBeNull()
  })

  it('发送后可以显式清掉', () => {
    writeRemoteDraft('dev-1', 's1', text('要发出去的内容'))
    clearRemoteDraft('dev-1', 's1')
    expect(readRemoteDraft('dev-1', 's1')).toBeNull()
  })
})
