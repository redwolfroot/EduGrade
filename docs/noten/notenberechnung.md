---
sidebar_position: 7
title: Notenberechnung
---

# Notenberechnung

EduGrade berechnet den Gesamtdurchschnitt automatisch. Hier erfahren Sie, wie die Berechnung Schritt für Schritt funktioniert.

## Berechnungsschritte

### Schritt 1: Kategoriedurchschnitte

Für jede Kategorie wird der Durchschnitt aller Noten berechnet:

- **Numerische Noten**: Summe ÷ Anzahl
- **Plus/Minus-Noten**: Symbole werden in [Prozentwerte](plus-minus.md) umgerechnet, dann gemittelt

### Schritt 2: Gewichteter Gesamtdurchschnitt

Die Kategoriedurchschnitte werden mit ihren [Gewichtungen](gewichtung.md) kombiniert:

```
Gewichteter Ø = Σ (Kategorie-Ø × Kategorie-Gewicht)
```

### Schritt 3: Endnote

Der gewichtete Durchschnitt wird anhand der [Notenbereiche](notenbereiche.md) in eine Endnote umgerechnet.

## Vollständiges Beispiel

**Kategorien:**
- Schularbeit: Gewicht 50%
- Mitarbeit (Plus/Minus): Gewicht 25%
- Hausübung: Gewicht 25%

**Noten eines Schülers:**

| Kategorie | Noten | Durchschnitt |
|-----------|-------|-------------|
| Schularbeit | 2, 3, 2 | 2,33 → 66,8% |
| Mitarbeit | +, +, ~ | (80+80+50)/3 = 70% |
| Hausübung | 1, 2, 2 | 1,67 → 83,3% |

**Gewichteter Durchschnitt:**

```
= (66,8% × 0,50) + (70% × 0,25) + (83,3% × 0,25)
= 33,4% + 17,5% + 20,8%
= 71,7%
```

→ 71,7% entspricht laut Standardbereichen der Note **2 (Gut)**

## Was beeinflusst die Berechnung?

- **Ausgeschlossene Noten** — Noten mit deaktiviertem "In Durchschnitt einbeziehen" werden ignoriert
- **Ausstehende Noten** — Werden nicht in die Berechnung einbezogen
- **Anwesenheits-Automatik** — Bei aktivierter [Auto-Benotung](../anwesenheit/anwesenheit-einstellungen.md) kann eine Note 5 automatisch vergeben werden

## Klassenstatistiken

EduGrade zeigt auch Klassenstatistiken:

- **Klassendurchschnitt** — Gewichteter Durchschnitt aller Schüler
- **Notenverteilung** — Wie viele Schüler welche Note haben
