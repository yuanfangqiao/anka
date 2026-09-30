/** 编辑器/TS 识别 *.vue 模块的 shim（仅类型，运行时不参与） */
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<any, any, any>
  export default component
}
