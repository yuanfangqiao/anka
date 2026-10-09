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
  --exclude 'plugins/quickdraw/apps' --exclude 'plugins/quickdraw/packages' \
  --exclude 'plugins/quickdraw/examples' --exclude 'plugins/quickdraw-0.1.3.tar.gz' \
  ./ ubuntu@106.55.121.165:/home/ubuntu/anka
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

[Install]
WantedBy=multi-user.target
```

`systemctl enable --now anka`

## 5. Caddy 映射（参照你 water/dsh 的现成风格）

追加到 `/etc/caddy/Caddyfile`：

```caddyfile
anka.vitcou.com {
    basic_auth {
        agent <bcrypt 哈希，用 caddy hash-password 生成>
    }
    reverse_proxy 127.0.0.1:8100 {
        flush_interval -1
    }
}
```

sudo caddy validate --config /etc/caddy/Caddyfile

systemctl reload caddy


两个细节：
- **`flush_interval -1` 必须加**——chat 接口是 SSE 流式，不加会把输出攒成一坨
- HTTPS 由 Caddy 自动签，PWA 的 SW/安装要求 secure context 自动满足
- 将来加多端同步（IDEA §3.11）时 WS 无需改 Caddy 配置，原生支持

## 6. ⚠️ 一个必须做的安全项

内核里有 **`tool-bash` 插件**（能执行 shell 命令）。裸暴露到公网 = 任何人可在你服务器上跑命令。所以第 5 步的 `basic_auth` **不是可选项**，或者至少用防火墙/内网限制访问。你 water/dsh 项目已经用过 basic_auth，照搬即可。

## 7. 上线验证清单

```text
[ ] https://anka.vitcou.com 打开壳
[ ] /api/health 正常
[ ] 手机 Chrome/Safari →「安装应用」出现（PWA 生效）
[ ] quickdraw / snake / notes 插件逐个打开
[ ] chat 发消息流式输出不断流（验证 flush_interval）
[ ] 未输密码时 401（basic_auth 生效）
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
