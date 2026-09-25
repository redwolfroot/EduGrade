/*
 * Native-app download promo. On Android browsers (not already running as an
 * installed PWA), offers the native EduGrade APK.
 *
 * Dismissal model (so it can never get permanently lost by accident):
 *   - Soft close ("Later" / backdrop / X)  -> sessionStorage only: hidden this
 *     visit, returns next time the site is opened.
 *   - Download tap                          -> localStorage: they got it, don't
 *     auto-open again until a newer versionCode ships.
 *   - A small "App (Beta)" pill stays in the corner either way, so the modal is
 *     always one tap away.
 */
(function () {
  'use strict';

  var GOT_KEY = 'edugrade_apk_got';        // localStorage: highest versionCode downloaded
  var SEEN_KEY = 'edugrade_apk_seen';      // sessionStorage: soft-dismissed this session

  var TXT = {
    de: {
      badge: 'BETA',
      title: 'EduGrade als App',
      lead: 'Du bist auf einem Android-Gerät. Die native App läuft flüssiger als die Webseite — probier sie aus.',
      bullets: [
        'Schneller & flüssiger als der Browser',
        'Wisch-Gesten zum Bearbeiten und Löschen',
        'Hell/Dunkel-Modus, offline-fähig',
        'Heimbildschirm-Symbol wie eine echte App',
      ],
      note: 'Beta — Installation aus unbekannter Quelle muss erlaubt werden.',
      download: 'App herunterladen',
      later: 'Im Browser bleiben',
      version: 'Version',
      pill: 'App',
    },
    en: {
      badge: 'BETA',
      title: 'EduGrade as an app',
      lead: 'You are on an Android device. The native app runs smoother than the website — give it a try.',
      bullets: [
        'Faster & smoother than the browser',
        'Swipe gestures to edit and delete',
        'Light/dark mode, offline-capable',
        'Home-screen icon like a real app',
      ],
      note: 'Beta — you must allow installation from unknown sources.',
      download: 'Download app',
      later: 'Stay in browser',
      version: 'Version',
      pill: 'App',
    },
  };

  function lang() {
    try {
      if (window.I18n && I18n.getCurrentLanguage) return I18n.getCurrentLanguage() === 'en' ? 'en' : 'de';
    } catch (e) {}
    return (navigator.language || 'de').toLowerCase().indexOf('en') === 0 ? 'en' : 'de';
  }

  function isAndroid() { return /Android/i.test(navigator.userAgent || ''); }

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true;
  }

  function gotVersion() {
    try { return parseInt(localStorage.getItem(GOT_KEY) || '0', 10) || 0; } catch (e) { return 0; }
  }
  function seenThisSession(code) {
    try { return (parseInt(sessionStorage.getItem(SEEN_KEY) || '0', 10) || 0) >= code; } catch (e) { return false; }
  }

  function injectStyles() {
    if (document.getElementById('apk-promo-style')) return;
    var css = ''
      + '.apk-promo-ov{position:fixed;inset:0;z-index:10000;background:rgba(8,8,8,.72);'
      + 'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;align-items:flex-end;'
      + 'justify-content:center;animation:apkFade .25s ease}'
      + '.apk-promo{width:100%;max-width:460px;background:var(--surface,#fff);color:var(--text,#141414);'
      + 'border-radius:22px 22px 0 0;padding:24px 22px calc(22px + env(safe-area-inset-bottom));'
      + 'box-shadow:0 -8px 40px rgba(0,0,0,.35);animation:apkUp .32s cubic-bezier(.2,.8,.2,1)}'
      + '@media(min-width:520px){.apk-promo-ov{align-items:center}.apk-promo{border-radius:22px}}'
      + '.apk-promo-head{display:flex;align-items:center;gap:12px;margin-bottom:14px}'
      + '.apk-promo-logo{width:48px;height:48px;border-radius:14px;background:var(--bg,#F2EFE6);'
      + 'display:flex;align-items:center;justify-content:center;flex:0 0 auto}'
      + '.apk-promo-logo img{width:34px;height:34px}'
      + '.apk-promo-badge{display:inline-block;font:700 11px/1 ui-monospace,monospace;letter-spacing:.12em;'
      + 'color:#fff;background:#FF6B4A;padding:4px 8px;border-radius:999px;margin-bottom:6px}'
      + '.apk-promo h2{font-size:1.35rem;font-weight:800;margin:0}'
      + '.apk-promo p.lead{margin:.5rem 0 1rem;color:var(--text-muted,#6B6B63);font-size:.95rem;line-height:1.5}'
      + '.apk-promo ul{list-style:none;margin:0 0 1rem;padding:0;display:flex;flex-direction:column;gap:8px}'
      + '.apk-promo li{display:flex;gap:10px;align-items:flex-start;font-size:.92rem}'
      + '.apk-promo li svg{flex:0 0 auto;margin-top:1px;color:#FF6B4A}'
      + '.apk-promo .note{font-size:.78rem;color:var(--text-muted,#6B6B63);margin:0 0 1rem}'
      + '.apk-promo-actions{display:flex;flex-direction:column;gap:10px}'
      + '.apk-promo-dl{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;'
      + 'padding:14px;border:0;border-radius:14px;background:#FF6B4A;color:#fff;font-weight:700;'
      + 'font-size:1rem;cursor:pointer;text-decoration:none}'
      + '.apk-promo-dl:active{transform:scale(.99)}'
      + '.apk-promo-later{width:100%;padding:12px;border:0;background:transparent;color:var(--text-muted,#6B6B63);'
      + 'font-size:.92rem;cursor:pointer}'
      + '.apk-promo-ver{text-align:center;font:600 .72rem/1 ui-monospace,monospace;color:var(--text-muted,#6B6B63);margin-top:10px}'
      // floating reopen pill
      + '.apk-pill{position:fixed;left:14px;bottom:calc(14px + env(safe-area-inset-bottom));z-index:9998;'
      + 'display:flex;align-items:center;gap:7px;padding:9px 14px;border:0;border-radius:999px;'
      + 'background:#FF6B4A;color:#fff;font-weight:700;font-size:.85rem;cursor:pointer;'
      + 'box-shadow:0 6px 20px rgba(0,0,0,.28);animation:apkFade .3s ease}'
      + '.apk-pill svg{width:16px;height:16px}'
      + '.apk-pill .dot{font:700 9px/1 ui-monospace,monospace;background:rgba(255,255,255,.25);'
      + 'padding:2px 5px;border-radius:999px;letter-spacing:.06em}'
      + '@keyframes apkFade{from{opacity:0}to{opacity:1}}'
      + '@keyframes apkUp{from{transform:translateY(24px);opacity:.6}to{transform:translateY(0);opacity:1}}';
    var st = document.createElement('style');
    st.id = 'apk-promo-style';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function checkIcon() {
    return '<svg class="lucide lucide-check-icon lucide-check" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
      + 'stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  }
  function dlIcon() {
    return '<svg class="lucide lucide-download-icon lucide-download" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
  }

  function openModal(rel) {
    if (document.querySelector('.apk-promo-ov')) return; // already open
    injectStyles();
    var t = TXT[lang()];
    var ov = document.createElement('div');
    ov.className = 'apk-promo-ov';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');

    var bullets = t.bullets.map(function (b) {
      return '<li>' + checkIcon() + '<span>' + b + '</span></li>';
    }).join('');

    ov.innerHTML = ''
      + '<div class="apk-promo">'
      + '  <div class="apk-promo-head">'
      + '    <div class="apk-promo-logo"><img src="/static/logo.svg" alt="EduGrade"></div>'
      + '    <div><span class="apk-promo-badge">' + t.badge + '</span><h2>' + t.title + '</h2></div>'
      + '  </div>'
      + '  <p class="lead">' + t.lead + '</p>'
      + '  <ul>' + bullets + '</ul>'
      + '  <p class="note">' + t.note + '</p>'
      + '  <div class="apk-promo-actions">'
      + '    <a class="apk-promo-dl" href="' + (rel.downloadUrl || '/download/edugrade.apk') + '">'
      + dlIcon() + ' ' + t.download + '</a>'
      + '    <button class="apk-promo-later" type="button">' + t.later + '</button>'
      + '  </div>'
      + '  <div class="apk-promo-ver">' + t.version + ' ' + (rel.versionName || '') + '</div>'
      + '</div>';

    function softClose() {
      try { sessionStorage.setItem(SEEN_KEY, String(rel.versionCode || 0)); } catch (e) {}
      ov.remove();
    }
    ov.querySelector('.apk-promo-later').addEventListener('click', softClose);
    ov.addEventListener('click', function (e) { if (e.target === ov) softClose(); });
    ov.querySelector('.apk-promo-dl').addEventListener('click', function () {
      try { localStorage.setItem(GOT_KEY, String(rel.versionCode || 0)); } catch (e) {}
      ov.remove();
    });

    document.body.appendChild(ov);
  }

  function addPill(rel) {
    if (document.querySelector('.apk-pill')) return;
    injectStyles();
    var t = TXT[lang()];
    var pill = document.createElement('button');
    pill.className = 'apk-pill';
    pill.type = 'button';
    pill.innerHTML = dlIcon() + '<span>' + t.pill + '</span><span class="dot">' + t.badge + '</span>';
    pill.addEventListener('click', function () { openModal(rel); });
    document.body.appendChild(pill);
  }

  function init() {
    if (!isAndroid() || isStandalone()) return;
    fetch('/api/app/latest', { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (rel) {
        if (!rel || !rel.available) return;
        var code = rel.versionCode || 0;
        addPill(rel); // always reachable
        var got = gotVersion() >= code;
        var seen = seenThisSession(code);
        if (!got && !seen) openModal(rel);
      })
      .catch(function () { /* offline / not published — stay silent */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
