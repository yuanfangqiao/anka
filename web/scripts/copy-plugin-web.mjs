/**
 * postbuild：把项目根 plugins/<id>/web/ 拷入 web/dist/plugins/<id>/web/，
 * 生产态由 FastAPI SPA 回退的 is_file 分支直接伺服（与开发态 URL 一致）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const srcDir = path.join(root, 'plugins')
const outDir = path.join(root, 'web', 'dist', 'plugins')

if (!fs.existsSync(srcDir)) {
  console.log('[copy-plugin-web] no plugins/ dir, skip')
  process.exit(0)
}

let copied = 0
for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const webSrc = path.join(srcDir, entry.name, 'web')
  if (!fs.existsSync(webSrc)) continue
  const dest = path.join(outDir, entry.name, 'web')
  fs.cpSync(webSrc, dest, { recursive: true })
  copied++
}
console.log(`[copy-plugin-web] copied ${copied} plugin web bundle(s) -> dist/plugins/`)
