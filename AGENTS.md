# Projektregeln

- Die App heißt Klassenbuch. Deployment-Branch: `Server`.
- Für jeden neuen Feature Request vor der Umsetzung ein GitHub-Issue anlegen oder ein passendes vorhandenes Issue verwenden.
- Issue im Commit referenzieren; nach Push der fertigen Implementierung mit Commit-Link schließen. Fehler oder ausstehende Akzeptanzkriterien offen lassen.
- Keine Passwörter, Schlüssel, Schülerdaten oder Backups ins Repository aufnehmen.
- Datenformat `stundenbuch.v1` aus Kompatibilitätsgründen erhalten. Änderungen an Kryptografie mit Interoperabilitätstests absichern.
- Server liefert öffentliche App-Assets und eine authentifizierte API für verschlüsselte Daten. Passwörter und Entschlüsselungsschlüssel dürfen den Browser nicht verlassen. Datenbank und Einrichtungsschlüssel niemals statisch ausliefern.
- Vor Push: `node --check dist/app.js`, `node --check dist/records.js`, `node test.cjs`, `node tests/records.cjs`, `node tests/exports-reminders.cjs`, `python3 -m unittest discover -s tests` und `bash -n install.sh update.sh`.
- Bei Änderungen an Kartenbewertung, Fehlzeiten und Noten zusätzlich `tests/browser.cjs` mit Desktop und `HTTP_FALLBACK=1 MOBILE=1` prüfen, wenn Chromium/Playwright verfügbar sind.

- Bei Änderungen am Serverspeicher oder Zugriffsschutz zusätzlich `tests/storage-browser.cjs` (auch `TEST_HTTPS=1` und `HTTP_FALLBACK=1 MOBILE=1`) ausführen. Tests nutzen ausschließlich temporäre isolierte Server.

- Freigabe zu #16 am 21.10.2026: Reine Erinnerungstermine und gerätespezifische Push-Abonnements dürfen auf dem Server liegen. Namen, Kursinhalte, Passwort und Entschlüsselungsschlüssel bleiben ausschließlich im verschlüsselten Bestand bzw. im Browser-RAM.
