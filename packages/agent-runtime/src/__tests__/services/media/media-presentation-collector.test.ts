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
