/**
 * ORGANISATION FEATURE — FRONTEND
 *
 * Handles the Settings → Organisation panel (create/join org, manage
 * pending members, view org-wide roster, accept/decline handovers) and
 * the class-view "hand over class" dialog.
 *
 * All API endpoints are implemented server-side already (see app.py's
 * "Organisation API" section) — this file only wires the UI to them.
 */

// Cached result of the last /api/org/status fetch (used by the handover
// button visibility check on app:dataLoaded). Not relied upon elsewhere —
// renderOrganisationPanel() always re-fetches fresh status itself.
let orgStatusCache = null;

// Currently selected handover target (set when a search result is clicked).
let orgHandoverSelectedUser = null;

// Debounce timer handle for the handover member search input.
let orgHandoverSearchTimer = null;

/**
 * Renders the entire Settings → Organisation panel based on current
 * membership status. Safe to call repeatedly (e.g. after every action).
 */
const renderOrganisationPanel = async () => {
    const container = document.getElementById('org-panel-content');
    if (!container) return;

    container.innerHTML = `<div class="flex items-center justify-center p-8">${SPINNER_SVG}</div>`;

    try {
        const response = await fetch('/api/org/status');
        const data = await response.json();

        if (!data.success) {
            container.innerHTML = `<p class="text-sm text-red-500">${t("error.connectionError")}</p>`;
            return;
        }

        if (!data.member) {
            renderOrgNoMembership(container);
        } else if (data.status === 'pending') {
            renderOrgPendingApproval(container, data.org);
        } else {
            await renderOrgApprovedMember(container, data.org, data.role);
        }
    } catch (error) {
        container.innerHTML = `<p class="text-sm text-red-500">${t("error.connectionError")}</p>`;
    }
};
window.renderOrganisationPanel = renderOrganisationPanel;

/**
 * State: user is not a member of any organisation yet.
 * Org creation and joining-by-code both moved out of this Settings-tab
 * panel (creation is registration-only now; joining lives in the Profile
 * dialog — see renderProfileOrgWidget below). This is just a hint.
 */
const renderOrgNoMembership = (container) => {
    container.innerHTML = `
        <div class="space-y-2">
            <p class="text-sm text-gray-400">${t("org.joinInProfileHint")}</p>
        </div>
    `;
};

/**
 * Shared join-code display + copy markup, used both by the Settings-tab
 * admin branch (renderOrgApprovedMember) and the org-admin dashboard
 * (renderOrgAdminDashboard).
 */
const renderOrgJoinCodeBlock = (joinCode) => `
    <div class="space-y-1">
        <label class="text-sm font-medium">${t("org.joinCodeLabel")}</label>
        <div class="flex gap-2">
            <input type="text" class="input flex-1 font-mono" value="${safeAttr(joinCode)}" readonly id="org-join-code-display">
            <button id="org-copy-code-btn" class="btn-outline shrink-0">${lucideIcon('copy')} ${t("org.copyCode")}</button>
        </div>
    </div>
`;

/**
 * Wires the copy button rendered by renderOrgJoinCodeBlock. Must be called
 * after the block's markup has been inserted into the DOM.
 */
const wireOrgJoinCodeCopyBtn = (joinCode) => {
    const copyBtn = document.getElementById('org-copy-code-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(joinCode).then(() => {
                showToast(t("org.codeCopied"), 'success');
            });
        });
    }
};

/**
 * State: user is a member with a pending (not yet approved) request.
 */
const renderOrgPendingApproval = (container, org) => {
    const orgName = org ? escapeHtml(org.name) : '';
    container.innerHTML = `
        <div class="space-y-2">
            <h3 class="text-lg font-semibold">${orgName}</h3>
            <p class="text-sm text-gray-400">${t("org.pendingApproval")}</p>
        </div>
    `;
};

/**
 * State: user is an approved member (teacher or admin).
 */
const renderOrgApprovedMember = async (container, org, role) => {
    const isAdmin = role === 'admin';
    const orgName = org ? escapeHtml(org.name) : '';

    let joinCodeSection = '';
    if (isAdmin && org && org.join_code) {
        joinCodeSection = renderOrgJoinCodeBlock(org.join_code);
    }

    container.innerHTML = `
        <div class="space-y-6">
            <div class="space-y-3">
                <h3 class="text-lg font-semibold">${t("org.yourOrg")}: ${orgName}</h3>
                ${joinCodeSection}
            </div>

            ${isAdmin ? `
            <div class="space-y-2">
                <h4 class="text-sm font-medium">${t("org.pendingMembers")}</h4>
                <div id="org-pending-members-list" class="flex items-center justify-center p-4">${SPINNER_SVG}</div>
            </div>
            ` : ''}

            <div class="space-y-2">
                <h4 class="text-sm font-medium">${t("org.pendingHandovers")}</h4>
                <div id="org-pending-handovers-list" class="flex items-center justify-center p-4">${SPINNER_SVG}</div>
            </div>

            <div class="space-y-2">
                <h4 class="text-sm font-medium">${t("org.roster")}</h4>
                <p class="text-sm text-gray-400">${t("org.rosterHint")}</p>
                <div id="org-roster-list" class="flex items-center justify-center p-4">${SPINNER_SVG}</div>
            </div>

            <hr>

            <button id="org-leave-btn" class="btn-destructive">${lucideIcon('log-out')} ${t("org.leaveOrganisation")}</button>
        </div>
    `;

    if (isAdmin) {
        wireOrgJoinCodeCopyBtn(org.join_code);
        renderOrgPendingMembers();
    }

    document.getElementById('org-leave-btn').addEventListener('click', () => {
        const doLeave = async () => {
            try {
                const response = await fetch('/api/org/leave', { method: 'POST' });
                const data = await response.json();
                if (data.success) {
                    showToast(t("toast.orgLeft"), 'success');
                    renderOrganisationPanel();
                } else {
                    showToast(data.message ? t(data.message) : t("error.connectionError"), 'error');
                }
            } catch (error) {
                showToast(t("error.connectionError"), 'error');
            }
        };

        if (typeof showConfirmDialog === 'function') {
            showConfirmDialog(t("org.confirmLeave"), doLeave);
        } else if (confirm(t("org.confirmLeave"))) {
            doLeave();
        }
    });

    renderOrgPendingHandovers();
    renderOrgRoster();
};

/**
 * Fetches and renders the admin-only pending-membership-requests list into
 * the given container id. Used by both the Settings-tab panel
 * (renderOrgApprovedMember) and the org-admin dashboard
 * (renderOrgAdminDashboard) — refreshFn controls which view gets re-rendered
 * after an approve/reject decision.
 */
const renderOrgPendingMembers = async (containerId = 'org-pending-members-list', refreshFn = renderOrganisationPanel) => {
    const listEl = document.getElementById(containerId);
    if (!listEl) return;

    try {
        const response = await fetch('/api/org/pending');
        const data = await response.json();
        if (!data.success) {
            listEl.innerHTML = `<p class="text-sm text-red-500">${t("error.connectionError")}</p>`;
            return;
        }

        if (!data.pending || data.pending.length === 0) {
            listEl.innerHTML = `<p class="text-sm text-gray-400">${t("org.noPendingMembers")}</p>`;
            return;
        }

        listEl.innerHTML = `
            <div class="space-y-2 w-full">
                ${data.pending.map(p => `
                    <div class="flex items-center justify-between gap-2 p-2 border rounded-lg" data-user-id="${safeAttr(p.user_id)}">
                        <div class="min-w-0">
                            <p class="text-sm font-medium truncate">${escapeHtml(p.username)}</p>
                            <p class="text-xs text-gray-400 truncate">${escapeHtml(p.email)}</p>
                        </div>
                        <div class="flex gap-2 shrink-0">
                            <button class="btn-sm-primary org-approve-btn" data-user-id="${safeAttr(p.user_id)}">${lucideIcon('check')} ${t("org.approve")}</button>
                            <button class="btn-sm-outline org-reject-btn" data-user-id="${safeAttr(p.user_id)}">${lucideIcon('x')} ${t("org.reject")}</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;

        listEl.querySelectorAll('.org-approve-btn').forEach(btn => {
            btn.addEventListener('click', () => orgHandleMemberDecision(btn.dataset.userId, 'approve', refreshFn));
        });
        listEl.querySelectorAll('.org-reject-btn').forEach(btn => {
            btn.addEventListener('click', () => orgHandleMemberDecision(btn.dataset.userId, 'reject', refreshFn));
        });
    } catch (error) {
        listEl.innerHTML = `<p class="text-sm text-red-500">${t("error.connectionError")}</p>`;
    }
};

const orgHandleMemberDecision = async (userId, decision, refreshFn = renderOrganisationPanel) => {
    try {
        const response = await fetch(`/api/org/members/${encodeURIComponent(userId)}/${decision}`, { method: 'POST' });
        const data = await response.json();
        if (data.success) {
            showToast(t(decision === 'approve' ? "toast.orgMemberApproved" : "toast.orgMemberRejected"), 'success');
            refreshFn();
        } else {
            showToast(data.message ? t(data.message) : t("error.connectionError"), 'error');
        }
    } catch (error) {
        showToast(t("error.connectionError"), 'error');
    }
};

/**
 * Fetches and renders handovers pending for the current user.
 */
const renderOrgPendingHandovers = async () => {
    const listEl = document.getElementById('org-pending-handovers-list');
    if (!listEl) return;

    try {
        const response = await fetch('/api/org/handovers');
        const data = await response.json();
        if (!data.success) {
            listEl.innerHTML = `<p class="text-sm text-red-500">${t("error.connectionError")}</p>`;
            return;
        }

        if (!data.handovers || data.handovers.length === 0) {
            listEl.innerHTML = `<p class="text-sm text-gray-400">${t("org.noPendingHandovers")}</p>`;
            return;
        }

        listEl.innerHTML = `
            <div class="space-y-2 w-full">
                ${data.handovers.map(h => `
                    <div class="flex items-center justify-between gap-2 p-2 border rounded-lg" data-token="${safeAttr(h.token)}">
                        <div class="min-w-0">
                            <p class="text-sm font-medium truncate">${escapeHtml(h.class_name)}</p>
                            <p class="text-xs text-gray-400 truncate">${escapeHtml(t("org.handoverFrom", { name: h.from_username }))}</p>
                        </div>
                        <div class="flex gap-2 shrink-0">
                            <button class="btn-sm-primary org-handover-accept-btn" data-token="${safeAttr(h.token)}">${lucideIcon('check')} ${t("org.handoverAccept")}</button>
                            <button class="btn-sm-outline org-handover-decline-btn" data-token="${safeAttr(h.token)}">${lucideIcon('x')} ${t("org.handoverDecline")}</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;

        listEl.querySelectorAll('.org-handover-accept-btn').forEach(btn => {
            btn.addEventListener('click', () => orgAcceptHandover(btn.dataset.token));
        });
        listEl.querySelectorAll('.org-handover-decline-btn').forEach(btn => {
            btn.addEventListener('click', () => orgDeclineHandover(btn.dataset.token));
        });
    } catch (error) {
        listEl.innerHTML = `<p class="text-sm text-red-500">${t("error.connectionError")}</p>`;
    }
};

const orgAcceptHandover = async (token) => {
    try {
        const response = await fetch(`/api/org/handover/${encodeURIComponent(token)}/accept`, { method: 'POST' });
        const data = await response.json();
        if (data.success) {
            await loadData();
            renderClassList();
            showToast(t("toast.handoverAccepted"), 'success');
            renderOrganisationPanel();
        } else {
            showToast(data.message ? t(data.message) : t("error.connectionError"), 'error');
        }
    } catch (error) {
        showToast(t("error.connectionError"), 'error');
    }
};

const orgDeclineHandover = async (token) => {
    try {
        const response = await fetch(`/api/org/handover/${encodeURIComponent(token)}/decline`, { method: 'POST' });
        const data = await response.json();
        if (data.success) {
            showToast(t("toast.handoverDeclined"), 'success');
            renderOrganisationPanel();
        } else {
            showToast(data.message ? t(data.message) : t("error.connectionError"), 'error');
        }
    } catch (error) {
        showToast(t("error.connectionError"), 'error');
    }
};

/**
 * Fetches and renders the org-wide student roster (name/class/teacher only,
 * never grades — the backend endpoint itself never returns grade data) into
 * the given container id. Used by both the Settings-tab panel and the
 * org-admin dashboard.
 */
const renderOrgRoster = async (containerId = 'org-roster-list') => {
    const listEl = document.getElementById(containerId);
    if (!listEl) return;

    try {
        const response = await fetch('/api/org/roster');
        const data = await response.json();
        if (!data.success) {
            listEl.innerHTML = `<p class="text-sm text-red-500">${t("error.connectionError")}</p>`;
            return;
        }

        if (!data.roster || data.roster.length === 0) {
            listEl.innerHTML = `<p class="text-sm text-gray-400">${t("org.rosterEmpty")}</p>`;
            return;
        }

        listEl.innerHTML = `
            <div class="w-full overflow-x-auto">
                <table class="table w-full text-sm">
                    <thead>
                        <tr>
                            <th class="text-left">${t("org.rosterStudent")}</th>
                            <th class="text-left">${t("org.rosterClass")}</th>
                            <th class="text-left">${t("org.rosterTeacher")}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.roster.map(r => `
                            <tr>
                                <td>${escapeHtml(r.student_name)}</td>
                                <td>${escapeHtml(r.class_name)}</td>
                                <td>${escapeHtml(r.teacher_name)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    } catch (error) {
        listEl.innerHTML = `<p class="text-sm text-red-500">${t("error.connectionError")}</p>`;
    }
};

// ---------------------------------------------------------------------
// Class handover button + dialog
// ---------------------------------------------------------------------

/**
 * Renders the handover dialog content for the currently open class.
 */
const openOrgHandoverDialog = () => {
    const currentClass = appData.classes.find(c => c.id === appData.currentClassId);
    if (!currentClass) return;

    const dialog = document.getElementById('org-handover-dialog');
    const content = document.getElementById('org-handover-content');
    if (!dialog || !content) return;

    orgHandoverSelectedUser = null;

    content.innerHTML = `
        <div class="space-y-4">
            <p class="text-sm text-gray-400">${t("org.handoverSubtitle")} <strong>${escapeHtml(currentClass.name)}</strong></p>

            <div class="space-y-2">
                <div id="org-handover-search-wrap">
                    <input type="text" id="org-handover-search" class="input w-full" placeholder="${safeAttr(t("org.handoverSearchPlaceholder"))}" data-icon="search">
                    <div id="org-handover-search-results" class="mt-2 space-y-1"></div>
                </div>
            </div>

            <div class="space-y-2">
                <label class="text-sm font-medium">${t("org.handoverInclude")}</label>
                <label class="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" id="org-handover-inc-students" class="checkbox" checked>
                    <span class="text-sm">${t("org.handoverIncludeStudents")}</span>
                </label>
                <label class="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" id="org-handover-inc-categories" class="checkbox" checked>
                    <span class="text-sm">${t("org.handoverIncludeCategories")}</span>
                </label>
                <label class="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" id="org-handover-inc-grades" class="checkbox" checked>
                    <span class="text-sm">${t("org.handoverIncludeGrades")}</span>
                </label>
                <label class="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" id="org-handover-inc-entries" class="checkbox" checked>
                    <span class="text-sm">${t("org.handoverIncludeEntries")}</span>
                </label>
                <label class="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" id="org-handover-inc-comments" class="checkbox" checked>
                    <span class="text-sm">${t("org.handoverIncludeComments")}</span>
                </label>
            </div>

            <p class="text-sm text-amber-500">${t("org.handoverConfirmWarning")}</p>

            <button id="org-handover-send-btn" class="btn-primary w-full" disabled>${lucideIcon('send')} ${t("org.handoverSend")}</button>
        </div>
    `;

    const searchInput = document.getElementById('org-handover-search');
    searchInput.addEventListener('input', () => {
        clearTimeout(orgHandoverSearchTimer);
        const query = searchInput.value.trim();
        orgHandoverSearchTimer = setTimeout(() => orgHandoverSearchMembers(query), 300);
    });

    document.getElementById('org-handover-send-btn').addEventListener('click', () => orgSendHandover(currentClass.id));

    dialog.showModal();
};

const orgHandoverSearchMembers = async (query) => {
    const resultsEl = document.getElementById('org-handover-search-results');
    if (!resultsEl) return;

    if (query.length < 2) {
        resultsEl.innerHTML = '';
        return;
    }

    try {
        const response = await fetch(`/api/org/members/search?q=${encodeURIComponent(query)}`);
        const data = await response.json();
        if (!data.success) {
            resultsEl.innerHTML = '';
            return;
        }

        if (!data.results || data.results.length === 0) {
            resultsEl.innerHTML = `<p class="text-sm text-gray-400">${t("org.handoverNoResults")}</p>`;
            return;
        }

        resultsEl.innerHTML = data.results.map(r => `
            <button type="button" class="org-handover-result w-full text-left p-2 border rounded-lg hover:bg-gray-500/10" data-user-id="${safeAttr(r.user_id)}" data-email="${safeAttr(r.email)}" data-username="${safeAttr(r.username)}">
                <span class="text-sm font-medium">${escapeHtml(r.email)}</span>
                <span class="text-xs text-gray-400"> — ${escapeHtml(r.username)}</span>
            </button>
        `).join('');

        resultsEl.querySelectorAll('.org-handover-result').forEach(btn => {
            btn.addEventListener('click', () => {
                orgHandoverSelectedUser = {
                    user_id: btn.dataset.userId,
                    email: btn.dataset.email,
                    username: btn.dataset.username
                };
                orgHandoverRenderSelected();
            });
        });
    } catch (error) {
        resultsEl.innerHTML = '';
    }
};

const orgHandoverRenderSelected = () => {
    const wrap = document.getElementById('org-handover-search-wrap');
    const sendBtn = document.getElementById('org-handover-send-btn');
    if (!wrap || !orgHandoverSelectedUser) return;

    wrap.innerHTML = `
        <div class="flex items-center justify-between gap-2 p-2 border rounded-lg bg-blue-500/10 border-blue-500/30">
            <div class="min-w-0">
                <p class="text-sm font-medium truncate">${escapeHtml(orgHandoverSelectedUser.email)}</p>
                <p class="text-xs text-gray-400 truncate">${escapeHtml(orgHandoverSelectedUser.username)}</p>
            </div>
            <button type="button" id="org-handover-change-btn" class="btn-sm-outline shrink-0">${t("org.handoverSearchPlaceholder")}</button>
        </div>
    `;

    document.getElementById('org-handover-change-btn').addEventListener('click', () => {
        orgHandoverSelectedUser = null;
        wrap.innerHTML = `
            <input type="text" id="org-handover-search" class="input w-full" placeholder="${safeAttr(t("org.handoverSearchPlaceholder"))}" data-icon="search">
            <div id="org-handover-search-results" class="mt-2 space-y-1"></div>
        `;
        const searchInput = document.getElementById('org-handover-search');
        searchInput.addEventListener('input', () => {
            clearTimeout(orgHandoverSearchTimer);
            const query = searchInput.value.trim();
            orgHandoverSearchTimer = setTimeout(() => orgHandoverSearchMembers(query), 300);
        });
        if (sendBtn) sendBtn.disabled = true;
    });

    if (sendBtn) sendBtn.disabled = false;
};

const orgSendHandover = async (classId) => {
    if (!orgHandoverSelectedUser) return;
    const btn = document.getElementById('org-handover-send-btn');
    setButtonLoading(btn, true, t("loading.creating"));

    const include = {
        students: document.getElementById('org-handover-inc-students').checked,
        categories: document.getElementById('org-handover-inc-categories').checked,
        grades: document.getElementById('org-handover-inc-grades').checked,
        entries: document.getElementById('org-handover-inc-entries').checked,
        comments: document.getElementById('org-handover-inc-comments').checked
    };

    try {
        const response = await fetch('/api/org/handover', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ class_id: classId, to_user_id: orgHandoverSelectedUser.user_id, include })
        });
        const data = await response.json();
        if (data.success) {
            showToast(t("toast.handoverSent"), 'success');
            const dialog = document.getElementById('org-handover-dialog');
            if (dialog) dialog.close();
        } else {
            showToast(data.message ? t(data.message) : t("error.connectionError"), 'error');
            setButtonLoading(btn, false);
        }
    } catch (error) {
        showToast(t("error.connectionError"), 'error');
        setButtonLoading(btn, false);
    }
};

// ---------------------------------------------------------------------
// Init: reveal the handover button once we know the user is an approved
// org member, and wire the dialog's close button.
// ---------------------------------------------------------------------

document.addEventListener('app:dataLoaded', async () => {
    const handoverBtn = document.getElementById('org-handover-btn');
    if (!handoverBtn) return;

    try {
        const response = await fetch('/api/org/status');
        const data = await response.json();
        orgStatusCache = data;

        if (data.success && data.member && data.status === 'approved') {
            handoverBtn.classList.remove('hidden');
            handoverBtn.addEventListener('click', openOrgHandoverDialog);
        }
    } catch (error) {
        // Silently ignore — button stays hidden.
    }
});

const closeOrgHandoverBtn = document.getElementById('close-org-handover');
if (closeOrgHandoverBtn) {
    closeOrgHandoverBtn.addEventListener('click', () => {
        const dialog = document.getElementById('org-handover-dialog');
        if (dialog) dialog.close();
    });
}

// ---------------------------------------------------------------------
// Profile dialog: compact organisation widget (join / pending / approved)
// ---------------------------------------------------------------------

/**
 * Renders the compact organisation widget shown in the Profile dialog.
 * Safe to call at any time (including before the dialog markup exists) —
 * it defensively no-ops if #profile-org-content isn't in the DOM yet.
 * Re-called every time the Profile dialog opens (wired in index.html).
 */
const renderProfileOrgWidget = async () => {
    const container = document.getElementById('profile-org-content');
    if (!container) return;

    container.innerHTML = `<div class="flex items-center justify-center p-4">${SPINNER_SVG}</div>`;

    try {
        const response = await fetch('/api/org/status');
        const data = await response.json();

        if (!data.success) {
            container.innerHTML = `<p class="text-sm text-red-500">${t("error.connectionError")}</p>`;
            return;
        }

        if (!data.member) {
            container.innerHTML = `
                <div class="space-y-2">
                    <div class="flex gap-2">
                        <input type="text" id="profile-org-join-code" class="input flex-1" placeholder="${safeAttr(t("org.joinCodePlaceholder"))}" data-icon="hash">
                        <button id="profile-org-join-btn" class="btn-primary shrink-0">${lucideIcon('log-in')} ${t("org.join")}</button>
                    </div>
                    <p class="text-sm text-gray-400">${t("org.noOrgHint")}</p>
                </div>
            `;

            const joinBtn = document.getElementById('profile-org-join-btn');
            joinBtn.addEventListener('click', async () => {
                const codeInput = document.getElementById('profile-org-join-code');
                const joinCode = codeInput.value.trim();
                if (!joinCode) return;

                setButtonLoading(joinBtn, true);

                try {
                    const response = await fetch('/api/org/join', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ join_code: joinCode })
                    });
                    const data = await response.json();
                    if (data.success) {
                        showToast(t("toast.orgJoinRequested"), 'success');
                        renderProfileOrgWidget();
                    } else {
                        showToast(data.message ? t(data.message) : t("error.connectionError"), 'error');
                        setButtonLoading(joinBtn, false);
                    }
                } catch (error) {
                    showToast(t("error.connectionError"), 'error');
                    setButtonLoading(joinBtn, false);
                }
            });
        } else if (data.status === 'pending') {
            const orgName = data.org ? escapeHtml(data.org.name) : '';
            container.innerHTML = `
                <div class="space-y-1">
                    <p class="text-sm font-medium">${orgName}</p>
                    <p class="text-sm text-gray-400">${t("org.pendingApproval")}</p>
                </div>
            `;
        } else {
            const orgName = data.org ? escapeHtml(data.org.name) : '';
            container.innerHTML = `
                <p class="text-sm">${orgName}</p>
                <p class="text-xs text-gray-400">${t("org.approvedMemberHint")}</p>
            `;
        }
    } catch (error) {
        container.innerHTML = `<p class="text-sm text-red-500">${t("error.connectionError")}</p>`;
    }
};
window.renderProfileOrgWidget = renderProfileOrgWidget;

// ---------------------------------------------------------------------
// Pure org-admin accounts: dedicated dashboard (no personal gradebook)
// ---------------------------------------------------------------------

/**
 * Wires the org-admin dashboard's logout button once. Safe to call on
 * every renderOrgAdminDashboard() re-render — guarded via dataset.wired.
 */
const wireOrgAdminLogoutBtn = () => {
    const logoutBtn = document.getElementById('org-admin-logout-btn');
    if (!logoutBtn || logoutBtn.dataset.wired) return;
    logoutBtn.dataset.wired = '1';
    logoutBtn.addEventListener('click', async () => {
        try {
            await fetch('/api/logout', { method: 'POST' });
        } catch (error) {
            // Ignore errors, redirect anyway (best-effort logout).
        }
        window.location.href = '/login';
    });
};

/**
 * Renders the full-page dashboard shown to pure org-admin accounts
 * (account_type === 'org_admin' — no personal classes/grades). Reuses the
 * join-code block, pending-members list and roster table already built for
 * the Settings-tab panel via the shared containerId/refreshFn parameters.
 */
const renderOrgAdminDashboard = async () => {
    const container = document.getElementById('org-admin-content');
    if (!container) return;

    container.innerHTML = `<div class="flex items-center justify-center p-8">${SPINNER_SVG}</div>`;

    try {
        const response = await fetch('/api/org/status');
        const data = await response.json();

        if (!data.success || !data.member || !data.org) {
            container.innerHTML = `<p class="text-sm text-red-500">${t("error.connectionError")}</p>`;
            wireOrgAdminLogoutBtn();
            return;
        }

        const org = data.org;

        container.innerHTML = `
            <div class="space-y-6">
                ${renderOrgJoinCodeBlock(org.join_code)}

                <div class="space-y-2">
                    <h4 class="text-sm font-medium">${t("org.pendingMembers")}</h4>
                    <div id="org-admin-pending-members-list" class="flex items-center justify-center p-4">${SPINNER_SVG}</div>
                </div>

                <div class="space-y-2">
                    <h4 class="text-sm font-medium">${t("org.roster")}</h4>
                    <p class="text-sm text-gray-400">${t("org.rosterHint")}</p>
                    <div id="org-admin-roster-list" class="flex items-center justify-center p-4">${SPINNER_SVG}</div>
                </div>

                <hr>

                <button id="org-admin-leave-btn" class="btn-destructive">${lucideIcon('log-out')} ${t("org.leaveOrganisation")}</button>
            </div>
        `;

        wireOrgJoinCodeCopyBtn(org.join_code);
        renderOrgPendingMembers('org-admin-pending-members-list', renderOrgAdminDashboard);
        renderOrgRoster('org-admin-roster-list');

        document.getElementById('org-admin-leave-btn').addEventListener('click', () => {
            const doLeave = async () => {
                try {
                    const response = await fetch('/api/org/leave', { method: 'POST' });
                    const data = await response.json();
                    if (data.success) {
                        showToast(t("toast.orgLeft"), 'success');
                        // A pure org-admin account has nothing meaningful left
                        // to do without an org — send it back to login.
                        window.location.href = '/login';
                    } else {
                        showToast(data.message ? t(data.message) : t("error.connectionError"), 'error');
                    }
                } catch (error) {
                    showToast(t("error.connectionError"), 'error');
                }
            };

            if (typeof showConfirmDialog === 'function') {
                showConfirmDialog(t("org.confirmLeave"), doLeave);
            } else if (confirm(t("org.confirmLeave"))) {
                doLeave();
            }
        });
    } catch (error) {
        container.innerHTML = `<p class="text-sm text-red-500">${t("error.connectionError")}</p>`;
    }

    wireOrgAdminLogoutBtn();
};
window.renderOrgAdminDashboard = renderOrgAdminDashboard;
