import { AppState } from '../core/state.js';
import { CLASSES, SUBJECTS, SUBJECT_BY_CODE, CA_MAX } from '../core/config.js';
import { LearnerService } from '../services/learner.service.js';
import { MarksService } from '../services/marks.service.js';
import { ImportService } from '../services/import.service.js';
import { Events, EVT } from '../core/events.js';
import { escapeHtml, debounce } from './helpers.js';
import { Toast } from './toast.js';

export const MarksUI = {

  currentSubTab: 'ca',      // ca | exam | mock
  currentCaView: 'daily',   // daily | full

  init() {
    // Sub-tab switching
    document.querySelectorAll('.marks-subtab').forEach(btn => {
      btn.addEventListener('click', () => {
        this.currentSubTab = btn.dataset.subtab;
        this._syncSubTabs();
        this.render();
      });
    });

    // CA inner view switching
    document.querySelectorAll('.ca-view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.currentCaView = btn.dataset.caview;
        this._syncCaViews();
        this.render();
      });
    });

    // Class filter (shared across all 3 sub-tabs)
    const cls = document.getElementById('marksClassFilter');
    if (cls && cls.options.length <= 1) {
      cls.innerHTML = '<option value="">-- Select Class --</option>' +
        CLASSES.map(c => `<option value="${c}">${c}</option>`).join('');
    }
    cls?.addEventListener('change', () => this.render());

    // CA month selector
    const month = document.getElementById('caMonthSelect');
    if (month && month.options.length <= 1) {
      const months = MarksService.monthsForCurrentTerm();
      month.innerHTML = months.map(m => `<option value="${m}">${m}</option>`).join('');
    }
    month?.addEventListener('change', () => this.render());

    // Bulk upload input
    document.getElementById('marksBulkInput')?.addEventListener('change', e => {
      this._handleBulk(e.target.files[0]);
    });

    Events.on(EVT.MARKS_CHANGED, () => { /* silent — cells already show their own state */ });
    Events.on(EVT.LEARNERS_CHANGED, () => { if (this._isVisible()) this.render(); });
    
    document.getElementById('btnExportCaMonthly')?.addEventListener('click', async () => {
      const session = AppState.currentSession;
      const cls = document.getElementById('marksClassFilter')?.value;
      const month = document.getElementById('caMonthSelect')?.value;
      if (!cls) return Toast.show('Select a class first.', 'error');
      if (!month) return Toast.show('Select a month first.', 'error');
      try {
        const { ExportService } = await import('../services/export.service.js');
        await ExportService.exportCaMonthly(session, cls, month);
        Toast.show('CA export downloaded.', 'success');
      } catch (err) {
        Toast.show('Export failed: ' + err.message, 'error');
      }
    });

    document.getElementById('btnExportCaTerm')?.addEventListener('click', async () => {
      const session = AppState.currentSession;
      const cls = document.getElementById('marksClassFilter')?.value;
      if (!cls) return Toast.show('Select a class first.', 'error');
      try {
        const { ExportService } = await import('../services/export.service.js');
        const months = MarksService.monthsForCurrentTerm();
        await ExportService.exportCaTerm(session, cls, months);
        Toast.show('CA term export downloaded.', 'success');
      } catch (err) {
        Toast.show('Export failed: ' + err.message, 'error');
      }
    });
  },

  _isVisible() {
    const el = document.getElementById('tabContent-upload');
    return el && !el.classList.contains('hidden');
  },

  _syncSubTabs() {
    document.querySelectorAll('.marks-subtab').forEach(btn => {
      const active = btn.dataset.subtab === this.currentSubTab;
      btn.className = active
        ? 'marks-subtab px-4 py-2 rounded-md bg-navy-800 text-white text-xs font-bold transition'
        : 'marks-subtab px-4 py-2 rounded-md text-slate-600 hover:bg-slate-200 text-xs font-semibold transition';
    });
    document.querySelectorAll('.marks-panel').forEach(p => p.classList.add('hidden'));
    document.getElementById(`marks-panel-${this.currentSubTab}`)?.classList.remove('hidden');

    // CA inner tabs visible only when CA is active
    document.getElementById('caInnerTabs')?.classList.toggle('hidden', this.currentSubTab !== 'ca');
    this._syncCaViews();
  },

  _syncCaViews() {
    document.querySelectorAll('.ca-view-btn').forEach(btn => {
      const active = btn.dataset.caview === this.currentCaView;
      btn.className = active
        ? 'ca-view-btn px-3 py-1 rounded text-[11px] font-bold bg-navy-700 text-white'
        : 'ca-view-btn px-3 py-1 rounded text-[11px] font-semibold text-slate-600 hover:bg-slate-200';
    });
    document.getElementById('ca-view-daily')?.classList.toggle('hidden', this.currentCaView !== 'daily');
    document.getElementById('ca-view-full')?.classList.toggle('hidden',  this.currentCaView !== 'full');
  },

  render() {
    const session = AppState.currentSession;
    if (!session) return;
    this._syncSubTabs();

    if (this.currentSubTab === 'ca')   this.renderCA();
    if (this.currentSubTab === 'exam') this.renderExamOrMock('exam');
    if (this.currentSubTab === 'mock') this.renderExamOrMock('mock');
  },

  /* ---------- CA ---------- */
  renderCA() {
    const session = AppState.currentSession;
    const cls = document.getElementById('marksClassFilter')?.value;
    if (!cls) return this._placeholder('ca-view-daily', 'Select a class to load the CA grid.');
    if (this.currentCaView === 'daily') this._renderCaDaily(cls);
    else this._renderCaFull(cls);
  },

  _renderCaDaily(cls) {
    const session = AppState.currentSession;
    const schema = MarksService.schemaForClass(cls);
    if (!schema) return this._placeholder('ca-view-daily', `No schema for ${cls}.`);

    const month = document.getElementById('caMonthSelect')?.value || MarksService.monthsForCurrentTerm()[0];
    const learners = LearnerService.listBySchool(session.emis, cls);
    const subjects = schema.subjects.map(sc => SUBJECT_BY_CODE[sc]);

    const wrap = document.getElementById('ca-view-daily');
    if (!learners.length) return this._placeholder('ca-view-daily', 'No active learners in this class.');

    const headCells = subjects.map(s => `<th class="py-2 px-2 text-center text-[11px]">${escapeHtml(s.short)} <span class="text-slate-400 font-normal">/${CA_MAX}</span></th>`).join('');

    const rows = learners.map(l => {
      const cells = subjects.map(s => {
        const v = MarksService.getCaScore(l.lin, s.code, month);
        const val = (v === null || v === undefined) ? '' : v;
        return `<td class="py-1 px-1 text-center">
          <input type="number" min="0" max="${CA_MAX}" value="${val}" data-ca
            data-lin="${escapeHtml(l.lin)}" data-sc="${s.code}" data-month="${escapeHtml(month)}"
            class="w-14 px-1.5 py-1 text-xs border rounded text-center font-mono">
        </td>`;
      }).join('');
      return `<tr class="border-b border-slate-100 hover:bg-slate-50">
        <td class="py-1 px-3 font-mono text-navy-800 font-bold text-xs">${escapeHtml(l.lin)}</td>
        <td class="py-1 px-3 text-xs font-semibold text-slate-800">${escapeHtml(l.name)}</td>
        ${cells}
      </tr>`;
    }).join('');

    wrap.innerHTML = `
      <div class="p-4 bg-slate-50 rounded-lg border border-slate-200 mb-3 text-xs text-slate-600">
        Enter scores for whichever subjects were administered in <strong>${escapeHtml(month)}</strong>.
        Leave a cell blank if the subject was not tested. Max per subject: <strong>${CA_MAX}</strong>.
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse text-xs">
          <thead class="bg-slate-100 text-slate-700 font-bold">
            <tr>
              <th class="py-2 px-3">LIN</th>
              <th class="py-2 px-3">Name</th>
              ${headCells}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;

    this._wireAutoSave(wrap, 'ca');
  },

  _renderCaFull(cls) {
    const session = AppState.currentSession;
    const schema = MarksService.schemaForClass(cls);
    if (!schema) return this._placeholder('ca-view-full', `No schema for ${cls}.`);

    const months = MarksService.monthsForCurrentTerm();
    const learners = LearnerService.listBySchool(session.emis, cls);
    const wrap = document.getElementById('ca-view-full');
    if (!learners.length) return this._placeholder('ca-view-full', 'No active learners in this class.');

    const blocks = learners.map(l => {
      const rows = schema.subjects.map(sc => {
        const s = SUBJECT_BY_CODE[sc];
        const cells = months.map(m => {
          const v = MarksService.getCaScore(l.lin, sc, m);
          return `<td class="py-1 px-2 text-center font-mono">${(v === null || v === undefined) ? '—' : v}</td>`;
        }).join('');
        const avg = MarksService.caSubjectAverage(l.lin, sc, months);
        return `<tr class="border-b border-slate-100">
          <td class="py-1 px-3 text-slate-700 font-semibold">${escapeHtml(s.short)}</td>
          ${cells}
          <td class="py-1 px-2 text-center font-bold text-navy-800">${avg ?? '—'}</td>
        </tr>`;
      }).join('');

      const monthCells = months.map(m => {
        const avg = MarksService.caMonthAverage(l.lin, schema.subjects, m);
        return `<td class="py-1 px-2 text-center font-mono text-slate-600">${avg ?? '—'}</td>`;
      }).join('');
      const termAvg = MarksService.caTermAverage(l.lin, schema.subjects, months);

      return `<tr class="bg-slate-50 border-y-2 border-slate-200">
        <td colspan="99" class="py-2 px-3 text-xs font-bold text-navy-800">
          ${escapeHtml(l.lin)} — ${escapeHtml(l.name)}
        </td>
      </tr>${rows}
      <tr class="bg-blue-50/40">
        <td class="py-1 px-3 text-[11px] font-bold text-blue-900">MONTH AVG</td>
        ${monthCells}
        <td class="py-1 px-2 text-center font-black text-blue-900">${termAvg ?? '—'}</td>
      </tr>`;
    }).join('');

    const head = months.map(m => `<th class="py-2 px-2 text-center text-[11px]">${escapeHtml(m)}</th>`).join('');

    wrap.innerHTML = `
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse text-xs">
          <thead class="bg-slate-100 text-slate-700 font-bold">
            <tr>
              <th class="py-2 px-3">Subject</th>
              ${head}
              <th class="py-2 px-2 text-center">Avg</th>
            </tr>
          </thead>
          <tbody>${blocks}</tbody>
        </table>
      </div>`;
  },

  /* ---------- Exam / Mock ---------- */
  renderExamOrMock(type) {
    const session = AppState.currentSession;
    const cls = document.getElementById('marksClassFilter')?.value;
    const wrap = document.getElementById(`marks-panel-${type}`);
    if (!cls) return wrap && (wrap.querySelector('.marks-grid-wrap').innerHTML = '') || this._placeholder(`marks-panel-${type}`, 'Select a class to load scores.');

    const schema = MarksService.schemaForClass(cls);
    if (!schema) return this._placeholder(`marks-panel-${type}`, `No schema for ${cls}.`);

    const learners = LearnerService.listBySchool(session.emis, cls);
    const gridWrap = wrap.querySelector('.marks-grid-wrap');
    if (!learners.length) { gridWrap.innerHTML = '<p class="text-xs text-slate-400 italic p-4">No active learners in this class.</p>'; return; }

    const ranked = MarksService.rankClass(type, learners, cls);

    const headCells = schema.subjects.map(sc => {
      const s = SUBJECT_BY_CODE[sc];
      return `<th class="py-2 px-2 text-center text-[11px]">${escapeHtml(s.short)} <span class="text-slate-400 font-normal">/${schema.maxPerSubject}</span></th>`;
    }).join('');

    const rows = ranked.map(r => {
      const l = r.learner;
      const c = r.computed;
      const cells = schema.subjects.map((sc, i) => {
        const v = c.scores[i];
        const shown = v === 0 && AppState.marks[type]?.[l.lin]?.[sc] === undefined ? '' : v;
        const gradeLetter = v > 0 ? MarksService.grade((v / schema.maxPerSubject) * 100)?.letter : '';
        return `<td class="py-1 px-1 text-center">
          <input type="number" min="0" max="${schema.maxPerSubject}" value="${shown}" data-exam
            data-type="${type}" data-lin="${escapeHtml(l.lin)}" data-sc="${sc}" data-max="${schema.maxPerSubject}"
            class="w-14 px-1.5 py-1 text-xs border rounded text-center font-mono">
          ${gradeLetter ? `<span class="block text-[9px] text-slate-500 font-bold mt-0.5">${gradeLetter}</span>` : ''}
        </td>`;
      }).join('');

      return `<tr class="border-b border-slate-100 hover:bg-slate-50" data-lin="${escapeHtml(l.lin)}">
        <td class="py-1 px-2 text-center font-black text-navy-800">#${r.position}</td>
        <td class="py-1 px-3 font-mono text-xs">${escapeHtml(l.lin)}</td>
        <td class="py-1 px-3 text-xs font-semibold text-slate-800">${escapeHtml(l.name)}</td>
        ${cells}
        <td class="py-1 px-2 text-center font-bold text-navy-900">${c.total}/${c.maxTotal}</td>
        <td class="py-1 px-2 text-center font-mono">${c.avgPercent}%</td>
        <td class="py-1 px-2 text-center font-bold">${c.grade}</td>
        <td class="py-1 px-2 text-center font-semibold ${c.status === 'Pass' ? 'text-emerald-700' : 'text-red-600'}">${c.status}</td>
      </tr>`;
    }).join('');

    gridWrap.innerHTML = `
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse text-xs">
          <thead class="bg-slate-100 text-slate-700 font-bold">
            <tr>
              <th class="py-2 px-2 text-center">Pos</th>
              <th class="py-2 px-3">LIN</th>
              <th class="py-2 px-3">Name</th>
              ${headCells}
              <th class="py-2 px-2 text-center">Total</th>
              <th class="py-2 px-2 text-center">Avg%</th>
              <th class="py-2 px-2 text-center">Grade</th>
              <th class="py-2 px-2 text-center">Status</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;

    this._wireAutoSave(gridWrap, type);
  },

    /* ---------- auto-save on blur + Enter → next input ---------- */
  _wireAutoSave(scope, type) {
    const inputs = Array.from(scope.querySelectorAll('input[data-ca], input[data-exam]'));

    inputs.forEach((inp, idx) => {
      inp.dataset.lastValue = inp.value;

      // Save on blur
      inp.addEventListener('blur', () => this._saveInput(inp, type));

      inp.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          const nextIdx = idx + 1;
          const nextEl = inputs[nextIdx];
          const nextLin = nextEl?.dataset.lin;
          const nextSc  = nextEl?.dataset.sc;

          inp.blur(); // save (may trigger re-render)

          // Re-focus after possible DOM rebuild
          requestAnimationFrame(() => {
            if (!nextLin) return;
            const selector = `input[data-lin="${nextLin}"][data-sc="${nextSc}"]`;
            const fresh = document.querySelector(selector);
            if (fresh) { fresh.focus(); fresh.select(); }
          });
        }
        if (ev.key === 'Backspace' && inp.value === '') {
          const prevEl = inputs[idx - 1];
          const prevLin = prevEl?.dataset.lin;
          const prevSc  = prevEl?.dataset.sc;
          if (prevLin) {
            ev.preventDefault();
            requestAnimationFrame(() => {
              const selector = `input[data-lin="${prevLin}"][data-sc="${prevSc}"]`;
              const fresh = document.querySelector(selector);
              if (fresh) { fresh.focus(); fresh.select(); }
            });
          }
        }
      });

      // Select-all on focus for quick overtype
      inp.addEventListener('focus', () => inp.select());
    });
  },

  async _saveInput(input, type) {
    const prev = input.dataset.lastValue ?? '';
    try {
      if (type === 'ca') {
        await MarksService.setCaScore(
          input.dataset.lin,
          input.dataset.sc,
          input.dataset.month,
          input.value
        );
      } else {
        await MarksService.setExamScore(
          input.dataset.type,
          input.dataset.lin,
          input.dataset.sc,
          input.value,
          parseInt(input.dataset.max, 10)
        );
      }
      input.dataset.lastValue = input.value;
      this._flashSaved(input);
      if (type !== 'ca') this.render(); // exam/mock need recompute (pos/total/grade)
    } catch (err) {
      input.value = prev;
      Toast.show('Failed to save: ' + err.message, 'error');
    }
  },

  _flashSaved(input) {
    const flag = document.createElement('span');
    flag.textContent = '✓';
    flag.className = 'absolute -top-2 -right-1 text-[10px] text-emerald-600 font-bold';
    const parent = input.parentElement;
    if (!parent.style.position) parent.style.position = 'relative';
    parent.appendChild(flag);
    setTimeout(() => flag.remove(), 900);
  },

  /* ---------- bulk upload ---------- */
  async _handleBulk(file) {
    if (!file) return;
    const session = AppState.currentSession;
    const cls = document.getElementById('marksClassFilter')?.value;
    if (!cls) return Toast.show('Select a class first.', 'error');

    try {
      Toast.show(`Reading ${file.name}…`, 'info');
      const rows = await ImportService.parse(file);

      if (this.currentSubTab === 'ca') {
        const month = document.getElementById('caMonthSelect')?.value || MarksService.monthsForCurrentTerm()[0];
        const normalized = this._normalizeCaRows(rows, month);
        const res = await MarksService.bulkSetCa(normalized);
        Toast.show(`CA upload: ${res.added} saved, ${res.skipped.length} skipped.`, res.added ? 'success' : 'error');
      } else {
        const normalized = this._normalizeExamRows(rows, cls);
        const res = await MarksService.bulkSetExam(this.currentSubTab, normalized, cls);
        Toast.show(`${this.currentSubTab.toUpperCase()} upload: ${res.added} saved, ${res.skipped.length} skipped.`, res.added ? 'success' : 'error');
      }
      this.render();
    } catch (err) {
      Toast.show(err.message, 'error');
    } finally {
      const inp = document.getElementById('marksBulkInput');
      if (inp) inp.value = '';
    }
  },

  _normalizeCaRows(rows, fallbackMonth) {
    const out = [];
    const months = MarksService.monthsForCurrentTerm();
    for (const row of rows) {
      const lin = pickField(row, ['lin', 'id']);
      if (!lin) continue;

      // Wide format: LIN, Subject, Sep, Oct, Nov
      const subjRaw = pickField(row, ['subject']);
      if (subjRaw) {
        const sc = resolveSubjectCode(subjRaw);
        if (sc) {
          let any = false;
          months.forEach(m => {
            const val = row[m] ?? row[m.slice(0,3)];
            if (val !== undefined && String(val).trim() !== '') {
              out.push({ lin, subjectCode: sc, month: m, score: val });
              any = true;
            }
          });
          // Long format fallback if no months found
          if (!any) {
            const m = pickField(row, ['month']) || fallbackMonth;
            const s = pickField(row, ['score', 'mark']);
            if (m && s) out.push({ lin, subjectCode: sc, month: m, score: s });
          }
        }
      } else {
        // Pivot format: LIN, ENG, MATH, SCI, ... (one column per subject)
        Object.keys(row).forEach(k => {
          const sc = resolveSubjectCode(k);
          if (sc) {
            const val = row[k];
            if (val !== undefined && String(val).trim() !== '') {
              out.push({ lin, subjectCode: sc, month: fallbackMonth, score: val });
            }
          }
        });
      }
    }
    return out;
  },

  _normalizeExamRows(rows, cls) {
    return rows.map(row => {
      const out = { ...row };
      const lin = pickField(row, ['lin', 'id']);
      out.__lin = lin || '';
      return out;
    });
  },

  _placeholder(panelId, msg) {
    const wrap = document.getElementById(panelId)?.querySelector('.marks-grid-wrap');
    if (wrap) wrap.innerHTML = `<p class="text-xs text-slate-400 italic p-4">${escapeHtml(msg)}</p>`;
  },
};

/* ---------- helpers ---------- */
function pickField(row, candidates) {
  const lower = {};
  Object.keys(row || {}).forEach(k => {
    const clean = String(k).replace(/^\uFEFF/, '').replace(/["']/g, '').trim().toLowerCase();
    lower[clean] = row[k];
  });
  for (const c of candidates) {
    const key = Object.keys(lower).find(k => k.includes(c));
    if (key && lower[key] !== undefined && String(lower[key]).trim() !== '') {
      return String(lower[key]).trim();
    }
  }
  return '';
}

function resolveSubjectCode(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase().trim();
  const found = SUBJECTS.find(subj =>
    subj.code.toLowerCase() === s ||
    subj.short.toLowerCase() === s ||
    subj.name.toLowerCase() === s ||
    subj.name.toLowerCase().includes(s) ||
    s.includes(subj.short.toLowerCase())
  );
  return found ? found.code : null;
}