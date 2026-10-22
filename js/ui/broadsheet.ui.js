import { AppState } from '../core/state.js';
import { CLASSES, SUBJECT_BY_CODE } from '../core/config.js';
import { LearnerService } from '../services/learner.service.js';
import { MarksService } from '../services/marks.service.js';
import { AnalyticsService } from '../services/analytics.service.js';
import { escapeHtml } from './helpers.js';
import { Toast } from './toast.js';

export const BroadsheetUI = {

  currentType: 'exam',

  init() {
    document.querySelectorAll('.broadsheet-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.currentType = btn.dataset.type;
        this._sync();
        this.render();
      });
    });
    document.getElementById('broadsheetClassSelect')?.addEventListener('change', () => this.render());
    document.getElementById('btnExportBroadsheet')?.addEventListener('click', () => this._exportExcel());
  },

  _sync() {
    document.querySelectorAll('.broadsheet-type-btn').forEach(btn => {
      const active = btn.dataset.type === this.currentType;
      btn.className = active
        ? 'broadsheet-type-btn px-3 py-1.5 rounded-md bg-navy-800 text-white text-xs font-bold'
        : 'broadsheet-type-btn px-3 py-1.5 rounded-md text-slate-600 hover:bg-slate-200 text-xs font-semibold';
    });
  },

  render() {
    const session = AppState.currentSession;
    if (!session) return;
    this._sync();

    const sel = document.getElementById('broadsheetClassSelect');
    if (sel && sel.options.length <= 1) {
      sel.innerHTML = '<option value="">-- Select Class --</option>' +
        CLASSES.map(c => `<option value="${c}">${c}</option>`).join('');
    }
    const cls = sel?.value;
    if (!cls) return this._placeholder();

    const type = this.currentType;
    const schema = MarksService.schemaForClass(cls);
    if (!schema) return this._placeholder(`No schema for ${cls}.`);

    const learners = LearnerService.listBySchool(session.emis, cls);
    const ranked = MarksService.rankClass(type, learners, cls);
    const sum = AnalyticsService.classSummary(type, session.emis, cls);

    const isMockStd8 = type === 'mock' && cls === 'Standard 8';
    const showGradeInCell = isMockStd8;

    const examLabel = type === 'exam' ? 'End of Term Standardized Exam'
                    : type === 'mock' ? 'MANEB Mock Examination'
                    : 'Continuous Assessment';

    const header = `
      <div class="text-center border-b-2 border-navy-800 pb-3 mb-4">
        <h3 class="text-lg font-black uppercase text-navy-900">${escapeHtml(examLabel)}</h3>
        <p class="text-sm font-bold text-navy-800 mt-1">${escapeHtml(session.name)}</p>
        <p class="text-xs text-slate-600">${escapeHtml(session.zone || 'Bandawe')} Zone · ${escapeHtml(cls)}</p>
        <p class="text-xs text-slate-600 font-mono">Academic Year ${escapeHtml(AppState.academicConfig.year)} · ${escapeHtml(AppState.academicConfig.term)}</p>
      </div>`;

    const headCells = schema.subjects.map(sc => {
      const s = SUBJECT_BY_CODE[sc];
      return `<th class="border border-slate-300 py-1.5 px-2 text-center text-[10px] uppercase">${escapeHtml(s.short)}</th>`;
    }).join('');

    const rows = ranked.map(r => {
      const l = r.learner;
      const c = r.computed;
      const subjectCells = schema.subjects.map((sc, i) => {
        const v = c.scores[i];
        const raw = AppState.marks[type]?.[l.lin]?.[sc];
        const blank = raw === undefined || raw === null;
        let txt = blank ? '' : v;
        if (showGradeInCell && !blank) {
          const grade = MarksService.grade((v / schema.maxPerSubject) * 100);
          txt = `${v} (${grade.letter})`;
        }
        return `<td class="border border-slate-300 py-1 px-2 text-center font-mono">${txt}</td>`;
      }).join('');

      return `<tr>
        <td class="border border-slate-300 py-1 px-2 text-center font-bold">${r.position}</td>
        <td class="border border-slate-300 py-1 px-2 font-mono text-[11px]">${escapeHtml(l.lin)}</td>
        <td class="border border-slate-300 py-1 px-2 font-semibold text-[11px]">${escapeHtml(l.name)}</td>
        ${subjectCells}
        <td class="border border-slate-300 py-1 px-2 text-center font-bold text-navy-900">${c.total}/${c.maxTotal}</td>
        <td class="border border-slate-300 py-1 px-2 text-center font-mono">${c.avgPercent}%</td>
        <td class="border border-slate-300 py-1 px-2 text-center font-bold">${c.grade}</td>
        <td class="border border-slate-300 py-1 px-2 text-center font-semibold ${c.status === 'Pass' ? 'text-emerald-700' : 'text-red-600'}">${c.status}</td>
      </tr>`;
    }).join('');

    const summary = isMockStd8
      ? this._mockSummary(session.emis, cls)
      : this._standardSummary(sum);

    const wrap = document.getElementById('broadsheetBody');
    wrap.innerHTML = `
      <div id="broadsheetPrintContainer" class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        ${header}
        <div class="overflow-x-auto">
          <table class="w-full text-[11px] border-collapse">
            <thead class="bg-slate-100 text-slate-800 font-bold">
              <tr>
                <th class="border border-slate-300 py-1.5 px-2">Pos</th>
                <th class="border border-slate-300 py-1.5 px-2">LIN</th>
                <th class="border border-slate-300 py-1.5 px-2">Name</th>
                ${headCells}
                <th class="border border-slate-300 py-1.5 px-2 text-center">Total</th>
                <th class="border border-slate-300 py-1.5 px-2 text-center">Avg%</th>
                <th class="border border-slate-300 py-1.5 px-2 text-center">Grade</th>
                <th class="border border-slate-300 py-1.5 px-2 text-center">Status</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        ${summary}
      </div>`;
  },

  _standardSummary(sum) {
    const cs = sum.stats;
    return `
      <div class="mt-6">
        <h4 class="font-bold text-navy-800 text-xs uppercase mb-2">Summary</h4>
        <table class="w-full max-w-2xl text-xs border-collapse">
          <thead class="bg-slate-100 font-bold">
            <tr>
              <th class="border border-slate-300 py-1.5 px-3 text-left">Metric</th>
              <th class="border border-slate-300 py-1.5 px-3 text-center">Female</th>
              <th class="border border-slate-300 py-1.5 px-3 text-center">Male</th>
              <th class="border border-slate-300 py-1.5 px-3 text-center">Class Total</th>
            </tr>
          </thead>
          <tbody>
            <tr><td class="border border-slate-300 py-1 px-3 font-semibold">Total Entered</td><td class="border border-slate-300 py-1 px-3 text-center">${cs.registered.F}</td><td class="border border-slate-300 py-1 px-3 text-center">${cs.registered.M}</td><td class="border border-slate-300 py-1 px-3 text-center font-bold">${cs.registered.total}</td></tr>
            <tr><td class="border border-slate-300 py-1 px-3 font-semibold">Total Sat</td><td class="border border-slate-300 py-1 px-3 text-center">${cs.sat.F}</td><td class="border border-slate-300 py-1 px-3 text-center">${cs.sat.M}</td><td class="border border-slate-300 py-1 px-3 text-center font-bold">${cs.sat.total}</td></tr>
            <tr><td class="border border-slate-300 py-1 px-3 font-semibold">Total Passed</td><td class="border border-slate-300 py-1 px-3 text-center">${cs.passed.F}</td><td class="border border-slate-300 py-1 px-3 text-center">${cs.passed.M}</td><td class="border border-slate-300 py-1 px-3 text-center font-bold">${cs.passed.total}</td></tr>
            <tr><td class="border border-slate-300 py-1 px-3 font-bold text-navy-800" colspan="3">Class Percentage</td><td class="border border-slate-300 py-1 px-3 text-center font-black text-navy-800">${sum.classPct}%</td></tr>
          </tbody>
        </table>
      </div>`;
  },

  _mockSummary(emis, cls) {
    const data = AnalyticsService.gradeDistribution('mock', emis, cls);
    if (!data) return '';
    const head = data.schema.subjects.map(sc => 
      `<th class="border border-slate-300 py-1.5 px-2 text-center">${escapeHtml(SUBJECT_BY_CODE[sc].short)}</th>`
    ).join('');
    const rows = ['A','B','C','D','F'].map(g =>
      `<tr>
        <td class="border border-slate-300 py-1 px-3 font-bold">${g}</td>
        ${data.schema.subjects.map(sc => `<td class="border border-slate-300 py-1 px-2 text-center font-mono">${data.dist[sc][g]}</td>`).join('')}
      </tr>`
    ).join('');

    return `
      <div class="mt-6">
        <h4 class="font-bold text-navy-800 text-xs uppercase mb-2">Grade Distribution per Subject</h4>
        <table class="w-full max-w-3xl text-xs border-collapse">
          <thead class="bg-slate-100 font-bold">
            <tr><th class="border border-slate-300 py-1.5 px-3 text-left">Grade</th>${head}</tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <p class="text-[10px] text-slate-500 mt-2">Rubric — A (80–100) · B (70–79) · C (55–69) · D (40–54) · F (0–39)</p>
      </div>`;
  },

  async _exportExcel() {
    const session = AppState.currentSession;
    const sel = document.getElementById('broadsheetClassSelect');
    const cls = sel?.value;
    if (!cls) return Toast.show('Select a class to export.', 'error');

    try {
      const { ExportService } = await import('../services/export.service.js');
      await ExportService.exportBroadsheet(session, cls, this.currentType);
      Toast.show('Broadsheet downloaded.', 'success');
    } catch (err) {
      Toast.show('Export failed: ' + err.message, 'error');
    }
  },

  _placeholder(msg = 'Select a class above to load the broadsheet.') {
    const wrap = document.getElementById('broadsheetBody');
    if (wrap) wrap.innerHTML = `<p class="text-xs text-slate-400 italic p-4">${escapeHtml(msg)}</p>`;
  },
};