#!/usr/bin/env python3
"""Static UI and authenticated, opaque encrypted vault storage."""
import json
import os
import sqlite3
import socket
from config import load_config
from vault import Vault, VaultError
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
ASSETS = {'index.html', 'app.js', 'records.js', 'exports.js', 'reminders.js', 'reminder-sw.js', 'style.css', 'sjcl.js', 'crypto-worker.js', 'SJCL-LICENSE.txt'}

class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        if path.startswith('/api/'):
            self.api('GET', path)
        elif path == '/healthz':
            body = b'klassenbuch ok\n'
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif path == '/' or path.lstrip('/') in ASSETS and path.count('/') == 1:
            super().do_GET()
        else:
            self.send_error(404)

    def do_HEAD(self):
        path = unquote(urlsplit(self.path).path)
        if path == '/' or path.lstrip('/') in ASSETS and path.count('/') == 1:
            super().do_HEAD()
        else:
            self.send_error(404)

    def do_POST(self):
        self.api('POST', urlsplit(self.path).path)

    def do_PUT(self):
        self.api('PUT', urlsplit(self.path).path)

    def json_response(self, status, value):
        body = json.dumps(value, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def api(self, method, path):
        try:
            if not hasattr(self.server, 'vault'):
                raise VaultError(503, 'Speicher nicht eingerichtet')
            vault = self.server.vault
            token = self.headers.get('Authorization', '').removeprefix('Bearer ')
            if method == 'GET' and path == '/api/vault/status':
                self.json_response(200, vault.status())
                return
            if method == 'GET' and path == '/api/vault':
                self.json_response(200, vault.read(token))
                return
            if method not in ('POST', 'PUT') or path != '/api/vault':
                raise VaultError(404, 'Nicht gefunden')
            origin = self.headers.get('Origin')
            if origin and urlsplit(origin).netloc != self.headers.get('Host'):
                raise VaultError(403, 'Ursprung nicht erlaubt')
            if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                raise VaultError(415, 'JSON erforderlich')
            try:
                length = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                raise VaultError(400, 'Ungültige Länge')
            if not 0 < length <= 20 * 1024 * 1024:
                raise VaultError(413, 'Maximal 20 MiB pro Speicherung')
            try:
                payload = json.loads(self.rfile.read(length))
            except (ValueError, UnicodeError):
                raise VaultError(400, 'Ungültiges JSON')
            if not isinstance(payload, dict) or set(payload) != {'envelope'}:
                raise VaultError(400, 'Nur verschlüsselte Daten erlaubt')
            if method == 'POST':
                result = vault.create(payload['envelope'], token, self.headers.get('X-Setup-Token', ''))
                self.json_response(201, result)
            else:
                result = vault.write(payload['envelope'], token, self.headers.get('If-Match', '').strip('"'))
                self.json_response(200, result)
        except VaultError as error:
            self.json_response(error.status, {'error': str(error)})
        except (sqlite3.Error, OSError):
            self.json_response(503, {'error': 'Serverspeicher vorübergehend nicht verfügbar'})

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        super().end_headers()


def main():
    args = load_config()
    os.umask(0o077)
    server_type = ThreadingHTTPServer
    if ':' in args.bind:
        class IPv6Server(ThreadingHTTPServer):
            address_family = socket.AF_INET6
        server_type = IPv6Server
    server = server_type((args.bind, args.port), functools.partial(Handler, directory=str(ROOT / 'dist')))
    server.vault = Vault(args.data_dir)
    host = f'[{args.bind}]' if ':' in args.bind else args.bind
    print(f'Klassenbuch läuft auf http://{host}:{server.server_port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

if __name__ == '__main__':
    main()
