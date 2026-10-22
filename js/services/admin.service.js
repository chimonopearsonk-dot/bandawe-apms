import { AppState } from '../core/state.js';
import { DB } from './db.js';
import { supabase, requireAuth } from '../core/supabase.js';
import { Storage } from './storage.js';
import { Events, EVT } from '../core/events.js';

/**
 * Superadmin operations. All writes go to Supabase.
 */

const EMAIL_DOMAIN = 'bandawe.zone';

export const AdminService = {

  /* ---------- SCHOOLS ---------- */
    async addSchool({ emis, zone, name, contactPerson, phone = '', email = '' }) {
    await requireAuth();
    const target = String(emis).trim().toUpperCase();

    const { data: schoolRow, error } = await DB
      .from('schools')
      .insert({
        emis: target, zone: zone || 'Bandawe', name: name.trim(),
        contact_person: contactPerson?.trim() || null,
        phone: phone || null, email: email || null, verified: true,
      }).select().single();

    if (error) {
      if (error.code === '23505') throw new Error(`EMIS ${target} is already registered.`);
      throw new Error('Add school failed: ' + error.message);
    }

    const credentials = await this._createSchoolUser(target, schoolRow.name);

    AppState.schools.push({
      emis: schoolRow.emis, zone: schoolRow.zone, name: schoolRow.name,
      contactPerson: schoolRow.contact_person, phone: schoolRow.phone,
      email: schoolRow.email, verified: schoolRow.verified,
    });
    Events.emit(EVT.SCHOOLS_CHANGED, {});
    return { schoolRow, credentials };
  },

  async removeSchool(emis) {
    await requireAuth();
    const { error } = await DB.from('schools').delete().eq('emis', emis);
    if (error) throw new Error('Remove school failed: ' + error.message);

    AppState.schools = AppState.schools.filter(s => s.emis !== emis);
    Events.emit(EVT.SCHOOLS_CHANGED, {});
  },

  /* ---------- APPROVALS ---------- */
    async approveRequest(id) {
    await requireAuth();

    const { data: req, error: readErr } = await DB
      .from('pending_schools').select('*').eq('id', id).single();
    if (readErr || !req) throw new Error('Request not found.');

    const { error: insErr } = await DB.from('schools').insert({
      emis: req.emis, zone: req.zone || 'Bandawe', name: req.name,
      contact_person: req.contact_person, phone: req.phone, email: req.email, verified: true,
    });
    if (insErr) throw new Error('Approve failed: ' + insErr.message);

    // Create the school's login user
    const credentials = await this._createSchoolUser(req.emis, req.name);

    const { error: delErr } = await DB.from('pending_schools').delete().eq('id', id);
    if (delErr) throw new Error('Cleanup failed: ' + delErr.message);

    AppState.schools.push({
      emis: req.emis, zone: req.zone, name: req.name,
      contactPerson: req.contact_person, phone: req.phone, email: req.email, verified: true,
    });
    AppState.pendingApprovals = AppState.pendingApprovals.filter(p => p.id !== id);

    Events.emit(EVT.SCHOOLS_CHANGED, {});
    Events.emit(EVT.PENDING_CHANGED, {});

    return { credentials };
  },

  async rejectRequest(id) {
    await requireAuth();
    const { error } = await DB.from('pending_schools').delete().eq('id', id);
    if (error) throw new Error('Reject failed: ' + error.message);

    AppState.pendingApprovals = AppState.pendingApprovals.filter(p => p.id !== id);
    Events.emit(EVT.PENDING_CHANGED, {});
  },

  /**
   * Create the auth user for a school. Uses EMIS-based synthetic email.
   * If the user already exists, we skip (no-op).
   * Default password: Password123 — school is prompted to change on first login.
   */
    async _createSchoolUser(emis, schoolName) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated.');

    const url = 'https://lcjnmdsbcmkbkfcjtdaw.supabase.co/functions/v1/create-school-user';

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ emis, name: schoolName }),
    });

    const payload = await res.json();

    if (!res.ok) {
      throw new Error('Create school user failed: ' + (payload.error || res.statusText));
    }

    // Return the credentials so the caller can display them once
    return {
      email: payload.email,
      password: payload.password,
      existing: !!payload.existing,
    };
  },
  /* ---------- ANNOUNCEMENTS ---------- */
  async postAnnouncement(title, body) {
    await requireAuth();
    const { data, error } = await DB
      .from('announcements')
      .insert({ title, body })
      .select()
      .single();
    if (error) throw new Error('Post failed: ' + error.message);

    AppState.announcements.unshift({
      id: data.id, title: data.title, body: data.body,
      date: new Date(data.posted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    });
    Events.emit(EVT.ANNOUNCE_CHANGED, {});
    return data;
  },

  async deleteAnnouncement(id) {
    await requireAuth();
    const { error } = await DB.from('announcements').delete().eq('id', id);
    if (error) throw new Error('Delete failed: ' + error.message);

    AppState.announcements = AppState.announcements.filter(a => a.id !== id);
    Events.emit(EVT.ANNOUNCE_CHANGED, {});
  },

  /* ---------- TECH CONTACTS ---------- */
  async addContact({ name, role, phone }) {
    await requireAuth();
    const { data, error } = await DB
      .from('tech_contacts')
      .insert({ name, role, phone })
      .select()
      .single();
    if (error) throw new Error('Add contact failed: ' + error.message);

    AppState.techSupportContacts.push({
      id: data.id, name: data.name, role: data.role, phone: data.phone,
    });
    Events.emit(EVT.SCHOOLS_CHANGED, {});   
    return data;
  },

  async deleteContact(id) {
    await requireAuth();
    const { error } = await DB.from('tech_contacts').delete().eq('id', id);
    if (error) throw new Error('Delete failed: ' + error.message);

    AppState.techSupportContacts = AppState.techSupportContacts.filter(c => c.id !== id);
    Events.emit(EVT.SCHOOLS_CHANGED, {});   // ← triggers footer re-render
  },

  /* ---------- APP SETTINGS ---------- */
  async saveAcademicConfig({ year, term }) {
    await requireAuth();
    const { error } = await DB
      .from('app_settings')
      .update({ academic_year: year, active_term: term, updated_at: new Date().toISOString() })
      .eq('id', 1);
    if (error) throw new Error('Save settings failed: ' + error.message);

    AppState.academicConfig.year = year;
    AppState.academicConfig.term = term;
    Events.emit(EVT.SETTINGS_CHANGED, {});
  },

  async saveNextOpening({ date, note }) {
    await requireAuth();
    const { error } = await DB
      .from('app_settings')
      .update({ next_opening: { date, note }, updated_at: new Date().toISOString() })
      .eq('id', 1);
    if (error) throw new Error('Save failed: ' + error.message);

    AppState.nextOpening = { date, note };
    Events.emit(EVT.SETTINGS_CHANGED, {});
  },

  async saveSchemaForClass(className, { subjects, maxPerSubject }) {
    await requireAuth();
    const newSchema = { ...(AppState.customSchema || {}) };
    newSchema[className] = { subjects, maxPerSubject };

    const { error } = await DB
      .from('app_settings')
      .update({ custom_schema: newSchema, updated_at: new Date().toISOString() })
      .eq('id', 1);
    if (error) throw new Error('Save schema failed: ' + error.message);

    AppState.customSchema = newSchema;
    Events.emit(EVT.SETTINGS_CHANGED, {});
  },
};