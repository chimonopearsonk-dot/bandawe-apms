import { ACADEMIC_DEFAULTS, DEFAULT_ZONES } from './config.js';

/**
 * AppState — in-memory store.
 *
 * Data is loaded asynchronously from Supabase on boot.
 * localStorage is retained only as an offline cache for reads.
 */

export const AppState = {
  zones: [...DEFAULT_ZONES],
  academicConfig: { ...ACADEMIC_DEFAULTS },
  adminPasskey: 'BandaweAdmin2026', // legacy — real auth now uses Supabase

  schools: [],
  pendingApprovals: [],
  announcements: [],
  techSupportContacts: [],

  learners: [],
  allLearners: [],
  linCounters: {},

  marks: { ca: {}, exam: {}, mock: {} },
  remarks: {},
  images: { emblem: null, schools: {} },
  nextOpening: { date: '', note: '' },
  customSchema: {},

  currentSession: null,

  /** True once remote data has loaded at least once. */
  ready: false,
};

export const LSKEYS = {
  schools:       'zonal_schools',
  pending:       'zonal_pending_approvals',
  announcements: 'zonal_announcements',
  tech:          'zonal_tech_contacts',
  learners:      'zonal_learners',
  counters:      'zonal_lin_counters',
  academic:      'zonal_academic_config',
  zones:         'zonal_zones',
  session:       'zonal_active_session',
  marks:         'zonal_marks',
  remarks:       'zonal_remarks',
  images:        'zonal_images',
  nextOpening:   'zonal_next_opening',
  customSchema:  'zonal_custom_schema',
};

/** Small helper: safely read JSON from localStorage. */
export function readLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}