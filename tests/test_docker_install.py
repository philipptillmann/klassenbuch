"""Exercise migration ordering and recovery without touching systemd or real data."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class DockerInstallTests(unittest.TestCase):
    def run_install(self, *, migrate=True, fail='', active=True):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        data = root / 'data'
        data.mkdir()
        (data / 'vault.sqlite3').write_bytes(b'encrypted fixture')
        (data / 'vapid-private.pem').write_bytes(b'key fixture')
        (root / '.env').write_text('KLASSENBUCH_PORT=18085\n')
        script = (ROOT / 'install-docker.sh').read_text().replace('/var/lib/klassenbuch', str(data))
        (root / 'install-docker.sh').write_text(script)
        commands = root / 'bin'
        commands.mkdir()
        mocks = {
            'docker': '''#!/bin/bash
printf 'docker %s\\n' "$*" >> "$QA_LOG"
[[ "$*" != *"$QA_FAIL"* || -z "$QA_FAIL" ]]
''',
            'systemctl': '''#!/bin/bash
printf 'systemctl %s\\n' "$*" >> "$QA_LOG"
if [[ "$1" == is-active || "$1" == is-enabled ]]; then [[ "$QA_ACTIVE" == true ]]; else exit 0; fi
''',
            'sudo': '#!/bin/bash\nexec "$@"\n',
        }
        for name, content in mocks.items():
            (commands / name).write_text(content)
            (commands / name).chmod(0o755)
        env = {**os.environ, 'PATH': str(commands) + ':' + os.environ['PATH'],
               'QA_LOG': str(root / 'log'), 'QA_FAIL': fail, 'QA_ACTIVE': str(active).lower()}
        result = subprocess.run(['bash', str(root / 'install-docker.sh'), *(['--migrate-systemd'] if migrate else [])],
                                env=env, capture_output=True, text=True)
        log = (root / 'log').read_text()
        return root, result, log

    def test_success_preserves_data_and_config_and_disables_after_health(self):
        root, result, log = self.run_install()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertLess(log.index('compose build'), log.index('systemctl stop'))
        self.assertLess(log.index('compose up'), log.index('systemctl disable'))
        backups = list(root.glob('data-backup-*'))
        self.assertEqual(len(backups), 1)
        self.assertEqual((backups[0] / 'vault.sqlite3').read_bytes(), b'encrypted fixture')
        self.assertEqual((backups[0] / 'vapid-private.pem').read_bytes(), b'key fixture')
        self.assertTrue((root / '.deployment-docker').exists())
        self.assertIn('KLASSENBUCH_PORT=18085', (root / '.env').read_text())

    def test_build_failure_leaves_old_service_running(self):
        root, result, log = self.run_install(fail='compose build')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('systemctl stop', log)
        self.assertFalse((root / '.deployment-docker').exists())

    def test_failed_start_stops_container_before_restarting_old_service(self):
        root, result, log = self.run_install(fail='compose up')
        self.assertNotEqual(result.returncode, 0)
        self.assertLess(log.index('compose down'), log.index('systemctl start'))
        self.assertNotIn('systemctl disable', log)
        self.assertFalse((root / '.deployment-docker').exists())

    def test_existing_service_requires_explicit_migration(self):
        root, result, log = self.run_install(migrate=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('compose up', log)
        self.assertNotIn('systemctl stop', log)

    def test_docker_update_does_not_require_systemd(self):
        root, result, log = self.run_install(migrate=False, active=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((root / '.deployment-docker').exists())
        self.assertNotIn('systemctl stop', log)
        self.assertNotIn('systemctl disable', log)
