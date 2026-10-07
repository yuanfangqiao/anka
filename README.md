# pwa-demo · 可安装的 Agent 样例 PWA

> 状态：**M14 完成**（真实模型 TokenHub + Agent 自我插件开发就绪）。
> 文档导航：[IDEA.md](./IDEA.md)（需求）· [PROJECT.md](./PROJECT.md)（范围与里程碑）· [ARCHITECTURE.md](./ARCHITECTURE.md)（技术方案）· [AGENT.md](./AGENT.md)（Agent 工作守则）

## 这是什么

一个可安装到桌面 / 主屏幕的 PWA 样例，演示「Agent = 一组可热插拔的插件」：

- **手机形态**（≤768px）：顶部返回/设置 + 内容区 + 底部 dock（笔记 / 对话 / 探索）
- **桌面形态**（>768px）：左侧竖向侧边栏（插件 / 任务 / 网络 / 工作区）+ 大圆角主窗口（对话框）+ 底部居中 dock（与手机共用）
- **后端**：FastAPI 承载插件化 Agent 内核（移植自 `reference/cordis-mini`），LLM 走 `llm-tokenhub`（腾讯云 TokenHub，13 模型），无 Key 时自动回退 Echo 假模型
- **PWA**：manifest + Service Worker，mac / Win / iOS / Android 均可安装，具备离线 App Shell

## 环境要求

- Python 3.11+（内核使用 `ExceptionGroup`）
- Node.js 18+ 与 npm（前端构建）

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

脚本会检查并释放已占用的 8000/5173 端口，等待服务就绪后打印地址；日志在 `logs/server.log`、`logs/web.log`。

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

### 安装 PWA（重要：从生产端口安装）

> ⚠️ 不要从 dev 端口 5173 安装——dev SW 已禁用，5173 仅供开发调试。
> 正确姿势：`cd web && npm run build`，然后打开 **http://localhost:8000** 安装。

1. 桌面 Chrome / Edge 打开 `http://localhost:8000`，地址栏出现安装按钮 → 安装后独立窗口启动
2. 手机模拟器（390×844）检查 dock 贴底、不被手势条遮挡
3. DevTools → Network → Offline，刷新仍有 App Shell
4. 窗口从 1440 拖到 400：桌面壳 → 手机壳，切换无闪烁
5. 旧版本 PWA 升级异常时：卸载后从 8000 重新安装（已开启 cleanupOutdatedCaches）

### 国行安卓（小米）安装 PWA 指引

> 适用范围：MIUI / HyperOS 国行 ROM。这类系统**没有 Google Play 服务（GMS）**，
> 而 Chrome 的 PWA 安装要靠 GMS 铸造 WebAPK，所以在国行小米上 **Chrome 换任何代码都装不出真 PWA**。
> 下表是各浏览器的实际表现，按需要选路。

| 浏览器 | 能否装 | 装出来是什么 | 说明 |
|---|---|---|---|
| **小米自带浏览器** | ✅ 推荐 | 独立窗口，**无地址栏** | 系统应用，天生有「创建桌面快捷方式」权限，用自家实现、不依赖 GMS —— 国行小米上的正解 |
| **Edge** | ⚠️ 需先开权限 | 独立窗口，基本无地址栏 | 自有 PWA 实现、不依赖 GMS。**必须先手动开权限**，否则点「添加到主屏幕」会跳到设置页后无下文 |
| **Chrome** | ❌ 只能加快捷方式 | 在 Chrome 标签页内打开，**带地址栏** | 无 GMS → 无 WebAPK → 菜单里只有「添加到主屏幕」而不是「安装应用」 |

**必须先开的系统权限（Chrome / Edge 都要）**

MIUI 对第三方应用默认**拒绝**「创建桌面快捷方式」，所以点了会静默失败 —— toast 一闪、桌面上什么都没有。手动开：

> 设置 → 应用设置 → 应用管理 → 找到对应浏览器 → **权限管理** → 「**创建桌面快捷方式**」→ 允许

找不到就在设置页顶部搜索框直接搜「快捷方式」。开完**回到浏览器重新点一次**。

**Edge 点「添加到主屏幕」跳到设置就没了？**

Edge 发现缺权限后会按标准安卓流程把系统丢到授权页，但 MIUI 没实现这个标准页，于是落地在一个没有任何可操作项的设置页上。**别走它那个跳转**，按上面的路径手动给 Edge 开权限即可。

**能力边界（别踩坑）**

- Chrome 即使加上了图标也**不是**真 PWA：没有 GMS 就没有 WebAPK，点开仍是 Chrome 里的标签页。
- 站点若挂在 `basic_auth` 之后，Chrome 铸造 WebAPK 时需要 Google 服务器**不带凭据**地抓取 `manifest.webmanifest`、图标和 `start_url`，会被 401 挡掉 —— 即便将来换到有 GMS 的环境，也可能仍装不出独立窗口。真要支持，得在 Caddy 上把这几个静态资源路径免鉴权放行。
- 判断装的是不是真 PWA，只看一点：桌面图标打开后**顶部有没有地址栏**。

## 目录结构

```
pwa-demo/
├── IDEA.md / PROJECT.md / ARCHITECTURE.md / AGENT.md / CHANGELOG.md / README.md
├── reference/          # 只读参考（cordis-mini、ComfyUI、ComfyUI_frontend）
├── plugins/            # 应用插件（前后端一体文件夹，可动态装卸）：notes / explore / …
├── system-plugins/     # 系统插件标记（对话/插件管理/设置，UI 静态捆入内核）
├── server/             # FastAPI + cordis 插件内核 + infra 插件 + data/installed.json
├── web/                # Vue 3 + Vite + Tailwind + vite-plugin-pwa（前端宿主）
└── scripts/smoke.py    # 后端冒烟验证（25+ 项断言）
```

技术细节见 `ARCHITECTURE.md`（App 插件模型见第 8 节）。

## 配置模型（TokenHub · M13）

1. 打开「设置」→「模型服务」分区，粘贴 TokenHub API Key（`sk-tp-...`）→「保存」→「测试连通性」
2. 对话页顶栏下拉切换 13 个模型，选择会即时生效并持久到服务端 `server/data/settings.json`
3. 未配 Key 时对话自动回退 Echo 假模型，不会报错；Key 存 `server/data/credentials.json`（只写、不回读明文、不入日志），API 只回脱敏 `sk-tp-***`

## 应用插件的装与卸

- **发现**：把符合契约的文件夹（`plugin.json` + `server/` + `web/`）放进 `plugins/` 目录，插件管理页「可安装」区就会出现
- **安装**：插件管理页点「安装」即时生效，dock 出现图标；**同名插件卸载后再装需重启后端**（拍板语义）
- **卸载**：插件卡片上的垃圾桶按钮 → 确认弹窗（含级联提示）→ dock 图标立即消失，刷新页面彻底干净
- **空系统**：卸光应用插件后，主页变为 EmptyHome 空态，只剩系统插件（对话/插件管理/设置）

## 约定

- `reference/` **只读**：不修改、不作为运行时 import 路径
- 业务能力一律写成插件（后端 `server/app/plugins/`，前端 `useAppRegistry` 元数据）
- 单文件 ≤300 行；改内核须同步记录 `server/app/cordis/PATCHES.md`
