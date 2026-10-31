# Anka 应用运行时与浏览器 SDK

更新：2026-10-31。此文件是应用实例、保活、前后台、通信及 iframe SDK v1 的契约。
安装生命周期仍以 [PLUGIN-SPEC](PLUGIN-SPEC.md) 为准，系统返回以 [NAVIGATION](NAVIGATION.md) 为准。

## 1. 使用行为

| 操作 | 行为 |
|---|---|
| 第一次打开 | 按需执行前端 setup，创建一个应用界面实例 |
| A → B → A | 同一个组件实例与 DOM，保留草稿、光标、滚动和 iframe 文档 |
| 再点当前 Dock 图标 | 不重复创建实例 |
| 切到后台 | 隐藏窗口、保持实例，发送生命周期状态 |
| 关闭 | 检查关闭保护，销毁界面及子应用，释放 iframe；不卸载插件或删除数据 |
| 重新启动 | 关闭后重新创建界面；原生 ESM 模块与 setup 注册的能力仍驻留 |
| 卸载/禁用 | 宿主清理界面、插件 teardown、导航、事件、命令和样式 |
| 桌面分屏 | 两个根应用同时显示，点击窗口改变焦点；手机自动只显示当前应用 |
| 嵌套 | 一个应用可嵌入另一个，父级隐藏/关闭时同步处理子应用 |

当前每个 appId 只允许一个实例；同一应用不能同时出现在主窗口和嵌套容器，循环嵌套被拒绝。点击内嵌应用的 Dock 图标会唤回其父窗口并聚焦子应用。
常驻界面上限为 **10 个**，系统应用、加载中实例、分屏、嵌套与预执行均占名额。
满额时按最近使用顺序回收后台根窗口及其子应用，保留当前/分屏窗口、声明 background=continue 的应用，
并检查整组关闭保护。保护回调超时也视为不可自动回收；检查期间重新使用的应用会跳过。
全部无法回收时拒绝创建第 11 个实例，保持当前页面并提示先保存或关闭后台应用。
预执行满额直接跳过，不挤掉用户打开的应用；资源预取不创建界面实例。
回收会释放组件/iframe，重新打开将重建界面并恢复导航位置；业务草稿需主动保存或注册关闭保护。
这限制的是界面实例，不能保证 CPU/内存字节上限，也不驱逐 ESM 模块或停止 Python 后端任务。
Dock 当前应用显示长线，后台应用显示小点，未运行应用无标记；右键/长按图标进入关闭、重启、分屏菜单。
`runtime.keepAlive: false` 是明确放弃切换保活的选择；关闭保护仍会阻止自动释放。

## 2. 加载与预热

安装清单只注册图标与路由，不在启动时串行执行所有插件。
首次导航时加载目标插件，异步 setup 最多等待 20 秒；失败提供单应用重试。
原生插件在 setup 中必须注册自己的 appId；安装清单路由必须能定位到这个应用。

manifest 可选字段：

```json
{
  "runtime": {
    "keepAlive": true,
    "preload": "resources",
    "background": "pause"
  }
}
```

| 字段 | 默认 | 含义 |
|---|---|---|
| apiVersion | 1 | 当前支持 SDK v1；声明不支持的版本时安装校验失败 |
| keepAlive | true | 切走后保留界面实例 |
| preload | resources | none 不预热；resources 只下载；execute 还执行 setup 并后台挂载 |
| background | pause | pause 建议暂停后台工作；continue 声明后台继续工作 |

预热在浏览器空闲时逐个执行，省流模式/2G 跳过。原生入口使用 modulepreload；
page 入口解析并抓取最多 16 个同源脚本/样式。预取不等于完整离线安装。
execute 可能触发初始化网络请求，作者必须保证不会在预执行阶段自动提交、播放或请求设备权限。
默认旧插件、无 manifest 的静态页面均保活，保持兼容。

服务端发现新产物时，运行中的应用继续使用当前版本；通过 Dock 图标菜单重新启动应用时应用待更新版本。
不在用户编辑过程中强制替换界面。

## 3. 原生插件 SDK

插件仍导出 `setup(uiCtx)`，新增的接口均位于本插件的上下文中，`sdkVersion` 当前为 1。
可运行示例见 `examples/plugins/runtime-notes/` 与 `examples/plugins/runtime-page/`。

```js
export function setup(ctx) {
  const stop = ctx.commands.register('save', async ({ text }) => {
    ctx.storage.set('draft', { text })
    return { saved: true }
  })
  ctx.registerApp({ id: ctx.appId, title: '示例', icon: 'package',
    route: '/' + ctx.appId, order: 50, component: MyApp })
  return { teardown() { stop() } }
}
```

| API | 契约 |
|---|---|
| appId | 宿主绑定的应用身份 |
| route.value | 本应用的宿主路径；后台应用不会变成另一个应用的路由 |
| lifecycle.state.value | appId / running / visible / focused / foreground / background |
| lifecycle.on(event, fn) | state / activate / deactivate / close；返回注销函数；state 订阅立即收到当前状态 |
| lifecycle.beforeClose(fn) | 返回 true 允许关闭；false 或字符串阻止并提示；可返回 Promise |
| events.on(name, fn) | 接收 `{source, data}`，返回注销函数 |
| events.emit(name, data) | 发布可复制的数据；source 由宿主绑定 |
| commands.register(name, fn) | 注册 appId:name，重名拒绝，返回注销函数 |
| commands.execute('appId:name', args) | 初始化原生提供方后调用；网页提供方需先打开/预执行并完成注册 |
| commands.list() | 当前已注册的命令名 |
| storage.get/set/remove(key) | 按登录用户和 appId 分区的 JSON localStorage；单值不超过 256KB |
| theme.value | 当前系统主题 |
| apps.open(id, path?) | 唤回应用，或打开该应用的明确深链 |
| apps.close(id) / restart(id) | 关闭/重启，遵循关闭保护 |
| apps.list() | 正在运行的应用状态 |

在 Vue 组件 setup 同步调用的事件、生命周期、命令、关闭保护会随组件作用域自动注销。
模块级注册仍须在插件 teardown 中释放，宿主卸载时另有兜底清理。
数据只传输，不授予其他插件的私有存储访问权。原生同源代码仍属于受信任代码，
此接口不是恶意代码安全沙箱，manifest.permissions 尚不是 Python/浏览器的权限隔离。

## 4. 前后台与持久化

```js
const stop = ctx.lifecycle.on('state', state => {
  if (state.foreground) resumeAnimations()
  else { pauseAnimations(); saveDraft() }
})
```

foreground 表示窗口可见且 Anka 文档位于前台；focused 表示当前获得交互焦点的应用。
分屏时可以有两个 foreground 应用，只有一个 focused 应用；嵌套应用也接收父级可见性变化。
后台状态是协作式通知，不会强制停止任意 JS 计时器、WebGL 循环、录音或网络任务。
需要持续运行的后端任务不依赖页面保活，沿用现有 run/SSE 重连机制。

刷新、关闭 PWA、浏览器回收后不能保留整个 JS 堆。草稿应在修改时持续存储，
前后台变化再补保存；不要只依赖 unload。SDK 存储是本机存储，不自动上传或跨设备同步。

## 5. 导航与界面组合

原生插件继续使用 ctx.navigation；push/replace 仅允许本应用路径。
背景/嵌套应用更新自己的逻辑路由，不改写正在使用的其他应用地址。
跨应用请用 switchApp 或 apps.open。后台组件的 useRoute/useRouter.currentRoute 绑定本应用。

`ctx.components.AppEmbed` 可以嵌入其他应用：

```js
ctx.vue.h(ctx.components.AppEmbed, { appId: 'another-app' })
```

带 Teleport 的应用请使用 `ctx.components.AppPortal` 包裹弹层：

```js
ctx.vue.h(ctx.components.AppPortal, {}, () => ctx.vue.h(MyDialog))
```

AppPortal 随应用隐藏，普通 Teleport 到 body 的节点不会被父窗口显隐自动覆盖。
已有插件需要按此约定接入弹层，或在生命周期中控制自己的 body 弹层。
切换、分屏与手机/桌面断点只修改容器样式，不重排活跃 iframe 的 DOM 父节点。

## 6. iframe SDK

静态页面无需改造即可保活。需要宿主导航、通信、存储、生命周期时引入：

```html
<script src="/anka-sdk.js"></script>
<script>
anka.ready.then(async () => {
  console.log(anka.appId, anka.lifecycle.state)
  anka.navigation.on(route => renderPage(route.path))
  renderPage(anka.navigation.current.path)
  anka.lifecycle.on('state', state => state.foreground ? resume() : pause())
  await anka.events.on('notes:changed', event => refreshNotes(event.data))
})
</script>
```

| API | 行为 |
|---|---|
| ready | 握手完成后得到 SDK；无法连接时超时拒绝 |
| navigation.current | `{path, canGoBack}`，本应用的虚拟地址 |
| navigation.push/replace(path) | 逻辑页面跳转；路径以单个 / 开头，不超过 4096 字符 |
| navigation.back() | 回退本应用虚拟栈 |
| navigation.on(fn) | 路由更新订阅，返回注销函数 |
| navigation.switchApp(id) | 显式唤回另一个应用 |
| lifecycle.on / beforeClose | 对应原生生命周期；beforeClose 异步注册，须等待完成 |
| events.on / emit | 对应原生事件；on 异步返回注销函数 |
| storage.get/set/remove | 同样按用户与 appId 分区，均异步 |
| commands.register/execute | 双向命令调用，均异步 |
| theme.current / on(fn) | 初始主题和变化订阅，也更新根元素 data-theme |

SDK 路由不会直接改写 iframe 的 location/history，页面根据 route.path 自行渲染，
已有 Vue/React Router 可在适配层中对接。宿主 URL 用 `__app` 查询参数镜像当前根应用虚拟路径，
刷新或分享后恢复到该路径；嵌套应用不会覆盖父应用的链接。内部逻辑栈不等于浏览器全局历史。
没有接入 SDK 的第三方页面，其任意内部路由和浏览器联合历史仍不能自动接管。

握手校验同源 origin、准确的 iframe contentWindow 和版本，用随机 nonce 响应，
随后绑定专属 MessageChannel；不接受调用方伪造 appId。每次文档加载和销毁都撤销旧通道。
请求有体积上限、方法白名单及超时；消息来源固定，不广播凭据。

## 7. 验证

```sh
cd web
npm run build
npm run typecheck
node scripts/check-runtime-capacity.mjs
node scripts/check-app-runtime.mjs
ANKA_RUNTIME_PRODUCTION=1 node scripts/check-app-runtime.mjs
node scripts/check-navigation.mjs
ANKA_NAV_PRODUCTION=1 node scripts/check-navigation.mjs
```

浏览器回归使用可选 Playwright 与已安装 Chrome。非本项目安装的 Playwright 通过
ANKA_PLAYWRIGHT_MODULE 指定 index.mjs；截图可设 ANKA_RUNTIME_SCREENSHOTS，输出到 .screenshots。
测试使用隔离浏览器、模拟目录与 API，不操作用户后端数据。系统手势、后台回收、摄像头/录音、
WebGL 游戏和蓝牙连接仍需要 Android/iOS 已安装 PWA 真机验证。

自动化验收记录（2026-10-31）：后端 53 项通过；开发/生产运行时与真实 Jot 导航通过；
生产 SW 与 manifest 通过；桌面 1440×900 / 手机 390×844 已检查。真机验证仍按上文单独执行。

Dock/容量修订验收：5 组并发准入/保护检查通过，开发/生产覆盖 10 个实例回收、全部保护时拒绝新增、图标状态、右键菜单与长按逻辑。
