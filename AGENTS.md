# Projektregeln

- Die App heißt Klassenbuch. Deployment-Branch: `Server`.
- Für jeden neuen Feature Request vor der Umsetzung ein GitHub-Issue anlegen oder ein passendes vorhandenes Issue verwenden.
- Issue im Commit referenzieren; nach Push der fertigen Implementierung mit Commit-Link schließen. Fehler oder ausstehende Akzeptanzkriterien offen lassen.
- Keine Passwörter, Schlüssel, Schülerdaten oder Backups ins Repository aufnehmen.
- Datenformat `stundenbuch.v1` aus Kompatibilitätsgründen erhalten. Änderungen an Kryptografie mit Interoperabilitätstests absichern.
- Server darf ausschließlich öffentliche App-Assets ausliefern. Kein Datenbank- oder Passwort-Endpunkt.
- Vor Push: `node --check dist/app.js`, `node test.cjs`, `python3 -m unittest discover -s tests` und `bash -n install.sh update.sh`.
