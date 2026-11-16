"""Run after docker build -t klassenbuch:local .; uses only isolated Docker resources."""
import subprocess, json, time, uuid
from pathlib import Path
name = 'klassenbuch-qa-' + uuid.uuid4().hex[:10]
volume = name + '-data'
def docker(*args):
    return subprocess.check_output(['docker', *args], text=True).strip()
def execute(code):
    return docker('exec', name, 'python', '-c', code)
def start():
    docker('run','-d','--name',name,'--read-only','--cap-drop=ALL','--security-opt=no-new-privileges:true','--tmpfs','/tmp:size=16m,mode=1777','-v',volume+':/var/lib/klassenbuch','klassenbuch:local')
    for _ in range(40):
        if json.loads(docker('inspect',name))[0]['State']['Health']['Status'] == 'healthy': return
        time.sleep(1)
    raise AssertionError(docker('logs',name))
try:
    docker('volume','create',volume)
    start()
    execute("import os; from pathlib import Path; assert os.getuid()==1000; assert not Path('/app/.env').exists(); assert not Path('/app/.git').exists(); assert not Path('/app/tests').exists()")
    key = execute("from pathlib import Path; import hashlib; print(hashlib.sha256(Path('/var/lib/klassenbuch/vapid-private.pem').read_bytes()).hexdigest())")
    execute('''import json, base64, urllib.request, urllib.error
from pathlib import Path
origin='http://127.0.0.1:8085'
token=base64.b64encode(b't'*32).decode()
envelope={'v':1,'salt':base64.b64encode(b's'*16).decode(),'iv':base64.b64encode(b'i'*12).decode(),'cipher':base64.b64encode(b'ciphertext'*4).decode()}
headers={'Content-Type':'application/json','Authorization':'Bearer '+token,'X-Setup-Token':Path('/var/lib/klassenbuch/setup-token').read_text().strip(),'Origin':origin}
r=urllib.request.urlopen(urllib.request.Request(origin+'/api/vault',data=json.dumps({'envelope':envelope}).encode(),headers=headers,method='POST')); assert r.status==201
assert not Path('/var/lib/klassenbuch/setup-token').exists()
for path in ['/api/vault','/vault.sqlite3','/setup-token','/vapid-private.pem','/.env']:
    try: urllib.request.urlopen(origin+path); raise AssertionError(path)
    except urllib.error.HTTPError as e: assert e.code==(401 if path=='/api/vault' else 404)
''')
    docker('rm','-f',name)
    start()
    assert key == execute("from pathlib import Path; import hashlib; print(hashlib.sha256(Path('/var/lib/klassenbuch/vapid-private.pem').read_bytes()).hexdigest())")
    execute('''import base64,json,urllib.request
from pathlib import Path
headers={'Authorization':'Bearer '+base64.b64encode(b't'*32).decode()}
r=json.load(urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8085/api/vault',headers=headers)))
assert r['revision']==1 and r['envelope']['cipher']==base64.b64encode(b'ciphertext'*4).decode()
assert not Path('/var/lib/klassenbuch/setup-token').exists()
assert Path('/var/lib/klassenbuch/vault.sqlite3').stat().st_mode&0o777==0o600
''')
    print('PASS: non-root read-only container, setup/auth/access protection, ciphertext and VAPID persistence across recreation')
finally:
    subprocess.run(['docker','rm','-f',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    subprocess.run(['docker','volume','rm',volume],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
