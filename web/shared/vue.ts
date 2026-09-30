/**
 * 宿主与插件共享的 Vue 单实例模块。
 * 构建为 public/shared/vue.js（见 scripts/build-shared.mjs），
 * 经 index.html 的 import map 暴露为 "vue"：
 * 宿主构建 externalize vue + 插件构建 externalize vue，
 * 两侧裸 import 都解析到这份模块，保证只有一个 Vue 实例。
 */
export * from 'vue'
