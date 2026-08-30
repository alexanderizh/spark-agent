import { describe, expect, it } from 'vitest'
import {
  absoluteToRelativeFor,
  resolveFlowNodeAbsoluteOrigin,
  type FlowNodeCoordinateRef,
} from './canvasFlowNodeCoordinates'

function mapOf(nodes: FlowNodeCoordinateRef[]): Map<string, FlowNodeCoordinateRef> {
  return new Map(nodes.map((node) => [node.id, node]))
}

describe('resolveFlowNodeAbsoluteOrigin', () => {
  it('returns the node position directly when there is no parent', () => {
    const node: FlowNodeCoordinateRef = { id: 'a', position: { x: 10, y: 20 } }
    expect(resolveFlowNodeAbsoluteOrigin(node, mapOf([node]))).toEqual({ x: 10, y: 20 })
  })

  it('accumulates a single-level parent offset', () => {
    const parent: FlowNodeCoordinateRef = { id: 'g', position: { x: 100, y: 50 } }
    const child: FlowNodeCoordinateRef = { id: 'c', position: { x: 10, y: 5 }, parentId: 'g' }
    expect(resolveFlowNodeAbsoluteOrigin(child, mapOf([parent, child]))).toEqual({ x: 110, y: 55 })
  })

  it('walks a nested two-level parent chain', () => {
    const root: FlowNodeCoordinateRef = { id: 'r', position: { x: 100, y: 200 } }
    const mid: FlowNodeCoordinateRef = { id: 'm', position: { x: 10, y: 20 }, parentId: 'r' }
    const leaf: FlowNodeCoordinateRef = { id: 'l', position: { x: 1, y: 2 }, parentId: 'm' }
    expect(resolveFlowNodeAbsoluteOrigin(leaf, mapOf([root, mid, leaf]))).toEqual({
      x: 111,
      y: 222,
    })
  })

  it('stops gracefully when the parent chain is broken', () => {
    const child: FlowNodeCoordinateRef = {
      id: 'c',
      position: { x: 5, y: 6 },
      parentId: 'missing',
    }
    expect(resolveFlowNodeAbsoluteOrigin(child, mapOf([child]))).toEqual({ x: 5, y: 6 })
  })

  it('does not loop forever on a cyclic parent chain', () => {
    const a: FlowNodeCoordinateRef = { id: 'a', position: { x: 1, y: 1 }, parentId: 'b' }
    const b: FlowNodeCoordinateRef = { id: 'b', position: { x: 2, y: 2 }, parentId: 'a' }
    // a -> b -> a -> b(visited 截断)：累加 a + b + a = (1+2+1, 1+2+1) = (4,4)
    expect(resolveFlowNodeAbsoluteOrigin(a, mapOf([a, b]))).toEqual({ x: 4, y: 4 })
  })
})

describe('absoluteToRelativeFor', () => {
  it('returns the absolute value as-is for a top-level node', () => {
    const node: FlowNodeCoordinateRef = { id: 'a', position: { x: 0, y: 0 } }
    expect(absoluteToRelativeFor({ x: 42, y: 17 }, node, mapOf([node]))).toEqual({ x: 42, y: 17 })
  })

  it('subtracts the parent absolute origin for a child', () => {
    const parent: FlowNodeCoordinateRef = { id: 'g', position: { x: 100, y: 50 } }
    const child: FlowNodeCoordinateRef = { id: 'c', position: { x: 0, y: 0 }, parentId: 'g' }
    expect(absoluteToRelativeFor({ x: 110, y: 55 }, child, mapOf([parent, child]))).toEqual({
      x: 10,
      y: 5,
    })
  })

  it('subtracts a nested parent chain origin', () => {
    const root: FlowNodeCoordinateRef = { id: 'r', position: { x: 100, y: 200 } }
    const mid: FlowNodeCoordinateRef = { id: 'm', position: { x: 10, y: 20 }, parentId: 'r' }
    const leaf: FlowNodeCoordinateRef = { id: 'l', position: { x: 0, y: 0 }, parentId: 'm' }
    expect(absoluteToRelativeFor({ x: 111, y: 222 }, leaf, mapOf([root, mid, leaf]))).toEqual({
      x: 1,
      y: 2,
    })
  })
})
