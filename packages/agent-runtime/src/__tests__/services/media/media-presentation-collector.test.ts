import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AgentEvent } from '@spark/protocol'
import { afterEach, describe, expect, it } from 'vitest'
import { MediaPresentationCollector } from '../../../services/media/media-presentation-collector.js'

const cleanup: string[] = []

afterEach(async () => {
  const { rm } = await import('node:fs/promises')
  await Promise.all(cleanup.splice(0).map((item) => rm(item, { recursive: true, force: true })))
})

describe('MediaPresentationCollector', () => {
  it('collects generated image, screenshot, audio, and video files from structured tool results', async () => {
    const workspace = await createWorkspace()
    const files = await createMediaFiles(workspace)
    const collector = new MediaPresentationCollector(workspace)

    collector.observe(
      toolResult('mcp__spark_media__generate', {
        files: [
          { filePath: files.image },
          { path: files.audio },
          { outputPath: files.video },
        ],
      }),
    )
    collector.observe(toolResult('mcp__spark_computer__capture_app_snapshot', { path: files.shot }))

    await expectCanonicalPaths(collector.takeUnpresented(), [
      files.image,
      files.audio,
      files.video,
      files.shot,
    ])
  })

  it('collects media file changes but rejects non-media files and paths outside the workspace', async () => {
    const workspace = await createWorkspace()
    const outside = await createWorkspace()
    const image = path.join(workspace, 'result.webp')
    const text = path.join(workspace, 'notes.txt')
    const secret = path.join(outside, 'secret.png')
    await writeFile(image, 'image')
    await writeFile(text, 'text')
    await writeFile(secret, 'secret')
    const collector = new MediaPresentationCollector(workspace)

    collector.observe(fileChange('result.webp'))
    collector.observe(fileChange('notes.txt'))
    collector.observe(toolResult('mcp__spark_image__generate_image', { files: [secret] }))

    await expectCanonicalPaths(collector.takeUnpresented(), [image])
  })

  it('does not duplicate files already presented explicitly and caps a turn at twenty files', async () => {
    const workspace = await createWorkspace()
    const collector = new MediaPresentationCollector(workspace)
    const paths: string[] = []
    for (let index = 0; index < 25; index += 1) {
      const file = path.join(workspace, `image-${index}.png`)
      await writeFile(file, String(index))
      paths.push(file)
    }

    collector.observe(toolResult('mcp__spark_image__generate_image', { files: paths }))
    collector.observe(toolResult('mcp__spark_files__present_files', { files: [{ path: paths[0] }] }))

    const result = collector.takeUnpresented()
    expect(result).toHaveLength(20)
    expect(result).not.toContainEqual({ path: await realpath(paths[0]!) })
    expect(new Set(result.map((item) => item.path)).size).toBe(20)
    expect(collector.takeUnpresented()).toEqual([])
  })

  it('does not expose ordinary computer observation evidence as a user deliverable', async () => {
    const workspace = await createWorkspace()
    const evidence = path.join(workspace, 'execution-before.png')
    await writeFile(evidence, 'evidence')
    const collector = new MediaPresentationCollector(workspace)

    collector.observe(toolResult('mcp__spark_computer__observe', { path: evidence }))

    expect(collector.takeUnpresented()).toEqual([])
  })

  it('drains newly observed media immediately so it can be shown inline, not at turn end', async () => {
    const workspace = await createWorkspace()
    const files = await createMediaFiles(workspace)
    const collector = new MediaPresentationCollector(workspace)

    collector.observe(
      toolResult('mcp__spark_media__generate_image', { files: [{ filePath: files.image }] }),
    )

    // 即时 drain：返回刚观察到的图片，供 session 层紧跟工具调用发出
    await expectCanonicalPaths(collector.drainPending(), [files.image])
    // 已计入 emitted：再次 drain 空
    expect(collector.drainPending()).toEqual([])
    // turn 末兜底也不会重复发同一张图
    expect(collector.takeUnpresented()).toEqual([])
  })

  it('markAgentPresented drops paths already emitted inline to avoid duplicate cards', async () => {
    const workspace = await createWorkspace()
    const files = await createMediaFiles(workspace)
    const collector = new MediaPresentationCollector(workspace)

    // 生图工具产出 → 即时 drain 发出 image（计入 emitted）
    collector.observe(
      toolResult('mcp__spark_media__generate_image', { files: [{ filePath: files.image }] }),
    )
    await expectCanonicalPaths(collector.drainPending(), [files.image])

    // agent 又主动 present_files：同一张 image 应被去重，新 audio 保留
    const imageResolved = await realpath(files.image)
    const audioResolved = await realpath(files.audio)
    const agentPresented = collector.markAgentPresented([
      { path: imageResolved, title: 'dup' },
      { path: audioResolved, title: 'new' },
    ])
    expect(agentPresented).toEqual([{ path: audioResolved, title: 'new' }])

    // 兜底仍空：image 已 emit、audio 已被 markAgentPresented 记入 emitted
    expect(collector.takeUnpresented()).toEqual([])
  })

  it('markAgentPresented keeps files the agent explicitly presented even though observe pre-populated presented', async () => {
    const workspace = await createWorkspace()
    const files = await createMediaFiles(workspace)
    const collector = new MediaPresentationCollector(workspace)
    const imageResolved = await realpath(files.image)

    // agent 主动调 present_files：observe 会先把路径记入 presented 集合
    collector.observe(
      toolResult('mcp__spark_files__present_files', { files: [{ path: files.image }] }),
    )
    // 即时 drain 空（present_files 不入 pendingEmit）
    expect(collector.drainPending()).toEqual([])

    // markAgentPresented 不能因为 presented 已有该路径就丢弃——那会让 agent 主动展示的卡片全部消失
    const agentPresented = collector.markAgentPresented([{ path: imageResolved }])
    expect(agentPresented).toEqual([{ path: imageResolved }])

    // 兜底仍空：image 已被 markAgentPresented 记入 emitted
    expect(collector.takeUnpresented()).toEqual([])
  })
})

async function createWorkspace(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'spark-media-presentation-'))
  cleanup.push(directory)
  return directory
}

async function createMediaFiles(workspace: string): Promise<{
  image: string
  audio: string
  video: string
  shot: string
}> {
  const output = path.join(workspace, 'output')
  await mkdir(output)
  const files = {
    image: path.join(output, 'image.png'),
    audio: path.join(output, 'audio.mp3'),
    video: path.join(output, 'video.mp4'),
    shot: path.join(output, 'screenshot.jpg'),
  }
  await Promise.all(Object.values(files).map((file) => writeFile(file, path.basename(file))))
  return files
}

function toolResult(toolName: string, output: unknown): AgentEvent {
  return {
    id: crypto.randomUUID(),
    type: 'tool_result',
    sessionId: 'session-1',
    turnId: 'turn-1',
    timestamp: new Date().toISOString(),
    toolCallId: crypto.randomUUID(),
    toolName,
    status: 'success',
    output,
  } as AgentEvent
}

function fileChange(filePath: string): AgentEvent {
  return {
    id: crypto.randomUUID(),
    type: 'file_change',
    sessionId: 'session-1',
    turnId: 'turn-1',
    timestamp: new Date().toISOString(),
    changeType: 'create',
    path: filePath,
  } as AgentEvent
}

async function expectCanonicalPaths(
  received: Array<{ path: string }>,
  expected: string[],
): Promise<void> {
  expect(received).toEqual(
    await Promise.all(expected.map(async (file) => ({ path: await realpath(file) }))),
  )
}
