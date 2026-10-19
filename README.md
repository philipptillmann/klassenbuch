# Klassenbuch

Lehrer-App für Klassen und Kurse, Schülerlisten, Wochenstundenplan und schnelle Mitarbeitserfassung per Karte. Der Branch **Server** enthält die installierbare Version.

## Installation auf dem eigenen Server

Voraussetzungen: Linux mit systemd, Python 3 (ab 3.9), Git, Bash, `flock` (util-linux) sowie sudo-Rechte oder root. Keine Node-Installation und kein Docker erforderlich. Der Port 8085 muss frei sein. Ein vorhandener Dienst gleichen Namens wird durch die Installation aktualisiert.

```bash
git clone --branch Server --single-branch https://github.com/philipptillmann/klassenbuch.git ~/klassenbuch
bash ~/klassenbuch/install.sh
```

Danach im Browser **http://meinservername:8085** öffnen. `meinservername` muss auf die IP des eigenen Servers zeigen; alternativ dessen IP verwenden. Falls eine Firewall aktiv ist, TCP-Port 8085 für die gewünschten Clients freigeben. Die Installation ändert weder DNS noch Firewall.

Das Installationsskript richtet `/etc/systemd/system/klassenbuch.service` ein, startet den Dienst und aktiviert den Start beim Booten. Der Prozess läuft als der Benutzer, der `install.sh` aufgerufen hat. Dateien unter dessen Heimatverzeichnis bleiben für den Dienst nur lesbar.

```bash
# Aktualisieren (bei Bedarf sudo-Passwort für Dienstinstallation/-neustart):
~/klassenbuch/update.sh

# Status und Protokoll:
sudo systemctl status klassenbuch
sudo journalctl -u klassenbuch -n 50

# Stoppen:
sudo systemctl stop klassenbuch
```

`update.sh` lädt ausschließlich Branch `Server` von `origin`, akzeptiert nur Fast-Forward-Updates, blockiert parallele Updates und bricht bei lokalen Änderungen an versionierten Dateien ab. Anschließend laufen Prüfungen und der Dienst wird neu gestartet. Ein Git-Fehler lässt den Updatevorgang abbrechen; es gibt keinen automatischen Reset und keinen automatischen Rollback. Browserdaten werden durch Serverupdates nicht angefasst.

Alternativ ohne systemd im Vordergrund starten:

```bash
cd ~/klassenbuch
python3 server.py --bind 0.0.0.0 --port 8085
```

## Funktionen

- Klassen/Kurse mit Fach und Schülerlisten anlegen und bearbeiten.
- Wochenstundenplan mit Wochentag, Uhrzeit und Raum.
- Eine neue Stunde mit Datum und Thema anlegen und alle Schüler als Karten durchgehen.
- Bewertungen: **++ = 2, + = 1, 0 = 0, − = −1, — = −2**. Zurückgehen und Überspringen möglich.
- Jahresbilanz mit Häufigkeiten, arithmetischem Punkteschnitt und Stundenverlauf. Übersprungene Schüler zählen nicht zum Schnitt. Der Schnitt ist keine Schulnote.
- Passwortsperre, automatische Sperre nach fünf Minuten ohne Eingabe, verschlüsselte Backups.

Ein Datenbestand enthält ein Schuljahr. Eine Änderung der Schuljahrbezeichnung filtert oder archiviert keine Daten. Für ein neues Schuljahr zuerst ein Backup sichern und einen getrennten Browserbereich verwenden.

## Daten und Verschlüsselung

**Die Daten liegen verschlüsselt im Browser, nicht auf dem Server.** Es gibt keine Konten, Serverdatenbank oder automatische Synchronisierung. Ein anderer Browser, ein anderes Gerät oder eine andere URL/Port/Protokoll-Kombination hat einen eigenen Speicher. Für einen Umzug zuerst das Backup unter „Datenschutz“ exportieren und am neuen Ort importieren. Alte Stundenbuch-Backups bleiben kompatibel; der interne Speicherschlüssel `stundenbuch.v1` bleibt erhalten.

Beim ersten Start ein Passwort mit mindestens zwölf Zeichen festlegen. Alle Fachdaten werden gemeinsam mit AES-256-GCM und 128-Bit-Authentifizierungstag verschlüsselt. Schlüsselableitung: PBKDF2-HMAC-SHA-256, 600.000 Iterationen, zufälliges 16-Byte-Salt. Jede Speicherung verwendet einen neuen zufälligen 12-Byte-IV. Zufallswerte kommen ausschließlich aus `crypto.getRandomValues`. Passwort und Schlüssel werden nicht dauerhaft gespeichert. Ohne Passwort gibt es keine Wiederherstellung. Browserdaten löschen bedeutet ohne Backup Datenverlust. Noch nicht gespeicherte Kartenbewertungen liegen nur im Arbeitsspeicher.

Unter HTTPS/localhost wird native Web Crypto verwendet. Auf der gewünschten HTTP-LAN-Adresse wird dieselbe Kryptografie durch die lokal mitgelieferte SJCL-Bibliothek umgesetzt. Die langsamere Passwortableitung läuft in einem Worker. Es gibt keine CDN-, Schrift- oder sonstigen externen Laufzeitabfragen.

**HTTP schützt die Übertragung der App nicht.** Die gespeicherten Daten sind verschlüsselt, ein aktiver Angreifer im Netzwerk könnte aber den ausgelieferten JavaScript-Code verändern und das eingegebene Passwort abgreifen. Für echte Schülerdaten HTTPS über einen vertrauenswürdigen Reverse Proxy vorsehen. Ein entsperrter Browser und ein kompromittiertes Gerät können die Daten anzeigen. Keine unabhängige Sicherheitsprüfung.

## Prüfungen

```bash
node --check dist/app.js
node test.cjs
python3 -m unittest discover -s tests
bash -n install.sh update.sh
```

Geprüft werden verschlüsselte Speicherung, Ablehnung falscher Passwörter und manipulierter Daten, Formatkompatibilität zwischen HTTP-Fallback und Web Crypto, neue IVs und Schnittberechnung. HTTP-Integrationstests prüfen Assets, Sicherheitsheader, Healthcheck und den Ausschluss von Repository-/Backup-Dateien. Das Installationsskript führt Python-Tests und, wenn Node vorhanden ist, die Kryptografietests aus.

Die systemd-Installation muss auf dem Zielserver erfolgen. Sie wurde in der Entwicklungsumgebung ohne systemd nicht ausgeführt; ein vollständiger Browser-End-to-End-Test steht aus.

## Feature Requests

Jeder Feature Request erhält vor der Umsetzung ein GitHub-Issue. Nach Umsetzung, passenden Prüfungen und Push auf `Server` wird es mit Commit-Verweis geschlossen. Die Regeln stehen in `AGENTS.md`, eine Issue-Vorlage liegt unter `.github/ISSUE_TEMPLATE/`.

## Drittanbieter

`dist/sjcl.js`: Stanford Javascript Crypto Library, Original aus https://github.com/bitwiseshiftleft/sjcl/blob/master/sjcl.js (Git-Blob `c3c3ea97712a5f252be850ebcb057fcadfbac2de`). Lizenz: `dist/SJCL-LICENSE.txt`. Unverändert lokal eingebunden; keine Verwendung der eingebauten passwortbasierten Schlüssel-Caches oder des SJCL-Zufallsgenerators.
