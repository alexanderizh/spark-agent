export function normalizeInverseDepth(values: Float32Array): Uint8Array {
  if (values.length === 0) return new Uint8Array()
  const finite = Array.from(values)
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
  if (finite.length === 0) return new Uint8Array(values.length)
  const low = percentile(finite, 0.02)
  const high = percentile(finite, 0.98)
  if (high <= low) return new Uint8Array(values.length)
  const scale = 255 / (high - low)
  return Uint8Array.from(values, (value) => {
    if (!Number.isFinite(value)) return 0
    return Math.round(Math.min(255, Math.max(0, (value - low) * scale)))
  })
}

export function smoothDepthFrame(
  current: Uint8Array,
  previous: Uint8Array | null,
  historyWeight = 0.25,
  sceneCut = false,
): Uint8Array {
  if (sceneCut || previous == null || previous.length !== current.length) return current
  const weight = Math.min(1, Math.max(0, historyWeight))
  return Uint8Array.from(current, (value, index) =>
    Math.round(value * (1 - weight) + (previous[index] ?? value) * weight),
  )
}

export function detectRgbSceneCut(
  current: Uint8Array,
  previous: Uint8Array | null,
  threshold = 0.35,
): boolean {
  if (previous == null || previous.length !== current.length || current.length === 0) return false
  const stride = Math.max(3, Math.floor(current.length / 12_000 / 3) * 3)
  let totalDifference = 0
  let samples = 0
  for (let index = 0; index < current.length; index += stride) {
    totalDifference += Math.abs(current[index]! - previous[index]!)
    samples += 1
  }
  return samples > 0 && totalDifference / samples / 255 >= threshold
}

function percentile(sorted: number[], ratio: number): number {
  if (sorted.length === 1) return sorted[0]!
  const position = ratio * (sorted.length - 1)
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.ceil(position)
  const lower = sorted[lowerIndex]!
  const upper = sorted[upperIndex]!
  return lower + (upper - lower) * (position - lowerIndex)
}
