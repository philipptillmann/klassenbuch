#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"
for tool in python3 systemctl; do command -v "$tool" >/dev/null || { echo "Fehlt: $tool" >&2; exit 1; }; done
[[ -d /run/systemd/system ]] || { echo 'Für die Installation ist Linux mit systemd erforderlich.' >&2; exit 1; }
# These characters cannot safely be inserted into a systemd ExecStart path.
[[ "$ROOT_DIR" =~ ^/[a-zA-Z0-9_./-]+$ ]] || { echo 'Installationspfad darf nur Buchstaben, Ziffern, _, ., / und - enthalten.' >&2; exit 1; }
as_root() { if [[ "$(id -u)" == 0 ]]; then "$@"; else sudo "$@"; fi; }
# Local configuration is never overwritten, including during updates.
python3 - <<'PYENV'
from pathlib import Path
from config import load_config
try:
    with Path('.env').open('x', encoding='utf-8') as output:
        output.write(Path('.env.example').read_text(encoding='utf-8'))
except FileExistsError:
    pass
load_config([], environ={})  # Fail before touching the service if settings are invalid.
PYENV
python3 -m unittest discover -s tests -p 'test_*.py'
if command -v node >/dev/null; then node --check dist/app.js; node --check dist/records.js; node test.cjs; node tests/records.cjs; node tests/exports-reminders.cjs; fi
SERVICE_USER="$(id -un)"
SERVICE_GROUP="$(id -gn)"
SERVICE_FILE="$(mktemp)"
trap 'rm -f "$SERVICE_FILE"' EXIT
cat > "$SERVICE_FILE" <<UNIT
[Unit]
Description=Klassenbuch Web-App
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_GROUP
WorkingDirectory=$ROOT_DIR
ExecStart=$(command -v python3) $ROOT_DIR/server.py --data-dir /var/lib/klassenbuch
StateDirectory=klassenbuch
StateDirectoryMode=0700
ReadWritePaths=/var/lib/klassenbuch
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
UMask=0077

[Install]
WantedBy=multi-user.target
UNIT
as_root install -m 0644 "$SERVICE_FILE" /etc/systemd/system/klassenbuch.service
as_root systemctl daemon-reload
as_root systemctl enable klassenbuch.service
as_root systemctl restart klassenbuch.service
python3 - <<'PY'
import time, urllib.request
from config import load_config
health_url = load_config([], environ={}).health_url
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
for attempt in range(30):
    try:
        with opener.open(health_url, timeout=1) as r:
            if r.read() == b'klassenbuch ok\n': break
    except OSError: pass
    time.sleep(.25)
else: raise SystemExit('Dienst nicht erreichbar. Prüfen: sudo journalctl -u klassenbuch -n 50')
PY
as_root systemctl is-active --quiet klassenbuch.service
echo 'Klassenbuch ist bereit. Über die HTTPS-Adresse deines Reverse-Proxys öffnen.'
if [[ -f /var/lib/klassenbuch/setup-token ]] || as_root test -f /var/lib/klassenbuch/setup-token; then
  echo 'Einmaliger Einrichtungsschlüssel: sudo cat /var/lib/klassenbuch/setup-token'
fi
