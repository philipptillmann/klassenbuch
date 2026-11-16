#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"
as_root() { if [[ "$(id -u)" == 0 ]]; then "$@"; else sudo "$@"; fi; }
[[ $# == 0 || ( $# == 1 && "$1" == --migrate-systemd ) ]] || { echo 'Aufruf: install-docker.sh [--migrate-systemd]' >&2; exit 1; }
command -v docker >/dev/null || { echo 'Docker Engine und Docker Compose Plugin installieren.' >&2; exit 1; }
docker compose version >/dev/null
docker info >/dev/null
[[ -f .env ]] || cp .env.example .env
# Persist the installation user's IDs for subsequent direct Compose commands.
INSTALL_UID="$(id -u)"
INSTALL_GID="$(id -g)"
if [[ "$INSTALL_UID" == 0 ]]; then INSTALL_UID=1000; INSTALL_GID=1000; fi
for entry in "KLASSENBUCH_UID=$INSTALL_UID" "KLASSENBUCH_GID=$INSTALL_GID"; do
  if ! grep -Eq "^[[:space:]]*(export[[:space:]]+)?${entry%%=*}[[:space:]]*=" .env; then
    printf '\n%s\n' "$entry" >> .env
  fi
done
if [[ ! -d /var/lib/klassenbuch ]]; then
  as_root install -d -m 0700 -o "$INSTALL_UID" -g "$INSTALL_GID" /var/lib/klassenbuch
fi
legacy_active=false
legacy_present=false
if command -v systemctl >/dev/null && systemctl is-active --quiet klassenbuch.service; then
  legacy_active=true
fi
if [[ "$legacy_active" == true ]] || { command -v systemctl >/dev/null && systemctl is-enabled --quiet klassenbuch.service; }; then
  legacy_present=true
  [[ "${1:-}" == --migrate-systemd ]] || { echo 'systemd-Dienst läuft oder ist für den Autostart aktiviert. Zum Umstieg install-docker.sh --migrate-systemd verwenden.' >&2; exit 1; }
fi
# Validate and build before stopping the existing application.
docker compose config --quiet
docker compose build --pull
if [[ "$legacy_present" == true ]]; then
  as_root systemctl stop klassenbuch.service
  # Consistent recovery copy while no process writes to SQLite.
  if ! as_root cp -a /var/lib/klassenbuch "/var/lib/klassenbuch-backup-$(date +%Y%m%d-%H%M%S)-$$"; then
    if [[ "$legacy_active" == true ]]; then as_root systemctl start klassenbuch.service; fi
    exit 1
  fi
fi
if ! docker compose up -d --wait --wait-timeout 90; then
  docker compose logs --tail 50 >&2 || true
  if [[ "$legacy_present" == true ]]; then
    docker compose down
    if [[ "$legacy_active" == true ]]; then as_root systemctl start klassenbuch.service; fi
  fi
  exit 1
fi
if [[ "${1:-}" == --migrate-systemd ]] && command -v systemctl >/dev/null; then
  as_root systemctl disable klassenbuch.service
fi
# update.sh uses this local marker; it is never part of the image or repository.
touch .deployment-docker
echo 'Klassenbuch läuft mit Docker. Updates: ~/klassenbuch/update.sh'
echo 'Ersteinrichtung, falls noch leer: sudo cat /var/lib/klassenbuch/setup-token'
