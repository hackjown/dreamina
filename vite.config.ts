import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // 后端当前监听在 0.0.0.0/IPv4，localhost 在部分环境会优先解析到 ::1，
        // 导致 Vite 代理偶发报错：Cannot read properties of undefined (reading 'headers')
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
});
