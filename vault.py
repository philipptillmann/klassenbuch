"""Single encrypted vault. This module never receives a decryption key/password."""
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import sqlite3


class VaultError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def validate_envelope(value):
    if not isinstance(value, dict) or set(value) != {'v', 'salt', 'iv', 'cipher'} or value['v'] != 1:
        raise VaultError(400, 'Ungültiges verschlüsseltes Datenformat')
    try:
        salt, iv, cipher = (base64.b64decode(value[k], validate=True) for k in ('salt', 'iv', 'cipher'))
    except (ValueError, TypeError):
        raise VaultError(400, 'Ungültige Verschlüsselungsdaten')
    if len(salt) != 16 or len(iv) != 12 or len(cipher) < 16:
        raise VaultError(400, 'Ungültige Verschlüsselungsdaten')
    return value


def token_hash(token):
    try:
        if len(base64.b64decode(token, validate=True)) != 32:
            raise ValueError()
    except (TypeError, ValueError):
        raise VaultError(401, 'Zugriff verweigert')
    return hashlib.sha256(token.encode('ascii')).hexdigest()


class Vault:
    def __init__(self, directory):
        self.directory = Path(directory).expanduser().resolve()
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.directory, 0o700)
        self.path = self.directory / 'vault.sqlite3'
        self.setup_path = self.directory / 'setup-token'
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS vault (id INTEGER PRIMARY KEY CHECK(id=1), envelope TEXT NOT NULL, verifier TEXT NOT NULL, revision INTEGER NOT NULL)')
        from push_service import init_tables
        with self.connect() as db: init_tables(db)
        os.chmod(self.path, 0o600)
        if not self.status()['exists']:
            try:
                fd = os.open(self.setup_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            except FileExistsError:
                pass
            else:
                with os.fdopen(fd, 'w') as f:
                    f.write(secrets.token_urlsafe(32) + '\n')

    def connect(self):
        return sqlite3.connect(self.path, timeout=15)

    def status(self):
        with self.connect() as db:
            row = db.execute('SELECT envelope, revision FROM vault WHERE id=1').fetchone()
        if not row:
            return {'exists': False}
        envelope = json.loads(row[0])
        return {'exists': True, 'salt': envelope['salt'], 'revision': row[1]}

    def read(self, token):
        verifier = token_hash(token)
        with self.connect() as db:
            row = db.execute('SELECT envelope, verifier, revision FROM vault WHERE id=1').fetchone()
        if not row or not hmac.compare_digest(row[1], verifier):
            raise VaultError(401, 'Zugriff verweigert')
        return {'envelope': json.loads(row[0]), 'revision': row[2]}

    def create(self, envelope, token, setup, reminder_times=None):
        validate_envelope(envelope)
        verifier = token_hash(token)
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute('SELECT id FROM vault WHERE id=1').fetchone():
                raise VaultError(409, 'Klassenbuch ist bereits eingerichtet. Bitte neu laden.')
            try:
                expected = self.setup_path.read_text().strip()
            except FileNotFoundError:
                raise VaultError(403, 'Einrichtungsschlüssel nicht verfügbar')
            if not isinstance(setup, str) or not setup.isascii() or not hmac.compare_digest(expected, setup):
                raise VaultError(403, 'Einrichtungsschlüssel prüfen')
            db.execute('INSERT INTO vault VALUES (1, ?, ?, 1)', (json.dumps(envelope), verifier))
            from push_service import replace_plan
            replace_plan(db, [] if reminder_times is None else reminder_times, 1)
        self.setup_path.unlink(missing_ok=True)
        return {'revision': 1}

    def write(self, envelope, token, revision, reminder_times=None):
        validate_envelope(envelope)
        verifier = token_hash(token)
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT envelope, verifier, revision FROM vault WHERE id=1').fetchone()
            if not row or not hmac.compare_digest(row[1], verifier):
                raise VaultError(401, 'Zugriff verweigert')
            if str(row[2]) != revision:
                raise VaultError(409, 'Neuere Daten auf dem Server. Bitte neu laden und erneut entsperren.')
            if envelope['salt'] != json.loads(row[0])['salt']:
                raise VaultError(400, 'Der Schlüssel darf beim Speichern nicht geändert werden')
            db.execute('UPDATE vault SET envelope=?, revision=revision+1 WHERE id=1', (json.dumps(envelope),))
            from push_service import replace_plan
            replace_plan(db, [] if reminder_times is None else reminder_times, row[2]+1)
        return {'revision': row[2] + 1}
