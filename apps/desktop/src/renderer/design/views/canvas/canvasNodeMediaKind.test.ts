import { describe, expect, it } from 'vitest'
import type { CanvasEdge, CanvasNode } from './canvas.types'
import {
  buildOutputMediaKindMap,
  buildOutputMediaNodeMap,
  resolveCanvasNodeMediaKind,
  resolveEffectiveMediaSourceNode,
} from './canvasNodeMediaKind'

type MediaKind = 'image' | 'video' | 'audio'

const mediaNode = (id: string, type: MediaKind): CanvasNode =>
  ({ id, type }) as unknown as CanvasNode
const taskNode = (id: string, type: CanvasNode['type'] = 'text_to_video'): CanvasNode =>
  ({ id, type }) as unknown as CanvasNode
const generatedEdge = (source: string, target: string): CanvasEdge =>
  ({ type: 'generated', sourceNodeId: source, targetNodeId: target }) as unknown as CanvasEdge
const connectionEdge = (source: string, target: string): CanvasEdge =>
  ({ type: 'connection', sourceNodeId: source, targetNodeId: target }) as unknown as CanvasEdge

describe('resolveCanvasNodeMediaKind', () => {
  it('returns the node type directly for pure media nodes', () => {
    expect(resolveCanvasNodeMediaKind(mediaNode('img', 'image'))).toBe('image')
    expect(resolveCanvasNodeMediaKind(mediaNode('vid', 'video'))).toBe('video')
    expect(resolveCanvasNodeMediaKind(mediaNode('aud', 'audio'))).toBe('audio')
  })

  it('returns undefined for task nodes without an output-kind map', () => {
    expect(resolveCanvasNodeMediaKind(taskNode('t2v'))).toBeUndefined()
  })

  it('returns the resolved output kind for task nodes when a map is provided', () => {
    const map = new Map([['t2v', 'video' as MediaKind]])
    expect(resolveCanvasNodeMediaKind(taskNode('t2v'), map)).toBe('video')
  })

  it('prefers the node type over the map for pure media nodes', () => {
    const map = new Map([['img', 'video' as MediaKind]])
    expect(resolveCanvasNodeMediaKind(mediaNode('img', 'image'), map)).toBe('image')
  })
})

describe('buildOutputMediaKindMap', () => {
  it('maps a task node to its generated video output kind', () => {
    const nodes = [taskNode('t2v'), mediaNode('out', 'video')]
    const edges = [generatedEdge('t2v', 'out')]
    expect(buildOutputMediaKindMap(nodes, edges).get('t2v')).toBe('video')
  })

  it('ignores non-generated edges', () => {
    const nodes = [taskNode('t2v'), mediaNode('out', 'video')]
    const edges = [connectionEdge('t2v', 'out')]
    expect(buildOutputMediaKindMap(nodes, edges).has('t2v')).toBe(false)
  })

  it('ignores generated edges that land on non-media nodes', () => {
    const nodes = [taskNode('t2v'), { id: 'text', type: 'text' } as unknown as CanvasNode]
    const edges = [generatedEdge('t2v', 'text')]
    expect(buildOutputMediaKindMap(nodes, edges).has('t2v')).toBe(false)
  })

  it('keeps the last media output when a task node has multiple outputs', () => {
    const nodes = [taskNode('t2v'), mediaNode('img-out', 'image'), mediaNode('vid-out', 'video')]
    const edges = [generatedEdge('t2v', 'img-out'), generatedEdge('t2v', 'vid-out')]
    expect(buildOutputMediaKindMap(nodes, edges).get('t2v')).toBe('video')
  })

  it('does not register pure media source nodes (they resolve via their own type)', () => {
    const nodes = [mediaNode('vid', 'video')]
    expect(buildOutputMediaKindMap(nodes, []).has('vid')).toBe(false)
  })
})

describe('buildOutputMediaNodeMap / resolveEffectiveMediaSourceNode', () => {
  it('resolves a task node to its latest generated media output node', () => {
    const first = mediaNode('first', 'video')
    const latest = mediaNode('latest', 'video')
    const nodes = [taskNode('t2v'), first, latest]
    const edges = [generatedEdge('t2v', 'first'), generatedEdge('t2v', 'latest')]
    const map = buildOutputMediaNodeMap(nodes, edges)
    expect(resolveEffectiveMediaSourceNode(taskNode('t2v'), map)).toBe(latest)
  })

  it('returns the node itself for pure media nodes', () => {
    const vid = mediaNode('vid', 'video')
    const map = buildOutputMediaNodeMap([vid], [])
    expect(resolveEffectiveMediaSourceNode(vid, map)).toBe(vid)
  })

  it('returns the task node itself when it has no media output yet', () => {
    const t2v = taskNode('t2v')
    const map = buildOutputMediaNodeMap([t2v], [])
    expect(resolveEffectiveMediaSourceNode(t2v, map)).toBe(t2v)
  })

  it('skips generated edges whose target is not a media node', () => {
    const t2v = taskNode('t2v')
    const nodes = [t2v, { id: 'text', type: 'text' } as unknown as CanvasNode]
    const edges = [generatedEdge('t2v', 'text')]
    const map = buildOutputMediaNodeMap(nodes, edges)
    expect(resolveEffectiveMediaSourceNode(t2v, map)).toBe(t2v)
  })
})
