import {
  capabilityForOperation,
  inferRolePolicy,
  type CanvasInputBinding,
  type CanvasInputBindingRole,
  type CanvasMediaInputMode,
  type CanvasMediaModelCapabilitySummary,
  type CanvasMediaModelSummary,
  type CanvasOperationType,
  type MediaCapabilityId,
  type MediaInputRolePolicy,
} from '@spark/protocol'

const MEDIA_KINDS = new Set<CanvasInputBinding['kind']>(['image', 'video', 'audio', 'file'])
const UNIFIED_VIDEO_OPERATIONS = new Set<CanvasOperationType>([
  'text_to_video',
  'image_to_video',
  'video_edit',
  'video_extend',
])
const UNIFIED_VIDEO_CAPABILITY_IDS: MediaCapabilityId[] = [
  'video.generate',
  'video.image_to_video',
  'video.reference_to_video',
  'video.edit',
  'video.extend',
]
/**
 * 合并后的「图片生成」容器覆盖的全部历史图片 operation。
 *
 * 与视频统一容器同构：新建菜单只产出 `text_to_image` 一种容器，但历史
 * `image_edit` / `image_compose` / `image_to_image` 节点继续沿用同一套
 * capability 池与模式选择器，运行时再按 mode + 参考图数量反推实际 operation。
 */
const UNIFIED_IMAGE_OPERATIONS = new Set<CanvasOperationType>([
  'text_to_image',
  'image_edit',
  'image_compose',
  'image_to_image',
])
const UNIFIED_IMAGE_CAPABILITY_IDS: MediaCapabilityId[] = ['image.generate', 'image.edit']

export type CanvasMediaInputModeOption = {
  mode: CanvasMediaInputMode
  label: string
  capabilityId: MediaCapabilityId
  capability: CanvasMediaModelCapabilitySummary
  rolePolicy: MediaInputRolePolicy
}

export type CanvasMediaInputAssignment = {
  sourceNodeId: string
  kind: CanvasInputBinding['kind']
  role: CanvasInputBindingRole
  order: number
  used: boolean
}

export function canvasMediaCapabilityIdsForOperation(
  operation: CanvasOperationType,
): MediaCapabilityId[] {
  if (UNIFIED_VIDEO_OPERATIONS.has(operation)) return [...UNIFIED_VIDEO_CAPABILITY_IDS]
  if (UNIFIED_IMAGE_OPERATIONS.has(operation)) return [...UNIFIED_IMAGE_CAPABILITY_IDS]
  return capabilityForOperation(operation)
}

export function executionOperationForCanvasMediaCapability(
  capabilityId: MediaCapabilityId | undefined,
  fallback: CanvasOperationType,
  options?: { imageInputCount?: number | undefined },
): CanvasOperationType {
  if (capabilityId === 'video.image_to_video') return 'image_to_video'
  if (capabilityId === 'video.edit') return 'video_edit'
  if (capabilityId === 'video.extend') return 'video_extend'
  if (capabilityId === 'video.generate' || capabilityId === 'video.reference_to_video') {
    return 'text_to_video'
  }
  if (capabilityId === 'image.generate') return 'text_to_image'
  if (capabilityId === 'image.edit') {
    // 图生图 / 编辑 / 多图合成共用 image.edit capability，按参考图数量反推 operation：
    // ≥2 张 → image_compose，否则 image_edit。imageInputCount 缺失按单图兜底，保持向后兼容。
    return (options?.imageInputCount ?? 0) >= 2 ? 'image_compose' : 'image_edit'
  }
  return fallback
}

export function canvasMediaInputModeOptions(
  operation: CanvasOperationType,
  model: CanvasMediaModelSummary | null | undefined,
): CanvasMediaInputModeOption[] {
  if (!model) return []
  const allowed = new Set(canvasMediaCapabilityIdsForOperation(operation))
  const candidates = model.capabilities.flatMap((capability) => {
    if (!allowed.has(capability.id as MediaCapabilityId)) return []
    return modeOptionsForCapability(capability)
  })
  const byMode = new Map<CanvasMediaInputMode, CanvasMediaInputModeOption>()
  for (const candidate of candidates) {
    const current = byMode.get(candidate.mode)
    if (!current || modeOptionPriority(candidate) > modeOptionPriority(current)) {
      byMode.set(candidate.mode, candidate)
    }
  }
  return Array.from(byMode.values()).sort(
    (left, right) => MODE_ORDER.indexOf(left.mode) - MODE_ORDER.indexOf(right.mode),
  )
}

export function resolveCanvasMediaInputMode(input: {
  preferred?: CanvasMediaInputMode | undefined
  operation: CanvasOperationType
  options: readonly CanvasMediaInputModeOption[]
  bindings: readonly CanvasInputBinding[]
}): CanvasMediaInputMode | undefined {
  const supported = new Set(input.options.map((option) => option.mode))
  if (input.preferred && supported.has(input.preferred)) return input.preferred
  const legacyMode = legacyCanvasMediaInputMode(input.operation)
  if (legacyMode && supported.has(legacyMode)) return legacyMode
  const available = new Set(
    input.options
      .filter((option) => !canvasMediaInputModeIssue(option, input.bindings))
      .map((option) => option.mode),
  )
  const media = canonicalMediaInventory(input.bindings)
  const images = media.filter((binding) => binding.kind === 'image')
  const hasVideoOrAudio = media.some(
    (binding) => binding.kind === 'video' || binding.kind === 'audio',
  )
  const hasExplicitLast = images.some((binding) => binding.role === 'last_frame')
  const hasExplicitFirst = images.some((binding) => binding.role === 'first_frame')
  const supports = (mode: CanvasMediaInputMode) => available.has(mode)

  if (hasVideoOrAudio && supports('reference')) return 'reference'
  if (hasExplicitLast && supports('first_last_frame')) return 'first_last_frame'
  if (hasExplicitFirst && supports('first_frame')) return 'first_frame'
  if (images.length > 0) {
    if (input.operation === 'text_to_video' && supports('reference')) return 'reference'
    if (images.length > 1 && supports('first_last_frame')) return 'first_last_frame'
    if (supports('first_frame')) return 'first_frame'
    if (supports('reference')) return 'reference'
  }
  if (supports('text')) return 'text'
  return (
    input.options.find((option) => option.mode === input.preferred)?.mode ?? input.options[0]?.mode
  )
}

function legacyCanvasMediaInputMode(
  operation: CanvasOperationType,
): CanvasMediaInputMode | undefined {
  if (operation === 'video_edit') return 'edit'
  if (operation === 'video_extend') return 'extend'
  // 图片统一容器：历史 image_edit / image_compose / image_to_image 节点默认落在
  // reference 模式（图生图 / 编辑），text_to_image 默认 text，避免旧节点漂移到文生图。
  if (operation === 'text_to_image') return 'text'
  if (
    operation === 'image_edit' ||
    operation === 'image_compose' ||
    operation === 'image_to_image'
  ) {
    return 'reference'
  }
  return undefined
}

export function canvasMediaInputModeIssue(
  option: CanvasMediaInputModeOption,
  bindings: readonly CanvasInputBinding[],
): string | undefined {
  const inventory = canonicalMediaInventory(bindings)
  const imageCount = inventory.filter((binding) => binding.kind === 'image').length
  const videoCount = inventory.filter((binding) => binding.kind === 'video').length
  const audioCount = inventory.filter((binding) => binding.kind === 'audio').length
  if (option.mode === 'text') return undefined
  if (option.mode === 'first_frame' && imageCount < 1) return '至少需要 1 张图片'
  if (option.mode === 'first_last_frame' && imageCount < 2) return '至少需要 2 张图片'
  if (option.mode === 'edit' || option.mode === 'extend') {
    return videoCount > 0 ? undefined : '至少需要 1 段视频'
  }
  if (option.mode === 'reference') {
    if (option.capability.input.required?.includes('image') && imageCount === 0) {
      return '至少需要 1 张图片'
    }
    if (option.capability.input.required?.includes('video') && videoCount === 0) {
      return '至少需要 1 段视频'
    }
    const hasSupportedReference =
      (imageCount > 0 && (option.rolePolicy.imageRoles?.includes('reference_image') ?? false)) ||
      (videoCount > 0 && (option.rolePolicy.videoRoles?.includes('reference_video') ?? false)) ||
      (audioCount > 0 && (option.rolePolicy.audioRoles?.includes('reference_audio') ?? false))
    return hasSupportedReference ? undefined : '请先添加模型支持的参考资源'
  }
  return undefined
}

export function capabilityIdForCanvasMediaInputMode(
  mode: CanvasMediaInputMode | undefined,
  options: readonly CanvasMediaInputModeOption[],
): MediaCapabilityId | undefined {
  return options.find((option) => option.mode === mode)?.capabilityId
}

/**
 * 视频编辑 / 延长合并判定：当模型同时支持 video.edit 与 video.extend 时，二者输入形状、参数、
 * 角色策略完全同构（仅 provider 模型名后缀不同），可在 UI 上合并为一个「视频编辑 / 延长」模式，
 * 用子开关切换。本函数返回这对选项供 UI 渲染合并行 + 动态子开关；任一缺失则返回 null（不合并）。
 */
export function collapseVideoEditExtendOptions(
  options: readonly CanvasMediaInputModeOption[],
): { edit: CanvasMediaInputModeOption; extend: CanvasMediaInputModeOption } | null {
  let edit: CanvasMediaInputModeOption | undefined
  let extend: CanvasMediaInputModeOption | undefined
  for (const option of options) {
    if (option.mode === 'edit') edit = option
    else if (option.mode === 'extend') extend = option
  }
  if (!edit || !extend) return null
  return { edit, extend }
}

export function applyCanvasMediaInputModeToBindings(input: {
  bindings: readonly CanvasInputBinding[]
  mode: CanvasMediaInputMode
  option: CanvasMediaInputModeOption
}): CanvasInputBinding[] {
  const inventory = canonicalMediaInventory(input.bindings)
  const assignments = assignMediaInventory(inventory, input.mode, input.option)
  const assignmentBySource = new Map(assignments.map((item) => [item.sourceNodeId, item]))
  const nonMedia = input.bindings
    .filter((binding) => binding.enabled && !MEDIA_KINDS.has(binding.kind))
    .map((binding) => ({ ...binding }))
  const media = inventory.map((binding, index) => {
    const assignment = assignmentBySource.get(binding.sourceNodeId)
    const role = assignment?.role ?? 'input'
    return {
      ...binding,
      id: `${binding.origin}:${binding.sourceNodeId}:${role}`,
      role,
      relation: relationForMediaRole(binding, role),
      order: nonMedia.length + index,
    }
  })
  return [...nonMedia, ...media]
}

function relationForMediaRole(
  binding: CanvasInputBinding,
  role: CanvasInputBindingRole,
): CanvasInputBinding['relation'] {
  if (role === 'first_frame' || role === 'last_frame') return role
  if (role === 'input' && MEDIA_KINDS.has(binding.kind)) return 'generic'
  if (role !== 'reference') return binding.relation
  if (binding.kind === 'video') return 'reference_video'
  if (binding.kind === 'audio') return 'reference_audio'
  if (binding.kind === 'image') return 'reference_image'
  return binding.relation
}

export function executionCanvasInputBindings(input: {
  bindings: readonly CanvasInputBinding[]
  mode: CanvasMediaInputMode
  option: CanvasMediaInputModeOption
}): CanvasInputBinding[] {
  const normalized = applyCanvasMediaInputModeToBindings(input)
  const inventory = normalized.filter((binding) => MEDIA_KINDS.has(binding.kind))
  const assignments = assignMediaInventory(inventory, input.mode, input.option)
  const used = new Set(assignments.filter((item) => item.used).map((item) => item.sourceNodeId))
  return normalized.filter(
    (binding) => !MEDIA_KINDS.has(binding.kind) || used.has(binding.sourceNodeId),
  )
}

export function canvasMediaInputAssignments(input: {
  bindings: readonly CanvasInputBinding[]
  mode: CanvasMediaInputMode
  option: CanvasMediaInputModeOption
}): CanvasMediaInputAssignment[] {
  return assignMediaInventory(canonicalMediaInventory(input.bindings), input.mode, input.option)
}

export function moveCanvasMediaInputBinding(
  bindings: readonly CanvasInputBinding[],
  sourceNodeId: string,
  direction: -1 | 1,
): CanvasInputBinding[] {
  const sourceIds = canonicalMediaInventory(bindings).map((binding) => binding.sourceNodeId)
  const index = sourceIds.indexOf(sourceNodeId)
  const target = index + direction
  if (index < 0 || target < 0 || target >= sourceIds.length)
    return bindings.map((item) => ({ ...item }))
  ;[sourceIds[index], sourceIds[target]] = [sourceIds[target]!, sourceIds[index]!]
  const rank = new Map(sourceIds.map((id, order) => [id, order]))
  const firstMediaOrder = bindings.reduce(
    (current, binding) =>
      binding.enabled && MEDIA_KINDS.has(binding.kind) ? Math.min(current, binding.order) : current,
    Number.POSITIVE_INFINITY,
  )
  const base = Number.isFinite(firstMediaOrder) ? firstMediaOrder : 0
  return bindings.map((binding) => {
    const order = rank.get(binding.sourceNodeId)
    return order == null ? { ...binding } : { ...binding, order: base + order }
  })
}

export function canvasInputRolesFromBindings(
  bindings: readonly CanvasInputBinding[],
): Record<string, CanvasInputBindingRole | CanvasInputBindingRole[]> | undefined {
  const grouped = new Map<string, CanvasInputBindingRole[]>()
  for (const binding of bindings) {
    if (!binding.enabled || !MEDIA_KINDS.has(binding.kind)) continue
    const role = binding.role ?? 'input'
    const roles = grouped.get(binding.sourceNodeId) ?? []
    if (!roles.includes(role)) roles.push(role)
    grouped.set(binding.sourceNodeId, roles)
  }
  if (grouped.size === 0) return undefined
  return Object.fromEntries(
    Array.from(grouped, ([sourceNodeId, roles]) => [
      sourceNodeId,
      roles.length === 1 ? roles[0]! : roles,
    ]),
  )
}

function modeOptionsForCapability(
  capability: CanvasMediaModelCapabilitySummary,
): CanvasMediaInputModeOption[] {
  const capabilityId = capability.id as MediaCapabilityId
  const rolePolicy = inferRolePolicy(capability)
  const option = (mode: CanvasMediaInputMode, label: string): CanvasMediaInputModeOption => ({
    mode,
    label,
    capabilityId,
    capability,
    rolePolicy,
  })
  // 图片统一容器：image.generate 固定文生图（text），image.edit 固定图生图 / 编辑（reference）。
  // 模式可选性完全由模型 manifest 声明的 capability 决定——缺素材只在提交时阻断。
  if (capabilityId === 'image.generate') return [option('text', '文生图')]
  if (capabilityId === 'image.edit') return [option('reference', '图生图 / 编辑')]
  if (capabilityId === 'video.generate') {
    const hasReferences =
      (rolePolicy.imageRoles?.includes('reference_image') ?? false) ||
      (rolePolicy.videoRoles?.includes('reference_video') ?? false) ||
      (rolePolicy.audioRoles?.includes('reference_audio') ?? false)
    return hasReferences
      ? [option('text', '文生视频'), option('reference', '全能参考')]
      : [option('text', '文生视频')]
  }
  if (capabilityId === 'video.image_to_video') {
    const result: CanvasMediaInputModeOption[] = []
    if (rolePolicy.imageRoles?.includes('first_frame')) {
      result.push(option('first_frame', '首帧生成'))
    }
    if (rolePolicy.imageRoles?.includes('last_frame')) {
      result.push(option('first_last_frame', '首尾帧生成'))
    }
    if (
      rolePolicy.imageRoles?.includes('reference_image') ||
      rolePolicy.videoRoles?.includes('reference_video') ||
      rolePolicy.audioRoles?.includes('reference_audio')
    ) {
      result.push(option('reference', '全能参考'))
    }
    return result
  }
  if (capabilityId === 'video.reference_to_video') {
    return [option('reference', '全能参考')]
  }
  if (capabilityId === 'video.edit') return [option('edit', '视频编辑')]
  if (capabilityId === 'video.extend') return [option('extend', '视频延长')]
  return []
}

function modeOptionPriority(option: CanvasMediaInputModeOption): number {
  if (option.mode !== 'reference') return 1
  if (option.capabilityId === 'video.reference_to_video') return 3
  if (option.capabilityId === 'video.generate') return 2
  return 1
}

function canonicalMediaInventory(bindings: readonly CanvasInputBinding[]): CanvasInputBinding[] {
  const grouped = new Map<string, CanvasInputBinding[]>()
  for (const binding of bindings) {
    if (!binding.enabled || !MEDIA_KINDS.has(binding.kind)) continue
    const current = grouped.get(binding.sourceNodeId) ?? []
    current.push(binding)
    grouped.set(binding.sourceNodeId, current)
  }
  return Array.from(grouped.values())
    .map((items) => {
      const ordered = [...items].sort(
        (left, right) =>
          rolePriority(right.role) - rolePriority(left.role) ||
          left.order - right.order ||
          left.id.localeCompare(right.id),
      )
      const selected = ordered[0]!
      const promptOwner = items.find((item) => item.promptBlockId)?.promptBlockId
      return { ...selected, ...(promptOwner ? { promptBlockId: promptOwner } : {}) }
    })
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
}

function assignMediaInventory(
  inventory: readonly CanvasInputBinding[],
  mode: CanvasMediaInputMode,
  option: Pick<CanvasMediaInputModeOption, 'capability' | 'rolePolicy'>,
): CanvasMediaInputAssignment[] {
  const policy = option.rolePolicy
  const result = inventory.map(
    (binding, index): CanvasMediaInputAssignment => ({
      sourceNodeId: binding.sourceNodeId,
      kind: binding.kind,
      role: binding.role ?? 'input',
      order: index,
      used: false,
    }),
  )
  if (mode === 'text') return result
  if (mode === 'reference') {
    let images = 0
    let videos = 0
    let audios = 0
    return result.map((item) => {
      const referenceKind = item.kind === 'image' || item.kind === 'video' || item.kind === 'audio'
      let used = false
      if (
        item.kind === 'image' &&
        policy.imageRoles?.includes('reference_image') &&
        images < (option.capability.input.maxImages ?? Number.POSITIVE_INFINITY)
      ) {
        images += 1
        used = true
      } else if (
        item.kind === 'video' &&
        policy.videoRoles?.includes('reference_video') &&
        videos < (option.capability.input.maxVideos ?? Number.POSITIVE_INFINITY)
      ) {
        videos += 1
        used = true
      } else if (
        item.kind === 'audio' &&
        policy.audioRoles?.includes('reference_audio') &&
        audios < (option.capability.input.maxAudios ?? Number.POSITIVE_INFINITY)
      ) {
        audios += 1
        used = true
      }
      return { ...item, role: referenceKind ? 'reference' : 'input', used }
    })
  }
  if (mode === 'first_frame' || mode === 'first_last_frame') {
    const images = result.filter((item) => item.kind === 'image')
    const first = images.find((item) => item.role === 'first_frame') ?? images[0]
    const last =
      mode === 'first_last_frame'
        ? (images.find((item) => item.role === 'last_frame' && item !== first) ??
          images.find((item) => item !== first))
        : undefined
    let usedImages = Number(first != null) + Number(last != null)
    let usedVideos = 0
    let usedAudios = 0
    return result.map((item) => {
      if (item === first) return { ...item, role: 'first_frame', used: true }
      if (item === last) return { ...item, role: 'last_frame', used: true }
      if (
        item.kind === 'image' &&
        policy.imageRoles?.includes('reference_image') &&
        usedImages < (option.capability.input.maxImages ?? Number.POSITIVE_INFINITY)
      ) {
        usedImages += 1
        return { ...item, role: 'reference', used: true }
      }
      if (
        item.kind === 'video' &&
        policy.videoRoles?.includes('reference_video') &&
        usedVideos < (option.capability.input.maxVideos ?? Number.POSITIVE_INFINITY)
      ) {
        usedVideos += 1
        return { ...item, role: 'reference', used: true }
      }
      if (
        item.kind === 'audio' &&
        policy.audioRoles?.includes('reference_audio') &&
        usedAudios < (option.capability.input.maxAudios ?? Number.POSITIVE_INFINITY)
      ) {
        usedAudios += 1
        return { ...item, role: 'reference', used: true }
      }
      return { ...item, role: 'input', used: false }
    })
  }
  if (mode === 'edit' || mode === 'extend') return assignVideoSourceAndReferences(result, option)
  return result
}

function assignVideoSourceAndReferences(
  inventory: readonly CanvasMediaInputAssignment[],
  option: Pick<CanvasMediaInputModeOption, 'capability' | 'rolePolicy'>,
): CanvasMediaInputAssignment[] {
  const source = inventory.find((item) => item.kind === 'video')
  let images = 0
  let videos = source ? 1 : 0
  let audios = 0
  const maxImages = option.capability.input.maxImages ?? Number.POSITIVE_INFINITY
  const maxVideos = option.capability.input.maxVideos ?? Number.POSITIVE_INFINITY
  const maxAudios = option.capability.input.maxAudios ?? Number.POSITIVE_INFINITY
  return inventory.map((item) => {
    if (item === source) return { ...item, role: 'input', used: true }
    if (
      item.kind === 'image' &&
      option.rolePolicy.imageRoles?.includes('reference_image') &&
      images < maxImages
    ) {
      images += 1
      return { ...item, role: 'reference', used: true }
    }
    if (
      item.kind === 'video' &&
      option.rolePolicy.videoRoles?.includes('reference_video') &&
      videos < maxVideos
    ) {
      videos += 1
      return { ...item, role: 'reference', used: true }
    }
    if (
      item.kind === 'audio' &&
      option.rolePolicy.audioRoles?.includes('reference_audio') &&
      audios < maxAudios
    ) {
      audios += 1
      return { ...item, role: 'reference', used: true }
    }
    return { ...item, role: 'input', used: false }
  })
}

function rolePriority(role: CanvasInputBinding['role']): number {
  if (role === 'first_frame' || role === 'last_frame' || role === 'mask') return 3
  if (role === 'reference') return 2
  return 1
}

const MODE_ORDER: CanvasMediaInputMode[] = [
  'text',
  'first_frame',
  'first_last_frame',
  'reference',
  'edit',
  'extend',
]
