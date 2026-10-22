import { AppState } from '../core/state.js';
import { CLASSES } from '../core/config.js';
import { LearnerService } from '../services/learner.service.js';
import { Storage } from '../services/storage.js';
import { ReportCardService } from '../services/report-card.service.js';
import { Events, EVT } from '../core/events.js';
import { escapeHtml } from './helpers.js';
import { Toast } from './toast.js';

export const ReportsUI = {

  currentType: 'exam',
  selectedLin: null,

  init() {
    document.querySelectorAll('.report-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.currentType = btn.dataset.type;
        this._syncTypes();
        this.render();
      });
    });

    document.getElementById('reportClassSelect')?.addEventListener('change', () => {
      this.selectedLin = null;
      this.render();
    });

    document.getElementById('reportStudentSelect')?.addEventListener('change', e => {
      this.selectedLin = e.target.value || null;
      this._renderRemarkEditor();
      this._renderPreview();
    });

    document.getElementById('btnDownloadReport')?.addEventListener('click', () => this._downloadSingle());
    document.getElementById('btnDownloadClass')?.addEventListener('click', () => this._downloadClass());
    document.getElementById('btnSaveRemark')?.addEventListener('click', () => this._saveRemark());

    Events.on(EVT.LEARNERS_CHANGED, () => this._maybeRefresh());
    Events.on(EVT.MARKS_CHANGED,    () => this._maybeRefresh());
    
    document.getElementById('btnCloseReportPreview')?.addEventListener('click', () => {
      this.selectedLin = null;
    document.getElementById('reportStudentSelect').value = '';
      const iframe = document.getElementById('reportPreviewIframe');
      const preview = document.getElementById('reportPreview');
      const btn = document.getElementById('btnCloseReportPreview');
      if (iframe) { iframe.srcdoc = ''; iframe.classList.add('hidden'); }
      if (preview) { preview.classList.remove('hidden'); preview.innerHTML = '<p class="text-xs text-slate-400 italic p-4">Select a class and learner to preview.</p>'; }
      if (btn) btn.classList.add('hidden');
  document.getElementById('reportRemarkEditor')?.classList.add('hidden');
  });
  },

  _maybeRefresh() {
    const el = document.getElementById('tabContent-reports');
    if (el && !el.classList.contains('hidden')) this.render();
  },

  _syncTypes() {
    document.querySelectorAll('.report-type-btn').forEach(btn => {
      const active = btn.dataset.type === this.currentType;
      btn.className = active
        ? 'report-type-btn px-3 py-1.5 rounded-md bg-navy-800 text-white text-xs font-bold'
        : 'report-type-btn px-3 py-1.5 rounded-md text-slate-600 hover:bg-slate-200 text-xs font-semibold';
    });
  },

  render() {
    const session = AppState.currentSession;
    if (!session) return;
    this._syncTypes();

    this.selectedLin = null;
    const iframe = document.getElementById('reportPreviewIframe');
    const preview = document.getElementById('reportPreview');
    if (iframe) { iframe.srcdoc = ''; iframe.classList.add('hidden'); }
    if (preview) { preview.classList.remove('hidden'); preview.innerHTML = '<p class="text-xs text-slate-400 italic p-4">Select a class and learner to preview.</p>'; }
    document.getElementById('reportRemarkEditor')?.classList.add('hidden');

    const classSel = document.getElementById('reportClassSelect');
    if (classSel && classSel.options.length <= 1) {
      classSel.innerHTML = '<option value="">-- Select Class --</option>' +
        CLASSES.map(c => `<option value="${c}">${c}</option>`).join('');
    }
    const cls = classSel?.value;
    if (!cls) {
      document.getElementById('reportStudentSelect').innerHTML = '<option value="">-- Select Learner --</option>';
      document.getElementById('reportPreview').innerHTML = '<p class="text-xs text-slate-400 italic p-4">Select a class, then a learner.</p>';
      document.getElementById('reportRemarkEditor').classList.add('hidden');
      return;
    }

    const learners = LearnerService.listBySchool(session.emis, cls);
    const sel = document.getElementById('reportStudentSelect');
    sel.innerHTML = '<option value="">-- Select Learner --</option>' +
      learners.map(l => `<option value="${escapeHtml(l.lin)}"${l.lin === this.selectedLin ? ' selected' : ''}>${escapeHtml(l.name)} (${escapeHtml(l.lin)})</option>`).join('');

    this._renderRemarkEditor();
    this._renderPreview();
  },

  _renderRemarkEditor() {
    const wrap = document.getElementById('reportRemarkEditor');
    const session = AppState.currentSession;
    if (!session || !this.selectedLin) { wrap.classList.add('hidden'); return; }
    wrap.classList.remove('hidden');

    const y = AppState.academicConfig.year;
    const t = AppState.academicConfig.term;
    const remark = AppState.remarks?.[session.emis]?.[this.selectedLin]?.[y]?.[t] || {};

    document.getElementById('classTeacherRemarkInput').value = remark.classTeacher || '';
    document.getElementById('headTeacherRemarkInput').value  = remark.headTeacher  || '';
  },

  _renderPreview() {
    const wrap = document.getElementById('reportPreview');
    const iframe = document.getElementById('reportPreviewIframe');
    const closeBtn = document.getElementById('btnCloseReportPreview');
    const session = AppState.currentSession;
    if (!session) return;
    if (!this.selectedLin) {
      wrap.innerHTML = '<p class="text-xs text-slate-400 italic p-4">Select a learner to preview the report card.</p>';
      return;
    }

    try {
      const html = ReportCardService.buildLearnerHtml(session.emis, this.selectedLin, this.currentType);
      // Extract just the card body for preview — render in an iframe srcdoc
      const iframe = document.getElementById('reportPreviewIframe');
      iframe.srcdoc = html;
      wrap.classList.add('hidden');
      iframe.classList.remove('hidden');
       if (closeBtn) closeBtn.classList.remove('hidden');
    } catch (err) {
      wrap.classList.remove('hidden');
      document.getElementById('reportPreviewIframe')?.classList.add('hidden');
      wrap.innerHTML = `<p class="text-xs text-red-500 italic p-4">${escapeHtml(err.message)}</p>`;
    }
  },

  async _saveRemark() {
    const session = AppState.currentSession;
    if (!session || !this.selectedLin) return;
    const y = AppState.academicConfig.year;
    const t = AppState.academicConfig.term;

    if (!AppState.remarks[session.emis]) AppState.remarks[session.emis] = {};
    if (!AppState.remarks[session.emis][this.selectedLin]) AppState.remarks[session.emis][this.selectedLin] = {};
    if (!AppState.remarks[session.emis][this.selectedLin][y]) AppState.remarks[session.emis][this.selectedLin][y] = {};

    AppState.remarks[session.emis][this.selectedLin][y][t] = {
      classTeacher: document.getElementById('classTeacherRemarkInput').value.trim(),
      headTeacher:  document.getElementById('headTeacherRemarkInput').value.trim(),
    };
    await Storage.saveRemarks();
    Events.emit(EVT.REMARKS_CHANGED, { emis: session.emis, lin: this.selectedLin });
    Toast.show('Remarks saved.', 'success');
    this._renderPreview();
  },

  _downloadSingle() {
    const session = AppState.currentSession;
    if (!session || !this.selectedLin) return Toast.show('Select a learner first.', 'error');
    try {
      const html = ReportCardService.buildLearnerHtml(session.emis, this.selectedLin, this.currentType);
      const learner = LearnerService.findByLin(this.selectedLin);
      const safeName = (learner?.name || 'learner').replace(/[^a-zA-Z0-9\-_]/g, '_');
      this._downloadHtml(html, `ReportCard_${safeName}_${learner?.lin || ''}.html`);
      Toast.show('Report card downloaded.', 'success');
    } catch (err) {
      Toast.show('Download failed: ' + err.message, 'error');
    }
  },

  _downloadClass() {
    const session = AppState.currentSession;
    const cls = document.getElementById('reportClassSelect')?.value;
    if (!session || !cls) return Toast.show('Select a class first.', 'error');

    const learners = LearnerService.listBySchool(session.emis, cls);
    if (!learners.length) return Toast.show('No learners in this class.', 'error');

    const cards = learners.map(l => {
      try {
        const html = ReportCardService.buildLearnerHtml(session.emis, l.lin, this.currentType);
        // Strip outer <html> tags so we can stack them
        return html.replace(/^[\s\S]*?<body[^>]*>/i, '').replace(/<\/body>[\s\S]*$/i, '');
      } catch (err) {
        return '';
      }
    }).filter(Boolean);

    const combined = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Report Cards — ${escapeHtml(cls)}</title>
<style>@media print { .card { page-break-after: always; } .card:last-child { page-break-after: auto; } }</style>
</head><body>${cards.join('<div style="height:24px"></div>')}</body></html>`;

    const safeCls = cls.replace(/[^a-zA-Z0-9\-_]/g, '_');
    this._downloadHtml(combined, `ReportCards_${safeCls}_${learners.length}_learners.html`);
    Toast.show(`Downloaded ${learners.length} report cards.`, 'success');
  },

  _downloadHtml(html, filename) {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 500);
  },
};