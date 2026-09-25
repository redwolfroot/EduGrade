---
sidebar_position: 5
title: Plus/Minus-Noten
---

# Plus/Minus-Noten

Neben numerischen Noten (1–5) unterstützt EduGrade auch ein **Plus/Minus-System** (+/~/-) — ideal für Mitarbeitsbewertungen.

## Kategorietypen

| Typ | Erlaubte Werte | Typischer Einsatz |
|-----|----------------|-------------------|
| Numerisch | 1, 2, 3, 4, 5 | Schularbeiten, Tests |
| Nur Plus/Minus | +, ~, - | Mitarbeit, Hausübungen |
| Gemischt | 1–5 und +/~/- | Flexible Bewertung |

Den Typ legen Sie beim Erstellen einer [Kategorie](notenkategorien.md) fest.

## Bedeutung der Symbole

| Symbol | Bedeutung |
|--------|-----------|
| **+** | Positive Leistung |
| **~** | Durchschnittliche Leistung |
| **-** | Schwache Leistung |

## Prozentwerte für Plus/Minus

Damit Plus/Minus-Noten in den Gesamtdurchschnitt einfließen können, wird jedem Symbol ein **Prozentwert** zugeordnet:

| Symbol | Standard-Prozent |
|--------|-----------------|
| + | 80% |
| ~ | 50% |
| - | 20% |

Diese Werte können Sie unter **Einstellungen** → **Plus/Minus** anpassen.

## Berechnung im Durchschnitt

Bei Plus/Minus-Kategorien werden die Symbole in Prozentwerte umgerechnet und dann mit der Kategorie-Gewichtung in den gewichteten Durchschnitt einbezogen.

**Beispiel:** Ein Schüler hat in der Kategorie "Mitarbeit" (Gewichtung 25%): +, +, ~, -

```
Durchschnitt = (80% + 80% + 50% + 20%) / 4 = 57,5%
```

Dieser Prozentwert wird dann mit den [Notenbereichen](notenbereiche.md) in eine Note umgerechnet und gewichtet in den Gesamtdurchschnitt einbezogen.

![Plus/Minus Einstellungen](/img/plus-minus-settings.png)
