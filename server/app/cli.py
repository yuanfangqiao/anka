"""插件 CLI —— 离线体检 / 校验 / 打包。

    cd server
    python -m app.cli doctor [--all] [--json]
    python -m app.cli verify <id> [--json]
    python -m app.cli pack <id> [--out DIR] [--json]

退出码：0 通过 / 1 发现问题 / 2 用法或环境错误。
全部命令离线执行：不启动 HTTP 服务、不加载 cordis 内核。
`doctor` 会像服务端启动一样做一次幂等的 installed.json → ledger 迁移。
"""

import argparse
import hashlib
import json
import subprocess
import sys
import tarfile
from pathlib import Path

_SERVER_DIR = Path(__file__).resolve().parents[1]
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))

from app import folder_scanner, settings  # noqa: E402
from app.plugin_service import PluginService  # noqa: E402

EXCLUDE_DIRS = {'node_modules', '.git', '__pycache__', '.plugin-backup'}
EXCLUDE_FILES = {'.DS_Store'}
IMPORT_TIMEOUT = 30


# ─── 输出 ──────────────────────────────────

class Out:
    def __init__(self, as_json: bool) -> None:
        self.as_json = as_json

    def emit(self, payload: dict, text: str) -> None:
        if self.as_json:
            print(json.dumps(payload, ensure_ascii=False, indent=2))
        elif text:
            print(text)

    def err(self, message: str) -> None:
        print(message, file=sys.stderr)


# ─── doctor ──────────────────────────────────

def _offline_service() -> PluginService:
    """CLI 专用：不注入内核回调，只用扫描 + ledger 投影。"""
    def _no_load(_name, _manifest):
        raise RuntimeError('doctor 不应加载插件')

    def _no_uninstall(name):
        raise RuntimeError('doctor 不应卸载插件')

    return PluginService(
        on_load=_no_load,
        on_uninstall=_no_uninstall,
        state_probe=lambda _name: None,
        was_loaded=lambda _name: False,
    )


def cmd_doctor(args) -> int:
    out = Out(args.json)
    service = _offline_service()
    fixed = service.reconcile() if args.fix else []
    rows = service.health_report(refresh=True)
    problems = service.ledger_problems()
    issues = [r for r in rows if r['issues']]
    shown = rows if args.all else issues

    if out.as_json:
        out.emit({'ok': not issues and not problems, 'command': 'doctor',
                  'total': len(rows), 'issues': len(issues),
                  'fixed': fixed, 'ledger_problems': problems,
                  'plugins': shown}, '')
    else:
        if fixed:
            print(f'已清理 {len(fixed)} 条幽灵记录: {", ".join(fixed)}')
            print('（ledger 追加 uninstalled 事件，审计可追溯）\n')
        for r in shown:
            state = r['ledger_state'] or 'available'
            head = f"{r['id']:<24} {r['kind']:<5} {state:<10} {r['version']}"
            if r['issues']:
                print(f'{head}  ✗')
                for issue in r['issues']:
                    print(f'    - {issue}')
                if r['codes']:
                    print(f'    codes: {", ".join(r["codes"])}')
            else:
                print(f'{head}  ✓')
        for p in problems:
            print(f'ledger: {p}')
        print(f'\n{len(rows)} 个插件，{len(issues)} 个问题')
        if not args.fix and any('目录缺失' in i for r in issues for i in r['issues']):
            print('提示：加 --fix 可清理「ledger 已安装但目录缺失」的幽灵记录')

    return 1 if issues or problems else 0


# ─── verify ──────────────────────────────────

def _import_smoke(manifest: folder_scanner.FolderManifest) -> str | None:
    """子进程 import 后端入口，返回错误信息；成功返回 None。"""
    entry = (manifest.root / manifest.backend_entry).resolve()
    code = (
        'import importlib.util, sys\n'
        'p = sys.argv[1]\n'
        "spec = importlib.util.spec_from_file_location('anka_verify', p)\n"
        'm = importlib.util.module_from_spec(spec)\n'
        "sys.modules['anka_verify'] = m\n"
        'spec.loader.exec_module(m)\n'
        'from app.cordis.registry import extract_plugin_meta\n'
        'meta = extract_plugin_meta(m)\n'
        "assert meta is not None, '未导出 apply 或 Service 子类'\n"
        'print(meta.name)\n'
    )
    try:
        r = subprocess.run([sys.executable, '-c', code, str(entry)],
                           cwd=str(_SERVER_DIR), capture_output=True,
                           text=True, timeout=IMPORT_TIMEOUT)
    except subprocess.TimeoutExpired:
        return f'后端 import 超时（>{IMPORT_TIMEOUT}s）'
    except Exception as e:
        return f'后端 import 无法执行: {e}'
    if r.returncode != 0:
        tail = (r.stderr or r.stdout).strip().splitlines()
        return f'后端 import 失败: {tail[-1] if tail else r.returncode}'
    name = (r.stdout or '').strip().splitlines()[-1] if r.stdout.strip() else ''
    if name and name != manifest.id:
        return f'模块 name "{name}" 与插件 id "{manifest.id}" 不一致'
    return None


def _verify(plugin_id: str) -> tuple[dict, list[str], dict | None]:
    manifests = folder_scanner.scan(settings.APP_PLUGINS_DIR)
    manifest = manifests.get(plugin_id)
    if manifest is None:
        return ({'ok': False, 'id': plugin_id, 'code': 'E_NOT_FOUND',
                 'errors': [f'plugins/ 下未发现插件 "{plugin_id}"'],
                 'codes': ['E_NOT_FOUND']}, ['插件未发现'], None)

    issues = list(manifest.errors)
    codes = list(manifest.codes)
    if manifest.ok and manifest.backend_entry:
        err = _import_smoke(manifest)
        if err:
            issues.append(err)
            codes.append('E_LOAD_FAILED')

    payload = {
        'ok': not issues,
        'id': manifest.id,
        'kind': manifest.kind,
        'version': manifest.version,
        'manifest_version': manifest.manifest_version,
        'root': str(manifest.root),
        'backend': manifest.backend_entry,
        'ui': manifest.ui_entry,
        'page': manifest.page_entry,
        'build_steps': [s.get('run') for s in manifest.build.get('steps', [])
                        if isinstance(s, dict)],
        'permissions': manifest.permissions,
        'errors': issues,
        'codes': codes,
    }
    return payload, issues, {'manifest': manifest}


def cmd_verify(args) -> int:
    out = Out(args.json)
    payload, issues, _ = _verify(args.id)
    if out.as_json:
        out.emit(payload, '')
    else:
        status = 'OK' if payload['ok'] else 'FAIL'
        print(f"[{status}] {payload['id']} ({payload.get('kind', '?')}) "
              f"v{payload.get('version', '?')}")
        if payload.get('root'):
            print(f"  root: {payload['root']}")
        for entry in ('backend', 'ui', 'page'):
            if payload.get(entry):
                print(f"  {entry}: {payload[entry]}")
        for code, err in zip(payload['codes'], payload['errors']):
            print(f'  - {code}: {err}')
    return 0 if not issues else 1


# ─── pack ──────────────────────────────────

def _tar_filter(info: tarfile.TarInfo) -> tarfile.TarInfo | None:
    parts = Path(info.name).parts
    if any(p in EXCLUDE_DIRS for p in parts):
        return None
    if Path(info.name).name in EXCLUDE_FILES:
        return None
    if info.name.endswith(('.pyc', '.pyo')):
        return None
    return info


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def cmd_pack(args) -> int:
    out = Out(args.json)
    payload, issues, ctx = _verify(args.id)
    if issues:
        if out.as_json:
            out.emit({**payload, 'command': 'pack', 'packed': False}, '')
        else:
            out.err(f'打包中止：verify 未通过（{len(issues)} 个问题）')
            for code, err in zip(payload['codes'], payload['errors']):
                out.err(f'  - {code}: {err}')
        return 1

    manifest = ctx['manifest']
    out_dir = Path(args.out) if args.out else settings.PACKAGE_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    name = f'{manifest.id}-{manifest.version}'
    archive = out_dir / f'{name}.anka'

    with tarfile.open(archive, 'w:gz') as tar:
        tar.add(manifest.root, arcname=manifest.id, filter=_tar_filter)

    digest = _sha256(archive)
    payload.update({'command': 'pack', 'packed': True,
                    'archive': str(archive), 'sha256': digest,
                    'size': archive.stat().st_size})
    if out.as_json:
        out.emit(payload, '')
    else:
        print(f'已打包: {archive}')
        print(f'sha256: {digest}')
        print(f'size:   {archive.stat().st_size} bytes')
    return 0


# ─── 入口 ──────────────────────────────────

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog='python -m app.cli',
                                description='Anka 插件离线工具')
    sub = p.add_subparsers(dest='command')

    d = sub.add_parser('doctor', help='体检：扫描与 ledger 交叉校验')
    d.add_argument('--all', action='store_true', help='列出全部插件（默认只列问题）')
    d.add_argument('--fix', action='store_true',
                   help='清理「ledger 已安装但目录缺失」的幽灵记录')
    d.add_argument('--json', action='store_true', help=argparse.SUPPRESS)
    d.set_defaults(func=cmd_doctor)

    v = sub.add_parser('verify', help='校验单个插件 manifest 与后端入口')
    v.add_argument('id')
    v.add_argument('--json', action='store_true', help=argparse.SUPPRESS)
    v.set_defaults(func=cmd_verify)

    k = sub.add_parser('pack', help='verify 后打包为 .anka 并输出 sha256')
    k.add_argument('id')
    k.add_argument('--out', default=None, help='输出目录（默认 dist-packages/）')
    k.add_argument('--json', action='store_true', help=argparse.SUPPRESS)
    k.set_defaults(func=cmd_pack)
    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not getattr(args, 'command', None):
        parser.print_help()
        return 2
    return int(args.func(args))


if __name__ == '__main__':
    raise SystemExit(main())
