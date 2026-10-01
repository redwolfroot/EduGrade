// donatePrompt.js
// "Gefällt dir EduGrade?" — occasional Ko-fi donation prompt after login.
//
// Schedule lives in appData.donatePrompt.nextAt (encrypted account data), so it
// is shared across devices and a teacher isn't asked again on every browser:
//   - first time seen          -> first prompt after FIRST_DELAY_DAYS
//   - "Später" / X / Esc       -> again after REMIND_DAYS
//   - donate button clicked    -> again after AFTER_DONATE_DAYS
// At most once per browser session, and never on top of another dialog.

const DONATE_FIRST_DELAY_DAYS = 2;
const DONATE_REMIND_DAYS = 30;
const DONATE_AFTER_DONATE_DAYS = 180;
const DONATE_SESSION_KEY = 'edugrade_donate_prompt_checked';
const DAY_MS = 24 * 60 * 60 * 1000;

const scheduleDonatePrompt = (days) => {
    appData.donatePrompt = { nextAt: Date.now() + days * DAY_MS };
    saveData('');
};

const maybeShowDonatePrompt = () => {
    try {
        if (sessionStorage.getItem(DONATE_SESSION_KEY)) return;
        sessionStorage.setItem(DONATE_SESSION_KEY, '1');
    } catch (_) { /* no sessionStorage — schedule below still limits it */ }

    const nextAt = appData.donatePrompt && appData.donatePrompt.nextAt;
    if (!nextAt) {
        scheduleDonatePrompt(DONATE_FIRST_DELAY_DAYS);
        return;
    }
    if (Date.now() < nextAt) return;

    // Let the dashboard settle first; skip if something else is already asking
    // for attention (update dialog, app promo, tutorial) — it'll come next session.
    setTimeout(() => {
        if (document.querySelector('dialog[open], .apk-promo-ov, .tutorial-prompt, .domain-move-ov')) return;
        const dialog = document.getElementById('donate-prompt-dialog');
        dialog.dataset.donated = '';
        dialog.showModal();
    }, 2500);
};

document.addEventListener('DOMContentLoaded', () => {
    const dialog = document.getElementById('donate-prompt-dialog');
    if (!dialog) return;
    document.getElementById('donate-prompt-kofi').addEventListener('click', () => {
        dialog.dataset.donated = '1';
        dialog.close();
    });
    dialog.addEventListener('close', () => {
        scheduleDonatePrompt(dialog.dataset.donated ? DONATE_AFTER_DONATE_DAYS : DONATE_REMIND_DAYS);
    });
});
