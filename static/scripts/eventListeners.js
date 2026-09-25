// ========== EVENT LISTENER ==========
document.getElementById("setup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const classNameInput = document.getElementById("class-name").value;

    // Validate class name
    const classValidation = validateStringInput(classNameInput, 50);
    if (!classValidation.isValid) {
        showAlertDialog(classValidation.error);
        return;
    }

    // Use username as default teacher name
    appData.teacherName = window.currentUser.username;
    addClass(classValidation.value);

    // Save data and reload page
    try {
        const saveResponse = await fetch('/api/data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(appData)
        });
        if (!saveResponse.ok) {
            console.error('Failed to save setup data, status:', saveResponse.status);
            showAlertDialog(t('error.savingData'));
            return;
        }
        location.reload();
    } catch (error) {
        console.error('Error saving setup data:', error);
        showAlertDialog(t('error.savingData'));
    }
});

document.getElementById("add-class").addEventListener("click", () => {
    const dialog = document.getElementById("add-class-dialog");
    dialog.showModal();
});

// Event listener for add class form submission
document.getElementById("add-class-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const classNameInput = document.getElementById("class-name-input").value;

    // Validate class name
    const validation = validateStringInput(classNameInput, 50);
    if (!validation.isValid) {
        showAlertDialog(validation.error);
        return;
    }

    addClass(validation.value);
    document.getElementById("add-class-dialog").close();
    document.getElementById("class-name-input").value = ""; // Clear input
});

// Event listener for cancel button
document.getElementById("cancel-add-class").addEventListener("click", () => {
    document.getElementById("add-class-dialog").close();
    document.getElementById("class-name-input").value = ""; // Clear input
});

document.getElementById("add-student").addEventListener("click", () => {
    const dialog = document.getElementById("add-student-dialog");
    dialog.showModal();
});

// Event listener for add student form submission
document.getElementById("add-student-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const firstName = document.getElementById("student-firstname-input").value;
    const middleName = document.getElementById("student-middlename-input").value;
    const lastName = document.getElementById("student-lastname-input").value;

    addStudent(firstName, lastName, middleName);
    document.getElementById("add-student-dialog").close();
    document.getElementById("student-firstname-input").value = "";
    document.getElementById("student-middlename-input").value = "";
    document.getElementById("student-lastname-input").value = "";
});

// Event listener for cancel button
document.getElementById("cancel-add-student").addEventListener("click", () => {
    document.getElementById("add-student-dialog").close();
    document.getElementById("student-firstname-input").value = "";
    document.getElementById("student-middlename-input").value = "";
    document.getElementById("student-lastname-input").value = "";
});

// ============ IMPORT STUDENTS ============

let parsedStudentsToImport = [];

// Download CSV template
document.getElementById("download-csv-template-btn").addEventListener("click", () => {
    // Create example CSV with header
    const csvContent = `Vorname,Zweitname,Nachname
Max,Maria,Mustermann
Anna,,Schmidt
Tom,Felix,Meyer
Lisa,Sophie,Wagner`;

    // Create blob and download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);

    link.setAttribute("href", url);
    link.setAttribute("download", "schueler_vorlage.csv");
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
});

const resetImportStudentsDialog = () => {
    document.getElementById("import-students-file").value = "";
    document.getElementById("import-students-preview").classList.add("hidden");
    document.getElementById("import-students-table").innerHTML = "";
    document.getElementById("confirm-import-students").disabled = true;
    parsedStudentsToImport = [];
};

const detectColumnType = (header) => {
    const h = header.toLowerCase().trim();
    if (['nachname', 'lastname', 'last_name', 'last name', 'familienname', 'surname'].includes(h)) return 'lastName';
    if (['vorname', 'firstname', 'first_name', 'first name'].includes(h)) return 'firstName';
    if (['zweitname', 'middlename', 'middle_name', 'middle name', 'zweitvorname', 'zweiter vorname', 'mittelname'].includes(h)) return 'middleName';
    if (h === 'name') return 'lastName';
    return null;
};

const parseCSVStudents = (text) => {
    const lines = text.split(/\r?\n/).filter(line => line.trim());
    if (lines.length === 0) return [];

    // Detect delimiter (semicolon or comma)
    const delimiter = lines[0].includes(';') ? ';' : ',';

    // Check if first line is a header by trying to map columns
    const firstLineParts = lines[0].split(delimiter).map(p => p.trim().replace(/^["']|["']$/g, ''));
    const columnMap = firstLineParts.map(detectColumnType);
    const isHeader = columnMap.some(type => type !== null);

    let dataLines;
    let getStudent;

    if (isHeader) {
        // Dynamic mapping based on header names
        dataLines = lines.slice(1);
        getStudent = (parts) => {
            const student = { firstName: '', lastName: '', middleName: '' };
            for (let i = 0; i < columnMap.length && i < parts.length; i++) {
                if (columnMap[i]) student[columnMap[i]] = parts[i] || '';
            }
            return student;
        };
    } else {
        // No header: default to Vorname[,Zweitname],Nachname
        dataLines = lines;
        getStudent = (parts) => {
            if (parts.length === 1) return { lastName: parts[0], firstName: '', middleName: '' };
            if (parts.length === 2) return { firstName: parts[0], lastName: parts[1], middleName: '' };
            return { firstName: parts[0], middleName: parts[1] || '', lastName: parts[2] || '' };
        };
    }

    const students = [];
    for (const line of dataLines) {
        const parts = line.split(delimiter).map(p => p.trim().replace(/^["']|["']$/g, ''));
        if (parts.length === 0 || parts.every(p => !p)) continue;
        const student = getStudent(parts);
        if (student.firstName || student.lastName) students.push(student);
    }
    return students;
};

const parseJSONStudents = (text) => {
    const data = JSON.parse(text);
    if (!Array.isArray(data)) return [];
    return data
        .filter(item => item && typeof item === 'object')
        .map(item => ({
            lastName: String(item.lastName || item.nachname || item.last_name || ''),
            firstName: String(item.firstName || item.vorname || item.first_name || ''),
            middleName: String(item.middleName || item.zweitname || item.middle_name || '')
        }))
        .filter(s => s.lastName || s.firstName);
};

const showImportPreview = (students) => {
    const preview = document.getElementById("import-students-preview");
    const table = document.getElementById("import-students-table");
    const count = document.getElementById("import-students-count");
    const confirmBtn = document.getElementById("confirm-import-students");

    if (students.length === 0) {
        preview.classList.remove("hidden");
        count.textContent = t("import.noStudentsFound");
        table.innerHTML = "";
        confirmBtn.disabled = true;
        return;
    }

    count.textContent = t("import.studentsFound").replace("{count}", students.length);
    table.innerHTML = students.map(s => `
        <tr>
            <td>${escapeHtml(s.lastName)}</td>
            <td>${escapeHtml(s.firstName)}</td>
            <td>${escapeHtml(s.middleName)}</td>
        </tr>
    `).join("");
    preview.classList.remove("hidden");
    confirmBtn.disabled = false;
};

document.getElementById("import-students-btn").addEventListener("click", () => {
    resetImportStudentsDialog();
    document.getElementById("import-students-dialog").showModal();
});

document.getElementById("import-students-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
        const text = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (ev) => resolve(ev.target.result);
            reader.onerror = (err) => reject(err);
            reader.readAsText(file);
        });

        if (file.name.toLowerCase().endsWith('.json')) {
            parsedStudentsToImport = parseJSONStudents(text);
        } else {
            parsedStudentsToImport = parseCSVStudents(text);
        }

        showImportPreview(parsedStudentsToImport);
    } catch (err) {
        console.error("Error reading import file:", err);
        showAlertDialog(t("import.parseError"));
    }
});

document.getElementById("confirm-import-students").addEventListener("click", () => {
    if (parsedStudentsToImport.length === 0) return;

    const currentYear = getCurrentYear();
    if (!currentYear) return;

    const skippedNames = [];
    let addedCount = 0;

    for (const student of parsedStudentsToImport) {
        const firstNameVal = validateStringInput(student.firstName || '', 50);
        const lastNameVal = validateStringInput(student.lastName || '', 50);
        const middleNameVal = student.middleName ? validateStringInput(student.middleName, 50) : { isValid: true, value: '' };

        const firstName = firstNameVal.isValid ? firstNameVal.value : '';
        const lastName = lastNameVal.isValid ? lastNameVal.value : '';
        const middleName = middleNameVal.isValid ? middleNameVal.value : '';

        // Duplikat-Prüfung: Vorname + Nachname (case-insensitive)
        const isDuplicate = currentYear.students.some(s =>
            s.firstName.toLowerCase() === firstName.toLowerCase() &&
            s.lastName.toLowerCase() === lastName.toLowerCase()
        );

        if (isDuplicate) {
            skippedNames.push([firstName, middleName, lastName].filter(Boolean).join(' '));
            continue;
        }

        currentYear.students.push({
            id: Date.now().toString() + '-' + Math.floor(Math.random() * 10000),
            firstName,
            lastName,
            middleName,
            grades: [],
            participation: []
        });
        addedCount++;
    }

    saveData();
    renderStudents();
    document.getElementById("import-students-dialog").close();
    resetImportStudentsDialog();

    if (addedCount > 0) {
        showToast(t("toast.studentsImported").replace("{count}", addedCount), "success");
    }
    if (skippedNames.length > 0) {
        showAlertDialog(t("error.studentsDuplicateSkipped").replace("{names}", skippedNames.join("\n")));
    }
});

document.getElementById("cancel-import-students").addEventListener("click", () => {
    document.getElementById("import-students-dialog").close();
    resetImportStudentsDialog();
});

// Settings dirty-tracking flag
window.settingsDirty = false;

// Event delegation: any input/change inside settings-view marks it dirty.
// This covers all inputs (grade ranges, plus/minus, attendance) without naming them individually.
const settingsViewEl = document.getElementById("settings-view");
if (settingsViewEl) {
    settingsViewEl.addEventListener("input", () => { window.settingsDirty = true; });
    settingsViewEl.addEventListener("change", () => { window.settingsDirty = true; });
}

// Nav settings button → open settings view
document.getElementById("nav-settings").addEventListener("click", () => {
    showSettingsView();
});


document.getElementById("save-plusminus-settings").addEventListener("click", () => {
    const plusPercent = document.getElementById("plusminus-plus-percent").value;
    const neutralPercent = document.getElementById("plusminus-neutral-percent").value;
    const minusPercent = document.getElementById("plusminus-minus-percent").value;
    updatePlusMinusPercentages(plusPercent, neutralPercent, minusPercent);
    window.settingsDirty = false;
    showToast(t("toast.plusMinusSettingsSaved"), "success");
});

// Event listener for saving percentage ranges
document.getElementById("save-percentage-ranges").addEventListener("click", () => {
    const ranges = [];
    for (let grade = 1; grade <= 5; grade++) {
        const minInput = document.getElementById(`grade-${grade}-min`);
        const maxInput = document.getElementById(`grade-${grade}-max`);
        if (minInput && maxInput) {
            ranges.push({
                grade: grade,
                minPercent: parseFloat(minInput.value),
                maxPercent: parseFloat(maxInput.value)
            });
        }
    }
    if (updateGradePercentageRanges(ranges)) {
        window.settingsDirty = false;
        showToast(t("toast.gradeRangesSaved"), "success");
    }
});

// Event listener for saving attendance settings
document.getElementById("save-attendance-settings").addEventListener("click", () => {
    const enabled = document.getElementById("attendance-auto-grading").checked;
    const minPercent = parseFloat(document.getElementById("attendance-min-percent").value);
    const warningThreshold = parseFloat(document.getElementById("attendance-warning-threshold").value);

    // Validation
    if (isNaN(minPercent) || minPercent < 0 || minPercent > 100) {
        showAlertDialog("Mindest-Anwesenheit muss zwischen 0 und 100% liegen");
        return;
    }
    if (isNaN(warningThreshold) || warningThreshold < 0 || warningThreshold > 20) {
        showAlertDialog("Warnungs-Schwelle muss zwischen 0 und 20% liegen");
        return;
    }

    // Save settings
    appData.attendanceSettings = {
        enabled: enabled,
        minAttendancePercent: minPercent,
        warningThreshold: warningThreshold
    };

    window.settingsDirty = false;
    saveData(t("toast.attendanceSettingsSaved") || "Anwesenheitseinstellungen gespeichert", "success");
    renderStudents();

    // If student detail view is open, re-render it
    const detailView = document.getElementById("student-detail-view");
    if (detailView && !detailView.classList.contains("hidden")) {
        const studentId = detailView.dataset.studentId;
        if (studentId) renderStudentDetail(studentId);
    }
});

// Event-Listener fuer den Kategorie hinzufuegen Button im Dialog
document.getElementById("add-category").addEventListener("click", () => {
    const content = `
        <div class="grid gap-2">
          <label class="block mb-2">${t("category.categoryName")}</label>
          <input type="text" name="name" class="input w-full" required>
          <p class="text-gray-400 text-sm">${t("category.categoryNameHint")}</p>
        </div>
        <div class="grid gap-2">
          <label class="block mb-2">${t("category.weight")}</label>
          <input type="number" name="weight" step="1" min="1" max="100" class="input w-full" required>
          <p class="text-gray-400 text-sm">${t("category.weightHint")} (${t("category.inPercent")})</p>
        </div>
        <div class="grid gap-2">
          <label class="flex items-center gap-2">
            <input type="checkbox" name="onlyPlusMinus" class="checkbox">
            <span>${t("category.plusMinusOnly")}</span>
          </label>
          <p class="text-gray-400 text-sm">${t("category.plusMinusHint")}</p>
        </div>
      `;

    showDialog("edit-dialog", t("category.addCategory"), content, (formData) => {
        const name = formData.get("name");
        const weight = parseFloat(formData.get("weight")); // This will be the percentage value from the UI
        const onlyPlusMinus = formData.get("onlyPlusMinus") === "on";

        // Validate the weight (this will convert percentage to decimal)
        const weightValidation = validateWeight(weight);
        if (!weightValidation.isValid) {
            showAlertDialog(weightValidation.error);
            return;
        }
        
        const decimalWeight = weightValidation.value; // This is the decimal value for internal use
        
        addCategory(name, decimalWeight, false, onlyPlusMinus);
        renderCategoryManagement();
    });
});

document.getElementById("export-data").addEventListener("click", exportData);

document.getElementById("search-students").addEventListener("input", renderStudents);
document.getElementById("filter-category").addEventListener("change", renderStudents);
document.getElementById("filter-attendance").addEventListener("change", renderStudents);

// Ensure data is loaded when the page loads
document.addEventListener("DOMContentLoaded", async () => {
    // Wait for translations to load before rendering UI
    await I18n.ready;

    // Pure org-admin accounts have no personal gradebook — skip the normal
    // data-loading flow entirely and show the dedicated org-admin dashboard.
    if (window.currentUser && window.currentUser.account_type === 'org_admin') {
        document.getElementById("setup-page")?.classList.add("hidden");
        document.getElementById("dashboard")?.classList.add("hidden");
        document.getElementById("org-admin-view")?.classList.remove("hidden");
        I18n.applyI18nToDOM();
        if (window.renderOrgAdminDashboard) window.renderOrgAdminDashboard();
        return;
    }

    // Load data from server (async); returns true on success, false on network/server error
    const dataLoaded = await loadData();

    // Check for app version updates
    initVersionCheck();

    if (!dataLoaded) {
        // Data loading failed (network error or server error).
        // Do NOT show the setup screen — this user is already logged in and
        // likely has existing data. Leaving setup-page hidden avoids
        // accidentally triggering re-setup for an account that already has data.
        document.getElementById("setup-page").classList.add("hidden");
        document.getElementById("dashboard").classList.add("hidden");
        document.dispatchEvent(new CustomEvent('app:dataLoaded'));
        return;
    }

    // Check if user has completed setup (has classes)
    if (appData.classes && appData.classes.length > 0) {
        document.getElementById("setup-page").classList.add("hidden");
        document.getElementById("dashboard").classList.remove("hidden");
        // Use teacherName or fallback to username
        const displayName = appData.teacherName || window.currentUser.username;
        document.getElementById("teacher-greeting").textContent = displayName;
        renderClassList();
        showHomeView();
        I18n.applyI18nToDOM();

        // Tutorial fuer wiederkehrende User anzeigen (falls nicht abgeschlossen)
        if (appData.tutorial && !appData.tutorial.completed && !appData.tutorial.neverShowAgain) {
            setTimeout(() => {
                initTutorial();
            }, 1500);
        }

        // Attach student access button event listener after DOM is loaded and data is ready
        document.getElementById("student-access-btn").addEventListener("click", window.openStudentAccessDialog);
    } else {
        // No classes found — show setup screen for new users
        document.getElementById("setup-page").classList.remove("hidden");
        document.getElementById("dashboard").classList.add("hidden");
    }

    // Signal that data is loaded so the profile avatar can render with correct saved gradient
    document.dispatchEvent(new CustomEvent('app:dataLoaded'));
});

// Home navigation
document.getElementById("nav-home").addEventListener("click", showHomeView);

// Back to class view from student detail
document.getElementById("back-to-class").addEventListener("click", backToClassView);

// Student Access (Share) Dialog
document.getElementById("close-student-access").addEventListener("click", () => {
    document.getElementById("student-access-dialog").close();
});

// ============ Anwesenheit Event Listeners ============

document.addEventListener('click', (e) => {
  if (e.target.closest('#add-attendance-btn')) {
    showAttendanceView();
  }
});


// ============ Compact View Toggle ============
document.addEventListener('click', (e) => {
    if (e.target.closest('#compact-view-toggle')) {
        const isCompact = localStorage.getItem('edugrade_compact_view') === '1';
        const newCompact = !isCompact;
        localStorage.setItem('edugrade_compact_view', newCompact ? '1' : '0');
        renderStudents();
        // Also update detail view if currently visible
        const detailView = document.getElementById('student-detail-view');
        if (detailView && !detailView.classList.contains('hidden')) {
            detailView.classList.toggle('compact-detail', newCompact);
            const detailGradesTable = document.querySelector('table:has(#student-grades-table)');
            if (detailGradesTable) detailGradesTable.classList.toggle('compact-table', newCompact);
        }
    }
});

// ============ Keyboard Shortcuts ============
document.addEventListener('keydown', (e) => {
    // Skip if focused on input, textarea, select or button
    const tag = document.activeElement?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    // Skip if a modal dialog (not a toast/notification) is open
    const hasModalDialog = Array.from(document.querySelectorAll('dialog[open]'))
        .some(d => !d.classList.contains('toast') && d.getBoundingClientRect().height > 80);
    if (hasModalDialog) return;

    const classView = document.getElementById('class-view');
    const studentDetailView = document.getElementById('student-detail-view');
    const isClassView = classView && !classView.classList.contains('hidden');
    const isStudentDetail = studentDetailView && !studentDetailView.classList.contains('hidden');

    switch (e.key) {
        case 'Escape':
            if (isStudentDetail) {
                e.preventDefault();
                backToClassView();
            }
            break;
        case 's':
        case 'S':
            if (isClassView) {
                e.preventDefault();
                document.getElementById('add-student')?.click();
            }
            break;
        case 'n':
        case 'N':
            if (isStudentDetail) {
                e.preventDefault();
                document.getElementById('student-detail-add-grade')?.click();
            }
            break;
        case 'ArrowLeft':
            if (isStudentDetail) {
                const prevBtn = document.getElementById('prev-student-btn');
                if (prevBtn && !prevBtn.disabled) { e.preventDefault(); prevBtn.click(); }
            }
            break;
        case 'ArrowRight':
            if (isStudentDetail) {
                const nextBtn = document.getElementById('next-student-btn');
                if (nextBtn && !nextBtn.disabled) { e.preventDefault(); nextBtn.click(); }
            }
            break;
    }
});

// Class Exam Mode initialisieren
document.addEventListener('DOMContentLoaded', () => {
    initClassExamMode();
    _initBackNavGuard();
});

// Prevent browser back-button / swipe-back from leaving the app to the login page.
// Pushes a guard state on load; every popstate re-pushes and routes in-app instead.
const _initBackNavGuard = () => {
    history.pushState({ app: true }, '');

    window.addEventListener('popstate', () => {
        const studentDetailView = document.getElementById('student-detail-view');
        const classView         = document.getElementById('class-view');
        const settingsView      = document.getElementById('settings-view');
        const attendanceView    = document.getElementById('attendance-view');

        if (studentDetailView && !studentDetailView.classList.contains('hidden')) {
            backToClassView();
        } else if (classView && !classView.classList.contains('hidden')) {
            showHomeView();
        } else if (settingsView && !settingsView.classList.contains('hidden')) {
            showHomeView();
        } else if (attendanceView && !attendanceView.classList.contains('hidden')) {
            showHomeView();
        }
        // Re-push so there is always a guard entry to consume before the browser leaves the app
        history.pushState({ app: true }, '');
    });
};

// Universelles Button-Press Feedback (deckt jeden Button jetzt und in Zukunft ab)
document.addEventListener("pointerdown", (e) => {
    const btn = e.target.closest(".btn-icon, .btn-primary, .btn-secondary, .btn-outline, .btn-destructive");
    if (!btn) return;
    btn.classList.remove("btn-press");
    void btn.offsetWidth;
    btn.classList.add("btn-press");
});

// Icon-Feedback: Löschen-Icon "wackelt" kurz beim Klick, bevor der Bestätigungsdialog öffnet
document.addEventListener("pointerdown", (e) => {
    const btn = e.target.closest("[data-delete-student], [data-delete-class]");
    if (!btn) return;
    const svg = btn.querySelector("svg");
    if (!svg) return;
    svg.classList.remove("icon-shake");
    void svg.offsetWidth;
    svg.classList.add("icon-shake");
});
