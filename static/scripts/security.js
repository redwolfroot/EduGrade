// security.js
// ========== SICHERHEITS-FUNKTIONEN ==========
// Diese Datei enthält alle Funktionen zum Schutz vor XSS-Angriffen (Cross-Site Scripting)
// und zur Validierung von Benutzereingaben.

// CSRF defence: every same-origin /api/ fetch automatically gets the
// X-Requested-With header. Browsers refuse to attach custom headers to
// cross-origin <form>/navigation requests, so a forged request from another
// site cannot satisfy the server-side check.
(() => {
    const _origFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
        try {
            const url = typeof input === 'string' ? input : (input && input.url) || '';
            const isApi = url.startsWith('/api/') || url.startsWith(window.location.origin + '/api/');
            if (isApi) {
                const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined));
                if (!headers.has('X-Requested-With')) {
                    headers.set('X-Requested-With', 'XMLHttpRequest');
                }
                init = { ...init, headers };
            }
        } catch (_) { /* fall through to original fetch */ }
        return _origFetch(input, init);
    };
})();

/**
 * ESCAPE HTML - Kernfunktion für XSS-Schutz
 *
 * Diese Funktion wandelt gefährliche HTML-Sonderzeichen in ihre harmlosen
 * HTML-Entity-Entsprechungen um. Dadurch wird verhindert, dass eingeschleuster
 * Code als HTML/JavaScript interpretiert wird.
 *
 * Beispiel:
 *   Eingabe:  <script>alert('XSS')</script>
 *   Ausgabe:  &lt;script&gt;alert(&#039;XSS&#039;)&lt;/script&gt;
 *
 * Die Ausgabe wird im Browser als Text angezeigt, nicht als Code ausgeführt.
 *
 * @param {string} text - Der zu escapende Text
 * @returns {string} - Sicherer Text für HTML-Einfügung
 */
const escapeHtml = (text) => {
    // Null/undefined werden zu leerem String
    if (text === null || text === undefined) {
        return '';
    }

    // Alles zu String konvertieren (auch Zahlen, Booleans, etc.)
    const str = String(text);

    // Mapping der gefährlichen Zeichen zu ihren HTML-Entities
    // Diese Zeichen könnten sonst für HTML-Injection missbraucht werden
    const map = {
        '&': '&amp;',   // & muss zuerst ersetzt werden (sonst werden andere Entities kaputt)
        '<': '&lt;',    // Öffnendes HTML-Tag
        '>': '&gt;',    // Schließendes HTML-Tag
        '"': '&quot;',  // Doppelte Anführungszeichen (für Attribute)
        "'": '&#039;',  // Einfache Anführungszeichen (für Attribute)
        '/': '&#x2F;',  // Schrägstrich (verhindert </script> etc.)
        '`': '&#x60;',  // Backtick (Template Literals in JS)
        '=': '&#x3D;'   // Gleichheitszeichen (für Attribute)
    };

    // Regex ersetzt alle gefährlichen Zeichen auf einmal
    // Die Callback-Funktion holt das Ersatz-Zeichen aus dem Map
    return str.replace(/[&<>"'`=/]/g, char => map[char]);
};

/**
 * UNESCAPE HTML ENTITIES
 *
 * Dekodiert HTML-Entities zurück zu normalen Zeichen.
 * Wird beim Import verwendet, um bereits escaped Daten zu korrigieren.
 *
 * @param {string} text - Der zu dekodierende Text
 * @returns {string} - Der dekodierte Text
 */
const unescapeHtml = (text) => {
    if (text === null || text === undefined) {
        return '';
    }

    const str = String(text);

    // Mapping von HTML-Entities zu ihren ursprünglichen Zeichen
    const map = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#039;': "'",
        '&#x2F;': '/',
        '&#x60;': '`',
        '&#x3D;': '='
    };

    // Ersetze alle HTML-Entities
    return str.replace(/&amp;|&lt;|&gt;|&quot;|&#039;|&#x2F;|&#x60;|&#x3D;/g, entity => map[entity] || entity);
};

/**
 * VALIDIERUNG VON TEXT-EINGABEN
 *
 * Prüft Benutzereingaben auf:
 * 1. Vorhandensein (nicht null/undefined/leer)
 * 2. Maximale Länge (verhindert Buffer Overflow / DoS)
 * 3. Gefährliche Muster (Script-Tags, Event-Handler, etc.)
 *
 * Gibt ein Objekt zurück mit:
 * - isValid: true/false
 * - value: der bereinigte Wert (getrimmt)
 * - error: Fehlermeldung wenn ungültig
 *
 * @param {string} input - Die zu validierende Eingabe
 * @param {number} maxLength - Maximale erlaubte Länge (Standard: 200)
 * @returns {object} - Validierungsergebnis
 */
const validateStringInput = (input, maxLength = 200) => {
    // Prüfung auf null/undefined
    if (input === null || input === undefined) {
        return { isValid: false, value: '', error: t("validation.inputRequired") };
    }

    // Zu String konvertieren und Whitespace an Anfang/Ende entfernen
    const trimmed = String(input).trim();

    // Leere Eingaben sind ungültig
    if (trimmed.length === 0) {
        return { isValid: false, value: '', error: t("validation.inputEmpty") };
    }

    // Längenbegrenzung prüfen (verhindert zu große Daten)
    if (trimmed.length > maxLength) {
        return { isValid: false, value: '', error: t("validation.inputTooLong", { max: maxLength }) };
    }

    // GEFÄHRLICHE MUSTER ERKENNEN
    // Diese Regex-Patterns erkennen typische XSS-Angriffsvektoren
    const dangerousPatterns = [
        /<script\b/i,      // <script> Tags - häufigstes XSS
        /javascript:/i,    // javascript: URLs (z.B. in href)
        /on\w+\s*=/i,      // Event-Handler wie onclick=, onerror=, onload=
        /data:/i,          // data: URLs (können JS enthalten)
        /vbscript:/i       // VBScript (älterer IE)
    ];

    // Jeden Pattern testen
    for (const pattern of dangerousPatterns) {
        if (pattern.test(trimmed)) {
            return { isValid: false, value: '', error: t("validation.dangerousContent") };
        }
    }

    // Alles OK - Eingabe ist sicher
    return { isValid: true, value: trimmed, error: null };
};

/**
 * VALIDIERUNG VON NOTENWERTEN
 *
 * Prüft ob ein Notenwert gültig ist. Unterstützt zwei Typen:
 * 1. Plus/Minus-Noten: Nur "+" oder "-" erlaubt
 * 2. Numerische Noten: Zahlen von 1 bis 6 (österreichisches System)
 *
 * @param {string|number} value - Der zu prüfende Notenwert
 * @param {boolean} isPlusMinus - Ob es eine +/- Note ist
 * @returns {object} - Validierungsergebnis
 */
const validateGradeValue = (value, isPlusMinus = false) => {
    // Plus/Minus-Noten: Nur exakt "+" oder "-" erlaubt
    if (isPlusMinus) {
        if (value === '+' || value === '~' || value === '-') {
            return { isValid: true, value: value, error: null };
        }
        return { isValid: false, value: null, error: t("validation.plusMinusInvalid") };
    }

    // Numerische Noten: Zu Zahl konvertieren
    const num = parseFloat(value);

    // Prüfen ob es überhaupt eine Zahl ist
    if (isNaN(num)) {
        return { isValid: false, value: null, error: t("validation.gradeMustBeNumber") };
    }

    // Wertebereich prüfen (1-6 für österreichisches System, 6 = Nicht Genügend)
    if (num < 1 || num > 6) {
        return { isValid: false, value: null, error: t("validation.gradeRange") };
    }

    return { isValid: true, value: num, error: null };
};

/**
 * VALIDIERUNG VON GEWICHTUNGSWERTEN
 *
 * Kategorien haben eine Gewichtung von 1% bis 100%.
 * Diese Funktion stellt sicher, dass nur gültige Werte akzeptiert werden.
 *
 * @param {string|number} value - Der zu prüfende Gewichtungswert (in Prozent)
 * @returns {object} - Validierungsergebnis (mit dezimalem Wert für interne Verwendung)
 */
const validateWeight = (value) => {
    const num = parseFloat(value);

    if (isNaN(num)) {
        return { isValid: false, value: null, error: t("validation.weightMustBeNumber") };
    }

    // Gewichtung muss zwischen 1% und 100% liegen
    if (num < 1 || num > 100) {
        return { isValid: false, value: null, error: t("validation.weightRangePercent") };
    }

    // Den Prozentwert in einen Dezimalwert für interne Verwendung umwandeln (z.B. 30 -> 0.3)
    const decimalValue = num / 100;

    return { isValid: true, value: decimalValue, error: null };
};

/**
 * SANITISIERUNG VON IMPORT-DATEN
 *
 * Wenn Benutzer eine JSON-Datei importieren, könnten darin
 * bösartige Daten versteckt sein. Diese Funktion:
 *
 * 1. Escaped alle String-Werte mit escapeHtml()
 * 2. Konvertiert IDs sicher zu Strings
 * 3. Validiert numerische Werte (Noten, Gewichtungen)
 * 4. Setzt sichere Standardwerte für fehlende Felder
 *
 * Das verhindert "Stored XSS" - bösartiger Code der in den
 * Daten gespeichert wird und später bei der Anzeige ausgeführt würde.
 *
 * @param {object} data - Das importierte Datenobjekt
 * @returns {object} - Sauber bereinigtes Datenobjekt
 */
const sanitizeImportData = (data) => {
    // Ungültige Daten ablehnen
    if (!data || typeof data !== 'object') {
        return null;
    }

    // Neues sauberes Objekt erstellen
    const sanitized = {
        teacherName: unescapeHtml(data.teacherName || ''),
        currentClassId: data.currentClassId || null,
        classes: [],
        categories: [],
        students: [],
        defaultSubjects: [],
        hiddenSubjectSuggestions: [],
        participationSettings: data.participationSettings
            ? {
                plusValue: parseFloat(data.participationSettings.plusValue) || 0.1,
                minusValue: parseFloat(data.participationSettings.minusValue) || 0.1
            }
            : { plusValue: 0.1, minusValue: 0.1 },
        gradePercentageRanges: Array.isArray(data.gradePercentageRanges)
            ? data.gradePercentageRanges.map(r => ({
                grade: parseInt(r.grade, 10),
                minPercent: parseFloat(r.minPercent),
                maxPercent: parseFloat(r.maxPercent)
            }))
            : null,
        plusMinusPercentages: data.plusMinusPercentages
            ? {
                plus: parseFloat(data.plusMinusPercentages.plus) ?? 100,
                neutral: parseFloat(data.plusMinusPercentages.neutral) ?? 50,
                minus: parseFloat(data.plusMinusPercentages.minus) ?? 0
            }
            : null,
        attendanceSettings: data.attendanceSettings
            ? {
                enabled: Boolean(data.attendanceSettings.enabled),
                minAttendancePercent: parseFloat(data.attendanceSettings.minAttendancePercent) || 75,
                warningThreshold: parseFloat(data.attendanceSettings.warningThreshold) || 5
            }
            : null,
        schoolType: data.schoolType === 'primary' ? 'primary' : 'secondary',
        plusMinusGradeSettings: data.plusMinusGradeSettings || { startGrade: 3, plusValue: 0.5, minusValue: 0.5 }
    };
    // null-Felder entfernen (damit Defaults aus data.js greifen)
    if (sanitized.gradePercentageRanges === null) delete sanitized.gradePercentageRanges;
    if (sanitized.plusMinusPercentages === null) delete sanitized.plusMinusPercentages;
    if (sanitized.attendanceSettings === null) delete sanitized.attendanceSettings;

    // KLASSEN SANITISIEREN
    // Jede Klasse enthält Schüler, die wiederum Noten haben (verschachtelte Struktur)
    // Kategorien werden jetzt global gespeichert, nicht mehr pro Klasse
    if (Array.isArray(data.classes)) {
        sanitized.classes = data.classes.map(cls => {
            const sanitizedClass = {
                id: String(cls.id || ''),                    // ID immer als String
                name: unescapeHtml(cls.name || ''),                // Name als String
                currentYearId: cls.currentYearId ? String(cls.currentYearId) : null
            };

            // Helper function to sanitize student data
            const sanitizeStudent = (student) => {
                // MIGRATION: Altes Format (name) → neues Format (firstName/lastName)
                let firstName = student.firstName || '';
                let lastName = student.lastName || '';
                let middleName = student.middleName || '';
                if (!firstName && !lastName && student.name) {
                    const parts = student.name.trim().split(/\s+/);
                    if (parts.length === 1) {
                        lastName = parts[0];
                    } else {
                        lastName = parts[parts.length - 1];
                        firstName = parts.slice(0, -1).join(' ');
                    }
                }
                return {
                    id: String(student.id || ''),
                    firstName: unescapeHtml(firstName),
                    lastName: unescapeHtml(lastName),
                    middleName: unescapeHtml(middleName),

                    // Noten des Schülers sanitisieren
                    grades: Array.isArray(student.grades) ? student.grades.map(grade => ({
                        id: String(grade.id || ''),
                        categoryId: String(grade.categoryId || ''),
                        categoryName: unescapeHtml(grade.categoryName || ''),
                        // subjectId für Fächer-Zuordnung
                        subjectId: grade.subjectId ? String(grade.subjectId) : null,
                        // Notenwert: +/- nur wenn gültig, sonst als Zahl parsen
                        value: grade.isPending ? null : (grade.isPlusMinus
                            ? (grade.value === '+' || grade.value === '~' || grade.value === '-' ? grade.value : '+')
                            : parseFloat(grade.value) || 1),
                        weight: parseFloat(grade.weight) || 0.5,
                        isPlusMinus: Boolean(grade.isPlusMinus),
                        isPending: Boolean(grade.isPending),
                        name: unescapeHtml(grade.name || ''),
                        createdAt: parseInt(grade.createdAt, 10) || Date.now(),
                        excludeFromAverage: Boolean(grade.excludeFromAverage),
                        enteredAsPercent: Boolean(grade.enteredAsPercent),
                        percentValue: grade.percentValue ? parseFloat(grade.percentValue) : null
                    })) : [],
                    participation: student.participation || [],
                    // Verhaltensprotokoll: Beschreibung bleibt Klartext (wird beim Rendern escaped)
                    behavior: Array.isArray(student.behavior) ? student.behavior
                        .filter(b => b && /^\d{4}-\d{2}-\d{2}$/.test(b.date) && /^\d{2}:\d{2}$/.test(b.time))
                        .map(b => ({
                            id: String(b.id || ''),
                            subjectId: b.subjectId ? String(b.subjectId) : null,
                            date: b.date,
                            time: b.time,
                            type: ['positive', 'neutral', 'negative'].includes(b.type) ? b.type : 'neutral',
                            note: String(b.note || '').slice(0, 500),
                            createdAt: parseInt(b.createdAt, 10) || Date.now()
                        })) : []
                };
            };

            // NEW FORMAT: Class with years
            if (Array.isArray(cls.years)) {
                sanitizedClass.years = cls.years.map(year => ({
                    id: String(year.id || ''),
                    name: unescapeHtml(year.name || ''),
                    currentSubjectId: year.currentSubjectId ? String(year.currentSubjectId) : null,

                    // Fächer-System (Subjects) sanitisieren
                    subjects: Array.isArray(year.subjects) ? year.subjects.map(subject => ({
                        id: String(subject.id || ''),
                        name: unescapeHtml(subject.name || ''),
                        minAttendancePercent: subject.minAttendancePercent != null ? parseFloat(subject.minAttendancePercent) : null,
                        warningThreshold: subject.warningThreshold != null ? parseFloat(subject.warningThreshold) : null,
                        attendanceAutoGrading: subject.attendanceAutoGrading != null ? Boolean(subject.attendanceAutoGrading) : null
                    })) : [],

                    // Schüler des Jahrgangs sanitisieren
                    students: Array.isArray(year.students) ? year.students.map(sanitizeStudent) : []
                }));
            }
            // OLD FORMAT: Class with students directly (for backward compatibility)
            else if (Array.isArray(cls.students)) {
                // Fächer-System (Subjects) sanitisieren - alte Struktur
                sanitizedClass.subjects = Array.isArray(cls.subjects) ? cls.subjects.map(subject => ({
                    id: String(subject.id || ''),
                    name: unescapeHtml(subject.name || '')
                })) : [];
                sanitizedClass.currentSubjectId = cls.currentSubjectId ? String(cls.currentSubjectId) : null;

                // Schüler der Klasse sanitisieren - alte Struktur
                sanitizedClass.students = cls.students.map(sanitizeStudent);
            }

            // MIGRATION: Falls alte Daten mit Kategorien pro Klasse importiert werden,
            // diese zu den globalen Kategorien hinzufügen
            if (Array.isArray(cls.categories)) {
                cls.categories.forEach(cat => {
                    const sanitizedCat = {
                        id: String(cat.id || ''),
                        name: unescapeHtml(cat.name || ''),
                        weight: parseFloat(cat.weight) || 0.5,
                        allowPlusMinus: Boolean(cat.allowPlusMinus),
                        onlyPlusMinus: Boolean(cat.onlyPlusMinus)
                    };
                    // Nur hinzufügen wenn ID noch nicht existiert
                    if (!sanitized.categories.some(c => c.id === sanitizedCat.id)) {
                        sanitized.categories.push(sanitizedCat);
                    }
                });
            }

            return sanitizedClass;
        });
    }

    // GLOBALE KATEGORIEN SANITISIEREN
    if (Array.isArray(data.categories)) {
        sanitized.categories = data.categories.map(cat => ({
            id: String(cat.id || ''),
            name: unescapeHtml(cat.name || ''),
            weight: parseFloat(cat.weight) || 0.5,
            allowPlusMinus: Boolean(cat.allowPlusMinus),
            onlyPlusMinus: Boolean(cat.onlyPlusMinus)
        }));
    }

    // DEFAULT SUBJECTS SANITISIEREN
    if (Array.isArray(data.defaultSubjects)) {
        sanitized.defaultSubjects = data.defaultSubjects.map(s => ({
            name: unescapeHtml(s.name || ''),
            minAttendancePercent: s.minAttendancePercent != null ? parseFloat(s.minAttendancePercent) : null,
            warningThreshold: s.warningThreshold != null ? parseFloat(s.warningThreshold) : null,
            attendanceAutoGrading: s.attendanceAutoGrading != null ? Boolean(s.attendanceAutoGrading) : null
        })).filter(s => s.name.length > 0);
    }

    // HIDDEN SUBJECT SUGGESTIONS SANITISIEREN
    if (Array.isArray(data.hiddenSubjectSuggestions)) {
        sanitized.hiddenSubjectSuggestions = data.hiddenSubjectSuggestions
            .filter(s => typeof s === 'string')
            .map(s => unescapeHtml(s));
    }

    // GLOBALE SCHÜLER SANITISIEREN
    if (Array.isArray(data.students)) {
        sanitized.students = data.students.map(student => {
            // MIGRATION: Altes Format (name) → neues Format (firstName/lastName)
            let firstName = student.firstName || '';
            let lastName = student.lastName || '';
            let middleName = student.middleName || '';
            if (!firstName && !lastName && student.name) {
                const parts = student.name.trim().split(/\s+/);
                if (parts.length === 1) {
                    lastName = parts[0];
                } else {
                    lastName = parts[parts.length - 1];
                    firstName = parts.slice(0, -1).join(' ');
                }
            }
            return {
            id: String(student.id || ''),
            firstName: String(firstName),
            lastName: String(lastName),
            middleName: String(middleName),
            grades: Array.isArray(student.grades) ? student.grades.map(grade => ({
                id: String(grade.id || ''),
                categoryId: String(grade.categoryId || ''),
                categoryName: unescapeHtml(grade.categoryName || ''),
                // subjectId für Fächer-Zuordnung
                subjectId: grade.subjectId ? String(grade.subjectId) : null,
                value: grade.isPending ? null : (grade.isPlusMinus
                    ? (grade.value === '+' || grade.value === '~' || grade.value === '-' ? grade.value : '+')
                    : parseFloat(grade.value) || 1),
                weight: parseFloat(grade.weight) || 0.5,
                isPlusMinus: Boolean(grade.isPlusMinus),
                isPending: Boolean(grade.isPending),
                name: unescapeHtml(grade.name || ''),
                createdAt: parseInt(grade.createdAt, 10) || Date.now(),
                excludeFromAverage: Boolean(grade.excludeFromAverage),
                enteredAsPercent: Boolean(grade.enteredAsPercent),
                percentValue: grade.percentValue ? parseFloat(grade.percentValue) : null
            })) : []
        };});
    }

    // PLUS/MINUS-EINSTELLUNGEN VALIDIEREN
    // Math.max/min begrenzt die Werte auf sichere Bereiche
    if (sanitized.plusMinusGradeSettings) {
        sanitized.plusMinusGradeSettings = {
            // Startnote: zwischen 1 und 5
            startGrade: Math.max(1, Math.min(5, parseFloat(sanitized.plusMinusGradeSettings.startGrade) || 3)),
            // Plus-Wert: zwischen 0.1 und 2
            plusValue: Math.max(0.1, Math.min(2, parseFloat(sanitized.plusMinusGradeSettings.plusValue) || 0.5)),
            // Minus-Wert: zwischen 0.1 und 2
            minusValue: Math.max(0.1, Math.min(2, parseFloat(sanitized.plusMinusGradeSettings.minusValue) || 0.5))
        };
    }

    return sanitized;
};

/**
 * SICHERE ATTRIBUT-WERTE
 *
 * Wrapper-Funktion für escapeHtml(), speziell für HTML-Attribute.
 * Stellt sicher, dass der Wert immer ein String ist.
 *
 * Verwendung: data-id="${safeAttr(someValue)}"
 *
 * @param {string} value - Der Wert für das Attribut
 * @returns {string} - Sicherer Attributwert
 */
const safeAttr = (value) => {
    return escapeHtml(String(value || ''));
};
