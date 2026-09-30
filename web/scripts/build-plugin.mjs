/**
 * 应用插件前端「安装时编译」驱动（M9）。
 * 用法：node scripts/build-plugin.mjs <pluginId>
 *
 * vite 程序化构建（内部 esbuild）：编译插件 web/ 内的 .vue / .ts / .js，
 * 产出到 <项目根>/.plugin-dist/<id>/index.js（单文件 ESM）。
 * 'vue' 保持 external —— 浏览器经宿主 import map 解析到共享实例。
 * 插件不 import 其他 npm 包，故无需其余 external。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const pluginId = process.argv[2]
if (!pluginId) {
  console.error('[build-plugin] usage: node scripts/build-plugin.mjs <pluginId>')
  process.exit(1)
}

const pluginDir = path.join(root, 'plugins', pluginId)
const manifestPath = path.join(pluginDir, 'plugin.json')
if (!fs.existsSync(manifestPath)) {
  console.error(`[build-plugin] ${pluginId}: plugin.json 不存在`)
  process.exit(1)
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
const entryRel = manifest.ui?.entry
if (!entryRel) {
  console.log(`[build-plugin] ${pluginId}: 无 ui.entry，跳过`)
  process.exit(0)
}

const webDir = path.join(pluginDir, 'web')
const outDir = path.join(root, '.plugin-dist', pluginId)

await build({
  configFile: false,
  root: webDir,
  plugins: [vue()],
  build: {
    lib: { entry: path.join(pluginDir, entryRel), formats: ['es'], fileName: () => 'index.js' },
    outDir,
    emptyOutDir: true,
    rollupOptions: { external: ['vue'] },
  },
  logLevel: 'warn',
})
console.log(`[build-plugin] ${pluginId}: ${entryRel} -> ${path.join(outDir, 'index.js')}`)
