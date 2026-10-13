-
Caddy 已有成熟配置可参照。再确认两个影响部署方式的关键点——依赖清单和 gitignore 对产物的处理：
两个关键确认影响部署策略：
- `web/dist/` 和 `.plugin-dist/` 都被 `.gitignore` 忽略 → **不能纯 git clone 部署**（产物会缺），要么本地构建后 rsync，要么服务器装 Node 构建
- 依赖极轻：`server/requirements.txt` 只有 fastapi/uvicorn/httpx 三项

完整步骤如下（你的 1、2 是对的，中间缺了传输方式、进程守护和一个安全项）：

## 0. 前置（一次性）

- **DNS**：`anka.vitcou.com` A 记录 → 服务器 IP
- 服务器装 **Python 3.10+**（代码用了 `tuple[...] | None` 新语法）+ 已有 Caddy ✓

## 1. 本地构建（不碰服务器，产物全在本地出）

```bash
cd web && npm run build          # → web/dist（SW 已含 M11.1 denylist 修复）
```

`.plugin-dist/`（6 个 app 插件的编译产物）**本地已经构建好了**，直接随项目传——这样**服务器完全不需要装 Node**。

## 2. 传输（rsync，排除无关大目录）

```bash
rsync -avz \
  --exclude node_modules --exclude .venv --exclude reference \
  --exclude 'plugins/' \
  ./ ubuntu@<IP>:/home/ubuntu/anka
```

注意 rsync **不受 gitignore 影响**，`web/dist` 和 `.plugin-dist` 会带上（这正是不能纯 git 部署的原因）。

## 3. 服务器初始化 + 手动验证

```bash
cd /home/ubuntu/anka/server
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
HOST=127.0.0.1 PORT=8100 .venv/bin/python run_dev.py --prod
# 另开终端验证：
curl -s localhost:8100/api/health
```

`--prod` 的作用：关 reload、不置 `AGENTOS_DEV` → 插件用 `.plugin-dist` 产物、静态走 `web/dist`。**绑 127.0.0.1**，只让 Caddy 能访问。

## 4. systemd 守护（生产必备，否则断连进程就没了）

`/etc/systemd/system/anka.service`：

```ini
[Unit]
Description=AgentOS PWA
After=network.target

[Service]
WorkingDirectory=/home/ubuntu/anka/server
Environment=HOST=127.0.0.1
Environment=PORT=8100
ExecStart=/home/ubuntu/anka/server/.venv/bin/python run_dev.py --prod
Restart=always
User=ubuntu
Group=ubuntu

[Install]
WantedBy=multi-user.target
```

`systemctl enable --now anka`

## 5. Caddy 映射（参照你 water/dsh 的现成风格）

追加到 `/etc/caddy/Caddyfile`：

```caddyfile
anka.vitcou.com {
    reverse_proxy 127.0.0.1:8100 {
        flush_interval -1
    }
}
```

sudo caddy validate --config /etc/caddy/Caddyfile

systemctl reload caddy


三个细节：
- **`flush_interval -1` 必须加**——chat 接口是 SSE 流式，不加会把输出攒成一坨
- **不要加 `basic_auth`**——M18 起鉴权在应用层（见第 6 节），叠加会变成「浏览器弹窗 + 登录页」双重验证，
  且 basic_auth 在 iOS 独立窗口（standalone PWA）有兼容坑
- **不要加 `encode gzip`**（除非你确认 SSE 不卡）——gzip 与 SSE 流式是已知的踩坑组合，
  压不动多少带宽却可能让流式输出攒批；前端资源是 hash 文件名、由 FastAPI 直出，需要压缩再单独处理
- HTTPS 由 Caddy 自动签，PWA 的 SW/安装要求 secure context 自动满足
- 将来加多端同步（IDEA §3.11）时 WS 无需改 Caddy 配置，原生支持

## 6. ⚠️ 一个必须做的安全项：应用层登录鉴权（M18）

内核里有 **`tool-bash` 插件**（能执行 shell 命令）。裸暴露到公网 = 任何人可在你服务器上跑命令。

**M18 起内置应用层会话鉴权**（不再依赖 Caddy basic_auth——basic_auth 在 iOS 独立窗口
（standalone PWA）有兼容坑，且体验原始、难以登出）：

### 6.1 创建账号（首次部署必做，无默认账号）

```bash
cd /home/ubuntu/anka/server
mkdir -p ~/.anka && chmod 700 ~/.anka
.venv/bin/python -m app.auth adduser vitcou        # 交互输入密码（不回显）
.venv/bin/python -m app.auth list                  # 查看账号
# 其他：deluser <name>（删号）
```

- 账号文件：`~/.anka/users.json`（pbkdf2_sha256 哈希，权限 600）
- 签名密钥：`~/.anka/auth_secret`（首次访问自动生成，权限 600）
- **放项目目录之外**：rsync 部署不会覆盖，账号不会被本地数据冲掉
- 自定义位置：环境变量 `ANKA_USERS_FILE=/path/to/users.json`
- **systemd 注意**：服务运行用户须有家目录（`~` 解析为运行用户 home）；
  `anka.service` 用 `ubuntu` 用户运行即满足

### 6.2 鉴权行为

- 会话：HttpOnly + SameSite=Lax cookie，30 天；HTTPS 下自动加 Secure
- 保护范围：全部 `/api/*`（含 SSE 对话流、会话、插件管理、设置）、`/plugins/`、
  `/plugin-dist/`、WebSocket 同步通道
- 放行：`/api/auth/*`、`/api/health`、壳静态资源（登录页在壳内渲染）
- 防爆破：单账号 5 次失败锁 10 分钟；**单 IP 100 次失败封 24 小时**
  （可用 `ANKA_ACCOUNT_MAX_FAILS` / `ANKA_IP_MAX_FAILS` / `ANKA_IP_BAN_SECONDS` 调整）
- 登出：控制台 → 关于 → 登出

### 6.3 Caddy 侧（最终形态）

```caddyfile
anka.vitcou.com {
    reverse_proxy 127.0.0.1:8100 {
        flush_interval -1
    }
}
```

- **`basic_auth` 必须删掉**：认证已由应用负责，叠加会双重验证且在 iOS PWA 上体验有问题
- **顺序**：先 `adduser` 建好账号，再去掉 `basic_auth` 并 reload——否则中间会有一段「零鉴权」窗口，
  而这个后端带 `tool-bash`（可执行 shell），不能有任何裸奔时间
- **`X-Forwarded-For` 保持默认开启**（Caddy 默认带）:应用的单 IP 失败封禁靠它识别真实客户端；
  若代理链丢了这个头，所有请求会被视为同一 IP，误伤全体
- 想要边缘限流需自定义构建（`rate_limit` 是第三方模块，非 Caddy 标准库）；
  应用已内置「单账号 5 次锁 10 分钟 + 单 IP 100 次封 24 小时」，个人部署够用

## 7. 上线验证清单

```text
[ ] https://anka.vitcou.com 打开壳
[ ] /api/health 正常
[ ] 手机 Chrome/Safari →「安装应用」出现（PWA 生效）
[ ] quickdraw / snake / notes 插件逐个打开
[ ] chat 发消息流式输出不断流（验证 flush_interval）
[ ] 未登录访问 / 被 302 到 /login（应用层鉴权生效）
[ ] 登录后 WS 同步/插件加载正常；登出后接口 401
```

以后更新只需：本地 `npm run build` → 重跑第 2 步 rsync → `systemctl restart anka`。

需要我把这份部署步骤写进 `README.md`（或单独 `DEPLOY.md`）吗？
## 8. 更新一致性约定（M17.10，长期维护必须遵守）

PWA 各端「每次打开都收敛到最新」靠三条约定，不靠运气：

1. **任何改动都走完整构建部署**：前端 / 后端 / `plugins/` 下插件的任何改动，提交后执行
   `npm run build` → rsync → `systemctl restart anka`。构建会把 git sha 写进
   `dist/version.json`（前端版本）与 `/api/health` 的 `api_build`（后端版本）——
   版本号必变，各端 PWA 才能感知并提示更新。**只改插件不重新构建 = 各端感知不到**。
2. **API 只增不改 + 宽限期**：可加字段；改/删旧字段须等最老在线客户端刷新后（≥24h）。
   灰度/重启间隙新旧终端并存，这是不炸的唯一保障。
3. **缓存头约定**：`sw.js` / `index.html` / `manifest.webmanifest` / `workbox-*` 由后端
   强制 no-cache（已内置）；`/assets/*` 为 hash 文件名可长缓存；若前面再套 CDN，
   不要给 `sw.js` 配置缓存规则。

运行机制（排障参考）：
- 代码级变化 → 顶部横幅「发现新版本 / 前端已更新 / 服务端已更新」→ 用户点击整页重载
  （有活跃 agent 任务时不会被打断，横幅只是提示）
- 数据级变化（插件装卸、配置变更、会话）→ WS 实时推送，各端局部刷新不重载
- 兜底：旧版 hash 资源 404（回滚翻车）→ 自动清缓存强制刷新
