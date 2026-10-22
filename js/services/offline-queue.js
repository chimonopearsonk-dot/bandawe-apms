import { supabase } from '../core/supabase.js';
import { Events, EVT } from '../core/events.js';

/**
 * Offline write queue.
 *
 * Strategy:
 *   - Queue lives in localStorage under 'bandawe_offline_queue'
 *   - Every write operation is enqueued here when offline
 *   - On reconnect, queue is flushed in order
 *   - Failures stay in queue for manual retry
 */

const QUEUE_KEY = 'bandawe_offline_queue';
const MAX_QUEUE = 5000;

function readQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function writeQueue(queue) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    Events.emit(EVT.OFFLINE_QUEUE_CHANGED, { count: queue.length });
  } catch (err) {
    console.error('[offline-queue] write failed:', err);
  }
}

export const OfflineQueue = {

  /** Add an operation to the queue. */
  enqueue(op) {
    const queue = readQueue();
    if (queue.length >= MAX_QUEUE) {
      console.warn('[offline-queue] full, dropping oldest');
      queue.shift();
    }
    queue.push({
      ...op,
      id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      queuedAt: new Date().toISOString(),
    });
    writeQueue(queue);
    return queue.length;
  },

  /** Current queue size. */
  count() {
    return readQueue().length;
  },

  /** All queued operations (for debugging / UI). */
  list() {
    return readQueue();
  },

  /** Clear the queue entirely. */
  clear() {
    writeQueue([]);
  },

  /** Flush the queue to Supabase. Called on reconnect. */
  async flush() {
    if (!navigator.onLine) return { ok: 0, failed: 0 };

    const queue = readQueue();
    if (!queue.length) return { ok: 0, failed: 0 };

    let ok = 0, failed = 0;
    const remaining = [];

    for (const op of queue) {
      try {
        await this._execute(op);
        ok++;
      } catch (err) {
        console.error('[offline-queue] flush failed for', op, err);
        failed++;
        remaining.push(op);
      }
    }

    writeQueue(remaining);
    if (ok > 0) {
      Events.emit(EVT.OFFLINE_QUEUE_FLUSHED, { ok, failed });
    }
    return { ok, failed };
  },

  /** Execute one queued operation against Supabase. */
  async _execute(op) {
    const { table, action, payload, match } = op;

    if (action === 'insert') {
      const { error } = await supabase.from(table).insert(payload);
      if (error) throw error;
      return;
    }

    if (action === 'upsert') {
      const { error } = await supabase.from(table).upsert(payload, { onConflict: op.onConflict });
      if (error) throw error;
      return;
    }

    if (action === 'update') {
      let q = supabase.from(table).update(payload);
      for (const [k, v] of Object.entries(match || {})) q = q.eq(k, v);
      const { error } = await q;
      if (error) throw error;
      return;
    }

    if (action === 'delete') {
      let q = supabase.from(table).delete();
      for (const [k, v] of Object.entries(match || {})) q = q.eq(k, v);
      const { error } = await q;
      if (error) throw error;
      return;
    }

    throw new Error('Unknown queue action: ' + action);
  },
};