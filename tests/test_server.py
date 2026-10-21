import functools
import base64
import json
import tempfile
import struct
from http.server import ThreadingHTTPServer
from pathlib import Path
import sys
import threading
import unittest
import urllib.error
import urllib.request
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import Handler, ROOT
from push_service import PushService
from vault import Vault

class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT / 'dist')))
        cls.temp = tempfile.TemporaryDirectory()
        cls.server.vault = Vault(cls.temp.name)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = f'http://127.0.0.1:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.temp.cleanup()

    def test_app_and_security_headers(self):
        with urllib.request.urlopen(self.origin) as response:
            self.assertIn(b'Klassenbuch', response.read())
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
            self.assertEqual(response.headers['X-Frame-Options'], 'DENY')
            self.assertIn("script-src 'self'", response.headers['Content-Security-Policy'])
        for asset in ['manifest.webmanifest', 'logo.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'app.js', 'records.js', 'exports.js', 'reminders.js', 'reminder-sw.js', 'sjcl.js', 'crypto-worker.js', 'style.css']:
            with urllib.request.urlopen(self.origin + '/' + asset) as response:
                self.assertEqual(response.status, 200)

    def test_repository_and_traversal_are_not_public(self):
        for path in ['/README.md', '/.git/config', '/../server.py', '/%2e%2e/server.py', '/dist/', '/backup.json', '/.env', '/.env.example', '/config.py']:
            with self.assertRaises(urllib.error.HTTPError) as cm:
                urllib.request.urlopen(self.origin + path)
            self.assertEqual(cm.exception.code, 404)

    def test_health_and_read_only(self):
        with urllib.request.urlopen(self.origin + '/healthz') as response:
            self.assertEqual(response.read(), b'klassenbuch ok\n')
        with self.assertRaises(urllib.error.HTTPError) as cm:
            urllib.request.urlopen(urllib.request.Request(self.origin, data=b'private data'))
        self.assertEqual(cm.exception.code, 404)

    def test_pwa_manifest_and_icon_sizes(self):
        with urllib.request.urlopen(self.origin + '/manifest.webmanifest') as response:
            self.assertIn('application/manifest+json', response.headers['Content-Type'])
            manifest = json.load(response)
        self.assertEqual(manifest['name'], 'Klassenbuch')
        self.assertEqual(manifest['display'], 'standalone')
        self.assertEqual(manifest['start_url'], './')
        self.assertTrue(any(icon['purpose'] == 'maskable' for icon in manifest['icons']))
        for name, size in [('icon-192.png',192), ('icon-512.png',512), ('icon-maskable-512.png',512), ('apple-touch-icon.png',180)]:
            with urllib.request.urlopen(self.origin + '/' + name) as response:
                png = response.read()
            self.assertEqual(png[:8], b'\x89PNG\r\n\x1a\n')
            self.assertEqual(struct.unpack('>II', png[16:24]), (size,size))

    def test_authenticated_ciphertext_api(self):
        token = base64.b64encode(b't' * 32).decode()
        envelope = {'v': 1, 'salt': base64.b64encode(b's' * 16).decode(), 'iv': base64.b64encode(b'i' * 12).decode(), 'cipher': base64.b64encode(b'ciphertext' * 4).decode()}
        with urllib.request.urlopen(self.origin + '/api/vault/status') as r:
            self.assertFalse(json.load(r)['exists'])
        with self.assertRaises(urllib.error.HTTPError) as cm:
            urllib.request.urlopen(self.origin + '/api/vault')
        self.assertEqual(cm.exception.code, 401)
        headers = {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'X-Setup-Token': self.server.vault.setup_path.read_text().strip(), 'Origin': self.origin}
        request = urllib.request.Request(self.origin + '/api/vault', data=json.dumps({'envelope': envelope}).encode(), headers=headers, method='POST')
        with urllib.request.urlopen(request) as r: self.assertEqual(r.status, 201)
        with urllib.request.urlopen(urllib.request.Request(self.origin + '/api/vault', headers={'Authorization': 'Bearer ' + token})) as r:
            self.assertEqual(json.load(r)['envelope'], envelope)
        bad = urllib.request.Request(self.origin + '/api/vault', data=json.dumps({'envelope': envelope}).encode(), headers={**headers, 'Origin': 'https://evil.invalid'}, method='PUT')
        with self.assertRaises(urllib.error.HTTPError) as cm: urllib.request.urlopen(bad)
        self.assertEqual(cm.exception.code, 403)
        valid = urllib.request.Request(self.origin + '/api/vault', data=json.dumps({'envelope': envelope}).encode(), headers={**headers, 'If-Match': '1'}, method='PUT')
        with urllib.request.urlopen(valid) as r: self.assertEqual(json.load(r)['revision'], 2)
        stale = urllib.request.Request(self.origin + '/api/vault', data=json.dumps({'envelope': envelope}).encode(), headers={**headers, 'If-Match': '1'}, method='PUT')
        with self.assertRaises(urllib.error.HTTPError) as cm: urllib.request.urlopen(stale)
        self.assertEqual(cm.exception.code, 409)
        for path in ['/vault.sqlite3', '/setup-token', '/vault.py']:
            with self.assertRaises(urllib.error.HTTPError) as cm: urllib.request.urlopen(self.origin + path)
            self.assertEqual(cm.exception.code, 404)

    def test_push_api_requires_auth_and_accepts_only_approved_metadata(self):
        import time
        token=base64.b64encode(b't'*32).decode()
        self.server.push=PushService(self.server.vault,enabled=False,sender=lambda sub:None)
        self.server.push.available=True
        origin=self.origin
        def request(path, body=None, method=None, authorized=True):
            headers={'Content-Type':'application/json','Origin':origin}
            if authorized:headers['Authorization']='Bearer '+token
            return urllib.request.urlopen(urllib.request.Request(origin+path,data=None if body is None else json.dumps(body).encode(),headers=headers,method=method))
        with self.assertRaises(urllib.error.HTTPError) as cm:request('/api/push/config',authorized=False)
        self.assertEqual(cm.exception.code,401)
        with request('/api/push/config') as r:self.assertTrue(json.load(r)['available'])
        subscription={'endpoint':'https://updates.push.services.mozilla.com/wpush/v2/test','keys':{'p256dh':base64.urlsafe_b64encode(b'\x04'+b'A'*64).decode().rstrip('='),'auth':base64.urlsafe_b64encode(b'B'*16).decode().rstrip('=')}}
        with request('/api/push/subscribe',{'subscription':subscription},'POST') as r:self.assertIn('deviceId',json.load(r))
        revision=self.server.vault.status()['revision']
        with request('/api/push/plan',{'times':[int(time.time())+60],'revision':revision},'PUT') as r:self.assertGreater(json.load(r)['plannedUntil'],0)
        with self.assertRaises(urllib.error.HTTPError) as cm:request('/api/push/plan',{'times':[],'revision':0},'PUT')
        self.assertEqual(cm.exception.code,409)
        with self.assertRaises(urllib.error.HTTPError) as cm:request('/api/push/plan',{'times':[],'revision':revision,'student':'not allowed'},'PUT')
        self.assertEqual(cm.exception.code,400)
        with request('/api/push/test',{'endpoint':subscription['endpoint']},'POST') as r:self.assertTrue(json.load(r)['accepted'])
        with request('/api/push/unsubscribe',{'endpoint':subscription['endpoint']},'POST') as r:self.assertTrue(json.load(r)['removed'])
        with self.server.vault.connect() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM push_devices').fetchone()[0],0)

if __name__ == '__main__': unittest.main()
