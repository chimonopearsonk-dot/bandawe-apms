import { AppState } from '../core/state.js';
import { SUBJECT_BY_CODE } from '../core/config.js';
import { LearnerService } from './learner.service.js';
import { MarksService } from './marks.service.js';
import { AnalyticsService } from './analytics.service.js';
import { loadVendor } from '../core/vendor-loader.js';

/**
 * Excel export service — uses ExcelJS (loaded via CDN) for styled .xlsx output.
 *
 * Layout:
 *   - Centered merged header block (exam title, school, zone+class, year+term)
 *   - Bold, shaded, bordered table header row
 *   - Compact bordered data rows
 *   - Shaded summary block: sex-split counts (or grade distribution for Std 8 Mock)
 *
 * Deploy-safe: ExcelJS is loaded from jsDelivr; nothing else needs a build step.
 */

const COLORS = {
  navy: 'FF081C2E',
  gold: 'FFF59E0B',
  lightGray: 'FFF1F5F9',
  border: 'FFCBD5E1',
  white: 'FFFFFFFF',
};

const THIN_BORDER = {
  top:    { style: 'thin', color: { argb: COLORS.border } },
  left:   { style: 'thin', color: { argb: COLORS.border } },
  bottom: { style: 'thin', color: { argb: COLORS.border } },
  right:  { style: 'thin', color: { argb: COLORS.border } },
};

export const ExportService = {

  /* ---------- Broadsheet: single class ---------- */
  async exportBroadsheet(session, className, type) {
    const ExcelJS = await loadVendor('vendor/exceljs.min.js', 'ExcelJS');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Bandawe Zone APMS';
    wb.created = new Date();

    const ws = wb.addWorksheet(this._safeSheetName(className), {
      views: [{ state: 'frozen', xSplit: 3, ySplit: 6 }],
      properties: { defaultRowHeight: 16 },
    });

    this._buildBroadsheet(ws, session, className, type);

    const buf = await wb.xlsx.writeBuffer();
    this._download(buf, this._filename(`Broadsheet_${type}_${className}`));
  },

  /* ---------- Broadsheet: whole school (one sheet per class) ---------- */
  async exportSchoolBroadsheet(session, type) {
    const classes = [...new Set(
      LearnerService.listBySchool(session.emis).map(l => l.class)
    )].sort();
    if (!classes.length) throw new Error('No classes found.');
    const ExcelJS = await loadVendor('vendor/exceljs.min.js', 'ExcelJS');

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Bandawe Zone APMS';
    wb.created = new Date();

    let added = 0;
    classes.forEach(cls => {
      const schema = MarksService.schemaForClass(cls);
      if (!schema) return;
      const ws = wb.addWorksheet(this._safeSheetName(cls), {
        views: [{ state: 'frozen', xSplit: 3, ySplit: 6 }],
        properties: { defaultRowHeight: 16 },
      });
      this._buildBroadsheet(ws, session, cls, type);
      added++;
    });

    if (!added) throw new Error('No valid classes to export.');

    const buf = await wb.xlsx.writeBuffer();
    this._download(buf, this._filename(`Broadsheet_${type}_WholeSchool`));
  },

  /* ---------- Core builder ---------- */
  _buildBroadsheet(ws, session, className, type) {
    const schema = MarksService.schemaForClass(className);
    if (!schema) throw new Error(`No schema for ${className}`);

    const learners = LearnerService.listBySchool(session.emis, className);
    const ranked = MarksService.rankClass(type, learners, className);
    const sum = AnalyticsService.classSummary(type, session.emis, className);
    const isMockStd8 = type === 'mock' && className === 'Standard 8';
    const showGradeInCell = isMockStd8;

    const examLabel = type === 'exam' ? 'END OF TERM STANDARDIZED EXAMINATION'
                    : type === 'mock' ? 'MANEB MOCK EXAMINATION'
                    : 'CONTINUOUS ASSESSMENT';

    // Number of columns
    const subjectCols = schema.subjects.length;
    const totalCols = 3 /* Pos, LIN, Name */ + subjectCols + 5 /* Total, Max, Avg%, Grade, Status */;

    // ---------- Column widths ----------
    ws.columns = [
      { width: 6 },   // Pos
      { width: 12 },  // LIN
      { width: 26 },  // Name
      ...schema.subjects.map(() => ({ width: 10 })),
      { width: 10 },  // Total
      { width: 8 },   // Max
      { width: 8 },   // Avg %
      { width: 8 },   // Grade
      { width: 10 },  // Status
    ];

    // ---------- Header block ----------
    const headers = [
      examLabel,
      session.name,
      `${session.zone || 'Bandawe'} Zone  ·  ${className}`,
      `Academic Year ${AppState.academicConfig.year}  ·  ${AppState.academicConfig.term}`,
    ];

    headers.forEach((txt, i) => {
      const row = ws.addRow([txt]);
      row.height = 22;
      ws.mergeCells(row.number, 1, row.number, totalCols);
      const cell = row.getCell(1);
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.font = {
        bold: true,
        size: i === 0 ? 14 : i === 1 ? 13 : 11,
        color: { argb: i === 0 ? COLORS.navy : 'FF334155' },
      };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: i === 0 ? COLORS.gold : COLORS.lightGray },
      };
      cell.border = THIN_BORDER;
    });

    // Blank spacer row
    ws.addRow([]);

    // ---------- Table header row ----------
    const head = ['Pos', 'LIN', 'Name',
      ...schema.subjects.map(sc => SUBJECT_BY_CODE[sc].short),
      'Total', 'Max', 'Avg %', 'Grade', 'Status'];
    const headRow = ws.addRow(head);
    headRow.height = 24;
    headRow.eachCell(cell => {
      cell.font = { bold: true, size: 10, color: { argb: COLORS.white } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navy } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = THIN_BORDER;
    });

    // ---------- Data rows ----------
    ranked.forEach(rw => {
      const l = rw.learner;
      const c = rw.computed;

      const rowData = [rw.position, l.lin, l.name];
      schema.subjects.forEach((sc, i) => {
        const v = c.scores[i];
        const raw = AppState.marks[type]?.[l.lin]?.[sc];
        const blank = raw === undefined || raw === null;
        if (blank) { rowData.push(''); return; }
        if (showGradeInCell) {
          const grade = MarksService.grade((v / schema.maxPerSubject) * 100);
          rowData.push(`${v} (${grade.letter})`);
        } else {
          rowData.push(v);
        }
      });
      rowData.push(c.total, c.maxTotal, c.avgPercent, c.grade, c.status);

      const row = ws.addRow(rowData);
      row.height = 16;
      row.eachCell((cell, colNumber) => {
        cell.border = THIN_BORDER;
        cell.font = { size: 10 };
        if (colNumber === 1) cell.alignment = { horizontal: 'center' };
        else if (colNumber === 2) cell.alignment = { horizontal: 'left' };
        else if (colNumber === 3) cell.alignment = { horizontal: 'left' };
        else cell.alignment = { horizontal: 'center' };
      });

      // Emphasize Total column
      const totalCell = row.getCell(3 + subjectCols + 1);
      totalCell.font = { bold: true, size: 10, color: { argb: COLORS.navy } };

      // Status color
      const statusCell = row.getCell(3 + subjectCols + 5);
      statusCell.font = {
        bold: true, size: 10,
        color: { argb: c.status === 'Pass' ? 'FF065F46' : 'FF991B1B' },
      };
    });

    // Blank spacer row
    ws.addRow([]);

    // ---------- Summary block ----------
    if (isMockStd8) {
      this._mockSummary(ws, session, className, schema, totalCols);
    } else {
      this._standardSummary(ws, sum, totalCols);
    }
  },

  _standardSummary(ws, sum, totalCols) {
    const cs = sum.stats;

    // Section title
    const titleRow = ws.addRow(['SUMMARY']);
    ws.mergeCells(titleRow.number, 1, titleRow.number, 4);
    const tc = titleRow.getCell(1);
    tc.font = { bold: true, size: 11, color: { argb: COLORS.white } };
    tc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navy } };
    tc.alignment = { horizontal: 'center', vertical: 'middle' };
    tc.border = THIN_BORDER;
    titleRow.height = 20;

    // Header
    const headerRow = ws.addRow(['Metric', 'Female', 'Male', 'Class Total']);
    headerRow.height = 18;
    headerRow.eachCell(cell => {
      cell.font = { bold: true, size: 10, color: { argb: COLORS.navy } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.lightGray } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = THIN_BORDER;
    });

    // Rows
    const data = [
      ['Total Entered', cs.registered.F, cs.registered.M, cs.registered.total],
      ['Total Sat',     cs.sat.F,        cs.sat.M,        cs.sat.total],
      ['Total Passed',  cs.passed.F,     cs.passed.M,     cs.passed.total],
      ['Class Percentage', '', '', `${sum.classPct}%`],
    ];
    data.forEach(arr => {
      const row = ws.addRow(arr);
      row.height = 16;
      row.eachCell((cell, idx) => {
        cell.border = THIN_BORDER;
        cell.font = { size: 10, bold: idx === 4 };
        cell.alignment = idx === 1
          ? { horizontal: 'left' }
          : { horizontal: 'center' };
      });
      // Bold the label
      row.getCell(1).font = { size: 10, bold: true };
    });

    // Final row emphasis
    const lastRow = ws.lastRow;
    lastRow.getCell(4).font = { size: 11, bold: true, color: { argb: COLORS.navy } };
  },

  _mockSummary(ws, session, className, schema, totalCols) {
    const dist = AnalyticsService.gradeDistribution('mock', session.emis, className);

    // Section title
    const titleRow = ws.addRow(['GRADE DISTRIBUTION PER SUBJECT']);
    ws.mergeCells(titleRow.number, 1, titleRow.number, schema.subjects.length + 1);
    const tc = titleRow.getCell(1);
    tc.font = { bold: true, size: 11, color: { argb: COLORS.white } };
    tc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navy } };
    tc.alignment = { horizontal: 'center', vertical: 'middle' };
    tc.border = THIN_BORDER;
    titleRow.height = 20;

    // Header
    const head = ['Grade', ...schema.subjects.map(sc => SUBJECT_BY_CODE[sc].short)];
    const headerRow = ws.addRow(head);
    headerRow.height = 18;
    headerRow.eachCell(cell => {
      cell.font = { bold: true, size: 10, color: { argb: COLORS.navy } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.lightGray } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = THIN_BORDER;
    });

    // Rows A-F
    ['A','B','C','D','F'].forEach(g => {
      const row = ws.addRow([g, ...schema.subjects.map(sc => dist.dist[sc][g])]);
      row.height = 16;
      row.eachCell((cell, idx) => {
        cell.border = THIN_BORDER;
        cell.font = { size: 10, bold: idx === 1 };
        cell.alignment = { horizontal: 'center' };
      });
    });

    // Rubric row
    const rubricRow = ws.addRow(['Rubric', 'A (80–100)', 'B (70–79)', 'C (55–69)', 'D (40–54)', 'F (0–39)']);
    ws.mergeCells(rubricRow.number, 6, rubricRow.number, schema.subjects.length + 1);
    rubricRow.eachCell(cell => {
      cell.font = { size: 9, italic: true, color: { argb: 'FF64748B' } };
      cell.alignment = { horizontal: 'left' };
    });
  },

  /* ---------- Utilities ---------- */
  _safeSheetName(name) {
    return String(name).replace(/[\\\/\?\*\[\]\:]/g, '').slice(0, 31);
  },

  _filename(base) {
    const stamp = new Date().toISOString().slice(0, 10);
    return `${base}_${stamp}.xlsx`;
  },

  _download(buffer, filename) {
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 500);
  },

  async exportCaMonthly(session, className, month) {
    const ExcelJS = await loadVendor('vendor/exceljs.min.js', 'ExcelJS');
    const schema = MarksService.schemaForClass(className);
    if (!schema) throw new Error('No schema for ' + className);

    const learners = LearnerService.listBySchool(session.emis, className);
    if (!learners.length) throw new Error('No learners in ' + className);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Bandawe Zone APMS';
    const ws = wb.addWorksheet(this._safeSheetName(className + ' ' + month));

    ws.columns = [
      { width: 8 }, { width: 12 }, { width: 26 },
      ...schema.subjects.map(() => ({ width: 10 })),
      { width: 10 },
    ];

    // Header block
    const titleRow = ws.addRow([`CONTINUOUS ASSESSMENT — ${month}`]);
    ws.mergeCells(titleRow.number, 1, titleRow.number, 3 + schema.subjects.length + 1);
    titleRow.getCell(1).font = { bold: true, size: 14 };
    titleRow.getCell(1).alignment = { horizontal: 'center' };

    ws.addRow([session.name]);
    ws.addRow([`${session.zone || 'Bandawe'} Zone · ${className} · ${month}`]);
    ws.addRow([`Academic Year ${AppState.academicConfig.year} · ${AppState.academicConfig.term}`]);
    ws.addRow([]);

    // Table header
    const head = ['Pos', 'LIN', 'Name', ...schema.subjects.map(sc => SUBJECT_BY_CODE[sc].short), 'Avg'];
    const headRow = ws.addRow(head);
    headRow.eachCell(cell => {
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF081C2E' } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { horizontal: 'center' };
    });

    // Data
    learners.forEach((l, idx) => {
      const row = [idx + 1, l.lin, l.name];
      let sum = 0, count = 0;
      schema.subjects.forEach(sc => {
        const v = AppState.marks.ca?.[l.lin]?.[sc]?.[month];
        if (typeof v === 'number') { sum += v; count++; row.push(v); }
        else row.push('');
      });
      row.push(count ? +(sum / count).toFixed(1) : '');
      ws.addRow(row);
    });

    const buf = await wb.xlsx.writeBuffer();
    this._download(buf, `CA_${className}_${month}_${session.emis}.xlsx`);
  },

  async exportCaTerm(session, className, months) {
    const ExcelJS = await loadVendor('vendor/exceljs.min.js', 'ExcelJS');
    const schema = MarksService.schemaForClass(className);
    if (!schema) throw new Error('No schema for ' + className);

    const learners = LearnerService.listBySchool(session.emis, className);
    if (!learners.length) throw new Error('No learners in ' + className);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Bandawe Zone APMS';
    const ws = wb.addWorksheet(this._safeSheetName(className + ' CA Term'));

    // Columns: Pos, LIN, Name, per-subject (each subject has its months + avg)
    const cols = [{ width: 8 }, { width: 12 }, { width: 26 }];
    schema.subjects.forEach(() => {
      months.forEach(() => cols.push({ width: 9 }));
      cols.push({ width: 10 });
    });
    cols.push({ width: 10 });
    ws.columns = cols;

    // Title
    const titleRow = ws.addRow([`CONTINUOUS ASSESSMENT — FULL TERM`]);
    ws.mergeCells(titleRow.number, 1, titleRow.number, cols.length);
    titleRow.getCell(1).font = { bold: true, size: 14 };
    titleRow.getCell(1).alignment = { horizontal: 'center' };

    ws.addRow([session.name]);
    ws.addRow([`${session.zone || 'Bandawe'} Zone · ${className}`]);
    ws.addRow([`Academic Year ${AppState.academicConfig.year} · ${AppState.academicConfig.term}`]);
    ws.addRow([]);

    // Header: subject months
    const headRow1 = ['', '', ''];
    const headRow2 = ['Pos', 'LIN', 'Name'];
    schema.subjects.forEach(sc => {
      const short = SUBJECT_BY_CODE[sc].short;
      months.forEach(() => headRow1.push(short));
      headRow1.push(short + ' Avg');
      headRow2.push(...months);
      headRow2.push('Avg');
    });
    // first row: subject names spanning months
    const r1 = ws.addRow(headRow1);
    r1.eachCell(cell => {
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF081C2E' } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { horizontal: 'center' };
    });
    const r2 = ws.addRow(headRow2);
    r2.eachCell(cell => {
      cell.font = { bold: true, size: 9 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      cell.alignment = { horizontal: 'center' };
    });

    // Data
    learners.forEach((l, idx) => {
      const row = [idx + 1, l.lin, l.name];
      let termSum = 0, termCount = 0;
      schema.subjects.forEach(sc => {
        const scores = months
          .map(m => AppState.marks.ca?.[l.lin]?.[sc]?.[m])
          .filter(v => typeof v === 'number');
        months.forEach(m => {
          const v = AppState.marks.ca?.[l.lin]?.[sc]?.[m];
          row.push(typeof v === 'number' ? v : '');
          if (typeof v === 'number') { termSum += v; termCount++; }
        });
        const subjAvg = scores.length ? +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '';
        row.push(subjAvg);
      });
      row.push(termCount ? +(termSum / termCount).toFixed(1) : '');
      ws.addRow(row);
    });

    const buf = await wb.xlsx.writeBuffer();
    this._download(buf, `CA_${className}_FullTerm_${session.emis}.xlsx`);
  },
};