/// <reference types="vite/client" />

import type { SparkApi } from '../preload/index'

declare global {
  interface Window {
    spark: SparkApi
  }
}
