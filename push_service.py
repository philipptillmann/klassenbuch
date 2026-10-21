"""Approved reminder timestamps/subscriptions only; never decrypts the vault."""
import base64
import hashlib
import json
import logging
import os
from pathlib import Path
import threading
import time
from urllib.parse import urlsplit
from vault import VaultError

LOG = logging.getLogger('klassenbuch.push')
ALLOWED_HOSTS = {'fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com', 'wns2-par02p.notify.windows.com'}
MESSAGE = json.dumps({'title': 'Klassenbuch · Erinnerung', 'body': 'Zeit, die Mitarbeit der letzten Unterrichtsstunde einzutragen.'}, ensure_ascii=False)


def init_tables(db):
    db.executescript('''
      CREATE TABLE IF NOT EXISTS push_plan (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, times TEXT NOT NULL, updated INTEGER NOT NULL);
      INSERT OR IGNORE INTO push_plan VALUES (1,0,'[]',0);
      CREATE TABLE IF NOT EXISTS push_devices (id TEXT PRIMARY KEY, subscription TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS push_jobs (device TEXT NOT NULL, at INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_try INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(device,at));
    ''')


def validate_times(times, now=None):
    now = int(time.time()) if now is None else int(now)
    if not isinstance(times, list) or len(times) > 10000:
        raise VaultError(400, 'Maximal 10000 Erinnerungstermine erlaubt')
    if any(type(at) is not int or at < 0 or at > now + 367 * 86400 for at in times):
        raise VaultError(400, 'Ungültige Erinnerungstermine')
    return sorted(set(at for at in times if at >= now - 300))


def replace_plan(db, times, revision, now=None):
    now = int(time.time()) if now is None else int(now)
    times = validate_times(times, now)
    wanted = set(times)
    db.execute('UPDATE push_plan SET revision=?,times=?,updated=? WHERE id=1', (revision,json.dumps(times),now))
    # Retain delivery/retry state for unchanged timestamps, including active leases.
    for device, at in db.execute("SELECT device,at FROM push_jobs WHERE state IN ('pending','sending')").fetchall():
        if at not in wanted:
            db.execute('DELETE FROM push_jobs WHERE device=? AND at=?', (device,at))
    db.execute('DELETE FROM push_jobs WHERE at<?', (now-86400,))
    for (device,) in db.execute('SELECT id FROM push_devices').fetchall():
        db.executemany('INSERT OR IGNORE INTO push_jobs(device,at) VALUES (?,?)', ((device,at) for at in times))


def validate_subscription(subscription):
    if not isinstance(subscription, dict) or set(subscription) - {'endpoint','keys','expirationTime'}:
        raise VaultError(400, 'Ungültiges Push-Abonnement')
    endpoint = subscription.get('endpoint')
    if not isinstance(endpoint,str) or len(endpoint)>4096:
        raise VaultError(400, 'Ungültiger Push-Endpunkt')
    try:
        url = urlsplit(endpoint)
        allowed = url.hostname in ALLOWED_HOSTS or (url.hostname or '').endswith('.notify.windows.com')
        if url.scheme!='https' or not allowed or url.port not in (None,443) or url.username or url.password or url.fragment:
            raise ValueError()
    except ValueError:
        raise VaultError(400, 'Nur offizielle HTTPS-Push-Dienste sind erlaubt')
    keys = subscription.get('keys')
    if not isinstance(keys,dict) or set(keys)!= {'p256dh','auth'}:
        raise VaultError(400, 'Ungültige Push-Schlüssel')
    try:
        decoded = {k:base64.b64decode(v+'='*((-len(v))%4),altchars=b'-_',validate=True) for k,v in keys.items() if isinstance(v,str)}
        if set(decoded)!=set(keys) or len(decoded['auth'])!=16 or len(decoded['p256dh'])!=65 or decoded['p256dh'][0]!=4:
            raise ValueError()
    except (ValueError,TypeError):
        raise VaultError(400, 'Ungültige Push-Schlüssel')
    return {'endpoint':endpoint,'keys':keys}


class PushService:
    def __init__(self, vault, enabled=True, subject='https://github.com/philipptillmann/klassenbuch', sender=None):
        self.vault=vault
        self.subject=subject
        self.available=False
        self.public_key=None
        self.key_path=vault.directory / 'vapid-private.pem'
        self.sender=sender
        self.stopped=threading.Event()
        self.thread=None
        self.last_error=None
        if enabled:
            try:
                from py_vapid import Vapid
                from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
                if not self.key_path.exists():
                    key=Vapid();key.generate_keys()
                    fd=os.open(self.key_path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
                    with os.fdopen(fd,'wb') as file:file.write(key.private_pem())
                os.chmod(self.key_path,0o600)
                key=Vapid.from_file(str(self.key_path))
                # RFC 8292 permits HTTPS contact URIs with paths; py-vapid's
                # optional strict subject regex only accepts bare HTTPS origins.
                key.conf['no-strict']=True
                self.public_key=base64.urlsafe_b64encode(key.public_key.public_bytes(Encoding.X962,PublicFormat.UncompressedPoint)).rstrip(b'=').decode()
                if self.sender is None:
                    from pywebpush import webpush
                    import requests
                    class NoRedirectSession(requests.Session):
                        def post(self, *args, **kwargs):
                            kwargs['allow_redirects']=False
                            return super().post(*args,**kwargs)
                    def send(subscription):
                        with NoRedirectSession() as session:
                            return webpush(subscription_info=subscription,data=MESSAGE,vapid_private_key=key,vapid_claims={'sub':self.subject},ttl=300,timeout=10,requests_session=session)
                    self.sender=send
                self.available=True
            except (ImportError,OSError,ValueError):
                self.last_error='Push-Abhängigkeiten oder VAPID-Schlüssel prüfen; install.sh erneut ausführen.'
                LOG.warning(self.last_error)

    def config(self):
        with self.vault.connect() as db:
            row=db.execute('SELECT times,updated FROM push_plan WHERE id=1').fetchone()
        times=json.loads(row[0])
        return {'available':self.available,'publicKey':self.public_key,'plannedUntil':max(times,default=0),'updated':row[1],'error':self.last_error}

    def plan(self, times, revision):
        with self.vault.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row=db.execute('SELECT revision FROM vault WHERE id=1').fetchone()
            if not row or row[0]!=revision:
                raise VaultError(409,'Neuere Daten auf dem Server. Bitte neu laden und erneut entsperren.')
            replace_plan(db,times,revision)
        return self.config()

    def subscribe(self, subscription):
        if not self.available:raise VaultError(503,'Hintergrund-Push ist auf dem Server nicht verfügbar')
        subscription=validate_subscription(subscription)
        device=hashlib.sha256(subscription['endpoint'].encode()).hexdigest()
        with self.vault.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            count=db.execute('SELECT COUNT(*) FROM push_devices').fetchone()[0]
            if count>=20 and not db.execute('SELECT id FROM push_devices WHERE id=?',(device,)).fetchone():
                raise VaultError(400,'Maximal 20 Push-Geräte erlaubt')
            db.execute('INSERT INTO push_devices VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET subscription=excluded.subscription',(device,json.dumps(subscription),int(time.time())))
            times=json.loads(db.execute('SELECT times FROM push_plan WHERE id=1').fetchone()[0])
            db.executemany('INSERT OR IGNORE INTO push_jobs(device,at) VALUES (?,?)',((device,at) for at in times if at>=time.time()-300))
        return {'deviceId':device,**self.config()}

    def unsubscribe(self, endpoint):
        if not isinstance(endpoint,str):raise VaultError(400,'Push-Endpunkt erforderlich')
        device=hashlib.sha256(endpoint.encode()).hexdigest()
        with self.vault.connect() as db:
            db.execute('DELETE FROM push_jobs WHERE device=?',(device,))
            db.execute('DELETE FROM push_devices WHERE id=?',(device,))
        return {'removed':True}

    def test(self, endpoint):
        if not self.available:raise VaultError(503,'Hintergrund-Push nicht verfügbar')
        device=hashlib.sha256(endpoint.encode()).hexdigest() if isinstance(endpoint,str) else ''
        with self.vault.connect() as db:row=db.execute('SELECT subscription FROM push_devices WHERE id=?',(device,)).fetchone()
        if not row:raise VaultError(404,'Gerät nicht angemeldet')
        try:
            response=self.sender(json.loads(row[0]))
            if response is not None and not 200<=response.status_code<300:raise ValueError()
        except Exception:
            raise VaultError(503,'Push-Dienst hat die Testnachricht nicht angenommen') from None
        return {'accepted':True}

    def tick(self, now=None):
        if not self.available:return
        now=int(time.time()) if now is None else int(now)
        for _ in range(25):
            with self.vault.connect() as db:
                db.execute('BEGIN IMMEDIATE')
                db.execute("DELETE FROM push_jobs WHERE at<?",(now-300,))
                row=db.execute("SELECT j.device,j.at,j.attempts,d.subscription FROM push_jobs j JOIN push_devices d ON d.id=j.device WHERE j.at<=? AND j.next_try<=? AND (j.state='pending' OR (j.state='sending' AND j.lease_until<?)) ORDER BY j.at LIMIT 1",(now,now,now)).fetchone()
                if not row:return
                device,at,attempts,subscription=row
                db.execute("UPDATE push_jobs SET state='sending',lease_until=? WHERE device=? AND at=?",(now+60,device,at))
            code=0
            try:
                response=self.sender(json.loads(subscription))
                code=201 if response is None else response.status_code
            except Exception as error:
                response=getattr(error,'response',None)
                code=response.status_code if response is not None else 0
            with self.vault.connect() as db:
                if code in (404,410):
                    db.execute('DELETE FROM push_jobs WHERE device=?',(device,))
                    db.execute('DELETE FROM push_devices WHERE id=?',(device,))
                elif 200<=code<300:
                    db.execute("UPDATE push_jobs SET state='sent',lease_until=0 WHERE device=? AND at=?",(device,at))
                    self.last_error=None
                else:
                    attempts+=1
                    db.execute("UPDATE push_jobs SET state=?,attempts=?,next_try=?,lease_until=0 WHERE device=? AND at=?",('failed' if attempts>=5 else 'pending',attempts,now+min(30*2**(attempts-1),300),device,at))
                    self.last_error='Ein Push-Versand ist fehlgeschlagen. Netzwerk/VAPID-Konfiguration prüfen.'

    def start(self):
        if not self.available:return
        def run():
            while not self.stopped.is_set():
                try:self.tick()
                except Exception:LOG.warning('Push-Zeitplaner vorübergehend nicht verfügbar')
                self.stopped.wait(15)
        self.thread=threading.Thread(target=run,name='klassenbuch-push',daemon=True)
        self.thread.start()

    def stop(self):
        self.stopped.set()
        if self.thread:self.thread.join(timeout=12)
