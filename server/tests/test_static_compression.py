"""Compression, cache and authorization contracts through the real Anka routes."""
import gzip
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient
from app import auth, settings
from app.main import app
from app.static_assets import StaticCompressionMiddleware

DATA = b'ANKA static asset ' * 1000
BROTLI = bytes.fromhex('1b4f46f81d0976ccca066de6382d8396c2ca892ee7ca408a94db2a847d9004e1f700cc03')


class StaticCompressionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.file = self.root / 'game/dist/assets/model-AbCd1234.glb'
        self.file.parent.mkdir(parents=True)
        self.file.write_bytes(DATA)
        Path(str(self.file) + '.gz').write_bytes(gzip.compress(DATA))
        Path(str(self.file) + '.br').write_bytes(BROTLI)
        self.patches = [patch.object(settings, 'APP_PLUGINS_DIR', self.root),
                        patch.object(auth, '_secret_cache', b'compression-test'),
                        patch.object(auth, 'DEBUG_DISABLE_AUTH', False)]
        for p in self.patches:
            p.start()
        self.client = TestClient(app)
        self.client.cookies.set(auth.COOKIE_NAME, auth.create_session('owner'))
        self.url = '/plugins/game/dist/assets/model-AbCd1234.glb'

    def tearDown(self):
        self.client.close()
        for p in reversed(self.patches):
            p.stop()
        self.tmp.cleanup()

    def test_brotli_preferred_and_original_mime_preserved(self):
        response = self.client.get(self.url, headers={'Accept-Encoding': 'br, gzip'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['content-encoding'], 'br')
        self.assertEqual(response.headers['content-type'], 'model/gltf-binary')
        self.assertIn(response.content, (DATA, BROTLI))  # httpx's optional Brotli decoder
        self.assertIn('private', response.headers['cache-control'])
        self.assertIn('immutable', response.headers['cache-control'])
        self.assertIn('Accept-Encoding', response.headers['vary'])

    def test_gzip_identity_and_quality_zero(self):
        for accept, encoding in [('gzip', 'gzip'), ('br;q=0, gzip', 'gzip'),
                                 ('br;q=.2, gzip;q=.8', 'gzip'),
                                 ('br;q=0,gzip;q=0', None), ('identity', None)]:
            response = self.client.get(self.url, headers={'Accept-Encoding': accept})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers.get('content-encoding'), encoding)
            self.assertEqual(response.content, DATA)

    def test_conditional_requests_use_the_selected_representation(self):
        first = self.client.get(self.url, headers={'Accept-Encoding': 'gzip'})
        second = self.client.get(self.url, headers={'Accept-Encoding': 'gzip',
                                'If-None-Match': first.headers['etag']})
        self.assertEqual(second.status_code, 304)
        self.assertEqual(second.content, b'')
        identity = self.client.get(self.url, headers={'Accept-Encoding': 'identity',
                                  'If-None-Match': first.headers['etag']})
        self.assertEqual(identity.status_code, 200)

    def test_range_is_uncompressed_and_exact(self):
        response = self.client.get(self.url, headers={'Accept-Encoding': 'br,gzip',
                                  'Range': 'bytes=10-29'})
        self.assertEqual(response.status_code, 206)
        self.assertNotIn('content-encoding', response.headers)
        self.assertEqual(response.content, DATA[10:30])

    def test_stale_companions_are_not_served(self):
        current = self.file.stat().st_mtime
        for suffix in ('.gz', '.br'):
            os.utime(str(self.file) + suffix, (current - 10, current - 10))
        response = self.client.get(self.url, headers={'Accept-Encoding': 'br,gzip;q=0'})
        self.assertNotIn('content-encoding', response.headers)
        self.assertEqual(response.content, DATA)

    def test_missing_precompression_uses_dynamic_gzip(self):
        Path(str(self.file) + '.gz').unlink()
        Path(str(self.file) + '.br').unlink()
        response = self.client.get(self.url, headers={'Accept-Encoding': 'gzip'})
        self.assertEqual(response.headers.get('content-encoding'), 'gzip')
        self.assertEqual(response.content, DATA)

    def test_head_preserves_compressed_headers_without_body(self):
        response = self.client.head(self.url, headers={'Accept-Encoding': 'br'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get('content-encoding'), 'br')
        self.assertEqual(int(response.headers['content-length']), len(BROTLI))
        self.assertEqual(response.content, b'')

    def test_no_acceptable_encoding_returns_406(self):
        response = self.client.get(self.url, headers={'Accept-Encoding': '*;q=0'})
        self.assertEqual(response.status_code, 406)

    def test_compressed_assets_still_require_authorization(self):
        self.client.cookies.clear()
        with patch('app.main.guest_asset', return_value=False):
            response = self.client.get(self.url, headers={'Accept-Encoding': 'br,gzip'})
        self.assertEqual(response.status_code, 401)

    def test_sse_is_not_compressed(self):
        stream = FastAPI()
        stream.add_middleware(StaticCompressionMiddleware)

        @stream.get('/api/stream')
        async def event_stream():
            return StreamingResponse(iter([b'data: ' + DATA + b'\n\n']), media_type='text/event-stream')

        with TestClient(stream) as client:
            response = client.get('/api/stream', headers={'Accept-Encoding': 'gzip'})
        self.assertNotIn('content-encoding', response.headers)
        self.assertTrue(response.content.startswith(b'data: '))


if __name__ == '__main__':
    unittest.main()
