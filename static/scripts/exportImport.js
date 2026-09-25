// ========== EXPORT/IMPORT ==========

/**
 * IMPORT PROGRESS DIALOG
 *
 * Shows a progress bar while importing and encrypting data.
 */
let importProgressDialog = null;
let importProgressBar = null;

const showImportProgress = () => {
    // Create dialog if not exists
    if (!importProgressDialog) {
        importProgressDialog = document.createElement('dialog');
        importProgressDialog.id = 'import-progress-dialog';
        importProgressDialog.className = 'dialog';
        importProgressDialog.style.cssText = 'max-width: 425px; width: 100%;';
        importProgressDialog.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1.5rem; padding: 2rem; text-align: center;">
                <div style="display: flex; flex-direction: column; align-items: center; gap: 0.75rem; width: 100%; max-width: 320px;">
                    <div style="margin-bottom: 0.5rem; background: rgba(255, 255, 255, 0.1); color: currentColor; display: flex; width: 48px; height: 48px; align-items: center; justify-content: center; border-radius: 50%;">
                        <svg class="lucide lucide-shield-check-icon lucide-shield-check" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/>
                            <path d="m9 12 2 2 4-4"/>
                        </svg>
                    </div>
                    <h3 style="font-size: 1.125rem; font-weight: 600; margin: 0;" id="import-progress-title">${escapeHtml(t("import.importing"))}</h3>
                    <p style="font-size: 0.875rem; opacity: 0.7; margin: 0;" id="import-progress-subtitle">${escapeHtml(t("import.importingSubtitle"))}</p>
                    <div style="width: 100%; margin-top: 1rem;">
                        <div style="background: rgba(255, 255, 255, 0.15); position: relative; height: 8px; width: 100%; overflow: hidden; border-radius: 9999px;">
                            <div id="import-progress-bar" style="background: white; height: 100%; width: 0%; transition: width 0.4s ease-out;"></div>
                        </div>
                        <p style="font-size: 0.75rem; opacity: 0.7; margin-top: 0.5rem;" id="import-progress-text">${escapeHtml(t("import.starting"))}</p>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(importProgressDialog);
    } else {
        // Update text in case language changed
        const titleEl = importProgressDialog.querySelector('#import-progress-title');
        if (titleEl) titleEl.textContent = t("import.importing");
        const subtitleEl = importProgressDialog.querySelector('#import-progress-subtitle');
        if (subtitleEl) subtitleEl.textContent = t("import.importingSubtitle");
        const textEl = importProgressDialog.querySelector('#import-progress-text');
        if (textEl) textEl.textContent = t("import.starting");
    }

    importProgressBar = importProgressDialog.querySelector('#import-progress-bar');
    importProgressDialog.showModal();
};

const setImportProgress = (percent, text) => {
    if (importProgressBar) {
        importProgressBar.style.width = `${percent}%`;
    }
    const textEl = document.getElementById('import-progress-text');
    if (textEl && text) {
        textEl.textContent = text;
    }
};

const hideImportProgress = () => {
    if (importProgressDialog) {
        importProgressDialog.close();
    }
};

const exportData = () => {
    const dataStr = JSON.stringify(appData, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `notenverwaltung_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    showToast(t("toast.exportSuccess"), "success");
};

// Function to handle the import of data
document.getElementById("import-setup").addEventListener("click", () => {
    document.getElementById("import-dialog").showModal();
});

document.getElementById("cancel-import").addEventListener("click", () => {
    document.getElementById("import-dialog").close();
});

document.getElementById("confirm-import").addEventListener("click", async () => {
    const fileInput = document.getElementById("import-file");
    const file = fileInput.files[0];

    if (!file) {
        showAlertDialog(t("import.selectFileError"));
        return;
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
        showAlertDialog(t("import.fileTooLarge"));
        return;
    }

    // Close import dialog and show import progress overlay
    document.getElementById("import-dialog").close();
    showImportProgress();

    // Wait for dialog to render before starting file read
    await new Promise(resolve => setTimeout(resolve, 150));

    // Track start time to ensure minimum display duration
    const startTime = Date.now();
    const MIN_LOADING_TIME = 3000; // 3 seconds minimum

    // Helper function to read file as Promise
    const readFileAsText = (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (event) => resolve(event.target.result);
            reader.onerror = (error) => reject(error);
            reader.readAsText(file);
        });
    };

    // Helper function to ensure minimum loading time
    const ensureMinTime = async () => {
        const elapsed = Date.now() - startTime;
        if (elapsed < MIN_LOADING_TIME) {
            await new Promise(resolve => setTimeout(resolve, MIN_LOADING_TIME - elapsed));
        }
    };

    try {
        // Step 1: Read file
        setImportProgress(10, t("import.readingFile"));
        await new Promise(resolve => setTimeout(resolve, 400));

        const fileContent = await readFileAsText(file);

        // Step 2: Parse JSON
        setImportProgress(25, t("import.parsingData"));
        await new Promise(resolve => setTimeout(resolve, 400));

        const rawData = JSON.parse(fileContent);

        // Step 3: Validate structure
        setImportProgress(40, t("import.validating"));
        await new Promise(resolve => setTimeout(resolve, 400));

        // Validate the data structure
        if (!rawData.teacherName || !Array.isArray(rawData.classes)) {
            await ensureMinTime();
            hideImportProgress();
            showAlertDialog(t("import.invalidStructure"));
            return;
        }

        // Check if the data structure matches our expected format
        // Support both old format (cls.students) and new format (cls.years[].students)
        const isValid = rawData.classes.every(cls => {
            // Check basic class properties
            if (!cls.id || !cls.name) return false;

            // New format: check if class has years with students
            if (Array.isArray(cls.years)) {
                return cls.years.every(year =>
                    year.id && year.name && Array.isArray(year.students)
                );
            }

            // Old format: check if class has students directly
            if (Array.isArray(cls.students)) {
                return true;
            }

            return false;
        }) && (!rawData.categories || rawData.categories.every(cat =>
            cat.id && cat.name && typeof cat.weight === 'number'
        )) && (!rawData.students || rawData.students.every(student =>
            student.id && (student.lastName || student.name) && Array.isArray(student.grades)
        ));

        if (!isValid) {
            await ensureMinTime();
            hideImportProgress();
            showAlertDialog(t("import.invalidStructure"));
            return;
        }

        // Step 4: Sanitize data
        setImportProgress(55, t("import.sanitizing"));
        await new Promise(resolve => setTimeout(resolve, 500));

        const sanitizedData = sanitizeImportData(rawData);

        if (!sanitizedData) {
            await ensureMinTime();
            hideImportProgress();
            showAlertDialog(t("import.sanitizeError"));
            return;
        }

        // Load the sanitized data into the application
        appData = sanitizedData;

        // Step 5: Encrypt and save (longest step)
        setImportProgress(70, t("import.encrypting"));

        await new Promise((resolve) => {
            fetch('/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(appData)
            })
            .then(response => {
                if (!response.ok) {
                    // Hand off to the regular save path so the in-memory retry
                    // queue takes over — sensitive data never hits localStorage.
                    saveData(t("toast.localSyncFailed"), "warning");
                }
                resolve();
            })
            .catch(error => {
                console.error('Import save error:', error);
                saveData(t("toast.localNetworkError"), "warning");
                resolve();
            });
        });

        // Extra delay for encryption step (most important)
        await new Promise(resolve => setTimeout(resolve, 800));

        // Step 6: Finalize
        setImportProgress(90, t("import.finalizing"));
        await new Promise(resolve => setTimeout(resolve, 400));

        // Complete progress bar
        setImportProgress(100, t("import.complete"));

        // Ensure minimum loading time
        await ensureMinTime();

        // Small delay to show 100% before closing
        await new Promise(resolve => setTimeout(resolve, 500));

        hideImportProgress();
        showToast(t("toast.importSuccess"), "success");

        // Hide the setup page and show the dashboard
        document.getElementById("setup-page").classList.add("hidden");
        document.getElementById("dashboard").classList.remove("hidden");

        // Use teacherName or fallback to username
        const displayName = appData.teacherName || window.currentUser.username;
        document.getElementById("teacher-greeting").textContent = displayName;

        // Render the UI with the imported data
        renderClassList();
        renderStudents();
        renderCategoryFilter();

        // Update home view with current data
        if (typeof renderHome === 'function') {
            renderHome();
        }

    } catch (error) {
        console.error('Import error:', error);
        await ensureMinTime();
        hideImportProgress();
        showAlertDialog(t("import.parseError"));
    }
});
