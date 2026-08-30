export function resolveDepthVideoPreserveAudio(configuredValue: unknown): boolean {
  return configuredValue == null ? true : configuredValue === true
}
