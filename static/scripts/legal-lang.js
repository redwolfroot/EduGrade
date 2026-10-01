/**
 * Language switch for the static legal pages (privacy, terms, DPA, DPA sign).
 *
 * Those pages contain both language versions; this script shows the one that
 * matches the account language. Same source as the app (i18n.js): ?lang=,
 * then the stored 'edugrade-lang', then the browser language. Loaded
 * synchronously in <head> so the wrong version never flashes.
 */
(() => {
    const SUPPORTED = ['de', 'en'];
    const STORAGE_KEY = 'edugrade-lang';

    const detect = () => {
        try {
            const fromUrl = new URLSearchParams(location.search).get('lang');
            if (SUPPORTED.includes(fromUrl)) return fromUrl;
        } catch (e) { /* ignore */ }
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (SUPPORTED.includes(stored)) return stored;
        } catch (e) { /* ignore */ }
        const browser = (navigator.language || '').substring(0, 2);
        return browser === 'de' ? 'de' : 'en';
    };

    const style = document.createElement('style');
    style.textContent = `
        html:not([data-lang="de"]) [data-lang-block="de"],
        html:not([data-lang="en"]) [data-lang-block="en"],
        html:not([data-lang="de"]) [data-lang-inline="de"],
        html:not([data-lang="en"]) [data-lang-inline="en"] { display: none !important; }
        .legal-lang-switch { display: inline-flex; border: 1px solid oklch(.4 0 0 / .5); border-radius: 0.5rem; overflow: hidden; }
        .legal-lang-switch button { padding: 0.35rem 0.7rem; font-size: 0.85rem; font-weight: 600; background: transparent; color: inherit; cursor: pointer; }
        .legal-lang-switch button[aria-pressed="true"] { background: oklch(.3 .1 250); color: white; }
    `;
    document.head.appendChild(style);

    const apply = (lang) => {
        document.documentElement.dataset.lang = lang;
        document.documentElement.lang = lang;
        const title = document.documentElement.dataset[`title${lang === 'de' ? 'De' : 'En'}`];
        if (title) document.title = title;
        document.querySelectorAll('.legal-lang-switch button').forEach(btn => {
            btn.setAttribute('aria-pressed', String(btn.dataset.setLang === lang));
        });
        document.dispatchEvent(new CustomEvent('legal:lang', { detail: lang }));
    };

    window.getLegalLang = () => document.documentElement.dataset.lang || 'de';

    apply(detect());

    document.addEventListener('DOMContentLoaded', () => {
        apply(window.getLegalLang());
        document.querySelectorAll('.legal-lang-switch button').forEach(btn => {
            btn.addEventListener('click', () => {
                try { localStorage.setItem(STORAGE_KEY, btn.dataset.setLang); } catch (e) { /* ignore */ }
                apply(btn.dataset.setLang);
            });
        });
    });

    // #anlage-N / #annex-N: both language versions are in the page, so the
    // browser's own anchor jump may hit the hidden one. Scroll to the visible.
    const jumpToAnchor = () => {
        const m = /^#(?:anlage|annex)-(\d+)$/.exec(location.hash);
        if (!m) return;
        const target = [...document.querySelectorAll(`#anlage-${m[1]}, #annex-${m[1]}`)]
            .find(el => el.getClientRects().length);
        if (target) target.scrollIntoView();
    };
    window.addEventListener('load', jumpToAnchor);
    window.addEventListener('hashchange', jumpToAnchor);
})();
