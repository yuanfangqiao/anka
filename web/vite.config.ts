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
    '.html': 'text/html',       // M11：page 类静态页应用入口
    '.htm': 'text/html',
    '.webmanifest': 'application/manifest+json',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',      // excalidraw 等 dist 产物自带字体
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
    '.map': 'application/json',
  }
  return {
    name: 'serve-app-plugins',
    configureServer(server) {
      server.middlewares.use('/plugins', async (req, res, next) => {
        const url = req.url ?? ''
        const raw = decodeURIComponent(url.split('?')[0])
        const file = path.join(APP_PLUGINS_DIR, raw)
        if (!file.startsWith(APP_PLUGINS_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
          next()
          return
        }
        const ext = path.extname(file)
        // page 类插件 HTML：改写绝对路径（构建时 base="/" 的产物，如 excalidraw
        // dist/index.html 引用 /assets/x.js → 挂上 /plugins/<id>/ 后会去站点根
        // 找 → 404。改写为 /plugins/<id>/<dir>/x.js；与 FastAPI 侧 serve_plugin_html 一致）
        if (ext === '.html' || ext === '.htm') {
          // raw 形如 /excalidraw/dist/index.html（中间件已剥掉 /plugins 前缀）
          const dir = raw.includes('/')
            ? raw.slice(0, raw.lastIndexOf('/') + 1)
            : '/'
          const urlPrefix = `/plugins${dir}`
          let html = fs.readFileSync(file, 'utf-8')
          if (!html.includes('<base')) {
            html = html.replace(/(<head[^>]*>)/, `$1<base href="${urlPrefix}">`)
          }
          html = html.replace(
            /(src|href)=(["'])(\/[^"']*)\2/g,
            (m, attr, q, p) =>
              p.startsWith('//') || p.startsWith('/plugins/') || p.startsWith('/api/')
                ? m
                : `${attr}=${q}${urlPrefix}${p.slice(1)}${q}`,
          )
          res.setHeader('Content-Type', 'text/html')
          res.end(html)
          return
        }
        if (ext === '.vue' || ext === '.ts') {
          try {
            // 用绝对文件路径走 vite 编译管线；保留 query（SFC 子块 ?vue&type=…）
            // 产物的相对 import 会被改写为 /@fs/ 绝对 URL，交由 vite 自身管线处理
            const query = url.includes('?') ? url.slice(url.indexOf('?')) : ''
            const result = await server.transformRequest(file + query)
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
        name: 'Anka',
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
        // 关键：NavigationRoute 在生成的 sw.js 里注册在最前，会截胡所有
        // navigation 请求（含 iframe 加载插件页）→ iframe 拿到壳的 index.html
        // → 壳在 iframe 里递归启动（多层内嵌）。denylist 放行插件/接口路径。
        navigateFallbackDenylist: [/^\/api\//, /^\/plugins\//, /^\/plugin-dist\//],
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
          },
          {
            // 插件构建产物（安装时编译，M9）：可装卸，不预缓存，网络优先
            urlPattern: /\/plugin-dist\//i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'plugin-dist-cache',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 30, maxAgeSeconds: 300 }
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
  build: {
    rollupOptions: {
      // vue 外置：宿主与插件共享同一实例（经 index.html 的 import map → /shared/vue.js）
      external: ['vue'],
    },
  },
  optimizeDeps: {
    // 截屏库为动态 import：显式纳入预构建，避免 dev 态首次触发时
    // 命中 504 Outdated Optimize Dep（截屏静默失败的环境差异根因）
    include: ['html-to-image'],
  },
  resolve: {
    alias: {
      // 应用插件（plugins/ 目录）import 'vue' 时解析到内核同一份依赖，保证同一 Vue 实例
      vue: path.resolve(__dirname, 'node_modules/vue'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    // 插件目录在项目根（web/ 之外），编译产物以 /@fs/ 绝对 URL 引用，需放行项目根
    fs: {
      allow: [path.resolve(__dirname, '..')],
    },
    proxy: {
      // M16：多端同步走 /api/sync/ws/{room_id}，Vite 默认不代理 WebSocket
      // upgrade（101 握手），必须显式开 ws: true，否则客户端永远连不上。
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        ws: true
      }
    }
  }
})
