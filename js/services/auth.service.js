import { AppState } from '../core/state.js';
import { supabase } from '../core/supabase.js';
import { Storage } from './storage.js';
import { Events, EVT } from '../core/events.js';

/**
 * Auth via Supabase.
 *
 * Login flow:
 *   1. User enters EMIS + password.
 *   2. We map EMIS → synthetic email (bz-101@bandawe.zone).
 *   3. Supabase signs them in.
 *   4. We check the school is verified; if not, we sign out.
 */

const EMAIL_DOMAIN = 'bandawe.zone';

function emisToEmail(emis) {
  return `${String(emis).trim().toLowerCase()}@${EMAIL_DOMAIN}`;
}

export const AuthService = {

  async login(emis, password) {
    const target = String(emis).trim().toUpperCase();
    if (!target || !password) {
      return { success: false, message: 'EMIS code and password are required.' };
    }

    const email = emisToEmail(target);

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      return { success: false, message: 'Invalid EMIS code or password.' };
    }

    // Fetch the matching school record
    const { data: schoolRow, error: schoolErr } = await supabase
      .from('schools')
      .select('*')
      .eq('emis', target)
      .maybeSingle();

    if (schoolErr || !schoolRow) {
      await supabase.auth.signOut();
      return { success: false, message: 'School account not found.' };
    }

    if (!schoolRow.verified) {
      await supabase.auth.signOut();
      return { success: false, message: 'Account pending Superadmin approval.' };
    }

    const session = {
      emis: schoolRow.emis,
      zone: schoolRow.zone || 'Bandawe',
      name: schoolRow.name,
      contactPerson: schoolRow.contact_person,
      requiresPasswordChange: false, // Supabase doesn't have a "default password" concept
      userId: data.user.id,
    };

    await Storage.setSession(session);
    Events.emit(EVT.SESSION_CHANGED, session);
    return { success: true, session };
  },

  async logout() {
    try { await supabase.auth.signOut(); } catch {}
    await Storage.setSession(null);
    Events.emit(EVT.SESSION_CHANGED, null);
  },

  /**
   * Check if there's an existing Supabase session — restores login across refreshes.
   */
    async restoreSession() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;

    // Look up the profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('emis, is_superadmin, display_name')
      .eq('id', session.user.id)
      .maybeSingle();

    if (!profile) return null;

    // Superadmin session — do NOT auto-navigate to a school dashboard
    if (profile.is_superadmin) {
      const sess = {
        emis: null,
        zone: 'Bandawe',
        name: profile.display_name || 'Superadmin',
        contactPerson: null,
        requiresPasswordChange: false,
        userId: session.user.id,
        isSuperadmin: true,
      };
      AppState.currentSession = sess;
      await Storage.setSession(sess);
      return sess;
    }

    // School session — requires a linked emis
    if (!profile.emis) return null;

    const { data: schoolRow } = await supabase
      .from('schools')
      .select('*')
      .eq('emis', profile.emis)
      .maybeSingle();

    if (!schoolRow) return null;

    const sess = {
      emis: schoolRow.emis,
      zone: schoolRow.zone || 'Bandawe',
      name: schoolRow.name,
      contactPerson: schoolRow.contact_person,
      requiresPasswordChange: false,
      userId: session.user.id,
      isSuperadmin: false,
    };
    AppState.currentSession = sess;
    await Storage.setSession(sess);
    return sess;
  },

  /**
   * Change password for the currently logged-in user.
   */
  async changePassword(newPassword) {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw new Error(error.message);
  },
};