import { supabase } from '../core/supabase.js';
import { OfflineQueue } from './offline-queue.js';

/**
 * DB wrapper around Supabase.
 *
 * Reads always pass through.
 * Writes queue when offline, and return a chainable result
 * that supports .select(), .single(), .eq(), and await.
 */

export const DB = {
  from(table) {
    return {
      // ---------- READS ----------
      select(...args) {
        return supabase.from(table).select(...args);
      },

      // ---------- INSERT ----------
      insert(payload) {
        if (navigator.onLine) {
          return supabase.from(table).insert(payload);
        }
        OfflineQueue.enqueue({ table, action: 'insert', payload });
        return makeQueuedResult(payload, 'insert');
      },

      // ---------- UPSERT ----------
      upsert(payload, opts = {}) {
        if (navigator.onLine) {
          return supabase.from(table).upsert(payload, opts);
        }
        OfflineQueue.enqueue({ table, action: 'upsert', payload, onConflict: opts.onConflict });
        return makeQueuedResult(payload, 'upsert');
      },

      // ---------- UPDATE ----------
      update(payload) {
        if (navigator.onLine) {
          return supabase.from(table).update(payload);
        }
        return makeQueuedUpdateOrDelete(table, 'update', payload);
      },

      // ---------- DELETE ----------
      delete() {
        if (navigator.onLine) {
          return supabase.from(table).delete();
        }
        return makeQueuedUpdateOrDelete(table, 'delete', null);
      },
    };
  },
};

/**
 * For insert/upsert offline — already queued, so this is a thin
 * chainable that resolves to a synthetic success.
 */
function makeQueuedResult(payload, action) {
  const result = {
    select() { return result; },
    single() { return Promise.resolve({ data: null, error: null, queued: true }); },
    maybeSingle() { return Promise.resolve({ data: null, error: null, queued: true }); },
    eq() { return result; },
    then(resolve, reject) {
      return Promise.resolve({ data: null, error: null, queued: true }).then(resolve, reject);
    },
  };
  return result;
}

/**
 * For update/delete offline — we must collect .eq() first, THEN queue.
 */
function makeQueuedUpdateOrDelete(table, action, payload) {
  const match = {};
  let queued = false;

  const flush = () => {
    if (queued) return;
    queued = true;
    OfflineQueue.enqueue({ table, action, payload, match });
  };

  const result = {
    eq(col, val) {
      match[col] = val;
      return result;
    },
    select() {
      flush();
      return result;
    },
    single() {
      flush();
      return Promise.resolve({ data: null, error: null, queued: true });
    },
    maybeSingle() {
      flush();
      return Promise.resolve({ data: null, error: null, queued: true });
    },
    then(resolve, reject) {
      flush();
      return Promise.resolve({ data: null, error: null, queued: true }).then(resolve, reject);
    },
  };

  return result;
}