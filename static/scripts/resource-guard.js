// resource-guard.js
// Shows an alert when several scripts/styles/fonts could not be loaded (CSP
// block, ad blocker, school firewall, flaky CDN) and offers a "hard reload"
// that clears the service worker + caches before reloading.
//
// Must be the FIRST <script> in <head>: the listeners have to exist before the
// CDN tags are parsed. Deliberately dependency-free (no Tailwind/Basecoat/i18n
// files) because those are exactly what may have failed to load.
(() => {
    const THRESHOLD = 2;            // distinct failed resources before we warn
    const CRITICAL = /tailwindcss|basecoat/; // layout-critical: warn on the first failure
    const SETTLE_MS = 1200;         // wait for a burst of failures to finish
    const FLAG_KEY = 'edugrade-hard-reload';
    const FLAG_TTL_MS = 2 * 60 * 1000;

    const TEXTS = {
        de: {
            title: 'Einige Ressourcen konnten nicht geladen werden',
            body: 'Die Seite wird eventuell fehlerhaft dargestellt oder einzelne Funktionen gehen nicht. Ein harter Neuladevorgang behebt das meistens.',
            persist: 'Das Problem besteht nach dem Neuladen weiterhin. Vermutlich blockiert ein Werbeblocker, eine Firewall oder das Schulnetzwerk die betroffenen Server.',
            blocked: 'Betroffen',
            reload: 'Hart neu laden',
            reloading: 'Lädt neu …',
            dismiss: 'Schließen',
        },
        en: {
            title: 'Some resources could not be loaded',
            body: 'The page may look broken or some features may not work. A hard reload usually fixes this.',
            persist: 'The problem persists after reloading. An ad blocker, firewall or school network is probably blocking the affected servers.',
            blocked: 'Affected',
            reload: 'Hard reload',
            reloading: 'Reloading …',
            dismiss: 'Dismiss',
        },
    };

    const failed = new Map(); // url -> host
    let settleTimer = null;
    let panel = null;

    const lang = () => {
        let stored = null;
        try { stored = localStorage.getItem('edugrade-lang'); } catch (_) { /* storage blocked */ }
        const code = stored || (navigator.language || '').substring(0, 2);
        return TEXTS[code] ? code : 'en';
    };

    // Drop the cache-buster added by hardReload() so it doesn't linger in the URL bar.
    try {
        const u = new URL(location.href);
        if (u.searchParams.has('_r')) {
            u.searchParams.delete('_r');
            history.replaceState(null, '', u.pathname + u.search + u.hash);
        }
    } catch (_) { /* cosmetic only */ }

    const recentlyReloaded = () => {
        try {
            const at = Number(sessionStorage.getItem(FLAG_KEY));
            return at > 0 && Date.now() - at < FLAG_TTL_MS;
        } catch (_) { return false; }
    };

    const record = (url) => {
        if (!/^https?:/i.test(url) || failed.has(url)) return;
        let host = url;
        try { host = new URL(url).host; } catch (_) { /* keep raw url */ }
        failed.set(url, host);
        if (panel) render();
        clearTimeout(settleTimer);
        settleTimer = setTimeout(check, SETTLE_MS);
    };

    const check = () => {
        if (panel) return;
        const critical = [...failed.keys()].some((u) => CRITICAL.test(u));
        if (failed.size >= THRESHOLD || critical) show();
    };

    // <script>/<link> load failures. Error events don't bubble, hence capture.
    // Needed in addition to CSP events: a request blocked inside the service
    // worker never raises securitypolicyviolation on the page.
    window.addEventListener('error', (e) => {
        const t = e.target;
        if (!t || t === window || !t.tagName) return;
        if (t.tagName === 'SCRIPT') record(t.src);
        else if (t.tagName === 'LINK' && /stylesheet/i.test(t.rel)) record(t.href);
    }, true);

    document.addEventListener('securitypolicyviolation', (e) => {
        if (/^(script|style|font)-src/.test(e.effectiveDirective || e.violatedDirective || '')) {
            record(e.blockedURI);
        }
    });

    async function hardReload() {
        try { sessionStorage.setItem(FLAG_KEY, String(Date.now())); } catch (_) { /* optional */ }
        try {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map((r) => r.unregister()));
        } catch (_) { /* no service worker support */ }
        try {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k)));
        } catch (_) { /* no Cache API */ }
        const u = new URL(location.href);
        u.searchParams.set('_r', Date.now());
        location.replace(u.toString());
    }

    const el = (tag, css, text) => {
        const node = document.createElement(tag);
        if (css) node.style.cssText = css;
        if (text) node.textContent = text;
        return node;
    };

    function render() {
        const t = TEXTS[lang()];
        const dark = document.documentElement.classList.contains('dark')
            || (!document.documentElement.classList.contains('light')
                && matchMedia('(prefers-color-scheme: dark)').matches);
        const c = dark
            ? { bg: '#221f1b', fg: '#f5f0e8', muted: '#9c948a', border: '#3a342d', ghost: '#2a2622' }
            : { bg: '#ffffff', fg: '#1c1917', muted: '#6b6357', border: '#e4ddd0', ghost: '#f1ede6' };

        panel.textContent = '';
        panel.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);'
            + 'z-index:2147483647;width:calc(100% - 32px);max-width:440px;box-sizing:border-box;'
            + `padding:16px;border-radius:10px;border:1px solid ${c.border};border-left:4px solid #c4361f;`
            + `background:${c.bg};color:${c.fg};box-shadow:0 10px 30px rgba(0,0,0,.35);`
            + 'font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;text-align:left;';

        panel.appendChild(el('div', 'font-weight:700;font-size:15px;margin-bottom:6px;', t.title));
        panel.appendChild(el('div', '', recentlyReloaded() ? t.persist : t.body));
        const hosts = [...new Set(failed.values())].join(', ');
        panel.appendChild(el('div', `margin-top:8px;font-size:12px;color:${c.muted};word-break:break-word;`,
            `${t.blocked}: ${hosts}`));

        const row = el('div', 'display:flex;gap:8px;margin-top:12px;justify-content:flex-end;');
        const dismiss = el('button', `padding:7px 14px;border-radius:8px;border:1px solid ${c.border};`
            + `background:${c.ghost};color:${c.fg};font:inherit;cursor:pointer;`, t.dismiss);
        dismiss.type = 'button';
        dismiss.onclick = () => panel.remove();
        const reload = el('button', 'padding:7px 14px;border-radius:8px;border:0;background:#c4361f;'
            + 'color:#fff;font:inherit;font-weight:600;cursor:pointer;', t.reload);
        reload.type = 'button';
        reload.onclick = () => {
            reload.disabled = true;
            reload.textContent = t.reloading;
            hardReload();
        };
        row.append(dismiss, reload);
        panel.appendChild(row);
    }

    function show() {
        if (!document.body) {
            document.addEventListener('DOMContentLoaded', show, { once: true });
            return;
        }
        if (panel) return;
        panel = document.createElement('div');
        panel.setAttribute('role', 'alert');
        panel.id = 'resource-guard';
        render();
        document.body.appendChild(panel);
    }
})();
