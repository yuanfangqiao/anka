import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'node:fs'
import path from 'node:path'

const APP_PLUGINS_DIR = path.resolve(__dirname, '../plugins')

/**
 * 开发态 /plugins/* 伺服（与应用插件 URL 契约一致）：
 * - .vue/.ts 源码经 vite transform 即时编译（支持 git 插件目录携带 vue 源码）
 * - 其余（.js/.svg/.png…）按静态文件输出
 */
function serveAppPlugins(): Plugin {
  const mime: Record<string, string> = {
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.css': 'text/css',
  }
  return {
    name: 'serve-app-plugins',
    configureServer(server) {
      server.middlewares.use('/plugins', async (req, res, next) => {
        const raw = decodeURIComponent((req.url ?? '').split('?')[0])
        const file = path.join(APP_PLUGINS_DIR, raw)
        if (!file.startsWith(APP_PLUGINS_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
          next()
          return
        }
        const ext = path.extname(file)
        if (ext === '.vue' || ext === '.ts') {
          try {
            const result = await server.transformRequest(`/plugins${raw}`)
            if (result) {
              res.setHeader('Content-Type', 'text/javascript')
              res.end(result.code)
              return
            }
          } catch (e) {
            console.error('[serve-app-plugins] transform failed:', e)
          }
        }
        res.setHeader('Content-Type', mime[ext] ?? 'application/octet-stream')
        fs.createReadStream(file).pipe(res)
      })
    },
  }
}

export default defineConfig({
  plugins: [
    vue(),
    serveAppPlugins(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'AgentOS · PWA Agent 样例',
        short_name: 'AgentOS',
        description: '一切皆插件的 Agent 演示：可安装的 PWA 双布局壳',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone'],
        orientation: 'any',
        theme_color: '#0B0E14',
        background_color: '#0B0E14',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-icon.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: ['**/plugins/**'],
        runtimeCaching: [
          {
            urlPattern: /\/api\/.*/i,
            handler: 'NetworkFirst',
            method: 'GET',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 50, maxAgeSeconds: 300 }
            }
          },
          {
            // 应用插件 bundle：装卸后必须拿到最新，不预缓存
            urlPattern: /\/plugins\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'app-plugins-cache',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 30, maxAgeSeconds: 120 }
            }
          }
        ]
      },
      // dev SW 会导致已安装 PWA 缓存旧壳、切换应用「加载失败」——只在生产构建启用
      devOptions: {
        enabled: false
      }
    })
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true
      }
    }
  }
})
