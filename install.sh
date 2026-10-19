#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"
for tool in python3 systemctl; do command -v "$tool" >/dev/null || { echo "Fehlt: $tool" >&2; exit 1; }; done
[[ -d /run/systemd/system ]] || { echo 'Für die Installation ist Linux mit systemd erforderlich.' >&2; exit 1; }
# These characters cannot safely be inserted into a systemd ExecStart path.
[[ "$ROOT_DIR" =~ ^/[a-zA-Z0-9_./-]+$ ]] || { echo 'Installationspfad darf nur Buchstaben, Ziffern, _, ., / und - enthalten.' >&2; exit 1; }
as_root() { if [[ "$(id -u)" == 0 ]]; then "$@"; else sudo "$@"; fi; }
python3 -m unittest discover -s tests -p 'test_*.py'
if command -v node >/dev/null; then node --check dist/app.js; node test.cjs; fi
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
ExecStart=$(command -v python3) $ROOT_DIR/server.py --bind 0.0.0.0 --port 8085
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
for attempt in range(30):
    try:
        with urllib.request.urlopen('http://127.0.0.1:8085/healthz', timeout=1) as r:
            if r.read() == b'klassenbuch ok\n': break
    except OSError: pass
    time.sleep(.25)
else: raise SystemExit('Dienst nicht erreichbar. Prüfen: sudo journalctl -u klassenbuch -n 50')
PY
as_root systemctl is-active --quiet klassenbuch.service
echo 'Klassenbuch ist bereit: http://meinservername:8085 (Servername/DNS und Firewall prüfen).'
