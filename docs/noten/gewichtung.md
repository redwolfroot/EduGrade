---
sidebar_position: 4
title: Gewichtung
---

# Gewichtung

Die Gewichtung der Notenkategorien bestimmt, wie stark jede Kategorie in den Gesamtdurchschnitt einfließt.

## So funktioniert die Gewichtung

Jede [Kategorie](notenkategorien.md) hat ein **Gewicht** (in Prozent). Der gewichtete Durchschnitt wird berechnet, indem:

1. Der Durchschnitt **innerhalb jeder Kategorie** berechnet wird
2. Jeder Kategoriedurchschnitt mit seinem **Gewicht multipliziert** wird
3. Die gewichteten Werte **zusammengezählt** werden

## Rechenbeispiel

| Kategorie | Gewicht | Noten | Kategorie-Ø |
|-----------|---------|-------|-------------|
| Schularbeit | 50% | 2, 3 | 2,5 |
| Mitarbeit | 25% | 1, 2 | 1,5 |
| Hausübung | 25% | 2, 1, 2 | 1,67 |

**Berechnung:**

```
Gewichteter Durchschnitt = (2,5 × 0,50) + (1,5 × 0,25) + (1,67 × 0,25)
                         = 1,25 + 0,375 + 0,4175
                         = 2,04
```

→ Endnote: **2** (Gut)

## Gewichte anpassen

Die Gewichte werden in den [Notenkategorien](notenkategorien.md) unter **Einstellungen** festgelegt. Sie können jederzeit geändert werden — der Durchschnitt wird automatisch neu berechnet.

:::info Hinweis
Die Gewichte müssen nicht genau 100% ergeben. EduGrade berechnet den gewichteten Durchschnitt relativ zu den vorhandenen Kategorien mit Noten.
:::
