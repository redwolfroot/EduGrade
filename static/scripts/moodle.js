/**
 * MOODLE FEATURE — FRONTEND
 *
 * Handles the Settings → Moodle panel: connect a teacher's own Moodle Web
 * Service token, map EduGrade classes to Moodle courses, and (via the hook
 * in render.js's class-exam-save handler) push newly created exams/tests as
 * course-visible calendar events.
 *
 * Follows the same panel pattern as organisation.js/webuntis.js.
 */

/**
 * Renders the entire Settings → Moodle panel based on connection status.
 * Safe to call repeatedly (e.g. every time the Settings view opens).
 */
const renderMoodlePanel = async () => {
    const container = document.getElementById('moodle-panel-content');
    if (!container) return;

    container.innerHTML = `<div class="flex items-center justify-center p-8">${SPINNER_SVG}</div>`;

    try {
        const response = await fetch('/api/moodle/status');
        const data = await response.json();

        if (!data.success) {
            container.innerHTML = `<p class="text-sm text-red-500">${t("error.connectionError")}</p>`;
            return;
        }

        if (!data.connected) {
            renderMoodleConnectForm(container);
        } else {
            renderMoodleConnected(container, data);
        }
    } catch (error) {
        container.innerHTML = `<p class="text-sm text-red-500">${t("error.connectionError")}</p>`;
    }
};
window.renderMoodlePanel = renderMoodlePanel;

/**
 * State: no Moodle account connected yet. Token only, never a password —
 * see moodle_client.py's module docstring for how to get one (Moodle
 * Profile → Preferences → "Security keys").
 */
const renderMoodleConnectForm = (container) => {
    container.innerHTML = `
        <div class="space-y-4">
            <p class="text-sm text-gray-400">${t("moodle.connectHint")}</p>

            <div class="space-y-2 border rounded-lg p-3">
                <p class="text-sm font-medium">${t("moodle.howToTitle")}</p>
                <ol class="text-sm text-gray-400 list-decimal list-inside space-y-1">
                    <li>${t("moodle.howToStep1")}</li>
                    <li>${t("moodle.howToStep2")}</li>
                    <li>${t("moodle.howToStep3")}</li>
                </ol>
                <p class="text-xs text-amber-500">${t("moodle.adminHint")}</p>
            </div>

            <div class="space-y-2">
                <label class="text-sm font-medium">${t("moodle.url")}</label>
                <input type="text" id="moodle-url" class="input w-full" placeholder="${safeAttr(t("moodle.urlPlaceholder"))}" data-icon="globe">
            </div>
            <div class="space-y-2">
                <label class="text-sm font-medium">${t("moodle.token")}</label>
                <input type="text" id="moodle-token" class="input w-full font-mono" autocomplete="off" data-icon="key-round">
            </div>
            <button id="moodle-connect-btn" class="btn-primary w-full">${lucideIcon('plug')} ${t("moodle.connect")}</button>
        </div>
    `;

    document.getElementById('moodle-connect-btn').addEventListener('click', async () => {
        const btn = document.getElementById('moodle-connect-btn');
        const url = document.getElementById('moodle-url').value.trim();
        const moodleToken = document.getElementById('moodle-token').value.trim();

        if (!url || !moodleToken) {
            showToast(t("backend.invalidRequest"), 'error');
            return;
        }

        setButtonLoading(btn, true, t("loading.creating"));
        try {
            const response = await fetch('/api/moodle/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, token: moodleToken })
            });
            const data = await response.json();
            if (data.success) {
                showToast(t("toast.moodleConnected"), 'success');
                renderMoodlePanel();
            } else {
                showToast(data.message ? t(data.message) : t("error.connectionError"), 'error');
                setButtonLoading(btn, false);
            }
        } catch (error) {
            showToast(t("error.connectionError"), 'error');
            setButtonLoading(btn, false);
        }
    });
};

/**
 * State: Moodle connected — show account info, class↔course mapping and a
 * disconnect button. Course list is loaded once and reused for every class row.
 */
const renderMoodleConnected = async (container, status) => {
    container.innerHTML = `
        <div class="space-y-6">
            <div class="space-y-1">
                <p class="text-sm"><strong>${escapeHtml(status.fullname)}</strong></p>
                <p class="text-sm text-gray-400">${escapeHtml(status.url)}</p>
            </div>

            <div class="space-y-2">
                <h4 class="text-sm font-medium">${t("moodle.classMapping")}</h4>
                <p class="text-sm text-gray-400">${t("moodle.classMappingHint")}</p>
                <div id="moodle-class-map-list" class="flex items-center justify-center p-4">${SPINNER_SVG}</div>
            </div>

            <hr>

            <button id="moodle-disconnect-btn" class="btn-destructive">${lucideIcon('unplug')} ${t("moodle.disconnect")}</button>
        </div>
    `;

    document.getElementById('moodle-disconnect-btn').addEventListener('click', () => {
        const doDisconnect = async () => {
            try {
                const response = await fetch('/api/moodle/connect', { method: 'DELETE' });
                const data = await response.json();
                if (data.success) {
                    showToast(t("toast.moodleDisconnected"), 'success');
                    renderMoodlePanel();
                } else {
                    showToast(data.message ? t(data.message) : t("error.connectionError"), 'error');
                }
            } catch (error) {
                showToast(t("error.connectionError"), 'error');
            }
        };

        if (typeof showConfirmDialog === 'function') {
            showConfirmDialog(t("moodle.confirmDisconnect"), doDisconnect);
        } else if (confirm(t("moodle.confirmDisconnect"))) {
            doDisconnect();
        }
    });

    renderMoodleClassMap();
};

/**
 * Fetches the Moodle course list once, then renders one dropdown per
 * EduGrade class (appData.classes) letting the teacher map it to a course.
 */
const renderMoodleClassMap = async () => {
    const listEl = document.getElementById('moodle-class-map-list');
    if (!listEl) return;

    try {
        const response = await fetch('/api/moodle/courses');
        const data = await response.json();
        if (!data.success) {
            listEl.innerHTML = `<p class="text-sm text-red-500">${data.message ? escapeHtml(t(data.message)) : escapeHtml(t("error.connectionError"))}</p>`;
            return;
        }

        const courses = data.courses || [];
        const classes = (appData.classes || []);
        if (classes.length === 0) {
            listEl.innerHTML = `<p class="text-sm text-gray-400">${t("moodle.noClasses")}</p>`;
            return;
        }
        if (courses.length === 0) {
            listEl.innerHTML = `<p class="text-sm text-gray-400">${t("moodle.noCourses")}</p>`;
            return;
        }

        const currentMap = appData.moodleClassMap || {};
        listEl.innerHTML = `
            <div class="space-y-2 w-full">
                ${classes.map(c => `
                    <div class="flex items-center justify-between gap-2 p-2 border rounded-lg">
                        <p class="text-sm font-medium truncate">${escapeHtml(c.name)}</p>
                        <select class="select moodle-course-select" data-class-id="${safeAttr(c.id)}">
                            <option value="">${t("moodle.noMapping")}</option>
                            ${courses.map(course => `
                                <option value="${safeAttr(course.id)}" ${String(currentMap[c.id]) === String(course.id) ? 'selected' : ''}>${escapeHtml(course.name)}</option>
                            `).join('')}
                        </select>
                    </div>
                `).join('')}
            </div>
        `;

        listEl.querySelectorAll('.moodle-course-select').forEach(select => {
            select.addEventListener('change', () => moodleSetClassMapping(select.dataset.classId, select.value || null, select));
        });
    } catch (error) {
        listEl.innerHTML = `<p class="text-sm text-red-500">${t("error.connectionError")}</p>`;
    }
};

const moodleSetClassMapping = async (classId, courseId, selectEl) => {
    try {
        const response = await fetch(`/api/moodle/classes/${encodeURIComponent(classId)}/map`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ courseId: courseId ? Number(courseId) : null })
        });
        const data = await response.json();
        if (data.success) {
            if (!appData.moodleClassMap) appData.moodleClassMap = {};
            if (courseId) {
                appData.moodleClassMap[classId] = Number(courseId);
            } else {
                delete appData.moodleClassMap[classId];
            }
            showToast(t("toast.moodleMappingSaved"), 'success');
        } else {
            showToast(data.message ? t(data.message) : t("error.connectionError"), 'error');
        }
    } catch (error) {
        showToast(t("error.connectionError"), 'error');
    }
};

/**
 * Best-effort push of one exam as a Moodle course calendar event. Never
 * throws — callers (render.js) should fire-and-forget this after the exam
 * is already saved locally, so a Moodle hiccup never loses grade data.
 */
const pushMoodleExamEvent = async (classId, name, timestartSeconds, timeductionSeconds = 0) => {
    try {
        const response = await fetch('/api/moodle/push-event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ classId, name, timestart: timestartSeconds, timeduration: timeductionSeconds })
        });
        const data = await response.json();
        if (data.success) {
            showToast(t("toast.moodleEventPushed"), 'success');
        } else if (data.message !== 'backend.moodleNoCourseMapped') {
            // Silent when simply unmapped (expected for classes without Moodle) —
            // only surface real failures (auth/connection/etc.).
            showToast(data.message ? t(data.message) : t("error.connectionError"), 'error');
        }
    } catch (error) {
        // best-effort only
    }
};
window.pushMoodleExamEvent = pushMoodleExamEvent;
