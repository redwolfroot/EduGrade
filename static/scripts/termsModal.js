// termsModal.js
// Active consent to changed terms of service. The server locks every write call
// (403 + terms_required) until the user accepts; reading and exporting stay
// possible. The modal is shown on load when index.html flags the account
// (window.__termsRequired) and whenever a write call is rejected with
// terms_required. Esc and backdrop clicks do not dismiss it.

(() => {
    const dialog = () => document.getElementById('terms-dialog');

    const showTermsModal = () => {
        const d = dialog();
        if (d && !d.open) d.showModal();
    };
    window.showTermsModal = showTermsModal;

    // Any write call that is rejected because of the pending consent opens the modal.
    const origFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
        const res = await origFetch(...args);
        if (res.status === 403) {
            res.clone().json().then((data) => {
                if (data && data.terms_required) showTermsModal();
            }).catch(() => { /* not JSON */ });
        }
        return res;
    };

    document.addEventListener('DOMContentLoaded', () => {
        const d = dialog();
        if (!d) return;
        d.addEventListener('cancel', (e) => e.preventDefault());  // Esc

        const acceptBtn = document.getElementById('terms-accept-btn');
        acceptBtn.addEventListener('click', async () => {
            acceptBtn.disabled = true;
            try {
                const res = await origFetch('/api/terms/accept', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ accepted: true, version: d.dataset.version })
                });
                const data = await res.json().catch(() => ({}));
                if (res.ok && data.success) {
                    window.__termsRequired = false;
                    d.close();
                    if (typeof showToast === 'function') showToast(t('terms.accepted'), 'success');
                } else if (typeof showToast === 'function') {
                    showToast(t('error.somethingWrong'), 'error');
                }
            } catch (_) {
                if (typeof showToast === 'function') showToast(t('error.somethingWrong'), 'error');
            } finally {
                acceptBtn.disabled = false;
            }
        });

        // Download the data, then hand over to the regular delete-account dialog.
        document.getElementById('terms-export-delete-btn').addEventListener('click', () => {
            if (typeof exportData === 'function') exportData();
            const del = document.getElementById('profile-delete-account');
            if (del) del.click();
        });

        if (window.__termsRequired) showTermsModal();
    });
})();
