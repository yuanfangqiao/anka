# 插件开发指南

`plugins/` 存放**可装卸的 app / page 插件**（每个子目录一个插件）。内核自身的
infra 插件不在这里，见 `server/app/plugins/`。

本文件是**上手与规范**；字段级契约以 [`docs/PLUGIN-SPEC.md`](../docs/PLUGIN-SPEC.md)
为准（manifest 字段、kind 判定、状态机、错误码）。两者冲突时以 spec 为准。

---

## 1. 先判断你要写哪一类

| kind | 形态 | 后端 | 前端 | 何时选它 |
|------|------|------|------|----------|
| `app` | `plugins/<id>/` + `plugin.json` | 可选 Python Service | `setup(uiCtx)` 用 Vue 渲染 | 需要读写宿主数据、要出现在 dock 的原生应用 |
| `page` | `plugins/<id>/`，可无 `plugin.json` | 无 | 自包含静态页（`dist/index.html`），iframe 加载 | 已有独立网页/小游戏，改造成本高于收益 |

现有插件都遵循同一套布局：`notes` / `anka-jot` / `tetris` 是 app 类的成熟参照，
`clock` / `snake` / `translate` / `anka-quickdraw` 是 page 类。

---

## 2. 三十分钟做出第一个 app 插件

`plugins/demo/` 是唯一官方样本，覆盖 manifest v2 + Python Service + Vue SFC 全链路。
**新建插件 = 复制整个目录改名**，不要从零手写。

```sh
# 1) 复制（目录名就是插件 id，务必 kebab-case）
cp -r plugins/demo plugins/my-plugin
rm plugins/my-plugin/README.md

# 2) 改 plugin.json：id / name / description / ui.route
#    必须保证 id == 目录名，否则扫描报 E_ID_MISMATCH

# 3) 改 web/index.ts 的 registerApp({ id, title, icon, route }) 与 server/main.py 的 name / provide

# 4) 校验（工作目录是 server/）
cd server && python -m app.cli verify my-plugin

# 5) 打开宿主的「插件」页安装，或调用 POST /api/plugins/my-plugin/install
```

开发态（`AGENT_DEV`）改完 `web/` 刷新页面即可；生产态**安装时**由内核把
`web/` 编译成 `.plugin-dist/<id>/index.js`，作者不需要写构建配置。

---

## 3. 目录布局与命名

```
plugins/my-plugin/
├── plugin.json          # 唯一的清单文件
├── server/main.py       # 可选：Service 子类
└── web/
    ├── index.ts         # 入口，导出 setup(uiCtx)
    ├── MyPlugin.vue     # 主界面（标准 SFC）
    └── types.ts         # uiCtx 的最小类型声明（插件自包含，不跨目录 import 宿主）
```

- 目录名 = `plugin.json.id`，`kebab-case`，只用小写字母、数字、连字符。
- `plugin.json` 是唯一清单；**不要**新增 `manifest.json` / `package.json` 来承载元数据。
- 插件必须自包含：只能 `import` 同目录文件与 `vue`（宿主用 import map 共享同一
  Vue 实例），不得 import 其他 npm 包，也不要 `import` 宿主 `web/src/**`。
- 不提交 `node_modules/`、`.plugin-dist/`、`__pycache__/`；app 类与源码型 page 类
  都不提交构建产物（`dist/`）。

---

## 4. manifest 最小模板

```json
{
  "manifest_version": 2,
  "id": "my-plugin",
  "name": "我的插件",
  "version": "0.1.0",
  "icon": "sparkles",
  "description": "一句话说清这个插件解决什么问题",
  "kind": "app",
  "system": false,
  "backend": { "entry": "server/main.py" },
  "ui": {
    "entry": "web/index.ts",
    "dock": { "order": 50 },
    "sidebar": false,
    "route": "/my-plugin"
  },
  "permissions": []
}
```

| 字段 | 说明 |
|------|------|
| `id` | 必填，等于目录名 |
| `name` / `version` / `icon` | 必填（`icon` 用 lucide 图标名） |
| `system` | 仅系统插件（对话/插件管理/设置）为 `true`，第三方插件一律 `false` |
| `kind` | `app` / `page`；省略时按 `backend` / `ui` / `page` 推断 |
| `backend.entry` | 相对插件根目录，文件必须存在 |
| `ui.entry` | 前端入口，必须存在；`route` 默认 `/<id>`；`dock.order` 默认 100 |
| `page.entry` | 仅 page 类；可省略（用 `build.output.entry` 代替）；page 类**不得**声明 `backend` / `ui` |
| `permissions` | `net` / `fs:read:<path>` / `fs:write:<path>` / `exec`，当前仅展示 |
| `build` | 仅源码型 page 类需要；安装与「加载更新」时执行 `steps`，产物 `dist/` 不入库 |

其余细节（`build.steps` 白名单、v1 兼容规则）见 spec §2、§7。

---

## 5. 后端：Service + 两条数据通道

没有自己的路由要写。`server/main.py` 里模块级声明 `name` / `provide`，再写一个
`Service` 子类：

```python
from app.cordis import Service

name = 'my-plugin'
provide = ['my-plugin']


class MyPluginService(Service):
    def __init__(self, ctx):
        super().__init__(ctx, 'my-plugin')

    def snapshot(self) -> dict:          # GET  /api/apps/my-plugin/state
        return {'items': []}

    def add_item(self, title: str) -> dict:   # POST /api/apps/my-plugin/call
        return {'ok': True, 'title': title}
```

- `snapshot()` → `GET /api/apps/<id>/state`，返回首屏整块状态。
- 其余公开方法 → `POST /api/apps/<id>/call`，请求体 `{"method": "...", "args": {...}}`。
- 方法参数用普通 Python 类型，返回值必须 JSON 可序列化；异常会让前端收到失败响应。
- 不写 FastAPI `router`、不直接读写 `server/data/`、不持久化安装状态
  （安装状态只由 ledger 记录）。

---

## 6. 前端：`setup(uiCtx)` + `registerApp`

```ts
import Page from './MyPlugin.vue'
import type { UiCtx } from './types'

export function setup(uiCtx: UiCtx): void {
  const { defineComponent, h } = uiCtx.vue
  uiCtx.registerApp({
    id: 'my-plugin',
    title: '我的插件',
    icon: 'sparkles',
    route: '/my-plugin',
    order: 50,
    component: defineComponent({ setup: () => () => h(Page, { uiCtx }) }),
  })
}
```

`uiCtx` 提供的全部能力：`vue`、`components`、`icons`、`api`、`toast`、
`layout`（`isMobile` / `isWide`）、`navigation`（跳转与历史栈，见
`docs/NAVIGATION.md`）、`registerApp` / `unregisterApp`。`demo/web/types.ts`
只声明了示例用到的子集，按需补齐。

- `registerApp` 的 `id` / `route` / `icon` 必须与 `plugin.json` 保持一致。
- 数据走 `uiCtx.api.getAppState(id)` 与 `uiCtx.api.callApp(id, method, args)`。
- 样式写在 SFC 的 `<style scoped>` 里；移动端用 `layout.isMobile` 分支。
- 加载失败必须有错误态与重试，不允许永远停在「加载中」。

---

## 7. page 类插件

```
# A. 自带产物：dist 随仓库提交
plugins/my-page/
└── dist/index.html

# B. 源码构建：dist 不进仓库
plugins/my-page/
├── plugin.json          # kind: page + build.output.entry: dist/index.html
├── package.json
└── src/ …
```

无 `plugin.json` 时，`id = name = 目录名`、`icon = package`、`route = /app/<id>`。
补一份 manifest 只改元数据（展示名/图标/描述），路由仍是 `/app/<id>`——page 类
不得声明 `ui`，无法自定义路由。参照 `plugins/anka-quickdraw/plugin.json`。

page 不加载 Python、不编译前端，宿主直接用 iframe 伺服入口；因此不支持
`enable` / `disable`（返回「不支持启停」且状态不变）。

形态 B 的约定：

1. `dist/` 写进**插件仓库**的 `.gitignore`，仓库只留源码；
2. `plugin.json` 声明 `build`（`requires` / `steps` / `output.entry` / `timeout`）；
3. 首次安装在可安装区点 **构建并安装**；之后拉取源码，在插件管理页点
   **加载更新**（`POST /api/plugins/<id>/build`），宿主重跑 `steps` 并重挂 iframe；
4. 构建失败返回 `E_BUILD_FAILED`，消息含出错步骤与日志尾；
5. **每次提交源码后必须 bump `version`**——它是宿主判断新旧的唯一依据，
   不 bump 视为同版本。语义化：修复 `patch`、新能力 `minor`、破坏性 `major`。

构建脚本在宿主持内核锁时执行（默认单步 600s），期间其他插件操作会排队。
完整示例与规则见 `plugins/anka-quickdraw/PLUGIN.md`。

---

## 8. 移动端与 iOS 约束

宿主壳层已经处理了缩放、视口、安全区、系统返回；插件要做的是**不破坏这些前提**，
并在少数场景自行补齐。以下约束对 app 与 page 两类插件都适用（page 类差异单独标注）。

### 8.1 缩放与手势

- 宿主全局 `touch-action: manipulation`（`web/src/styles/base.css`）：禁双击放大，
  保留滚动与双指缩放。插件**不要**再写 `user-scalable=no` / `maximum-scale=1`；
  page 类自己的 viewport 用 `width=device-width, initial-scale=1, viewport-fit=cover`。
- 不要依赖 `dblclick` 做核心操作——双击语义已被全局规则接管，不同 WebView
  派发行为不一致。需要「双击」时用两次 `pointerdown` 的时间窗自判。
- 宿主「创造模式」占用两个角：移动端左下 + 右上 **96px** 角区双指同时按；
  iPad（触屏桌面布局）在 1.5s 内先后点这两个角区也会触发。插件不要在这两个角
  放高频或不可撤销的操作按钮。
- 自定义横/竖滑容器显式声明 `touch-action: pan-x` / `pan-y`，并加
  `overscroll-behavior: contain`；否则 iOS 的 rubber-band 会沿滚动链传导到整页。

### 8.2 视口与高度

- 宿主根是 `fixed inset-0` + `body { overflow: hidden }`，文档流本身不滚动。
  插件根容器用 `height: 100%` / `h-full`，**不要用 `100vh`**——iOS 地址栏收起、
  键盘弹出时它比可视区高，底部按钮会被顶出屏幕。
- 长列表放在插件自己的容器里滚（`overflow-y: auto` + `min-height: 0`），
  不要让内容把宿主 main 撑成整页滚动。
- app 插件在宿主主内容区内渲染，`position: fixed` 相对浏览器窗口、不随宿主滚动区
  裁剪，会盖住 dock 或压到安全区。浮层优先用 `absolute` 定位在插件根内；
  确需全屏浮层（含 `Teleport` 到 body）时自行加 `env(safe-area-inset-*)` 内边距。
- page 类：iframe 内部 `100vh` 等于 iframe 高度，不会溢出；但宿主调整容器高度时
  用 `100%` 跟随更稳，别写死像素高度。

### 8.3 安全区

- 移动壳对 dock 应用与全屏页**不渲染 TopBar、不留顶部空位**（含 safe-area），
  整块区域交给应用。app 插件自绘页头时必须加
  `padding-top: env(safe-area-inset-top, 0px)`，否则被状态栏/灵动岛遮挡。
- 底部固定操作条加 `padding-bottom: env(safe-area-inset-bottom, 0px)`。
  移动壳的 dock 是宿主独立条（已按 safe-area + 16px 抬高），插件不必再为 dock 让位。
- iPad 走桌面壳，上下边同样保留了 safe-area（状态栏），贴边元素一律按 `env()` 处理。
- page 类是 iframe，`env(safe-area-inset-*)` 在 iframe 内通常为 0——不要靠它做
  刘海避让，上下留白由宿主容器负责。

### 8.4 键盘

- Android 由 viewport 的 `interactive-widget=resizes-content` 压缩可视区；
  **iOS 不压缩**，键盘直接盖住页面下半部分，宿主 `fixed` 根不会跟着变。
- 输入框聚焦后用 `scrollIntoView({ block: 'nearest' })` 把输入区带进可视范围；
  **不要**把输入框放在 `position: fixed` 的底栏里（键盘弹出后它被盖住且无法滚动）。
- 键盘感知监听 `visualViewport.resize`，不要用 `window.resize`（iOS 不触发或时机不同）。

### 8.5 返回键与系统手势（必须）

完整约定见 [`docs/NAVIGATION.md`](../docs/NAVIGATION.md)。

- app 插件必须接 `uiCtx.navigation`：内部页面 `push` / `replace`，返回能力用
  `register({ appId, canGoBack, back })`，弹层用
  `registerOverlay({ canGoBack, back, priority })`（优先级高于页面，保证
  「先关弹层、再退页面」）。
- **禁止**自行 `history.pushState` 或监听 `popstate` 做返回。宿主栈是唯一事实来源，
  自建历史会让 Android 返回跳过一级，或在刷新后被重置到应用入口。
- 宿主卸载插件时会调 `removeApp(id)` 清理栈与处理器，插件不要在卸载后继续持有 router。
- page 类：iframe 的历史与宿主隔离，宿主返回会直接离开插件、**不会在 iframe 内部回退**。
  多级界面的 page 插件请用页内返回按钮 + 单页状态，不要依赖浏览器返回键。

### 8.6 设备与布局判定

- 用 `uiCtx.layout.isMobile`（`< 640px`，仅手机竖屏）与 `isWide`（`≥ 1280px`）分支，
  不要用 UA 判断。
- iPad（768–1024px）**走桌面壳**，按宽度适配，不要假设「触屏 = 手机」；
  触屏 iPad 的创造模式入口是两角先后点按，而非双指对角。

### 8.7 媒体、权限与安装态

- 选图用 `<input type="file" accept="image/*" multiple>`（移动端唤起「照片图库 / 拍照」），
  不要写死 `capture`。
- 摄像头/麦克风：iOS **网页态**授权是会话级（每次询问），加入主屏以 standalone 运行时
  才记住授权。插件不要自己引导安装，安装提示由宿主统一负责；媒体调用失败时
  提示「添加到主屏幕后重试」即可。
- 插件不做安装态检测（`navigator.standalone` / `display-mode`），当前 `uiCtx` 未暴露
  该能力，确有需要先向宿主提通用接口。

### 8.8 触控目标

- 可点区域 ≥ 36×36px，移动端主要操作 40×40；按压反馈用 `active:scale-95` 一类。
- `-webkit-tap-highlight-color` 宿主已全局置透明，插件不要再设成有色高亮。

---

## 9. 提交前自检

```sh
cd server
python -m app.cli verify my-plugin     # 字段 / 入口 / build 白名单 / 后端 import 冒烟
python -m app.cli doctor --all         # 扫描与 ledger 交叉校验，确认无 issue
```

提交插件源码后**必须 bump `plugin.json` 的 `version`**（见 §7 形态 B 第 5 条），
否则宿主与插件管理页视为同一版本，用户无法判断「是否需要加载更新」。

手动走一遍：

- [ ] 插件页能看到卡片，`name` / `description` / `icon` 正确
- [ ] 安装后 dock 出现入口，点击能进入，硬刷新后路由仍是该插件
- [ ] `snapshot()` 数据渲染正常；`call` 方法与 `toast` 反馈正常
- [ ] 断网/后端报错时显示错误态，可重试（不白屏、不卡加载）
- [ ] 卸载后 dock 入口消失、`doctor` 无残留；再次安装正常
- [ ] 移动端宽度下布局可用，且符合 §8 约束：
  - [ ] 390×844（手机）与 768×1024（iPad）下无横向溢出，底部内容不被 dock / 安全区遮挡
  - [ ] 无 `100vh` 硬高；输入框聚焦后仍可见（键盘不遮）
  - [ ] 系统返回逐级退栈：弹层先关 → 页面后退 → 退出应用
  - [ ] page 类没有自建 `history` 返回逻辑；app 类没有 `popstate` 监听

---

## 10. 常见报错与修法

| 错误码 | 通常是 | 怎么修 |
|--------|--------|--------|
| `E_MANIFEST_PARSE` | `plugin.json` 有注释或尾逗号 | 用严格 JSON 校验一遍 |
| `E_MANIFEST_FIELD` | 缺 `id`/`name`/`version`，或 page 类声明了 `ui`/`backend` | 对照 §4 模板补齐/删除字段 |
| `E_ID_MISMATCH` | 目录名与 `id` 不一致 | 改目录名或改 `id`，两者必须相同 |
| `E_ENTRY_MISSING` | `backend.entry` / `ui.entry` / `page.entry` 指向不存在的文件 | 路径相对插件根目录，检查大小写 |
| `E_LOAD_FAILED` | 后端 import 或 `apply` 抛错 | 在 `server/` 下按路径加载复现：`python -c "import importlib.util as u,sys;f='../plugins/<id>/server/main.py';s=u.spec_from_file_location('probe',f);m=u.module_from_spec(s);s.loader.exec_module(m)"`，看 traceback |
| `E_RESTART_REQUIRED` | 同名插件本进程加载过，重装被拒 | 重启后端后再装；开发期改后端代码也需要重启 |

后端日志的关键字是 `agentos.plugin_service` / `agentos.folder_loader`。

---

## 11. 红线

- 不改内核：不编辑 `server/app/**`、`web/src/**` 来适配单个插件；需要新能力先加
  `uiCtx` / Service 的通用接口。
- 不新增清单文件、不新增安装状态文件（`installed.json` 已废弃，ledger 是唯一事实来源）。
- 不跨插件 import 另一个插件的代码；共享逻辑上提到宿主或复制。
- 不在插件里写 `sys.path` hack、不改 `sys.modules`、不在 import 期做重 IO。

---

## 12. 文档索引

| 文档 | 内容 |
|------|------|
| [`docs/PLUGIN-SPEC.md`](../docs/PLUGIN-SPEC.md) | 正典契约：字段表、kind 判定、状态机、错误码、CLI |
| [`plugins/demo/README.md`](./demo/README.md) | 官方样本逐文件说明 |
| [`docs/NAVIGATION.md`](../docs/NAVIGATION.md) | 应用内跳转与历史栈约定（`uiCtx.navigation`） |
| `ARCHITECTURE.md` §8 | App 插件模型与内核分工 |
