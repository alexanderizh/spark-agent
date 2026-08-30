export interface SubmitGate {
  tryEnter: () => boolean
  leave: () => void
}

export function createSubmitGate(): SubmitGate {
  let entered = false
  return {
    tryEnter: () => {
      if (entered) return false
      entered = true
      return true
    },
    leave: () => {
      entered = false
    },
  }
}
