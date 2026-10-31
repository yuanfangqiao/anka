# Anka · Agent 操作系统

## 这是什么
![anka-full-screen](/assets/apple-touch-icon.png)
![anka-full-screen](/assets/ipad_screen_shot.png)

**Anka** 是一个 **Agent 操作系统**（AgentOS）的实现：把「Agent = 一组可热插拔的插件」做成可安装、可扩展的系统。当前前端以 **PWA** 形态交付（可安装到桌面 / 主屏幕），后端由 FastAPI 承载插件内核。

三个词的分工：

| 名称 | 指什么 |
|---|---|
| **Anka** | 项目名，本仓库 |
| **AgentOS** | 实现方式：一个以插件为基本单元的 Agent 操作系统 |
| **PWA** | 前端交付形态：可安装、可离线，不是项目本身 |

当前形态：

- **手机形态**（≤768px）：顶部返回/设置 + 内容区 + 底部 dock（笔记 / 对话 / 探索）
- **桌面形态**（>768px）：左侧竖向侧边栏（插件 / 任务 / 网络 / 工作区）+ 大圆角主窗口（对话框）+ 底部居中 dock（与手机共用）
- **后端**：FastAPI 承载插件化 Agent 内核（移植自 `reference/cordis-mini`），LLM 走 `llm-tokenhub`（腾讯云 TokenHub，13 模型），无 Key 时自动回退 Echo 假模型
- **前端（PWA）**：manifest + Service Worker，mac / Win / iOS / Android 均可安装，具备离线 App Shell；PWA 只是当前的交付形态，换壳不影响内核

## 环境要求

- Python 3.11+（内核使用 `ExceptionGroup`）
- Node.js 18+ 与 npm（前端构建）

游戏等自带构建的插件按自身 `build.requires` 检查环境；前线对决需要 Node.js 22.12+。

## 游戏房间与邀请

更新后重启后端，在插件管理中对 `anka-outpost-strike` 点击「构建并安装」。
配置 `ANKA_PUBLIC_URL=https://你的域名`，房主即可生成好友可访问的二维码与链接。
邀请 10 分钟有效，成功兑换后的房间访客身份独立有效 24 小时。
当前按单实例、单 worker 运行；完整接入、部署与限制见 [房间文档](docs/ROOMS.md)。

新增后端验证（项目根目录）：

```sh
PYTHONPATH=server .venv/bin/python -m unittest discover -s server/tests -v
```


## Mosaico 蓝牙手柄

新增独立原生应用 [anka-gatt-gamepad](device/anka-gatt-gamepad/README.md)，原 Wi-Fi/手机手柄保留。
游戏里的「连接蓝牙手柄」使用电脑 Chrome/Edge、可信 HTTPS 或 localhost。
构建/安装命令、固定依赖及平台限制见应用说明，接口见 [GATT协议](docs/GATT-GAMEPAD.md)。

## 依赖清单

### 后端 `server/requirements.txt`

```
fastapi>=0.112
uvicorn[standard]>=0.30
httpx>=0.27        # TokenHub 真实 LLM 流式调用
```

### 前端 `web/package.json`（核心依赖）

```
vue ^3.4                 vue-router ^4.3
typescript ^5.5          vite ^5.4              @vitejs/plugin-vue ^5.1
tailwindcss 3.4.17       postcss ^8.5           autoprefixer ^10.4.20
tailwindcss-animate ^1.0.7
vite-plugin-pwa ^0.20    lucide-vue-next        @vueuse/core ^11
```

## 快速开始（推荐：一键脚本）

```bash
./start_all.sh          # 启动后端 8000 + 前端 5173（自动建 venv / npm install）
./stop_all.sh           # 停止全部（按 PID 文件 + 端口兜底清理）
./start_all.sh --prod   # 后端关 reload，配合 web/dist 验证生产形态
```

脚本会检查并释放已占用的 8000/5173 监听端口，并行等待前后端就绪后打印地址。
本机健康检查直连 `127.0.0.1`，绕过代理；进程退出或超时会报错并返回非零状态。
`logs/startup.log` 记录启动各阶段与总耗时，`logs/server.log` 记录模块导入、
插件初始化、缓存复用和构建步骤耗时，`logs/web.log` 记录 Vite 启动。
长构建每 5 秒记录一次进度；可运行 `tail -f logs/startup.log logs/server.log logs/web.log` 定位等待位置。
游戏等 App 的独立运行时已有 `build.output.entry` 时，重启直接复用；
缺失时才补构建，主动安装或「加载更新」会执行构建配方（包含声明的 `npm ci`）。

## 手动启动

```bash
# 1) 后端（端口 8000）
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r server/requirements.txt
python server/run_dev.py
# 验证：curl http://localhost:8000/api/health → {"status":"ok",...}

# 2) 前端开发（端口 5173，/api 自动代理到 8000）
cd web
npm install
npm run dev
# 打开 http://localhost:5173
```

### 生产运行（单进程）

```bash
cd web && npm run build          # 产出 web/dist（含 manifest.webmanifest 与 sw.js）
cd .. && python server/run_dev.py --prod
# 或：uvicorn app.main:app --app-dir server/app --port 8000
# 访问 http://localhost:8000，由 FastAPI 托管 dist 并提供 SPA 回退
```


## 目录结构

```
anka/
├── IDEA.md / PROJECT.md / ARCHITECTURE.md / AGENT.md / CHANGELOG.md / README.md
├── agent-architecture.drawio.png  # 双端布局事实图（内嵌 XML，可编辑）
├── docs/               # 已定契约：PLUGIN-SPEC / NAVIGATION
├── design/             # 设计方案与 UI 设计（architecture/ 方案、ui/ 线框与原型）
├── reference/          # 只读参考（cordis-mini、ComfyUI、ComfyUI_frontend）
├── plugins/            # 应用插件（前后端一体文件夹，可动态装卸）：notes / explore / …
├── system-plugins/     # 系统插件标记（对话/插件管理/设置，UI 静态捆入内核）
├── server/             # FastAPI + cordis 插件内核 + infra 插件 + data/installed.json
├── web/                # Vue 3 + Vite + Tailwind + vite-plugin-pwa（前端宿主）
└── scripts/smoke.py    # 后端冒烟验证（25+ 项断言）
```

技术细节见 `ARCHITECTURE.md`（App 插件模型见第 8 节）。

## 配置模型

1. 打开「设置」→「模型服务」分区，粘贴 TokenHub API Key（`sk-tp-...`）→「保存」→「测试连通性」
2. 对话页顶栏下拉切换 13 个模型，选择会即时生效并持久到服务端 `server/data/settings.json`
3. 未配 Key 时对话自动回退 Echo 假模型，不会报错；Key 存 `server/data/credentials.json`（只写、不回读明文、不入日志），API 只回脱敏 `sk-tp-***`

## 应用插件的装与卸

- **发现**：把符合契约的文件夹（`plugin.json` + `server/` + `web/`）放进 `plugins/` 目录，插件管理页「可安装」区就会出现
- **安装**：插件管理页点「安装」即时生效，dock 出现图标；**同名插件卸载后再装需重启后端**（拍板语义）
- **卸载**：插件卡片上的垃圾桶按钮 → 确认弹窗（含级联提示）→ dock 图标立即消失，刷新页面彻底干净
- **空系统**：卸光应用插件后，主页变为 EmptyHome 空态，只剩系统插件（对话/插件管理/设置）

## 约定

插件开发上手、命名规范与自检清单见 [`plugins/README.md`](plugins/README.md)，
字段契约见 [`docs/PLUGIN-SPEC.md`](docs/PLUGIN-SPEC.md)。

应用切换与系统返回的插件开发接口见 [`docs/NAVIGATION.md`](docs/NAVIGATION.md)。
导航回归可运行 `cd web && node scripts/check-navigation.mjs`：需要可选 Playwright
与已安装 Chrome；模块不在项目路径时设置 `ANKA_PLAYWRIGHT_MODULE`，详见导航文档。

- `reference/` **只读**：不修改、不作为运行时 import 路径
- 业务能力一律写成插件（后端 `server/app/plugins/`，前端 `useAppRegistry` 元数据）
- 单文件 ≤300 行；改内核须同步记录 `server/app/cordis/PATCHES.md`

## 设计文档与图

自己写方案设计和 UI 设计时，一律放 `design/`，不要新建平行目录：

- **写在哪**：架构/交互方案 → `design/architecture/`；UI 设计、线框、原型 → `design/ui/`。`docs/` 只放已成契约的规范（`PLUGIN-SPEC.md`、`NAVIGATION.md`），`ARCHITECTURE.md` 是架构正典。
- **怎么命名**：`design/<领域>/<主题>.md`，配图同名同目录（`shell-layout.md` ↔ `shell-layout.drawio.png`），正文用相对路径引用。
- **图怎么编辑**：`.drawio.png` 是 PNG 内嵌 diagram XML，VSCode 安装 **Draw.io Integration** 后可直接双击编辑并保存回写；不要改名去掉 `.drawio`，也不要用普通图片工具另存（会丢 XML）。
- **状态与归档**：文档首部标 `草案 / 已定稿 / 已废弃`；定稿后把结论合并进 `ARCHITECTURE.md` 或 `docs/`，`design/` 原稿留作决策记录，不两边同步维护。
- **不放根目录**：根目录 `*.png` 已被 `.gitignore` 兜底忽略（`agent-architecture.drawio.png` 为已跟踪例外），新图放 `design/`；只有给 `docs/` 正文配的图才放 `docs/assets/`（按需创建）。

索引与完整约定见 [`design/README.md`](design/README.md)。

### 扫码手柄

游戏中点击“手柄设备接入”，手机扫码自动控制当前玩家；ESP-Mosaico 打开已保存的手柄 Idea 后沿用系统 Wi-Fi 自动进入扫码，无需手机配网或输入 host。用已有 `ANKA_PUBLIC_URL` 配置对外地址（如局域网 `http://192.168.1.100:5173` 或域名 `https://anka.example.com`）；`HOST`/`PORT` 仍只控制后端监听。项目根 `.env` 会在启动时读取，Shell 环境优先。权限、JSON 调试与验证命令见 [设备接入](docs/DEVICES.md)，固件依赖和构建见 [ESP32 手柄](device/esp32/README.md)。

手机手柄体感需要可信HTTPS：二维码地址继续配置`ANKA_PUBLIC_URL`；Vite本地TLS可同时设置`ANKA_DEV_TLS_CERT`和`ANKA_DEV_TLS_KEY`为受信任证书/私钥路径。无TLS时ESP与手机触控可用，iPhone网页体感受浏览器限制。完整协议与验证命令见[设备文档](docs/DEVICES.md)。

### 静态资源压缩

前端 `npm run build` 自动生成 Brotli/Gzip 副本；Anka 开发和生产环境默认压缩游戏等静态资源，带哈希的文件使用浏览器私有长期缓存。无需客户端配置，详见 [静态资源传输](docs/STATIC-ASSETS.md)。


## 应用保活与运行管理（M21）

打开应用后，切换只改变显示状态，原生组件、草稿、滚动与 iframe 文档保持原样。
Dock 图标下，当前应用显示长线，后台应用显示小点，未运行应用不显示标记。
桌面右键或手机长按图标，可显示、关闭、重新启动应用或在桌面选择第二个应用分屏。
手机继续单窗口显示；常驻界面上限为 10 个，满额优先回收最久未使用且允许关闭的后台应用。
关闭保护或声明继续运行的应用不自动回收；全部受保护时提示先保存/关闭，预执行满额跳过。
关闭应用不卸载插件，刷新或回收后的草稿恢复需应用接入持久化。

插件首次打开才初始化；manifest.runtime 可控制保活、资源预取、选择性预执行与后台策略。
静态页面无需改造即可保活，引入 `/anka-sdk.js` 可接入虚拟路由、返回、通信、存储和主题。
完整说明与边界见 [应用运行时与 SDK](docs/APP-RUNTIME.md)。

```sh
cd web
npm run typecheck
npm run check:capacity
npm run check:runtime
ANKA_RUNTIME_PRODUCTION=1 npm run check:runtime
npm run check:navigation
```

浏览器回归依赖可选 Playwright 和本机 Chrome；外部安装通过 ANKA_PLAYWRIGHT_MODULE 指定入口。
回归使用隔离数据，不操作用户后端。手机 PWA 手势、浏览器回收和设备连接须另行真机验收。
