// tutorial.js
// ========== INTERAKTIVES TUTORIAL SYSTEM ==========

// Tutorial State
let tutorialActive = false;
let currentStepIndex = 0;
let currentWaitListener = null; // Aktueller Event-Listener für Benutzeraktion
let dialogWasOpen = false; // Für Dialog-Schließen-Checks

/**
 * Tutorial-Schritte Definition
 * waitFor: Beschreibt worauf gewartet wird (selector + event oder custom check)
 * action: Wird ausgeführt bevor der Schritt angezeigt wird
 * onComplete: Wird ausgeführt wenn der Schritt abgeschlossen ist
 */
const TUTORIAL_STEPS = [
    {
        id: 'welcome',
        get title() { return t("tutorial.welcome.title"); },
        get content() { return t("tutorial.welcome.content"); },
        targetSelector: null,
        position: 'center',
        manualNext: true // Benutzer muss "Next" klicken
    },
    {
        id: 'click-nav-settings',
        get title() { return t("tutorial.openCategories.title"); },
        get content() { return t("tutorial.openCategories.content"); },
        targetSelector: '#nav-settings',
        position: 'bottom',
        waitFor: {
            selector: '#nav-settings',
            event: 'click'
        },
        action: () => {
            closeTutorialDialogs();
        }
    },
    {
        id: 'click-add-category',
        get title() { return t("tutorial.addCategory.title"); },
        get content() { return t("tutorial.addCategory.content"); },
        targetSelector: '#add-category',
        position: 'bottom',
        waitFor: {
            selector: '#add-category',
            event: 'click'
        }
    },
    {
        id: 'fill-category-form',
        get title() { return t("tutorial.fillCategory.title"); },
        get content() { return t("tutorial.fillCategory.content"); },
        targetSelector: '#edit-dialog',
        position: 'right',
        waitFor: {
            check: () => appData.categories.length > 0,
            event: 'categoryAdded'
        }
    },
    {
        id: 'explain-grade-ranges',
        get title() { return t("tutorial.gradeRangesTab.title"); },
        get content() { return t("tutorial.gradeRangesTab.content"); },
        targetSelector: '#save-percentage-ranges',
        position: 'top',
        manualNext: true,
        action: () => {
            // Schließe edit-dialog falls noch offen
            const editDialog = document.getElementById('edit-dialog');
            if (editDialog && editDialog.open) editDialog.close();
        }
    },
    {
        id: 'explain-percentage-settings-and-back',
        get title() { return t("tutorial.gradeRanges.title"); },
        get content() { return t("tutorial.gradeRanges.content"); },
        targetSelector: '#settings-breadcrumb-home',
        position: 'bottom',
        waitFor: {
            selector: '#settings-breadcrumb-home',
            event: 'click'
        }
    },
    {
        id: 'click-add-student',
        get title() { return t("tutorial.addStudent.title"); },
        get content() { return t("tutorial.addStudent.content"); },
        targetSelector: '#add-student',
        position: 'bottom',
        waitFor: {
            selector: '#add-student',
            event: 'click'
        }
    },
    {
        id: 'fill-student-form',
        get title() { return t("tutorial.fillStudent.title"); },
        get content() { return t("tutorial.fillStudent.content"); },
        targetSelector: '#add-student-dialog',
        position: 'right',
        waitFor: {
            check: () => {
                const currentYear = getCurrentYear();
                return currentYear && currentYear.students.length > 0;
            },
            event: 'studentAdded'
        }
    },
    {
        id: 'click-add-grade',
        get title() { return t("tutorial.addGrade.title"); },
        get content() { return t("tutorial.addGrade.content"); },
        targetSelector: '[data-add-grade]',
        position: 'left',
        waitFor: {
            selector: '[data-add-grade]',
            event: 'click'
        },
        action: () => {
            // Stelle sicher, dass der Student sichtbar ist
            renderStudents();
        }
    },
    {
        id: 'fill-grade-form',
        get title() { return t("tutorial.fillGrade.title"); },
        get content() { return t("tutorial.fillGrade.content"); },
        targetSelector: '#edit-dialog',
        position: 'right',
        waitFor: {
            check: () => {
                const currentYear = getCurrentYear();
                if (!currentYear) return false;
                const student = currentYear.students[0];
                return student && student.grades && student.grades.length > 0;
            },
            event: 'gradeAdded'
        }
    },
    {
        id: 'view-results',
        get title() { return t("tutorial.viewResults.title"); },
        get content() { return t("tutorial.viewResults.content"); },
        targetSelector: '.student-table-container',
        position: 'top',
        manualNext: true,
        action: () => {
            closeTutorialDialogs();
            renderStudents();
        }
    },
    {
        id: 'open-student-detail',
        get title() { return t("tutorial.studentDetail.title"); },
        get content() { return t("tutorial.studentDetail.content"); },
        targetSelector: '.student-table-container tbody tr:first-child',
        position: 'center',
        waitFor: {
            check: () => {
                const studentDetailView = document.getElementById('student-detail-view');
                return studentDetailView && !studentDetailView.classList.contains('hidden');
            },
            interval: 200
        }
    },
    {
        id: 'view-grade-list',
        get title() { return t("tutorial.gradeList.title"); },
        get content() { return t("tutorial.gradeList.content"); },
        targetSelector: '#student-grades-table',
        position: 'top',
        manualNext: true
    },
    {
        id: 'edit-grade-interactive',
        get title() { return t("tutorial.editGrade.title"); },
        get content() { return t("tutorial.editGrade.content"); },
        targetSelector: '#student-grades-table',
        position: 'left',
        waitFor: {
            check: () => {
                const editDialog = document.getElementById('edit-dialog');
                return editDialog && editDialog.open;
            },
            interval: 200
        }
    },
    {
        id: 'years-and-subjects',
        get title() { return t("tutorial.yearsAndSubjects.title"); },
        get content() { return t("tutorial.yearsAndSubjects.content"); },
        targetSelector: '#year-selector',
        position: 'bottom',
        manualNext: true,
        action: () => {
            closeTutorialDialogs();
        }
    },
    {
        id: 'complete',
        get title() { return t("tutorial.complete.title"); },
        get content() { return t("tutorial.complete.content"); },
        targetSelector: null,
        position: 'center',
        manualNext: true
    }
];

/**
 * Schließt alle Dialoge
 */
const closeTutorialDialogs = () => {
    document.querySelectorAll('dialog[open]').forEach(d => {
        d.close();
    });
};

/**
 * Initialize tutorial
 */
const initTutorial = () => {
    if (!appData.tutorial) {
        appData.tutorial = {
            completed: false,
            currentStep: 0,
            neverShowAgain: false
        };
    }

    if (appData.tutorial.completed || appData.tutorial.neverShowAgain) {
        return;
    }

    currentStepIndex = appData.tutorial.currentStep || 0;
    showTutorialPrompt();
};

/**
 * Zeigt den initialen Prompt
 */
const showTutorialPrompt = () => {
    const promptEl = document.createElement('div');
    promptEl.className = 'tutorial-prompt';
    promptEl.innerHTML = `
        <div class="tutorial-overlay"></div>
        <div class="tutorial-dialog" style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);">
            <h3 class="text-xl font-semibold mb-3">${escapeHtml(t("tutorial.prompt"))}</h3>
            <p class="text-gray-400 mb-4">${escapeHtml(t("tutorial.promptSubtext"))}</p>
            <div class="flex justify-between items-center">
                <label class="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" class="checkbox" id="tutorial-never-again">
                    <span class="text-gray-400 text-sm">${escapeHtml(t("tutorial.dontShowAgain"))}</span>
                </label>
                <div class="flex gap-2">
                    <button type="button" class="btn-outline" id="tutorial-skip">${escapeHtml(t("tutorial.skip"))}</button>
                    <button type="button" class="btn-primary" id="tutorial-start">${lucideIcon('play')} ${escapeHtml(t("tutorial.startTour"))}</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(promptEl);

    document.getElementById('tutorial-start').addEventListener('click', () => {
        promptEl.remove();
        startTutorial();
    });

    document.getElementById('tutorial-skip').addEventListener('click', () => {
        const neverAgain = document.getElementById('tutorial-never-again').checked;
        promptEl.remove();
        skipTutorial(neverAgain);
    });
};

/**
 * Startet das Tutorial
 */
const startTutorial = () => {
    tutorialActive = true;
    currentStepIndex = 0;

    // Markiere body als tutorial-active (für CSS)
    document.body.classList.add('tutorial-active');

    // Stelle sicher, dass wir in der Class-View sind
    if (appData.classes.length > 0) {
        if (!appData.currentClassId) {
            appData.currentClassId = appData.classes[0].id;
        }
        showClassView();
    }

    showStep(currentStepIndex);
};

/**
 * Zeigt einen Tutorial-Schritt
 */
const showStep = (stepIndex) => {
    // Cleanup vorheriger Schritt
    cleanupTutorialUI();
    removeWaitListener();

    const step = TUTORIAL_STEPS[stepIndex];
    if (!step) {
        completeTutorial();
        return;
    }

    // Führe Aktion aus
    if (step.action) {
        step.action();
    }

    // Kurze Verzögerung für DOM-Updates
    setTimeout(() => {
        renderTutorialStep(step, stepIndex);

        // Setup wait listener wenn nicht manualNext
        if (!step.manualNext && step.waitFor) {
            setupWaitListener(step);
        }
    }, 200);
};

/**
 * Rendert den Tutorial-Schritt
 * Verwendet ein fixes div Element statt dialog, um Interaktion mit anderen Dialogen zu ermöglichen
 */
const renderTutorialStep = (step, stepIndex) => {
    // Target highlighten (bevor Dialog geöffnet wird)
    if (step.targetSelector) {
        const targetElement = document.querySelector(step.targetSelector);
        if (targetElement) {
            targetElement.classList.add('tutorial-spotlight');

            if (!targetElement.closest('dialog')) {
                targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }

    // Progress
    const progressDots = TUTORIAL_STEPS.map((_, i) => {
        let dotClass = 'tutorial-progress-dot';
        if (i < stepIndex) dotClass += ' completed';
        else if (i === stepIndex) dotClass += ' active';
        return `<div class="${dotClass}"></div>`;
    }).join('');

    const stepNumber = `${stepIndex + 1}/${TUTORIAL_STEPS.length}`;
    const isLastStep = stepIndex === TUTORIAL_STEPS.length - 1;
    const showNextButton = step.manualNext;

    // Hinweis wenn auf Aktion gewartet wird
    const waitingHint = !step.manualNext && step.waitFor
        ? `<p class="text-xs mt-2" style="color: var(--primary);">${escapeHtml(t("tutorial.waiting"))}</p>`
        : '';

    // Prüfe ob das Ziel-Element in einem Dialog ist
    let targetDialog = null;
    let isInDialog = false;
    if (step.targetSelector) {
        const targetElement = document.querySelector(step.targetSelector);
        if (targetElement) {
            targetDialog = targetElement.closest('dialog');
            isInDialog = targetDialog && targetDialog.open;
        }
    }

    // Berechne Position basierend auf targetSelector
    let positionStyle = '';
    if (step.targetSelector && step.position !== 'center' && !isInDialog) {
        const targetElement = document.querySelector(step.targetSelector);
        if (targetElement) {
            const targetRect = targetElement.getBoundingClientRect();
            positionStyle = calculateDialogPosition(targetRect, step.position);
        }
    }

    // Wenn keine Position berechnet wurde, verwende default
    if (!positionStyle) {
        if (isInDialog) {
            // Im Dialog: verwende fixed positioning mit hohem z-index, aber außerhalb des Dialogs
            positionStyle = 'position: fixed; bottom: 1.5rem; right: 1.5rem; z-index: 99999;';
        } else if (step.position === 'center') {
            positionStyle = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 99999;';
        } else {
            positionStyle = 'position: fixed; bottom: 1.5rem; right: 1.5rem; z-index: 99999;';
        }
    } else {
        // Füge z-index hinzu
        positionStyle += ' z-index: 99999;';
    }

    // Füge pointer-events hinzu
    positionStyle += ' pointer-events: auto;';

    // Erstelle ein fixes div Element statt dialog (kein blocking von anderen Elementen)
    const tutorialBox = document.createElement('div');
    tutorialBox.className = 'tutorial-floating-box';
    tutorialBox.setAttribute('style', positionStyle);
    tutorialBox.innerHTML = `
        <div class="tutorial-dialog-content">
            <div class="flex justify-between items-center mb-2">
                <div class="tutorial-progress">${progressDots}</div>
                <span class="text-gray-400 text-sm">${stepNumber}</span>
            </div>
            <h3 class="text-lg font-semibold mb-2">${escapeHtml(step.title)}</h3>
            <p class="text-gray-400 mb-4" style="white-space: pre-line;">${escapeHtml(step.content)}</p>
            ${waitingHint}
            <div class="flex justify-between items-center mt-4">
                <button type="button" class="btn-outline" id="tutorial-skip-btn">
                    ${escapeHtml(t("tutorial.skipTour"))}
                </button>
                <div class="flex gap-2">
                    ${stepIndex > 0 ? `<button type="button" class="btn-outline" id="tutorial-back-btn">${lucideIcon('arrow-left')} ${escapeHtml(t("tutorial.back"))}</button>` : ''}
                    ${showNextButton ? `<button type="button" class="btn-primary" id="tutorial-next-btn">${isLastStep ? escapeHtml(t("tutorial.finish")) : escapeHtml(t("tutorial.next"))}</button>` : ''}
                </div>
            </div>
        </div>
    `;

    // Füge Tutorial-Box immer zum Body hinzu
    // (Dialog-Elemente sind im "top layer" und ignorieren z-index, daher besser außerhalb positionieren)
    document.body.appendChild(tutorialBox);

    // Event Listeners
    if (showNextButton) {
        document.getElementById('tutorial-next-btn').addEventListener('click', nextStep);
    }

    if (stepIndex > 0) {
        const backBtn = document.getElementById('tutorial-back-btn');
        if (backBtn) {
            backBtn.addEventListener('click', prevStep);
        }
    }

    document.getElementById('tutorial-skip-btn').addEventListener('click', () => {
        skipTutorial(false);
    });

    // Keyboard
    const handleKeydown = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault(); // Verhindere dass andere Dialoge geschlossen werden
            skipTutorial(false);
        } else if ((e.key === 'ArrowRight' || e.key === 'Enter') && showNextButton) {
            nextStep();
        } else if (e.key === 'ArrowLeft' && stepIndex > 0) {
            prevStep();
        }
    };
    document.addEventListener('keydown', handleKeydown);
    tutorialBox._keydownHandler = handleKeydown;

    // Fortschritt speichern
    appData.tutorial.currentStep = stepIndex;
    saveData('', 'info');
};

/**
 * Setup listener für Benutzeraktion
 */
const setupWaitListener = (step) => {
    const waitFor = step.waitFor;

    if (waitFor.dialogCloseEvent) {
        // Warte auf Dialog close Event
        const dialog = document.getElementById(waitFor.dialogCloseEvent);
        if (dialog) {
            const handler = () => {
                setTimeout(() => {
                    nextStep();
                }, 200);
            };
            dialog.addEventListener('close', handler, { once: true });
            currentWaitListener = { element: dialog, event: 'close', handler };
        }
    } else if (waitFor.selector && waitFor.event) {
        // Warte auf Klick auf Element
        const element = document.querySelector(waitFor.selector);
        if (element) {
            const handler = () => {
                // Kleine Verzögerung damit die Aktion ausgeführt werden kann
                setTimeout(() => {
                    nextStep();
                }, 100);
            };
            element.addEventListener(waitFor.event, handler, { once: true });
            currentWaitListener = { element, event: waitFor.event, handler };
        }
    } else if (waitFor.check) {
        // Polling für Zustandsänderung
        const interval = waitFor.interval || 300;
        const checkInterval = setInterval(() => {
            if (waitFor.check()) {
                clearInterval(checkInterval);
                setTimeout(() => {
                    nextStep();
                }, 300);
            }
        }, interval);
        currentWaitListener = { interval: checkInterval };
    }
};

/**
 * Entfernt den aktuellen Wait-Listener
 */
const removeWaitListener = () => {
    if (currentWaitListener) {
        if (currentWaitListener.interval) {
            clearInterval(currentWaitListener.interval);
        }
        if (currentWaitListener.element && currentWaitListener.handler) {
            currentWaitListener.element.removeEventListener(
                currentWaitListener.event,
                currentWaitListener.handler
            );
        }
        currentWaitListener = null;
    }
};

/**
 * Berechnet Dialog-Position
 */
const calculateDialogPosition = (targetRect, position) => {
    if (!targetRect || position === 'center') {
        return 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);';
    }

    const padding = 20;
    const dialogWidth = 380;
    const dialogHeight = 300;

    let top, left;

    switch (position) {
        case 'top':
            top = targetRect.top - dialogHeight - padding;
            left = targetRect.left + (targetRect.width / 2) - (dialogWidth / 2);
            break;
        case 'bottom':
            top = targetRect.bottom + padding;
            left = targetRect.left + (targetRect.width / 2) - (dialogWidth / 2);
            break;
        case 'left':
            top = targetRect.top + (targetRect.height / 2) - (dialogHeight / 2);
            left = targetRect.left - dialogWidth - padding;
            break;
        case 'right':
            top = targetRect.top + (targetRect.height / 2) - (dialogHeight / 2);
            left = targetRect.right + padding;
            break;
        default:
            top = targetRect.bottom + padding;
            left = targetRect.left;
    }

    // Viewport-Grenzen
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    if (left < padding) left = padding;
    if (left + dialogWidth > viewportWidth - padding) left = viewportWidth - dialogWidth - padding;
    if (top < padding) top = padding;
    if (top + dialogHeight > viewportHeight - padding) top = viewportHeight - dialogHeight - padding;

    return `position: fixed; top: ${top}px; left: ${left}px;`;
};

/**
 * Nächster Schritt
 */
const nextStep = () => {
    currentStepIndex++;
    if (currentStepIndex >= TUTORIAL_STEPS.length) {
        completeTutorial();
    } else {
        showStep(currentStepIndex);
    }
};

/**
 * Vorheriger Schritt
 */
const prevStep = () => {
    if (currentStepIndex > 0) {
        currentStepIndex--;
        showStep(currentStepIndex);
    }
};

/**
 * Tutorial überspringen
 */
const skipTutorial = (neverShowAgain) => {
    tutorialActive = false;
    document.body.classList.remove('tutorial-active');
    cleanupTutorialUI();
    removeWaitListener();
    closeTutorialDialogs();

    appData.tutorial.completed = true;
    appData.tutorial.neverShowAgain = neverShowAgain;
    saveData(t("tutorial.skipped"), 'info');
};

/**
 * Tutorial abschließen
 */
const completeTutorial = () => {
    tutorialActive = false;
    document.body.classList.remove('tutorial-active');
    cleanupTutorialUI();
    removeWaitListener();
    closeTutorialDialogs();

    appData.tutorial.completed = true;
    appData.tutorial.currentStep = TUTORIAL_STEPS.length;
    saveData(t("tutorial.completed"), 'success');
};

/**
 * Cleanup UI
 */
const cleanupTutorialUI = () => {
    // Tutorial floating box entfernen
    const floatingBox = document.querySelector('.tutorial-floating-box');
    if (floatingBox) {
        if (floatingBox._keydownHandler) {
            document.removeEventListener('keydown', floatingBox._keydownHandler);
        }
        floatingBox.remove();
    }

    // Natives Tutorial-Dialog entfernen (legacy)
    const nativeDialog = document.querySelector('.tutorial-native-dialog');
    if (nativeDialog) {
        if (nativeDialog._keydownHandler) {
            document.removeEventListener('keydown', nativeDialog._keydownHandler);
        }
        if (nativeDialog.close) nativeDialog.close();
        nativeDialog.remove();
    }

    // Altes Container-System (falls noch vorhanden)
    const container = document.querySelector('.tutorial-container');
    if (container) {
        if (container._keydownHandler) {
            document.removeEventListener('keydown', container._keydownHandler);
        }
        container.remove();
    }

    const prompt = document.querySelector('.tutorial-prompt');
    if (prompt) prompt.remove();

    document.querySelectorAll('.tutorial-spotlight').forEach(el => {
        el.classList.remove('tutorial-spotlight');
    });
};

/**
 * Tutorial zurücksetzen (Konsole: resetTutorial())
 */
const resetTutorial = () => {
    appData.tutorial = {
        completed: false,
        currentStep: 0,
        neverShowAgain: false
    };
    saveData(t("tutorial.reset"), 'info');
};
