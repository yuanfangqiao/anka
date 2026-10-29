"""Pinned firmware dependencies and an optional project-local ESP-IDF toolchain."""
import argparse
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import shutil
import configparser
import time
from urllib.request import urlopen
from urllib.parse import urljoin
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PINS = json.loads((ROOT / 'dependencies.json').read_text())
SSH_HOST = os.environ.get('ANKA_GITHUB_HOST', '')


def archive(repo, revision, destination):
    marker = destination / '.anka-revision'
    if marker.is_file() and marker.read_text().strip() == revision:
        return
    if destination.exists() and any(destination.iterdir()):
        raise SystemExit(f'Refusing to replace unverified dependency: {destination}')
    # Reuse this task's already-verified research checkout at bootstrap time only.
    local = ROOT.parents[1] / 'doc/mosaico/upstream/esp-mosaico-vibe/submodule' / repo.rsplit('/', 1)[-1]
    if local.is_dir() and repo.startswith('esp-mosaico/'):
        try:
            actual = subprocess.check_output(['git', '-C', str(local), 'rev-parse', 'HEAD'], text=True).strip()
            if actual == revision:
                shutil.copytree(local, destination, ignore=shutil.ignore_patterns('.git'), dirs_exist_ok=True)
                marker.write_text(revision + '\n')
                print(f'Reused verified local {repo}', flush=True)
                return
        except subprocess.CalledProcessError:
            pass
    print(f'Downloading {repo} at {revision}', flush=True)
    for attempt in range(4):
        try:
            with urlopen(f'https://codeload.github.com/{repo}/zip/{revision}', timeout=60) as response:
                data = response.read()
            break
        except Exception:
            if attempt == 3:
                raise
            print(f'Retrying {repo} ({attempt+2}/4)', flush=True)
            time.sleep(min(5, attempt+1))
    destination.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(data)) as source:
        for entry in source.infolist():
            parts = Path(entry.filename).parts[1:]
            if not parts or entry.is_dir():
                continue
            target = destination.joinpath(*parts)
            if not target.resolve().is_relative_to(destination.resolve()):
                raise SystemExit('Invalid archive path')
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source.read(entry))
    marker.write_text(revision + '\n')


def run(args, **kwargs):
    subprocess.run(args, check=True, **kwargs)


def main():
    parser = argparse.ArgumentParser()
    global SSH_HOST
    parser.add_argument('--github-host', default=SSH_HOST, help='optional SSH alias, e.g. github_vitcou')
    parser.add_argument('--idf', action='store_true')
    parser.add_argument('--tools', action='store_true')
    parser.add_argument('--archive-submodules', action='store_true')
    args = parser.parse_args()
    SSH_HOST = args.github_host
    archive('esp-mosaico/esp-mosaico-bsp', PINS['esp-mosaico-bsp'], ROOT / '.deps/bsp')
    archive('esp-mosaico/esp-mosaico-utils', PINS['esp-mosaico-utils'], ROOT / '.deps/utils')
    archive('dlbeer/quirc', PINS['quirc'], ROOT / '.deps/quirc')
    if args.idf or args.tools:
        sdk = ROOT / '.sdk/esp-idf'
        sdk.mkdir(parents=True, exist_ok=True)
        if not (sdk / '.git').exists():
            run(['git', 'init', str(sdk)])
            run(['git', '-C', str(sdk), 'remote', 'add', 'origin', 'https://github.com/espressif/esp-idf.git'])
        if SSH_HOST:
            run(['git', '-C', str(sdk), 'config', f'url.git@{SSH_HOST}:.insteadOf', 'https://github.com/'])
        current = subprocess.check_output(['git', '-C', str(sdk), 'rev-parse', '--verify', 'HEAD'],
                                          text=True, stderr=subprocess.DEVNULL).strip() if (sdk / 'tools/idf.py').exists() else ''
        if current != PINS['esp-idf']:
            run(['git', '-C', str(sdk), 'fetch', '--depth', '1', 'origin', PINS['esp-idf']])
            run(['git', '-C', str(sdk), 'checkout', '--detach', 'FETCH_HEAD'])
        # Controller uses Wi-Fi, TLS and display, not Bluetooth/Thread. Avoid
        # fetching unrelated radio stacks and their large binary repositories.
        required = ['components/bootloader/subproject/components/micro-ecc/micro-ecc',
                    'components/esp_coex/lib', 'components/esp_phy/lib',
                    'components/esp_wifi/lib', 'components/heap/tlsf',
                    'components/lwip/lwip', 'components/mbedtls/mbedtls',
                    'components/unity/unity']
        if args.archive_submodules:
            modules = configparser.ConfigParser()
            modules.read(sdk / '.gitmodules')
            for section in modules.sections():
                relative = modules[section]['path']
                if relative not in required:
                    continue
                revision = subprocess.check_output(['git', '-C', str(sdk), 'ls-tree', 'HEAD', relative], text=True).split()[2]
                repository = urljoin('https://github.com/espressif/esp-idf/', modules[section]['url'])
                repository = repository.removeprefix('https://github.com/').removesuffix('.git')
                cached = ROOT / '.sdk/source-cache' / repository.replace('/', '-')
                archive(repository, revision, cached)
                shutil.copytree(cached, sdk / relative, dirs_exist_ok=True)
            print('Archive-pinned SDK: build with IDF_SKIP_CHECK_SUBMODULES=1', flush=True)
        else:
            run(['git', '-C', str(sdk), 'submodule', 'update', '--init', '--depth', '1',
                 '--jobs', '4', '--', *required])
        if args.tools:
            env = dict(os.environ, IDF_TOOLS_PATH=str(ROOT / '.sdk/tools'))
            run([sys.executable, str(sdk / 'tools/idf_tools.py'), 'install', '--targets', PINS['target']], env=env)
            run([sys.executable, str(sdk / 'tools/idf_tools.py'), 'install-python-env'], env=env)
            exported = subprocess.check_output([sys.executable, str(sdk / 'tools/idf_tools.py'),
                                                 'export', '--format', 'key-value'], env=env, text=True)
            python_env = next(line.split('=', 1)[1] for line in exported.splitlines()
                              if line.startswith('IDF_PYTHON_ENV_PATH='))
            interpreter = Path(python_env) / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
            run([str(interpreter), '-m', 'pip', 'install', f"cmake=={PINS['cmake']}",
                 f"ninja=={PINS['ninja']}"], env=env)
    print('Pinned firmware dependencies ready. No board has been flashed.', flush=True)


if __name__ == '__main__':
    main()
