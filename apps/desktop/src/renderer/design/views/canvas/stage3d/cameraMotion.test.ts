import { describe, expect, it } from 'vitest'
import {
  STAGE3D_MOTION_PRESETS,
  describeStage3DMotion,
  describeStage3DMotionEn,
  evaluateStage3DCameraMotion,
  getStage3DMotionPreset,
  makeKeyframe,
  makeKeyframeMotion,
  makePresetMotion,
  motionEase,
  type Stage3DCameraMotion,
  type Stage3DMotionSubject,
} from './cameraMotion'

const START = {
  position: [3, 1.6, 4] as [number, number, number],
  target: [0, 1, 0] as [number, number, number],
  fov: 40,
}

/** 环绕类主体：原点站一个朝 +Z 的角色 */
const SUBJECT: Stage3DMotionSubject = { position: [0, 0, 0], rotationY: 0 }

function presetMotion(id: Parameters<typeof makePresetMotion>[0]): Stage3DCameraMotion {
  return makePresetMotion(id, START)
}

function distance(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

describe('STAGE3D_MOTION_PRESETS', () => {
  it('包含 13 个预设且 id/时长唯一可查', () => {
    expect(STAGE3D_MOTION_PRESETS).toHaveLength(13)
    const ids = new Set(STAGE3D_MOTION_PRESETS.map((p) => p.id))
    expect(ids.size).toBe(13)
    for (const preset of STAGE3D_MOTION_PRESETS) {
      expect(getStage3DMotionPreset(preset.id)?.label).toBeTruthy()
      expect(preset.durationSec).toBeGreaterThan(0)
      expect(preset.en).toBeTruthy()
    }
  })

  it('未知 id 返回 null', () => {
    expect(getStage3DMotionPreset('nope')).toBeNull()
    expect(getStage3DMotionPreset(undefined)).toBeNull()
  })
})

describe('makePresetMotion', () => {
  it('快照起始机位并可自定义时长（0.5–30s 钳制）', () => {
    const motion = makePresetMotion('orbit', START, 999)
    expect(motion.kind).toBe('preset')
    expect(motion.durationSec).toBe(30)
    expect(motion.start?.position).toEqual(START.position)
    expect(motion.start?.target).toEqual(START.target)
  })
})

describe('evaluateStage3DCameraMotion：预设求值', () => {
  it('时间 0 时回到起始机位（ ease 起点为 0）', () => {
    for (const preset of STAGE3D_MOTION_PRESETS) {
      const frame = evaluateStage3DCameraMotion(presetMotion(preset.id), 0, SUBJECT)
      expect(frame.position[0]).toBeCloseTo(START.position[0], 5)
      expect(frame.position[1]).toBeCloseTo(START.position[1], 5)
      expect(frame.position[2]).toBeCloseTo(START.position[2], 5)
    }
  })

  it('时间超出时长时钳制到终点', () => {
    const motion = presetMotion('push-in')
    const atEnd = evaluateStage3DCameraMotion(motion, motion.durationSec + 5, SUBJECT)
    const clamped = evaluateStage3DCameraMotion(motion, motion.durationSec, SUBJECT)
    expect(atEnd.position).toEqual(clamped.position)
  })

  it('推近特写：相机向主体靠近', () => {
    const motion = presetMotion('push-in')
    const start = distance(START.position, SUBJECT.position)
    const end = distance(
      evaluateStage3DCameraMotion(motion, motion.durationSec, SUBJECT).position,
      SUBJECT.position,
    )
    expect(end).toBeLessThan(start * 0.9)
  })

  it('拉远交代：相机远离主体', () => {
    const motion = presetMotion('pull-out')
    const start = distance(START.position, SUBJECT.position)
    const end = distance(
      evaluateStage3DCameraMotion(motion, motion.durationSec, SUBJECT).position,
      SUBJECT.position,
    )
    expect(end).toBeGreaterThan(start * 1.3)
  })

  it('跟拍前移/后退沿主体朝向移动，注视点锁定主体', () => {
    for (const id of ['follow-forward', 'follow-back'] as const) {
      const motion = presetMotion(id)
      const frame = evaluateStage3DCameraMotion(motion, motion.durationSec, SUBJECT)
      // 主体朝 +Z（rotationY=0）：前移 z 增大，后退 z 减小
      if (id === 'follow-forward') expect(frame.position[2]).toBeGreaterThan(START.position[2])
      else expect(frame.position[2]).toBeLessThan(START.position[2])
      expect(frame.target).toEqual([0, 1, 0])
    }
  })

  it('环绕一周后回到起点方位，注视点保持主体', () => {
    const motion = presetMotion('orbit')
    const end = evaluateStage3DCameraMotion(motion, motion.durationSec, SUBJECT)
    expect(end.position[0]).toBeCloseTo(START.position[0], 5)
    expect(end.position[2]).toBeCloseTo(START.position[2], 5)
    expect(end.target).toEqual([0, 1, 0])
    // 中途应转了约半圈：与起点位置不同
    const mid = evaluateStage3DCameraMotion(motion, motion.durationSec / 2, SUBJECT)
    expect(distance(mid.position, START.position)).toBeGreaterThan(1)
  })

  it('左向半弧扫过约半圈', () => {
    const motion = presetMotion('arc-left')
    const end = evaluateStage3DCameraMotion(motion, motion.durationSec, SUBJECT)
    // 180° 半弧终点：绕主体转到对侧
    expect(end.position[0]).toBeCloseTo(-START.position[0], 4)
    expect(end.position[2]).toBeCloseTo(-START.position[2], 4)
  })

  it('横移沿屏幕左右方向移动并保持注视', () => {
    const left = evaluateStage3DCameraMotion(presetMotion('truck-left'), 2, SUBJECT)
    const right = evaluateStage3DCameraMotion(presetMotion('truck-right'), 2, SUBJECT)
    // 相机在 +Z 侧看向 -Z：屏幕右为 -X，truck-left 应向 +X，truck-right 向 -X
    expect(left.position[0]).toBeGreaterThan(START.position[0])
    expect(right.position[0]).toBeLessThan(START.position[0])
    expect(left.target).toEqual([0, 1, 0])
  })

  it('上升/下降改变相机高度且不低于地面安全值', () => {
    const up = evaluateStage3DCameraMotion(presetMotion('crane-up'), 2.6, SUBJECT)
    expect(up.position[1]).toBeGreaterThan(START.position[1])
    const lowStart = { ...START, position: [0, 0.4, 3] as [number, number, number] }
    const down = evaluateStage3DCameraMotion(makePresetMotion('crane-down', lowStart), 2.6, SUBJECT)
    expect(down.position[1]).toBeGreaterThanOrEqual(0.25)
  })

  it('螺旋上升同时环绕（水平位移）并升高', () => {
    const motion = presetMotion('spiral-up')
    const end = evaluateStage3DCameraMotion(motion, motion.durationSec, SUBJECT)
    expect(end.position[1]).toBeGreaterThan(START.position[1])
    const mid = evaluateStage3DCameraMotion(motion, motion.durationSec / 2, SUBJECT)
    expect(distance(mid.position, START.position)).toBeGreaterThan(0.5)
  })

  it('无主体时围绕起始注视点求值（虚拟主体）', () => {
    const motion = presetMotion('orbit')
    const frame = evaluateStage3DCameraMotion(motion, motion.durationSec / 2)
    // 注视点即主体：结束时目标点不变
    expect(frame.target).toEqual(START.target)
  })
})

describe('evaluateStage3DCameraMotion：关键帧插值', () => {
  it('帧间平滑插值且端点命中关键帧', () => {
    const motion = makeKeyframeMotion(
      [
        makeKeyframe(0, [0, 1, 5], [0, 1, 0]),
        makeKeyframe(2, [4, 2, 0], [1, 1, 0]),
      ],
      2,
    )
    expect(motion.kind).toBe('keyframes')
    const atStart = evaluateStage3DCameraMotion(motion, 0)
    expect(atStart.position).toEqual([0, 1, 5])
    const atEnd = evaluateStage3DCameraMotion(motion, 2)
    expect(atEnd.position).toEqual([4, 2, 0])
    const atMid = evaluateStage3DCameraMotion(motion, 1)
    // smoothstep(0.5)=0.5 → 中点即线性中点
    expect(atMid.position[0]).toBeCloseTo(2, 5)
    expect(atMid.position[1]).toBeCloseTo(1.5, 5)
  })

  it('单帧轨迹静止，空关键帧回退 start', () => {
    const single = makeKeyframeMotion([makeKeyframe(0, [1, 1, 1], [0, 0, 0])], 2)
    const frame = evaluateStage3DCameraMotion(single, 1.5)
    expect(frame.position).toEqual([1, 1, 1])
    const empty: Stage3DCameraMotion = {
      kind: 'keyframes',
      durationSec: 2,
      start: { ...START },
      keyframes: [],
    }
    const fallback = evaluateStage3DCameraMotion(empty, 1)
    expect(fallback.position).toEqual(START.position)
  })

  it('关键帧按时间归一化到 [0, duration]', () => {
    const motion = makeKeyframeMotion(
      [
        makeKeyframe(10, [0, 0, 0], [0, 0, 0]),
        makeKeyframe(20, [2, 0, 0], [0, 0, 0]),
      ],
      4,
    )
    expect(motion.keyframes?.[0]?.t).toBe(0)
    expect(motion.keyframes?.[1]?.t).toBe(4)
  })
})

describe('motionEase / 描述词', () => {
  it('ease 端点为 0/1，中点为 0.5，单调', () => {
    expect(motionEase(0)).toBe(0)
    expect(motionEase(1)).toBe(1)
    expect(motionEase(0.5)).toBeCloseTo(0.5, 6)
    let prev = -1
    for (let i = 0; i <= 20; i += 1) {
      const v = motionEase(i / 20)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })

  it('描述词包含时长与预设名，英文描述可回退', () => {
    const motion = presetMotion('orbit')
    expect(describeStage3DMotion(motion)).toContain('环绕')
    expect(describeStage3DMotion(motion)).toContain('4.5')
    expect(describeStage3DMotionEn(motion)).toContain('orbit')
    expect(describeStage3DMotion(makeKeyframeMotion([makeKeyframe(0, [0, 1, 1], [0, 0, 0]), makeKeyframe(1, [1, 1, 1], [0, 0, 0])], 1))).toContain('关键帧')
    expect(describeStage3DMotionEn({ kind: 'preset', presetId: 'nope' as never, durationSec: 2 })).toBeNull()
  })
})
