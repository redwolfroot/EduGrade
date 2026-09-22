/**
 * PDF Export Module for EduGrade
 * Exports student detail view as PDF using jsPDF
 */

/**
 * Export student detail view as PDF
 * @param {string} studentId - ID of the student to export
 */
const exportStudentDetailPDF = async (studentId) => {
    const currentClass = getCurrentClass();
    if (!currentClass) {
        showAlertDialog(t("pdf.noClassSelected"));
        return;
    }

    const currentYear = getCurrentYear();
    if (!currentYear) {
        showAlertDialog(t("pdf.noYearSelected"));
        return;
    }

    const student = currentYear.students.find(s => s.id === studentId);
    if (!student) {
        showAlertDialog(t("pdf.studentNotFound"));
        return;
    }

    // Get current subject
    const currentSubject = currentYear.subjects?.find(s => s.id === currentYear.currentSubjectId);
    const subjectName = currentSubject ? currentSubject.name : t("common.allSubjects");

    // Show loading overlay
    const loadingOverlay = document.createElement('div');
    loadingOverlay.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
    loadingOverlay.innerHTML = `
        <div class="bg-white rounded-lg p-6 max-w-sm">
            <div class="flex items-center gap-3">
                <div class="avo-spinner" style="--avo-spinner-size:32px" aria-hidden="true"></div>
                <div>
                    <p class="font-semibold">${escapeHtml(t("pdf.generating"))}</p>
                    <p class="text-sm text-gray-600">${escapeHtml(t("pdf.pleaseWait"))}</p>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(loadingOverlay);

    try {
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p', 'mm', 'a4');

        // PDF dimensions
        const pageWidth = 210; // A4 width in mm
        const pageHeight = 297; // A4 height in mm
        const margin = 15;
        let yPosition = margin;

        // Helper function to check if we need a new page
        const checkNewPage = (requiredSpace) => {
            if (yPosition + requiredSpace > pageHeight - margin) {
                pdf.addPage();
                yPosition = margin;
                return true;
            }
            return false;
        };

        // 1. Header - Student Name
        pdf.setFontSize(20);
        pdf.setFont('helvetica', 'bold');
        const studentName = getStudentDisplayName(student);
        pdf.text(studentName, margin, yPosition);
        yPosition += 8;

        // Metadata
        pdf.setFontSize(9);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(100, 100, 100);
        pdf.text(`${t("common.class")}: ${currentClass.name}`, margin, yPosition);
        yPosition += 5;
        pdf.text(`${t("common.subject")}: ${subjectName}`, margin, yPosition);
        yPosition += 5;

        // Add teacher name if available
        const teacherName = appData.teacherName || '';
        if (teacherName) {
            pdf.text(`${t("pdf.teacher")}: ${teacherName}`, margin, yPosition);
            yPosition += 5;
        }

        pdf.text(`${t("pdf.generatedOn")}: ${new Date().toLocaleDateString()}`, margin, yPosition);
        yPosition += 12;
        pdf.setTextColor(0, 0, 0);

        // 2. Statistics Section
        const filteredGrades = filterGradesBySubject(student.grades, currentYear.currentSubjectId);
        const weightedAvg = calculateWeightedAverage(filteredGrades);
        const finalGrade = calculateFinalGrade(weightedAvg);
        const trend = calculateTrend(filteredGrades);
        const classAvg = calculateClassAverage();
        const gradePercentage = weightedAvg ? ((6 - weightedAvg) / 5) * 100 : null;

        checkNewPage(40);

        pdf.setFontSize(14);
        pdf.setFont('helvetica', 'bold');
        pdf.text(t("student.statistics"), margin, yPosition);
        yPosition += 8;

        // Statistics grid (2 columns)
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'normal');

        const stats = [
            {
                label: t("student.average"),
                value: weightedAvg ? `${weightedAvg.toFixed(2)} (${gradePercentage.toFixed(0)}%)` : "-"
            },
            {
                label: t("student.finalGrade"),
                value: finalGrade
            },
            {
                label: t("student.trend"),
                value: t(`student.${trend.trend}`)
            },
            {
                label: t("student.gradeCount"),
                value: filteredGrades.length.toString()
            },
            {
                label: t("student.vsClassAverage"),
                value: classAvg && weightedAvg ? `${(weightedAvg - classAvg).toFixed(2)}` : "-"
            }
        ];

        stats.forEach((stat, idx) => {
            const col = idx % 2;
            const row = Math.floor(idx / 2);
            const xPos = margin + (col * 95);
            const yPos = yPosition + (row * 10);

            pdf.setFont('helvetica', 'bold');
            pdf.text(stat.label + ":", xPos, yPos);
            pdf.setFont('helvetica', 'normal');
            pdf.text(stat.value, xPos + 40, yPos);
        });

        yPosition += Math.ceil(stats.length / 2) * 10 + 5;

        // 3. Chart - Capture Chart.js canvas
        const canvas = document.getElementById("student-grade-chart");
        console.log("PDF Export - Canvas exists:", !!canvas);
        console.log("PDF Export - Chart instance exists:", !!window.studentGradeChartInstance);
        console.log("PDF Export - Filtered grades count:", filteredGrades.length);

        if (canvas && window.studentGradeChartInstance) {
            checkNewPage(120); // Mehr Platz reservieren

            pdf.setFontSize(14);
            pdf.setFont('helvetica', 'bold');
            pdf.text(t("student.gradeProgression"), margin, yPosition);
            yPosition += 8;

            try {
                // Warte, damit das Chart vollständig gerendert ist
                await new Promise(resolve => setTimeout(resolve, 100));

                const chartImage = canvas.toDataURL('image/png', 1.0);
                const chartWidth = pageWidth - (margin * 2);

                // Berechne Höhe basierend auf Canvas-Verhältnis
                const canvasRatio = canvas.height / canvas.width;
                const chartHeight = chartWidth * canvasRatio;

                pdf.addImage(chartImage, 'PNG', margin, yPosition, chartWidth, chartHeight);
                yPosition += chartHeight + 10;
                console.log("PDF Export - Chart added successfully");
            } catch (error) {
                console.error("PDF Export - Error capturing chart:", error);
            }
        } else {
            console.log("PDF Export - Chart skipped (canvas or instance missing)");
        }

        // 4. Category Breakdown
        if (filteredGrades.length > 0) {
            checkNewPage(50);

            pdf.setFontSize(14);
            pdf.setFont('helvetica', 'bold');
            pdf.text(t("student.categoryBreakdown"), margin, yPosition);
            yPosition += 8;

            // Group grades by category
            const gradesByCategory = {};
            filteredGrades.forEach(grade => {
                const catId = grade.categoryId;
                if (!gradesByCategory[catId]) {
                    gradesByCategory[catId] = {
                        name: grade.categoryName,
                        weight: grade.weight,
                        grades: []
                    };
                }
                gradesByCategory[catId].grades.push(grade);
            });

            pdf.setFontSize(10);
            Object.entries(gradesByCategory).forEach(([catId, category]) => {
                checkNewPage(8);

                const numericGrades = category.grades.filter(g => !g.isPlusMinus);
                const avg = numericGrades.length > 0
                    ? (numericGrades.reduce((sum, g) => sum + g.value, 0) / numericGrades.length).toFixed(2)
                    : '-';

                const percentage = avg !== '-' ? `(${(((6 - parseFloat(avg)) / 5) * 100).toFixed(0)}%)` : '';

                pdf.setFont('helvetica', 'bold');
                pdf.text(category.name, margin, yPosition);
                pdf.setFont('helvetica', 'normal');
                pdf.text(`${avg} ${percentage}`, margin + 70, yPosition);
                pdf.text(`${(category.weight * 100).toFixed(0)}% ${t("common.weight")}`, margin + 120, yPosition);
                pdf.text(`${category.grades.length} ${t("student.grades")}`, margin + 160, yPosition);

                yPosition += 6;
            });

            yPosition += 8;
        }

        // 5. Grades Table
        if (filteredGrades.length > 0) {
            checkNewPage(40);

            pdf.setFontSize(14);
            pdf.setFont('helvetica', 'bold');
            pdf.text(t("student.gradesHistory"), margin, yPosition);
            yPosition += 8;

            const sortedGrades = [...filteredGrades].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

            // Table headers
            pdf.setFontSize(9);
            pdf.setFont('helvetica', 'bold');
            pdf.setFillColor(240, 240, 240);
            pdf.rect(margin, yPosition - 4, pageWidth - (margin * 2), 6, 'F');

            const colWidths = [35, 50, 25, 70];
            const colPositions = [margin, margin + colWidths[0], margin + colWidths[0] + colWidths[1], margin + colWidths[0] + colWidths[1] + colWidths[2]];
            const headers = [t("grade.date"), t("grade.category"), t("grade.value"), t("grade.name")];

            headers.forEach((header, i) => {
                pdf.text(header, colPositions[i] + 2, yPosition);
            });
            yPosition += 7;

            // Table rows
            pdf.setFont('helvetica', 'normal');
            sortedGrades.forEach((grade, idx) => {
                checkNewPage(10);

                // Alternating row colors
                if (idx % 2 === 0) {
                    pdf.setFillColor(250, 250, 250);
                    pdf.rect(margin, yPosition - 4, pageWidth - (margin * 2), 6, 'F');
                }

                const date = grade.createdAt ? new Date(grade.createdAt).toLocaleDateString() : '-';
                const gradeValue = grade.isPlusMinus ? grade.value : formatGradeDisplay(grade.value);
                const gradeName = grade.name || '-';

                // Set text color to gray if excluded from average
                if (grade.excludeFromAverage) {
                    pdf.setTextColor(150, 150, 150);
                }

                const dateX = colPositions[0] + 2;
                const categoryX = colPositions[1] + 2;
                const gradeValueX = colPositions[2] + 2;
                const gradeNameX = colPositions[3] + 2;

                pdf.text(date, dateX, yPosition);
                pdf.text(grade.categoryName || '-', categoryX, yPosition);
                pdf.text(gradeValue, gradeValueX, yPosition);

                // Truncate long grade names
                const maxWidth = colWidths[3] - 4;
                const truncatedName = gradeName.length > 30 ? gradeName.substring(0, 27) + '...' : gradeName;
                pdf.text(truncatedName, gradeNameX, yPosition);

                // Add strikethrough if excluded from average
                if (grade.excludeFromAverage) {
                    const dateWidth = pdf.getTextWidth(date);
                    const categoryWidth = pdf.getTextWidth(grade.categoryName || '-');
                    const gradeValueWidth = pdf.getTextWidth(gradeValue);
                    const gradeNameWidth = pdf.getTextWidth(truncatedName);

                    pdf.setDrawColor(150, 150, 150);
                    pdf.setLineWidth(0.2);

                    // Strikethrough for each column
                    pdf.line(dateX, yPosition - 1.5, dateX + dateWidth, yPosition - 1.5);
                    pdf.line(categoryX, yPosition - 1.5, categoryX + categoryWidth, yPosition - 1.5);
                    pdf.line(gradeValueX, yPosition - 1.5, gradeValueX + gradeValueWidth, yPosition - 1.5);
                    pdf.line(gradeNameX, yPosition - 1.5, gradeNameX + gradeNameWidth, yPosition - 1.5);

                    // Reset color
                    pdf.setTextColor(0, 0, 0);
                    pdf.setDrawColor(0, 0, 0);
                }

                yPosition += 6;
            });
        }

        // 6. Attendance Section
        const attendanceStats = calculateAttendanceStats(studentId, currentYear.currentSubjectId || null);
        if (attendanceStats && attendanceStats.total > 0) {
            checkNewPage(40);

            pdf.setFontSize(14);
            pdf.setFont('helvetica', 'bold');
            pdf.text(t("attendance.title"), margin, yPosition);
            yPosition += 8;

            // Attendance stats row
            pdf.setFontSize(10);
            pdf.setFont('helvetica', 'normal');

            const attendanceStatItems = [
                { label: t("attendance.total"), value: attendanceStats.total.toString() },
                { label: t("attendance.present"), value: attendanceStats.present.toString() },
                { label: t("attendance.late"), value: attendanceStats.late.toString() },
                { label: t("attendance.absent"), value: attendanceStats.absent.toString() },
                { label: t("attendance.rate"), value: `${attendanceStats.presentRate}%` }
            ];

            attendanceStatItems.forEach((item, idx) => {
                const col = idx % 2;
                const row = Math.floor(idx / 2);
                const xPos = margin + (col * 95);
                const yPos = yPosition + (row * 8);
                pdf.setFont('helvetica', 'bold');
                pdf.text(item.label + ":", xPos, yPos);
                pdf.setFont('helvetica', 'normal');
                pdf.text(item.value, xPos + 45, yPos);
            });

            yPosition += Math.ceil(attendanceStatItems.length / 2) * 8 + 8;

            // Attendance entries table
            const participation = student.participation || [];
            if (participation.length > 0) {
                checkNewPage(30);

                pdf.setFontSize(9);
                pdf.setFont('helvetica', 'bold');
                pdf.setFillColor(240, 240, 240);
                pdf.rect(margin, yPosition - 4, pageWidth - (margin * 2), 6, 'F');

                const attColWidths = [35, 50, 30, 65];
                const attColPositions = [
                    margin,
                    margin + attColWidths[0],
                    margin + attColWidths[0] + attColWidths[1],
                    margin + attColWidths[0] + attColWidths[1] + attColWidths[2]
                ];
                const attHeaders = [t("attendance.date"), t("attendance.subject"), "Status", t("attendance.notes")];
                attHeaders.forEach((header, i) => {
                    pdf.text(header, attColPositions[i] + 2, yPosition);
                });
                yPosition += 7;

                const subjects = currentYear.subjects || [];
                const sortedParticipation = [...participation].sort((a, b) => new Date(b.date) - new Date(a.date));

                pdf.setFont('helvetica', 'normal');
                sortedParticipation.forEach((entry, idx) => {
                    checkNewPage(8);

                    if (idx % 2 === 0) {
                        pdf.setFillColor(250, 250, 250);
                        pdf.rect(margin, yPosition - 4, pageWidth - (margin * 2), 6, 'F');
                    }

                    const entryDate = new Date(entry.date).toLocaleDateString();
                    const subjectObj = subjects.find(s => s.id === entry.subjectId);
                    const subjectLabel = subjectObj ? subjectObj.name : '—';
                    const statusLabel = entry.status === 'present'
                        ? t("attendance.present")
                        : entry.status === 'late'
                            ? t("attendance.late")
                            : t("attendance.absent");
                    const notes = entry.notes || '—';
                    const truncatedNotes = notes.length > 28 ? notes.substring(0, 25) + '...' : notes;

                    pdf.text(entryDate, attColPositions[0] + 2, yPosition);
                    pdf.text(subjectLabel.length > 18 ? subjectLabel.substring(0, 15) + '...' : subjectLabel, attColPositions[1] + 2, yPosition);
                    pdf.text(statusLabel, attColPositions[2] + 2, yPosition);
                    pdf.text(truncatedNotes, attColPositions[3] + 2, yPosition);

                    yPosition += 6;
                });
            }
        }

        // Save PDF
        const sanitizedStudentName = studentName.replace(/[^a-zA-Z0-9]/g, '_');
        const sanitizedSubjectName = subjectName.replace(/[^a-zA-Z0-9]/g, '_');
        const filename = `${sanitizedStudentName}_${sanitizedSubjectName}_${new Date().toISOString().slice(0, 10)}.pdf`;
        pdf.save(filename);

        showToast(t("toast.pdfExported"), "success");
    } catch (error) {
        console.error("PDF export error:", error);
        showAlertDialog(t("pdf.exportError"));
    } finally {
        // Remove loading overlay
        loadingOverlay.remove();
    }
};
