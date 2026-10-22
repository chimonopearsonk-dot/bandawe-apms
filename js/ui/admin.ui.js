import { AppState } from '../core/state.js';
import { AdminService } from '../services/admin.service.js';
import { ImageStoreService } from '../services/image-store.service.js';
import { BackupService } from '../services/backup.service.js';
import { Storage } from '../services/storage.js';
import { CLASSES, SUBJECTS, CLASS_EXAM_SCHEMA } from '../core/config.js';
import { escapeHtml } from './helpers.js';
import { Toast } from './toast.js';
import { Events, EVT } from '../core/events.js';

export const AdminUI = {

    currentTab: 'overview',

  init() {
    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.currentTab = btn.dataset.adminTab;
        this._syncTabs();
        this.render();
      });
    });

    document.getElementById('btnCloseAdmin')?.addEventListener('click', () => {
      document.getElementById('adminModal')?.classList.add('hidden');
    });

    // Approvals
    document.getElementById('adminApprovalsTableBody')?.addEventListener('click', async e => {
      const approve = e.target.closest('[data-action="approve"]');
      const reject  = e.target.closest('[data-action="reject"]');
      if (approve) await this._approve(approve.dataset.id);
      if (reject)  await this._reject(reject.dataset.id);
    });

    // Schools
    document.getElementById('adminSchoolsTableBody')?.addEventListener('click', async e => {
      const btn = e.target.closest('[data-action="remove-school"]');
      if (btn) await this._removeSchool(btn.dataset.emis);
    });
    document.getElementById('adminAddSchoolForm')?.addEventListener('submit', e => this._addSchool(e));

    // Announcements
    document.getElementById('adminAnnouncementForm')?.addEventListener('submit', e => this._postAnnouncement(e));
    document.getElementById('adminAnnouncementsList')?.addEventListener('click', async e => {
      const btn = e.target.closest('[data-action="del-announce"]');
      if (btn) await this._deleteAnnouncement(btn.dataset.id);
    });

    // Contacts
    document.getElementById('adminSupportContactForm')?.addEventListener('submit', e => this._addContact(e));
    document.getElementById('adminTechContactsList')?.addEventListener('click', async e => {
      const btn = e.target.closest('[data-action="del-contact"]');
      if (btn) await this._deleteContact(btn.dataset.id);
    });

    // Academic
    document.getElementById('adminAcademicSettingsForm')?.addEventListener('submit', e => this._saveAcademic(e));
    document.getElementById('adminNextOpeningForm')?.addEventListener('submit', e => this._saveNextOpening(e));

    // Branding
    document.getElementById('upload-emblem')?.addEventListener('change', e => this._uploadEmblem(e));
    document.getElementById('clear-emblem')?.addEventListener('click', () => this._clearEmblem());

    // Schema
    document.getElementById('adminSchemaClassSelect')?.addEventListener('change', () => this._renderSchemaEditor());
    document.getElementById('btnSaveSchema')?.addEventListener('click', () => this._saveSchema());

    // Backup
    document.getElementById('btnExportBackup')?.addEventListener('click', () => this._exportBackup());
    document.getElementById('importBackupInput')?.addEventListener('change', e => this._importBackup(e));
    document.getElementById('btnFactoryReset')?.addEventListener('click', () => BackupService.factoryReset());

    Events.on(EVT.SCHOOLS_CHANGED,  () => this._isOpen() && this.render());
    Events.on(EVT.PENDING_CHANGED,  () => this._isOpen() && this.render());
    Events.on(EVT.ANNOUNCE_CHANGED, () => this._isOpen() && this.render());
  },

  _isOpen() {
    const el = document.getElementById('adminModal');
    return el && !el.classList.contains('hidden');
  },

  _syncTabs() {
    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
      const active = btn.dataset.adminTab === this.currentTab;
      btn.className = active
        ? 'admin-tab-btn w-full text-left px-3 py-2 rounded-lg text-xs font-bold bg-navy-800 text-white flex items-center space-x-2'
        : 'admin-tab-btn w-full text-left px-3 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-200 flex items-center space-x-2';
    });
    document.querySelectorAll('.admin-tab-content').forEach(el => el.classList.add('hidden'));
    document.getElementById(`adminTabContent-${this.currentTab}`)?.classList.remove('hidden');
  },
  _renderOverview() {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

    // Prefer the full admin-loaded list when available
    const learnerList = (AppState.allLearners && AppState.allLearners.length)
      ? AppState.allLearners
      : AppState.learners;

    const totalSchools = AppState.schools.length;
    const verifiedSchools = AppState.schools.filter(s => s.verified).length;
    const totalLearners = learnerList.filter(l => l.status === 'active').length;
    const pending = AppState.pendingApprovals.length;

    set('adminStatSchools', totalSchools);
    set('adminStatVerified', verifiedSchools);
    set('adminStatLearners', totalLearners);
    set('adminStatPending', pending);

    // Learners by class
    const byClass = {};
    learnerList.filter(l => l.status === 'active').forEach(l => {
      byClass[l.class] = (byClass[l.class] || 0) + 1;
    });

    const classEl = document.getElementById('adminStatByClass');
    if (classEl) {
      const entries = Object.entries(byClass).sort((a, b) => {
        const na = parseInt(a[0].replace(/\D/g, ''), 10) || 0;
        const nb = parseInt(b[0].replace(/\D/g, ''), 10) || 0;
        return na - nb;
      });
      classEl.innerHTML = !entries.length
        ? '<p class="text-slate-400 italic">No learners registered yet.</p>'
        : entries.map(([cls, count]) => `
            <div class="flex items-center justify-between">
              <span class="text-slate-700 font-semibold">${escapeHtml(cls)}</span>
              <span class="font-mono font-bold text-navy-800">${count}</span>
            </div>
          `).join('');
    }

    // Learners by school
    const bySchool = {};
    learnerList.filter(l => l.status === 'active').forEach(l => {
      bySchool[l.emis] = (bySchool[l.emis] || 0) + 1;
    });

    const schoolEl = document.getElementById('adminStatBySchool');
    if (schoolEl) {
      const entries = Object.entries(bySchool).sort((a, b) => b[1] - a[1]);
      schoolEl.innerHTML = !entries.length
        ? '<p class="text-slate-400 italic">No learners registered yet.</p>'
        : entries.map(([emis, count]) => {
            const school = AppState.schools.find(s => s.emis === emis);
            return `
              <div class="flex items-center justify-between gap-2">
                <span class="text-slate-700 font-semibold truncate">${escapeHtml(school?.name || emis)}</span>
                <span class="font-mono font-bold text-navy-800 shrink-0">${count}</span>
              </div>
            `;
          }).join('');
    }
  },

  render() {
    this._syncTabs();
    this._renderOverview();
    this._renderApprovals();
    this._renderPasswordRequests();
    this._renderSchools();
    this._renderAnnouncements();
    this._renderContacts();
    this._renderAcademicSettings();
    this._renderNextOpening();
    this._renderBranding();
    this._renderSchemaEditor();
  },

  /* ---------- Approvals ---------- */
  _renderApprovals() {
    const tbody = document.getElementById('adminApprovalsTableBody');
    if (!tbody) return;
    document.getElementById('adminPendingBadge').textContent = AppState.pendingApprovals.length;

    if (!AppState.pendingApprovals.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="py-3 text-center text-slate-400 text-xs">No pending registration requests.</td></tr>';
      return;
    }
    tbody.innerHTML = AppState.pendingApprovals.map(p => `
      <tr class="hover:bg-slate-50">
        <td class="py-2 px-3 font-mono font-bold text-navy-800">${escapeHtml(p.emis)}</td>
        <td class="py-2 px-3 font-semibold">${escapeHtml(p.name)}</td>
        <td class="py-2 px-3">${escapeHtml(p.contactPerson || '')}</td>
        <td class="py-2 px-3 font-mono text-[11px]">${escapeHtml(p.phone || '')}</td>
        <td class="py-2 px-3 text-right space-x-1">
          <button data-action="approve" data-id="${p.id}" class="bg-emerald-600 text-white font-bold text-[10px] px-2.5 py-1 rounded hover:bg-emerald-700">Approve</button>
          <button data-action="reject"  data-id="${p.id}" class="bg-red-600 text-white font-bold text-[10px] px-2.5 py-1 rounded hover:bg-red-700">Reject</button>
        </td>
      </tr>`).join('');
  },

  async _approve(id) {
    try {
      const result = await AdminService.approveRequest(id);

      if (result?.credentials) {
        const msg = result.credentials.existing
          ? `School approved.\n\nNote: User already existed in Supabase.\nLogin: ${result.credentials.email}`
          : `School approved.\n\nGive these credentials to the school:\n\n  Email: ${result.credentials.email}\n  Password: ${result.credentials.password}\n\nThey should change the password on first login.`;

        alert(msg);
      }
      Toast.show('School approved.', 'success');
    } catch (err) {
      Toast.show(err.message, 'error');
    }
  },

  async _reject(id) {
    if (!confirm('Reject this request?')) return;
    try {
      await AdminService.rejectRequest(id);
      Toast.show('Request rejected.', 'info');
    } catch (err) { Toast.show(err.message, 'error'); }
  },
  async _renderPasswordRequests() {
    const tbody = document.getElementById('adminPasswordRequestsTableBody');
    if (!tbody) return;

    try {
      const { supabase } = await import('../core/supabase.js');
      const { data, error } = await supabase
        .from('password_requests')
        .select('*')
        .eq('resolved', false)
        .order('requested_at', { ascending: false });

      if (error) throw error;

      if (!data || !data.length) {
        tbody.innerHTML = '<tr><td colspan="3" class="py-3 text-center text-slate-400 text-xs">No pending requests.</td></tr>';
        return;
      }

      tbody.innerHTML = data.map(r => `
        <tr class="hover:bg-slate-50">
          <td class="py-2 px-3 font-mono font-bold text-navy-800">${escapeHtml(r.emis)}</td>
          <td class="py-2 px-3 text-slate-600 text-[11px]">${new Date(r.requested_at).toLocaleString()}</td>
          <td class="py-2 px-3 text-right">
            <button data-action="reset-pw" data-id="${r.id}" data-emis="${escapeHtml(r.emis)}"
              class="bg-amber-500 hover:bg-amber-600 text-white font-bold text-[10px] px-2.5 py-1 rounded">
              Reset Password
            </button>
            <button data-action="dismiss-pw" data-id="${r.id}"
              class="bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-[10px] px-2.5 py-1 rounded ml-1">
              Dismiss
            </button>
          </td>
        </tr>
      `).join('');

      // Wire actions
      tbody.querySelectorAll('[data-action="reset-pw"]').forEach(btn => {
        btn.addEventListener('click', () => this._resetPasswordRequest(btn.dataset.id, btn.dataset.emis));
      });
      tbody.querySelectorAll('[data-action="dismiss-pw"]').forEach(btn => {
        btn.addEventListener('click', () => this._dismissPasswordRequest(btn.dataset.id));
      });

    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="3" class="py-3 text-center text-red-500 text-xs">${escapeHtml(err.message)}</td></tr>`;
    }
  },

  async _resetPasswordRequest(id, emis) {
    const newPw = prompt(`New password for ${emis} (min 6 chars):`);
    if (!newPw || newPw.length < 6) return;

    try {
      const { supabase } = await import('../core/supabase.js');
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated.');

      // Call the Edge Function to reset the user's password
      const res = await fetch('https://lcjnmdsbcmkbkfcjtdaw.supabase.co/functions/v1/reset-school-password', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ emis, password: newPw }),
      });

      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Reset failed.');

      // Mark request resolved
      await supabase.from('password_requests').update({ resolved: true }).eq('id', id);

      alert(`Password reset.\n\nGive this to ${emis}:\n\n  Email: ${payload.email}\n  Password: ${newPw}`);
      this._renderPasswordRequests();
    } catch (err) {
      alert('Reset failed: ' + err.message);
    }
  },

  async _dismissPasswordRequest(id) {
    if (!confirm('Dismiss this request without resetting the password?')) return;
    try {
      const { supabase } = await import('../core/supabase.js');
      await supabase.from('password_requests').update({ resolved: true }).eq('id', id);
      this._renderPasswordRequests();
    } catch (err) {
      alert(err.message);
    }
  },

  /* ---------- Schools ---------- */
  _renderSchools() {
    const tbody = document.getElementById('adminSchoolsTableBody');
    if (!tbody) return;
    if (!AppState.schools.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="py-3 text-center text-slate-400 text-xs">No schools yet.</td></tr>';
      return;
    }
    tbody.innerHTML = AppState.schools.map(s => `
      <tr class="hover:bg-slate-50">
        <td class="py-2 px-3 font-mono font-bold text-navy-800">${escapeHtml(s.emis)}</td>
        <td class="py-2 px-3 font-semibold">${escapeHtml(s.name)}</td>
        <td class="py-2 px-3">${escapeHtml(s.contactPerson || '')}</td>
        <td class="py-2 px-3 text-center">
          ${s.verified ? '<span class="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full">Verified</span>'
                       : '<span class="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-full">Pending</span>'}
        </td>
        <td class="py-2 px-3 text-right">
          <button data-action="remove-school" data-emis="${escapeHtml(s.emis)}" class="text-red-600 hover:text-red-800 font-bold text-[11px]">Remove</button>
        </td>
      </tr>`).join('');
  },

  async _addSchool(e) {
    e.preventDefault();
    const emis = document.getElementById('adminEmis').value.trim().toUpperCase();
    const name = document.getElementById('adminSchoolName').value.trim();
    const contactPerson = document.getElementById('adminContactPerson').value.trim();
    const zone = document.getElementById('adminSchoolZone')?.value.trim() || 'Bandawe';

    try {
      const result = await AdminService.addSchool({ emis, zone, name, contactPerson });
      e.target.reset();
      Toast.show(`School ${name} (${emis}) added.`, 'success');
      if (result?.credentials) {
        alert(`School created.\n\nLogin credentials:\n  Email: ${result.credentials.email}\n  Password: ${result.credentials.password}\n\nShare these with the school. They should change the password on first login.`);
      }
    } catch (err) { Toast.show(err.message, 'error'); }
  },

  async _removeSchool(emis) {
    if (!confirm(`Delete school ${emis}? This does not delete learners.`)) return;
    try {
      await AdminService.removeSchool(emis);
      Toast.show('School removed.', 'info');
    } catch (err) { Toast.show(err.message, 'error'); }
  },

  /* ---------- Announcements ---------- */
  _renderAnnouncements() {
    const c = document.getElementById('adminAnnouncementsList');
    if (!c) return;
    if (!AppState.announcements.length) {
      c.innerHTML = '<p class="text-xs text-slate-400 italic">No announcements posted.</p>';
      return;
    }
    c.innerHTML = AppState.announcements.map(a => `
      <div class="p-2.5 bg-slate-50 rounded border flex items-start justify-between text-xs gap-2">
        <div class="min-w-0">
          <div class="font-bold text-navy-800 truncate">${escapeHtml(a.title)}</div>
          <div class="text-[10px] text-slate-500">${escapeHtml(a.date)} • ${escapeHtml(a.body)}</div>
        </div>
        <button data-action="del-announce" data-id="${a.id}" class="text-red-600 hover:text-red-800 font-bold text-[11px] shrink-0">Delete</button>
      </div>`).join('');
  },

  async _postAnnouncement(e) {
    e.preventDefault();
    const title = document.getElementById('announcementTitle').value.trim();
    const body  = document.getElementById('announcementBody').value.trim();
    try {
      await AdminService.postAnnouncement(title, body);
      e.target.reset();
      Toast.show('Announcement posted.', 'success');
    } catch (err) { Toast.show(err.message, 'error'); }
  },

  async _deleteAnnouncement(id) {
    if (!confirm('Delete this announcement?')) return;
    try {
      await AdminService.deleteAnnouncement(id);
      Toast.show('Announcement deleted.', 'info');
    } catch (err) { Toast.show(err.message, 'error'); }
  },

  /* ---------- Contacts ---------- */
  _renderContacts() {
    const c = document.getElementById('adminTechContactsList');
    if (!c) return;
    if (!AppState.techSupportContacts.length) {
      c.innerHTML = '<p class="text-xs text-slate-400 italic">No support contacts.</p>';
      return;
    }
    c.innerHTML = AppState.techSupportContacts.map(t => `
      <div class="p-2.5 bg-slate-50 rounded border flex items-center justify-between text-xs gap-2">
        <div>
          <span class="font-bold text-navy-800">${escapeHtml(t.name)}</span>
          <span class="text-slate-500">(${escapeHtml(t.role)})</span>
          <span class="font-mono text-gold-600">${escapeHtml(t.phone)}</span>
        </div>
        <button data-action="del-contact" data-id="${t.id}" class="text-red-600 hover:text-red-800 font-bold text-[11px]">Remove</button>
      </div>`).join('');
  },

  async _addContact(e) {
    e.preventDefault();
    const name  = document.getElementById('techOfficerName').value.trim();
    const role  = document.getElementById('techOfficerRole').value.trim();
    const phone = document.getElementById('techOfficerPhone').value.trim();
    try {
      await AdminService.addContact({ name, role, phone });
      e.target.reset();
      Toast.show('Contact added.', 'success');
    } catch (err) { Toast.show(err.message, 'error'); }
  },

  async _deleteContact(id) {
    try {
      await AdminService.deleteContact(id);
      Toast.show('Contact removed.', 'info');
    } catch (err) { Toast.show(err.message, 'error'); }
  },

  /* ---------- Academic ---------- */
  _renderAcademicSettings() {
    const y = document.getElementById('adminSettingYear');
    const t = document.getElementById('adminSettingTerm');
    if (y) y.value = AppState.academicConfig.year;
    if (t) t.value = AppState.academicConfig.term;
  },

  async _saveAcademic(e) {
    e.preventDefault();
    const year = document.getElementById('adminSettingYear').value.trim();
    const term = document.getElementById('adminSettingTerm').value;
    try {
      await AdminService.saveAcademicConfig({ year, term });
      Toast.show('Academic configuration saved.', 'success');
    } catch (err) { Toast.show(err.message, 'error'); }
  },

  _renderNextOpening() {
    const d = document.getElementById('adminNextOpeningDate');
    const n = document.getElementById('adminNextOpeningNote');
    if (d) d.value = AppState.nextOpening?.date || '';
    if (n) n.value = AppState.nextOpening?.note || '';
  },

  async _saveNextOpening(e) {
    e.preventDefault();
    const date = document.getElementById('adminNextOpeningDate').value;
    const note = document.getElementById('adminNextOpeningNote').value.trim();
    try {
      await AdminService.saveNextOpening({ date, note });
      Toast.show('Next opening date saved.', 'success');
    } catch (err) { Toast.show(err.message, 'error'); }
  },

  /* ---------- Branding ---------- */
  _renderBranding() {
    const slot = document.getElementById('emblemSlot');
    if (!slot) return;
    const emblem = ImageStoreService.getEmblem();
    slot.innerHTML = emblem
      ? `<img src="${emblem}" class="max-h-24 mx-auto border border-slate-200 rounded" alt="Emblem">`
      : `<div class="text-[10px] text-slate-400 italic text-center py-6 border border-dashed border-slate-300 rounded">No emblem uploaded.</div>`;
  },

  async _uploadEmblem(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await ImageStoreService.setEmblemFromFile(file);
      Toast.show(`Emblem uploaded (${Math.round(file.size/1024)} KB).`, 'success');
      this._renderBranding();
    } catch (err) {
      console.error(err);
      Toast.show(err.message, 'error');
    } finally { e.target.value = ''; }
  },

  async _clearEmblem() {
    if (!confirm('Remove the government emblem?')) return;
    try {
      await ImageStoreService.clearEmblem();
      Toast.show('Emblem removed.', 'info');
      this._renderBranding();
    } catch (err) { Toast.show(err.message, 'error'); }
  },

  /* ---------- Schema ---------- */
  _renderSchemaEditor() {
    const sel = document.getElementById('adminSchemaClassSelect');
    if (!sel) return;
    if (sel.options.length <= 1) {
      sel.innerHTML = CLASSES.map(c => `<option value="${c}">${c}</option>`).join('');
    }
    const cls = sel.value || CLASSES[0];
    const schema = AppState.customSchema?.[cls] || CLASS_EXAM_SCHEMA[cls];
    if (!schema) return;

    document.getElementById('adminSchemaMax').value = schema.maxPerSubject;
    document.getElementById('adminSchemaSubjects').innerHTML = SUBJECTS.map(s => `
      <label class="flex items-center gap-2 text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1.5">
        <input type="checkbox" value="${s.code}" ${schema.subjects.includes(s.code) ? 'checked' : ''}>
        <span class="font-semibold">${escapeHtml(s.short)}</span>
        <span class="text-[10px] text-slate-500">${escapeHtml(s.name)}</span>
      </label>`).join('');
  },

  async _saveSchema() {
    const cls = document.getElementById('adminSchemaClassSelect').value;
    const maxPerSubject = parseInt(document.getElementById('adminSchemaMax').value, 10);
    const subjects = [...document.querySelectorAll('#adminSchemaSubjects input:checked')].map(i => i.value);
    if (!subjects.length) return Toast.show('Select at least one subject.', 'error');
    if (!maxPerSubject || maxPerSubject < 1) return Toast.show('Invalid max.', 'error');

    try {
      await AdminService.saveSchemaForClass(cls, { subjects, maxPerSubject });
      Toast.show(`Schema for ${cls} saved.`, 'success');
    } catch (err) { Toast.show(err.message, 'error'); }
  },

  /* ---------- Backup ---------- */
  async _exportBackup() {
    await BackupService.exportAll();
    Toast.show('Backup downloaded.', 'success');
  },

  async _importBackup(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm('Importing will OVERWRITE all current data. Continue?')) { e.target.value = ''; return; }
    try {
      const summary = await BackupService.importFromFile(file);
      Toast.show(`Restored ${summary.schools} schools and ${summary.learners} learners.`, 'success');
    } catch (err) { Toast.show('Import failed: ' + err.message, 'error'); }
    finally { e.target.value = ''; }
  },
};