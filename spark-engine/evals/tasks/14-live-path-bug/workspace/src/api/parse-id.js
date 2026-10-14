// The accepted fix is to change ID_PATTERN. The re-export is only a shim.
export const ID_PATTERN = /^[A-Z]+$/u

export { normalizeId } from '../core/ids.js'
