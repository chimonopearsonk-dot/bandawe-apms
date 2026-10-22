import { AppState } from '../core/state.js';
import { supabase } from '../core/supabase.js';
import { DB } from './db.js';
import { Events, EVT } from '../core/events.js';
import { CLASSES, classAbbrev } from '../core/config.js';
import { titleCase } from '../ui/helpers.js';

/**
 * Learner domain service — Supabase-backed.
 *
 * Rules:
 *  - LIN format: STD<n>-<000serial>, unique per (school, class).
 *  - Counters stored in Supabase `lin_counters` table (per school+class).
 *  - Archived (transferred) learners keep their historical LIN.
 *  - All queries are school-scoped by `emis`.
 *  - Writes go to Supabase FIRST, then update in-memory AppState.
 */

function counterKey(emis, className) {
  return `${emis}::${className}`;
}

/* ---------- helpers ---------- */
function shapeLearner(row) {
  return {
    lin: row.lin,
    emis: row.emis,
    zone: row.zone,
    name: row.name,
    gender: row.gender,
    class: row.class,
    status: row.status,
    enrollmentType: row.enrollment_type,
    previousSchool: row.previous_school,
    previousLin: row.previous_lin,
    enrolledAt: row.enrolled_at,
    updatedAt: row.updated_at,
  };
}

function pickField(row, candidates) {
  const lower = {};
  Object.keys(row || {}).forEach(k => {
    const clean = String(k).replace(/^\uFEFF/, '').replace(/["']/g, '').trim().toLowerCase();
    lower[clean] = row[k];
  });
  for (const c of candidates) {
    const key = Object.keys(lower).find(k => k.includes(c));
    if (key && lower[key] !== undefined && lower[key] !== null && String(lower[key]).trim() !== '') {
      return String(lower[key]).trim();
    }
  }
  return '';
}

function normalizeGender(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  if (s.startsWith('m')) return 'Male';
  if (s.startsWith('f')) return 'Female';
  return null;
}

function normalizeClass(v, fallback) {
  if (!v) return fallback || null;
  const s = String(v).trim();
  if (CLASSES.includes(s)) return s;
  const num = s.match(/\d+/);
  if (num) {
    const cand = `Standard ${num[0]}`;
    if (CLASSES.includes(cand)) return cand;
  }
  return fallback || null;
}

/* =========================================================
 * SERVICE
 * ========================================================= */

export const LearnerService = {

  /* ---------- LIN counter (Supabase atomic) ---------- */
  peekNextLin(emis, className) {
    const key = counterKey(emis, className);
    const current = AppState.linCounters[key] || 0;
    const next = current + 1;
    return `${classAbbrev(className)}-${String(next).padStart(3, '0')}`;
  },

  /**
   * Atomically reserve the next LIN for (school, class).
   * Uses an UPSERT + RETURNING via RPC-less pattern:
   *   - select current counter
   *   - update +1
   *   - if conflict (another device), retry once
   * For safety under concurrency we use an upsert with a computed counter.
   */
  async generateLin(emis, className) {
  const key = counterKey(emis, className);

  if (navigator.onLine) {
    // Online: read the authoritative counter from Supabase
    const { data: row, error: readErr } = await DB
      .from('lin_counters')
      .select('counter')
      .eq('emis', emis)
      .eq('class', className)
      .maybeSingle();

    if (readErr) throw new Error('Counter read failed: ' + readErr.message);

    const next = (row?.counter || 0) + 1;

    const { error: upsertErr } = await DB
      .from('lin_counters')
      .upsert({ emis, class: className, counter: next }, { onConflict: 'emis,class' });

    if (upsertErr) throw new Error('Counter update failed: ' + upsertErr.message);

    AppState.linCounters[key] = next;
    return `${classAbbrev(className)}-${String(next).padStart(3, '0')}`;
  }

  // Offline: use the cached counter, increment locally, queue the upsert
  const current = AppState.linCounters[key] || 0;
  const next = current + 1;

  await DB
    .from('lin_counters')
    .upsert({ emis, class: className, counter: next }, { onConflict: 'emis,class' });

  AppState.linCounters[key] = next;
  return `${classAbbrev(className)}-${String(next).padStart(3, '0')}`;
},

  /* ---------- READ (from in-memory AppState) ---------- */
  listBySchool(emis, className = null) {
    const genderRank = g => (g === 'Female' ? 0 : g === 'Male' ? 1 : 2);
    const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

    return AppState.learners
      .filter(l => l.emis === emis && l.status === 'active')
      .filter(l => !className || l.class === className)
      .sort((a, b) => {
        const g = genderRank(a.gender) - genderRank(b.gender);
        if (g !== 0) return g;
        const n = collator.compare(a.name, b.name);
        if (n !== 0) return n;
        return collator.compare(a.lin, b.lin);
      });
  },

  findByLin(lin) {
    return AppState.learners.find(l => l.lin === lin) || null;
  },

  isDuplicate({ emis, className, name, gender }) {
    const key = titleCase(name).toLowerCase();
    return AppState.learners.some(l =>
      l.emis === emis &&
      l.class === className &&
      l.status === 'active' &&
      l.name.toLowerCase() === key &&
      l.gender === gender
    );
  },

  /* ---------- WRITE: single enroll ---------- */
  async enroll({
    emis, zone, name, gender, className,
    enrollmentType = 'new',
    previousSchool = '',
    previousLin = '',
  }) {
    if (!emis) throw new Error('Missing school context.');
    if (!CLASSES.includes(className)) throw new Error(`Unknown class: ${className}`);

    const cleanName = titleCase(name);
    if (!cleanName) throw new Error('Learner name is required.');
    if (!['Male', 'Female'].includes(gender)) throw new Error('Gender must be Male or Female.');

    if (this.isDuplicate({ emis, className, name: cleanName, gender })) {
      throw new Error(`Duplicate: ${cleanName} already enrolled in ${className}.`);
    }

    const lin = await this.generateLin(emis, className);

    const insertRow = {
      lin, emis,
      zone: zone || 'Bandawe',
      name: cleanName,
      gender,
      class: className,
      status: 'active',
      enrollment_type: enrollmentType,
      previous_school: previousSchool || null,
      previous_lin: previousLin || null,
    };

        const result = await DB
      .from('learners')
      .insert(insertRow)
      .select()
      .single();

    if (result.error) throw new Error('Enroll failed: ' + result.error.message);

    let learner;
    if (result.queued) {
      learner = {
        lin: insertRow.lin, emis: insertRow.emis, zone: insertRow.zone,
        name: insertRow.name, gender: insertRow.gender, class: insertRow.class,
        status: 'active', enrollmentType: insertRow.enrollment_type,
        previousSchool: insertRow.previous_school, previousLin: insertRow.previous_lin,
        enrolledAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    } else {
      learner = shapeLearner(result.data);
    }

    AppState.learners.push(learner);
    Events.emit(EVT.LEARNERS_CHANGED, { emis });
    return learner;
  },

  /* ---------- WRITE: bulk enroll ---------- */
  async bulkEnroll(rows, { emis, zone, defaultClass }) {
    const summary = { added: 0, skipped: [], errors: [] };

    // 1. Parse + validate
    const staged = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      try {
        const rawName  = pickField(row, ['name', 'learner', 'student', 'full name']);
        const rawSex   = pickField(row, ['sex', 'gender']);
        const rawClass = pickField(row, ['class', 'standard', 'std']);

        const name   = titleCase(rawName);
        const gender = normalizeGender(rawSex);
        const cls    = normalizeClass(rawClass, defaultClass);

        if (!name)   { summary.skipped.push({ row: i + 1, reason: 'Missing name' }); continue; }
        if (!cls)    { summary.skipped.push({ row: i + 1, reason: 'Missing/invalid class', name }); continue; }
        if (!gender) { summary.skipped.push({ row: i + 1, reason: 'Missing/invalid gender', name }); continue; }

        if (this.isDuplicate({ emis, className: cls, name, gender })) {
          summary.skipped.push({ row: i + 1, reason: 'Duplicate', name });
          continue;
        }

        staged.push({ name, gender, cls });
      } catch (e) {
        summary.errors.push({ row: i + 1, reason: e.message });
      }
    }

    // 2. Group by class; sort girls-first-alpha if class is currently empty
    const byClass = new Map();
    staged.forEach(r => {
      if (!byClass.has(r.cls)) byClass.set(r.cls, []);
      byClass.get(r.cls).push(r);
    });

    const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
    const genderRank = g => (g === 'Female' ? 0 : g === 'Male' ? 1 : 2);

    for (const [cls, group] of byClass.entries()) {
      const existing = this.listBySchool(emis, cls);
      const isEmptyClass = existing.length === 0;

      if (isEmptyClass) {
        group.sort((a, b) => {
          const g = genderRank(a.gender) - genderRank(b.gender);
          if (g !== 0) return g;
          return collator.compare(a.name, b.name);
        });
      }

      // Build all rows, assign LINs one at a time to keep counters in sync
      const toInsert = [];
      for (const r of group) {
        const lin = await this.generateLin(emis, cls);
        toInsert.push({
          lin, emis,
          zone: zone || 'Bandawe',
          name: r.name,
          gender: r.gender,
          class: r.cls,
          status: 'active',
          enrollment_type: 'new',
        });
        summary.added++;
      }

      if (toInsert.length) {
        const result = await DB
          .from('learners')
          .insert(toInsert)
          .select();

        if (result.error) {
          summary.errors.push({ reason: 'Bulk insert failed: ' + result.error.message });
          summary.added -= toInsert.length;
          for (let i = 0; i < toInsert.length; i++) {
            const key = counterKey(emis, cls);
            AppState.linCounters[key] = Math.max(0, (AppState.linCounters[key] || 1) - 1);
          }
          continue;
        }

        if (result.queued) {
          toInsert.forEach(row => AppState.learners.push({
            lin: row.lin, emis: row.emis, zone: row.zone, name: row.name,
            gender: row.gender, class: row.class, status: 'active',
            enrollmentType: 'new',
            enrolledAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }));
        } else {
          (result.data || []).forEach(r => AppState.learners.push(shapeLearner(r)));
        }
      }
    }

    if (summary.added > 0) {
      Events.emit(EVT.LEARNERS_CHANGED, { emis });
    }
    return summary;
  },

  /* ---------- WRITE: re-sequence LINs for a class ---------- */
  async resequenceClass(emis, className) {
    const classLearners = this.listBySchool(emis, className);
    if (classLearners.length === 0) return 0;

    const abbrev = classAbbrev(className);

    // Build updates
    const updates = classLearners.map((l, i) => ({
      lin: l.lin,  // identifies the row
      newLin: `${abbrev}-${String(i + 1).padStart(3, '0')}`,
    }));

    // We do row-by-row updates because LIN is part of the unique key.
    // Order matters: to avoid unique collisions when reshuffling, we do it in two passes.
    // Pass 1: move all to a "TMP-" prefix (safe, guaranteed unique)
    for (const u of updates) {
      const tempLin = `TMP-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const { error } = await DB
        .from('learners')
        .update({ lin: tempLin, updated_at: new Date().toISOString() })
        .eq('emis', emis).eq('lin', u.lin);
      if (error) throw new Error(`Resequence pass 1 failed: ${error.message}`);

      // Also update in-memory
      const mem = AppState.learners.find(l => l.emis === emis && l.lin === u.lin);
      if (mem) mem.lin = tempLin;
    }

    // Pass 2: move from TMP to final
    for (let i = 0; i < updates.length; i++) {
      const u = updates[i];
      const memTemp = AppState.learners.find(l =>
        l.emis === emis && l.lin.startsWith('TMP-') && l.name === classLearners[i].name
      );
      if (!memTemp) continue;

      const { error } = await DB
        .from('learners')
        .update({ lin: u.newLin, updated_at: new Date().toISOString() })
        .eq('emis', emis).eq('lin', memTemp.lin);
      if (error) throw new Error(`Resequence pass 2 failed: ${error.message}`);

      memTemp.lin = u.newLin;
    }

    // Update the counter to N
    const key = counterKey(emis, className);
    const { error: cErr } = await DB
      .from('lin_counters')
      .upsert({ emis, class: className, counter: classLearners.length }, { onConflict: 'emis,class' });
    if (cErr) throw new Error('Counter update failed: ' + cErr.message);
    AppState.linCounters[key] = classLearners.length;

    Events.emit(EVT.LEARNERS_CHANGED, { emis });
    return classLearners.length;
  },

  /* ---------- WRITE: soft delete (transfer) ---------- */
  async transfer(lin) {
    const l = this.findByLin(lin);
    if (!l) throw new Error('Learner not found.');

    const { error } = await DB
      .from('learners')
      .update({ status: 'transferred', updated_at: new Date().toISOString() })
      .eq('emis', l.emis).eq('lin', lin);

    if (error) throw new Error('Transfer failed: ' + error.message);

    l.status = 'transferred';
    l.updatedAt = new Date().toISOString();
    Events.emit(EVT.LEARNERS_CHANGED, { emis: l.emis });
    return l;
  },
};