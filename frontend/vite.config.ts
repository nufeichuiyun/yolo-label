import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    watch: {
      usePolling: true
    },
    // 代理API请求到后端
    // 在Docker容器中，前端容器需要通过宿主机访问后端（因为端口已映射）
    // 使用host.docker.internal访问宿主机，或者使用backend服务名（Docker内部网络）
    proxy: {
      '/api': {
        // 优先使用backend服务名（Docker内部网络），如果不可用则使用host.docker.internal
        target: 'http://backend:8000',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path,
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, _res) => {
            console.error('[Vite Proxy] 代理错误:', err);
            // 如果backend服务名失败，尝试使用host.docker.internal
            if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
              console.log('[Vite Proxy] backend服务名不可用，尝试使用host.docker.internal');
            }
          });
        },
        onProxyReq: (proxyReq, req, res) => {
          console.log(`[Vite Proxy] 代理请求: ${req.method} ${req.url} -> backend:8000`);
        },
        onError: (err, req, res) => {
          console.error('[Vite Proxy] 代理错误详情:', err);
        }
      },
      '/uploads': {
        // 代理静态文件请求到后端
        target: 'http://backend:8000',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path,
        onProxyReq: (proxyReq, req, res) => {
          console.log(`[Vite Proxy] 代理静态文件请求: ${req.method} ${req.url} -> backend:8000`);
        },
        onError: (err, req, res) => {
          console.error('[Vite Proxy] 静态文件代理错误详情:', err);
        }
      }
    }
  }
})
