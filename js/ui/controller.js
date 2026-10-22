import { AppState } from '../core/state.js';
import { Storage } from '../services/storage.js';
import { Events, EVT } from '../core/events.js';
import { Toast } from './toast.js';
import { EnrollmentUI } from './enrollment.ui.js';
import { MarksUI } from './marks.ui.js';
import { AnalyticsUI } from './analytics.ui.js';
import { BroadsheetUI } from './broadsheet.ui.js';
import { ReportsUI } from './reports.ui.js';
import { SettingsUI } from './settings.ui.js';
import { AdminUI } from './admin.ui.js';
import { escapeHtml, fmtDate } from './helpers.js';

export const Controller = {

  init() {
    this.syncAcademicBadges();
    this.renderLandingPage();
    this.renderFooterTechSupport();
    this.syncHeaderState();
    this.renderNextOpeningBanner();

    EnrollmentUI.init();
    MarksUI.init();
    AnalyticsUI.init();
    BroadsheetUI.init();
    ReportsUI.init();
    SettingsUI.init();
    AdminUI.init();

    Events.on(EVT.SCHOOLS_CHANGED,  () => { this.renderLandingPage(); this.renderFooterTechSupport(); });
    Events.on(EVT.PENDING_CHANGED,  () => { this.renderLandingPage(); });
    Events.on(EVT.ANNOUNCE_CHANGED, () => { this.renderLandingPage(); });
    Events.on(EVT.SETTINGS_CHANGED, () => { this.syncAcademicBadges(); this.renderNextOpeningBanner(); });
    Events.on(EVT.IMAGES_CHANGED,   () => { this.renderBrandLogo(); });

    if (AppState.currentSession?.requiresPasswordChange) {
      this.showModal('firstLoginModal');
    }
  },

  /* ---------- views ---------- */
  showView(viewId) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
    const target = document.getElementById(`view-${viewId}`);
    if (!target) return;

    if (viewId === 'dashboard' && !AppState.currentSession) {
      this.showView('login');
      Toast.show('Please sign in to access the School Dashboard.', 'error');
      return;
    }

    target.classList.remove('hidden');
    this.syncHeaderState();

    if (viewId === 'dashboard') {
      this.renderDashboard();
      SettingsUI.render();
    }
    if (viewId === 'landing') this.renderLandingPage();
  },

  switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.className = 'tab-btn px-3 py-1.5 rounded-md text-slate-600 hover:bg-slate-200 transition';
    });
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));

    const btn = document.getElementById(`tabBtn-${tabId}`);
    const content = document.getElementById(`tabContent-${tabId}`);
    if (btn) btn.className = 'tab-btn px-3 py-1.5 rounded-md bg-navy-800 text-white font-bold transition';
    if (content) content.classList.remove('hidden');

    if (tabId === 'enrollment')  EnrollmentUI.render();
    if (tabId === 'upload')      MarksUI.render();
    if (tabId === 'computation') AnalyticsUI.render();
    if (tabId === 'broadsheet')  BroadsheetUI.render();
    if (tabId === 'reports')     ReportsUI.render();
  },

  /* ---------- modals ---------- */
  showModal(id) { document.getElementById(id)?.classList.remove('hidden'); },
  closeModal(id) { document.getElementById(id)?.classList.add('hidden'); },
  showRegisterModal() { this.showModal('registerModal'); },
  async showAdminLoginModal() {
  const { supabase } = await import('../core/supabase.js');
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    const { data: isSuper } = await supabase.rpc('am_i_superadmin');
    if (isSuper) {
      await Storage.loadAll();
      try { await Storage.loadAllLearnersForAdmin(); } catch {}
      this.showAdminConsole();
      return;
    }
  }
  this.showModal('adminLoginModal');
  },
  showAdminConsole() { this.showModal('adminModal'); AdminUI.render(); },
  showSchoolSettings() { this.showModal('schoolSettingsModal'); SettingsUI.render(); },

  /* ---------- landing ---------- */
  renderLandingPage() {
    this.renderSchoolsTable();
    this.renderLandingAnnouncements();
    this.renderZonalStats();
    this.renderNextOpeningBanner();
    this.renderBrandLogo();  
  },

  renderNextOpeningBanner() {
    const bar = document.getElementById('nextOpeningBanner');
    if (!bar) return;
    const no = AppState.nextOpening;
    if (!no || !no.date) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    bar.innerHTML = `
      <i class="fa-solid fa-calendar-day text-gold-500"></i>
      <span class="text-xs font-semibold">
        Next Term Opens: <strong>${escapeHtml(no.date)}</strong>
        ${no.note ? ' — ' + escapeHtml(no.note) : ''}
      </span>`;
  },

  renderSchoolsTable(query = '') {
    const tbody = document.getElementById('schoolsTableBody');
    if (!tbody) return;
    const q = query.toLowerCase();

    const filtered = AppState.schools.filter(s =>
      (s.name || '').toLowerCase().includes(q) ||
      (s.emis || '').toLowerCase().includes(q) ||
      (s.contactPerson || '').toLowerCase().includes(q)
    );

    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="py-4 text-center text-slate-400">No matching schools found.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(s => `
      <tr class="hover:bg-slate-50 transition">
        <td class="py-3 px-4 font-mono font-bold text-navy-800">${escapeHtml(s.emis)}</td>
        <td class="py-3 px-4 font-semibold text-slate-800">${escapeHtml(s.name)}</td>
        <td class="py-3 px-4 text-slate-600">${escapeHtml(s.zone || 'Bandawe')}</td>
        <td class="py-3 px-4 font-medium text-slate-700">${escapeHtml(s.contactPerson || '')}</td>
        <td class="py-3 px-4 text-center">
          ${s.verified
            ? '<span class="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full">Verified</span>'
            : '<span class="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-full">Pending</span>'}
        </td>
        <td class="py-3 px-4 text-right">
          <button data-emis="${escapeHtml(s.emis)}"
            class="quick-login bg-navy-800 hover:bg-navy-900 text-white text-[11px] font-bold px-3 py-1 rounded transition">
            Login Access
          </button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('.quick-login').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('emisCode').value = btn.dataset.emis;
        this.showView('login');
      });
    });
  },

  renderLandingAnnouncements() {
    const c = document.getElementById('landingAnnouncementsList');
    if (!c) return;
    if (!AppState.announcements.length) {
      c.innerHTML = '<p class="text-xs text-slate-400 italic">No current announcements.</p>';
      return;
    }
    c.innerHTML = AppState.announcements.map(a => `
      <div class="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-1">
        <div class="flex items-center justify-between text-navy-800 font-bold">
          <span>${escapeHtml(a.title)}</span>
          <span class="text-[10px] text-slate-400 font-normal">${escapeHtml(a.date)}</span>
        </div>
        <p class="text-slate-600 text-[11px] leading-relaxed">${escapeHtml(a.body)}</p>
      </div>
    `).join('');
  },

  renderZonalStats() {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('statRegisteredSchools', AppState.schools.length);
    set('statVerifiedSchools', AppState.schools.filter(s => s.verified).length);
    set('statTotalCandidates', AppState.learners.filter(l => l.status === 'active').length);
  },

  renderFooterTechSupport() {
    const c = document.getElementById('footerTechSupport');
    if (!c) return;
    c.innerHTML = AppState.techSupportContacts.map(t => `
      <div class="bg-navy-800/80 p-2.5 rounded border border-navy-700 flex items-start space-x-2">
        <i class="fa-solid fa-headset text-gold-400 mt-1"></i>
        <div>
          <div class="font-bold text-white">${escapeHtml(t.name)}</div>
          <div class="text-[10px] text-slate-400">${escapeHtml(t.role)}</div>
          <div class="text-gold-400 font-mono font-semibold mt-0.5">${escapeHtml(t.phone)}</div>
        </div>
      </div>
    `).join('');
  },

  renderDashboard() {
    const s = AppState.currentSession;
    if (!s) return;
    const name = document.getElementById('dashSchoolTitle');
    const emis = document.getElementById('dashEmisCode');
    if (name) name.textContent = s.name;
    if (emis) emis.textContent = s.emis;
    EnrollmentUI.render();
  },

async syncHeaderState() {
  const session = AppState.currentSession;
  const userProfile = document.getElementById('userHeaderProfile');
  const navLogin = document.getElementById('navLoginBtn');
  if (!userProfile || !navLogin) return;

  const dashBtn = userProfile.querySelector('button[onclick*="dashboard"]');
  const settingsBtn = document.getElementById('btnOpenSettings');

  // Reset visibility
  userProfile.classList.add('hidden');
  navLogin.classList.remove('hidden');
  if (dashBtn) dashBtn.classList.remove('hidden');
  if (settingsBtn) settingsBtn.classList.remove('hidden');

  if (session) {
    // School user — show dashboard + settings + logout
    userProfile.classList.remove('hidden');
    navLogin.classList.add('hidden');
    const n = document.getElementById('userSchoolName');
    const e = document.getElementById('userEmisCode');
    if (n) n.textContent = session.name;
    if (e) e.textContent = session.emis;
    return;
  }

  // Check for superadmin session
  try {
    const { supabase } = await import('../core/supabase.js');
    const { data: { session: supabaseSession } } = await supabase.auth.getSession();
    if (supabaseSession) {
      const { data: isSuper } = await supabase.rpc('am_i_superadmin');
      if (isSuper) {
        // Superadmin — show only "Superadmin / Console" + logout, hide dashboard + settings
        userProfile.classList.remove('hidden');
        navLogin.classList.add('hidden');
        const n = document.getElementById('userSchoolName');
        const e = document.getElementById('userEmisCode');
        if (n) n.textContent = 'Superadmin';
        if (e) e.textContent = 'Console access';
        if (dashBtn) dashBtn.classList.add('hidden');
        if (settingsBtn) settingsBtn.classList.add('hidden');
      }
    }
  } catch (err) {
    console.warn('[syncHeaderState] superadmin check failed:', err.message);
  }
},

  syncAcademicBadges() {
    const y = AppState.academicConfig.year;
    const t = AppState.academicConfig.term;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('landingAcademicYearBadge', y);
    set('landingTermBadge', t);
    set('dashAcademicContext', `Academic Year ${y} • ${t}`);
  },
    renderBrandLogo() {
    const wrap = document.getElementById('navBrandLogoWrap');
    const icon = document.getElementById('navBrandFallbackIcon');
    const img  = document.getElementById('navBrandLogoImg');
    if (!wrap || !icon || !img) return;

    // Pull the emblem directly from state (avoids a hard import loop)
    const emblem = AppState.images?.emblem || null;

    if (emblem) {
      img.src = emblem;
      img.classList.remove('hidden');
      icon.classList.add('hidden');
      // Logo already has its own background; remove gold so it doesn't clash
      wrap.classList.remove('bg-gold-500');
      wrap.classList.add('bg-white');
    } else {
      img.classList.add('hidden');
      img.removeAttribute('src');
      icon.classList.remove('hidden');
      wrap.classList.remove('bg-white');
      wrap.classList.add('bg-gold-500');
    }
  },
};