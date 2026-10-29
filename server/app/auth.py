"""M18：应用层会话鉴权 —— 固定账号 + HMAC 签名 cookie（零新增依赖，标准库实现）。

设计：
- 账号存 ~/.anka/users.json（同目录 auth_secret 首次自动生成；均 chmod 600）；
  `ANKA_USERS_FILE` 环境变量可覆盖（容器化/自定义部署）
- 会话 token 自包含：`base64url(username).exp.hmac_sha256(secret)`，无服务端存储
- 双层防爆破：
  · 单账号：5 次失败 → 锁 10 分钟
  · 单 IP：100 次失败 → 封 24 小时（阈值/时长可用环境变量覆盖，便于测试）
- CLI（在 server/ 目录下运行）：
  `.venv/bin/python -m app.auth adduser <name> [password]`
  `.venv/bin/python -m app.auth deluser <name>` / `list`

配套：
- `main.py` 的 HTTP 中间件负责 HTTP 路由保护（白名单放行见该文件）
- `api/sync_api.py` 的 WS 握手单独校验（HTTP 中间件不覆盖 WebSocket）
"""

import argparse
import base64
import getpass
import hashlib
import hmac
import json
import logging
import os
import secrets
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel

log = logging.getLogger('agentos.auth')

# ─── 配置 ────────────────────────────────────────────────────────────

#: 账号文件（默认 ~/.anka/users.json；systemd 服务用户须有 home 目录）
USERS_FILE = Path(os.environ.get('ANKA_USERS_FILE')
                  or Path.home() / '.anka' / 'users.json')
SECRET_FILE = USERS_FILE.parent / 'auth_secret'
COOKIE_NAME = 'anka_session'

SESSION_TTL = int(os.environ.get('ANKA_SESSION_TTL') or 30 * 24 * 3600)         # 30 天
ACCOUNT_MAX_FAILS = int(os.environ.get('ANKA_ACCOUNT_MAX_FAILS') or 5)          # 单账号
ACCOUNT_LOCK_SECONDS = int(os.environ.get('ANKA_ACCOUNT_LOCK_SECONDS') or 600)  # 10 分钟
IP_MAX_FAILS = int(os.environ.get('ANKA_IP_MAX_FAILS') or 100)                  # 单 IP
IP_BAN_SECONDS = int(os.environ.get('ANKA_IP_BAN_SECONDS') or 24 * 3600)        # 24 小时

#: 开发调试：DEBUG_DISABLE_AUTH=1 且 AGENTOS_DEV=1 时全局放行
#: （current_user 返回合成用户 'dev'）。AGENTOS_DEV 仅 run_dev.py dev 模式
#: 设置，--prod/systemd 永远免疫——防生产误开。见 DEPLOY.md。
DEBUG_DISABLE_AUTH = (
    os.environ.get('DEBUG_DISABLE_AUTH', '').lower() in ('1', 'true', 'yes')
    and os.environ.get('AGENTOS_DEV', '') == '1'
)

router = APIRouter(prefix='/auth', tags=['auth'])

if DEBUG_DISABLE_AUTH:
    log.warning('DEBUG_DISABLE_AUTH=1 已生效：鉴权全局关闭（合成用户 dev）'
                '——仅限开发调试，严禁生产环境！')


# ─── 密码哈希（pbkdf2_sha256） ────────────────────────────────────────

def hash_password(password: str, salt: str | None = None) -> str:
    """返回 `salt$hash`（salt 16 字节 hex，pbkdf2 200k 迭代）。"""
    salt = salt or secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 200_000)
    return f'{salt}${dk.hex()}'


def verify_password(password: str, stored: str) -> bool:
    try:
        salt = stored.split('$', 1)[0]
    except (AttributeError, IndexError):
        return False
    return hmac.compare_digest(hash_password(password, salt), stored)


# ─── 账号文件 ────────────────────────────────────────────────────────

def load_users() -> dict:
    try:
        return json.loads(USERS_FILE.read_text(encoding='utf-8'))
    except Exception:
        return {}


def save_users(users: dict) -> None:
    USERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    USERS_FILE.write_text(
        json.dumps(users, ensure_ascii=False, indent=2), encoding='utf-8')
    os.chmod(USERS_FILE, 0o600)


_secret_cache: bytes | None = None


def _secret() -> bytes:
    """签名密钥：首次访问自动生成（chmod 600）。"""
    global _secret_cache
    if _secret_cache is None:
        try:
            _secret_cache = SECRET_FILE.read_bytes().strip()
        except Exception:
            SECRET_FILE.parent.mkdir(parents=True, exist_ok=True)
            _secret_cache = secrets.token_hex(32).encode()
            SECRET_FILE.write_bytes(_secret_cache)
            os.chmod(SECRET_FILE, 0o600)
            log.info('已生成会话签名密钥 %s', SECRET_FILE)
    return _secret_cache


# ─── 会话签发与校验 ──────────────────────────────────────────────────

def create_session(username: str) -> str:
    exp = int(time.time()) + SESSION_TTL
    user_b64 = base64.urlsafe_b64encode(username.encode()).decode().rstrip('=')
    payload = f'{user_b64}.{exp}'
    sig = hmac.new(_secret(), payload.encode(), hashlib.sha256).hexdigest()
    return f'{payload}.{sig}'


def verify_session(token: str | None) -> str | None:
    """校验签名与过期时间，返回用户名或 None。"""
    if not token:
        return None
    parts = token.split('.')
    if len(parts) != 3:
        return None
    user_b64, exp, sig = parts
    expect = hmac.new(_secret(), f'{user_b64}.{exp}'.encode(),
                      hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expect):
        return None
    try:
        if int(exp) < time.time():
            return None
        pad = '=' * (-len(user_b64) % 4)
        return base64.urlsafe_b64decode(user_b64 + pad).decode()
    except Exception:
        return None


def client_ip(request) -> str:
    """取客户端 IP：优先 x-forwarded-for 首项（Caddy 反代），回退直连地址。"""
    fwd = request.headers.get('x-forwarded-for')
    if fwd:
        return fwd.split(',')[0].strip()
    return getattr(getattr(request, 'client', None), 'host', '') or 'unknown'


def current_user(request) -> str | None:
    """HTTP Request 与 WebSocket 通用：从 cookies 取会话校验。"""
    if DEBUG_DISABLE_AUTH:
        return 'dev'
    return verify_session(request.cookies.get(COOKIE_NAME))


# ─── 防爆破（进程内存；重启清零，个人部署够用） ──────────────────────

_account_fails: dict[str, list[float]] = {}
_ip_fails: dict[str, list[float]] = {}


def _prune(store: dict[str, list[float]], window: int) -> None:
    now = time.time()
    for key in list(store):
        kept = [t for t in store[key] if now - t < window]
        if kept:
            store[key] = kept
        else:
            del store[key]


def _account_locked(username: str) -> bool:
    _prune(_account_fails, ACCOUNT_LOCK_SECONDS)
    return len(_account_fails.get(username, [])) >= ACCOUNT_MAX_FAILS


def _ip_banned(ip: str) -> bool:
    """IP 累计失败 ≥ IP_MAX_FAILS 且都在窗口内 → 封禁中。"""
    _prune(_ip_fails, IP_BAN_SECONDS)
    fails = _ip_fails.get(ip, [])
    if len(fails) < IP_MAX_FAILS:
        return False
    # 距最早一次失败不足封禁时长则仍在封禁期
    return (time.time() - fails[0]) < IP_BAN_SECONDS


def _record_failure(username: str, ip: str) -> int:
    now = time.time()
    _account_fails.setdefault(username, []).append(now)
    _ip_fails.setdefault(ip, []).append(now)
    return len(_ip_fails[ip])


def _reset_after_success(username: str, ip: str) -> None:
    _account_fails.pop(username, None)
    _ip_fails.pop(ip, None)


# ─── 路由 ────────────────────────────────────────────────────────────

class LoginBody(BaseModel):
    username: str
    password: str


@router.post('/login')
async def login(body: LoginBody, request: Request, response: Response) -> dict:
    ip = client_ip(request)

    # ① IP 级封禁（100 次失败 → 24 小时）
    if _ip_banned(ip):
        raise HTTPException(
            status_code=429,
            detail={'error': 'ip_banned',
                    'message': '该 IP 失败次数过多，已封禁 24 小时'})

    # ② 账号级锁定（5 次失败 → 10 分钟）
    if _account_locked(body.username):
        raise HTTPException(
            status_code=429,
            detail={'error': 'account_locked',
                    'message': '尝试次数过多，请 10 分钟后再试'})

    rec = load_users().get(body.username)
    if rec and verify_password(body.password, rec.get('password', '')):
        _reset_after_success(body.username, ip)
        scheme = request.headers.get('x-forwarded-proto') or request.url.scheme
        response.set_cookie(
            COOKIE_NAME, create_session(body.username),
            max_age=SESSION_TTL, httponly=True, samesite='lax',
            secure=(scheme == 'https'),
        )
        log.info('登录成功 user=%s ip=%s', body.username, ip)
        return {'username': body.username}

    fails = _record_failure(body.username, ip)
    log.warning('登录失败 user=%s ip=%s ip_fails=%d/%d',
                body.username, ip, fails, IP_MAX_FAILS)
    raise HTTPException(
        status_code=401,
        detail={'error': 'bad_credentials', 'message': '用户名或密码错误'})


@router.post('/logout')
async def logout(request: Request, response: Response) -> dict:
    from . import deps
    from .devices.service import digest
    devices = deps.manager.ctx.get('devices')
    token = request.cookies.get(COOKIE_NAME, '')
    if devices and token:
        devices.logout(digest('user:' + token))
    response.delete_cookie(COOKIE_NAME)
    return {'ok': True}


@router.get('/me')
async def me(request: Request) -> dict:
    """登录态探测：始终 200，username=null 表示未登录
    （避免前端探测产生 401 控制台噪音——浏览器对 401 响应必定记一条资源错误）。"""
    return {'username': current_user(request)}


# ─── 登录页（后端直出静态 HTML） ──────────────────────────────────────
#
# 刻意不放进 SPA：登录过程与前端路由/懒加载模块状态解耦，登录成功后
# location.replace() 整页进入应用（bootstrap 带 cookie 重跑，完成全部初始化）。

page_router = APIRouter(tags=['auth'])

_LOGIN_PAGE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<meta name="theme-color" content="#0B0E14" />
<title>登录 · Anka</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    min-height:100dvh; display:flex; align-items:center; justify-content:center;
    background:#0B0E14; color:#F3F4F6; padding:24px;
    font-family:"PingFang SC",-apple-system,"Helvetica Neue",sans-serif; font-size:14px;
    -webkit-font-smoothing:antialiased; overflow:hidden;
    /* M20：禁用双击缩放（iOS PWA 双击放大问题），保留滚动/双指缩放 */
    touch-action: manipulation;
  }
  .glow { position:fixed; border-radius:50%; filter:blur(120px); pointer-events:none; }
  .g1 { top:-120px; left:-96px; width:384px; height:384px; background:rgba(99,102,241,.22); }
  .g2 { bottom:-160px; right:-64px; width:448px; height:448px; background:rgba(34,211,238,.12); filter:blur(140px); }
  .wrap { position:relative; width:100%; max-width:23rem; animation:in .28s ease-out; }
  @keyframes in { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:none; } }
  .brand { display:flex; flex-direction:column; align-items:center; }
  .logo {
    width:80px; height:80px; border-radius:28px; display:block; object-fit:cover;
    box-shadow:0 8px 32px rgba(99,102,241,.45);
  }
  h1 { margin-top:20px; font-size:24px; font-weight:700; letter-spacing:-.02em; }
  .sub { margin-top:4px; font-size:14px; color:#9CA3AF; }
  form {
    margin-top:32px; padding:20px; border-radius:16px; border:1px solid rgba(255,255,255,.09);
    background:rgba(255,255,255,.05); backdrop-filter:blur(12px);
  }
  label {
    display:flex; align-items:center; gap:12px; padding:0 14px; border-radius:12px;
    border:1px solid rgba(255,255,255,.09); background:#0B0E14; transition:border-color .2s;
  }
  label:focus-within { border-color:rgba(99,102,241,.55); }
  label + label { margin-top:12px; }
  svg { width:16px; height:16px; flex-shrink:0; color:#9CA3AF; }
  input {
    width:100%; height:48px; border:0; outline:0; background:transparent;
    color:#F3F4F6; font-size:14px; font-family:inherit;
  }
  input::placeholder { color:#9CA3AF; }
  .err { margin-top:12px; text-align:center; font-size:12px; line-height:1.6; color:#EF4444; }
  button {
    margin-top:16px; width:100%; height:48px; border:0; border-radius:12px; cursor:pointer;
    background:linear-gradient(90deg,#6366F1,#22D3EE); color:#fff;
    font-size:14px; font-weight:500; font-family:inherit;
    box-shadow:0 6px 20px rgba(99,102,241,.35); transition:filter .15s, transform .1s;
  }
  button:hover { filter:brightness(1.1); }
  button:active { transform:scale(.98); }
  button:disabled { opacity:.5; cursor:not-allowed; }
  .foot { margin-top:20px; text-align:center; font-size:11px; color:#9CA3AF; }
</style>
</head>
<body>
  <div class="glow g1"></div><div class="glow g2"></div>
  <div class="wrap">
    <div class="brand">
      <img class="logo" src="/icons/icon-192.png" alt="Anka" />
      <h1>Anka</h1>
      <p class="sub"></p>
    </div>
    <form id="f" autocomplete="on">
      <label>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        <input id="u" name="username" type="text" placeholder="用户名" autocomplete="username" required />
      </label>
      <label>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        <input id="p" name="password" type="password" placeholder="密码" autocomplete="current-password" required />
      </label>
      <p class="err" id="e"></p>
      <button id="b" type="submit">登录</button>
    </form>
    <p class="foot"></p>
  </div>
<script>
  // M18.1：只接受站内绝对路径。拒绝 //evil.com（开放重定向）与指回登录页的脏值
  // （死循环时代 redirect 会被嵌套成 /login?redirect=%2Flogin…，逐层解开又回登录页）
  function safeRedirect(raw) {
    if (!raw || raw.charAt(0) !== '/' || raw.charAt(1) === '/') return '/'
    if (raw === '/login' || raw.indexOf('/login?') === 0
        || raw.indexOf('/login/') === 0 || raw.indexOf('/login#') === 0) return '/'
    return raw
  }
  var rawRedirect = new URLSearchParams(location.search).get('redirect')
  var target = safeRedirect(rawRedirect)
  // 地址栏当场清洗：避免把死循环 URL 复制/分享出去
  if (rawRedirect !== null && rawRedirect !== target) {
    history.replaceState(null, '', '/login?redirect=' + encodeURIComponent(target))
  }
  var form = document.getElementById('f')
  form.addEventListener('submit', async function (ev) {
    ev.preventDefault()
    var btn = document.getElementById('b')
    var err = document.getElementById('e')
    err.textContent = ''
    btn.disabled = true
    btn.textContent = '登录中…'
    try {
      var res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: document.getElementById('u').value.trim(),
          password: document.getElementById('p').value
        })
      })
      if (res.ok) {
        location.replace(target)
        return
      }
      var body = await res.json().catch(function () { return null })
      err.textContent = (body && body.detail && body.detail.message) || '登录失败，请重试'
    } catch (x) {
      err.textContent = '无法连接服务，请稍后再试'
    }
    btn.disabled = false
    btn.textContent = '登录'
  })
</script>
</body>
</html>"""


def _safe_redirect(raw: str | None) -> str:
    """登录后回跳目标：只接受站内绝对路径。

    拒绝两类脏值：
    - `//evil.com`：协议相对 URL，不拦会变成开放重定向
    - `/login…`：指回登录页自身 —— 上游一旦把自己的 URL 当 redirect 传进来，
      就会形成 `/login?redirect=%2Flogin…` 逐层嵌套的死循环（M18.1 修复）
    """
    if not raw or not raw.startswith('/') or raw.startswith('//'):
        return '/'
    if raw == '/login' or raw.startswith(('/login?', '/login/', '/login#')):
        return '/'
    return raw


@page_router.get('/login', include_in_schema=False)
async def login_page(request: Request) -> Response:
    """登录页：后端直出（不经过 SPA，避免前端路由/模块状态竞态）。

    已登录再访问（含 redirect 是历史脏值的情况）→ 直接 302 回应用，
    避免「登录成功了却仍停在登录页」。
    """
    if current_user(request) is not None:
        return RedirectResponse(
            _safe_redirect(request.query_params.get('redirect')),
            status_code=302)
    return HTMLResponse(_LOGIN_PAGE, headers={'Cache-Control': 'no-store'})


# ─── CLI：python -m app.auth adduser <name> [password] ───────────────

def _cli() -> None:
    parser = argparse.ArgumentParser(
        prog='python -m app.auth',
        description=f'账号管理（存储于 {USERS_FILE}）')
    sub = parser.add_subparsers(dest='cmd', required=True)

    p_add = sub.add_parser('adduser', help='新增/覆盖账号')
    p_add.add_argument('name')
    p_add.add_argument('password', nargs='?', help='缺省则交互输入（不回显）')

    p_del = sub.add_parser('deluser', help='删除账号')
    p_del.add_argument('name')

    sub.add_parser('list', help='列出账号')

    args = parser.parse_args()
    users = load_users()

    if args.cmd == 'adduser':
        password = args.password or getpass.getpass(f'为 {args.name} 设置密码: ')
        if not password:
            print('✗ 密码不能为空')
            return
        users[args.name] = {'password': hash_password(password)}
        save_users(users)
        print(f'✓ 已写入账号 {args.name} → {USERS_FILE}')
    elif args.cmd == 'deluser':
        if users.pop(args.name, None) is None:
            print(f'✗ 账号 {args.name} 不存在')
            return
        save_users(users)
        print(f'✓ 已删除账号 {args.name}')
    else:
        print('\n'.join(users) if users else '（无账号）')


if __name__ == '__main__':
    _cli()
