import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const appView = env.VITE_APP_VIEW?.trim()
  const base = env.VITE_BASE_PATH?.trim() || '/'

  const isCamera = appView === 'camera'

  return {
    base,
    plugins: [
      react(),
      ...(isCamera ? [basicSsl()] : [])
    ],
    define: appView
      ? {
          'import.meta.env.VITE_APP_VIEW': JSON.stringify(appView),
        }
      : undefined,
    server: {
      host: '0.0.0.0',
      port: isCamera ? 5174 : 5173,
      
      proxy: {
        ...(isCamera ? {
          '/api/validate': {
            target: 'http://localhost:4100',
            changeOrigin: true,
            secure: false,
          }
        } : {}),
        '/api': 'http://localhost:4000',
        '/uploads': 'http://localhost:4000',
      },
    },
  }
})
