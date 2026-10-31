/**
 * 应用插件前端「安装时编译」驱动（M9）。
 * 用法：node scripts/build-plugin.mjs <pluginId>
 *
 * 产出两份文件到 <项目根>/.plugin-dist/<id>/：
 * - index.js    vite 程序化构建（内部 esbuild）：插件 web/ 内的 .vue / .ts / .js → 单文件 ESM。
 *               'vue' 保持 external —— 浏览器经宿主 import map 解析到共享实例。
 * - index.css   插件自带样式：源码里 import 的 CSS（vite 抽出的 style.css，合并进来）
 *               + 按插件源码单独跑一遍 Tailwind 得到的工具类。
 *
 * 为什么插件要自带 CSS：宿主 CSS 是「宿主构建时」生成的，运行时安装的插件永远
 * 不在那次扫描里；靠宿主工具类控制尺寸/可见性，一旦漏扫就是 0×0 的空元素（静默失效）。
 * 自带产物后插件与宿主构建解耦，宿主只需在加载插件时注入这个 <link>（pluginHost.ts）。
 *
 * Tailwind 主题取自 web/tailwind.preset.js —— 与宿主同一份，类名语义完全一致；
 * 只输出 @tailwind utilities（不含 preflight），不污染宿主的全局重置。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import preset from '../tailwind.preset.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const pluginId = process.argv[2]
if (!pluginId) {
  console.error('[build-plugin] usage: node scripts/build-plugin.mjs <pluginId>')
  process.exit(1)
}

const env = { ...loadEnv('development', root, 'ANKA_'), ...process.env }
const pluginDir = path.join(path.resolve(root, env.ANKA_PLUGINS_DIR || 'plugins'), pluginId)
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
const finalDir = path.join(root, '.plugin-dist', pluginId)
const outDir = path.join(root, '.plugin-dist', `.${pluginId}.stage-${process.pid}`)
process.once('exit', () => fs.rmSync(outDir, { recursive: true, force: true }))

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

/** 按插件自身源码单独生成工具类（content 只含该插件，不扫宿主/其他插件） */
async function buildPluginCss() {
  const content = [`${webDir}/**/*.{vue,ts,js,html}`].map((p) => p.split(path.sep).join('/'))
  const result = await postcss([
    tailwindcss({ ...preset, content }),
    autoprefixer(),
  ]).process('@tailwind utilities;', { from: undefined })
  return result.css
}

// vite lib 模式把源码里 import 的 CSS 抽成独立 style.css（JS 不引用它），
// 合并进 index.css 后删掉——否则宿主漏加载，和漏扫工具类是同一类故障。
const viteCssPath = path.join(outDir, 'style.css')
let sourceCss = ''
if (fs.existsSync(viteCssPath)) {
  sourceCss = fs.readFileSync(viteCssPath, 'utf-8').trim()
  fs.unlinkSync(viteCssPath)
}

let utilities
try {
  utilities = await buildPluginCss()
} catch (e) {
  console.error(`[build-plugin] ${pluginId}: 样式构建失败：${e?.message || e}`)
  process.exit(1)
}

const banner = `/* ${pluginId} — 插件自带样式（build-plugin.mjs 生成，勿手改） */\n`
const cssOut = path.join(outDir, 'index.css')
fs.writeFileSync(cssOut, `${banner}${sourceCss ? sourceCss + '\n' : ''}${utilities}`)

const kb = (n) => `${(n / 1024).toFixed(1)}KB`
const cssSize = kb(fs.statSync(cssOut).size)
const previous = `${finalDir}.previous`
fs.rmSync(previous, { recursive: true, force: true })
if (fs.existsSync(finalDir)) fs.renameSync(finalDir, previous)
try { fs.renameSync(outDir, finalDir) } catch (error) {
  if (fs.existsSync(previous)) fs.renameSync(previous, finalDir)
  throw error
}
fs.rmSync(previous, { recursive: true, force: true })
console.log(`[build-plugin] ${pluginId}: ${entryRel} -> ${path.join(finalDir, 'index.js')}`)
console.log(`[build-plugin] ${pluginId}: 样式 -> index.css（${cssSize}）`)
