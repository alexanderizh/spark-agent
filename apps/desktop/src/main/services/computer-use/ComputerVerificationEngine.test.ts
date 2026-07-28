import type { ComputerObservation, VerificationSpec } from '@spark/protocol'
import { describe, expect, it } from 'vitest'
import { ComputerVerificationEngine } from './ComputerVerificationEngine.js'

const OBSERVATION = {
  frameId: 'frame-2',
  treeVersion: 'tree-2',
  capturedAt: '2026-07-28T08:00:01.000Z',
  display: { id: 'display-1', width: 1920, height: 1080, scaleFactor: 1 },
  foreground: {
    app: { id: 'app-1', name: 'Editor' },
    window: {
      id: 'window-1',
      title: 'Document — Saved',
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    },
  },
  screenshot: { snapshotId: 'snapshot-2', width: 800, height: 600 },
  tree: { mode: 'full', text: 'status "Saved"', elementCount: 1 },
  elements: [
    {
      id: 'status-1',
      treeVersion: 'tree-2',
      role: 'status',
      name: 'Saved',
      value: 'Saved',
      bounds: { x: 10, y: 10, width: 100, height: 30 },
      enabled: true,
      focused: false,
      actions: [],
    },
  ],
  loading: false,
  sensitiveRegions: [],
} satisfies ComputerObservation

describe('ComputerVerificationEngine', () => {
  it('requires every deterministic accessibility, visual-text, and application assertion to pass', () => {
    const criteria: VerificationSpec[] = [
      {
        kind: 'accessibility',
        selector: { role: 'status', name: 'Saved' },
        assertion: { operator: 'exists', expected: true },
      },
      { kind: 'visual', assertion: { operator: 'text_present', expected: 'Saved' } },
      {
        kind: 'application_state',
        appId: 'app-1',
        assertion: { operator: 'window_title_contains', expected: 'Saved' },
      },
    ]

    expect(new ComputerVerificationEngine().verify(criteria, OBSERVATION)).toMatchObject({
      passed: true,
      results: [{ passed: true }, { passed: true }, { passed: true }],
    })
  })

  it('fails closed for unsupported evidence sources and mismatched assertions', () => {
    const criteria: VerificationSpec[] = [
      {
        kind: 'file',
        pathPolicyRef: 'export-1',
        assertion: { operator: 'exists', expected: true },
      },
      { kind: 'visual', assertion: { operator: 'text_absent', expected: 'Saved' } },
    ]

    expect(new ComputerVerificationEngine().verify(criteria, OBSERVATION)).toMatchObject({
      passed: false,
      results: [{ passed: false, reason: 'unsupported_evidence' }, { passed: false }],
    })
  })

  it('never proves visual absence from a diff tree patch', () => {
    const diff = {
      ...OBSERVATION,
      tree: { mode: 'diff' as const, text: '{"changed":[],"removed":[]}', elementCount: 0 },
      elements: [],
    }

    expect(
      new ComputerVerificationEngine().verify(
        [{ kind: 'visual', assertion: { operator: 'text_absent', expected: 'Saved' } }],
        diff,
      ),
    ).toMatchObject({
      passed: false,
      results: [{ passed: false, reason: 'unsupported_evidence' }],
    })
  })

  it('uses the complete current element inventory instead of serialized tree patches for text', () => {
    const full = {
      ...OBSERVATION,
      tree: { ...OBSERVATION.tree, text: 'opaque host serialization' },
    }

    expect(
      new ComputerVerificationEngine().verify(
        [{ kind: 'visual', assertion: { operator: 'text_present', expected: 'Saved' } }],
        full,
      ),
    ).toMatchObject({ passed: true })
  })

  it('requires a process/window inventory for running and window-exists assertions', () => {
    const criteria: VerificationSpec[] = [
      {
        kind: 'application_state',
        appId: 'background-app',
        assertion: { operator: 'running', expected: false },
      },
    ]
    const engine = new ComputerVerificationEngine()

    expect(engine.verify(criteria, OBSERVATION)).toMatchObject({
      passed: false,
      results: [{ reason: 'unsupported_evidence' }],
    })
    expect(
      engine.verify(criteria, OBSERVATION, {
        windows: [
          {
            app: { id: 'background-app', name: 'Background' },
            window: {
              id: 'background-window',
              title: 'Background window',
              bounds: { x: 0, y: 0, width: 100, height: 100 },
            },
            display: OBSERVATION.display,
            focused: false,
            minimized: false,
          },
        ],
      }),
    ).toMatchObject({ passed: false, results: [{ reason: 'assertion_failed' }] })
    expect(engine.verify(criteria, OBSERVATION, { windows: [] })).toMatchObject({
      passed: false,
      results: [{ reason: 'unsupported_evidence' }],
    })
  })
})
