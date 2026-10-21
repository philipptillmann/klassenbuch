import contextlib
import io
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from config import load_config


class ConfigTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / '.env'

    def config(self, argv=None, environ=None):
        return load_config(argv or [], environ={} if environ is None else environ, env_path=self.path)

    def test_defaults_and_missing_file(self):
        config = self.config()
        self.assertEqual((config.bind, config.port), ('127.0.0.1', 8085))

    def test_comments_quotes_and_precedence(self):
        self.path.write_text('# proxy\nexport KLASSENBUCH_BIND="0.0.0.0" # comment\nKLASSENBUCH_PORT=18085\nOTHER=value\n')
        self.assertEqual(self.config().port, 18085)
        self.assertEqual(self.config().health_url, 'http://127.0.0.1:18085/healthz')
        self.assertEqual(self.config(environ={'KLASSENBUCH_PORT': '18086'}).port, 18086)
        self.assertEqual(self.config(['--port', '18087'], {'KLASSENBUCH_PORT': '18086'}).port, 18087)
        self.assertEqual(self.config(['--port', '0']).port, 0)
        self.assertEqual(self.config(['--bind', '::']).health_url, 'http://[::1]:18085/healthz')

    def test_invalid_values_fail_before_binding(self):
        for value in ['0', '-1', '65536', 'not-a-port', '"unterminated']:
            self.path.write_text('KLASSENBUCH_PORT=' + value)
            with self.subTest(value=value), contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                self.config()

    def test_push_environment_settings(self):
        self.path.write_text('KLASSENBUCH_PUSH_ENABLED=false\nKLASSENBUCH_PUSH_SUBJECT=mailto:test@example.org\n')
        self.assertFalse(self.config().push_enabled)
        self.assertEqual(self.config().push_subject,'mailto:test@example.org')
        self.path.write_text('KLASSENBUCH_PUSH_ENABLED=maybe\n')
        with contextlib.redirect_stderr(io.StringIO()),self.assertRaises(SystemExit):self.config()

    def test_shell_expressions_are_never_executed(self):
        marker = Path(self.temp.name) / 'must-not-exist'
        self.path.write_text(f'KLASSENBUCH_BIND="$(touch {marker})"\n')
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit): self.config()
        self.assertFalse(marker.exists())

    def test_server_reads_dotenv_from_checkout_not_working_directory(self):
        checkout = Path(self.temp.name) / 'app'
        checkout.mkdir()
        root = Path(__file__).resolve().parents[1]
        for filename in ['server.py', 'vault.py', 'config.py', 'push_service.py']:
            shutil.copyfile(root / filename, checkout / filename)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        config_text = f'KLASSENBUCH_BIND=127.0.0.1\nKLASSENBUCH_PORT={port}\n'
        (checkout / '.env').write_text(config_text)
        process = subprocess.Popen([sys.executable, str(checkout / 'server.py'), '--data-dir', str(checkout / 'data')], cwd=self.temp.name, env={key: value for key, value in os.environ.items() if key not in {'KLASSENBUCH_BIND', 'KLASSENBUCH_PORT'}}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.addCleanup(lambda: process.wait(timeout=5))
        self.addCleanup(process.terminate)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        for attempt in range(50):
            try:
                with opener.open(f'http://127.0.0.1:{port}/healthz', timeout=1) as response:
                    self.assertEqual(response.read(), b'klassenbuch ok\n')
                break
            except OSError: time.sleep(.05)
        else: self.fail('Configured server did not start')
        self.assertEqual((checkout / '.env').read_text(), config_text)

if __name__ == '__main__': unittest.main()
