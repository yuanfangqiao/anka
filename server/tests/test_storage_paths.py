"""Real attachment HTTP boundaries and isolated, lazy storage configuration."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from app import auth, settings
from app.main import app


class StoragePathsTests(unittest.TestCase):
    def test_relative_roots_work_outside_project_without_creating_directories(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder).resolve()
            env = dict(os.environ, PYTHONPATH=str(settings.PROJECT_ROOT / 'server'),
                       ANKA_DATA_DIR=os.path.relpath(root / 'data', settings.PROJECT_ROOT),
                       ANKA_PLUGINS_DIR=str(root / 'plugins'))
            program = ('from app import settings as s; import json; '
                       'print(json.dumps([str(p) for p in '
                       '[s.DATA_DIR,s.SYNC_DB,s.ROOMS_DB,s.LEDGER_FILE,s.SESSIONS_DIR,'
                       's.CREDENTIALS_FILE,s.APP_PLUGINS_DIR,s.app_data_dir("example")]]))')
            result = subprocess.run([sys.executable, '-c', program], cwd=root,
                                    env=env, capture_output=True, text=True, check=True)
            paths = json.loads(result.stdout)
            self.assertEqual(paths, [str(p) for p in [
                root / 'data', root / 'data/system/databases/agentos.db',
                root / 'data/system/databases/rooms.sqlite3',
                root / 'data/system/state/ledger.jsonl', root / 'data/ai/sessions',
                root / 'data/system/config/credentials.json', root / 'plugins',
                root / 'data/apps/example']])
            self.assertEqual(list(root.iterdir()), [])

    def test_attachment_auth_range_and_data_boundaries(self):
        with tempfile.TemporaryDirectory() as folder, \
                patch.object(settings, 'DATA_DIR', Path(folder)), \
                patch.object(auth, '_secret_cache', b'storage-tests'), \
                patch.object(auth, 'DEBUG_DISABLE_AUTH', False):
            application = settings.app_data_dir('example')
            media = application / 'files/media/clip.mp4'
            media.parent.mkdir(parents=True)
            media.write_bytes(b'0123456789abcdef')
            database = application / 'databases/private.sqlite3'
            database.parent.mkdir()
            database.write_bytes(b'private-database')
            (media.parent / 'escape.mp4').symlink_to(database)
            client = TestClient(app)
            self.addCleanup(client.close)
            url = '/api/apps/example/files/media/clip.mp4'
            self.assertEqual(client.get(url).status_code, 401)
            client.cookies.set(auth.COOKIE_NAME, auth.create_session('storage-owner'))
            self.assertEqual(client.get(url).content, media.read_bytes())
            part = client.get(url, headers={'Range': 'bytes=2-5'})
            self.assertEqual(part.status_code, 206)
            self.assertEqual(part.content, b'2345')
            self.assertEqual(client.head(url).content, b'')
            for suffix in ['media/escape.mp4', 'media/missing.mp4',
                           '%2e%2e/databases/private.sqlite3']:
                self.assertEqual(client.get('/api/apps/example/files/' + suffix).status_code, 404)
            with self.assertRaises(ValueError):
                settings.app_data_dir('../system')


if __name__ == '__main__':
    unittest.main()
