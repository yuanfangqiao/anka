"""
FolderScanner —— 扫描应用插件目录，产出「可安装」清单。

扫描 <项目根>/plugins/<name>/plugin.json，校验字段与入口文件存在性。
P1：manifest v2（kind / page / build / permissions）在此做**纯静态校验**，
CLI `verify` 直接复用，不启动内核。

结果由 PluginService 缓存，安装/卸载后失效重建。
"""

import json
import logging
import shlex
from dataclasses import dataclass, field
from pathlib import Path
from .runtime_policy import parse_runtime

log = logging.getLogger('agentos.scanner')

REQUIRED_FIELDS = ('id', 'name', 'version')
KINDS = ('infra', 'app', 'page')

# build.steps[].run 的静态白名单：只允许这些可执行文件作为首 token
BUILD_COMMANDS = ('npm', 'node', 'npx', 'pnpm', 'yarn', 'bun',
                  'python', 'python3', 'pip', 'pip3')
# 禁止 shell 元字符：命令按 shlex.split 后直接 exec，绝不过 shell
SHELL_METACHARS = (';', '&', '|', '$', '`', '>', '<', '\n', '\r')


@dataclass
class FolderManifest:
    id: str
    name: str
    version: str
    icon: str = 'package'
    system: bool = False
    description: str = ''
    backend_entry: str | None = None     # 相对插件目录，如 server/main.py
    ui_entry: str | None = None          # 相对插件目录，如 web/index.js
    page_entry: str | None = None        # page 类静态入口（相对插件目录）
    dock_order: int = 100
    has_sidebar: bool = False
    route: str = ''
    root: Path = field(default_factory=Path)
    errors: list[str] = field(default_factory=list)   # 人读，向后兼容
    codes: list[str] = field(default_factory=list)    # 稳定错误码，与 errors 一一对应
    details: list[dict] = field(default_factory=list)
    kind: str = 'app'                                 # infra | app | page
    manifest_version: int = 1
    build: dict = field(default_factory=dict)
    permissions: list[str] = field(default_factory=list)
    runtime: dict = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return not self.errors

    @property
    def page(self) -> bool:
        """静态页形态：iframe 伺服，无后端、无编译"""
        return self.kind == 'page' or self.page_entry is not None

    def fail(self, code: str, message: str, **detail) -> None:
        self.codes.append(code)
        self.errors.append(message)
        self.details.append({'code': code, 'message': message, **detail})


def check_build_step(run: object) -> str | None:
    """校验一条 build.steps[].run；返回错误信息，合法则 None。"""
    if not isinstance(run, str) or not run.strip():
        return 'build.steps[].run 必须是非空字符串'
    for ch in SHELL_METACHARS:
        if ch in run:
            return f'build.step 含 shell 元字符 {ch!r}，只允许声明式命令: {run}'
    try:
        argv = shlex.split(run)
    except ValueError as e:
        return f'build.step 无法解析: {e}'
    if not argv:
        return 'build.step 为空'
    exe = Path(argv[0]).name
    if exe not in BUILD_COMMANDS:
        return f'build.step 命令不在白名单 {BUILD_COMMANDS}: {exe}'
    return None


def _parse(plugin_json: Path) -> FolderManifest:
    root = plugin_json.parent
    try:
        data = json.loads(plugin_json.read_text(encoding='utf-8'))
        if not isinstance(data, dict):
            raise ValueError('顶层必须是 JSON 对象')
    except Exception as e:
        m = FolderManifest(id=root.name, name='?', version='?', root=root)
        m.fail('E_MANIFEST_PARSE', f'plugin.json 解析失败: {e}')
        return m

    backend = data.get('backend') or {}
    ui = data.get('ui') or {}
    page = data.get('page') or {}
    build = data.get('build') or {}
    if not isinstance(backend, dict) or not isinstance(ui, dict) \
            or not isinstance(page, dict) or not isinstance(build, dict):
        backend, ui, page, build = {}, {}, {}, {}

    m = FolderManifest(
        id=str(data.get('id') or root.name),
        name=str(data.get('name') or root.name),
        version=str(data.get('version') or '?'),
        icon=str(data.get('icon') or 'package'),
        system=bool(data.get('system', False)),
        description=str(data.get('description') or ''),
        backend_entry=backend.get('entry'),
        ui_entry=ui.get('entry'),
        dock_order=int((ui.get('dock') or {}).get('order', 100)),
        has_sidebar=bool(ui.get('sidebar', False)),
        route=ui.get('route') or '',
        root=root,
    )
    m.manifest_version = _int(data.get('manifest_version'), 1)

    # ─── 必填字段 ───
    for f in REQUIRED_FIELDS:
        if f not in data:
            m.fail('E_MANIFEST_FIELD', f'缺少字段 {f}', field=f)

    # ─── kind 判定（§1.1）───
    declared = data.get('kind')
    if declared is not None:
        if declared not in KINDS:
            m.fail('E_MANIFEST_FIELD',
                   f'kind 非法: {declared!r}（允许 {", ".join(KINDS)}）', field='kind')
            declared = None
        elif declared == 'infra':
            m.fail('E_MANIFEST_FIELD',
                   'plugins/ 目录下的插件不能声明 kind=infra（infra 位于 server/app/plugins/）',
                   field='kind')
            declared = None
    if declared:
        m.kind = declared
    elif m.ui_entry or m.backend_entry:
        m.kind = 'app'
    elif page.get('entry') or (build.get('output') or {}).get('entry'):
        m.kind = 'page'
    else:
        m.kind = 'app'
        m.fail('E_MANIFEST_FIELD',
               '无法判定 kind：需要 ui.entry / backend.entry / page.entry 之一',
               field='kind')

    # ─── page 入口：显式 page.entry 或 build.output.entry ───
    output_entry = (build.get('output') or {}).get('entry')
    if page.get('entry'):
        m.page_entry = page.get('entry')
    elif m.kind == 'page' and output_entry:
        m.page_entry = output_entry

    # ─── 路由缺省：page 与自动发现保持同形，避免补 manifest 改变既有深链 ───
    if not m.route:
        m.route = f'/app/{m.id}' if m.kind == 'page' else f'/{m.id}'

    # ─── 类型/互斥校验 ───
    if m.kind == 'page' and (m.backend_entry or m.ui_entry):
        m.fail('E_MANIFEST_FIELD', 'page 类不得声明 backend 或 ui', field='kind')
    m.runtime = parse_runtime(m, data.get('runtime'))
    perms = data.get('permissions', [])
    if perms and (not isinstance(perms, list)
                  or not all(isinstance(p, str) for p in perms)):
        m.fail('E_MANIFEST_FIELD', 'permissions 必须是字符串数组', field='permissions')
    else:
        m.permissions = list(perms)

    if m.id != root.name:
        m.fail('E_ID_MISMATCH', f'id "{m.id}" 与目录名 "{root.name}" 不一致')

    # ─── 入口存在性（容忍 ?v= 缓存参数）───
    if m.backend_entry and not _entry_file(root, m.backend_entry).is_file():
        m.fail('E_ENTRY_MISSING', f'后端入口不存在: {m.backend_entry}',
               entry=m.backend_entry)
    if m.ui_entry and not _entry_file(root, m.ui_entry).is_file():
        m.fail('E_ENTRY_MISSING', f'前端入口不存在: {m.ui_entry}',
               entry=m.ui_entry)
    if m.kind == 'page':
        # 声明了 build 的源码型插件：产物由安装/更新时构建，此刻允许 dist 不存在
        deferred = bool(output_entry and build.get('steps'))
        if not m.page_entry:
            m.fail('E_MANIFEST_FIELD', 'page 类必须声明 page.entry 或 build.output.entry',
                   field='page.entry')
        elif not deferred and not _entry_file(root, m.page_entry).is_file():
            m.fail('E_ENTRY_MISSING', f'页面入口不存在: {m.page_entry}',
                   entry=m.page_entry)

    # ─── build recipe（静态校验，不执行）───
    if build:
        m.build = build
        _check_build(m, build)

    return m


def _entry_file(root: Path, entry: str) -> Path:
    """入口可能是带缓存参数的 URL（web/index.js?v=1），校验时只取路径部分。"""
    return root / entry.split('?', 1)[0].split('#', 1)[0]


def _int(value: object, default: int) -> int:
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default


def _check_build(m: FolderManifest, build: dict) -> None:
    steps = build.get('steps', [])
    if not isinstance(steps, list):
        m.fail('E_BUILD_STEP_INVALID', 'build.steps 必须是数组', field='build.steps')
        return
    for i, step in enumerate(steps):
        run = step.get('run') if isinstance(step, dict) else step
        err = check_build_step(run)
        if err:
            m.fail('E_BUILD_STEP_INVALID', f'build.steps[{i}]: {err}',
                   field=f'build.steps[{i}]')

    cwd = build.get('cwd', '.')
    if not isinstance(cwd, str) or '..' in Path(cwd).parts:
        m.fail('E_MANIFEST_FIELD', 'build.cwd 必须是插件内的相对路径',
               field='build.cwd')

    requires = build.get('requires', [])
    if requires and (not isinstance(requires, list)
                     or not all(isinstance(r, str) for r in requires)):
        m.fail('E_MANIFEST_FIELD', 'build.requires 必须是字符串数组',
               field='build.requires')

    timeout = build.get('timeout', 600)
    if not isinstance(timeout, int) or timeout <= 0:
        m.fail('E_MANIFEST_FIELD', 'build.timeout 必须是正整数',
               field='build.timeout')


# M11：无 plugin.json 时的降级探测入口（按优先级）
PAGE_ENTRIES = ('index.html', 'dist/index.html', 'web/index.html')


def _parse_page_fallback(root: Path) -> FolderManifest | None:
    """任意可伺服的静态页面目录 → page 类 manifest（无后端、iframe 加载）"""
    for entry in PAGE_ENTRIES:
        if (root / entry).is_file():
            folder = root.name
            return FolderManifest(
                id=folder, name=folder, version='0.0.0',
                icon='package',
                description='静态页面应用（自动发现，无 plugin.json）',
                page_entry=entry,
                dock_order=100,
                route=f'/app/{folder}',
                root=root,
                kind='page',
            )
    log.debug('目录 %s 无 plugin.json 且未发现静态入口 %s，忽略',
              root.name, PAGE_ENTRIES)
    return None


def scan(plugins_dir: Path) -> dict[str, FolderManifest]:
    """扫描目录，返回 {id: manifest}；坏插件也返回（带 errors/codes）。
    M11：无 plugin.json 的目录按静态页应用降级探测。"""
    found: dict[str, FolderManifest] = {}
    if not plugins_dir.is_dir():
        log.warning('plugins dir not found: %s', plugins_dir)
        return found
    for child in sorted(plugins_dir.iterdir()):
        pj = child / 'plugin.json'
        if child.is_dir() and pj.is_file():
            m = _parse(pj)
            found[m.id] = m
            if not m.ok:
                log.error('插件 %s 校验失败: %s', m.id, m.errors)
        elif child.is_dir():
            m = _parse_page_fallback(child)
            if m:
                found[m.id] = m
                log.info('发现静态页应用（自动）: %s -> %s', m.id, m.route)
    return found
