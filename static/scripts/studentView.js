// studentView.js
// Self-contained JS for the student grade viewing page.
// Duplicates calculation functions since this page is independent of the teacher app.

(() => {
    'use strict';

    // Exit early if there's an error state (no PIN form to render)
    if (window.shareError) return;

    // ============ UTILITY FUNCTIONS ============

    const escapeHtml = (text) => {
        if (text === null || text === undefined) return '';
        const str = String(text);
        const map = {
            '&': '&amp;', '<': '&lt;', '>': '&gt;',
            '"': '&quot;', "'": '&#039;', '/': '&#x2F;',
            '`': '&#x60;', '=': '&#x3D;'
        };
        return str.replace(/[&<>"'`=/]/g, char => map[char]);
    };

    const safeAttr = (value) => escapeHtml(String(value || ''));

    // ============ GRADE CALCULATION FUNCTIONS ============

    const getGradeColorClass = (grade) => {
        if (grade.isPlusMinus) {
            if (grade.value === '+') return 'grade-badge grade-plus';
            if (grade.value === '~') return 'grade-badge grade-neutral';
            return 'grade-badge grade-minus';
        }
        const value = parseFloat(grade.value);
        if (isNaN(value)) return 'badge-secondary';
        if (value <= 1.5) return 'grade-badge grade-1';
        if (value <= 2.5) return 'grade-badge grade-2';
        if (value <= 3.5) return 'grade-badge grade-3';
        if (value <= 4.5) return 'grade-badge grade-4';
        return 'grade-badge grade-5';
    };

    const calculateSimpleAverage = (grades) => {
        const numeric = grades.filter(g => !g.isPlusMinus);
        if (numeric.length === 0) return 0;
        return numeric.reduce((sum, g) => sum + g.value, 0) / numeric.length;
    };

    const calculateWeightedAverage = (grades, plusMinusPercentages) => {
        const percentages = plusMinusPercentages || { plus: 100, neutral: 50, minus: 0 };
        const byCategory = {};

        grades.forEach(grade => {
            const catId = grade.categoryId;
            if (!byCategory[catId]) {
                byCategory[catId] = { weight: grade.weight, numericGrades: [], plusCount: 0, neutralCount: 0, minusCount: 0 };
            }
            if (grade.isPlusMinus) {
                if (grade.value === '+') byCategory[catId].plusCount++;
                else if (grade.value === '~') byCategory[catId].neutralCount++;
                else if (grade.value === '-') byCategory[catId].minusCount++;
            } else {
                byCategory[catId].numericGrades.push(grade.value);
            }
        });

        let weightedSum = 0, totalWeight = 0;

        Object.values(byCategory).forEach(cat => {
            let avg = null;
            if (cat.numericGrades.length > 0) {
                avg = cat.numericGrades.reduce((a, b) => a + b, 0) / cat.numericGrades.length;
            }

            const totalPlusMinusGrades = cat.plusCount + cat.neutralCount + cat.minusCount;
            if (totalPlusMinusGrades > 0) {
                // Prozentbasierte Berechnung für +/~/- Noten
                const totalPoints = (cat.plusCount * percentages.plus) +
                                   (cat.neutralCount * percentages.neutral) +
                                   (cat.minusCount * percentages.minus);
                const percentage = totalPoints / totalPlusMinusGrades;

                let pmGrade;
                // Prozent in Note umwandeln (mit percentToGrade falls verfügbar)
                if (typeof percentToGrade === 'function') {
                    pmGrade = percentToGrade(percentage);
                    if (pmGrade === null) pmGrade = 3;
                } else {
                    // Fallback: Einfache Umrechnung wenn percentToGrade nicht verfügbar
                    if (percentage >= 85) pmGrade = 1;
                    else if (percentage >= 70) pmGrade = 2;
                    else if (percentage >= 55) pmGrade = 3;
                    else if (percentage >= 40) pmGrade = 4;
                    else pmGrade = 5;
                }

                if (cat.numericGrades.length === 0) {
                    // Nur +/~/- Noten
                    avg = pmGrade;
                } else {
                    // Gemischte Kategorie: +/~/- zählt als eine zusätzliche "Note"
                    avg = (avg * cat.numericGrades.length + pmGrade) / (cat.numericGrades.length + 1);
                }
            }

            if (avg !== null) {
                weightedSum += avg * cat.weight;
                totalWeight += cat.weight;
            }
        });

        if (totalWeight === 0) return 0;
        return Math.max(1, Math.min(5, weightedSum / totalWeight));
    };

    const calculateFinalGrade = (average) => {
        if (average === 0) return '-';
        if (average <= 1.5) return '1';
        if (average <= 2.5) return '2';
        if (average <= 3.5) return '3';
        if (average <= 4.5) return '4';
        return '5';
    };

    const filterGradesBySubject = (grades, subjectId) => {
        if (!subjectId) return [];
        return grades.filter(g => g.subjectId === subjectId);
    };

    // ============ STATE ============

    let studentData = null;
    let allData = null;
    let currentSubjectId = null;
    let chartInstance = null;

    // ============ PIN VERIFICATION ============

    const pinForm = document.getElementById('pin-form');
    if (pinForm) {
        pinForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const pin = document.getElementById('pin-input').value.trim();
            const errorEl = document.getElementById('pin-error');
            const btn = document.getElementById('pin-submit-btn');
            const originalHtml = btn.innerHTML;

            errorEl.classList.add('hidden');
            btn.disabled = true;
            btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="animate-spin lucide lucide-loader-circle-icon lucide-loader-circle"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg> ${t("studentView.loading")}`;

            try {
                const response = await fetch(`/api/grades/${window.shareToken}/verify`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pin })
                });

                const data = await response.json();

                if (data.success) {
                    allData = data;
                    studentData = data.student;
                    document.getElementById('pin-entry').classList.add('hidden');
                    document.getElementById('grades-display').classList.remove('hidden');
                    renderStudentData();
                } else {
                    errorEl.textContent = data.message ? t(data.message) : t("studentView.wrongPin");
                    errorEl.classList.remove('hidden');
                    btn.disabled = false;
                    btn.innerHTML = originalHtml;
                }
            } catch (error) {
                errorEl.textContent = t("studentView.connectionError");
                errorEl.classList.remove('hidden');
                btn.disabled = false;
                btn.innerHTML = originalHtml;
            }
        });
    }

    // ============ RENDERING ============

    const renderStudentData = () => {
        if (!studentData || !allData) return;

        // Header
        document.getElementById('student-name-display').textContent = studentData.name;
        document.getElementById('class-info-display').textContent =
            `${allData.class_name} — ${allData.teacher_name}`;

        // Subject tabs
        renderSubjectTabs();

        // Render content based on active subject
        renderContent();
    };

    const renderSubjectTabs = () => {
        const container = document.getElementById('student-subject-tabs');
        const subjects = allData.subjects || [];

        if (subjects.length === 0) {
            container.innerHTML = '';
            return;
        }

        // Wenn kein Fach ausgewählt ist, wähle das erste
        if (!currentSubjectId && subjects.length > 0) {
            currentSubjectId = subjects[0].id;
        }

        let html = '';
        subjects.forEach(s => {
            const isActive = currentSubjectId === s.id;
            html += `<button class="${isActive ? 'btn-sm-primary' : 'btn-sm-outline'}" data-subject-filter="${safeAttr(s.id)}">${escapeHtml(s.name)}</button>`;
        });

        container.innerHTML = html;

        container.querySelectorAll('[data-subject-filter]').forEach(btn => {
            btn.addEventListener('click', () => {
                currentSubjectId = btn.dataset.subjectFilter;
                renderSubjectTabs();
                renderContent();
            });
        });
    };

    const renderContent = () => {
        const grades = filterGradesBySubject(studentData.grades || [], currentSubjectId);
        const visibility = allData.visibility || {};
        const settings = allData.plusMinusGradeSettings || {};

        renderStatCards(grades, visibility, settings);
        renderGradesTable(grades);

        if (visibility.categoryBreakdown) {
            renderCategoryBreakdown(grades);
        }

        if (visibility.chart) {
            renderChart(grades);
        }
    };

    const renderStatCards = (grades, visibility, settings) => {
        const container = document.getElementById('student-stat-cards');
        // Prefer server-computed stats: when grades are hidden the raw list is
        // empty and only the server knows the real average/final grade.
        const serverStats = (allData.stats || {})[String(currentSubjectId)] || null;
        const weightedAvg = (serverStats && typeof serverStats.average === 'number')
            ? serverStats.average
            : calculateWeightedAverage(grades, settings);
        const finalGrade = (serverStats && serverStats.finalGrade !== undefined)
            ? serverStats.finalGrade
            : calculateFinalGrade(weightedAvg);

        let html = '';

        if (visibility.average !== false) {
            html += `
                <div class="stat-card p-4 rounded-lg border">
                    <p class="text-gray-400 text-sm">${t("studentView.average")}</p>
                    <p class="text-2xl font-bold">${weightedAvg ? weightedAvg.toFixed(2) : '-'}</p>
                </div>`;
        }

        if (visibility.finalGrade !== false) {
            html += `
                <div class="stat-card p-4 rounded-lg border">
                    <p class="text-gray-400 text-sm">${t("studentView.finalGrade")}</p>
                    <p class="text-2xl font-bold">${finalGrade}</p>
                </div>`;
        }

        container.innerHTML = html;
    };

    const renderGradesTable = (grades) => {
        const tbody = document.getElementById('student-grades-tbody');
        const visibility = allData.visibility || {};

        if (!visibility.grades && visibility.grades !== undefined) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center text-gray-400">${t("studentView.gradesNotShared")}</td></tr>`;
            return;
        }

        const sorted = [...grades].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        if (sorted.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center text-gray-400">${t("studentView.noGradesYet")}</td></tr>`;
            return;
        }

        tbody.innerHTML = sorted.map(grade => {
            const date = grade.createdAt
                ? new Date(grade.createdAt).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })
                : '-';
            const displayValue = grade.isPlusMinus ? grade.value : grade.value.toString();
            const colorClass = getGradeColorClass(grade);
            const weightDisplay = grade.isPlusMinus ? '-' : `${(grade.weight * 100).toFixed(0)}%`;

            return `
                <tr>
                    <td>${escapeHtml(date)}</td>
                    <td>${escapeHtml(grade.categoryName || '-')}</td>
                    <td>${escapeHtml(grade.name || '-')}</td>
                    <td><span class="badge ${colorClass}">${escapeHtml(displayValue)}</span></td>
                    <td>${weightDisplay}</td>
                </tr>`;
        }).join('');
    };

    const renderCategoryBreakdown = (grades) => {
        const section = document.getElementById('student-category-section');
        const container = document.getElementById('student-category-breakdown');
        section.classList.remove('hidden');

        const byCategory = {};
        grades.forEach(g => {
            if (!byCategory[g.categoryId]) {
                byCategory[g.categoryId] = { name: g.categoryName, weight: g.weight, grades: [] };
            }
            byCategory[g.categoryId].grades.push(g);
        });

        if (Object.keys(byCategory).length === 0) {
            container.innerHTML = `<p class="text-gray-400 text-sm">${t("studentView.noGrades")}</p>`;
            return;
        }

        container.innerHTML = Object.entries(byCategory).map(([_, cat]) => {
            const numeric = cat.grades.filter(g => !g.isPlusMinus);
            const pm = cat.grades.filter(g => g.isPlusMinus);

            let avgText = '-';
            let info = '';

            if (numeric.length > 0) {
                avgText = (numeric.reduce((s, g) => s + g.value, 0) / numeric.length).toFixed(2);
                info = t("studentView.gradeCount", { count: numeric.length });
            }

            if (pm.length > 0) {
                const plus = pm.filter(g => g.value === '+').length;
                const neutral = pm.filter(g => g.value === '~').length;
                const minus = pm.filter(g => g.value === '-').length;
                if (info) info += ', ';
                info += `${plus}+ / ${neutral}~ / ${minus}-`;
            }

            return `
                <div class="category-stat-card p-3 rounded-lg border">
                    <div class="flex justify-between items-start mb-2">
                        <span class="font-medium">${escapeHtml(cat.name)}</span>
                        <span class="badge badge-secondary text-xs">${(cat.weight * 100).toFixed(0)}%</span>
                    </div>
                    <p class="text-2xl font-bold">${avgText}</p>
                    <p class="text-gray-400 text-sm">${info}</p>
                </div>`;
        }).join('');
    };

    const renderChart = (grades) => {
        const section = document.getElementById('student-chart-section');
        section.classList.remove('hidden');

        const ctx = document.getElementById('student-chart').getContext('2d');

        if (chartInstance) {
            chartInstance.destroy();
        }

        const byCategory = {};
        const colors = [
            { bg: 'rgba(59, 130, 246, 0.2)', border: 'rgb(59, 130, 246)' },
            { bg: 'rgba(34, 197, 94, 0.2)', border: 'rgb(34, 197, 94)' },
            { bg: 'rgba(249, 115, 22, 0.2)', border: 'rgb(249, 115, 22)' },
            { bg: 'rgba(168, 85, 247, 0.2)', border: 'rgb(168, 85, 247)' },
            { bg: 'rgba(236, 72, 153, 0.2)', border: 'rgb(236, 72, 153)' },
            { bg: 'rgba(234, 179, 8, 0.2)', border: 'rgb(234, 179, 8)' },
        ];

        const numeric = grades.filter(g => !g.isPlusMinus);
        numeric.forEach(g => {
            const cat = g.categoryName || t("chart.unknown");
            if (!byCategory[cat]) byCategory[cat] = [];
            byCategory[cat].push({ x: g.createdAt || Date.now(), y: g.value, name: g.name || '' });
        });

        Object.values(byCategory).forEach(arr => arr.sort((a, b) => a.x - b.x));

        const datasets = Object.entries(byCategory).map(([name, data], i) => ({
            label: name,
            data,
            borderColor: colors[i % colors.length].border,
            backgroundColor: colors[i % colors.length].bg,
            borderWidth: 2,
            tension: 0.3,
            pointRadius: 5,
            pointHoverRadius: 7,
            fill: false
        }));

        if (datasets.length === 0) {
            ctx.font = '16px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = '#6b7280';
            ctx.fillText(t("studentView.noGradesYet"), ctx.canvas.width / 2, ctx.canvas.height / 2);
            return;
        }

        chartInstance = new Chart(ctx, {
            type: 'line',
            data: { datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        type: 'time',
                        time: { unit: 'day', displayFormats: { day: 'dd.MM.yy' } },
                        title: { display: true, text: t("chart.date") }
                    },
                    y: {
                        reverse: true,
                        min: 1,
                        max: 5,
                        title: { display: true, text: t("chart.grade") },
                        ticks: { stepSize: 1 }
                    }
                },
                plugins: {
                    legend: { position: 'top' },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const p = ctx.raw;
                                let label = `${ctx.dataset.label}: ${p.y}`;
                                if (p.name) label += ` (${p.name})`;
                                return label;
                            }
                        }
                    }
                }
            }
        });
    };
})();
