/**
 * 构建共享 Vue 模块 → public/shared/vue.js（vite lib 模式）。
 * 主构建（vite build）会把 public/ 原样拷入 dist/shared/vue.js。
 * 必须在主构建之前运行（npm run build 已串联）。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

await build({
  configFile: false,
  define: {
    // vue esm-bundler 构建需要显式定义环境与特性开关
    'process.env.NODE_ENV': '"production"',
    __VUE_OPTIONS_API__: 'true',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
  },
  build: {
    lib: { entry: path.join(webDir, 'shared', 'vue.ts'), formats: ['es'], fileName: () => 'vue.js' },
    outDir: path.join(webDir, 'public', 'shared'),
    emptyOutDir: true,
  },
  logLevel: 'warn',
})
console.log('[build-shared] shared/vue.ts -> public/shared/vue.js')
