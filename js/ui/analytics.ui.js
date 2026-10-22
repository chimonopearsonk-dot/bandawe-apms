import { AppState } from '../core/state.js';
import { CLASSES } from '../core/config.js';
import { LearnerService } from '../services/learner.service.js';
import { MarksService } from '../services/marks.service.js';
import { AnalyticsService } from '../services/analytics.service.js';
import { escapeHtml } from './helpers.js';

export const AnalyticsUI = {

  currentType: 'exam',

  init() {
    document.querySelectorAll('.analytics-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.currentType = btn.dataset.type;
        this._syncTypeButtons();
        this.render();
      });
    });

    const sel = document.getElementById('analyticsClassSelect');
    if (sel && sel.options.length <= 1) {
      sel.innerHTML = '<option value="ALL">All Classes (School)</option>' +
        CLASSES.map(c => `<option value="${c}">${c}</option>`).join('');
    }
    sel?.addEventListener('change', () => this.render());
  },

  _syncTypeButtons() {
    document.querySelectorAll('.analytics-type-btn').forEach(btn => {
      const active = btn.dataset.type === this.currentType;
      btn.className = active
        ? 'analytics-type-btn px-3 py-1.5 rounded-md bg-navy-800 text-white text-xs font-bold'
        : 'analytics-type-btn px-3 py-1.5 rounded-md text-slate-600 hover:bg-slate-200 text-xs font-semibold';
    });
  },

  render() {
    const session = AppState.currentSession;
    if (!session) return;
    this._syncTypeButtons();

    const sel = document.getElementById('analyticsClassSelect');
    if (sel && sel.options.length <= 1) {
      sel.innerHTML = '<option value="ALL">All Classes (School)</option>' +
        CLASSES.map(c => `<option value="${c}">${c}</option>`).join('');
    }

    const selected = sel?.value || 'ALL';
    if (selected === 'ALL') this._renderSchool(session);
    else                    this._renderClass(session, selected);
  },

  _renderSchool(session) {
    const wrap = document.getElementById('analyticsBody');
    if (!wrap) return;

    const type = this.currentType;
    const sum = AnalyticsService.schoolSummary(type, session.emis);
    const typeLabel = type === 'exam' ? 'End of Term Exam' : 'MANEB Mock';

    const rows = sum.rows.map(r => {
      const cs = r.stats;
      return `
        <tr class="border-b border-slate-100 hover:bg-slate-50">
          <td class="py-2 px-3 font-bold text-navy-800">${escapeHtml(r.className)}</td>
          <td class="py-2 px-3 text-center">${cs.registered.total}</td>
          <td class="py-2 px-3 text-center">${cs.sat.total}</td>
          <td class="py-2 px-3 text-center">${cs.passed.total}</td>
          <td class="py-2 px-3 text-center font-bold ${r.classPct >= 50 ? 'text-emerald-700' : 'text-red-600'}">${r.classPct}%</td>
        </tr>`;
    }).join('');

    wrap.innerHTML = `
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        ${card('Total Registered', sum.totals.registered.total, 'text-navy-800')}
        ${card('Total Sat', sum.totals.sat.total, 'text-blue-700')}
        ${card('Total Passed', sum.totals.passed.total, 'text-emerald-700')}
        ${card('Overall Pass Rate', sum.overallPct + '%', sum.overallPct >= 50 ? 'text-emerald-700' : 'text-red-600')}
      </div>

      <div class="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div class="p-3 border-b border-slate-100 flex justify-between items-center">
          <h4 class="font-bold text-navy-800 text-sm">${escapeHtml(typeLabel)} — School-wide by Class</h4>
          <span class="text-[11px] text-slate-400">${sum.rows.length} class(es)</span>
        </div>
        <table class="w-full text-xs">
          <thead class="bg-slate-50 text-slate-600 font-bold uppercase text-[11px]">
            <tr>
              <th class="py-2 px-3 text-left">Class</th>
              <th class="py-2 px-3 text-center">Registered</th>
              <th class="py-2 px-3 text-center">Sat</th>
              <th class="py-2 px-3 text-center">Passed</th>
              <th class="py-2 px-3 text-center">Pass %</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="5" class="py-4 text-center text-slate-400">No data yet.</td></tr>'}</tbody>
        </table>
      </div>`;
  },

  _renderClass(session, className) {
    const wrap = document.getElementById('analyticsBody');
    if (!wrap) return;

    const type = this.currentType;
    const stats = AnalyticsService.classStats(type, session.emis, className);
    const sum   = AnalyticsService.classSummary(type, session.emis, className);
    if (!stats || !sum) {
      wrap.innerHTML = `<p class="text-xs text-slate-400 italic p-4">No data for ${escapeHtml(className)}.</p>`;
      return;
    }

    const cs = sum.stats;
    const typeLabel = type === 'exam' ? 'End of Term Exam' : 'MANEB Mock';

    wrap.innerHTML = `
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        ${card('Class Mean', stats.mean + '%', 'text-navy-800')}
        ${card('Highest Total', stats.highest, 'text-emerald-700')}
        ${card('Lowest Total', stats.lowest, 'text-amber-700')}
        ${card('Pass Rate', stats.passRate + '%', stats.passRate >= 50 ? 'text-emerald-700' : 'text-red-600')}
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="bg-white rounded-xl border border-slate-200 p-4">
          <h4 class="font-bold text-navy-800 text-sm mb-3">${escapeHtml(className)} — ${escapeHtml(typeLabel)}</h4>
          <table class="w-full text-xs">
            <thead class="bg-slate-50 text-slate-600 font-bold uppercase text-[11px]">
              <tr>
                <th class="py-2 px-3 text-left">Metric</th>
                <th class="py-2 px-3 text-center">F</th>
                <th class="py-2 px-3 text-center">M</th>
                <th class="py-2 px-3 text-center">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr class="border-b border-slate-100"><td class="py-2 px-3 font-semibold">Registered</td><td class="text-center">${cs.registered.F}</td><td class="text-center">${cs.registered.M}</td><td class="text-center font-bold">${cs.registered.total}</td></tr>
              <tr class="border-b border-slate-100"><td class="py-2 px-3 font-semibold">Sat</td><td class="text-center">${cs.sat.F}</td><td class="text-center">${cs.sat.M}</td><td class="text-center font-bold">${cs.sat.total}</td></tr>
              <tr class="border-b border-slate-100"><td class="py-2 px-3 font-semibold">Passed</td><td class="text-center">${cs.passed.F}</td><td class="text-center">${cs.passed.M}</td><td class="text-center font-bold">${cs.passed.total}</td></tr>
              <tr><td class="py-2 px-3 font-bold text-navy-800">Class %</td><td colspan="3" class="text-center font-black text-navy-800">${sum.classPct}%</td></tr>
            </tbody>
          </table>
        </div>

        <div class="bg-white rounded-xl border border-slate-200 p-4">
          <h4 class="font-bold text-navy-800 text-sm mb-3">Grade Distribution per Subject</h4>
          ${this._gradeDistTable(session.emis, className, type)}
        </div>
      </div>`;
  },

  _gradeDistTable(emis, className, type) {
    const data = AnalyticsService.gradeDistribution(type, emis, className);
    if (!data) return '<p class="text-xs text-slate-400 italic">No data.</p>';

    const headCells = data.schema.subjects.map(sc =>
      `<th class="py-1 px-2 text-center text-[10px]">${escapeHtml(sc)}</th>`
    ).join('');

    const rows = ['A','B','C','D','F'].map(letter => {
      const cells = data.schema.subjects.map(sc =>
        `<td class="py-1 px-2 text-center font-mono">${data.dist[sc][letter]}</td>`
      ).join('');
      return `<tr class="border-b border-slate-100"><td class="py-1 px-2 font-bold">${letter}</td>${cells}</tr>`;
    }).join('');

    return `<table class="w-full text-xs">
      <thead class="bg-slate-50 text-slate-600 font-bold uppercase text-[10px]">
        <tr><th class="py-1 px-2 text-left">Grade</th>${headCells}</tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
  },
};

function card(label, value, color) {
  return `<div class="bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
    <div class="text-[10px] font-bold text-slate-500 uppercase">${label}</div>
    <div class="text-xl font-black mt-0.5 ${color}">${value}</div>
  </div>`;
}