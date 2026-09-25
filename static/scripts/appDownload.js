// appDownload.js
// "App-Download" dialog from the profile menu. Android shows a QR code to the
// newest APK; iOS is locked (App Store fees) and points to Ko-fi instead.

// Bumped per Android selection so a slow earlier request can't overwrite a newer one.
let _appDlRequest = 0;

const openAppDownloadDialog = () => {
    selectAppPlatform(null);
    document.getElementById('app-download-dialog').showModal();
};

const selectAppPlatform = (platform) => {
    document.querySelectorAll('[data-app-platform]').forEach(btn => {
        btn.setAttribute('aria-pressed', String(btn.dataset.appPlatform === platform));
    });
    document.getElementById('app-dl-android-panel').hidden = platform !== 'android';
    document.getElementById('app-dl-ios-panel').hidden = platform !== 'ios';
    if (platform === 'android') loadAndroidDownload();
};

const loadAndroidDownload = async () => {
    const req = ++_appDlRequest;
    const qrBox = document.getElementById('app-dl-qr');
    const meta = document.getElementById('app-dl-meta');
    const direct = document.getElementById('app-dl-direct');
    qrBox.innerHTML = `<span class="text-sm text-gray-400">${escapeHtml(t('appDownload.loading'))}</span>`;
    meta.textContent = '';
    direct.classList.add('hidden');

    let release = null;
    try {
        const response = await fetch('/api/app/latest');
        release = response.ok ? await response.json() : null;
    } catch (_) { /* offline — handled below */ }
    if (req !== _appDlRequest) return;
    if (!release || !release.available) {
        qrBox.innerHTML = `<span class="text-sm text-gray-400">${escapeHtml(t('appDownload.notAvailable'))}</span>`;
        return;
    }

    // The download route always serves the newest APK; ?v= only makes each
    // release's QR code (and any cached download) distinct.
    const url = new URL(release.downloadUrl || '/download/edugrade.apk', window.location.origin);
    url.searchParams.set('v', release.versionCode);
    direct.href = url.pathname + url.search;
    direct.classList.remove('hidden');
    meta.textContent = [
        t('appDownload.version', { version: release.versionName }),
        release.beta ? 'Beta' : null,
        release.sizeBytes ? `${Math.round(release.sizeBytes / 1048576)} MB` : null,
    ].filter(Boolean).join(' · ');

    try {
        const response = await fetch('/api/qrcode/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: url.href })
        });
        const data = response.ok ? await response.json() : null;
        if (req !== _appDlRequest) return;
        if (!data || !data.success) throw new Error('qr');
        qrBox.innerHTML = `<img src="${safeAttr(data.qr_code)}" alt="${safeAttr(t('appDownload.qrAlt'))}" width="200" height="200">`;
    } catch (_) {
        if (req !== _appDlRequest) return;
        qrBox.innerHTML = `<span class="text-sm text-red-500">${escapeHtml(t('appDownload.qrError'))}</span>`;
    }
};

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('app-download-btn')?.addEventListener('click', openAppDownloadDialog);
    document.querySelectorAll('[data-app-platform]').forEach(btn => {
        btn.addEventListener('click', () => selectAppPlatform(btn.dataset.appPlatform));
    });
});
