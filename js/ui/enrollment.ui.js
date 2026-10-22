import { AppState } from '../core/state.js';
import { CLASSES } from '../core/config.js';
import { LearnerService } from '../services/learner.service.js';
import { ImportService } from '../services/import.service.js';
import { Events, EVT } from '../core/events.js';
import { escapeHtml, fmtDate } from './helpers.js';
import { Toast } from './toast.js';

export const EnrollmentUI = {

  init() {
    // Filter dropdown
    const filter = document.getElementById('classFilterSelect');
    if (filter && filter.options.length <= 1) {
      filter.innerHTML = '<option value="ALL">All Classes</option>' +
        CLASSES.map(c => `<option value="${c}">${c}</option>`).join('');
    }
    filter?.addEventListener('change', () => this.render());

    // Add learner form
    document.getElementById('addStudentForm')?.addEventListener('submit', e => this._handleAdd(e));

    // Bulk upload
    const bulkInput = document.getElementById('bulkUploadInput');
    bulkInput?.addEventListener('change', e => this._handleBulk(e.target.files[0]));

    // Transfer-in toggle
    const typeSelect = document.getElementById('studentEnrollmentType');
    const transferFields = document.getElementById('transferFields');
    typeSelect?.addEventListener('change', () => {
      if (!transferFields) return;
      transferFields.classList.toggle('hidden', typeSelect.value !== 'transfer');
    });

    // Actions menu
    const actionsBtn = document.getElementById('enrollActionsBtn');
    const actionsMenu = document.getElementById('enrollActionsMenu');
    actionsBtn?.addEventListener('click', e => {
      e.stopPropagation();
      actionsMenu?.classList.toggle('hidden');
    });
    document.addEventListener('click', () => actionsMenu?.classList.add('hidden'));

    document.getElementById('menuDownloadTemplate')?.addEventListener('click', () => {
      actionsMenu?.classList.add('hidden');
      this.handleDownloadTemplate();
    });
    document.getElementById('menuResequence')?.addEventListener('click', () => {
      actionsMenu?.classList.add('hidden');
      this.handleResequence();
    });

    // Refresh table when service mutates data
    Events.on(EVT.LEARNERS_CHANGED, () => this.render());
  },

  render() {
    const session = AppState.currentSession;
    if (!session) return;

    const filterEl = document.getElementById('classFilterSelect');
    const filter = filterEl?.value || 'ALL';

    const learners = LearnerService.listBySchool(session.emis, filter === 'ALL' ? null : filter);

    const badge = document.getElementById('enrollmentCountBadge');
    if (badge) badge.textContent = `${learners.length} Enrolled Learner(s) — ${filter}`;

    const tbody = document.getElementById('enrollmentTableBody');
    if (!tbody) return;

    if (learners.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-slate-400 text-xs">
        No active learners${filter !== 'ALL' ? ` in ${escapeHtml(filter)}` : ''}. Add one above or use Bulk Upload.
      </td></tr>`;
      return;
    }

    tbody.innerHTML = learners.map(l => `
      <tr class="hover:bg-slate-50 border-b border-slate-100">
        <td class="py-2 px-3 font-mono text-navy-800 font-bold">${escapeHtml(l.lin)}</td>
        <td class="py-2 px-3 font-semibold text-slate-800">${escapeHtml(l.name)}</td>
        <td class="py-2 px-3 text-slate-600">${escapeHtml(l.gender)}</td>
        <td class="py-2 px-3 text-slate-700">${escapeHtml(l.class)}</td>
        <td class="py-2 px-3 text-slate-500 text-[11px]">${l.enrollmentType === 'transfer' ? 'Transfer-in' : 'New'} • ${escapeHtml(fmtDate(l.enrolledAt))}</td>
        <td class="py-2 px-3 text-right">
          <button data-action="transfer" data-lin="${escapeHtml(l.lin)}"
            class="bg-red-600 hover:bg-red-700 text-white text-[10px] font-bold px-2 py-1 rounded transition">
            Transfer Out
          </button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('button[data-action="transfer"]').forEach(btn => {
      btn.addEventListener('click', () => this._handleTransfer(btn.dataset.lin));
    });
  },

  async _handleAdd(e) {
    e.preventDefault();
    const session = AppState.currentSession;
    if (!session) return;

    const name   = document.getElementById('studentName').value;
    const gender = document.getElementById('studentGender').value;
    const cls    = document.getElementById('studentClass').value;
    const type   = document.getElementById('studentEnrollmentType')?.value || 'new';
    const prevSchool = document.getElementById('prevSchool')?.value || '';
    const prevLin    = document.getElementById('prevLin')?.value || '';

    try {
      const rec = await LearnerService.enroll({
        emis: session.emis,
        zone: session.zone,
        name, gender, className: cls,
        enrollmentType: type,
        previousSchool: prevSchool,
        previousLin: prevLin,
      });
      Toast.show(`Enrolled ${rec.name} — LIN ${rec.lin}`, 'success');
      e.target.reset();
      document.getElementById('transferFields')?.classList.add('hidden');
    } catch (err) {
      Toast.show(err.message, 'error');
    }
  },

  async _handleTransfer(lin) {
    if (!confirm(`Mark ${lin} as transferred out? The LIN stays reserved and the learner is archived.`)) return;
    try {
      await LearnerService.transfer(lin);
      Toast.show('Learner marked as transferred.', 'info');
    } catch (err) {
      Toast.show(err.message, 'error');
    }
  },

  async _handleBulk(file) {
    if (!file) return;
    const session = AppState.currentSession;
    if (!session) return;

    const filterEl = document.getElementById('classFilterSelect');
    const defaultClass = (filterEl?.value && filterEl.value !== 'ALL') ? filterEl.value : null;

    try {
      Toast.show(`Reading ${file.name}…`, 'info');
      const rows = await ImportService.parse(file);
      if (!rows.length) return Toast.show('No rows found in file.', 'error');

      const summary = await LearnerService.bulkEnroll(rows, {
        emis: session.emis,
        zone: session.zone,
        defaultClass,
      });

      const bits = [`${summary.added} added`];
      if (summary.skipped.length) bits.push(`${summary.skipped.length} skipped`);
      if (summary.errors.length)  bits.push(`${summary.errors.length} errors`);
      Toast.show(`Bulk upload: ${bits.join(', ')}`, summary.added ? 'success' : 'error');

      if (summary.skipped.length || summary.errors.length) {
        console.table([...summary.skipped, ...summary.errors]);
      }
    } catch (err) {
      Toast.show(err.message, 'error');
    } finally {
      const inp = document.getElementById('bulkUploadInput');
      if (inp) inp.value = '';
    }
  },

  handleDownloadTemplate() {
    // Blank enrollment template — placeholder until Module 2 refines templates.
    const header = 'Name,Sex,Class\n';
    const sample = 'Ali Yamikani,Female,Standard 8\nBanda Chimwemwe,Male,Standard 8\n';
    const blob = new Blob([header + sample], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Enrollment_Template_${AppState.academicConfig.year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    Toast.show('Enrollment template downloaded.', 'success');
  },

  async handleResequence() {
    const session = AppState.currentSession;
    const filterEl = document.getElementById('classFilterSelect');
    const cls = filterEl?.value;

    if (!cls || cls === 'ALL') {
      return Toast.show('Select a specific class first (not "All Classes").', 'error');
    }

    const learners = LearnerService.listBySchool(session.emis, cls);
    if (!learners.length) return Toast.show('No active learners in this class.', 'info');

    const preview = learners.map((l, i) =>
      `${String(i + 1).padStart(3, '0')}  ${l.name}  (${l.gender})`
    ).join('\n');

    const ok = confirm(
      `Re-sequence ${learners.length} learner(s) in ${cls}?\n\n` +
      `New order (girls first, alphabetical):\n\n${preview}\n\n` +
      `This will REWRITE all active LINs in this class. Only proceed if no report cards\n` +
      `or broadsheets have been issued under the current LINs.`
    );
    if (!ok) return;

    try {
      const count = await LearnerService.resequenceClass(session.emis, cls);
      Toast.show(`Re-sequenced ${count} learner(s) in ${cls}.`, 'success');
    } catch (err) {
      Toast.show(err.message, 'error');
    }
  },
};