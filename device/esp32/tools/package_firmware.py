"""Build an unsigned official Iris System Update bundle; never install/flash it."""
import os
from pathlib import Path
import subprocess
import sys
import venv

root = Path(__file__).resolve().parents[1]
host = root / '.sdk/iris-host'
python = host / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
if not python.is_file():
    venv.create(host, with_pip=True)
requirements = root / '.deps/utils/ESP-Iris/components/esp_iris/tools/requirements.txt'
subprocess.run([str(python), '-m', 'pip', 'install', '-r', str(requirements)], check=True)
env = dict(os.environ, ESP_IRIS_PYTHON=str(python))
subprocess.run([str(root/'tools/idf.sh'), '-D', f'ESP_IRIS_PYTHON={python}', 'reconfigure'], env=env, check=True)
subprocess.run([str(root/'tools/idf.sh'), 'system-update-bundle'], env=env, check=True)
print('Review bundle:', root/'build/anka_handpad-system-update.irisfw')
