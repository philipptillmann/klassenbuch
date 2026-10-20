# Klassenbuch

Lehrer-App für Klassen, Kurse, Schülerlisten, Stundenplan, Mitarbeit, Schulnoten und Fehlzeiten. Der Branch **Server** enthält die installierbare Version.

## Installation und Update

Voraussetzungen: Linux mit systemd, Python ab 3.9, Git, Bash, `flock` (util-linux), sudo-Rechte oder root. Node und Docker sind für den Betrieb nicht erforderlich. Port 8085 muss frei sein.

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
python3 server.py --bind 127.0.0.1 --port 8085 --data-dir /pfad/zum/klassenbuch-speicher
```

Ohne `--data-dir` verwendet der manuelle Start `KLASSENBUCH_DATA_DIR`, andernfalls `~/.local/share/klassenbuch`. Dort liegt auch der einmalige `setup-token`. Die UI nennt standardmäßig den systemd-Pfad. Der Datenpfad muss dauerhaft beschreibbar sein.

`update.sh` holt ausschließlich Fast-Forward-Änderungen von `origin/Server`, blockiert parallele Updates und bricht bei lokalen Änderungen an versionierten Dateien ab. Danach laufen Prüfungen und ein Dienstneustart. Kein automatischer Reset oder Rollback. Die systemd-Installation erfolgt auf dem Zielserver und wurde in der Entwicklungsumgebung ohne systemd nicht ausgeführt.

## Daten und Verschlüsselung

**Der Server speichert nur den verschlüsselten Datenbestand in `/var/lib/klassenbuch/vault.sqlite3`.** Klassen, Namen, Kommentare, Fehlzeiten und Noten werden vor dem Upload im Browser gemeinsam per AES-256-GCM verschlüsselt. Passwort und Entschlüsselungsschlüssel verlassen den Browser nicht und werden dort nur im Arbeitsspeicher gehalten. Nach fünf Minuten ohne Eingabe sperrt sich die App.

Das portable Datenformat bleibt `v:1` mit Salt, IV und Ciphertext. Schlüsselableitung: PBKDF2-HMAC-SHA-256 mit 600.000 Iterationen und zufälligem 16-Byte-Salt. Jede Speicherung verwendet einen neuen zufälligen 12-Byte-IV und einen 128-Bit-Authentifizierungstag. Zufallswerte kommen aus `crypto.getRandomValues`. Alte Backups bleiben lesbar.

Für den Serverzugriff wird separat ein 256-Bit-Zugriffstoken aus dem Passwort abgeleitet: PBKDF2-HMAC-SHA-256, ebenfalls 600.000 Iterationen, aber mit dem getrennten Salt `UTF8("klassenbuch-server-auth-v1:") || Salt`. Dieser Token kann die Daten nicht entschlüsseln. Er wird ausschließlich über HTTPS übertragen, nur im Browser-RAM gehalten und serverseitig nur als SHA-256-Prüfwert gespeichert. Salt und Versionsinformationen sind vor dem Entsperren öffentlich; der verschlüsselte Datenbestand und Schreibzugriffe benötigen den Zugriffstoken. Es gibt keine persistierenden Anmelde-Cookies oder im Browser gespeicherte Schlüssel.

Die SQLite-Datenbank liegt in einem Verzeichnis mit Modus 0700, die Datei hat Modus 0600. Datenbank und Einrichtungsschlüssel werden niemals als Web-Dateien ausgeliefert. SQLite-Transaktionen sichern Schreibvorgänge ab. Eine Revision schützt vor verloren gehenden Änderungen: Wer einen alten Stand geöffnet hat, erhält beim Speichern einen Konflikt und muss neu laden und erneut entsperren. Andere Geräte laden neue Änderungen beim Entsperren/Neuladen; es gibt keine Live-Zusammenarbeit. Bei Verbindungsfehlern wird ein Speichern als fehlgeschlagen gemeldet und die versuchte Änderung zurückgenommen. Es gibt keinen Offline-Browser-Fallback.

Ohne Passwort gibt es keine Wiederherstellung. Ein kompromittierter Server könnte veränderten JavaScript-Code ausliefern; ein entsperrtes oder kompromittiertes Gerät kann die Daten lesen. Die Architektur schützt den gespeicherten Datenbestand, stellt aber keine unabhängige Sicherheitsprüfung dar.

### Backups

Unter **Datenschutz → Verschlüsseltes Backup** wird der aktuelle verschlüsselte Serverbestand als Datei exportiert. Die Datei benötigt das Passwort, aber keinen Zugriffstoken. Beim Import in ein bereits entsperrtes Server-Klassenbuch wird der Inhalt mit dessen bestehendem Schlüssel neu verschlüsselt; das Serverpasswort ändert sich nicht. Beim Import in eine leere Installation wird das Backup-Passwort zum Serverpasswort.

Regelmäßig Backups exportieren und zusätzlich das Server-Datenverzeichnis sichern. Für eine konsistente Dateisicherung entweder den Dienst während der Kopie stoppen oder die SQLite-Backup-Funktion verwenden. Ein Systembackup muss Datenbank und gegebenenfalls noch vorhandenen Einrichtungsschlüssel enthalten. Niemals eine Datenbank ins Git-Repository legen.

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

Die App verwendet dabei denselben HTTPS-Server und Passwortschutz. Es werden keine entschlüsselten Daten für Offline-Nutzung gecacht. Eine Installation allein aktiviert keinen Push bei geschlossener App; die Einschränkung aus Issue #16 bleibt bestehen. Die Icons lassen sich bei Bedarf mit `node scripts/generate-icons.cjs` aus dem SVG neu erzeugen (nur dafür Playwright/Chromium nötig).

## CSV-Export

Unter **Datenschutz → Unverschlüsselte CSV exportieren** steht ein lesbarer Export des aktuellen Serverbestands bereit. Enthalten sind aktuelle Schülerlisten (auch ohne Bewertung), Mitarbeit mit Punktwerten, Kommentare, Fehlzeiten und sämtliche Schulnoten einschließlich vorläufiger und Halbjahresnoten. Historische Einträge entfernter Schüler bleiben enthalten. Der Wochenstundenplan und Erinnerungseinstellungen sind nicht Teil dieses Tabellenexports.

Die Datei verwendet UTF-8 mit BOM, Semikolon als Trennzeichen sowie korrekt maskierte Anführungszeichen und mehrzeilige Kommentare. Textfelder mit möglichen Tabellenformeln werden mit einem führenden Apostroph geschützt; numerische Noten/Punkte bleiben Zahlen. CSV ist **nicht verschlüsselt** und kein vollständiges Wiederherstellungs-Backup. Vor dem Download wird darauf hingewiesen. Für Sicherung/Wiederherstellung weiterhin das verschlüsselte Backup verwenden.

Doppelte Bewertungssymbole werden als **+ +** und **− −** angezeigt (Karten, Auswahlfelder, Stundenverlauf, Bilanz und CSV). Die numerischen Werte und vorhandenen Daten ändern sich dadurch nicht.

## Erinnerungen (erste Umsetzung von Issue #16)

Unter **Erinnerungen** kann auf diesem Gerät die Browser-Berechtigung angefordert und eine Testnachricht angezeigt werden. Zur Auswahl stehen 0, 5, 10 oder 15 Minuten nach Stundenende oder eine tägliche Uhrzeit an Tagen mit Unterricht. Das Ende wird aus Beginn + Dauer im Stundenplan ermittelt; neue Einträge bieten eine Dauer-Eingabe, vorhandene Einträge werden mit 45 Minuten behandelt. Zeitberechnung erfolgt in der lokalen Zeitzone des jeweiligen Geräts.

Die Einstellungen werden mit dem Datenbestand verschlüsselt gespeichert. Die Berechtigung muss pro Gerät erteilt werden. Nachrichten enthalten keine Namen oder Kursdaten. Der Zeitplaner läuft nur in der geöffneten, entsperrten App; nach der Sperre wird er gestoppt. Hintergrund-Tabs können vom Browser verzögert werden. Bis zu fünf Minuten verspätete Erinnerungen werden nachgeholt, ältere verworfen. Gleichzeitige Termine werden gebündelt, doppelte Nachrichten während derselben entsperrten Sitzung vermieden. Ohne Stundenplantermine oder bei deaktivierten/blockierten Benachrichtigungen gibt es keine Nachrichten.

**Push bei geschlossener oder gesperrter App ist noch offen.** Der Service Worker zeigt ausschließlich vom geöffneten Fenster ausgelöste Nachrichten an und verarbeitet Klicks; er enthält weder Schlüssel noch Stundenplan und ist kein Hintergrund-Zeitplaner. Der Server kann den verschlüsselten Stundenplan nicht auswerten. Für echte zeitgesteuerte Web-Push-Nachrichten müsste der Browser dem Server zusätzliche Erinnerungstermine (ohne Namen/Kursinhalte) und Push-Abonnements übermitteln oder eine andere Hintergrundlösung gewählt werden. Die dafür nötige Datenschutzentscheidung wird in Issue #16 dokumentiert; das Issue bleibt offen. Es werden bislang keine separaten Terminmetadaten oder Push-Abonnements an den Server übertragen.

## Prüfungen

```bash
node --check dist/app.js
node --check dist/records.js
node test.cjs
node tests/records.cjs
node tests/exports-reminders.cjs
python3 -m unittest discover -s tests
bash -n install.sh update.sh
```

Geprüft: Kryptografie, native/Fallback-Kompatibilität und getrennte Authentifizierungsableitung, fachliche Datenoperationen, API-Zugriffsschutz, Einrichtung, Revisionen, Verzeichnisrechte und Persistenz nach Neustart. Der Installer führt Python-Tests und, falls Node verfügbar ist, die JS-Tests aus.

Optionale Browser-Durchläufe benötigen Playwright und Chromium (nicht für den Betrieb nötig). Sie starten selbst isolierte Testserver mit temporären Datenverzeichnissen:

```bash
node tests/review-browser.cjs
node tests/browser.cjs
HTTP_FALLBACK=1 MOBILE=1 node tests/browser.cjs
node tests/storage-browser.cjs
HTTP_FALLBACK=1 MOBILE=1 node tests/storage-browser.cjs
TEST_HTTPS=1 node tests/storage-browser.cjs
```

Der zusätzliche `review-browser`-Test prüft den CSV-Download mit einem echten CSV-Parser, getrennte Doppelzeichen, verschlüsselte Erinnerungseinstellungen und die Service-Worker-Benachrichtigung.

Der HTTPS-Test benötigt zusätzlich `openssl` und simuliert einen lokalen TLS-Reverse-Proxy. Geprüft werden Migration, ein unabhängiges zweites Gerät, falsche Passwörter, Schreibkonflikte, Netzwerkausfälle, Backups mit anderem Passwort und ausschließlich verschlüsselte Speicherung. `CHROMIUM_PATH` und `PLAYWRIGHT_MODULE` passen Chromium-Datei bzw. Playwright-Modul an.

## Feature Requests

Jeder Feature Request erhält vor der Umsetzung ein GitHub-Issue. Nach Umsetzung, passenden Prüfungen und Push auf `Server` wird es mit Commit-Verweis geschlossen. Regeln: `AGENTS.md`; Vorlage: `.github/ISSUE_TEMPLATE/`.

## Drittanbieter

`dist/sjcl.js`: Stanford Javascript Crypto Library aus https://github.com/bitwiseshiftleft/sjcl/blob/master/sjcl.js (Blob `c3c3ea97712a5f252be850ebcb057fcadfbac2de`). Lizenz: `dist/SJCL-LICENSE.txt`. Lokal eingebunden; keine externen Laufzeitabfragen oder Nutzung der eingebauten Passwort-Caches/des SJCL-Zufallsgenerators. Native Web Crypto wird bevorzugt; der Fallback bleibt kompatibel.
