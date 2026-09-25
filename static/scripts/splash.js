/* ==========================================================================
   avocloud · post-login splash — CAD construction reveal (BRANDING.md §5)
   Vanilla port of brand/motion/Wordmark.tsx (React + GSAP). Same animation,
   same timings, same timeScale — do not hand-roll a variant of it. If the
   brand kit changes, mirror it here.

   Guide lines are MEASURED from the real glyph boxes after the webfont
   settles (cap/mid/baseline horizontals, per-letter boundary ticks, bounding
   verticals + diagonals, dashed rings inscribing the round letters), so every
   guide sits on an actual letter feature at any size. Guides draw in →
   letters appear as stroked outlines → fills rise bottom-up → scaffold fades.
   ========================================================================== */
(function () {
    'use strict';

    // BRANDING.md §5 offers the product word (EDUGRADE) here; EduGrade splashes
    // on the parent brand instead — deliberate, it's avocloud's handshake with
    // a signed-in user. '.NET' from index 8 renders coral, per the kit default.
    var WORD = 'AVOCLOUD.NET';
    var CORAL_FROM = 8;
    var ROUND = { O: 1, C: 1, D: 1 }; // letters that get an inscribed ring

    var TIME_SCALE = 0.6; // locked by BRANDING.md §5 — the raw timeline reads as rushed
    var GSAP_VERSION = '3.13.0';
    var SCRIPTS = [
        ['gsap.min.js', 'sha384-HOvlOYPIs/zjoIkWUGXkVmXsjr8GuZLV+Q+rcPwmJOVZVpvTSXQChiN4t9Euv9Vc'],
        ['CustomEase.min.js', 'sha384-JCMGAgtMgo/19ttIm8BSnUFxOA5KAxaKT7jZdTDtaL0df8+CHKRo9XFCmhsvUlXG'],
        ['DrawSVGPlugin.min.js', 'sha384-hk4mr+NXgJSfCJFF+LKzt26e6ZekZmmXAesF9r58nbaoAqB/VAlvY4T8k2plkXf+']
    ];
    var SVG_NS = 'http://www.w3.org/2000/svg';

    var overlay = document.getElementById('avo-splash');
    if (!overlay) return;

    var done = false;
    function finish(immediate) {
        if (done) return;
        done = true;
        window._avoIntroPlaying = false;
        document.body.style.overflow = '';
        if (immediate) { overlay.remove(); return; }
        overlay.classList.add('avo-splash-out');
        setTimeout(function () { overlay.remove(); }, 800);
    }

    // Once per session, after a login only — never on reload or tab focus.
    if (!sessionStorage.getItem('avoShowIntro')) { overlay.remove(); return; }
    sessionStorage.removeItem('avoShowIntro');

    // Reduced motion → skip the splash entirely, straight to the app. No
    // static wordmark screen as a substitute.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { overlay.remove(); return; }

    overlay.classList.add('avo-splash-on');
    // Blocks toasts/dialogs while the splash is up (see ui.js, storage.js).
    window._avoIntroPlaying = true;
    document.body.style.overflow = 'hidden';

    // Never blocking: whatever goes wrong (CDN down, fonts stuck, GSAP error),
    // the splash gets out of the way instead of holding the app hostage.
    var bail = setTimeout(function () { finish(true); }, 9000);

    /* ---- markup: one .hw-ch per letter, stroke layer + fill layer -------- */
    var wrap = document.createElement('div');
    wrap.className = 'hw';
    var text = document.createElement('div');
    text.className = 'avo-splash-word';
    for (var i = 0; i < WORD.length; i++) {
        var ch = document.createElement('span');
        ch.className = 'hw-ch' + (i >= CORAL_FROM ? ' coral' : '');
        var stroke = document.createElement('span');
        stroke.className = 'hw-stroke';
        stroke.setAttribute('data-ch', WORD[i]);
        stroke.setAttribute('aria-hidden', 'true');
        var fill = document.createElement('span');
        fill.className = 'hw-fill';
        fill.textContent = WORD[i];
        ch.appendChild(stroke);
        ch.appendChild(fill);
        text.appendChild(ch);
    }
    wrap.appendChild(text);
    overlay.appendChild(wrap);

    /* ---- geometry: measured from the rendered glyphs, never hardcoded ---- */
    function buildGuides() {
        var chs = [].slice.call(wrap.querySelectorAll('.hw-ch'));
        if (!chs.length) return null;
        var wr = wrap.getBoundingClientRect();
        var r = chs.map(function (c) {
            var b = c.getBoundingClientRect();
            return { left: b.left - wr.left, right: b.right - wr.left, top: b.top - wr.top, bottom: b.bottom - wr.top };
        });
        var w = wr.width, h = wr.height;
        var lead = (r[0].bottom - r[0].top) * 0.11;
        var capTop = Math.min.apply(null, r.map(function (x) { return x.top; })) + lead;
        var base = Math.max.apply(null, r.map(function (x) { return x.bottom; })) - lead;
        var midY = (capTop + base) / 2;
        var left = r[0].left;
        var right = r[r.length - 1].right;
        var ext = w * 0.05;

        var lines = [];
        [capTop, midY, base].forEach(function (y) { lines.push([left - ext, y, right + ext, y]); });
        lines.push([left, capTop - ext * 0.5, left, base + ext * 0.5]);
        lines.push([right, capTop - ext * 0.5, right, base + ext * 0.5]);
        for (var i = 0; i < r.length - 1; i++) {
            var x = (r[i].right + r[i + 1].left) / 2;
            lines.push([x, capTop - ext * 0.25, x, base + ext * 0.25]);
        }
        lines.push([left, capTop, right, base]);
        lines.push([right, capTop, left, base]);

        var svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', 'hw-guides');
        svg.setAttribute('width', w);
        svg.setAttribute('height', h);
        svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
        svg.setAttribute('aria-hidden', 'true');
        lines.forEach(function (l) {
            var el = document.createElementNS(SVG_NS, 'line');
            el.setAttribute('class', 'hw-line');
            el.setAttribute('x1', l[0]); el.setAttribute('y1', l[1]);
            el.setAttribute('x2', l[2]); el.setAttribute('y2', l[3]);
            el.setAttribute('vector-effect', 'non-scaling-stroke');
            svg.appendChild(el);
        });
        r.forEach(function (c, i) {
            if (!ROUND[WORD[i]]) return;
            var el = document.createElementNS(SVG_NS, 'circle');
            el.setAttribute('class', 'hw-circ' + (i >= CORAL_FROM ? ' coral' : ''));
            el.setAttribute('cx', (c.left + c.right) / 2);
            el.setAttribute('cy', (c.top + c.bottom) / 2);
            el.setAttribute('r', ((base - capTop) / 2) * 1.08);
            el.setAttribute('vector-effect', 'non-scaling-stroke');
            svg.appendChild(el);
        });
        wrap.insertBefore(svg, text);
        return svg;
    }

    /* ---- the reveal ------------------------------------------------------ */
    function play() {
        var gsap = window.gsap;
        if (!gsap) { finish(true); return; }
        gsap.registerPlugin(window.CustomEase, window.DrawSVGPlugin);
        // Same curve as the brand's EASE.out (cubic-bezier(.16,1,.3,1)).
        window.CustomEase.create('avo-out', 'M0,0 C0.16,1 0.3,1 1,1');

        if (!buildGuides()) { finish(true); return; }

        var strokes = wrap.querySelectorAll('.hw-stroke');
        var fills = wrap.querySelectorAll('.hw-fill');
        // Arrays, not live NodeLists, and only used when non-empty — tweening
        // an empty selection makes GSAP log "target not found".
        var lines = [].slice.call(wrap.querySelectorAll('.hw-line'));
        var circles = [].slice.call(wrap.querySelectorAll('.hw-circ'));

        gsap.set(fills, { clipPath: 'inset(100% 0 0 0)' });
        gsap.set(strokes, { opacity: 0, yPercent: 8 });
        // Guides draw from their midpoint outward — a straightedge being laid
        // down rather than a line growing from one end.
        gsap.set(lines, { drawSVG: '50% 50%', opacity: 0 });
        // Circles keep their dashed CSS stroke, so they scale/fade in instead:
        // DrawSVG would overwrite strokeDasharray and eat the dashes.
        if (circles.length) gsap.set(circles, { opacity: 0, transformOrigin: '50% 50%' });

        var tl = gsap.timeline({ delay: 0.15, onComplete: function () { clearTimeout(bail); finish(false); } });
        tl.set(lines, { opacity: 1 })
            .to(lines, { drawSVG: '0% 100%', duration: 0.7, ease: 'power2.inOut', stagger: 0.025 }, 0);
        if (circles.length) {
            tl.fromTo(circles, { scale: 0.86 }, { opacity: 1, scale: 1, duration: 0.55, ease: 'avo-out', stagger: 0.06 }, 0.25);
        }
        tl.to(strokes, { opacity: 1, yPercent: 0, duration: 0.4, ease: 'avo-out', stagger: 0.045 }, 0.4)
            .to(fills, { clipPath: 'inset(0% 0 0 0)', duration: 0.5, ease: 'avo-out', stagger: 0.055 }, 0.85)
            // One flat array, not [lines, circles] — the nested form makes
            // GSAP's lazy tween-init throw and leaves the guides stuck visible.
            .to(lines.concat(circles), { opacity: 0, duration: 0.7, ease: 'power2.inOut' }, 1.7)
            .to(strokes, { opacity: 0, duration: 0.7, ease: 'power2.inOut' }, 1.7);
        tl.timeScale(TIME_SCALE);
    }

    /* ---- load GSAP only when the splash actually plays ------------------- */
    function loadScripts(i, cb) {
        if (i >= SCRIPTS.length) { cb(); return; }
        var s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/gsap@' + GSAP_VERSION + '/dist/' + SCRIPTS[i][0];
        s.integrity = SCRIPTS[i][1];
        s.crossOrigin = 'anonymous';
        s.onload = function () { loadScripts(i + 1, cb); };
        s.onerror = function () { finish(true); };
        document.head.appendChild(s);
    }

    loadScripts(0, function () {
        var fonts = document.fonts && document.fonts.ready;
        if (fonts) fonts.then(play); else play();
    });
})();
