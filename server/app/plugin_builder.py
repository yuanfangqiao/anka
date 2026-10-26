"""
PluginBuilder —— 应用插件前端的「安装时编译」（M9）。

调用 web/scripts/build-plugin.mjs（vite 程序化构建，内部 esbuild）：
插件 web/ 内 .vue/.ts/.js → 单文件 ESM，缓存到 <根>/.plugin-dist/<id>/index.js，
由 FastAPI 挂载为 /plugin-dist 伺服。'vue' 保持 external，
经宿主 import map 解析到共享实例（防双 Vue）。

同一脚本还产出 <id>/index.css：插件自带样式（SFC/style + 按插件源码生成的工具类），
URL 经 /api/apps 的 style 字段下发，前端 pluginHost 在加载插件前注入。

开发态（run_dev.py 非 --prod → AGENTOS_DEV=1）不构建：
插件源码由 vite 中间件按需编译并直接伺服。
"""

import hashlib
import logging
import os
import re
import shlex
import subprocess
import threading
from time import perf_counter

from . import settings
from .folder_scanner import check_build_step

log = logging.getLogger('agentos.plugin_builder')

_HASH_FILE = '.src-hash'


def _run_build(argv, *, cwd, timeout, label):
    """Keep long npm/build steps visible while preserving subprocess timeouts."""
    started = perf_counter()
    finished = threading.Event()

    def report():
        while not finished.wait(5):
            log.info('[build] %s 仍在运行，耗时=%.1fs（超时=%ss）',
                     label, perf_counter() - started, timeout)

    reporter = threading.Thread(target=report, daemon=True)
    log.info('[build] 开始 %s，cwd=%s，超时=%ss', label, cwd, timeout)
    reporter.start()
    result = None
    try:
        result = subprocess.run(argv, cwd=cwd, capture_output=True,
                                text=True, timeout=timeout)
        return result
    finally:
        finished.set()
        reporter.join()
        log.info('[build] 结束 %s，耗时=%.3fs，exit=%s', label,
                 perf_counter() - started,
                 result.returncode if result is not None else '异常/超时')


def has_dist(app_id: str) -> bool:
    return (settings.PLUGIN_DIST_DIR / app_id / 'index.js').is_file()


def css_url(app_id: str) -> str:
    """插件自带样式 index.css 的 URL（缺产物返回 ''）。

    带 mtime 版本号：SW 对 /plugin-dist/ 走 NetworkFirst 且按 URL 命中缓存，
    重新构建后 URL 变化才能立刻拿到新样式，而不是等 5 分钟过期。
    """
    p = settings.PLUGIN_DIST_DIR / app_id / 'index.css'
    if not p.is_file():
        return ''
    return f'/plugin-dist/{app_id}/index.css?v={int(p.stat().st_mtime)}'


def _src_hash(app_id: str) -> str:
    """插件 web/ 源码内容指纹（sha1）：git pull 引入任何源码变化都会改变它。"""
    d = settings.APP_PLUGINS_DIR / app_id / 'web'
    h = hashlib.sha1()
    if not d.is_dir():
        return ''
    for root, dirs, files in os.walk(d):
        dirs.sort()
        for name in sorted(files):
            p = os.path.join(root, name)
            h.update(os.path.relpath(p, d).encode())
            try:
                with open(p, 'rb') as f:
                    h.update(f.read())
            except OSError:
                pass
    return h.hexdigest()


def is_stale(app_id: str) -> bool:
    """dist 缺失、指纹缺失或指纹已变化（git pull 后）→ 需要重建。
    此前 has_dist 只看文件存在：git pull 后旧产物永久续命，
    是「部署端插件一直是旧版 UI」的根因。"""
    dist = settings.PLUGIN_DIST_DIR / app_id
    if not (dist / 'index.js').is_file():
        return True
    try:
        saved = (dist / _HASH_FILE).read_text().strip()
    except OSError:
        return True
    return saved != _src_hash(app_id)


def build_web(app_id: str) -> bool:
    script = settings.WEB_DIR / 'scripts' / 'build-plugin.mjs'
    if not script.is_file():
        log.warning('构建脚本不存在，跳过 %s 前端构建: %s', app_id, script)
        return False
    try:
        r = _run_build(
            ['node', str(script), app_id],
            cwd=settings.WEB_DIR, timeout=180, label=f'{app_id} 原生入口')
    except Exception as e:
        log.error('插件 %s 前端构建失败: %s', app_id, e)
        return False
    if r.returncode != 0:
        log.error('插件 %s 前端构建失败:\n%s', app_id, (r.stderr or r.stdout)[-2000:])
        return False
    # 构建成功后写入源码指纹，供下次启动比对（emptyOutDir 会清掉旧指纹）
    try:
        (settings.PLUGIN_DIST_DIR / app_id / _HASH_FILE).write_text(_src_hash(app_id))
    except OSError:
        pass
    log.info('插件 %s 前端已构建: %s', app_id,
             settings.PLUGIN_DIST_DIR / app_id / 'index.js')
    return True


# ─── build recipe（page 类源码构建）─────────────────────
#
# 与 build_web 的分工：build_web 只处理 app 类 web/ 源码（esbuild 单文件）；
# 本节的 build_recipe 执行 manifest.build.steps（npm ci / vite build …），
# 产物落在插件目录内（如 dist/），由 /plugins 挂载直接伺服。
# 产物不入库：插件仓库 .gitignore 忽略 dist，宿主在安装/更新时现场构建。

_REQ_RE = re.compile(r'^(?P<exe>[\w.-]+)\s*>=\s*(?P<version>\d+(?:\.\d+){0,2})$')


def _check_requires(requires: list[str]) -> str | None:
    """校验 build.requires（形如 node>=18）；返回错误信息，满足则 None。"""
    for req in requires:
        m = _REQ_RE.match(str(req).strip())
        if not m:
            return f'build.requires 无法解析: {req}（形如 node>=18）'
        exe = m.group('exe')
        need = tuple(int(part) for part in m.group('version').split('.'))
        need = need + (0,) * (3 - len(need))
        try:
            r = subprocess.run([exe, '--version'], capture_output=True,
                               text=True, timeout=10)
        except (OSError, subprocess.SubprocessError):
            return f'缺少构建依赖: {req}'
        out = f'{r.stdout or ""}{r.stderr or ""}'
        found = re.search(r'(\d+)\.(\d+)(?:\.(\d+))?', out)
        have_version = tuple(int(part or 0) for part in found.groups()) if found else ()
        if not found or have_version < need:
            have = out.strip().splitlines()[0] if out.strip() else '未知版本'
            return f'构建依赖版本不满足 {req}（当前 {have}）'
    return None


def build_recipe(app_id: str, manifest) -> tuple[bool, str]:
    """按 manifest.build 现场构建（不使用 shell，逐步超时）。

    返回 (ok, 人读消息)；失败时消息含出错步骤与日志尾，供 API/CLI 透出。
    """
    build = getattr(manifest, 'build', None) or {}
    steps = build.get('steps') or []
    if not steps:
        return False, '未声明 build.steps'

    started = perf_counter()
    log.info('[build] 插件 %s 检查构建依赖：%s', app_id, build.get('requires') or [])
    missing = _check_requires(list(build.get('requires') or []))
    log.info('[build] 插件 %s 构建依赖检查耗时=%.3fs，结果=%s',
             app_id, perf_counter() - started, missing or '通过')
    if missing:
        return False, missing

    root = (settings.APP_PLUGINS_DIR / app_id).resolve()
    cwd = (root / str(build.get('cwd') or '.')).resolve()
    try:
        cwd.relative_to(root)
    except ValueError:
        return False, f'build.cwd 逃出插件目录: {cwd}'

    timeout = int(build.get('timeout') or 600)
    for i, step in enumerate(steps):
        run = step.get('run') if isinstance(step, dict) else step
        err = check_build_step(run)
        if err:
            return False, f'build.steps[{i}]: {err}'
        argv = shlex.split(str(run))
        log.info('插件 %s 构建 [%d/%d]: %s', app_id, i + 1, len(steps), run)
        try:
            r = _run_build(argv, cwd=cwd, timeout=timeout,
                           label=f'{app_id} 步骤 {i + 1}/{len(steps)}: {run}')
        except subprocess.TimeoutExpired:
            log.error('[build] 插件 %s 步骤 %d/%d 超时（%ss）',
                      app_id, i + 1, len(steps), timeout)
            return False, f'build.steps[{i}] 超时（{timeout}s）: {run}'
        except OSError as e:
            return False, f'build.steps[{i}] 无法执行: {e}'
        if r.returncode != 0:
            tail = ((r.stderr or r.stdout or '').strip().splitlines() or [''])[-1]
            log.error('插件 %s 构建失败 [%d/%d] exit=%s\n%s', app_id, i + 1,
                      len(steps), r.returncode, (r.stderr or r.stdout or '')[-2000:])
            return False, f'build.steps[{i}] 失败（exit {r.returncode}）: {run}；{tail}'[:500]

    entry = (build.get('output') or {}).get('entry')
    if entry and not (root / entry).is_file():
        return False, f'构建完成但产物缺失: {entry}'
    log.info('插件 %s 构建完成: %s，总耗时=%.3fs',
             app_id, entry or 'ok', perf_counter() - started)
    return True, f'构建完成: {entry}' if entry else '构建完成'
