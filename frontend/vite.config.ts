import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// https://vite.dev/config/
export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Local development only. The credential stays on the server and is never VITE_*.
  const localKey =
    command === 'serve' && env.OPTISTOCK_LOCAL_KEY_FILE
      ? readFileSync(resolve(env.OPTISTOCK_LOCAL_KEY_FILE), 'utf8').trim()
      : ''
  const localOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173']
  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      proxy: {
        '/api': {
          target: localKey ? 'http://127.0.0.1:8000' : env.API_PROXY_TARGET || 'http://127.0.0.1:8000',
          changeOrigin: true,
          configure(proxy) {
            proxy.on('proxyReq', (proxyReq, req) => {
              if (!localKey || req.headers.authorization !== 'Bearer local') return
              const sameHost = ['127.0.0.1:5173', 'localhost:5173'].includes(req.headers.host || '')
              const sameOrigin = !req.headers.origin || localOrigins.includes(req.headers.origin)
              const sameSite =
                !req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'same-origin'
              if (sameHost && sameOrigin && sameSite)
                proxyReq.setHeader('Authorization', `Bearer ${localKey}`)
            })
          },
        },
      },
    },
    preview: { host: '127.0.0.1', port: 4173 },
    build: { chunkSizeWarningLimit: 700 },
  }
})
