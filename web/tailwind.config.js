/**
 * 宿主壳的 Tailwind 配置：只管「扫谁」，主题统一来自 tailwind.preset.js
 * （插件构建脚本也导入同一份 preset，见 scripts/build-plugin.mjs）。
 */
import preset from './tailwind.preset.js'

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{vue,ts}',
    // 应用插件的 Vue/TS 源码参与类名扫描——只扫 web/ 源码目录；
    // 排除 page 类 dist 产物（如 excalidraw，43MB/数百文件，无需 Tailwind 且会拖垮扫描）
    //
    // 注意：这里只为「dev 态 + 仓库内插件」兜底。生产态插件样式由
    // .plugin-dist/<id>/index.css 自带（build-plugin.mjs 生成、pluginHost 注入），
    // 不依赖宿主构建时是否扫过插件源码——运行时安装的插件同样生效。
    '../plugins/*/web/**/*.{vue,ts,js}',
  ],
  ...preset,
}
