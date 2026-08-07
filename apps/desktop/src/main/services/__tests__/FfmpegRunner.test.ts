import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  audioExtForCodec,
  buildFfmpegEnv,
  buildKeyframeFrameSyncArgs,
  ensureOutputDirectory,
  injectNoSslVerifyForHttpsInputs,
  resolveSystemCaBundle,
} from '../FfmpegRunner'

const roots: string[] = []
const originalSslCertFile = process.env.SSL_CERT_FILE

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  // 恢复 process.env.SSL_CERT_FILE，避免污染并行用例
  if (originalSslCertFile === undefined) delete process.env.SSL_CERT_FILE
  else process.env.SSL_CERT_FILE = originalSslCertFile
})

describe('ensureOutputDirectory', () => {
  it('creates the parent directory required by trim and concat outputs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spark-video-output-'))
    roots.push(root)
    const outputPath = join(root, 'nested', 'video-workbench', 'clip.mp4')

    ensureOutputDirectory(outputPath)

    expect(existsSync(join(root, 'nested', 'video-workbench'))).toBe(true)
  })
})

describe('buildKeyframeFrameSyncArgs', () => {
  it('falls back to legacy vsync when FFmpeg rejects fps_mode', () => {
    expect(
      buildKeyframeFrameSyncArgs(
        "Unrecognized option 'fps_mode'. Error splitting the argument list: Option not found",
      ),
    ).toEqual(['-vsync', 'vfr'])
  })

  it('uses fps_mode for modern FFmpeg by default', () => {
    expect(buildKeyframeFrameSyncArgs()).toEqual(['-fps_mode', 'vfr'])
  })
})

describe('resolveSystemCaBundle / buildFfmpegEnv', () => {
  it('resolveSystemCaBundle 返回真实存在的系统 CA bundle（或无候选时不注入）', () => {
    const bundle = resolveSystemCaBundle()
    if (bundle) expect(existsSync(bundle)).toBe(true)
    else expect(bundle).toBeUndefined()
  })

  it('buildFfmpegEnv 透传其余 env 并注入 SSL_CERT_FILE（指向存在的 CA bundle）', () => {
    delete process.env.SSL_CERT_FILE
    const env = buildFfmpegEnv()
    expect(env.SSL_CERT_FILE).toBeDefined()
    expect(existsSync(env.SSL_CERT_FILE as string)).toBe(true)
    // 其余变量照常透传
    expect(env.PATH).toBe(process.env.PATH)
  })

  it('buildFfmpegEnv 不覆盖用户已有的显式 SSL_CERT_FILE', () => {
    process.env.SSL_CERT_FILE = '/custom/ca.pem'
    expect(buildFfmpegEnv().SSL_CERT_FILE).toBe('/custom/ca.pem')
  })
})

describe('injectNoSslVerifyForHttpsInputs', () => {
  it('ffmpeg 形态：https 输入在 -i 前注入 -tls_verify 0', () => {
    const args = ['-i', 'https://example.com/v.mp4', '-vn', '-c:a', 'copy', 'out.m4a']
    expect(injectNoSslVerifyForHttpsInputs(args)).toEqual([
      '-tls_verify', '0',
      '-i', 'https://example.com/v.mp4',
      '-vn', '-c:a', 'copy', 'out.m4a',
    ])
  })

  it('ffprobe 形态：https 输入为末尾位置参数时在其前注入', () => {
    const args = ['-v', 'error', '-print_format', 'json', 'https://example.com/v.mp4']
    expect(injectNoSslVerifyForHttpsInputs(args)).toEqual([
      '-v', 'error', '-print_format', 'json',
      '-tls_verify', '0', 'https://example.com/v.mp4',
    ])
  })

  it('本地路径与 http 输入不注入（无 TLS）', () => {
    const local = ['-i', '/tmp/v.mp4', '-vn', 'out.m4a']
    expect(injectNoSslVerifyForHttpsInputs(local)).toEqual(local)
    const http = ['-i', 'http://192.168.1.10:8080/v.mp4', '-vn', 'out.m4a']
    expect(injectNoSslVerifyForHttpsInputs(http)).toEqual(http)
  })

  it('大小写不敏感的 https:// 前缀也注入', () => {
    const args = ['-i', 'HTTPS://EXAMPLE.COM/v.mp4', '-vn', 'out.m4a']
    expect(injectNoSslVerifyForHttpsInputs(args)[0]).toBe('-tls_verify')
  })
})

describe('audioExtForCodec', () => {
  it('maps known codecs to copy-friendly containers', () => {
    expect(audioExtForCodec('aac')).toBe('m4a')
    expect(audioExtForCodec('alac')).toBe('m4a')
    expect(audioExtForCodec('mp3')).toBe('mp3')
    expect(audioExtForCodec('ac3')).toBe('ac3')
    expect(audioExtForCodec('eac3')).toBe('ac3')
    expect(audioExtForCodec('opus')).toBe('ogg')
    expect(audioExtForCodec('vorbis')).toBe('ogg')
    expect(audioExtForCodec('flac')).toBe('flac')
    expect(audioExtForCodec('pcm_s16le')).toBe('wav')
    expect(audioExtForCodec('pcm_f32le')).toBe('wav')
  })

  it('falls back to mka for unknown codecs (Matroska can hold almost anything)', () => {
    expect(audioExtForCodec(null)).toBe('mka')
    expect(audioExtForCodec('dts')).toBe('mka')
  })
})
