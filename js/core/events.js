/**
 * Tiny pub/sub. UI modules subscribe; services publish.
 * Keeps services decoupled from UI.
 */

const listeners = new Map();

export const Events = {
  on(event, handler) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(handler);
    return () => listeners.get(event).delete(handler);
  },
  emit(event, payload) {
    if (!listeners.has(event)) return;
    listeners.get(event).forEach(fn => {
      try { fn(payload); } catch (e) { console.error(`[events] ${event}`, e); }
    });
  },
};

export const EVT = {
  LEARNERS_CHANGED: 'learners:changed',
  SCHOOLS_CHANGED:  'schools:changed',
  PENDING_CHANGED:  'pending:changed',
  ANNOUNCE_CHANGED: 'announcements:changed',
  SESSION_CHANGED:  'session:changed',
  CONFIG_CHANGED:   'config:changed',
  MARKS_CHANGED: 'marks:changed',
  REMARKS_CHANGED: 'remarks:changed',
  IMAGES_CHANGED:  'images:changed',
  SETTINGS_CHANGED: 'settings:changed',
  OFFLINE_QUEUE_CHANGED: 'offline:queue-changed',
  OFFLINE_QUEUE_FLUSHED: 'offline:queue-flushed',
};