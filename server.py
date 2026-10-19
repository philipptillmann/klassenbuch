#!/usr/bin/env python3
"""Serve only Klassenbuch's static assets; never the repository or backups."""
import argparse
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
ASSETS = {'index.html', 'app.js', 'style.css', 'sjcl.js', 'crypto-worker.js', 'SJCL-LICENSE.txt'}

class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        if path == '/healthz':
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

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        super().end_headers()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--bind', default='0.0.0.0')
    parser.add_argument('--port', type=int, default=8085)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.bind, args.port), functools.partial(Handler, directory=str(ROOT / 'dist')))
    print(f'Klassenbuch läuft auf http://{args.bind}:{args.port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

if __name__ == '__main__':
    main()
