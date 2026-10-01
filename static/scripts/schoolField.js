// ========== SCHOOL FIELD ==========
// The school is mandatory for teacher accounts. It is stored in plain text on
// the account (POST /api/profile/school), not in the encrypted appData, so
// schools colleagues already entered can be suggested while typing
// (GET /api/schools). Server console: `schools` lists them.

const SCHOOL_SUGGEST_DELAY_MS = 200;

/** Saves the school on the account; returns the stored spelling. */
const saveSchool = async (name) => {
    const res = await fetch('/api/profile/school', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ school: name })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.message || 'error.savingData');
    window.currentUser.school = data.school;
    appData.school = data.school;
    document.dispatchEvent(new CustomEvent('school:saved', { detail: data.school }));
    return data.school;
};

/** Suggestion dropdown (combobox) for a school input. */
const attachSchoolAutocomplete = (input, list) => {
    if (!input || !list || input.dataset.schoolAutocomplete) return;
    input.dataset.schoolAutocomplete = '1';
    let timer = null;
    let requestId = 0;
    let active = -1;

    const items = () => [...list.querySelectorAll('[role="option"]')];

    const hide = () => {
        list.classList.add('hidden');
        list.replaceChildren();
        input.setAttribute('aria-expanded', 'false');
        active = -1;
    };

    const setActive = (index) => {
        const opts = items();
        active = opts.length ? (index + opts.length) % opts.length : -1;
        opts.forEach((o, i) => o.setAttribute('aria-selected', String(i === active)));
        if (active >= 0) opts[active].scrollIntoView({ block: 'nearest' });
    };

    const choose = (name) => {
        input.value = name;
        hide();
        input.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const show = (schools) => {
        const typed = input.value.trim().toLowerCase();
        // Nothing to suggest if the only hit is exactly what's already typed
        if (!schools.length || (schools.length === 1 && schools[0].toLowerCase() === typed)) {
            hide();
            return;
        }
        list.replaceChildren(...schools.map((name, i) => {
            const li = document.createElement('li');
            li.setAttribute('role', 'option');
            li.id = `${list.id}-${i}`;
            li.textContent = name;
            li.setAttribute('aria-selected', 'false');
            // mousedown instead of click: fires before the input's blur hides the list
            li.addEventListener('mousedown', (e) => {
                e.preventDefault();
                choose(name);
            });
            return li;
        }));
        list.classList.remove('hidden');
        input.setAttribute('aria-expanded', 'true');
        active = -1;
    };

    const fetchSuggestions = async () => {
        const q = input.value.trim();
        const id = ++requestId;
        if (q.length < 2) {
            hide();
            return;
        }
        try {
            const res = await fetch(`/api/schools?q=${encodeURIComponent(q)}`);
            const data = await res.json();
            if (id === requestId && document.activeElement === input) show(data.schools || []);
        } catch {
            hide();
        }
    };

    input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(fetchSuggestions, SCHOOL_SUGGEST_DELAY_MS);
    });
    input.addEventListener('focus', fetchSuggestions);
    input.addEventListener('blur', () => setTimeout(hide, 100));
    input.addEventListener('keydown', (e) => {
        const open = !list.classList.contains('hidden');
        if (e.key === 'ArrowDown' && open) {
            e.preventDefault();
            setActive(active + 1);
        } else if (e.key === 'ArrowUp' && open) {
            e.preventDefault();
            setActive(active - 1);
        } else if (e.key === 'Enter' && open && active >= 0) {
            e.preventDefault();
            choose(items()[active].textContent);
        } else if (e.key === 'Escape' && open) {
            // Only close the list, not the surrounding dialog
            e.preventDefault();
            e.stopPropagation();
            hide();
        }
    });
};

/**
 * Makes sure a teacher account has a school. Older accounts that only have it
 * in their (encrypted) appData are migrated silently; otherwise the profile
 * dialog opens and can't be left until a school is saved.
 * Resolves once the account has a school.
 */
const ensureSchoolSet = async () => {
    if (!window.currentUser || window.currentUser.account_type === 'org_admin') return;
    if ((window.currentUser.school || '').trim()) return;

    const legacy = (appData.school || '').trim();
    if (legacy) {
        try {
            await saveSchool(legacy);
            return;
        } catch (e) {
            console.error('School migration failed:', e);
        }
    }

    const dialog = document.getElementById('profile-dialog');
    if (!dialog || !window.openProfileDialog) return;
    const saved = new Promise((resolve) => {
        document.addEventListener('school:saved', resolve, { once: true });
    });
    setSchoolRequired(dialog, true);
    window.openProfileDialog();
    const input = document.getElementById('profile-school');
    if (input) {
        input.scrollIntoView({ block: 'center' });
        input.focus();
    }
    await saved;
    setSchoolRequired(dialog, false);
};

/** Required mode: notice shown, cancel/close hidden, Escape blocked. */
const setSchoolRequired = (dialog, required) => {
    dialog.toggleAttribute('data-school-required', required);
    document.getElementById('profile-school-required')?.classList.toggle('hidden', !required);
};

(() => {
    attachSchoolAutocomplete(
        document.getElementById('profile-school'),
        document.getElementById('profile-school-suggestions'));
    attachSchoolAutocomplete(
        document.getElementById('setup-school'),
        document.getElementById('setup-school-suggestions'));

    const dialog = document.getElementById('profile-dialog');
    if (!dialog) return;
    dialog.addEventListener('cancel', (e) => {
        if (dialog.hasAttribute('data-school-required')) e.preventDefault();
    });
    // Any other way out (backdrop click etc.): reopen while still required
    dialog.addEventListener('close', () => {
        if (dialog.hasAttribute('data-school-required') && !(window.currentUser.school || '').trim()) {
            setTimeout(() => window.openProfileDialog && window.openProfileDialog(), 0);
        }
    });
})();
