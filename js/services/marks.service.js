import { AppState } from '../core/state.js';
import { supabase } from '../core/supabase.js';
import { DB } from './db.js';
import { Events, EVT } from '../core/events.js';
import {
  SUBJECT_BY_CODE,
  CLASS_EXAM_SCHEMA,
  ACADEMIC_TERMS,
  GRADE_BANDS,
  CA_MAX,
} from '../core/config.js';

/**
 * Marks domain service — Supabase-backed.
 *
 * Stores:
 *   AppState.marks.ca[lin][subject][month] = score
 *   AppState.marks.exam[lin][subject] = score
 *   AppState.marks.mock[lin][subject] = score
 *
 * All writes hit Supabase first, then update AppState.
 */

export const MarksService = {

  /* ---------- grade ---------- */
  grade(percent) {
    if (percent === null || percent === undefined || isNaN(percent)) return null;
    return GRADE_BANDS.find(b => percent >= b.min) || GRADE_BANDS[GRADE_BANDS.length - 1];
  },

  schemaForClass(className) {
    return AppState.customSchema?.[className]
        || CLASS_EXAM_SCHEMA[className]
        || null;
  },

  monthsForCurrentTerm() {
    const term = AppState.academicConfig.term;
    return ACADEMIC_TERMS[term] || [];
  },

  /* ---------- READ (from AppState) ---------- */
  getCaScore(lin, subjectCode, month) {
    return AppState.marks.ca?.[lin]?.[subjectCode]?.[month] ?? null;
  },

  caSubjectAverage(lin, subjectCode, months) {
    const scores = months
      .map(m => AppState.marks.ca?.[lin]?.[subjectCode]?.[m])
      .filter(v => typeof v === 'number');
    if (!scores.length) return null;
    return +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
  },

  caMonthAverage(lin, subjectCodes, month) {
    const scores = subjectCodes
      .map(sc => AppState.marks.ca?.[lin]?.[sc]?.[month])
      .filter(v => typeof v === 'number');
    if (!scores.length) return null;
    return +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
  },

  caTermAverage(lin, subjectCodes, months) {
    const scores = [];
    subjectCodes.forEach(sc => months.forEach(m => {
      const v = AppState.marks.ca?.[lin]?.[sc]?.[m];
      if (typeof v === 'number') scores.push(v);
    }));
    if (!scores.length) return null;
    return +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
  },

  getExamScore(type, lin, subjectCode) {
    return AppState.marks[type]?.[lin]?.[subjectCode] ?? null;
  },

  /* ---------- WRITE: CA ---------- */
  async setCaScore(lin, subjectCode, month, value) {
    const emis = AppState.currentSession?.emis;
    if (!emis) throw new Error('No active session.');

    let v = parseInt(value, 10);
    if (isNaN(v)) v = null;
    else v = Math.max(0, Math.min(CA_MAX, v));

    if (v === null) {
      // Delete the row
      const { error } = await DB
        .from('marks_ca')
        .delete()
        .eq('emis', emis).eq('lin', lin).eq('subject', subjectCode).eq('month', month);
      if (error) throw new Error('CA delete failed: ' + error.message);

      // Update in-memory
      if (AppState.marks.ca?.[lin]?.[subjectCode]) {
        delete AppState.marks.ca[lin][subjectCode][month];
      }
    } else {
      const { error } = await DB
        .from('marks_ca')
        .upsert({
          emis, lin, subject: subjectCode, month,
          score: v, updated_at: new Date().toISOString(),
        }, { onConflict: 'emis,lin,subject,month' });
      if (error) throw new Error('CA save failed: ' + error.message);

      AppState.marks.ca[lin] ??= {};
      AppState.marks.ca[lin][subjectCode] ??= {};
      AppState.marks.ca[lin][subjectCode][month] = v;
    }

    Events.emit(EVT.MARKS_CHANGED, { type: 'ca', lin });
  },

  /* ---------- WRITE: EXAM / MOCK ---------- */
  async setExamScore(type, lin, subjectCode, value, maxPerSubject) {
    const emis = AppState.currentSession?.emis;
    if (!emis) throw new Error('No active session.');
    if (!['exam', 'mock'].includes(type)) throw new Error('Invalid mark type: ' + type);

    let v = parseInt(value, 10);
    if (isNaN(v)) v = null;
    else v = Math.max(0, Math.min(maxPerSubject, v));

    const table = type === 'exam' ? 'marks_exam' : 'marks_mock';

    if (v === null) {
      const { error } = await DB
        .from(table)
        .delete()
        .eq('emis', emis).eq('lin', lin).eq('subject', subjectCode);
      if (error) throw new Error(`${type} delete failed: ` + error.message);

      if (AppState.marks[type]?.[lin]) {
        delete AppState.marks[type][lin][subjectCode];
      }
    } else {
      const { error } = await DB
        .from(table)
        .upsert({
          emis, lin, subject: subjectCode,
          score: v, updated_at: new Date().toISOString(),
        }, { onConflict: 'emis,lin,subject' });
      if (error) throw new Error(`${type} save failed: ` + error.message);

      AppState.marks[type][lin] ??= {};
      AppState.marks[type][lin][subjectCode] = v;
    }

    Events.emit(EVT.MARKS_CHANGED, { type, lin });
  },

  /* ---------- compute (unchanged) ---------- */
  computeLearnerTotals(type, lin, className) {
    const schema = this.schemaForClass(className);
    if (!schema) return null;

    const scores = schema.subjects.map(sc => {
      const v = AppState.marks[type]?.[lin]?.[sc];
      return typeof v === 'number' ? v : 0;
    });

    const total     = scores.reduce((a, b) => a + b, 0);
    const maxTotal  = schema.subjects.length * schema.maxPerSubject;
    const avgPercent = maxTotal > 0 ? +((total / maxTotal) * 100).toFixed(1) : 0;
    const grade     = this.grade(avgPercent);

    return {
      scores, total, maxTotal, avgPercent,
      grade:  grade?.letter || '—',
      status: grade?.status || '—',
      color:  grade?.color  || '',
    };
  },

  rankClass(type, learners, className) {
    const rows = learners.map(l => ({
      learner: l,
      computed: this.computeLearnerTotals(type, l.lin, className),
    }));

    rows.sort((a, b) => {
      const ta = a.computed?.total ?? 0;
      const tb = b.computed?.total ?? 0;
      if (tb !== ta) return tb - ta;
      return a.learner.name.localeCompare(b.learner.name);
    });

    let prevTotal = null;
    let prevRank = 0;
    rows.forEach((r, i) => {
      const t = r.computed?.total ?? 0;
      if (t === prevTotal) {
        r.position = prevRank;
      } else {
        r.position = i + 1;
        prevRank = r.position;
        prevTotal = t;
      }
    });

    return rows;
  },

  /* ---------- BULK: CA ---------- */
  async bulkSetCa(rows) {
    const emis = AppState.currentSession?.emis;
    if (!emis) throw new Error('No active session.');

    const added = [];
    const skipped = [];

    for (let i = 0; i < rows.length; i++) {
      const { lin, subjectCode, month, score } = rows[i];
      if (!lin || !subjectCode || !month) {
        skipped.push({ row: i + 1, reason: 'Missing LIN/subject/month' });
        continue;
      }
      if (!SUBJECT_BY_CODE[subjectCode]) {
        skipped.push({ row: i + 1, reason: `Unknown subject ${subjectCode}` });
        continue;
      }
      const v = parseInt(score, 10);
      if (isNaN(v) || v < 0 || v > CA_MAX) {
        skipped.push({ row: i + 1, reason: `Invalid score ${score}` });
        continue;
      }
      added.push({ emis, lin, subject: subjectCode, month, score: v, updated_at: new Date().toISOString() });
    }

    if (added.length) {
      const { error } = await DB
        .from('marks_ca')
        .upsert(added, { onConflict: 'emis,lin,subject,month' });
      if (error) throw new Error('Bulk CA failed: ' + error.message);

      added.forEach(a => {
        AppState.marks.ca[a.lin] ??= {};
        AppState.marks.ca[a.lin][a.subject] ??= {};
        AppState.marks.ca[a.lin][a.subject][a.month] = a.score;
      });
      Events.emit(EVT.MARKS_CHANGED, { type: 'ca' });
    }

    return { added: added.length, skipped };
  },

  /* ---------- BULK: EXAM / MOCK ---------- */
  async bulkSetExam(type, rows, className) {
    const emis = AppState.currentSession?.emis;
    if (!emis) throw new Error('No active session.');

    const schema = this.schemaForClass(className);
    if (!schema) return { added: 0, skipped: [{ reason: `No schema for ${className}` }] };

    const added = [];
    const skipped = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const lin = r.__lin;
      if (!lin) { skipped.push({ row: i + 1, reason: 'Missing LIN' }); continue; }

      schema.subjects.forEach(sc => {
        const raw = r[sc];
        if (raw === undefined || raw === null || String(raw).trim() === '') return;
        const v = parseInt(raw, 10);
        if (isNaN(v)) return;
        const clamped = Math.max(0, Math.min(schema.maxPerSubject, v));
        added.push({
          emis, lin, subject: sc, score: clamped,
          updated_at: new Date().toISOString(),
        });
      });
    }

    if (added.length) {
      const table = type === 'exam' ? 'marks_exam' : 'marks_mock';
      const { error } = await DB
        .from(table)
        .upsert(added, { onConflict: 'emis,lin,subject' });
      if (error) throw new Error(`Bulk ${type} failed: ` + error.message);

      added.forEach(a => {
        AppState.marks[type][a.lin] ??= {};
        AppState.marks[type][a.lin][a.subject] = a.score;
      });
      Events.emit(EVT.MARKS_CHANGED, { type });
    }

    return { added: added.length, skipped };
  },
};