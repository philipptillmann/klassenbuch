#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"
for tool in git flock; do command -v "$tool" >/dev/null || { echo "Fehlt: $tool" >&2; exit 1; }; done
exec 9> "$ROOT_DIR/.update.lock"
flock -n 9 || { echo 'Ein Update läuft bereits.' >&2; exit 1; }
[[ "$(git branch --show-current)" == Server ]] || { echo 'Abbruch: Branch Server erforderlich.' >&2; exit 1; }
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || { echo 'Abbruch: Lokale Änderungen zuerst sichern oder committen.' >&2; exit 1; }
git fetch origin Server
git merge --ff-only FETCH_HEAD
# Interpret scripts explicitly so installation also works from an unpacked archive.
exec bash "$ROOT_DIR/install.sh"
