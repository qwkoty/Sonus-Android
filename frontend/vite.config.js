import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/',  // Capacitor 使用本地 HTTP 服务器，base 必须是 '/'
  server: {
    // 开发模式把 /api 转发到后端（默认 http://localhost:3000），
    // 修复「扫码登录生成二维码失败：Unexpected token < in JSON」——
    // 该错误系前端请求打到 Vite dev server 返回 index.html 所致。
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
