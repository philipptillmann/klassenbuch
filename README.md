# Klassenbuch

Lehrer-App für Klassen, Kurse, Schülerlisten, Stundenplan, Mitarbeit, Schulnoten und Fehlzeiten. Der Branch **Server** enthält die installierbare Version.

## Installation und Update

Voraussetzungen: Linux mit systemd, Python ab 3.9 mit `venv`/pip, Git, Bash, `flock` (util-linux), sudo-Rechte oder root. Node und Docker sind für den Betrieb nicht erforderlich. Port 8085 muss frei sein. Der Installer richtet `.venv` ein und installiert die Web-Push-Abhängigkeiten aus `requirements.txt`; beim ersten Update wird dafür Internetzugang benötigt (unter Debian/Ubuntu ggf. `sudo apt install python3-venv`).

```bash
git clone --branch Server --single-branch https://github.com/philipptillmann/klassenbuch.git ~/klassenbuch
bash ~/klassenbuch/install.sh

# Bestehende Installation aktualisieren:
~/klassenbuch/update.sh
```

Der Installer richtet `klassenbuch.service` ein und aktiviert den Start beim Booten. Der Dienst läuft als der Benutzer, der `install.sh` aufgerufen hat. Code bleibt nur lesbar; `/var/lib/klassenbuch` ist das schreibbare, dauerhafte Datenverzeichnis und liegt außerhalb des Git-Checkouts. Updates löschen oder ersetzen es nicht. Ein bestehender Dienst gleichen Namens wird aktualisiert.

### Bind-Adresse und Port (.env)

Beim ersten Installieren/Update wird eine fehlende `~/klassenbuch/.env` aus `.env.example` angelegt. Eine vorhandene Datei wird niemals überschrieben und bleibt beim Update erhalten. Beispiel:

```dotenv
# Keep loopback when using a reverse proxy on the same host.
KLASSENBUCH_BIND=127.0.0.1
KLASSENBUCH_PORT=8085
```

Den Port dort anpassen, z. B. auf `18085`, und den Dienst neu starten:

```bash
sudo systemctl restart klassenbuch
```

Den Upstream-Port des HTTPS-Reverse-Proxys ebenfalls anpassen. Standard ist jetzt Loopback (`127.0.0.1`), passend für einen Reverse-Proxy auf demselben Host. Wenn der Proxy von einem anderen Host/Container zugreift, eine passende erreichbare Bind-Adresse einstellen; `0.0.0.0` bindet alle IPv4-Schnittstellen. IPv6-Adressen wie `::1` und `::` sind ebenfalls möglich.

Die `.env` wird relativ zum Installationsverzeichnis gelesen, unabhängig vom aktuellen Arbeitsverzeichnis. Werte werden als Daten gelesen und niemals als Shellcode ausgeführt; Kommentare und einfache/doppelte Anführungszeichen sind möglich. Für einen manuellen Start gilt: CLI-Argumente vor Prozessumgebung vor `.env` vor Standardwerten. Der systemd-Dienst liest die Datei direkt; Shell-Variablen des Benutzers beim Aufruf von `install.sh` werden nicht in den Dienst übernommen. Portwerte müssen zwischen 1 und 65535 liegen. `--port 0` ist nur für dynamische Testports vorgesehen.

`.env` wird von Git ignoriert und nicht über HTTP ausgeliefert. `.env.example` enthält nur die Vorlage. Eine Registrierungsvariable ist nicht erforderlich: Klassenbuch verwendet ein gemeinsames verschlüsseltes Klassenbuch ohne zusätzliche Benutzerkonten.

**Die App über die HTTPS-Adresse des bestehenden Reverse-Proxys öffnen.** Außer auf localhost blockiert der Browser einen Serverzugriff über unverschlüsseltes HTTP. Der Proxy muss die gesamte App einschließlich `/api/` weiterleiten, die Header `Host` (mit Port, falls nötig), `Authorization`, `If-Match` und `X-Setup-Token` erhalten und darf API-Antworten nicht cachen. Für große Backups das Proxy-Uploadlimit auf mindestens 20 MiB setzen, z. B. `client_max_body_size 20m` bei nginx. Der Backend-Port sollte nur für den Proxy erreichbar sein. Der Installer ändert weder HTTPS, DNS noch Firewall.

### Einmalige Einrichtung

Vor dem ersten Speichern wird zusätzlich zum Passwort ein Einrichtungsschlüssel benötigt. Dadurch kann ein zufälliger Besucher nicht das noch leere Klassenbuch übernehmen.

```bash
sudo cat /var/lib/klassenbuch/setup-token
```

Den Schlüssel auf der HTTPS-Einrichtungsseite eintragen. Danach entweder ein neues Passwort mit mindestens zwölf Zeichen festlegen oder ein vorhandenes Klassenbuch übernehmen. Der Einrichtungsschlüssel wird nach erfolgreicher Einrichtung entfernt. Weitere Geräte benötigen nur das Passwort. Es gibt ein gemeinsames Klassenbuch pro Serverinstallation, keine getrennten Benutzerkonten.

### Vorhandene Browserdaten übernehmen

Nach dem Update alle bereits geöffneten App-Tabs neu laden. Alte Tabs können noch die bisherige Version mit lokalem Speicher ausführen.

- **Gleiche Adresse wie zuvor:** Die App erkennt den bisherigen Eintrag `stundenbuch.v1`. Einrichtungsschlüssel und bisheriges Passwort eingeben. Die verschlüsselten Daten werden unverändert übertragen, zurückgelesen und erst nach erfolgreicher Prüfung aus diesem Browser entfernt. Vorher kann eine verschlüsselte lokale Sicherung heruntergeladen werden.
- **Neue Adresse, HTTP → HTTPS oder anderer Port:** Browser isolieren ihren lokalen Speicher nach Adresse. Auf der bisherigen Adresse „Bisherige Browserdaten als Backup sichern“ verwenden; das geht auch auf der jetzt gesperrten HTTP-Seite ohne Passworteingabe. Auf der HTTPS-Adresse Einrichtungsschlüssel eintragen und „Verschlüsseltes Backup importieren“ wählen. Das Passwort des Backups wird zum Passwort des neuen Server-Klassenbuchs. Wenn die alte Adresse nicht mehr erreichbar ist, muss sie kurz bereitgestellt werden oder ein bereits exportiertes Backup verwendet werden.
- **Server bereits eingerichtet:** Erst das Server-Klassenbuch entsperren. Unter „Datenschutz“ ein Backup importieren. Der Import ersetzt nach Bestätigung den gesamten Datenbestand; er führt keinen automatischen Merge aus. Das bestehende Serverpasswort bleibt erhalten. Eventuell noch vorhandene lokale Altdaten lassen sich dort als Backup sichern.

Altdaten auf einer anderen Adresse werden nicht automatisch gelöscht. Nach erfolgreicher Kontrolle des Serverbestands können sie dort manuell entfernt werden. Neue Änderungen werden ausschließlich auf dem Server gespeichert, nicht im lokalen Speicher oder Session-Speicher des Browsers.

### Betrieb

```bash
sudo systemctl status klassenbuch
sudo journalctl -u klassenbuch -n 50
sudo systemctl stop klassenbuch
```

Ohne systemd im Vordergrund:

```bash
.venv/bin/python server.py --bind 127.0.0.1 --port 8085 --data-dir /pfad/zum/klassenbuch-speicher
```

Ohne `--data-dir` verwendet der manuelle Start `KLASSENBUCH_DATA_DIR`, andernfalls `~/.local/share/klassenbuch`. Dort liegt auch der einmalige `setup-token`. Die UI nennt standardmäßig den systemd-Pfad. Der Datenpfad muss dauerhaft beschreibbar sein.

`update.sh` holt ausschließlich Fast-Forward-Änderungen von `origin/Server`, blockiert parallele Updates und bricht bei lokalen Änderungen an versionierten Dateien ab. Danach laufen Prüfungen und ein Dienstneustart. Kein automatischer Reset oder Rollback. Die systemd-Installation erfolgt auf dem Zielserver und wurde in der Entwicklungsumgebung ohne systemd nicht ausgeführt.

## Daten und Verschlüsselung

**Der eigentliche Klassenbuch-Datenbestand bleibt verschlüsselt in `/var/lib/klassenbuch/vault.sqlite3`.** Zusätzlich sind nach der Freigabe zu #16 reine Erinnerungstermine und gerätespezifische Push-Abonnements für den Server lesbar; sie enthalten keine Namen oder Kursinhalte. Klassen, Namen, Kommentare, Fehlzeiten und Noten werden vor dem Upload im Browser gemeinsam per AES-256-GCM verschlüsselt. Passwort und Entschlüsselungsschlüssel verlassen den Browser nicht und werden dort nur im Arbeitsspeicher gehalten. Nach fünf Minuten ohne Eingabe sperrt sich die App.

Das portable Datenformat bleibt `v:1` mit Salt, IV und Ciphertext. Schlüsselableitung: PBKDF2-HMAC-SHA-256 mit 600.000 Iterationen und zufälligem 16-Byte-Salt. Jede Speicherung verwendet einen neuen zufälligen 12-Byte-IV und einen 128-Bit-Authentifizierungstag. Zufallswerte kommen aus `crypto.getRandomValues`. Alte Backups bleiben lesbar.

Für den Serverzugriff wird separat ein 256-Bit-Zugriffstoken aus dem Passwort abgeleitet: PBKDF2-HMAC-SHA-256, ebenfalls 600.000 Iterationen, aber mit dem getrennten Salt `UTF8("klassenbuch-server-auth-v1:") || Salt`. Dieser Token kann die Daten nicht entschlüsseln. Er wird ausschließlich über HTTPS übertragen, nur im Browser-RAM gehalten und serverseitig nur als SHA-256-Prüfwert gespeichert. Salt und Versionsinformationen sind vor dem Entsperren öffentlich; der verschlüsselte Datenbestand und Schreibzugriffe benötigen den Zugriffstoken. Es gibt keine persistierenden Anmelde-Cookies oder im Browser gespeicherte Schlüssel.

Die SQLite-Datenbank liegt in einem Verzeichnis mit Modus 0700, die Datei hat Modus 0600. Datenbank und Einrichtungsschlüssel werden niemals als Web-Dateien ausgeliefert. SQLite-Transaktionen sichern Schreibvorgänge ab. Eine Revision schützt vor verloren gehenden Änderungen: Wer einen alten Stand geöffnet hat, erhält beim Speichern einen Konflikt und muss neu laden und erneut entsperren. Andere Geräte laden neue Änderungen beim Entsperren/Neuladen; es gibt keine Live-Zusammenarbeit. Bei Verbindungsfehlern wird ein Speichern als fehlgeschlagen gemeldet und die versuchte Änderung zurückgenommen. Es gibt keinen Offline-Browser-Fallback.

Ohne Passwort gibt es keine Wiederherstellung. Ein kompromittierter Server könnte veränderten JavaScript-Code ausliefern; ein entsperrtes oder kompromittiertes Gerät kann die Daten lesen. Die Architektur schützt den gespeicherten Datenbestand, stellt aber keine unabhängige Sicherheitsprüfung dar.

### Backups

Unter **Datenschutz → Verschlüsseltes Backup** wird der aktuelle verschlüsselte Serverbestand als Datei exportiert. Die Datei benötigt das Passwort, aber keinen Zugriffstoken. Beim Import in ein bereits entsperrtes Server-Klassenbuch wird der Inhalt mit dessen bestehendem Schlüssel neu verschlüsselt; das Serverpasswort ändert sich nicht. Beim Import in eine leere Installation wird das Backup-Passwort zum Serverpasswort.

Regelmäßig Backups exportieren und zusätzlich das Server-Datenverzeichnis sichern. Für eine konsistente Dateisicherung entweder den Dienst während der Kopie stoppen oder die SQLite-Backup-Funktion verwenden. Ein Systembackup muss Datenbank, `vapid-private.pem` und gegebenenfalls noch vorhandenen Einrichtungsschlüssel enthalten. Der VAPID-Schlüssel ist nur der Versandschlüssel für Push, kein Entschlüsselungsschlüssel für Klassenbuchdaten. Geht er verloren, müssen die Geräte für Push neu angemeldet werden. Niemals eine Datenbank ins Git-Repository legen.

## Funktionen

- Klassen/Kurse mit Fach und Schülerlisten anlegen und bearbeiten.
- Wochenstundenplan mit Wochentag, Uhrzeit und Raum.
- Unterrichtsstunden mit Datum und Thema erfassen und Schüler als Karten durchgehen.
- Mitarbeit **++ = 2, + = 1, 0 = 0, − = −1, — = −2**, optionale Kommentare, Zurückgehen und Überspringen.
- Ganze Stunden und einzelne Bewertungen/Kommentare nachträglich bearbeiten.
- Abwesenheit getrennt vom Überspringen erfassen; Fehlzeiten nach Kind gruppiert mit offenen, entschuldigten und unentschuldigten Einträgen. Eine Unterrichtseinheit zählt als eine Fehlstunde.
- Tests/Klassenarbeiten und weitere Leistungen mit Schulnoten 1–6 und optionalen Kommentaren.
- Vorläufige Noten und Halbjahresnoten beider Halbjahre separat hervorheben.
- Jahresbilanz: Mitarbeitsschnitt und Schulnotenschnitt getrennt; Abwesenheiten und Überspringen zählen nicht zur Mitarbeit, Bilanznoten nicht zu den Schnitten. Keine automatische Gesamtnote.

Ein Datenbestand enthält ein Schuljahr. Die Schuljahrbezeichnung archiviert oder filtert keine Daten. Ein anderer Browser öffnet dasselbe Server-Klassenbuch. Frühere übersprungene Karten werden nicht automatisch zu Fehlzeiten. Historische Einträge entfernter Schüler bleiben bearbeitbar.

## App-Logo und PWA

Das Buchlogo ist als `logo.svg` (Oberfläche/Favicon) sowie als PNG in 192×192 und 512×512 verfügbar. Eine separate maskierbare 512×512-Version hat einen durchgehenden Hintergrund und hält das Buchmotiv im sicheren Bereich; für iOS ist ein 180×180-Apple-Touch-Icon enthalten. `manifest.webmanifest` verknüpft Name, Farben, Startadresse und Symbole für die Installation über das Browsermenü („App installieren“/„Zum Home-Bildschirm“).

Die App verwendet dabei denselben HTTPS-Server und Passwortschutz. Es werden keine entschlüsselten Daten für Offline-Nutzung gecacht. Eine PWA-Installation allein aktiviert keine Erinnerungen; jedes Gerät wird unter „Erinnerungen“ für Hintergrund-Push angemeldet. Die Icons lassen sich bei Bedarf mit `node scripts/generate-icons.cjs` aus dem SVG neu erzeugen (nur dafür Playwright/Chromium nötig).

## CSV-Export

Unter **Datenschutz → Unverschlüsselte CSV exportieren** steht ein lesbarer Export des aktuellen Serverbestands bereit. Enthalten sind aktuelle Schülerlisten (auch ohne Bewertung), Mitarbeit mit Punktwerten, Kommentare, Fehlzeiten und sämtliche Schulnoten einschließlich vorläufiger und Halbjahresnoten. Historische Einträge entfernter Schüler bleiben enthalten. Der Wochenstundenplan und Erinnerungseinstellungen sind nicht Teil dieses Tabellenexports.

Die Datei verwendet UTF-8 mit BOM, Semikolon als Trennzeichen sowie korrekt maskierte Anführungszeichen und mehrzeilige Kommentare. Textfelder mit möglichen Tabellenformeln werden mit einem führenden Apostroph geschützt; numerische Noten/Punkte bleiben Zahlen. CSV ist **nicht verschlüsselt** und kein vollständiges Wiederherstellungs-Backup. Vor dem Download wird darauf hingewiesen. Für Sicherung/Wiederherstellung weiterhin das verschlüsselte Backup verwenden.

Doppelte Bewertungssymbole werden als **+ +** und **− −** angezeigt (Karten, Auswahlfelder, Stundenverlauf, Bilanz und CSV). Die numerischen Werte und vorhandenen Daten ändern sich dadurch nicht.

## Erinnerungen und Hintergrund-Web-Push (#16)

### Aktivieren

1. Nach `~/klassenbuch/update.sh` die HTTPS-App neu laden und entsperren.
2. Unter **Erinnerungen** Browser-Benachrichtigungen erlauben und **Hintergrund-Push aktivieren** wählen. Das ist eine Anmeldung nur für dieses Gerät.
3. Erinnerungen einschalten und entweder 0/5/10/15 Minuten nach Stundenende oder eine tägliche Uhrzeit an Unterrichtstagen speichern.
4. Mit **Hintergrund-Push testen** eine Nachricht über den echten Push-Dienst anfordern. „Angenommen“ bestätigt die Annahme durch den Dienst, nicht die sofortige Anzeige auf dem Gerät.

Das Ende einer Stunde ergibt sich aus Beginn + Dauer im Stundenplan (Altbestand: 45 Minuten). Ohne Termine oder bei ausgeschalteten Erinnerungen werden keine zeitgesteuerten Nachrichten geplant. Die Einstellungen bleiben Teil des verschlüsselten Klassenbuchs. Die Push-Berechtigung ist gerätespezifisch. **Dieses Gerät abmelden** entfernt das Abonnement und seine ausstehenden Jobs vom Server sowie aus dem Browser. Andere Geräte bleiben angemeldet. Erinnerungen global ausschalten und speichern leert den gemeinsamen Zeitplan für alle Geräte.

### Technik und Datenschutz

Am 21.10.2026 wurde ausdrücklich freigegeben, reine Erinnerungstermine und Push-Abonnements serverseitig zu speichern. Der Browser berechnet bis zu ein Jahr im Voraus UTC-Zeitstempel und sendet nur diese zusätzlich zum Ciphertext. Namen, Kursinhalte, Passwort und Entschlüsselungsschlüssel werden dabei nicht offengelegt. Aus den Zeitpunkten sind Unterrichtsmuster ableitbar. Die allgemeine Nachricht enthält weder Schüler- noch Kursdaten.

Der Zeitplan wird beim Entsperren und bei jedem Speichern erneuert. Uhrzeiten richten sich nach der lokalen Zeitzone des Geräts, das den Plan zuletzt berechnet hat, einschließlich dessen Sommer-/Winterzeitregeln. Nach über einem Jahr ohne Öffnen läuft der vorausberechnete Plan aus. Der Server übernimmt keine vertraulichen Stundenplanregeln; alle Geräte erhalten den zuletzt freigegebenen Zeitplan.

Änderungen am verschlüsselten Datenbestand und den zugehörigen Terminen werden in einer gemeinsamen SQLite-Transaktion mit Versionsprüfung gespeichert. Push-Anmeldung, Planaktualisierung und Abmeldung erfordern denselben authentifizierten Zugriff wie das Klassenbuch. Der Versand läuft im Serverprozess alle 15 Sekunden und braucht kein offenes oder entsperrtes App-Fenster. Die Warteschlange, Zustellzustände und Abonnements überstehen einen Neustart. Bei vorübergehenden Fehlern folgen begrenzte Wiederholungsversuche; über fünf Minuten alte Jobs werden verworfen. Push-Dienste erhalten eine TTL von fünf Minuten. HTTP 404/410 entfernt abgelaufene Abonnements. HTTPS-Endpunkte sind auf offizielle Browser-Push-Dienste begrenzt; HTTP-Weiterleitungen werden nicht verfolgt.

VAPID-Schlüssel werden automatisch unter `/var/lib/klassenbuch/vapid-private.pem` erzeugt (0600). Sie sind von allen Datenschlüsseln getrennt und bleiben bei Updates erhalten. Nur der öffentliche VAPID-Schlüssel geht an den Browser. `pywebpush` verschlüsselt den Nachrichteninhalt für das jeweilige Abonnement und signiert den Versand. Zulässige optionale `.env`-Einstellungen:

```dotenv
KLASSENBUCH_PUSH_ENABLED=true
# Öffentliche VAPID-Kontaktadresse; alternativ die eigene mailto: Adresse setzen.
KLASSENBUCH_PUSH_SUBJECT=https://github.com/philipptillmann/klassenbuch
```

Nach Änderungen `sudo systemctl restart klassenbuch` ausführen. Bestehende `.env`-Dateien werden nicht ergänzt/überschrieben; die gezeigten Werte sind auch die Standardwerte. Bei `KLASSENBUCH_PUSH_ENABLED=false` stoppt der Serverversand. Die App kann weiterhin lokal erinnern, solange sie geöffnet und entsperrt ist. Der VAPID-Kontakt kann vom Push-Anbieter gelesen werden; dort keine geheimen Daten eintragen.

### Gerätegrenzen

Web Push benötigt HTTPS, einen unterstützten Browser und die Benachrichtigungsberechtigung des Betriebssystems. Auf iPhone/iPad (iOS/iPadOS ab 16.4) muss die App zum Home-Bildschirm hinzugefügt und von dort gestartet werden. Browser, Energiesparmodus, fehlende Verbindung und Betriebssystem können die Anzeige verzögern oder unterdrücken; es gibt keine garantierte Echtzeitzustellung. Der Server muss die HTTPS-Push-Dienste von Google, Mozilla, Apple bzw. Windows erreichen können. Eine vollständig vom Betriebssystem beendete/deaktivierte Browser-Komponente kann abhängig vom Gerät keine Nachrichten empfangen.

Ohne Hintergrund-Anmeldung gibt es den bisherigen lokalen Zeitplaner als Fallback. Er läuft nur in einer geöffneten, entsperrten App und kann durch Hintergrund-Tab-Drosselung verzögert werden. Mit aktiver Hintergrund-Anmeldung wird dieser lokale Wecker auf dem Gerät unterdrückt, um doppelte Nachrichten zu vermeiden. Auch im Hintergrund hält der Service Worker **keinen Passwort-/Zugriffstoken und keinen Entschlüsselungsschlüssel**; beim Öffnen der gesperrten App muss weiterhin das Passwort eingegeben werden.

## Prüfungen

```bash
node --check dist/app.js
node --check dist/records.js
node test.cjs
node tests/records.cjs
node tests/exports-reminders.cjs
.venv/bin/python -m unittest discover -s tests
bash -n install.sh update.sh
```

Geprüft: Kryptografie, native/Fallback-Kompatibilität und getrennte Authentifizierungsableitung, fachliche Datenoperationen, API-Zugriffsschutz, Einrichtung, Revisionen, Verzeichnisrechte und Persistenz nach Neustart. Der Installer führt Python-Tests und, falls Node verfügbar ist, die JS-Tests aus.

Optionale Browser-Durchläufe benötigen Playwright und Chromium (nicht für den Betrieb nötig). Sie starten selbst isolierte Testserver mit temporären Datenverzeichnissen:

```bash
PYTHON_BIN=.venv/bin/python node tests/push-browser.cjs
PYTHON_BIN=.venv/bin/python TEST_HTTPS=1 MOBILE=1 node tests/push-browser.cjs
node tests/review-browser.cjs
node tests/browser.cjs
HTTP_FALLBACK=1 MOBILE=1 node tests/browser.cjs
node tests/storage-browser.cjs
HTTP_FALLBACK=1 MOBILE=1 node tests/storage-browser.cjs
TEST_HTTPS=1 node tests/storage-browser.cjs
```

Der zusätzliche `review-browser`-Test prüft den CSV-Download mit einem echten CSV-Parser, getrennte Doppelzeichen, verschlüsselte Erinnerungseinstellungen und die Service-Worker-Benachrichtigung.

Der HTTPS-Test benötigt zusätzlich `openssl` und simuliert einen lokalen TLS-Reverse-Proxy. Geprüft werden Migration, ein unabhängiges zweites Gerät, falsche Passwörter, Schreibkonflikte, Netzwerkausfälle, Backups mit anderem Passwort und ausschließlich verschlüsselte Speicherung. `CHROMIUM_PATH` und `PLAYWRIGHT_MODULE` passen Chromium-Datei bzw. Playwright-Modul an. `PYTHON_BIN` wählt das Python des Testservers; für Hintergrund-Push `.venv/bin/python` verwenden.

Der Push-Test nutzt ein synthetisches Provider-Abonnement und liefert ein echtes Browser-Push-Ereignis über Chromiums Testprotokoll aus, auch bei gesperrter und geschlossener App. Die Python-Tests prüfen separat die echte pywebpush-Nachrichtenverschlüsselung, Entschlüsselung durch den Empfänger und VAPID-Signatur, außerdem Retry/Neustart/Abmeldung und Metadaten-Zugriffsschutz. Eine Live-Zustellung über ein reales Benutzer-Abonnement bzw. ein physisches iPhone wird damit nicht behauptet; dafür dient „Hintergrund-Push testen“ nach dem Update.

## Feature Requests

Jeder Feature Request erhält vor der Umsetzung ein GitHub-Issue. Nach Umsetzung, passenden Prüfungen und Push auf `Server` wird es mit Commit-Verweis geschlossen. Regeln: `AGENTS.md`; Vorlage: `.github/ISSUE_TEMPLATE/`.

## Drittanbieter

`dist/sjcl.js`: Stanford Javascript Crypto Library aus https://github.com/bitwiseshiftleft/sjcl/blob/master/sjcl.js (Blob `c3c3ea97712a5f252be850ebcb057fcadfbac2de`). Lizenz: `dist/SJCL-LICENSE.txt`. Lokal eingebunden; keine externen Laufzeitabfragen oder Nutzung der eingebauten Passwort-Caches/des SJCL-Zufallsgenerators. Native Web Crypto wird bevorzugt; der Fallback bleibt kompatibel.
