/// <reference types="vite/client" />

import type { SparkApi } from '../preload/index'

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: any
    }
  }

  interface Window {
    spark: SparkApi
  }
}
