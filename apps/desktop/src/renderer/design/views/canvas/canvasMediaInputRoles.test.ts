import { describe, expect, it } from 'vitest'
import { computeMediaInputRoleMap } from './canvasMediaInputRoles'

const image = (id: string) => ({ id, type: 'image' })
const video = (id: string) => ({ id, type: 'video' })
const audio = (id: string) => ({ id, type: 'audio' })

describe('computeMediaInputRoleMap', () => {
  it('纯参考图路径：文生视频多模态参考 maxImages=9，5 张图全选 → 全 reference_image/used', () => {
    const map = computeMediaInputRoleMap({
      mediaInputs: ['img1', 'img2', 'img3', 'img4', 'img5'].map(image),
      selectedInputNodeIds: ['img1', 'img2', 'img3', 'img4', 'img5'],
      supportsFrameRoles: false,
      supportsImageRoles: true,
      policy: {
        imageRoles: ['reference_image'],
        videoRoles: ['reference_video'],
        audioRoles: ['reference_audio'],
        defaultRoleAssignment: 'all_reference',
      },
      maxImages: 9,
      firstFrameNodeId: '',
      lastFrameNodeId: '',
      referenceFrameNodeIds: [],
      explicitFrameNodeIds: [],
    })
    expect(map.get('img1')).toEqual({ role: 'reference_image', usageStatus: 'used' })
    expect(map.get('img5')).toEqual({ role: 'reference_image', usageStatus: 'used' })
    expect([...map.values()].every((v) => v.usageStatus === 'used')).toBe(true)
  })

  it('纯参考图路径：image.edit maxImages=2，5 张图全选 → 全部尝试作为 reference_image 使用', () => {
    const map = computeMediaInputRoleMap({
      mediaInputs: ['img1', 'img2', 'img3', 'img4', 'img5'].map(image),
      selectedInputNodeIds: ['img1', 'img2', 'img3', 'img4', 'img5'],
      supportsFrameRoles: false,
      supportsImageRoles: true,
      policy: { imageRoles: ['reference_image'], defaultRoleAssignment: 'all_reference' },
      maxImages: 2,
      firstFrameNodeId: '',
      lastFrameNodeId: '',
      referenceFrameNodeIds: [],
      explicitFrameNodeIds: [],
    })
    expect(map.get('img1')).toEqual({ role: 'reference_image', usageStatus: 'used' })
    expect(map.get('img2')).toEqual({ role: 'reference_image', usageStatus: 'used' })
    expect(map.get('img3')).toEqual({ role: 'reference_image', usageStatus: 'used' })
    expect(map.get('img5')).toEqual({ role: 'reference_image', usageStatus: 'used' })
  })

  it('纯参考图路径：未勾选的 image 标 unused', () => {
    const map = computeMediaInputRoleMap({
      mediaInputs: ['img1', 'img2', 'img3'].map(image),
      selectedInputNodeIds: ['img1', 'img2'],
      supportsFrameRoles: false,
      supportsImageRoles: true,
      policy: { imageRoles: ['reference_image'], defaultRoleAssignment: 'all_reference' },
      maxImages: 4,
      firstFrameNodeId: '',
      lastFrameNodeId: '',
      referenceFrameNodeIds: [],
      explicitFrameNodeIds: [],
    })
    expect(map.get('img1')?.usageStatus).toBe('used')
    expect(map.get('img3')).toEqual({ usageStatus: 'unused' })
  })

  it('帧角色路径：image_to_video maxImages=2，首帧+尾帧+未指定图 → 未指定图 unused', () => {
    const map = computeMediaInputRoleMap({
      mediaInputs: ['A', 'B', 'C'].map(image),
      selectedInputNodeIds: ['A', 'B', 'C'],
      supportsFrameRoles: true,
      supportsImageRoles: true,
      policy: {
        imageRoles: ['first_frame', 'last_frame'],
        defaultRoleAssignment: 'first_then_last_then_reference',
      },
      maxImages: 2,
      firstFrameNodeId: 'A',
      lastFrameNodeId: 'B',
      referenceFrameNodeIds: [],
      explicitFrameNodeIds: ['A', 'B'],
    })
    expect(map.get('A')).toEqual({ role: 'first_frame', usageStatus: 'used' })
    expect(map.get('B')).toEqual({ role: 'last_frame', usageStatus: 'used' })
    expect(map.get('C')).toEqual({ usageStatus: 'unused' })
  })

  it('帧角色路径：未达到上限时，未分配角色的图片标 unused 而不是 overflow', () => {
    const map = computeMediaInputRoleMap({
      mediaInputs: ['A', 'B', 'C'].map(image),
      selectedInputNodeIds: ['A', 'B', 'C'],
      supportsFrameRoles: true,
      supportsImageRoles: true,
      policy: {
        imageRoles: ['first_frame', 'last_frame', 'reference_image'],
        defaultRoleAssignment: 'first_then_last_then_reference',
      },
      maxImages: 3,
      firstFrameNodeId: 'A',
      lastFrameNodeId: '',
      referenceFrameNodeIds: [],
      explicitFrameNodeIds: ['A'],
    })
    expect(map.get('B')).toEqual({ usageStatus: 'unused' })
    expect(map.get('C')).toEqual({ usageStatus: 'unused' })
  })

  it('video.edit：输入视频标 input_video role', () => {
    const map = computeMediaInputRoleMap({
      mediaInputs: [video('v1'), image('img1')],
      selectedInputNodeIds: ['v1', 'img1'],
      supportsFrameRoles: true,
      supportsImageRoles: true,
      policy: {
        imageRoles: ['first_frame', 'last_frame', 'reference_image'],
        videoRoles: ['input_video'],
        defaultRoleAssignment: 'first_then_last_then_reference',
      },
      maxImages: 2,
      firstFrameNodeId: 'img1',
      lastFrameNodeId: '',
      referenceFrameNodeIds: [],
      explicitFrameNodeIds: ['img1'],
    })
    expect(map.get('v1')).toEqual({ role: 'input_video', usageStatus: 'used' })
    expect(map.get('img1')).toEqual({ role: 'first_frame', usageStatus: 'used' })
  })

  it('video.generate 多模态：参考视频标 reference_video role', () => {
    const map = computeMediaInputRoleMap({
      mediaInputs: [video('v1'), image('img1')],
      selectedInputNodeIds: ['v1', 'img1'],
      supportsFrameRoles: false,
      supportsImageRoles: true,
      policy: {
        imageRoles: ['reference_image'],
        videoRoles: ['reference_video'],
        audioRoles: ['reference_audio'],
        defaultRoleAssignment: 'all_reference',
      },
      maxImages: 9,
      firstFrameNodeId: '',
      lastFrameNodeId: '',
      referenceFrameNodeIds: [],
      explicitFrameNodeIds: [],
    })
    expect(map.get('v1')).toEqual({ role: 'reference_video', usageStatus: 'used' })
    expect(map.get('img1')).toEqual({ role: 'reference_image', usageStatus: 'used' })
  })

  it('video.generate 多模态：参考音频标 reference_audio role', () => {
    const map = computeMediaInputRoleMap({
      mediaInputs: [audio('a1'), image('img1')],
      selectedInputNodeIds: ['a1', 'img1'],
      supportsFrameRoles: false,
      supportsImageRoles: true,
      policy: {
        imageRoles: ['reference_image'],
        videoRoles: ['reference_video'],
        audioRoles: ['reference_audio'],
        defaultRoleAssignment: 'all_reference',
      },
      maxImages: 9,
      firstFrameNodeId: '',
      lastFrameNodeId: '',
      referenceFrameNodeIds: [],
      explicitFrameNodeIds: [],
    })
    expect(map.get('a1')).toEqual({ role: 'reference_audio', usageStatus: 'used' })
  })

  it('无图片角色 capability（如 audio.generate）：所有输入标 used 无 role', () => {
    const map = computeMediaInputRoleMap({
      mediaInputs: [image('img1'), video('v1')],
      selectedInputNodeIds: [],
      supportsFrameRoles: false,
      supportsImageRoles: false,
      policy: { defaultRoleAssignment: 'none' },
      maxImages: 0,
      firstFrameNodeId: '',
      lastFrameNodeId: '',
      referenceFrameNodeIds: [],
      explicitFrameNodeIds: [],
    })
    expect(map.get('img1')).toEqual({ usageStatus: 'used' })
    expect(map.get('v1')).toEqual({ usageStatus: 'used' })
  })
})
