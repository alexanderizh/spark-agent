import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: { sourcemap: true },
  server: {
    proxy: {
      '/api/v1': {
        target: 'https://spark.yiqibyte.com',
        changeOrigin: true,
      },
    },
  },
})
