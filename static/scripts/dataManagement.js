// dataManagement.js
// ========== DATENVERWALTUNG ==========
// Diese Datei enthält alle CRUD-Operationen (Create, Read, Update, Delete)
// für Klassen, Schüler, Kategorien und Noten.


/**
 * KLASSE HINZUFÜGEN
 *
 * Erstellt eine neue Klasse und fügt sie zum appData-Array hinzu.
 * Die neue Klasse wird automatisch als aktuelle Klasse ausgewählt.
 *
 * Ablauf:
 * 1. Name validieren (max. 50 Zeichen, keine gefährlichen Zeichen)
 * 2. Neues Klassen-Objekt mit eindeutiger ID erstellen
 * 3. Zu appData hinzufügen und als aktuelle Klasse setzen
 * 4. Daten speichern und UI aktualisieren
 *
 * @param {string} name - Der Name der neuen Klasse (z.B. "1A", "2B")
 */
const addClass = (name) => {
    // SICHERHEIT: Eingabe validieren bevor sie verwendet wird
    const validation = validateStringInput(name, 50);
    if (!validation.isValid) {
        showAlertDialog(validation.error);
        return; // Abbruch wenn ungültig
    }

    // Neues Klassen-Objekt erstellen
    // Verwende eine wirklich eindeutige ID (Timestamp + Zufallszahl)
    const yearId = Date.now().toString() + '-year-' + Math.floor(Math.random() * 1000);

    // Create default year with current academic year name
    const currentYear = getCurrentSchoolYear();
    const defaultYearName = `${currentYear}/${currentYear + 1}`;

    // Create subjects array from defaultSubjects or fallback to default subject
    let subjects = [];
    let firstSubjectId = null;

    if (appData.defaultSubjects && appData.defaultSubjects.length > 0) {
        // Use configured default subjects
        subjects = appData.defaultSubjects.map((subjectTemplate, index) => {
            const subjectId = Date.now().toString() + '-sub-' + Math.floor(Math.random() * 1000) + '-' + index;
            if (index === 0) firstSubjectId = subjectId;
            return {
                id: subjectId,
                name: subjectTemplate.name,
                minAttendancePercent: subjectTemplate.minAttendancePercent ?? null,
                warningThreshold: subjectTemplate.warningThreshold ?? null,
                attendanceAutoGrading: subjectTemplate.attendanceAutoGrading ?? null
            };
        });
    } else {
        // Fallback to default subject if none configured
        firstSubjectId = Date.now().toString() + '-sub-' + Math.floor(Math.random() * 1000);
        subjects = [{
            id: firstSubjectId,
            name: t("class.defaultSubject"),
            minAttendancePercent: null,
            warningThreshold: null,
            attendanceAutoGrading: null
        }];
    }

    const defaultYear = {
        id: yearId,
        name: defaultYearName,
        subjects: subjects,
        currentSubjectId: firstSubjectId,
        currentSemester: "WS",
        startDate: `${currentYear}-09-01`,
        semesterSwitchDate: `${currentYear + 1}-02-01`,
        endDate: `${currentYear + 1}-06-30`,
        students: []
    };

    const newClass = {
        id: Date.now().toString() + '-' + Math.floor(Math.random() * 1000),
        name: validation.value,          // Validierter/bereinigter Name
        attendanceEnabled: true,         // Anwesenheitsfunktion standardmäßig aktiv
        years: [defaultYear],            // Array mit Standard-Jahr
        currentYearId: yearId            // Standard-Jahr aktiv setzen
        // Kategorien werden global in appData.categories gespeichert
    };

    // Klasse zum globalen Daten-Array hinzufügen
    appData.classes.push(newClass);

    // Diese Klasse als aktive Klasse setzen
    appData.currentClassId = newClass.id;

    // Daten in LocalStorage speichern und Erfolgsmeldung zeigen
    saveData(t("toast.classAdded"));

    // UI aktualisieren: Klassenliste, Home-View und Schülertabelle neu rendern
    renderClassList();
    renderHome();
    renderStudents();
};

/**
 * JAHR HINZUFÜGEN
 *
 * Erstellt einen neuen Jahrgang für eine Klasse.
 * Optional können Schüler und Fächer vom vorherigen Jahrgang kopiert werden.
 *
 * @param {string} classId - ID der Klasse
 * @param {string} name - Name des Jahrgangs (z.B. "2024/2025")
 * @param {string|null} copyFromYearId - Optional: ID des Jahrgangs von dem kopiert werden soll
 * @param {Array<string>|null} keepStudentIds - Optional: nur diese Schüler-IDs aus dem Quelljahr übernehmen (null = alle)
 */
const addYear = (classId, name, copyFromYearId = null, dates = null, keepStudentIds = null) => {
    const validation = validateStringInput(name, 50);
    if (!validation.isValid) {
        showAlertDialog(validation.error);
        return;
    }

    const cls = appData.classes.find(c => c.id === classId);
    if (!cls) {
        console.error("Class not found!");
        return;
    }

    if (!cls.years) cls.years = [];

    const newYear = {
        id: Date.now().toString() + '-year-' + Math.floor(Math.random() * 1000),
        name: validation.value,
        subjects: [],
        currentSubjectId: null,
        currentSemester: "WS",
        startDate: dates?.startDate || null,
        semesterSwitchDate: dates?.semesterSwitchDate || null,
        endDate: dates?.endDate || null,
        students: []
    };

    // If copying from previous year
    if (copyFromYearId) {
        const sourceYear = cls.years.find(y => y.id === copyFromYearId);
        if (sourceYear) {
            // Copy subjects (with new IDs, preserving attendance settings)
            newYear.subjects = sourceYear.subjects.map(subj => ({
                id: Date.now().toString() + '-sub-' + Math.floor(Math.random() * 10000),
                name: subj.name,
                minAttendancePercent: subj.minAttendancePercent ?? null,
                warningThreshold: subj.warningThreshold ?? null,
                attendanceAutoGrading: subj.attendanceAutoGrading ?? null
            }));

            // Copy students (with new IDs, but NO grades) - only the ones in keepStudentIds, or all if not given
            const studentsToCopy = keepStudentIds
                ? sourceYear.students.filter(s => keepStudentIds.includes(s.id))
                : sourceYear.students;
            newYear.students = studentsToCopy.map(student => ({
                id: Date.now().toString() + '-stu-' + Math.floor(Math.random() * 10000),
                firstName: student.firstName,
                lastName: student.lastName,
                middleName: student.middleName,
                grades: [],
                participation: []
            }));

            // Set first subject as current if available
            if (newYear.subjects.length > 0) {
                newYear.currentSubjectId = newYear.subjects[0].id;
            }
        }
    }

    cls.years.push(newYear);
    cls.currentYearId = newYear.id;

    saveData(t("toast.yearAdded"), "success");
    renderYearSelector();
    renderSemesterSelector();
    renderSubjectTabs();
    renderStudents();

    return newYear;
};

/**
 * JAHR BEARBEITEN
 *
 * Ändert den Namen eines Jahrgangs.
 *
 * @param {string} classId - ID der Klasse
 * @param {string} yearId - ID des Jahrgangs
 * @param {string} newName - Neuer Name
 */
const editYear = (classId, yearId, newName, dates = null) => {
    const validation = validateStringInput(newName, 50);
    if (!validation.isValid) {
        showAlertDialog(validation.error);
        return;
    }

    const cls = appData.classes.find(c => c.id === classId);
    if (!cls || !cls.years) return;

    const year = cls.years.find(y => y.id === yearId);
    if (year) {
        year.name = validation.value;
        if (dates) {
            year.startDate = dates.startDate || null;
            year.semesterSwitchDate = dates.semesterSwitchDate || null;
            year.endDate = dates.endDate || null;
        }
        saveData(t("toast.yearEdited"), "success");
        renderYearSelector();
        renderSemesterSelector();
    }
};

/**
 * JAHR LÖSCHEN
 *
 * Löscht einen Jahrgang (sofern es nicht der letzte ist).
 *
 * @param {string} classId - ID der Klasse
 * @param {string} yearId - ID des Jahrgangs
 */
const deleteYear = (classId, yearId) => {
    const cls = appData.classes.find(c => c.id === classId);
    if (!cls || !cls.years) return;

    // Prevent deleting last year
    if (cls.years.length <= 1) {
        showAlertDialog(t("error.cannotDeleteLastYear"));
        return;
    }

    // Remove year
    cls.years = cls.years.filter(y => y.id !== yearId);

    // If deleted year was current, select first remaining
    if (cls.currentYearId === yearId) {
        cls.currentYearId = cls.years.length > 0 ? cls.years[0].id : null;
    }

    saveData(t("toast.yearDeleted"), "success");
    renderYearSelector();
    renderSemesterSelector();
    renderSubjectTabs();
    renderStudents();
};

/**
 * SCHÜLER HINZUFÜGEN
 *
 * Fügt einen neuen Schüler zur aktuell ausgewählten Klasse hinzu.
 *
 * @param {string} firstName - Vorname des Schülers
 * @param {string} lastName - Nachname des Schülers
 * @param {string} middleName - Zweitname des Schülers (optional)
 */
const addStudent = (firstName, lastName, middleName) => {
    // SICHERHEIT: Eingaben validieren (max. 50 Zeichen pro Feld)
    const firstNameValidation = validateStringInput(firstName, 50);
    if (!firstNameValidation.isValid) {
        showAlertDialog(firstNameValidation.error);
        return;
    }
    const lastNameValidation = validateStringInput(lastName, 50);
    if (!lastNameValidation.isValid) {
        showAlertDialog(lastNameValidation.error);
        return;
    }
    let validatedMiddleName = '';
    if (middleName && middleName.trim()) {
        const middleNameValidation = validateStringInput(middleName, 50);
        if (!middleNameValidation.isValid) {
            showAlertDialog(middleNameValidation.error);
            return;
        }
        validatedMiddleName = middleNameValidation.value;
    }

    // Aktuellen Jahrgang finden
    const currentYear = getCurrentYear();
    if (!currentYear) {
        console.error("No current year found!");
        return;
    }

    // Duplikat-Prüfung: Vorname + Nachname (case-insensitive)
    const isDuplicate = currentYear.students.some(s =>
        s.firstName.toLowerCase() === firstNameValidation.value.toLowerCase() &&
        s.lastName.toLowerCase() === lastNameValidation.value.toLowerCase()
    );
    if (isDuplicate) {
        const displayName = [firstNameValidation.value, validatedMiddleName, lastNameValidation.value].filter(Boolean).join(' ');
        showAlertDialog(t("error.studentDuplicate").replace("{name}", displayName));
        return;
    }

    // Neues Schüler-Objekt erstellen
    const newStudent = {
        id: Date.now().toString() + '-' + Math.floor(Math.random() * 1000),
        firstName: firstNameValidation.value,
        lastName: lastNameValidation.value,
        middleName: validatedMiddleName,
        notes: '',               // Vertrauliche Notizen (Lernschwächen etc.)
        grades: [],              // Leeres Array für Noten
        participation: []        // Für zukünftige Mitarbeits-Funktion
    };

    // Schüler zum Jahrgang hinzufügen
    currentYear.students.push(newStudent);
    saveData(t("toast.studentAdded"));
    renderStudents();
    requestAnimationFrame(() => {
        document.querySelector(`tr[data-open-qsb="${newStudent.id}"]`)?.classList.add('row-added');
    });
};

/**
 * KATEGORIE HINZUFÜGEN
 *
 * Kategorien sind Notentypen wie "Schularbeit", "Test", "Mitarbeit".
 * Jede Kategorie hat eine Gewichtung (z.B. Schularbeit 50%, Mitarbeit 20%).
 * Kategorien gelten GLOBAL für alle Klassen.
 *
 * @param {string} name - Kategoriename (z.B. "Schularbeit")
 * @param {number} weight - Gewichtung als Dezimalzahl (0.5 = 50%)
 * @param {boolean} allowPlusMinus - Erlaubt +/- zusätzlich zu Noten
 * @param {boolean} onlyPlusMinus - NUR +/- erlaubt (keine Zahlennoten)
 */
const addCategory = (name, weight, allowPlusMinus = false, onlyPlusMinus = false) => {
    // Name validieren
    const nameValidation = validateStringInput(name, 100);
    if (!nameValidation.isValid) {
        showAlertDialog(nameValidation.error);
        return;
    }

    // Neues Kategorie-Objekt erstellen
    const newCategory = {
        id: Date.now().toString(),
        name: nameValidation.value,
        weight: weight,
        // Wenn onlyPlusMinus true ist, muss allowPlusMinus auch true sein
        allowPlusMinus: allowPlusMinus || onlyPlusMinus,
        onlyPlusMinus: onlyPlusMinus
    };

    // Kategorie global hinzufügen (gilt für alle Klassen)
    appData.categories.push(newCategory);
    saveData(t("toast.categoryAdded"));
    renderCategoryFilter(); // Dropdown im Filter aktualisieren
};

/**
 * NOTE HINZUFÜGEN
 *
 * Fügt eine Note zu einem Schüler in einer bestimmten Kategorie hinzu.
 * Unterstützt sowohl numerische Noten (1-6) als auch +/- Noten.
 *
 * @param {string} studentId - ID des Schülers
 * @param {string} categoryId - ID der Kategorie
 * @param {string|number} value - Notenwert ("+" / "-" oder Zahl 1-6)
 * @param {string} gradeName - Optionaler Name (z.B. "SA1", "Test 2")
 * @param {string} subjectId - ID des Fachs
 * @param {number} gradeDate - Optionales Datum als Timestamp (default: jetzt)
 */
const addGrade = (studentId, categoryId, value, gradeName = "", subjectId = null, gradeDate = null, isPending = false, note = "", examId = "") => {
    const currentYear = getCurrentYear();
    if (!currentYear) {
        console.error("No current year found!");
        return;
    }

    // Schüler und Kategorie finden (Kategorien sind global)
    const student = currentYear.students.find(s => s.id === studentId);
    const category = appData.categories.find(c => c.id === categoryId);

    if (student && category) {
        // Optionalen Notennamen validieren (wenn angegeben)
        let validatedGradeName = "";
        if (gradeName && gradeName.trim() !== "") {
            const nameValidation = validateStringInput(gradeName, 50);
            if (!nameValidation.isValid) {
                showAlertDialog(nameValidation.error);
                return;
            }
            validatedGradeName = nameValidation.value;
        }

        // Neues Noten-Objekt erstellen
        let validatedNote = "";
        if (note && note.trim() !== "") {
            const noteValidation = validateStringInput(note, 200);
            if (!noteValidation.isValid) {
                showAlertDialog(noteValidation.error);
                return;
            }
            validatedNote = noteValidation.value;
        }

        const timestamp = gradeDate || Date.now();
        const newGrade = {
            id: Date.now().toString(),
            categoryId: categoryId,
            categoryName: category.name,    // Name der Kategorie speichern (für Anzeige)
            weight: category.weight,        // Gewichtung von Kategorie übernehmen
            name: validatedGradeName,
            note: validatedNote,
            createdAt: timestamp,           // Zeitstempel für zeitlichen Graph (vom Benutzer wählbar)
            subjectId: subjectId,           // Zugehöriges Fach (null = kein Fach)
            isPending: isPending,           // Marker für ausstehende Noten
            semester: getCurrentYear()?.currentSemester || "WS",
            examId: examId || ""            // Group identifier for class exam batch (empty for single grades)
        };

        // If grade is pending, skip validation and set placeholder value
        if (isPending) {
            newGrade.value = null;
            newGrade.isPlusMinus = false;
        } else {
            // NOTENWERT VALIDIEREN
            const isPlusMinus = value === "+" || value === "~" || value === "-";
            const gradeValidation = validateGradeValue(value, isPlusMinus);
            if (!gradeValidation.isValid) {
                showAlertDialog(gradeValidation.error);
                return;
            }

            if (isPlusMinus) {
                newGrade.value = gradeValidation.value;  // "+" oder "-"
                newGrade.isPlusMinus = true;
            } else {
                newGrade.value = gradeValidation.value;  // Zahl 1-6
                newGrade.isPlusMinus = false;
            }
        }

        // Note zum Schüler hinzufügen
        student.grades.push(newGrade);

        // Return the new grade for further processing (e.g., storing percentage)
        // Note: saveData() and renderStudents() are called by the caller
        return newGrade;
    } else {
        console.error("Student or category not found!");
        return null;
    }
};

/**
 * ELEMENT LÖSCHEN (Generische Funktion)
 *
 * Löscht Schüler, Kategorien oder Noten basierend auf dem Typ.
 * Bei Kategorien werden auch alle zugehörigen Noten gelöscht.
 *
 * @param {string} type - "student", "category" oder "grade"
 * @param {string} id - Die ID des zu löschenden Elements
 */
const deleteItem = (type, id) => {
    const currentYear = getCurrentYear();
    if (!currentYear) {
        console.error("No current year found!");
        return;
    }

    if (type === "student") {
        // Schüler aus dem Array entfernen
        // filter() erstellt ein neues Array ohne das Element mit der ID
        currentYear.students = currentYear.students.filter(s => s.id !== id);

    } else if (type === "category") {
        // Kategorie global löschen
        appData.categories = appData.categories.filter(c => c.id !== id);

        // WICHTIG: Auch alle Noten dieser Kategorie bei allen Schülern in ALLEN Klassen und Jahren löschen
        // Sonst hätten Schüler "verwaiste" Noten ohne Kategorie
        appData.classes.forEach(cls => {
            if (cls.years) {
                cls.years.forEach(year => {
                    if (year.students) {
                        year.students.forEach(s => {
                            s.grades = s.grades.filter(g => g.categoryId !== id);
                        });
                    }
                });
            }
        });

    } else if (type === "grade") {
        // Einzelne Note löschen
        // Muss bei allen Schülern gesucht werden (wir wissen nicht welcher Schüler)
        currentYear.students.forEach(s => {
            s.grades = s.grades.filter(g => g.id !== id);
        });
    }

    saveData(t("toast.itemDeleted"), "success");
    renderStudents();
    renderCategoryFilter();
};

/**
 * KLASSE BEARBEITEN (Umbenennen)
 *
 * Ändert den Namen einer bestehenden Klasse.
 *
 * @param {string} classId - ID der Klasse
 * @param {string} newName - Neuer Name
 */
const editClass = (classId, newName, attendanceEnabled = undefined) => {
    // Neuen Namen validieren
    const validation = validateStringInput(newName, 50);
    if (!validation.isValid) {
        showAlertDialog(validation.error);
        return;
    }

    // Klasse finden und Namen ändern
    const cls = appData.classes.find(c => c.id === classId);
    if (cls) {
        cls.name = validation.value;
        if (typeof attendanceEnabled === 'boolean') {
            cls.attendanceEnabled = attendanceEnabled;
        }
        saveData(t("toast.classEdited"), "success");
        renderClassList();
        renderStudents();
        applyAttendanceVisibility();

        // Wenn es die aktuelle Klasse ist, auch die Überschrift aktualisieren
        if (classId === appData.currentClassId) {
            document.getElementById("current-class-name").textContent = validation.value;
        }
        return true;
    }
    return false;
};

/**
 * KLASSE LÖSCHEN
 *
 * Entfernt eine Klasse komplett (inkl. aller Schüler und Noten).
 * Wenn die gelöschte Klasse die aktuelle war, wird zur ersten
 * verbleibenden Klasse gewechselt.
 *
 * @param {string} classId - ID der zu löschenden Klasse
 */
const deleteClass = (classId) => {
    // Klasse aus dem Array entfernen
    appData.classes = appData.classes.filter(c => c.id !== classId);

    // Wenn wir die aktuelle Klasse gelöscht haben:
    // Zur ersten verbleibenden Klasse wechseln (oder null wenn keine mehr da)
    if (appData.currentClassId === classId) {
        appData.currentClassId = appData.classes.length > 0 ? appData.classes[0].id : null;
    }

    saveData(t("toast.classDeleted"), "success");
    renderClassList();
    renderStudents();
    renderCategoryFilter();

    // UI aktualisieren: Klassenname in Überschrift
    if (appData.currentClassId) {
        const currentClass = appData.classes.find(c => c.id === appData.currentClassId);
        if (currentClass) {
            document.getElementById("current-class-name").textContent = currentClass.name;
        }
    }
};

/**
 * PLUS/MINUS-PROZENT-EINSTELLUNGEN AKTUALISIEREN
 *
 * Definiert die Prozentwerte für +/~/- Noten.
 * Diese werden verwendet, um +/~/- Noten in eine Note umzuwandeln.
 *
 * Beispiel mit Standardwerten (+ = 100%, ~ = 50%, - = 0%):
 * - 2+, 1~, 1- = (200 + 50 + 0) / 4 = 62.5% → Note 2 (bei Standard-Prozentbereichen)
 * - 3+, 0~, 1- = (300 + 0 + 0) / 4 = 75% → Note 2
 * - 1+, 2~, 2- = (100 + 100 + 0) / 5 = 40% → Note 4
 *
 * @param {number} plusPercent - Prozentwert für Plus (Standard: 100)
 * @param {number} neutralPercent - Prozentwert für Neutral (Standard: 50)
 * @param {number} minusPercent - Prozentwert für Minus (Standard: 0)
 */
const updatePlusMinusPercentages = (plusPercent, neutralPercent, minusPercent) => {
    // Alle Werte zu Zahlen konvertieren
    const plus = parseFloat(plusPercent);
    const neutral = parseFloat(neutralPercent);
    const minus = parseFloat(minusPercent);

    // VALIDIERUNG: Alle Werte müssen zwischen 0 und 100 liegen
    if (isNaN(plus) || plus < 0 || plus > 100) {
        showAlertDialog(t("validation.percentRange"));
        return;
    }

    if (isNaN(neutral) || neutral < 0 || neutral > 100) {
        showAlertDialog(t("validation.percentRange"));
        return;
    }

    if (isNaN(minus) || minus < 0 || minus > 100) {
        showAlertDialog(t("validation.percentRange"));
        return;
    }

    // Einstellungen speichern
    appData.plusMinusPercentages = {
        plus: plus,
        neutral: neutral,
        minus: minus
    };

    saveData();
    // Schülertabelle neu rendern (Durchschnitte werden neu berechnet)
    renderStudents();
};

/**
 * PROZENTBEREICHE FÜR NOTEN AKTUALISIEREN
 *
 * Speichert die Prozentbereiche für jede Note (1-5).
 * Diese werden verwendet, um Prozentangaben in Noten umzuwandeln.
 *
 * @param {Array} ranges - Array mit {grade, minPercent, maxPercent} Objekten
 */
const updateGradePercentageRanges = (ranges) => {
    // Validierung: Alle Bereiche prüfen
    for (const range of ranges) {
        const min = parseFloat(range.minPercent);
        const max = parseFloat(range.maxPercent);

        if (isNaN(min) || isNaN(max)) {
            showAlertDialog(t("validation.percentMustBeNumber"));
            return false;
        }

        if (min < 0 || min > 100 || max < 0 || max > 100) {
            showAlertDialog(t("validation.percentRange"));
            return false;
        }

        if (min > max) {
            showAlertDialog(t("validation.gradeMinMax", { grade: range.grade }));
            return false;
        }
    }

    // Einstellungen speichern
    appData.gradePercentageRanges = ranges;
    saveData(t("toast.gradeRangesSaved"), "success");
    return true;
};

/**
 * PROZENT ZU NOTE KONVERTIEREN
 *
 * Wandelt einen Prozentwert in eine Note um, basierend auf den
 * konfigurierten Prozentbereichen.
 *
 * @param {number} percent - Prozentwert (0-100)
 * @returns {number} - Note (1-5) oder null wenn ungültig
 */
const percentToGrade = (percent) => {
    const p = parseFloat(percent);
    if (isNaN(p) || p < 0 || p > 100) {
        return null;
    }

    // Standardbereiche falls keine konfiguriert
    const ranges = appData.gradePercentageRanges || [
        { grade: 1, minPercent: 85, maxPercent: 100 },
        { grade: 2, minPercent: 70, maxPercent: 84 },
        { grade: 3, minPercent: 55, maxPercent: 69 },
        { grade: 4, minPercent: 40, maxPercent: 54 },
        { grade: 5, minPercent: 0, maxPercent: 39 }
    ];

    // Passenden Bereich finden
    for (const range of ranges) {
        if (p >= range.minPercent && p <= range.maxPercent) {
            return range.grade;
        }
    }

    // Falls kein Bereich passt, Note 5 zurückgeben
    return 5;
};

/**
 * NOTE ZU PROZENT KONVERTIEREN (REVERSE)
 *
 * Wandelt eine Note zurück in einen Prozentwert um, basierend auf den
 * konfigurierten Prozentbereichen. Gibt die Mitte des Bereichs zurück.
 *
 * @param {number} grade - Note (1-6)
 * @returns {number} - Prozentwert (0-100) oder null wenn ungültig
 */
const gradeToPercent = (grade) => {
    const g = parseFloat(grade);
    if (isNaN(g) || g < 1 || g > 6) {
        return null;
    }

    // Standardbereiche falls keine konfiguriert
    const ranges = appData.gradePercentageRanges || [
        { grade: 1, minPercent: 85, maxPercent: 100 },
        { grade: 2, minPercent: 70, maxPercent: 84 },
        { grade: 3, minPercent: 55, maxPercent: 69 },
        { grade: 4, minPercent: 40, maxPercent: 54 },
        { grade: 5, minPercent: 0, maxPercent: 39 }
    ];

    // Finde den passenden Bereich für die Note
    // Bei Note 6 (Nicht beurteilt) gibt es keinen Prozentbereich, return null
    if (g === 6) {
        return null;
    }

    // Suche nach dem Bereich für die Note (z.B. Note 2 -> 70-84%)
    const range = ranges.find(r => r.grade === Math.floor(g));
    if (!range) {
        return null;
    }

    // Berechne die Mitte des Bereichs als Startwert
    // Bei Dezimalnoten (z.B. 2.3) interpolieren wir zwischen den Bereichen
    const gradeInt = Math.floor(g);
    const gradeFraction = g - gradeInt;

    if (gradeFraction === 0) {
        // Ganzzahlige Note: Mitte des Bereichs
        return Math.round((range.minPercent + range.maxPercent) / 2);
    } else {
        // Dezimale Note: Interpolation
        // z.B. Note 2.3 liegt zwischen Note 2 (70-84%) und Note 3 (55-69%)
        const currentRange = range;
        const nextRange = ranges.find(r => r.grade === gradeInt + 1);

        if (!nextRange) {
            // Kein nächster Bereich (z.B. Note 5.x), nutze die untere Grenze
            return Math.round(currentRange.minPercent + (currentRange.maxPercent - currentRange.minPercent) * (1 - gradeFraction));
        }

        // Interpoliere zwischen Mitte des aktuellen Bereichs und Mitte des nächsten Bereichs
        const currentMid = (currentRange.minPercent + currentRange.maxPercent) / 2;
        const nextMid = (nextRange.minPercent + nextRange.maxPercent) / 2;
        return Math.round(currentMid + (nextMid - currentMid) * gradeFraction);
    }
};

// ========== FÄCHER-VERWALTUNG (Subjects) ==========

/**
 * FACH-TEMPLATE AKTUALISIEREN (Upsert)
 *
 * Legt ein Fach in appData.defaultSubjects an oder aktualisiert es.
 * Der Fachname ist der eindeutige Schlüssel.
 *
 * @param {string} name - Fachname
 * @param {{ minAttendancePercent, warningThreshold, attendanceAutoGrading }} settings
 */
const upsertSubjectTemplate = (name, settings) => {
    if (!appData.defaultSubjects) appData.defaultSubjects = [];
    const existing = appData.defaultSubjects.find(t => t.name === name);
    if (existing) {
        existing.minAttendancePercent = settings.minAttendancePercent;
        existing.warningThreshold = settings.warningThreshold;
        existing.attendanceAutoGrading = settings.attendanceAutoGrading;
    } else {
        appData.defaultSubjects.push({
            name,
            minAttendancePercent: settings.minAttendancePercent,
            warningThreshold: settings.warningThreshold,
            attendanceAutoGrading: settings.attendanceAutoGrading
        });
    }
};

/**
 * ALLE FÄCHER EINES NAMENS SYNCHRONISIEREN
 *
 * Liest die Anwesenheitseinstellungen aus dem Template (defaultSubjects)
 * und schreibt sie in alle Fächer mit diesem Namen in allen Klassen/Jahrgängen.
 *
 * @param {string} name - Fachname
 */
const syncSubjectByName = (name) => {
    if (!appData.defaultSubjects || !appData.classes) return;
    const template = appData.defaultSubjects.find(t => t.name === name);
    if (!template) return;
    appData.classes.forEach(cls => {
        if (!cls.years) return;
        cls.years.forEach(year => {
            if (!year.subjects) return;
            year.subjects.forEach(subj => {
                if (subj.name === name) {
                    subj.minAttendancePercent = template.minAttendancePercent;
                    subj.warningThreshold = template.warningThreshold;
                    subj.attendanceAutoGrading = template.attendanceAutoGrading;
                }
            });
        });
    });
};

/**
 * FACH HINZUFÜGEN
 *
 * Erstellt ein neues Unterrichtsfach für die aktuelle Klasse.
 * Anwesenheitseinstellungen werden aus dem globalen Template geerbt
 * wenn nicht explizit angegeben. Änderungen werden in alle Fächer
 * mit demselben Namen synchronisiert.
 *
 * @param {string} classId - ID der Klasse
 * @param {string} name - Name des Fachs (z.B. "Mathematik")
 * @param {number|null} minAttendancePercent - Mindest-Anwesenheit (null = aus Template/global)
 * @param {number|null} warningThreshold - Warnschwelle (null = aus Template/global)
 * @param {boolean|null} attendanceAutoGrading - Auto-Grading (null = aus Template/global)
 */
const addSubject = (classId, name, minAttendancePercent = null, warningThreshold = null, attendanceAutoGrading = null) => {
    const validation = validateStringInput(name, 50);
    if (!validation.isValid) {
        showAlertDialog(validation.error);
        return;
    }

    const cls = appData.classes.find(c => c.id === classId);
    if (!cls) {
        console.error("Class not found!");
        return;
    }

    const currentYear = cls.years ? cls.years.find(y => y.id === cls.currentYearId) : null;
    if (!currentYear) {
        console.error("Current year not found!");
        return;
    }

    if (!currentYear.subjects) currentYear.subjects = [];

    // Inherit from template if settings not explicitly provided
    const template = appData.defaultSubjects?.find(t => t.name === validation.value);
    const resolvedMin = minAttendancePercent !== null ? minAttendancePercent : (template?.minAttendancePercent ?? null);
    const resolvedWarn = warningThreshold !== null ? warningThreshold : (template?.warningThreshold ?? null);
    const resolvedAutoGrading = attendanceAutoGrading !== null ? attendanceAutoGrading : (template?.attendanceAutoGrading ?? null);

    const newSubject = {
        id: Date.now().toString() + '-' + Math.floor(Math.random() * 1000),
        name: validation.value,
        minAttendancePercent: (resolvedMin !== null && !isNaN(resolvedMin)) ? Math.min(100, Math.max(0, Number(resolvedMin))) : null,
        warningThreshold: (resolvedWarn !== null && !isNaN(resolvedWarn)) ? Math.min(100, Math.max(0, Number(resolvedWarn))) : null,
        attendanceAutoGrading: resolvedAutoGrading !== null ? Boolean(resolvedAutoGrading) : null
    };

    currentYear.subjects.push(newSubject);

    // Update global template and sync all subjects with this name
    upsertSubjectTemplate(newSubject.name, newSubject);
    syncSubjectByName(newSubject.name);

    saveData(t("toast.subjectAdded"), "success");
    renderSubjectTabs();
};

/**
 * FACH BEARBEITEN
 *
 * Ändert Name und Anwesenheitseinstellungen eines Fachs.
 * Aktualisiert das globale Template und synchronisiert alle Fächer
 * mit demselben Namen in allen Klassen und Jahrgängen.
 *
 * @param {string} classId - ID der Klasse
 * @param {string} subjectId - ID des Fachs
 * @param {string} newName - Neuer Name
 * @param {number|null} minAttendancePercent - Mindest-Anwesenheit
 * @param {number|null} warningThreshold - Warnschwelle
 * @param {boolean|null} attendanceAutoGrading - Auto-Grading
 */
const editSubject = (classId, subjectId, newName, minAttendancePercent = null, warningThreshold = null, attendanceAutoGrading = null) => {
    const validation = validateStringInput(newName, 50);
    if (!validation.isValid) {
        showAlertDialog(validation.error);
        return;
    }

    const cls = appData.classes.find(c => c.id === classId);
    if (!cls) return;

    const currentYear = cls.years ? cls.years.find(y => y.id === cls.currentYearId) : null;
    if (!currentYear || !currentYear.subjects) return;

    const subject = currentYear.subjects.find(s => s.id === subjectId);
    if (subject) {
        subject.name = validation.value;
        subject.minAttendancePercent = (minAttendancePercent !== null && !isNaN(minAttendancePercent)) ? Math.min(100, Math.max(0, Number(minAttendancePercent))) : null;
        subject.warningThreshold = (warningThreshold !== null && !isNaN(warningThreshold)) ? Math.min(100, Math.max(0, Number(warningThreshold))) : null;
        subject.attendanceAutoGrading = attendanceAutoGrading !== null ? Boolean(attendanceAutoGrading) : null;

        // Update global template and sync all subjects with this name
        upsertSubjectTemplate(subject.name, subject);
        syncSubjectByName(subject.name);

        saveData(t("toast.subjectRenamed"), "success");
        renderSubjectTabs();
        renderStudents();
        flashRenameSuccessIcon(document.querySelector(`[data-edit-subject="${subjectId}"]`));
    }
};

/**
 * FACH LÖSCHEN
 *
 * Löscht ein Fach und alle zugehörigen Noten.
 *
 * @param {string} classId - ID der Klasse
 * @param {string} subjectId - ID des zu löschenden Fachs
 */
const deleteSubject = (classId, subjectId) => {
    const cls = appData.classes.find(c => c.id === classId);
    if (!cls) return;

    const currentYear = cls.years ? cls.years.find(y => y.id === cls.currentYearId) : null;
    if (!currentYear || !currentYear.subjects) return;

    // Fach aus dem Array entfernen
    currentYear.subjects = currentYear.subjects.filter(s => s.id !== subjectId);

    // Alle Noten dieses Fachs bei allen Schülern dieses Jahrgangs löschen
    if (currentYear.students) {
        currentYear.students.forEach(student => {
            student.grades = student.grades.filter(g => g.subjectId !== subjectId);
        });
    }

    // Wenn das gelöschte Fach das aktive war, erstes verbleibendes Fach wählen
    if (currentYear.currentSubjectId === subjectId) {
        currentYear.currentSubjectId = currentYear.subjects.length > 0 ? currentYear.subjects[0].id : null;
    }

    saveData(t("toast.subjectDeleted"), "success");
    renderSubjectTabs();
    renderStudents();
    renderClassStats();
};

// ========== SCHÜLERZUGANG (Student Access / Share) ==========

/**
 * SCHÜLERZUGANG-DIALOG ÖFFNEN
 *
 * Prüft ob bereits ein Share für die aktuelle Klasse existiert
 * und zeigt entsprechend die Erstell- oder Verwaltungs-UI.
 */
const openStudentAccessDialog = async () => {
    const currentClass = appData.classes.find(c => c.id === appData.currentClassId);
    if (!currentClass) return;

    const dialog = document.getElementById('student-access-dialog');
    const content = document.getElementById('student-access-content');

    // Show loading
    content.innerHTML = '<div class="flex items-center justify-center p-8"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="animate-spin lucide lucide-loader-circle-icon lucide-loader-circle"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg></div>';
    dialog.showModal();

    try {
        const response = await fetch(`/api/share/class/status/${encodeURIComponent(currentClass.id)}`);
        const data = await response.json();

        if (data.success && data.has_share) {
            renderActiveShare(content, data, currentClass);
        } else {
            renderCreateShare(content, currentClass);
        }
    } catch (error) {
        content.innerHTML = `<p class="text-red-500">${t("error.loadingShareStatus")}</p>`;
    }
};

// Make the function globally available
window.openStudentAccessDialog = openStudentAccessDialog;

/**
 * UI: Share erstellen
 */
const renderCreateShare = (container, currentClass) => {
    // Get the current year from the class
    const currentYear = currentClass.years ? currentClass.years.find(y => y.id === currentClass.currentYearId) : null;
    const subjects = currentYear && currentYear.subjects ? currentYear.subjects : [];

    // Generate subject checkboxes HTML
    let subjectCheckboxes = '';
    if (subjects.length > 0) {
        subjectCheckboxes = `
            <div class="space-y-2">
                <label class="text-sm font-medium">${t("share.subjectsToShare")}</label>
                ${subjects.map(subject => `
                    <label class="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" id="subject-${subject.id}" class="checkbox" checked>
                        <span class="text-sm">${escapeHtml(subject.name)}</span>
                    </label>
                `).join('')}
            </div>
        `;
    } else {
        subjectCheckboxes = `
            <div class="space-y-2">
                <label class="text-sm font-medium">${t("share.subjectsToShare")}</label>
                <p class="text-sm text-gray-500">${t("share.noSubjectsAvailable")}</p>
            </div>
        `;
    }

    container.innerHTML = `
        <div class="space-y-4">
            <p class="text-gray-400 text-sm">
                ${t("share.createLink", { name: escapeHtml(currentClass.name) })}
            </p>

            <div class="grid gap-2">
                <label class="text-sm font-medium">${t("share.validityPeriod")}</label>
                <select id="share-expires" class="select w-full" data-icon="clock">
                    <option value="24">${t("share.1day")}</option>
                    <option value="72">${t("share.3days")}</option>
                    <option value="168" selected>${t("share.1week")}</option>
                    <option value="720">${t("share.1month")}</option>
                    <option value="2160">${t("share.3months")}</option>
                </select>
            </div>

            ${subjectCheckboxes}

            <div class="space-y-2">
                <label class="text-sm font-medium">${t("share.visibleInfo")}</label>
                <label class="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" id="vis-grades" class="checkbox" checked>
                    <span class="text-sm">${t("share.individualGrades")}</span>
                </label>
                <label class="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" id="vis-average" class="checkbox" checked>
                    <span class="text-sm">${t("share.average")}</span>
                </label>
                <label class="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" id="vis-finalGrade" class="checkbox" checked>
                    <span class="text-sm">${t("share.finalGrade")}</span>
                </label>
                <label class="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" id="vis-categoryBreakdown" class="checkbox">
                    <span class="text-sm">${t("share.categoryBreakdown")}</span>
                </label>
                <label class="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" id="vis-chart" class="checkbox">
                    <span class="text-sm">${t("share.gradeChart")}</span>
                </label>
            </div>

            <button id="create-share-btn" class="btn-primary w-full">
                <svg class="lucide lucide-link-icon lucide-link" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                ${t("share.createAccess")}
            </button>
        </div>
    `;

    document.getElementById('create-share-btn').addEventListener('click', () => createClassShare(container, currentClass));
};

/**
 * Share erstellen (API-Call)
 */
const createClassShare = async (container, currentClass) => {
    const btn = document.getElementById('create-share-btn');
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `${SPINNER_SVG} ${t("loading.creating")}`;

    const visibility = {
        grades: document.getElementById('vis-grades').checked,
        average: document.getElementById('vis-average').checked,
        finalGrade: document.getElementById('vis-finalGrade').checked,
        categoryBreakdown: document.getElementById('vis-categoryBreakdown').checked,
        chart: document.getElementById('vis-chart').checked
    };

    // Get the current year from the class
    const currentYear = currentClass.years ? currentClass.years.find(y => y.id === currentClass.currentYearId) : null;
    const subjects = currentYear && currentYear.subjects ? currentYear.subjects : [];

    // Get selected subjects
    const selectedSubjects = [];
    if (subjects && subjects.length > 0) {
        subjects.forEach(subject => {
            const checkbox = document.getElementById(`subject-${subject.id}`);
            if (checkbox && checkbox.checked) {
                selectedSubjects.push(subject.id);
            }
        });
    }

    const expiresHours = parseInt(document.getElementById('share-expires').value);

    try {
        const response = await fetch('/api/share/class', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                class_id: currentClass.id,
                expires_hours: expiresHours,
                visibility,
                subjects: selectedSubjects
            })
        });

        const data = await response.json();

        if (data.success) {
            showToast(t("toast.accessCreated"), 'success');
            // Show PIN list immediately
            renderPinListView(container, data.token, data.pins, currentClass);
        } else {
            showToast(data.message || t("error.creatingShare"), 'error');
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    } catch (error) {
        showToast(t("error.connectionError"), 'error');
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
};

/**
 * PIN-Liste nach dem Erstellen anzeigen
 */
const renderPinListView = (container, token, pins, currentClass) => {
    const shareUrl = `${window.location.origin}/grades/${token}`;

    let tableContent = '';
    if (pins.length === 0) {
        // Check if there are actually students in the class to determine the appropriate message
        const currentYear = currentClass.years ? currentClass.years.find(y => y.id === currentClass.currentYearId) : null;
        const students = currentYear && currentYear.students ? currentYear.students : [];

        if (students.length === 0) {
            // No students in class
            tableContent = `
                <div class="p-4 text-center text-sm text-gray-500">
                    ${t("share.noStudentsInClass")}
                </div>
            `;
        } else {
            // Students exist in class but no PINs were generated (shouldn't normally happen)
            tableContent = `
                <div class="p-4 text-center text-sm text-gray-500">
                    ${t("share.noPinsGenerated")}
                </div>
            `;
        }
    } else {
        // Students exist, show PIN table
        tableContent = `
            <table class="table w-full text-sm">
                <thead>
                    <tr><th>${t("table.lastName")}</th><th>${t("share.pin")}</th><th></th></tr>
                </thead>
                <tbody>
                    ${pins.map(p => `
                        <tr>
                            <td>${escapeHtml(p.name)}</td>
                            <td><code class="text-lg tracking-widest font-mono">${escapeHtml(p.pin)}</code></td>
                            <td>
                                <button class="btn-sm-icon-outline copy-pin-btn" data-pin="${safeAttr(p.pin)}" data-tooltip="${t("share.copyPin")}" data-side="left">
                                    <svg class="lucide lucide-copy-icon lucide-copy" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
                                    </svg>
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    container.innerHTML = `
        <div class="space-y-4">
            <div class="p-3 rounded-lg border bg-green-500/10 border-green-500/30">
                <p class="text-sm font-medium text-green-500 mb-1">${t("share.accessCreated")}</p>
                <p class="text-gray-400 text-sm">${t("share.pinWarning")}</p>
            </div>

            <div class="grid gap-2">
                <label class="text-sm font-medium">${t("share.accessLink")}</label>
                <div class="flex gap-2">
                    <input type="text" class="input flex-1 text-sm" value="${safeAttr(shareUrl)}" readonly id="share-url-input">
                    <button class="btn-outline" id="copy-share-url" data-tooltip="${t("share.copyLink")}" data-side="top">
                        <svg class="lucide lucide-copy-icon lucide-copy" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
                        </svg>
                    </button>
                </div>
            </div>

            <!-- QR Code Section -->
            <div class="flex flex-col items-center justify-center p-4 border rounded-lg bg-white">
                <label class="text-sm font-medium mb-2">${t("share.qrCode")}</label>
                <div id="qr-code-container" class="flex items-center justify-center p-4 bg-white border rounded-lg">
                    <div id="qr-code-placeholder" class="text-center">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="animate-spin mx-auto mb-2 lucide lucide-loader-circle-icon lucide-loader-circle">
                            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                        </svg>
                        <p class="text-sm">${t("share.generatingQR")}</p>
                    </div>
                    <img id="qr-code-image" class="hidden max-w-xs max-h-xs" alt="${t("share.qrCodeAlt")}">
                </div>
                <p class="text-gray-400 text-sm mt-2 text-center">${t("share.qrCodeDescription")}</p>
            </div>

            <div>
                <div class="flex items-center justify-between mb-2">
                    <label class="text-sm font-medium">${t("share.studentPins")}</label>
                    ${pins.length > 0 ? `<button class="btn-sm-outline" id="copy-all-pins">${lucideIcon('copy')} ${t("share.copyAll")}</button>` : ''}
                </div>
                <div class="overflow-x-auto border rounded-lg">
                    ${tableContent}
                </div>
            </div>

            <button class="btn-outline w-full" id="pin-list-done">${t("share.done")}</button>
        </div>
    `;

    // Generate QR code
    generateQRCode(shareUrl);

    // Copy URL
    document.getElementById('copy-share-url').addEventListener('click', () => {
        navigator.clipboard.writeText(shareUrl).then(() => showToast(t("toast.linkCopied"), 'success'));
    });

    // Copy individual PINs (only if there are PINs to copy)
    if (pins.length > 0) {
        container.querySelectorAll('.copy-pin-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                navigator.clipboard.writeText(btn.dataset.pin).then(() => showToast(t("toast.pinCopied"), 'success'));
            });
        });

        // Copy all PINs as text
        document.getElementById('copy-all-pins').addEventListener('click', () => {
            const text = pins.map(p => `${p.name}: ${p.pin}`).join('\n');
            navigator.clipboard.writeText(text).then(() => showToast(t("toast.allPinsCopied"), 'success'));
        });
    }

    // Done button -> reload share status
    document.getElementById('pin-list-done').addEventListener('click', () => {
        openStudentAccessDialog();
    });
};

/**
 * Generate QR code for the share URL
 */
const generateQRCode = async (url) => {
    try {
        // First, try the server-side generation
        const response = await fetch('/api/qrcode/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ url: url })
        });

        // Check if the response is OK before trying to parse JSON
        if (response.ok) {
            const data = await response.json();

            if (data.success) {
                const qrImage = document.getElementById('qr-code-image');
                const placeholder = document.getElementById('qr-code-placeholder');
                
                qrImage.src = data.qr_code;
                qrImage.classList.remove('hidden');
                placeholder.classList.add('hidden');
                return; // Success, exit early
            } else {
                console.warn('Server-side QR code generation failed, falling back to client-side:', data.message);
            }
        } else {
            console.warn(`Server-side QR code generation failed with status: ${response.status}, falling back to client-side`);
        }
    } catch (error) {
        console.warn('Server-side QR code generation failed, falling back to client-side:', error);
    }

    // Fallback to client-side QR code generation
    if (typeof QRCode !== 'undefined') {
        try {
            const qrImage = document.getElementById('qr-code-image');
            const placeholder = document.getElementById('qr-code-placeholder');
            
            // Use the client-side QR code library
            const canvas = document.createElement('canvas');
            await QRCode.toCanvas(canvas, url, { width: 200 }); // Fixed width for consistency
            
            // Convert canvas to data URL
            const dataUrl = canvas.toDataURL('image/png');
            
            // Update the image element
            qrImage.src = dataUrl;
            qrImage.classList.remove('hidden');
            placeholder.classList.add('hidden');
            return; // Success with client-side generation
        } catch (clientError) {
            console.error('Client-side QR code generation failed:', clientError);
        }
    } else {
        console.warn('QRCode library not available, skipping client-side generation');
    }
    
    // If both server-side and client-side fail, show error
    const placeholder = document.getElementById('qr-code-placeholder');
    placeholder.innerHTML = `<p class="text-red-500 text-sm">${t("share.qrGenerationError")}</p>`;
};

/**
 * UI: Aktiver Share verwalten
 */
const renderActiveShare = (container, shareData, currentClass) => {
    const shareUrl = `${window.location.origin}/grades/${shareData.token}`;
    const expiresAt = new Date(shareData.expires_at);
    const expiresFormatted = expiresAt.toLocaleDateString('de-AT', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    // Get the current year from the class
    const currentYear = currentClass.years ? currentClass.years.find(y => y.id === currentClass.currentYearId) : null;
    const subjects = currentYear && currentYear.subjects ? currentYear.subjects : [];

    // Generate subject checkboxes HTML
    let subjectCheckboxes = '';
    if (subjects.length > 0) {
        // Determine which subjects are currently shared (default to all if not specified)
        const sharedSubjects = shareData.subjects || subjects.map(s => s.id);

        subjectCheckboxes = `
            <div class="space-y-2">
                <label class="text-sm font-medium">${t("share.subjectsToShare")}</label>
                ${subjects.map(subject => `
                    <label class="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" id="subject-${subject.id}" class="checkbox" ${(sharedSubjects.includes(subject.id)) ? 'checked' : ''}>
                        <span class="text-sm">${escapeHtml(subject.name)}</span>
                    </label>
                `).join('')}
                <button id="save-subjects-btn" class="btn-sm-primary mt-2">${lucideIcon('save')} ${t("share.saveSubjects")}</button>
            </div>
        `;
    } else {
        subjectCheckboxes = `
            <div class="space-y-2">
                <label class="text-sm font-medium">${t("share.subjectsToShare")}</label>
                <p class="text-sm text-gray-500">${t("share.noSubjectsAvailable")}</p>
            </div>
        `;
    }

    const vis = shareData.visibility || {};

    container.innerHTML = `
        <div class="space-y-4">
            <div class="p-3 rounded-lg border bg-blue-500/10 border-blue-500/30">
                <div class="flex items-center gap-2 mb-1">
                    <div class="w-2 h-2 rounded-full bg-green-500"></div>
                    <span class="text-sm font-medium">${t("share.accessActive")}</span>
                </div>
                <p class="text-gray-400 text-sm">${t("share.validUntil", { date: escapeHtml(expiresFormatted), count: shareData.student_count })}</p>
            </div>

            <div class="grid gap-2">
                <label class="text-sm font-medium">${t("share.accessLink")}</label>
                <div class="flex gap-2">
                    <input type="text" class="input flex-1 text-sm" value="${safeAttr(shareUrl)}" readonly id="share-url-input">
                    <button class="btn-outline" id="copy-share-url">
                        <svg class="lucide lucide-copy-icon lucide-copy" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
                        </svg>
                    </button>
                </div>
            </div>

            <!-- QR Code Section -->
            <div class="flex flex-col items-center justify-center p-4 border rounded-lg bg-white">
                <label class="text-sm font-medium mb-2">${t("share.qrCode")}</label>
                <div id="qr-code-container" class="flex items-center justify-center p-4 bg-white border rounded-lg">
                    <div id="qr-code-placeholder" class="text-center">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="animate-spin mx-auto mb-2 lucide lucide-loader-circle-icon lucide-loader-circle">
                            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                        </svg>
                        <p class="text-sm">${t("share.generatingQR")}</p>
                    </div>
                    <img id="qr-code-image" class="hidden max-w-xs max-h-xs" alt="${t("share.qrCodeAlt")}">
                </div>
                <p class="text-gray-400 text-sm mt-2 text-center">${t("share.qrCodeDescription")}</p>
            </div>

            ${subjectCheckboxes}

            <div class="space-y-2">
                <label class="text-sm font-medium">${t("share.visibleInfo")}</label>
                <label class="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" id="vis-grades" class="checkbox" ${vis.grades !== false ? 'checked' : ''}>
                    <span class="text-sm">${t("share.individualGrades")}</span>
                </label>
                <label class="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" id="vis-average" class="checkbox" ${vis.average !== false ? 'checked' : ''}>
                    <span class="text-sm">${t("share.average")}</span>
                </label>
                <label class="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" id="vis-finalGrade" class="checkbox" ${vis.finalGrade !== false ? 'checked' : ''}>
                    <span class="text-sm">${t("share.finalGrade")}</span>
                </label>
                <label class="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" id="vis-categoryBreakdown" class="checkbox" ${vis.categoryBreakdown ? 'checked' : ''}>
                    <span class="text-sm">${t("share.categoryBreakdown")}</span>
                </label>
                <label class="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" id="vis-chart" class="checkbox" ${vis.chart ? 'checked' : ''}>
                    <span class="text-sm">${t("share.gradeChart")}</span>
                </label>
                <button id="save-visibility-btn" class="btn-sm-primary mt-2">${lucideIcon('save')} ${t("share.saveVisibility")}</button>
            </div>

            <hr>

            <div role="group" class="button-group">
                <button id="regenerate-pins-btn" class="btn-outline flex-1">
                    <svg class="lucide lucide-refresh-ccw-icon lucide-refresh-ccw" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/>
                    </svg>
                    ${t("share.newPins")}
                </button>
                <button id="revoke-share-btn" class="btn-destructive flex-1">
                    <svg class="lucide lucide-x-icon lucide-x" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
                    </svg>
                    ${t("share.revokeAccess")}
                </button>
            </div>
        </div>
    `;

    // Generate QR code
    generateQRCode(shareUrl);

    // Copy URL
    document.getElementById('copy-share-url').addEventListener('click', () => {
        navigator.clipboard.writeText(shareUrl).then(() => showToast(t("toast.linkCopied"), 'success'));
    });

    // Save visibility
    document.getElementById('save-visibility-btn').addEventListener('click', async () => {
        const btn = document.getElementById('save-visibility-btn');
        btn.disabled = true;
        btn.textContent = t("error.saving");

        const visibility = {
            grades: document.getElementById('vis-grades').checked,
            average: document.getElementById('vis-average').checked,
            finalGrade: document.getElementById('vis-finalGrade').checked,
            categoryBreakdown: document.getElementById('vis-categoryBreakdown').checked,
            chart: document.getElementById('vis-chart').checked
        };

        try {
            const response = await fetch(`/api/share/class/${shareData.token}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ visibility })
            });
            const result = await response.json();
            if (result.success) {
                showToast(t("toast.visibilitySaved"), 'success');
            } else {
                showToast(result.message || t("error.error"), 'error');
            }
        } catch (error) {
            showToast(t("error.connectionError"), 'error');
        }

        btn.disabled = false;
        btn.innerHTML = `${lucideIcon('save')} ${t("share.saveVisibility")}`;
    });

    // Save subjects
    const saveSubjectsBtn = document.getElementById('save-subjects-btn');
    if (saveSubjectsBtn) {
        saveSubjectsBtn.addEventListener('click', async () => {
            const btn = saveSubjectsBtn;
            btn.disabled = true;
            btn.textContent = t("error.saving");

            // Get the current year from the class
            const currentYear = currentClass.years ? currentClass.years.find(y => y.id === currentClass.currentYearId) : null;
            const subjects = currentYear && currentYear.subjects ? currentYear.subjects : [];

            // Get selected subjects
            const selectedSubjects = [];
            if (subjects && subjects.length > 0) {
                subjects.forEach(subject => {
                    const checkbox = document.getElementById(`subject-${subject.id}`);
                    if (checkbox && checkbox.checked) {
                        selectedSubjects.push(subject.id);
                    }
                });
            }

            try {
                const response = await fetch(`/api/share/class/${shareData.token}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ subjects: selectedSubjects })
                });
                const result = await response.json();
                
                if (result.success) {
                    showToast(t("toast.subjectsSaved"), 'success');
                } else {
                    showToast(result.message || t("error.error"), 'error');
                }
            } catch (error) {
                showToast(t("error.connectionError"), 'error');
            }

            btn.disabled = false;
            btn.innerHTML = `${lucideIcon('save')} ${t("share.saveSubjects")}`;
        });
    }

    // Regenerate PINs
    document.getElementById('regenerate-pins-btn').addEventListener('click', () => {
        showConfirmDialog(t("share.confirmNewPins"), async () => {
            try {
                const response = await fetch(`/api/share/class/${shareData.token}/regenerate-pins`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                const result = await response.json();
                if (result.success) {
                    showToast(t("toast.newPinsGenerated"), 'success');
                    renderPinListView(container, shareData.token, result.pins, currentClass);
                } else {
                    showToast(result.message || t("error.error"), 'error');
                }
            } catch (error) {
                showToast(t("error.connectionError"), 'error');
            }
        });
    });

    // Revoke share
    document.getElementById('revoke-share-btn').addEventListener('click', () => {
        showConfirmDialog(t("share.confirmRevoke"), async () => {
            try {
                const response = await fetch(`/api/share/class/${shareData.token}`, {
                    method: 'DELETE'
                });
                const result = await response.json();
                if (result.success) {
                    showToast(t("toast.accessRevoked"), 'success');
                    openStudentAccessDialog(); // Reload -> will show create form
                } else {
                    showToast(result.message || t("error.error"), 'error');
                }
            } catch (error) {
                showToast(t("error.connectionError"), 'error');
            }
        });
    });
};

// ============ Anwesenheits-Management ============

function addAttendance(studentId, date, status, notes = '', subjectId = null) {
  const validation = validateAttendanceInput(date, status, notes);
  if (!validation.isValid) {
    showAlertDialog(validation.error);
    return false;
  }

  const currentYear = getCurrentYear();
  const student = currentYear.students.find(s => s.id === studentId);

  if (!student) {
    showAlertDialog('Schüler nicht gefunden');
    return false;
  }

  // Check if attendance already exists for this date and subject
  const existingIndex = student.participation.findIndex(p => p.date === date && p.subjectId === subjectId);

  const attendanceEntry = {
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
    date: date,
    status: status,
    notes: escapeHtml(notes),
    subjectId: subjectId,
    createdAt: Date.now()
  };

  if (existingIndex >= 0) {
    // Update existing entry
    student.participation[existingIndex] = attendanceEntry;
  } else {
    // Add new entry
    student.participation.push(attendanceEntry);
  }

  return true;
}

function bulkAddAttendance(attendanceData, date, subjectId = null) {
  // attendanceData = { studentId: { status, notes }, ... }
  let successCount = 0;

  Object.entries(attendanceData).forEach(([studentId, data]) => {
    if (addAttendance(studentId, date, data.status, data.notes || '', subjectId)) {
      successCount++;
    }
  });

  if (successCount > 0) {
    saveData(t('toast.attendanceAdded', { count: successCount }), 'success');
    renderStudents();
  }
}

function deleteAttendance(studentId, attendanceId) {
  const currentYear = getCurrentYear();
  const student = currentYear.students.find(s => s.id === studentId);

  if (!student) return false;

  const index = student.participation.findIndex(p => p.id === attendanceId);
  if (index === -1) return false;

  student.participation.splice(index, 1);
  saveData(t('toast.attendanceDeleted'), 'success');
  renderStudents();
  return true;
}

/**
 * Deletes a specific attendance entry for a student and re-renders the detail view.
 * @param {string} studentId - The student ID
 * @param {string} attendanceId - The attendance entry ID to delete
 */
function deleteAttendanceEntry(studentId, attendanceId) {
  const currentYear = getCurrentYear();
  const student = currentYear.students.find(s => s.id === studentId);

  if (!student) return false;

  const index = student.participation.findIndex(p => p.id === attendanceId);
  if (index === -1) return false;

  const entry = student.participation[index];
  const date = new Date(entry.date).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });

  const message = t('attendance.confirmDelete') || 'Möchten Sie diesen Eintrag wirklich löschen?';
  const details = `${date}: ${t('attendance.' + entry.status)}`;

  showConfirmDialog(message, () => {
    student.participation.splice(index, 1);
    saveData(t('toast.attendanceDeleted'), 'success');
    // Re-render student detail view if open
    const studentDetailView = document.getElementById('student-detail-view');
    if (studentDetailView && studentDetailView.dataset.studentId === studentId) {
      renderStudentDetail(studentId);
    } else {
      renderStudents();
    }
  }, details);
}

/**
 * Opens a dialog to edit an existing attendance entry.
 * @param {string} studentId - The student ID
 * @param {string} attendanceId - The attendance entry ID to edit
 */
function openEditAttendanceDialog(studentId, attendanceId) {
  const currentYear = getCurrentYear();
  const student = currentYear.students.find(s => s.id === studentId);

  if (!student) return;

  const entry = student.participation.find(p => p.id === attendanceId);
  if (!entry) return;

  const date = new Date(entry.date).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });

  // Get subject name
  const subjects = currentYear.subjects || [];
  const subject = subjects.find(s => s.id === entry.subjectId);
  const subjectName = subject ? subject.name : '—';

  const content = `
    <form id="edit-attendance-form" class="form grid gap-4">
      <div class="text-gray-400 text-sm">
        <strong>${date}</strong>
      </div>
      <div class="grid gap-2">
        <label class="text-sm font-medium">${t('attendance.subject')}</label>
        <div class="text-gray-400 text-sm">${escapeHtml(subjectName)}</div>
      </div>
      <div class="grid gap-2">
        <label for="edit-attendance-status" class="text-sm font-medium">${t('attendance.status')}</label>
        <select id="edit-attendance-status" name="edit-attendance-status" class="select" required data-icon="list-checks">
          <option value="present" ${entry.status === 'present' ? 'selected' : ''}>${t('attendance.present')}</option>
          <option value="late" ${entry.status === 'late' ? 'selected' : ''}>${t('attendance.late')}</option>
          <option value="absent" ${entry.status === 'absent' ? 'selected' : ''}>${t('attendance.absent')}</option>
        </select>
      </div>
      <div class="grid gap-2">
        <label for="edit-attendance-notes" class="text-sm font-medium">${t('attendance.notes')}</label>
        <textarea id="edit-attendance-notes" name="edit-attendance-notes" class="textarea" rows="3" maxlength="200">${escapeHtml(entry.notes || '')}</textarea>
        <p class="text-gray-400 text-sm">${t('attendance.notesHint') || 'Optional'}</p>
      </div>
    </form>
  `;

  showDialog('edit-dialog', t('attendance.editEntry') || 'Eintrag bearbeiten', content, (formData) => {
    const newStatus = formData.get('edit-attendance-status');
    const newNotes = formData.get('edit-attendance-notes') || '';

    // Update the entry
    entry.status = newStatus;
    entry.notes = escapeHtml(newNotes);

    saveData(t('toast.attendanceEdited') || 'Anwesenheitseintrag aktualisiert', 'success');

    // Re-render student detail view if open
    const studentDetailView = document.getElementById('student-detail-view');
    if (studentDetailView && studentDetailView.dataset.studentId === studentId) {
      renderStudentDetail(studentId);
    } else {
      renderStudents();
    }
  });
}

/**
 * Prüft ob Anwesenheitsfunktion für eine Klasse aktiv ist.
 * Default true (fehlendes Flag = aktiv für Rückwärtskompatibilität).
 */
function isAttendanceEnabledForClass(cls) {
  if (!cls) return true;
  return cls.attendanceEnabled !== false;
}

/** Shortcut: aktuelle Klasse. */
function isAttendanceEnabledForCurrentClass() {
  return isAttendanceEnabledForClass(getCurrentClass());
}

function getAttendanceForDate(studentId, date, subjectId = null) {
  if (!isAttendanceEnabledForCurrentClass()) return null;
  const currentYear = getCurrentYear();
  const student = currentYear.students.find(s => s.id === studentId);
  if (!student) return null;

  return student.participation.find(p => p.date === date && p.subjectId === subjectId) || null;
}

function calculateAttendanceStats(studentId, subjectId = null) {
  if (!isAttendanceEnabledForCurrentClass()) {
    return { total: 0, present: 0, absent: 0, late: 0, presentRate: 0, absentRate: 0 };
  }
  const currentYear = getCurrentYear();
  const student = currentYear.students.find(s => s.id === studentId);
  if (!student) return null;

  // Filter by subject if provided
  let participation = student.participation;
  if (subjectId !== null) {
    participation = participation.filter(p => p.subjectId === subjectId);
  }

  const total = participation.length;
  const present = participation.filter(p => p.status === 'present').length;
  const absent = participation.filter(p => p.status === 'absent').length;
  const late = participation.filter(p => p.status === 'late').length;

  // presentRate = (present + late) / total — Verspätete sind anwesend
  return {
    total,
    present,
    absent,
    late,
    presentRate: total > 0 ? Math.round(((present + late) / total) * 100) : 0,
    absentRate: total > 0 ? Math.round((absent / total) * 100) : 0
  };
}

/**
 * Prüft den Anwesenheitsstatus eines Schülers gegen die Einstellungen.
 * Gibt zurück: 'critical' (unter Minimum), 'warning' (knapp darüber), 'ok'
 */
function getAttendanceStatus(studentId, subjectId = null) {
  if (!isAttendanceEnabledForCurrentClass()) return { status: 'ok', rate: null, hasData: false };
  const globalSettings = appData.attendanceSettings || { enabled: false, minAttendancePercent: 75, warningThreshold: 5 };

  // Merge subject-specific settings with global fallback
  let settings = { ...globalSettings };
  if (subjectId !== null) {
    const currentYear = getCurrentYear();
    const subject = currentYear?.subjects?.find(s => s.id === subjectId);
    if (subject) {
      settings = {
        enabled: subject.attendanceAutoGrading ?? globalSettings.enabled,
        minAttendancePercent: subject.minAttendancePercent ?? globalSettings.minAttendancePercent,
        warningThreshold: subject.warningThreshold ?? globalSettings.warningThreshold
      };
    }
  }

  if (!settings.enabled) return { status: 'ok', rate: null, hasData: false };

  const stats = calculateAttendanceStats(studentId, subjectId);
  if (!stats || stats.total === 0) return { status: 'ok', rate: null, hasData: false };

  const rate = stats.presentRate;
  const minPercent = settings.minAttendancePercent;
  const warningLimit = minPercent + settings.warningThreshold;

  if (rate < minPercent) {
    return { status: 'critical', rate: rate, minPercent: minPercent, hasData: true };
  } else if (rate < warningLimit) {
    return { status: 'warning', rate: rate, minPercent: minPercent, warningLimit: warningLimit, hasData: true };
  }
  return { status: 'ok', rate: rate, hasData: true };
}

function validateAttendanceInput(date, status, notes) {
  // Validate date
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    return { isValid: false, error: 'Ungültiges Datumsformat' };
  }

  // Validate status
  const validStatuses = ['present', 'absent', 'late'];
  if (!validStatuses.includes(status)) {
    return { isValid: false, error: 'Ungültiger Status' };
  }

  // Validate notes (optional)
  if (notes && notes.length > 500) {
    return { isValid: false, error: 'Notizen zu lang (max. 500 Zeichen)' };
  }

  return { isValid: true };
}
