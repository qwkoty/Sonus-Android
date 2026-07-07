import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/',  // Capacitor 使用本地 HTTP 服务器，base 必须是 '/'
})
