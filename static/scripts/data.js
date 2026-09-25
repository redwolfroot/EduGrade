// data.js
// ========== DATENSTRUKTUR ==========
// Diese Datei definiert die zentrale Datenstruktur der Anwendung.
// Alle Daten werden in diesem einen Objekt gespeichert.

/**
 * APPDATA - Das zentrale Datenobjekt
 *
 * Struktur:
 * appData
 * ├── teacherName: String - Name des Lehrers
 * ├── currentClassId: String - ID der aktuell ausgewählten Klasse
 * ├── classes: Array - Liste aller Klassen
 * │   └── [Klasse]
 * │       ├── id: String - Eindeutige ID
 * │       ├── name: String - Name der Klasse (z.B. "1A")
 * │       ├── attendanceEnabled: Boolean - Anwesenheitsfunktion aktiv (Default true; fehlend = aktiv)
 * │       ├── years: Array - Jahrgänge dieser Klasse (z.B. "2024/2025")
 * │       │   └── [Jahrgang]
 * │       │       ├── id: String - Eindeutige ID
 * │       │       ├── name: String - Name des Jahrgangs (z.B. "2024/2025")
 * │       │       ├── startDate: String|null - Schuljahresbeginn (YYYY-MM-DD)
 * │       │       ├── semesterSwitchDate: String|null - Semesterwechsel (YYYY-MM-DD)
 * │       │       ├── endDate: String|null - Schuljahresende (YYYY-MM-DD)
 * │       │       ├── currentSemester: "WS"|"SS" - Aktives Semester
 * │       │       ├── subjects: Array - Unterrichtsfächer dieses Jahrgangs
 * │       │       │   └── [Fach]
 * │       │       │       ├── id: String - Eindeutige ID
 * │       │       │       ├── name: String - Name des Fachs (z.B. "Mathematik")
 * │       │       │       ├── minAttendancePercent: null|Number - Mindest-Anwesenheit in % (null = globale Einstellung)
 * │       │       │       ├── warningThreshold: null|Number - Warnschwelle in % (null = globale Einstellung)
 * │       │       │       └── attendanceAutoGrading: null|Boolean - Auto-Grading aktiv (null = globale Einstellung)
 * │       │       ├── currentSubjectId: null|String - Aktives Fach-Tab (null = Alle Fächer)
 * │       │       └── students: Array - Schüler dieses Jahrgangs
 * │       │           └── [Schüler]
 * │       │               ├── id: String
 * │       │               ├── firstName: String - Vorname
 * │       │               ├── lastName: String - Nachname
 * │       │               ├── middleName: String - Zweitname (optional)
 * │       │               ├── grades: Array - Noten des Schülers
 * │       │               │   └── [Note]
 * │       │               │       ├── id: String
 * │       │               │       ├── categoryId: String - Zugehörige Kategorie
 * │       │               │       ├── categoryName: String
 * │       │               │       ├── value: Number|String - Notenwert (1-6 oder "+"/"-")
 * │       │               │       ├── weight: Number - Gewichtung (0.1-1.0)
 * │       │               │       ├── isPlusMinus: Boolean
 * │       │               │       ├── name: String - Optionaler Name (z.B. "SA1")
 * │       │               │       └── subjectId: String|undefined - Zugehöriges Fach (undefined = kein Fach)
 * │       │               ├── participation: Array - Anwesenheitseinträge
 * │       │               └── behavior: Array - Verhaltensprotokoll
 * │       │                   └── [Eintrag]
 * │       │                       ├── id: String
 * │       │                       ├── subjectId: String|null - Fach, in dem das Verhalten auftrat
 * │       │                       ├── date: String - YYYY-MM-DD (Ortszeit)
 * │       │                       ├── time: String - HH:MM (Ortszeit)
 * │       │                       ├── type: "positive"|"neutral"|"negative"
 * │       │                       ├── note: String - Beschreibung (Klartext, max. 500 Zeichen)
 * │       │                       └── createdAt: Number - Erstellzeitpunkt (ms)
 * │       └── currentYearId: String - ID des aktuell ausgewählten Jahrgangs
 * ├── categories: Array - GLOBALE Notenkategorien (gelten für ALLE Klassen und Jahrgänge)
 * │   └── [Kategorie]
 * │       ├── id: String
 * │       ├── name: String (z.B. "Schularbeit")
 * │       ├── weight: Number (z.B. 0.5 für 50%)
 * │       ├── allowPlusMinus: Boolean
 * │       └── onlyPlusMinus: Boolean
 * ├── students: Array - Globale Schüler (Legacy, nicht verwendet)
 * └── participationSettings: Object - Einstellungen für Mitarbeit
 *     ├── plusValue: Number
 *     └── minusValue: Number
 *
 * WICHTIG: Dieses Objekt wird bei saveData() in LocalStorage gespeichert
 * und bei loadData() wieder geladen.
 */
let appData = {
    teacherName: "",              // Name des Lehrers (für personalisierte Nachrichten)
    currentClassId: null,         // ID der aktuell angezeigten Klasse
    classes: [],                  // Hauptarray mit allen Klassen und deren Daten
    categories: [],               // GLOBALE Kategorien (gelten für alle Klassen)
    defaultSubjects: [],          // Standard-Fächer (Objekte: { name, minAttendancePercent, warningThreshold, attendanceAutoGrading })
    hiddenSubjectSuggestions: [], // Fächer, die aus der Vorschlagsliste ausgeblendet wurden (Array von Namen-Strings)
    students: [],                 // Legacy-Array (wird nicht aktiv verwendet)
    participationSettings: {      // Einstellungen für Mitarbeits-Funktion
        plusValue: 0.1,           // Wert pro Plus bei Mitarbeit
        minusValue: 0.1           // Wert pro Minus bei Mitarbeit
    },
    tutorial: {                   // Tutorial-Status
        completed: false,         // Tutorial abgeschlossen oder übersprungen
        currentStep: 0,           // Aktueller Schritt (für Resume)
        neverShowAgain: false     // "Nicht mehr anzeigen" Option
    },
    gradePercentageRanges: [      // Prozentbereiche für Noten (österreichisches System)
        { grade: 1, minPercent: 85, maxPercent: 100 },  // Sehr Gut
        { grade: 2, minPercent: 70, maxPercent: 84 },   // Gut
        { grade: 3, minPercent: 55, maxPercent: 69 },   // Befriedigend
        { grade: 4, minPercent: 40, maxPercent: 54 },   // Genügend
        { grade: 5, minPercent: 0, maxPercent: 39 }     // Nicht Genügend
    ],
    plusMinusPercentages: {       // Prozentwerte für +/~/- Noten
        plus: 100,                // Plus = 100% (Sehr gute Leistung)
        neutral: 50,              // Neutral = 50% (Durchschnittliche Leistung)
        minus: 0                  // Minus = 0% (Schwache Leistung)
    },
    attendanceSettings: {         // Einstellungen für Anwesenheitsbewertung
        enabled: false,           // Automatische Note bei niedriger Anwesenheit
        minAttendancePercent: 75, // Mindest-Anwesenheit in % (Standard: 75%)
        warningThreshold: 5       // Warnung wenn X% über Minimum (Standard: 80%)
    },
    schoolType: "secondary",      // Schultyp: "primary" (Grundschule/Volksschule) oder "secondary" (weiterführende Schule)
    accentColor: "coral"          // Akzentfarben-Preset: coral | red | orange | yellow | green | blue | purple | mono
};
