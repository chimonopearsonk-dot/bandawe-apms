import { AppState } from '../core/state.js';
import { Storage } from './storage.js';
import { Events, EVT } from '../core/events.js';

/**
 * Full state backup / restore.
 * Format: a single .json file with all persisted keys.
 */

const BACKUP_VERSION = 1;

export const BackupService = {

  async exportAll() {
    const payload = {
      _meta: {
        app: 'Bandawe Zone APMS',
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
      },
      schools:          AppState.schools,
      pendingApprovals: AppState.pendingApprovals,
      announcements:    AppState.announcements,
      techSupportContacts: AppState.techSupportContacts,
      learners:         AppState.learners,
      linCounters:      AppState.linCounters,
      academicConfig:   AppState.academicConfig,
      zones:            AppState.zones,
      marks:            AppState.marks,
      remarks:          AppState.remarks,
      images:           AppState.images,
      nextOpening:      AppState.nextOpening,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `Bandawe_Backup_${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 500);
    return true;
  },

  async importFromFile(file) {
    if (!file) throw new Error('No file provided.');
    const text = await file.text();
    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error('Invalid JSON — not a valid backup file.'); }

    if (!data || typeof data !== 'object') throw new Error('Backup file is empty or malformed.');
    if (!data._meta || data._meta.app !== 'Bandawe Zone APMS') {
      throw new Error('This file is not a Bandawe Zone APMS backup.');
    }

    // Overwrite in-memory state
    const assign = (key) => { if (data[key] !== undefined) AppState[key] = data[key]; };
    ['schools','pendingApprovals','announcements','techSupportContacts',
     'learners','linCounters','academicConfig','zones','marks',
     'remarks','images','nextOpening'].forEach(assign);

    // Persist everything
    await Promise.all([
      Storage.saveSchools(),
      Storage.savePending(),
      Storage.saveAnnouncements(),
      Storage.saveTechContacts(),
      Storage.saveLearners(),
      Storage.saveLinCounters(),
      Storage.saveAcademicConfig(),
      Storage.saveZones(),
      Storage.saveMarks(),
      Storage.saveRemarks(),
      Storage.saveImages(),
      Storage.saveNextOpening(),
    ]);

    Events.emit(EVT.SCHOOLS_CHANGED,  {});
    Events.emit(EVT.LEARNERS_CHANGED, {});
    Events.emit(EVT.SETTINGS_CHANGED, {});
    Events.emit(EVT.IMAGES_CHANGED,   {});

    return {
      schools:    AppState.schools.length,
      learners:   AppState.learners.length,
      exportedAt: data._meta.exportedAt,
    };
  },

  /** Wipe everything back to seed (for testing). Requires explicit confirmation. */
  async factoryReset() {
    if (!confirm('This will ERASE all data and restore seed defaults. Continue?')) return false;
    if (!confirm('Are you absolutely sure? This cannot be undone.')) return false;

    Object.keys(localStorage).forEach(k => {
      if (k.startsWith('zonal_')) localStorage.removeItem(k);
    });
    sessionStorage.clear();
    location.reload();
    return true;
  },
};