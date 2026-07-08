import type { Stage3DProp, Stage3DPropKind } from './stage3d.types'
import { makeStage3DId } from './stage3d.types'

export type Stage3DLocalModelFormat = 'fbx' | 'obj' | 'glb'

export type Stage3DLocalModelAsset = {
  fileName: string
  format: Stage3DLocalModelFormat
  name: string
  url: string
}

export type Stage3DLocalModelRuntimeUrl = {
  url: string
  revoke?: (() => void) | undefined
}

export function inferStage3DLocalModelFormat(fileName: string): Stage3DLocalModelFormat | null {
  if (/\.fbx$/i.test(fileName)) return 'fbx'
  if (/\.obj$/i.test(fileName)) return 'obj'
  if (/\.glb$/i.test(fileName)) return 'glb'
  return null
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }
      reject(new Error('模型文件读取失败'))
    })
    reader.addEventListener('error', () => reject(reader.error ?? new Error('模型文件读取失败')))
    reader.readAsDataURL(file)
  })
}

export async function readStage3DLocalModelFile(file: File): Promise<Stage3DLocalModelAsset> {
  const format = inferStage3DLocalModelFormat(file.name)
  if (!format) throw new Error('当前仅支持 FBX / OBJ / GLB 模型文件')
  return {
    fileName: file.name,
    format,
    name: file.name.replace(/\.(fbx|obj|glb)$/i, ''),
    url: await readFileAsDataUrl(file),
  }
}

export async function createStage3DLocalModelRuntimeUrl(url: string): Promise<Stage3DLocalModelRuntimeUrl> {
  if (!url.startsWith('data:')) return { url }
  if (typeof URL.createObjectURL !== 'function') return { url }

  const response = await fetch(url)
  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  return {
    url: objectUrl,
    revoke: () => URL.revokeObjectURL(objectUrl),
  }
}

export function makeLocalModelProp(asset: Stage3DLocalModelAsset, index: number): Stage3DProp {
  return {
    id: makeStage3DId('prop'),
    kind: 'local-model' as Stage3DPropKind,
    assetId: makeStage3DId('local-model'),
    name: asset.name || `本地模型${index + 1}`,
    position: [0, 0, 0],
    rotationY: 0,
    scale: 1,
    fileName: asset.fileName,
    format: asset.format,
    url: asset.url,
  }
}
