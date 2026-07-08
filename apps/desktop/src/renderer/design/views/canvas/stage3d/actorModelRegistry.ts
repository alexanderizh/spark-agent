import type {
  Stage3DActorModelId,
  Stage3DActorModelSource,
  Stage3DActorRigType,
} from './stage3d.types'

export type Stage3DActorModelDef = {
  id: Stage3DActorModelId
  label: string
  description: string
  source: Stage3DActorModelSource
  rigType: Stage3DActorRigType
}

export const DEFAULT_STAGE3D_ACTOR_MODEL_ID: Stage3DActorModelId = 'mixamo-mannequin'

export const BUILTIN_STAGE3D_ACTOR_MODELS: Stage3DActorModelDef[] = [
  {
    id: 'mixamo-mannequin',
    label: 'Mixamo 素体',
    description: '内置 FBX 素体，作为导演台默认人物模型。',
    source: 'builtin',
    rigType: 'mixamo',
  },
  {
    id: 'ue4-mannequin',
    label: 'UE4 素体',
    description: '参考项目引入的可摆姿势素体，体型使用局部骨骼比例。',
    source: 'builtin',
    rigType: 'ue4-mannequin',
  },
]

const MODEL_BY_ID = new Map(BUILTIN_STAGE3D_ACTOR_MODELS.map((model) => [model.id, model]))

export function getStage3DActorModel(id: string | undefined): Stage3DActorModelDef {
  return MODEL_BY_ID.get(normalizeStage3DActorModelId(id)) ?? BUILTIN_STAGE3D_ACTOR_MODELS[0]!
}

export function normalizeStage3DActorModelId(id: string | undefined | null): Stage3DActorModelId {
  if (id && MODEL_BY_ID.has(id as Stage3DActorModelId)) return id as Stage3DActorModelId
  return DEFAULT_STAGE3D_ACTOR_MODEL_ID
}
