import { AppState, LSKEYS, readLocal } from '../core/state.js';
import { supabase, requireAuth } from '../core/supabase.js';

/**
 * Storage service — Supabase-backed.
 *
 * Design:
 *   - Reads: hit Supabase, cache result in AppState + localStorage.
 *   - Writes: hit Supabase first (authoritative), then update AppState.
 *   - Errors propagate so callers can show toasts.
 */

export const Storage = {

  /* ---------- BOOT: load everything the app needs ---------- */
  async loadAll() {
    try {
      const emis = AppState.currentSession?.emis;

      // Parallel fetch — all independent
      const [
        zonesRes,
        schoolsRes,
        pendingRes,
        announcementsRes,
        contactsRes,
        settingsRes,
        imagesRes,
      ] = await Promise.all([
        supabase.from('zones').select('*'),
        supabase.from('schools').select('*'),
        supabase.from('pending_schools').select('*'),
        supabase.from('announcements').select('*').order('posted_at', { ascending: false }),
        supabase.from('tech_contacts').select('*').order('created_at', { ascending: true }),
        supabase.from('app_settings').select('*').eq('id', 1).maybeSingle(),
        supabase.from('images').select('*'),
      ]);
      for (const result of [zonesRes, schoolsRes, pendingRes, announcementsRes, contactsRes, settingsRes, imagesRes]) {
      if (result.error) throw result.error;
      }

      if (zonesRes.data)         AppState.zones = zonesRes.data.map(z => ({ code: z.code, name: z.name, emisPrefix: z.emis_prefix }));
      if (schoolsRes.data)       AppState.schools = schoolsRes.data.map(shapeSchool);
      if (pendingRes.data)       AppState.pendingApprovals = pendingRes.data.map(shapePending);
      if (announcementsRes.data) AppState.announcements = announcementsRes.data.map(shapeAnnouncement);
      if (contactsRes.data)      AppState.techSupportContacts = contactsRes.data.map(shapeContact);
      if (settingsRes.data) {
        AppState.academicConfig.year = settingsRes.data.academic_year;
        AppState.academicConfig.term = settingsRes.data.active_term;
        AppState.nextOpening = settingsRes.data.next_opening || { date: '', note: '' };
        AppState.customSchema = settingsRes.data.custom_schema || {};
      }
      // Images — read URLs from the images table (no extension guessing needed)
      AppState.images = { emblem: null, schools: {} };
      if (imagesRes.data) {
        imagesRes.data.forEach(row => {
          if (row.scope === 'emblem') {
            AppState.images.emblem = row.url || null;
          } else if (row.scope === 'school') {
            if (!AppState.images.schools[row.ref]) AppState.images.schools[row.ref] = {};
            AppState.images.schools[row.ref][row.slot] = row.url || null;
          }
        });
      }
      

      // School-scoped data — only if a school is logged in
      if (emis) {
        await this._loadSchoolData(emis);
      }

      AppState.ready = true;
      return true;
    } catch (err) {
      console.error('[storage] loadAll failed:', err);
      // Fall back to whatever localStorage has (offline support)
      this._hydrateFromLocalCache();
      AppState.ready = true;
      return false;
    }
  },
  async loadPublic() {
    try {
      const [zonesRes, schoolsRes, announcementsRes, contactsRes, settingsRes, imagesRes, zonalRes] = await Promise.all([
        supabase.from('zones').select('*'),
        supabase.from('schools').select('*'),
        supabase.from('announcements').select('*').order('posted_at', { ascending: false }),
        supabase.from('tech_contacts').select('*').order('created_at', { ascending: true }),
        supabase.from('app_settings').select('*').eq('id', 1).maybeSingle(),
        supabase.from('images').select('*').eq('scope', 'emblem'),
        supabase.rpc('zonal_stats'),
      ]);

      if (zonesRes.data)         AppState.zones = zonesRes.data.map(z => ({ code: z.code, name: z.name, emisPrefix: z.emis_prefix }));
      if (schoolsRes.data)       AppState.schools = schoolsRes.data.map(shapeSchool);
      if (announcementsRes.data) AppState.announcements = announcementsRes.data.map(shapeAnnouncement);
      if (contactsRes.data)      AppState.techSupportContacts = contactsRes.data.map(shapeContact);
      if (settingsRes.data) {
        AppState.academicConfig.year = settingsRes.data.academic_year;
        AppState.academicConfig.term = settingsRes.data.active_term;
        AppState.nextOpening = settingsRes.data.next_opening || { date: '', note: '' };
        AppState.customSchema = settingsRes.data.custom_schema || {};
      }
      if (imagesRes.data) {
        const emblemRow = imagesRes.data.find(r => r.scope === 'emblem');
        AppState.images.emblem = emblemRow?.url || null;
      }
      if (zonalRes.data) {
        AppState.zonalStats = zonalRes.data;
      }
    } catch (err) {
      console.warn('[storage] loadPublic failed:', err.message);
    }
  },
    /** Load ALL learners across ALL schools — superadmin only. */
  async loadAllLearnersForAdmin() {
    const { data, error } = await DB.from('learners').select('*');
    if (error) {
      console.warn('[storage] loadAllLearnersForAdmin failed:', error.message);
      return;
    }
    AppState.allLearners = (data || []).map(shapeLearner);
  },

  async _loadSchoolData(emis) {
    const [learnersRes, countersRes, caRes, examRes, mockRes, remarksRes] = await Promise.all([
      supabase.from('learners').select('*').eq('emis', emis),
      supabase.from('lin_counters').select('*').eq('emis', emis),
      supabase.from('marks_ca').select('*').eq('emis', emis),
      supabase.from('marks_exam').select('*').eq('emis', emis),
      supabase.from('marks_mock').select('*').eq('emis', emis),
      supabase.from('remarks').select('*').eq('emis', emis),
    ]);
    for (const result of [learnersRes, countersRes, caRes, examRes, mockRes, remarksRes]) {
    if (result.error) throw result.error;
    }

    AppState.learners = (learnersRes.data || []).map(shapeLearner);

    AppState.linCounters = {};
    (countersRes.data || []).forEach(c => {
      AppState.linCounters[`${c.emis}::${c.class}`] = c.counter;
    });

    AppState.marks = { ca: {}, exam: {}, mock: {} };
    (caRes.data || []).forEach(m => {
      AppState.marks.ca[m.lin] ??= {};
      AppState.marks.ca[m.lin][m.subject] ??= {};
      AppState.marks.ca[m.lin][m.subject][m.month] = m.score;
    });
    (examRes.data || []).forEach(m => {
      AppState.marks.exam[m.lin] ??= {};
      AppState.marks.exam[m.lin][m.subject] = m.score;
    });
    (mockRes.data || []).forEach(m => {
      AppState.marks.mock[m.lin] ??= {};
      AppState.marks.mock[m.lin][m.subject] = m.score;
    });

    AppState.remarks = {};
    (remarksRes.data || []).forEach(r => {
      AppState.remarks[r.emis] ??= {};
      AppState.remarks[r.emis][r.lin] ??= {};
      AppState.remarks[r.emis][r.lin][r.year] ??= {};
      AppState.remarks[r.emis][r.lin][r.year][r.term] = {
        classTeacher: r.class_teacher || '',
        headTeacher: r.head_teacher || '',
      };
    });
  },

  _hydrateFromLocalCache() {
    AppState.schools = readLocal(LSKEYS.schools, []);
    AppState.pendingApprovals = readLocal(LSKEYS.pending, []);
    AppState.announcements = readLocal(LSKEYS.announcements, []);
    AppState.techSupportContacts = readLocal(LSKEYS.tech, []);
    AppState.learners = readLocal(LSKEYS.learners, []);
    AppState.linCounters = readLocal(LSKEYS.counters, {});
    AppState.marks = readLocal(LSKEYS.marks, { ca: {}, exam: {}, mock: {} });
    AppState.remarks = readLocal(LSKEYS.remarks, {});
    AppState.images = readLocal(LSKEYS.images, { emblem: null, schools: {} });
    AppState.nextOpening = readLocal(LSKEYS.nextOpening, { date: '', note: '' });
    AppState.customSchema = readLocal(LSKEYS.customSchema, {});
    AppState.academicConfig = readLocal(LSKEYS.academic, AppState.academicConfig);
  },

  /* ---------- LEARNERS ---------- */
  async saveLearners() {
    // NOTE: writes are done via dedicated methods in learner.service.js
    // This is kept for compatibility but persists local cache only.
    this._cacheLocal(LSKEYS.learners, AppState.learners);
  },

  /* ---------- LIN COUNTERS ---------- */
  async saveLinCounters() {
    this._cacheLocal(LSKEYS.counters, AppState.linCounters);
  },

  /* ---------- MARKS ---------- */
  async saveMarks() {
    this._cacheLocal(LSKEYS.marks, AppState.marks);
  },

  /* ---------- REMARKS ---------- */
  async saveRemarks() {
    this._cacheLocal(LSKEYS.remarks, AppState.remarks);
  },

  /* ---------- IMAGES ---------- */
  async saveImages() {
    this._cacheLocal(LSKEYS.images, AppState.images);
  },

  /* ---------- ANNOUNCEMENTS ---------- */
  async saveAnnouncements() {
    this._cacheLocal(LSKEYS.announcements, AppState.announcements);
  },

  /* ---------- SETTINGS ---------- */
  async saveAcademicConfig() {
    await requireAuth();
    const { error } = await DB.from('app_settings').update({
      academic_year: AppState.academicConfig.year,
      active_term: AppState.academicConfig.term,
      updated_at: new Date().toISOString(),
    }).eq('id', 1);
    if (error) throw error;
    this._cacheLocal(LSKEYS.academic, AppState.academicConfig);
  },

  async saveNextOpening() {
    await requireAuth();
    const { error } = await DB.from('app_settings').update({
      next_opening: AppState.nextOpening,
      updated_at: new Date().toISOString(),
    }).eq('id', 1);
    if (error) throw error;
    this._cacheLocal(LSKEYS.nextOpening, AppState.nextOpening);
  },

  async saveCustomSchema() {
    await requireAuth();
    const { error } = await DB.from('app_settings').update({
      custom_schema: AppState.customSchema,
      updated_at: new Date().toISOString(),
    }).eq('id', 1);
    if (error) throw error;
    this._cacheLocal(LSKEYS.customSchema, AppState.customSchema);
  },

  /* ---------- MISC ---------- */
  async save(key, value) {
    this._cacheLocal(key, value);
  },

  async setSession(session) {
    AppState.currentSession = session;
    try {
      if (session) localStorage.setItem(LSKEYS.session, JSON.stringify(session));
      else localStorage.removeItem(LSKEYS.session);
    } catch {}
  },

  _cacheLocal(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
  /* ---------- LEGACY STUBS (replaced in Phase 3D) ---------- */
  // These keep the old admin.ui.js code working during the transition.
  // In Phase 3D, admin.ui.js will call Supabase directly and these disappear.

  async saveSchools()      { this._cacheLocal(LSKEYS.schools, AppState.schools); },
  async savePending()      { this._cacheLocal(LSKEYS.pending, AppState.pendingApprovals); },
  async saveTechContacts() { this._cacheLocal(LSKEYS.tech, AppState.techSupportContacts); },
  async saveZones()        { this._cacheLocal(LSKEYS.zones, AppState.zones); },
};

/* ---------- shape helpers ---------- */
function shapeSchool(r) {
  return {
    emis: r.emis, zone: r.zone, name: r.name,
    contactPerson: r.contact_person, phone: r.phone, email: r.email,
    verified: r.verified,
  };
}
function shapePending(r) {
  return {
    id: r.id, emis: r.emis, zone: r.zone, name: r.name,
    contactPerson: r.contact_person, phone: r.phone, email: r.email,
    requestedAt: r.requested_at?.split('T')[0] || '',
  };
}
function shapeAnnouncement(r) {
  return {
    id: r.id, title: r.title, body: r.body,
    date: new Date(r.posted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
  };
}
function shapeContact(r) {
  return { id: r.id, name: r.name, role: r.role, phone: r.phone };
}
function shapeLearner(r) {
  return {
    lin: r.lin, emis: r.emis, zone: r.zone, name: r.name,
    gender: r.gender, class: r.class, status: r.status,
    enrollmentType: r.enrollment_type,
    previousSchool: r.previous_school, previousLin: r.previous_lin,
    enrolledAt: r.enrolled_at, updatedAt: r.updated_at,
  };

}