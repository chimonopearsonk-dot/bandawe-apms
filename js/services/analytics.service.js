import { AppState } from '../core/state.js';
import { SUBJECT_BY_CODE } from '../core/config.js';
import { LearnerService } from './learner.service.js';
import { MarksService } from './marks.service.js';

/**
 * Analytics + summary helpers used by:
 *   - Analytics tab (school-wide + class drill-down)
 *   - Broadsheet tab (per-class summary table)
 *   - Excel exports
 */

export const AnalyticsService = {

  /**
   * Summary for one class within a school.
   * @param {string} type 'exam' | 'mock'
   * @param {string} emis
   * @param {string} className
   */
  classSummary(type, emis, className) {
    const learners = LearnerService.listBySchool(emis, className);
    const schema   = MarksService.schemaForClass(className);
    if (!schema) return null;

    const stats = {
      registered: { F: 0, M: 0, total: 0 },
      sat:        { F: 0, M: 0, total: 0 },
      passed:     { F: 0, M: 0, total: 0 },
    };

    learners.forEach(l => {
      const sex = l.gender === 'Female' ? 'F' : 'M';
      stats.registered[sex]++;
      stats.registered.total++;

      const marks = AppState.marks[type]?.[l.lin] || {};
      const values = schema.subjects.map(sc => marks[sc]);
      const hasAny = values.some(v => typeof v === 'number');

      if (hasAny) {
        stats.sat[sex]++;
        stats.sat.total++;

        const computed = MarksService.computeLearnerTotals(type, l.lin, className);
        if (computed?.status === 'Pass') {
          stats.passed[sex]++;
          stats.passed.total++;
        }
      }
    });

    const classPct = stats.sat.total > 0
      ? +((stats.passed.total / stats.sat.total) * 100).toFixed(1)
      : 0;

    return { stats, classPct, schema, learners };
  },

  /**
   * School-wide analytics: rolls up all classes.
   */
  schoolSummary(type, emis) {
    const classes = [...new Set(
      LearnerService.listBySchool(emis).map(l => l.class)
    )].sort();

    const rows = classes.map(c => ({
      className: c,
      ...this.classSummary(type, emis, c),
    })).filter(r => r.schema);

    const totals = {
      registered: { F: 0, M: 0, total: 0 },
      sat:        { F: 0, M: 0, total: 0 },
      passed:     { F: 0, M: 0, total: 0 },
    };

    rows.forEach(r => {
      totals.registered.F += r.stats.registered.F;
      totals.registered.M += r.stats.registered.M;
      totals.registered.total += r.stats.registered.total;
      totals.sat.F += r.stats.sat.F;
      totals.sat.M += r.stats.sat.M;
      totals.sat.total += r.stats.sat.total;
      totals.passed.F += r.stats.passed.F;
      totals.passed.M += r.stats.passed.M;
      totals.passed.total += r.stats.passed.total;
    });

    const overallPct = totals.sat.total > 0
      ? +((totals.passed.total / totals.sat.total) * 100).toFixed(1)
      : 0;

    return { rows, totals, overallPct };
  },

  /**
   * Grade distribution per subject — used by Standard 8 Mock summary.
   */
  gradeDistribution(type, emis, className) {
    const learners = LearnerService.listBySchool(emis, className);
    const schema   = MarksService.schemaForClass(className);
    if (!schema) return null;

    const dist = {};
    schema.subjects.forEach(sc => {
      dist[sc] = { A: 0, B: 0, C: 0, D: 0, F: 0 };
    });

    learners.forEach(l => {
      const marks = AppState.marks[type]?.[l.lin] || {};
      schema.subjects.forEach(sc => {
        const v = marks[sc];
        if (typeof v !== 'number') return;
        const pct = (v / schema.maxPerSubject) * 100;
        const grade = MarksService.grade(pct);
        if (grade) dist[sc][grade.letter]++;
      });
    });

    return { dist, schema };
  },

  /**
   * School-wide class-level stats for the Analytics tab.
   */
  classStats(type, emis, className) {
    const learners = LearnerService.listBySchool(emis, className);
    const schema   = MarksService.schemaForClass(className);
    if (!schema || !learners.length) return null;

    const avgs   = [];
    const totals = [];

    learners.forEach(l => {
      const c = MarksService.computeLearnerTotals(type, l.lin, className);
      if (c && typeof c.avgPercent === 'number') {
        avgs.push(c.avgPercent);
        totals.push(c.total);
      }
    });

    if (!avgs.length) return null;

    const mean     = +(avgs.reduce((a, b) => a + b, 0) / avgs.length).toFixed(1);
    const highest  = Math.max(...totals);
    const lowest   = Math.min(...totals);
    const passCount = learners.filter(l => {
      const c = MarksService.computeLearnerTotals(type, l.lin, className);
      return c?.status === 'Pass';
    }).length;

    return {
      mean, highest, lowest,
      passCount,
      passRate: +((passCount / learners.length) * 100).toFixed(1),
      count: learners.length,
    };
  },
};