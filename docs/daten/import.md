---
sidebar_position: 2
title: Daten importieren
---

# Daten importieren

Stellen Sie Ihre Daten aus einem zuvor erstellten Backup wieder her.

:::info Wann ist der Import verfügbar?
Der Import ist nur im **Einrichtungsbildschirm** (Setup Screen) verfügbar — also beim ersten Login nach der Registrierung oder nachdem Sie alle Daten gelöscht haben (**Einstellungen** → **Alle Daten löschen**).
:::

## Import durchführen

1. Melden Sie sich an oder löschen Sie alle Daten unter **Einstellungen** → **Alle Daten löschen**
2. Auf dem **Einrichtungsbildschirm** klicken Sie auf **Backup importieren**
3. Wählen Sie Ihre JSON-Backup-Datei aus (max. 5 MB)
4. EduGrade prüft die Datei auf Gültigkeit
5. Bestätigen Sie den Import

![Daten importieren](/img/import-data.png)

## Was passiert beim Import?

- Die importierten Daten **ersetzen** Ihre aktuellen Daten
- Der Import wird verschlüsselt gespeichert
- Ein Fortschrittsbalken zeigt den Status an

:::danger Achtung
Der Import überschreibt alle aktuellen Daten. Erstellen Sie vorher ein [Backup](export.md), wenn Sie die aktuellen Daten behalten möchten.
:::

## Fehlerbehandlung

Falls die Datei ungültig ist oder ein Fehler auftritt:

- EduGrade zeigt eine Fehlermeldung an
- Ihre bestehenden Daten bleiben unverändert
- Prüfen Sie, ob die Datei eine gültige EduGrade-Exportdatei ist
