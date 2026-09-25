---
sidebar_position: 2
title: Schüler importieren (CSV)
---

# Schüler importieren

Sie können mehrere Schüler auf einmal über eine CSV-Datei importieren.

## CSV-Vorlage herunterladen

1. Klicken Sie auf **Schüler importieren**
2. Wählen Sie **CSV-Vorlage herunterladen**

Die Vorlage enthält die korrekte Spaltenstruktur mit Beispieldaten.

## CSV-Datei vorbereiten

Ihre CSV-Datei sollte folgende Spalten enthalten:

```
Vorname;Nachname;Zweiter Vorname
Max;Mustermann;
Anna;Musterfrau;Maria
```

### Unterstützte Formate

- **Trennzeichen**: Komma (`,`) oder Semikolon (`;`) — wird automatisch erkannt
- **Kopfzeile**: Wird automatisch erkannt und zugeordnet
- **Maximale Dateigröße**: 5 MB

## Import durchführen

1. Klicken Sie auf **Schüler importieren**
2. Wählen Sie Ihre CSV-Datei aus
3. Prüfen Sie die **Vorschau** — hier sehen Sie alle erkannten Schüler
4. Duplikate werden markiert und können übersprungen werden
5. Klicken Sie auf **Importieren**

![CSV-Import Vorschau](/img/csv-import-preview.png)

:::info Hinweis
Bereits vorhandene Schüler (gleicher Vor- und Nachname) werden automatisch erkannt und mit einer Warnung versehen. Diese werden beim Import übersprungen.
:::
