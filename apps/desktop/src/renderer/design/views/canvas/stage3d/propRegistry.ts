import type { Stage3DProp, Stage3DPropKind } from './stage3d.types'
import { makeStage3DId } from './stage3d.types'

/**
 * 道具资产注册表。
 *
 * - primitive：程序化几何道具（box/cylinder/sphere/plane），可调颜色 / 尺寸。
 * - glb：Kenney furniture-kit 精选子集（37 件，共约 660KB，全部自包含无外部纹理），
 *   Scene 层用 drei useGLTF 按 url 加载（带缓存），每实例 clone。
 */

export type Stage3DPrimitiveShape =
  | 'box'
  | 'cylinder'
  | 'sphere'
  | 'plane'
  | 'cone'
  | 'torus'
  | 'pyramid'

export type PrimitiveDef = {
  id: Stage3DPrimitiveShape
  label: string
}

export const PRIMITIVE_DEFS: PrimitiveDef[] = [
  { id: 'box', label: '方块' },
  { id: 'cylinder', label: '圆柱' },
  { id: 'sphere', label: '球体' },
  { id: 'plane', label: '平面' },
  { id: 'cone', label: '圆锥' },
  { id: 'torus', label: '环形体' },
  { id: 'pyramid', label: '棱锥' },
]

export function isPrimitiveShape(value: string): value is Stage3DPrimitiveShape {
  return (
    value === 'box' ||
    value === 'cylinder' ||
    value === 'sphere' ||
    value === 'plane' ||
    value === 'cone' ||
    value === 'torus' ||
    value === 'pyramid'
  )
}

// ─────────────────────────── GLB 资产注册表 ───────────────────────────

/**
 * GLB 通过 Vite 资产管线（import.meta.glob + ?url）打包：
 * 开发模式由 dev server 提供，打包模式进入 out/renderer/assets/（hash 文件名），
 * electron-builder 按产物原样收集，不依赖运行时读源码路径。
 */
const GLB_URL_BY_FILE = import.meta.glob('../../../../assets/stage3d-furniture/*.glb', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

function glbUrl(fileBase: string): string {
  for (const [path, url] of Object.entries(GLB_URL_BY_FILE)) {
    if (path.endsWith(`/${fileBase}.glb`)) return url
  }
  return ''
}

export type GlbCategory = 'bed' | 'table' | 'chair' | 'cabinet' | 'sofa' | 'bath' | 'misc'

export type GlbAssetDef = {
  id: string
  label: string
  category: GlbCategory
  /** 打入资产目录后的可加载 URL（safe-file:// 或 asset:// 等） */
  url: string
  /** 缩略图 URL（家具面板展示） */
  thumbnailUrl?: string
  /** 默认落地缩放 */
  defaultScale?: number
}

export const GLB_CATEGORY_LABEL: Record<GlbCategory, string> = {
  bed: '床',
  table: '桌',
  chair: '椅',
  cabinet: '柜',
  sofa: '沙发',
  bath: '浴室',
  misc: '杂项',
}

/** 家具面板类别展示顺序 */
export const GLB_CATEGORY_ORDER: GlbCategory[] = [
  'bed',
  'table',
  'chair',
  'cabinet',
  'sofa',
  'bath',
  'misc',
]

/**
 * Kenney furniture-kit 模型约为真实世界 0.5 倍比例（椅高 0.47、冰箱高 0.92、
 * 单人床长 1.13），人偶按 1.8m 建模 → defaultScale 统一取 2 对齐真实尺度。
 * 模型 yMin=0（贴地建模），落位 y=0 即可。
 */
const K = 2

function def(
  id: string,
  label: string,
  category: GlbCategory,
  defaultScale: number = K,
): GlbAssetDef {
  return { id, label, category, url: glbUrl(id), defaultScale }
}

export const GLB_ASSETS: GlbAssetDef[] = [
  // 床
  def('bedSingle', '单人床', 'bed'),
  def('bedDouble', '双人床', 'bed'),
  def('bedBunk', '上下铺', 'bed'),
  // 桌
  def('table', '餐桌', 'table'),
  def('tableRound', '圆桌', 'table'),
  def('tableCoffee', '咖啡桌', 'table'),
  def('desk', '书桌', 'table'),
  def('sideTable', '边几', 'table'),
  // 椅
  def('chair', '木椅', 'chair'),
  def('chairCushion', '软垫椅', 'chair'),
  def('chairDesk', '办公椅', 'chair'),
  def('chairModernCushion', '现代餐椅', 'chair'),
  def('stoolBar', '吧台凳', 'chair'),
  // 柜（书架）
  def('bookcaseOpen', '开放书架', 'cabinet'),
  def('bookcaseClosed', '带门书柜', 'cabinet'),
  def('cabinetTelevision', '电视柜', 'cabinet'),
  def('kitchenCabinet', '橱柜', 'cabinet'),
  def('kitchenFridge', '冰箱', 'cabinet'),
  def('kitchenStove', '燃气灶台', 'cabinet'),
  // 沙发（长椅）
  def('loungeSofa', '双人沙发', 'sofa'),
  def('loungeSofaCorner', '转角沙发', 'sofa'),
  def('loungeChair', '单人沙发', 'sofa'),
  def('benchCushion', '软垫长椅', 'sofa'),
  // 浴室
  def('bathtub', '浴缸', 'bath'),
  def('toilet', '马桶', 'bath'),
  def('bathroomSink', '洗手台', 'bath'),
  def('shower', '淋浴间', 'bath'),
  def('bathroomMirror', '浴室镜', 'bath'),
  // 杂项（常用陈设）
  def('lampRoundFloor', '落地灯', 'misc'),
  def('lampSquareTable', '台灯', 'misc'),
  def('rugRectangle', '长方地毯', 'misc'),
  def('rugRound', '圆形地毯', 'misc'),
  def('televisionModern', '电视机', 'misc'),
  def('pottedPlant', '盆栽', 'misc'),
  def('plantSmall2', '小绿植', 'misc'),
  def('books', '书堆', 'misc'),
  def('coatRackStanding', '立式衣帽架', 'misc'),
]

export function findGlbAsset(assetId: string): GlbAssetDef | undefined {
  return GLB_ASSETS.find((a) => a.id === assetId)
}

// ─────────────────────────── 创建道具 ───────────────────────────

export function makePrimitiveProp(shape: Stage3DPrimitiveShape, index: number): Stage3DProp {
  const label = PRIMITIVE_DEFS.find((d) => d.id === shape)?.label ?? shape
  return {
    id: makeStage3DId('prop'),
    kind: 'primitive' as Stage3DPropKind,
    assetId: shape,
    name: `${label}${index + 1}`,
    position: [0, shape === 'plane' ? 0.01 : shape === 'torus' ? 0.14 : 0.4, 0],
    rotationY: 0,
    scale: 1,
    color: '#cbd5e1',
  }
}

export function makeGlbProp(asset: GlbAssetDef, index: number): Stage3DProp {
  return {
    id: makeStage3DId('prop'),
    kind: 'glb',
    assetId: asset.id,
    name: `${asset.label}${index + 1}`,
    position: [0, 0, 0],
    rotationY: 0,
    scale: asset.defaultScale ?? 1,
  }
}
