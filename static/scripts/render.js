//render.js
// ========== RENDER-FUNKTIONEN ==========
// Diese Datei enthält alle Funktionen die das UI (User Interface) aktualisieren.
// "Rendern" bedeutet: Daten aus appData nehmen und als HTML darstellen.

/**
 * Updates the main header greeting to show either the default "Hello, Name!"
 * or a contextual page title (class name, student name, etc.).
 * @param {string|null} context - If null, restores greeting. Otherwise shows context text.
 */
const setGreetingContext = (context) => {
    const helloSpan = document.getElementById("greeting-hello");
    const contextSpan = document.getElementById("greeting-context");
    if (!helloSpan || !contextSpan) return;
    if (context) {
        helloSpan.classList.add("hidden");
        contextSpan.classList.remove("hidden");
        contextSpan.textContent = context;
    } else {
        helloSpan.classList.remove("hidden");
        contextSpan.classList.add("hidden");
    }
};

/**
 * Gibt den vollständigen Anzeigenamen eines Schülers zurück.
 * Format: "Vorname [Zweitname] Nachname"
 */
const getStudentDisplayName = (student) => {
    const parts = [student.firstName];
    if (student.middleName) parts.push(student.middleName);
    parts.push(student.lastName);
    return parts.filter(Boolean).join(' ');
};

/**
 * HELPER FUNCTIONS FOR CLASS AND YEAR SELECTION
 */


/**
 * Gets the currently selected class from appData.
 * @returns {Object|undefined} The current class object or undefined if not found
 */
const getCurrentClass = () => {
    return appData.classes.find(c => c.id === appData.currentClassId);
};

/**
 * Gets the currently selected year from the current class.
 * @returns {Object|null} The current year object or null if not found
 */
const getCurrentYear = () => {
    const currentClass = getCurrentClass();
    if (!currentClass || !currentClass.years) return null;
    return currentClass.years.find(y => y.id === currentClass.currentYearId);
};

/**
 * KLASSENLISTE RENDERN
 *
 * Zeigt alle Klassen als Buttons in der Sidebar an.
 * Jede Klasse hat Buttons zum Auswählen, Bearbeiten und Löschen.
 *
 * Technische Details:
 * - Verwendet Template Literals (Backticks `) für HTML-Strings
 * - map() wandelt jedes Klassen-Objekt in einen HTML-String um
 * - join("") verbindet alle Strings zu einem großen HTML-Block
 * - innerHTML setzt den HTML-Inhalt des Elements
 *
 * SICHERHEIT: Alle Benutzerdaten werden mit escapeHtml() escaped!
 */
// ── Class / Student Search ──────────────────────────────────────────────────

let _sidebarSearchQuery = '';
let _homeSearchQuery = '';

const _searchStudentMatches = (query) => {
    const matches = [];
    const seen = new Set();
    appData.classes.forEach(cls => {
        (cls.years || []).forEach(year => {
            (year.students || []).forEach(student => {
                if (seen.has(student.id)) return;
                const hay = `${student.lastName || ''} ${student.firstName || ''}`.toLowerCase();
                const hay2 = `${student.firstName || ''} ${student.lastName || ''}`.toLowerCase();
                if (hay.includes(query) || hay2.includes(query)) {
                    seen.add(student.id);
                    matches.push({ student, cls });
                }
            });
        });
    });
    return matches;
};

const _applySidebarSearch = (query) => {
    const allClassDivs = document.querySelectorAll('#class-list > div');
    allClassDivs.forEach(div => {
        const btn = div.querySelector('[data-class-id]');
        if (!btn) return;
        const cls = appData.classes.find(c => c.id === btn.dataset.classId);
        div.style.display = (!query || (cls && cls.name.toLowerCase().includes(query))) ? '' : 'none';
    });

    const resultsLi = document.getElementById('sidebar-student-results-li');
    const resultsEl = document.getElementById('sidebar-student-results');
    if (!resultsLi || !resultsEl) return;

    if (!query) { resultsLi.classList.add('hidden'); resultsEl.innerHTML = ''; return; }

    const matches = _searchStudentMatches(query).slice(0, 10);
    if (matches.length === 0) { resultsLi.classList.add('hidden'); resultsEl.innerHTML = ''; return; }

    resultsLi.classList.remove('hidden');
    resultsEl.innerHTML = `
        <p class="text-xs px-1 py-1" style="opacity:0.5;">${t('search.studentsSection')}</p>
        ${matches.map(({ student, cls }) => `
            <button class="btn-block btn-ghost w-full" data-sb-student="${safeAttr(student.id)}" data-sb-class="${safeAttr(cls.id)}"
                style="justify-content:flex-start;gap:0.4rem;padding:0.3rem 0.5rem;font-size:0.85rem;">
                <span style="flex:1;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                    ${escapeHtml(`${student.lastName || ''}${student.firstName ? ', ' + student.firstName : ''}`)}
                </span>
                <span style="font-size:0.75rem;opacity:0.5;flex-shrink:0;">${escapeHtml(cls.name)}</span>
            </button>
        `).join('')}`;

    resultsEl.querySelectorAll('[data-sb-student]').forEach(btn => {
        btn.addEventListener('click', () => {
            appData.currentClassId = btn.dataset.sbClass;
            saveData();
            showStudentDetailView(btn.dataset.sbStudent);
        });
    });
};

const _initSidebarSearch = () => {
    const input = document.getElementById('sidebar-search');
    if (!input) return;
    input.placeholder = t('search.placeholder') || 'Suchen...';
    input.value = _sidebarSearchQuery;
    input.oninput = (e) => {
        _sidebarSearchQuery = e.target.value.trim().toLowerCase();
        _applySidebarSearch(_sidebarSearchQuery);
    };
    _applySidebarSearch(_sidebarSearchQuery);
};

const _applyHomeSearch = (query) => {
    const overviewList = document.getElementById('class-overview-list');
    const resultsEl = document.getElementById('home-search-results');
    if (!overviewList || !resultsEl) return;

    if (!query) {
        overviewList.querySelectorAll('[data-goto-class]').forEach(c => c.style.display = '');
        resultsEl.innerHTML = '';
        resultsEl.classList.add('hidden');
        return;
    }

    let classCount = 0;
    overviewList.querySelectorAll('[data-goto-class]').forEach(card => {
        const cls = appData.classes.find(c => c.id === card.dataset.gotoClass);
        const show = cls && cls.name.toLowerCase().includes(query);
        card.style.display = show ? '' : 'none';
        if (show) classCount++;
    });

    const studentMatches = _searchStudentMatches(query).slice(0, 20);
    if (studentMatches.length === 0 && classCount === 0) {
        resultsEl.innerHTML = `<p class="text-sm text-center py-2" style="opacity:0.5;">${t('search.noResults')}</p>`;
        resultsEl.classList.remove('hidden');
        return;
    }
    if (studentMatches.length === 0) { resultsEl.innerHTML = ''; resultsEl.classList.add('hidden'); return; }

    resultsEl.classList.remove('hidden');
    const chevron = `<svg class="lucide lucide-chevron-right-icon lucide-chevron-right" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
    resultsEl.innerHTML = `
        <p class="text-sm font-medium mb-2" style="opacity:0.5;">${t('search.studentsSection')}</p>
        <div class="space-y-2">
            ${studentMatches.map(({ student, cls }) => `
                <div class="flex items-center justify-between p-3 border rounded cursor-pointer"
                    data-hs-student="${safeAttr(student.id)}" data-hs-class="${safeAttr(cls.id)}">
                    <div>
                        <p class="font-semibold">${escapeHtml(`${student.lastName || ''}${student.firstName ? ', ' + student.firstName : ''}`)}</p>
                        <p class="text-sm" style="opacity:0.5;">${escapeHtml(cls.name)}</p>
                    </div>
                    ${chevron}
                </div>
            `).join('')}
        </div>`;

    resultsEl.querySelectorAll('[data-hs-student]').forEach(el => {
        el.addEventListener('click', () => {
            appData.currentClassId = el.dataset.hsClass;
            saveData();
            showStudentDetailView(el.dataset.hsStudent);
        });
    });
};

const _initHomeSearch = () => {
    const input = document.getElementById('home-search');
    if (!input) return;
    input.placeholder = t('search.placeholder') || 'Suchen...';
    input.value = _homeSearchQuery;
    input.oninput = (e) => {
        _homeSearchQuery = e.target.value.trim().toLowerCase();
        _applyHomeSearch(_homeSearchQuery);
    };
    _applyHomeSearch(_homeSearchQuery);
};

// ── End Class / Student Search ──────────────────────────────────────────────

// Shared edit/delete prompts (used by sidebar list + home overview)
const _promptEditClass = (classId) => {
    const cls = appData.classes.find(c => c.id === classId);
    if (!cls) return;
    const attendanceOn = cls.attendanceEnabled !== false;
    const content = `
        <div class="grid gap-2">
            <label class="block mb-2">${t("class.newClassName")}</label>
            <input type="text" name="name" class="input w-full" value="${escapeHtml(cls.name)}" required maxlength="100">
            <p class="text-gray-400 text-sm">${t("class.renameHint")}</p>
            <label class="flex items-center gap-2 mt-3 cursor-pointer">
                <input type="checkbox" name="attendanceEnabled" class="checkbox" ${attendanceOn ? 'checked' : ''}>
                <span>${t("class.attendanceEnabledLabel")}</span>
            </label>
            <p class="text-gray-400 text-sm">${t("class.attendanceEnabledHint")}</p>
        </div>
    `;
    showDialog("edit-dialog", t("class.editClass"), content, (formData) => {
        if (editClass(classId, formData.get("name"), formData.has("attendanceEnabled"))) {
            flashRenameSuccessIcon(document.querySelector(`[data-edit-class="${classId}"]`));
        }
    });
};

const _promptDeleteClass = (classId) => {
    const cls = appData.classes.find(c => c.id === classId);
    if (!cls) return;
    let totalStudents = 0, totalGrades = 0;
    if (cls.years) {
        cls.years.forEach(year => {
            if (year.students) {
                totalStudents += year.students.length;
                year.students.forEach(student => { totalGrades += student.grades.length; });
            }
        });
    }
    const message = t("confirm.deleteClass", { name: escapeHtml(cls.name) });
    const details = `<strong>${t('confirm.classStats') || 'Inhalt'}:</strong><br>
        • ${totalStudents} ${t('confirm.students') || 'Schüler'}<br>
        • ${totalGrades} ${t('confirm.grades') || 'Noten'}<br><br>
        ${t('confirm.allDataDeleted') || 'Alle Daten dieser Klasse werden unwiderruflich gelöscht.'}`;
    const warning = t('confirm.cannotBeUndone') || 'Diese Aktion kann nicht rückgängig gemacht werden.';
    showConfirmDialog(message, () => {
        const row = document.querySelector(`[data-delete-class="${classId}"]`)?.closest('#class-list > div');
        animateOutThenRun(row, 'row-removing', () => { deleteClass(classId); });
    }, details, warning);
};

const renderClassList = () => {
    const classList = document.getElementById("class-list");
    const isMobile = window.matchMedia('(max-width: 768px)').matches;

    classList.innerHTML = appData.classes.map(cls => {
        if (isMobile) {
            const inner = `<button class="btn-block ${cls.id === appData.currentClassId ? 'btn-primary' : 'btn-secondary'} w-full"
                data-class-id="${safeAttr(cls.id)}" style="text-align:left;">
                ${escapeHtml(cls.name)}
            </button>`;
            return swipeRowHtml({
                contentHtml: inner,
                leftAction:  { label: t('class.editClass') || 'Bearbeiten', iconSvg: SWIPE_ICONS.edit,  attr: `data-edit-class="${safeAttr(cls.id)}"` },
                rightAction: { label: t('class.deleteClass') || 'Löschen',  iconSvg: SWIPE_ICONS.trash, attr: `data-delete-class="${safeAttr(cls.id)}"` }
            });
        }
        return `<div class="w-full">
            <div role="group" class="button-group w-full">
                <button class="btn-block ${cls.id === appData.currentClassId ? 'btn-primary' : 'btn-secondary'} flex-1"
                data-class-id="${safeAttr(cls.id)}">
                    ${escapeHtml(cls.name)}
                </button>
                <button class="btn-icon btn-secondary" data-edit-class="${safeAttr(cls.id)}" title="${t("class.editClass")}" data-tooltip="${t("class.editClass")}" data-side="left">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-folder-pen-icon lucide-folder-pen"><path d="M2 11.5V5a2 2 0 0 1 2-2h3.9c.7 0 1.3.3 1.7.9l.8 1.2c.4.6 1 .9 1.7.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-9.5"/><path d="M11.378 13.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/></svg>
                </button>
                <button class="btn-icon btn-destructive" data-delete-class="${safeAttr(cls.id)}" title="${t("class.deleteClass")}" data-tooltip="${t("class.deleteClass")}" data-side="left">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-icon lucide-trash"><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
            </div>
        </div>`;
    }).join("");

    if (isMobile) {
        classList.querySelectorAll('.swipe-row').forEach(attachSwipe);
        playSwipeHint(classList, 'classList');
    }

    document.querySelectorAll("[data-class-id]").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            appData.currentClassId = btn.dataset.classId;
            saveData(""); // Klassenwechsel ist Navigation, kein Erfolg - kein Popup nötig
            showClassView();
        });
    });

    document.querySelectorAll("[data-edit-class]").forEach(btn => {
        btn.addEventListener("click", (e) => { e.stopPropagation(); _promptEditClass(btn.dataset.editClass); });
    });
    document.querySelectorAll("[data-delete-class]").forEach(btn => {
        btn.addEventListener("click", (e) => { e.stopPropagation(); _promptDeleteClass(btn.dataset.deleteClass); });
    });
    _initSidebarSearch();
};

/**
 * JAHR-TABS RENDERN
 *
 * Zeigt Tabs für alle Jahrgänge der aktuellen Klasse (ähnlich wie Subject-Tabs).
 */
const renderYearSelector = () => {
    const currentClass = getCurrentClass();
    if (!currentClass) return;

    const container = document.getElementById("year-selector");
    if (!container) return;

    // Ensure years array exists
    if (!currentClass.years) currentClass.years = [];

    // Sort years by name (newest first)
    const sortedYears = [...currentClass.years].sort((a, b) =>
        b.name.localeCompare(a.name)
    );

    let html = '';

    // Ein Tab pro Jahr
    sortedYears.forEach(year => {
        const isActive = currentClass.currentYearId === year.id;
        html += `<div class="flex flex-col items-start gap-8"><div role="group" class="button-group">
            <button class="${isActive ? 'btn-sm-primary' : 'btn-sm-outline'} rounded-r-none" data-year-id="${safeAttr(year.id)}">${escapeHtml(year.name)}</button>
            <button class="btn-sm-icon-outline" data-edit-year="${safeAttr(year.id)}" data-tooltip="${t("year.editYear")}" data-side="top">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-notebook-pen-icon lucide-notebook-pen"><path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4"/><path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/></svg>
            </button>
            <button class="btn-sm-icon-outline" data-delete-year="${safeAttr(year.id)}" data-tooltip="${t("year.manageYears")}" data-side="top" ${sortedYears.length <= 1 ? 'disabled' : ''}>
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-icon lucide-trash"><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
        </div></div>`;
    });

    // "+" Button zum Hinzufügen
    html += `<button class="btn-sm-icon-outline" id="add-year-btn" data-tooltip="${t("tooltip.addYearTo", { class: currentClass.name })}" data-side="top">
        <svg class="lucide lucide-plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
    </button>`;

    container.innerHTML = html;

    // Event-Listener: Tab-Klick (Jahr wechseln)
    container.querySelectorAll("[data-year-id]").forEach(btn => {
        btn.addEventListener("click", () => {
            const yearId = btn.dataset.yearId;
            currentClass.currentYearId = yearId;
            saveData();
            renderYearSelector();
            renderSemesterSelector();
            renderSubjectTabs();
            renderStudents();
            renderClassStats();
        });
    });

    // Event-Listener: Jahr hinzufügen
    const addBtn = document.getElementById("add-year-btn");
    if (addBtn) {
        addBtn.addEventListener("click", () => {
            showAddYearDialog(currentClass.id);
        });
    }

    // Event-Listener: Jahr bearbeiten
    container.querySelectorAll("[data-edit-year]").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const yearId = btn.dataset.editYear;
            const year = currentClass.years.find(y => y.id === yearId);
            if (year) {
                const content = `
                    <div class="grid gap-2">
                        <label class="block mb-2">${t("year.newYearName")}</label>
                        <input type="text" name="name" class="input w-full" value="${escapeHtml(year.name)}" required maxlength="50">
                    </div>
                    <hr style="border-color:var(--border);margin:0.75rem 0;">
                    <p class="text-gray-400 text-sm mb-2">${t("year.datesHint")}</p>
                    <div class="grid grid-cols-1 gap-3">
                        <div>
                            <label class="block text-sm mb-1">${t("year.startDate")}</label>
                            <input type="date" name="startDate" class="input w-full" value="${escapeHtml(year.startDate || '')}">
                        </div>
                        <div>
                            <label class="block text-sm mb-1">${t("year.semesterSwitchDate")}</label>
                            <input type="date" name="semesterSwitchDate" class="input w-full" value="${escapeHtml(year.semesterSwitchDate || '')}">
                        </div>
                        <div>
                            <label class="block text-sm mb-1">${t("year.endDate")}</label>
                            <input type="date" name="endDate" class="input w-full" value="${escapeHtml(year.endDate || '')}">
                        </div>
                    </div>
                `;
                showDialog("edit-dialog", t("year.editYear"), content, (formData) => {
                    const dates = {
                        startDate: formData.get("startDate") || null,
                        semesterSwitchDate: formData.get("semesterSwitchDate") || null,
                        endDate: formData.get("endDate") || null
                    };
                    editYear(currentClass.id, yearId, formData.get("name"), dates);
                });
            }
        });
    });

    // Event-Listener: Jahr löschen
    container.querySelectorAll("[data-delete-year]").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const yearId = btn.dataset.deleteYear;
            const year = currentClass.years.find(y => y.id === yearId);
            if (year && !btn.disabled) {
                showConfirmDialog(t("year.confirmDelete").replace('{name}', escapeHtml(year.name)), () => {
                    deleteYear(currentClass.id, yearId);
                });
            }
        });
    });
};

const autoSelectSemester = (year) => {
    if (!year || !year.semesterSwitchDate) return;
    const today = new Date().toISOString().slice(0, 10);
    year.currentSemester = today < year.semesterSwitchDate ? "WS" : "SS";
};

// Track which year IDs have already been prompted this session (no-dates dialog)
const _promptedYearIds = new Set();

const showSetYearDatesDialog = (classId, year) => {
    const y = new Date().getFullYear();
    const match = year.name.match(/^(\d{4})\/(\d{4})$/);
    const y1 = match ? parseInt(match[1]) : y;
    const y2 = match ? parseInt(match[2]) : y + 1;

    const content = `
        <p class="font-semibold mb-1">${escapeHtml(year.name)}</p>
        <p class="text-sm mb-3" style="color:var(--muted-foreground)">${t("year.setDatesHint")}</p>
        <div class="grid grid-cols-1 gap-3">
            <div>
                <label class="block text-sm mb-1">${t("year.startDate")}</label>
                <input type="date" name="startDate" class="input w-full" value="${y1}-09-01" id="sdlg-start">
            </div>
            <div>
                <label class="block text-sm mb-1">${t("year.semesterSwitchDate")}</label>
                <input type="date" name="semesterSwitchDate" class="input w-full" value="${y2}-02-01" id="sdlg-switch">
            </div>
            <div>
                <label class="block text-sm mb-1">${t("year.endDate")}</label>
                <input type="date" name="endDate" class="input w-full" value="${y2}-06-30" id="sdlg-end">
            </div>
        </div>
    `;

    showDialog("edit-dialog", t("year.setDatesTitle"), content, (formData) => {
        const dates = {
            startDate: formData.get("startDate") || null,
            semesterSwitchDate: formData.get("semesterSwitchDate") || null,
            endDate: formData.get("endDate") || null
        };
        editYear(classId, year.id, year.name, dates);
        autoSelectSemester(getCurrentYear());
        renderSemesterSelector();
    });
};

const renderSemesterSelector = () => {
    const container = document.getElementById("semester-selector");
    if (!container) return;

    const currentYear = getCurrentYear();
    if (!currentYear) {
        container.innerHTML = '';
        return;
    }

    const activeSemester = currentYear.currentSemester || "WS";
    const noDates = !currentYear.semesterSwitchDate;
    const currentClass = getCurrentClass();
    const currentYearId = currentYear.id;

    container.innerHTML = `
        <div role="group" class="button-group">
            <button class="${activeSemester === 'WS' ? 'btn-sm-primary' : 'btn-sm-outline'}" id="semester-ws-btn">${t("semester.WS")}</button>
            <button class="${activeSemester === 'SS' ? 'btn-sm-primary' : 'btn-sm-outline'}" id="semester-ss-btn">${t("semester.SS")}</button>
        </div>
        ${noDates ? `<button class="btn-sm-outline" id="semester-set-dates-btn" style="font-size:0.75rem;opacity:0.7;">${lucideIcon('triangle-alert')} ${t("year.setDates")}</button>` : ''}
    `;

    document.getElementById("semester-ws-btn")?.addEventListener("click", () => {
        const year = getCurrentYear();
        if (!year) return;
        year.currentSemester = "WS";
        saveData();
        renderSemesterSelector();
        renderStudents();
        renderClassStats();
    });

    document.getElementById("semester-ss-btn")?.addEventListener("click", () => {
        const year = getCurrentYear();
        if (!year) return;
        year.currentSemester = "SS";
        saveData();
        renderSemesterSelector();
        renderStudents();
        renderClassStats();
    });

    document.getElementById("semester-set-dates-btn")?.addEventListener("click", () => {
        const cls = getCurrentClass();
        const year = getCurrentYear();
        if (!cls || !year) return;
        const content = `
            <div class="grid gap-2">
                <label class="block mb-2">${t("year.newYearName")}</label>
                <input type="text" name="name" class="input w-full" value="${escapeHtml(year.name)}" required maxlength="50">
            </div>
            <hr style="border-color:var(--border);margin:0.75rem 0;">
            <p class="text-gray-400 text-sm mb-2">${t("year.datesHint")}</p>
            <div class="grid grid-cols-1 gap-3">
                <div>
                    <label class="block text-sm mb-1">${t("year.startDate")}</label>
                    <input type="date" name="startDate" class="input w-full" value="${escapeHtml(year.startDate || '')}">
                </div>
                <div>
                    <label class="block text-sm mb-1">${t("year.semesterSwitchDate")}</label>
                    <input type="date" name="semesterSwitchDate" class="input w-full" value="${escapeHtml(year.semesterSwitchDate || '')}">
                </div>
                <div>
                    <label class="block text-sm mb-1">${t("year.endDate")}</label>
                    <input type="date" name="endDate" class="input w-full" value="${escapeHtml(year.endDate || '')}">
                </div>
            </div>
        `;
        showDialog("edit-dialog", t("year.editYear"), content, (formData) => {
            const dates = {
                startDate: formData.get("startDate") || null,
                semesterSwitchDate: formData.get("semesterSwitchDate") || null,
                endDate: formData.get("endDate") || null
            };
            editYear(cls.id, year.id, formData.get("name"), dates);
            autoSelectSemester(getCurrentYear());
            renderStudents();
            renderClassStats();
        });
    });
};

/**
 * Nächsten Klassennamen ableiten (führende Zahl +1), z.B. "2AFIT" -> "3AFIT".
 * Gibt null zurück wenn kein Zahlenmuster erkennbar ist.
 */
const deriveNextClassName = (name) => {
    const m = name.match(/^(\d+)(.*)$/);
    if (!m) return null;
    return `${parseInt(m[1], 10) + 1}${m[2]}`;
};

/**
 * JAHR HINZUFÜGEN WIZARD
 *
 * 3 Schritte: Jahr festlegen -> Klasse umbenennen (z.B. 2AFIT -> 3AFIT) ->
 * Schülerliste (abwählbar + neue Schüler hinzufügen).
 */
const showAddYearDialog = (classId) => {
    const cls = appData.classes.find(c => c.id === classId);
    if (!cls) return;

    const dialog = document.getElementById("edit-dialog");
    const form = dialog.querySelector("form");
    const submitBtn = dialog.querySelector('footer button[type="submit"]');
    const setStepContent = (title, contentHtml) => {
        // Swap synchronously (callers bind elements/onsubmit right after calling
        // this) — only the entrance is animated, deferring the swap broke
        // callers that query the new DOM immediately after this returns.
        dialog.querySelector("h2").textContent = title;
        form.classList.remove('wizard-step-in');
        form.innerHTML = contentHtml;
        void form.offsetWidth; // restart animation
        form.classList.add('wizard-step-in');
        form.addEventListener('animationend', () => form.classList.remove('wizard-step-in'), { once: true });
    };

    const sortedYears = [...cls.years].sort((a, b) => b.name.localeCompare(a.name));
    const previousYear = sortedYears.length > 0 ? sortedYears[0] : null;

    const wizardState = { yearName: null, dates: null, newClassName: cls.name };

    // ---------- Schritt 1: Jahr ----------
    const renderStep1 = () => {
        const currentYear = getCurrentSchoolYear();
        const defaultStart = `${currentYear}-09-01`;
        const defaultSwitch = `${currentYear + 1}-02-01`;
        const defaultEnd = `${currentYear + 1}-06-30`;

        const content = `
            <div class="flex items-center justify-center gap-4 my-2">
                <button type="button" id="year-dec-btn" class="btn-outline" style="padding:0.25rem 0.75rem;font-size:1.25rem;line-height:1" tabindex="-1">−</button>
                <div class="text-center" style="min-width:9rem">
                    <div id="year-display" class="font-bold" style="font-size:1.75rem;line-height:1.2">${currentYear}</div>
                    <div id="year-name-preview" class="text-sm" style="color:var(--muted-foreground)">${currentYear}/${currentYear + 1}</div>
                </div>
                <button type="button" id="year-inc-btn" class="btn-outline" style="padding:0.25rem 0.75rem;font-size:1.25rem;line-height:1" tabindex="-1">+</button>
                <input type="hidden" name="startYear" id="year-start-input" value="${currentYear}">
            </div>
            <div class="grid gap-2 mt-3">
                <label class="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" name="useSchoolYearFormat" id="use-school-year-format" class="checkbox" checked>
                    <span>${t("year.useSchoolYearFormat")}</span>
                </label>
                <p class="text-gray-400 text-sm">${t("year.schoolYearFormatHint")}</p>
            </div>
            <hr style="border-color:var(--border);margin:0.75rem 0;">
            <p class="text-gray-400 text-sm mb-2">${t("year.datesHint")}</p>
            <div class="grid grid-cols-1 gap-3">
                <div>
                    <label class="block text-sm mb-1">${t("year.startDate")}</label>
                    <input type="date" name="startDate" class="input w-full" value="${defaultStart}" id="year-add-start-date">
                </div>
                <div>
                    <label class="block text-sm mb-1">${t("year.semesterSwitchDate")}</label>
                    <input type="date" name="semesterSwitchDate" class="input w-full" value="${defaultSwitch}" id="year-add-switch-date">
                </div>
                <div>
                    <label class="block text-sm mb-1">${t("year.endDate")}</label>
                    <input type="date" name="endDate" class="input w-full" value="${defaultEnd}" id="year-add-end-date">
                </div>
            </div>
        `;

        showDialog("edit-dialog", t("year.wizard.step1Title"), content, (formData) => {
            const startYear = parseInt(formData.get("startYear"));
            const useSchoolYearFormat = formData.get("useSchoolYearFormat") === "on";
            wizardState.yearName = useSchoolYearFormat ? `${startYear}/${startYear + 1}` : `${startYear}`;
            wizardState.dates = {
                startDate: formData.get("startDate") || null,
                semesterSwitchDate: formData.get("semesterSwitchDate") || null,
                endDate: formData.get("endDate") || null
            };
            renderStep2();
            return false; // Dialog offen halten, Schritte werden manuell gewechselt
        });
        if (submitBtn) submitBtn.textContent = t("dialog.next");

        const updateYearUI = () => {
            const y = parseInt(document.getElementById("year-start-input").value);
            const useFmt = document.getElementById("use-school-year-format").checked;
            document.getElementById("year-display").textContent = y;
            document.getElementById("year-name-preview").textContent = useFmt ? `${y}/${y + 1}` : `${y}`;
            document.getElementById("year-add-start-date").value  = `${y}-09-01`;
            document.getElementById("year-add-switch-date").value = `${y + 1}-02-01`;
            document.getElementById("year-add-end-date").value    = `${y + 1}-06-30`;
        };
        document.getElementById("year-dec-btn")?.addEventListener("click", () => {
            const inp = document.getElementById("year-start-input");
            inp.value = parseInt(inp.value) - 1;
            updateYearUI();
        });
        document.getElementById("year-inc-btn")?.addEventListener("click", () => {
            const inp = document.getElementById("year-start-input");
            inp.value = parseInt(inp.value) + 1;
            updateYearUI();
        });
        document.getElementById("use-school-year-format")?.addEventListener("change", updateYearUI);
    };

    // ---------- Schritt 2: Klasse umbenennen ----------
    const renderStep2 = () => {
        const suggested = deriveNextClassName(cls.name);
        const skipByDefault = suggested === null;

        const content = `
            <p class="text-sm mb-3" style="color:var(--muted-foreground)">${t("year.wizard.step2Hint")}</p>
            <div class="grid gap-2">
                <label class="block mb-1">${t("class.newClassName")}</label>
                <input type="text" id="wizard-class-name" class="input w-full" value="${escapeHtml(suggested || cls.name)}" maxlength="50" ${skipByDefault ? 'disabled' : ''} data-icon="users">
            </div>
            <p id="wizard-rename-preview" class="text-sm mt-2" style="color:var(--muted-foreground)"></p>
            <label class="flex items-center gap-2 mt-3 cursor-pointer">
                <input type="checkbox" id="wizard-skip-rename" class="checkbox" ${skipByDefault ? 'checked' : ''}>
                <span>${t("class.keepNameCheckbox")}</span>
            </label>
        `;
        setStepContent(t("year.wizard.step2Title"), content);
        if (submitBtn) submitBtn.textContent = t("dialog.next");

        const nameInput = document.getElementById("wizard-class-name");
        const skipCheckbox = document.getElementById("wizard-skip-rename");
        const preview = document.getElementById("wizard-rename-preview");

        const updatePreview = () => {
            nameInput.disabled = skipCheckbox.checked;
            const target = skipCheckbox.checked ? cls.name : (nameInput.value || cls.name);
            const newText = target === cls.name ? "" : t("class.renamePreview", { from: cls.name, to: target });
            if (newText === preview.textContent) return;
            preview.textContent = newText;
            preview.classList.remove('wizard-preview-update');
            void preview.offsetWidth;
            preview.classList.add('wizard-preview-update');
        };
        nameInput.addEventListener("input", updatePreview);
        skipCheckbox.addEventListener("change", updatePreview);
        updatePreview();

        form.onsubmit = (e) => {
            e.preventDefault();
            if (skipCheckbox.checked) {
                wizardState.newClassName = cls.name;
                renderStep3();
                return;
            }
            const validation = validateStringInput(nameInput.value, 50);
            if (!validation.isValid) {
                showAlertDialog(validation.error);
                return;
            }
            wizardState.newClassName = validation.value;
            renderStep3();
        };
    };

    // ---------- Schritt 3: Schülerliste ----------
    const renderStep3 = () => {
        const students = previousYear ? previousYear.students : [];

        const studentRows = students.map(s => {
            const displayName = [s.firstName, s.middleName, s.lastName].filter(Boolean).join(' ');
            return `
                <label class="flex items-center gap-2 cursor-pointer wizard-student-row" data-student-row="${safeAttr(s.id)}">
                    <input type="checkbox" data-keep-student="${safeAttr(s.id)}" class="checkbox wizard-keep-checkbox" checked>
                    <span class="wizard-student-name">${escapeHtml(displayName)}</span>
                    <span class="wizard-leaving-tag text-sm hidden" style="color:var(--muted-foreground)">${t("year.wizard.studentLeaving")}</span>
                </label>
            `;
        }).join('');

        const content = `
            ${students.length > 0 ? `
                <p class="text-sm mb-2" style="color:var(--muted-foreground)">${t("year.wizard.keepStudentHint")}</p>
                <div class="grid gap-1 mb-3" style="max-height:12rem;overflow-y:auto;">${studentRows}</div>
                <hr style="border-color:var(--border);margin:0.75rem 0;">
            ` : ''}
            <p class="text-sm font-medium mb-2">${t("year.wizard.addNewStudents")}</p>
            <div id="wizard-new-student-rows" class="grid gap-2"></div>
            <button type="button" id="wizard-add-student-row" class="btn-sm-outline mt-2">${lucideIcon('plus')} ${t("year.wizard.addStudentRow")}</button>
        `;
        setStepContent(t("year.wizard.step3Title"), content);
        if (submitBtn) submitBtn.textContent = t("year.addYear");

        dialog.querySelectorAll(".wizard-keep-checkbox").forEach(cb => {
            cb.addEventListener("change", () => {
                const row = cb.closest(".wizard-student-row");
                row.querySelector(".wizard-student-name").style.textDecoration = cb.checked ? "" : "line-through";
                row.querySelector(".wizard-leaving-tag").classList.toggle("hidden", cb.checked);
            });
        });

        const rowsContainer = document.getElementById("wizard-new-student-rows");
        const addStudentRow = () => {
            const row = document.createElement("div");
            row.className = "grid gap-2 items-center wizard-new-student-row";
            row.style.gridTemplateColumns = "1fr 1fr 1fr auto";
            row.innerHTML = `
                <input type="text" class="input" placeholder="${t('student.firstName')}" data-field="firstName" maxlength="50">
                <input type="text" class="input" placeholder="${t('student.middleName')}" data-field="middleName" maxlength="50">
                <input type="text" class="input" placeholder="${t('student.lastName')}" data-field="lastName" maxlength="50">
                <button type="button" class="btn-icon btn-secondary" data-remove-row title="${t('dialog.remove')}">
                    <svg class="lucide lucide-x-icon lucide-x" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
            `;
            row.querySelector("[data-remove-row]").addEventListener("click", () => row.remove());
            rowsContainer.appendChild(row);
        };
        document.getElementById("wizard-add-student-row")?.addEventListener("click", addStudentRow);
        addStudentRow();

        form.onsubmit = (e) => {
            e.preventDefault();

            const keepStudentIds = students
                .filter(s => dialog.querySelector(`[data-keep-student="${CSS.escape(s.id)}"]`)?.checked)
                .map(s => s.id);

            addYear(classId, wizardState.yearName, previousYear ? previousYear.id : null, wizardState.dates, keepStudentIds);

            // Neue Schüler anlegen - currentYearId zeigt nach addYear() bereits auf den neuen Jahrgang
            dialog.querySelectorAll(".wizard-new-student-row").forEach(row => {
                const firstName = row.querySelector('[data-field="firstName"]')?.value.trim();
                const lastName = row.querySelector('[data-field="lastName"]')?.value.trim();
                const middleName = row.querySelector('[data-field="middleName"]')?.value.trim();
                if (firstName && lastName) addStudent(firstName, lastName, middleName);
            });

            if (wizardState.newClassName !== cls.name) {
                editClass(classId, wizardState.newClassName);
            }

            closeDialogAnimated(dialog);
        };
    };

    renderStep1();
};

/**
 * JAHRE VERWALTEN DIALOG
 *
 * Zeigt Liste aller Jahrgänge mit Edit/Delete Buttons.
 */
const showManageYearsDialog = (classId) => {
    const cls = appData.classes.find(c => c.id === classId);
    if (!cls) return;

    const sortedYears = [...cls.years].sort((a, b) =>
        b.name.localeCompare(a.name)
    );

    const content = `
        <div class="space-y-2">
            ${sortedYears.map(year => `
                <div class="flex items-center justify-between p-2 border rounded">
                    <span>${escapeHtml(year.name)} ${year.id === cls.currentYearId ? '(aktiv)' : ''}</span>
                    <div role="group" class="button-group">
                        <button class="btn-sm-icon-outline" data-edit-year="${safeAttr(year.id)}">
                            <svg class="lucide lucide-square-pen-icon lucide-square-pen" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                        </button>
                        <button class="btn-sm-icon-destructive" data-delete-year="${safeAttr(year.id)}" ${cls.years.length <= 1 ? 'disabled' : ''}>
                            <svg class="lucide lucide-trash-icon lucide-trash" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
                        </button>
                    </div>
                </div>
            `).join('')}
        </div>
    `;

    showDialog("manage-years-dialog", t("year.manageYears"), content, null, true);

    // Event listeners for edit/delete
    document.querySelectorAll("[data-edit-year]").forEach(btn => {
        btn.addEventListener("click", () => {
            const yearId = btn.dataset.editYear;
            const year = cls.years.find(y => y.id === yearId);
            if (year) {
                const editContent = `
                    <div class="grid gap-2">
                        <label class="block mb-2">${t("year.newYearName")}</label>
                        <input type="text" name="name" class="input w-full" value="${escapeHtml(year.name)}" required maxlength="50">
                    </div>
                `;
                showDialog("edit-dialog", t("year.editYear"), editContent, (formData) => {
                    editYear(classId, yearId, formData.get("name"));
                    document.getElementById("manage-years-dialog").close();
                    showManageYearsDialog(classId);
                });
            }
        });
    });

    document.querySelectorAll("[data-delete-year]").forEach(btn => {
        btn.addEventListener("click", () => {
            const yearId = btn.dataset.deleteYear;
            const year = cls.years.find(y => y.id === yearId);
            if (year) {
                showConfirmDialog(t("year.confirmDelete").replace('{name}', escapeHtml(year.name)), () => {
                    deleteYear(classId, yearId);
                    document.getElementById("manage-years-dialog").close();
                });
            }
        });
    });
};

/**
 * HELPER: Noten für aktives Fach filtern
 *
 * Gibt die gefilterten Noten zurück basierend auf dem aktuellen Fach-Tab.
 *
 * @param {Array} grades - Array mit Noten-Objekten
 * @param {string|null} currentSubjectId - Aktives Fach
 * @returns {Array} - Gefilterte Noten
 */
const filterGradesBySubject = (grades, currentSubjectId) => {
    if (!currentSubjectId) return [];
    const semester = getCurrentYear()?.currentSemester;
    return grades.filter(g => {
        if (g.subjectId !== currentSubjectId) return false;
        if (semester && g.semester && g.semester !== semester) return false;
        return true;
    });
};

/**
 * FÄCHER-TABS RENDERN
 *
 * Zeigt Tab-Leiste mit "Alle Fächer" + ein Tab pro Fach + "+" Button.
 * Jeder Fach-Tab hat Edit/Delete-Buttons.
 */
const renderSubjectTabs = () => {
    const currentYear = getCurrentYear();
    if (!currentYear) return;

    // Sicherstellen, dass subjects-Array existiert (Rückwärtskompatibilität)
    if (!currentYear.subjects) currentYear.subjects = [];
    if (!currentYear.currentSubjectId || currentYear.currentSubjectId === "overview") {
        // Erstes Fach auswählen falls vorhanden
        currentYear.currentSubjectId = currentYear.subjects.length > 0 ? currentYear.subjects[0].id : null;
    }

    const container = document.getElementById("subject-tabs");
    if (!container) return;

    const activeId = currentYear.currentSubjectId;

    let html = '';

    // Ein Tab pro Fach
    currentYear.subjects.forEach(subject => {
        const isActive = activeId === subject.id;
        html += `<div class="flex flex-col items-start gap-8"><div role="group" class="button-group">
            <button class="${isActive ? 'btn-sm-primary' : 'btn-sm-outline'} rounded-r-none" data-subject-id="${safeAttr(subject.id)}">${escapeHtml(subject.name)}</button>
            <button class="btn-sm-icon-outline" data-edit-subject="${safeAttr(subject.id)}" data-tooltip="${t("subject.editSubject")}" data-side="top">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-notebook-pen-icon lucide-notebook-pen"><path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4"/><path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/></svg>
            </button>
            <button class="btn-sm-icon-outline" data-delete-subject="${safeAttr(subject.id)}" data-tooltip="${t("subject.deleteSubject")}" data-side="top">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-icon lucide-trash"><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
        </div></div>`;
    });

    // "+" Button zum Hinzufügen
    html += `<button class="btn-sm-icon-outline" id="add-subject-btn" data-tooltip="${t("tooltip.addSubjectTo", { year: currentYear.name })}" data-side="top">
        <svg class="lucide lucide-plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
    </button>`;

    container.innerHTML = html;

    // Update attendance button tooltip for current subject
    const attendanceBtn = document.getElementById("add-attendance-btn");
    if (attendanceBtn) {
        const activeSubject = currentYear.subjects?.find(s => s.id === activeId);
        if (activeSubject) {
            attendanceBtn.dataset.tooltip = t("tooltip.addAttendanceFor", { subject: activeSubject.name });
        }
    }

    // Event-Listener: Tab-Klick (Fach wechseln)
    container.querySelectorAll("[data-subject-id]").forEach(btn => {
        btn.addEventListener("click", () => {
            const subjectId = btn.dataset.subjectId;
            currentYear.currentSubjectId = subjectId;
            saveData();
            renderSubjectTabs();
            renderStudents();
            renderClassStats();
        });
    });

    // Event-Listener: Fach hinzufügen
    const addBtn = document.getElementById("add-subject-btn");
    if (addBtn) {
        addBtn.addEventListener("click", () => {
            const currentClass = getCurrentClass();
            const globalSettings = appData.attendanceSettings || { minAttendancePercent: 75, warningThreshold: 5 };

            // Collect known subject templates (defaultSubjects first, then any names used in classes)
            const hiddenSuggestions = new Set(appData.hiddenSubjectSuggestions || []);
            const knownSubjects = new Map(); // name → template object
            if (appData.defaultSubjects) {
                appData.defaultSubjects.forEach(tmpl => knownSubjects.set(tmpl.name, tmpl));
            }
            if (appData.classes) {
                appData.classes.forEach(cls => {
                    if (cls.years) cls.years.forEach(year => {
                        if (year.subjects) year.subjects.forEach(s => {
                            if (!knownSubjects.has(s.name) && !hiddenSuggestions.has(s.name)) {
                                knownSubjects.set(s.name, { name: s.name, minAttendancePercent: null, warningThreshold: null, attendanceAutoGrading: null });
                            }
                        });
                    });
                });
            }
            const sortedTemplates = [...knownSubjects.values()].sort((a, b) => a.name.localeCompare(b.name));
            const chipsHtml = sortedTemplates.map(tmpl => {
                const hasCustom = tmpl.minAttendancePercent !== null || tmpl.warningThreshold !== null || tmpl.attendanceAutoGrading !== null;
                const tooltip = hasCustom
                    ? safeAttr(t("subject.chipTooltipCustom", { min: tmpl.minAttendancePercent ?? '?' }))
                    : safeAttr(t("subject.chipTooltipGlobal"));
                return `<button type="button" class="btn-sm-outline" data-chip-name="${safeAttr(tmpl.name)}" title="${tooltip}">${escapeHtml(tmpl.name)}</button>`;
            }).join('');

            const content = `
                <div class="grid gap-3">
                    <div>
                        <p class="text-sm font-medium mb-1">${t("subject.knownSubjects")}</p>
                        <div class="flex flex-wrap gap-1" id="subject-chips-container">
                            ${chipsHtml}
                            <button type="button" id="add-chip-btn" class="btn-sm-icon-outline" title="${t("subject.addChipTooltip")}">
                                <svg class="lucide lucide-plus-icon lucide-plus" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v16m8-8H4"/></svg>
                            </button>
                        </div>
                        <div id="new-chip-row" class="hidden flex gap-1 mt-2">
                            <input type="text" id="new-chip-input" class="input flex-1" placeholder="${t("subject.newChipPlaceholder")}" maxlength="50" data-icon="book-open">
                            <button type="button" id="confirm-new-chip" class="btn-sm-primary">OK</button>
                            <button type="button" id="cancel-new-chip" class="btn-sm-outline" aria-label="${t('dialog.cancel')}">${lucideIcon('x')} </button>
                        </div>
                        <p class="text-gray-400 text-sm mt-2">${t("subject.chipsHint")}</p>
                    </div>
                    <hr>
                    <div>
                        <label class="block mb-1 text-sm font-medium">${t("subject.subjectName")}</label>
                        <input type="text" name="name" id="subject-name-input" class="input w-full" required maxlength="50" placeholder="${t("subject.subjectPlaceholder")}" data-icon="book-open">
                        <p class="text-gray-400 text-sm mt-1">${t("subject.nameShareHint")}</p>
                    </div>
                    <div>
                        <label class="flex items-center gap-2 cursor-pointer text-sm font-medium">
                            <input type="checkbox" id="custom-attendance-toggle" class="checkbox">
                            <span>${t("subject.attendanceToggleLabel")}</span>
                        </label>
                        <p class="text-gray-400 text-sm mt-1">${t("subject.attendanceGlobalFallbackHint", { min: globalSettings.minAttendancePercent, warn: globalSettings.warningThreshold })}</p>
                    </div>
                    <div id="custom-attendance-fields" class="grid gap-3 hidden pl-1 border-l-2 border-border">
                        <div>
                            <label class="block text-sm font-medium mb-1">${t("subject.minAttendanceLabel")}</label>
                            <input type="number" name="minAttendancePercent" class="input w-full" min="0" max="100" placeholder="${globalSettings.minAttendancePercent}">
                            <p class="text-gray-400 text-sm mt-1">${t("subject.minAttendanceHint")}</p>
                        </div>
                        <div>
                            <label class="block text-sm font-medium mb-1">${t("subject.warningThresholdLabel")}</label>
                            <input type="number" name="warningThreshold" class="input w-full" min="0" max="100" placeholder="${globalSettings.warningThreshold}">
                            <p class="text-gray-400 text-sm mt-1">${t("subject.warningThresholdHint")}</p>
                        </div>
                        <label class="flex items-start gap-2 text-sm cursor-pointer">
                            <input type="checkbox" name="attendanceAutoGrading" class="checkbox mt-0.5">
                            <span>
                                <span class="font-medium">${t("subject.autoGradingLabel")}</span><br>
                                <span class="text-gray-400 text-sm">${t("subject.autoGradingHint")}</span>
                            </span>
                        </label>
                    </div>
                </div>
            `;

            showDialog("edit-dialog", t("subject.addSubject"), content, (formData) => {
                const useCustom = document.getElementById("custom-attendance-toggle")?.checked;
                const minAttendancePercent = useCustom ? (formData.get("minAttendancePercent") !== "" ? Number(formData.get("minAttendancePercent")) : null) : null;
                const warningThreshold = useCustom ? (formData.get("warningThreshold") !== "" ? Number(formData.get("warningThreshold")) : null) : null;
                const attendanceAutoGrading = useCustom ? formData.has("attendanceAutoGrading") : null;
                addSubject(currentClass.id, formData.get("name"), minAttendancePercent, warningThreshold, attendanceAutoGrading);
            });

            // Chip click: fill name + pre-fill attendance settings from template
            document.querySelectorAll('[data-chip-name]').forEach(chip => {
                chip.addEventListener('click', () => {
                    const name = chip.dataset.chipName;
                    const tmpl = knownSubjects.get(name) || {};
                    const nameInput = document.getElementById('subject-name-input');
                    if (nameInput) nameInput.value = name;

                    const hasCustom = tmpl.minAttendancePercent !== null || tmpl.warningThreshold !== null || tmpl.attendanceAutoGrading !== null;
                    const toggle = document.getElementById('custom-attendance-toggle');
                    const fields = document.getElementById('custom-attendance-fields');
                    if (toggle && fields) {
                        toggle.checked = hasCustom;
                        fields.classList.toggle('hidden', !hasCustom);
                    }
                    if (hasCustom) {
                        const minInput = document.querySelector('#edit-dialog [name="minAttendancePercent"]');
                        const warnInput = document.querySelector('#edit-dialog [name="warningThreshold"]');
                        const autoInput = document.querySelector('#edit-dialog [name="attendanceAutoGrading"]');
                        if (minInput) minInput.value = tmpl.minAttendancePercent !== null ? tmpl.minAttendancePercent : '';
                        if (warnInput) warnInput.value = tmpl.warningThreshold !== null ? tmpl.warningThreshold : '';
                        if (autoInput) autoInput.checked = !!tmpl.attendanceAutoGrading;
                    }
                });

                chip.addEventListener('dblclick', () => {
                    const name = chip.dataset.chipName;
                    const isDefault = appData.defaultSubjects?.some(s => s.name === name);
                    if (isDefault) {
                        showAlertDialog(t('subject.chipDeleteDefaultError'));
                    } else {
                        showConfirmDialog(t('subject.chipDeleteConfirm', { name }), () => {
                            if (!appData.hiddenSubjectSuggestions) appData.hiddenSubjectSuggestions = [];
                            if (!appData.hiddenSubjectSuggestions.includes(name)) {
                                appData.hiddenSubjectSuggestions.push(name);
                            }
                            knownSubjects.delete(name);
                            chip.remove();
                            saveData();
                        });
                    }
                });
            });

            // "+" button: show new-chip input row
            const addChipBtn = document.getElementById('add-chip-btn');
            const newChipRow = document.getElementById('new-chip-row');
            const newChipInput = document.getElementById('new-chip-input');
            const confirmNewChip = document.getElementById('confirm-new-chip');
            const cancelNewChip = document.getElementById('cancel-new-chip');

            addChipBtn?.addEventListener('click', () => {
                newChipRow?.classList.remove('hidden');
                newChipInput?.focus();
            });

            cancelNewChip?.addEventListener('click', () => {
                newChipRow?.classList.add('hidden');
                if (newChipInput) newChipInput.value = '';
            });

            const addNewChip = () => {
                const name = newChipInput?.value?.trim();
                if (!name) return;

                // Persist to defaultSubjects in memory (saved on next saveData call)
                if (!appData.defaultSubjects) appData.defaultSubjects = [];
                if (!appData.defaultSubjects.some(s => s.name === name)) {
                    appData.defaultSubjects.push({ name, minAttendancePercent: null, warningThreshold: null, attendanceAutoGrading: null });
                }

                // Insert chip before the "+" button
                const chipsContainer = document.getElementById('subject-chips-container');
                const plusBtn = document.getElementById('add-chip-btn');
                if (chipsContainer && plusBtn) {
                    const chipEl = document.createElement('button');
                    chipEl.type = 'button';
                    chipEl.className = 'btn-sm-outline';
                    chipEl.dataset.chipName = name;
                    chipEl.textContent = name;
                    chipEl.addEventListener('click', () => {
                        const nameInput = document.getElementById('subject-name-input');
                        if (nameInput) nameInput.value = name;
                    });
                    chipEl.addEventListener('dblclick', () => {
                        const isDefault = appData.defaultSubjects?.some(s => s.name === name);
                        if (isDefault) {
                            showAlertDialog(t('subject.chipDeleteDefaultError'));
                        } else {
                            showConfirmDialog(t('subject.chipDeleteConfirm', { name }), () => {
                                if (!appData.hiddenSubjectSuggestions) appData.hiddenSubjectSuggestions = [];
                                if (!appData.hiddenSubjectSuggestions.includes(name)) {
                                    appData.hiddenSubjectSuggestions.push(name);
                                }
                                knownSubjects.delete(name);
                                chipEl.remove();
                                saveData();
                            });
                        }
                    });
                    chipsContainer.insertBefore(chipEl, plusBtn);
                }

                // Fill name input and close the row
                const nameInput = document.getElementById('subject-name-input');
                if (nameInput) nameInput.value = name;
                newChipRow?.classList.add('hidden');
                if (newChipInput) newChipInput.value = '';
            };

            confirmNewChip?.addEventListener('click', addNewChip);
            newChipInput?.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); addNewChip(); }
                if (e.key === 'Escape') { newChipRow?.classList.add('hidden'); if (newChipInput) newChipInput.value = ''; }
            });

            // Toggle attendance fields
            const toggle = document.getElementById("custom-attendance-toggle");
            const fields = document.getElementById("custom-attendance-fields");
            if (toggle && fields) {
                toggle.addEventListener("change", () => {
                    fields.classList.toggle("hidden", !toggle.checked);
                });
            }
        });
    }

    // Event-Listener: Fach bearbeiten
    container.querySelectorAll("[data-edit-subject]").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const currentClass = getCurrentClass();
            const subjectId = btn.dataset.editSubject;
            const subject = currentYear.subjects.find(s => s.id === subjectId);
            if (subject) {
                const hasCustom = subject.minAttendancePercent !== null || subject.warningThreshold !== null || subject.attendanceAutoGrading !== null;
                const globalSettings = appData.attendanceSettings || { minAttendancePercent: 75, warningThreshold: 5 };
                const content = `
                    <div class="grid gap-3">
                        <div>
                            <label class="block text-sm font-medium mb-1">${t("subject.newSubjectName")}</label>
                            <input type="text" name="name" class="input w-full" value="${escapeHtml(subject.name)}" required maxlength="50">
                            <p class="text-gray-400 text-sm mt-1">${t("subject.renameOnlyThisHint")}</p>
                        </div>
                        <div>
                            <label class="flex items-center gap-2 cursor-pointer text-sm font-medium">
                                <input type="checkbox" id="custom-attendance-toggle" class="checkbox" ${hasCustom ? 'checked' : ''}>
                                <span>${t("subject.attendanceToggleLabel")}</span>
                            </label>
                            <p class="text-gray-400 text-sm mt-1">${t("subject.attendanceSyncHint", { name: escapeHtml(subject.name) })}</p>
                        </div>
                        <div id="custom-attendance-fields" class="grid gap-3 ${hasCustom ? '' : 'hidden'} pl-1 border-l-2 border-border">
                            <div>
                                <label class="block text-sm font-medium mb-1">${t("subject.minAttendanceLabel")}</label>
                                <input type="number" name="minAttendancePercent" class="input w-full" min="0" max="100"
                                    value="${subject.minAttendancePercent !== null ? subject.minAttendancePercent : ''}"
                                    placeholder="${globalSettings.minAttendancePercent} (global)">
                                <p class="text-gray-400 text-sm mt-1">${t("subject.minAttendanceEditHint", { global: globalSettings.minAttendancePercent })}</p>
                            </div>
                            <div>
                                <label class="block text-sm font-medium mb-1">${t("subject.warningThresholdLabel")}</label>
                                <input type="number" name="warningThreshold" class="input w-full" min="0" max="100"
                                    value="${subject.warningThreshold !== null ? subject.warningThreshold : ''}"
                                    placeholder="${globalSettings.warningThreshold} (global)">
                                <p class="text-gray-400 text-sm mt-1">${t("subject.warningThresholdEditHint", { global: globalSettings.warningThreshold })}</p>
                            </div>
                            <label class="flex items-start gap-2 text-sm cursor-pointer">
                                <input type="checkbox" name="attendanceAutoGrading" class="checkbox mt-0.5" ${subject.attendanceAutoGrading ? 'checked' : ''}>
                                <span>
                                    <span class="font-medium">${t("subject.autoGradingLabel")}</span><br>
                                    <span class="text-gray-400 text-sm">${t("subject.autoGradingHint")}</span>
                                </span>
                            </label>
                        </div>
                    </div>
                `;
                showDialog("edit-dialog", t("subject.editSubject"), content, (formData) => {
                    const useCustom = document.getElementById("custom-attendance-toggle")?.checked;
                    const minAttendancePercent = useCustom ? (formData.get("minAttendancePercent") !== "" ? Number(formData.get("minAttendancePercent")) : null) : null;
                    const warningThreshold = useCustom ? (formData.get("warningThreshold") !== "" ? Number(formData.get("warningThreshold")) : null) : null;
                    const attendanceAutoGrading = useCustom ? formData.has("attendanceAutoGrading") : null;
                    editSubject(currentClass.id, subjectId, formData.get("name"), minAttendancePercent, warningThreshold, attendanceAutoGrading);
                });
                // Toggle visibility of custom fields
                const toggle = document.getElementById("custom-attendance-toggle");
                const fields = document.getElementById("custom-attendance-fields");
                if (toggle && fields) {
                    toggle.addEventListener("change", () => {
                        fields.classList.toggle("hidden", !toggle.checked);
                    });
                }
            }
        });
    });

    // Event-Listener: Fach löschen
    container.querySelectorAll("[data-delete-subject]").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const currentClass = getCurrentClass();
            const subjectId = btn.dataset.deleteSubject;
            const subject = currentYear.subjects.find(s => s.id === subjectId);
            if (subject) {
                showConfirmDialog(t("subject.confirmDelete", { name: escapeHtml(subject.name) }), () => {
                    deleteSubject(currentClass.id, subjectId);
                });
            }
        });
    });
};

/**
 * SCHÜLERTABELLE RENDERN
 *
 * Zeigt alle Schüler der aktuellen Klasse in einer Tabelle an.
 * Für jeden Schüler werden angezeigt:
 * - Name
 * - Alle Noten (als klickbare Badges)
 * - Einfacher Durchschnitt (ungewichtet)
 * - Gewichteter Durchschnitt
 * - Endnote (1-5)
 * - Aktions-Buttons (Note hinzufügen, Bearbeiten, Löschen)
 *
 * Features:
 * - Suchfunktion: Filtert nach Name, Notenwert oder Notenname
 * - Kategoriefilter: Zeigt nur Schüler mit Noten in einer bestimmten Kategorie
 */

/**
 * INITIALIZE TABS IN DIALOG
 *
 * Helper function to initialize tab functionality for dynamically created tabs.
 * Handles switching between tabs when clicked.
 *
 * @param {string} tabsContainerId - ID of the tabs container element
 */
const initializeTabs = (tabsContainerId) => {
    const container = document.getElementById(tabsContainerId);
    if (!container) return;

    const tabs = container.querySelectorAll('[role="tab"]');
    const panels = container.querySelectorAll('[role="tabpanel"]');

    tabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.preventDefault();

            // Deactivate all tabs and panels
            tabs.forEach(t => {
                t.setAttribute('aria-selected', 'false');
                t.setAttribute('tabindex', '-1');
            });
            panels.forEach(p => {
                p.setAttribute('aria-selected', 'false');
                p.hidden = true;
            });

            // Activate clicked tab and its panel
            tab.setAttribute('aria-selected', 'true');
            tab.setAttribute('tabindex', '0');
            const panelId = tab.getAttribute('aria-controls');
            const panel = document.getElementById(panelId);
            if (panel) {
                panel.setAttribute('aria-selected', 'true');
                panel.hidden = false;
            }
        });
    });
};

/**
 * OPEN ADD GRADE DIALOG
 *
 * Opens the dialog for adding a grade to a student. Reusable from class view and student detail view.
 *
 * @param {string} studentId - The ID of the student
 * @param {function} onSuccess - Callback after grade is successfully added
 */
const openAddGradeDialog = (studentId, onSuccess) => {
    const currentYear = getCurrentYear();
    if (!currentYear) return;

    // Get student for display
    const student = currentYear.students.find(s => s.id === studentId);
    if (!student) return;
    const studentName = getStudentDisplayName(student);

    // Require at least one subject in the current year
    if (!currentYear.subjects || currentYear.subjects.length === 0) {
        showAlertDialog(t("grade.noSubjectsError"));
        return;
    }

    // For primary school: require at least one category to exist
    if (appData.schoolType === 'primary' && appData.categories.length === 0) {
        showAlertDialog("Bitte zuerst mindestens eine Kategorie in den Einstellungen anlegen.");
        return;
    }

    // Create category selection with info about +/- support (global categories)
    const categoryOptions = appData.categories.map(cat => {
        const label = cat.onlyPlusMinus ? ' [+/~/- only]' : (cat.allowPlusMinus ? ' [+/~/-]' : '');
        return `<option value="${safeAttr(cat.id)}" data-allow-plus-minus="${cat.allowPlusMinus}" data-only-plus-minus="${cat.onlyPlusMinus || false}">${escapeHtml(cat.name)} (${(cat.weight * 100).toFixed(0)}%)${label}</option>`;
    }).join("");

    // Collect existing grade names from current year/subject for quick reuse
    const activeSubjectId = currentYear.currentSubjectId;
    const existingGradeNames = [...new Set(
        (currentYear.students || [])
            .flatMap(s => s.grades || [])
            .filter(g => g.name && g.name.trim() && g.subjectId === activeSubjectId)
            .map(g => g.name.trim())
    )].sort();

    const hasGradeNames = existingGradeNames.length > 0;

    // Get today's date in YYYY-MM-DD format for the date input
    const today = new Date().toISOString().split('T')[0];

    const isPrimarySchool = (appData.schoolType === 'primary');

    // Primary school: numeric grades 1-5, displayed as "1 – Sehr gut" etc. + mandatory comment
    const primaryGradeInput = isPrimarySchool ? `
    <div class="grid gap-2" id="grade-value-container">
      <label class="block mb-2">Beurteilung</label>
      <div class="grid grid-cols-2 gap-2" id="primary-grade-buttons">
        ${[
            { value: '1', label: 'Sehr gut',            color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
            { value: '2', label: 'Gut',                  color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
            { value: '3', label: 'Befriedigend',         color: '#eab308', bg: 'rgba(234,179,8,0.12)' },
            { value: '4', label: 'Gen\u00fcgend',        color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
            { value: '5', label: 'Nicht gen\u00fcgend',  color: '#ef4444', bg: 'rgba(239,68,68,0.12)' }
        ].map(g => `
          <label class="primary-grade-btn flex items-center gap-2 p-2 rounded-lg border-2 cursor-pointer transition-all"
              style="border-color: var(--border, #2d2d3d);"
              data-value="${g.value}" data-color="${g.color}" data-bg="${g.bg}">
            <input type="radio" name="value" value="${g.value}" class="sr-only" required>
            <span class="text-sm font-semibold px-2 py-0.5 rounded-full whitespace-nowrap" style="background:${g.bg}; color:${g.color};">${g.value} \u2013 ${g.label}</span>
          </label>`).join('')}
      </div>
    </div>
    <div class="grid gap-2">
      <label class="block mb-2">Textbeurteilung <span class="text-red-400">*</span></label>
      <textarea name="gradeComment" id="grade-comment-input" class="input w-full" rows="3" placeholder="Schriftliche Erläuterung zur Beurteilung..."></textarea>
      <p class="text-gray-400 text-sm">Pflichtfeld – schriftliche Erläuterung zur Note.</p>
    </div>` : `
    <div class="grid gap-2" id="grade-value-container">
      <div class="tabs w-full" id="grade-input-tabs">
        <nav role="tablist" aria-orientation="horizontal" class="w-full">
          <button type="button" role="tab" id="tab-grade-direct" aria-controls="panel-grade-direct" aria-selected="true" tabindex="0">${t("grade.gradeTab")}</button>
          <button type="button" role="tab" id="tab-grade-percent" aria-controls="panel-grade-percent" aria-selected="false" tabindex="0">${t("grade.percentageTab")}</button>
        </nav>
        <div role="tabpanel" id="panel-grade-direct" aria-labelledby="tab-grade-direct" tabindex="-1" aria-selected="true">
          <div class="pt-3">
            <input type="number" name="value" step="0.1" min="1" max="6" class="input w-full" id="grade-value-input" placeholder="1-6" data-icon="hash">
            <p class="text-gray-400 text-sm mt-2">${t("grade.enterGrade")}</p>
          </div>
        </div>
        <div role="tabpanel" id="panel-grade-percent" aria-labelledby="tab-grade-percent" tabindex="-1" aria-selected="false" hidden>
          <div class="pt-3">
            <div class="flex items-center gap-2">
              <input type="number" id="grade-percent-input" step="0.1" min="0" max="100" class="input flex-1" placeholder="0-100" data-icon="percent">
              <span>%</span>
            </div>
            <p class="text-gray-400 text-sm mt-2">${t("grade.enterPercentage")}</p>
            <p class="text-sm mt-1 font-semibold" id="percent-preview"></p>
          </div>
        </div>
      </div>
    </div>`;

    const content = `
    <div class="mb-3 p-3 rounded-lg bg-primary/10">
      <p class="text-sm font-medium">${escapeHtml(studentName)}</p>
    </div>
    <div class="grid gap-2">
      <label class="block mb-2">${t("grade.gradeDate")}</label>
      <input type="date" name="gradeDate" class="input w-full" value="${today}" required>
      <p class="text-gray-400 text-sm">${t("grade.gradeDateHint")}</p>
    </div>
    <div class="grid gap-2">
      <label class="block mb-2">${t("grade.gradeName")}</label>
      <div class="relative">
        <div class="flex gap-2">
          <input type="text" name="name" class="input flex-1" placeholder="${t("grade.gradeNamePlaceholder")}">
          ${hasGradeNames ? `<button type="button" id="grade-name-dropdown-btn" class="btn-outline" style="padding: 0.4rem 0.5rem; display: flex; align-items: center;" title="${t("grade.previousNames")}">
            <svg class="lucide lucide-chevron-down-icon lucide-chevron-down" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>` : ''}
        </div>
        ${hasGradeNames ? `<div id="grade-name-dropdown" class="hidden absolute z-50 mt-1 w-full rounded-lg shadow-lg overflow-auto" style="max-height: 200px; background: var(--card, #1e1e2e); border: 1px solid var(--border, #2d2d3d);">
          ${existingGradeNames.map(name => `<button type="button" class="grade-name-option w-full text-left px-3 py-2 cursor-pointer" style="border: none; background: none; color: inherit;" onmouseover="this.style.background='rgba(128,128,128,0.15)'" onmouseout="this.style.background='none'" data-name="${safeAttr(name)}">${escapeHtml(name)}</button>`).join('')}
        </div>` : ''}
      </div>
      <p class="text-gray-400 text-sm">${t("grade.gradeNameHint")}</p>
    </div>
    ${!isPrimarySchool ? `<div class="grid gap-2">
      <label class="block mb-2">${t("grade.category")}</label>
      <select name="categoryId" id="grade-category-select" class="select w-full" required data-icon="tag">
        ${categoryOptions}
      </select>
      <p class="text-gray-400 text-sm">${t("grade.categoryHint")}</p>
    </div>` : `<input type="hidden" name="categoryId" value="${appData.categories.length > 0 ? safeAttr(appData.categories[0].id) : ''}">` }
    <div class="grid gap-2 mb-3">
      <label class="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" name="isPending" id="grade-is-pending" class="checkbox">
        <span>${t("grade.pendingGrade")}</span>
      </label>
      <p class="text-gray-400 text-sm">${t("grade.pendingGradeHint")}</p>
    </div>
    ${primaryGradeInput}
  `;

    showDialog("edit-dialog", t("grade.addGrade"), content, (formData) => {
        // Check if pending grade checkbox is checked
        const isPending = formData.get("isPending") === "on";

        let gradeValue = formData.get("value");
        let enteredAsPercent = false;
        let percentValue = null;

        if (isPrimarySchool) {
            if (!isPending) {
                if (!gradeValue) {
                    showAlertDialog("Bitte eine Beurteilung auswählen.");
                    return false;
                }
                const comment = formData.get("gradeComment");
                if (!comment || !comment.trim()) {
                    // Highlight the textarea instead of alert so dialog stays open
                    const ta = document.getElementById("grade-comment-input");
                    if (ta) {
                        ta.style.borderColor = 'var(--destructive, #ef4444)';
                        ta.focus();
                        ta.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }
                    return false;
                }
            } else {
                gradeValue = null;
            }
        } else {
            // Secondary school: numeric/percentage handling
            const percentPanel = document.getElementById("panel-grade-percent");
            const percentInput = document.getElementById("grade-percent-input");
            const directGradeInput = document.getElementById("grade-value-input");

            if (!isPending) {
                if (percentPanel && !percentPanel.hidden && percentInput && percentInput.value) {
                    percentValue = parseFloat(percentInput.value);
                    const convertedGrade = percentToGrade(percentValue);
                    if (convertedGrade !== null) {
                        gradeValue = convertedGrade.toString();
                        enteredAsPercent = true;
                    } else {
                        showAlertDialog(t("error.invalidPercentage"));
                        return false;
                    }
                } else if (percentPanel && !percentPanel.hidden && (!percentInput || !percentInput.value)) {
                    showAlertDialog(t("error.enterPercentage"));
                    return false;
                } else if ((!percentPanel || percentPanel.hidden) && directGradeInput && !directGradeInput.value && !gradeValue) {
                    showAlertDialog(t("error.enterGrade"));
                    return false;
                }
            } else {
                gradeValue = null;
            }
        }

        // subjectId vom aktiven Fach-Tab übernehmen
        if (!activeSubjectId) {
            showAlertDialog(t("grade.mustSelectSubject"));
            return false;
        }

        // Get selected date and convert to timestamp
        const selectedDate = formData.get("gradeDate");
        let gradeTimestamp = null;
        if (selectedDate) {
            const dateParts = selectedDate.split('-');
            const dateObj = new Date(dateParts[0], dateParts[1] - 1, dateParts[2], 12, 0, 0);
            gradeTimestamp = dateObj.getTime();
        }

        const newGrade = addGrade(studentId, formData.get("categoryId"), gradeValue, formData.get("name"), activeSubjectId, gradeTimestamp, isPending);

        if (newGrade) {
            if (enteredAsPercent) {
                newGrade.enteredAsPercent = true;
                newGrade.percentValue = percentValue;
            }
            // Save comment for primary school grades (mandatory)
            if (isPrimarySchool) {
                newGrade.comment = (formData.get("gradeComment") || '').trim();
            }

            saveData(t("toast.gradeAdded"), "success");
            if (onSuccess) onSuccess();
        }
    });

    // For primary school: initialize card-style grade button interactions
    if (isPrimarySchool) {
        setTimeout(() => {
            const buttons = document.querySelectorAll('.primary-grade-btn');
            buttons.forEach(btn => {
                btn.addEventListener('click', () => {
                    buttons.forEach(b => {
                        b.style.borderColor = 'var(--border, #2d2d3d)';
                        b.style.background = '';
                    });
                    btn.style.borderColor = btn.dataset.color;
                    btn.style.background = btn.dataset.bg;
                    const radio = btn.querySelector('input[type="radio"]');
                    if (radio) radio.checked = true;
                });
            });
            // Clear red border on textarea when user starts typing
            const ta = document.getElementById('grade-comment-input');
            if (ta) {
                ta.addEventListener('input', () => { ta.style.borderColor = ''; });
            }
        }, 0);
        return; // No category select needed for primary school
    }

    // Add dynamic input switching based on category selection
    const categorySelect = document.getElementById("grade-category-select");
    const valueContainer = document.getElementById("grade-value-container");

    const updateGradeInput = () => {
        const selectedOption = categorySelect.options[categorySelect.selectedIndex];
        const allowPlusMinus = selectedOption.dataset.allowPlusMinus === "true";
        const onlyPlusMinus = selectedOption.dataset.onlyPlusMinus === "true";

        if (onlyPlusMinus) {
            // Only +/- grades allowed - no tabs needed
            valueContainer.innerHTML = `
                <label class="block mb-2">${t("grade.gradeTab")}</label>
                <select name="value" class="select w-full" required>
                    <option value="">${t("grade.select")}</option>
                    <option value="+">${t("grade.plus")}</option>
                    <option value="~">${t("grade.neutral")}</option>
                    <option value="-">${t("grade.minus")}</option>
                </select>
                <p class="text-gray-400 text-sm">${t("grade.plusMinusOnlyHint")}</p>
            `;
        } else if (allowPlusMinus) {
            // Allow +/- but also numeric - no percentage for mixed
            valueContainer.innerHTML = `
                <label class="block mb-2">${t("grade.gradeTab")}</label>
                <select name="value" class="select w-full" required>
                    <option value="">${t("grade.selectGradeType")}</option>
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                    <option value="4">4</option>
                    <option value="5">5</option>
                    <option value="6">6</option>
                    <option value="+">${t("grade.plus")}</option>
                    <option value="~">${t("grade.neutral")}</option>
                    <option value="-">${t("grade.minus")}</option>
                </select>
                <p class="text-gray-400 text-sm">${t("grade.mixedHint")}</p>
            `;
        } else {
            // Normal numeric grades - show tabs with percentage option
            valueContainer.innerHTML = `
                <div class="tabs w-full" id="grade-input-tabs">
                  <nav role="tablist" aria-orientation="horizontal" class="w-full">
                    <button type="button" role="tab" id="tab-grade-direct" aria-controls="panel-grade-direct" aria-selected="true" tabindex="0">${t("grade.gradeTab")}</button>
                    <button type="button" role="tab" id="tab-grade-percent" aria-controls="panel-grade-percent" aria-selected="false" tabindex="0">${t("grade.percentageTab")}</button>
                  </nav>
                  <div role="tabpanel" id="panel-grade-direct" aria-labelledby="tab-grade-direct" tabindex="-1" aria-selected="true">
                    <div class="pt-3">
                      <input type="number" name="value" step="0.1" min="1" max="6" class="input w-full" id="grade-value-input" placeholder="1-6" data-icon="hash">
                      <p class="text-gray-400 text-sm mt-2">${t("grade.enterGrade")}</p>
                    </div>
                  </div>
                  <div role="tabpanel" id="panel-grade-percent" aria-labelledby="tab-grade-percent" tabindex="-1" aria-selected="false" hidden>
                    <div class="pt-3">
                      <div class="flex items-center gap-2">
                        <input type="number" id="grade-percent-input" step="0.1" min="0" max="100" class="input flex-1" placeholder="0-100" data-icon="percent">
                        <span>%</span>
                      </div>
                      <p class="text-gray-400 text-sm mt-2">${t("grade.enterPercentage")}</p>
                      <p class="text-sm mt-1 font-semibold" id="percent-preview"></p>
                    </div>
                  </div>
                </div>
            `;

            // Initialize tabs
            setTimeout(() => {
                initializeTabs("grade-input-tabs");
            }, 0);

            // Add percentage preview listener
            setTimeout(() => {
                const percentInput = document.getElementById("grade-percent-input");
                const percentPreview = document.getElementById("percent-preview");
                if (percentInput && percentPreview) {
                    percentInput.addEventListener("input", () => {
                        const percent = parseFloat(percentInput.value);
                        if (!isNaN(percent) && percent >= 0 && percent <= 100) {
                            const grade = percentToGrade(percent);
                            percentPreview.textContent = t("grade.percentPreview", { grade: grade });
                        } else {
                            percentPreview.textContent = "";
                        }
                    });
                }
            }, 0);
        }
    };

    categorySelect.addEventListener("change", updateGradeInput);
    updateGradeInput(); // Initialize on load

    // Initialize tabs functionality
    setTimeout(() => {
        initializeTabs("grade-input-tabs");
    }, 0);

    // Add initial percentage preview listener
    setTimeout(() => {
        const percentInput = document.getElementById("grade-percent-input");
        const percentPreview = document.getElementById("percent-preview");
        if (percentInput && percentPreview) {
            percentInput.addEventListener("input", () => {
                const percent = parseFloat(percentInput.value);
                if (!isNaN(percent) && percent >= 0 && percent <= 100) {
                    const grade = percentToGrade(percent);
                    percentPreview.textContent = t("grade.percentPreview", { grade: grade });
                } else {
                    percentPreview.textContent = "";
                }
            });
        }
    }, 0);

    // Grade name dropdown listeners
    if (hasGradeNames) {
        const dropdownBtn = document.getElementById("grade-name-dropdown-btn");
        const dropdown = document.getElementById("grade-name-dropdown");
        const nameInput = document.querySelector("#edit-dialog [name='name']");

        if (dropdownBtn && dropdown && nameInput) {
            dropdownBtn.addEventListener("click", (e) => {
                e.preventDefault();
                dropdown.classList.toggle("hidden");
            });

            dropdown.querySelectorAll(".grade-name-option").forEach(option => {
                option.addEventListener("click", (e) => {
                    e.preventDefault();
                    nameInput.value = option.dataset.name;
                    dropdown.classList.add("hidden");
                    nameInput.focus();
                });
            });

            document.addEventListener("click", (e) => {
                if (!dropdownBtn.contains(e.target) && !dropdown.contains(e.target)) {
                    dropdown.classList.add("hidden");
                }
            });
        }
    }

    // Add event listener for pending grade checkbox
    const pendingCheckbox = document.getElementById("grade-is-pending");
    const gradeValueContainer = document.getElementById("grade-value-container");

    if (pendingCheckbox && gradeValueContainer) {
        const toggleGradeInputs = () => {
            const isPending = pendingCheckbox.checked;
            gradeValueContainer.style.opacity = isPending ? "0.5" : "1";
            gradeValueContainer.style.pointerEvents = isPending ? "none" : "auto";

            // Disable/enable all inputs in the container
            gradeValueContainer.querySelectorAll("input, select, button").forEach(el => {
                el.disabled = isPending;
            });
        };

        pendingCheckbox.addEventListener("change", toggleGradeInputs);
    }
};

// Sort state for student table
window.studentSortState = window.studentSortState || { column: 'lastName', direction: 'asc' };

const renderStudents = () => {
    // Aktuellen Jahrgang finden
    const currentYear = getCurrentYear();
    if (!currentYear) {
        console.error("No current year found!");
        return;
    }

    const currentSubject = currentYear.subjects?.find(s => s.id === currentYear.currentSubjectId);
    const currentSubjectName = currentSubject?.name || '';

    // Update class stats when students table changes
    renderClassStats();

    // Suchbegriff und Kategoriefilter aus den Input-Feldern holen
    const searchTerm = document.getElementById("search-students").value.toLowerCase();
    const filterCategory = document.getElementById("filter-category").value;
    const filterAttendance = document.getElementById("filter-attendance").value;

    const studentsTable = document.getElementById("students-table");

    // FILTER-PIPELINE: Erst filtern, sortieren, dann rendern
    const filteredStudents = currentYear.students
        // 1. FILTERN: Nur Schüler behalten die den Kriterien entsprechen
        .filter(student => {
            const fullName = getStudentDisplayName(student).toLowerCase();
            // Calculate final grade for search (respect category filter)
            let searchGrades = filterGradesBySubject(student.grades, currentYear.currentSubjectId);
            if (filterCategory) searchGrades = searchGrades.filter(g => g.categoryId === filterCategory);
            const weightedAvg = calculateWeightedAverage(searchGrades);
            const finalGrade = calculateFinalGrade(weightedAvg).toLowerCase();

            const matchesSearch = fullName.includes(searchTerm) || finalGrade.includes(searchTerm);
            const matchesCategory = filterCategory ? student.grades.some(g => g.categoryId === filterCategory) : true;
            const matchesAttendance = filterAttendance
                ? getAttendanceStatus(student.id, currentYear.currentSubjectId).status === filterAttendance
                : true;
            return matchesSearch && matchesCategory && matchesAttendance;
        })
        // 2. SORTIEREN: nach gewählter Spalte
        .sort((a, b) => {
            const { column, direction } = window.studentSortState;
            const dir = direction === 'asc' ? 1 : -1;

            const getGradeData = (student) => {
                let grades = filterGradesBySubject(student.grades, currentYear.currentSubjectId);
                if (filterCategory) grades = grades.filter(g => g.categoryId === filterCategory);
                return {
                    gradeCount: grades.length,
                    weighted: calculateWeightedAverage(grades) || 999,
                    finalGrade: parseFloat(calculateFinalGrade(calculateWeightedAverage(grades))) || 999
                };
            };

            if (column === 'lastName') {
                const cmp = (a.lastName || '').localeCompare(b.lastName || '', 'de');
                if (cmp !== 0) return cmp * dir;
                return (a.firstName || '').localeCompare(b.firstName || '', 'de') * dir;
            } else if (column === 'firstName') {
                return (a.firstName || '').localeCompare(b.firstName || '', 'de') * dir;
            } else if (column === 'gradeCount') {
                return (getGradeData(a).gradeCount - getGradeData(b).gradeCount) * dir;
            } else if (column === 'weighted') {
                return (getGradeData(a).weighted - getGradeData(b).weighted) * dir;
            } else if (column === 'finalGrade') {
                return (getGradeData(a).finalGrade - getGradeData(b).finalGrade) * dir;
            }
            return 0;
        });

    // Empty State anzeigen wenn keine Schüler vorhanden
    if (filteredStudents.length === 0) {
        const icon = `<svg class="lucide lucide-users-icon lucide-users" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>`;

        const title = currentYear.students.length === 0 ? t('emptyState.noStudents') || 'Keine Schüler' : t('emptyState.noStudentsFiltered') || 'Keine Schüler gefunden';
        const description = currentYear.students.length === 0
            ? t('emptyState.noStudentsDesc') || 'Sie haben noch keine Schüler in dieser Klasse. Klicken Sie auf "Schüler hinzufügen" um zu beginnen.'
            : t('emptyState.noStudentsFilteredDesc') || 'Keine Schüler entsprechen Ihren Suchkriterien. Versuchen Sie einen anderen Suchbegriff oder Filter.';

        const buttons = currentYear.students.length === 0 ? [{
            text: t('class.addStudent') || 'Schüler hinzufügen',
            class: 'btn-primary',
            onclick: 'document.getElementById(\'add-student\').click()'
        }] : [];

        const tableSection = document.getElementById('students-table-section');
        const emptyHost = document.getElementById('students-empty-state');
        if (currentYear.students.length === 0 && tableSection && emptyHost) {
            // No students at all → hide table entirely, show empty state alone.
            tableSection.classList.add('hidden');
            emptyHost.classList.remove('hidden');
            emptyHost.innerHTML = createEmptyState(icon, title, description, buttons);
            studentsTable.innerHTML = '';
        } else {
            // Filtered-empty: keep table chrome, show empty state inside body.
            if (tableSection) tableSection.classList.remove('hidden');
            if (emptyHost) { emptyHost.classList.add('hidden'); emptyHost.innerHTML = ''; }
            studentsTable.innerHTML = `<tr><td colspan="9">${createEmptyState(icon, title, description, buttons)}</td></tr>`;
        }
        return;
    }
    // Students exist → ensure table visible and empty host hidden.
    {
        const tableSection = document.getElementById('students-table-section');
        const emptyHost = document.getElementById('students-empty-state');
        if (tableSection) tableSection.classList.remove('hidden');
        if (emptyHost) { emptyHost.classList.add('hidden'); emptyHost.innerHTML = ''; }
    }

    studentsTable.innerHTML = filteredStudents.map(student => {
            // Noten nach aktivem Fach und ggf. Kategorie filtern
            let filteredGrades = filterGradesBySubject(student.grades, currentYear.currentSubjectId);
            if (filterCategory) filteredGrades = filteredGrades.filter(g => g.categoryId === filterCategory);
            const weightedAvg = calculateWeightedAverage(filteredGrades);
            const gradeCount = filteredGrades.length;

            // Jahresübersicht: WS + SS + Gesamt (immer über beide Semester, unabhängig vom aktiven Semester-Filter)
            const sid = currentYear.currentSubjectId;
            const _wsGrades = sid ? student.grades.filter(g => g.subjectId === sid && g.semester === "WS") : [];
            const _ssGrades = sid ? student.grades.filter(g => g.subjectId === sid && g.semester === "SS") : [];
            const _allGrades = sid ? student.grades.filter(g => g.subjectId === sid) : [];
            const _wsAvg = calculateWeightedAverage(filterCategory ? _wsGrades.filter(g => g.categoryId === filterCategory) : _wsGrades);
            const _ssAvg = calculateWeightedAverage(filterCategory ? _ssGrades.filter(g => g.categoryId === filterCategory) : _ssGrades);
            const _allAvg = calculateWeightedAverage(filterCategory ? _allGrades.filter(g => g.categoryId === filterCategory) : _allGrades);
            const _wsFinal = _wsAvg ? calculateFinalGrade(_wsAvg) : "—";
            const _ssFinal = _ssAvg ? calculateFinalGrade(_ssAvg) : "—";
            const _yearFinal = _allAvg ? calculateFinalGrade(_allAvg) : "—";
            const _gradeClass = (g) => (g && g !== "—" && g !== "-") ? `grade-badge grade-${g}` : '';

            // Anwesenheits-Check für aktuelles Fach
            const attendanceStatus = getAttendanceStatus(student.id, currentYear.currentSubjectId);
            let finalGradeDisplay = calculateFinalGrade(weightedAvg);
            let attendanceBadge = '';
            let rowClass = '';

            if (attendanceStatus.status === 'critical') {
              finalGradeDisplay = '5';
              rowClass = 'attendance-critical-row';
            } else if (attendanceStatus.status === 'warning') {
              rowClass = 'attendance-warning-row';
            }

            // Attendance warning text (shown below name)
            let attendanceWarningText = '';
            if (attendanceStatus.status === 'critical') {
              attendanceWarningText = `<span class="text-xs text-red-600 dark:text-red-400" title="${t('attendance.criticalWarning')}">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="inline lucide lucide-circle-alert-icon lucide-circle-alert"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                ${t('attendance.atLimitWarning') || 'Am Limit'} (${attendanceStatus.rate}%)
              </span>`;
            } else if (attendanceStatus.status === 'warning') {
              attendanceWarningText = `<span class="text-xs text-orange-600 dark:text-orange-400" title="${t('attendance.lowWarning')}">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="inline lucide lucide-triangle-alert-icon lucide-triangle-alert"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                ${t('attendance.nearLimit') || 'Knapp am Limit'} (${attendanceStatus.rate}%)
              </span>`;
            }

            // Trend badge for declining students
            const trend = calculateTrend(filteredGrades);
            const trendBadge = trend.trend === 'declining'
                ? `<span class="trend-badge declining" title="${t('student.declining') || 'Absteigend'}">${lucideIcon('trending-down')}</span>`
                : '';

            return `
            <tr class="${rowClass} student-row" data-open-qsb="${safeAttr(student.id)}" style="cursor:pointer">
              <td>
                <input type="checkbox" class="checkbox student-checkbox no-row-click" data-student-id="${safeAttr(student.id)}">
              </td>
              <td>
                <span class="student-name-link" data-student-id="${safeAttr(student.id)}">${escapeHtml(student.lastName || '')}</span>${trendBadge}
                ${attendanceWarningText ? `<div class="text-xs mt-0.5">${attendanceWarningText}</div>` : ''}
              </td>
              <td>${escapeHtml(student.firstName || '')}</td>
              <td>${escapeHtml(student.middleName || '')}</td>
              <td>${gradeCount}</td>
              <td>${weightedAvg ? weightedAvg.toFixed(2) : "—"}</td>
              <td>${filterCategory ? (weightedAvg ? weightedAvg.toFixed(2) : "—") : finalGradeDisplay}</td>
              <td style="white-space:nowrap">
                <div style="display:flex;align-items:center;gap:0.35rem;font-size:0.8em">
                  <span style="opacity:0.5;font-size:0.9em">WS</span>
                  <span class="${_gradeClass(_wsFinal)}" style="padding:0.1rem 0.4rem;border-radius:4px;font-weight:600;min-width:1.4em;text-align:center">${_wsFinal}</span>
                  <span style="opacity:0.25">·</span>
                  <span style="opacity:0.5;font-size:0.9em">SS</span>
                  <span class="${_gradeClass(_ssFinal)}" style="padding:0.1rem 0.4rem;border-radius:4px;font-weight:600;min-width:1.4em;text-align:center">${_ssFinal}</span>
                  <span style="opacity:0.25">·</span>
                  <span style="opacity:0.5;font-size:0.9em">∑</span>
                  <span class="${_gradeClass(_yearFinal)}" style="padding:0.1rem 0.4rem;border-radius:4px;font-weight:600;min-width:1.4em;text-align:center">${_yearFinal}</span>
                </div>
              </td>
              <td class="no-row-click">
                <button class="btn-icon btn-secondary mr-1" data-view-student="${safeAttr(student.id)}" data-tooltip="${t("tooltip.viewStudentDetails", { student: `${student.firstName} ${student.lastName}`.trim() })}" data-side="top">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-eye-icon lucide-eye"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>
                </button>
                <button class="btn-icon btn-primary mr-1" data-add-grade="${safeAttr(student.id)}" data-tooltip="${currentSubjectName ? t("tooltip.addGradeToStudent", { student: `${student.firstName} ${student.lastName}`.trim(), subject: currentSubjectName }) : t("grade.addGrade")}" data-side="top">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-plus-icon lucide-plus"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
                </button>
                <button class="btn-icon btn-secondary mr-1" data-edit-student="${safeAttr(student.id)}" data-tooltip="${t("tooltip.renameStudent", { student: `${student.firstName} ${student.lastName}`.trim() })}" data-side="top">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-user-pen-icon lucide-user-pen"><path d="M11.5 15H7a4 4 0 0 0-4 4v2"/><path d="M21.378 16.626a1 1 0 0 0-3.004-3.004l-4.01 4.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/><circle cx="10" cy="7" r="4"/></svg>
                </button>
                <button class="btn-icon btn-destructive" data-delete-student="${safeAttr(student.id)}" data-tooltip="${t("dialog.delete")}" data-side="top">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash-icon lucide-trash"><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </button>
              </td>
            </tr>
          `;
        }).join("");
    //<button class="btn-icon btn-secondary mr-1" data-print-student="${safeAttr(student.id)}" data-tooltip="${t("student.print")}" data-side="top"><svg class="lucide lucide-printer-icon lucide-printer" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg></button>
                
    // Entire row → quick sidebar; skip clicks on checkbox/action cells
    document.querySelectorAll(".student-row").forEach(row => {
        row.addEventListener("click", (e) => {
            if (e.target.closest(".no-row-click")) return;
            openStudentQuickSidebar(row.dataset.openQsb);
        });
    });

    // Add event listeners for view details buttons
    document.querySelectorAll("[data-view-student]").forEach(btn => {
        btn.addEventListener("click", () => {
            const studentId = btn.dataset.viewStudent;
            showStudentDetailView(studentId);
        });
    });

    document.querySelectorAll("[data-add-grade]").forEach(btn => {
        btn.addEventListener("click", () => {
            openAddGradeDialog(btn.dataset.addGrade, () => renderStudents());
        });
    });

    document.querySelectorAll("[data-print-student]").forEach(btn => {
        btn.addEventListener("click", () => {
            const studentId = btn.dataset.printStudent;
            exportStudentDetailPDF(studentId);
        });
    });

    document.querySelectorAll("[data-edit-student]").forEach(btn => {
        btn.addEventListener("click", () => {
            const studentId = btn.dataset.editStudent;
            const student = currentYear.students.find(s => s.id === studentId);
            if (student) {
                const content = `
            <div class="grid gap-2">
              <label class="block mb-2">${t("student.firstName")}</label>
              <input type="text" name="firstName" class="input w-full" value="${escapeHtml(student.firstName || '')}" required maxlength="50">
            </div>
            <div class="grid gap-2 mt-3">
              <label class="block mb-2">${t("student.middleName")}</label>
              <input type="text" name="middleName" class="input w-full" value="${escapeHtml(student.middleName || '')}" maxlength="50">
            </div>
            <div class="grid gap-2 mt-3">
              <label class="block mb-2">${t("student.lastName")}</label>
              <input type="text" name="lastName" class="input w-full" value="${escapeHtml(student.lastName || '')}" required maxlength="50">
            </div>
            <div class="grid gap-2 mt-3">
              <label class="block mb-2">${t("student.notes")}</label>
              <textarea name="notes" class="input w-full" rows="4" maxlength="2000" placeholder="${escapeHtml(t("student.notesPlaceholder"))}">${escapeHtml(student.notes || '')}</textarea>
              <p class="text-gray-400 text-sm">${t("student.notesHint")}</p>
            </div>
          `;

                showDialog("edit-dialog", t("class.editStudent"), content, (formData) => {
                    student.firstName = formData.get("firstName");
                    student.middleName = formData.get("middleName") || '';
                    student.lastName = formData.get("lastName");
                    const rawNotes = (formData.get("notes") || '').toString();
                    student.notes = rawNotes.slice(0, 2000);
                    saveData(t("toast.studentEdited"), "success");
                    renderStudents();
                    flashRenameSuccessIcon(document.querySelector(`[data-edit-student="${studentId}"]`));
                });
            }
        });
    });

    document.querySelectorAll("[data-delete-student]").forEach(btn => {
        btn.addEventListener("click", () => {
            const studentId = btn.dataset.deleteStudent;
            const student = currentYear.students.find(s => s.id === studentId);
            if (student) {
                const studentName = getStudentDisplayName(student);
                const gradeCount = student.grades.length;
                const message = t("confirm.deleteStudent") + ` ${studentName}?`;
                const details = gradeCount > 0
                    ? `<strong>${t('confirm.studentGradeCount') || 'Anzahl Noten'}:</strong> ${gradeCount}<br><br>${t('confirm.allGradesDeleted') || 'Alle Noten dieses Schülers werden ebenfalls gelöscht.'}`
                    : '';
                const warning = t('confirm.cannotBeUndone') || 'Diese Aktion kann nicht rückgängig gemacht werden.';

                showConfirmDialog(message, () => {
                    const row = document.querySelector(`tr[data-open-qsb="${studentId}"]`);
                    animateOutThenRun(row, 'row-removing', () => {
                        deleteItem("student", studentId);
                        saveData(t("toast.studentDeleted"), "success");
                        renderStudents();
                    });
                }, details, warning);
            }
        });
    });

    // Sort headers: attach click listeners and update active state
    const _SVG_UPDOWN = `<svg class="lucide lucide-arrow-up-down-icon lucide-arrow-up-down" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/></svg>`;
    const _SVG_UP    = `<svg class="lucide lucide-arrow-up-icon lucide-arrow-up" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>`;
    const _SVG_DOWN  = `<svg class="lucide lucide-arrow-down-icon lucide-arrow-down" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>`;
    document.querySelectorAll(".sortable-header").forEach(th => {
        th.classList.remove('sort-asc', 'sort-desc');
        const icon = th.querySelector('.sort-icon');
        if (th.dataset.sort === window.studentSortState.column) {
            th.classList.add(window.studentSortState.direction === 'asc' ? 'sort-asc' : 'sort-desc');
            if (icon) {
                icon.style.opacity = '1';
                icon.innerHTML = window.studentSortState.direction === 'asc' ? _SVG_UP : _SVG_DOWN;
            }
        } else {
            if (icon) {
                icon.style.opacity = '0.4';
                icon.innerHTML = _SVG_UPDOWN;
            }
        }
        th.onclick = () => {
            const col = th.dataset.sort;
            if (window.studentSortState.column === col) {
                window.studentSortState.direction = window.studentSortState.direction === 'asc' ? 'desc' : 'asc';
            } else {
                window.studentSortState.column = col;
                window.studentSortState.direction = 'asc';
            }
            renderStudents();
        };
    });

    // Compact view: apply current state
    const tableEl = document.querySelector("#students-table")?.closest('table');
    const isCompact = localStorage.getItem('edugrade_compact_view') === '1';
    if (tableEl) tableEl.classList.toggle('compact-table', isCompact);
    if (tableEl) tableEl.classList.toggle('category-filtered', !!filterCategory);

    // Update final grade column header based on active category filter
    const headerLabel = document.getElementById('students-finalgrade-header-label');
    if (headerLabel) {
        if (filterCategory) {
            const catName = appData.categories.find(c => c.id === filterCategory)?.name || '';
            headerLabel.textContent = `${t("table.semFinalGrade")} ${catName}`;
        } else {
            headerLabel.textContent = t("table.semFinalGrade");
        }
    }

    const compactBtn = document.getElementById('compact-view-toggle');
    if (compactBtn) compactBtn.classList.toggle('active', isCompact);

    // Bulk Actions: Handle checkbox changes
    const updateBulkActionsToolbar = () => {
        const checkboxes = document.querySelectorAll(".student-checkbox");
        const checkedCheckboxes = document.querySelectorAll(".student-checkbox:checked");
        const toolbar = document.getElementById("bulk-actions-toolbar");
        const countElement = document.getElementById("bulk-selection-count");
        const selectAllCheckbox = document.getElementById("select-all-students");

        const checkedCount = checkedCheckboxes.length;

        // Show/hide toolbar based on selection
        if (checkedCount > 0) {
            toolbar.classList.remove("hidden");
            countElement.textContent = t("class.selected").replace("{count}", checkedCount);
        } else {
            toolbar.classList.add("hidden");
        }

        // Update "select all" checkbox state
        if (selectAllCheckbox) {
            selectAllCheckbox.checked = checkedCount === checkboxes.length && checkboxes.length > 0;
            selectAllCheckbox.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
        }
    };

    // Individual checkbox listeners
    document.querySelectorAll(".student-checkbox").forEach(checkbox => {
        checkbox.addEventListener("change", updateBulkActionsToolbar);
    });

    // Select all checkbox
    const selectAllCheckbox = document.getElementById("select-all-students");
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener("change", (e) => {
            const checkboxes = document.querySelectorAll(".student-checkbox");
            checkboxes.forEach(cb => {
                cb.checked = e.target.checked;
            });
            updateBulkActionsToolbar();
        });
    }

    // Bulk add grade button
    const bulkAddGradeBtn = document.getElementById("bulk-add-grade-btn");
    if (bulkAddGradeBtn) {
        // Remove old listener if exists
        const newBtn = bulkAddGradeBtn.cloneNode(true);
        bulkAddGradeBtn.parentNode.replaceChild(newBtn, bulkAddGradeBtn);

        newBtn.addEventListener("click", () => {
            const selectedStudentIds = Array.from(document.querySelectorAll(".student-checkbox:checked"))
                .map(cb => cb.dataset.studentId);

            if (selectedStudentIds.length === 0) return;

            // Open the grade dialog and add to all selected students
            const currentYear = getCurrentYear();
            if (!currentYear) return;

            // Create category selection with info about +/- support (global categories)
            const categoryOptions = appData.categories.map(cat => {
                const label = cat.onlyPlusMinus ? ' [+/~/- only]' : (cat.allowPlusMinus ? ' [+/~/-]' : '');
                return `<option value="${safeAttr(cat.id)}" data-allow-plus-minus="${cat.allowPlusMinus}" data-only-plus-minus="${cat.onlyPlusMinus || false}">${escapeHtml(cat.name)} (${(cat.weight * 100).toFixed(0)}%)${label}</option>`;
            }).join("");

            // Collect existing grade names from current year/subject for quick reuse
            const activeSubjectId = currentYear.currentSubjectId;
            const existingGradeNames = [...new Set(
                (currentYear.students || [])
                    .flatMap(s => s.grades || [])
                    .filter(g => g.name && g.name.trim() && g.subjectId === activeSubjectId)
                    .map(g => g.name.trim())
            )].sort();

            const hasGradeNames = existingGradeNames.length > 0;

            // Get today's date in YYYY-MM-DD format for the date input
            const today = new Date().toISOString().split('T')[0];

            const content = `
            <div class="mb-3 p-3 rounded-lg bg-primary/10">
                <p class="text-sm font-medium">${t("class.selected").replace("{count}", selectedStudentIds.length)}</p>
            </div>
            <div class="grid gap-2">
              <label class="block mb-2">${t("grade.gradeDate")}</label>
              <input type="date" name="gradeDate" class="input w-full" value="${today}" required>
              <p class="text-gray-400 text-sm">${t("grade.gradeDateHint")}</p>
            </div>
            <div class="grid gap-2">
              <label class="block mb-2">${t("grade.gradeName")}</label>
              <div class="relative">
                <div class="flex gap-2">
                  <input type="text" name="name" class="input flex-1" placeholder="${t("grade.gradeNamePlaceholder")}">
                  ${hasGradeNames ? `<button type="button" id="grade-name-dropdown-btn" class="btn-outline" style="padding: 0.4rem 0.5rem; display: flex; align-items: center;" title="${t("grade.previousNames")}">
                    <svg class="lucide lucide-chevron-down-icon lucide-chevron-down" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                  </button>` : ''}
                </div>
                ${hasGradeNames ? `<div id="grade-name-dropdown" class="hidden absolute z-50 mt-1 w-full rounded-lg shadow-lg overflow-auto" style="max-height: 200px; background: var(--card, #1e1e2e); border: 1px solid var(--border, #2d2d3d);">
                  ${existingGradeNames.map(name => `<button type="button" class="grade-name-option w-full text-left px-3 py-2 cursor-pointer" style="border: none; background: none; color: inherit;" onmouseover="this.style.background='rgba(128,128,128,0.15)'" onmouseout="this.style.background='none'" data-name="${safeAttr(name)}">${escapeHtml(name)}</button>`).join('')}
                </div>` : ''}
              </div>
              <p class="text-gray-400 text-sm">${t("grade.gradeNameHint")}</p>
            </div>
            <div class="grid gap-2">
              <label class="block mb-2">${t("grade.category")}</label>
              <select name="categoryId" id="grade-category-select" class="select w-full" required data-icon="tag">
                ${categoryOptions}
              </select>
              <p class="text-gray-400 text-sm">${t("grade.categoryHint")}</p>
            </div>
            <div class="grid gap-2 mb-3">
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" name="isPending" id="grade-is-pending-bulk" class="checkbox">
                <span>${t("grade.pendingGrade")}</span>
              </label>
              <p class="text-gray-400 text-sm">${t("grade.pendingGradeHint")}</p>
            </div>
            <div class="grid gap-2" id="grade-value-container">
              <div class="tabs w-full" id="grade-input-tabs">
                <nav role="tablist" aria-orientation="horizontal" class="w-full">
                  <button type="button" role="tab" id="tab-grade-direct" aria-controls="panel-grade-direct" aria-selected="true" tabindex="0">${t("grade.gradeTab")}</button>
                  <button type="button" role="tab" id="tab-grade-percent" aria-controls="panel-grade-percent" aria-selected="false" tabindex="0">${t("grade.percentageTab")}</button>
                </nav>
                <div role="tabpanel" id="panel-grade-direct" aria-labelledby="tab-grade-direct" tabindex="-1" aria-selected="true">
                  <div class="pt-3">
                    <input type="number" name="value" step="0.1" min="1" max="6" class="input w-full" id="grade-value-input" placeholder="1-6" data-icon="hash">
                    <p class="text-gray-400 text-sm mt-2">${t("grade.enterGrade")}</p>
                  </div>
                </div>
                <div role="tabpanel" id="panel-grade-percent" aria-labelledby="tab-grade-percent" tabindex="-1" aria-selected="false" hidden>
                  <div class="pt-3">
                    <div class="flex items-center gap-2">
                      <input type="number" id="grade-percent-input" step="0.1" min="0" max="100" class="input flex-1" placeholder="0-100" data-icon="percent">
                      <span>%</span>
                    </div>
                    <p class="text-gray-400 text-sm mt-2">${t("grade.enterPercentage")}</p>
                    <p class="text-sm mt-1 font-semibold" id="percent-preview"></p>
                  </div>
                </div>
              </div>
            </div>
          `;

            showDialog("edit-dialog", t("class.bulkAddGrade"), content, (formData) => {
                // Check if pending grade checkbox is checked
                const isPending = formData.get("isPending") === "on";

                // Check if percentage tab is active
                const percentPanel = document.getElementById("panel-grade-percent");
                const percentInput = document.getElementById("grade-percent-input");
                const directGradeInput = document.getElementById("grade-value-input");

                let gradeValue = formData.get("value");
                let enteredAsPercent = false;
                let percentValue = null;

                // If grade is pending, skip value validation
                if (!isPending) {
                    // If percentage panel is visible and has a value, convert it
                    if (percentPanel && !percentPanel.hidden && percentInput && percentInput.value) {
                        percentValue = parseFloat(percentInput.value);
                        const convertedGrade = percentToGrade(percentValue);
                        if (convertedGrade !== null) {
                            gradeValue = convertedGrade.toString();
                            enteredAsPercent = true;
                        } else {
                            showAlertDialog(t("error.invalidPercentage"));
                            return;
                        }
                    } else if (percentPanel && !percentPanel.hidden && (!percentInput || !percentInput.value)) {
                        showAlertDialog(t("error.enterPercentage"));
                        return;
                    } else if ((!percentPanel || percentPanel.hidden) && directGradeInput && !directGradeInput.value && !gradeValue) {
                        showAlertDialog(t("error.enterGrade"));
                        return;
                    }
                } else {
                    // For pending grades, set value to null
                    gradeValue = null;
                }

                // Check if subject is selected
                if (!activeSubjectId) {
                    showAlertDialog(t("grade.mustSelectSubject"));
                    return;
                }

                // Get selected date and convert to timestamp
                const selectedDate = formData.get("gradeDate");
                let gradeTimestamp = null;
                if (selectedDate) {
                    // Parse the date string (YYYY-MM-DD) and set time to noon to avoid timezone issues
                    const dateParts = selectedDate.split('-');
                    const dateObj = new Date(dateParts[0], dateParts[1] - 1, dateParts[2], 12, 0, 0);
                    gradeTimestamp = dateObj.getTime();
                }

                // Add grade to all selected students
                selectedStudentIds.forEach(studentId => {
                    const newGrade = addGrade(studentId, formData.get("categoryId"), gradeValue, formData.get("name"), activeSubjectId, gradeTimestamp, isPending);

                    if (newGrade && enteredAsPercent) {
                        newGrade.enteredAsPercent = true;
                        newGrade.percentValue = percentValue;
                    }
                });

                saveData(t("toast.gradeAddedToMultiple").replace("{count}", selectedStudentIds.length), "success");
                renderStudents();
            });

            // Set up tab switching after dialog is shown
            setTimeout(() => {
                const tabGradeDirect = document.getElementById("tab-grade-direct");
                const tabGradePercent = document.getElementById("tab-grade-percent");
                const panelGradeDirect = document.getElementById("panel-grade-direct");
                const panelGradePercent = document.getElementById("panel-grade-percent");

                if (tabGradeDirect && tabGradePercent && panelGradeDirect && panelGradePercent) {
                    tabGradeDirect.addEventListener("click", () => {
                        tabGradeDirect.setAttribute("aria-selected", "true");
                        tabGradePercent.setAttribute("aria-selected", "false");
                        panelGradeDirect.removeAttribute("hidden");
                        panelGradePercent.setAttribute("hidden", "");
                    });

                    tabGradePercent.addEventListener("click", () => {
                        tabGradePercent.setAttribute("aria-selected", "true");
                        tabGradeDirect.setAttribute("aria-selected", "false");
                        panelGradePercent.removeAttribute("hidden");
                        panelGradeDirect.setAttribute("hidden", "");
                    });

                    // Percentage preview
                    const percentInput = document.getElementById("grade-percent-input");
                    const percentPreview = document.getElementById("percent-preview");
                    if (percentInput && percentPreview) {
                        percentInput.addEventListener("input", () => {
                            const val = parseFloat(percentInput.value);
                            if (!isNaN(val) && val >= 0 && val <= 100) {
                                const grade = percentToGrade(val);
                                if (grade !== null) {
                                    percentPreview.textContent = t("grade.percentPreview").replace("{grade}", grade.toFixed(1));
                                }
                            } else {
                                percentPreview.textContent = "";
                            }
                        });
                    }
                }

                // Grade name dropdown
                const dropdownBtn = document.getElementById("grade-name-dropdown-btn");
                const dropdown = document.getElementById("grade-name-dropdown");
                const nameInput = document.querySelector('input[name="name"]');

                if (dropdownBtn && dropdown && nameInput) {
                    dropdownBtn.addEventListener("click", () => {
                        dropdown.classList.toggle("hidden");
                    });

                    document.querySelectorAll(".grade-name-option").forEach(option => {
                        option.addEventListener("click", () => {
                            nameInput.value = option.dataset.name;
                            dropdown.classList.add("hidden");
                        });
                    });
                }

                // Add dynamic input switching based on category selection
                const categorySelect = document.getElementById("grade-category-select");
                const valueContainer = document.getElementById("grade-value-container");

                if (categorySelect && valueContainer) {
                    const updateGradeInput = () => {
                        const selectedOption = categorySelect.options[categorySelect.selectedIndex];
                        const allowPlusMinus = selectedOption.dataset.allowPlusMinus === "true";
                        const onlyPlusMinus = selectedOption.dataset.onlyPlusMinus === "true";

                        if (onlyPlusMinus) {
                            valueContainer.innerHTML = `
                                <label class="block mb-2">${t("grade.gradeTab")}</label>
                                <select name="value" class="select w-full" required>
                                    <option value="">${t("grade.select")}</option>
                                    <option value="+">${t("grade.plus")}</option>
                                    <option value="~">${t("grade.neutral")}</option>
                                    <option value="-">${t("grade.minus")}</option>
                                </select>
                                <p class="text-gray-400 text-sm">${t("grade.plusMinusOnlyHint")}</p>
                            `;
                        } else if (allowPlusMinus) {
                            valueContainer.innerHTML = `
                                <label class="block mb-2">${t("grade.gradeTab")}</label>
                                <select name="value" class="select w-full" required>
                                    <option value="">${t("grade.selectGradeType")}</option>
                                    <option value="1">1</option>
                                    <option value="2">2</option>
                                    <option value="3">3</option>
                                    <option value="4">4</option>
                                    <option value="5">5</option>
                                    <option value="6">6</option>
                                    <option value="+">${t("grade.plus")}</option>
                                    <option value="~">${t("grade.neutral")}</option>
                                    <option value="-">${t("grade.minus")}</option>
                                </select>
                                <p class="text-gray-400 text-sm">${t("grade.mixedHint")}</p>
                            `;
                        }
                    };

                    categorySelect.addEventListener("change", updateGradeInput);
                }

                // Add event listener for pending grade checkbox (bulk)
                const pendingCheckboxBulk = document.getElementById("grade-is-pending-bulk");
                const gradeValueContainerBulk = document.getElementById("grade-value-container");

                if (pendingCheckboxBulk && gradeValueContainerBulk) {
                    const toggleGradeInputsBulk = () => {
                        const isPending = pendingCheckboxBulk.checked;
                        gradeValueContainerBulk.style.opacity = isPending ? "0.5" : "1";
                        gradeValueContainerBulk.style.pointerEvents = isPending ? "none" : "auto";

                        // Disable/enable all inputs in the container
                        gradeValueContainerBulk.querySelectorAll("input, select, button").forEach(el => {
                            el.disabled = isPending;
                        });
                    };

                    pendingCheckboxBulk.addEventListener("change", toggleGradeInputsBulk);
                }
            }, 100);
        });
    }

    // Bulk delete button
    const bulkDeleteBtn = document.getElementById("bulk-delete-btn");
    if (bulkDeleteBtn) {
        // Remove old listener if exists
        const newBtn = bulkDeleteBtn.cloneNode(true);
        bulkDeleteBtn.parentNode.replaceChild(newBtn, bulkDeleteBtn);

        newBtn.addEventListener("click", () => {
            const selectedStudentIds = Array.from(document.querySelectorAll(".student-checkbox:checked"))
                .map(cb => cb.dataset.studentId);

            if (selectedStudentIds.length === 0) return;

            const confirmMessage = t("confirm.deleteStudents").replace("{count}", selectedStudentIds.length);
            showConfirmDialog(confirmMessage, () => {
                const currentYear = getCurrentYear();
                if (!currentYear) return;

                // Delete all selected students
                currentYear.students = currentYear.students.filter(
                    student => !selectedStudentIds.includes(student.id)
                );

                saveData(t("toast.studentsDeleted").replace("{count}", selectedStudentIds.length), "success");
                renderStudents();
            });
        });
    }

    // Initialize toolbar state
    updateBulkActionsToolbar();

};

/**
 * RENDER CLASS STATS
 *
 * Displays statistics for the current class at the top of the class view.
 * Shows: Class average, student count, total grades, pass rate.
 */
const renderClassStats = () => {
    const currentYear = getCurrentYear();
    if (!currentYear) return;

    const studentCount = currentYear.students.length;

    let totalGrades = 0;
    let passCount = 0;
    let studentWithGradesCount = 0;
    const classAverages = [];

    currentYear.students.forEach(student => {
        // Noten nach aktivem Fach filtern
        const filteredGrades = filterGradesBySubject(student.grades, currentYear.currentSubjectId);
        const numericGrades = filteredGrades.filter(g => !g.isPlusMinus);
        totalGrades += numericGrades.length;

        const avg = calculateWeightedAverage(filteredGrades);
        if (avg > 0) {
            classAverages.push(avg);
            studentWithGradesCount++;
            
            // Check attendance for current subject - student fails if attendance is critical
            const attendanceStatus = getAttendanceStatus(student.id, currentYear.currentSubjectId);
            const finalGrade = attendanceStatus.status === 'critical' ? 5 : avg;
            
            if (finalGrade <= 4.5) passCount++;
        }
    });

    // Class average
    const classAverage = classAverages.length > 0
        ? (classAverages.reduce((a, b) => a + b, 0) / classAverages.length).toFixed(2)
        : "-";

    // Pass rate (students with grade 4 or better)
    const passRate = studentWithGradesCount > 0
        ? Math.round((passCount / studentWithGradesCount) * 100) + "%"
        : "-";

    document.getElementById("class-stat-average").textContent = classAverage;
    document.getElementById("class-stat-students").textContent = studentCount;
    document.getElementById("class-stat-grades").textContent = totalGrades;
    document.getElementById("class-stat-pass-rate").textContent = passRate;
};

const renderCategoryFilter = () => {
    // Kategorien sind jetzt global (gelten für alle Klassen)
    const filter = document.getElementById("filter-category");
    filter.innerHTML = `
        <option value="">${t("class.allCategories")}</option>
        ${appData.categories.map(cat => `
          <option value="${safeAttr(cat.id)}">${escapeHtml(cat.name)}</option>
        `).join("")}
      `;
};

const renderCategoryManagement = () => {
    // Kategorien sind jetzt global (gelten für alle Klassen)
    const categoryManagementList = document.getElementById("categories-list");
    categoryManagementList.innerHTML = appData.categories.map(cat => {
        const label = cat.onlyPlusMinus ? ` <span class="badge badge-primary">${t("category.plusMinusOnlyBadge")}</span>` : (cat.allowPlusMinus ? ` <span class="badge badge-primary">${t("category.plusMinusBadge")}</span>` : '');
        return `
        <div class="flex items-center justify-between p-2 border rounded">
            <div>
                <span>${escapeHtml(cat.name)} (${(cat.weight * 100).toFixed(0)}%)${label}</span>
            </div>
            <div role="group" class="button-group">
                <button class="btn-icon btn-small btn-secondary" data-edit-category="${safeAttr(cat.id)}" data-tooltip="${t("category.editTooltip")}" data-side="left">
                    <svg class="lucide lucide-edit" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.5 5.5l-4 4L17 11.5 21 7.5z" />
                    </svg>
                </button>
                <button class="btn-icon btn-small btn-destructive" data-delete-category="${safeAttr(cat.id)}" data-tooltip="${t("category.deleteTooltip")}" data-side="left">
                    <svg class="lucide lucide-trash-2" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 6h18" />
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                </button>
            </div>
        </div>
    `;
    }).join("");

    document.querySelectorAll("[data-edit-category]").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const categoryId = e.target.closest("[data-edit-category]").dataset.editCategory;
            const category = appData.categories.find(c => c.id === categoryId);
            if (category) {
                const content = `
                    <div class="grid gap-2">
                        <label class="block mb-2">${t("category.categoryName")}</label>
                        <input type="text" name="name" class="input w-full" value="${escapeHtml(category.name)}" required maxlength="100">
                        <p class="text-gray-400 text-sm">${t("category.editCategoryNameHint")}</p>
                    </div>
                    <div class="grid gap-2">
                        <label class="block mb-2">${t("category.weight")}</label>
                        <input type="number" name="weight" step="1" min="1" max="100" class="input w-full" value="${escapeHtml(category.weight * 100)}" required>
                        <p class="text-gray-400 text-sm">${t("category.editWeightHint")} (${t("category.inPercent")})</p>
                    </div>
                    <div class="grid gap-2">
                        <label class="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" name="onlyPlusMinus" class="checkbox" ${category.onlyPlusMinus ? 'checked' : ''}>
                            <span>${t("category.plusMinusOnly")}</span>
                        </label>
                        <p class="text-gray-400 text-sm">${t("category.editPlusMinusHint")}</p>
                    </div>
                `;
                showDialog("edit-dialog", t("category.editCategory"), content, (formData) => {
                    const newName = formData.get("name");
                    const newWeight = parseFloat(formData.get("weight")); // This will be the percentage value from the UI
                    const onlyPlusMinus = formData.get("onlyPlusMinus") === "on";

                    // Validate the weight (this will convert percentage to decimal)
                    const weightValidation = validateWeight(newWeight);
                    if (!weightValidation.isValid) {
                        showAlertDialog(weightValidation.error);
                        return;
                    }
                    
                    const decimalWeight = weightValidation.value; // This is the decimal value for internal use

                    // Update all existing grades that belong to this category (in ALL classes)
                    appData.classes.forEach(cls => {
                        (cls.years || []).forEach(year => {
                            (year.students || []).forEach(student => {
                                (student.grades || []).forEach(grade => {
                                    if (grade.categoryId === category.id) {
                                        grade.categoryName = newName;
                                        grade.weight = decimalWeight; // Use the decimal value internally
                                    }
                                });
                            });
                        });
                    });

                    // Update the category itself
                    category.name = newName;
                    category.weight = decimalWeight; // Use the decimal value internally
                    category.onlyPlusMinus = onlyPlusMinus;
                    category.allowPlusMinus = onlyPlusMinus || category.allowPlusMinus;

                    saveData(t("toast.categoryEdited"), "success");
                    renderCategoryFilter();
                    renderStudents();
                    renderCategoryManagement();
                });
            }
        });
    });

    document.querySelectorAll("[data-delete-category]").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const categoryId = e.target.closest("[data-delete-category]").dataset.deleteCategory;
            showConfirmDialog(t("confirm.deleteCategory"), () => {
                deleteItem("category", categoryId);
                saveData(t("toast.categoryDeleted"), "success");
                renderCategoryManagement();
            });
        });
    });
};

/**
 * FARB-KLASSE FÜR NOTE ERMITTELN
 *
 * Gibt eine CSS-Klasse zurück, die der Leistung entspricht.
 * Bessere Noten sind neutraler, schlechtere Noten sind rötlicher.
 *
 * @param {Object} grade - Das Noten-Objekt
 * @returns {string} - CSS-Klassen für die Farbgebung
 */
/**
 * Formatiert einen Notenwert für die Anzeige.
 * Bei Grundschule: "1 – Sehr gut", bei weiterführenden Schulen: "1"
 */
const formatGradeDisplay = (value) => {
    if (appData.schoolType === 'primary') {
        const labels = { 1: 'Sehr gut', 2: 'Gut', 3: 'Befriedigend', 4: 'Gen\u00fcgend', 5: 'Nicht gen\u00fcgend' };
        const num = Math.round(parseFloat(value));
        return labels[num] ? `${num} \u2013 ${labels[num]}` : String(value);
    }
    return String(value);
};

const getGradeColorClass = (grade) => {
    // Plus/Minus Noten
    if (grade.isPlusMinus) {
        if (grade.value === '+') {
            return 'grade-badge grade-plus';
        } else if (grade.value === '~') {
            return 'grade-badge grade-neutral';
        } else {
            return 'grade-badge grade-minus';
        }
    }

    // Numerische Noten nach Wert färben
    const value = parseFloat(grade.value);
    if (isNaN(value)) return 'badge-secondary';

    if (value <= 1.5) {
        // Note 1 - Sehr Gut
        return 'grade-badge grade-1';
    } else if (value <= 2.5) {
        // Note 2 - Gut
        return 'grade-badge grade-2';
    } else if (value <= 3.5) {
        // Note 3 - Befriedigend
        return 'grade-badge grade-3';
    } else if (value <= 4.5) {
        // Note 4 - Genügend
        return 'grade-badge grade-4';
    } else {
        // Note 5 - Nicht Genügend
        return 'grade-badge grade-5';
    }
};

/**
 * EINFACHER DURCHSCHNITT BERECHNEN (ohne Gewichtung)
 *
 * Berechnet den arithmetischen Mittelwert aller numerischen Noten.
 * Plus/Minus-Noten werden ignoriert.
 *
 * Formel: (Note1 + Note2 + Note3 + ...) / Anzahl der Noten
 *
 * Beispiel:
 *   Noten: 1, 2, 3, 4
 *   Durchschnitt = (1 + 2 + 3 + 4) / 4 = 2.5
 *
 * @param {Array} grades - Array mit Noten-Objekten
 * @returns {number} - Durchschnitt oder 0 wenn keine Noten vorhanden
 */
const calculateSimpleAverage = (grades) => {
    // Nur numerische Noten verwenden (keine +/- Noten)
    const numericGrades = grades.filter(g => !g.isPlusMinus && !g.excludeFromAverage);

    // Wenn keine Noten vorhanden, 0 zurückgeben
    if (numericGrades.length === 0) return 0;

    // Summe aller Notenwerte berechnen
    // reduce() akkumuliert alle Werte zu einer Summe
    // acc = Akkumulator (Zwischenergebnis), grade = aktuelles Element
    const sum = numericGrades.reduce((acc, grade) => acc + grade.value, 0);

    // Durchschnitt = Summe / Anzahl
    return sum / numericGrades.length;
};

/**
 * GEWICHTETER DURCHSCHNITT BERECHNEN
 *
 * Dies ist die KERNFUNKTION für die Notenberechnung.
 * Sie berücksichtigt die Gewichtung jeder Kategorie.
 *
 * BERECHNUNG IN 2 SCHRITTEN (österreichisches System):
 * 1. Erst Durchschnitt PRO KATEGORIE berechnen
 * 2. Dann Kategorie-Durchschnitte mit Kategorie-Gewichten kombinieren
 *
 * FORMEL:
 *   Durchschnitt = Σ(Kategorie-Durchschnitt × Kategorie-Gewicht) / Σ(Kategorie-Gewicht)
 *
 * Beispiel:
 *   Schularbeit (Gewicht 0.5): Noten 2, 3, 1 → Durchschnitt 2.0
 *   Test (Gewicht 0.3): Note 4 → Durchschnitt 4.0
 *
 *   Gewichteter Durchschnitt = (2.0×0.5 + 4.0×0.3) / (0.5 + 0.3)
 *                            = (1.0 + 1.2) / 0.8
 *                            = 2.75
 *
 * PLUS/MINUS-NOTEN:
 * Werden pro Kategorie gesammelt und in eine Note umgewandelt.
 * Beispiel: 3 Plus und 1 Minus bei Startnote 3 und Wert 0.5:
 *   Note = 3 - (3 × 0.5) + (1 × 0.5) = 3 - 1.5 + 0.5 = 2.0
 *
 * @param {Array} grades - Array mit Noten-Objekten
 * @returns {number} - Gewichteter Durchschnitt (1-5) oder 0
 */
const calculateWeightedAverage = (grades) => {
    // Prozentwerte für Plus/Minus/Neutral laden
    const plusMinusPercentages = appData.plusMinusPercentages || {
        plus: 100,
        neutral: 50,
        minus: 0
    };

    // SCHRITT 1: Noten nach Kategorie gruppieren
    const gradesByCategory = {};

    grades.forEach(grade => {
        // Noten, die nicht in die Gesamtnote eingerechnet werden sollen, überspringen
        if (grade.excludeFromAverage) return;

        // Ausstehende Noten (isPending) überspringen
        if (grade.isPending) return;

        const catId = grade.categoryId;
        if (!gradesByCategory[catId]) {
            gradesByCategory[catId] = {
                weight: grade.weight,
                numericGrades: [],
                plusCount: 0,
                neutralCount: 0,
                minusCount: 0
            };
        }

        if (grade.isPlusMinus) {
            if (grade.value === "+") {
                gradesByCategory[catId].plusCount++;
            } else if (grade.value === "~") {
                gradesByCategory[catId].neutralCount++;
            } else if (grade.value === "-") {
                gradesByCategory[catId].minusCount++;
            }
        } else {
            gradesByCategory[catId].numericGrades.push(grade.value);
        }
    });

    // SCHRITT 2: Durchschnitt pro Kategorie berechnen
    let weightedSum = 0;
    let totalWeight = 0;

    Object.values(gradesByCategory).forEach(category => {
        let categoryAverage = null;

        // Numerische Noten: einfacher Durchschnitt
        if (category.numericGrades.length > 0) {
            const sum = category.numericGrades.reduce((a, b) => a + b, 0);
            categoryAverage = sum / category.numericGrades.length;
        }

        // Plus/Minus/Neutral Noten
        const totalPlusMinusGrades = category.plusCount + category.neutralCount + category.minusCount;
        if (totalPlusMinusGrades > 0) {
            // Prozentbasierte Berechnung für +/~/- Noten (immer, auch bei gemischten Kategorien)
            const totalPoints = (category.plusCount * plusMinusPercentages.plus) +
                               (category.neutralCount * plusMinusPercentages.neutral) +
                               (category.minusCount * plusMinusPercentages.minus);
            const percentage = totalPoints / totalPlusMinusGrades;

            // Prozent in Note umwandeln (verwendet gradePercentageRanges)
            let pmGrade = percentToGrade(percentage);
            if (pmGrade === null) pmGrade = 3; // Fallback

            if (category.numericGrades.length === 0) {
                // Nur +/~/- Noten: verwende die berechnete Note direkt
                categoryAverage = pmGrade;
            } else {
                // Gemischte Kategorie: +/- zählt als eine zusätzliche "Note"
                const totalGrades = category.numericGrades.length + 1;
                categoryAverage = (categoryAverage * category.numericGrades.length + pmGrade) / totalGrades;
            }
        }

        // Kategorie zum gewichteten Durchschnitt hinzufügen
        if (categoryAverage !== null) {
            weightedSum += categoryAverage * category.weight;
            totalWeight += category.weight;
        }
    });

    // SCHRITT 3: Gewichteten Gesamtdurchschnitt berechnen
    if (totalWeight === 0) return 0;

    let average = weightedSum / totalWeight;
    return Math.max(1, Math.min(5, average));
};

/**
 * ENDNOTE BERECHNEN (Österreichisches Notensystem)
 *
 * Wandelt einen Durchschnittswert in eine Schulnote um.
 *
 * ÖSTERREICHISCHES NOTENSYSTEM:
 *   1 = Sehr Gut      (Durchschnitt 1.0 - 1.5)
 *   2 = Gut           (Durchschnitt 1.51 - 2.5)
 *   3 = Befriedigend  (Durchschnitt 2.51 - 3.5)
 *   4 = Genügend      (Durchschnitt 3.51 - 4.5)
 *   5 = Nicht Genügend (Durchschnitt über 4.5)
 *
 * Die Grenzen sind so gewählt, dass bei x.5 auf die bessere Note
 * gerundet wird (z.B. 2.5 → Note 2).
 *
 * @param {number} average - Der berechnete Durchschnitt
 * @returns {string} - Die Endnote als String ("1" bis "5" oder "-")
 */
const calculateFinalGrade = (average) => {
    // Wenn kein Durchschnitt berechenbar, "-" anzeigen
    if (average === 0) return "-";

    // Notenberechnung nach österreichischem System
    // Die if-Abfragen werden von oben nach unten durchlaufen
    // Das erste zutreffende if liefert die Note
    if (average <= 1.5) return "1";  // Sehr Gut
    if (average <= 2.5) return "2";  // Gut
    if (average <= 3.5) return "3";  // Befriedigend
    if (average <= 4.5) return "4";  // Genügend
    return "5";                       // Nicht Genügend
};

/**
 * HOME-ANSICHT RENDERN (Dashboard mit Statistiken)
 *
 * Zeigt eine Übersicht mit:
 * - Gesamtzahl der Klassen
 * - Gesamtzahl der Schüler
 * - Durchschnitt aller Schüler
 * - Gesamtzahl der Noten
 * - Klassenübersicht mit Durchschnitten
 *
 * Die Statistiken werden live aus den Daten berechnet.
 */
const renderHome = () => {
    // STATISTIKEN BERECHNEN

    // Anzahl der Klassen (direkt aus Array-Länge)
    const totalClasses = appData.classes.length;

    // Diese Werte werden durch Iteration berechnet
    let totalStudents = 0;      // Gesamtzahl aller Schüler
    let totalGrades = 0;        // Gesamtzahl aller Noten
    let allAverages = [];       // Array mit allen Schüler-Durchschnitten

    // Durch alle Klassen iterieren
    appData.classes.forEach(cls => {
        // Durch alle Jahre der Klasse iterieren
        if (cls.years) {
            cls.years.forEach(year => {
                // Schüleranzahl addieren
                if (year.students) {
                    totalStudents += year.students.length;

                    // Durch alle Schüler des Jahres iterieren
                    year.students.forEach(student => {
                        // Nur numerische Noten zählen (keine +/-)
                        const numericGrades = student.grades.filter(g => !g.isPlusMinus);
                        totalGrades += numericGrades.length;

                        // Wenn der Schüler Noten hat, Durchschnitt berechnen
                        // some() prüft ob mindestens ein Element die Bedingung erfüllt
                        if (numericGrades.length > 0 || student.grades.some(g => g.isPlusMinus)) {
                            const avg = calculateWeightedAverage(student.grades);
                            // Nur gültige Durchschnitte (> 0) speichern
                            if (avg > 0) allAverages.push(avg);
                        }
                    });
                }
            });
        }
    });

    // GESAMTDURCHSCHNITT BERECHNEN
    // Durchschnitt aller Schüler-Durchschnitte
    const overallAverage = allAverages.length > 0
        // Summe aller Durchschnitte / Anzahl der Durchschnitte
        // toFixed(2) formatiert auf 2 Nachkommastellen
        ? (allAverages.reduce((a, b) => a + b, 0) / allAverages.length).toFixed(2)
        : "-"; // Wenn keine Durchschnitte vorhanden, "-" anzeigen

    // Update stats
    document.getElementById("stat-total-classes").textContent = totalClasses;
    document.getElementById("stat-total-students").textContent = totalStudents;
    document.getElementById("stat-overall-average").textContent = overallAverage;
    document.getElementById("stat-total-grades").textContent = totalGrades;

    // Render class overview
    const overviewList = document.getElementById("class-overview-list");
    if (appData.classes.length === 0) {
        const icon = `<svg class="lucide lucide-users-round-icon lucide-users-round" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 21a8 8 0 0 0-16 0" />
            <circle cx="10" cy="8" r="5" />
            <path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3" />
        </svg>`;

        const title = t('emptyState.noClasses') || 'Keine Klassen';
        const description = t('emptyState.noClassesDesc') || 'Sie haben noch keine Klassen erstellt. Klicken Sie auf "Klasse hinzufügen" in der Seitenleiste um zu beginnen.';

        const buttons = [{
            text: t('nav.addClass') || 'Klasse hinzufügen',
            class: 'btn-primary',
            onclick: 'document.getElementById(\'add-class\').click()'
        }];

        overviewList.innerHTML = createEmptyState(icon, title, description, buttons);
        return;
    }

    const isMobile = window.matchMedia('(max-width: 768px)').matches;

    overviewList.innerHTML = appData.classes.map(cls => {
        let studentCount = 0;
        let classAverage = "-";
        const classAverages = [];

        if (cls.years) {
            cls.years.forEach(year => {
                if (year.students) {
                    studentCount += year.students.length;
                    year.students.forEach(student => {
                        const avg = calculateWeightedAverage(student.grades);
                        if (avg > 0) classAverages.push(avg);
                    });
                }
            });
        }
        if (classAverages.length > 0) {
            classAverage = (classAverages.reduce((a, b) => a + b, 0) / classAverages.length).toFixed(2);
        }

        const card = `
            <div class="flex items-center justify-between p-3 border rounded cursor-pointer" data-goto-class="${safeAttr(cls.id)}">
                <div>
                    <h3 class="font-semibold">${escapeHtml(cls.name)}</h3>
                    <p class="text-gray-400 text-sm">${t("home.studentCount", { count: studentCount })}</p>
                </div>
                <div class="flex items-center gap-3">
                    <div class="text-right">
                        <p class="text-lg font-bold">${escapeHtml(classAverage)}</p>
                        <p class="text-gray-400 text-sm">${t("home.average")}</p>
                    </div>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="class-card-chevron lucide lucide-chevron-right-icon lucide-chevron-right"><polyline points="9 18 15 12 9 6"/></svg>
                </div>
            </div>`;

        if (isMobile) {
            return swipeRowHtml({
                contentHtml: card,
                leftAction:  { label: t('class.editClass') || 'Bearbeiten', iconSvg: SWIPE_ICONS.edit,  attr: `data-edit-class="${safeAttr(cls.id)}"` },
                rightAction: { label: t('class.deleteClass') || 'Löschen',  iconSvg: SWIPE_ICONS.trash, attr: `data-delete-class="${safeAttr(cls.id)}"` }
            });
        }
        return card;
    }).join("");

    // Click → open class
    overviewList.querySelectorAll("[data-goto-class]").forEach(el => {
        el.addEventListener("click", () => {
            closeAllSwipes();
            const classId = el.dataset.gotoClass;
            appData.currentClassId = classId;
            saveData();
            showClassView();
        });
    });

    if (isMobile) {
        // Edit/Delete side actions
        overviewList.querySelectorAll("[data-edit-class]").forEach(btn => {
            btn.addEventListener("click", (e) => { e.stopPropagation(); closeAllSwipes(); _promptEditClass(btn.dataset.editClass); });
        });
        overviewList.querySelectorAll("[data-delete-class]").forEach(btn => {
            btn.addEventListener("click", (e) => { e.stopPropagation(); _promptDeleteClass(btn.dataset.deleteClass); });
        });
        // Wire swipe
        overviewList.querySelectorAll('.swipe-row').forEach(attachSwipe);
        playSwipeHint(overviewList, 'homeOverview');
    }
    _initHomeSearch();
};

// Reload all settings form inputs from appData (restores saved values)
const reloadSettingsFormValues = () => {
    const pm = appData.plusMinusPercentages || { plus: 100, neutral: 50, minus: 0 };
    const plusEl = document.getElementById("plusminus-plus-percent");
    const neutralEl = document.getElementById("plusminus-neutral-percent");
    const minusEl = document.getElementById("plusminus-minus-percent");
    if (plusEl) plusEl.value = pm.plus;
    if (neutralEl) neutralEl.value = pm.neutral;
    if (minusEl) minusEl.value = pm.minus;

    const att = appData.attendanceSettings || { enabled: false, minAttendancePercent: 75, warningThreshold: 5 };
    const enabledEl = document.getElementById("attendance-auto-grading");
    const minPctEl = document.getElementById("attendance-min-percent");
    const warnEl = document.getElementById("attendance-warning-threshold");
    if (enabledEl) enabledEl.checked = att.enabled;
    if (minPctEl) minPctEl.value = att.minAttendancePercent;
    if (warnEl) warnEl.value = att.warningThreshold;

    const defaultRanges = [
        { grade: 1, minPercent: 85, maxPercent: 100 },
        { grade: 2, minPercent: 70, maxPercent: 84 },
        { grade: 3, minPercent: 55, maxPercent: 69 },
        { grade: 4, minPercent: 40, maxPercent: 54 },
        { grade: 5, minPercent: 0, maxPercent: 39 }
    ];
    (appData.gradePercentageRanges || defaultRanges).forEach(range => {
        const minEl = document.getElementById(`grade-${range.grade}-min`);
        const maxEl = document.getElementById(`grade-${range.grade}-max`);
        if (minEl) minEl.value = range.minPercent;
        if (maxEl) maxEl.value = range.maxPercent;
    });
};

// Settings dirty-check helper: shows confirm dialog if there are unsaved changes
const checkSettingsDirtyThenRun = (callback) => {
    if (window.settingsDirty) {
        showConfirmDialog(
            t('dialog.unsavedMessage'),
            () => {
                window.settingsDirty = false;
                reloadSettingsFormValues();
                callback();
            },
            null, null,
            { confirmText: t('dialog.unsavedDiscard'), cancelText: t('dialog.unsavedBack') }
        );
    } else {
        callback();
    }
};

// Show Home View
const showHomeView = () => {
    const homeView = document.getElementById("home-view");
    const classView = document.getElementById("class-view");
    const studentDetailView = document.getElementById("student-detail-view");
    const settingsView = document.getElementById("settings-view");

    // Guard: if settings view is visible with unsaved changes, confirm first
    if (settingsView && !settingsView.classList.contains("hidden") && window.settingsDirty) {
        showConfirmDialog(
            t('dialog.unsavedMessage'),
            () => { window.settingsDirty = false; showHomeView(); },
            null, null,
            { confirmText: t('dialog.unsavedDiscard'), cancelText: t('dialog.unsavedBack') }
        );
        return;
    }

    // Destroy chart instance if exists
    if (window.studentGradeChartInstance) {
        window.studentGradeChartInstance.destroy();
        window.studentGradeChartInstance = null;
    }

    // Find which view is currently visible
    let viewToHide = null;
    const attendanceView = document.getElementById("attendance-view");
    if (!classView.classList.contains("hidden")) {
        viewToHide = classView;
    } else if (studentDetailView && !studentDetailView.classList.contains("hidden")) {
        viewToHide = studentDetailView;
    } else if (settingsView && !settingsView.classList.contains("hidden")) {
        viewToHide = settingsView;
    } else if (attendanceView && !attendanceView.classList.contains("hidden")) {
        viewToHide = attendanceView;
    }

    // Animation triggern
    if (viewToHide) {
        // View ausblenden mit Animation
        viewToHide.style.animation = 'viewFadeOut 0.15s ease-in forwards';
        setTimeout(() => {
            viewToHide.classList.add("hidden");
            viewToHide.style.animation = '';

            // Home View einblenden
            homeView.classList.remove("hidden");
            homeView.style.animation = 'none';
            homeView.offsetHeight; // Force reflow
            homeView.style.animation = 'viewFadeIn 0.25s ease-out';

            renderHome();
        }, 150);
    } else {
        homeView.classList.remove("hidden");
        renderHome();
    }

    document.getElementById("nav-home").classList.add("btn-primary");
    document.getElementById("nav-home").classList.remove("btn-secondary");

    const navSettings = document.getElementById("nav-settings");
    if (navSettings) {
        navSettings.classList.remove("btn-primary");
        navSettings.classList.remove("btn-outline");
    }

    // Reset class buttons in sidebar to inactive
    document.querySelectorAll("[data-class-id]").forEach(btn => {
        btn.classList.remove("btn-primary");
        btn.classList.add("btn-secondary");
    });

    // Restore greeting to "Hello, Name!"
    setGreetingContext(null);
};

// Show Class View
/**
 * Blendet alle Anwesenheits-bezogenen UI-Elemente aus, wenn die aktuelle Klasse
 * die Anwesenheitsfunktion deaktiviert hat. Wird bei Klassenwechsel/Edit aufgerufen.
 */
const applyAttendanceVisibility = () => {
    const cls = appData.classes.find(c => c.id === appData.currentClassId);
    const enabled = !cls || cls.attendanceEnabled !== false;

    const addBtn = document.getElementById("add-attendance-btn");
    if (addBtn) addBtn.classList.toggle("hidden", !enabled);

    const filter = document.getElementById("filter-attendance");
    if (filter) {
        filter.classList.toggle("hidden", !enabled);
        if (!enabled) filter.value = "";
    }

    // Wenn gerade die Attendance-View sichtbar ist aber Funktion deaktiviert: zur Klassen-Ansicht zurück
    const attView = document.getElementById("attendance-view");
    if (!enabled && attView && !attView.classList.contains("hidden")) {
        showClassView();
    }
};

const showClassView = () => {
    const homeView = document.getElementById("home-view");
    const classView = document.getElementById("class-view");
    const studentDetailView = document.getElementById("student-detail-view");
    const settingsView = document.getElementById("settings-view");

    // Guard: if settings view is visible with unsaved changes, confirm first
    if (settingsView && !settingsView.classList.contains("hidden") && window.settingsDirty) {
        showConfirmDialog(
            t('dialog.unsavedMessage'),
            () => { window.settingsDirty = false; showClassView(); },
            null, null,
            { confirmText: t('dialog.unsavedDiscard'), cancelText: t('dialog.unsavedBack') }
        );
        return;
    }

    // Destroy chart instance if exists
    if (window.studentGradeChartInstance) {
        window.studentGradeChartInstance.destroy();
        window.studentGradeChartInstance = null;
    }

    // Find which view is currently visible
    let viewToHide = null;
    if (!homeView.classList.contains("hidden")) {
        viewToHide = homeView;
    } else if (studentDetailView && !studentDetailView.classList.contains("hidden")) {
        viewToHide = studentDetailView;
    } else if (settingsView && !settingsView.classList.contains("hidden")) {
        viewToHide = settingsView;
    } else if (document.getElementById("attendance-view") && !document.getElementById("attendance-view").classList.contains("hidden")) {
        viewToHide = document.getElementById("attendance-view");
    }

    // Animation triggern
    if (viewToHide) {
        // View ausblenden mit Animation
        viewToHide.style.animation = 'viewFadeOut 0.15s ease-in forwards';
        setTimeout(() => {
            viewToHide.classList.add("hidden");
            viewToHide.style.animation = '';

            // Class View einblenden
            classView.classList.remove("hidden");
            classView.style.animation = 'none';
            classView.offsetHeight; // Force reflow
            classView.style.animation = 'viewFadeIn 0.25s ease-out';

            const currentClass = appData.classes.find(c => c.id === appData.currentClassId);
            if (currentClass) {
                document.getElementById("current-class-name").textContent = currentClass.name;
                // Update breadcrumb
                document.getElementById("breadcrumb-class-name").textContent = currentClass.name;
            }

            // Breadcrumb home click handler
            document.getElementById("breadcrumb-home").onclick = (e) => {
                e.preventDefault();
                showHomeView();
            };

            autoSelectSemester(getCurrentYear());
            renderClassList();
            renderYearSelector();
            renderSemesterSelector();
            renderSubjectTabs();
            renderClassStats();
            renderStudents();
            renderCategoryFilter();
            applyAttendanceVisibility();
            const _cy1 = getCurrentYear();
            if (_cy1 && !_cy1.startDate && !_promptedYearIds.has(_cy1.id)) {
                _promptedYearIds.add(_cy1.id);
                showSetYearDatesDialog(appData.currentClassId, _cy1);
            }
        }, 150);
    } else {
        classView.classList.remove("hidden");

        const currentClass = appData.classes.find(c => c.id === appData.currentClassId);
        if (currentClass) {
            document.getElementById("current-class-name").textContent = currentClass.name;
            // Update breadcrumb
            document.getElementById("breadcrumb-class-name").textContent = currentClass.name;
        }

        // Breadcrumb home click handler
        document.getElementById("breadcrumb-home").onclick = (e) => {
            e.preventDefault();
            showHomeView();
        };

        autoSelectSemester(getCurrentYear());
        renderClassList();
        renderYearSelector();
        renderSemesterSelector();
        renderSubjectTabs();
        renderClassStats();
        renderStudents();
        renderCategoryFilter();
        const _cy2 = getCurrentYear();
        if (_cy2 && !_cy2.startDate && !_promptedYearIds.has(_cy2.id)) {
            _promptedYearIds.add(_cy2.id);
            showSetYearDatesDialog(appData.currentClassId, _cy2);
        }
    }

    document.getElementById("nav-home").classList.remove("btn-primary");
    document.getElementById("nav-home").classList.add("btn-secondary");

    const navSettings = document.getElementById("nav-settings");
    if (navSettings) {
        navSettings.classList.remove("btn-primary");
        navSettings.classList.remove("btn-outline");
    }

    // Update header to show current class name
    const _currentClass = appData.classes.find(c => c.id === appData.currentClassId);
    setGreetingContext(_currentClass ? _currentClass.name : null);

    // Add contextual tooltip to add-student button
    const addStudentBtn = document.getElementById("add-student");
    if (addStudentBtn) {
        const currentClass = getCurrentClass();
        const currentYear = getCurrentYear();
        if (currentClass && currentYear) {
            addStudentBtn.dataset.tooltip = t("tooltip.addStudentTo", { class: currentClass.name, year: currentYear.name });
        }
    }
};

// ========== STUDENT DETAIL VIEW FUNCTIONS ==========

// Store the Chart.js instance for cleanup (global so PDF export can access it)
window.window.studentGradeChartInstance = null;
window.detailSemesterFilter = null; // null = all year, "WS" or "SS" = specific semester

// ========== QUICK STUDENT SIDEBAR ==========

window.qsbChartInstance = null;
let _qsbCurrentStudentId = null;
let _qsbSemesterFilter = null; // null = all year, "WS" or "SS"

const _closeStudentQuickSidebar = () => {
    const sidebar = document.getElementById("student-quick-sidebar");
    if (!sidebar) return;
    sidebar.classList.remove("open");
    document.querySelector("main")?.classList.remove("qsb-open");
    if (window.qsbChartInstance) { window.qsbChartInstance.destroy(); window.qsbChartInstance = null; }
    setTimeout(() => { sidebar.style.display = "none"; }, 300);
    _qsbCurrentStudentId = null;
};

const _renderStudentQuickContent = (studentId) => {
    const currentYear = getCurrentYear();
    if (!currentYear) return;
    const student = currentYear.students.find(s => s.id === studentId);
    if (!student) return;

    const sid = currentYear.currentSubjectId;
    const currentSubjectName = currentYear.subjects?.find(s => s.id === sid)?.name || "";

    // All-year by default; _qsbSemesterFilter optionally limits to WS or SS
    const filteredGrades = sid
        ? student.grades.filter(g => {
            if (g.subjectId !== sid) return false;
            if (_qsbSemesterFilter && g.semester !== _qsbSemesterFilter) return false;
            return true;
        })
        : [];

    // Year overview
    const wsGrades = sid ? student.grades.filter(g => g.subjectId === sid && g.semester === "WS") : [];
    const ssGrades = sid ? student.grades.filter(g => g.subjectId === sid && g.semester === "SS") : [];
    const allGrades = sid ? student.grades.filter(g => g.subjectId === sid) : [];
    const wsAvg = calculateWeightedAverage(wsGrades);
    const ssAvg = calculateWeightedAverage(ssGrades);
    const allAvg = calculateWeightedAverage(allGrades);
    const wsFinal = wsAvg ? calculateFinalGrade(wsAvg) : "—";
    const ssFinal = ssAvg ? calculateFinalGrade(ssAvg) : "—";
    const yearFinal = allAvg ? calculateFinalGrade(allAvg) : "—";
    const gcls = (g) => (g && g !== "—" && g !== "-") ? `grade-badge grade-${g}` : '';

    // Stats
    const weightedAvg = calculateWeightedAverage(filteredGrades);
    const finalGrade = calculateFinalGrade(weightedAvg);
    const trend = calculateTrend(filteredGrades);
    const classAvg = calculateClassAverage(_qsbSemesterFilter);

    const trendHtml = trend.trend === 'improving'
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-green-500 lucide lucide-chevron-up-icon lucide-chevron-up" style="color:#22c55e"><path d="m18 15-6-6-6 6"/></svg>`
        : trend.trend === 'declining'
        ? `<svg class="lucide lucide-chevron-down-icon lucide-chevron-down" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:#ef4444"><path d="m6 9 6 6 6-6"/></svg>`
        : `<svg class="lucide lucide-minus-icon lucide-minus" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:#eab308"><path d="M5 12h14"/></svg>`;

    let comparisonHtml = "—";
    if (weightedAvg && classAvg) {
        const diff = classAvg - weightedAvg;
        comparisonHtml = Math.abs(diff) < 0.1
            ? `<span style="color:#eab308">=</span>`
            : diff > 0
            ? `<span style="color:#22c55e">+${diff.toFixed(1)}</span>`
            : `<span style="color:#ef4444">${diff.toFixed(1)}</span>`;
    }

    // Category breakdown (inline)
    const gradesByCat = {};
    filteredGrades.forEach(g => {
        if (!gradesByCat[g.categoryId]) gradesByCat[g.categoryId] = { name: g.categoryName, grades: [] };
        gradesByCat[g.categoryId].grades.push(g);
    });
    const catBreakdownHtml = Object.entries(gradesByCat).length === 0
        ? `<p style="opacity:0.45;font-size:0.85em;padding:0.5rem 0">${t("student.noGrades")}</p>`
        : Object.entries(gradesByCat).map(([, cat]) => {
            const numeric = cat.grades.filter(g => !g.isPlusMinus);
            const pm = cat.grades.filter(g => g.isPlusMinus);
            let avg = "—"; let pct = ""; let gClass = "";
            if (numeric.length > 0) {
                const a = numeric.reduce((s, g) => s + g.value, 0) / numeric.length;
                avg = a.toFixed(2);
                const p = Math.round(((6 - a) / 5) * 100);
                pct = p >= 80 ? `grade-1` : p >= 60 ? `grade-2` : p >= 40 ? `grade-3` : p >= 20 ? `grade-4` : `grade-5`;
                gClass = pct;
            } else if (pm.length > 0) {
                const plusC = pm.filter(g => g.value === '+').length;
                const minusC = pm.filter(g => g.value === '-').length;
                avg = plusC > minusC ? '+' : minusC > plusC ? '-' : '~';
                gClass = plusC > minusC ? 'grade-plus' : minusC > plusC ? 'grade-minus' : 'grade-neutral';
            }
            const pmInfo = pm.length > 0 ? ` · ${pm.filter(g=>g.value==='+').length}+ ${pm.filter(g=>g.value==='-').length}-` : "";
            return `<div style="display:flex;align-items:center;justify-content:space-between;padding:0.45rem 0;border-bottom:1px solid var(--border)">
                <span style="font-size:0.85em">${escapeHtml(cat.name)}<span style="opacity:0.4;font-size:0.8em">${pmInfo}</span></span>
                <span class="grade-badge ${gClass}" style="padding:0.1rem 0.5rem;border-radius:4px;font-weight:700;min-width:2rem;text-align:center">${avg}</span>
            </div>`;
        }).join("");

    // Grades list (newest first)
    const sortedGrades = [...filteredGrades].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const gradeListHtml = sortedGrades.length === 0
        ? `<p style="opacity:0.45;font-size:0.85em;padding:0.5rem 0">${t("student.noGrades")}</p>`
        : sortedGrades.map(g => {
            const val = g.isPlusMinus ? (g.value === '+' ? '+' : g.value === '-' ? '−' : '~') : g.value;
            const gNum = g.isPlusMinus ? (g.value === '+' ? 'plus' : g.value === '-' ? 'minus' : 'neutral') : g.value;
            const dateStr = g.createdAt ? new Date(g.createdAt).toLocaleDateString('de-AT', { day:'2-digit', month:'2-digit', year:'2-digit' }) : '';
            return `<div style="display:flex;align-items:center;gap:0.5rem;padding:0.4rem 0;border-bottom:1px solid var(--border)">
                <span class="grade-badge grade-${gNum}" style="padding:0.1rem 0.5rem;border-radius:4px;font-weight:700;min-width:2rem;text-align:center;flex-shrink:0">${val}</span>
                <span style="flex:1;font-size:0.85em">${escapeHtml(g.name || g.categoryName || '')}</span>
                <span style="font-size:0.75em;opacity:0.4">${dateStr}</span>
                <span style="font-size:0.75em;opacity:0.4">×${g.weight}</span>
            </div>`;
        }).join("");

    if (window.qsbChartInstance) { window.qsbChartInstance.destroy(); window.qsbChartInstance = null; }

    const _qsbMkSemBtn = (label, val) => {
        const active = _qsbSemesterFilter === val;
        return `<button class="${active ? 'btn-sm-primary' : 'btn-sm-outline'}" data-qsb-sem="${val ?? '__all__'}">${label}</button>`;
    };

    document.getElementById("qsb-content").innerHTML = `
        <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:1rem;flex-wrap:wrap">
            <button id="qsb-add-grade-btn" class="btn-primary" style="flex:1;font-size:0.85rem;padding:0.4rem 0.75rem;min-width:8rem">${lucideIcon('plus')} ${t("grade.addGrade")}</button>
            <div style="display:flex;gap:0.25rem;flex-shrink:0">
                ${_qsbMkSemBtn(t("semester.all") || "Gesamt", null)}
                ${_qsbMkSemBtn(t("semester.WS") || "WS", "WS")}
                ${_qsbMkSemBtn(t("semester.SS") || "SS", "SS")}
            </div>
        </div>

        <!-- Stat cards -->
        <div class="qsb-stat-grid">
            <div class="qsb-stat-card">
                <div class="qsb-stat-label">${t("student.average")}</div>
                <div class="qsb-stat-value">${weightedAvg ? weightedAvg.toFixed(2) : "—"}</div>
            </div>
            <div class="qsb-stat-card">
                <div class="qsb-stat-label">${t("table.semFinalGrade")}</div>
                <div class="qsb-stat-value ${gcls(finalGrade)}" style="padding:0.1rem 0.4rem;border-radius:4px;display:inline-block">${finalGrade}</div>
            </div>
            <div class="qsb-stat-card">
                <div class="qsb-stat-label">${t("table.gradeCount")}</div>
                <div class="qsb-stat-value">${filteredGrades.length}</div>
            </div>
            <div class="qsb-stat-card">
                <div class="qsb-stat-label">${t("student.trend")}</div>
                <div class="qsb-stat-value" style="font-size:1rem;display:flex;align-items:center;gap:0.3rem">${trendHtml} ${comparisonHtml}</div>
            </div>
        </div>

        <!-- Year overview -->
        <div class="qsb-section-title">${t("table.yearOverview")}</div>
        <div style="display:flex;align-items:center;gap:0.75rem;padding:0.6rem 0.75rem;background:var(--muted);border-radius:0.5rem;margin-bottom:0.25rem">
            <div style="display:flex;align-items:center;gap:0.3rem">
                <span style="opacity:0.5;font-size:0.8em">WS</span>
                <span class="${gcls(wsFinal)}" style="padding:0.2rem 0.6rem;border-radius:5px;font-weight:700;font-size:1.1rem">${wsFinal}</span>
            </div>
            <span style="opacity:0.25">·</span>
            <div style="display:flex;align-items:center;gap:0.3rem">
                <span style="opacity:0.5;font-size:0.8em">SS</span>
                <span class="${gcls(ssFinal)}" style="padding:0.2rem 0.6rem;border-radius:5px;font-weight:700;font-size:1.1rem">${ssFinal}</span>
            </div>
            <span style="opacity:0.25">·</span>
            <div style="display:flex;align-items:center;gap:0.3rem">
                <span style="opacity:0.5;font-size:0.8em">∑</span>
                <span class="${gcls(yearFinal)}" style="padding:0.2rem 0.6rem;border-radius:5px;font-weight:700;font-size:1.1rem">${yearFinal}</span>
            </div>
        </div>

        <!-- Chart -->
        <div class="qsb-section-title">${t("chart.grades") || "Verlauf"}</div>
        <div style="height:180px;margin-bottom:0.25rem;position:relative">
            <canvas id="qsb-grade-chart"></canvas>
        </div>

        <!-- Category breakdown -->
        <div class="qsb-section-title">${t("student.categoryBreakdown") || "Kategorien"}</div>
        <div style="margin-bottom:0.25rem">${catBreakdownHtml}</div>

        <!-- Grades list -->
        <div class="qsb-section-title">${_qsbSemesterFilter || (t("semester.all") || "Gesamt")}${currentSubjectName ? ` · ${escapeHtml(currentSubjectName)}` : ""}</div>
        <div>${gradeListHtml}</div>
    `;

    // Wire add-grade button
    document.getElementById("qsb-add-grade-btn")?.addEventListener("click", () => {
        openAddGradeDialog(studentId, () => _renderStudentQuickContent(studentId));
    });

    // Wire semester filter buttons
    document.querySelectorAll("[data-qsb-sem]").forEach(btn => {
        btn.addEventListener("click", () => {
            _qsbSemesterFilter = btn.dataset.qsbSem === '__all__' ? null : btn.dataset.qsbSem;
            _renderStudentQuickContent(studentId);
        });
    });

    // Render chart into qsb-grade-chart canvas
    _renderQsbChart(filteredGrades);
};

const _renderQsbChart = (grades) => {
    const canvas = document.getElementById("qsb-grade-chart");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const categoryColors = [
        { bg: 'rgba(59,130,246,0.2)', border: 'rgb(59,130,246)' },
        { bg: 'rgba(34,197,94,0.2)', border: 'rgb(34,197,94)' },
        { bg: 'rgba(249,115,22,0.2)', border: 'rgb(249,115,22)' },
        { bg: 'rgba(168,85,247,0.2)', border: 'rgb(168,85,247)' },
        { bg: 'rgba(236,72,153,0.2)', border: 'rgb(236,72,153)' },
        { bg: 'rgba(234,179,8,0.2)', border: 'rgb(234,179,8)' },
    ];

    const byCategory = {};
    grades.forEach(g => {
        const cat = g.categoryName || '?';
        if (!byCategory[cat]) byCategory[cat] = [];
        let y = g.isPlusMinus ? (g.value === '+' ? 1.5 : g.value === '-' ? 4.5 : 3) : g.value;
        byCategory[cat].push({ x: g.createdAt || Date.now(), y });
    });
    Object.values(byCategory).forEach(arr => arr.sort((a, b) => a.x - b.x));

    const datasets = Object.entries(byCategory).map(([name, data], i) => ({
        label: name, data,
        borderColor: categoryColors[i % categoryColors.length].border,
        backgroundColor: categoryColors[i % categoryColors.length].bg,
        borderWidth: 2, tension: 0.3, pointRadius: 4, fill: false
    }));

    if (datasets.length === 0) {
        ctx.font = '13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#6b7280';
        ctx.fillText(t("student.noGrades"), canvas.width / 2, canvas.height / 2);
        return;
    }

    window.qsbChartInstance = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { type: 'time', time: { unit: 'day', displayFormats: { day: 'dd.MM' } }, ticks: { maxTicksLimit: 5, font: { size: 10 } } },
                y: { reverse: true, min: 1, max: 5, ticks: { stepSize: 1, font: { size: 10 } } }
            }
        }
    });
};

const openStudentQuickSidebar = (studentId) => {
    const sidebar = document.getElementById("student-quick-sidebar");
    if (!sidebar) return;

    const currentYear = getCurrentYear();
    const student = currentYear?.students?.find(s => s.id === studentId);
    if (!student) return;
    _qsbCurrentStudentId = studentId;
    _qsbSemesterFilter = null; // reset to all-year on new student open

    // Prev/next navigation
    const { column, direction } = window.studentSortState || { column: 'lastName', direction: 'asc' };
    const sorted = [...currentYear.students].sort((a, b) => {
        const dir = direction === 'asc' ? 1 : -1;
        if (column === 'lastName') {
            const c = (a.lastName || '').localeCompare(b.lastName || '', 'de');
            return c !== 0 ? c * dir : (a.firstName || '').localeCompare(b.firstName || '', 'de') * dir;
        }
        return (a.firstName || '').localeCompare(b.firstName || '', 'de') * dir;
    });
    const idx = sorted.findIndex(s => s.id === studentId);
    const prev = idx > 0 ? sorted[idx - 1] : null;
    const next = idx < sorted.length - 1 ? sorted[idx + 1] : null;

    document.getElementById("qsb-name").textContent = getStudentDisplayName(student);

    const prevBtn = document.getElementById("qsb-prev-btn");
    const nextBtn = document.getElementById("qsb-next-btn");
    prevBtn.disabled = !prev;
    prevBtn.onclick = prev ? () => openStudentQuickSidebar(prev.id) : null;
    nextBtn.disabled = !next;
    nextBtn.onclick = next ? () => openStudentQuickSidebar(next.id) : null;

    document.getElementById("qsb-close-btn").onclick = _closeStudentQuickSidebar;
    document.getElementById("qsb-fullscreen-btn").onclick = () => {
        _closeStudentQuickSidebar();
        showStudentDetailView(studentId);
    };

    // Show sidebar (push layout)
    sidebar.style.display = "flex";
    document.querySelector("main")?.classList.add("qsb-open");
    requestAnimationFrame(() => { sidebar.classList.add("open"); });

    _renderStudentQuickContent(studentId);
};

/**
 * SHOW STUDENT DETAIL VIEW
 *
 * Navigates to the student detail view with animation.
 *
 * @param {string} studentId - The ID of the student to display
 */
const showStudentDetailView = (studentId) => {
    window.detailSemesterFilter = null; // reset to all-year on new student open
    const classView = document.getElementById("class-view");
    const homeView = document.getElementById("home-view");
    const studentDetailView = document.getElementById("student-detail-view");
    const settingsView = document.getElementById("settings-view");

    // Hide other views with animation
    let viewToHide;
    if (!classView.classList.contains("hidden")) {
        viewToHide = classView;
    } else if (settingsView && !settingsView.classList.contains("hidden")) {
        viewToHide = settingsView;
    } else {
        viewToHide = homeView;
    }

    // Update header to show student name immediately
    const _detailYear = getCurrentYear();
    const _detailStudent = _detailYear?.students?.find(s => s.id === studentId);
    if (_detailStudent) setGreetingContext(getStudentDisplayName(_detailStudent));

    viewToHide.style.animation = 'viewFadeOut 0.15s ease-in forwards';
    setTimeout(() => {
        viewToHide.classList.add("hidden");
        viewToHide.style.animation = '';

        // Show student detail view
        studentDetailView.classList.remove("hidden");
        studentDetailView.style.animation = 'none';
        studentDetailView.offsetHeight; // Force reflow
        studentDetailView.style.animation = 'viewFadeIn 0.25s ease-out';

        // Render the student details
        renderStudentDetail(studentId);
    }, 150);
};

/**
 * BACK TO CLASS VIEW
 *
 * Returns from student detail view to class view with animation.
 */
const backToClassView = () => {
    const classView = document.getElementById("class-view");
    const studentDetailView = document.getElementById("student-detail-view");

    // Destroy chart instance if exists
    if (window.studentGradeChartInstance) {
        window.studentGradeChartInstance.destroy();
        window.studentGradeChartInstance = null;
    }

    // Restore header to class name
    const _backClass = getCurrentClass();
    setGreetingContext(_backClass ? _backClass.name : null);

    studentDetailView.style.animation = 'viewFadeOut 0.15s ease-in forwards';
    setTimeout(() => {
        studentDetailView.classList.add("hidden");
        studentDetailView.style.animation = '';

        classView.classList.remove("hidden");
        classView.style.animation = 'none';
        classView.offsetHeight; // Force reflow
        classView.style.animation = 'viewFadeIn 0.25s ease-out';

        renderSubjectTabs();
        renderStudents();
    }, 150);
};

// Show Settings View
const showSettingsView = () => {
    const homeView = document.getElementById("home-view");
    const classView = document.getElementById("class-view");
    const studentDetailView = document.getElementById("student-detail-view");
    const settingsView = document.getElementById("settings-view");

    if (!settingsView) return;

    // Destroy chart instance if exists
    if (window.studentGradeChartInstance) {
        window.studentGradeChartInstance.destroy();
        window.studentGradeChartInstance = null;
    }

    // Find which view is currently visible
    let viewToHide = null;
    if (!homeView.classList.contains("hidden")) {
        viewToHide = homeView;
    } else if (!classView.classList.contains("hidden")) {
        viewToHide = classView;
    } else if (studentDetailView && !studentDetailView.classList.contains("hidden")) {
        viewToHide = studentDetailView;
    }

    const showSettings = () => {
        settingsView.classList.remove("hidden");
        settingsView.style.animation = 'none';
        settingsView.offsetHeight; // Force reflow
        settingsView.style.animation = 'viewFadeIn 0.25s ease-out';

        // Load all settings form values from appData
        reloadSettingsFormValues();

        // Render category management
        renderCategoryManagement();

        if (window.renderOrganisationPanel) window.renderOrganisationPanel();
        if (window.renderWebUntisPanel) window.renderWebUntisPanel();
        if (window.renderMoodlePanel) window.renderMoodlePanel();

        // Render default subjects
        if (window.renderDefaultSubjects) {
            window.renderDefaultSubjects('settings-subjects-list');
        }

        // Tab-switch dirty guard — registered once per settings-tabs container
        if (!document.getElementById("settings-tabs")?.dataset.dirtyGuardInit) {
            const tabContainer = document.getElementById("settings-tabs");
            if (tabContainer) {
                // Manually switch a tab — used when confirming discard after dirty check
                const switchToTab = (targetTab) => {
                    const allTabs = tabContainer.querySelectorAll('[role="tab"]');
                    const allPanels = tabContainer.querySelectorAll('[role="tabpanel"]');
                    allTabs.forEach(t => {
                        t.setAttribute('aria-selected', t === targetTab ? 'true' : 'false');
                        t.setAttribute('tabindex', t === targetTab ? '0' : '-1');
                    });
                    allPanels.forEach(p => {
                        p.hidden = p.id !== targetTab.getAttribute('aria-controls');
                    });
                };

                // Attach directly on each button (target phase) — fires before basecoat's
                // bubble-phase delegation handler on nav[tablist]. At target phase,
                // aria-selected still reflects the pre-click state so the check is reliable.
                tabContainer.querySelectorAll('[role="tab"]').forEach(tab => {
                    tab.addEventListener('click', (e) => {
                        // Already active tab — nothing to intercept
                        if (tab.getAttribute('aria-selected') === 'true') return;
                        // Not dirty — let basecoat handle the switch normally
                        if (!window.settingsDirty) return;

                        // Dirty: stop basecoat's delegation handler from running
                        e.stopPropagation();
                        e.preventDefault();

                        // Show confirm; on discard, do the switch ourselves
                        checkSettingsDirtyThenRun(() => switchToTab(tab));
                    });
                });

                tabContainer.dataset.dirtyGuardInit = "true";
            }
        }

        // Reset dirty state when entering settings (values are freshly loaded)
        window.settingsDirty = false;

        // Set breadcrumb home handler
        const breadcrumbHome = document.getElementById("settings-breadcrumb-home");
        if (breadcrumbHome) {
            breadcrumbHome.onclick = (e) => {
                e.preventDefault();
                showHomeView();
            };
        }
    };

    if (viewToHide) {
        viewToHide.style.animation = 'viewFadeOut 0.15s ease-in forwards';
        setTimeout(() => {
            viewToHide.classList.add("hidden");
            viewToHide.style.animation = '';
            showSettings();
        }, 150);
    } else {
        showSettings();
    }

    // Update nav button states
    document.getElementById("nav-home").classList.remove("btn-primary");
    document.getElementById("nav-home").classList.add("btn-secondary");

    const navSettings = document.getElementById("nav-settings");
    if (navSettings) {
        navSettings.classList.remove("btn-primary");
        navSettings.classList.remove("btn-outline");
    }

    // Update header to show "Settings"
    setGreetingContext(t("nav.settings") || "Settings");
};

/**
 * CALCULATE TREND
 *
 * Calculates whether the student's grades are improving, declining, or stable.
 * Compares the average of the first half to the second half of grades.
 *
 * @param {Array} grades - Array of grade objects sorted by date
 * @returns {object} - { trend: 'improving' | 'declining' | 'stable', value: number }
 */
const calculateTrend = (grades) => {
    // Filter numeric grades and sort by date
    const numericGrades = grades
        .filter(g => !g.isPlusMinus)
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

    if (numericGrades.length < 2) {
        return { trend: 'stable', value: 0 };
    }

    const midPoint = Math.floor(numericGrades.length / 2);
    const firstHalf = numericGrades.slice(0, midPoint);
    const secondHalf = numericGrades.slice(midPoint);

    const firstAvg = firstHalf.reduce((sum, g) => sum + g.value, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, g) => sum + g.value, 0) / secondHalf.length;

    const diff = firstAvg - secondAvg; // Positive = improving (lower grades are better)

    if (Math.abs(diff) < 0.3) {
        return { trend: 'stable', value: diff };
    } else if (diff > 0) {
        return { trend: 'improving', value: diff };
    } else {
        return { trend: 'declining', value: diff };
    }
};

/**
 * CALCULATE CLASS AVERAGE
 *
 * Calculates the weighted average of all students in the current class.
 *
 * @returns {number} - Class average or 0 if no grades
 */
const calculateClassAverage = (semesterFilter = undefined) => {
    const currentYear = getCurrentYear();
    if (!currentYear) return 0;
    const sid = currentYear.currentSubjectId;

    const averages = [];
    currentYear.students.forEach(student => {
        let grades;
        if (semesterFilter === undefined) {
            // default: use current semester filter (for class table stats)
            grades = filterGradesBySubject(student.grades, sid);
        } else {
            // explicit filter: null = all year, "WS"/"SS" = specific semester
            grades = sid ? student.grades.filter(g => {
                if (g.subjectId !== sid) return false;
                if (semesterFilter && g.semester !== semesterFilter) return false;
                return true;
            }) : [];
        }
        const avg = calculateWeightedAverage(grades);
        if (avg > 0) averages.push(avg);
    });

    if (averages.length === 0) return 0;
    return averages.reduce((sum, avg) => sum + avg, 0) / averages.length;
};

/**
 * RENDER STUDENT DETAIL
 *
 * Main render function for the student detail view.
 * Populates all statistics, chart, category breakdown, and grades table.
 *
 * @param {string} studentId - The ID of the student to display
 */
const renderStudentDetail = (studentId) => {
    const currentYear = getCurrentYear();
    if (!currentYear) return;

    const student = currentYear.students.find(s => s.id === studentId);
    if (!student) return;

    // Store student ID for reference
    document.getElementById("student-detail-view").dataset.studentId = studentId;

    // Set student name
    const studentName = getStudentDisplayName(student);
    document.getElementById("student-detail-name").textContent = studentName;

    // Show notes (e.g. accommodations, learning differences) if present.
    // Hidden by default, only revealed for students that have notes saved.
    const notesCard = document.getElementById("student-detail-notes-card");
    const notesText = document.getElementById("student-detail-notes-text");
    if (notesCard && notesText) {
        const noteValue = (student.notes || '').toString().trim();
        if (noteValue) {
            notesText.textContent = noteValue;
            notesCard.classList.remove("hidden");
        } else {
            notesText.textContent = '';
            notesCard.classList.add("hidden");
        }
    }

    // Prev/next student navigation (same sort order as table)
    const { column, direction } = window.studentSortState || { column: 'lastName', direction: 'asc' };
    const sortedStudents = [...currentYear.students].sort((a, b) => {
        const dir = direction === 'asc' ? 1 : -1;
        if (column === 'lastName') {
            const cmp = (a.lastName || '').localeCompare(b.lastName || '', 'de');
            if (cmp !== 0) return cmp * dir;
            return (a.firstName || '').localeCompare(b.firstName || '', 'de') * dir;
        } else if (column === 'firstName') {
            return (a.firstName || '').localeCompare(b.firstName || '', 'de') * dir;
        }
        return (a.lastName || '').localeCompare(b.lastName || '', 'de') * dir;
    });
    const currentIdx = sortedStudents.findIndex(s => s.id === studentId);
    const prevStudent = currentIdx > 0 ? sortedStudents[currentIdx - 1] : null;
    const nextStudent = currentIdx < sortedStudents.length - 1 ? sortedStudents[currentIdx + 1] : null;

    const prevBtn = document.getElementById('prev-student-btn');
    const nextBtn = document.getElementById('next-student-btn');
    if (prevBtn) {
        prevBtn.disabled = !prevStudent;
        prevBtn.onclick = prevStudent ? () => renderStudentDetail(prevStudent.id) : null;
        prevBtn.title = prevStudent ? getStudentDisplayName(prevStudent) : '';
        prevBtn.setAttribute('data-tooltip', prevStudent ? getStudentDisplayName(prevStudent) : t('student.noPrevStudent'));
    }
    if (nextBtn) {
        nextBtn.disabled = !nextStudent;
        nextBtn.onclick = nextStudent ? () => renderStudentDetail(nextStudent.id) : null;
        nextBtn.title = nextStudent ? getStudentDisplayName(nextStudent) : '';
        nextBtn.setAttribute('data-tooltip', nextStudent ? getStudentDisplayName(nextStudent) : t('student.noNextStudent'));
    }

    // Update breadcrumbs
    const currentClass = getCurrentClass();
    if (currentClass) {
        document.getElementById("breadcrumb-student-class").textContent = currentClass.name;
        document.getElementById("breadcrumb-student-class").onclick = (e) => {
            e.preventDefault();
            showClassView();
        };
    }
    document.getElementById("breadcrumb-student-name").textContent = studentName;
    document.getElementById("breadcrumb-student-home").onclick = (e) => {
        e.preventDefault();
        showHomeView();
    };

    // Noten nach aktivem Fach filtern (kein Semester-Filter — zeigt gesamtes Jahr; optional nach Semester filtern)
    const currentSubjectId = currentYear.currentSubjectId || null;
    const filteredGrades = currentSubjectId
        ? student.grades.filter(g => {
            if (g.subjectId !== currentSubjectId) return false;
            if (window.detailSemesterFilter && g.semester !== window.detailSemesterFilter) return false;
            return true;
        })
        : [];

    // Semester-Filter Toggle rendern
    const semFilterEl = document.getElementById("student-semester-filter");
    if (semFilterEl) {
        const mkBtn = (label, val) => {
            const active = window.detailSemesterFilter === val;
            return `<button class="${active ? 'btn-sm-primary' : 'btn-sm-outline'}" data-detail-sem="${val ?? '__all__'}">${label}</button>`;
        };
        semFilterEl.innerHTML = `<div class="flex gap-1 items-center">
            ${mkBtn(t("semester.all") || "Gesamt", null)}
            ${mkBtn(t("semester.WS") || "WS", "WS")}
            ${mkBtn(t("semester.SS") || "SS", "SS")}
        </div>`;
        semFilterEl.querySelectorAll("[data-detail-sem]").forEach(btn => {
            btn.addEventListener("click", () => {
                window.detailSemesterFilter = btn.dataset.detailSem === '__all__' ? null : btn.dataset.detailSem;
                renderStudentDetail(studentId);
            });
        });
    }

    // Calculate statistics with filtered grades
    const weightedAvg = calculateWeightedAverage(filteredGrades);
    let finalGrade = calculateFinalGrade(weightedAvg);
    const trend = calculateTrend(filteredGrades);
    const classAvg = calculateClassAverage(window.detailSemesterFilter);
    const numericGradeCount = filteredGrades.filter(g => !g.isPlusMinus).length;

    // Check attendance status for current subject and override final grade if critical
    const attendanceStatus = getAttendanceStatus(studentId, currentSubjectId);
    if (attendanceStatus.status === 'critical') {
        finalGrade = '5';
    }

    // Populate stat cards
    document.getElementById("student-stat-average").textContent =
        weightedAvg ? weightedAvg.toFixed(2) : "-";

    // Add percentage badge for average
    const averagePercentEl = document.getElementById("student-stat-average-percent");
    if (weightedAvg && weightedAvg > 0) {
        const percentage = Math.round(((6 - weightedAvg) / 5) * 100);

        // Determine badge color based on percentage
        let badgeClass = 'badge-secondary';
        if (percentage >= 80) {
            badgeClass = 'grade-badge grade-1';
        } else if (percentage >= 60) {
            badgeClass = 'grade-badge grade-2';
        } else if (percentage >= 40) {
            badgeClass = 'grade-badge grade-3';
        } else if (percentage >= 20) {
            badgeClass = 'grade-badge grade-4';
        } else {
            badgeClass = 'grade-badge grade-5';
        }

        averagePercentEl.innerHTML = `<span class="badge ${badgeClass} text-xs">${percentage}%</span>`;
    } else {
        averagePercentEl.innerHTML = '';
    }

    document.getElementById("student-stat-final").textContent = finalGrade;
    document.getElementById("student-stat-count").textContent = filteredGrades.length;

    // Trend display with icon
    const trendEl = document.getElementById("student-stat-trend");
    if (trend.trend === 'improving') {
        trendEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-green-500 lucide lucide-chevron-up-icon lucide-chevron-up"><path d="m18 15-6-6-6 6"/></svg><span class="text-green-500">${t("student.improving")}</span>`;
    } else if (trend.trend === 'declining') {
        trendEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-red-500 lucide lucide-chevron-down-icon lucide-chevron-down"><path d="m6 9 6 6 6-6"/></svg><span class="text-red-500">${t("student.declining")}</span>`;
    } else {
        trendEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-yellow-500 lucide lucide-minus-icon lucide-minus"><path d="M5 12h14"/></svg><span class="text-yellow-500">${t("student.stable")}</span>`;
    }

    // Class comparison
    const comparisonEl = document.getElementById("student-stat-comparison");
    if (weightedAvg && classAvg) {
        const diff = classAvg - weightedAvg; // Positive = better than class (lower is better)
        if (Math.abs(diff) < 0.1) {
            comparisonEl.innerHTML = `<span class="text-yellow-500">=</span>`;
        } else if (diff > 0) {
            comparisonEl.innerHTML = `<span class="text-green-500">+${diff.toFixed(1)}</span>`;
        } else {
            comparisonEl.innerHTML = `<span class="text-red-500">${diff.toFixed(1)}</span>`;
        }
    } else {
        comparisonEl.textContent = "-";
    }

    // Attendance warning/critical banner in detail view
    let existingBanner = document.getElementById('attendance-status-banner');
    if (existingBanner) existingBanner.remove();

    if (attendanceStatus.status === 'critical') {
        const banner = document.createElement('div');
        banner.id = 'attendance-status-banner';
        banner.className = 'mb-4 p-4 rounded-lg border-2 border-red-500 bg-red-50 dark:bg-red-900/20';
        banner.innerHTML = `
            <div class="flex items-center gap-3">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-red-600 dark:text-red-400 flex-shrink-0 lucide lucide-circle-alert-icon lucide-circle-alert"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <div>
                    <p class="font-semibold text-red-700 dark:text-red-400">${t('attendance.criticalWarning')}</p>
                    <p class="text-sm text-red-600 dark:text-red-400/80">${t('attendance.title')}: ${attendanceStatus.rate}% — ${t('attendance.minPercent')}: ${attendanceStatus.minPercent}%</p>
                </div>
            </div>
        `;
        const statCards = document.querySelector('#student-detail-view .stat-card')?.closest('.grid');
        if (statCards) statCards.parentNode.insertBefore(banner, statCards);
    } else if (attendanceStatus.status === 'warning') {
        const banner = document.createElement('div');
        banner.id = 'attendance-status-banner';
        banner.className = 'mb-4 p-4 rounded-lg border-2 border-orange-400 bg-orange-50 dark:bg-orange-900/20';
        banner.innerHTML = `
            <div class="flex items-center gap-3">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-orange-500 dark:text-orange-400 flex-shrink-0 lucide lucide-triangle-alert-icon lucide-triangle-alert"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                <div>
                    <p class="font-semibold text-orange-700 dark:text-orange-400">${t('attendance.lowWarning')}</p>
                    <p class="text-sm text-orange-600 dark:text-orange-400/80">${t('attendance.title')}: ${attendanceStatus.rate}% — ${t('attendance.minPercent')}: ${attendanceStatus.minPercent}%</p>
                </div>
            </div>
        `;
        const statCards = document.querySelector('#student-detail-view .stat-card')?.closest('.grid');
        if (statCards) statCards.parentNode.insertBefore(banner, statCards);
    }

    // Update attendance statistics for current subject
    const attendanceStats = calculateAttendanceStats(studentId, currentSubjectId);
    if (attendanceStats && attendanceStats.total > 0) {
        document.getElementById("student-attendance-total").textContent = attendanceStats.total;
        document.getElementById("student-attendance-present").textContent = attendanceStats.present;
        document.getElementById("student-attendance-late").textContent = attendanceStats.late;
        document.getElementById("student-attendance-absent").textContent = attendanceStats.absent;
        document.getElementById("student-attendance-rate").textContent = attendanceStats.presentRate + '%';

        // Render attendance list
        renderStudentAttendanceList(student);

        document.getElementById("student-attendance-section").style.display = 'block';
    } else {
        // Hide attendance section if no data
        document.getElementById("student-attendance-section").style.display = 'none';
    }

    // Render chart, category breakdown, and grades table with filtered grades
    const filteredStudent = { ...student, grades: filteredGrades };
    renderStudentGradeChart(filteredStudent);
    renderCategoryBreakdown(filteredStudent);
    renderStudentGradesTable(student, filteredGrades);

    // Setup grade search functionality
    setupGradeSearch(student, filteredGrades);

    // Add Grade button in student detail header
    const addGradeBtn = document.getElementById("student-detail-add-grade");
    addGradeBtn.onclick = () => {
        openAddGradeDialog(studentId, () => renderStudentDetail(studentId));
    };

    // Print button in student detail header
    const printBtn = document.getElementById("student-detail-print");
    if (printBtn) {
        printBtn.onclick = () => exportStudentDetailPDF(studentId);
    }

    // Apply compact mode to detail view
    const detailView = document.getElementById('student-detail-view');
    if (detailView) detailView.classList.toggle('compact-detail', localStorage.getItem('edugrade_compact_view') === '1');
};

/**
 * RENDER STUDENT GRADE CHART
 *
 * Creates a Chart.js line chart showing grades over time, grouped by category.
 *
 * @param {object} student - The student object
 */
const renderStudentGradeChart = (student) => {
    const ctx = document.getElementById("student-grade-chart").getContext("2d");

    // Destroy existing chart if any
    if (window.studentGradeChartInstance) {
        window.studentGradeChartInstance.destroy();
    }

    // Group grades by category
    const gradesByCategory = {};
    const categoryColors = [
        { bg: 'rgba(59, 130, 246, 0.2)', border: 'rgb(59, 130, 246)' },   // Blue
        { bg: 'rgba(34, 197, 94, 0.2)', border: 'rgb(34, 197, 94)' },     // Green
        { bg: 'rgba(249, 115, 22, 0.2)', border: 'rgb(249, 115, 22)' },   // Orange
        { bg: 'rgba(168, 85, 247, 0.2)', border: 'rgb(168, 85, 247)' },   // Purple
        { bg: 'rgba(236, 72, 153, 0.2)', border: 'rgb(236, 72, 153)' },   // Pink
        { bg: 'rgba(234, 179, 8, 0.2)', border: 'rgb(234, 179, 8)' },     // Yellow
    ];

    // Include all grades (numeric and +/~/-)
    student.grades.forEach(grade => {
        const catName = grade.categoryName || 'Unknown';
        if (!gradesByCategory[catName]) {
            gradesByCategory[catName] = [];
        }

        let yValue;
        let displayLabel;
        if (grade.isPlusMinus) {
            // For chart visualization: fixed Y-values for better readability
            if (grade.value === '+') {
                yValue = 1.5;  // Display near "Very Good"
                displayLabel = '+';
            } else if (grade.value === '~') {
                yValue = 3;    // Display at "Satisfactory"
                displayLabel = '~';
            } else {
                yValue = 4.5;  // Display near "Sufficient"
                displayLabel = '-';
            }
        } else {
            yValue = grade.value;
            displayLabel = null;
        }

        gradesByCategory[catName].push({
            x: grade.createdAt || Date.now(),
            y: yValue,
            name: grade.name || '',
            plusMinusLabel: displayLabel
        });
    });

    // Sort each category's grades by date
    Object.values(gradesByCategory).forEach(grades => {
        grades.sort((a, b) => a.x - b.x);
    });

    // Create datasets
    const datasets = Object.entries(gradesByCategory).map(([categoryName, grades], index) => {
        const colorIndex = index % categoryColors.length;
        return {
            label: categoryName,
            data: grades,
            borderColor: categoryColors[colorIndex].border,
            backgroundColor: categoryColors[colorIndex].bg,
            borderWidth: 2,
            tension: 0.3,
            pointRadius: grades.map(g => g.plusMinusLabel ? 7 : 5),
            pointHoverRadius: grades.map(g => g.plusMinusLabel ? 9 : 7),
            pointStyle: grades.map(g => {
                if (g.plusMinusLabel === '+') return 'triangle';
                if (g.plusMinusLabel === '~') return 'rectRot';
                if (g.plusMinusLabel === '-') return 'crossRot';
                return 'circle';
            }),
            fill: false
        };
    });

    // If no data, show empty state
    if (datasets.length === 0) {
        ctx.font = '16px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#6b7280';
        ctx.fillText(t("student.noGrades"), ctx.canvas.width / 2, ctx.canvas.height / 2);
        return;
    }

    window.studentGradeChartInstance = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: 'day',
                        displayFormats: {
                            day: 'dd.MM.yy'
                        }
                    },
                    title: {
                        display: true,
                        text: t("chart.date")
                    }
                },
                y: {
                    reverse: true, // Grade 1 at top
                    min: 1,
                    max: 5,
                    title: {
                        display: true,
                        text: t("chart.grade")
                    },
                    ticks: {
                        stepSize: 1
                    }
                }
            },
            plugins: {
                legend: {
                    position: 'top'
                },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const point = context.raw;
                            const valueDisplay = point.plusMinusLabel || point.y;
                            let label = `${context.dataset.label}: ${valueDisplay}`;
                            if (point.name) {
                                label += ` (${point.name})`;
                            }
                            return label;
                        }
                    }
                }
            }
        }
    });
};

/**
 * RENDER CATEGORY BREAKDOWN
 *
 * Shows statistics for each category the student has grades in.
 *
 * @param {object} student - The student object
 */
const renderCategoryBreakdown = (student) => {
    const container = document.getElementById("category-breakdown");

    // Group grades by category
    const gradesByCategory = {};
    student.grades.forEach(grade => {
        const catId = grade.categoryId;
        if (!gradesByCategory[catId]) {
            gradesByCategory[catId] = {
                name: grade.categoryName,
                weight: grade.weight,
                grades: []
            };
        }
        gradesByCategory[catId].grades.push(grade);
    });

    if (Object.keys(gradesByCategory).length === 0) {
        container.innerHTML = `<p class="text-gray-400 text-sm">${t("student.noGrades")}</p>`;
        return;
    }

    container.innerHTML = Object.entries(gradesByCategory).map(([catId, category]) => {
        const numericGrades = category.grades.filter(g => !g.isPlusMinus);
        const plusMinusGrades = category.grades.filter(g => g.isPlusMinus);

        let avgText = '-';
        let gradeInfo = '';
        let percentageBadge = '';

        if (numericGrades.length > 0) {
            const avg = numericGrades.reduce((sum, g) => sum + g.value, 0) / numericGrades.length;
            avgText = avg.toFixed(2);
            gradeInfo = `${numericGrades.length} grade${numericGrades.length !== 1 ? 's' : ''}`;

            // Calculate percentage: Grade 1 = 100%, Grade 6 = 0%
            const percentage = Math.round(((6 - avg) / 5) * 100);

            // Determine badge color based on percentage
            let badgeClass = 'badge-secondary';
            if (percentage >= 80) {
                badgeClass = 'grade-badge grade-1'; // Very good (green-ish)
            } else if (percentage >= 60) {
                badgeClass = 'grade-badge grade-2'; // Good
            } else if (percentage >= 40) {
                badgeClass = 'grade-badge grade-3'; // Satisfactory
            } else if (percentage >= 20) {
                badgeClass = 'grade-badge grade-4'; // Sufficient
            } else {
                badgeClass = 'grade-badge grade-5'; // Insufficient
            }

            percentageBadge = `<span class="badge ${badgeClass} text-xs">${percentage}%</span>`;
        }

        if (plusMinusGrades.length > 0) {
            const plusCount = plusMinusGrades.filter(g => g.value === '+').length;
            const neutralCount = plusMinusGrades.filter(g => g.value === '~').length;
            const minusCount = plusMinusGrades.filter(g => g.value === '-').length;
            if (gradeInfo) gradeInfo += ', ';
            gradeInfo += `${plusCount}+ / ${neutralCount}~ / ${minusCount}-`;

            // If this category has ONLY +/~/- grades (no numeric grades), show the tendency
            if (numericGrades.length === 0) {
                // Determine the dominant tendency
                if (plusCount > minusCount) {
                    avgText = '+';
                    percentageBadge = '<span class="badge grade-badge grade-1 text-xs">+</span>';
                } else if (minusCount > plusCount) {
                    avgText = '-';
                    percentageBadge = '<span class="badge grade-badge grade-5 text-xs">-</span>';
                } else {
                    // Equal or neutral dominates
                    avgText = '~';
                    percentageBadge = '<span class="badge grade-badge grade-3 text-xs">~</span>';
                }
            }
        }

        return `
            <div class="category-stat-card p-3 rounded-lg border">
                <div class="flex justify-between items-start mb-2">
                    <span class="font-medium">${escapeHtml(category.name)}</span>
                    <div class="flex gap-2">
                        ${percentageBadge}
                        <span class="badge badge-secondary text-xs">${(category.weight * 100).toFixed(0)}%</span>
                    </div>
                </div>
                <p class="text-2xl font-bold">${avgText}</p>
                <p class="text-gray-400 text-sm">${gradeInfo}</p>
            </div>
        `;
    }).join('');
};

/**
 * RENDER STUDENT GRADES TABLE
 *
 * Shows a chronological list of all grades with details.
 *
 * @param {object} student - The student object
 */
const renderStudentGradesTable = (student, filteredGrades = null) => {
    const tbody = document.getElementById("student-grades-table");

    // Sort grades by date (newest first), use filtered grades if provided
    const gradesToShow = filteredGrades || student.grades;
    const sortedGrades = [...gradesToShow].sort((a, b) =>
        (b.createdAt || 0) - (a.createdAt || 0)
    );

    if (sortedGrades.length === 0) {
        const icon = `<svg class="lucide lucide-pen-line-icon lucide-pen-line" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>`;

        const title = t('emptyState.noGrades') || 'Keine Noten';
        const description = t('emptyState.noGradesDesc') || 'Dieser Schüler hat noch keine Noten. Klicken Sie auf "Note hinzufügen" um eine neue Note zu erfassen.';

        const buttons = [{
            text: t('grade.addGrade') || 'Note hinzufügen',
            class: 'btn-primary',
            onclick: 'document.getElementById(\'student-detail-add-grade\').click()'
        }];

        tbody.innerHTML = `<tr><td colspan="6">${createEmptyState(icon, title, description, buttons)}</td></tr>`;
        return;
    }

    // Hide category column when all shown grades share the same category
    const detailTable = tbody.closest('table');
    const allSameCategory = sortedGrades.length > 0 &&
        sortedGrades.every(g => g.categoryName === sortedGrades[0].categoryName);
    if (detailTable) detailTable.classList.toggle('single-category', allSameCategory);
    if (detailTable) detailTable.classList.toggle('compact-table', localStorage.getItem('edugrade_compact_view') === '1');

    tbody.innerHTML = sortedGrades.map(grade => {
        const date = grade.createdAt
            ? new Date(grade.createdAt).toLocaleDateString('de-AT', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            })
            : '-';

        // Check if student was absent/late on this grade's date
        const gradeDateStr = grade.createdAt ? new Date(grade.createdAt).toISOString().split('T')[0] : null;
        const absenceOnGradeDay = (gradeDateStr && isAttendanceEnabledForCurrentClass())
            ? (student.participation || []).find(p =>
                p.date === gradeDateStr &&
                (!grade.subjectId || p.subjectId === grade.subjectId) &&
                (p.status === 'absent' || p.status === 'late'))
            : null;
        const absenceBadge = absenceOnGradeDay
            ? `<span class="badge ${absenceOnGradeDay.status === 'absent' ? 'badge-destructive' : 'badge-warning'} text-xs ml-1"
                data-tooltip="${absenceOnGradeDay.status === 'absent' ? escapeHtml(t('attendance.view.absentOnGradeDay')) : escapeHtml(t('attendance.view.lateOnGradeDay'))}" data-side="top"
                style="display:inline-flex;align-items:center;gap:2px;">
                <svg class="lucide lucide-triangle-alert-icon lucide-triangle-alert" xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
              </span>`
            : '';

        // Handle pending grades
        let displayValue, gradeColorClass, weightDisplay;
        if (grade.isPending) {
            displayValue = t("grade.pendingValue");
            gradeColorClass = "badge-warning";
            weightDisplay = '-';
        } else {
            displayValue = grade.isPlusMinus ? grade.value : formatGradeDisplay(grade.value);
            gradeColorClass = getGradeColorClass(grade);
            weightDisplay = grade.isPlusMinus ? '-' : `${(grade.weight * 100).toFixed(0)}%`;
        }

        // Visual indication for grades excluded from average
        const excludedClass = grade.excludeFromAverage ? 'opacity-50' : '';
        const excludedBadge = grade.excludeFromAverage
            ? `<span class="badge badge-secondary text-xs ml-1" data-tooltip="${t("grade.excludedFromAverage")}" data-side="top">⊘</span>`
            : '';

        // Visual indication for pending grades
        const pendingClass = grade.isPending ? 'pending-grade' : '';
        const pendingBadge = grade.isPending
            ? `<span class="badge badge-warning text-xs ml-1" data-tooltip="${t("grade.pendingTooltip")}" data-side="top" style="display: inline-flex; align-items: center; gap: 0.25rem;">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-clock-alert-icon lucide-clock-alert">
                  <path d="M12 6v6l4 2"/>
                  <path d="M20 12v5"/>
                  <path d="M20 21h.01"/>
                  <path d="M21.25 8.2A10 10 0 1 0 16 21.16"/>
                </svg>
              </span>`
            : '';

        return `
            <tr class="${excludedClass} ${pendingClass}">
                <td>${escapeHtml(date)}${absenceBadge}</td>
                <td>${escapeHtml(grade.categoryName || '-')}</td>
                <td>${escapeHtml(grade.name || '-')}${excludedBadge}${pendingBadge}</td>
                <td>
                    <span class="badge ${gradeColorClass}">${escapeHtml(displayValue)}</span>
                    ${grade.comment ? `<p class="text-xs text-gray-400 mt-1 max-w-[200px] truncate" title="${safeAttr(grade.comment)}">${escapeHtml(grade.comment)}</p>` : ''}
                </td>
                <td>${weightDisplay}</td>
                <td>
                    <div role="group" class="button-group">
                        <button class="btn-icon btn-secondary" data-edit-grade="${safeAttr(grade.id)}" data-tooltip="${t("grade.editTooltip")}" data-side="top">
                            <svg class="lucide lucide-edit" viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.5 5.5l-4 4L17 11.5 21 7.5z" />
                            </svg>
                        </button>
                        <button class="btn-icon btn-destructive" data-delete-grade="${safeAttr(grade.id)}" data-tooltip="${t("grade.deleteTooltip")}" data-side="top">
                            <svg class="lucide lucide-trash-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 6h18" />
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    // Add event listeners for edit grade buttons
    document.querySelectorAll("#student-grades-table [data-edit-grade]").forEach(btn => {
        btn.addEventListener("click", () => {
            const gradeId = btn.dataset.editGrade;
            const grade = student.grades.find(g => g.id === gradeId);
            if (grade) {
                const isPlusMinus = grade.isPlusMinus;
                const wasEnteredAsPercent = grade.enteredAsPercent === true;

                const isPrimarySchool = (appData.schoolType === 'primary');

                let valueInput;
                // For pending grades, show empty input
                if (grade.isPending) {
                    if (isPrimarySchool) {
                        valueInput = `
                            <div class="grid grid-cols-2 gap-2" id="primary-grade-buttons-edit">
                              ${[
                                { value: '1', label: 'Sehr gut',           color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
                                { value: '2', label: 'Gut',                 color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
                                { value: '3', label: 'Befriedigend',        color: '#eab308', bg: 'rgba(234,179,8,0.12)' },
                                { value: '4', label: 'Gen\u00fcgend',       color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
                                { value: '5', label: 'Nicht gen\u00fcgend', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' }
                              ].map(g => `
                                <label class="primary-grade-btn flex items-center gap-2 p-2 rounded-lg border-2 cursor-pointer transition-all"
                                    style="border-color: var(--border, #2d2d3d);"
                                    data-value="${g.value}" data-color="${g.color}" data-bg="${g.bg}">
                                  <input type="radio" name="value" value="${g.value}" class="sr-only">
                                  <span class="text-sm font-semibold px-2 py-0.5 rounded-full whitespace-nowrap" style="background:${g.bg}; color:${g.color};">${g.value} \u2013 ${g.label}</span>
                                </label>`).join('')}
                            </div>`;
                    } else {
                        valueInput = `
                            <input type="number" name="value" step="0.1" min="1" max="6" class="input w-full" id="grade-value-input-edit" placeholder="1-6" data-icon="hash">
                            <p class="text-gray-400 text-sm mt-2">${t("grade.enterGrade")}</p>
                        `;
                    }
                } else if (isPlusMinus) {
                    valueInput = `
                        <select name="value" class="select w-full" required>
                            <option value="+" ${grade.value === '+' ? 'selected' : ''}>${t("grade.plus")}</option>
                            <option value="~" ${grade.value === '~' ? 'selected' : ''}>${t("grade.neutral")}</option>
                            <option value="-" ${grade.value === '-' ? 'selected' : ''}>${t("grade.minus")}</option>
                        </select>
                    `;
                } else if (isPrimarySchool) {
                    // Primary school: card radio buttons with current grade pre-selected
                    valueInput = `
                        <div class="grid grid-cols-2 gap-2" id="primary-grade-buttons-edit">
                          ${[
                            { value: '1', label: 'Sehr gut',           color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
                            { value: '2', label: 'Gut',                 color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
                            { value: '3', label: 'Befriedigend',        color: '#eab308', bg: 'rgba(234,179,8,0.12)' },
                            { value: '4', label: 'Gen\u00fcgend',       color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
                            { value: '5', label: 'Nicht gen\u00fcgend', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' }
                          ].map(g => {
                            const isSelected = String(Math.round(grade.value)) === g.value;
                            return `
                              <label class="primary-grade-btn flex items-center gap-2 p-2 rounded-lg border-2 cursor-pointer transition-all"
                                  style="border-color: ${isSelected ? g.color : 'var(--border, #2d2d3d)'}; background: ${isSelected ? g.bg : ''};"
                                  data-value="${g.value}" data-color="${g.color}" data-bg="${g.bg}">
                                <input type="radio" name="value" value="${g.value}" class="sr-only" ${isSelected ? 'checked' : ''} required>
                                <span class="text-sm font-semibold px-2 py-0.5 rounded-full whitespace-nowrap" style="background:${g.bg}; color:${g.color};">${g.value} \u2013 ${g.label}</span>
                              </label>`;
                          }).join('')}
                        </div>`;
                } else {
                    // Secondary school: tabs with percentage option
                    const initialPercent = wasEnteredAsPercent ? grade.percentValue : gradeToPercent(grade.value);
                    const gradeSelected = !wasEnteredAsPercent;
                    const percentSelected = wasEnteredAsPercent;

                    valueInput = `
                        <div class="tabs w-full" id="grade-input-tabs-edit">
                          <nav role="tablist" aria-orientation="horizontal" class="w-full">
                            <button type="button" role="tab" id="tab-grade-direct-edit" aria-controls="panel-grade-direct-edit" aria-selected="${gradeSelected}" tabindex="0">${t("grade.gradeTab")}</button>
                            <button type="button" role="tab" id="tab-grade-percent-edit" aria-controls="panel-grade-percent-edit" aria-selected="${percentSelected}" tabindex="0">${t("grade.percentageTab")}</button>
                          </nav>
                          <div role="tabpanel" id="panel-grade-direct-edit" aria-labelledby="tab-grade-direct-edit" tabindex="-1" aria-selected="${gradeSelected}" ${gradeSelected ? '' : 'hidden'}>
                            <div class="pt-3">
                              <input type="number" name="value" step="0.1" min="1" max="6" class="input w-full" id="grade-value-input-edit" value="${escapeHtml(grade.value || '')}" placeholder="1-6" data-icon="hash">
                              <p class="text-gray-400 text-sm mt-2">${t("grade.enterGrade")}</p>
                            </div>
                          </div>
                          <div role="tabpanel" id="panel-grade-percent-edit" aria-labelledby="tab-grade-percent-edit" tabindex="-1" aria-selected="${percentSelected}" ${percentSelected ? '' : 'hidden'}>
                            <div class="pt-3">
                              <div class="flex items-center gap-2">
                                <input type="number" id="grade-percent-input-edit" step="0.1" min="0" max="100" class="input flex-1" value="${escapeHtml(initialPercent || '')}" placeholder="0-100" data-icon="percent">
                                <span>%</span>
                              </div>
                              <p class="text-gray-400 text-sm mt-2">${t("grade.enterPercentage")}</p>
                              <p class="text-sm mt-1 font-semibold" id="percent-preview-edit"></p>
                            </div>
                          </div>
                        </div>
                    `;
                }

                // Convert timestamp to date string (YYYY-MM-DD)
                const gradeDate = grade.createdAt ? new Date(grade.createdAt) : new Date();
                const gradeDateStr = gradeDate.toISOString().split('T')[0];

                // Get student name for display
                const studentDisplayName = getStudentDisplayName(student);

                // Create category dropdown with current category selected
                const categoryOptions = appData.categories.map(cat => {
                    const label = cat.onlyPlusMinus ? ' [+/~/- only]' : (cat.allowPlusMinus ? ' [+/~/-]' : '');
                    const selected = cat.id === grade.categoryId ? 'selected' : '';
                    return `<option value="${safeAttr(cat.id)}" ${selected}>${escapeHtml(cat.name)} (${(cat.weight * 100).toFixed(0)}%)${label}</option>`;
                }).join("");

                const content = `
                    <div class="mb-3 p-3 rounded-lg bg-primary/10">
                        <p class="text-sm font-medium">${escapeHtml(studentDisplayName)}</p>
                    </div>
                    <div class="grid gap-2">
                        <label class="block mb-2">${t("grade.gradeDate")}</label>
                        <input type="date" name="gradeDate" class="input w-full" value="${gradeDateStr}" required>
                        <p class="text-gray-400 text-sm">${t("grade.gradeDateHint")}</p>
                    </div>
                    <div class="grid gap-2">
                        <label class="block mb-2">${t("grade.gradeName")}</label>
                        <input type="text" name="name" class="input w-full" value="${escapeHtml(grade.name || '')}" maxlength="100">
                    </div>
                    <div class="grid gap-2">
                        <label class="block mb-2">${t("grade.category")}</label>
                        <select name="categoryId" class="select w-full" required>
                            ${categoryOptions}
                        </select>
                        <p class="text-gray-400 text-sm">${t("grade.categoryHint")}</p>
                    </div>
                    <div class="grid gap-2">
                        <label class="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" name="includeInAverage" class="checkbox" ${!grade.excludeFromAverage ? 'checked' : ''}>
                            <span class="text-sm">${t("grade.includeInAverage")}</span>
                        </label>
                    </div>
                    <div class="grid gap-2 mb-3">
                        <label class="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" name="isPending" id="grade-is-pending-edit" class="checkbox" ${grade.isPending ? 'checked' : ''}>
                            <span>${t("grade.pendingGrade")}</span>
                        </label>
                        <p class="text-gray-400 text-sm">${t("grade.pendingGradeHint")}</p>
                    </div>
                    <div class="grid gap-2" id="grade-value-container-edit">
                        <label class="block mb-2">${t("grade.gradeValue")}</label>
                        ${valueInput}
                    </div>
                    <div class="grid gap-2">
                        <label class="block mb-2">
                            Textbeurteilung
                            ${isPrimarySchool ? '<span class="text-red-400">*</span>' : '<span class="text-gray-400 text-sm">(optional)</span>'}
                        </label>
                        <textarea name="gradeComment" id="grade-comment-input-edit" class="input w-full" rows="3"
                            placeholder="Schriftliche Erläuterung zur Beurteilung...">${escapeHtml(grade.comment || '')}</textarea>
                        ${isPrimarySchool ? '<p class="text-gray-400 text-sm">Pflichtfeld – schriftliche Erläuterung zur Note.</p>' : ''}
                    </div>
                `;

                showDialog("edit-dialog", t("grade.editGrade"), content, (formData) => {
                    const newName = formData.get("name");
                    const includeInAverage = formData.get("includeInAverage");
                    const isPendingChecked = formData.get("isPending") === "on";
                    let newValue = formData.get("value");
                    let enteredAsPercent = false;
                    let percentValue = null;

                    // If grade is pending, skip value validation
                    if (!isPendingChecked) {
                        if (isPrimarySchool) {
                            if (!newValue) {
                                showAlertDialog("Bitte eine Beurteilung auswählen.");
                                return false;
                            }
                            const comment = formData.get("gradeComment");
                            if (!comment || !comment.trim()) {
                                const ta = document.getElementById("grade-comment-input-edit");
                                if (ta) { ta.style.borderColor = 'var(--destructive, #ef4444)'; ta.focus(); ta.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
                                return false;
                            }
                            grade.value = parseFloat(newValue);
                        } else {
                            // Check if percentage tab exists and is active (for numeric grades)
                            if (!isPlusMinus) {
                                const percentPanel = document.getElementById("panel-grade-percent-edit");
                                const percentInput = document.getElementById("grade-percent-input-edit");
                                const directGradeInput = document.getElementById("grade-value-input-edit");

                                if (percentPanel && !percentPanel.hidden && percentInput && percentInput.value) {
                                    percentValue = parseFloat(percentInput.value);
                                    const convertedGrade = percentToGrade(percentValue);
                                    if (convertedGrade !== null) {
                                        newValue = convertedGrade.toString();
                                        enteredAsPercent = true;
                                    } else {
                                        showAlertDialog(t("error.invalidPercentage"));
                                        return false;
                                    }
                                } else if (percentPanel && !percentPanel.hidden && (!percentInput || !percentInput.value)) {
                                    showAlertDialog(t("error.enterPercentage"));
                                    return false;
                                } else if (directGradeInput && directGradeInput.value) {
                                    newValue = directGradeInput.value;
                                    enteredAsPercent = false;
                                }
                            }

                            if (isPlusMinus) {
                                grade.value = newValue;
                            } else {
                                grade.value = parseFloat(newValue);
                            }
                        }
                    } else {
                        // For pending grades, set value to null
                        grade.value = null;
                    }

                    // Save comment (mandatory for primary, optional otherwise)
                    const newComment = (formData.get("gradeComment") || '').trim();
                    if (newComment) {
                        grade.comment = newComment;
                    } else {
                        delete grade.comment;
                    }

                    grade.name = newName;
                    grade.isPending = isPendingChecked;

                    // Update "include in average" setting
                    if (includeInAverage === "on") {
                        // Checkbox is checked - remove excludeFromAverage flag
                        delete grade.excludeFromAverage;
                    } else {
                        // Checkbox is not checked - set excludeFromAverage to true
                        grade.excludeFromAverage = true;
                    }

                    // Update percentage metadata
                    if (enteredAsPercent) {
                        grade.enteredAsPercent = true;
                        grade.percentValue = percentValue;
                    } else {
                        // Remove percentage metadata if user switched to direct grade input
                        delete grade.enteredAsPercent;
                        delete grade.percentValue;
                    }

                    // Update date if changed
                    const selectedDate = formData.get("gradeDate");
                    if (selectedDate) {
                        const dateParts = selectedDate.split('-');
                        const dateObj = new Date(dateParts[0], dateParts[1] - 1, dateParts[2], 12, 0, 0);
                        grade.createdAt = dateObj.getTime();
                    }

                    // Update category if changed
                    const newCategoryId = formData.get("categoryId");
                    if (newCategoryId && newCategoryId !== grade.categoryId) {
                        const newCategory = appData.categories.find(c => c.id === newCategoryId);
                        if (newCategory) {
                            grade.categoryId = newCategory.id;
                            grade.categoryName = newCategory.name;
                            grade.weight = newCategory.weight;
                        }
                    }

                    saveData(t("toast.gradeUpdated"), "success");
                    renderStudentDetail(student.id);
                });

                // For primary school: initialize card interactions in edit dialog
                if (isPrimarySchool) {
                    setTimeout(() => {
                        const buttons = document.querySelectorAll('#primary-grade-buttons-edit .primary-grade-btn');
                        buttons.forEach(btn => {
                            btn.addEventListener('click', () => {
                                buttons.forEach(b => { b.style.borderColor = 'var(--border, #2d2d3d)'; b.style.background = ''; });
                                btn.style.borderColor = btn.dataset.color;
                                btn.style.background = btn.dataset.bg;
                                const radio = btn.querySelector('input[type="radio"]');
                                if (radio) radio.checked = true;
                            });
                        });
                        const ta = document.getElementById('grade-comment-input-edit');
                        if (ta) ta.addEventListener('input', () => { ta.style.borderColor = ''; });
                    }, 0);
                }

                // Add percentage preview listener and tab functionality for edit dialog (for numeric grades)
                if (!isPlusMinus && !isPrimarySchool) {
                    setTimeout(() => {
                        // Initialize tabs
                        initializeTabs("grade-input-tabs-edit");

                        const percentInput = document.getElementById("grade-percent-input-edit");
                        const percentPreview = document.getElementById("percent-preview-edit");
                        const gradeInput = document.getElementById("grade-value-input-edit");

                        if (percentInput && percentPreview) {
                            // Initial preview
                            const initialPercent = parseFloat(percentInput.value);
                            if (!isNaN(initialPercent) && initialPercent >= 0 && initialPercent <= 100) {
                                const gradeValue = percentToGrade(initialPercent);
                                percentPreview.textContent = t("grade.percentPreview", { grade: gradeValue });
                            }

                            // Update on input
                            percentInput.addEventListener("input", () => {
                                const percent = parseFloat(percentInput.value);
                                if (!isNaN(percent) && percent >= 0 && percent <= 100) {
                                    const gradeValue = percentToGrade(percent);
                                    percentPreview.textContent = t("grade.percentPreview", { grade: gradeValue });
                                } else {
                                    percentPreview.textContent = "";
                                }
                            });
                        }

                        // When switching from grade tab to percent tab, auto-fill percentage
                        const percentTab = document.getElementById("tab-grade-percent-edit");
                        if (percentTab && gradeInput && percentInput) {
                            percentTab.addEventListener("click", () => {
                                const currentGrade = parseFloat(gradeInput.value);
                                // Only auto-fill if percent input is empty
                                if (!percentInput.value && !isNaN(currentGrade) && currentGrade >= 1 && currentGrade <= 6) {
                                    const calculatedPercent = gradeToPercent(currentGrade);
                                    if (calculatedPercent !== null) {
                                        percentInput.value = calculatedPercent;
                                        // Trigger preview update
                                        const gradeValue = percentToGrade(calculatedPercent);
                                        if (percentPreview) {
                                            percentPreview.textContent = t("grade.percentPreview", { grade: gradeValue });
                                        }
                                    }
                                }
                            });
                        }

                        // When switching from percent tab to grade tab, optionally update grade
                        const gradeTab = document.getElementById("tab-grade-direct-edit");
                        if (gradeTab && gradeInput && percentInput) {
                            gradeTab.addEventListener("click", () => {
                                const currentPercent = parseFloat(percentInput.value);
                                // Only auto-fill if grade input is empty and we have a valid percent
                                if (!gradeInput.value && !isNaN(currentPercent) && currentPercent >= 0 && currentPercent <= 100) {
                                    const calculatedGrade = percentToGrade(currentPercent);
                                    if (calculatedGrade !== null) {
                                        gradeInput.value = calculatedGrade;
                                    }
                                }
                            });
                        }
                    }, 0);
                }

                // Add event listener for pending grade checkbox in edit dialog
                setTimeout(() => {
                    const pendingCheckboxEdit = document.getElementById("grade-is-pending-edit");
                    const gradeValueContainerEdit = document.getElementById("grade-value-container-edit");

                    if (pendingCheckboxEdit && gradeValueContainerEdit) {
                        const toggleGradeInputsEdit = () => {
                            const isPending = pendingCheckboxEdit.checked;
                            gradeValueContainerEdit.style.opacity = isPending ? "0.5" : "1";
                            gradeValueContainerEdit.style.pointerEvents = isPending ? "none" : "auto";

                            // Disable/enable all inputs in the container
                            gradeValueContainerEdit.querySelectorAll("input, select, button").forEach(el => {
                                el.disabled = isPending;
                            });
                        };

                        pendingCheckboxEdit.addEventListener("change", toggleGradeInputsEdit);
                        // Initialize state if already pending
                        if (pendingCheckboxEdit.checked) {
                            toggleGradeInputsEdit();
                        }
                    }
                }, 0);
            }
        });
    });

    // Add event listeners for delete grade buttons
    document.querySelectorAll("#student-grades-table [data-delete-grade]").forEach(btn => {
        btn.addEventListener("click", () => {
            const gradeId = btn.dataset.deleteGrade;
            const grade = student.grades.find(g => g.id === gradeId);
            if (grade) {
                const gradeName = grade.name || t('grade.unnamed') || 'Unbenannte Note';
                const gradeValue = grade.isPlusMinus ? grade.value : grade.value.toString();
                const gradeCategory = grade.categoryName || '-';
                const gradeDate = grade.createdAt
                    ? new Date(grade.createdAt).toLocaleDateString('de-AT', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric'
                    })
                    : '-';

                const message = t("confirm.deleteGrade") + ` "${gradeName}"?`;
                const details = `<strong>${t('confirm.gradeDetails') || 'Details'}:</strong><br>
                    • ${t('table.value') || 'Wert'}: ${gradeValue}<br>
                    • ${t('table.category') || 'Kategorie'}: ${gradeCategory}<br>
                    • ${t('table.date') || 'Datum'}: ${gradeDate}`;
                const warning = t('confirm.cannotBeUndone') || 'Diese Aktion kann nicht rückgängig gemacht werden.';

                showConfirmDialog(message, () => {
                    const gradeIndex = student.grades.findIndex(g => g.id === gradeId);
                    if (gradeIndex !== -1) {
                        const deletedGrade = student.grades.splice(gradeIndex, 1)[0];
                        saveData(t("toast.gradeDeleted"), "success");
                        renderStudentDetail(student.id);
                        showUndoNotification(
                            (t('toast.gradeDeletedNamed') || 'Grade "{name}" deleted').replace('{name}', gradeName),
                            () => {
                                student.grades.splice(gradeIndex, 0, deletedGrade);
                                saveData(t("toast.gradeUpdated"), "success");
                                renderStudentDetail(student.id);
                            }
                        );
                    }
                }, details, warning);
            }
        });
    });
};

/**
 * SETUP GRADE SEARCH
 *
 * Sets up the search functionality for filtering grades in the student detail view.
 * The search filters by date, category name, grade name, and grade value.
 *
 * @param {object} student - The student object with all grades
 * @param {Array} filteredGrades - The grades filtered by subject
 */
const setupGradeSearch = (student, filteredGrades) => {
    const searchInput = document.getElementById("student-grades-search");
    if (!searchInput) return;

    // Store the original filtered grades for searching
    searchInput.dataset.allGrades = JSON.stringify(filteredGrades);

    // Remove any existing event listener by cloning the element
    const newSearchInput = searchInput.cloneNode(true);
    searchInput.parentNode.replaceChild(newSearchInput, searchInput);

    // Add input event listener for search
    newSearchInput.addEventListener("input", (e) => {
        const searchTerm = e.target.value.toLowerCase().trim();
        const allGrades = JSON.parse(newSearchInput.dataset.allGrades || "[]");

        if (!searchTerm) {
            // If search is empty, show all filtered grades
            renderStudentGradesTable(student, allGrades);
            return;
        }

        // Filter grades based on search term
        const searchedGrades = allGrades.filter(grade => {
            // Format date for searching
            const date = grade.createdAt
                ? new Date(grade.createdAt).toLocaleDateString('de-AT', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric'
                })
                : '';

            // Get grade value as string
            const displayValue = grade.isPlusMinus
                ? grade.value.toString()
                : grade.value.toString();

            // Search in: date, category name, grade name, grade value
            return date.toLowerCase().includes(searchTerm) ||
                   (grade.categoryName || '').toLowerCase().includes(searchTerm) ||
                   (grade.name || '').toLowerCase().includes(searchTerm) ||
                   displayValue.toLowerCase().includes(searchTerm);
        });

        renderStudentGradesTable(student, searchedGrades);
    });

    // Clear search when view changes
    newSearchInput.value = '';
};

// ============ Anwesenheits-Dialog ============

function renderAttendanceDialog() {
  const currentYear = getCurrentYear();
  if (!currentYear || !currentYear.students || currentYear.students.length === 0) {
    showAlertDialog(t('attendance.noStudents'));
    return;
  }

  const today = new Date().toISOString().split('T')[0];
  
  // Get subjects for the current class
  const subjects = currentYear.subjects || [];
  const currentSubjectId = currentYear.currentSubjectId || (subjects.length > 0 ? subjects[0].id : null);

  // Sort students alphabetically by last name, then first name
  const students = [...currentYear.students].sort((a, b) => {
    const lastNameCmp = (a.lastName || '').localeCompare(b.lastName || '', 'de');
    if (lastNameCmp !== 0) return lastNameCmp;
    return (a.firstName || '').localeCompare(b.firstName || '', 'de');
  });

  // Generate student cards
  const studentCards = students.map(student => {
    const initials = getStudentInitials(student);
    const displayName = getStudentDisplayName(student);

    return `
      <div class="attendance-student-card" data-student-id="${safeAttr(student.id)}">
        <div class="flex items-center gap-3 p-3 border rounded-lg">
          <div class="attendance-avatar">
            <svg class="lucide lucide-user-icon lucide-user" xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
            <div class="attendance-initials">${escapeHtml(initials)}</div>
          </div>
          <div class="flex-1 min-w-0">
            <div class="font-medium truncate">${escapeHtml(displayName)}</div>
            <div class="attendance-notes-field hidden mt-1">
              <input type="text" class="input w-full text-xs py-1 h-auto" placeholder="${t('attendance.notesPlaceholder') || 'Notiz (optional)'}" maxlength="200">
            </div>
          </div>
          <div class="attendance-status-buttons flex gap-2 shrink-0">
            <button type="button" class="btn-primary attendance-status-btn selected" data-status="present" title="${t('attendance.present')}">
              <svg class="lucide lucide-check-icon lucide-check" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </button>
            <button type="button" class="btn-secondary attendance-status-btn" data-status="late" title="${t('attendance.late')}">
              <svg class="lucide lucide-clock-icon lucide-clock" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
            </button>
            <button type="button" class="btn-secondary attendance-status-btn" data-status="absent" title="${t('attendance.absent')}">
              <svg class="lucide lucide-x-icon lucide-x" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Generate subject options
  const subjectOptions = subjects.map(subject => 
    `<option value="${safeAttr(subject.id)}" ${subject.id === currentSubjectId ? 'selected' : ''}>${escapeHtml(subject.name)}</option>`
  ).join('');

  const content = `
    <form id="attendance-form" class="form grid gap-4">
      <div class="grid gap-2">
        <label for="attendance-subject">${t('attendance.subject')}</label>
        <select id="attendance-subject" name="subject" class="select" required data-icon="book-open">
          ${subjectOptions}
        </select>
      </div>
      <div class="grid gap-2">
        <label for="attendance-date">${t('attendance.date')}</label>
        <input type="date" id="attendance-date" name="date" class="input" value="${today}" required>
      </div>
      <div class="grid gap-2">
        <label>${t('attendance.students')}</label>
        <div id="attendance-student-list" class="grid gap-2 max-h-96 overflow-y-auto">
          ${studentCards}
        </div>
      </div>
    </form>
  `;

  showDialog('edit-dialog', t('attendance.title'), content, (formData) => {
    const date = formData.get('date');
    const subjectId = formData.get('subject');
    const attendanceData = {};

    // Collect attendance data from selected buttons
    document.querySelectorAll('.attendance-student-card').forEach(card => {
      const studentId = card.dataset.studentId;
      const selectedBtn = card.querySelector('.attendance-status-btn.selected');

      if (selectedBtn) {
        const notesField = card.querySelector('.attendance-notes-field input');
        attendanceData[studentId] = {
          status: selectedBtn.dataset.status,
          notes: notesField ? notesField.value : ''
        };
      }
    });

    if (Object.keys(attendanceData).length === 0) {
      showAlertDialog(t('attendance.noStatusSelected'));
      return;
    }

    bulkAddAttendance(attendanceData, date, subjectId);
  });

  // Attach click handlers to status buttons
  setTimeout(() => {
    document.querySelectorAll('.attendance-status-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const card = btn.closest('.attendance-student-card');
        const studentId = card.dataset.studentId;
        const status = btn.dataset.status;

        // Toggle selection and update button styles
        const allBtns = card.querySelectorAll('.attendance-status-btn');
        allBtns.forEach(b => {
          b.classList.remove('selected', 'btn-primary');
          b.classList.add('btn-secondary');
        });
        btn.classList.remove('btn-secondary');
        btn.classList.add('selected', 'btn-primary');

        // Show/hide notes field based on status
        const notesField = card.querySelector('.attendance-notes-field');
        if (notesField) {
          if (status === 'present') {
            notesField.classList.add('hidden');
          } else {
            notesField.classList.remove('hidden');
          }
        }
      });
    });

    // Pre-select based on existing attendance for the date and subject
    const dateInput = document.getElementById('attendance-date');
    const subjectSelect = document.getElementById('attendance-subject');
    
    if (dateInput && subjectSelect) {
      const loadAttendanceForDateAndSubject = () => {
        updateAttendanceDialogForDateAndSubject(dateInput.value, subjectSelect.value);
      };
      
      dateInput.addEventListener('change', loadAttendanceForDateAndSubject);
      subjectSelect.addEventListener('change', loadAttendanceForDateAndSubject);

      // Initial load
      updateAttendanceDialogForDateAndSubject(today, currentSubjectId);
    }
  }, 100);
}

function updateAttendanceDialogForDateAndSubject(date, subjectId) {
  document.querySelectorAll('.attendance-student-card').forEach(card => {
    const studentId = card.dataset.studentId;
    const attendance = getAttendanceForDate(studentId, date, subjectId);

    // Reset all buttons to secondary
    const allBtns = card.querySelectorAll('.attendance-status-btn');
    allBtns.forEach(b => {
      b.classList.remove('selected', 'btn-primary');
      b.classList.add('btn-secondary');
    });

    // Select existing status if available, otherwise default to present
    let selectedStatus = attendance ? attendance.status : 'present';
    const btn = card.querySelector(`.attendance-status-btn[data-status="${selectedStatus}"]`);
    if (btn) {
      btn.classList.remove('btn-secondary');
      btn.classList.add('selected', 'btn-primary');
    }

    // Show/hide notes field based on status
    const notesField = card.querySelector('.attendance-notes-field');
    const notesInput = card.querySelector('.attendance-notes-field input');
    if (notesField && notesInput) {
      if (selectedStatus === 'present') {
        notesField.classList.add('hidden');
        notesInput.value = '';
      } else {
        notesField.classList.remove('hidden');
        // Populate notes if existing attendance has notes
        if (attendance && attendance.notes) {
          notesInput.value = attendance.notes;
        } else {
          notesInput.value = '';
        }
      }
    }
  });
}

function getStudentInitials(student) {
  const first = (student.firstName || '').trim();
  const last = (student.lastName || '').trim();

  if (first && last) {
    return (first[0] + last[0]).toUpperCase();
  } else if (first) {
    return first.substring(0, 2).toUpperCase();
  } else if (last) {
    return last.substring(0, 2).toUpperCase();
  }
  return '??';
}

function renderStudentAttendanceList(student) {
  const attendanceList = document.getElementById('student-attendance-list');
  if (!attendanceList) return;

  const currentYear = getCurrentYear();
  const subjects = currentYear?.subjects || [];

  if (!student.participation || student.participation.length === 0) {
    attendanceList.innerHTML = `
      <tr>
        <td colspan="5" class="text-center text-gray-400">
          Keine Anwesenheitseinträge vorhanden
        </td>
      </tr>
    `;
    return;
  }

  // Sort by date (newest first)
  const sortedAttendance = [...student.participation].sort((a, b) => {
    return new Date(b.date) - new Date(a.date);
  });

  // Render attendance entries
  attendanceList.innerHTML = sortedAttendance.map(entry => {
    // Format date
    const date = new Date(entry.date);
    const formattedDate = date.toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });

    // Get subject name
    const subject = subjects.find(s => s.id === entry.subjectId);
    const subjectName = subject ? subject.name : '—';

    // Status badge with color
    let statusBadge = '';
    let statusText = '';
    if (entry.status === 'present') {
      statusBadge = 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
      statusText = t('attendance.present');
    } else if (entry.status === 'late') {
      statusBadge = 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400';
      statusText = t('attendance.late');
    } else if (entry.status === 'absent') {
      statusBadge = 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
      statusText = t('attendance.absent');
    }

    return `
      <tr>
        <td>${escapeHtml(formattedDate)}</td>
        <td>${escapeHtml(subjectName)}</td>
        <td>
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusBadge}">
            ${escapeHtml(statusText)}
          </span>
        </td>
        <td class="text-gray-400">${escapeHtml(entry.notes || '—')}</td>
        <td>
          <div class="flex items-center justify-end gap-1">
            <button class="btn-icon btn-secondary btn-small" data-edit-attendance="${escapeHtml(entry.id)}" data-tooltip="${t('attendance.editEntry')}" data-side="left">
              <svg class="lucide lucide-square-pen-icon lucide-square-pen" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button class="btn-icon btn-destructive btn-small" data-delete-attendance="${escapeHtml(entry.id)}" data-tooltip="${t('dialog.delete')}" data-side="left">
              <svg class="lucide lucide-trash-icon lucide-trash" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Add event listeners for edit buttons
  document.querySelectorAll('[data-edit-attendance]').forEach(btn => {
    btn.addEventListener('click', () => {
      const entryId = btn.dataset.editAttendance;
      openEditAttendanceDialog(student.id, entryId);
    });
  });

  // Add event listeners for delete buttons
  document.querySelectorAll('[data-delete-attendance]').forEach(btn => {
    btn.addEventListener('click', () => {
      const entryId = btn.dataset.deleteAttendance;
      deleteAttendanceEntry(student.id, entryId);
    });
  });
}

// ============================================================
// ATTENDANCE VIEW (full-page calendar + student panel)
// ============================================================

window._attState = {
    year: new Date().getFullYear(),
    month: new Date().getMonth(),
    selectedDate: null,
    subjectId: null,
    pending: {}   // studentId -> { status, notes }
};

const showAttendanceView = () => {
    const views = ['home-view', 'class-view', 'student-detail-view', 'settings-view'];
    views.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
    const view = document.getElementById('attendance-view');
    if (!view) return;
    view.classList.remove('hidden');
    view.style.animation = 'none';
    view.offsetHeight;
    view.style.animation = 'viewFadeIn 0.25s ease-out';

    const today = new Date().toISOString().split('T')[0];
    const currentYear = getCurrentYear();
    const subjects = currentYear?.subjects || [];
    const subjectId = currentYear?.currentSubjectId || (subjects.length > 0 ? subjects[0].id : null);

    window._attState = {
        year: new Date().getFullYear(),
        month: new Date().getMonth(),
        selectedDate: today,
        subjectId,
        pending: {}
    };

    // Breadcrumbs
    const currentClass = getCurrentClass();
    const attClassCrumb = document.getElementById('breadcrumb-att-class');
    if (attClassCrumb) attClassCrumb.textContent = currentClass?.name || '';
    document.getElementById('breadcrumb-att-home').onclick = e => { e.preventDefault(); showHomeView(); };
    document.getElementById('breadcrumb-att-class').onclick = e => { e.preventDefault(); showClassView(); };
    document.getElementById('attendance-back-btn').onclick = () => showClassView();

    _attLoadPendingForDate(today, subjectId);
    _renderAttCalendar();
    _renderAttStudentPanel();
};

/** Pre-load existing attendance into pending state for date+subject */
const _attLoadPendingForDate = (date, subjectId) => {
    const currentYear = getCurrentYear();
    if (!currentYear) return;
    const students = currentYear.students || [];
    const pending = {};
    students.forEach(s => {
        const entry = (s.participation || []).find(p => p.date === date && p.subjectId === subjectId);
        pending[s.id] = { status: entry?.status || 'present', notes: entry?.notes || '' };
    });
    window._attState.pending = pending;
};

/** Render the calendar panel */
const _renderAttCalendar = () => {
    const container = document.getElementById('att-calendar-container');
    if (!container) return;

    const { year, month, selectedDate, subjectId } = window._attState;
    const today = new Date().toISOString().split('T')[0];

    // Build attendance date map: date -> { present, late, absent } counts
    const currentYear = getCurrentYear();
    const students = currentYear?.students || [];
    const attMap = {};
    students.forEach(s => {
        (s.participation || []).filter(p => !subjectId || p.subjectId === subjectId).forEach(p => {
            if (!attMap[p.date]) attMap[p.date] = { present: 0, late: 0, absent: 0 };
            attMap[p.date][p.status] = (attMap[p.date][p.status] || 0) + 1;
        });
    });

    // Build grade date set: days on which at least one grade was recorded
    const gradeDates = new Set();
    students.forEach(s => {
        (s.grades || []).filter(g => !subjectId || g.subjectId === subjectId).forEach(g => {
            if (g.createdAt) gradeDates.add(new Date(g.createdAt).toISOString().split('T')[0]);
        });
    });

    const locale = I18n.getCurrentLanguage() === 'de' ? 'de-AT' : 'en-US';
    const monthYearLabel = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(year, month, 1));
    // Weekday abbreviations Mon–Sun (2024-01-01 = Monday)
    const weekdays = Array.from({ length: 7 }, (_, i) =>
        new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(2024, 0, i + 1))
    );

    // First day of month (adjust: Mon=0)
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    let startDow = (firstDay.getDay() + 6) % 7; // 0=Mon

    // Build day cells
    const cells = [];
    // Padding from prev month
    for (let i = 0; i < startDow; i++) {
        const d = new Date(year, month, -startDow + i + 1);
        cells.push({ date: null, label: d.getDate(), other: true });
    }
    for (let d = 1; d <= lastDay.getDate(); d++) {
        const dateStr = `${year}-${String(month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        cells.push({ date: dateStr, label: d, other: false });
    }
    // Padding to next month
    const remaining = 7 - (cells.length % 7);
    if (remaining < 7) {
        for (let i = 1; i <= remaining; i++) cells.push({ date: null, label: i, other: true });
    }

    const dayHtml = cells.map(c => {
        if (c.other) {
            return `<div class="att-day att-day-other"><span class="att-day-num">${c.label}</span></div>`;
        }
        let cls = 'att-day';
        if (c.date === today) cls += ' att-day-today';
        if (c.date === selectedDate) cls += ' att-day-selected';

        // Dots: one attendance dot (worst status wins) + optional grade dot
        let dots = '';
        const att = attMap[c.date];
        if (att) {
            if (att.absent > 0)       dots += `<span class="att-dot att-dot-absent"></span>`;
            else if (att.late > 0)    dots += `<span class="att-dot att-dot-late"></span>`;
            else if (att.present > 0) dots += `<span class="att-dot att-dot-present"></span>`;
        }
        if (gradeDates.has(c.date)) dots += `<span class="att-dot att-dot-grade"></span>`;

        return `<button class="${cls}" data-att-date="${escapeHtml(c.date)}">
            <span class="att-day-num">${c.label}</span>
            <div class="att-day-dots">${dots}</div>
        </button>`;
    }).join('');

    container.innerHTML = `
        <div class="att-cal-header">
            <button class="btn-icon-outline" id="att-prev-month" title="${escapeHtml(t('attendance.view.prevMonth'))}">
                <svg class="lucide lucide-chevron-left-icon lucide-chevron-left" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            </button>
            <span class="font-semibold text-sm">${escapeHtml(monthYearLabel)}</span>
            <button class="btn-icon-outline" id="att-next-month" title="${escapeHtml(t('attendance.view.nextMonth'))}">
                <svg class="lucide lucide-chevron-right-icon lucide-chevron-right" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
            </button>
        </div>
        <div class="att-cal-weekdays">${weekdays.map(d => `<span>${escapeHtml(d)}</span>`).join('')}</div>
        <div class="att-cal-grid">${dayHtml}</div>
        <div class="att-legend">
            <div class="att-legend-item"><span class="att-dot att-dot-present"></span> ${escapeHtml(t('attendance.view.legendAllPresent'))}</div>
            <div class="att-legend-item"><span class="att-dot att-dot-late"></span> ${escapeHtml(t('attendance.view.legendMixed'))}</div>
            <div class="att-legend-item"><span class="att-dot att-dot-absent"></span> ${escapeHtml(t('attendance.view.legendAbsent'))}</div>
            <div class="att-legend-item"><span class="att-dot att-dot-grade"></span> ${escapeHtml(t('attendance.view.legendGrade'))}</div>
        </div>`;

    // Month nav
    document.getElementById('att-prev-month').onclick = () => {
        let { year, month } = window._attState;
        month--; if (month < 0) { month = 11; year--; }
        window._attState.year = year; window._attState.month = month;
        _renderAttCalendar();
    };
    document.getElementById('att-next-month').onclick = () => {
        let { year, month } = window._attState;
        month++; if (month > 11) { month = 0; year++; }
        window._attState.year = year; window._attState.month = month;
        _renderAttCalendar();
    };

    // Day click
    container.querySelectorAll('[data-att-date]').forEach(btn => {
        btn.addEventListener('click', () => {
            const date = btn.dataset.attDate;
            window._attState.selectedDate = date;
            _attLoadPendingForDate(date, window._attState.subjectId);
            _renderAttCalendar();
            _renderAttStudentPanel();
        });
    });
};

/** Render the right student panel */
const _renderAttStudentPanel = () => {
    const container = document.getElementById('att-student-container');
    if (!container) return;

    const { selectedDate, subjectId, pending } = window._attState;
    const currentYear = getCurrentYear();
    if (!currentYear) return;

    const subjects = currentYear.subjects || [];

    if (!selectedDate) {
        container.innerHTML = `<div class="att-no-date-msg">
            <svg class="lucide lucide-calendar-icon lucide-calendar" xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.3"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <p class="text-sm">${escapeHtml(t('attendance.view.selectDate'))}</p>
        </div>`;
        return;
    }

    const locale = I18n.getCurrentLanguage() === 'de' ? 'de-AT' : 'en-US';
    const students = [...(currentYear.students || [])].sort((a, b) => {
        const l = (a.lastName || '').localeCompare(b.lastName || '', locale);
        return l !== 0 ? l : (a.firstName || '').localeCompare(b.firstName || '', locale);
    });

    const dateObj = new Date(selectedDate + 'T00:00:00');
    const dateLabel = dateObj.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const subjectOptions = subjects.map(s =>
        `<option value="${safeAttr(s.id)}" ${s.id === subjectId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`
    ).join('');

    const subjectSelectHtml = subjects.length > 0
        ? `<select id="att-subject-sel" class="select" style="font-size:0.8rem;padding:0.25rem 0.5rem;height:auto;">${subjectOptions}</select>`
        : '';

    const svgCheck = `<svg class="lucide lucide-check-icon lucide-check" xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
    const svgClock = `<svg class="lucide lucide-clock-icon lucide-clock" xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
    const svgX    = `<svg class="lucide lucide-x-icon lucide-x" xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;


    const notePlaceholder = escapeHtml(t('attendance.notesPlaceholder'));
    const studentRows = students.map(s => {
        const initials = getStudentInitials(s);
        const displayName = getStudentDisplayName(s);
        const st = pending[s.id] || { status: 'present', notes: '' };
        const pc = st.status === 'present' ? 'sel-present' : '';
        const lc = st.status === 'late'    ? 'sel-late'    : '';
        const ac = st.status === 'absent'  ? 'sel-absent'  : '';
        return `
        <div class="att-student-row" data-student-id="${safeAttr(s.id)}">
            <div class="att-initials-circle">${escapeHtml(initials)}</div>
            <span class="att-student-name">${escapeHtml(displayName)}</span>
            <input class="att-note-inline" type="text" placeholder="${notePlaceholder}" maxlength="200" value="${safeAttr(st.notes)}" data-note-for="${safeAttr(s.id)}">
            <div class="att-seg">
                <button class="att-seg-btn ${pc}" data-status="present" title="${escapeHtml(t('attendance.present'))}">${svgCheck}</button>
                <button class="att-seg-btn ${lc}" data-status="late"    title="${escapeHtml(t('attendance.late'))}">${svgClock}</button>
                <button class="att-seg-btn ${ac}" data-status="absent"  title="${escapeHtml(t('attendance.absent'))}">${svgX}</button>
            </div>
        </div>`;
    }).join('');

    container.innerHTML = `
        <div class="att-student-header">
            <div>
                <div class="att-date-label">${escapeHtml(dateLabel)}</div>
                <div class="att-date-sub">${escapeHtml(t('attendance.view.studentCount', { count: students.length }))}</div>
            </div>
            ${subjectSelectHtml}
        </div>
        <div class="att-quick-actions">
            <button class="att-quick-btn all-present" id="att-all-present">${svgCheck} ${escapeHtml(t('attendance.view.allPresent'))}</button>
            <button class="att-quick-btn all-absent"  id="att-all-absent">${svgX} ${escapeHtml(t('attendance.view.allAbsent'))}</button>
        </div>
        <div class="att-students-list" id="att-students-list">${studentRows}</div>
        <div class="att-save-footer">
            <button class="btn-primary w-full" id="att-save-btn">
                <svg class="lucide lucide-save-icon lucide-save" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                ${escapeHtml(t('attendance.view.save'))}
            </button>
        </div>`;

    // Subject change
    const subjectSel = document.getElementById('att-subject-sel');
    if (subjectSel) {
        subjectSel.addEventListener('change', () => {
            window._attState.subjectId = subjectSel.value;
            _attLoadPendingForDate(window._attState.selectedDate, subjectSel.value);
            _renderAttCalendar();
            _renderAttStudentPanel();
        });
    }

    // Quick actions
    document.getElementById('att-all-present').onclick = () => {
        students.forEach(s => { window._attState.pending[s.id] = { ...( window._attState.pending[s.id] || {}), status: 'present' }; });
        _renderAttStudentPanel();
    };
    document.getElementById('att-all-absent').onclick = () => {
        students.forEach(s => { window._attState.pending[s.id] = { ...(window._attState.pending[s.id] || {}), status: 'absent' }; });
        _renderAttStudentPanel();
    };

    // Status buttons
    container.querySelectorAll('.att-seg-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const row = btn.closest('[data-student-id]');
            const studentId = row.dataset.studentId;
            const status = btn.dataset.status;
            if (!window._attState.pending[studentId]) window._attState.pending[studentId] = { status: 'present', notes: '' };
            window._attState.pending[studentId].status = status;
            // Update visual only (no full re-render)
            row.querySelectorAll('.att-seg-btn').forEach(b => b.className = b.className.replace(/sel-\w+/g, '').trim());
            btn.classList.add(`sel-${status}`);
        });
    });

    // Inline note inputs
    container.querySelectorAll('.att-note-inline').forEach(input => {
        const studentId = input.dataset.noteFor;
        input.addEventListener('input', () => {
            if (!window._attState.pending[studentId]) window._attState.pending[studentId] = { status: 'present', notes: '' };
            window._attState.pending[studentId].notes = input.value;
        });
    });

    // Save
    document.getElementById('att-save-btn').onclick = () => {
        const { selectedDate, subjectId, pending } = window._attState;
        if (!selectedDate || !subjectId) {
            showToast(t('attendance.view.selectDateSubject'), 'warning');
            return;
        }
        bulkAddAttendance(pending, selectedDate, subjectId);
        _renderAttCalendar(); // refresh dots
    };
};

// ── Class Exam Mode ────────────────────────────────────────────────────────
const initClassExamMode = () => {
    const overlay      = document.getElementById('class-exam-overlay');
    const stepOverview = document.getElementById('class-exam-step-overview');
    const stepSetup    = document.getElementById('class-exam-step-setup');
    const stepEntry    = document.getElementById('class-exam-step-entry');
    const stepSum      = document.getElementById('class-exam-step-summary');

    const showStep = (step) => {
        if (!step) return;
        [stepOverview, stepSetup, stepEntry, stepSum].forEach(s => {
            if (!s) return;
            s.classList.add('hidden');
            s.style.display = 'none';
        });
        step.classList.remove('hidden');
        step.style.display = 'flex';
        step.style.flexDirection = 'column';
        step.style.height = '100%';
    };

    // State: { mode: 'create'|'edit', examId, name, categoryId, date, students, results, currentIdx }
    let examState = null;

    // ── Draft persistence (server-synced via appData.examDrafts) ────────────
    const _draftKey = () => {
        const cy = getCurrentYear();
        if (!cy) return null;
        return `${cy.id}.${cy.currentSubjectId || 'none'}`;
    };
    const _getDraftsStore = () => {
        if (!appData.examDrafts || typeof appData.examDrafts !== 'object') {
            appData.examDrafts = {};
        }
        return appData.examDrafts;
    };
    const _saveDraft = () => {
        if (!examState || examState.mode !== 'create') return;
        const k = _draftKey();
        if (!k) return;
        const studentIds = examState.students.map(s => s.id);
        _getDraftsStore()[k] = {
            name: examState.name,
            categoryId: examState.categoryId,
            subjectId: examState.subjectId || (getCurrentYear()?.currentSubjectId) || '',
            date: examState.date,
            studentIds,
            results: examState.results,
            currentIdx: examState.currentIdx,
            savedAt: Date.now()
        };
        // Silent server-sync (no toast)
        saveData('');
    };
    const _loadDraft = () => {
        const k = _draftKey();
        if (!k) return null;
        const store = appData.examDrafts;
        if (!store || typeof store !== 'object') return null;
        return store[k] || null;
    };
    const _clearDraft = () => {
        const k = _draftKey();
        if (!k) return;
        const store = appData.examDrafts;
        if (store && store[k]) {
            delete store[k];
            saveData('');
        }
    };

    // Legacy: migrate any old localStorage drafts to appData on first access
    const _migrateLegacyDrafts = () => {
        try {
            const cy = getCurrentYear();
            if (!cy) return;
            const k = `eduGrade.examDraft.${cy.id}.${cy.currentSubjectId || 'none'}`;
            const raw = localStorage.getItem(k);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            const newKey = `${cy.id}.${cy.currentSubjectId || 'none'}`;
            const store = _getDraftsStore();
            if (!store[newKey]) {
                store[newKey] = parsed;
                saveData('');
            }
            localStorage.removeItem(k);
        } catch (e) { /* ignore */ }
    };

    // ── Existing class exams (grouped by examId) ────────────────────────────
    const _collectExistingExams = () => {
        const cy = getCurrentYear();
        if (!cy || !cy.currentSubjectId) return [];
        const map = new Map();
        (cy.students || []).forEach(st => {
            (st.grades || []).forEach(g => {
                if (!g.examId) return;
                if (g.subjectId !== cy.currentSubjectId) return;
                if (!map.has(g.examId)) {
                    map.set(g.examId, {
                        examId: g.examId,
                        name: g.name || '',
                        categoryId: g.categoryId,
                        categoryName: g.categoryName || '',
                        date: g.createdAt,
                        count: 0
                    });
                }
                map.get(g.examId).count++;
            });
        });
        return Array.from(map.values()).sort((a, b) => b.date - a.date);
    };

    const _badge = (label, color) =>
        `<span style="display:inline-block;padding:0.15rem 0.5rem;border-radius:9999px;font-size:0.7rem;font-weight:600;background:${color}22;color:${color};border:1px solid ${color}66;">${escapeHtml(label)}</span>`;

    const _renderOverview = () => {
        const listEl     = document.getElementById('class-exam-overview-list');
        const emptyEl    = document.getElementById('class-exam-overview-empty');
        const nonEmptyEl = document.getElementById('class-exam-overview-nonempty');
        if (!listEl) return;

        const draft = _loadDraft();
        const exams = _collectExistingExams();

        const items = [];

        const isMobile = window.matchMedia('(max-width: 768px)').matches;

        const _cardInner = (name, badge, sub) => `<div class="class-exam-overview-card" style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;width:100%;padding:0.85rem 1rem;border:1px solid var(--border,#2d2d3d);border-radius:0.75rem;cursor:pointer;color:inherit;">
            <span style="display:flex;flex-direction:column;align-items:flex-start;gap:0.25rem;flex:1;min-width:0;overflow:hidden;">
                <span style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;width:100%;">
                    <strong style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;">${escapeHtml(name)}</strong>
                    ${badge}
                </span>
                <span style="font-size:0.8rem;opacity:0.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;">${sub}</span>
            </span>
            <span style="opacity:0.4;font-size:1.25rem;flex-shrink:0;">›</span>
        </div>`;

        const _card = (name, badge, sub, mainAttr, editAttr, deleteAttr) => {
            const inner = _cardInner(name, badge, sub);
            if (isMobile) {
                return swipeRowHtml({
                    contentHtml: inner,
                    contentAttr: `${mainAttr} role="button" tabindex="0"`,
                    leftAction:  { label: t('classExam.editMeta') || 'Bearbeiten', iconSvg: SWIPE_ICONS.edit,  attr: editAttr },
                    rightAction: { label: t('classExam.delete')   || 'Löschen',    iconSvg: SWIPE_ICONS.trash, attr: deleteAttr }
                });
            }
            // Desktop: card + stacked icon buttons (edit on top, delete below)
            return `<div style="display:flex;align-items:stretch;gap:0.4rem;margin-bottom:0.5rem;">
                <div style="flex:1;min-width:0;" ${mainAttr} role="button" tabindex="0">${inner}</div>
                <div style="display:flex;flex-direction:column;gap:0.3rem;flex-shrink:0;">
                    <button type="button" class="btn-icon btn-secondary" ${editAttr} title="${escapeHtml(t('classExam.editMeta') || 'Bearbeiten')}" aria-label="${escapeHtml(t('classExam.editMeta') || 'Bearbeiten')}" style="flex:1;border-radius:0.5rem;padding:0.4rem;">${SWIPE_ICONS.edit}</button>
                    <button type="button" class="btn-icon btn-destructive" ${deleteAttr} title="${escapeHtml(t('classExam.delete') || 'Löschen')}" aria-label="${escapeHtml(t('classExam.delete') || 'Löschen')}" style="flex:1;border-radius:0.5rem;padding:0.4rem;">${SWIPE_ICONS.trash}</button>
                </div>
            </div>`;
        };

        // Draft card (if any)
        if (draft && Array.isArray(draft.studentIds) && draft.studentIds.length > 0) {
            const filled = (draft.results || []).filter(r => r && (r.type === 'grade' || r.type === 'absent')).length;
            const total = draft.studentIds.length;
            const dateStr = draft.date ? new Date(draft.date).toLocaleDateString() : '';
            const subRaw = [dateStr, `${filled}/${total}`].filter(Boolean).join(' · ');
            items.push(_card(
                draft.name || t('classExam.draft') || 'Entwurf',
                _badge(t('classExam.badgeDraft') || 'Entwurf', '#f59e0b'),
                escapeHtml(subRaw),
                'data-overview-draft="1"',
                'data-overview-edit-draft="1"',
                'data-overview-delete-draft="1"'
            ));
        }

        // Completed exams
        exams.forEach(ex => {
            const dt = new Date(ex.date);
            const dateStr = isNaN(dt) ? '' : dt.toLocaleDateString();
            const subRaw = [ex.categoryName, dateStr, `${ex.count}`].filter(Boolean).join(' · ');
            items.push(_card(
                ex.name || '—',
                _badge(t('classExam.badgeDone') || 'Abgeschlossen', '#22c55e'),
                escapeHtml(subRaw),
                `data-overview-exam="${safeAttr(ex.examId)}"`,
                `data-overview-edit-exam="${safeAttr(ex.examId)}"`,
                `data-overview-delete-exam="${safeAttr(ex.examId)}"`
            ));
        });

        listEl.innerHTML = items.join('');
        const isEmpty = items.length === 0;
        if (emptyEl)    emptyEl.style.display    = isEmpty ? 'flex'  : 'none';
        if (nonEmptyEl) nonEmptyEl.style.display = isEmpty ? 'none'  : 'block';

        // Wire main card clicks
        listEl.querySelectorAll('[data-overview-draft]').forEach(el => {
            el.addEventListener('click', () => { closeAllSwipes(); _resumeDraft(); });
        });
        listEl.querySelectorAll('[data-overview-exam]').forEach(el => {
            el.addEventListener('click', () => { closeAllSwipes(); _openEditMode(el.dataset.overviewExam); });
        });

        // Side actions
        listEl.querySelectorAll('[data-overview-edit-draft]').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); closeAllSwipes(); _openMetaEditForDraft(); });
        });
        listEl.querySelectorAll('[data-overview-edit-exam]').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); closeAllSwipes(); _openMetaEditForExam(btn.dataset.overviewEditExam); });
        });
        listEl.querySelectorAll('[data-overview-delete-draft]').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); _confirmDeleteDraft(); });
        });
        listEl.querySelectorAll('[data-overview-delete-exam]').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); _confirmDeleteExam(btn.dataset.overviewDeleteExam); });
        });

        // Mobile-only: wire swipe + hint
        if (isMobile) {
            listEl.querySelectorAll('.swipe-row').forEach(attachSwipe);
            playSwipeHint(listEl, 'examOverview');
        }
    };

    // ── Delete handlers ─────────────────────────────────────────────────────
    const _confirmDeleteDraft = () => {
        showConfirmDialog(
            t('classExam.confirmDeleteDraft') || 'Entwurf wirklich löschen?',
            () => { _clearDraft(); closeAllSwipes(); _renderOverview(); showToast(t('classExam.toastDraftDeleted') || 'Entwurf gelöscht.', 'success'); },
            null, null,
            { confirmText: t('classExam.delete') || 'Löschen', cancelText: t('dialog.cancel') || 'Abbrechen' }
        );
    };
    const _confirmDeleteExam = (examId) => {
        const cy = getCurrentYear();
        if (!cy) return;
        let count = 0;
        (cy.students || []).forEach(st => (st.grades || []).forEach(g => { if (g.examId === examId) count++; }));
        const msg = (t('classExam.confirmDeleteExam') || 'Diese Klassenarbeit ({n} Noten) wirklich löschen?').replace('{n}', count);
        showConfirmDialog(
            msg,
            () => {
                (cy.students || []).forEach(st => {
                    if (Array.isArray(st.grades)) st.grades = st.grades.filter(g => g.examId !== examId);
                });
                saveData('');
                renderStudents();
                closeAllSwipes();
                _renderOverview();
                showToast(t('classExam.toastExamDeleted') || 'Klassenarbeit gelöscht.', 'success');
            },
            null,
            t('classExam.deleteWarning') || 'Alle Noten dieser Klassenarbeit werden entfernt.',
            { confirmText: t('classExam.delete') || 'Löschen', cancelText: t('dialog.cancel') || 'Abbrechen' }
        );
    };

    // ── Meta-Edit (change name/category/date without touching grades) ───────
    const _openMetaEditForExam = (examId) => {
        const cy = getCurrentYear();
        if (!cy) return;
        let proto = null;
        for (const s of (cy.students || [])) {
            const g = (s.grades || []).find(gr => gr.examId === examId);
            if (g) { proto = g; break; }
        }
        if (!proto) {
            showAlertDialog(t('classExam.errorNotFound') || 'Klassenarbeit nicht gefunden.');
            return;
        }
        examState = {
            mode: 'metaEdit',
            metaTarget: { kind: 'exam', examId },
            name: proto.name || '',
            categoryId: proto.categoryId,
            subjectId: proto.subjectId,
            date: new Date(proto.createdAt).toISOString().split('T')[0],
            students: [],
            results: [],
            currentIdx: 0
        };
        _populateSetupForm(examState);
        showStep(stepSetup);
    };
    const _openMetaEditForDraft = () => {
        const draft = _loadDraft();
        if (!draft) return;
        const cy = getCurrentYear();
        examState = {
            mode: 'metaEdit',
            metaTarget: { kind: 'draft' },
            name: draft.name || '',
            categoryId: draft.categoryId,
            subjectId: draft.subjectId || (cy && cy.currentSubjectId) || '',
            date: draft.date,
            students: [],
            results: [],
            currentIdx: 0
        };
        _populateSetupForm(examState);
        showStep(stepSetup);
    };
    const _populateSetupForm = (st) => {
        const catSel = document.getElementById('class-exam-category');
        catSel.innerHTML = appData.categories.map(cat =>
            `<option value="${safeAttr(cat.id)}" ${cat.id === st.categoryId ? 'selected' : ''}>${escapeHtml(cat.name)} (${(cat.weight*100).toFixed(0)}%)</option>`
        ).join('');
        _populateSubjectSelect(st.subjectId);
        document.getElementById('class-exam-name').value = st.name || '';
        document.getElementById('class-exam-date').value = st.date || new Date().toISOString().split('T')[0];
        document.getElementById('class-exam-setup-error').classList.add('hidden');
        const startBtn = document.getElementById('class-exam-start');
        if (startBtn) startBtn.innerHTML = `${lucideIcon('save')} ${escapeHtml(t('classExam.saveMeta') || 'Speichern')}`;
    };

    const _resumeDraft = () => {
        const cy = getCurrentYear();
        if (!cy) return;
        const draft = _loadDraft();
        if (!draft) return;
        const sortedAll = _sortStudents(cy.students || []);
        const resolved = (draft.studentIds || []).map(id => sortedAll.find(s => s.id === id)).filter(Boolean);
        if (resolved.length !== (draft.studentIds || []).length) {
            // Stale (student set changed) — offer discard
            showConfirmDialog(
                t('classExam.draftStale') || 'Schülerliste hat sich geändert. Entwurf verwerfen?',
                () => { _clearDraft(); _renderOverview(); },
                null, null,
                { confirmText: t('classExam.resumeDiscard') || 'Verwerfen', cancelText: t('dialog.cancel') || 'Abbrechen' }
            );
            return;
        }
        examState = {
            mode: 'create',
            examId: null,
            name: draft.name || '',
            categoryId: draft.categoryId,
            subjectId: draft.subjectId || (cy.currentSubjectId) || '',
            date: draft.date,
            students: resolved,
            results: draft.results || [],
            currentIdx: Math.min(draft.currentIdx || 0, resolved.length)
        };
        if (examState.currentIdx >= resolved.length) {
            _renderExamSummary();
            showStep(stepSum);
        } else {
            _renderExamEntry();
            showStep(stepEntry);
        }
    };

    // ── Edit existing exam ──────────────────────────────────────────────────
    const _sortStudents = (arr) => [...arr].sort((a, b) =>
        (a.lastName || '').localeCompare(b.lastName || '', 'de') ||
        (a.firstName || '').localeCompare(b.firstName || '', 'de')
    );

    const _openEditMode = (examId) => {
        const cy = getCurrentYear();
        if (!cy) return;
        const students = _sortStudents(cy.students || []);
        let proto = null;
        const results = students.map(s => {
            const g = (s.grades || []).find(gr => gr.examId === examId);
            if (!g) return { type: 'absent', note: '' };
            if (!proto) proto = g;
            return { type: 'grade', value: g.value, note: g.note || '', gradeId: g.id };
        });
        if (!proto) {
            // try any student in case sort missed
            for (const s of students) {
                const g = (s.grades || []).find(gr => gr.examId === examId);
                if (g) { proto = g; break; }
            }
        }
        if (!proto) {
            showAlertDialog(t('classExam.errorNotFound') || 'Klassenarbeit nicht gefunden.');
            return;
        }
        const dateStr = new Date(proto.createdAt).toISOString().split('T')[0];
        examState = {
            mode: 'edit',
            examId,
            name: proto.name || '',
            categoryId: proto.categoryId,
            subjectId: proto.subjectId,
            date: dateStr,
            students,
            results,
            currentIdx: 0
        };
        _renderExamSummary();
        showStep(stepSum);
    };

    const _populateSubjectSelect = (selectedId) => {
        const subSel = document.getElementById('class-exam-subject');
        if (!subSel) return;
        const cy = getCurrentYear();
        const subjects = (cy && Array.isArray(cy.subjects)) ? cy.subjects : [];
        const pick = selectedId || (cy && cy.currentSubjectId) || (subjects[0] && subjects[0].id) || '';
        subSel.innerHTML = subjects.map(s =>
            `<option value="${safeAttr(s.id)}" ${s.id === pick ? 'selected' : ''}>${escapeHtml(s.name)}</option>`
        ).join('');
    };

    const _resetSetupForm = () => {
        const catSel = document.getElementById('class-exam-category');
        catSel.innerHTML = appData.categories.map(cat =>
            `<option value="${safeAttr(cat.id)}">${escapeHtml(cat.name)} (${(cat.weight*100).toFixed(0)}%)</option>`
        ).join('');
        _populateSubjectSelect(null);
        document.getElementById('class-exam-date').value = new Date().toISOString().split('T')[0];
        const nameEl = document.getElementById('class-exam-name');
        nameEl.value = '';
        nameEl.removeAttribute('aria-invalid');
        document.getElementById('class-exam-date').removeAttribute('aria-invalid');
        document.getElementById('class-exam-webuntis-hint')?.classList.add('hidden');
        document.getElementById('class-exam-setup-error').classList.add('hidden');
        const startBtn = document.getElementById('class-exam-start');
        if (startBtn) startBtn.innerHTML = `<span data-i18n="classExam.start">${escapeHtml(t('classExam.start') || 'Noten eintragen')}</span> ${lucideIcon('arrow-right')}`;
    };

    // ── Open / Close ────────────────────────────────────────────────────────
    const openExam = () => {
        const currentYear = getCurrentYear();
        if (!currentYear || !currentYear.students || currentYear.students.length === 0) {
            showAlertDialog(t('emptyState.noStudents') || 'Keine Schüler in dieser Klasse.');
            return;
        }
        if (!appData.categories || appData.categories.length === 0) {
            showAlertDialog('Bitte zuerst mindestens eine Kategorie in den Einstellungen anlegen.');
            return;
        }

        if (stepOverview) {
            _migrateLegacyDrafts();
            _renderOverview();
            showStep(stepOverview);
        } else {
            // Fallback: HTML noch alt geladen — gehe direkt zum Setup
            _resetSetupForm();
            showStep(stepSetup);
            setTimeout(() => document.getElementById('class-exam-name')?.focus(), 50);
        }
        overlay.classList.add('active');
    };

    const closeExam = () => {
        overlay.classList.remove('active');
        examState = null;
    };

    // ── Step 1 → 2 ──────────────────────────────────────────────────────────
    document.getElementById('class-exam-start').addEventListener('click', () => {
        const name = document.getElementById('class-exam-name').value.trim();
        const categoryId = document.getElementById('class-exam-category').value;
        const subjectId = document.getElementById('class-exam-subject')?.value || (getCurrentYear()?.currentSubjectId) || '';
        const date = document.getElementById('class-exam-date').value;
        const errEl = document.getElementById('class-exam-setup-error');

        const nameInput = document.getElementById('class-exam-name');
        const dateInput = document.getElementById('class-exam-date');
        nameInput.removeAttribute('aria-invalid');
        dateInput.removeAttribute('aria-invalid');
        if (!name) {
            errEl.textContent = t('classExam.errorNoName');
            errEl.classList.remove('hidden');
            nameInput.setAttribute('aria-invalid', 'true');
            return;
        }
        if (!date) {
            errEl.textContent = t('classExam.errorNoDate');
            errEl.classList.remove('hidden');
            dateInput.setAttribute('aria-invalid', 'true');
            return;
        }
        errEl.classList.add('hidden');

        // metaEdit: update meta on existing exam grades or draft, then back to overview
        if (examState && examState.mode === 'metaEdit') {
            const tgt = examState.metaTarget || {};
            const cy = getCurrentYear();
            const catObj = (appData.categories || []).find(c => c.id === categoryId);
            const newTimestamp = new Date(date).getTime() || Date.now();

            if (tgt.kind === 'exam' && tgt.examId && cy) {
                (cy.students || []).forEach(st => {
                    (st.grades || []).forEach(g => {
                        if (g.examId === tgt.examId) {
                            g.name = name;
                            g.categoryId = categoryId;
                            g.subjectId = subjectId;
                            if (catObj) {
                                g.categoryName = catObj.name;
                                g.weight = catObj.weight;
                            }
                            g.createdAt = newTimestamp;
                        }
                    });
                });
                saveData('');
                renderStudents();
                showToast(t('classExam.toastMetaUpdated') || 'Klassenarbeit aktualisiert.', 'success');
            } else if (tgt.kind === 'draft') {
                const draft = _loadDraft();
                if (draft) {
                    draft.name = name;
                    draft.categoryId = categoryId;
                    draft.subjectId = subjectId;
                    draft.date = date;
                    _getDraftsStore()[_draftKey()] = draft;
                    saveData('');
                    showToast(t('classExam.toastMetaUpdated') || 'Klassenarbeit aktualisiert.', 'success');
                }
            }
            examState = null;
            _renderOverview();
            showStep(stepOverview);
            return;
        }

        const currentYear = getCurrentYear();
        const students = _sortStudents(currentYear.students || []);

        examState = { mode: 'create', examId: null, name, categoryId, subjectId, date, students, results: [], currentIdx: 0 };
        _saveDraft();
        _renderExamEntry();
        showStep(stepEntry);
    });

    // ── Entry rendering ──────────────────────────────────────────────────────
    const _renderExamEntry = () => {
        if (!examState) return;
        const { students, currentIdx } = examState;

        if (currentIdx >= students.length) {
            _renderExamSummary();
            showStep(stepSum);
            return;
        }

        const student = students[currentIdx];
        const displayName = `${escapeHtml(student.lastName || '')}${student.firstName ? ', ' + escapeHtml(student.firstName) : ''}`;
        document.getElementById('class-exam-student-name').innerHTML = displayName;

        const pct = Math.round((currentIdx / students.length) * 100);
        document.getElementById('class-exam-progress-fill').style.width = pct + '%';
        document.getElementById('class-exam-progress-text').textContent = `${currentIdx + 1} / ${students.length}`;

        document.getElementById('class-exam-undo').disabled = currentIdx === 0;
        document.getElementById('class-exam-note').value = '';
    };

    // Grade buttons
    document.querySelectorAll('[data-exam-grade]').forEach(btn => {
        btn.addEventListener('click', () => {
            if (!examState) return;
            const grade = parseInt(btn.dataset.examGrade, 10);
            const note = document.getElementById('class-exam-note').value.trim();
            examState.results[examState.currentIdx] = { type: 'grade', value: grade, note };
            examState.currentIdx++;
            _saveDraft();
            _renderExamEntry();
        });
    });

    // Absent button
    document.getElementById('class-exam-absent-btn').addEventListener('click', () => {
        if (!examState) return;
        const note = document.getElementById('class-exam-note').value.trim();
        examState.results[examState.currentIdx] = { type: 'absent', note };
        examState.currentIdx++;
        _saveDraft();
        _renderExamEntry();
    });

    // Undo
    document.getElementById('class-exam-undo').addEventListener('click', () => {
        if (!examState || examState.currentIdx === 0) return;
        examState.currentIdx--;
        examState.results[examState.currentIdx] = undefined;
        _saveDraft();
        _renderExamEntry();
    });

    // Back to overview from entry (auto-saves draft in create mode)
    document.getElementById('class-exam-back-to-setup').addEventListener('click', () => {
        if (examState && examState.mode === 'create') {
            _saveDraft();
        }
        examState = null;
        _renderOverview();
        showStep(stepOverview);
    });

    // ── Summary ──────────────────────────────────────────────────────────────
    const _gradeColor = (g) => {
        if (g === 1) return '#22c55e'; if (g === 2) return '#3b82f6';
        if (g === 3) return '#eab308'; if (g === 4) return '#f97316';
        return '#ef4444';
    };

    const _renderExamSummary = () => {
        if (!examState) return;
        const { students, results, mode } = examState;
        const listEl = document.getElementById('class-exam-summary-list');
        listEl.innerHTML = students.map((s, i) => {
            const r = results[i];
            const name = `${escapeHtml(s.lastName || '')}${s.firstName ? ', ' + escapeHtml(s.firstName) : ''}`;
            let right = '';
            if (!r || r.type === 'absent') {
                right = `<span class="exam-absent-label">Abwesend</span>`;
            } else {
                const color = _gradeColor(r.value);
                right = `<span class="exam-grade-badge grade-${r.value}" style="background:${color}20;color:${color};">${r.value}</span>`;
            }
            const noteHtml = r?.note ? `<span class="exam-summary-note">${escapeHtml(r.note)}</span>` : '';
            return `<div class="class-exam-summary-row" data-row-idx="${i}" style="cursor:pointer;"><span>${name}${noteHtml}</span>${right}</div>
                <div class="class-exam-inline-edit" data-edit-for="${i}" style="display:none;padding:0.5rem 0.75rem;border-top:1px solid var(--border-color,#374151);background:rgba(255,255,255,0.02);">
                    <div style="display:flex;gap:0.4rem;flex-wrap:wrap;margin-bottom:0.4rem;">
                        ${[1,2,3,4,5].map(g => `<button type="button" class="class-exam-grade-btn g${g}" data-inline-grade="${g}" data-row="${i}" style="flex:1;min-width:2.5rem;padding:0.4rem;">${g}</button>`).join('')}
                        <button type="button" class="class-exam-absent-btn" data-inline-absent="${i}" style="flex:2;padding:0.4rem;font-size:0.85rem;">${escapeHtml(t('classExam.absent') || 'Abwesend')}</button>
                    </div>
                    <input type="text" class="input w-full" data-inline-note="${i}" placeholder="${escapeHtml(t('grade.note') || 'Notiz...')}" value="${escapeHtml(r?.note || '')}" style="margin-bottom:0.4rem;">
                    <div style="display:flex;gap:0.4rem;justify-content:flex-end;">
                        <button type="button" class="btn-outline" data-inline-cancel="${i}" style="padding:0.3rem 0.7rem;">${escapeHtml(t('dialog.cancel') || 'Abbrechen')}</button>
                    </div>
                </div>`;
        }).join('');

        // Update save button label based on mode
        const saveBtn = document.getElementById('class-exam-save');
        if (saveBtn) {
            saveBtn.innerHTML = `${lucideIcon('save')} ${escapeHtml((mode === 'edit')
                ? (t('classExam.saveEdit') || 'Änderungen speichern')
                : (t('classExam.save') || 'Alle Noten speichern'))}`;
        }

        // Wire row clicks (toggle inline edit)
        listEl.querySelectorAll('.class-exam-summary-row').forEach(row => {
            row.addEventListener('click', () => {
                const idx = row.dataset.rowIdx;
                const editEl = listEl.querySelector(`.class-exam-inline-edit[data-edit-for="${idx}"]`);
                if (!editEl) return;
                // close all others
                listEl.querySelectorAll('.class-exam-inline-edit').forEach(e => { if (e !== editEl) e.style.display = 'none'; });
                editEl.style.display = (editEl.style.display === 'none') ? 'block' : 'none';
            });
        });

        // Wire inline grade buttons
        listEl.querySelectorAll('[data-inline-grade]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const i = parseInt(btn.dataset.row, 10);
                const grade = parseInt(btn.dataset.inlineGrade, 10);
                const noteInput = listEl.querySelector(`[data-inline-note="${i}"]`);
                examState.results[i] = { type: 'grade', value: grade, note: (noteInput?.value || '').trim() };
                _renderExamSummary();
            });
        });
        listEl.querySelectorAll('[data-inline-absent]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const i = parseInt(btn.dataset.inlineAbsent, 10);
                const noteInput = listEl.querySelector(`[data-inline-note="${i}"]`);
                examState.results[i] = { type: 'absent', note: (noteInput?.value || '').trim() };
                _renderExamSummary();
            });
        });
        listEl.querySelectorAll('[data-inline-cancel]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const i = btn.dataset.inlineCancel;
                const editEl = listEl.querySelector(`.class-exam-inline-edit[data-edit-for="${i}"]`);
                if (editEl) editEl.style.display = 'none';
            });
        });
        // prevent inline-edit clicks from bubbling and toggling row
        listEl.querySelectorAll('.class-exam-inline-edit').forEach(el => {
            el.addEventListener('click', (e) => e.stopPropagation());
        });
    };

    // Back to entry from summary
    document.getElementById('class-exam-back-to-entry').addEventListener('click', () => {
        if (!examState) return;
        examState.currentIdx = examState.students.length - 1;
        // roll back to last non-undefined
        while (examState.currentIdx > 0 && examState.results[examState.currentIdx] === undefined) {
            examState.currentIdx--;
        }
        _renderExamEntry();
        showStep(stepEntry);
    });

    // Save all grades
    document.getElementById('class-exam-save').addEventListener('click', () => {
        if (!examState) return;
        const { mode, name, categoryId, date, students, results } = examState;
        const currentYear = getCurrentYear();
        if (!currentYear) return;

        const subjectId = examState.subjectId || currentYear.currentSubjectId;
        const gradeTimestamp = new Date(date).getTime() || Date.now();
        const examId = (mode === 'edit' && examState.examId)
            ? examState.examId
            : `exam_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        // Edit mode: remove all prior grades belonging to this examId across all students
        if (mode === 'edit') {
            (currentYear.students || []).forEach(st => {
                if (Array.isArray(st.grades)) {
                    st.grades = st.grades.filter(g => g.examId !== examState.examId);
                }
            });
        }

        let saved = 0;
        students.forEach((student, i) => {
            const r = results[i];
            if (!r || r.type === 'absent') return;
            addGrade(student.id, categoryId, r.value, name, subjectId, gradeTimestamp, false, r.note || '', examId);
            saved++;
        });

        saveData();
        _clearDraft();
        closeExam();
        renderStudents();
        const msg = (mode === 'edit')
            ? (t('classExam.toastUpdated') || '{n} Noten aktualisiert.').replace('{n}', saved)
            : `${saved} Note${saved !== 1 ? 'n' : ''} gespeichert.`;
        showToast(msg, 'success');

        // Best-effort: push new (not edited) exams to a mapped Moodle course
        // calendar. Fire-and-forget — grades are already saved above either way.
        if (mode !== 'edit' && saved > 0 && typeof window.pushMoodleExamEvent === 'function') {
            const cls = getCurrentClass();
            if (cls && appData.moodleClassMap && appData.moodleClassMap[cls.id]) {
                window.pushMoodleExamEvent(cls.id, name, Math.floor(gradeTimestamp / 1000));
            }
        }
    });

    // Cancel from summary
    document.getElementById('class-exam-cancel-summary').addEventListener('click', () => {
        _clearDraft();
        closeExam();
    });

    // Overview close → close overlay completely
    document.getElementById('class-exam-close').addEventListener('click', closeExam);
    // Setup close → back to overview (not full close)
    const closeSetupBtn = document.getElementById('class-exam-close-setup');
    if (closeSetupBtn) closeSetupBtn.addEventListener('click', () => {
        examState = null;
        _renderOverview();
        showStep(stepOverview);
    });

    // Overview → Setup (new exam) — both buttons (compact + empty-state)
    const _gotoNew = () => {
        _resetSetupForm();
        showStep(stepSetup);
        setTimeout(() => document.getElementById('class-exam-name')?.focus(), 50);
        _suggestWebUntisDate();
    };

    // Best-effort: prefill the date field from the connected WebUntis
    // timetable's next matching lesson. No-ops silently if WebUntis isn't
    // connected or nothing matches — see suggestWebUntisExamDate() in
    // webuntis.js for the matching logic.
    const _suggestWebUntisDate = async () => {
        if (typeof window.suggestWebUntisExamDate !== 'function') return;
        const cy = getCurrentYear();
        const cls = getCurrentClass();
        const subjectId = document.getElementById('class-exam-subject')?.value;
        const subject = (cy && cy.subjects || []).find(s => s.id === subjectId);
        const hint = await window.suggestWebUntisExamDate(subject && subject.name, cls && cls.name);
        const hintEl = document.getElementById('class-exam-webuntis-hint');
        if (!hint || !hintEl) return;
        // Don't clobber a date the user already changed while we were waiting.
        const dateInput = document.getElementById('class-exam-date');
        const todayStr = new Date().toISOString().split('T')[0];
        if (dateInput && dateInput.value === todayStr) {
            dateInput.value = hint.date;
        }
        hintEl.textContent = t('webuntis.examDateSuggested', { date: hint.date });
        hintEl.classList.remove('hidden');
    };
    const newBtn      = document.getElementById('class-exam-new-btn');
    const newBtnEmpty = document.getElementById('class-exam-new-btn-empty');
    if (newBtn)      newBtn.addEventListener('click', _gotoNew);
    if (newBtnEmpty) newBtnEmpty.addEventListener('click', _gotoNew);

    // Continue Later → save draft (already auto-saved), close overlay
    const continueLaterBtn = document.getElementById('class-exam-continue-later');
    if (continueLaterBtn) continueLaterBtn.addEventListener('click', () => {
        if (examState && examState.mode === 'create') {
            _saveDraft();
            showToast(t('classExam.toastDraftSaved') || 'Entwurf gespeichert.', 'success');
        }
        closeExam();
    });

    // Setup → Overview (back arrow): discard metaEdit / new state, return
    const backToOverviewBtn = document.getElementById('class-exam-back-to-overview');
    if (backToOverviewBtn) backToOverviewBtn.addEventListener('click', () => {
        examState = null;
        _renderOverview();
        showStep(stepOverview);
    });

    // Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay.classList.contains('active')) closeExam();
    });

    // Open trigger
    const triggerBtn = document.getElementById('class-exam-btn');
    if (triggerBtn) triggerBtn.addEventListener('click', openExam);
};
