// domain-move.js
// EduGrade zieht von edugrade.avocloud.net auf edugrade.at um.
//   - Alte Adresse: Hinweis mit "Weiter" (bleibt hier, einmal pro Browser-
//     Sitzung) oder "Zur neuen Domain" (gleicher Pfad auf edugrade.at).
//   - Wer über diesen Button auf edugrade.at landet (?moved=<lang>), wird dort
//     mit Konfetti begrüßt. Die Sprache reist im Parameter mit, weil die neue
//     Domain den localStorage der alten nicht lesen kann.
//
// Deliberately dependency-free (no Tailwind/Basecoat/i18n) so it works on every
// page, including the ones that don't load those. Looks like the other modals:
// centered card on a blurred backdrop (same overlay as app-promo.js).
(() => {
    const OLD_HOST = 'edugrade.avocloud.net';
    const NEW_ORIGIN = 'https://edugrade.at';
    const NEW_HOST = 'edugrade.at';
    const MOVED_PARAM = 'moved';
    // Session cookie, not sessionStorage: that one is per tab, so every new tab
    // (e.g. the Terms link) would show the notice again after "Weiter".
    const DISMISS_COOKIE = 'edugrade_domain_move=1';

    const TEXTS = {
        de: {
            badge: 'NEU',
            title: 'EduGrade hat ein eigenes Zuhause!',
            lead: 'EduGrade ist erwachsen geworden: Ab sofort gibt es EduGrade als eigenständiges Produkt unter einer eigenen Adresse. Neue Domain, dasselbe EduGrade, das du kennst.',
            hint: 'Speicher dir die neue Adresse am besten gleich als Lesezeichen.',
            stay: 'Weiter',
            go: 'Zur neuen Domain',
            welcomeBadge: 'WILLKOMMEN',
            welcomeTitle: 'Willkommen auf edugrade.at!',
            welcomeLead: 'Schön, dass du da bist! Das hier ist ab sofort das neue Zuhause von EduGrade.',
            welcomeHint: 'Kleiner Tipp: Speicher dir diese Seite gleich als Lesezeichen.',
            welcomeGo: 'Los geht’s',
        },
        en: {
            badge: 'NEW',
            title: 'EduGrade has a home of its own!',
            lead: 'EduGrade has grown up: from now on it is a product of its own, with its own address. New domain, same EduGrade you know.',
            hint: 'Best save the new address as a bookmark right away.',
            stay: 'Continue',
            go: 'Go to the new domain',
            welcomeBadge: 'WELCOME',
            welcomeTitle: 'Welcome to edugrade.at!',
            welcomeLead: 'Great to have you here! This is EduGrade’s new home from now on.',
            welcomeHint: 'Quick tip: bookmark this page right away.',
            welcomeGo: 'Let’s go',
        },
    };

    // Own keys only: "constructor" or "__proto__" from a crafted ?moved= link must not count.
    const known = (code) => Object.prototype.hasOwnProperty.call(TEXTS, code);

    const lang = (preferred) => {
        let stored = null;
        try { stored = localStorage.getItem('edugrade-lang'); } catch (_) { /* storage blocked */ }
        for (const code of [preferred, stored, (navigator.language || '').substring(0, 2)]) {
            if (known(code)) return code;
        }
        return 'en';
    };

    const dismissed = () => {
        try { return document.cookie.split('; ').includes(DISMISS_COOKIE); } catch (_) { return false; }
    };
    const rememberDismissed = () => {
        try { document.cookie = DISMISS_COOKIE + '; path=/; SameSite=Lax; Secure'; } catch (_) { /* optional */ }
    };

    // Which dialog, if any, this page load gets.
    let mode = null;
    let movedLang = null;
    if (location.hostname === OLD_HOST) {
        if (!dismissed()) mode = 'move';
    } else if (location.hostname === NEW_HOST) {
        const url = new URL(location.href);
        if (url.searchParams.has(MOVED_PARAM)) {
            mode = 'welcome';
            movedLang = url.searchParams.get(MOVED_PARAM);
            // Carry the language over before i18n.js reads it, so the site
            // matches the old one.
            try {
                if (known(movedLang) && !localStorage.getItem('edugrade-lang')) {
                    localStorage.setItem('edugrade-lang', movedLang);
                }
            } catch (_) { /* optional */ }
            // Drop the marker so a reload or bookmark doesn't greet again.
            url.searchParams.delete(MOVED_PARAM);
            history.replaceState(history.state, '', url.pathname + url.search + url.hash);
        }
    }
    if (!mode) return;

    const injectStyles = () => {
        if (document.getElementById('domain-move-style')) return;
        const st = document.createElement('style');
        st.id = 'domain-move-style';
        st.textContent = ''
            + '.domain-move-ov{position:fixed;inset:0;z-index:10050;background:rgba(8,8,8,.72);'
            + 'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;align-items:center;'
            + 'justify-content:center;padding:16px;animation:domainMoveFade .25s ease}'
            + '.domain-move{width:100%;max-width:440px;box-sizing:border-box;background:var(--card,#fff);'
            + 'color:var(--foreground,#1c1917);border:1px solid var(--border,#e4ddd0);border-radius:18px;'
            + 'padding:28px 24px 22px;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,.4);'
            + 'font-family:inherit;animation:domainMoveUp .3s cubic-bezier(.2,.8,.2,1)}'
            + '.domain-move-icon{width:56px;height:56px;margin:0 auto 14px;border-radius:999px;display:flex;'
            + 'align-items:center;justify-content:center;color:var(--primary,#c4361f);'
            + 'background:color-mix(in srgb,var(--primary,#c4361f) 14%,transparent)}'
            + '.domain-move-badge{display:inline-block;font:700 11px/1 ui-monospace,monospace;letter-spacing:.12em;'
            + 'color:#fff;background:var(--primary,#c4361f);padding:4px 8px;border-radius:999px;margin-bottom:8px}'
            + '.domain-move h2{font-size:1.3rem;font-weight:800;margin:0 0 10px;line-height:1.25}'
            + '.domain-move p{margin:0 0 12px;font-size:.93rem;line-height:1.55;color:var(--muted-foreground,#6b6357)}'
            + '.domain-move-host{display:inline-block;margin:4px 0 14px;padding:8px 16px;border-radius:999px;'
            + 'font:700 1.05rem/1 ui-monospace,monospace;color:var(--primary,#c4361f);'
            + 'border:1px dashed color-mix(in srgb,var(--primary,#c4361f) 55%,transparent)}'
            + '.domain-move-actions{display:flex;flex-direction:column-reverse;gap:8px;margin-top:6px}'
            + '@media(min-width:420px){.domain-move-actions{flex-direction:row}.domain-move-actions>*{flex:1}}'
            + '.domain-move-actions a,.domain-move-actions button{box-sizing:border-box;padding:11px 16px;'
            + 'border-radius:10px;font:inherit;font-size:.93rem;cursor:pointer;text-decoration:none;text-align:center}'
            + '.domain-move-stay{border:1px solid var(--border,#e4ddd0);background:transparent;color:inherit}'
            + '.domain-move-go{border:0;background:var(--primary,#c4361f);color:#fff;font-weight:700}'
            + '.domain-move-confetti{position:fixed;inset:0;width:100%;height:100%;z-index:10051;pointer-events:none}'
            + '@keyframes domainMoveFade{from{opacity:0}to{opacity:1}}'
            + '@keyframes domainMoveUp{from{transform:translateY(16px) scale(.97);opacity:.6}'
            + 'to{transform:none;opacity:1}}';
        document.head.appendChild(st);
    };

    // lucide "party-popper"
    const ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" '
        + 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        + '<path d="M5.8 11.3 2 22l10.7-3.79"/><path d="M4 3h.01"/><path d="M22 8h.01"/><path d="M15 2h.01"/>'
        + '<path d="M22 20h.01"/><path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"/>'
        + '<path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17"/>'
        + '<path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7"/>'
        + '<path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z"/></svg>';

    const el = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text) node.textContent = text;
        return node;
    };

    // Two confetti bursts from the lower corners, drawn on a canvas above the
    // overlay; removes itself when every piece has fallen out of view.
    function confetti() {
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const canvas = el('canvas', 'domain-move-confetti');
        canvas.setAttribute('aria-hidden', 'true');
        document.body.appendChild(canvas);
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const w = innerWidth;
        const h = innerHeight;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.scale(dpr, dpr);

        const primary = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#c4361f';
        const colors = [primary, '#f59e0b', '#10b981', '#3b82f6', '#ec4899', '#a855f7', '#facc15'];
        const pieces = [];
        [[0, -1], [w, 1]].forEach(([x0, dir]) => {
            for (let i = 0; i < 90; i++) {
                const angle = (55 + Math.random() * 30) * Math.PI / 180;
                const speed = 9 + Math.random() * 9;
                pieces.push({
                    x: x0, y: h,
                    vx: -dir * Math.cos(angle) * speed,
                    vy: -Math.sin(angle) * speed * (h / 700 + 0.6),
                    size: 6 + Math.random() * 6,
                    rot: Math.random() * Math.PI,
                    vr: (Math.random() - 0.5) * 0.3,
                    color: colors[i % colors.length],
                    round: Math.random() < 0.3,
                });
            }
        });

        const tick = () => {
            ctx.clearRect(0, 0, w, h);
            let alive = 0;
            for (const p of pieces) {
                p.vy += 0.25;
                p.vx *= 0.99;
                p.x += p.vx;
                p.y += p.vy;
                p.rot += p.vr;
                if (p.y > h + 20) continue;
                alive++;
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(p.rot);
                ctx.fillStyle = p.color;
                if (p.round) {
                    ctx.beginPath();
                    ctx.arc(0, 0, p.size / 2.5, 0, Math.PI * 2);
                    ctx.fill();
                } else {
                    // Flat strip that "flips" as it tumbles.
                    ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2 * Math.abs(Math.cos(p.rot * 2)) + 1);
                }
                ctx.restore();
            }
            if (alive) requestAnimationFrame(tick);
            else canvas.remove();
        };
        requestAnimationFrame(tick);
    }

    // Centered card; the first button closes it (for this session), the
    // optional link leaves the page.
    function modal({ badge, title, lead, host, hint, stayText, goText, goHref }) {
        injectStyles();
        const ov = el('div', 'domain-move-ov');
        ov.setAttribute('role', 'dialog');
        ov.setAttribute('aria-modal', 'true');
        ov.setAttribute('aria-labelledby', 'domain-move-title');

        const card = el('div', 'domain-move');
        const icon = el('div', 'domain-move-icon');
        icon.innerHTML = ICON;
        const h2 = el('h2', '', title);
        h2.id = 'domain-move-title';
        card.append(icon, el('span', 'domain-move-badge', badge), h2, el('p', '', lead));
        if (host) card.appendChild(el('div', 'domain-move-host', host));
        card.appendChild(el('p', '', hint));

        const row = el('div', 'domain-move-actions');
        const stay = el('button', goHref ? 'domain-move-stay' : 'domain-move-go', stayText);
        stay.type = 'button';
        row.appendChild(stay);
        let focus = stay;
        if (goHref) {
            const go = el('a', 'domain-move-go', goText);
            go.href = goHref;
            // End the session here first: edugrade.at allows one web session per
            // account, so a session left open on the old address would greet the
            // user there with "already signed in on another device".
            go.addEventListener('click', (e) => {
                e.preventDefault();
                const leave = () => { location.href = goHref; };
                const timer = setTimeout(leave, 1500);
                fetch('/api/logout', { method: 'POST', credentials: 'same-origin', keepalive: true })
                    .catch(() => {})
                    .finally(() => { clearTimeout(timer); leave(); });
            });
            row.appendChild(go);
            focus = go;
        }
        card.appendChild(row);
        ov.appendChild(card);

        // Button, Esc and a backdrop click all close it for this session.
        const close = () => {
            rememberDismissed();
            document.removeEventListener('keydown', onKey);
            ov.remove();
        };
        // Esc belongs to a native dialog that is open on top (it closes itself);
        // only a lone Esc dismisses this notice.
        const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('dialog[open]')) close(); };
        stay.addEventListener('click', close);
        ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
        document.addEventListener('keydown', onKey);

        document.body.appendChild(ov);
        focus.focus();
    }

    function show() {
        if (mode === 'move') {
            const code = lang();
            const t = TEXTS[code];
            // Set the parts on the new origin (a path like "//x" must never pick the host).
            const target = new URL(NEW_ORIGIN);
            target.pathname = location.pathname;
            target.search = location.search;
            target.hash = location.hash;
            target.searchParams.set(MOVED_PARAM, code);
            modal({
                badge: t.badge, title: t.title, lead: t.lead, host: NEW_HOST, hint: t.hint,
                stayText: t.stay, goText: t.go, goHref: target.toString(),
            });
        } else {
            const code = lang(movedLang);
            const t = TEXTS[code];
            modal({
                badge: t.welcomeBadge, title: t.welcomeTitle, lead: t.welcomeLead, hint: t.welcomeHint,
                stayText: t.welcomeGo,
            });
            confetti();
        }
    }

    // The dashboard covers everything with its boot loader and, after a login,
    // the intro splash (both above any modal). Wait until they are gone so the
    // notice and the confetti are actually seen; give up waiting after 15 s.
    const appReady = () => {
        if (document.getElementById('avo-splash')) return false;
        const boot = document.getElementById('edu-boot-loader');
        // Hidden via the edu-boot-hide class, then removed (ui.js / index.html).
        return !boot || boot.classList.contains('edu-boot-hide');
    };
    const showWhenReady = () => {
        const started = Date.now();
        const tick = () => {
            if (appReady() || Date.now() - started > 15000) show();
            else setTimeout(tick, 200);
        };
        tick();
    };

    if (document.body) showWhenReady();
    else document.addEventListener('DOMContentLoaded', showWhenReady, { once: true });
})();
