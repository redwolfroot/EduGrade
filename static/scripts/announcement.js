// announcement.js
// Developer announcements (created in the server console: `python manage.py` → announce).
// After login the dashboard asks /api/announcement for everything this user
// hasn't confirmed yet and shows it one dialog at a time, oldest first.
// "OK" confirms that one announcement for the account (all devices); Esc and
// backdrop clicks don't count — it has to be acknowledged.

const ANNOUNCEMENT_ICONS = {
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    danger: '<path d="M12 16h.01"/><path d="M12 8v4"/><path d="M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z"/>',
};

const showAnnouncement = (ann) => new Promise((resolve) => {
    const dialog = document.getElementById('announcement-dialog');
    const german = (I18n.getCurrentLanguage() || '').startsWith('de');
    const title = (!german && ann.title_en) || ann.title || I18n.t(`announcement.title.${ann.level}`);
    const message = (!german && ann.message_en) || ann.message;

    dialog.dataset.level = ann.level;
    document.getElementById('announcement-icon').innerHTML =
        `<svg class="lucide" xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ANNOUNCEMENT_ICONS[ann.level] || ANNOUNCEMENT_ICONS.info}</svg>`;
    // textContent only: the text comes from the server config, never render it as HTML.
    document.getElementById('announcement-title').textContent = title;
    document.getElementById('announcement-text').textContent = message;

    const ok = document.getElementById('announcement-ok');
    const onOk = () => {
        ok.removeEventListener('click', onOk);
        fetch('/api/announcement/ack', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: ann.id })
        }).catch(() => { /* shown again next time — acceptable */ });
        dialog.close();
        // Short pause so consecutive announcements read as separate dialogs.
        setTimeout(resolve, 250);
    };
    ok.addEventListener('click', onOk);
    dialog.showModal();
    ok.focus();
});

// Resolves once every pending announcement was confirmed (or right away if none).
const maybeShowAnnouncements = async () => {
    let list = [];
    try {
        const res = await fetch('/api/announcement');
        if (res.ok) list = (await res.json()).announcements || [];
    } catch (_) { return; }
    for (const ann of list) await showAnnouncement(ann);
};

document.addEventListener('DOMContentLoaded', () => {
    const dialog = document.getElementById('announcement-dialog');
    if (dialog) dialog.addEventListener('cancel', (e) => e.preventDefault());  // Esc
});
