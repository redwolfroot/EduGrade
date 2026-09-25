// ui.js
// ========== UI-HILFSFUNKTIONEN ==========
// Diese Datei enthält Funktionen für Benutzer-Benachrichtigungen und Dialoge.
// "UI" steht für "User Interface" (Benutzeroberfläche).

// ============ LOADING SPINNER SVG ============
const SPINNER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" role="status" aria-label="Loading" class="animate-spin lucide lucide-loader-circle-icon lucide-loader-circle"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>`;

/**
 * BUTTON LOADING STATE
 *
 * Setzt einen Button in den Loading-Zustand mit Spinner.
 * Speichert den ursprünglichen Inhalt für spätere Wiederherstellung.
 *
 * @param {HTMLButtonElement} btn - Der Button
 * @param {boolean} isLoading - true = Loading, false = Normal
 * @param {string} loadingText - Text während des Ladens (optional)
 */
const setButtonLoading = (btn, isLoading, loadingText = 'Loading...') => {
    if (isLoading) {
        // Speichere originalen Inhalt
        btn.dataset.originalHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `${SPINNER_SVG}<span>${loadingText}</span>`;
    } else {
        // Stelle originalen Inhalt wieder her
        if (btn.dataset.originalHtml) {
            btn.innerHTML = btn.dataset.originalHtml;
            delete btn.dataset.originalHtml;
        }
        btn.disabled = false;
    }
};

/**
 * LOADING OVERLAY ANZEIGEN
 *
 * Zeigt ein modales Loading-Overlay mit Spinner und optionalem Text.
 * Blockiert Benutzerinteraktion während des Ladevorgangs.
 *
 * @param {string} title - Überschrift (optional)
 * @param {string} description - Beschreibung (optional)
 * @returns {HTMLDialogElement} Das Dialog-Element zum späteren Schließen
 */
let _loadingOverlayCancelled = false;

const showLoadingOverlay = (title = t('loading.processing'), description = t('loading.pleaseWait')) => {
    // Defer until intro animation finishes
    if (window._avoIntroPlaying) {
        setTimeout(() => showLoadingOverlay(title, description), 200);
        return;
    }

    // Data already finished loading while we were waiting — skip
    if (_loadingOverlayCancelled) {
        _loadingOverlayCancelled = false;
        return;
    }

    // Prüfe ob schon ein Loading-Overlay existiert
    let overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.querySelector('h3').textContent = title;
        overlay.querySelector('p').textContent = description;
        return overlay;
    }

    overlay = document.createElement('dialog');
    overlay.id = 'loading-overlay';
    overlay.className = 'dialog w-full sm:max-w-[400px]';
    overlay.innerHTML = `
        <div class="flex min-w-0 flex-1 flex-col items-center justify-center gap-6 rounded-lg p-6 text-center text-balance md:p-12 text-neutral-800 dark:text-neutral-300">
            <header class="flex max-w-sm flex-col items-center gap-3 text-center">
                <div class="mb-2 bg-muted text-foreground flex size-10 shrink-0 items-center justify-center rounded-lg [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-6">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" role="status" aria-label="Loading" class="animate-spin size-4 lucide lucide-loader-circle-icon lucide-loader-circle"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                </div>
                <h3 class="text-lg font-semibold tracking-tight">${title}</h3>
                <p class="text-gray-400 text-sm/relaxed">${description}</p>
            </header>
        </div>
    `;

    document.body.appendChild(overlay);
    overlay.showModal();
    return overlay;
};

/**
 * LOADING OVERLAY AUSBLENDEN
 */
const hideLoadingOverlay = () => {
    // If overlay hasn't shown yet (still pending due to intro), cancel it
    _loadingOverlayCancelled = true;
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.close();
        overlay.remove();
    }
    // App is now interactive — dismiss the very-early boot loader if still present.
    const boot = document.getElementById('edu-boot-loader');
    if (boot && !boot.classList.contains('edu-boot-hide')) {
        boot.classList.add('edu-boot-hide');
        setTimeout(() => boot.remove(), 450);
    }
};

/**
 * SKELETON LOADING CARD
 *
 * Erstellt eine Skeleton-Loading-Karte für Content-Bereiche.
 *
 * @param {number} rows - Anzahl der Skeleton-Zeilen
 * @returns {string} HTML-String für die Skeleton-Karte
 */
const createSkeletonCard = (rows = 3) => {
    let skeletonRows = '';
    for (let i = 0; i < rows; i++) {
        const width = [100, 80, 60][i % 3]; // Variierende Breiten
        skeletonRows += `<div class="h-4 bg-muted rounded animate-pulse" style="width: ${width}%;"></div>`;
    }
    return `
        <div class="card p-6">
            <div class="space-y-4">
                <div class="h-6 bg-muted rounded animate-pulse w-1/3"></div>
                <div class="space-y-3">
                    ${skeletonRows}
                </div>
            </div>
        </div>
    `;
};

/**
 * SKELETON TABLE
 *
 * Erstellt eine Skeleton-Loading-Tabelle.
 *
 * @param {number} rows - Anzahl der Skeleton-Zeilen
 * @param {number} cols - Anzahl der Spalten
 * @returns {string} HTML-String für die Skeleton-Tabelle
 */
const createSkeletonTable = (rows = 5, cols = 4) => {
    let headerCells = '';
    for (let i = 0; i < cols; i++) {
        headerCells += `<th class="p-3"><div class="h-4 bg-muted rounded animate-pulse"></div></th>`;
    }

    let bodyRows = '';
    for (let i = 0; i < rows; i++) {
        let cells = '';
        for (let j = 0; j < cols; j++) {
            const width = 50 + Math.random() * 40; // Zufällige Breiten für natürlicheren Look
            cells += `<td class="p-3"><div class="h-4 bg-muted rounded animate-pulse" style="width: ${width}%;"></div></td>`;
        }
        bodyRows += `<tr>${cells}</tr>`;
    }

    return `
        <div class="overflow-x-auto">
            <table class="w-full">
                <thead>
                    <tr>${headerCells}</tr>
                </thead>
                <tbody>
                    ${bodyRows}
                </tbody>
            </table>
        </div>
    `;
};

// Toast debounce tracking - prevents duplicate toasts
const recentToasts = new Map();
const TOAST_DEBOUNCE_MS = 2000;

const ACTION_POPUP_ICONS = {
    success: '<path d="M20 6 9 17l-5-5"/>',
    error: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'
};
const ACTION_POPUP_COLORS = {
    success: '#22c55e',
    error: '#ef4444',
    info: '#3b82f6'
};
const ACTION_POPUP_ICON_NAMES = {
    success: 'check',
    error: 'circle-x',
    info: 'info'
};

let _actionPopupTimer = null;

/**
 * AKTIONS-ERFOLGS-POPUP ANZEIGEN
 * Ersetzt den früheren Basecoat-Toast: eine minimale, zentrierte Karte mit
 * animiertem Icon (Häkchen/X/Info) und Label darunter, die kurz erscheint
 * und wieder verschwindet.
 * @param {string} message - Die anzuzeigende Nachricht
 * @param {string} type - "success" | "error" | "info"
 */
const showActionPopup = (message, type = "info") => {
    let popup = document.getElementById("action-popup");
    if (!popup) {
        popup = document.createElement("div");
        popup.id = "action-popup";
        document.body.appendChild(popup);
    }
    clearTimeout(_actionPopupTimer);
    const iconPath = ACTION_POPUP_ICONS[type] || ACTION_POPUP_ICONS.info;
    const color = ACTION_POPUP_COLORS[type] || ACTION_POPUP_COLORS.info;
    const iconName = ACTION_POPUP_ICON_NAMES[type] || ACTION_POPUP_ICON_NAMES.info;
    popup.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="action-popup-icon lucide lucide-${iconName}-icon lucide-${iconName}">${iconPath}</svg>
        <span class="action-popup-label">${escapeHtml(message)}</span>
    `;
    popup.className = "action-popup"; // reset (also clears in/out from a previous call)
    void popup.offsetWidth; // force reflow so the entrance animation restarts
    popup.classList.add("action-popup-in");
    _actionPopupTimer = setTimeout(() => {
        popup.classList.remove("action-popup-in");
        popup.classList.add("action-popup-out");
        popup.addEventListener("animationend", () => popup.remove(), { once: true });
    }, 1600);
};

/**
 * TOAST-BENACHRICHTIGUNG ANZEIGEN
 *
 * Zeigt eine kurze Erfolgs-/Fehler-/Info-Rückmeldung als animiertes
 * Check/X/Info-Popup an (siehe showActionPopup).
 *
 * @param {string} message - Die anzuzeigende Nachricht
 * @param {string} type - Typ: "success" (grün), "error" (rot), "info" (blau)
 */
const showToast = (message, type = "info") => {
    // Defer toast until intro animation finishes
    if (window._avoIntroPlaying) {
        setTimeout(() => showToast(message, type), 200);
        return;
    }

    // Debounce: Verhindere doppelte Toasts mit gleicher Nachricht
    const toastKey = `${type}:${message}`;
    if (recentToasts.has(toastKey)) {
        return; // Toast wurde kürzlich angezeigt, ignorieren
    }

    // Toast als kürzlich angezeigt markieren
    recentToasts.set(toastKey, true);
    setTimeout(() => recentToasts.delete(toastKey), TOAST_DEBOUNCE_MS);

    // Personalisierte Nachricht mit Lehrernamen
    const teacherName = appData?.teacherName || "there";
    const personalizedMessage = message.includes(teacherName) ? message : `${teacherName}, ${message}`;

    showActionPopup(personalizedMessage, type);
};

/**
 * RATE LIMIT DIALOG ANZEIGEN
 *
 * Zeigt einen auffälligen Dialog bei Rate-Limit-Fehlern.
 * Wichtiger als ein Toast, da der Benutzer aktiv bestätigen muss.
 *
 * @param {string} message - Die Fehlermeldung
 */
const showRateLimitDialog = (message = t("error.tooManyRequestsMsg")) => {
    // Prüfe ob schon ein Rate-Limit-Dialog existiert
    let dialog = document.getElementById('rate-limit-dialog');

    if (!dialog) {
        // Dialog erstellen falls nicht vorhanden
        dialog = document.createElement('dialog');
        dialog.id = 'rate-limit-dialog';
        dialog.className = 'dialog w-full sm:max-w-[425px]';
        dialog.innerHTML = `
            <div>
                <header>
                    <div class="flex items-center gap-3">
                        <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-red-500/15">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-red-500 lucide lucide-circle-alert-icon lucide-circle-alert">
                                <circle cx="12" cy="12" r="10"/>
                                <line x1="12" y1="8" x2="12" y2="12"/>
                                <line x1="12" y1="16" x2="12.01" y2="16"/>
                            </svg>
                        </div>
                        <div>
                            <h2 class="text-lg font-semibold">${t("error.tooManyRequests")}</h2>
                        </div>
                    </div>
                </header>
                <section class="py-4">
                    <p id="rate-limit-message" class="text-gray-400"></p>
                </section>
                <footer class="flex justify-end">
                    <button type="button" class="btn-primary" id="rate-limit-close">${t("error.understood")}</button>
                </footer>
            </div>
        `;
        document.body.appendChild(dialog);

        // Close button handler
        dialog.querySelector('#rate-limit-close').addEventListener('click', () => {
            closeDialogAnimated(dialog);
        });
    }

    // Nachricht setzen und Dialog öffnen
    dialog.querySelector('#rate-limit-message').textContent = message;
    dialog.showModal();
};

/**
 * SESSION EXPIRED DIALOG ANZEIGEN
 *
 * Zeigt einen Dialog wenn die Session abgelaufen ist und der Benutzer
 * sich neu einloggen muss, um Daten sicher zu speichern.
 *
 * @param {string} message - Die Fehlermeldung
 */
const showSessionExpiredDialog = (message = t("error.sessionExpiredMsg")) => {
    // Prüfe ob schon ein Session-Expired-Dialog existiert
    let dialog = document.getElementById('session-expired-dialog');

    if (!dialog) {
        // Dialog erstellen falls nicht vorhanden
        dialog = document.createElement('dialog');
        dialog.id = 'session-expired-dialog';
        dialog.className = 'dialog w-full sm:max-w-[425px]';
        dialog.innerHTML = `
            <div>
                <header>
                    <div class="flex items-center gap-3">
                        <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-yellow-500/15">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-yellow-500">
                                <path d="M12 9v4"/>
                                <path d="M12 17h.01"/>
                                <path d="M2.39 17.43A9.96 9.96 0 0 1 2 14C2 8.48 6.48 4 12 4c3.34 0 6.3 1.64 8.11 4.16"/>
                                <path d="M22 14c0 2.76-1.12 5.26-2.93 7.07"/>
                                <path d="m15 15 5 5"/>
                                <path d="m20 15-5 5"/>
                            </svg>
                        </div>
                        <div>
                            <h2 class="text-lg font-semibold">${t("error.sessionExpired")}</h2>
                        </div>
                    </div>
                </header>
                <section class="py-4">
                    <p id="session-expired-message" class="text-gray-400"></p>
                    <p class="text-gray-400 text-sm mt-3">${t("error.localDataSaved")}</p>
                </section>
                <footer class="flex justify-end">
                    <button type="button" class="btn-primary" id="session-expired-login">${lucideIcon('log-in')} ${t("error.logIn")}</button>
                </footer>
            </div>
        `;
        document.body.appendChild(dialog);

        // Prevent closing with Escape key
        dialog.addEventListener('cancel', (e) => {
            e.preventDefault();
        });

        // Prevent closing by clicking backdrop
        dialog.addEventListener('click', (e) => {
            if (e.target === dialog) {
                e.stopPropagation();
            }
        });

        // Login button handler - only way to proceed
        dialog.querySelector('#session-expired-login').addEventListener('click', async () => {
            // Clear all local data for security
            localStorage.removeItem('notenverwaltung');
            localStorage.removeItem('pendingServerSync');
            sessionStorage.clear();

            // Logout from server to clear session cookie
            try {
                await fetch('/api/logout', { method: 'POST' });
            } catch (e) {
                // Ignore errors, redirect anyway
            }

            window.location.href = '/login';
        });
    }

    // Nachricht setzen und Dialog öffnen
    dialog.querySelector('#session-expired-message').textContent = message;
    dialog.showModal();
};

/**
 * RENAME-ERFOLG ICON-ANIMATION
 * Morpht das Icon eines Buttons (z.B. Stift) kurz zu einem Häkchen als
 * visuelles Bestätigungsfeedback, dann zurück zum Original-Icon.
 * @param {HTMLElement} btn - Button mit dem Icon
 */
const flashRenameSuccessIcon = (btn) => {
    if (!btn) return;
    const svg = btn.querySelector('svg');
    if (!svg) return;
    const originalHtml = svg.outerHTML;
    const checkSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check-icon lucide-check">
        <path d="M20 6 9 17l-5-5"/>
    </svg>`;
    setTimeout(() => {
        animateOutThenRun(svg, 'icon-swap-out', () => {
            btn.innerHTML = checkSvg;
            btn.querySelector('svg')?.classList.add('icon-swap-in');
            setTimeout(() => {
                const current = btn.querySelector('svg');
                current?.classList.remove('icon-swap-in');
                animateOutThenRun(current, 'icon-swap-out', () => {
                    btn.innerHTML = originalHtml;
                    btn.querySelector('svg')?.classList.add('icon-swap-in');
                }, 320);
            }, 1300);
        }, 280);
    }, 150);
};

/**
 * DIALOG ANIMIERT SCHLIESSEN
 * Spielt die dialogClose-Exit-Animation ab, bevor die native close()
 * aufgerufen wird (statt dass der Dialog instant verschwindet).
 * @param {HTMLDialogElement} dialog
 */
const closeDialogAnimated = (dialog) => {
    animateOutThenRun(dialog, 'dialog-closing', () => {
        dialog.classList.remove('dialog-closing');
        dialog.close();
    }, 200);
};

/**
 * DIALOG ANZEIGEN (Wiederverwendbar)
 *
 * Öffnet ein modales Dialog-Fenster mit benutzerdefiniertem Inhalt.
 * "Modal" bedeutet: Der Benutzer muss den Dialog schließen bevor
 * er mit dem Rest der Seite interagieren kann.
 *
 * Diese Funktion ist generisch und kann für verschiedene Dialoge
 * verwendet werden (Bearbeiten, Hinzufügen, etc.).
 *
 * @param {string} dialogId - ID des Dialog-Elements im HTML
 * @param {string} title - Überschrift des Dialogs
 * @param {string} content - HTML-Inhalt für das Formular
 * @param {function} onConfirm - Callback-Funktion bei Formular-Submit
 */
const showDialog = (dialogId, title, content, onConfirm = null) => {
    // Dialog-Element aus dem DOM holen
    const dialog = document.getElementById(dialogId);

    // Titel setzen (h2-Element im Dialog)
    dialog.querySelector("h2").textContent = title;

    // Inhalt in das Formular einfügen
    // HINWEIS: content sollte bereits escaped sein wenn Benutzerdaten enthalten
    dialog.querySelector("form").innerHTML = content;

    // Dirty-State tracken für Warnung bei ungespeicherten Änderungen
    let isDirty = false;
    const form = dialog.querySelector("form");
    const markDirty = () => { isDirty = true; };
    form.addEventListener("input", markDirty);
    form.addEventListener("change", markDirty);

    // Hilfsfunktion: Dialog sicher schließen (mit Cleanup)
    const cleanupAndClose = () => {
        form.removeEventListener("input", markDirty);
        form.removeEventListener("change", markDirty);
        isDirty = false;
        closeDialogAnimated(dialog);
    };

    // Versuche den Dialog zu schließen - mit Warnung falls dirty
    const tryClose = async () => {
        if (isDirty) {
            const discard = await showUnsavedChangesWarning();
            if (!discard) return; // Zurück zum Bearbeiten
        }
        cleanupAndClose();
    };

    // Escape-Taste abfangen
    dialog._cancelHandler = (e) => {
        e.preventDefault();
        tryClose();
    };
    dialog.addEventListener("cancel", dialog._cancelHandler);

    // Dialog öffnen (native HTML5 Dialog-API)
    // showModal() macht den Dialog modal (blockiert Hintergrund)
    dialog.showModal();

    // Wenn eine Callback-Funktion übergeben wurde
    if (onConfirm) {
        // Event-Handler für Formular-Submit setzen
        form.onsubmit = (e) => {
            // Standard-Verhalten verhindern (Seite würde neu laden)
            e.preventDefault();

            // FormData-Objekt erstellt aus dem Formular
            // Enthält alle Eingabefelder als Key-Value-Paare
            // Wenn onConfirm false zurückgibt, bleibt der Dialog offen (z.B. bei Validierungsfehlern)
            const result = onConfirm(new FormData(e.target));
            if (result === false) return;

            // Dialog schließen (kein Warning nötig - wurde gespeichert)
            form.removeEventListener("input", markDirty);
            form.removeEventListener("change", markDirty);
            isDirty = false;
            closeDialogAnimated(dialog);
        };
    }

    // Cancel-Button und X-Button mit tryClose verbinden
    const cancelBtn = document.getElementById("cancel-edit");
    if (cancelBtn) {
        cancelBtn.onclick = (e) => {
            e.preventDefault();
            tryClose();
        };
    }

    // X-Button (close icon) im Dialog
    const closeIcon = dialog.querySelector('[aria-label="Close dialog"]');
    if (closeIcon) {
        closeIcon.onclick = (e) => {
            e.preventDefault();
            tryClose();
        };
    }
};

/**
 * BESTÄTIGUNGS-DIALOG ANZEIGEN
 *
 * Zeigt einen Dialog mit "Bist du sicher?"-Frage.
 * Wird verwendet vor destruktiven Aktionen (Löschen, etc.).
 *
 * Der Dialog hat zwei Buttons:
 * - "Cancel": Schließt den Dialog ohne Aktion
 * - "Delete": Führt die übergebene Funktion aus
 *
 * @param {string} message - Die Bestätigungsfrage
 * @param {function} onConfirm - Funktion die bei Bestätigung ausgeführt wird
 */
const showConfirmDialog = (message, onConfirm, details = null, warning = null, options = {}) => {
    const dialog = document.getElementById("confirm-dialog");
    const confirmBtn = document.getElementById("confirm-action");
    const cancelBtn = document.getElementById("cancel-action");

    // Personalisierte Nachricht mit Lehrernamen
    const teacherName = appData.teacherName || "there";
    const personalizedMessage = message.includes(teacherName) ? message : `${teacherName}, ${message}`;

    // Nachricht in den Dialog einfügen
    // textContent ist sicher gegen XSS (interpretiert kein HTML)
    dialog.querySelector("#confirm-message").textContent = personalizedMessage;

    // Details anzeigen (falls vorhanden)
    const detailsEl = dialog.querySelector("#confirm-details");
    if (details) {
        detailsEl.innerHTML = details;
        detailsEl.style.display = 'block';
    } else {
        detailsEl.innerHTML = '';
        detailsEl.style.display = 'none';
    }

    // Warnung anzeigen (falls vorhanden)
    const warningEl = dialog.querySelector("#confirm-warning");
    if (warning) {
        warningEl.textContent = warning;
        warningEl.style.display = 'block';
    } else {
        warningEl.textContent = '';
        warningEl.style.display = 'none';
    }

    // Optionale benutzerdefinierte Button-Labels (z.B. für "Verwerfen" / "Zurück")
    if (options.confirmText || options.cancelText) {
        const origConfirmText = confirmBtn.textContent;
        const origCancelText = cancelBtn.textContent;
        if (options.confirmText) confirmBtn.textContent = options.confirmText;
        if (options.cancelText) cancelBtn.textContent = options.cancelText;
        dialog.addEventListener('close', () => {
            confirmBtn.textContent = origConfirmText;
            cancelBtn.textContent = origCancelText;
        }, { once: true });
    }

    // Optionaler Button-Stil: Default ist der rote "Delete"-Stil; nicht-destruktive
    // Aktionen (z.B. Recovery Key generieren) übergeben confirmClass: 'btn-primary'.
    if (options.confirmClass) {
        const origConfirmClass = confirmBtn.className;
        confirmBtn.className = options.confirmClass;
        dialog.addEventListener('close', () => {
            confirmBtn.className = origConfirmClass;
        }, { once: true });
    }

    // Dialog öffnen
    dialog.showModal();

    // "Delete"-Button: Führt Aktion aus und schließt Dialog
    confirmBtn.onclick = () => {
        onConfirm();      // Übergebene Funktion ausführen
        closeDialogAnimated(dialog);   // Dialog schließen
    };

    // "Cancel"-Button: Nur Dialog schließen
    cancelBtn.onclick = () => {
        closeDialogAnimated(dialog);
    };
};

/**
 * ALERT-DIALOG ANZEIGEN
 *
 * Zeigt einen einfachen Hinweis-Dialog mit nur einem "OK"-Button.
 * Wird verwendet für Warnungen, Fehlermeldungen oder Hinweise.
 *
 * Im Gegensatz zum Bestätigungs-Dialog gibt es hier keine Entscheidung
 * zu treffen - der Benutzer nimmt die Information nur zur Kenntnis.
 *
 * @param {string} message - Die anzuzeigende Nachricht
 */
const showAlertDialog = (message) => {
    const dialog = document.getElementById("alert-dialog");

    // Personalisierte Nachricht
    const teacherName = appData.teacherName || "there";
    const personalizedMessage = message.includes(teacherName) ? message : `${teacherName}, ${message}`;

    // Nachricht setzen (textContent ist XSS-sicher)
    dialog.querySelector("#alert-message").textContent = personalizedMessage;

    // Dialog öffnen
    dialog.showModal();

    // "OK"-Button schließt den Dialog
    document.getElementById("close-alert").onclick = () => {
        closeDialogAnimated(dialog);
    };
};

/**
 * UNSAVED CHANGES WARNING
 *
 * Shows a confirmation dialog when the user tries to close a dialog
 * with unsaved changes. Returns a Promise that resolves to true
 * (discard) or false (go back to editing).
 *
 * @returns {Promise<boolean>} - true if user wants to discard
 */
const showUnsavedChangesWarning = () => {
    return new Promise((resolve) => {
        let warningDialog = document.getElementById('unsaved-changes-dialog');

        if (!warningDialog) {
            warningDialog = document.createElement('dialog');
            warningDialog.id = 'unsaved-changes-dialog';
            warningDialog.className = 'dialog w-full sm:max-w-[425px]';
            document.body.appendChild(warningDialog);
        }

        warningDialog.innerHTML = `
            <div>
                <header>
                    <div class="flex items-center gap-3">
                        <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-yellow-500/15">
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-yellow-500 lucide lucide-triangle-alert-icon lucide-triangle-alert">
                                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
                                <path d="M12 9v4"/>
                                <path d="M12 17h.01"/>
                            </svg>
                        </div>
                        <div>
                            <h2 class="text-lg font-semibold">${t('dialog.unsavedTitle')}</h2>
                        </div>
                    </div>
                </header>
                <section class="py-4">
                    <p class="text-gray-400">${t('dialog.unsavedMessage')}</p>
                </section>
                <footer class="flex justify-end gap-2">
                    <button type="button" class="btn-outline" id="unsaved-back-btn">${lucideIcon('arrow-left')} ${t('dialog.unsavedBack')}</button>
                    <button type="button" class="btn-destructive" id="unsaved-discard-btn">${lucideIcon('trash')} ${t('dialog.unsavedDiscard')}</button>
                </footer>
            </div>
        `;

        warningDialog.addEventListener('cancel', (e) => {
            e.preventDefault();
            closeDialogAnimated(warningDialog);
            resolve(false);
        }, { once: true });

        warningDialog.querySelector('#unsaved-back-btn').addEventListener('click', () => {
            closeDialogAnimated(warningDialog);
            resolve(false);
        }, { once: true });

        warningDialog.querySelector('#unsaved-discard-btn').addEventListener('click', () => {
            closeDialogAnimated(warningDialog);
            resolve(true);
        }, { once: true });

        warningDialog.showModal();
    });
};

/**
 * ANIMATIONEN INITIALISIEREN
 *
 * Fügt Event-Listener hinzu, um Animationen bei Tab-Wechseln
 * und View-Übergängen zu triggern.
 */
const initAnimations = () => {
    // Tab-Wechsel Animation
    // Beobachte alle Tab-Panels und trigger Animation bei Anzeige
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'attributes' && mutation.attributeName === 'hidden') {
                const panel = mutation.target;
                // Wenn Panel sichtbar wird (hidden entfernt)
                if (!panel.hidden && panel.getAttribute('role') === 'tabpanel') {
                    // Animation neu triggern
                    panel.style.animation = 'none';
                    panel.offsetHeight; // Force reflow
                    panel.style.animation = '';
                }
            }
        });
    });

    // Beobachte alle Tab-Panels
    document.querySelectorAll('[role="tabpanel"]').forEach(panel => {
        observer.observe(panel, { attributes: true });
    });

    // Auch für dynamisch erstellte Panels (z.B. in Dialogen)
    const bodyObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === 1) { // Element node
                    const panels = node.querySelectorAll ? node.querySelectorAll('[role="tabpanel"]') : [];
                    panels.forEach(panel => {
                        observer.observe(panel, { attributes: true });
                    });
                    // Auch wenn das hinzugefügte Element selbst ein Panel ist
                    if (node.getAttribute && node.getAttribute('role') === 'tabpanel') {
                        observer.observe(node, { attributes: true });
                    }
                }
            });
        });
    });

    bodyObserver.observe(document.body, { childList: true, subtree: true });
};

/**
 * EMPTY STATE ERSTELLEN
 *
 * Erstellt einen schönen Empty State für leere Listen.
 *
 * @param {string} icon - SVG-Icon als String
 * @param {string} title - Überschrift
 * @param {string} description - Beschreibung
 * @param {Array} buttons - Array von Button-Objekten {text, class, onclick}
 * @param {string} learnMoreLink - Optional: Link zu "Learn More" (z.B. "#")
 * @returns {string} HTML-String für den Empty State
 */
const createEmptyState = (icon, title, description, buttons = [], learnMoreLink = null) => {
    const buttonsHtml = buttons.map(btn =>
        `<button class="${btn.class}" onclick="${btn.onclick}">${btn.text}</button>`
    ).join('');

    const learnMoreHtml = learnMoreLink ? `
        <a href="${learnMoreLink}" class="inline-flex items-center justify-center whitespace-nowrap text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive underline-offset-4 hover:underline h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5 text-gray-400">
            ${t('emptyState.learnMore') || 'Learn More'}
            <svg class="lucide lucide-arrow-up-right-icon lucide-arrow-up-right" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h10v10" /><path d="M7 17 17 7" /></svg>
        </a>
    ` : '';

    return `
        <div class="flex min-w-0 flex-1 flex-col items-center justify-center gap-6 rounded-lg border border-dashed p-6 text-center text-balance md:p-12 text-neutral-800 dark:text-neutral-300">
            <header class="flex max-w-sm flex-col items-center gap-2 text-center">
                <div class="mb-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 bg-muted text-foreground flex size-10 shrink-0 items-center justify-center rounded-lg [&_svg:not([class*='size-'])]:size-6">
                    ${icon}
                </div>
                <h3 class="text-lg font-medium tracking-tight">${title}</h3>
                <p class="text-gray-400 [&>a:hover]:text-primary text-sm/relaxed [&>a]:underline [&>a]:underline-offset-4">
                    ${description}
                </p>
            </header>
            ${buttons.length > 0 ? `
            <section class="flex w-full max-w-sm min-w-0 flex-col items-center gap-4 text-sm text-balance">
                <div class="flex gap-2">
                    ${buttonsHtml}
                </div>
            </section>
            ` : ''}
            ${learnMoreHtml}
        </div>
    `;
};

// Initialisiere Animationen wenn DOM geladen
document.addEventListener('DOMContentLoaded', initAnimations);

// ============ UNDO NOTIFICATION ============
let _undoTimer = null;

const showUndoNotification = (message, undoCallback, durationMs = 5000) => {
    const bar = document.getElementById('undo-notification');
    const textEl = document.getElementById('undo-notification-text');
    const undoBtn = document.getElementById('undo-notification-btn');
    const closeBtn = document.getElementById('undo-notification-close');
    if (!bar || !textEl || !undoBtn || !closeBtn) return;

    // Clear any existing timer
    if (_undoTimer) { clearTimeout(_undoTimer); _undoTimer = null; }

    textEl.textContent = message;
    undoBtn.innerHTML = `${lucideIcon('undo-2')} ${escapeHtml((typeof t === 'function' ? t('toast.undo') : null) || 'Undo')}`;
    bar.classList.remove('hidden');
    bar.style.animation = 'none';
    bar.offsetHeight; // force reflow
    bar.style.animation = 'viewFadeIn 0.2s ease-out';

    const hide = () => {
        bar.classList.add('hidden');
        if (_undoTimer) { clearTimeout(_undoTimer); _undoTimer = null; }
    };

    undoBtn.onclick = () => {
        hide();
        if (typeof undoCallback === 'function') undoCallback();
    };
    closeBtn.onclick = hide;

    _undoTimer = setTimeout(hide, durationMs);
};


/**
 * SWIPE-ROW (iOS Mail style)
 *
 * Build a swipeable list row with up to two actions:
 *   - Drag right (positive dx)  → reveals left-side action  (typically EDIT, blue)
 *   - Drag left  (negative dx)  → reveals right-side action (typically DELETE, red)
 *
 * Usage:
 *   const html = swipeRowHtml({
 *       contentHtml,                // the visible row content (your card)
 *       leftAction:  { label, iconSvg, attr },   // edit (optional)
 *       rightAction: { label, iconSvg, attr },   // delete (optional)
 *       contentAttr: 'role="button" data-id="123"',
 *   });
 *   // After inserting into the DOM, call attachSwipe on every .swipe-row
 *   document.querySelectorAll('.swipe-row').forEach(attachSwipe);
 */
const SWIPE_ICONS = {
    edit:   `<svg class="lucide lucide-pen-line-icon lucide-pen-line" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
    trash:  `<svg class="lucide lucide-trash-icon lucide-trash" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>`
};

const swipeRowHtml = ({ contentHtml, leftAction, rightAction, contentAttr = '' }) => {
    const left = leftAction
        ? `<button type="button" class="swipe-action swipe-action-left" ${leftAction.attr || ''} aria-label="${escapeHtml(leftAction.label || '')}">${leftAction.iconSvg || ''}<span>${escapeHtml(leftAction.label || '')}</span></button>`
        : '';
    const right = rightAction
        ? `<button type="button" class="swipe-action swipe-action-right" ${rightAction.attr || ''} aria-label="${escapeHtml(rightAction.label || '')}">${rightAction.iconSvg || ''}<span>${escapeHtml(rightAction.label || '')}</span></button>`
        : '';
    return `<div class="swipe-row" data-has-left="${leftAction ? '1' : '0'}" data-has-right="${rightAction ? '1' : '0'}">
        ${left}${right}
        <div class="swipe-content" ${contentAttr}>${contentHtml}</div>
    </div>`;
};

const SWIPE_OPEN_PX = 88;
const SWIPE_THRESHOLD = 35;

const closeAllSwipes = (except = null) => {
    document.querySelectorAll('.swipe-row .swipe-content').forEach(c => {
        if (c !== except) c.style.transform = 'translateX(0)';
    });
};

/**
 * Briefly animate the first swipeable row to hint that it can be swiped.
 * Runs at most once per scope per session (using sessionStorage key).
 * scopeKey: unique string identifying the list (e.g. "examOverview", "classList").
 */
const playSwipeHint = (rootEl, scopeKey) => {
    if (!rootEl) return;
    try {
        const k = `swipeHint:${scopeKey}`;
        if (sessionStorage.getItem(k)) return;
        const row = rootEl.querySelector('.swipe-row');
        if (!row) return;
        const content = row.querySelector('.swipe-content');
        if (!content) return;
        if (row.dataset.hasRight !== '1' && row.dataset.hasLeft !== '1') return;
        sessionStorage.setItem(k, '1');

        const peek = (row.dataset.hasRight === '1') ? -44 : 44;
        setTimeout(() => {
            content.style.transition = 'transform 0.45s cubic-bezier(0.22, 1, 0.36, 1)';
            content.style.transform  = `translateX(${peek}px)`;
            setTimeout(() => {
                content.style.transform = 'translateX(0)';
                setTimeout(() => { content.style.transition = ''; }, 500);
            }, 650);
        }, 350);
    } catch { /* ignore */ }
};

const attachSwipe = (row) => {
    const content = row.querySelector('.swipe-content');
    if (!content || content.dataset.swipeBound) return;
    content.dataset.swipeBound = '1';
    const hasLeft  = row.dataset.hasLeft === '1';
    const hasRight = row.dataset.hasRight === '1';

    let startX = 0, startY = 0, startTx = 0;
    let dragging = false, locked = null;
    const getTx = () => {
        const m = /translateX\((-?\d+(?:\.\d+)?)px\)/.exec(content.style.transform || '');
        return m ? parseFloat(m[1]) : 0;
    };
    const setTx = (tx) => { content.style.transform = `translateX(${tx}px)`; };

    const onStart = (x, y) => {
        startX = x; startY = y;
        startTx = getTx();
        dragging = true; locked = null;
        content._didDrag = false;
        content.classList.add('dragging');
    };
    const onMove = (x, y) => {
        if (!dragging) return false;
        const dx = x - startX, dy = y - startY;
        if (locked === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
            locked = (Math.abs(dx) > Math.abs(dy)) ? 'x' : 'y';
        }
        if (locked !== 'x') return false;
        let tx = startTx + dx;
        const min = hasRight ? -SWIPE_OPEN_PX : 0;
        const max = hasLeft  ?  SWIPE_OPEN_PX : 0;
        tx = Math.max(min, Math.min(max, tx));
        setTx(tx);
        if (Math.abs(dx) > 4) content._didDrag = true;
        return true;
    };
    const onEnd = () => {
        if (!dragging) return;
        dragging = false;
        content.classList.remove('dragging');
        const tx = getTx();
        let target = 0;
        if (tx <= -SWIPE_THRESHOLD && hasRight) target = -SWIPE_OPEN_PX;
        else if (tx >= SWIPE_THRESHOLD && hasLeft) target = SWIPE_OPEN_PX;
        closeAllSwipes(content);
        setTx(target);
    };

    content.addEventListener('touchstart', (e) => onStart(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
    content.addEventListener('touchmove',  (e) => {
        const consumed = onMove(e.touches[0].clientX, e.touches[0].clientY);
        if (consumed && e.cancelable) e.preventDefault();
    }, { passive: false });
    content.addEventListener('touchend', onEnd);
    content.addEventListener('touchcancel', onEnd);

    content.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        onStart(e.clientX, e.clientY);
        const mm = (ev) => onMove(ev.clientX, ev.clientY);
        const mu = () => { onEnd(); document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); };
        document.addEventListener('mousemove', mm);
        document.addEventListener('mouseup', mu);
    });

    // Click-through suppression after drag
    content.addEventListener('click', (e) => {
        if (content._didDrag) {
            content._didDrag = false;
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);
};
