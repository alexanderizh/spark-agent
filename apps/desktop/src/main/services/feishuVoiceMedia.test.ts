import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { downloadFeishuVoice, extractFeishuInboundVoice } from './feishuVoiceMedia.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  )
})

const OGG_BYTES = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(48)])

describe('extractFeishuInboundVoice', () => {
  it('提取语音消息（msg_type=audio）的 file_key', () => {
    expect(
      extractFeishuInboundVoice({
        message_id: 'om_1',
        message_type: 'audio',
        content: '{"file_key":"file_v2_1"}',
      }),
    ).toEqual({ messageId: 'om_1', fileKey: 'file_v2_1' })
  })

  it('提取文件名带音频扩展名的文件消息', () => {
    expect(
      extractFeishuInboundVoice({
        message_id: 'om_2',
        message_type: 'file',
        content: '{"file_key":"file_v2_2","file_name":"朗读.mp3"}',
      }),
    ).toEqual({ messageId: 'om_2', fileKey: 'file_v2_2', fileName: '朗读.mp3' })
  })

  it('非音频文件消息与其他消息类型返回 null', () => {
    expect(
      extractFeishuInboundVoice({
        message_id: 'om_3',
        message_type: 'file',
        content: '{"file_key":"file_v2_3","file_name":"报告.pdf"}',
      }),
    ).toBeNull()
    expect(
      extractFeishuInboundVoice({
        message_id: 'om_4',
        message_type: 'text',
        content: '{"text":"你好"}',
      }),
    ).toBeNull()
    expect(
      extractFeishuInboundVoice({
        message_id: 'om_5',
        message_type: 'audio',
        content: 'not-json',
      }),
    ).toBeNull()
  })
})

describe('downloadFeishuVoice', () => {
  it('下载 OGG/Opus 语音并落盘', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'spark-feishu-voice-test-'))
    temporaryDirectories.push(directory)
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(OGG_BYTES))

    const file = await downloadFeishuVoice(
      {
        token: 't-tenant',
        voice: { messageId: 'om_1', fileKey: 'file_v2_1' },
        attachmentRoot: directory,
      },
      fetchMock,
    )

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      '/im/v1/messages/om_1/resources/file_v2_1?type=file',
    )
    expect(file.mimeType).toBe('audio/ogg')
    expect(file.path.endsWith('.ogg')).toBe(true)
    expect((await fs.readFile(file.path)).subarray(0, 4).toString('ascii')).toBe('OggS')
  })

  it('非音频内容抛出明确错误', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'spark-feishu-voice-test-'))
    temporaryDirectories.push(directory)
    await expect(
      downloadFeishuVoice(
        {
          token: 't-tenant',
          voice: { messageId: 'om_1', fileKey: 'file_v2_x' },
          attachmentRoot: directory,
        },
        vi.fn<typeof fetch>(async () => new Response(Buffer.from('unknown-bytes'))),
      ),
    ).rejects.toThrow('不是受支持的音频格式')
  })

  it('下载失败时抛出带状态码的错误', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'spark-feishu-voice-test-'))
    temporaryDirectories.push(directory)
    await expect(
      downloadFeishuVoice(
        {
          token: 't-tenant',
          voice: { messageId: 'om_1', fileKey: 'file_v2_x' },
          attachmentRoot: directory,
        },
        vi.fn<typeof fetch>(async () => new Response('forbidden', { status: 403 })),
      ),
    ).rejects.toThrow('403')
  })
})
