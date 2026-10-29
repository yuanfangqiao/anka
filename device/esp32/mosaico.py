#!/usr/bin/env python3
"""Run the pinned official CLI with this handpad's application workspace."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
TOOLS = ROOT / '.deps/utils/mosaico-tools'
if not (TOOLS / 'tools/mosaico_cli/cli.py').is_file():
    raise SystemExit('Prepare dependencies with tools/bootstrap.py and tools/prepare_font.py first.')
sys.path.insert(0, str(TOOLS / 'tools'))
from mosaico_cli.cli import main

if __name__ == '__main__':
    raise SystemExit(main(['--workspace', str(ROOT), *sys.argv[1:]], tool_root=TOOLS))
