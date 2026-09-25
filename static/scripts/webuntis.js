/**
 * WEBUNTIS FEATURE — FRONTEND
 *
 * Handles the Settings → WebUntis panel: connect/disconnect a teacher's own
 * WebUntis account, import a class roster from WebUntis, and show a
 * read-only weekly timetable.
 *
 * Follows the same panel pattern as organisation.js: one render*Panel entry
 * point per state, fetch+toast idiom, native <dialog> not needed here (all
 * inline in the settings tab).
 */

// Cached connection flag, used by suggestWebUntisExamDate() to avoid firing
// a status request every time the "new exam" dialog opens. Invalidated (set
// back to null) on connect/disconnect so the next check re-fetches.
let webUntisStatusCache = null;

/**
 * Renders the entire Settings → WebUntis panel based on connection status.
 * Safe to call repeatedly (e.g. every time the Settings view opens).
 */
const renderWebUntisPanel = async () => {
    const container = document.getElementById('webuntis-panel-content');
    if (!container) return;

    container.innerHTML = `<div class="flex items-center justify-center p-8">${SPINNER_SVG}</div>`;

    try {
        const response = await fetch('/api/webuntis/status');
        const data = await response.json();
        webUntisStatusCache = data.success ? !!data.connected : null;

        if (!data.success) {
            container.innerHTML = `<p class="text-sm text-red-500">${t("error.connectionError")}</p>`;
            return;
        }

        if (!data.connected) {
            renderWebUntisConnectForm(container);
        } else {
            renderWebUntisConnected(container, data);
        }
    } catch (error) {
        container.innerHTML = `<p class="text-sm text-red-500">${t("error.connectionError")}</p>`;
    }
};
window.renderWebUntisPanel = renderWebUntisPanel;

/**
 * Best-effort date suggestion for the "new class exam" setup form: looks at
 * the connected WebUntis account's timetable for the current week and
 * returns the nearest upcoming period matching the given subject/class name.
 *
 * Returns null (never throws) whenever WebUntis isn't connected, nothing
 * matches, or the request fails — this must never block exam creation.
 *
 * ponytail: only checks the current week (server default range) and matches
 * subject/class names via loose substring comparison (WebUntis long names
 * don't always match EduGrade's subject names exactly). Widen the date
 * range or add a manual class↔WebUntis-Klasse mapping if this proves too
 * unreliable in practice.
 */
const suggestWebUntisExamDate = async (subjectName, className) => {
    try {
        if (webUntisStatusCache === null) {
            const statusResp = await fetch('/api/webuntis/status');
            const statusData = await statusResp.json();
            webUntisStatusCache = statusData.success ? !!statusData.connected : false;
        }
        if (!webUntisStatusCache) return null;

        const resp = await fetch('/api/webuntis/timetable');
        const data = await resp.json();
        if (!data.success || !data.periods) return null;

        const todayStr = new Date().toISOString().split('T')[0];
        const norm = (s) => (s || '').toLowerCase().trim();
        const subjNorm = norm(subjectName);
        const classNorm = norm(className);
        const toIsoDate = (d) => {
            const s = String(d);
            return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
        };

        const matches = data.periods
            .filter(p => !p.cancelled)
            .map(p => ({ ...p, isoDate: toIsoDate(p.date) }))
            .filter(p => p.isoDate && p.isoDate >= todayStr)
            .filter(p => !subjNorm || norm(p.subject).includes(subjNorm) || subjNorm.includes(norm(p.subject)))
            .filter(p => !classNorm || norm(p.klasse).includes(classNorm) || classNorm.includes(norm(p.klasse)))
            .sort((a, b) => a.isoDate.localeCompare(b.isoDate));

        return matches.length > 0 ? { date: matches[0].isoDate } : null;
    } catch (error) {
        return null;
    }
};
window.suggestWebUntisExamDate = suggestWebUntisExamDate;

/**
 * State: no WebUntis account connected yet.
 *
 * Primary path is pasting the WebUntis pairing QR code's content (users
 * scan it with any phone camera — not the Untis app — which shows the
 * decoded untis:// link as text to copy). This is a TOTP secret, never the
 * teacher's actual WebUntis password — see webuntis_client.py for why. A
 * collapsed <details> holds the four fields directly as a fallback for
 * schools where the QR route doesn't work.
 */
const renderWebUntisConnectForm = (container) => {
    container.innerHTML = `
        <div class="space-y-4">
            <p class="text-sm text-gray-400">${t("webuntis.connectHint")}</p>

            <div class="space-y-2 border rounded-lg p-3">
                <p class="text-sm font-medium">${t("webuntis.howToTitle")}</p>
                <ol class="text-sm text-gray-400 list-decimal list-inside space-y-1">
                    <li>${t("webuntis.howToStep1")}</li>
                    <li>${t("webuntis.howToStep2")}</li>
                    <li>${t("webuntis.howToStep3")}</li>
                    <li>${t("webuntis.howToStep4")}</li>
                </ol>
            </div>

            <div class="space-y-2">
                <label class="text-sm font-medium">${t("webuntis.qrLabel")}</label>
                <input type="text" id="webuntis-qr" class="input w-full font-mono" placeholder="untis://setschool?..." data-icon="qr-code">
            </div>

            <button id="webuntis-connect-btn" class="btn-primary w-full">${lucideIcon('plug')} ${t("webuntis.connect")}</button>

            <details class="text-sm">
                <summary class="text-gray-400 cursor-pointer">${t("webuntis.manualToggle")}</summary>
                <div class="space-y-2 mt-3">
                    <div class="space-y-2">
                        <label class="text-sm font-medium">${t("webuntis.server")}</label>
                        <input type="text" id="webuntis-server" class="input w-full" placeholder="${safeAttr(t("webuntis.serverPlaceholder"))}" data-icon="globe">
                    </div>
                    <div class="space-y-2">
                        <label class="text-sm font-medium">${t("webuntis.school")}</label>
                        <input type="text" id="webuntis-school" class="input w-full" placeholder="${safeAttr(t("webuntis.schoolPlaceholder"))}" data-icon="school">
                    </div>
                    <div class="space-y-2">
                        <label class="text-sm font-medium">${t("webuntis.username")}</label>
                        <input type="text" id="webuntis-username" class="input w-full" autocomplete="off" data-icon="user">
                    </div>
                    <div class="space-y-2">
                        <label class="text-sm font-medium">${t("webuntis.secret")}</label>
                        <input type="text" id="webuntis-secret" class="input w-full font-mono" autocomplete="off" data-icon="key-round">
                    </div>
                </div>
            </details>
        </div>
    `;

    document.getElementById('webuntis-connect-btn').addEventListener('click', async () => {
        const btn = document.getElementById('webuntis-connect-btn');
        const qr = document.getElementById('webuntis-qr').value.trim();

        let body;
        if (qr) {
            body = { qr };
        } else {
            const server = document.getElementById('webuntis-server').value.trim();
            const school = document.getElementById('webuntis-school').value.trim();
            const username = document.getElementById('webuntis-username').value.trim();
            const secret = document.getElementById('webuntis-secret').value.trim();
            if (!server || !school || !username || !secret) {
                showToast(t("backend.invalidRequest"), 'error');
                return;
            }
            body = { server, school, username, secret };
        }

        setButtonLoading(btn, true, t("loading.creating"));
        try {
            const response = await fetch('/api/webuntis/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await response.json();
            if (data.success) {
                showToast(t("toast.webUntisConnected"), 'success');
                renderWebUntisPanel();
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
 * State: WebUntis account connected — show account info, class import and
 * a read-only weekly timetable, both loaded on demand.
 */
const renderWebUntisConnected = (container, status) => {
    container.innerHTML = `
        <div class="space-y-6">
            <div class="space-y-1">
                <p class="text-sm"><strong>${escapeHtml(status.school)}</strong> (${escapeHtml(status.server)})</p>
                <p class="text-sm text-gray-400">${escapeHtml(status.username)}</p>
            </div>

            <div class="space-y-2">
                <h4 class="text-sm font-medium">${t("webuntis.importClasses")}</h4>
                <button id="webuntis-load-klassen-btn" class="btn-outline">${lucideIcon('download')} ${t("webuntis.loadClasses")}</button>
                <div id="webuntis-klassen-list" class="space-y-2 mt-2"></div>
            </div>

            <div class="space-y-2">
                <h4 class="text-sm font-medium">${t("webuntis.timetable")}</h4>
                <button id="webuntis-load-timetable-btn" class="btn-outline">${lucideIcon('calendar-days')} ${t("webuntis.loadTimetable")}</button>
                <div id="webuntis-timetable-view" class="space-y-2 mt-2"></div>
            </div>

            <hr>

            <button id="webuntis-disconnect-btn" class="btn-destructive">${lucideIcon('unplug')} ${t("webuntis.disconnect")}</button>
        </div>
    `;

    document.getElementById('webuntis-load-klassen-btn').addEventListener('click', webUntisLoadKlassen);
    document.getElementById('webuntis-load-timetable-btn').addEventListener('click', webUntisLoadTimetable);

    document.getElementById('webuntis-disconnect-btn').addEventListener('click', () => {
        const doDisconnect = async () => {
            try {
                const response = await fetch('/api/webuntis/connect', { method: 'DELETE' });
                const data = await response.json();
                if (data.success) {
                    showToast(t("toast.webUntisDisconnected"), 'success');
                    renderWebUntisPanel();
                } else {
                    showToast(data.message ? t(data.message) : t("error.connectionError"), 'error');
                }
            } catch (error) {
                showToast(t("error.connectionError"), 'error');
            }
        };

        if (typeof showConfirmDialog === 'function') {
            showConfirmDialog(t("webuntis.confirmDisconnect"), doDisconnect);
        } else if (confirm(t("webuntis.confirmDisconnect"))) {
            doDisconnect();
        }
    });
};

/**
 * Fetches and renders the WebUntis class list with per-class import buttons.
 */
const webUntisLoadKlassen = async () => {
    const btn = document.getElementById('webuntis-load-klassen-btn');
    const listEl = document.getElementById('webuntis-klassen-list');
    if (!listEl) return;

    setButtonLoading(btn, true);
    listEl.innerHTML = `<div class="flex items-center justify-center p-4">${SPINNER_SVG}</div>`;

    try {
        const response = await fetch('/api/webuntis/klassen');
        const data = await response.json();
        setButtonLoading(btn, false);

        if (!data.success) {
            listEl.innerHTML = `<p class="text-sm text-red-500">${data.message ? escapeHtml(t(data.message)) : escapeHtml(t("error.connectionError"))}</p>`;
            return;
        }

        if (!data.klassen || data.klassen.length === 0) {
            listEl.innerHTML = `<p class="text-sm text-gray-400">${t("webuntis.noClasses")}</p>`;
            return;
        }

        listEl.innerHTML = `
            <div class="space-y-2 w-full">
                ${data.klassen.map(k => `
                    <div class="flex items-center justify-between gap-2 p-2 border rounded-lg" data-klasse-id="${safeAttr(k.id)}">
                        <p class="text-sm font-medium truncate">${escapeHtml(k.name)}</p>
                        <button class="btn-sm-primary webuntis-import-btn" data-klasse-id="${safeAttr(k.id)}" data-klasse-name="${safeAttr(k.name)}">${lucideIcon('download')} ${t("webuntis.import")}</button>
                    </div>
                `).join('')}
            </div>
        `;

        listEl.querySelectorAll('.webuntis-import-btn').forEach(importBtn => {
            importBtn.addEventListener('click', () => webUntisImportKlasse(importBtn.dataset.klasseId, importBtn.dataset.klasseName, importBtn));
        });
    } catch (error) {
        setButtonLoading(btn, false);
        listEl.innerHTML = `<p class="text-sm text-red-500">${t("error.connectionError")}</p>`;
    }
};

/**
 * Imports one WebUntis class: fetches its roster from the backend, then
 * builds the class the same way manual creation does (addClass + per-student
 * push into the current year, matching dataManagement.js's addStudent shape)
 * so it goes through the exact same save/render path as every other class.
 */
const webUntisImportKlasse = async (klasseId, klasseName, btn) => {
    setButtonLoading(btn, true);
    try {
        const response = await fetch(`/api/webuntis/klassen/${encodeURIComponent(klasseId)}/import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: klasseName })
        });
        const data = await response.json();
        if (!data.success) {
            showToast(data.message ? t(data.message) : t("error.connectionError"), 'error');
            setButtonLoading(btn, false);
            return;
        }
        if (data.warning) {
            showToast(t(data.warning), 'warning');
        }

        addClass(data.name);
        const currentYear = getCurrentYear();
        (data.students || []).forEach(s => {
            currentYear.students.push({
                id: Date.now().toString() + '-' + Math.floor(Math.random() * 1000),
                firstName: s.firstName,
                lastName: s.lastName,
                middleName: '',
                notes: '',
                grades: [],
                participation: [],
                behavior: []
            });
        });
        saveData(t("toast.webUntisClassImported"));
        renderClassList();
        renderHome();
        renderStudents();
        setButtonLoading(btn, false);
    } catch (error) {
        showToast(t("error.connectionError"), 'error');
        setButtonLoading(btn, false);
    }
};

/**
 * Fetches and renders the current week's timetable as a simple list.
 */
const webUntisLoadTimetable = async () => {
    const btn = document.getElementById('webuntis-load-timetable-btn');
    const viewEl = document.getElementById('webuntis-timetable-view');
    if (!viewEl) return;

    setButtonLoading(btn, true);
    viewEl.innerHTML = `<div class="flex items-center justify-center p-4">${SPINNER_SVG}</div>`;

    try {
        const response = await fetch('/api/webuntis/timetable');
        const data = await response.json();
        setButtonLoading(btn, false);

        if (!data.success) {
            viewEl.innerHTML = `<p class="text-sm text-red-500">${data.message ? escapeHtml(t(data.message)) : escapeHtml(t("error.connectionError"))}</p>`;
            return;
        }

        if (!data.periods || data.periods.length === 0) {
            viewEl.innerHTML = `<p class="text-sm text-gray-400">${t("webuntis.noPeriods")}</p>`;
            return;
        }

        viewEl.innerHTML = `
            <div class="w-full overflow-x-auto">
                <table class="table w-full text-sm">
                    <thead>
                        <tr>
                            <th class="text-left">${t("webuntis.colDate")}</th>
                            <th class="text-left">${t("webuntis.colTime")}</th>
                            <th class="text-left">${t("webuntis.colSubject")}</th>
                            <th class="text-left">${t("webuntis.colClass")}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.periods.map(p => `
                            <tr class="${p.cancelled ? 'opacity-50 line-through' : ''}">
                                <td>${escapeHtml(String(p.date ?? ''))}</td>
                                <td>${escapeHtml(String(p.startTime ?? ''))}–${escapeHtml(String(p.endTime ?? ''))}</td>
                                <td>${escapeHtml(p.subject || '')}</td>
                                <td>${escapeHtml(p.klasse || '')}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    } catch (error) {
        setButtonLoading(btn, false);
        viewEl.innerHTML = `<p class="text-sm text-red-500">${t("error.connectionError")}</p>`;
    }
};
