# Anka 应用导航与系统返回

更新：2026-10-16。对应宿主 `web/src/services/navigation.ts` 与
`web/src/router/appHistory.ts`。本契约适用于系统插件与 App 插件。

## 1. 用户行为

| 操作 | 结果 |
|------|------|
| Dock 从 A 切到 B | B 成为当前应用；系统返回不切回 A |
| B 内打开详情后返回 | 回到 B 的上一页 |
| 弹层打开时返回 | 优先关闭弹层，再返回内部页面 |
| B 根页面继续返回 | 保持 B；不退出到其他插件 |
| Dock 切回 A | 恢复 A 最近的导航位置 |
| 未接入返回接口的插件 | 保持当前应用；宿主无法推断其自绘内部页面 |

导航位置保存在当前页面的内存中。刷新后从当前 URL 恢复；不承诺恢复其他应用的
完整栈、组件草稿或运行状态。业务草稿应由插件另行持久化。

## 2. 宿主与浏览器历史

- `createAppHistory()` 包装 Vue Router 的 `createWebHistory()`。
- 首次导航成功后创建两条同文档记录：底部边界与当前应用；刷新复用已有边界。
- 后续 `push/replace` 更新当前物理记录，由导航服务分别维护每个应用的逻辑路由栈。
- 原生返回到边界时，在 RouterHistory 监听层先恢复当前 URL，再调用统一 `back()`。
  Vue Router 不会先挂载上一个插件，历史记录也不会随着反复返回无限增长。
- 更新历史一律经路由器的 history 实现，保留 `position/current/back/forward` 等字段。
- 桌面浏览器后退同样采用应用内返回语义；浏览器前进不承担跨应用切换功能。
- 这管理的是浏览器同文档返回，不能阻止系统强制关闭、回桌面、进程回收，不能控制
  Android 原生返回动画。首次进入后的无用户交互状态、连续快速系统手势与不同浏览器
  对脚本历史的处理仍须真机验证。

不得在插件中直接监听顶层 `popstate`、调用顶层 `history.back/pushState` 或
`replaceState(null, ...)`。这些操作会绕过应用边界或损坏 Vue Router 状态。

## 3. `uiCtx.navigation` 接口

### 应用切换与路由页面

```ts
await uiCtx.navigation.switchApp('anka-jot') // 使用应用 ID，恢复其栈顶位置
await uiCtx.navigation.push('/my-app/detail/123') // 应用内部进入下一页
await uiCtx.navigation.replace('/my-app/list')   // 替换当前逻辑页面
await uiCtx.navigation.back()                    // 与系统返回相同入口
```

`switchApp` 自动解析注册路由的可选参数，如 `/settings/:section?`，不会把参数模板
写入地址栏。重复点击当前应用不重置其页面。跨应用深链直接指定目标位置时，该应用
从新位置开始；需要恢复位置时使用 `switchApp`。

使用 Vue Router 多路由的插件，宿主自动记录同一 `appId` 的路由栈。已有内部栈或
自绘页面的插件应注册返回处理器：

```ts
const unregisterBack = uiCtx.navigation.register({
  appId: 'my-app',
  canGoBack: () => stack.length > 1,
  back: () => { stack.pop() },
})
```

规则：`canGoBack` 必须无副作用；`back` 可以返回 Promise；每次返回只调用一个
处理器。只有当前应用的处理器会被调用。没有处理器能消费时，宿主尝试该应用的
逻辑路由栈；栈底保持原位。处理器异常会记录日志，返回边界仍保留。

### 弹层与 URL 镜像

插件弹层可注册同一 `appId` 的高优先级处理器：

```ts
const removeDialogBack = uiCtx.navigation.register({
  appId: 'my-app',
  priority: 100,
  canGoBack: () => dialogOpen.value,
  back: () => { dialogOpen.value = false },
})
```

壳层全局弹层使用 `registerOverlay({ canGoBack, back, priority? })`。
返回顺序：壳层弹层 → 当前插件处理器（priority 降序）→ 当前插件路由栈。
同优先级按注册先后处理，需要嵌套弹层时明确设定优先级。

插件内部栈可将当前视图镜像到 hash，供刷新恢复：

```ts
await uiCtx.navigation.setHash('my-app', '#/detail?id=123')
```

`setHash` 只在该插件为当前应用时写 URL；后台插件调用不改变其他应用的地址。
它不增加逻辑页面记录，真正的内部栈仍由插件维护。解析深链时只能解析本插件路径。

### 生命周期

注册接口均返回注销函数。组件卸载调用注销函数；插件 setup 返回 teardown 时也应
注销。宿主等待 `setup(uiCtx)` 的异步结果，并在 `unloadApp` 调用 teardown，最终经
`unregisterApp` 清理该应用的导航栈和全部处理器：

```ts
export function setup(uiCtx) {
  uiCtx.registerApp(/* 应用元数据 */)
  const stopBack = uiCtx.navigation.register(/* 返回处理器 */)
  return { teardown() { stopBack() } }
}
```

`navigation.removeApp(id)` 是宿主卸载清理接口，插件正常使用 `unregisterApp(id)`。

## 4. 已接入与边界

- Dock 图标与全部应用网格、后台任务跳转、创造模式跳转：统一切应用。
- 控制台：手机二级页面返回一级菜单，包含刷新后直接打开的二级深链。
- Jot：保留内部栈；系统返回调用 `pop()`；hash 经宿主同步；刷新非根视图时补首页
  作为可返回父级；切其他插件不读取其 hash；插件卸载注销处理器。
- Jot 图片/视频预览与动作面板优先关闭；录音中返回先调用正常停止/保存流程。
- Dock 展开面板、后台任务气泡、创造模式弹层：统一优先关闭。
- iframe 页面：壳层无法读取跨域或任意第三方应用的内部栈；子框架自身导航也可能
  先消耗浏览器联合历史。本次未实现 iframe 消息桥。要接入内部返回，后续需定义
  `postMessage` 协议并严格校验 origin/source；不能宣称任意 iframe 已完整支持。

旧宿主没有 `uiCtx.navigation` 时，Jot 只保留页面按钮返回和 hash 镜像兼容，不承诺
旧宿主的系统返回行为。部署应同时更新宿主与插件并刷新已安装 PWA。

## 5. 验证

```sh
cd web
npm run build
node scripts/build-plugin.mjs anka-jot
node scripts/check-navigation.mjs
ANKA_NAV_PRODUCTION=1 node scripts/check-navigation.mjs
```

浏览器检查使用可选的 Playwright 与已安装 Chrome，未引入运行时依赖。
Playwright 不在项目模块路径时，将 `ANKA_PLAYWRIGHT_MODULE` 设为其 `index.mjs`
绝对路径；其他 Chromium 浏览器可设 `ANKA_BROWSER_CHANNEL`。
设 `ANKA_NAV_SCREENSHOTS` 可保存 390×844、1440×900 截图。
脚本使用独立浏览器上下文、模拟 API 和临时测试服务，不读写用户后端数据。
`ANKA_NAV_PRODUCTION=1` 使用已构建的宿主和插件产物，并检查 SW 激活及 manifest；
默认模式检查开发源码。两种模式覆盖应用切换、独立路由栈、Jot、深链刷新、根页
连续返回、弹层优先、实际插件卸载与重新安装。

发布前仍须 Android 已安装 PWA 真机验证：A→B 返回、B 内多级返回、根页连续返回、
弹层、刷新深链、切后台恢复；iOS PWA 验证边缘返回。自动化历史返回不能替代系统手势。
