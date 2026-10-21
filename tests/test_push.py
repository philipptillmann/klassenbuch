import base64
from pathlib import Path
import json
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from vault import Vault, VaultError
from push_service import PushService, validate_subscription, MESSAGE


def b64(value):return base64.urlsafe_b64encode(value).rstrip(b'=').decode()
def subscription(suffix='test'):
    return {'endpoint':'https://updates.push.services.mozilla.com/wpush/v2/'+suffix,'keys':{'p256dh':b64(b'\x04'+b'A'*64),'auth':b64(b'B'*16)}}
def envelope():return {'v':1,'salt':base64.b64encode(b's'*16).decode(),'iv':base64.b64encode(b'i'*12).decode(),'cipher':base64.b64encode(b'ciphertext'*4).decode()}


class PushTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.vault=Vault(self.temp.name);self.now=int(time.time())
        self.token=base64.b64encode(b't'*32).decode()
        self.vault.create(envelope(),self.token,self.vault.setup_path.read_text().strip())
        self.sent=[]
        self.service=PushService(self.vault,enabled=False,sender=lambda sub:self.sent.append(sub))
        self.service.available=True

    def register(self):return self.service.subscribe(subscription())['deviceId']

    def test_persistent_dispatch_without_browser_or_password_and_no_duplicates(self):
        self.register();self.service.plan([self.now],1)
        restarted=PushService(Vault(self.temp.name),enabled=False,sender=lambda sub:self.sent.append(sub));restarted.available=True
        restarted.tick(self.now);restarted.tick(self.now+1)
        self.assertEqual(len(self.sent),1)
        with self.vault.connect() as db:self.assertEqual(db.execute('SELECT state FROM push_jobs').fetchone()[0],'sent')
        restarted.plan([self.now,self.now+60],1);restarted.tick(self.now+1)
        self.assertEqual(len(self.sent),1)

    def test_changes_disable_all_devices_atomically_and_keep_ciphertext(self):
        self.register();self.service.subscribe(subscription('second'))
        self.vault.write(envelope(),self.token,'1',[self.now+30])
        with self.vault.connect() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM push_jobs').fetchone()[0],2)
        self.vault.write(envelope(),self.token,'2',[])
        self.service.tick(self.now+31);self.assertFalse(self.sent)
        self.assertEqual(self.vault.read(self.token)['envelope'],envelope())

    def test_bad_metadata_rolls_back_vault_revision(self):
        for times in [[self.now+400*86400],['a course name'],{},[True]]:
            with self.assertRaises(VaultError):self.vault.write(envelope(),self.token,'1',times)
            self.assertEqual(self.vault.read(self.token)['revision'],1)
        with self.assertRaises(VaultError):self.service.plan([],0)

    def test_transient_retry_and_expired_subscription_cleanup(self):
        device=self.register();self.service.plan([self.now],1)
        class Response:status_code=503
        self.service.sender=lambda sub:Response()
        self.service.tick(self.now)
        with self.vault.connect() as db:self.assertEqual(db.execute('SELECT attempts FROM push_jobs').fetchone()[0],1)
        self.service.sender=lambda sub:self.sent.append(sub)
        self.service.tick(self.now+1);self.assertEqual(len(self.sent),0)
        self.service.tick(self.now+31);self.assertEqual(len(self.sent),1)
        self.service.plan([self.now+40],1)
        class Gone:status_code=410
        self.service.sender=lambda sub:Gone()
        self.service.tick(self.now+41)
        with self.vault.connect() as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM push_devices').fetchone()[0],0)

    def test_unsubscribe_and_expired_jobs_do_not_send(self):
        self.register();self.service.plan([self.now],1)
        self.service.unsubscribe(subscription()['endpoint']);self.service.tick(self.now)
        self.assertFalse(self.sent)
        self.register();self.service.tick(self.now+301)
        self.assertFalse(self.sent)

    def test_expired_worker_lease_is_recovered(self):
        self.register();self.service.plan([self.now],1)
        with self.vault.connect() as db:db.execute("UPDATE push_jobs SET state='sending',lease_until=?",(self.now+60,))
        self.service.tick(self.now);self.assertFalse(self.sent)
        self.service.tick(self.now+61);self.assertEqual(len(self.sent),1)

    def test_provider_allowlist_and_metadata_validation(self):
        for endpoint in ['http://updates.push.services.mozilla.com/x','https://127.0.0.1/x','https://169.254.169.254/latest','https://evil.example/x','https://user:pass@fcm.googleapis.com/x','https://fcm.googleapis.com:8080/x']:
            with self.subTest(endpoint=endpoint),self.assertRaises(VaultError):validate_subscription({**subscription(),'endpoint':endpoint})
        with self.assertRaises(VaultError):validate_subscription({**subscription(),'course':'plaintext'})
        with self.assertRaises(VaultError):validate_subscription({**subscription(),'keys':{'auth':'bad','p256dh':'bad'}})


class PushCryptoTests(unittest.TestCase):
    def setUp(self):
        try:
            import pywebpush
        except ImportError:self.skipTest('Web-Push dependencies not installed; run venv tests')
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.vault=Vault(self.temp.name)

    def test_real_webpush_encryption_vapid_and_key_persistence(self):
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.hazmat.primitives.serialization import Encoding,PublicFormat
        from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
        from cryptography.hazmat.primitives import hashes
        from py_vapid import Vapid
        import http_ece
        from requests import Response
        private=ec.generate_private_key(ec.SECP256R1());auth=b'B'*16
        sub=subscription();sub['keys']['p256dh']=b64(private.public_key().public_bytes(Encoding.X962,PublicFormat.UncompressedPoint))
        service=PushService(self.vault);self.assertTrue(service.available)
        first=service.public_key;self.assertEqual(PushService(self.vault).public_key,first)
        self.assertEqual(service.key_path.stat().st_mode & 0o777,0o600)
        response=Response();response.status_code=201
        with patch('requests.sessions.Session.post',return_value=response) as post:
            service.sender(sub)
        kwargs=post.call_args.kwargs
        self.assertFalse(kwargs['allow_redirects'])
        self.assertEqual(kwargs['headers']['content-encoding'],'aes128gcm')
        plain=http_ece.decrypt(kwargs['data'],private_key=private,auth_secret=auth,version='aes128gcm').decode()
        self.assertEqual(json.loads(plain),json.loads(MESSAGE))
        authorization={name.lower():value for name,value in kwargs['headers'].items()}['authorization']
        jwt=authorization.split('t=')[1].split(',')[0]
        def decode(value):return base64.urlsafe_b64decode(value+'='*((-len(value))%4))
        header,claims,signature=jwt.split('.')
        claim=json.loads(decode(claims));self.assertEqual(claim['aud'],'https://updates.push.services.mozilla.com')
        self.assertLessEqual(claim['exp'],int(time.time())+86400)
        raw=decode(signature);signed=encode_dss_signature(int.from_bytes(raw[:32],'big'),int.from_bytes(raw[32:],'big'))
        Vapid.from_file(str(service.key_path)).public_key.verify(signed,(header+'.'+claims).encode(),ec.ECDSA(hashes.SHA256()))

if __name__=='__main__':unittest.main()
