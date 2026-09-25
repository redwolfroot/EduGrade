/* =============================================================
 * EduGrade Mobile Layer (Phase 1)
 * Bottom nav, sidebar swipe-to-close, mobile state helper.
 * Loaded after render.js / eventListeners.js — relies on globals
 *   showHomeView, showClassView, appData, t (i18n)
 * Desktop UI must remain untouched: all behavior gated on isMobile().
 * ============================================================= */
(function () {
    "use strict";

    const MOBILE_QUERY = "(max-width: 768px)";
    const mql = window.matchMedia(MOBILE_QUERY);

    /** Single source of truth for "is the viewport mobile-sized?" */
    window.isMobile = () => mql.matches;

    /* ---------- i18n helper (fallback to literal) ---------- */
    const tr = (key, fallback) => {
        try {
            if (typeof t === "function") {
                const v = t(key);
                if (v && v !== key) return v;
            }
        } catch (_) { /* ignore */ }
        return fallback;
    };

    /* ---------- Toast helper (uses existing undo-notification bar as fallback) ---------- */
    const toast = (msg) => {
        const bar = document.getElementById("undo-notification");
        const txt = document.getElementById("undo-notification-text");
        const btn = document.getElementById("undo-notification-btn");
        if (!bar || !txt) {
            // Fallback: alert is acceptable here, but keep silent in production.
            console.info("[mobile]", msg);
            return;
        }
        txt.textContent = msg;
        if (btn) btn.style.display = "none";
        bar.classList.remove("hidden");
        bar.classList.add("flex");
        clearTimeout(toast._t);
        toast._t = setTimeout(() => {
            bar.classList.add("hidden");
            bar.classList.remove("flex");
            if (btn) btn.style.display = "";
        }, 2400);
    };

    /* ---------- View-state helpers ---------- */
    const isViewVisible = (id) => {
        const el = document.getElementById(id);
        return !!(el && !el.classList.contains("hidden"));
    };

    const isStudentDetailVisible = () => isViewVisible("student-detail-view");
    const isClassViewVisible = () => isViewVisible("class-view");

    /* ---------- Bottom-nav actions ---------- */
    function actHome() {
        if (typeof showHomeView === "function") showHomeView();
    }

    function actClasses() {
        if (typeof appData !== "undefined" && appData && Array.isArray(appData.classes) && appData.classes.length > 0) {
            openClassPickerSheet();
            return;
        }
        // Fallback when no classes exist yet — let user create one.
        const addBtn = document.getElementById("add-class");
        if (addBtn) { addBtn.click(); return; }
        document.dispatchEvent(new CustomEvent("basecoat:sidebar"));
    }

    function actQuickAdd() {
        // Student detail open → add grade for that student.
        if (isStudentDetailVisible()) {
            const btn = document.getElementById("student-detail-add-grade");
            if (btn) { btn.click(); return; }
        }
        // Class view open → ask: new student or new grade?
        if (isClassViewVisible()) {
            const cid = (typeof appData !== "undefined" && appData) ? appData.currentClassId : null;
            if (cid) { openClassFabChoice(); return; }
        }
        // Home view (or anything else) → open new-class dialog.
        const addBtn = document.getElementById("add-class");
        if (addBtn) { addBtn.click(); return; }
        toast(tr("mobile.pickClass", "Bitte zuerst eine Klasse öffnen."));
    }

    function _openExamAfterClassReady() {
        // Wait briefly for class view to render, then trigger the exam button.
        setTimeout(() => {
            const btn = document.getElementById("class-exam-btn");
            if (btn) btn.click();
        }, 220);
    }

    function actClassExam() {
        if (isClassViewVisible()) {
            const btn = document.getElementById("class-exam-btn");
            if (btn) { btn.click(); return; }
        }
        // Not in class view → show picker, then open exam after selection.
        openClassPickerSheet(() => _openExamAfterClassReady());
    }

    function actMenu() {
        openMenuSheet();
    }

    /* ---------- Bottom-nav rendering ---------- */
    function renderBottomNav() {
        let nav = document.getElementById("mobile-bottom-nav");
        if (!nav) return;

        // Idempotent: if already rendered, just rewire current state.
        if (!nav.dataset.rendered) {
            nav.innerHTML = `
                <button type="button" class="mnav-btn" data-mnav="home" aria-label="${tr("nav.home", "Home")}">
                    <svg class="lucide lucide-house-icon lucide-house" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                        <polyline points="9 22 9 12 15 12 15 22"/>
                    </svg>
                    <span>${tr("nav.home", "Home")}</span>
                </button>
                <button type="button" class="mnav-btn" data-mnav="classes" aria-label="${tr("nav.classes", "Klassen")}">
                    <svg class="lucide lucide-book-icon lucide-book" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                    </svg>
                    <span>${tr("nav.classes", "Klassen")}</span>
                </button>
                <button type="button" class="mnav-btn mnav-primary" data-mnav="quick-add" aria-label="${tr("mobile.quickAdd", "Note hinzufügen")}">
                    <svg class="lucide lucide-plus-icon lucide-plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.4" aria-hidden="true">
                        <line x1="12" y1="5" x2="12" y2="19"/>
                        <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    <span>${tr("mobile.quickAdd", "Note")}</span>
                </button>
                <button type="button" class="mnav-btn" data-mnav="class-exam" aria-label="${tr("classExam.title", "Klassenarbeit")}">
                    <svg class="lucide lucide-file-text-icon lucide-file-text" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <line x1="9" y1="13" x2="15" y2="13"/>
                        <line x1="9" y1="17" x2="13" y2="17"/>
                    </svg>
                    <span>${tr("mobile.exam", "Exam")}</span>
                </button>
                <button type="button" class="mnav-btn" data-mnav="menu" aria-label="${tr("nav.menu", "Menü")}">
                    <svg class="lucide lucide-ellipsis-icon lucide-ellipsis" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <circle cx="5" cy="12" r="1.5"/>
                        <circle cx="12" cy="12" r="1.5"/>
                        <circle cx="19" cy="12" r="1.5"/>
                    </svg>
                    <span>${tr("nav.menu", "Menü")}</span>
                </button>
            `;
            nav.addEventListener("click", onNavClick);
            nav.dataset.rendered = "1";
        }
        updateActiveState();
    }

    function onNavClick(ev) {
        const btn = ev.target.closest("[data-mnav]");
        if (!btn) return;
        const action = btn.dataset.mnav;
        // Close exam overlay if navigating away to another section
        if (action !== "class-exam") {
            const examOverlay = document.getElementById("class-exam-overlay");
            if (examOverlay && examOverlay.classList.contains("active")) {
                examOverlay.classList.remove("active");
            }
        }
        switch (action) {
            case "home": actHome(); break;
            case "classes": actClasses(); break;
            case "quick-add": actQuickAdd(); break;
            case "class-exam": actClassExam(); break;
            case "menu": actMenu(); break;
        }
        setTimeout(updateActiveState, 50);
    }

    function updateActiveState() {
        const nav = document.getElementById("mobile-bottom-nav");
        if (!nav) return;
        let current = "home";
        const examOverlay = document.getElementById("class-exam-overlay");
        if (examOverlay && examOverlay.classList.contains("active")) {
            current = "class-exam";
        } else if (isViewVisible("class-view") || isViewVisible("student-detail-view") || isViewVisible("attendance-view")) {
            current = "classes";
        } else if (isViewVisible("settings-view")) {
            current = "menu";
        } else if (isViewVisible("home-view")) {
            current = "home";
        }
        nav.querySelectorAll("[data-mnav]").forEach(btn => {
            if (btn.dataset.mnav === current) btn.setAttribute("aria-current", "page");
            else btn.removeAttribute("aria-current");
        });
    }
    // Refresh active state when exam overlay opens/closes
    window.addEventListener("DOMContentLoaded", () => {
        const overlay = document.getElementById("class-exam-overlay");
        if (!overlay) return;
        const obs = new MutationObserver(() => updateActiveState());
        obs.observe(overlay, { attributes: true, attributeFilter: ["class"] });
    });

    /* ---------- Shared sheet gestures: body-lock + swipe-down close ---------- */
    function attachSheetGestures(sheet, backdrop, onClose, dragZone) {
        const prevBodyOverflow = document.body.style.overflow;
        const prevBodyOverscroll = document.body.style.overscrollBehavior;
        const prevHtmlOverflow = document.documentElement.style.overflow;
        document.body.style.overflow = "hidden";
        document.body.style.overscrollBehavior = "contain";
        document.documentElement.style.overflow = "hidden";
        document.body.classList.add("m-sheet-open");

        let _yStart = 0;
        const blockBgTouch = (e) => {
            if (!sheet.contains(e.target)) { e.preventDefault(); return; }
            const list = sheet.querySelector(".m-picker-list");
            if (!list || !list.contains(e.target)) { e.preventDefault(); return; }
            const atTop = list.scrollTop <= 0;
            const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
            const t = e.touches[0];
            const dy = t.clientY - _yStart;
            if ((atTop && dy > 0) || (atBottom && dy < 0)) e.preventDefault();
        };
        const onListStart = (e) => { _yStart = e.touches[0].clientY; };
        document.addEventListener("touchmove", blockBgTouch, { passive: false });
        document.addEventListener("touchstart", onListStart, { passive: true });

        let sStartY = 0, sStartX = 0, sDy = 0, sDx = 0, sTracking = false, sDecided = false, sVertical = false;
        const dz = dragZone || sheet;
        const dragStart = (e) => {
            const t = e.touches[0];
            sStartY = t.clientY; sStartX = t.clientX;
            sDy = 0; sDx = 0; sTracking = true; sDecided = false; sVertical = false;
            sheet.style.transition = "none";
        };
        const dragMove = (e) => {
            if (!sTracking) return;
            const t = e.touches[0];
            sDy = t.clientY - sStartY;
            sDx = t.clientX - sStartX;
            if (!sDecided) {
                if (Math.abs(sDy) > 8 || Math.abs(sDx) > 8) {
                    sVertical = Math.abs(sDy) > Math.abs(sDx);
                    sDecided = true;
                }
            }
            if (sVertical && sDy > 0) sheet.style.transform = `translateY(${sDy}px)`;
        };
        const dragEnd = () => {
            if (!sTracking) return;
            sTracking = false;
            sheet.style.transition = "";
            if (sVertical && sDy > 80) onClose();
            else sheet.style.transform = "";
        };
        dz.addEventListener("touchstart", dragStart, { passive: true });
        dz.addEventListener("touchmove", dragMove, { passive: true });
        dz.addEventListener("touchend", dragEnd, { passive: true });
        dz.addEventListener("touchcancel", dragEnd, { passive: true });

        const onKey = (e) => { if (e.key === "Escape") onClose(); };
        document.addEventListener("keydown", onKey);

        return function cleanup() {
            document.body.style.overflow = prevBodyOverflow || "";
            document.body.style.overscrollBehavior = prevBodyOverscroll || "";
            document.documentElement.style.overflow = prevHtmlOverflow || "";
            document.body.classList.remove("m-sheet-open");
            document.removeEventListener("touchmove", blockBgTouch);
            document.removeEventListener("touchstart", onListStart);
            document.removeEventListener("keydown", onKey);
            dz.removeEventListener("touchstart", dragStart);
            dz.removeEventListener("touchmove", dragMove);
            dz.removeEventListener("touchend", dragEnd);
            dz.removeEventListener("touchcancel", dragEnd);
        };
    }

    /* ---------- Menu sheet ---------- */
    let _menuSheet = null;
    function openMenuSheet() {
        if (_menuSheet) return; // already open
        const backdrop = document.createElement("div");
        backdrop.className = "mobile-sheet-backdrop";
        backdrop.setAttribute("aria-hidden", "true");

        const sheet = document.createElement("div");
        sheet.className = "mobile-sheet";
        sheet.setAttribute("role", "dialog");
        sheet.setAttribute("aria-modal", "true");
        sheet.innerHTML = `
            <button type="button" data-sheet-act="settings">
                <svg class="lucide lucide-settings-icon lucide-settings" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                    <circle cx="12" cy="12" r="3"/>
                </svg>
                <span>${tr("nav.settings", "Notengebung")}</span>
            </button>
            <button type="button" data-sheet-act="profile">
                <svg class="lucide lucide-user-icon lucide-user" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>
                    <circle cx="12" cy="7" r="4"/>
                </svg>
                <span>${tr("nav.profile", "Profil & Darstellung")}</span>
            </button>
            <button type="button" data-sheet-act="export">
                <svg class="lucide lucide-download-icon lucide-download" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <path d="M7 10l5 5 5-5"/>
                    <path d="M12 15V3"/>
                </svg>
                <span>${tr("nav.export", "Export")}</span>
            </button>
            <button type="button" data-sheet-act="theme">
                <svg class="lucide lucide-moon-icon lucide-moon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
                </svg>
                <span>${tr("nav.toggleTheme", "Theme wechseln")}</span>
            </button>
            <a href="/about.html" data-sheet-act="about">
                <svg class="lucide lucide-info-icon lucide-info" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <circle cx="12" cy="12" r="10"/>
                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 16v-4M12 8h.01"/>
                </svg>
                <span>${tr("nav.about", "Über")}</span>
            </a>
            <button type="button" data-sheet-act="support">
                <svg class="lucide lucide-coffee-icon lucide-coffee" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M10 2v2"/>
                    <path d="M14 2v2"/>
                    <path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/>
                    <path d="M6 2v2"/>
                </svg>
                <span>${tr("nav.support", "Unterstütze uns")}</span>
            </button>
            <hr/>
            <button type="button" data-sheet-act="logout" style="color: var(--destructive, #ef4444);">
                <svg class="lucide lucide-log-out-icon lucide-log-out" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                    <polyline points="16 17 21 12 16 7"/>
                    <line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
                <span>${tr("nav.logout", "Abmelden")}</span>
            </button>
        `;
        document.body.appendChild(backdrop);
        document.body.appendChild(sheet);

        const cleanup = attachSheetGestures(sheet, backdrop, () => closeMenuSheet(), sheet);

        function closeMenuSheet() {
            if (!_menuSheet) return;
            const m = _menuSheet;
            _menuSheet = null;
            m.sheet.classList.remove("is-open");
            m.backdrop.classList.remove("is-open");
            m.cleanup();
            setTimeout(() => { m.backdrop.remove(); m.sheet.remove(); }, 250);
        }

        backdrop.addEventListener("click", closeMenuSheet);
        sheet.addEventListener("click", (ev) => {
            const target = ev.target.closest("[data-sheet-act]");
            if (!target) return;
            const act = target.dataset.sheetAct;
            if (target.tagName !== "A") ev.preventDefault();
            closeMenuSheet();
            switch (act) {
                case "settings": { const b = document.getElementById("nav-settings"); if (b) b.click(); break; }
                case "profile":  { const b = document.getElementById("profile-btn"); if (b) b.click(); break; }
                case "export":   { const b = document.getElementById("export-data"); if (b) b.click(); break; }
                case "theme":    document.dispatchEvent(new CustomEvent("basecoat:theme")); break;
                case "support":  { const b = document.getElementById("support-btn"); if (b) b.click(); break; }
                case "logout":   { const b = document.getElementById("logout-btn"); if (b) b.click(); break; }
                case "about":    /* anchor handles navigation */ break;
            }
        });

        _menuSheet = { backdrop, sheet, cleanup };
        sheet.offsetHeight;
        backdrop.classList.add("is-open");
        sheet.classList.add("is-open");
    }

    /* ---------- Generic list picker sheet ---------- */
    let _pickerEls = null;

    const escHtml = (s) => String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

    function closeListPicker() {
        if (!_pickerEls) return;
        const { backdrop, sheet, cleanup } = _pickerEls;
        _pickerEls = null;
        sheet.classList.remove("is-open");
        backdrop.classList.remove("is-open");
        cleanup && cleanup();
        setTimeout(() => { backdrop.remove(); sheet.remove(); }, 250);
    }

    /**
     * Open a generic mobile list picker.
     * opts: { title, subtitle, items: [{id, name, search, meta}], onPick(id), showSearch }
     */
    function openListPicker(opts) {
        if (_pickerEls) return;
        const items = opts.items || [];
        if (items.length === 0) return;
        const showSearch = (opts.showSearch !== undefined) ? opts.showSearch : items.length > 10;

        const backdrop = document.createElement("div");
        backdrop.className = "mobile-sheet-backdrop";
        backdrop.setAttribute("aria-hidden", "true");

        const sheet = document.createElement("div");
        sheet.className = "mobile-sheet mobile-sheet--picker";
        sheet.setAttribute("role", "dialog");
        sheet.setAttribute("aria-modal", "true");
        if (opts.title) sheet.setAttribute("aria-label", opts.title);

        const searchHtml = showSearch
            ? `<input type="search" class="m-picker-search" placeholder="${tr("mobile.search", "Suchen…")}" autocomplete="off"/>`
            : "";

        const itemsHtml = items.map(it => {
            const name = escHtml(it.name || "");
            const search = escHtml(String(it.search || it.name || "").toLowerCase());
            const meta = (it.meta != null) ? `<span class="m-picker-meta">${escHtml(it.meta)}</span>` : "";
            return `<button type="button" data-pick-id="${escHtml(it.id)}" data-search="${search}" class="m-picker-item">
                <span class="m-picker-name">${name}</span>
                ${meta}
            </button>`;
        }).join("");

        sheet.innerHTML = `
            <div class="m-picker-header">
                <strong>${escHtml(opts.title || "")}</strong>
                ${opts.subtitle ? `<span class="m-picker-sub">${escHtml(opts.subtitle)}</span>` : ""}
            </div>
            ${searchHtml}
            <div class="m-picker-list" role="listbox">${itemsHtml}</div>
        `;

        document.body.appendChild(backdrop);
        document.body.appendChild(sheet);

        backdrop.addEventListener("click", closeListPicker);
        sheet.addEventListener("click", (ev) => {
            const item = ev.target.closest("[data-pick-id]");
            if (!item) return;
            const id = item.dataset.pickId;
            closeListPicker();
            if (typeof opts.onPick === "function") opts.onPick(id);
        });

        if (showSearch) {
            const input = sheet.querySelector(".m-picker-search");
            const list = sheet.querySelector(".m-picker-list");
            input.addEventListener("input", () => {
                const q = input.value.trim().toLowerCase();
                list.querySelectorAll("[data-pick-id]").forEach(btn => {
                    const hay = btn.dataset.search || "";
                    btn.style.display = (!q || hay.includes(q)) ? "" : "none";
                });
            });
        }

        const header = sheet.querySelector(".m-picker-header");
        const cleanup = attachSheetGestures(sheet, backdrop, closeListPicker, header || sheet);

        _pickerEls = { backdrop, sheet, cleanup };
        sheet.offsetHeight;
        backdrop.classList.add("is-open");
        sheet.classList.add("is-open");
    }

    /* ---------- FAB choice on class view: new student / new grade ---------- */
    function openClassFabChoice() {
        openListPicker({
            title: tr("mobile.fabChoiceTitle", "Was möchtest du hinzufügen?"),
            showSearch: false,
            items: [
                { id: "grade",   name: tr("mobile.newGrade",   "Neue Note") },
                { id: "student", name: tr("mobile.newStudent", "Neuer Schüler") },
            ],
            onPick: (id) => {
                if (id === "grade") {
                    openStudentPickerForGrade();
                } else if (id === "student") {
                    const btn = document.getElementById("add-student");
                    if (btn) btn.click();
                }
            },
        });
    }

    /* ---------- Student picker (FAB on class view) ---------- */
    function openStudentPickerForGrade() {
        if (typeof getCurrentClass !== "function" || typeof getCurrentYear !== "function") return;
        const cls = getCurrentClass();
        const year = getCurrentYear();
        const students = (year && Array.isArray(year.students)) ? year.students.slice() : [];
        if (students.length === 0) {
            toast(tr("mobile.noStudents", "Keine Schüler in dieser Klasse"));
            return;
        }
        students.sort((a, b) => {
            const an = (a.lastName || "").localeCompare(b.lastName || "", undefined, { sensitivity: "base" });
            if (an !== 0) return an;
            return (a.firstName || "").localeCompare(b.firstName || "", undefined, { sensitivity: "base" });
        });
        const fullName = (s) => {
            const parts = [s.firstName];
            if (s.middleName) parts.push(s.middleName);
            parts.push(s.lastName);
            return parts.filter(Boolean).join(" ");
        };
        openListPicker({
            title: tr("mobile.pickStudent", "Schüler auswählen"),
            subtitle: cls && cls.name ? cls.name : "",
            items: students.map(s => ({
                id: s.id,
                name: fullName(s),
                search: `${s.lastName || ""} ${s.firstName || ""} ${s.middleName || ""}`,
                meta: Array.isArray(s.grades) ? s.grades.length : 0,
            })),
            onPick: (studentId) => {
                if (typeof openAddGradeDialog === "function") {
                    openAddGradeDialog(studentId, () => {
                        if (typeof renderStudents === "function") renderStudents();
                    });
                }
            },
        });
    }

    /* ---------- Class picker (bottom-nav "Klassen") ---------- */
    function openClassPickerSheet(onPickOverride) {
        if (typeof appData === "undefined" || !appData || !Array.isArray(appData.classes) || appData.classes.length === 0) {
            const addBtn = document.getElementById("add-class");
            if (addBtn) addBtn.click();
            return;
        }
        const classes = appData.classes.slice().sort((a, b) =>
            (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base", numeric: true })
        );
        openListPicker({
            title: tr("mobile.pickClass", "Klasse auswählen"),
            items: classes.map(c => {
                const year = Array.isArray(c.years) ? c.years.find(y => y.id === c.currentYearId) : null;
                const count = year && Array.isArray(year.students) ? year.students.length : 0;
                return { id: c.id, name: c.name || "", search: c.name || "", meta: count };
            }),
            onPick: (classId) => {
                appData.currentClassId = classId;
                if (typeof showClassView === "function") showClassView();
                if (typeof onPickOverride === "function") onPickOverride(classId);
            },
        });
    }

    /* ---------- Sidebar: backdrop + swipe-to-close ---------- */
    let _backdrop = null;
    function getBackdrop() {
        if (_backdrop) return _backdrop;
        _backdrop = document.createElement("div");
        _backdrop.className = "sidebar-backdrop";
        _backdrop.addEventListener("click", () => {
            // Close sidebar via the existing toggle so all listeners stay in sync.
            document.dispatchEvent(new CustomEvent("basecoat:sidebar"));
        });
        document.body.appendChild(_backdrop);
        return _backdrop;
    }

    function syncBackdrop() {
        if (!window.isMobile()) {
            if (_backdrop) _backdrop.classList.remove("is-open");
            return;
        }
        const sb = document.querySelector("aside.sidebar");
        if (!sb) return;
        const open = sb.getAttribute("aria-hidden") === "false";
        getBackdrop().classList.toggle("is-open", open);
    }

    function attachSwipe() {
        const sb = document.querySelector("aside.sidebar");
        if (!sb || sb.dataset.swipeAttached) return;
        sb.dataset.swipeAttached = "1";

        let startX = 0, startY = 0, dx = 0, dy = 0, tracking = false, decided = false, isHorizontal = false;

        sb.addEventListener("touchstart", (e) => {
            if (!window.isMobile()) return;
            if (sb.getAttribute("aria-hidden") !== "false") return;
            const t = e.touches[0];
            startX = t.clientX; startY = t.clientY; dx = 0; dy = 0;
            tracking = true; decided = false; isHorizontal = false;
        }, { passive: true });

        sb.addEventListener("touchmove", (e) => {
            if (!tracking) return;
            const t = e.touches[0];
            dx = t.clientX - startX;
            dy = t.clientY - startY;
            if (!decided) {
                if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
                    isHorizontal = Math.abs(dx) > Math.abs(dy);
                    decided = true;
                    if (isHorizontal) sb.classList.add("is-swiping");
                }
            }
            if (isHorizontal && dx < 0) {
                // Pin to finger only when swiping left (closing direction).
                sb.style.transform = `translateX(${dx}px)`;
            }
        }, { passive: true });

        const end = () => {
            if (!tracking) return;
            tracking = false;
            sb.classList.remove("is-swiping");
            sb.style.transform = "";
            if (isHorizontal && dx < -60) {
                // Past threshold → close via the official toggle.
                document.dispatchEvent(new CustomEvent("basecoat:sidebar"));
            }
        };
        sb.addEventListener("touchend", end, { passive: true });
        sb.addEventListener("touchcancel", end, { passive: true });
    }

    /* ---------- Boot ---------- */
    function init() {
        renderBottomNav();
        attachSwipe();
        syncBackdrop();

        // Re-render labels when language changes (i18n module typically dispatches this).
        document.addEventListener("i18n:changed", () => {
            const nav = document.getElementById("mobile-bottom-nav");
            if (nav) { nav.innerHTML = ""; delete nav.dataset.rendered; renderBottomNav(); }
            if (_menuSheet) {
                _menuSheet.cleanup && _menuSheet.cleanup();
                _menuSheet.sheet.remove();
                _menuSheet.backdrop.remove();
                _menuSheet = null;
            }
        });

        // Track sidebar open/close to sync backdrop. The basecoat sidebar toggle
        // flips aria-hidden on the aside; observe it directly.
        const sb = document.querySelector("aside.sidebar");
        if (sb) {
            new MutationObserver(syncBackdrop).observe(sb, {
                attributes: true,
                attributeFilter: ["aria-hidden"],
            });
        }

        // Update active state when views switch (any class change on view sections).
        const targets = ["home-view", "class-view", "student-detail-view", "attendance-view", "settings-view"];
        targets.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            new MutationObserver(updateActiveState).observe(el, {
                attributes: true,
                attributeFilter: ["class"],
            });
        });

        // Re-evaluate when viewport crosses the breakpoint (e.g. rotation).
        const onMqChange = () => syncBackdrop();
        if (typeof mql.addEventListener === "function") mql.addEventListener("change", onMqChange);
        else if (typeof mql.addListener === "function") mql.addListener(onMqChange);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
