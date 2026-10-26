"""Build activation is transactional: failures must not load or replace apps."""
import hashlib
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app import settings
from app.ledger import Ledger
from app.plugin_service import PluginService, ServiceError


class PluginBuildTests(unittest.TestCase):
    def test_app_recipe_finishes_before_backend_activation(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            plugin = root / 'test-build'
            (plugin / 'web').mkdir(parents=True)
            (plugin / 'server').mkdir()
            (plugin / 'web/index.js').write_text('export function setup() {}')
            (plugin / 'server/main.py').write_text('name="test-build"')
            (plugin / 'plugin.json').write_text(json.dumps({
                'id': 'test-build', 'name': 'test', 'version': '1.0.0', 'kind': 'app',
                'backend': {'entry': 'server/main.py'}, 'ui': {'entry': 'web/index.js'},
                'build': {'steps': [{'run': 'npm run build'}],
                          'output': {'entry': 'dist/index.html'}}}))
            events = []
            ledger = Ledger(root / 'ledger.jsonl', root / 'snapshot.json')
            with patch.object(settings, 'INSTALLED_FILE', root / 'missing.json'), \
                    patch.object(settings, 'AGENT_DEV', False):
                service = PluginService(on_load=lambda *_: events.append('load') or 'ACTIVE',
                    on_uninstall=lambda _: None, state_probe=lambda _: 'ACTIVE',
                    was_loaded=lambda _: False, ledger=ledger, plugins_dir=root)
                with patch('app.plugin_builder.build_recipe', return_value=(False, 'compile failed')):
                    with self.assertRaises(ServiceError):
                        service.install('test-build')
                self.assertEqual(events, [])
                self.assertFalse(service.is_installed('test-build'))
                def recipe(*_):
                    events.append('recipe')
                    return True, 'ok'
                with patch('app.plugin_builder.build_recipe', side_effect=recipe), \
                        patch('app.plugin_builder.build_web', side_effect=lambda _: events.append('web') or True):
                    self.assertTrue(service.install('test-build').ok)
                self.assertEqual(events, ['recipe', 'web', 'load'])
                self.assertTrue(service.is_installed('test-build'))

    @unittest.skipUnless(shutil.which('node'), 'Node is required for the actual plugin compiler')
    def test_native_compiler_keeps_last_good_artifact_on_failure(self):
        with tempfile.TemporaryDirectory(prefix='qa-build-', dir=settings.APP_PLUGINS_DIR) as folder:
            plugin = Path(folder)
            pid = plugin.name
            out = settings.PLUGIN_DIST_DIR / pid
            try:
                (plugin / 'web').mkdir()
                (plugin / 'plugin.json').write_text(json.dumps({'ui': {'entry': 'web/index.js'}}))
                entry = plugin / 'web/index.js'
                entry.write_text('export function setup() { return "last-good-build"; }')
                argv = ['node', str(settings.WEB_DIR / 'scripts/build-plugin.mjs'), pid]
                good = subprocess.run(argv, cwd=settings.WEB_DIR, capture_output=True, text=True)
                self.assertEqual(good.returncode, 0, good.stderr)
                fingerprint = hashlib.sha256((out / 'index.js').read_bytes()).hexdigest()
                entry.write_text('export function setup( { syntax error')
                bad = subprocess.run(argv, cwd=settings.WEB_DIR, capture_output=True, text=True)
                self.assertNotEqual(bad.returncode, 0)
                self.assertEqual(hashlib.sha256((out / 'index.js').read_bytes()).hexdigest(), fingerprint)
                self.assertTrue((out / 'index.css').is_file())
            finally:
                shutil.rmtree(out, ignore_errors=True)


if __name__ == '__main__':
    unittest.main()
