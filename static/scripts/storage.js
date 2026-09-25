// storage.js
// This file manages saving and loading data via API.
// Sensitive data (names, grades, classes) is NEVER persisted in localStorage.
// On save failure, the unsaved blob is held only in this module's memory
// and retried; if the tab is closed while a retry is pending, the user is
// warned via the standard beforeunload prompt.

// Debounce timer for API calls
let saveDebounceTimer = null;
const SAVE_DEBOUNCE_MS = 500;

// In-memory retry queue for failed saves. Holds the most recent unsaved
// snapshot only — newer attempts overwrite older ones (the full blob is
// always self-contained, so older retries become redundant).
let pendingSaveSnapshot = null;
let retryTimer = null;
const RETRY_DELAY_MS = 5000;

// Save-progress indicator: always shown when a save runs, with a minimum
// visible duration so it doesn't flash and leave the user uncertain.
let activeSaveCount = 0;
let saveIndicatorShownAt = 0;
let saveIndicatorHideTimer = null;
const SAVE_INDICATOR_MIN_VISIBLE_MS = 500;

const showSaveIndicator = () => {
    const el = document.getElementById('save-indicator');
    if (!el) return;
    const txt = document.getElementById('save-indicator-text');
    if (txt && typeof t === 'function') {
        try { txt.textContent = t('loading.saving'); } catch (_) { /* keep default */ }
    }
    el.classList.remove('hidden');
    el.classList.add('flex');
};

const hideSaveIndicator = () => {
    const el = document.getElementById('save-indicator');
    if (!el) return;
    el.classList.add('hidden');
    el.classList.remove('flex');
};

const beginSaveIndicator = () => {
    activeSaveCount++;
    if (activeSaveCount === 1) {
        // Cancel a pending hide from a previous quick save.
        if (saveIndicatorHideTimer) {
            clearTimeout(saveIndicatorHideTimer);
            saveIndicatorHideTimer = null;
        }
        saveIndicatorShownAt = Date.now();
        showSaveIndicator();
    }
};

// Persistent save-failure banner: stays visible while there's an unsaved
// snapshot, with a retry button that triggers flushPendingSave() immediately.
const showSaveErrorBanner = () => {
    const el = document.getElementById('save-error-banner');
    if (!el) return;
    el.classList.remove('hidden');
    el.classList.add('flex');
    // Defensive: in case the `hidden` Tailwind utility is loaded after `flex`,
    // force display via inline style so the banner is guaranteed visible.
    el.style.display = 'flex';
};

const hideSaveErrorBanner = () => {
    const el = document.getElementById('save-error-banner');
    if (!el) return;
    el.classList.add('hidden');
    el.classList.remove('flex');
    el.style.display = '';
};

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('save-error-banner-retry');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        if (pendingSaveSnapshot === null) {
            hideSaveErrorBanner();
            return;
        }
        // Cancel any scheduled automatic retry — the user is asking for one now.
        if (retryTimer) {
            clearTimeout(retryTimer);
            retryTimer = null;
        }
        const originalHtml = btn.innerHTML;
        btn.disabled = true;
        try { btn.textContent = t('save.retryRunning'); } catch (_) { /* keep */ }
        try {
            await flushPendingSave();
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    });
});

const endSaveIndicator = () => {
    activeSaveCount = Math.max(0, activeSaveCount - 1);
    if (activeSaveCount > 0) return;
    const elapsed = Date.now() - saveIndicatorShownAt;
    const remaining = SAVE_INDICATOR_MIN_VISIBLE_MS - elapsed;
    if (remaining > 0) {
        if (saveIndicatorHideTimer) clearTimeout(saveIndicatorHideTimer);
        saveIndicatorHideTimer = setTimeout(() => {
            saveIndicatorHideTimer = null;
            if (activeSaveCount === 0) hideSaveIndicator();
        }, remaining);
    } else {
        hideSaveIndicator();
    }
};

// ============ HEARTBEAT SYSTEM ============
// Keeps server-side cache alive while page is open

const HEARTBEAT_INTERVAL_MS = 30000; // 30 seconds
let heartbeatTimer = null;

const startHeartbeat = () => {
    // Clear any existing timer
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
    }

    // Send heartbeat immediately
    sendHeartbeat();

    // Then send every 30 seconds
    heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
};

const sendHeartbeat = async () => {
    try {
        await fetch('/api/heartbeat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        // Silently ignore heartbeat errors
        console.debug('Heartbeat failed:', error);
    }
};

const stopHeartbeat = () => {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
};

// Notify server when page is closed to clear cache
const notifyDisconnect = () => {
    // Use sendBeacon for reliable delivery on page close
    navigator.sendBeacon('/api/disconnect', JSON.stringify({}));
};

// Start heartbeat when page loads
document.addEventListener('DOMContentLoaded', startHeartbeat);

// Stop heartbeat and notify disconnect when page closes
window.addEventListener('pagehide', () => {
    stopHeartbeat();
    notifyDisconnect();
});

// Also handle visibility change (tab hidden for long time)
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopHeartbeat();
    } else {
        startHeartbeat();
    }
});

// ============ OFFLINE INDICATOR ============
const updateOfflineIndicator = (isOffline, text = null) => {
    const indicator = document.getElementById('offline-indicator');
    if (!indicator) return;
    const textEl = document.getElementById('offline-indicator-text');
    if (isOffline) {
        indicator.classList.remove('hidden');
        indicator.classList.add('flex');
        if (textEl && text) textEl.textContent = text;
    } else {
        indicator.classList.add('hidden');
        indicator.classList.remove('flex');
    }
};

window.addEventListener('online', () => updateOfflineIndicator(false));
window.addEventListener('offline', () => updateOfflineIndicator(true, 'Offline'));

// On page close: try one last best-effort sync via sendBeacon (fire-and-forget,
// works even after the page is unloaded). If a save is still pending or has
// already failed, warn the user with the standard browser prompt so they can
// stay on the page and let the retry succeed.
window.addEventListener('beforeunload', (e) => {
    const hasPending = saveDebounceTimer !== null || pendingSaveSnapshot !== null;
    if (!hasPending) return;

    if (saveDebounceTimer) {
        clearTimeout(saveDebounceTimer);
        saveDebounceTimer = null;
    }

    try {
        const blob = new Blob([JSON.stringify(appData)], { type: 'application/json' });
        navigator.sendBeacon('/api/data', blob);
    } catch (_) {
        // ignore
    }

    if (pendingSaveSnapshot !== null) {
        // Standard browser confirmation: most browsers ignore the custom string
        // but will show a generic "leave site?" dialog when preventDefault is set.
        e.preventDefault();
        e.returnValue = '';
        return '';
    }
});

/**
 * SAVE DATA
 *
 * Saves the complete appData object locally and on the server.
 * Shows a toast notification afterwards.
 *
 * @param {string} message - The message to display (Default: "Data saved!")
 * @param {string} type - Toast type: "success", "error", "info" (Default: "success")
 */
const scheduleRetry = () => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
        retryTimer = null;
        if (pendingSaveSnapshot !== null) flushPendingSave();
    }, RETRY_DELAY_MS);
};

// Attempt to push the latest pending snapshot to the server.
// On failure the snapshot is kept and a retry is scheduled.
const flushPendingSave = async () => {
    if (pendingSaveSnapshot === null) return;
    const body = pendingSaveSnapshot;
    beginSaveIndicator();
    try {
        const response = await fetch('/api/data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body
        });
        if (response.ok) {
            pendingSaveSnapshot = null;
            updateOfflineIndicator(false);
            hideSaveErrorBanner();
            return;
        }
        if (response.status === 401) {
            const data = await response.json().catch(() => ({}));
            // Keep snapshot in memory so the user can re-login and retry
            showSessionExpiredDialog(data.message ? t(data.message) : t("error.sessionExpiredMsg"));
            showSaveErrorBanner();
            return;
        }
        if (response.status === 429) {
            const data = await response.json().catch(() => ({}));
            showRateLimitDialog(data.message ? t(data.message, data.message_params || {}) : t("error.tooManyRequestsMsg"));
            showSaveErrorBanner();
            scheduleRetry();
            return;
        }
        updateOfflineIndicator(true, 'Sync-Fehler');
        showSaveErrorBanner();
        scheduleRetry();
    } catch (error) {
        console.error('Error saving to server:', error);
        updateOfflineIndicator(true, 'Offline');
        showSaveErrorBanner();
        scheduleRetry();
    } finally {
        endSaveIndicator();
    }
};

const saveData = (message = "Data saved!", type = "success") => {
    // Silent save: pass empty message to skip the toast (used for autosave/draft flows)
    if (message) {
        const teacherName = appData.teacherName || "there";
        const personalizedMessage = message.replace("successfully", `successfully, ${teacherName}`);
        showToast(personalizedMessage, type);
    }

    if (saveDebounceTimer) clearTimeout(saveDebounceTimer);

    saveDebounceTimer = setTimeout(async () => {
        saveDebounceTimer = null;
        // Stash latest blob as the pending snapshot. flushPendingSave clears it on success.
        pendingSaveSnapshot = JSON.stringify(appData);
        await flushPendingSave();
    }, SAVE_DEBOUNCE_MS);
};


/**
 * One-shot rescue: if a previous version of the app left an unsynced blob in
 * localStorage, push it to the server before we wipe it. This runs at most
 * once per browser per upgrade and protects users who had pending offline
 * changes when we removed the localStorage fallback.
 */
const rescueLegacyLocalStorage = async () => {
    const legacyData = localStorage.getItem('notenverwaltung');
    if (!legacyData) return;
    const wasPending = localStorage.getItem('pendingServerSync') === 'true';

    // No unsynced changes → server is already authoritative, safe to wipe.
    if (!wasPending) {
        localStorage.removeItem('notenverwaltung');
        localStorage.removeItem('pendingServerSync');
        return;
    }

    // Unsynced changes exist. Push them to the server first; only wipe local
    // copy on a confirmed successful sync. Otherwise keep the data and try
    // again on the next page load — better to keep a sensitive blob around
    // briefly than to silently lose offline changes.
    try {
        const response = await fetch('/api/data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: legacyData
        });
        if (response.ok) {
            localStorage.removeItem('notenverwaltung');
            localStorage.removeItem('pendingServerSync');
        } else {
            console.warn('Legacy localStorage rescue: server rejected sync, keeping local copy for retry.', response.status);
        }
    } catch (err) {
        console.warn('Legacy localStorage rescue: network failure, keeping local copy for retry.', err);
    }
};

/**
 * LOAD DATA
 *
 * Server is the single source of truth. No localStorage fallback for user data.
 * Called on application start (DOMContentLoaded).
 */
const loadData = async () => {
    showLoadingOverlay(t('loading.loadingData'), t('loading.decrypting'));

    // Rescue any legacy localStorage payload before we go online.
    await rescueLegacyLocalStorage();

    let loadSucceeded = false;

    try {
        const response = await fetch('/api/data');

        if (response.ok) {
            appData = await response.json();
            loadSucceeded = true;
        } else if (response.status === 401) {
            // The session cookie may still be valid but unusable (e.g. the
            // server's in-memory encryption key was cleared by a restart).
            // Tear down the session on the server first so the /login page
            // doesn't immediately bounce us back here in a redirect loop.
            try {
                await fetch('/api/logout', { method: 'POST' });
            } catch (_) { /* ignore — logout is best-effort */ }
            hideLoadingOverlay();
            window.location.href = '/login';
            return false;
        } else {
            console.error("Server error loading data:", response.status);
            showToast(t("toast.localSyncFailed"), "error");
        }
    } catch (error) {
        console.error("Network error loading data:", error);
        updateOfflineIndicator(true, 'Offline');
        showToast(t("toast.localNetworkError"), "error");
    }

    migrateData();

    if (appData.language && appData.language !== I18n.getCurrentLanguage()) {
        I18n.setLanguage(appData.language);
    }

    // Apply user-selected accent from loaded data
    if (appData.accentColor && window.EduGradeAccent) {
        window.EduGradeAccent.apply(appData.accentColor);
    }

    hideLoadingOverlay();
    return loadSucceeded;
};

/**
 * DATA MIGRATION
 *
 * Ensures old data structures are compatible.
 */
const migrateData = () => {
    // MIGRATION: Migrate to year-based structure first (before other migrations)
    migrateToYearStructure();

    // If classes exist, set the first one as current
    if (appData.classes && appData.classes.length > 0 && !appData.currentClassId) {
        appData.currentClassId = appData.classes[0].id;
    }

    // MIGRATION: Make old data compatible
    if (!appData.participationSettings) {
        appData.participationSettings = { plusValue: 0.1, minusValue: 0.1 };
    }

    // MIGRATION: Initialize attendance settings
    if (!appData.attendanceSettings) {
        appData.attendanceSettings = { enabled: false, minAttendancePercent: 75, warningThreshold: 5 };
    }

    // MIGRATION: Initialize participation/behavior arrays for existing students.
    // Always sending `behavior` also tells the server this client knows the field
    // (see carry_over_student_fields in app.py).
    if (appData.classes) {
        appData.classes.forEach(cls => {
            if (cls.years) {
                cls.years.forEach(year => {
                    if (year.students) {
                        year.students.forEach(student => {
                            if (!student.participation) {
                                student.participation = [];
                            }
                            if (!Array.isArray(student.behavior)) {
                                student.behavior = [];
                            }
                        });
                    }
                });
            }
        });
    }

    // MIGRATION: ensure hiddenSubjectSuggestions exists
    if (!appData.hiddenSubjectSuggestions) {
        appData.hiddenSubjectSuggestions = [];
    }

    // MIGRATION: ensure schoolType exists
    if (!appData.schoolType) {
        appData.schoolType = "secondary";
    }

    // MIGRATION: ensure accentColor exists
    if (!appData.accentColor) {
        appData.accentColor = "coral";
    }

    // MIGRATION: defaultSubjects from string[] to object[]
    if (appData.defaultSubjects && appData.defaultSubjects.length > 0) {
        appData.defaultSubjects = appData.defaultSubjects.map(s => {
            if (typeof s === 'string') {
                return { name: s, minAttendancePercent: null, warningThreshold: null, attendanceAutoGrading: null };
            }
            if (!('minAttendancePercent' in s)) s.minAttendancePercent = null;
            if (!('warningThreshold' in s)) s.warningThreshold = null;
            if (!('attendanceAutoGrading' in s)) s.attendanceAutoGrading = null;
            return s;
        });
    }

    // MIGRATION: Add per-subject attendance settings fields to existing subjects
    if (appData.classes) {
        appData.classes.forEach(cls => {
            if (cls.years) {
                cls.years.forEach(year => {
                    if (year.subjects) {
                        year.subjects.forEach(subject => {
                            if (!('minAttendancePercent' in subject)) subject.minAttendancePercent = null;
                            if (!('warningThreshold' in subject)) subject.warningThreshold = null;
                            if (!('attendanceAutoGrading' in subject)) subject.attendanceAutoGrading = null;
                        });
                    }
                });
            }
        });
    }

    // MIGRATION: Move categories from class level to global level
    if (!appData.categories) {
        appData.categories = [];
    }

    // Collect all categories from classes and add to global categories
    const existingCategoryIds = new Set(appData.categories.map(c => c.id));
    if (appData.classes) {
        appData.classes.forEach(cls => {
            if (cls.categories && Array.isArray(cls.categories)) {
                cls.categories.forEach(cat => {
                    if (!existingCategoryIds.has(cat.id)) {
                        appData.categories.push(cat);
                        existingCategoryIds.add(cat.id);
                    }
                });
                delete cls.categories;
            }
        });
    }

    // MIGRATION: Initialize percentage ranges for grades (if not present)
    if (!appData.gradePercentageRanges) {
        appData.gradePercentageRanges = [
            { grade: 1, minPercent: 85, maxPercent: 100 },
            { grade: 2, minPercent: 70, maxPercent: 84 },
            { grade: 3, minPercent: 55, maxPercent: 69 },
            { grade: 4, minPercent: 40, maxPercent: 54 },
            { grade: 5, minPercent: 0, maxPercent: 39 }
        ];
    }

    // MIGRATION: Tutorial status
    if (!appData.tutorial) {
        appData.tutorial = {
            completed: false,
            currentStep: 0,
            neverShowAgain: false
        };
    }

    // Add language field
    if (!appData.language) {
        appData.language = I18n.getCurrentLanguage();
    }

    // MIGRATION: plusMinusPercentages (replaces old plusMinusGradeSettings)
    if (!appData.plusMinusPercentages) {
        appData.plusMinusPercentages = {
            plus: 100,
            neutral: 50,
            minus: 0
        };
    }
    // Remove old plusMinusGradeSettings if it exists
    if (appData.plusMinusGradeSettings) {
        delete appData.plusMinusGradeSettings;
    }

    // MIGRATION: Ensure all grades have the correct structure
    if (appData.classes) {
        appData.classes.forEach(cls => {
            if (cls.years) {
                cls.years.forEach(year => {
                    if (year.students) {
                        year.students.forEach(student => {
                            if (student.grades) {
                                student.grades.forEach((grade, index) => {
                                    // Ensure categoryName and weight are present
                                    if (!grade.categoryName && grade.categoryId) {
                                        const category = appData.categories.find(c => c.id === grade.categoryId);
                                        if (category) {
                                            grade.categoryName = category.name;
                                            grade.weight = category.weight;
                                        }
                                    }
                                    // MIGRATION: Add createdAt timestamp if missing
                                    // Use grade ID as timestamp (IDs are based on Date.now())
                                    // or fallback to sequential timestamps
                                    if (!grade.createdAt) {
                                        const idAsTimestamp = parseInt(grade.id, 10);
                                        if (!isNaN(idAsTimestamp) && idAsTimestamp > 1000000000000) {
                                            // ID looks like a timestamp (after year 2001)
                                            grade.createdAt = idAsTimestamp;
                                        } else {
                                            // Fallback: use a sequential timestamp based on index
                                            // Start from a base date and add index * 1 day
                                            const baseDate = Date.now() - (student.grades.length - index) * 86400000;
                                            grade.createdAt = baseDate;
                                        }
                                    }
                                });
                            }
                        });
                    }
                });
            }
        });
    }

    // MIGRATION: Split student name into firstName/lastName/middleName
    if (appData.classes) {
        appData.classes.forEach(cls => {
            if (cls.years) {
                cls.years.forEach(year => {
                    if (year.students) {
                        year.students.forEach(student => {
                            if (student.name && !student.lastName) {
                                const parts = student.name.trim().split(/\s+/);
                                if (parts.length === 1) {
                                    student.lastName = parts[0];
                                    student.firstName = '';
                                } else {
                                    student.lastName = parts[parts.length - 1];
                                    student.firstName = parts.slice(0, -1).join(' ');
                                }
                                student.middleName = '';
                                delete student.name;
                            }
                            // Ensure fields exist even for already-migrated students
                            if (!student.firstName && student.firstName !== '') student.firstName = '';
                            if (!student.lastName && student.lastName !== '') student.lastName = '';
                            if (!student.middleName && student.middleName !== '') student.middleName = '';
                        });
                    }
                });
            }
        });
    }

    // MIGRATION: Add semester field to years and grades
    appData.classes?.forEach(cls => {
        cls.years?.forEach(year => {
            if (!year.currentSemester) year.currentSemester = "WS";
            year.students?.forEach(student => {
                student.grades?.forEach(grade => {
                    if (!grade.semester) grade.semester = "WS";
                });
            });
        });
    });

    // MIGRATION: Add school year dates from year name (e.g. "2024/2025")
    appData.classes?.forEach(cls => {
        cls.years?.forEach(year => {
            if (!year.startDate && !year.semesterSwitchDate && !year.endDate) {
                const match = year.name.match(/^(\d{4})\/(\d{4})$/);
                if (match) {
                    const y1 = parseInt(match[1]);
                    const y2 = parseInt(match[2]);
                    year.startDate = `${y1}-09-01`;
                    year.semesterSwitchDate = `${y2}-02-01`;
                    year.endDate = `${y2}-06-30`;
                }
            }
        });
    });

    // Data after migration
    // No automatic saving - data will be saved when user makes next change
    console.log("Data migration completed - changes will be saved on next user action");
};

/**
 * MIGRATION: Migrate to Year-based Structure
 *
 * Converts old structure (class.subjects, class.students) to new structure
 * (class.years[].subjects, class.years[].students)
 *
 * This allows teachers to manage the same class across multiple academic years.
 */
const migrateToYearStructure = () => {
    if (!appData.classes || appData.classes.length === 0) return;

    let needsMigration = false;

    // Check if any class needs migration
    appData.classes.forEach(cls => {
        if (!cls.years && (cls.students || cls.subjects || cls.currentSubjectId !== undefined)) {
            needsMigration = true;
        }
    });

    if (!needsMigration) return;

    console.log("Migrating data structure to support years (Jahrgänge)...");

    appData.classes.forEach(cls => {
        // Skip classes that already have years
        if (cls.years) return;

        // Create default year with current academic year name
        const currentYear = getCurrentSchoolYear();
        const defaultYearName = `${currentYear}/${currentYear + 1}`;

        const y1 = currentYear;
        const y2 = currentYear + 1;
        const defaultYear = {
            id: Date.now().toString() + '-year-' + Math.floor(Math.random() * 1000),
            name: defaultYearName,
            subjects: cls.subjects || [],
            currentSubjectId: cls.currentSubjectId || null,
            currentSemester: "WS",
            startDate: `${y1}-09-01`,
            semesterSwitchDate: `${y2}-02-01`,
            endDate: `${y2}-06-30`,
            students: cls.students || []
        };

        // Set up new structure
        cls.years = [defaultYear];
        cls.currentYearId = defaultYear.id;

        // Remove old properties
        delete cls.subjects;
        delete cls.currentSubjectId;
        delete cls.students;
    });

    console.log("Year structure migration completed");
};

// ============ VERSION CHECK ============

const VERSION_CHECK_KEY = 'edugrade_version';
const VERSION_CHECK_INTERVAL = 60000; // Check every 60 seconds

/**
 * Show update dialog when a new version is detected.
 * Uses the basecoat-css dialog pattern (same style as session-expired).
 */
const showVersionUpdateDialog = (previousVersion) => {
    // Defer until intro animation finishes
    if (window._avoIntroPlaying) {
        setTimeout(() => showVersionUpdateDialog(previousVersion), 300);
        return;
    }

    // Prevent showing multiple dialogs
    if (document.getElementById('version-update-dialog')) return;

    const newVersion = window.appVersion || '';
    const buildDate = window.appBuildDate || '';
    const prevVersionHtml = previousVersion
        ? `<span class="text-xs text-gray-500 line-through mr-1">v${previousVersion}</span>` : '';

    const dialog = document.createElement('dialog');
    dialog.id = 'version-update-dialog';
    dialog.className = 'dialog w-full sm:max-w-[425px]';
    dialog.innerHTML = `
        <div>
            <header>
                <div class="flex items-center gap-3">
                    <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-blue-500/15">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-blue-500 lucide lucide-download-icon lucide-download">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" x2="12" y1="15" y2="3"/>
                        </svg>
                    </div>
                    <div>
                        <h2 class="text-lg font-semibold">${t('version.updateTitle')}</h2>
                        <div class="flex items-center gap-1 mt-0.5">
                            ${prevVersionHtml}
                            <span class="text-sm font-semibold text-blue-400">v${newVersion}</span>
                            ${buildDate ? `<span class="text-xs text-gray-500 ml-2">· ${buildDate}</span>` : ''}
                        </div>
                    </div>
                </div>
            </header>
            <section class="py-4">
                <p class="text-gray-400">${t('version.updateMessage')}</p>
                <p class="text-gray-400 text-sm mt-3">${t('version.reloadHint')}</p>
            </section>
            <footer class="flex justify-end">
                <button type="button" class="btn-primary" id="version-reload-btn">${lucideIcon('refresh-cw')} ${t('version.reloadButton')}</button>
            </footer>
        </div>
    `;
    document.body.appendChild(dialog);

    // Prevent closing with Escape key
    dialog.addEventListener('cancel', (e) => {
        e.preventDefault();
    });

    // Prevent closing by clicking backdrop
    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) {
            e.stopPropagation();
        }
    });

    dialog.querySelector('#version-reload-btn').addEventListener('click', () => {
        localStorage.setItem(VERSION_CHECK_KEY, window.appVersion);
        location.reload();
    });

    dialog.showModal();
};

/**
 * Initialize version checking.
 *
 * - First visit (no stored version): silently store current version
 * - Stored version differs from current: show update dialog
 * - Already open pages: poll /api/version every 60s to detect deploys
 */
const initVersionCheck = () => {
    const currentVersion = window.appVersion;
    if (!currentVersion) return;

    const storedVersion = localStorage.getItem(VERSION_CHECK_KEY);

    if (!storedVersion) {
        // First visit ever - store version silently, no dialog
        localStorage.setItem(VERSION_CHECK_KEY, currentVersion);
    } else if (storedVersion !== currentVersion) {
        // Version changed since last visit - show update dialog
        showVersionUpdateDialog(storedVersion);
    }

    // Poll for updates while page is open
    setInterval(async () => {
        try {
            const response = await fetch('/api/version');
            if (response.ok) {
                const data = await response.json();
                const serverVersion = data.version;
                const knownVersion = localStorage.getItem(VERSION_CHECK_KEY);
                if (knownVersion && serverVersion !== knownVersion) {
                    showVersionUpdateDialog(knownVersion);
                }
            }
        } catch (e) {
            // Network error - ignore silently
        }
    }, VERSION_CHECK_INTERVAL);
};
