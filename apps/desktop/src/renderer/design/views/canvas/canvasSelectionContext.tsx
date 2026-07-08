import { createContext, useContext } from 'react'

export const CanvasSelectionContext = createContext(0)

export function useCanvasSelectedCount(): number {
  return useContext(CanvasSelectionContext)
}
