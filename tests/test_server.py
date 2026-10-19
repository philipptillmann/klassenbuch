import functools
from http.server import ThreadingHTTPServer
from pathlib import Path
import sys
import threading
import unittest
import urllib.error
import urllib.request
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import Handler, ROOT

class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT / 'dist')))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = f'http://127.0.0.1:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def test_app_and_security_headers(self):
        with urllib.request.urlopen(self.origin) as response:
            self.assertIn(b'Klassenbuch', response.read())
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
            self.assertEqual(response.headers['X-Frame-Options'], 'DENY')
            self.assertIn("script-src 'self'", response.headers['Content-Security-Policy'])
        for asset in ['app.js', 'sjcl.js', 'crypto-worker.js', 'style.css']:
            with urllib.request.urlopen(self.origin + '/' + asset) as response:
                self.assertEqual(response.status, 200)

    def test_repository_and_traversal_are_not_public(self):
        for path in ['/README.md', '/.git/config', '/../server.py', '/%2e%2e/server.py', '/dist/', '/backup.json']:
            with self.assertRaises(urllib.error.HTTPError) as cm:
                urllib.request.urlopen(self.origin + path)
            self.assertEqual(cm.exception.code, 404)

    def test_health_and_read_only(self):
        with urllib.request.urlopen(self.origin + '/healthz') as response:
            self.assertEqual(response.read(), b'klassenbuch ok\n')
        with self.assertRaises(urllib.error.HTTPError) as cm:
            urllib.request.urlopen(urllib.request.Request(self.origin, data=b'private data'))
        self.assertEqual(cm.exception.code, 501)

if __name__ == '__main__': unittest.main()
