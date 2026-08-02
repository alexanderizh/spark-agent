import { describe, expect, it } from 'vitest'
import type {
  CanvasInputBinding,
  CanvasMediaModelSummary,
  MediaInputRolePolicy,
} from '@spark/protocol'
import { BUILTIN_MEDIA_MODEL_MANIFESTS } from '@spark/protocol'
import {
  applyCanvasMediaInputModeToBindings,
  canvasMediaInputAssignments,
  canvasMediaInputModeOptions,
  capabilityIdForCanvasMediaInputMode,
  collapseVideoEditExtendOptions,
  executionOperationForCanvasMediaCapability,
  executionCanvasInputBindings,
  resolveCanvasMediaInputMode,
} from './canvasMediaInputMode'

describe('canvasMediaInputMode', () => {
  it('exposes every supported video mode from every compatible legacy video node', () => {    const summary = model([
      capability('video.generate', {}),
      capability('video.image_to_video', {
        imageRoles: ['first_frame', 'last_frame'],
        defaultRoleAssignment: 'first_then_last_then_reference',
      }),
      capability('video.reference_to_video', {
        imageRoles: ['reference_image'],
        videoRoles: ['reference_video'],
        audioRoles: ['reference_audio'],
        defaultRoleAssignment: 'all_reference',
      }),
      capability('video.edit', {
        imageRoles: ['reference_image'],
        videoRoles: ['input_video', 'reference_video'],
        audioRoles: ['reference_audio'],
        defaultRoleAssignment: 'none',
      }),
      capability('video.extend', {
        imageRoles: ['reference_image'],
        videoRoles: ['input_video', 'reference_video'],
        audioRoles: ['reference_audio'],
        defaultRoleAssignment: 'none',
      }),
    ])

    for (const operation of [
      'text_to_video',
      'image_to_video',
      'video_edit',
      'video_extend',
    ] as const) {
      expect(
        canvasMediaInputModeOptions(operation, summary).map((option) => option.mode),
        operation,
      ).toEqual(['text', 'first_frame', 'first_last_frame', 'reference', 'edit', 'extend'])
    }
  })

  it('maps the selected capability to the actual task operation', () => {
    expect(executionOperationForCanvasMediaCapability('video.generate', 'video_edit')).toBe(
      'text_to_video',
    )
    expect(
      executionOperationForCanvasMediaCapability('video.reference_to_video', 'image_to_video'),
    ).toBe('text_to_video')
    expect(
      executionOperationForCanvasMediaCapability('video.image_to_video', 'text_to_video'),
    ).toBe('image_to_video')
    expect(executionOperationForCanvasMediaCapability('video.edit', 'text_to_video')).toBe(
      'video_edit',
    )
    expect(executionOperationForCanvasMediaCapability('video.extend', 'text_to_video')).toBe(
      'video_extend',
    )
  })

  describe('collapseVideoEditExtendOptions', () => {
    it('returns both options when the model supports edit and extend', () => {
      const options = canvasMediaInputModeOptions(
        'video_edit',
        model([
          capability('video.edit', {
            videoRoles: ['input_video', 'reference_video'],
            defaultRoleAssignment: 'none',
          }),
          capability('video.extend', {
            videoRoles: ['input_video', 'reference_video'],
            defaultRoleAssignment: 'none',
          }),
        ]),
      )
      const collapsed = collapseVideoEditExtendOptions(options)
      expect(collapsed?.edit.mode).toBe('edit')
      expect(collapsed?.extend.mode).toBe('extend')
    })

    it('returns null when only edit is supported', () => {
      const options = canvasMediaInputModeOptions(
        'video_edit',
        model([
          capability('video.edit', {
            videoRoles: ['input_video'],
            defaultRoleAssignment: 'none',
          }),
        ]),
      )
      expect(collapseVideoEditExtendOptions(options)).toBeNull()
    })

    it('returns null when only extend is supported', () => {
      const options = canvasMediaInputModeOptions(
        'video_extend',
        model([
          capability('video.extend', {
            videoRoles: ['input_video'],
            defaultRoleAssignment: 'none',
          }),
        ]),
      )
      expect(collapseVideoEditExtendOptions(options)).toBeNull()
    })

    it('returns null when neither edit nor extend is supported', () => {
      const options = canvasMediaInputModeOptions(
        'text_to_video',
        model([capability('video.generate', {})]),
      )
      expect(collapseVideoEditExtendOptions(options)).toBeNull()
    })
  })

  it('matches the shipped Volcengine Seedance capability matrix', () => {
    const manifests = BUILTIN_MEDIA_MODEL_MANIFESTS.filter(
      (item) => item.providerKind === 'volcengine-ark' && item.modelId.includes('seedance'),
    )
    const legacy = manifests.filter((item) => item.modelId.includes('seedance-1-'))
    const version2 = manifests.filter((item) => item.modelId.includes('seedance-2-'))
    expect(legacy).not.toHaveLength(0)
    expect(version2).not.toHaveLength(0)
    for (const manifest of legacy) {
      expect(
        canvasMediaInputModeOptions('image_to_video', summaryFromManifest(manifest)).map(
          (item) => item.mode,
        ),
        manifest.modelId,
      ).not.toContain('reference')
    }
    for (const manifest of version2) {
      expect(
        canvasMediaInputModeOptions('image_to_video', summaryFromManifest(manifest)).map(
          (item) => item.mode,
        ),
        manifest.modelId,
      ).toContain('reference')
    }
  })

  it('keeps APIMart Seedance 1.x and 2.x input modes isolated', () => {
    const manifests = BUILTIN_MEDIA_MODEL_MANIFESTS.filter(
      (item) => item.providerKind === 'apimart' && item.modelId.includes('doubao-seedance'),
    )
    const legacy = manifests.filter((item) => item.modelId.includes('seedance-1-'))
    const version2 = manifests.filter((item) => /seedance-2(?:[.-])/.test(item.modelId))
    expect(legacy).not.toHaveLength(0)
    expect(version2).not.toHaveLength(0)
    for (const manifest of legacy) {
      expect(
        canvasMediaInputModeOptions('image_to_video', summaryFromManifest(manifest)).map(
          (item) => item.mode,
        ),
        manifest.modelId,
      ).not.toContain('reference')
    }
    for (const manifest of version2) {
      expect(
        canvasMediaInputModeOptions('image_to_video', summaryFromManifest(manifest)).map(
          (item) => item.mode,
        ),
        manifest.modelId,
      ).toContain('reference')
    }
  })

  it('derives modes from every shipped video manifest without provider-specific guesses', () => {
    const manifests = BUILTIN_MEDIA_MODEL_MANIFESTS.filter((item) => item.domains.includes('video'))
    expect(manifests.length).toBeGreaterThan(10)
    for (const manifest of manifests) {
      const summary = summaryFromManifest(manifest)
      const options = canvasMediaInputModeOptions('text_to_video', summary)
      expect(new Set(options.map((item) => item.mode)).size, manifest.id).toBe(options.length)
      for (const option of options) {
        expect(
          manifest.capabilities.some((capability) => capability.id === option.capabilityId),
          `${manifest.id}/${option.mode}`,
        ).toBe(true)
        if (option.mode === 'reference') {
          expect(
            Boolean(
              option.rolePolicy.imageRoles?.includes('reference_image') ||
              option.rolePolicy.videoRoles?.includes('reference_video') ||
              option.rolePolicy.audioRoles?.includes('reference_audio'),
            ),
            `${manifest.id}/${option.capabilityId}`,
          ).toBe(true)
        }
        if (option.mode === 'first_last_frame') {
          expect(option.rolePolicy.imageRoles).toContain('last_frame')
        }
      }
    }
  })

  it('derives Seedance 1.x text, first-frame and first-last modes without reference', () => {
    const options = canvasMediaInputModeOptions(
      'image_to_video',
      model([
        capability('video.generate', {}),
        capability(
          'video.image_to_video',
          {
            imageRoles: ['first_frame', 'last_frame'],
            defaultRoleAssignment: 'first_then_last_then_reference',
          },
          2,
        ),
      ]),
    )
    expect(options.map((item) => item.mode)).toEqual(['text', 'first_frame', 'first_last_frame'])
  })

  it('prefers the dedicated reference capability for Seedance 2.x', () => {
    const options = canvasMediaInputModeOptions(
      'text_to_video',
      model([
        capability(
          'video.generate',
          {
            imageRoles: ['reference_image'],
            videoRoles: ['reference_video'],
            audioRoles: ['reference_audio'],
            defaultRoleAssignment: 'all_reference',
          },
          9,
        ),
        capability(
          'video.reference_to_video',
          {
            imageRoles: ['reference_image'],
            videoRoles: ['reference_video'],
            audioRoles: ['reference_audio'],
            defaultRoleAssignment: 'all_reference',
          },
          9,
        ),
      ]),
    )
    expect(options.map((item) => item.mode)).toEqual(['text', 'reference'])
    expect(capabilityIdForCanvasMediaInputMode('reference', options)).toBe(
      'video.reference_to_video',
    )
  })

  it('keeps compatible references active beside first and last frames for hybrid models', () => {
    const options = canvasMediaInputModeOptions(
      'image_to_video',
      model([
        capability(
          'video.image_to_video',
          {
            imageRoles: ['first_frame', 'last_frame', 'reference_image'],
            videoRoles: ['reference_video'],
            audioRoles: ['reference_audio'],
            defaultRoleAssignment: 'first_then_last_then_reference',
          },
          9,
        ),
      ]),
    )
    expect(options.map((item) => item.mode)).toEqual([
      'first_frame',
      'first_last_frame',
      'reference',
    ])
    const option = options.find((item) => item.mode === 'first_last_frame')!
    const bindings = [
      binding('first', 'first_frame', 0),
      binding('last', 'last_frame', 1),
      binding('image-ref', 'reference', 2),
      binding('video-ref', 'reference', 3, 'picker', 'video'),
      binding('audio-ref', 'reference', 4, 'picker', 'audio'),
    ]

    expect(
      canvasMediaInputAssignments({ bindings, mode: 'first_last_frame', option }).map(
        ({ kind, role, used }) => ({ kind, role, used }),
      ),
    ).toEqual([
      { kind: 'image', role: 'first_frame', used: true },
      { kind: 'image', role: 'last_frame', used: true },
      { kind: 'image', role: 'reference', used: true },
      { kind: 'video', role: 'reference', used: true },
      { kind: 'audio', role: 'reference', used: true },
    ])
    expect(
      executionCanvasInputBindings({ bindings, mode: 'first_last_frame', option }),
    ).toHaveLength(5)
  })

  it('migrates legacy reference images to Seedance 1.x first and last frames', () => {
    const options = canvasMediaInputModeOptions(
      'image_to_video',
      model([
        capability(
          'video.image_to_video',
          {
            imageRoles: ['first_frame', 'last_frame'],
            defaultRoleAssignment: 'first_then_last_then_reference',
          },
          2,
        ),
      ]),
    )
    const bindings = [binding('a', 'reference', 0), binding('b', 'reference', 1)]
    const mode = resolveCanvasMediaInputMode({ operation: 'image_to_video', options, bindings })
    expect(mode).toBe('first_last_frame')
    const normalized = applyCanvasMediaInputModeToBindings({
      bindings,
      mode: mode!,
      option: options.find((item) => item.mode === mode)!,
    })
    expect(normalized.map((item) => item.role)).toEqual(['first_frame', 'last_frame'])
    expect(normalized.map((item) => item.relation)).toEqual(['first_frame', 'last_frame'])
  })

  it('keeps an explicitly selected first-last mode after the tail image is removed', () => {
    const options = canvasMediaInputModeOptions(
      'image_to_video',
      model([
        capability(
          'video.image_to_video',
          {
            imageRoles: ['first_frame', 'last_frame'],
            defaultRoleAssignment: 'first_then_last_then_reference',
          },
          2,
        ),
      ]),
    )

    expect(
      resolveCanvasMediaInputMode({
        preferred: 'first_last_frame',
        operation: 'image_to_video',
        options,
        bindings: [binding('a', 'first_frame', 0)],
      }),
    ).toBe('first_last_frame')
  })

  it.each([
    ['video_edit', 'edit'],
    ['video_extend', 'extend'],
  ] as const)(
    'preserves the legacy %s node mode when no explicit mode was persisted',
    (operation, expected) => {
      const options = canvasMediaInputModeOptions(
        operation,
        model([
          capability('video.generate', {}),
          capability('video.reference_to_video', {
            videoRoles: ['reference_video'],
            defaultRoleAssignment: 'all_reference',
          }),
          capability('video.edit', {
            videoRoles: ['input_video', 'reference_video'],
            defaultRoleAssignment: 'none',
          }),
          capability('video.extend', {
            videoRoles: ['input_video', 'reference_video'],
            defaultRoleAssignment: 'none',
          }),
        ]),
      )

      expect(
        resolveCanvasMediaInputMode({
          operation,
          options,
          bindings: [binding('legacy-video', 'input', 0, 'connection', 'video')],
        }),
      ).toBe(expected)
    },
  )

  it('deduplicates one resource that arrived through connection and prompt mention', () => {
    const options = canvasMediaInputModeOptions(
      'image_to_video',
      model([
        capability(
          'video.image_to_video',
          {
            imageRoles: ['first_frame'],
            defaultRoleAssignment: 'first_then_last_then_reference',
          },
          1,
        ),
      ]),
    )
    const bindings: CanvasInputBinding[] = [
      binding('a', 'reference', 0, 'connection'),
      binding('a', 'first_frame', 1, 'manual'),
    ]
    const option = options[0]!
    expect(canvasMediaInputAssignments({ bindings, mode: 'first_frame', option })).toEqual([
      expect.objectContaining({ sourceNodeId: 'a', role: 'first_frame', used: true }),
    ])
    expect(executionCanvasInputBindings({ bindings, mode: 'first_frame', option })).toHaveLength(1)
  })

  it('keeps extra frame inputs visible but excludes them from execution', () => {
    const options = canvasMediaInputModeOptions(
      'image_to_video',
      model([
        capability(
          'video.image_to_video',
          {
            imageRoles: ['first_frame'],
            defaultRoleAssignment: 'first_then_last_then_reference',
          },
          1,
        ),
      ]),
    )
    const option = options[0]!
    const bindings = [binding('a', 'reference', 0), binding('b', 'reference', 1)]
    const assignments = canvasMediaInputAssignments({ bindings, mode: 'first_frame', option })
    expect(assignments.map((item) => item.used)).toEqual([true, false])
    expect(executionCanvasInputBindings({ bindings, mode: 'first_frame', option })).toHaveLength(1)
  })

  it('keeps image, video and audio resources as references in multimodal mode', () => {
    const options = canvasMediaInputModeOptions(
      'text_to_video',
      model([
        capability('video.reference_to_video', {
          imageRoles: ['reference_image'],
          videoRoles: ['reference_video'],
          audioRoles: ['reference_audio'],
          defaultRoleAssignment: 'all_reference',
        }),
      ]),
    )
    const option = options[0]!
    const bindings = [
      binding('image', 'reference', 0, 'picker', 'image'),
      binding('video', 'input', 1, 'picker', 'video'),
      binding('audio', 'input', 2, 'picker', 'audio'),
    ]

    expect(
      canvasMediaInputAssignments({ bindings, mode: 'reference', option }).map(
        ({ kind, role, used }) => ({ kind, role, used }),
      ),
    ).toEqual([
      { kind: 'image', role: 'reference', used: true },
      { kind: 'video', role: 'reference', used: true },
      { kind: 'audio', role: 'reference', used: true },
    ])
  })

  it('keeps an edit source video as input instead of a reference video', () => {
    const options = canvasMediaInputModeOptions(
      'video_edit',
      model([
        capability('video.edit', {
          videoRoles: ['input_video'],
          imageRoles: ['reference_image'],
          defaultRoleAssignment: 'none',
        }),
      ]),
    )
    const option = options[0]!
    const execution = executionCanvasInputBindings({
      bindings: [binding('video', 'input', 0, 'picker', 'video')],
      mode: 'edit',
      option,
    })

    expect(execution).toEqual([
      expect.objectContaining({ kind: 'video', role: 'input', relation: 'generic' }),
    ])
  })

  it('keeps compatible image, video and audio references beside an edit source video', () => {
    const option = canvasMediaInputModeOptions(
      'video_edit',
      model([
        capabilityWithLimits(
          'video.edit',
          {
            imageRoles: ['reference_image'],
            videoRoles: ['input_video', 'reference_video'],
            audioRoles: ['reference_audio'],
            defaultRoleAssignment: 'none',
          },
          { maxImages: 1, maxVideos: 2, maxAudios: 1 },
        ),
      ]),
    ).find((item) => item.mode === 'edit')!
    const bindings = [
      binding('source', 'input', 0, 'picker', 'video'),
      binding('video-ref', 'reference', 1, 'picker', 'video'),
      binding('image-ref', 'reference', 2, 'picker', 'image'),
      binding('audio-ref', 'reference', 3, 'picker', 'audio'),
    ]

    expect(
      canvasMediaInputAssignments({ bindings, mode: 'edit', option }).map(
        ({ sourceNodeId, role, used }) => ({ sourceNodeId, role, used }),
      ),
    ).toEqual([
      { sourceNodeId: 'source', role: 'input', used: true },
      { sourceNodeId: 'video-ref', role: 'reference', used: true },
      { sourceNodeId: 'image-ref', role: 'reference', used: true },
      { sourceNodeId: 'audio-ref', role: 'reference', used: true },
    ])
  })

  it('keeps compatible references beside an extend source video', () => {
    const option = canvasMediaInputModeOptions(
      'video_extend',
      model([
        capabilityWithLimits(
          'video.extend',
          {
            imageRoles: ['reference_image'],
            videoRoles: ['input_video', 'reference_video'],
            audioRoles: ['reference_audio'],
            defaultRoleAssignment: 'none',
          },
          { maxImages: 1, maxVideos: 2, maxAudios: 1 },
        ),
      ]),
    ).find((item) => item.mode === 'extend')!
    const bindings = [
      binding('source', 'input', 0, 'picker', 'video'),
      binding('video-ref', 'reference', 1, 'picker', 'video'),
      binding('image-ref', 'reference', 2, 'picker', 'image'),
      binding('audio-ref', 'reference', 3, 'picker', 'audio'),
    ]

    expect(
      canvasMediaInputAssignments({ bindings, mode: 'extend', option }).map(
        ({ sourceNodeId, role, used }) => ({ sourceNodeId, role, used }),
      ),
    ).toEqual([
      { sourceNodeId: 'source', role: 'input', used: true },
      { sourceNodeId: 'video-ref', role: 'reference', used: true },
      { sourceNodeId: 'image-ref', role: 'reference', used: true },
      { sourceNodeId: 'audio-ref', role: 'reference', used: true },
    ])
  })

  it('keeps reference overflow visible but excludes it from execution', () => {
    const options = canvasMediaInputModeOptions(
      'text_to_video',
      model([
        capability(
          'video.reference_to_video',
          {
            imageRoles: ['reference_image'],
            defaultRoleAssignment: 'all_reference',
          },
          1,
        ),
      ]),
    )
    const option = options[0]!
    const bindings = [binding('a', 'reference', 0), binding('b', 'reference', 1)]

    expect(
      canvasMediaInputAssignments({ bindings, mode: 'reference', option }).map((item) => item.used),
    ).toEqual([true, false])
    expect(executionCanvasInputBindings({ bindings, mode: 'reference', option })).toHaveLength(1)
  })
})

function model(capabilities: CanvasMediaModelSummary['capabilities']): CanvasMediaModelSummary {
  return {
    manifestId: 'test:model',
    providerKind: 'volcengine-ark',
    modelId: 'test-model',
    effectiveModelId: 'test-model',
    displayName: 'Test model',
    domains: ['video'],
    invocationMode: 'async_polling',
    capabilities,
    sourceUrls: [],
    enabled: true,
  }
}

function summaryFromManifest(
  manifest: (typeof BUILTIN_MEDIA_MODEL_MANIFESTS)[number],
): CanvasMediaModelSummary {
  return {
    manifestId: manifest.id,
    providerKind: manifest.providerKind,
    modelId: manifest.modelId,
    effectiveModelId: manifest.modelId,
    displayName: manifest.displayName,
    domains: manifest.domains,
    invocationMode: manifest.invocation.mode,
    capabilities: manifest.capabilities.map((item) => ({
      id: item.id,
      label: item.label,
      input: item.input,
      ...(item.rolePolicy ? { rolePolicy: item.rolePolicy } : {}),
      output: item.output,
      paramSchema: item.paramSchema,
      ...(item.defaults ? { defaults: item.defaults } : {}),
    })),
    sourceUrls: manifest.docs.sourceUrls,
    enabled: true,
  }
}

function capability(
  id: string,
  rolePolicy: MediaInputRolePolicy,
  maxImages = 0,
): CanvasMediaModelSummary['capabilities'][number] {
  return {
    id,
    label: id,
    input: { required: [], ...(maxImages > 0 ? { maxImages } : {}) },
    rolePolicy,
    output: { types: ['video'] },
    paramSchema: {},
  }
}

function capabilityWithLimits(
  id: string,
  rolePolicy: MediaInputRolePolicy,
  limits: { maxImages?: number; maxVideos?: number; maxAudios?: number },
): CanvasMediaModelSummary['capabilities'][number] {
  return {
    id,
    label: id,
    input: { required: [], ...limits },
    rolePolicy,
    output: { types: ['video'] },
    paramSchema: {},
  }
}

function binding(
  sourceNodeId: string,
  role: CanvasInputBinding['role'],
  order: number,
  origin: CanvasInputBinding['origin'] = 'picker',
  kind: CanvasInputBinding['kind'] = 'image',
): CanvasInputBinding {
  return {
    id: `${origin}:${sourceNodeId}:${role}`,
    sourceNodeId,
    origin,
    kind,
    relation:
      kind === 'video'
        ? 'reference_video'
        : kind === 'audio'
          ? 'reference_audio'
          : 'reference_image',
    ...(role ? { role } : {}),
    enabled: true,
    order,
  }
}
