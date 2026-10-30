# 默认静态资源压缩与缓存

Anka 为宿主资源和插件运行资源默认协商压缩，无需玩家操作。

## 构建与交付

- `web` 的 `npm run build` 在 Vite/PWA 构建完成后，为 HTML、JS、CSS、JSON、SVG、GLB、glTF 和 WASM 生成 `.br` / `.gz` 副本。小于 1 KB 或压缩收益不足 2% 的内容不生成副本。
- 插件可以使用相同的预压缩约定。游戏插件已经在自己的事务式构建中生成副本，压缩失败不会替换上一份完整构建。
- 浏览器请求原始 URL；按 `Accept-Encoding` 的可用格式与质量选择副本，相同质量优先 Brotli。压缩文件须不早于原文件；过期副本不使用。
- 没有合适副本时，支持 Gzip 的静态/HTML 请求可以动态压缩（级别 6，约 1 KB 起）；其余回退原文件。不把 API、SSE 或 WebSocket 纳入这一静态压缩层。
- 保留原始资源 MIME，使用 `Content-Encoding` 和 `Vary: Accept-Encoding`。Range 请求使用未压缩表示，保留字节范围语义。

## 两条资源路径

- 生产：`server/app/static_assets.py` 提供静态响应、静态目录与动态压缩中间件；`main.py` 仅接线。`/plugins/`、`/plugin-dist/` 的已有鉴权先于资源交付执行。
- 开发：`web/scripts/http-assets.mjs` 被 Vite 的插件文件中间件使用，覆盖绕过 FastAPI 的游戏模型请求。同一工具在游戏独立开发/预览中复用。

这些属于 HTTP 静态资源交付基础设施，不新增业务插件、权限或公开资源入口。

## 缓存与更新

- 带内容哈希的 `assets/<name>-<hash>.<ext>`：`private, max-age=31536000, immutable`，缓存仅供浏览器使用。
- 开发源码继续 `no-store, must-revalidate`；生产不带哈希的普通资源默认 `no-cache`。
- 插件 HTML 入口检查更新；宿主已有入口、Service Worker、manifest 和 Workbox 的禁缓存规则继续保留。
- 保留宿主原有 Service Worker 策略；不可变资源的浏览器缓存避免重复传输，未额外预下载插件模型。

## 验证

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=server .venv/bin/python -B -m unittest discover -s server/tests -p 'test_*.py'
cd web && npm run build
```

专门的 `server/tests/test_static_compression.py` 覆盖 Brotli、Gzip、原始表示、q=0、条件请求、Range、过期副本、动态压缩、登录保护、SSE 和 HEAD。

游戏插件的 `scripts/verify-asset-server.mjs` 检查 Anka Vite；`scripts/verify-delivery.mjs` 用真实 Chrome 检查 Anka 生产路由、模型解码、首次传输和再次打开的缓存。

2026-10-30 本地验证：游戏单独入口的桌面和手机视口首次各约 2.21 MB，再次约 1.2 KB。不包含 Anka 外壳初次加载；这不是公网或真机网络实测。
