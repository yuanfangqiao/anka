"""Isolated real Anka runtime for controller browser QA; never uses production users/data."""
import argparse
import os
import tempfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=18772)
args = parser.parse_args()
folder = tempfile.TemporaryDirectory(prefix='anka-device-qa-')
root = Path(folder.name)
os.environ['ANKA_DATA_DIR'] = str(root / 'data')
os.environ['ANKA_USERS_FILE'] = str(root / 'users.json')
os.environ['AGENTOS_DEV'] = '1'
os.environ.pop('DEBUG_DISABLE_AUTH', None)

from app import auth, settings
settings.DEFAULT_INSTALLED = ['anka-outpost-strike']
settings.ROOM_PUBLIC_URL = f'http://127.0.0.1:{args.port}'
auth.save_users({'controller-qa': {'password': auth.hash_password('controller-local-only')}})

import uvicorn
from app.main import app
uvicorn.run(app, host='127.0.0.1', port=args.port, log_level='warning')
