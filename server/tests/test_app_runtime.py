"""Frontend runtime contracts travel through discovery and the authenticated app catalog."""
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient
from app import auth, deps, settings
from app.folder_scanner import scan
from app.main import app
from app.plugin_catalog import apps


class AppRuntimeTests(unittest.TestCase):
    def fixture(self, root, name, runtime=None, kind='page'):
        folder = root / name
        folder.mkdir()
        (folder / 'index.html').write_text('<!doctype html><textarea></textarea>')
        manifest = {'id': name, 'name': name, 'version': '1.2.3', 'kind': kind,
                    'page': {'entry': 'index.html'}}
        if runtime is not None:
            manifest['runtime'] = runtime
        (folder / 'plugin.json').write_text(json.dumps(manifest))

    def test_legacy_manifest_and_bare_page_remain_usable(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.fixture(root, 'legacy')
            (root / 'bare').mkdir()
            (root / 'bare/index.html').write_text('<!doctype html>legacy')
            catalog = scan(root)
            self.assertEqual(set(catalog), {'bare', 'legacy'})
            for item in catalog.values():
                self.assertTrue(item.ok)
                self.assertEqual(item.runtime, {})

    def test_invalid_policies_fail_before_install(self):
        policies = [[], False, {'keepAlive': 'yes'}, {'preload': 'eager'},
                    {'background': 'forever'}, {'unknown': True}, {'apiVersion': 2}, {'apiVersion': True}]
        for policy in policies:
            with self.subTest(policy=policy), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                self.fixture(root, 'invalid', policy)
                manifest = scan(root)['invalid']
                self.assertFalse(manifest.ok)
                self.assertIn('E_MANIFEST_FIELD', manifest.codes)

    def test_runtime_policy_in_real_authenticated_http_catalog(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            policy = {'keepAlive': True, 'preload': 'execute', 'background': 'pause'}
            self.fixture(root, 'runtime-app', policy)
            discovered = scan(root)
            service = SimpleNamespace(discover=lambda: discovered,
                installed_ids=lambda: ['runtime-app'])
            manager = SimpleNamespace(apps=lambda: apps(service))
            with patch.object(deps, 'manager', manager), \
                    patch.object(auth, '_secret_cache', b'app-runtime-tests-only'), \
                    patch.object(auth, 'DEBUG_DISABLE_AUTH', False):
                client = TestClient(app)
                try:
                    self.assertEqual(client.get('/api/apps').status_code, 401)
                    client.cookies.set(auth.COOKIE_NAME, auth.create_session('runtime-owner'))
                    response = client.get('/api/apps')
                    self.assertEqual(response.status_code, 200, response.text)
                    item = response.json()[0]
                    self.assertEqual(item['runtime'], policy)
                    self.assertEqual(item['version'], '1.2.3')
                    self.assertEqual(item['route'], '/app/runtime-app')
                finally:
                    client.close()

    def test_plugin_html_preserves_host_sdk_and_rewrites_local_assets(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.fixture(root, 'sdk-page')
            (root / 'sdk-page/index.html').write_text(
                '<head><script src="/anka-sdk.js?v=1"></script>'
                '<script src="/assets/local.js"></script></head>')
            with patch.object(settings, 'APP_PLUGINS_DIR', root), \
                    patch.object(auth, '_secret_cache', b'app-runtime-tests-only'), \
                    patch.object(auth, 'DEBUG_DISABLE_AUTH', False):
                client = TestClient(app)
                try:
                    client.cookies.set(auth.COOKIE_NAME, auth.create_session('runtime-owner'))
                    response = client.get('/plugins/sdk-page/index.html')
                    self.assertEqual(response.status_code, 200)
                    self.assertIn('src="/anka-sdk.js?v=1"', response.text)
                    self.assertIn('src="/plugins/sdk-page/assets/local.js"', response.text)
                finally:
                    client.close()

