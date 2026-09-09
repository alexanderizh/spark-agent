export const OPEN_OPTIONAL_CAPABILITY_CENTER_EVENT = 'spark:open-optional-capability-center'

export function openOptionalCapabilityCenter(): void {
  window.dispatchEvent(new CustomEvent(OPEN_OPTIONAL_CAPABILITY_CENTER_EVENT))
}
