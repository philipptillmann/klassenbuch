import base64
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from vault import Vault, VaultError


def envelope(iv=None):
    return {'v': 1, 'salt': base64.b64encode(b's' * 16).decode(), 'iv': base64.b64encode(iv or b'i' * 12).decode(), 'cipher': base64.b64encode(b'opaque authenticated ciphertext' * 2).decode()}


class VaultTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = Vault(self.temp.name)
        self.setup = self.store.setup_path.read_text().strip()
        self.token = base64.b64encode(b't' * 32).decode()

    def create(self):
        return self.store.create(envelope(), self.token, self.setup)

    def test_setup_auth_and_no_secrets_on_disk(self):
        with self.assertRaises(VaultError) as cm:
            self.store.create(envelope(), self.token, 'wrong')
        self.assertEqual(cm.exception.status, 403)
        self.create()
        self.assertFalse(self.store.setup_path.exists())
        with self.assertRaises(VaultError): self.store.read('')
        with self.assertRaises(VaultError): self.store.read(base64.b64encode(b'x' * 32).decode())
        self.assertEqual(self.store.read(self.token)['envelope'], envelope())
        contents = self.store.path.read_bytes()
        self.assertNotIn(self.token.encode(), contents)
        self.assertEqual(self.store.path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.store.directory.stat().st_mode & 0o777, 0o700)

    def test_revision_prevents_lost_updates_and_survives_restart(self):
        self.create()
        self.store.write(envelope(b'j' * 12), self.token, '1')
        with self.assertRaises(VaultError) as cm:
            self.store.write(envelope(), self.token, '1')
        self.assertEqual(cm.exception.status, 409)
        restarted = Vault(self.temp.name)
        self.assertEqual(restarted.read(self.token)['revision'], 2)
        self.assertEqual(restarted.read(self.token)['envelope'], envelope(b'j' * 12))
        with self.assertRaises(VaultError): restarted.create(envelope(), self.token, self.setup)

    def test_invalid_envelope_and_salt_change_rejected(self):
        for bad in [{}, {**envelope(), 'plaintext': 'not allowed'}, {**envelope(), 'iv': 'bad'}, {**envelope(), 'cipher': 'not base64'}]:
            with self.assertRaises(VaultError): self.store.create(bad, self.token, self.setup)
        self.create()
        with self.assertRaises(VaultError): self.store.write({**envelope(), 'salt': base64.b64encode(b'z' * 16).decode()}, self.token, '1')

if __name__ == '__main__': unittest.main()
