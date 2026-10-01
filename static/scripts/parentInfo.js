/**
 * Parent Information Module for EduGrade
 * Generates a printable data protection notice (Art. 13 GDPR) that teachers
 * or schools hand out to parents. The school is the controller, so its name
 * and data protection contact go on the sheet; avocloud.net is named as the
 * processor.
 */

// Long legal text lives here instead of the i18n files; picked by UI language.
const PARENT_INFO_TEXT = {
    de: {
        title: 'Datenschutzinformation',
        subtitle: 'für Eltern und Erziehungsberechtigte · Digitale Notenführung (Art. 13 DSGVO)',
        intro: 'Liebe Eltern und Erziehungsberechtigte,\nan unserer Schule werden Noten und Leistungsbeurteilungen digital mit der Notenverwaltung EduGrade geführt. Mit diesem Blatt informieren wir Sie, wie dabei mit den Daten Ihres Kindes umgegangen wird.',
        labels: { school: 'Schule', teacher: 'Lehrkraft', classes: 'Klasse / Fach' },
        sections: (d) => [
            ['Wer ist verantwortlich?',
                `Verantwortlich für die Verarbeitung ist ${d.school || 'die Schule'}${d.address ? `, ${d.address}` : ''}. ` +
                (d.contact
                    ? `Bei Fragen zum Datenschutz erreichen Sie uns unter: ${d.contact}.`
                    : 'Bei Fragen zum Datenschutz wenden Sie sich bitte an die Lehrkraft oder die Schulleitung.')],
            ['Wofür werden die Daten verarbeitet?',
                'Für die Leistungsfeststellung und -beurteilung, die Dokumentation von Anwesenheit und Mitarbeit sowie die Vorbereitung von Zeugnissen und Elterngesprächen.'],
            ['Welche Daten werden verarbeitet?',
                'Vor- und Nachname, Klasse und Fächer, Noten und Leistungsbeurteilungen, Anwesenheit, Mitarbeit sowie Notizen der Lehrkraft zum Lernfortschritt.'],
            ['Auf welcher Rechtsgrundlage?',
                'Die Schule ist gesetzlich verpflichtet, Leistungen festzustellen und zu dokumentieren (Schulunterrichtsgesetz, Leistungsbeurteilungsverordnung). Rechtsgrundlage ist Art. 6 Abs. 1 lit. c und e DSGVO. Eine gesonderte Einwilligung ist dafür nicht erforderlich.'],
            ['Wo werden die Daten gespeichert?',
                'EduGrade wird von avocloud.net (Fabian Murauer, 4600 Wels, Österreich) als Auftragsverarbeiter betrieben; die Verarbeitung ist durch einen Auftragsverarbeitungsvertrag nach Art. 28 DSGVO geregelt. Die Daten liegen verschlüsselt auf Servern in Deutschland (EU). Sie werden weder für Werbung noch für andere Zwecke verwendet und nicht verkauft.'],
            ['Wer erhält die Daten?',
                'Die Daten sind grundsätzlich nur für die Lehrkraft einsehbar. Schüler und Eltern können auf Wunsch der Lehrkraft über einen persönlichen Zugang (Link und PIN) ausschließlich die eigenen Noten einsehen. Nutzt die Schule EduGrade gemeinsam, sehen andere Lehrkräfte der Schule Name und Klasse, aber keine Noten. Eine Weitergabe an sonstige Dritte erfolgt nur, wenn ein Gesetz dies vorschreibt.'],
            ['Wie lange werden die Daten gespeichert?',
                'Solange sie für die Leistungsbeurteilung im jeweiligen Schuljahr und die gesetzlichen Aufbewahrungsfristen benötigt werden. Danach werden sie gelöscht.'],
            ['Ihre Rechte',
                'Sie haben das Recht auf Auskunft, Berichtigung, Löschung und Einschränkung der Verarbeitung sowie das Recht auf Widerspruch, soweit die gesetzlichen Voraussetzungen vorliegen. Wenden Sie sich dazu an die Schule. Außerdem können Sie sich bei der Österreichischen Datenschutzbehörde beschweren (Barichgasse 40–42, 1030 Wien, www.dsb.gv.at).'],
        ],
        filename: 'Datenschutzinformation_Eltern',
    },
    en: {
        title: 'Data Protection Notice',
        subtitle: 'for parents and guardians · Digital grade records (Art. 13 GDPR)',
        intro: 'Dear parents and guardians,\nat our school, grades and assessments are kept digitally using the grade management app EduGrade. This sheet explains how your child\'s data is handled.',
        labels: { school: 'School', teacher: 'Teacher', classes: 'Class / Subject' },
        sections: (d) => [
            ['Who is responsible?',
                `The controller is ${d.school || 'the school'}${d.address ? `, ${d.address}` : ''}. ` +
                (d.contact
                    ? `For data protection questions, contact: ${d.contact}.`
                    : 'For data protection questions, please contact the teacher or the school management.')],
            ['What is the data used for?',
                'To assess and record academic performance, to document attendance and participation, and to prepare reports and parent meetings.'],
            ['Which data is processed?',
                'First and last name, class and subjects, grades and assessments, attendance, participation and the teacher\'s notes on learning progress.'],
            ['On what legal basis?',
                'The school is legally required to assess and document performance (Austrian School Education Act and Performance Assessment Regulation). The legal basis is Art. 6(1)(c) and (e) GDPR. Separate consent is not required.'],
            ['Where is the data stored?',
                'EduGrade is operated by avocloud.net (Fabian Murauer, 4600 Wels, Austria) as a processor under a data processing agreement pursuant to Art. 28 GDPR. The data is stored encrypted on servers in Germany (EU). It is not used for advertising or any other purpose and is never sold.'],
            ['Who receives the data?',
                'In principle only the teacher can see the data. If the teacher chooses, students and parents can view only their own grades through a personal access (link and PIN). If the school uses EduGrade jointly, other teachers of the school see the name and class, but no grades. Data is passed on to other third parties only where required by law.'],
            ['How long is the data kept?',
                'As long as it is needed for the assessment in the respective school year and for statutory retention periods. It is deleted afterwards.'],
            ['Your rights',
                'You have the right of access, rectification, erasure and restriction of processing, and the right to object, where the legal requirements are met. Please contact the school. You can also lodge a complaint with the Austrian Data Protection Authority (Barichgasse 40–42, 1030 Vienna, www.dsb.gv.at).'],
        ],
        filename: 'Data_protection_notice_parents',
    },
};

/**
 * Opens the dialog to fill in school details and download the notice.
 */
const openParentInfoDialog = () => {
    const school = (window.currentUser && window.currentUser.school) || appData.school || '';

    const content = `
        <p class="text-sm text-gray-400">${escapeHtml(t("parentInfo.dialogHint"))}</p>
        <div class="grid gap-2">
            <label for="parent-info-school">${escapeHtml(t("parentInfo.school"))}</label>
            <input type="text" id="parent-info-school" name="school" class="input w-full" value="${safeAttr(school)}" required>
        </div>
        <div class="grid gap-2">
            <label for="parent-info-address">${escapeHtml(t("parentInfo.address"))}</label>
            <input type="text" id="parent-info-address" name="address" class="input w-full" placeholder="${safeAttr(t("parentInfo.optional"))}">
        </div>
        <div class="grid gap-2">
            <label for="parent-info-contact">${escapeHtml(t("parentInfo.contact"))}</label>
            <input type="text" id="parent-info-contact" name="contact" class="input w-full" placeholder="${safeAttr(t("parentInfo.contactPlaceholder"))}">
        </div>
        <div class="grid gap-2">
            <label for="parent-info-teacher">${escapeHtml(t("parentInfo.teacher"))}</label>
            <input type="text" id="parent-info-teacher" name="teacher" class="input w-full" value="${safeAttr(appData.teacherName || '')}" placeholder="${safeAttr(t("parentInfo.optional"))}">
        </div>
        <div class="grid gap-2">
            <label for="parent-info-classes">${escapeHtml(t("parentInfo.classes"))}</label>
            <input type="text" id="parent-info-classes" name="classes" class="input w-full" placeholder="${safeAttr(t("parentInfo.classesPlaceholder"))}">
        </div>
    `;

    showDialog("edit-dialog", t("parentInfo.title"), content, (formData) => {
        generateParentInfoPDF({
            school: (formData.get("school") || '').trim(),
            address: (formData.get("address") || '').trim(),
            contact: (formData.get("contact") || '').trim(),
            teacher: (formData.get("teacher") || '').trim(),
            classes: (formData.get("classes") || '').trim(),
        });
    });

    // The shared edit dialog says "Save"; label it for this action and
    // restore the label once the dialog closes.
    const dialog = document.getElementById("edit-dialog");
    const submitLabel = dialog.querySelector('button[type="submit"] [data-i18n="dialog.save"]');
    if (submitLabel) {
        submitLabel.textContent = t("parentInfo.cardButton");
        dialog.addEventListener('close', () => { submitLabel.textContent = t("dialog.save"); }, { once: true });
    }
};
window.openParentInfoDialog = openParentInfoDialog;

/**
 * Builds and downloads the parent information PDF.
 * @param {{school: string, address: string, contact: string, teacher: string, classes: string}} data
 */
const generateParentInfoPDF = (data) => {
    try {
        const lang = (typeof I18n !== 'undefined' && I18n.getCurrentLanguage() === 'en') ? 'en' : 'de';
        const text = PARENT_INFO_TEXT[lang];
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p', 'mm', 'a4');

        const pageHeight = 297;
        const margin = 20;
        const contentWidth = 210 - margin * 2;
        let y = margin + 2;

        const ensureSpace = (needed) => {
            if (y + needed > pageHeight - 18) {
                pdf.addPage();
                y = margin;
            }
        };

        const paragraph = (str, size = 10) => {
            pdf.setFontSize(size);
            pdf.setFont('helvetica', 'normal');
            pdf.setTextColor(30, 30, 30);
            pdf.splitTextToSize(str, contentWidth).forEach(line => {
                ensureSpace(5);
                pdf.text(line, margin, y);
                y += size * 0.48;
            });
        };

        // School name (letterhead)
        if (data.school) {
            pdf.setFontSize(11);
            pdf.setFont('helvetica', 'bold');
            pdf.setTextColor(80, 80, 80);
            pdf.splitTextToSize(data.school, contentWidth).forEach(line => {
                pdf.text(line, margin, y);
                y += 5;
            });
            y += 5;
        }

        // Title
        pdf.setFontSize(18);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(0, 0, 0);
        pdf.text(text.title, margin, y);
        y += 6.5;
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(100, 100, 100);
        pdf.splitTextToSize(text.subtitle, contentWidth).forEach(line => {
            pdf.text(line, margin, y);
            y += 4.8;
        });
        y += 4;

        // Info box: school / teacher / classes
        const rows = [
            [text.labels.school, data.school],
            [text.labels.teacher, data.teacher],
            [text.labels.classes, data.classes],
        ].filter(([, value]) => value);
        if (rows.length) {
            const rowHeight = 6.5;
            const boxHeight = rows.length * rowHeight + 5;
            pdf.setFillColor(245, 245, 247);
            pdf.setDrawColor(225, 225, 230);
            pdf.roundedRect(margin, y, contentWidth, boxHeight, 2, 2, 'FD');
            let rowY = y + 7;
            rows.forEach(([label, value]) => {
                pdf.setFontSize(9.5);
                pdf.setFont('helvetica', 'bold');
                pdf.setTextColor(90, 90, 90);
                pdf.text(`${label}:`, margin + 5, rowY);
                pdf.setFont('helvetica', 'normal');
                pdf.setTextColor(20, 20, 20);
                pdf.text(pdf.splitTextToSize(value, contentWidth - 45)[0], margin + 40, rowY);
                rowY += rowHeight;
            });
            y += boxHeight + 8;
        }

        paragraph(text.intro);
        y += 3;

        text.sections(data).forEach(([heading, body]) => {
            ensureSpace(14);
            y += 2;
            pdf.setFontSize(11);
            pdf.setFont('helvetica', 'bold');
            pdf.setTextColor(0, 0, 0);
            pdf.text(heading, margin, y);
            y += 5.5;
            paragraph(body);
            y += 1.5;
        });

        addPdfBrandingFooter(pdf, margin);
        pdf.save(`${text.filename}.pdf`);
        showToast(t("toast.pdfExported"), "success");
    } catch (error) {
        console.error("Parent info export error:", error);
        showAlertDialog(t("pdf.exportError"));
    }
};
