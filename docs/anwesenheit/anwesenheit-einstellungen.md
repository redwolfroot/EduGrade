---
sidebar_position: 3
title: Anwesenheitseinstellungen
---

# Anwesenheitseinstellungen

Sie können Anwesenheitsregeln global und pro Fach konfigurieren.

## Globale Einstellungen

Unter **Einstellungen** → **Anwesenheit** legen Sie die Standardwerte fest:

- **Mindestanwesenheit** — z.B. 75%
- **Warnschwelle** — z.B. 5% (Warnung ab 80% bei 75% Minimum)

Diese Werte gelten als Standardvorgabe für alle Fächer, die keine eigenen Einstellungen haben.

## Fachspezifische Einstellungen

Jedes Fach kann eigene Anwesenheitsregeln haben, die beim [Hinzufügen](../faecher/fach-hinzufuegen.md) oder [Bearbeiten](../faecher/fach-bearbeiten.md) eines Fachs konfiguriert werden:

- **Mindestanwesenheit** — Individuell pro Fach
- **Warnschwelle** — Individuell pro Fach
- **Automatische Benotung** — Schüler unter Minimum erhalten automatisch Note 5

## Automatische Benotung

Wenn die automatische Benotung für ein Fach aktiviert ist:

1. Fällt ein Schüler unter die Mindestanwesenheit
2. Wird automatisch die Note **5 (Nicht genügend)** vergeben
3. Dies geschieht ohne manuelle Eingabe

![Anwesenheitseinstellungen](/img/attendance-settings.png)

:::warning Achtung
Die automatische Benotung greift sofort, wenn ein Schüler unter den Schwellenwert fällt. Prüfen Sie die Einstellungen sorgfältig.
:::

## Farbliche Warnungen

Die Anwesenheitsanzeige verwendet ein Ampelsystem:

| Zustand | Farbe | Beispiel (75% Minimum, 5% Warnschwelle) |
|---------|-------|----------------------------------------|
| Über Warnschwelle | 🟢 Grün | ≥ 80% Anwesenheit |
| Im Warnbereich | 🟡 Gelb | 75–79% Anwesenheit |
| Unter Minimum | 🔴 Rot | < 75% Anwesenheit |
