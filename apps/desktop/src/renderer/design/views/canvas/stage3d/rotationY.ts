import * as THREE from 'three'

/**
 * 从 quaternion 提取水平朝向。
 * 不直接读 Euler.y，避免 three 在等价欧拉角重排时把 135° 表示成 45°。
 */
export function rotationYFromQuaternion(quaternion: THREE.Quaternion): number {
  return Math.atan2(
    2 * (quaternion.w * quaternion.y + quaternion.x * quaternion.z),
    1 - 2 * (quaternion.y * quaternion.y + quaternion.z * quaternion.z),
  )
}
